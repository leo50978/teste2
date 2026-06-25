const { admin, db } = require("./firebase-admin");
const {
  buildRewardAmountHtg,
  buildStakeAmountHtg,
  resolveGameEntryFundingRequest,
} = require("./domino-classic");
const { makeHttpError } = require("./http");
const {
  LUDO_ALLOWED_STAKES,
  LUDO_DISCONNECT_FORFEIT_MS,
  LUDO_RECENT_MATCH_IDS_LIMIT,
  LUDO_RECENT_OUTCOMES_LIMIT,
  buildLudoRewardDoes,
  buildLudoSessionId,
  getConfiguredLudoBotDifficulty,
  readActiveLudoWagerStatus,
} = require("./ludo");
const { safeInt, safeSignedInt, sanitizeText } = require("./safe");
const {
  applyHtgRewardCredit,
  applyHtgStakeDebit,
  normalizeFundingCurrency,
  readApprovedHtg,
  readProvisionalHtg,
} = require("./wallet-htg");

const APP_PUBLIC_SETTINGS_DOC = "public_app_settings";
const DPAYMENT_ADMIN_BOOTSTRAP_DOC = "dpayment_admin_bootstrap";
const FORCED_LOSS_REASONS = new Set([
  "quit",
  "offline",
  "heartbeat_failed",
  "pagehide",
  "beforeunload",
  "session_resume_forfeit",
  "auto_forfeit_active_session",
]);

async function readLudoEnabledFlag() {
  const directSnap = await db.collection("settings").doc(APP_PUBLIC_SETTINGS_DOC).get();
  if (directSnap.exists) {
    return (directSnap.data() || {}).ludoEnabled !== false;
  }

  const fallbackSnap = await db.collection("settings").get();
  if (fallbackSnap.empty) return true;

  const legacy = fallbackSnap.docs.find((docSnap) => {
    return ![DPAYMENT_ADMIN_BOOTSTRAP_DOC, APP_PUBLIC_SETTINGS_DOC].includes(docSnap.id);
  });
  return legacy ? (legacy.data() || {}).ludoEnabled !== false : true;
}

async function startLudoWager({ uid, email, payload = {} }) {
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
  const ludoEnabled = await readLudoEnabledFlag();
  if (!ludoEnabled) {
    throw makeHttpError(403, "ludo-disabled", "Ludo pa disponib pou kounye a.");
  }

  const clientRef = db.collection("clients").doc(uid);
  return db.runTransaction(async (tx) => {
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
}

async function touchLudoWagerHeartbeat({ uid, payload = {} }) {
  const sessionId = sanitizeText(payload.sessionId || "", 120);
  if (!sessionId) {
    throw makeHttpError(400, "missing-session-id", "sessionId requis.");
  }

  const nowMs = Date.now();
  const clientRef = db.collection("clients").doc(uid);
  return db.runTransaction(async (tx) => {
    const clientSnap = await tx.get(clientRef);
    const clientData = clientSnap.exists ? (clientSnap.data() || {}) : {};
    const currentWager = clientData.ludoWagerState && typeof clientData.ludoWagerState === "object"
      ? clientData.ludoWagerState
      : {};
    const activeWager = readActiveLudoWagerStatus(currentWager, nowMs);
    const isActiveSession = activeWager.wagerStatus === "active" && activeWager.sessionId === sessionId;

    if (!isActiveSession) {
      return {
        ok: true,
        active: false,
        status: activeWager.wagerStatus || "none",
      };
    }

    tx.set(clientRef, {
      uid,
      ludoWagerState: {
        ...currentWager,
        lastEventAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAtMs: nowMs,
    }, { merge: true });

    return {
      ok: true,
      active: true,
      status: "active",
      sessionId,
      lastEventAtMs: nowMs,
    };
  });
}

async function recordLudoMatchResult({ uid, email, payload = {} }) {
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

  return {
    ok: true,
    ...result,
    winner: String(result?.winner || requestedWinner),
    matchId,
  };
}

module.exports = {
  recordLudoMatchResult,
  startLudoWager,
  touchLudoWagerHeartbeat,
};
