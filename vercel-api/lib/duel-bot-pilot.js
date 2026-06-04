const { admin, db } = require("./firebase-admin");
const { safeInt, safeSignedInt } = require("./safe");

const BOOTSTRAP_DOC_ID = "dpayment_admin_bootstrap";
const DUEL_ROOM_RESULTS_COLLECTION = "duelRoomResults";
const DEFAULT_BOT_DIFFICULTY = "dominov1";
const BOT_DIFFICULTY_LEVELS = new Set(["userpro", "dominov1"]);
const BOT_PILOT_MODES = new Set(["manual", "auto"]);
const BOT_PILOT_WINDOW_MS = 24 * 60 * 60 * 1000;
const BOT_PILOT_SNAPSHOT_LIMIT = 5000;
const BOT_PILOT_TREND_POINT_LIMIT = 12;
const BOT_PILOT_EQUITY_POINT_LIMIT = 24;
const DEFAULT_DUEL_BOT_WAIT_SECONDS = 7;
const MIN_DUEL_BOT_WAIT_SECONDS = 3;
const MAX_DUEL_BOT_WAIT_SECONDS = 15;

function safeFloat(value, fallback = 0) {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const f = Number(fallback);
  return Number.isFinite(f) ? f : 0;
}

function normalizeDuelBotDifficulty(value = "") {
  const level = String(value || "").trim().toLowerCase();
  if (level === "dominov1" || level === "v1") return "dominov1";
  if (level === "ultra" || level === "expert") return "dominov1";
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

function normalizeDuelBotWaitSeconds(value, fallback = DEFAULT_DUEL_BOT_WAIT_SECONDS) {
  const candidate = safeInt(value, safeInt(fallback, DEFAULT_DUEL_BOT_WAIT_SECONDS));
  return Math.max(MIN_DUEL_BOT_WAIT_SECONDS, Math.min(MAX_DUEL_BOT_WAIT_SECONDS, candidate || DEFAULT_DUEL_BOT_WAIT_SECONDS));
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
  if (drawdownPct >= 0.03 || drawdownHtg >= 120) {
    return { level: "dominov1", band: "danger", reason: "drawdown_critical", marginPct, drawdownPct };
  }
  if (netHtg < 0 || marginPct < 0.14) {
    return { level: "dominov1", band: "danger", reason: "margin_too_low", marginPct, drawdownPct };
  }
  if (drawdownPct > 0 || !isNearPeak) {
    return { level: "dominov1", band: "defense", reason: "drawdown_high", marginPct, drawdownPct };
  }
  if (marginPct < 0.22) {
    return { level: "dominov1", band: "defense", reason: "margin_low", marginPct, drawdownPct };
  }
  if (!isNearPeak || marginPct < 0.3) {
    return { level: "dominov1", band: "equilibrium", reason: "recovery_guard", marginPct, drawdownPct };
  }
  return { level: "userpro", band: "comfort", reason: "new_high_comfort", marginPct, drawdownPct };
}

async function readAdminBootstrap() {
  const snap = await db.collection("settings").doc(BOOTSTRAP_DOC_ID).get();
  return snap.exists ? (snap.data() || {}) : {};
}

async function getConfiguredDuelBotDifficulty() {
  try {
    const data = await readAdminBootstrap();
    const mode = normalizeBotPilotMode(data.duelBotPilotMode || data.botPilotMode || "manual");
    if (mode === "auto") {
      return normalizeDuelBotDifficulty(
        data.autoDuelBotDifficulty
        || data.duelBotDifficulty
        || data.autoBotDifficulty
        || data.botDifficulty
      );
    }
    return normalizeDuelBotDifficulty(
      data.manualDuelBotDifficulty
      || data.duelBotDifficulty
      || data.manualBotDifficulty
      || data.botDifficulty
    );
  } catch (_) {
    return DEFAULT_BOT_DIFFICULTY;
  }
}

async function getConfiguredDuelBotWaitMs() {
  try {
    const data = await readAdminBootstrap();
    const waitSeconds = normalizeDuelBotWaitSeconds(
      data.duelBotWaitSeconds
      || data.publicDuelBotWaitSeconds
      || data.botWaitSeconds
      || DEFAULT_DUEL_BOT_WAIT_SECONDS
    );
    return waitSeconds * 1000;
  } catch (_) {
    return DEFAULT_DUEL_BOT_WAIT_SECONDS * 1000;
  }
}

async function computeDuelBotPilotSnapshot(options = {}) {
  const nowMs = safeSignedInt(options.nowMs) || Date.now();
  const range = getBotPilotRange(options.window || "today", nowMs);
  const querySnap = await db.collection(DUEL_ROOM_RESULTS_COLLECTION)
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
    if (String(data.roomMode || "").trim().toLowerCase() !== "duel_v2_public") return;
    if (safeInt(data.botCount) <= 0) return;

    const stakeHtg = Math.max(0, safeInt(data.stakeHtg));
    if (stakeHtg <= 0) return;
    const rewardAmountHtg = Math.max(0, safeInt(data.rewardAmountHtg || data.rewardExpectedHtg));
    const winnerType = String(data.winnerType || data.winner || "").trim().toLowerCase() === "human" ? "human" : "bot";
    const rewardGranted = data.rewardGranted === true || (winnerType === "human" && rewardAmountHtg > 0);
    const roomCollectedHtg = stakeHtg;
    const roomPayoutHtg = rewardGranted ? rewardAmountHtg : 0;
    const roomNetHtg = safeSignedInt(roomCollectedHtg - roomPayoutHtg);
    const botDifficulty = normalizeDuelBotDifficulty(data.botDifficulty || DEFAULT_BOT_DIFFICULTY);

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
  const marginPct = collectedHtg > 0 ? (netHtg / collectedHtg) : 0;

  return {
    ok: true,
    game: "duel_v2_public_bot_only",
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
    botWinRatePct,
    humanWinRatePct,
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
      level: normalizeDuelBotDifficulty(item.level),
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

async function setDuelBotPilotControl(payload = {}) {
  const current = await readAdminBootstrap();
  const mode = normalizeBotPilotMode(payload.mode || current.duelBotPilotMode || current.botPilotMode || "manual");
  const windowKey = normalizeBotPilotWindow(payload.window || current.duelBotPilotWindow || current.botPilotWindow || "today");
  const waitSeconds = normalizeDuelBotWaitSeconds(
    payload.waitSeconds
    || current.duelBotWaitSeconds
    || current.publicDuelBotWaitSeconds
    || current.botWaitSeconds
    || DEFAULT_DUEL_BOT_WAIT_SECONDS
  );
  const manualBotDifficulty = normalizeDuelBotDifficulty(
    payload.manualBotDifficulty
    || current.manualDuelBotDifficulty
    || current.duelBotDifficulty
    || current.manualBotDifficulty
    || current.botDifficulty
  );

  let autoBotDifficulty = normalizeDuelBotDifficulty(
    current.autoDuelBotDifficulty
    || current.duelBotDifficulty
    || current.autoBotDifficulty
    || current.botDifficulty
  );
  let appliedBotDifficulty = manualBotDifficulty;
  let snapshot = null;
  const nowMs = Date.now();

  if (mode === "auto") {
    snapshot = await computeDuelBotPilotSnapshot({ nowMs, window: windowKey });
    autoBotDifficulty = normalizeDuelBotDifficulty(snapshot.recommendedLevel || autoBotDifficulty);
    appliedBotDifficulty = autoBotDifficulty;
  }

  await db.collection("settings").doc(BOOTSTRAP_DOC_ID).set({
    duelBotPilotMode: mode,
    duelBotPilotWindow: windowKey,
    duelBotWaitSeconds: waitSeconds,
    manualDuelBotDifficulty: manualBotDifficulty,
    autoDuelBotDifficulty: autoBotDifficulty,
    duelBotDifficulty: appliedBotDifficulty,
    duelBotPilotLastComputedAtMs: nowMs,
    duelBotPilotUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    duelBotPilotMetricsSnapshot: snapshot ? {
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
    waitSeconds,
    manualBotDifficulty,
    autoBotDifficulty,
    appliedBotDifficulty,
    snapshot,
  };
}

async function getDuelBotPilotSnapshot(payload = {}) {
  const settings = await readAdminBootstrap();
  const nowMs = Date.now();
  const mode = normalizeBotPilotMode(payload.mode || settings.duelBotPilotMode || settings.botPilotMode || "manual");
  const windowKey = normalizeBotPilotWindow(payload.window || settings.duelBotPilotWindow || settings.botPilotWindow || "today");
  const waitSeconds = normalizeDuelBotWaitSeconds(
    payload.waitSeconds
    || settings.duelBotWaitSeconds
    || settings.publicDuelBotWaitSeconds
    || settings.botWaitSeconds
    || DEFAULT_DUEL_BOT_WAIT_SECONDS
  );
  const snapshot = await computeDuelBotPilotSnapshot({ nowMs, window: windowKey });
  const appliedDifficulty = mode === "auto"
    ? normalizeDuelBotDifficulty(
      snapshot.recommendedLevel
      || settings.autoDuelBotDifficulty
      || settings.duelBotDifficulty
      || settings.autoBotDifficulty
      || settings.botDifficulty
    )
    : normalizeDuelBotDifficulty(
      settings.manualDuelBotDifficulty
      || settings.duelBotDifficulty
      || settings.manualBotDifficulty
      || settings.botDifficulty
    );

  return {
    ok: true,
    mode,
    window: windowKey,
    waitSeconds,
    manualBotDifficulty: normalizeDuelBotDifficulty(
      settings.manualDuelBotDifficulty
      || settings.duelBotDifficulty
      || settings.manualBotDifficulty
      || settings.botDifficulty
    ),
    autoBotDifficulty: normalizeDuelBotDifficulty(
      settings.autoDuelBotDifficulty
      || settings.duelBotDifficulty
      || snapshot.recommendedLevel
      || settings.autoBotDifficulty
      || settings.botDifficulty
    ),
    appliedBotDifficulty: appliedDifficulty,
    snapshot,
  };
}

module.exports = {
  computeDuelBotPilotSnapshot,
  getConfiguredDuelBotDifficulty,
  getConfiguredDuelBotWaitMs,
  getDuelBotPilotSnapshot,
  normalizeDuelBotDifficulty,
  normalizeDuelBotWaitSeconds,
  setDuelBotPilotControl,
};
