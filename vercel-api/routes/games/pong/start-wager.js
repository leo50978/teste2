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
  PONG_ALLOWED_STAKES,
  buildPongRewardDoes,
  buildPongSessionId,
  getConfiguredPongAiProfile,
  readActivePongWagerStatus,
} = require("../../../lib/pong");
const { readPublicAppSettings } = require("../../../lib/public-config");
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
    const publicSettings = await readPublicAppSettings();

    if (publicSettings.pongEnabled === false) {
      throw makeHttpError(503, "pong-disabled", "Jwet Pong la pa disponib pou kounye a.", {
        gameKey: "pong",
      });
    }

    if (!PONG_ALLOWED_STAKES.has(stakeDoes)) {
      throw makeHttpError(400, "pong-stake-not-allowed", "Mise Pong non autorisee.");
    }
    if (fundingRequest.fundingCurrency !== "htg") {
      throw makeHttpError(400, "pong-htg-only", "Seul le financement HTG est autorise pour Pong.", {
        fundingCurrency: fundingRequest.fundingCurrency,
      });
    }

    const nowMs = Date.now();
    const requestedSessionId = sanitizeText(payload.sessionId || "", 120);
    const sessionId = requestedSessionId || buildPongSessionId(nowMs);
    const rewardDoes = buildPongRewardDoes(stakeDoes);
    const stakeHtg = buildStakeAmountHtg(stakeDoes);
    const rewardHtg = buildRewardAmountHtg(stakeDoes, rewardDoes);
    const aiProfile = await getConfiguredPongAiProfile();
    const clientRef = db.collection("clients").doc(uid);

    const result = await db.runTransaction(async (tx) => {
      const clientSnap = await tx.get(clientRef);
      const clientData = clientSnap.exists ? (clientSnap.data() || {}) : {};
      const currentWager = clientData.pongWagerState && typeof clientData.pongWagerState === "object"
        ? clientData.pongWagerState
        : {};
      const beforeBalanceHtg = Math.max(0, readApprovedHtg(clientData) + readProvisionalHtg(clientData));

      const activeWager = readActivePongWagerStatus(currentWager, nowMs);
      if (activeWager.isActive && activeWager.sessionId && !activeWager.expired) {
        throw makeHttpError(409, "active-pong-wager", "Une mise Pong est deja en cours.", {
          sessionId: activeWager.sessionId,
        });
      }

      const walletMutation = applyHtgStakeDebit(clientData, { stakeHtg });
      tx.set(clientRef, {
        uid,
        email: email || clientData.email || "",
        ...walletMutation.balancesPatch,
        pongWagerState: {
          sessionId,
          status: "active",
          aiProfile,
          stakeDoes,
          rewardDoes,
          fundingCurrency: fundingRequest.fundingCurrency,
          gameEntryFunding: walletMutation.gameEntryFunding,
          stakeHtg,
          rewardAmountHtg: rewardHtg,
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
        aiProfile,
        fundingCurrency: fundingRequest.fundingCurrency,
        stakeHtg,
        rewardAmountHtg: rewardHtg,
        does: safeInt(walletMutation.afterDoes),
        htg: safeInt(walletMutation.afterPlayableHtg),
        playableHtg: safeInt(walletMutation.afterPlayableHtg),
        approvedHtgAvailable: safeInt(walletMutation.afterApprovedHtgAvailable),
        provisionalHtgAvailable: safeInt(walletMutation.afterProvisionalHtgAvailable),
      };
    });

    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de demarrer la partie Pong.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
