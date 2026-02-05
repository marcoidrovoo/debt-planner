import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY") ?? "";
const stripeWebhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET") ?? "";
const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const stripe = new Stripe(stripeSecretKey, {
  apiVersion: "2024-04-10"
});

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

async function updateProfileFromSubscription(
  supabase: ReturnType<typeof createClient>,
  subscription: Stripe.Subscription
) {
  const status = subscription.status;
  const isPaid = status === "active" || status === "trialing";
  const periodEnd = subscription.current_period_end
    ? new Date(subscription.current_period_end * 1000).toISOString()
    : null;

  const updateData = {
    stripe_customer_id: String(subscription.customer),
    stripe_subscription_id: subscription.id,
    subscription_status: status,
    current_period_end: periodEnd,
    plan: isPaid ? "paid" : "free"
  };

  const { data: updated, error } = await supabase
    .from("profiles")
    .update(updateData)
    .eq("stripe_customer_id", String(subscription.customer))
    .select("id");

  if (!error && updated && updated.length > 0) {
    return;
  }

  const uid = subscription.metadata?.supabase_uid;
  if (uid) {
    await supabase
      .from("profiles")
      .update(updateData)
      .eq("id", uid);
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  if (!stripeSecretKey || !stripeWebhookSecret || !supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: "Server is missing configuration." }, 500);
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return jsonResponse({ error: "Missing Stripe signature." }, 400);
  }

  const body = await req.text();
  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(body, signature, stripeWebhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: `Webhook signature error: ${message}` }, 400);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.subscription) {
        const subscription = await stripe.subscriptions.retrieve(String(session.subscription));
        await updateProfileFromSubscription(supabase, subscription);
      } else if (session.customer) {
        await supabase
          .from("profiles")
          .update({ stripe_customer_id: String(session.customer) })
          .eq("id", session.client_reference_id || "");
      }
      break;
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const subscription = event.data.object as Stripe.Subscription;
      await updateProfileFromSubscription(supabase, subscription);
      break;
    }
    default:
      break;
  }

  return jsonResponse({ received: true });
});
