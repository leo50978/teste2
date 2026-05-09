const { db } = require("./firebase-admin");
const { buildAgentDepositContextOrder } = require("./agent-deposits");
const { buildRewardAmountHtg, buildStakeAmountHtg } = require("./domino-classic");
const {
  computeOrderAmount,
  getOrderResolutionStatus,
  getPendingOrderAmountForSettlement,
  summarizePendingOrders,
} = require("./deposits");
const { safeInt, safeSignedInt, sanitizeText } = require("./safe");
const {
  RATE_HTG_TO_DOES,
  normalizeFundingCurrency,
  readApprovedHtg,
  readProvisionalHtg,
  readWithdrawableHtg,
} = require("./wallet-htg");

const ROOM_RESULTS_COLLECTION = "roomResults";
const DUEL_ROOM_RESULTS_COLLECTION = "duelRoomResults";
const DUEL_V2_ROOMS_COLLECTION = "duelRoomsV2";
const MORPION_ROOM_RESULTS_COLLECTION = "morpionRoomResults";
const DAME_ROOM_RESULTS_COLLECTION = "dameRoomResults";
const DOMINO_CLASSIC_MATCH_RESULTS_COLLECTION = "dominoClassicMatchResults";
const PONG_MATCH_RESULTS_COLLECTION = "pongMatchResults";

function normalizeDashboardGameFilter(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["duel", "morpion", "dame", "pong", "domino"].includes(normalized)) {
    return normalized;
  }
  return "all";
}

function normalizeDashboardOpponentFilter(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "bot" || normalized === "human") return normalized;
  return "all";
}

function inferGameKeyFromHistoryDoc(sourceKey = "", data = {}) {
  const source = String(sourceKey || "").trim().toLowerCase();
  if (source === "duelroomresults") return "duel";
  if (source === "duelroomsv2") return "duel";
  if (source === "morpionroomresults") return "morpion";
  if (source === "dameroomresults") return "dame";
  if (source === "pongmatchresults") return "pong";
  if (source === "dominoclassicmatchresults") return "domino";
  if (source === "roomresults") {
    const roomMode = String(data.roomMode || data.gameMode || data.mode || "").trim().toLowerCase();
    if (roomMode.includes("duel")) return "duel";
    if (roomMode.includes("morpion")) return "morpion";
    if (roomMode.includes("dame")) return "dame";
    if (roomMode.includes("pong")) return "pong";
    return "domino";
  }
  return "domino";
}

function getGameLabelFromKey(gameKey = "") {
  const normalized = String(gameKey || "").trim().toLowerCase();
  if (normalized === "duel") return "Duel";
  if (normalized === "morpion") return "Morpion";
  if (normalized === "dame") return "Dame";
  if (normalized === "pong") return "Pong";
  if (normalized === "domino") return "Domino";
  return "Jeu";
}

function recordMatchesClientHistory(data = {}, clientId = "") {
  const uid = String(clientId || "").trim();
  if (!uid) return false;
  const visibleToUid = String(data.visibleToUid || "").trim();
  if (visibleToUid && visibleToUid !== uid) return false;
  const playerUids = Array.isArray(data.playerUids)
    ? data.playerUids.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const blockedRejoinUids = Array.isArray(data.blockedRejoinUids)
    ? data.blockedRejoinUids.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  if (playerUids.includes(uid)) return true;
  if (blockedRejoinUids.includes(uid)) return true;
  if (String(data.uid || "").trim() === uid) return true;
  if (String(data.clientId || "").trim() === uid) return true;
  if (String(data.playerUid || "").trim() === uid) return true;
  if (String(data.winnerUid || "").trim() === uid) return true;
  return false;
}

function inferClientHistoryOpponentType(gameKey = "", data = {}) {
  const normalizedGameKey = String(gameKey || "").trim().toLowerCase();
  if (normalizedGameKey === "pong") return "bot";
  const botCount = safeInt(data.botCount);
  if (botCount > 0) return "bot";
  const roomMode = String(data.roomMode || data.gameMode || data.mode || "").trim().toLowerCase();
  if (roomMode.includes("bot") || roomMode.includes("ai")) return "bot";
  return "human";
}

function resolveOptionalSignedInt(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.trunc(numeric) : null;
}

function buildClientHistoryRecord(sourceKey = "", docSnap, clientId = "") {
  const data = docSnap?.data && typeof docSnap.data === "function" ? (docSnap.data() || {}) : {};
  if (!recordMatchesClientHistory(data, clientId)) return null;

  const gameKey = inferGameKeyFromHistoryDoc(sourceKey, data);
  const participantUid = String(data.uid || data.clientId || data.playerUid || "").trim();
  const winnerUid = String(data.winnerUid || "").trim();
  const winnerType = String(data.winnerType || "").trim().toLowerCase();
  const clientUid = String(clientId || "").trim();
  const playerUids = Array.isArray(data.playerUids)
    ? data.playerUids.map((item) => String(item || "").trim()).filter(Boolean)
    : (participantUid ? [participantUid] : []);
  const endedAtMs = safeSignedInt(data.endedAtMs || data.endedAt || data.createdAtMs);
  const startedAtMs = safeSignedInt(data.startedAtMs);
  const endedReason = String(data.endedReason || "").trim().toLowerCase();
  const isRefundResult = endedReason === "timeout_refund" || endedReason === "quit_refund_before_opening";
  const isDrawResult = !isRefundResult && endedReason.startsWith("draw");
  const isNeutralResult = isRefundResult || isDrawResult;
  const won = isNeutralResult
    ? false
    : (winnerUid
      ? winnerUid === clientUid
      : (winnerType === "human" && (participantUid === clientUid || playerUids.includes(clientUid))));
  const lost = !won && !isNeutralResult && endedAtMs > 0;
  const fundingCurrency = normalizeFundingCurrency(data.fundingCurrency || data.entryFundingCurrency || "");
  const wageredDoes = safeInt(data.stakeDoes || data.entryCostDoes);
  const explicitStakeHtg = Number(data.stakeHtg);
  const wageredHtg = Number.isFinite(explicitStakeHtg)
    ? Math.max(0, Math.trunc(explicitStakeHtg))
    : Math.max(0, buildStakeAmountHtg(wageredDoes));
  const opponentType = inferClientHistoryOpponentType(gameKey, data);
  const rewardDoes = isNeutralResult
    ? 0
    : safeInt(data.rewardAmountDoes || data.rewardDoes || data.rewardExpectedDoes);
  const wonDoes = won ? Math.max(0, rewardDoes || wageredDoes) : 0;
  const explicitRewardHtg = Number(data.rewardAmountHtg ?? data.rewardExpectedHtg);
  const rewardAmountHtg = isNeutralResult
    ? 0
    : safeInt(data.rewardAmountHtg || data.rewardExpectedHtg);
  const wonHtg = won
    ? (Number.isFinite(explicitRewardHtg)
      ? Math.max(0, Math.trunc(explicitRewardHtg))
      : Math.max(0, buildRewardAmountHtg(wageredDoes, rewardDoes || wageredDoes)))
    : 0;
  const netDoes = isNeutralResult ? 0 : (wonDoes - wageredDoes);
  let netHtg = isNeutralResult ? 0 : (wonHtg - wageredHtg);
  if (netHtg === 0 && netDoes !== 0) {
    netHtg = Math.trunc(netDoes / RATE_HTG_TO_DOES);
  }

  const beforeBalanceHtgByUid = data.beforeBalanceHtgByUid && typeof data.beforeBalanceHtgByUid === "object"
    ? data.beforeBalanceHtgByUid
    : {};
  const afterBalanceHtgByUid = data.afterBalanceHtgByUid && typeof data.afterBalanceHtgByUid === "object"
    ? data.afterBalanceHtgByUid
    : {};
  const beforeBalanceHtg = resolveOptionalSignedInt(
    beforeBalanceHtgByUid[clientUid] != null
      ? beforeBalanceHtgByUid[clientUid]
      : data.beforeBalanceHtg
  );
  const afterBalanceHtg = resolveOptionalSignedInt(
    afterBalanceHtgByUid[clientUid] != null
      ? afterBalanceHtgByUid[clientUid]
      : data.afterBalanceHtg
  );

  return {
    id: String(docSnap?.id || "").trim(),
    sourceKey,
    gameKey,
    gameLabel: getGameLabelFromKey(gameKey),
    roomId: String(data.roomId || data.matchId || docSnap?.id || "").trim(),
    matchId: String(data.matchId || docSnap?.id || "").trim(),
    sessionId: String(data.sessionId || "").trim(),
    status: String(data.status || "ended").trim().toLowerCase(),
    endedAtMs,
    startedAtMs,
    createdAtMs: safeSignedInt(data.createdAtMs),
    winnerUid,
    winnerType,
    participantUid,
    playerUids,
    roomMode: String(data.roomMode || "").trim(),
    fundingCurrency,
    leftScore: safeInt(data.leftScore),
    rightScore: safeInt(data.rightScore),
    scoreLabel: String(
      data.scoreLabel
      || ((data.leftScore != null && data.rightScore != null)
        ? `${safeInt(data.leftScore)}-${safeInt(data.rightScore)}`
        : "")
    ).trim(),
    stakeDoes: wageredDoes,
    stakeHtg: wageredHtg,
    wageredDoes,
    wageredHtg,
    rewardAmountDoes: rewardDoes,
    rewardAmountHtg,
    rewardExpectedHtg: safeInt(data.rewardExpectedHtg),
    wonDoes,
    wonHtg,
    netDoes,
    netHtg,
    beforeBalanceHtg: Number.isFinite(beforeBalanceHtg) && beforeBalanceHtg >= 0 ? beforeBalanceHtg : null,
    afterBalanceHtg: Number.isFinite(afterBalanceHtg) && afterBalanceHtg >= 0 ? afterBalanceHtg : null,
    winnerSeat: safeSignedInt(data.winnerSeat),
    endedReason: String(data.endedReason || "").trim(),
    opponentType,
    opponentLabel: opponentType === "bot" ? "Bot" : "Humain",
    vsBot: opponentType === "bot",
    vsHuman: opponentType === "human",
    resultLabel: isRefundResult ? "Rembourse" : isDrawResult ? "Nul" : won ? "Gagne" : lost ? "Perdu" : "Termine",
    won,
    lost,
  };
}

function buildClientHistoryDedupKey(record = {}) {
  const gameKey = String(record.gameKey || "").trim().toLowerCase();
  if (gameKey !== "dame" && gameKey !== "duel") return "";
  const roomId = sanitizeText(record.roomId || record.matchId || "", 160);
  const endedAtMs = safeSignedInt(record.endedAtMs);
  const winnerUid = sanitizeText(record.winnerUid || "", 160);
  const winnerSeat = safeSignedInt(record.winnerSeat, -1);
  const endedReason = sanitizeText(record.endedReason || "", 80);
  if (!roomId || endedAtMs <= 0) return "";
  return `${gameKey}|${roomId}|${endedAtMs}|${winnerUid}|${winnerSeat}|${endedReason}`;
}

async function collectClientGameHistoryRows(clientId = "", {
  startMs = 0,
  endMs = 0,
  game = "all",
  opponent = "all",
  result = "all",
  minWonDoes = 0,
  maxWonDoes = 0,
} = {}) {
  const normalizedClientId = sanitizeText(clientId || "", 160);
  if (!normalizedClientId) return [];

  const gameFilter = normalizeDashboardGameFilter(game || "all");
  const opponentFilter = normalizeDashboardOpponentFilter(opponent || "all");
  const resultFilter = String(result || "all").trim().toLowerCase();
  const sourceDefs = [
    { key: "roomResults", collection: db.collection(ROOM_RESULTS_COLLECTION), gameKey: "domino" },
    { key: "duelRoomResults", collection: db.collection(DUEL_ROOM_RESULTS_COLLECTION), gameKey: "duel" },
    { key: "duelRoomsV2", collection: db.collection(DUEL_V2_ROOMS_COLLECTION), gameKey: "duel" },
    { key: "morpionRoomResults", collection: db.collection(MORPION_ROOM_RESULTS_COLLECTION), gameKey: "morpion" },
    { key: "dameRoomResults", collection: db.collection(DAME_ROOM_RESULTS_COLLECTION), gameKey: "dame" },
    { key: "dominoClassicMatchResults", collection: db.collection(DOMINO_CLASSIC_MATCH_RESULTS_COLLECTION), gameKey: "domino" },
    { key: "pongMatchResults", collection: db.collection(PONG_MATCH_RESULTS_COLLECTION), gameKey: "pong" },
  ];

  const activeSources = sourceDefs.filter((item) => gameFilter === "all" || item.gameKey === gameFilter);
  const snapshots = await Promise.all(activeSources.map(async (source) => {
    const useUidQuery = source.key === "pongMatchResults" || source.key === "dominoClassicMatchResults";
    const fallbackQuery = useUidQuery
      ? source.collection.where("uid", "==", normalizedClientId)
      : source.collection.where("playerUids", "array-contains", normalizedClientId);

    try {
      let query = useUidQuery
        ? source.collection.where("uid", "==", normalizedClientId).orderBy("endedAtMs", "desc")
        : source.collection.where("playerUids", "array-contains", normalizedClientId).orderBy("endedAtMs", "desc");
      if (startMs > 0) query = query.where("endedAtMs", ">=", startMs);
      if (endMs > 0) query = query.where("endedAtMs", "<=", endMs);
      return await query.get();
    } catch (_) {
      return fallbackQuery.get();
    }
  }));

  const rows = [];
  snapshots.forEach((snap, index) => {
    const source = activeSources[index];
    (snap?.docs || []).forEach((docSnap) => {
      const record = buildClientHistoryRecord(source.key, docSnap, normalizedClientId);
      if (!record) return;
      if (gameFilter !== "all" && record.gameKey !== gameFilter) return;
      if (opponentFilter !== "all" && record.opponentType !== opponentFilter) return;
      if (resultFilter === "win" && record.won !== true) return;
      if (resultFilter === "loss" && record.lost !== true) return;
      if (startMs > 0 && record.endedAtMs > 0 && record.endedAtMs < startMs) return;
      if (endMs > 0 && record.endedAtMs > 0 && record.endedAtMs > endMs) return;
      if (minWonDoes > 0 && record.wonDoes < minWonDoes) return;
      if (maxWonDoes > 0 && record.wonDoes > maxWonDoes) return;
      if (record.endedAtMs <= 0) return;
      rows.push(record);
    });
  });

  rows.sort((left, right) =>
    safeSignedInt(right.endedAtMs) - safeSignedInt(left.endedAtMs)
    || safeSignedInt(right.createdAtMs) - safeSignedInt(left.createdAtMs)
    || String(right.id || "").localeCompare(String(left.id || ""), "fr")
  );

  const dedupedRows = [];
  const seenDedupKeys = new Set();
  rows.forEach((row) => {
    const dedupKey = buildClientHistoryDedupKey(row);
    if (dedupKey) {
      if (seenDedupKeys.has(dedupKey)) return;
      seenDedupKeys.add(dedupKey);
    }
    dedupedRows.push(row);
  });

  return dedupedRows;
}

function summarizeClientFraudGameRows(rows = []) {
  const summary = {
    totalMatches: 0,
    totalWageredHtg: 0,
    totalWonHtg: 0,
    totalNetHtg: 0,
    wins: 0,
    losses: 0,
    vsBotMatches: 0,
    vsHumanMatches: 0,
  };

  const byGame = new Map();

  (Array.isArray(rows) ? rows : []).forEach((row) => {
    summary.totalMatches += 1;
    summary.totalWageredHtg += safeInt(row.wageredHtg || row.stakeHtg);
    summary.totalWonHtg += safeInt(row.wonHtg || row.rewardAmountHtg);
    summary.totalNetHtg += safeSignedInt(row.netHtg);
    if (row.won) summary.wins += 1;
    if (row.lost) summary.losses += 1;
    if (row.vsBot) summary.vsBotMatches += 1;
    if (row.vsHuman) summary.vsHumanMatches += 1;

    const key = String(row.gameKey || "other").trim().toLowerCase() || "other";
    const current = byGame.get(key) || {
      gameKey: key,
      gameLabel: row.gameLabel || getGameLabelFromKey(key),
      matches: 0,
      wins: 0,
      losses: 0,
      wageredHtg: 0,
      wonHtg: 0,
      netHtg: 0,
      vsBotMatches: 0,
      vsHumanMatches: 0,
      lastAtMs: 0,
    };
    current.matches += 1;
    current.wins += row.won ? 1 : 0;
    current.losses += row.lost ? 1 : 0;
    current.wageredHtg += safeInt(row.wageredHtg || row.stakeHtg);
    current.wonHtg += safeInt(row.wonHtg || row.rewardAmountHtg);
    current.netHtg += safeSignedInt(row.netHtg);
    current.vsBotMatches += row.vsBot ? 1 : 0;
    current.vsHumanMatches += row.vsHuman ? 1 : 0;
    current.lastAtMs = Math.max(current.lastAtMs, safeSignedInt(row.endedAtMs));
    byGame.set(key, current);
  });

  return {
    summary,
    byGame: Array.from(byGame.values()).sort((left, right) =>
      safeSignedInt(right.matches) - safeSignedInt(left.matches)
      || safeSignedInt(right.lastAtMs) - safeSignedInt(left.lastAtMs)
      || String(left.gameLabel || left.gameKey || "").localeCompare(String(right.gameLabel || right.gameKey || ""), "fr")
    ),
  };
}

function buildReviewOrderRow(docSnap) {
  const data = docSnap?.data && typeof docSnap.data === "function" ? (docSnap.data() || {}) : (docSnap || {});
  const status = getOrderResolutionStatus(data);
  return {
    ...buildAgentDepositContextOrder(docSnap),
    id: String(docSnap?.id || data.id || data.orderId || "").trim(),
    orderId: String(data.orderId || docSnap?.id || "").trim(),
    status,
    resolutionStatus: status,
    amountHtg: computeOrderAmount(data),
    approvedAmountHtg: safeInt(data.approvedAmountHtg),
    provisionalHtgRemaining: safeInt(data.provisionalHtgRemaining),
    provisionalDoesRemaining: safeInt(data.provisionalDoesRemaining),
    provisionalGainDoes: safeInt(data.provisionalGainDoes),
    uniqueCode: String(data.uniqueCode || "").trim(),
    reference: String(data.reference || data.proofRef || data.uniqueCode || "").trim(),
    proofRef: String(data.proofRef || "").trim(),
    createdAtMs: safeSignedInt(data.createdAtMs),
    updatedAtMs: safeSignedInt(data.updatedAtMs),
    approvedAtMs: safeSignedInt(data.approvedAtMs),
  };
}

function buildFraudFinding({
  title = "",
  detail = "",
  severity = "medium",
  occurredAtMs = 0,
  recommendedAction = "review",
}) {
  const weights = {
    low: 10,
    medium: 22,
    high: 38,
    critical: 55,
  };

  return {
    title: String(title || "").trim() || "Anomalie",
    detail: String(detail || "").trim() || "Verification requise.",
    severity,
    occurredAtMs: safeSignedInt(occurredAtMs),
    recommendedAction,
    severityScore: weights[severity] || 18,
  };
}

function buildWindowLabel(startMs = 0, endMs = 0) {
  if (startMs > 0 && endMs > 0) return "Periode filtree";
  if (startMs > 0) return "Depuis la date choisie";
  if (endMs > 0) return "Jusqu'a la date choisie";
  return "Toute la periode";
}

function buildTimelineEntries({ orders = [], withdrawals = [], gameRows = [] }, limit = 20) {
  const entries = [];

  (Array.isArray(orders) ? orders : []).forEach((order) => {
    entries.push({
      kind: "deposit_order",
      severity: ["rejected", "cancelled"].includes(String(order.status || "").toLowerCase()) ? "medium" : "neutral",
      atMs: safeSignedInt(order.createdAtMs),
      title: `Commande depot ${String(order.status || "pending").toUpperCase()}`,
      detail: `${safeInt(order.amountHtg)} HTG via ${String(order.methodName || order.methodId || "methode").trim() || "methode"}.`,
    });
  });

  (Array.isArray(withdrawals) ? withdrawals : []).forEach((row) => {
    const amountHtg = safeInt(row?.amountHtg ?? row?.requestedAmount ?? row?.amount);
    entries.push({
      kind: "withdrawal",
      severity: ["rejected", "failed"].includes(String(row?.status || "").toLowerCase()) ? "medium" : "neutral",
      atMs: safeSignedInt(row?.createdAtMs),
      title: `Retrait ${String(row?.status || "pending").toUpperCase()}`,
      detail: `${amountHtg} HTG.`,
    });
  });

  (Array.isArray(gameRows) ? gameRows : []).forEach((row) => {
    entries.push({
      kind: "game_result",
      severity: row?.won ? "good" : row?.lost ? "neutral" : "neutral",
      atMs: safeSignedInt(row?.endedAtMs),
      title: `${String(row?.gameLabel || "Jeu")} ${row?.won ? "gagne" : row?.lost ? "perdu" : "termine"}`,
      detail: `Mise ${safeInt(row?.stakeHtg)} HTG, net ${safeSignedInt(row?.netHtg)} HTG.`,
    });
  });

  return entries
    .filter((item) => item.atMs > 0)
    .sort((left, right) => safeSignedInt(right.atMs) - safeSignedInt(left.atMs))
    .slice(0, Math.max(1, safeInt(limit) || 20));
}

function buildClientFraudAnalysis({
  clientData = {},
  orders = [],
  withdrawals = [],
  gameRows = [],
  startMs = 0,
  endMs = 0,
  findingsLimit = 12,
  timelineLimit = 20,
} = {}) {
  const findings = [];
  const currentApprovedHtg = readApprovedHtg(clientData);
  const currentProvisionalHtg = readProvisionalHtg(clientData);
  const currentWithdrawableHtg = readWithdrawableHtg(clientData, currentApprovedHtg);
  const pendingOrders = summarizePendingOrders(orders);
  const approvedOrders = orders.filter((order) => getOrderResolutionStatus(order) === "approved");
  const rejectedOrders = orders.filter((order) => getOrderResolutionStatus(order) === "rejected");
  const approvedDepositsHtg = approvedOrders.reduce((sum, order) => sum + computeOrderAmount(order), 0);
  const expectedPendingHtg = pendingOrders.reduce((sum, order) => sum + getPendingOrderAmountForSettlement(order), 0);
  const summary = summarizeClientFraudGameRows(gameRows);
  const totalMatches = safeInt(summary.summary.totalMatches);
  const winRate = totalMatches > 0 ? summary.summary.wins / totalMatches : 0;
  const pendingOlderThan72h = pendingOrders.filter((order) => {
    const createdAtMs = safeSignedInt(order.createdAtMs);
    return createdAtMs > 0 && (Date.now() - createdAtMs) >= (72 * 60 * 60 * 1000);
  });
  const pendingWithdrawals = (Array.isArray(withdrawals) ? withdrawals : []).filter((row) => {
    const status = String(row?.status || row?.resolutionStatus || "").trim().toLowerCase();
    return status === "pending" || status === "review";
  });
  const pendingWithdrawalTotalHtg = pendingWithdrawals.reduce((sum, row) => {
    return sum + safeInt(row?.amountHtg ?? row?.requestedAmount ?? row?.amount);
  }, 0);

  if (clientData.accountFrozen === true) {
    findings.push(buildFraudFinding({
      title: "Compte gele",
      detail: "Le compte est deja gele, ce qui signale un historique a revoir.",
      severity: "high",
      occurredAtMs: safeSignedInt(clientData.updatedAtMs || clientData.freezeAtMs || Date.now()),
      recommendedAction: "manual_review",
    }));
  }

  if (clientData.withdrawalHold === true) {
    findings.push(buildFraudFinding({
      title: "Retraits bloques",
      detail: "Le compte a un blocage retrait actif.",
      severity: "medium",
      occurredAtMs: safeSignedInt(clientData.withdrawalHoldAtMs || clientData.updatedAtMs || Date.now()),
      recommendedAction: "manual_review",
    }));
  }

  if (currentProvisionalHtg > 0 && pendingOrders.length === 0) {
    findings.push(buildFraudFinding({
      title: "HTG pending sans commande active",
      detail: `Le wallet affiche ${currentProvisionalHtg} HTG pending, mais aucune commande depot pending/review n'a ete retrouvee.`,
      severity: "high",
      occurredAtMs: safeSignedInt(clientData.updatedAtMs || Date.now()),
      recommendedAction: "repair_wallet",
    }));
  }

  if (Math.abs(currentProvisionalHtg - expectedPendingHtg) >= 25) {
    findings.push(buildFraudFinding({
      title: "Ecart sur le solde pending",
      detail: `Le wallet affiche ${currentProvisionalHtg} HTG pending alors que les commandes actives totalisent ${expectedPendingHtg} HTG.`,
      severity: "medium",
      occurredAtMs: safeSignedInt(clientData.updatedAtMs || Date.now()),
      recommendedAction: "repair_wallet",
    }));
  }

  if (pendingOlderThan72h.length > 0) {
    findings.push(buildFraudFinding({
      title: "Commandes pending trop anciennes",
      detail: `${pendingOlderThan72h.length} commande(s) pending/review depassent 72 heures.`,
      severity: "medium",
      occurredAtMs: safeSignedInt(pendingOlderThan72h[0]?.createdAtMs || Date.now()),
      recommendedAction: "manual_review",
    }));
  }

  if (rejectedOrders.length >= 2) {
    findings.push(buildFraudFinding({
      title: "Plusieurs depots rejetes",
      detail: `${rejectedOrders.length} depot(s) rejetes ont ete trouves sur ce compte.`,
      severity: rejectedOrders.length >= 3 ? "high" : "medium",
      occurredAtMs: safeSignedInt(rejectedOrders[0]?.updatedAtMs || rejectedOrders[0]?.createdAtMs || Date.now()),
      recommendedAction: "manual_review",
    }));
  }

  if (pendingWithdrawalTotalHtg > currentWithdrawableHtg) {
    findings.push(buildFraudFinding({
      title: "Retraits en attente superieurs au retirable",
      detail: `Les retraits pending totalisent ${pendingWithdrawalTotalHtg} HTG alors que le wallet retirable affiche ${currentWithdrawableHtg} HTG.`,
      severity: "medium",
      occurredAtMs: Date.now(),
      recommendedAction: "manual_review",
    }));
  }

  if (totalMatches >= 10 && winRate >= 0.85 && summary.summary.vsHumanMatches >= 5) {
    findings.push(buildFraudFinding({
      title: "Taux de victoire inhabituellement eleve",
      detail: `Le joueur gagne ${Math.round(winRate * 100)}% de ses parties sur ${totalMatches} matchs analyses.`,
      severity: "medium",
      occurredAtMs: safeSignedInt(gameRows[0]?.endedAtMs || Date.now()),
      recommendedAction: "monitor",
    }));
  }

  if (summary.summary.vsBotMatches >= 10 && summary.summary.totalNetHtg >= 250) {
    findings.push(buildFraudFinding({
      title: "Gains concentres contre bot",
      detail: `Le compte cumule ${summary.summary.totalNetHtg} HTG nets sur ${summary.summary.vsBotMatches} partie(s) contre bot.`,
      severity: "low",
      occurredAtMs: safeSignedInt(gameRows[0]?.endedAtMs || Date.now()),
      recommendedAction: "monitor",
    }));
  }

  findings.sort((left, right) =>
    safeSignedInt(right.severityScore) - safeSignedInt(left.severityScore)
    || safeSignedInt(right.occurredAtMs) - safeSignedInt(left.occurredAtMs)
  );

  const score = Math.min(100, findings.reduce((sum, item) => sum + safeInt(item.severityScore), 0));
  const level = score >= 60 ? "critical" : score >= 35 ? "high" : score >= 15 ? "medium" : "low";
  const isSuspicious = score >= 35 || clientData.accountFrozen === true || clientData.withdrawalHold === true;
  const timeline = buildTimelineEntries({ orders, withdrawals, gameRows }, timelineLimit);

  return {
    ok: true,
    score,
    level,
    isSuspicious,
    windowLabel: buildWindowLabel(startMs, endMs),
    summary: isSuspicious
      ? "Des signaux exigent une verification manuelle."
      : "Aucune alerte majeure sur la fenetre analysee.",
    status: isSuspicious
      ? "Compte a revoir"
      : "Aucune alerte majeure.",
    findings: findings.slice(0, Math.max(1, safeInt(findingsLimit) || 12)),
    timeline,
    gameSummary: summary.summary,
    byGame: summary.byGame,
    walletSnapshot: {
      approvedHtgAvailable: currentApprovedHtg,
      provisionalHtgAvailable: currentProvisionalHtg,
      withdrawableHtg: currentWithdrawableHtg,
      approvedDepositsHtg,
      expectedPendingHtg,
    },
  };
}

module.exports = {
  buildClientFraudAnalysis,
  buildReviewOrderRow,
  collectClientGameHistoryRows,
  getGameLabelFromKey,
  normalizeDashboardGameFilter,
  normalizeDashboardOpponentFilter,
  summarizeClientFraudGameRows,
};
