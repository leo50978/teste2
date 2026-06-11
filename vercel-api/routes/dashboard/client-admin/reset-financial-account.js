const { requireAuth } = require("../../../lib/auth");
const { requireFinanceAdmin } = require("../../../lib/dashboard-admin");
const {
  handlePreflight,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../../lib/http");
const { resetClientFinancialAccount } = require("../../../lib/dashboard-client-admin");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const adminInfo = await requireFinanceAdmin(decoded);
    const payload = await parseJsonBody(req);
    const result = await resetClientFinancialAccount({
      adminUid: adminInfo.uid,
      adminEmail: adminInfo.email,
      payload,
    });
    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de reinitialiser le compte financier client.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
