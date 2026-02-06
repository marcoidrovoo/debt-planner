(function () {
  const config = window.BUDGET_DAD_CONFIG || {};
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
        storageKey: "budgetdad-auth"
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

  function looksLikeJwt(token) {
    if (!token || typeof token !== "string") return false;
    const parts = token.split(".");
    return parts.length === 3 && parts.every(part => part.length > 0);
  }

  async function getFreshSession() {
    const session = await getSession();
    if (!state.client || !session) return session;

    const expiresAtMs = (session.expires_at || 0) * 1000;
    const hasValidAccessToken = looksLikeJwt(session.access_token);
    const shouldRefresh = !hasValidAccessToken || !expiresAtMs || (expiresAtMs - Date.now()) < 60 * 1000;
    if (!shouldRefresh) return session;

    const { data, error } = await state.client.auth.refreshSession();
    if (error) return hasValidAccessToken ? session : null;
    const refreshed = data.session || null;
    if (!refreshed) return hasValidAccessToken ? session : null;
    return looksLikeJwt(refreshed.access_token) ? refreshed : (hasValidAccessToken ? session : null);
  }

  function buildRedirectParam() {
    const url = window.location.pathname + window.location.search;
    return encodeURIComponent(url);
  }
  function safeRedirect(value, fallback = "/account") {
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
    const redirect = safeRedirect(params.get("redirect"), "/account");
    window.location.href = redirect;
  }

  async function handleSignup(form) {
    if (!state.client) return;
    const email = form.querySelector("input[name='email']")?.value?.trim();
    const password = form.querySelector("input[name='password']")?.value || "";

    showFormMessage(form, "Creating your account…", "info");
    const appUrl = getConfiguredAppUrl();
    if (!appUrl) {
      showFormMessage(form, "APP_URL is not configured. Contact support.", "error");
      return;
    }
    const { data, error } = await state.client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${appUrl}/account`
      }
    });

    if (error) {
      showFormMessage(form, error.message, "error");
      return;
    }

    if (data?.user && data?.session) {
      await refreshUser();
      await refreshProfile();
      window.location.href = "/account";
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
      showFormMessage(form, "APP_URL is not configured. Contact support.", "error");
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

  async function parseJsonSafe(response) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_err) {
      return { message: text };
    }
  }

  async function postFunctionWithSession(path, body, session, retryOn401 = true) {
    if (!session?.access_token || !looksLikeJwt(session.access_token)) {
      return { ok: false, status: 401, payload: { message: "Invalid JWT" } };
    }

    const functionsBase = config.SUPABASE_FUNCTIONS_URL || `${config.SUPABASE_URL}/functions/v1`;
    const headers = {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.access_token}`,
      "apikey": config.SUPABASE_ANON_KEY
    };

    const res = await fetch(`${functionsBase}/${path}`, {
      method: "POST",
      headers,
      body: body ? JSON.stringify(body) : undefined
    });

    if (res.status !== 401 || !retryOn401 || !state.client) {
      return { ok: res.ok, status: res.status, payload: await parseJsonSafe(res) };
    }

    const { data, error } = await state.client.auth.refreshSession();
    if (error || !data?.session?.access_token || !looksLikeJwt(data.session.access_token)) {
      return { ok: res.ok, status: res.status, payload: await parseJsonSafe(res) };
    }

    const retryRes = await fetch(`${functionsBase}/${path}`, {
      method: "POST",
      headers: {
        ...headers,
        "Authorization": `Bearer ${data.session.access_token}`
      },
      body: body ? JSON.stringify(body) : undefined
    });

    return { ok: retryRes.ok, status: retryRes.status, payload: await parseJsonSafe(retryRes) };
  }

  async function invokeProjectFunction(path, body, retryOn401 = true) {
    const customFunctionsUrl = String(config.SUPABASE_FUNCTIONS_URL || "").trim();
    const defaultFunctionsUrl = `${config.SUPABASE_URL}/functions/v1`;

    if (customFunctionsUrl && customFunctionsUrl !== defaultFunctionsUrl) {
      const session = await getFreshSession();
      if (!session) {
        return { ok: false, status: 401, payload: { message: "Session not found." } };
      }
      return postFunctionWithSession(path, body, session, retryOn401);
    }

    const invokeOnce = async () => {
      const { data, error } = await state.client.functions.invoke(
        path,
        body ? { body } : {}
      );

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

      const message = payload?.error || payload?.message || error.message || "Request failed.";
      return { ok: false, status, payload: { ...payload, message } };
    };

    let result = await invokeOnce();
    if (!result.ok && result.status === 401 && retryOn401) {
      await getFreshSession();
      result = await invokeOnce();
    }
    return result;
  }

  async function startCheckout(plan) {
    initClient();
    if (!state.client) {
      alert("Subscriptions are not configured yet.");
      return;
    }

    const session = await getFreshSession();
    if (!session) {
      requireAuth();
      return;
    }

    try {
      const { ok, status, payload } = await invokeProjectFunction(
        "create-checkout-session",
        { plan }
      );
      if (status === 409 && payload?.code === "active_subscription_exists") {
        await openBillingPortal();
        return;
      }
      if (!ok) {
        if (status === 401) {
          window.location.href = `/login?redirect=${buildRedirectParam()}`;
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
    } catch (_err) {
      alert("Network error while starting checkout. Please try again.");
    }
  }

  async function openBillingPortal() {
    initClient();
    if (!state.client) {
      alert("Billing portal is not configured yet.");
      return;
    }

    const session = await getFreshSession();
    if (!session) {
      requireAuth();
      return;
    }

    try {
      const { ok, status, payload } = await invokeProjectFunction(
        "create-portal-session",
        null
      );
      if (!ok) {
        if (status === 401) {
          window.location.href = `/login?redirect=${buildRedirectParam()}`;
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
    } catch (_err) {
      alert("Network error while opening billing portal. Please try again.");
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
    applyPaidGate
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
