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
  PONG_ALLOWED_AI_PROFILES,
  PONG_DISCONNECT_FORFEIT_MS,
  PONG_RECENT_MATCH_IDS_LIMIT,
  PONG_RECENT_OUTCOMES_LIMIT,
} = require("../../../lib/pong");
const { clamp, safeSignedInt, safeInt, sanitizeText } = require("../../../lib/safe");
const {
  applyHtgRewardCredit,
  normalizeFundingCurrency,
  readApprovedHtg,
  readProvisionalHtg,
} = require("../../../lib/wallet-htg");

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
    const aiProfileRaw = sanitizeText(payload.aiProfile || "", 24).toLowerCase();
    const aiProfile = PONG_ALLOWED_AI_PROFILES.has(aiProfileRaw) ? aiProfileRaw : "normal";
    const leftScore = Math.min(99, safeInt(payload.leftScore));
    const rightScore = Math.min(99, safeInt(payload.rightScore));
    const winnerRaw = String(payload.winner || "").trim().toLowerCase();
    const winnerFromScore = leftScore === rightScore ? "" : (leftScore > rightScore ? "user" : "ai");
    const winner = winnerFromScore || (winnerRaw === "user" || winnerRaw === "ai" ? winnerRaw : "ai");
    const nowMs = Date.now();
    const clientRef = db.collection("clients").doc(uid);

    const result = await db.runTransaction(async (tx) => {
      const clientSnap = await tx.get(clientRef);
      const clientData = clientSnap.exists ? (clientSnap.data() || {}) : {};
      const currentStats = clientData.pongStats && typeof clientData.pongStats === "object"
        ? clientData.pongStats
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
          winner,
        };
      }

      const currentRecentOutcomes = Array.isArray(currentStats.recentOutcomes)
        ? currentStats.recentOutcomes.map((item) => String(item || "")).filter((item) => item === "W" || item === "L")
        : [];
      const nextRecentOutcomes = [
        ...currentRecentOutcomes.slice(-(PONG_RECENT_OUTCOMES_LIMIT - 1)),
        winner === "user" ? "W" : "L",
      ];
      const nextRecentMatchIds = [
        ...existingMatchIds.slice(-(PONG_RECENT_MATCH_IDS_LIMIT - 1)),
        matchId,
      ];

      const currentWager = clientData.pongWagerState && typeof clientData.pongWagerState === "object"
        ? clientData.pongWagerState
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
        && (nowMs - wagerLastEventAtMs) >= PONG_DISCONNECT_FORFEIT_MS;
      const resolvedWinner = disconnectedTooLong ? "ai" : winner;
      const resolvedSettleReason = disconnectedTooLong ? "disconnect_forfeit" : (settleReason || "match_end");
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

      const resultDocId = `${uid}_${matchId}`;
      const startedAtMsFromWager = safeSignedInt(currentWager.startedAtMs);
      const startedAtMsFromPayload = safeSignedInt(payload.startedAtMs);
      const startedAtMs = startedAtMsFromWager > 0
        ? startedAtMsFromWager
        : (startedAtMsFromPayload > 0 ? startedAtMsFromPayload : 0);

      tx.set(db.collection("pongMatchResults").doc(resultDocId), {
        id: resultDocId,
        matchId,
        sessionId,
        uid,
        status: "ended",
        roomMode: "pong_solo",
        winner: resolvedWinner,
        winnerType: resolvedWinner === "user" ? "human" : "bot",
        humanCount: 1,
        botCount: 1,
        aiProfile,
        leftScore,
        rightScore,
        scoreLabel: `${leftScore}-${rightScore}`,
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
        pongWagerState: canSettleWager
          ? {
              ...currentWager,
              sessionId,
              status: "settled",
              outcome: resolvedWinner,
              settleReason: resolvedSettleReason,
              settledAtMs: nowMs,
              lastEventAtMs: nowMs,
              matchId,
              lastScore: `${leftScore}-${rightScore}`,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }
          : currentWager,
        pongStats: {
          gamesPlayed,
          userWins,
          aiWins,
          recentOutcomes: nextRecentOutcomes,
          recentMatchIds: nextRecentMatchIds,
          lastAiProfile: aiProfile,
          lastMatchId: matchId,
          lastMatchWinner: resolvedWinner,
          lastScore: `${leftScore}-${rightScore}`,
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
      winner: String(result?.winner || winner),
      aiProfile,
      matchId,
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible d'enregistrer le resultat Pong.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
