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

const DEFAULT_TEMPORARY_WITHDRAWAL_HOLD_MESSAGE = "Le retrait est temporairement indisponible, veuillez attendre quelques minutes.";

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
    const active = payload.active === true;
    const reason = sanitizeText(payload.reason || "", 240) || "temporary_admin_hold";
    const requestedMessage = sanitizeText(payload.message || "", 240);
    const message = requestedMessage || DEFAULT_TEMPORARY_WITHDRAWAL_HOLD_MESSAGE;

    if (!uid) {
      throw makeHttpError(400, "invalid-argument", "uid requis.");
    }

    const nowMs = Date.now();
    const patch = active
      ? {
          withdrawalTemporaryHold: true,
          withdrawalTemporaryHoldReason: reason,
          withdrawalTemporaryHoldMessage: message,
          withdrawalTemporaryHoldAtMs: nowMs,
          withdrawalTemporaryHoldByUid: adminUser.uid,
          withdrawalTemporaryHoldByEmail: adminUser.email,
        }
      : {
          withdrawalTemporaryHold: false,
          withdrawalTemporaryHoldReason: "",
          withdrawalTemporaryHoldMessage: "",
          withdrawalTemporaryHoldAtMs: 0,
          withdrawalTemporaryHoldByUid: "",
          withdrawalTemporaryHoldByEmail: "",
          withdrawalTemporaryHoldReleasedAtMs: nowMs,
          withdrawalTemporaryHoldReleasedByUid: adminUser.uid,
          withdrawalTemporaryHoldReleasedByEmail: adminUser.email,
        };

    const clientRef = walletRef(uid);
    const clientSnap = await clientRef.get();
    if (!clientSnap.exists) {
      throw makeHttpError(404, "not-found", "Compte client introuvable.");
    }

    await clientRef.set({
      ...patch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    }, { merge: true });

    sendJson(req, res, 200, {
      ok: true,
      uid,
      withdrawalTemporaryHold: active,
      withdrawalTemporaryHoldReason: active ? reason : "",
      withdrawalTemporaryHoldMessage: active ? message : "",
      updatedAtMs: nowMs,
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de mettre a jour le gel retrait temporaire.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
