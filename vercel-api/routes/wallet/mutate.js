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
const { safeInt } = require("../../lib/safe");
const {
  assertWalletNotFrozen,
  walletRef,
} = require("../../lib/player-wallet");
const {
  RATE_HTG_TO_DOES,
  applyHtgStakeDebit,
  normalizeFundingCurrency,
  readProvisionalHtg,
} = require("../../lib/wallet-htg");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const uid = String(decoded.uid || "").trim();
    const email = String(decoded.email || "").trim();
    const payload = await parseJsonBody(req);
    const op = String(payload.op || "").trim().toLowerCase();

    if (op !== "game_entry") {
      throw makeHttpError(400, "invalid-argument", "Operation non supportee.");
    }

    const amountDoes = Math.max(0, safeInt(payload.amountDoes));
    const amountGourdesRaw = Math.max(0, safeInt(payload.amountGourdes));
    const fundingCurrency = normalizeFundingCurrency(payload.fundingCurrency || "htg");
    if (fundingCurrency !== "htg") {
      throw makeHttpError(400, "invalid-argument", "Se funding HTG selman ki sipote pou endpoint sa a.");
    }

    const amountHtgFromDoes = amountDoes > 0 ? Math.floor(amountDoes / RATE_HTG_TO_DOES) : 0;
    const stakeHtg = Math.max(amountGourdesRaw, amountHtgFromDoes);
    if (stakeHtg <= 0) {
      throw makeHttpError(400, "invalid-argument", "Montan antre a pa valid.");
    }

    const clientRef = walletRef(uid);
    const result = await db.runTransaction(async (tx) => {
      const clientSnap = await tx.get(clientRef);
      if (!clientSnap.exists) {
        throw makeHttpError(404, "not-found", "Kont kliyan an pa jwenn.");
      }

      const clientData = clientSnap.data() || {};
      assertWalletNotFrozen(clientData);
      const provisionalHtg = readProvisionalHtg(clientData);
      if (provisionalHtg > 0) {
        throw makeHttpError(409, "pending-htg-blocked", "Ou pa ka enskri pandan ou gen HTG an atant.", {
          provisionalHtgAvailable: provisionalHtg,
        });
      }
      const walletMutation = applyHtgStakeDebit(clientData, { stakeHtg });
      const nowMs = Date.now();

      tx.set(clientRef, {
        uid,
        email: email || String(clientData.email || ""),
        ...walletMutation.balancesPatch,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAtMs: nowMs,
      }, { merge: true });

      return {
        ok: true,
        op: "game_entry",
        fundingCurrency: "htg",
        amountHtg: stakeHtg,
        amountDoes: stakeHtg * RATE_HTG_TO_DOES,
        does: safeInt(walletMutation.afterDoes),
        approvedHtgAvailable: safeInt(walletMutation.afterApprovedHtgAvailable),
        provisionalHtgAvailable: safeInt(walletMutation.afterProvisionalHtgAvailable),
        playableHtg: safeInt(walletMutation.afterPlayableHtg),
        gameEntryFunding: walletMutation.gameEntryFunding || null,
      };
    });

    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de mettre a jour le wallet.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
