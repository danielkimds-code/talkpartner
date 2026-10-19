// TalkPartner relay — Cloudflare Worker
// Forwards the app's requests to aiapiflow.com and adds the browser permission (CORS)
// that aiapiflow does not send.
//
// Two ways to use it:
//  1) Built-in key: fill API_KEY and APP_TOKENS below (only inside your own Cloudflare
//     account, never in the public repo). The app then needs no key on the iPad;
//     it proves the login with the x-tp-token header. Each login token gets its own
//     storage slot, so every account keeps separate study data.
//  2) Pass-through: leave them empty; the app sends its own key in Authorization.

const UPSTREAM = "https://aiapiflow.com";
const API_KEY = "";    // sk-... (built-in key, optional)
// login-derived token -> storage slot ("" keeps the first account's original keys)
const APP_TOKENS = {};
const ALLOWED_ORIGINS = ["https://danielkimds-code.github.io"];
const known = (t) => !!t && Object.prototype.hasOwnProperty.call(APP_TOKENS, t);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
      "Access-Control-Allow-Headers": "authorization, content-type, x-tp-token",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    const json = (status, message) =>
      new Response(JSON.stringify({ error: { message } }), { status, headers: { ...cors, "content-type": "application/json" } });

    // Cloud storage for study notes and review cards (needs a KV binding named TP).
    if (url.pathname.startsWith("/store/")) {
      if (request.method === "OPTIONS") return new Response(null, { status: allowed ? 204 : 403, headers: cors });
      if (!allowed) return json(403, "Forbidden origin");
      if (!env || !env.TP) return json(501, "No storage on this relay");
      const tok = request.headers.get("x-tp-token") || "";
      if (!known(tok)) return json(401, "Login token invalid");
      const key = url.pathname.slice(7);
      if (!/^[a-z0-9_-]{1,40}$/.test(key)) return json(400, "Bad key");
      const kvKey = "tp:" + (APP_TOKENS[tok] ? APP_TOKENS[tok] + ":" : "") + key;
      if (request.method === "GET") {
        const v = await env.TP.get(kvKey);
        return new Response(v === null ? "null" : v, { headers: { ...cors, "content-type": "application/json" } });
      }
      if (request.method === "PUT") {
        const body = await request.text();
        if (body.length > 4000000) return json(413, "Too large");
        try { JSON.parse(body); } catch { return json(400, "Not JSON"); }
        await env.TP.put(kvKey, body);
        return new Response('{"ok":true}', { headers: { ...cors, "content-type": "application/json" } });
      }
      return json(405, "Method not allowed");
    }

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
      if (!known(token)) return json(401, "Login token invalid");
      auth = "Bearer " + API_KEY;
    }

    let upstream;
    try {
      upstream = await fetch(UPSTREAM + url.pathname + url.search, {
        method: request.method,
        headers: { "authorization": auth, "content-type": "application/json" },
        body: request.method === "GET" ? undefined : await request.text(),
      });
    } catch (e) {
      return json(502, "Upstream unreachable: " + String(e && e.message || e));
    }
    const headers = new Headers(cors);
    headers.set("content-type", upstream.headers.get("content-type") || "application/json");
    return new Response(upstream.body, { status: upstream.status, headers });
  },
};
