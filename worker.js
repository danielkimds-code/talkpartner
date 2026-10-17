// TalkPartner relay — Cloudflare Worker
// Forwards the app's requests to aiapiflow.com and adds the browser permission (CORS)
// that aiapiflow does not send.
//
// Two ways to use it:
//  1) Built-in key: fill API_KEY and APP_TOKEN below (only inside your own Cloudflare
//     account, never in the public repo). The app then needs no key on the iPad;
//     it proves the login with the x-tp-token header.
//  2) Pass-through: leave them empty; the app sends its own key in Authorization.

const UPSTREAM = "https://aiapiflow.com";
const API_KEY = "";    // sk-... (built-in key, optional)
const APP_TOKEN = "";  // login-derived token (required when API_KEY is set)
const ALLOWED_ORIGINS = ["https://danielkimds-code.github.io"];

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, content-type, x-tp-token",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    const json = (status, message) =>
      new Response(JSON.stringify({ error: { message } }), { status, headers: { ...cors, "content-type": "application/json" } });

    // Opening the worker address in a browser shows this check message.
    if (!url.pathname.startsWith("/v1/")) {
      return new Response("TalkPartner relay is running." + (API_KEY ? " (built-in key)" : ""), { headers: { ...cors, "content-type": "text/plain; charset=utf-8" } });
    }
    if (request.method === "OPTIONS") return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (!allowed) return json(403, "Forbidden origin");

    let auth = request.headers.get("authorization") || "";
    const token = request.headers.get("x-tp-token") || "";
    if (token || !auth) {
      if (!API_KEY) return json(401, "No built-in key on this relay");
      if (token !== APP_TOKEN) return json(401, "Login token invalid");
      auth = "Bearer " + API_KEY;
    }

    const upstream = await fetch(UPSTREAM + url.pathname + url.search, {
      method: request.method,
      headers: { "authorization": auth, "content-type": "application/json" },
      body: request.method === "GET" ? undefined : await request.text(),
    });
    const headers = new Headers(cors);
    headers.set("content-type", upstream.headers.get("content-type") || "application/json");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
