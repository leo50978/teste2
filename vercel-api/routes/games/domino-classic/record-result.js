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
  DOMINO_CLASSIC_DISCONNECT_FORFEIT_MS,
  DOMINO_CLASSIC_RECENT_MATCH_IDS_LIMIT,
  DOMINO_CLASSIC_RECENT_OUTCOMES_LIMIT,
  buildRewardAmountHtg,
  normalizeBotDifficulty,
  refreshDominoClassicBotPilotAutoNow,
} = require("../../../lib/domino-classic");
const { clamp, safeSignedInt, safeInt, sanitizeText } = require("../../../lib/safe");
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
  "sync_retry",
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
    const motif = sanitizeText(payload.motif || "", 80);
    const winnerSeat = clamp(safeSignedInt(payload.winnerSeat, -1), -1, 3);
    const winnerRaw = String(payload.winner || "").trim().toLowerCase();
    const requestedWinner = winnerRaw === "user" || winnerRaw === "ai" ? winnerRaw : "ai";
    const nowMs = Date.now();
    const clientRef = db.collection("clients").doc(uid);

    const result = await db.runTransaction(async (tx) => {
      const clientSnap = await tx.get(clientRef);
      const clientData = clientSnap.exists ? (clientSnap.data() || {}) : {};
      const currentStats = clientData.dominoClassicStats && typeof clientData.dominoClassicStats === "object"
        ? clientData.dominoClassicStats
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
        ...existingMatchIds.slice(-(DOMINO_CLASSIC_RECENT_MATCH_IDS_LIMIT - 1)),
        matchId,
      ];

      const currentWager = clientData.dominoClassicWagerState && typeof clientData.dominoClassicWagerState === "object"
        ? clientData.dominoClassicWagerState
        : {};
      const wagerStatus = String(currentWager.status || "").trim().toLowerCase();
      const wagerSessionId = sanitizeText(currentWager.sessionId || "", 120);
      const canSettleWager = sessionId && wagerStatus === "active" && wagerSessionId === sessionId;
      const wagerLastEventAtMs = Math.max(
        safeSignedInt(currentWager.lastEventAtMs, 0),
        safeSignedInt(currentWager.startedAtMs, 0)
      );
      const botDifficulty = normalizeBotDifficulty(
        currentWager.botDifficulty
        || payload.botDifficulty
        || "expert"
      );
      const disconnectedTooLong = canSettleWager
        && wagerLastEventAtMs > 0
        && (nowMs - wagerLastEventAtMs) >= DOMINO_CLASSIC_DISCONNECT_FORFEIT_MS;
      const forcedLoss = FORCED_LOSS_REASONS.has(settleReason) || motif === "quit";
      const resolvedWinner = (disconnectedTooLong || forcedLoss) ? "ai" : requestedWinner;
      const resolvedSettleReason = disconnectedTooLong ? "disconnect_forfeit" : (settleReason || "match_end");
      const nextRecentOutcomes = [
        ...currentRecentOutcomes.slice(-(DOMINO_CLASSIC_RECENT_OUTCOMES_LIMIT - 1)),
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
      let beforeBalanceHtg = entryBeforeBalanceHtg >= 0 ? entryBeforeBalanceHtg : fallbackCurrentBalanceHtg;
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
      const winnerUid = resolvedWinner === "user" ? uid : "";
      const resultDocId = `${uid}_${matchId}`;

      tx.set(db.collection("dominoClassicMatchResults").doc(resultDocId), {
        id: resultDocId,
        matchId,
        sessionId,
        uid,
        playerUids: [uid],
        status: "ended",
        roomMode: "domino_classic_local_bots",
        gameMode: "classic_local_bots",
        winner: resolvedWinner,
        winnerUid,
        winnerSeat,
        winnerType: resolvedWinner === "user" ? "human" : "bot",
        humanCount: 1,
        botCount: 3,
        botDifficulty,
        motif,
        scoreLabel: motif || (winnerSeat >= 0 ? `seat_${winnerSeat}` : ""),
        stakeDoes: safeInt(currentWager.stakeDoes || payload.stakeDoes),
        stakeHtg: safeInt(currentWager.stakeHtg),
        fundingCurrency: normalizeFundingCurrency(currentWager.fundingCurrency || payload.fundingCurrency || "htg"),
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
        dominoClassicWagerState: canSettleWager
          ? {
              ...currentWager,
              sessionId,
              status: "settled",
              outcome: resolvedWinner,
              settleReason: resolvedSettleReason,
              settledAtMs: nowMs,
              lastEventAtMs: nowMs,
              matchId,
              lastWinnerSeat: winnerSeat,
              lastMotif: motif,
              updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            }
          : currentWager,
        dominoClassicStats: {
          gamesPlayed,
          userWins,
          aiWins,
          recentOutcomes: nextRecentOutcomes,
          recentMatchIds: nextRecentMatchIds,
          lastGameVariant: sanitizeText(currentWager.gameVariant || payload.gameVariant || "classic_local_bots", 40),
          lastMatchId: matchId,
          lastMatchWinner: resolvedWinner,
          lastWinnerSeat: winnerSeat,
          lastMotif: motif,
          lastBotDifficulty: botDifficulty,
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

    await refreshDominoClassicBotPilotAutoNow().catch((error) => {
      console.warn("[VERCEL_DOMINO_CLASSIC_BOT_PILOT] auto refresh failed", String(error?.message || error || ""));
    });

    sendJson(req, res, 200, {
      ok: true,
      ...result,
      winner: String(result?.winner || requestedWinner),
      matchId,
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible d'enregistrer le resultat Domino classique.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
