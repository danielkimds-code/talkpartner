// TalkPartner relay — Cloudflare Worker
// Forwards the app's requests to aiapiflow.com and adds the browser permission (CORS)
// that aiapiflow does not send. The API key is NOT stored here: it stays on the iPad
// and passes through in the Authorization header.

const UPSTREAM = "https://aiapiflow.com";
const ALLOWED_ORIGINS = ["https://danielkimds-code.github.io"];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, content-type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };

    // Opening the worker address in a browser shows this check message.
    if (!url.pathname.startsWith("/v1/")) {
      return new Response("TalkPartner relay is running.", { headers: { ...cors, "content-type": "text/plain; charset=utf-8" } });
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    }
    if (!allowed) {
      return new Response("Forbidden origin", { status: 403, headers: cors });
    }

    const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
      method: request.method,
      headers: {
        "authorization": request.headers.get("authorization") || "",
        "content-type": "application/json",
      },
      body: request.method === "GET" ? undefined : await request.text(),
    });

    const headers = new Headers(cors);
    headers.set("content-type", upstream.headers.get("content-type") || "application/json");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
