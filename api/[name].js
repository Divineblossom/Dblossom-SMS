// Vercel adapter for the existing Netlify-compatible handlers.
// Keeps the current root-based HTML/CSS/JS site intact and exposes only named API routes.
const routes = {
  "admin-advanced": () => require("../netlify/functions/admin-advanced.js"),
  "admin-login": () => require("../netlify/functions/admin-login.js"),
  "admin-operations": () => require("../netlify/functions/admin-operations.js"),
  "admission-status": () => require("../netlify/functions/admission-status.js"),
  "admissions": () => require("../netlify/functions/admissions.js"),
  "bank-transfer-notifications": () => require("../netlify/functions/bank-transfer-notifications.js"),
  "browser-notifications": () => require("../netlify/functions/browser-notifications.js"),
  "contact": () => require("../netlify/functions/contact.js"),
  "dashboard-data": () => require("../netlify/functions/dashboard-data.js"),
  "fee-pay-init": () => require("../netlify/functions/fee-pay-init.js"),
  "fee-pay-verify": () => require("../netlify/functions/fee-pay-verify.js"),
  "parent-data": () => require("../netlify/functions/parent-data.js"),
  "paystack-init": () => require("../netlify/functions/paystack-init.js"),
  "paystack-verify": () => require("../netlify/functions/paystack-verify.js"),
  "paystack-webhook": () => require("../netlify/functions/paystack-webhook.js"),
  "portal-login": () => require("../netlify/functions/portal-login.js"),
  "teacher-records": () => require("../netlify/functions/teacher-records.js"),
  "supabase-health": () => require("../netlify/functions/supabase-health.js")
};

const MAX_BODY = 4 * 1024 * 1024;

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readBody(req) {
  if (req.method === "GET" || req.method === "HEAD") return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) {
      const error = new Error("Request body too large");
      error.status = 413;
      throw error;
    }
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  if (raw) return raw;
  // Fallback for runtimes that already parsed the request body.
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);
  return null;
}

module.exports = async function handler(req, res) {
  let url;
  try {
    url = new URL(req.url || "/", "http://localhost");
  } catch {
    return send(res, 400, { error: "Invalid request URL." });
  }

  const name = decodeURIComponent(url.pathname.replace(/^\/api\//, "").replace(/\/+$/, ""));
  if (!/^[A-Za-z0-9_-]+$/.test(name) || !Object.prototype.hasOwnProperty.call(routes, name)) {
    return send(res, 404, { error: "API route not found." });
  }

  try {
    const module = routes[name]();
    if (typeof module.handler !== "function") throw new Error("API handler is missing.");
    const body = await readBody(req);
    const event = {
      httpMethod: req.method,
      headers: req.headers || {},
      queryStringParameters: Object.fromEntries(url.searchParams.entries()),
      path: url.pathname,
      body,
      isBase64Encoded: false
    };
    const result = await module.handler(event, {});
    for (const [key, value] of Object.entries(result?.headers || {})) {
      if (value !== undefined && value !== null) res.setHeader(key, value);
    }
    res.statusCode = result?.statusCode || 200;
    // Portal API responses contain user-specific records. Never allow browser,
    // proxy, or CDN caches to reuse one account\u2019s dashboard for another.
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Vary", "Authorization, Cookie");
    if (!res.getHeader("Content-Type")) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    res.end(result?.body ?? "");
  } catch (error) {
    console.error("Vercel API route " + name + " failed:", error);
    send(res, error?.status || 500, {
      error: error?.status === 413
        ? "Request body is too large."
        : "The request could not be completed. Check server configuration and logs."
    });
  }
};
