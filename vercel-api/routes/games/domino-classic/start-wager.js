const { admin, db } = require("../../../lib/firebase-admin");
const { requireAuth } = require("../../../lib/auth");
const {
  handlePreflight,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../../lib/http");
const { readPublicAppSettings } = require("../../../lib/public-config");
const {
  assertAllowedDominoClassicStake,
  assertAllowedGameVariant,
  buildDominoClassicSessionId,
  getConfiguredDominoClassicBotDifficulty,
  readActiveWagerStatus,
  resolveGameEntryFundingRequest,
} = require("../../../lib/domino-classic");
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
    if (fundingRequest.fundingCurrency !== "htg") {
      throw normalizeError({
        httpStatus: 400,
        code: "domino-classic-htg-only",
        message: "Seul le financement HTG est autorise pour Domino classique.",
        details: {
          fundingCurrency: fundingRequest.fundingCurrency,
        },
      });
    }

    const gameVariant = assertAllowedGameVariant(payload.gameVariant);
    const settings = await readPublicAppSettings();
    if (settings.dominoClassicEnabled === false) {
      throw normalizeError({
        httpStatus: 503,
        code: "domino-classic-disabled",
        message: "Jwet Domino 4 player la pa disponib pou kounye a.",
        details: {
          gameKey: "dominoClassic",
        },
      });
    }
    const { rewardDoes, stakeHtg, rewardHtg } = assertAllowedDominoClassicStake(stakeDoes, settings.gameStakeOptions);
    const configuredBotDifficulty = await getConfiguredDominoClassicBotDifficulty();

    const nowMs = Date.now();
    const requestedSessionId = sanitizeText(payload.sessionId || "", 120);
    const sessionId = requestedSessionId || buildDominoClassicSessionId(nowMs);
    const clientRef = db.collection("clients").doc(uid);

    const result = await db.runTransaction(async (tx) => {
      const clientSnap = await tx.get(clientRef);
      const clientData = clientSnap.exists ? (clientSnap.data() || {}) : {};
      const currentWager = clientData.dominoClassicWagerState && typeof clientData.dominoClassicWagerState === "object"
        ? clientData.dominoClassicWagerState
        : {};
      const activeWager = readActiveWagerStatus(currentWager, nowMs);
      if (activeWager.isActive && activeWager.sessionId && !activeWager.expired) {
        throw normalizeError({
          httpStatus: 409,
          code: "active-domino-classic-wager",
          message: "Une mise Domino classique est deja en cours.",
          details: {
            sessionId: activeWager.sessionId,
          },
        });
      }

      const beforeBalanceHtg = Math.max(0, readApprovedHtg(clientData) + readProvisionalHtg(clientData));
      const walletMutation = applyHtgStakeDebit(clientData, { stakeHtg });
      tx.set(clientRef, {
        uid,
        email: email || clientData.email || "",
        ...walletMutation.balancesPatch,
        dominoClassicWagerState: {
          sessionId,
          status: "active",
          gameVariant,
          stakeDoes,
          rewardDoes,
          fundingCurrency: fundingRequest.fundingCurrency,
          gameEntryFunding: walletMutation.gameEntryFunding,
          botDifficulty: configuredBotDifficulty,
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
        gameVariant,
        fundingCurrency: fundingRequest.fundingCurrency,
        botDifficulty: configuredBotDifficulty,
        stakeHtg,
        rewardAmountHtg: rewardHtg,
        gameEntryFunding: walletMutation.gameEntryFunding,
        does: safeInt(walletMutation.afterDoes),
        htg: safeInt(walletMutation.afterPlayableHtg),
        playableHtg: safeInt(walletMutation.afterPlayableHtg),
        approvedHtgAvailable: safeInt(walletMutation.afterApprovedHtgAvailable),
        provisionalHtgAvailable: safeInt(walletMutation.afterProvisionalHtgAvailable),
      };
    });

    sendJson(req, res, 200, result);
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de demarrer la partie Domino classique.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
