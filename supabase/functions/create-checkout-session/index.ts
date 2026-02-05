import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders } from "../_shared/cors.ts";

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2024-04-10"
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!stripeSecretKey || !supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: "Server is missing configuration." }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    return jsonResponse({ error: "Missing authorization token." }, 401);
  }

  let payload: { plan?: string } = {};
  try {
    payload = await req.json();
  } catch (_err) {
    return jsonResponse({ error: "Invalid JSON body." }, 400);
  }

  if (!payload.plan) {
    return jsonResponse({ error: "Missing plan." }, 400);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const user = authData.user;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id,email,stripe_customer_id")
    .eq("id", user.id)
    .single();

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

  const appUrl = Deno.env.get("APP_URL") ?? req.headers.get("origin") ?? "";
  if (!appUrl) {
    return jsonResponse({ error: "APP_URL is not configured." }, 500);
  }

  const monthlyPriceId = Deno.env.get("STRIPE_PRICE_ID_MONTHLY") ?? "";
  const yearlyPriceId = Deno.env.get("STRIPE_PRICE_ID_YEARLY") ?? "";
  const plan = payload.plan;
  const priceId = plan === "monthly" ? monthlyPriceId : plan === "yearly" ? yearlyPriceId : "";
  if (!priceId) {
    return jsonResponse({ error: "Price ID not configured for plan." }, 400);
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

  return jsonResponse({ url: session.url });
});
