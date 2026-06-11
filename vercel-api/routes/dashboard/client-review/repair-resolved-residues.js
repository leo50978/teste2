const { admin, db } = require("../../../lib/firebase-admin");
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
const { getOrderResolutionStatus, sanitizeEmail } = require("../../../lib/deposits");
const { safeInt, sanitizeText } = require("../../../lib/safe");

function buildResolvedDepositResidueCleanupPatch(orderData = {}, { nowMs, adminUid, adminEmail }) {
  const status = getOrderResolutionStatus(orderData);
  if (!["approved", "rejected", "cancelled"].includes(status)) return null;

  const before = {
    provisionalHtgRemaining: safeInt(orderData.provisionalHtgRemaining),
    provisionalDoesRemaining: safeInt(orderData.provisionalDoesRemaining),
    provisionalGainDoes: safeInt(orderData.provisionalGainDoes),
  };

  if (before.provisionalHtgRemaining <= 0 && before.provisionalDoesRemaining <= 0 && before.provisionalGainDoes <= 0) {
    return null;
  }

  return {
    provisionalHtgRemaining: 0,
    provisionalDoesRemaining: 0,
    provisionalGainDoes: 0,
    fundingSettledAtMs: safeInt(orderData.fundingSettledAtMs) || nowMs,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: nowMs,
    resolvedResidueBeforeCleanup: before,
    resolvedResidueCleanedAtMs: nowMs,
    resolvedResidueCleanedByUid: sanitizeText(adminUid || "", 160),
    resolvedResidueCleanedByEmail: sanitizeEmail(adminEmail || "", 160),
  };
}

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const financeAdmin = await requireFinanceAdmin(decoded);
    const payload = await parseJsonBody(req);
    const clientId = sanitizeText(payload.clientId || payload.uid || "", 160);
    const limit = Math.min(200, Math.max(1, safeInt(payload.limit) || 100));

    if (!clientId) {
      throw makeHttpError(400, "invalid-argument", "Client introuvable.");
    }

    const clientRef = db.collection("clients").doc(clientId);
    const clientSnap = await clientRef.get();
    if (!clientSnap.exists) {
      throw makeHttpError(404, "not-found", "Compte client introuvable.");
    }

    const ordersSnap = await clientRef.collection("orders").limit(limit).get();
    const nowMs = Date.now();
    const batch = db.batch();
    const repaired = [];

    ordersSnap.docs.forEach((orderSnap) => {
      const orderData = orderSnap.data() || {};
      const patch = buildResolvedDepositResidueCleanupPatch(orderData, {
        nowMs,
        adminUid: financeAdmin.uid,
        adminEmail: financeAdmin.email,
      });
      if (!patch) return;
      batch.set(orderSnap.ref, patch, { merge: true });
      repaired.push({
        orderId: orderSnap.id,
        status: getOrderResolutionStatus(orderData),
        before: patch.resolvedResidueBeforeCleanup,
      });
    });

    if (repaired.length) {
      batch.set(clientRef, {
        lastResolvedDepositResidueRepairAt: admin.firestore.FieldValue.serverTimestamp(),
        lastResolvedDepositResidueRepairAtMs: nowMs,
        lastResolvedDepositResidueRepairByUid: sanitizeText(financeAdmin.uid || "", 160),
        lastResolvedDepositResidueRepairByEmail: sanitizeEmail(financeAdmin.email || "", 160),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });
      await batch.commit();
    }

    sendJson(req, res, 200, {
      ok: true,
      clientId,
      scanned: ordersSnap.size,
      repairedCount: repaired.length,
      repaired,
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de reparer les residus des commandes resolues.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
