(function () {
  const config = window.BUDGET_DAD_CONFIG || {};
  const SUPPORT_EMAIL = "marco@idrovofox.com";
  const DEFAULT_POST_LOGIN_REDIRECT = "/planner";
  const DEFAULT_POST_CHECKOUT_REDIRECT = "/planner?checkout=success";
  function isConfiguredValue(value) {
    if (!value) return false;
    const normalized = String(value).trim();
    if (!normalized) return false;
    if (normalized.includes("YOUR_PROJECT")) return false;
    if (normalized.includes("YOUR_SUPABASE_ANON_KEY")) return false;
    if (normalized.includes("your-domain.com")) return false;
    return true;
  }

  const hasConfig = isConfiguredValue(config.SUPABASE_URL) && isConfiguredValue(config.SUPABASE_ANON_KEY);
  const state = {
    client: null,
    user: null,
    profile: null,
    paid: false,
    ready: false
  };
  let resolveReady = null;
  const readyPromise = new Promise(resolve => {
    resolveReady = resolve;
  });

  function getConfiguredAppUrl() {
    if (!isConfiguredValue(config.APP_URL)) return null;
    try {
      const parsed = new URL(String(config.APP_URL).trim());
      const basePath = parsed.pathname.replace(/\/$/, "");
      return `${parsed.origin}${basePath}`;
    } catch (_err) {
      return null;
    }
  }

  function getProjectScopedStorageKey() {
    try {
      const host = new URL(String(config.SUPABASE_URL).trim()).hostname;
      const projectRef = host.split(".")[0] || "default";
      return `budgetdad-auth-${projectRef}`;
    } catch (_err) {
      return "budgetdad-auth";
    }
  }

  function markReady() {
    if (state.ready) return;
    state.ready = true;
    if (resolveReady) {
      resolveReady();
      resolveReady = null;
    }
  }

  function initClient() {
    if (!hasConfig || !window.supabase || state.client) return;
    state.client = window.supabase.createClient(config.SUPABASE_URL, config.SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        storageKey: getProjectScopedStorageKey()
      }
    });

    state.client.auth.onAuthStateChange((_event, session) => {
      state.user = session?.user || null;
      refreshProfile().finally(() => {
        updateAuthUI();
        applyPaidGate();
      });
    });
  }

  function isPaidProfile(profile) {
    if (!profile) return false;
    const status = String(profile.subscription_status || "").toLowerCase();
    return profile.plan === "paid" && (status === "active" || status === "trialing");
  }

  async function refreshUser() {
    if (!state.client) return null;
    const { data, error } = await state.client.auth.getUser();
    if (error) {
      state.user = null;
      return null;
    }
    state.user = data.user || null;
    return state.user;
  }

  async function refreshProfile() {
    if (!state.client || !state.user) {
      state.profile = null;
      state.paid = false;
      return null;
    }

    const { data, error } = await state.client
      .from("profiles")
      .select("id,email,full_name,plan,stripe_customer_id,stripe_subscription_id,subscription_status,current_period_end")
      .eq("id", state.user.id)
      .single();

    if (error) {
      console.warn("Failed to load profile", error);
      state.profile = null;
      state.paid = false;
      return null;
    }

    state.profile = data;
    state.paid = isPaidProfile(data);
    return data;
  }

  async function ensureProfileReady() {
    initClient();
    if (!state.client) return null;
    if (!state.user) await refreshUser();
    if (state.user && !state.profile) {
      await refreshProfile();
    }
    return state.profile;
  }

  async function waitUntilReady(timeoutMs = 4000) {
    if (state.ready) return;
    try {
      await Promise.race([
        readyPromise,
        new Promise((_, reject) => {
          window.setTimeout(() => reject(new Error("timeout")), timeoutMs);
        })
      ]);
    } catch (_err) {
      // Allow fallback behavior when readiness times out.
    }
  }

  async function getSession() {
    if (!state.client) return null;
    const { data } = await state.client.auth.getSession();
    return data.session || null;
  }

  function hasAccessToken(token) {
    return typeof token === "string" && token.trim().length > 0;
  }

  async function getFreshSession() {
    const session = await getSession();
    if (!state.client || !session) return session;

    const expiresAtMs = (session.expires_at || 0) * 1000;
    const hasValidAccessToken = hasAccessToken(session.access_token);
    const shouldRefresh = !hasValidAccessToken || !expiresAtMs || (expiresAtMs - Date.now()) < 60 * 1000;
    if (!shouldRefresh) return session;

    const { data, error } = await state.client.auth.refreshSession();
    if (error) return hasValidAccessToken ? session : null;
    const refreshed = data.session || null;
    if (!refreshed) return hasValidAccessToken ? session : null;
    return hasAccessToken(refreshed.access_token) ? refreshed : (hasValidAccessToken ? session : null);
  }

  async function ensureProjectSession() {
    if (!state.client) return null;

    const session = await getFreshSession();
    if (!hasAccessToken(session?.access_token)) {
      return null;
    }

    const currentUser = await state.client.auth.getUser(session.access_token);
    if (!currentUser.error && currentUser.data?.user) {
      return session;
    }

    const { data, error } = await state.client.auth.refreshSession();
    const refreshed = error ? null : (data.session || null);
    if (hasAccessToken(refreshed?.access_token)) {
      const refreshedUser = await state.client.auth.getUser(refreshed.access_token);
      if (!refreshedUser.error && refreshedUser.data?.user) {
        return refreshed;
      }
    }

    await state.client.auth.signOut();
    state.user = null;
    state.profile = null;
    state.paid = false;
    updateAuthUI();
    applyPaidGate();
    return null;
  }

  function buildRedirectParam() {
    const url = window.location.pathname + window.location.search;
    return encodeURIComponent(url);
  }
  function safeRedirect(value, fallback = DEFAULT_POST_LOGIN_REDIRECT) {
    if (!value) return fallback;
    try {
      const url = new URL(value, window.location.origin);
      if (url.origin === window.location.origin) {
        return url.pathname + url.search + url.hash;
      }
    } catch (_err) {
      // ignore invalid URLs
    }
    return fallback;
  }

  function requireAuth(redirectTo) {
    if (state.user) return true;
    const redirect = redirectTo || buildRedirectParam();
    window.location.href = `/login?redirect=${redirect}`;
    return false;
  }

  function requirePaid(redirectTo) {
    if (state.paid) return true;
    const redirect = redirectTo || buildRedirectParam();
    window.location.href = `/pricing?redirect=${redirect}`;
    return false;
  }

  function applyPaidGate() {
    const paidOnly = document.querySelectorAll("[data-paid-only]");
    const freeOnly = document.querySelectorAll("[data-free-only]");

    paidOnly.forEach(el => {
      el.style.display = state.paid ? "" : "none";
    });
    freeOnly.forEach(el => {
      el.style.display = state.paid ? "none" : "";
    });
  }

  function updateAuthUI() {
    const containers = document.querySelectorAll("[data-auth-nav]");
    containers.forEach(container => {
      if (!hasConfig) {
        container.innerHTML = "";
        return;
      }

      if (state.user) {
        container.innerHTML = `
          <a class="auth-link" href="/account">Account</a>
          <button class="auth-link-button" type="button" data-action="signout">Sign out</button>
        `;
      } else {
        container.innerHTML = `
          <a class="auth-link" href="/login">Sign in</a>
          <a class="button secondary" href="/signup">Sign up</a>
        `;
      }

      container.querySelectorAll("[data-action='signout']").forEach(btn => {
        btn.addEventListener("click", async () => {
          if (!state.client) return;
          await state.client.auth.signOut();
          state.user = null;
          state.profile = null;
          state.paid = false;
          updateAuthUI();
          applyPaidGate();
          if (window.location.pathname === "/account") {
            window.location.href = "/login";
          }
        });
      });
    });
  }

  function showFormMessage(form, message, type) {
    const box = form.querySelector("[data-auth-message]");
    if (!box) return;
    box.textContent = message;
    box.dataset.type = type || "info";
    box.style.display = message ? "block" : "none";
  }

  function showConfigWarningOnForms() {
    document.querySelectorAll("[data-auth-form]").forEach(form => {
      showFormMessage(form, "Auth is not configured. Add real values in /assets/app-config.js.", "error");
    });
  }

  async function handleLogin(form) {
    if (!state.client) return;
    const email = form.querySelector("input[name='email']")?.value?.trim();
    const password = form.querySelector("input[name='password']")?.value || "";

    showFormMessage(form, "Signing you in…", "info");
    const { error } = await state.client.auth.signInWithPassword({ email, password });
    if (error) {
      showFormMessage(form, error.message, "error");
      return;
    }

    await refreshUser();
    await refreshProfile();
    const params = new URLSearchParams(window.location.search);
    const redirect = safeRedirect(params.get("redirect"), DEFAULT_POST_LOGIN_REDIRECT);
    window.location.href = redirect;
  }

  async function handleSignup(form) {
    if (!state.client) return;
    const email = form.querySelector("input[name='email']")?.value?.trim();
    const password = form.querySelector("input[name='password']")?.value || "";

    showFormMessage(form, "Creating your account…", "info");
    const appUrl = getConfiguredAppUrl();
    if (!appUrl) {
      showFormMessage(form, `APP_URL is not configured. Contact support at ${SUPPORT_EMAIL}.`, "error");
      return;
    }
    const { data, error } = await state.client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${appUrl}/planner`
      }
    });

    if (error) {
      showFormMessage(form, error.message, "error");
      return;
    }

    if (data?.user && data?.session) {
      await refreshUser();
      await refreshProfile();
      window.location.href = DEFAULT_POST_LOGIN_REDIRECT;
      return;
    }

    showFormMessage(form, "Check your email to confirm your account.", "success");
  }

  async function handleForgotPassword(form) {
    if (!state.client) return;
    const email = form.querySelector("input[name='email']")?.value?.trim();

    if (!email) {
      showFormMessage(form, "Enter your email first.", "error");
      return;
    }

    showFormMessage(form, "Sending reset link…", "info");
    const appUrl = getConfiguredAppUrl();
    if (!appUrl) {
      showFormMessage(form, `APP_URL is not configured. Contact support at ${SUPPORT_EMAIL}.`, "error");
      return;
    }
    const { error } = await state.client.auth.resetPasswordForEmail(email, {
      redirectTo: `${appUrl}/reset-password`
    });

    if (error) {
      showFormMessage(form, error.message, "error");
      return;
    }

    showFormMessage(form, "Check your email for a password reset link.", "success");
  }

  async function handleResetPassword(form) {
    if (!state.client) return;

    const password = form.querySelector("input[name='password']")?.value || "";
    const confirmPassword = form.querySelector("input[name='password_confirm']")?.value || "";

    if (password.length < 8) {
      showFormMessage(form, "Use at least 8 characters for your new password.", "error");
      return;
    }
    if (password !== confirmPassword) {
      showFormMessage(form, "Passwords do not match.", "error");
      return;
    }

    const session = await getSession();
    if (!session) {
      showFormMessage(form, "Open this page from your password reset email link.", "error");
      return;
    }

    showFormMessage(form, "Updating password…", "info");
    const { error } = await state.client.auth.updateUser({ password });
    if (error) {
      showFormMessage(form, error.message, "error");
      return;
    }

    showFormMessage(form, "Password updated. Redirecting to account…", "success");
    window.setTimeout(() => {
      window.location.href = "/account";
    }, 800);
  }

  async function parseJsonSafe(input) {
    if (input === null || input === undefined) return {};

    try {
      if (typeof input.text === "function") {
        const text = await input.text();
        if (!text) return {};
        try {
          return JSON.parse(text);
        } catch (_err) {
          return { message: text };
        }
      }

      if (typeof input.json === "function") {
        const json = await input.json();
        return json || {};
      }
    } catch (_err) {
      // Fall through to type-based parsing.
    }

    if (typeof input === "string") {
      try {
        return JSON.parse(input);
      } catch (_err) {
        return { message: input };
      }
    }

    if (typeof input === "object") {
      return input;
    }

    return { message: String(input) };
  }

  function getFunctionTargets(path) {
    const directBase = config.SUPABASE_FUNCTIONS_URL || `${config.SUPABASE_URL}/functions/v1`;
    const directUrl = `${directBase}/${path}`;
    const targets = [directUrl];

    if (typeof window !== "undefined" && window.location?.origin && /^https?:$/.test(window.location.protocol)) {
      targets.unshift(`${window.location.origin}/api/${path}`);
    }

    return Array.from(new Set(targets));
  }

  async function postFunctionWithSession(path, body, session, retryOn401 = true) {
    if (!hasAccessToken(session?.access_token)) {
      return { ok: false, status: 401, payload: { message: "Session token missing. Please sign in again." } };
    }

    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_token}`,
      "apikey": config.SUPABASE_ANON_KEY
    };

    const targetUrls = getFunctionTargets(path);
    let res = null;
    let firstNetworkError = null;
    let apiUnauthorizedRes = null;

    for (const targetUrl of targetUrls) {
      // Fallback path when browser blocks/aborts raw fetch for any reason.
      try {
        const candidateRes = await fetch(targetUrl, {
          method: "POST",
          headers,
          body: body ? JSON.stringify(body) : undefined
        });

        // Allow local environments without Vercel API routes to fall back to direct Supabase URL.
        if (candidateRes.status === 404 && targetUrl.includes("/api/")) {
          continue;
        }
        // If Vercel API proxy rejects auth, try direct Supabase function URL.
        if ((candidateRes.status === 401 || candidateRes.status === 403) && targetUrl.includes("/api/")) {
          if (!apiUnauthorizedRes) {
            apiUnauthorizedRes = candidateRes;
          }
          continue;
        }

        res = candidateRes;
        break;
      } catch (err) {
        if (!firstNetworkError) {
          firstNetworkError = err;
        }
      }
    }

    if (!res && apiUnauthorizedRes) {
      res = apiUnauthorizedRes;
    }

    if (!res) {
      // Last-resort path via Supabase JS invoke helper.
      try {
        const invokeOptions = {
          headers: {
            Authorization: `Bearer ${session.access_token}`
          }
        };
        if (body !== null && body !== undefined) {
          invokeOptions.body = body;
        }
        const { data, error } = await state.client.functions.invoke(path, invokeOptions);
        if (!error) {
          return { ok: true, status: 200, payload: data || {} };
        }

        let status = 500;
        let payload = {};
        if (error.context) {
          status = error.context.status;
          payload = await parseJsonSafe(error.context);
        } else if (typeof error.status === "number") {
          status = error.status;
        }

        const message = payload?.error || payload?.message || error.message || "Function invoke failed.";
        return { ok: false, status, payload: { ...payload, message } };
      } catch (fallbackErr) {
        const message = fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr);
        const original = firstNetworkError instanceof Error ? firstNetworkError.message : String(firstNetworkError || "unknown");
        return {
          ok: false,
          status: 0,
          payload: { message: `Network error while calling billing service. (${original}; fallback: ${message})` }
        };
      }
    }

    if (res.status !== 401 || !retryOn401 || !state.client) {
      return { ok: res.ok, status: res.status, payload: await parseJsonSafe(res) };
    }

    const { data, error } = await state.client.auth.refreshSession();
    if (error || !hasAccessToken(data?.session?.access_token)) {
      await state.client.auth.signOut();
      state.user = null;
      state.profile = null;
      state.paid = false;
      updateAuthUI();
      applyPaidGate();
      return {
        ok: false,
        status: 401,
        payload: { message: "Session expired. Please sign in again." }
      };
    }

    let retryRes = null;
    let retryApiUnauthorizedRes = null;
    for (const targetUrl of targetUrls) {
      try {
        const candidateRes = await fetch(targetUrl, {
          method: "POST",
          headers: {
            ...headers,
            "Authorization": `Bearer ${data.session.access_token}`
          },
          body: body ? JSON.stringify(body) : undefined
        });

        if (candidateRes.status === 404 && targetUrl.includes("/api/")) {
          continue;
        }
        if ((candidateRes.status === 401 || candidateRes.status === 403) && targetUrl.includes("/api/")) {
          if (!retryApiUnauthorizedRes) {
            retryApiUnauthorizedRes = candidateRes;
          }
          continue;
        }

        retryRes = candidateRes;
        break;
      } catch (_err) {
        // Try next function target URL.
      }
    }

    if (!retryRes && retryApiUnauthorizedRes) {
      retryRes = retryApiUnauthorizedRes;
    }

    if (!retryRes) {
      return {
        ok: false,
        status: 0,
        payload: { message: "Could not reach billing service after refreshing session." }
      };
    }

    return { ok: retryRes.ok, status: retryRes.status, payload: await parseJsonSafe(retryRes) };
  }

  async function invokeProjectFunction(path, body, session, retryOn401 = true) {
    return postFunctionWithSession(path, body, session, retryOn401);
  }

  async function startCheckout(plan, options = {}) {
    initClient();
    if (!state.client) {
      alert("Subscriptions are not configured yet.");
      return;
    }

    const postCheckoutRedirect = safeRedirect(
      options.postCheckoutRedirect,
      DEFAULT_POST_CHECKOUT_REDIRECT
    );

    const session = await ensureProjectSession();
    if (!session) {
      alert("Your session is invalid for this project. Please sign in again.");
      requireAuth();
      return;
    }

    try {
      const { ok, status, payload } = await invokeProjectFunction(
        "create-checkout-session",
        { plan, postCheckoutRedirect },
        session
      );
      if (status === 409 && payload?.code === "active_subscription_exists") {
        await openBillingPortal();
        return;
      }
      if (!ok) {
        if (status === 401) {
          alert(payload?.error || payload?.message || "Session is invalid. Please sign in again.");
          requireAuth();
          return;
        }
        const message = payload?.error || payload?.message || `Unable to start checkout (status ${status}).`;
        alert(message);
        return;
      }

      if (payload?.url) {
        window.location.href = payload.url;
      } else {
        alert("Checkout session was created but no redirect URL was returned.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      alert(`Unexpected checkout error: ${message}`);
    }
  }

  async function openBillingPortal() {
    initClient();
    if (!state.client) {
      alert("Billing portal is not configured yet.");
      return;
    }

    const session = await ensureProjectSession();
    if (!session) {
      alert("Your session is invalid for this project. Please sign in again.");
      requireAuth();
      return;
    }

    try {
      const { ok, status, payload } = await invokeProjectFunction(
        "create-portal-session",
        null,
        session
      );
      if (!ok) {
        if (status === 401) {
          alert(payload?.error || payload?.message || "Session is invalid. Please sign in again.");
          requireAuth();
          return;
        }
        const message = payload?.error || payload?.message || `Unable to open billing portal (status ${status}).`;
        alert(message);
        return;
      }

      if (payload?.url) {
        window.location.href = payload.url;
      } else {
        alert("Billing portal session was created but no redirect URL was returned.");
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      alert(`Unexpected billing portal error: ${message}`);
    }
  }

  async function updateProfile(updates) {
    initClient();
    if (!state.client) {
      return { error: { message: "Auth is not configured." } };
    }
    if (!state.user) {
      return { error: { message: "You must be signed in." } };
    }
    const { error } = await state.client
      .from("profiles")
      .update(updates)
      .eq("id", state.user.id);
    if (!error) {
      await refreshProfile();
    }
    return { error };
  }

  async function getPlannerSnapshot() {
    initClient();
    if (!state.client) {
      return { data: null, error: { message: "Auth is not configured." } };
    }
    if (!state.user) {
      return { data: null, error: { message: "You must be signed in." } };
    }

    const { data, error } = await state.client
      .from("planner_snapshots")
      .select("snapshot,updated_at")
      .eq("user_id", state.user.id)
      .maybeSingle();

    if (error) {
      return { data: null, error };
    }

    return {
      data: data
        ? { snapshot: data.snapshot || {}, updatedAt: data.updated_at || null }
        : null,
      error: null
    };
  }

  async function savePlannerSnapshot(snapshot) {
    initClient();
    if (!state.client) {
      return { error: { message: "Auth is not configured." } };
    }
    if (!state.user) {
      return { error: { message: "You must be signed in." } };
    }

    const payload = (snapshot && typeof snapshot === "object") ? snapshot : {};

    const { error } = await state.client
      .from("planner_snapshots")
      .upsert(
        {
          user_id: state.user.id,
          snapshot: payload
        },
        { onConflict: "user_id" }
      );

    return { error };
  }

  async function clearPlannerSnapshot() {
    initClient();
    if (!state.client) {
      return { error: { message: "Auth is not configured." } };
    }
    if (!state.user) {
      return { error: { message: "You must be signed in." } };
    }

    const { error } = await state.client
      .from("planner_snapshots")
      .delete()
      .eq("user_id", state.user.id);
    return { error };
  }

  async function createSupportTicket(payload) {
    initClient();
    if (!state.client) {
      return { data: null, error: { message: "Support is not configured yet." } };
    }

    const session = await ensureProjectSession();
    if (!session) {
      return { data: null, error: { message: "Session is invalid. Please sign in again." } };
    }

    const body = {
      subject: String(payload?.subject || "").trim(),
      message: String(payload?.message || "").trim(),
      email: String(payload?.email || state.user?.email || "").trim()
    };

    const { ok, status, payload: responsePayload } = await invokeProjectFunction(
      "create-support-ticket",
      body,
      session
    );

    if (!ok) {
      if (status === 401) {
        if (state.client) {
          await state.client.auth.signOut();
        }
        state.user = null;
        state.profile = null;
        state.paid = false;
        updateAuthUI();
        applyPaidGate();
        const redirect = buildRedirectParam();
        window.location.href = `/login?redirect=${redirect}`;
        return { data: null, error: { message: "Session expired. Please sign in again." } };
      }
      return {
        data: null,
        error: {
          message: responsePayload?.error || responsePayload?.message || `Could not submit support ticket. Contact ${SUPPORT_EMAIL}.`
        }
      };
    }

    return { data: responsePayload, error: null };
  }

  function wireAuthForms() {
    document.querySelectorAll("[data-auth-form='login']").forEach(form => {
      form.addEventListener("submit", evt => {
        evt.preventDefault();
        handleLogin(form);
      });
    });

    document.querySelectorAll("[data-auth-form='signup']").forEach(form => {
      form.addEventListener("submit", evt => {
        evt.preventDefault();
        handleSignup(form);
      });
    });

    document.querySelectorAll("[data-auth-form='forgot']").forEach(form => {
      form.addEventListener("submit", evt => {
        evt.preventDefault();
        handleForgotPassword(form);
      });
    });

    document.querySelectorAll("[data-auth-form='reset-password']").forEach(form => {
      form.addEventListener("submit", evt => {
        evt.preventDefault();
        handleResetPassword(form);
      });
    });
  }

  async function init() {
    initClient();
    if (!state.client) {
      updateAuthUI();
      applyPaidGate();
      wireAuthForms();
      if (!hasConfig) {
        showConfigWarningOnForms();
      }
      markReady();
      return;
    }
    await refreshUser();
    await refreshProfile();
    updateAuthUI();
    applyPaidGate();
    wireAuthForms();
    markReady();
  }

  window.BudgetDadAuth = {
    getUser: () => state.user,
    getProfile: () => state.profile,
    isPaid: () => state.paid,
    isReady: () => state.ready,
    waitUntilReady,
    refreshProfile,
    ensureProfileReady,
    requireAuth,
    requirePaid,
    startCheckout,
    openBillingPortal,
    updateProfile,
    applyPaidGate,
    getPlannerSnapshot,
    savePlannerSnapshot,
    clearPlannerSnapshot,
    createSupportTicket
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
