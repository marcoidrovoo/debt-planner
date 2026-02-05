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

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) {
    return jsonResponse({ error: "Unauthorized." }, 401);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("stripe_customer_id")
    .eq("id", authData.user.id)
    .single();

  if (!profile?.stripe_customer_id) {
    return jsonResponse({ error: "No Stripe customer found." }, 400);
  }

  const appUrl = Deno.env.get("APP_URL") ?? req.headers.get("origin") ?? "";
  if (!appUrl) {
    return jsonResponse({ error: "APP_URL is not configured." }, 500);
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: profile.stripe_customer_id,
    return_url: `${appUrl}/account`
  });

  return jsonResponse({ url: session.url });
});
