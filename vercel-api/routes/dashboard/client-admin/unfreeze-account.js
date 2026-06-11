const { admin } = require("../../../lib/firebase-admin");
const { requireAuth } = require("../../../lib/auth");
const { requireFinanceAdmin } = require("../../../lib/dashboard-admin");
const {
  handlePreflight,
  makeHttpError,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../../lib/http");
const { sanitizeText } = require("../../../lib/safe");
const { walletRef } = require("../../../lib/player-wallet");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const adminUser = await requireFinanceAdmin(decoded);
    const payload = await parseJsonBody(req);
    const uid = sanitizeText(payload.uid || payload.clientId || "", 160);
    const reason = sanitizeText(payload.reason || "", 240);

    if (!uid) {
      throw makeHttpError(400, "invalid-argument", "uid requis.");
    }

    await walletRef(uid).set({
      accountFrozen: false,
      freezeReason: "",
      freezeReasonLabel: "",
      freezeReasonAtMs: 0,
      withdrawalHold: false,
      withdrawalHoldReason: "",
      withdrawalHoldAtMs: 0,
      rejectedDepositStrikeCount: 0,
      unfrozenAtMs: Date.now(),
      unfrozenByUid: adminUser.uid,
      unfrozenByEmail: adminUser.email,
      unfreezeReason: reason || "",
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: Date.now(),
    }, { merge: true });

    sendJson(req, res, 200, {
      ok: true,
      uid,
      accountFrozen: false,
      withdrawalHold: false,
      rejectedDepositStrikeCount: 0,
      unfreezeReason: reason || "",
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de debloquer le compte client.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
