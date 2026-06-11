const { resolveAllowedOrigin } = require("./origins");

function applyCors(req, res) {
  const origin = resolveAllowedOrigin(req.headers.origin || "");
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Internal-Secret");
}

function handlePreflight(req, res) {
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return true;
  }
  return false;
}

function sendJson(req, res, status, payload) {
  applyCors(req, res);
  res.status(status).json(payload);
}

function sendMethodNotAllowed(req, res, allowedMethods = ["POST"]) {
  res.setHeader("Allow", allowedMethods.join(", "));
  sendJson(req, res, 405, {
    ok: false,
    code: "method-not-allowed",
    message: "Methode non autorisee.",
  });
}

function normalizeError(error, fallbackMessage = "Erreur serveur") {
  if (error && typeof error === "object" && error.httpStatus) {
    return error;
  }

  const normalized = new Error(String(error?.message || fallbackMessage));
  normalized.httpStatus = Number(error?.httpStatus) || 500;
  normalized.code = String(error?.code || "internal");
  normalized.details = error?.details && typeof error.details === "object" ? error.details : undefined;
  return normalized;
}

function makeHttpError(httpStatus, code, message, details = undefined) {
  const err = new Error(String(message || "Erreur"));
  err.httpStatus = Number(httpStatus) || 500;
  err.code = String(code || "internal");
  err.details = details && typeof details === "object" ? details : undefined;
  return err;
}

async function parseJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string" && req.body.trim()) {
    try {
      return JSON.parse(req.body);
    } catch (_) {
      return {};
    }
  }
  return {};
}

module.exports = {
  applyCors,
  handlePreflight,
  makeHttpError,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
};
