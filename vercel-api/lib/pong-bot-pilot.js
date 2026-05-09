const { admin, db } = require("./firebase-admin");
const { safeInt, safeSignedInt, sanitizeText } = require("./safe");

const BOOTSTRAP_DOC_ID = "dpayment_admin_bootstrap";
const PONG_MATCH_RESULTS_COLLECTION = "pongMatchResults";
const DEFAULT_BOT_DIFFICULTY = "expert";
const BOT_DIFFICULTY_LEVELS = new Set(["amateur", "expert", "ultra", "userpro"]);
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

function normalizeBotDifficulty(value = "") {
  const level = String(value || "").trim().toLowerCase();
  return BOT_DIFFICULTY_LEVELS.has(level) ? level : DEFAULT_BOT_DIFFICULTY;
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

function getBotPilotHourKey(ms = Date.now()) {
  const date = new Date(ms);
  return `${getBotPilotDayKey(ms)}-${String(date.getHours()).padStart(2, "0")}`;
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
  const startMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return { windowKey: "today", startMs, endMs: nowMs };
}

function getBotPilotTrendKey(windowKey = "today", ms = 0) {
  const normalized = normalizeBotPilotWindow(windowKey);
  return normalized === "7d" ? getBotPilotDayKey(ms) : getBotPilotHourKey(ms);
}

function getBotPilotTrendLabel(windowKey = "today", ms = 0) {
  if (!ms) return "-";
  const normalized = normalizeBotPilotWindow(windowKey);
  const date = new Date(ms);
  if (normalized === "7d") {
    return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${String(date.getHours()).padStart(2, "0")}h`;
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
  if (drawdownPct >= 0.18 || (drawdownDoes >= 400 && drawdownPct >= 0.12)) {
    return { level: "ultra", band: "danger", reason: "drawdown_critical", marginPct, drawdownPct };
  }
  if (netDoes < 0 || marginPct < 0.03) {
    return { level: "ultra", band: "danger", reason: "margin_too_low", marginPct, drawdownPct };
  }
  if (drawdownPct >= 0.08) {
    return { level: "expert", band: "defense", reason: "drawdown_high", marginPct, drawdownPct };
  }
  if (marginPct < 0.08) {
    return { level: "expert", band: "defense", reason: "margin_low", marginPct, drawdownPct };
  }
  if (!isNearPeak) {
    return { level: "amateur", band: "equilibrium", reason: "recovery_guard", marginPct, drawdownPct };
  }
  if (marginPct < 0.16) {
    return { level: "amateur", band: "equilibrium", reason: "margin_ok", marginPct, drawdownPct };
  }
  return { level: "userpro", band: "comfort", reason: "new_high_comfort", marginPct, drawdownPct };
}

async function readAdminBootstrap() {
  const snap = await db.collection("settings").doc(BOOTSTRAP_DOC_ID).get();
  return snap.exists ? (snap.data() || {}) : {};
}

async function computePongBotPilotSnapshot(options = {}) {
  const nowMs = safeSignedInt(options.nowMs) || Date.now();
  const range = getBotPilotRange(options.window || "today", nowMs);
  const querySnap = await db
    .collection(PONG_MATCH_RESULTS_COLLECTION)
    .where("endedAtMs", ">=", range.startMs)
    .where("endedAtMs", "<=", range.endMs)
    .orderBy("endedAtMs", "asc")
    .limit(BOT_PILOT_SNAPSHOT_LIMIT)
    .get();

  let roomsCount = 0;
  let collectedDoes = 0;
  let payoutDoes = 0;
  let netDoes = 0;
  let humanWins = 0;
  let botWins = 0;
  let currentEquityDoes = 0;
  let highWaterMarkDoes = 0;
  let drawdownDoes = 0;
  let lastPeakAtMs = 0;
  const trendMap = new Map();
  const fullTrend = [];
  const fullEquityCurve = [{ key: "start", label: "Start", periodMs: range.startMs, equityDoes: 0 }];
  const profileMixMap = new Map();
  const difficultyMixMap = new Map();
  const stakeMixMap = new Map();

  querySnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const endedAtMs = safeSignedInt(data.endedAtMs);
    const status = String(data.status || "").trim().toLowerCase();
    if (status !== "ended" || endedAtMs <= 0) return;

    roomsCount += 1;
    const stakeDoes = safeInt(data.stakeDoes || data.entryCostDoes);
    const rewardAmountDoes = safeInt(data.rewardAmountDoes);
    const rewardGranted = data.rewardGranted === true && rewardAmountDoes > 0;
    const winnerTypeRaw = String(data.winnerType || data.winner || "").trim().toLowerCase();
    const winnerType = winnerTypeRaw === "user" ? "human" : (winnerTypeRaw === "ai" ? "bot" : winnerTypeRaw);
    if (winnerType === "human") humanWins += 1;
    if (winnerType === "bot") botWins += 1;

    const roomCollected = stakeDoes;
    const roomPayout = rewardGranted ? rewardAmountDoes : 0;
    const roomNet = roomCollected - roomPayout;

    collectedDoes += roomCollected;
    payoutDoes += roomPayout;
    netDoes += roomNet;

    const aiProfile = sanitizeText(data.aiProfile || "", 24).toLowerCase() || "normal";
    const profileEntry = profileMixMap.get(aiProfile) || {
      aiProfile,
      rooms: 0,
      netDoes: 0,
      botWins: 0,
      humanWins: 0,
    };
    profileEntry.rooms += 1;
    profileEntry.netDoes += roomNet;
    if (winnerType === "bot") profileEntry.botWins += 1;
    if (winnerType === "human") profileEntry.humanWins += 1;
    profileMixMap.set(aiProfile, profileEntry);

    const inferredDifficulty = aiProfile === "ultra" ? "ultra" : "amateur";
    const diffEntry = difficultyMixMap.get(inferredDifficulty) || {
      level: inferredDifficulty,
      rooms: 0,
      netDoes: 0,
      botWins: 0,
      humanWins: 0,
    };
    diffEntry.rooms += 1;
    diffEntry.netDoes += roomNet;
    if (winnerType === "bot") diffEntry.botWins += 1;
    if (winnerType === "human") diffEntry.humanWins += 1;
    difficultyMixMap.set(inferredDifficulty, diffEntry);

    const stakeKey = String(stakeDoes || 0);
    const stakeEntry = stakeMixMap.get(stakeKey) || {
      stakeDoes,
      label: `${safeInt(stakeDoes)} Does`,
      rooms: 0,
      netDoes: 0,
      botWins: 0,
      humanWins: 0,
    };
    stakeEntry.rooms += 1;
    stakeEntry.netDoes += roomNet;
    if (winnerType === "bot") stakeEntry.botWins += 1;
    if (winnerType === "human") stakeEntry.humanWins += 1;
    stakeMixMap.set(stakeKey, stakeEntry);

    const trendKey = getBotPilotTrendKey(range.windowKey, endedAtMs);
    const trendItem = trendMap.get(trendKey) || {
      key: trendKey,
      label: getBotPilotTrendLabel(range.windowKey, endedAtMs),
      periodMs: endedAtMs,
      rooms: 0,
      collectedDoes: 0,
      payoutDoes: 0,
      netDoes: 0,
      botWins: 0,
      humanWins: 0,
    };
    trendItem.rooms += 1;
    trendItem.collectedDoes += roomCollected;
    trendItem.payoutDoes += roomPayout;
    trendItem.netDoes += roomNet;
    if (winnerType === "bot") trendItem.botWins += 1;
    if (winnerType === "human") trendItem.humanWins += 1;
    if (endedAtMs > safeSignedInt(trendItem.periodMs)) {
      trendItem.periodMs = endedAtMs;
      trendItem.label = getBotPilotTrendLabel(range.windowKey, endedAtMs);
    }
    trendMap.set(trendKey, trendItem);

    currentEquityDoes += roomNet;
    if (currentEquityDoes >= highWaterMarkDoes) {
      highWaterMarkDoes = currentEquityDoes;
      lastPeakAtMs = endedAtMs;
    }
    drawdownDoes = Math.max(0, highWaterMarkDoes - currentEquityDoes);
    fullEquityCurve.push({
      key: `${trendKey}_${roomsCount}`,
      label: getBotPilotTrendLabel(range.windowKey, endedAtMs),
      periodMs: endedAtMs,
      equityDoes: currentEquityDoes,
    });
  });

  trendMap.forEach((item) => {
    fullTrend.push({
      key: item.key,
      label: item.label,
      periodMs: safeSignedInt(item.periodMs),
      rooms: safeInt(item.rooms),
      collectedDoes: safeInt(item.collectedDoes),
      payoutDoes: safeInt(item.payoutDoes),
      netDoes: safeSignedInt(item.netDoes),
      botWins: safeInt(item.botWins),
      humanWins: safeInt(item.humanWins),
    });
  });
  fullTrend.sort((left, right) => safeSignedInt(left.periodMs) - safeSignedInt(right.periodMs));

  const recommended = chooseAutoBotDifficulty({
    netDoes,
    collectedDoes,
    highWaterMarkDoes,
    currentEquityDoes,
    drawdownDoes,
    drawdownPct: highWaterMarkDoes > 0 ? drawdownDoes / highWaterMarkDoes : 0,
  });

  return {
    ok: true,
    window: range.windowKey,
    startMs: range.startMs,
    endMs: range.endMs,
    dayKey: getBotPilotDayKey(range.startMs),
    roomsCount,
    collectedDoes,
    payoutDoes,
    netDoes,
    marginPct: collectedDoes > 0 ? netDoes / collectedDoes : 0,
    currentEquityDoes,
    highWaterMarkDoes,
    drawdownDoes,
    drawdownPct: highWaterMarkDoes > 0 ? drawdownDoes / highWaterMarkDoes : 0,
    lastPeakAtMs,
    botWins,
    humanWins,
    botWinRatePct: roomsCount > 0 ? botWins / roomsCount : 0,
    humanWinRatePct: roomsCount > 0 ? humanWins / roomsCount : 0,
    recommendedLevel: recommended.level,
    recommendedBand: recommended.band,
    recommendedReason: recommended.reason,
    trend: fullTrend.slice(-BOT_PILOT_TREND_POINT_LIMIT),
    equityCurve: fullEquityCurve.slice(-(BOT_PILOT_EQUITY_POINT_LIMIT + 1)),
    difficultyMix: Array.from(difficultyMixMap.values())
      .sort((left, right) => safeInt(right.rooms) - safeInt(left.rooms))
      .map((item) => ({
        level: normalizeBotDifficulty(item.level),
        rooms: safeInt(item.rooms),
        netDoes: safeSignedInt(item.netDoes),
        botWins: safeInt(item.botWins),
        humanWins: safeInt(item.humanWins),
      })),
    stakeMix: Array.from(stakeMixMap.values())
      .sort((left, right) => safeInt(left.stakeDoes) - safeInt(right.stakeDoes))
      .map((item) => ({
        stakeDoes: safeInt(item.stakeDoes),
        label: String(item.label || `${safeInt(item.stakeDoes)} Does`),
        rooms: safeInt(item.rooms),
        netDoes: safeSignedInt(item.netDoes),
        botWins: safeInt(item.botWins),
        humanWins: safeInt(item.humanWins),
      })),
    profileMix: Array.from(profileMixMap.values())
      .sort((left, right) => safeInt(right.rooms) - safeInt(left.rooms))
      .map((item) => ({
        aiProfile: String(item.aiProfile || "normal"),
        rooms: safeInt(item.rooms),
        netDoes: safeSignedInt(item.netDoes),
        botWins: safeInt(item.botWins),
        humanWins: safeInt(item.humanWins),
      })),
  };
}

async function getPongBotPilotSnapshot(payload = {}) {
  const settings = await readAdminBootstrap();
  const nowMs = Date.now();
  const mode = normalizeBotPilotMode(payload.mode || settings.pongBotPilotMode || "manual");
  const windowKey = normalizeBotPilotWindow(payload.window || settings.pongBotPilotWindow || "today");
  const snapshot = await computePongBotPilotSnapshot({ nowMs, window: windowKey });
  const appliedBotDifficulty = mode === "auto"
    ? normalizeBotDifficulty(
      snapshot.recommendedLevel
      || settings.autoPongBotDifficulty
      || settings.pongBotDifficulty
      || settings.autoBotDifficulty
      || settings.botDifficulty
    )
    : normalizeBotDifficulty(
      settings.manualPongBotDifficulty
      || settings.pongBotDifficulty
      || settings.manualBotDifficulty
      || settings.botDifficulty
    );

  return {
    ok: true,
    mode,
    window: windowKey,
    manualBotDifficulty: normalizeBotDifficulty(
      settings.manualPongBotDifficulty
      || settings.pongBotDifficulty
      || settings.manualBotDifficulty
      || settings.botDifficulty
    ),
    autoBotDifficulty: normalizeBotDifficulty(
      settings.autoPongBotDifficulty
      || settings.pongBotDifficulty
      || snapshot.recommendedLevel
      || settings.autoBotDifficulty
      || settings.botDifficulty
    ),
    appliedBotDifficulty,
    snapshot,
  };
}

async function setPongBotPilotControl(payload = {}) {
  const current = await readAdminBootstrap();
  const mode = normalizeBotPilotMode(payload.mode || current.pongBotPilotMode || "manual");
  const windowKey = normalizeBotPilotWindow(payload.window || current.pongBotPilotWindow || "today");
  const manualBotDifficulty = normalizeBotDifficulty(
    payload.manualBotDifficulty
    || current.manualPongBotDifficulty
    || current.pongBotDifficulty
    || current.manualBotDifficulty
    || current.botDifficulty
  );

  let autoBotDifficulty = normalizeBotDifficulty(
    current.autoPongBotDifficulty
    || current.pongBotDifficulty
    || current.autoBotDifficulty
    || current.botDifficulty
  );
  let appliedBotDifficulty = manualBotDifficulty;
  let snapshot = null;
  const nowMs = Date.now();

  if (mode === "auto") {
    snapshot = await computePongBotPilotSnapshot({ nowMs, window: windowKey });
    autoBotDifficulty = normalizeBotDifficulty(snapshot.recommendedLevel || autoBotDifficulty);
    appliedBotDifficulty = autoBotDifficulty;
  }

  await db.collection("settings").doc(BOOTSTRAP_DOC_ID).set({
    pongBotPilotMode: mode,
    pongBotPilotWindow: windowKey,
    manualPongBotDifficulty: manualBotDifficulty,
    autoPongBotDifficulty: autoBotDifficulty,
    pongBotDifficulty: appliedBotDifficulty,
    pongBotPilotLastComputedAtMs: nowMs,
    pongBotPilotUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    pongBotPilotMetricsSnapshot: snapshot ? {
      window: snapshot.window,
      startMs: snapshot.startMs,
      endMs: snapshot.endMs,
      roomsCount: safeInt(snapshot.roomsCount),
      collectedDoes: safeInt(snapshot.collectedDoes),
      payoutDoes: safeInt(snapshot.payoutDoes),
      netDoes: safeSignedInt(snapshot.netDoes),
      marginPct: safeFloat(snapshot.marginPct),
      currentEquityDoes: safeSignedInt(snapshot.currentEquityDoes),
      highWaterMarkDoes: safeSignedInt(snapshot.highWaterMarkDoes),
      drawdownDoes: safeInt(snapshot.drawdownDoes),
      drawdownPct: safeFloat(snapshot.drawdownPct),
      lastPeakAtMs: safeSignedInt(snapshot.lastPeakAtMs),
      botWins: safeInt(snapshot.botWins),
      humanWins: safeInt(snapshot.humanWins),
      botWinRatePct: safeFloat(snapshot.botWinRatePct),
      humanWinRatePct: safeFloat(snapshot.humanWinRatePct),
      recommendedLevel: normalizeBotDifficulty(snapshot.recommendedLevel),
      recommendedBand: String(snapshot.recommendedBand || ""),
      recommendedReason: String(snapshot.recommendedReason || ""),
      computedAtMs: nowMs,
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

module.exports = {
  computePongBotPilotSnapshot,
  getPongBotPilotSnapshot,
  setPongBotPilotControl,
};
