const { admin, db } = require("../../../lib/firebase-admin");
const { requireAuth } = require("../../../lib/auth");
const { requireFinanceAdmin } = require("../../../lib/dashboard-admin");
const { handlePreflight, makeHttpError, normalizeError, parseJsonBody, sendJson, sendMethodNotAllowed } = require("../../../lib/http");
const {
  AGENT_ASSISTED_METHOD_ID,
  MIN_ORDER_HTG,
  buildAgentApprovedOrder,
  buildAgentCreditWalletPatch,
  computeDepositBonusSnapshot,
  getAgentDepositMethodMeta,
} = require("../../../lib/agent-deposits");
const {
  applyApprovedDepositStatsTx,
} = require("../../../lib/deposit-flow-stats");
const { sanitizeEmail } = require("../../../lib/deposits");
const { safeInt, sanitizeText } = require("../../../lib/safe");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const { uid: agentUid, email: agentEmail } = await requireFinanceAdmin(decoded);
    const payload = await parseJsonBody(req);
    const clientId = sanitizeText(payload.clientId || payload.uid || "", 160);
    const amountHtg = safeInt(payload.amountHtg);
    const note = sanitizeText(payload.note || "", 240);
    const requestedMethodId = sanitizeText(payload.methodId || AGENT_ASSISTED_METHOD_ID, 80).toLowerCase();

    if (!clientId || amountHtg < MIN_ORDER_HTG) {
      throw makeHttpError(400, "invalid-argument", "Credit agent invalide.");
    }

    const clientRef = db.collection("clients").doc(clientId);
    const methodMetaBase = getAgentDepositMethodMeta(requestedMethodId);
    let methodMeta = methodMetaBase;

    if (methodMetaBase.id !== AGENT_ASSISTED_METHOD_ID) {
      const methodSnap = await db.collection("paymentMethods").doc(methodMetaBase.id).get();
      if (methodSnap.exists) {
        methodMeta = getAgentDepositMethodMeta(methodMetaBase.id, methodSnap.data() || {});
      }
    }

    const result = await db.runTransaction(async (tx) => {
      const [clientSnap] = await Promise.all([
        tx.get(clientRef),
      ]);

      if (!clientSnap.exists) {
        throw makeHttpError(404, "not-found", "Compte client introuvable.");
      }

      const clientData = clientSnap.data() || {};
      const nowMs = Date.now();
      const orderRef = clientRef.collection("orders").doc();
      const orderData = buildAgentApprovedOrder({
        orderId: orderRef.id,
        clientId,
        clientData,
        amountHtg,
        note,
        methodMeta,
        agentUid,
        agentEmail,
        nowMs,
      });
      const depositBonusSnapshot = computeDepositBonusSnapshot(amountHtg);
      const walletPatch = buildAgentCreditWalletPatch(clientData, amountHtg, depositBonusSnapshot.bonusHtgAwarded);

      tx.set(orderRef, {
        ...orderData,
        createdAtServer: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      applyApprovedDepositStatsTx(tx, orderData, nowMs);
      tx.set(clientRef, {
        uid: clientId,
        email: sanitizeEmail(clientData.email || "", 160),
        ...walletPatch,
        hasApprovedDeposit: true,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAtMs: nowMs,
      }, { merge: true });

      return {
        ok: true,
        orderId: orderRef.id,
        clientId,
        amountHtg,
        methodId: methodMeta.id,
        methodName: methodMeta.name,
        bonusHtgAwarded: safeInt(depositBonusSnapshot.bonusHtgAwarded),
        approvedHtgAvailable: safeInt(walletPatch.approvedHtgAvailable),
        provisionalHtgAvailable: safeInt(walletPatch.provisionalHtgAvailable),
        playableHtg: safeInt(walletPatch.playableHtg),
      };
    });

    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de crediter le compte client.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
