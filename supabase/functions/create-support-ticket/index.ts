import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const resendApiKey = Deno.env.get("RESEND_API_KEY") ?? "";
const supportFromEmail = Deno.env.get("SUPPORT_FROM_EMAIL") ?? "onboarding@resend.dev";
const supportToEmail = Deno.env.get("SUPPORT_TO_EMAIL") ?? "marco@idrovofox.com";

function jsonResponse(body: Record<string, unknown>, status: number, corsHeaders: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

function cleanText(value: unknown, maxLength = 5000) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  if (!trimmed) return "";
  return trimmed.slice(0, maxLength);
}

async function sendSupportEmail(payload: {
  ticketId: string;
  fromEmail: string;
  userEmail: string;
  userId: string;
  subject: string;
  message: string;
}) {
  if (!resendApiKey) {
    return { sent: false, warning: "RESEND_API_KEY is not configured." };
  }

  const emailBody = [
    `Ticket ID: ${payload.ticketId}`,
    `User ID: ${payload.userId}`,
    `User Email: ${payload.userEmail}`,
    "",
    payload.message
  ].join("\n");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${resendApiKey}`
    },
    body: JSON.stringify({
      from: supportFromEmail,
      to: [supportToEmail],
      reply_to: payload.fromEmail,
      subject: `[Budget Dad Support] ${payload.subject}`,
      text: emailBody
    })
  });

  if (!res.ok) {
    const text = await res.text();
    return { sent: false, warning: `Support email failed (${res.status}): ${text.slice(0, 200)}` };
  }

  return { sent: true };
}

serve(async (req) => {
  const corsHeaders = buildCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405, corsHeaders);
  }

  if (!supabaseUrl || !supabaseServiceKey) {
    return jsonResponse({ error: "Server is missing configuration." }, 500, corsHeaders);
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace("Bearer ", "").trim();
  if (!token) {
    return jsonResponse({ error: "Missing authorization token." }, 401, corsHeaders);
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { persistSession: false }
  });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) {
    return jsonResponse({ error: "Unauthorized." }, 401, corsHeaders);
  }

  let payload: { subject?: string; message?: string; email?: string } = {};
  try {
    payload = await req.json();
  } catch (_err) {
    return jsonResponse({ error: "Invalid JSON body." }, 400, corsHeaders);
  }

  const subject = cleanText(payload.subject, 140);
  const message = cleanText(payload.message, 5000);
  const email = cleanText(payload.email || authData.user.email || "", 320);

  if (!subject) {
    return jsonResponse({ error: "Subject is required." }, 400, corsHeaders);
  }
  if (!message || message.length < 10) {
    return jsonResponse({ error: "Message must be at least 10 characters." }, 400, corsHeaders);
  }
  if (!email || !email.includes("@")) {
    return jsonResponse({ error: "A valid email is required." }, 400, corsHeaders);
  }

  const { data: inserted, error: insertError } = await supabase
    .from("support_tickets")
    .insert({
      user_id: authData.user.id,
      email,
      subject,
      message,
      status: "open"
    })
    .select("id")
    .single();

  if (insertError || !inserted?.id) {
    const msg = insertError?.message || "Could not create support ticket.";
    return jsonResponse({ error: msg }, 500, corsHeaders);
  }

  const emailResult = await sendSupportEmail({
    ticketId: inserted.id,
    fromEmail: email,
    userEmail: email,
    userId: authData.user.id,
    subject,
    message
  });

  return jsonResponse({
    ticketId: inserted.id,
    emailSent: emailResult.sent,
    warning: emailResult.sent ? undefined : emailResult.warning
  }, 200, corsHeaders);
});
