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

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return sendJson(res, 405, { error: "Method not allowed." });
  }

  const authorization = req.headers.authorization || "";
  if (!authorization) {
    return sendJson(res, 401, { error: "Missing authorization token." });
  }

  const apikey = req.headers.apikey || process.env.SUPABASE_ANON_KEY || "";
  if (!apikey) {
    return sendJson(res, 500, { error: "Missing Supabase anon key on proxy." });
  }

  try {
    const upstream = await fetch(`${getSupabaseUrl()}/functions/v1/create-portal-session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": authorization,
        "apikey": apikey
      },
      body: "{}"
    });

    const text = await upstream.text();
    res.statusCode = upstream.status;
    res.setHeader("Content-Type", upstream.headers.get("content-type") || "application/json");
    res.end(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    sendJson(res, 502, { error: `Portal proxy upstream request failed: ${message}` });
  }
}
