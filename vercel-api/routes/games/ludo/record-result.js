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
const { buildRewardAmountHtg } = require("../../../lib/domino-classic");
const {
  LUDO_DISCONNECT_FORFEIT_MS,
  LUDO_RECENT_MATCH_IDS_LIMIT,
  LUDO_RECENT_OUTCOMES_LIMIT,
} = require("../../../lib/ludo");
const { safeSignedInt, safeInt, sanitizeText } = require("../../../lib/safe");
const {
  applyHtgRewardCredit,
  normalizeFundingCurrency,
  readApprovedHtg,
  readProvisionalHtg,
} = require("../../../lib/wallet-htg");

const FORCED_LOSS_REASONS = new Set([
  "quit",
  "offline",
  "heartbeat_failed",
  "pagehide",
  "beforeunload",
  "session_resume_forfeit",
  "auto_forfeit_active_session",
]);

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

    const matchId = sanitizeText(payload.matchId || "", 120);
    if (!matchId) {
      throw makeHttpError(400, "missing-match-id", "matchId requis.");
    }

    const sessionId = sanitizeText(payload.sessionId || "", 120);
    const settleReason = sanitizeText(payload.reason || "", 80);
    const requestedWinner = String(payload.winner || "").trim().toLowerCase() === "user" ? "user" : "ai";
    const botUsername = sanitizeText(payload.botUsername || "", 64);
    const payloadBotDifficulty = sanitizeText(payload.botDifficulty || "", 32);
    const nowMs = Date.now();
    const clientRef = db.collection("clients").doc(uid);

    const result = await db.runTransaction(async (tx) => {
      const clientSnap = await tx.get(clientRef);
      const clientData = clientSnap.exists ? (clientSnap.data() || {}) : {};
      const currentStats = clientData.ludoStats && typeof clientData.ludoStats === "object"
        ? clientData.ludoStats
        : {};
      const existingMatchIds = Array.isArray(currentStats.recentMatchIds)
        ? currentStats.recentMatchIds.map((item) => sanitizeText(item || "", 120)).filter(Boolean)
        : [];

      if (existingMatchIds.includes(matchId)) {
        return {
          duplicate: true,
          gamesPlayed: safeInt(currentStats.gamesPlayed),
          userWins: safeInt(currentStats.userWins),
          aiWins: safeInt(currentStats.aiWins),
          rewardGranted: false,
          rewardAmountDoes: 0,
          rewardAmountHtg: 0,
          winner: requestedWinner,
        };
      }

      const currentRecentOutcomes = Array.isArray(currentStats.recentOutcomes)
        ? currentStats.recentOutcomes.map((item) => String(item || "")).filter((item) => item === "W" || item === "L")
        : [];
      const nextRecentMatchIds = [
        ...existingMatchIds.slice(-(LUDO_RECENT_MATCH_IDS_LIMIT - 1)),
        matchId,
      ];

      const currentWager = clientData.ludoWagerState && typeof clientData.ludoWagerState === "object"
        ? clientData.ludoWagerState
        : {};
      const wagerStatus = String(currentWager.status || "").trim().toLowerCase();
      const wagerSessionId = sanitizeText(currentWager.sessionId || "", 120);
      const canSettleWager = sessionId && wagerStatus === "active" && wagerSessionId === sessionId;
      const wagerLastEventAtMs = Math.max(
        safeSignedInt(currentWager.lastEventAtMs, 0),
        safeSignedInt(currentWager.startedAtMs, 0)
      );
      const disconnectedTooLong = canSettleWager
        && wagerLastEventAtMs > 0
        && (nowMs - wagerLastEventAtMs) >= LUDO_DISCONNECT_FORFEIT_MS;
      const forcedLoss = FORCED_LOSS_REASONS.has(settleReason);
      const resolvedWinner = (disconnectedTooLong || forcedLoss) ? "ai" : requestedWinner;
      const resolvedSettleReason = disconnectedTooLong ? "disconnect_forfeit" : (settleReason || "match_end");
      const nextRecentOutcomes = [
        ...currentRecentOutcomes.slice(-(LUDO_RECENT_OUTCOMES_LIMIT - 1)),
        resolvedWinner === "user" ? "W" : "L",
      ];
      const gamesPlayed = safeInt(currentStats.gamesPlayed) + 1;
      const userWins = safeInt(currentStats.userWins) + (resolvedWinner === "user" ? 1 : 0);
      const aiWins = safeInt(currentStats.aiWins) + (resolvedWinner === "ai" ? 1 : 0);
      let rewardGranted = false;
      let rewardAmountDoes = 0;
      let rewardAmountHtg = 0;
      const fallbackCurrentBalanceHtg = Math.max(0, readApprovedHtg(clientData) + readProvisionalHtg(clientData));
      const entryBeforeBalanceHtg = safeSignedInt(currentWager.beforeBalanceHtgAtEntry);
      const entryAfterBalanceHtg = safeSignedInt(currentWager.afterEntryBalanceHtg);
      const beforeBalanceHtg = entryBeforeBalanceHtg >= 0 ? entryBeforeBalanceHtg : fallbackCurrentBalanceHtg;
      let afterBalanceHtg = entryAfterBalanceHtg >= 0 ? entryAfterBalanceHtg : fallbackCurrentBalanceHtg;
      let balancePatch = {};

      if (canSettleWager) {
        const configuredRewardDoes = safeInt(currentWager.rewardDoes);
        const wagerFundingCurrency = normalizeFundingCurrency(currentWager.fundingCurrency || "htg");
        const configuredRewardHtg = safeInt(
          currentWager.rewardAmountHtg || buildRewardAmountHtg(safeInt(currentWager.stakeDoes), configuredRewardDoes)
        );

        if (resolvedWinner === "user" && configuredRewardDoes > 0 && wagerFundingCurrency === "htg") {
          const walletMutation = applyHtgRewardCredit(clientData, {
            rewardHtg: configuredRewardHtg,
            rewardEntryFunding: currentWager.gameEntryFunding || null,
          });
          rewardGranted = true;
          rewardAmountDoes = configuredRewardDoes;
          rewardAmountHtg = configuredRewardHtg;
          afterBalanceHtg = Math.max(0, safeInt(walletMutation.afterPlayableHtg));
          balancePatch = walletMutation.balancesPatch;
        }
      }

      const startedAtMsFromWager = safeSignedInt(currentWager.startedAtMs);
      const startedAtMsFromPayload = safeSignedInt(payload.startedAtMs);
      const startedAtMs = startedAtMsFromWager > 0
        ? startedAtMsFromWager
        : (startedAtMsFromPayload > 0 ? startedAtMsFromPayload : 0);
      const resultDocId = `${uid}_${matchId}`;

      tx.set(db.collection("ludoMatchResults").doc(resultDocId), {
        id: resultDocId,
        matchId,
        sessionId,
        uid,
        playerUids: [uid],
        status: "ended",
        roomMode: "ludo_local_bot",
        gameMode: "ludo_local_bot",
        winner: resolvedWinner,
        winnerType: resolvedWinner === "user" ? "human" : "bot",
        humanCount: 1,
        botCount: 1,
        botUsername: botUsername || sanitizeText(currentWager.botUsername || "", 64),
        botDifficulty: sanitizeText(currentWager.botDifficulty || payloadBotDifficulty || "", 32),
        stakeDoes: safeInt(currentWager.stakeDoes || payload.stakeDoes),
        stakeHtg: safeInt(currentWager.stakeHtg),
        fundingCurrency: normalizeFundingCurrency(currentWager.fundingCurrency || payload.fundingCurrency || "htg"),
        approvedWithdrawalPlayHtg: safeInt(currentWager?.gameEntryFunding?.approvedHtg),
        gameEntryFunding: currentWager?.gameEntryFunding && typeof currentWager.gameEntryFunding === "object"
          ? currentWager.gameEntryFunding
          : null,
        rewardExpectedDoes: safeInt(currentWager.rewardDoes),
        rewardExpectedHtg: safeInt(currentWager.rewardAmountHtg),
        rewardGranted,
        rewardAmountDoes,
        rewardAmountHtg,
        beforeBalanceHtg,
        afterBalanceHtg,
        scoreLabel: resolvedWinner === "user" ? "user_win" : "bot_win",
        startedAtMs,
        endedAtMs: nowMs,
        endedReason: resolvedSettleReason,
        archiveVersion: 1,
        archivedAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      tx.set(clientRef, {
        uid,
        email: email || clientData.email || "",
        ...balancePatch,
        ludoWagerState: canSettleWager
          ? {
              ...currentWager,
              sessionId,
              status: "settled",
              outcome: resolvedWinner,
              settleReason: resolvedSettleReason,
              settledAtMs: nowMs,
              lastEventAtMs: nowMs,
              matchId,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }
          : currentWager,
        ludoStats: {
          gamesPlayed,
          userWins,
          aiWins,
          recentOutcomes: nextRecentOutcomes,
          recentMatchIds: nextRecentMatchIds,
          lastMatchId: matchId,
          lastMatchWinner: resolvedWinner,
          lastBotUsername: botUsername || sanitizeText(currentWager.botUsername || "", 64),
          lastBotDifficulty: sanitizeText(currentWager.botDifficulty || payloadBotDifficulty || "", 32),
          lastPlayedAtMs: nowMs,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAtMs: nowMs,
      }, { merge: true });

      return {
        duplicate: false,
        gamesPlayed,
        userWins,
        aiWins,
        rewardGranted,
        rewardAmountDoes,
        rewardAmountHtg,
        winner: resolvedWinner,
      };
    });

    sendJson(req, res, 200, {
      ok: true,
      ...result,
      winner: String(result?.winner || requestedWinner),
      matchId,
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible d'enregistrer le resultat Ludo.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
