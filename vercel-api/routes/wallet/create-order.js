const { admin, db } = require("../../lib/firebase-admin");
const { requireAuth } = require("../../lib/auth");
const {
  handlePreflight,
  makeHttpError,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../lib/http");
const { sanitizePublicMethod } = require("../../lib/payment-options");
const {
  MIN_ORDER_HTG,
  buildDepositOrderRecord,
  hasBlockingPendingOrder,
  sanitizeEmail,
} = require("../../lib/deposits");
const { safeInt, sanitizePhone, sanitizeText } = require("../../lib/safe");
const {
  buildBalancesPatch,
  readApprovedHtg,
  readProvisionalHtg,
  readWithdrawableHtg,
} = require("../../lib/wallet-htg");
const { applyDepositCreatedStatsTx } = require("../../lib/deposit-flow-stats");

function assertClientCanCreateDeposit(clientData = {}) {
  if (clientData.accountFrozen === true || clientData.withdrawalHold === true) {
    throw makeHttpError(
      403,
      "account-frozen",
      "Kont ou a te bloke tanporeman apre plizye depo yo te rejte. Kontakte sipo a."
    );
  }
}

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const uid = String(decoded.uid || "").trim();
    const email = sanitizeEmail(decoded.email || "");
    const payload = await parseJsonBody(req);
    const methodId = sanitizeText(payload.methodId || "", 120);
    const amountHtg = safeInt(payload.amountHtg);
    const customerName = sanitizeText(payload.customerName || "", 120);
    const customerEmail = sanitizeEmail(payload.customerEmail || email || "", 160) || email;
    const customerPhone = sanitizePhone(payload.customerPhone || "", 40);
    const depositorPhone = sanitizePhone(payload.depositorPhone || "", 40);
    const proofRef = sanitizeText(payload.proofRef || "", 180);
    const proofStepDurationMs = safeInt(payload.proofStepDurationMs);
    const extractedText = sanitizeText(payload.extractedText || "", 500);
    const extractedTextStatus = sanitizeText(payload.extractedTextStatus || "pending", 20).toLowerCase();

    if (!methodId || amountHtg < MIN_ORDER_HTG || !customerName || !proofRef) {
      throw makeHttpError(400, "invalid-argument", "Commande invalide.");
    }

    const methodSnap = await db.collection("paymentMethods").doc(methodId).get();
    if (!methodSnap.exists) {
      throw makeHttpError(404, "not-found", "Methode introuvable.");
    }
    const method = sanitizePublicMethod(methodSnap);
    if (!method) {
      throw makeHttpError(409, "failed-precondition", "Methode indisponible.");
    }

    const nowMs = Date.now();
    const orderRef = db.collection("clients").doc(uid).collection("orders").doc();
    const clientRef = db.collection("clients").doc(uid);

    const result = await db.runTransaction(async (tx) => {
      const clientSnap = await tx.get(clientRef);
      const ordersSnap = await tx.get(clientRef.collection("orders"));
      const clientData = clientSnap.exists ? (clientSnap.data() || {}) : {};
      const existingOrders = ordersSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));

      assertClientCanCreateDeposit(clientData);
      if (hasBlockingPendingOrder(existingOrders)) {
        throw makeHttpError(
          409,
          "failed-precondition",
          "Ou deja gen yon depo an atant. Tann admin nan valide oswa rejte li avan ou voye yon lot demann depo."
        );
      }

      const approvedHtg = readApprovedHtg(clientData);
      const provisionalHtg = readProvisionalHtg(clientData);
      const withdrawableHtg = readWithdrawableHtg(clientData, approvedHtg);
      const nextBalances = buildBalancesPatch({
        approvedHtg,
        provisionalHtg: provisionalHtg + amountHtg,
        withdrawableHtg,
      });

      const orderRecord = buildDepositOrderRecord({
        orderId: orderRef.id,
        uid,
        amountHtg,
        method,
        customerName,
        customerEmail,
        customerPhone,
        depositorPhone,
        proofRef,
        extractedText,
        extractedTextStatus,
        proofStepDurationMs,
        nowMs,
      });

      tx.set(orderRef, {
        ...orderRecord,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      applyDepositCreatedStatsTx(tx, orderRecord, nowMs);

      tx.set(clientRef, {
        uid,
        email: email || clientData.email || "",
        ...nextBalances,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAtMs: nowMs,
      }, { merge: true });

      return {
        ok: true,
        orderId: orderRef.id,
        clientId: uid,
        status: "pending",
        creditedProvisionally: true,
        message: "Depo a anrejistre an atant verifikasyon admin.",
        approvedHtgAvailable: safeInt(nextBalances.approvedHtgAvailable),
        provisionalHtgAvailable: safeInt(nextBalances.provisionalHtgAvailable),
        playableHtg: safeInt(nextBalances.playableHtg),
      };
    });

    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de creer la commande.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
