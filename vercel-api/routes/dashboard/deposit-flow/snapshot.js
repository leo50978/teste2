const { requireAuth } = require("../../../lib/auth");
const { requireFinanceAdmin } = require("../../../lib/dashboard-admin");
const {
  handlePreflight,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../../lib/http");
const { computeDepositAnalyticsSnapshot } = require("../../../lib/dashboard-analytics");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    await requireFinanceAdmin(decoded);
    const payload = await parseJsonBody(req);
    const snapshot = await computeDepositAnalyticsSnapshot(payload || {});
    sendJson(req, res, 200, { ok: true, snapshot });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de charger les analytics des depots.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
