const { requireAuth } = require("../../../lib/auth");
const {
  handlePreflight,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../../lib/http");
const { joinMatchmakingDuelV2 } = require("../../../lib/duel-v2");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const payload = await parseJsonBody(req);
    const result = await joinMatchmakingDuelV2({
      uid: String(decoded.uid || "").trim(),
      email: String(decoded.email || "").trim(),
      payload,
    });
    sendJson(req, res, 200, result);
  } catch (error) {
    console.error("[DUEL_V2_ROUTE] join-matchmaking failed", {
      uid: String(req?.user?.uid || "").trim(),
      method: String(req?.method || "").trim(),
      path: String(req?.url || "").trim(),
      code: String(error?.code || "internal"),
      httpStatus: Number(error?.httpStatus) || 500,
      message: String(error?.message || "Impossible de rejoindre Duel V2."),
      stack: String(error?.stack || "").split("\n").slice(0, 8).join("\n"),
    });
    const normalized = normalizeError(error, "Impossible de rejoindre Duel V2.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
