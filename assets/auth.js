(function () {
  const config = window.BUDGET_DAD_CONFIG || {};
  const hasConfig = !!(config.SUPABASE_URL && config.SUPABASE_ANON_KEY);
  const state = {
    client: null,
    user: null,
    profile: null,
    paid: false,
    ready: false
  };

  function safeLocalStorageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function safeLocalStorageSet(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      // ignore storage errors
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
      safeLocalStorageSet("bdPro", "no");
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
      safeLocalStorageSet("bdPro", "no");
      return null;
    }

    state.profile = data;
    state.paid = isPaidProfile(data);
    safeLocalStorageSet("bdPro", state.paid ? "yes" : "no");
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

  async function getSession() {
    if (!state.client) return null;
    const { data } = await state.client.auth.getSession();
    return data.session || null;
  }

  function buildRedirectParam() {
    const url = window.location.pathname + window.location.search;
    return encodeURIComponent(url);
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
          safeLocalStorageSet("bdPro", "no");
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
    const redirect = params.get("redirect") || "/account";
    window.location.href = redirect;
  }

  async function handleSignup(form) {
    if (!state.client) return;
    const email = form.querySelector("input[name='email']")?.value?.trim();
    const password = form.querySelector("input[name='password']")?.value || "";

    showFormMessage(form, "Creating your account…", "info");
    const { data, error } = await state.client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${config.APP_URL || window.location.origin}/account`
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

  async function startCheckout(plan) {
    initClient();
    if (!state.client) {
      alert("Subscriptions are not configured yet.");
      return;
    }

    const session = await getSession();
    if (!session) {
      requireAuth();
      return;
    }

    const functionsBase = config.SUPABASE_FUNCTIONS_URL || `${config.SUPABASE_URL}/functions/v1`;
    const res = await fetch(`${functionsBase}/create-checkout-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
        "apikey": config.SUPABASE_ANON_KEY
      },
      body: JSON.stringify({ plan })
    });

    const payload = await res.json();
    if (!res.ok) {
      alert(payload?.error || "Unable to start checkout.");
      return;
    }

    if (payload?.url) {
      window.location.href = payload.url;
    }
  }

  async function openBillingPortal() {
    initClient();
    if (!state.client) {
      alert("Billing portal is not configured yet.");
      return;
    }

    const session = await getSession();
    if (!session) {
      requireAuth();
      return;
    }

    const functionsBase = config.SUPABASE_FUNCTIONS_URL || `${config.SUPABASE_URL}/functions/v1`;
    const res = await fetch(`${functionsBase}/create-portal-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.access_token}`,
        "apikey": config.SUPABASE_ANON_KEY
      }
    });

    const payload = await res.json();
    if (!res.ok) {
      alert(payload?.error || "Unable to open billing portal.");
      return;
    }

    if (payload?.url) {
      window.location.href = payload.url;
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
  }

  async function init() {
    initClient();
    if (!state.client) {
      updateAuthUI();
      return;
    }
    await refreshUser();
    await refreshProfile();
    updateAuthUI();
    applyPaidGate();
    wireAuthForms();
    state.ready = true;
  }

  window.BudgetDadAuth = {
    getUser: () => state.user,
    getProfile: () => state.profile,
    isPaid: () => state.paid,
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
