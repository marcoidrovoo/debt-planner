const DEFAULT_SUPABASE_URL = "https://tgyxthvhmhsqzmjcpyyp.supabase.co";

function getSupabaseUrl() {
  const raw = String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  try {
    return new URL(raw).origin;
  } catch (_err) {
    return DEFAULT_SUPABASE_URL;
  }
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(body));
}

function getBodyText(req) {
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
  return "{}";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
  if (!serviceRoleKey) {
    return sendJson(res, 500, { error: "Server missing SUPABASE_SERVICE_ROLE_KEY." });
  }

  try {
    const payload = JSON.parse(getBodyText(req));
    const email = String(payload?.email || "").trim();
    const subject = String(payload?.subject || "Message board").trim().slice(0, 140);
    const message = String(payload?.message || "").trim().slice(0, 5000);

    if (!email || !email.includes("@")) {
      return sendJson(res, 400, { error: "Valid email is required." });
    }
    if (!message || message.length < 2) {
      return sendJson(res, 400, { error: "Message is required." });
    }

    const upstream = await fetch(`${getSupabaseUrl()}/rest/v1/support_tickets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${serviceRoleKey}`,
        "apikey": serviceRoleKey,
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        user_id: null,
        email,
        subject: subject || "Message board",
        message,
        status: "open"
      })
    });

    const text = await upstream.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch (_err) {
      data = null;
    }

    if (!upstream.ok) {
      const error =
        data?.message ||
        data?.error_description ||
        data?.error ||
        `Message insert failed (status ${upstream.status}).`;
      return sendJson(res, upstream.status, { error });
    }

    const row = Array.isArray(data) ? data[0] : data;
    return sendJson(res, 200, { ticketId: row?.id || null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 502, { error: `Could not post message: ${message}` });
  }
}
