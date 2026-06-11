const { admin, db } = require("./firebase-admin");
const { safeInt, safeSignedInt } = require("./safe");

const BOOTSTRAP_DOC_ID = "dpayment_admin_bootstrap";
const CHESS_ROOM_RESULTS_COLLECTION = "chessRoomResults";
const DEFAULT_BOT_DIFFICULTY = "fo";
const BOT_DIFFICULTY_LEVELS = new Set(["fo", "weak"]);
const BOT_PILOT_MODES = new Set(["manual", "auto"]);
const BOT_PILOT_WINDOW_MS = 24 * 60 * 60 * 1000;
const BOT_PILOT_SNAPSHOT_LIMIT = 5000;
const BOT_PILOT_TREND_POINT_LIMIT = 12;
const BOT_PILOT_EQUITY_POINT_LIMIT = 24;

function safeFloat(value, fallback = 0) {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const f = Number(fallback);
  return Number.isFinite(f) ? f : 0;
}

function normalizeChessBotDifficulty(value = "") {
  const level = String(value || "").trim().toLowerCase();
  if (!level) return DEFAULT_BOT_DIFFICULTY;
  if (level === "fo" || level === "strong" || level === "expert" || level === "ultra") return "fo";
  if (level === "weak" || level === "easy" || level === "amateur" || level === "low") return "weak";
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

function normalizeWinnerType(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "human" || normalized === "user" || normalized === "player") return "human";
  if (normalized === "draw" || normalized === "nul") return "draw";
  if (normalized === "bot" || normalized === "ai" || normalized === "system") return "bot";
  return "bot";
}

function chooseAutoBotDifficulty(snapshot = {}) {
  const netHtg = safeSignedInt(snapshot.netHtg);
  const collectedHtg = safeInt(snapshot.collectedHtg);
  const marginPct = collectedHtg > 0 ? (netHtg / collectedHtg) : 0;
  const drawdownHtg = Math.max(0, safeInt(snapshot.drawdownHtg));
  const drawdownPct = Math.max(0, Number(snapshot.drawdownPct || 0));
  const highWaterMarkHtg = Math.max(0, safeInt(snapshot.highWaterMarkHtg));
  const isNearPeak = highWaterMarkHtg <= 0 || drawdownPct <= 0.02;

  if (collectedHtg <= 0) {
    return {
      level: DEFAULT_BOT_DIFFICULTY,
      band: "neutral",
      reason: "no_volume",
      marginPct: 0,
    };
  }
  if (drawdownPct >= 0.08 || drawdownHtg >= 200) {
    return { level: "fo", band: "danger", reason: "drawdown_critical", marginPct, drawdownPct };
  }
  if (netHtg < 0 || marginPct < 0.12) {
    return { level: "fo", band: "danger", reason: "margin_too_low", marginPct, drawdownPct };
  }
  if (drawdownPct >= 0.04) {
    return { level: "fo", band: "defense", reason: "drawdown_high", marginPct, drawdownPct };
  }
  if (marginPct < 0.2) {
    return { level: "fo", band: "defense", reason: "margin_low", marginPct, drawdownPct };
  }
  if (!isNearPeak || marginPct < 0.28) {
    return { level: "fo", band: "equilibrium", reason: "recovery_guard", marginPct, drawdownPct };
  }
  return { level: "weak", band: "comfort", reason: "new_high_comfort", marginPct, drawdownPct };
}

async function readAdminBootstrap() {
  const snap = await db.collection("settings").doc(BOOTSTRAP_DOC_ID).get();
  return snap.exists ? (snap.data() || {}) : {};
}

function isChessPublicBotResult(data = {}) {
  const roomMode = String(data.roomMode || "").trim().toLowerCase();
  const opponentType = String(data.opponentType || data.roomOpponentType || "").trim().toLowerCase();
  return roomMode === "chess_public_bot"
    || roomMode === "chess_public"
    || data.isBotMatch === true
    || safeInt(data.botCount) > 0
    || opponentType === "bot";
}

function readStakeHtg(data = {}) {
  return Math.max(
    0,
    safeInt(
      data.stakeHtg
      || data.entryCostHtg
      || data.entryHtg
      || data.wagerHtg
    )
  );
}

function readRewardHtg(data = {}) {
  return Math.max(
    0,
    safeInt(
      data.rewardAmountHtg
      || data.rewardExpectedHtg
      || data.payoutHtg
      || data.winRewardHtg
    )
  );
}

async function getConfiguredChessBotDifficulty() {
  try {
    const data = await readAdminBootstrap();
    const mode = normalizeBotPilotMode(data.chessBotPilotMode || "manual");
    if (mode === "auto") {
      return normalizeChessBotDifficulty(
        data.autoChessBotDifficulty
        || data.chessBotDifficulty
        || data.autoBotDifficulty
        || data.botDifficulty
      );
    }
    return normalizeChessBotDifficulty(
      data.manualChessBotDifficulty
      || data.chessBotDifficulty
      || data.manualBotDifficulty
      || data.botDifficulty
    );
  } catch (_) {
    return DEFAULT_BOT_DIFFICULTY;
  }
}

async function computeChessBotPilotSnapshot(options = {}) {
  const nowMs = safeSignedInt(options.nowMs) || Date.now();
  const range = getBotPilotRange(options.window || "today", nowMs);
  const querySnap = await db.collection(CHESS_ROOM_RESULTS_COLLECTION)
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
  let drawsCount = 0;
  const trendMap = new Map();
  const difficultyMixMap = new Map(
    Array.from(BOT_DIFFICULTY_LEVELS).map((level) => [level, {
      level,
      rooms: 0,
      netHtg: 0,
      botWins: 0,
      humanWins: 0,
      drawsCount: 0,
    }])
  );
  const stakeMixMap = new Map();
  const truncated = querySnap.size >= BOT_PILOT_SNAPSHOT_LIMIT;

  querySnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const endedAtMs = safeSignedInt(data.endedAtMs);
    if (endedAtMs < range.startMs || endedAtMs > range.endMs) return;
    if (String(data.status || "").trim().toLowerCase() !== "ended") return;
    if (!isChessPublicBotResult(data)) return;

    const stakeHtg = readStakeHtg(data);
    if (stakeHtg <= 0) return;

    const winnerType = normalizeWinnerType(data.winnerType || data.winner || data.resultType);
    const rewardAmountHtg = readRewardHtg(data);
    const rewardGranted = winnerType === "human" && (
      data.rewardGranted === true
      || rewardAmountHtg > 0
    );
    const roomCollectedHtg = stakeHtg;
    const roomPayoutHtg = rewardGranted ? rewardAmountHtg : 0;
    const roomNetHtg = safeSignedInt(roomCollectedHtg - roomPayoutHtg);
    const botDifficulty = normalizeChessBotDifficulty(data.botDifficulty || data.aiProfile || DEFAULT_BOT_DIFFICULTY);

    roomsCount += 1;
    collectedHtg += roomCollectedHtg;
    payoutHtg += roomPayoutHtg;
    netHtg += roomNetHtg;

    if (winnerType === "human") humanWins += 1;
    else if (winnerType === "draw") drawsCount += 1;
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
      botWins: 0,
      humanWins: 0,
      drawsCount: 0,
    };
    existingTrend.rooms += 1;
    existingTrend.collectedHtg += roomCollectedHtg;
    existingTrend.payoutHtg += roomPayoutHtg;
    existingTrend.netHtg += roomNetHtg;
    if (winnerType === "human") existingTrend.humanWins += 1;
    else if (winnerType === "draw") existingTrend.drawsCount += 1;
    else existingTrend.botWins += 1;
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
      drawsCount: 0,
    };
    difficultyMix.rooms += 1;
    difficultyMix.netHtg += roomNetHtg;
    if (winnerType === "human") difficultyMix.humanWins += 1;
    else if (winnerType === "draw") difficultyMix.drawsCount += 1;
    else difficultyMix.botWins += 1;
    difficultyMixMap.set(botDifficulty, difficultyMix);

    const stakeKey = String(stakeHtg);
    const existingStake = stakeMixMap.get(stakeKey) || {
      key: stakeKey,
      label: `${stakeHtg} HTG`,
      stakeHtg,
      rooms: 0,
      netHtg: 0,
      botWins: 0,
      humanWins: 0,
      drawsCount: 0,
    };
    existingStake.rooms += 1;
    existingStake.netHtg += roomNetHtg;
    if (winnerType === "human") existingStake.humanWins += 1;
    else if (winnerType === "draw") existingStake.drawsCount += 1;
    else existingStake.botWins += 1;
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
      botWins: safeInt(item.botWins),
      humanWins: safeInt(item.humanWins),
      drawsCount: safeInt(item.drawsCount),
    }));

  let runningEquityHtg = 0;
  let highWaterMarkHtg = 0;
  let highWaterMarkAtMs = 0;
  let drawdownHtg = 0;
  let drawdownPct = 0;
  let lastPeakAtMs = 0;
  const equityCurve = [];

  fullTrend.forEach((item) => {
    runningEquityHtg += safeSignedInt(item.netHtg);
    if (runningEquityHtg >= highWaterMarkHtg) {
      highWaterMarkHtg = runningEquityHtg;
      highWaterMarkAtMs = safeSignedInt(item.periodMs);
    }
    const currentDrawdownHtg = Math.max(0, highWaterMarkHtg - runningEquityHtg);
    const currentDrawdownPct = highWaterMarkHtg > 0 ? (currentDrawdownHtg / highWaterMarkHtg) : 0;
    if (currentDrawdownHtg >= drawdownHtg) {
      drawdownHtg = currentDrawdownHtg;
      drawdownPct = currentDrawdownPct;
      lastPeakAtMs = highWaterMarkAtMs;
    }
    equityCurve.push({
      key: item.key,
      label: item.label,
      periodMs: safeSignedInt(item.periodMs),
      equityHtg: runningEquityHtg,
    });
  });

  const recommendation = chooseAutoBotDifficulty({
    netHtg,
    collectedHtg,
    drawdownHtg,
    drawdownPct,
    highWaterMarkHtg,
  });
  const botWinRatePct = roomsCount > 0 ? (botWins / roomsCount) : 0;
  const humanWinRatePct = roomsCount > 0 ? (humanWins / roomsCount) : 0;
  const drawRatePct = roomsCount > 0 ? (drawsCount / roomsCount) : 0;
  const marginPct = collectedHtg > 0 ? (netHtg / collectedHtg) : 0;

  return {
    ok: true,
    game: "chess_public_bot_only",
    window: range.windowKey,
    startMs: range.startMs,
    endMs: range.endMs,
    roomsCount,
    collectedHtg,
    payoutHtg,
    netHtg,
    marginPct,
    botWins,
    humanWins,
    drawsCount,
    botWinRatePct,
    humanWinRatePct,
    drawRatePct,
    currentEquityHtg: runningEquityHtg,
    highWaterMarkHtg,
    highWaterMarkAtMs,
    drawdownHtg,
    drawdownPct,
    lastPeakAtMs,
    truncated,
    recommendedLevel: recommendation.level,
    recommendedBand: recommendation.band,
    recommendedReason: recommendation.reason,
    trend: fullTrend.slice(-BOT_PILOT_TREND_POINT_LIMIT),
    equityCurve: equityCurve.slice(-BOT_PILOT_EQUITY_POINT_LIMIT),
    difficultyMix: Array.from(difficultyMixMap.values()).map((item) => ({
      level: normalizeChessBotDifficulty(item.level),
      rooms: safeInt(item.rooms),
      netHtg: safeSignedInt(item.netHtg),
      botWins: safeInt(item.botWins),
      humanWins: safeInt(item.humanWins),
      drawsCount: safeInt(item.drawsCount),
    })),
    stakeMix: Array.from(stakeMixMap.values())
      .sort((left, right) => safeInt(left.stakeHtg) - safeInt(right.stakeHtg))
      .map((item) => ({
        key: item.key,
        label: item.label,
        stakeHtg: safeInt(item.stakeHtg),
        rooms: safeInt(item.rooms),
        netHtg: safeSignedInt(item.netHtg),
        botWins: safeInt(item.botWins),
        humanWins: safeInt(item.humanWins),
        drawsCount: safeInt(item.drawsCount),
      })),
    computedAtMs: nowMs,
  };
}

async function setChessBotPilotControl(payload = {}) {
  const current = await readAdminBootstrap();
  const mode = normalizeBotPilotMode(payload.mode || current.chessBotPilotMode || "manual");
  const windowKey = normalizeBotPilotWindow(payload.window || current.chessBotPilotWindow || "today");
  const manualBotDifficulty = normalizeChessBotDifficulty(
    payload.manualBotDifficulty
    || current.manualChessBotDifficulty
    || current.chessBotDifficulty
    || current.manualBotDifficulty
    || current.botDifficulty
  );

  let autoBotDifficulty = normalizeChessBotDifficulty(
    current.autoChessBotDifficulty
    || current.chessBotDifficulty
    || current.autoBotDifficulty
    || current.botDifficulty
  );
  let appliedBotDifficulty = manualBotDifficulty;
  let snapshot = null;
  const nowMs = Date.now();

  if (mode === "auto") {
    snapshot = await computeChessBotPilotSnapshot({ nowMs, window: windowKey });
    autoBotDifficulty = normalizeChessBotDifficulty(snapshot.recommendedLevel || autoBotDifficulty);
    appliedBotDifficulty = autoBotDifficulty;
  }

  await db.collection("settings").doc(BOOTSTRAP_DOC_ID).set({
    chessBotPilotMode: mode,
    chessBotPilotWindow: windowKey,
    manualChessBotDifficulty: manualBotDifficulty,
    autoChessBotDifficulty: autoBotDifficulty,
    chessBotDifficulty: appliedBotDifficulty,
    chessBotPilotLastComputedAtMs: nowMs,
    chessBotPilotUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    chessBotPilotMetricsSnapshot: snapshot ? {
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
      botWins: safeInt(snapshot.botWins),
      humanWins: safeInt(snapshot.humanWins),
      drawsCount: safeInt(snapshot.drawsCount),
      botWinRatePct: safeFloat(snapshot.botWinRatePct),
      humanWinRatePct: safeFloat(snapshot.humanWinRatePct),
      drawRatePct: safeFloat(snapshot.drawRatePct),
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

async function getChessBotPilotSnapshot(payload = {}) {
  const settings = await readAdminBootstrap();
  const nowMs = Date.now();
  const mode = normalizeBotPilotMode(payload.mode || settings.chessBotPilotMode || "manual");
  const windowKey = normalizeBotPilotWindow(payload.window || settings.chessBotPilotWindow || "today");
  const snapshot = await computeChessBotPilotSnapshot({ nowMs, window: windowKey });
  const appliedDifficulty = mode === "auto"
    ? normalizeChessBotDifficulty(
      snapshot.recommendedLevel
      || settings.autoChessBotDifficulty
      || settings.chessBotDifficulty
      || settings.autoBotDifficulty
      || settings.botDifficulty
    )
    : normalizeChessBotDifficulty(
      settings.manualChessBotDifficulty
      || settings.chessBotDifficulty
      || settings.manualBotDifficulty
      || settings.botDifficulty
    );

  return {
    ok: true,
    mode,
    window: windowKey,
    manualBotDifficulty: normalizeChessBotDifficulty(
      settings.manualChessBotDifficulty
      || settings.chessBotDifficulty
      || settings.manualBotDifficulty
      || settings.botDifficulty
    ),
    autoBotDifficulty: normalizeChessBotDifficulty(
      settings.autoChessBotDifficulty
      || settings.chessBotDifficulty
      || snapshot.recommendedLevel
      || settings.autoBotDifficulty
      || settings.botDifficulty
    ),
    appliedBotDifficulty: appliedDifficulty,
    snapshot,
  };
}

module.exports = {
  computeChessBotPilotSnapshot,
  getChessBotPilotSnapshot,
  getConfiguredChessBotDifficulty,
  normalizeChessBotDifficulty,
  setChessBotPilotControl,
};
