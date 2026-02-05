function normalizeOrigin(raw: string): string | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    return parsed.origin;
  } catch (_err) {
    return null;
  }
}

function getAllowedOrigins(): string[] {
  const envOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map(origin => origin.trim())
    .filter(Boolean);
  const appUrl = Deno.env.get("APP_URL") ?? "";

  const origins = [...envOrigins, appUrl]
    .map(normalizeOrigin)
    .filter((origin): origin is string => Boolean(origin));

  return Array.from(new Set(origins));
}

const allowedOrigins = getAllowedOrigins();

export function buildCorsHeaders(req: Request) {
  const requestOrigin = normalizeOrigin(req.headers.get("origin") ?? "");
  const allowOrigin = requestOrigin && allowedOrigins.includes(requestOrigin)
    ? requestOrigin
    : (allowedOrigins[0] ?? "null");

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}
