const DEFAULT_SUPABASE_URL = "https://tgyxthvhmhsqzmjcpyyp.supabase.co";
const DEFAULT_SUPABASE_ANON_KEY = "sb_publishable_VU6CBUIcrzu2UE2UqmorAA_4TNucJjB";

function getSupabaseUrl() {
  const raw = String(process.env.SUPABASE_URL || DEFAULT_SUPABASE_URL).trim();
  try {
    return new URL(raw).origin;
  } catch (_err) {
    return DEFAULT_SUPABASE_URL;
  }
}

function getSupabaseAnonKey() {
  const candidate = String(process.env.SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY).trim();
  return candidate.startsWith("sb_publishable_") ? candidate : DEFAULT_SUPABASE_ANON_KEY;
}

function sendJson(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
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

  const authorization = String(req.headers.authorization || "").trim();
  if (!authorization.startsWith("Bearer ")) {
    return sendJson(res, 401, { error: "Missing authorization token." });
  }

  const apikey = getSupabaseAnonKey();
  if (!apikey) {
    return sendJson(res, 500, { error: "Server configuration error." });
  }

  try {
    const upstream = await fetch(`${getSupabaseUrl()}/functions/v1/create-checkout-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authorization,
        "apikey": apikey
      },
      body: getBodyText(req)
    });

    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    res.setHeader("Cache-Control", "no-store");
    res.end(text);
  } catch (err) {
    sendJson(res, 502, { error: "Checkout proxy upstream request failed." });
  }
}
