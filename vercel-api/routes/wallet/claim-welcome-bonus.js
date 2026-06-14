const { admin } = require("../../lib/firebase-admin");
const { requireAuth } = require("../../lib/auth");
const {
  handlePreflight,
  makeHttpError,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../lib/http");
const { sanitizeEmail } = require("../../lib/deposits");
const { safeSignedInt, sanitizePhone, sanitizeText } = require("../../lib/safe");
const {
  WELCOME_BONUS_END_AT_MS,
  WELCOME_BONUS_HTG_AMOUNT,
  assertWalletNotFrozen,
  buildFundingStatusDecorations,
  isWelcomeBonusOrder,
  resolveWelcomeBonusEligibility,
  walletRef,
} = require("../../lib/player-wallet");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const uid = String(decoded.uid || "").trim();
    const email = sanitizeEmail(decoded.email || "", 160);
    const payload = await parseJsonBody(req);
    const customerName = sanitizeText(payload.customerName || "", 120);
    const customerPhone = sanitizePhone(payload.customerPhone || "", 40);
    const proofRef = sanitizeText(payload.proofRef || "", 180);

    if (!proofRef) {
      throw makeHttpError(400, "invalid-argument", "Preuve bienvenue requise.");
    }

    const clientRef = walletRef(uid);
    const result = await clientRef.firestore.runTransaction(async (tx) => {
      const [clientSnap, ordersSnap] = await Promise.all([
        tx.get(clientRef),
        tx.get(clientRef.collection("orders")),
      ]);

      if (!clientSnap.exists) {
        throw makeHttpError(404, "client-not-found", "Compte introuvable.");
      }

      const clientData = clientSnap.data() || {};
      const orders = ordersSnap.docs.map((docSnap) => ({ id: docSnap.id, ...(docSnap.data() || {}) }));
      assertWalletNotFrozen(clientData);

      const eligibility = resolveWelcomeBonusEligibility({
        clientData,
        orders,
      });

      if (eligibility.eligible !== true) {
        let code = "welcome-bonus-not-eligible";
        let message = "Ce compte n'est pas eligible au bonus de bienvenue.";

        if (eligibility.reason === "already-claimed" || orders.some((order) => isWelcomeBonusOrder(order))) {
          code = "welcome-bonus-already-claimed";
          message = "Bonus bienvenue deja reclame.";
        } else if (eligibility.reason === "offer-ended" || Date.now() > WELCOME_BONUS_END_AT_MS) {
          code = "welcome-bonus-offer-ended";
          message = "Desole, le bonus de bienvenue est termine.";
        } else if (eligibility.reason === "account-frozen") {
          code = "account-frozen";
          message = "Kont sa a pa ka resevwa bonus la kounye a.";
        } else if (eligibility.reason === "real-deposit-exists") {
          code = "welcome-bonus-real-deposit-exists";
          message = "Kont sa a deja gen yon depo reyel.";
        }

        throw makeHttpError(409, code, message, {
          reason: eligibility.reason,
          welcomeBonusEndAtMs: eligibility.endAtMs,
          welcomeBonusLaunchAtMs: eligibility.launchAtMs,
        });
      }

      const nowMs = Date.now();
      const patch = {
        uid,
        email: email || clientData.email || "",
        name: customerName || sanitizeText(clientData.name || String(email || "").split("@")[0] || "Player", 80),
        phone: customerPhone || sanitizePhone(clientData.phone || "", 40),
        welcomeBonusClaimed: true,
        welcomeBonusReceivedAtMs: nowMs,
        welcomeBonusProofCode: sanitizeText(clientData.welcomeBonusProofCode || "", 80).toUpperCase(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAtMs: nowMs,
      };

      tx.set(clientRef, patch, { merge: true });

      const fundingDecorations = buildFundingStatusDecorations({
        ...clientData,
        ...patch,
      }, orders);

      return {
        ok: true,
        message: `Ton bonus de bienvenue de ${WELCOME_BONUS_HTG_AMOUNT} HTG a ete active avec succes.`,
        welcomeBonusHtgGranted: WELCOME_BONUS_HTG_AMOUNT,
        welcomeBonusClaimed: true,
        ...fundingDecorations,
      };
    });

    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de reclamer le bonus de bienvenue.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
