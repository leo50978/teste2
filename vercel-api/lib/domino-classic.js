const crypto = require("crypto");

const { admin, db } = require("./firebase-admin");
const { findStakeConfigByAmount, normalizeGameStakeOptions } = require("./payment-options");
const { makeHttpError } = require("./http");
const { safeInt, safeSignedInt, sanitizeText } = require("./safe");
const { RATE_HTG_TO_DOES, normalizeFundingCurrency } = require("./wallet-htg");

const BOOTSTRAP_DOC_ID = "dpayment_admin_bootstrap";
const DOMINO_CLASSIC_MATCH_RESULTS_COLLECTION = "dominoClassicMatchResults";
const DEFAULT_BOT_DIFFICULTY = "userpro";
const BOT_DIFFICULTY_LEVELS = new Set(["userpro", "ultra"]);
const BOT_PILOT_MODES = new Set(["manual", "auto"]);
const BOT_PILOT_WINDOW_MS = 24 * 60 * 60 * 1000;
const BOT_PILOT_SNAPSHOT_LIMIT = 5000;
const BOT_PILOT_TREND_POINT_LIMIT = 12;
const BOT_PILOT_EQUITY_POINT_LIMIT = 24;

const DOMINO_CLASSIC_RECENT_OUTCOMES_LIMIT = 10;
const DOMINO_CLASSIC_RECENT_MATCH_IDS_LIMIT = 20;
const DOMINO_CLASSIC_ALLOWED_STAKES = new Set([100, 500, 1000]);
const DOMINO_CLASSIC_ACTIVE_WAGER_STALE_MS = 30 * 60 * 1000;
const DOMINO_CLASSIC_DISCONNECT_FORFEIT_MS = 30 * 1000;

function safeFloat(value, fallback = 0) {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const f = Number(fallback);
  return Number.isFinite(f) ? f : 0;
}

function normalizeBotDifficulty(value = "") {
  const level = String(value || "").trim().toLowerCase();
  if (level === "ultra" || level === "expert") return "ultra";
  if (level === "userpro" || level === "amateur") return "userpro";
  return DEFAULT_BOT_DIFFICULTY;
}

function normalizeBotPilotMode(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return BOT_PILOT_MODES.has(normalized) ? normalized : "manual";
}

function normalizeBotPilotWindow(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "today" || normalized === "24h" || normalized === "7d" ? normalized : "today";
}

function getBotPilotDayKey(ms = Date.now()) {
  const date = new Date(ms);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getBotPilotRange(windowKey = "today", nowMs = Date.now()) {
  const normalized = normalizeBotPilotWindow(windowKey);
  if (normalized === "24h") {
    return { windowKey: normalized, startMs: nowMs - BOT_PILOT_WINDOW_MS, endMs: nowMs };
  }
  if (normalized === "7d") {
    return { windowKey: normalized, startMs: nowMs - (7 * BOT_PILOT_WINDOW_MS), endMs: nowMs };
  }
  const now = new Date(nowMs);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0).getTime();
  return { windowKey: normalized, startMs: start, endMs: nowMs };
}

function getBotPilotTrendKey(windowKey = "today", periodMs = Date.now()) {
  const date = new Date(periodMs);
  if (windowKey === "7d") {
    return getBotPilotDayKey(periodMs);
  }
  return `${getBotPilotDayKey(periodMs)}-${String(date.getHours()).padStart(2, "0")}`;
}

function getBotPilotTrendLabel(windowKey = "today", periodMs = Date.now()) {
  const date = new Date(periodMs);
  if (windowKey === "7d") {
    return date.toLocaleDateString("fr-FR", { month: "short", day: "numeric" });
  }
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

function chooseAutoBotDifficulty(snapshot = {}) {
  const netDoes = safeSignedInt(snapshot.netDoes);
  const collectedDoes = safeInt(snapshot.collectedDoes);
  const marginPct = collectedDoes > 0 ? (netDoes / collectedDoes) : 0;
  const drawdownDoes = Math.max(0, safeInt(snapshot.drawdownDoes));
  const drawdownPct = Math.max(0, Number(snapshot.drawdownPct || 0));
  const highWaterMarkDoes = Math.max(0, safeInt(snapshot.highWaterMarkDoes));
  const isNearPeak = highWaterMarkDoes <= 0 || drawdownPct <= 0.02;

  if (collectedDoes <= 0) {
    return {
      level: DEFAULT_BOT_DIFFICULTY,
      band: "neutral",
      reason: "no_volume",
      marginPct: 0,
    };
  }
  if (drawdownPct >= 0.03 || drawdownDoes >= 120) {
    return { level: "ultra", band: "danger", reason: "drawdown_critical", marginPct, drawdownPct };
  }
  if (netDoes < 0 || marginPct < 0.14) {
    return { level: "ultra", band: "danger", reason: "margin_too_low", marginPct, drawdownPct };
  }
  if (drawdownPct > 0 || !isNearPeak) {
    return { level: "ultra", band: "defense", reason: "drawdown_high", marginPct, drawdownPct };
  }
  if (marginPct < 0.22) {
    return { level: "ultra", band: "defense", reason: "margin_low", marginPct, drawdownPct };
  }
  if (!isNearPeak || marginPct < 0.3) {
    return { level: "ultra", band: "equilibrium", reason: "recovery_guard", marginPct, drawdownPct };
  }
  return { level: "userpro", band: "comfort", reason: "new_high_comfort", marginPct, drawdownPct };
}

async function readAdminBootstrap() {
  const snap = await db.collection("settings").doc(BOOTSTRAP_DOC_ID).get();
  return snap.exists ? (snap.data() || {}) : {};
}

async function getConfiguredDominoClassicBotDifficulty() {
  try {
    const data = await readAdminBootstrap();
    const mode = normalizeBotPilotMode(data.dominoClassicBotPilotMode || data.botPilotMode || "manual");
    if (mode === "auto") {
      return normalizeBotDifficulty(
        data.autoDominoClassicBotDifficulty
        || data.dominoClassicBotDifficulty
        || data.autoBotDifficulty
        || data.botDifficulty
      );
    }
    return normalizeBotDifficulty(
      data.manualDominoClassicBotDifficulty
      || data.dominoClassicBotDifficulty
      || data.manualBotDifficulty
      || data.botDifficulty
    );
  } catch (_) {
    return DEFAULT_BOT_DIFFICULTY;
  }
}

async function computeDominoClassicBotPilotSnapshot(options = {}) {
  const nowMs = safeSignedInt(options.nowMs) || Date.now();
  const range = getBotPilotRange(options.window || "today", nowMs);
  const querySnap = await db.collection(DOMINO_CLASSIC_MATCH_RESULTS_COLLECTION)
    .where("endedAtMs", ">=", range.startMs)
    .orderBy("endedAtMs", "desc")
    .limit(BOT_PILOT_SNAPSHOT_LIMIT)
    .get();

  let roomsCount = 0;
  let collectedHtg = 0;
  let payoutHtg = 0;
  let netHtg = 0;
  let humanWins = 0;
  let botWins = 0;
  const trendMap = new Map();
  const difficultyMixMap = new Map(
    Array.from(BOT_DIFFICULTY_LEVELS).map((level) => [level, {
      level,
      rooms: 0,
      netHtg: 0,
      botWins: 0,
      humanWins: 0,
    }])
  );
  const stakeMixMap = new Map();
  const truncated = querySnap.size >= BOT_PILOT_SNAPSHOT_LIMIT;

  querySnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const endedAtMs = safeSignedInt(data.endedAtMs);
    if (endedAtMs < range.startMs || endedAtMs > range.endMs) return;
    if (String(data.status || "").trim().toLowerCase() !== "ended") return;
    if (String(data.roomMode || "").trim().toLowerCase() !== "domino_classic_local_bots") return;

    const stakeHtg = Math.max(0, safeInt(data.stakeHtg));
    if (stakeHtg <= 0) return;
    const rewardAmountHtg = Math.max(0, safeInt(data.rewardAmountHtg || data.rewardExpectedHtg));
    const winnerType = String(data.winnerType || data.winner || "").trim().toLowerCase() === "human" ? "human" : "bot";
    const rewardGranted = data.rewardGranted === true || (winnerType === "human" && rewardAmountHtg > 0);
    const roomCollectedHtg = stakeHtg;
    const roomPayoutHtg = rewardGranted ? rewardAmountHtg : 0;
    const roomNetHtg = safeSignedInt(roomCollectedHtg - roomPayoutHtg);
    const botDifficulty = normalizeBotDifficulty(data.botDifficulty || DEFAULT_BOT_DIFFICULTY);

    roomsCount += 1;
    collectedHtg += roomCollectedHtg;
    payoutHtg += roomPayoutHtg;
    netHtg += roomNetHtg;
    if (winnerType === "human") humanWins += 1;
    else botWins += 1;

    const trendKey = getBotPilotTrendKey(range.windowKey, endedAtMs);
    const existingTrend = trendMap.get(trendKey) || {
      key: trendKey,
      label: getBotPilotTrendLabel(range.windowKey, endedAtMs),
      periodMs: endedAtMs,
      rooms: 0,
      collectedHtg: 0,
      payoutHtg: 0,
      netHtg: 0,
    };
    existingTrend.rooms += 1;
    existingTrend.collectedHtg += roomCollectedHtg;
    existingTrend.payoutHtg += roomPayoutHtg;
    existingTrend.netHtg += roomNetHtg;
    if (endedAtMs > safeSignedInt(existingTrend.periodMs)) {
      existingTrend.periodMs = endedAtMs;
      existingTrend.label = getBotPilotTrendLabel(range.windowKey, endedAtMs);
    }
    trendMap.set(trendKey, existingTrend);

    const difficultyMix = difficultyMixMap.get(botDifficulty) || {
      level: botDifficulty,
      rooms: 0,
      netHtg: 0,
      botWins: 0,
      humanWins: 0,
    };
    difficultyMix.rooms += 1;
    difficultyMix.netHtg += roomNetHtg;
    if (winnerType === "human") difficultyMix.humanWins += 1;
    else difficultyMix.botWins += 1;
    difficultyMixMap.set(botDifficulty, difficultyMix);

    const stakeKey = String(stakeHtg);
    const existingStake = stakeMixMap.get(stakeKey) || {
      key: stakeKey,
      label: `${stakeHtg} HTG`,
      stakeHtg,
      rooms: 0,
      netHtg: 0,
    };
    existingStake.rooms += 1;
    existingStake.netHtg += roomNetHtg;
    stakeMixMap.set(stakeKey, existingStake);
  });

  const fullTrend = Array.from(trendMap.values())
    .sort((a, b) => safeSignedInt(a.periodMs) - safeSignedInt(b.periodMs))
    .map((item) => ({
      key: item.key,
      label: item.label,
      periodMs: safeSignedInt(item.periodMs),
      rooms: safeInt(item.rooms),
      collectedHtg: safeInt(item.collectedHtg),
      payoutHtg: safeInt(item.payoutHtg),
      netHtg: safeSignedInt(item.netHtg),
    }));

  let runningEquityHtg = 0;
  let highWaterMarkHtg = 0;
  let lastPeakAtMs = range.startMs;
  const fullEquityCurve = [{
    key: "baseline",
    label: "Debut",
    periodMs: range.startMs,
    deltaNetHtg: 0,
    equityHtg: 0,
    drawdownHtg: 0,
    drawdownPct: 0,
  }];
  fullTrend.forEach((item) => {
    runningEquityHtg += safeSignedInt(item.netHtg);
    if (runningEquityHtg >= highWaterMarkHtg) {
      highWaterMarkHtg = runningEquityHtg;
      lastPeakAtMs = safeSignedInt(item.periodMs) || lastPeakAtMs;
    }
    const pointDrawdownHtg = Math.max(0, highWaterMarkHtg - runningEquityHtg);
    const pointDrawdownPct = highWaterMarkHtg > 0 ? (pointDrawdownHtg / highWaterMarkHtg) : 0;
    fullEquityCurve.push({
      key: item.key,
      label: item.label,
      periodMs: safeSignedInt(item.periodMs),
      deltaNetHtg: safeSignedInt(item.netHtg),
      equityHtg: runningEquityHtg,
      drawdownHtg: pointDrawdownHtg,
      drawdownPct: pointDrawdownPct,
    });
  });

  const currentEquityHtg = runningEquityHtg;
  const drawdownHtg = Math.max(0, highWaterMarkHtg - currentEquityHtg);
  const drawdownPct = highWaterMarkHtg > 0 ? (drawdownHtg / highWaterMarkHtg) : 0;
  const recommended = chooseAutoBotDifficulty({
    netDoes: netHtg * RATE_HTG_TO_DOES,
    collectedDoes: collectedHtg * RATE_HTG_TO_DOES,
    highWaterMarkDoes: highWaterMarkHtg * RATE_HTG_TO_DOES,
    currentEquityDoes: currentEquityHtg * RATE_HTG_TO_DOES,
    drawdownDoes: drawdownHtg * RATE_HTG_TO_DOES,
    drawdownPct,
  });

  return {
    ok: true,
    window: range.windowKey,
    startMs: range.startMs,
    endMs: range.endMs,
    dayKey: getBotPilotDayKey(range.startMs),
    roomsCount,
    collectedHtg,
    payoutHtg,
    netHtg,
    marginPct: collectedHtg > 0 ? netHtg / collectedHtg : 0,
    currentEquityHtg,
    highWaterMarkHtg,
    drawdownHtg,
    drawdownPct,
    lastPeakAtMs,
    humanWins,
    botWins,
    botWinRatePct: roomsCount > 0 ? botWins / roomsCount : 0,
    humanWinRatePct: roomsCount > 0 ? humanWins / roomsCount : 0,
    truncated,
    fetchLimit: BOT_PILOT_SNAPSHOT_LIMIT,
    recommendedLevel: recommended.level,
    recommendedBand: recommended.band,
    recommendedReason: recommended.reason,
    trend: fullTrend.slice(-BOT_PILOT_TREND_POINT_LIMIT),
    equityCurve: fullEquityCurve.slice(-(BOT_PILOT_EQUITY_POINT_LIMIT + 1)),
    difficultyMix: Array.from(difficultyMixMap.values()).map((item) => ({
      level: normalizeBotDifficulty(item.level),
      rooms: safeInt(item.rooms),
      netHtg: safeSignedInt(item.netHtg),
      botWins: safeInt(item.botWins),
      humanWins: safeInt(item.humanWins),
    })),
    stakeMix: Array.from(stakeMixMap.values())
      .sort((left, right) => safeInt(left.stakeHtg) - safeInt(right.stakeHtg))
      .map((item) => ({
        key: item.key,
        label: item.label,
        stakeHtg: safeInt(item.stakeHtg),
        rooms: safeInt(item.rooms),
        netHtg: safeSignedInt(item.netHtg),
      })),
    computedAtMs: nowMs,
  };
}

async function setDominoClassicBotPilotControl(payload = {}) {
  const current = await readAdminBootstrap();
  const mode = normalizeBotPilotMode(payload.mode || current.dominoClassicBotPilotMode || current.botPilotMode || "manual");
  const windowKey = normalizeBotPilotWindow(payload.window || current.dominoClassicBotPilotWindow || current.botPilotWindow || "today");
  const manualBotDifficulty = normalizeBotDifficulty(
    payload.manualBotDifficulty
    || current.manualDominoClassicBotDifficulty
    || current.dominoClassicBotDifficulty
    || current.manualBotDifficulty
    || current.botDifficulty
  );

  let autoBotDifficulty = normalizeBotDifficulty(
    current.autoDominoClassicBotDifficulty
    || current.dominoClassicBotDifficulty
    || current.autoBotDifficulty
    || current.botDifficulty
  );
  let appliedBotDifficulty = manualBotDifficulty;
  let snapshot = null;
  const nowMs = Date.now();

  if (mode === "auto") {
    snapshot = await computeDominoClassicBotPilotSnapshot({ nowMs, window: windowKey });
    autoBotDifficulty = normalizeBotDifficulty(snapshot.recommendedLevel || autoBotDifficulty);
    appliedBotDifficulty = autoBotDifficulty;
  }

  await db.collection("settings").doc(BOOTSTRAP_DOC_ID).set({
    dominoClassicBotPilotMode: mode,
    dominoClassicBotPilotWindow: windowKey,
    manualDominoClassicBotDifficulty: manualBotDifficulty,
    autoDominoClassicBotDifficulty: autoBotDifficulty,
    dominoClassicBotDifficulty: appliedBotDifficulty,
    dominoClassicBotPilotLastComputedAtMs: nowMs,
    dominoClassicBotPilotUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    dominoClassicBotPilotMetricsSnapshot: snapshot ? {
      window: snapshot.window,
      startMs: snapshot.startMs,
      endMs: snapshot.endMs,
      roomsCount: safeInt(snapshot.roomsCount),
      collectedHtg: safeInt(snapshot.collectedHtg),
      payoutHtg: safeInt(snapshot.payoutHtg),
      netHtg: safeSignedInt(snapshot.netHtg),
      marginPct: safeFloat(snapshot.marginPct),
      currentEquityHtg: safeSignedInt(snapshot.currentEquityHtg),
      highWaterMarkHtg: safeInt(snapshot.highWaterMarkHtg),
      drawdownHtg: safeInt(snapshot.drawdownHtg),
      drawdownPct: safeFloat(snapshot.drawdownPct),
      botWinRatePct: safeFloat(snapshot.botWinRatePct),
      humanWinRatePct: safeFloat(snapshot.humanWinRatePct),
      recommendedLevel: snapshot.recommendedLevel,
      recommendedBand: snapshot.recommendedBand,
      recommendedReason: snapshot.recommendedReason,
      computedAtMs: safeSignedInt(snapshot.computedAtMs),
    } : admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    ok: true,
    mode,
    window: windowKey,
    manualBotDifficulty,
    autoBotDifficulty,
    appliedBotDifficulty,
    snapshot,
  };
}

async function getDominoClassicBotPilotSnapshot(payload = {}) {
  const settings = await readAdminBootstrap();
  const nowMs = Date.now();
  const mode = normalizeBotPilotMode(payload.mode || settings.dominoClassicBotPilotMode || settings.botPilotMode || "manual");
  const windowKey = normalizeBotPilotWindow(payload.window || settings.dominoClassicBotPilotWindow || settings.botPilotWindow || "today");
  const snapshot = await computeDominoClassicBotPilotSnapshot({ nowMs, window: windowKey });
  const appliedDifficulty = mode === "auto"
    ? normalizeBotDifficulty(
      snapshot.recommendedLevel
      || settings.autoDominoClassicBotDifficulty
      || settings.dominoClassicBotDifficulty
      || settings.autoBotDifficulty
      || settings.botDifficulty
    )
    : normalizeBotDifficulty(
      settings.manualDominoClassicBotDifficulty
      || settings.dominoClassicBotDifficulty
      || settings.manualBotDifficulty
      || settings.botDifficulty
    );

  return {
    ok: true,
    mode,
    window: windowKey,
    manualBotDifficulty: normalizeBotDifficulty(
      settings.manualDominoClassicBotDifficulty
      || settings.dominoClassicBotDifficulty
      || settings.manualBotDifficulty
      || settings.botDifficulty
    ),
    autoBotDifficulty: normalizeBotDifficulty(
      settings.autoDominoClassicBotDifficulty
      || settings.dominoClassicBotDifficulty
      || snapshot.recommendedLevel
      || settings.autoBotDifficulty
      || settings.botDifficulty
    ),
    appliedBotDifficulty: appliedDifficulty,
    snapshot,
  };
}

async function refreshDominoClassicBotPilotAutoNow() {
  const settings = await readAdminBootstrap();
  const mode = normalizeBotPilotMode(settings.dominoClassicBotPilotMode || settings.botPilotMode || "manual");
  if (mode !== "auto") return null;
  return setDominoClassicBotPilotControl({
    mode: "auto",
    window: settings.dominoClassicBotPilotWindow || settings.botPilotWindow || "today",
    manualBotDifficulty: settings.manualDominoClassicBotDifficulty || settings.dominoClassicBotDifficulty || settings.manualBotDifficulty || settings.botDifficulty,
  });
}

function resolveGameEntryFundingRequest(payload = {}, stakeDoes = 0, fallbackCurrency = "htg") {
  const safeStakeDoes = safeInt(stakeDoes);
  const fundingCurrency = normalizeFundingCurrency(
    payload?.fundingCurrency
    || payload?.currency
    || fallbackCurrency
  );

  if (fundingCurrency !== "htg") {
    return {
      fundingCurrency: "does",
      amountGourdes: 0,
    };
  }

  if (safeStakeDoes <= 0 || (safeStakeDoes % RATE_HTG_TO_DOES) !== 0) {
    throw makeHttpError(400, "invalid-stake-amount", "Cette mise HTG n'est pas disponible.");
  }

  const requiredAmountHtg = Math.floor(safeStakeDoes / RATE_HTG_TO_DOES);
  const requestedAmountHtg = safeInt(
    payload?.amountGourdes
    ?? payload?.amountHtg
    ?? payload?.stakeHtg
  );
  if (requestedAmountHtg > 0 && requestedAmountHtg !== requiredAmountHtg) {
    throw makeHttpError(400, "stake-amount-mismatch", "Le montant HTG choisi ne correspond pas a cette mise.");
  }

  return {
    fundingCurrency: "htg",
    amountGourdes: requiredAmountHtg,
  };
}

function buildStakeAmountHtg(stakeDoes = 0) {
  const safeStakeDoes = safeInt(stakeDoes);
  if (safeStakeDoes <= 0 || (safeStakeDoes % RATE_HTG_TO_DOES) !== 0) return 0;
  return Math.floor(safeStakeDoes / RATE_HTG_TO_DOES);
}

function buildRewardAmountHtg(stakeDoes = 0, rewardDoes = 0) {
  const safeStakeDoes = safeInt(stakeDoes);
  const safeRewardDoes = safeInt(rewardDoes);
  if (safeStakeDoes <= 0 || safeRewardDoes <= 0) return 0;
  const stakeHtg = buildStakeAmountHtg(safeStakeDoes);
  if (stakeHtg <= 0) return 0;
  return Math.max(0, Math.floor((stakeHtg * safeRewardDoes) / safeStakeDoes));
}

function buildDominoClassicSessionId(nowMs = Date.now()) {
  return `domino_classic_${Number(nowMs).toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function assertAllowedDominoClassicStake(stakeDoes, gameStakeOptions = []) {
  const safeStakeDoes = safeInt(stakeDoes);
  if (!DOMINO_CLASSIC_ALLOWED_STAKES.has(safeStakeDoes)) {
    throw makeHttpError(400, "domino-classic-stake-not-allowed", "Mise Domino classique non autorisee.", {
      stakeDoes: safeStakeDoes,
    });
  }

  const selectedStakeConfig = findStakeConfigByAmount(safeStakeDoes, gameStakeOptions, false)
    || findStakeConfigByAmount(safeStakeDoes, normalizeGameStakeOptions(), false);
  if (!selectedStakeConfig) {
    throw makeHttpError(400, "domino-classic-stake-not-allowed", "Mise Domino classique non autorisee.", {
      stakeDoes: safeStakeDoes,
    });
  }

  const rewardDoes = safeInt(selectedStakeConfig.rewardDoes);
  const stakeHtg = buildStakeAmountHtg(safeStakeDoes);
  const rewardHtg = buildRewardAmountHtg(safeStakeDoes, rewardDoes);
  if (stakeHtg <= 0 || rewardHtg <= 0) {
    throw makeHttpError(412, "domino-classic-invalid-amounts", "Configuration Domino classique invalide.", {
      stakeDoes: safeStakeDoes,
      rewardDoes,
      stakeHtg,
      rewardHtg,
    });
  }

  return {
    selectedStakeConfig,
    rewardDoes,
    stakeHtg,
    rewardHtg,
  };
}

function assertAllowedGameVariant(rawVariant = "") {
  const gameVariant = sanitizeText(rawVariant || "classic_local_bots", 40) || "classic_local_bots";
  if (gameVariant !== "classic_local_bots") {
    throw makeHttpError(400, "domino-classic-variant-not-allowed", "Variante Domino classique non autorisee.");
  }
  return gameVariant;
}

function readActiveWagerStatus(currentWager = {}, nowMs = Date.now()) {
  const wagerStatus = String(currentWager.status || "").trim().toLowerCase();
  const sessionId = sanitizeText(currentWager.sessionId || "", 120);
  const lastEventAtMs = Math.max(
    safeSignedInt(currentWager.lastEventAtMs, 0),
    safeSignedInt(currentWager.startedAtMs, 0)
  );
  const expired = lastEventAtMs > 0
    ? (nowMs - lastEventAtMs) >= DOMINO_CLASSIC_ACTIVE_WAGER_STALE_MS
    : false;

  return {
    wagerStatus,
    sessionId,
    lastEventAtMs,
    expired,
    isActive: wagerStatus === "active",
  };
}

module.exports = {
  DOMINO_CLASSIC_ACTIVE_WAGER_STALE_MS,
  DOMINO_CLASSIC_ALLOWED_STAKES,
  DOMINO_CLASSIC_DISCONNECT_FORFEIT_MS,
  DOMINO_CLASSIC_RECENT_MATCH_IDS_LIMIT,
  DOMINO_CLASSIC_RECENT_OUTCOMES_LIMIT,
  assertAllowedDominoClassicStake,
  assertAllowedGameVariant,
  buildDominoClassicSessionId,
  buildRewardAmountHtg,
  buildStakeAmountHtg,
  computeDominoClassicBotPilotSnapshot,
  getConfiguredDominoClassicBotDifficulty,
  getDominoClassicBotPilotSnapshot,
  normalizeBotDifficulty,
  readActiveWagerStatus,
  refreshDominoClassicBotPilotAutoNow,
  resolveGameEntryFundingRequest,
  setDominoClassicBotPilotControl,
};
