import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2024-04-10"
});

function jsonResponse(
  body: Record<string, unknown>,
  status: number,
  corsHeaders: Record<string, string>
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function normalizeAppUrl(raw: string): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    const basePath = parsed.pathname.replace(/\/$/, "");
    return `${parsed.origin}${basePath}`;
  } catch (_err) {
    return null;
  }
}

function hasBlockingSubscriptionStatus(status: string | null | undefined) {
  return status === "active" || status === "trialing" || status === "past_due" || status === "unpaid";
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  if (!stripeSecretKey || !supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: "Server is missing configuration." }, 500, corsHeaders);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    return jsonResponse({ error: "Missing authorization token." }, 401, corsHeaders);
  }

  let payload: { plan?: string } = {};
  try {
    payload = await req.json();
  } catch (_err) {
    return jsonResponse({ error: "Invalid JSON body." }, 400, corsHeaders);
  }

  if (payload.plan !== "monthly" && payload.plan !== "yearly") {
    return jsonResponse({ error: "Invalid plan. Use monthly or yearly." }, 400, corsHeaders);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) {
    return jsonResponse({ error: "Unauthorized." }, 401, corsHeaders);
  }

  const user = authData.user;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id,email,plan,stripe_customer_id,stripe_subscription_id,subscription_status")
    .eq("id", user.id)
    .single();

  if (hasBlockingSubscriptionStatus(profile?.subscription_status)) {
    return jsonResponse(
      {
        error: "You already have an active subscription. Open billing portal to manage it.",
        code: "active_subscription_exists"
      },
      409,
      corsHeaders
    );
  }

  let customerId = profile?.stripe_customer_id || null;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { supabase_uid: user.id }
    });
    customerId = customer.id;
    await supabase
      .from("profiles")
      .update({ stripe_customer_id: customerId })
      .eq("id", user.id);
  }

  if (customerId) {
    const existingSubscriptions = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10
    });
    const hasActiveSubscription = existingSubscriptions.data.some((subscription) =>
      hasBlockingSubscriptionStatus(subscription.status)
    );
    if (hasActiveSubscription) {
      return jsonResponse(
        {
          error: "You already have an active subscription. Open billing portal to manage it.",
          code: "active_subscription_exists"
        },
        409,
        corsHeaders
      );
    }
  }

  const appUrl = normalizeAppUrl(Deno.env.get("APP_URL") ?? "");
  if (!appUrl) {
    return jsonResponse({ error: "APP_URL is not configured." }, 500, corsHeaders);
  }

  const monthlyPriceId = Deno.env.get("STRIPE_PRICE_ID_MONTHLY") ?? "";
  const yearlyPriceId = Deno.env.get("STRIPE_PRICE_ID_YEARLY") ?? "";
  const plan = payload.plan;
  const priceId = plan === "monthly" ? monthlyPriceId : plan === "yearly" ? yearlyPriceId : "";
  if (!priceId) {
    return jsonResponse({ error: "Price ID not configured for plan." }, 400, corsHeaders);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceId, quantity: 1 }],
    allow_promotion_codes: true,
    client_reference_id: user.id,
    subscription_data: {
      metadata: { supabase_uid: user.id }
    },
    success_url: `${appUrl}/account?checkout=success`,
    cancel_url: `${appUrl}/pricing?checkout=cancel`
  });

  return jsonResponse({ url: session.url }, 200, corsHeaders);
});
