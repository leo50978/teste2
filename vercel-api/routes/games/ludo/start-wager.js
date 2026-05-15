const { admin, db } = require("../../../lib/firebase-admin");
const { requireAuth } = require("../../../lib/auth");
const {
  handlePreflight,
  makeHttpError,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../../lib/http");
const {
  buildRewardAmountHtg,
  buildStakeAmountHtg,
  resolveGameEntryFundingRequest,
} = require("../../../lib/domino-classic");
const {
  LUDO_ALLOWED_STAKES,
  buildLudoRewardDoes,
  buildLudoSessionId,
  getConfiguredLudoBotDifficulty,
  readActiveLudoWagerStatus,
} = require("../../../lib/ludo");
const { safeInt, sanitizeText } = require("../../../lib/safe");
const { applyHtgStakeDebit, readApprovedHtg, readProvisionalHtg } = require("../../../lib/wallet-htg");

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
    const stakeDoes = safeInt(payload.stakeDoes);
    const fundingRequest = resolveGameEntryFundingRequest(payload, stakeDoes, "htg");

    if (!LUDO_ALLOWED_STAKES.has(stakeDoes)) {
      throw makeHttpError(400, "ludo-stake-not-allowed", "Mise Ludo non autorisee.");
    }
    if (fundingRequest.fundingCurrency !== "htg") {
      throw makeHttpError(400, "ludo-htg-only", "Seul le financement HTG est autorise pour Ludo.", {
        fundingCurrency: fundingRequest.fundingCurrency,
      });
    }

    const nowMs = Date.now();
    const requestedSessionId = sanitizeText(payload.sessionId || "", 120);
    const sessionId = requestedSessionId || buildLudoSessionId(nowMs);
    const rewardDoes = buildLudoRewardDoes(stakeDoes);
    const stakeHtg = buildStakeAmountHtg(stakeDoes);
    const rewardHtg = buildRewardAmountHtg(stakeDoes, rewardDoes);
    const botUsername = sanitizeText(payload.botUsername || "", 64);
    const botDifficulty = await getConfiguredLudoBotDifficulty();
    const clientRef = db.collection("clients").doc(uid);

    const result = await db.runTransaction(async (tx) => {
      const clientSnap = await tx.get(clientRef);
      const clientData = clientSnap.exists ? (clientSnap.data() || {}) : {};
      const currentWager = clientData.ludoWagerState && typeof clientData.ludoWagerState === "object"
        ? clientData.ludoWagerState
        : {};
      const beforeBalanceHtg = Math.max(0, readApprovedHtg(clientData) + readProvisionalHtg(clientData));

      const activeWager = readActiveLudoWagerStatus(currentWager, nowMs);
      if (activeWager.isActive && activeWager.sessionId && !activeWager.expired) {
        throw makeHttpError(409, "active-ludo-wager", "Une mise Ludo est deja en cours.", {
          sessionId: activeWager.sessionId,
        });
      }

      const walletMutation = applyHtgStakeDebit(clientData, { stakeHtg });
      tx.set(clientRef, {
        uid,
        email: email || clientData.email || "",
        ...walletMutation.balancesPatch,
        ludoWagerState: {
          sessionId,
          status: "active",
          stakeDoes,
          rewardDoes,
          fundingCurrency: fundingRequest.fundingCurrency,
          gameEntryFunding: walletMutation.gameEntryFunding,
          stakeHtg,
          rewardAmountHtg: rewardHtg,
          botUsername,
          botDifficulty,
          beforeBalanceHtgAtEntry: beforeBalanceHtg,
          afterEntryBalanceHtg: safeInt(walletMutation.afterPlayableHtg),
          startedAtMs: nowMs,
          lastEventAtMs: nowMs,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAtMs: nowMs,
      }, { merge: true });

      return {
        ok: true,
        sessionId,
        stakeDoes,
        rewardDoes,
        fundingCurrency: fundingRequest.fundingCurrency,
        stakeHtg,
        rewardAmountHtg: rewardHtg,
        botUsername,
        botDifficulty,
        startedAtMs: nowMs,
        does: safeInt(walletMutation.afterDoes),
        htg: safeInt(walletMutation.afterPlayableHtg),
        playableHtg: safeInt(walletMutation.afterPlayableHtg),
        approvedHtgAvailable: safeInt(walletMutation.afterApprovedHtgAvailable),
        provisionalHtgAvailable: safeInt(walletMutation.afterProvisionalHtgAvailable),
      };
    });

    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de demarrer la partie Ludo.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
