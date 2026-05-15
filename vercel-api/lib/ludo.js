const crypto = require("crypto");

const { admin, db } = require("./firebase-admin");
const { safeInt, safeSignedInt, sanitizeText } = require("./safe");
const { doesToHtg } = require("./wallet-htg");

const BOOTSTRAP_DOC_ID = "dpayment_admin_bootstrap";
const LUDO_MATCH_RESULTS_COLLECTION = "ludoMatchResults";
const LUDO_ALLOWED_STAKES = new Set([500]);
const LUDO_ODDS_NUMERATOR = 19;
const LUDO_ODDS_DENOMINATOR = 10;
const LUDO_ACTIVE_WAGER_STALE_MS = 30 * 60 * 1000;
const LUDO_DISCONNECT_FORFEIT_MS = 30 * 1000;
const LUDO_RECENT_OUTCOMES_LIMIT = 10;
const LUDO_RECENT_MATCH_IDS_LIMIT = 20;
const DEFAULT_LUDO_BOT_DIFFICULTY = "weak";
const LUDO_BOT_DIFFICULTY_LEVELS = new Set(["weak", "strong"]);
const LUDO_BOT_PILOT_MODES = new Set(["manual", "auto"]);
const LUDO_BOT_PILOT_WINDOW_MS = 24 * 60 * 60 * 1000;
const LUDO_BOT_PILOT_SNAPSHOT_LIMIT = 5000;
const LUDO_BOT_PILOT_TREND_POINT_LIMIT = 12;
const LUDO_BOT_PILOT_EQUITY_POINT_LIMIT = 24;
const LUDO_BOT_PILOT_TIMEZONE = "America/Port-au-Prince";

const ludoBotPilotDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: LUDO_BOT_PILOT_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function safeFloat(value, fallback = 0) {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const f = Number(fallback);
  return Number.isFinite(f) ? f : 0;
}

function normalizeLudoBotDifficulty(value = "") {
  const level = String(value || "").trim().toLowerCase();
  if (level === "strong" || level === "fort" || level === "fo" || level === "impossible") return "strong";
  if (level === "ultra" || level === "expert" || level === "dominov1") return "strong";
  if (level === "weak" || level === "faible" || level === "feb") return "weak";
  if (level === "userpro" || level === "amateur") return "weak";
  return DEFAULT_LUDO_BOT_DIFFICULTY;
}

function normalizeLudoBotPilotMode(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return LUDO_BOT_PILOT_MODES.has(normalized) ? normalized : "manual";
}

function normalizeLudoBotPilotWindow(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "today" || normalized === "24h" || normalized === "7d" ? normalized : "today";
}

function getLudoBotPilotLocalParts(nowMs = Date.now()) {
  const parts = ludoBotPilotDateTimeFormatter.formatToParts(new Date(nowMs));
  const values = {};
  parts.forEach((part) => {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  });
  return {
    year: safeSignedInt(values.year),
    month: safeSignedInt(values.month),
    day: safeSignedInt(values.day),
    hour: String(values.hour || "00") === "24" ? 0 : safeSignedInt(values.hour),
    minute: safeSignedInt(values.minute),
    second: safeSignedInt(values.second),
  };
}

function getLudoBotPilotZonedTimestamp(parts = {}, hour = 0, minute = 0, second = 0, millisecond = 0) {
  const year = safeSignedInt(parts.year);
  const month = safeSignedInt(parts.month);
  const day = safeSignedInt(parts.day);
  if (year <= 0 || month <= 0 || day <= 0) return 0;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const observed = getLudoBotPilotLocalParts(utcGuess);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const observedAsUtc = Date.UTC(
    safeSignedInt(observed.year),
    Math.max(0, safeSignedInt(observed.month) - 1),
    safeSignedInt(observed.day),
    safeSignedInt(observed.hour),
    safeSignedInt(observed.minute),
    safeSignedInt(observed.second),
    millisecond
  );
  return utcGuess + (targetAsUtc - observedAsUtc);
}

function getLudoBotPilotShiftedDayParts(nowMs = Date.now(), deltaDays = 0) {
  const current = getLudoBotPilotLocalParts(nowMs);
  const shiftedUtc = Date.UTC(
    current.year,
    Math.max(0, current.month - 1),
    current.day + safeSignedInt(deltaDays),
    12,
    0,
    0,
    0
  );
  const shifted = new Date(shiftedUtc);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function getLudoBotPilotDayKey(ms = Date.now()) {
  const parts = getLudoBotPilotLocalParts(ms);
  const year = String(parts.year || 0);
  const month = String(parts.month || 0).padStart(2, "0");
  const day = String(parts.day || 0).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getLudoBotPilotHourKey(ms = Date.now()) {
  const parts = getLudoBotPilotLocalParts(ms);
  const hour = String(parts.hour || 0).padStart(2, "0");
  return `${getLudoBotPilotDayKey(ms)}-${hour}`;
}

function getLudoBotPilotRange(windowKey = "today", nowMs = Date.now()) {
  const normalized = normalizeLudoBotPilotWindow(windowKey);
  if (normalized === "24h") {
    return { windowKey: normalized, startMs: nowMs - LUDO_BOT_PILOT_WINDOW_MS, endMs: nowMs };
  }
  if (normalized === "7d") {
    return { windowKey: normalized, startMs: nowMs - (7 * LUDO_BOT_PILOT_WINDOW_MS), endMs: nowMs };
  }
  const todayParts = getLudoBotPilotShiftedDayParts(nowMs, 0);
  return {
    windowKey: "today",
    startMs: getLudoBotPilotZonedTimestamp(todayParts, 0, 0, 0, 0),
    endMs: nowMs,
  };
}

function getLudoBotPilotTrendKey(windowKey = "today", ms = 0) {
  return windowKey === "7d" ? getLudoBotPilotDayKey(ms) : getLudoBotPilotHourKey(ms);
}

function getLudoBotPilotTrendLabel(windowKey = "today", ms = 0) {
  if (!ms) return "-";
  const date = new Date(ms);
  if (windowKey === "7d") {
    return date.toLocaleDateString("fr-FR", {
      timeZone: LUDO_BOT_PILOT_TIMEZONE,
      day: "2-digit",
      month: "short",
    });
  }
  return date.toLocaleTimeString("fr-FR", {
    timeZone: LUDO_BOT_PILOT_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
  });
}

function readResultStakeHtg(result = {}) {
  const explicit = safeInt(result.stakeHtg);
  if (explicit > 0) return explicit;
  return Math.max(0, doesToHtg(safeInt(result.stakeDoes || result.entryCostDoes)));
}

function readResultRewardHtg(result = {}) {
  const explicit = safeInt(result.rewardAmountHtg || result.rewardExpectedHtg);
  if (explicit > 0) return explicit;
  return Math.max(0, doesToHtg(safeInt(result.rewardAmountDoes || result.rewardExpectedDoes)));
}

function chooseAutoLudoBotDifficulty(snapshot = {}) {
  const netHtg = safeSignedInt(snapshot.netHtg);
  const collectedHtg = safeInt(snapshot.collectedHtg);
  const marginPct = collectedHtg > 0 ? (netHtg / collectedHtg) : 0;
  const drawdownHtg = Math.max(0, safeInt(snapshot.drawdownHtg));
  const drawdownPct = Math.max(0, Number(snapshot.drawdownPct || 0));
  const highWaterMarkHtg = Math.max(0, safeInt(snapshot.highWaterMarkHtg));
  const isNearPeak = highWaterMarkHtg <= 0 || drawdownPct <= 0.02;

  if (collectedHtg <= 0) {
    return {
      level: DEFAULT_LUDO_BOT_DIFFICULTY,
      band: "neutral",
      reason: "no_volume",
      marginPct: 0,
      drawdownPct: 0,
    };
  }
  if (drawdownPct >= 0.08 || drawdownHtg >= 100) {
    return { level: "strong", band: "danger", reason: "drawdown_critical", marginPct, drawdownPct };
  }
  if (netHtg < 0 || marginPct < 0.1) {
    return { level: "strong", band: "danger", reason: "margin_too_low", marginPct, drawdownPct };
  }
  if (drawdownPct >= 0.03 || !isNearPeak) {
    return { level: "strong", band: "defense", reason: "drawdown_high", marginPct, drawdownPct };
  }
  if (marginPct < 0.18) {
    return { level: "strong", band: "defense", reason: "margin_low", marginPct, drawdownPct };
  }
  return { level: "weak", band: "comfort", reason: "new_high_comfort", marginPct, drawdownPct };
}

async function readAdminBootstrap() {
  const snap = await db.collection("settings").doc(BOOTSTRAP_DOC_ID).get();
  return snap.exists ? (snap.data() || {}) : {};
}

async function getConfiguredLudoBotDifficulty() {
  try {
    const data = await readAdminBootstrap();
    const mode = normalizeLudoBotPilotMode(data.ludoBotPilotMode || "manual");
    if (mode === "auto") {
      return normalizeLudoBotDifficulty(
        data.autoLudoBotDifficulty
        || data.ludoBotDifficulty
        || data.autoBotDifficulty
        || data.botDifficulty
      );
    }
    return normalizeLudoBotDifficulty(
      data.manualLudoBotDifficulty
      || data.ludoBotDifficulty
      || data.manualBotDifficulty
      || data.botDifficulty
    );
  } catch (_) {
    return DEFAULT_LUDO_BOT_DIFFICULTY;
  }
}

async function computeLudoBotPilotSnapshot(options = {}) {
  const nowMs = safeSignedInt(options.nowMs) || Date.now();
  const range = getLudoBotPilotRange(options.window || "today", nowMs);
  const querySnap = await db
    .collection(LUDO_MATCH_RESULTS_COLLECTION)
    .where("endedAtMs", ">=", range.startMs)
    .where("endedAtMs", "<=", range.endMs)
    .orderBy("endedAtMs", "asc")
    .limit(LUDO_BOT_PILOT_SNAPSHOT_LIMIT)
    .get();

  let roomsCount = 0;
  let collectedHtg = 0;
  let payoutHtg = 0;
  let netHtg = 0;
  let humanWins = 0;
  let botWins = 0;
  let currentEquityHtg = 0;
  let highWaterMarkHtg = 0;
  let lastPeakAtMs = 0;
  const trendMap = new Map();
  const fullTrend = [];
  const fullEquityCurve = [{ key: "start", label: "Debut", periodMs: range.startMs, equityHtg: 0 }];
  const difficultyMixMap = new Map(
    Array.from(LUDO_BOT_DIFFICULTY_LEVELS).map((level) => [level, {
      level,
      rooms: 0,
      netHtg: 0,
      botWins: 0,
      humanWins: 0,
    }])
  );
  const stakeMixMap = new Map();

  querySnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const endedAtMs = safeSignedInt(data.endedAtMs);
    const status = String(data.status || "").trim().toLowerCase();
    if (status !== "ended" || endedAtMs <= 0) return;

    const stakeHtg = readResultStakeHtg(data);
    if (stakeHtg <= 0) return;
    const winnerType = String(data.winnerType || data.winner || "").trim().toLowerCase() === "human" ? "human" : "bot";
    const settledRewardHtg = safeInt(data.rewardAmountHtg);
    const expectedRewardHtg = safeInt(data.rewardExpectedHtg);
    const rewardAmountHtg = Math.max(0, settledRewardHtg || expectedRewardHtg);
    const rewardGranted = data.rewardGranted === true || (winnerType === "human" && rewardAmountHtg > 0);
    const botDifficulty = normalizeLudoBotDifficulty(data.botDifficulty || DEFAULT_LUDO_BOT_DIFFICULTY);
    const roomCollectedHtg = stakeHtg;
    const roomPayoutHtg = rewardGranted ? rewardAmountHtg : 0;
    const roomNetHtg = roomCollectedHtg - roomPayoutHtg;

    roomsCount += 1;
    collectedHtg += roomCollectedHtg;
    payoutHtg += roomPayoutHtg;
    netHtg += roomNetHtg;
    if (winnerType === "human") humanWins += 1;
    if (winnerType === "bot") botWins += 1;

    const diffEntry = difficultyMixMap.get(botDifficulty) || {
      level: botDifficulty,
      rooms: 0,
      netHtg: 0,
      botWins: 0,
      humanWins: 0,
    };
    diffEntry.rooms += 1;
    diffEntry.netHtg += roomNetHtg;
    if (winnerType === "human") diffEntry.humanWins += 1;
    if (winnerType === "bot") diffEntry.botWins += 1;
    difficultyMixMap.set(botDifficulty, diffEntry);

    const stakeKey = String(stakeHtg);
    const stakeEntry = stakeMixMap.get(stakeKey) || {
      stakeHtg,
      labelHtg: `${stakeHtg} HTG`,
      rooms: 0,
      netHtg: 0,
      botWins: 0,
      humanWins: 0,
    };
    stakeEntry.rooms += 1;
    stakeEntry.netHtg += roomNetHtg;
    if (winnerType === "human") stakeEntry.humanWins += 1;
    if (winnerType === "bot") stakeEntry.botWins += 1;
    stakeMixMap.set(stakeKey, stakeEntry);

    const trendKey = getLudoBotPilotTrendKey(range.windowKey, endedAtMs);
    const trendItem = trendMap.get(trendKey) || {
      key: trendKey,
      label: getLudoBotPilotTrendLabel(range.windowKey, endedAtMs),
      periodMs: endedAtMs,
      rooms: 0,
      collectedHtg: 0,
      payoutHtg: 0,
      netHtg: 0,
      botWins: 0,
      humanWins: 0,
    };
    trendItem.rooms += 1;
    trendItem.collectedHtg += roomCollectedHtg;
    trendItem.payoutHtg += roomPayoutHtg;
    trendItem.netHtg += roomNetHtg;
    if (winnerType === "human") trendItem.humanWins += 1;
    if (winnerType === "bot") trendItem.botWins += 1;
    if (endedAtMs > safeSignedInt(trendItem.periodMs)) {
      trendItem.periodMs = endedAtMs;
      trendItem.label = getLudoBotPilotTrendLabel(range.windowKey, endedAtMs);
    }
    trendMap.set(trendKey, trendItem);

    currentEquityHtg += roomNetHtg;
    if (currentEquityHtg >= highWaterMarkHtg) {
      highWaterMarkHtg = currentEquityHtg;
      lastPeakAtMs = endedAtMs;
    }
    fullEquityCurve.push({
      key: `${trendKey}_${roomsCount}`,
      label: getLudoBotPilotTrendLabel(range.windowKey, endedAtMs),
      periodMs: endedAtMs,
      equityHtg: currentEquityHtg,
    });
  });

  trendMap.forEach((item) => {
    fullTrend.push({
      key: item.key,
      label: item.label,
      periodMs: safeSignedInt(item.periodMs),
      rooms: safeInt(item.rooms),
      collectedHtg: safeInt(item.collectedHtg),
      payoutHtg: safeInt(item.payoutHtg),
      netHtg: safeSignedInt(item.netHtg),
      botWins: safeInt(item.botWins),
      humanWins: safeInt(item.humanWins),
    });
  });
  fullTrend.sort((left, right) => safeSignedInt(left.periodMs) - safeSignedInt(right.periodMs));

  const drawdownHtg = Math.max(0, highWaterMarkHtg - currentEquityHtg);
  const drawdownPct = highWaterMarkHtg > 0 ? drawdownHtg / highWaterMarkHtg : 0;
  const recommended = chooseAutoLudoBotDifficulty({
    netHtg,
    collectedHtg,
    highWaterMarkHtg,
    currentEquityHtg,
    drawdownHtg,
    drawdownPct,
  });

  return {
    ok: true,
    window: range.windowKey,
    startMs: range.startMs,
    endMs: range.endMs,
    dayKey: getLudoBotPilotDayKey(range.startMs),
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
    botWins,
    humanWins,
    botWinRatePct: roomsCount > 0 ? botWins / roomsCount : 0,
    humanWinRatePct: roomsCount > 0 ? humanWins / roomsCount : 0,
    recommendedLevel: recommended.level,
    recommendedBand: recommended.band,
    recommendedReason: recommended.reason,
    trend: fullTrend.slice(-LUDO_BOT_PILOT_TREND_POINT_LIMIT),
    equityCurve: fullEquityCurve.slice(-(LUDO_BOT_PILOT_EQUITY_POINT_LIMIT + 1)),
    difficultyMix: Array.from(difficultyMixMap.values())
      .sort((left, right) => safeInt(right.rooms) - safeInt(left.rooms))
      .map((item) => ({
        level: normalizeLudoBotDifficulty(item.level),
        rooms: safeInt(item.rooms),
        netHtg: safeSignedInt(item.netHtg),
        botWins: safeInt(item.botWins),
        humanWins: safeInt(item.humanWins),
      })),
    stakeMix: Array.from(stakeMixMap.values())
      .sort((left, right) => safeInt(left.stakeHtg) - safeInt(right.stakeHtg))
      .map((item) => ({
        stakeHtg: safeInt(item.stakeHtg),
        labelHtg: String(item.labelHtg || `${safeInt(item.stakeHtg)} HTG`),
        rooms: safeInt(item.rooms),
        netHtg: safeSignedInt(item.netHtg),
        botWins: safeInt(item.botWins),
        humanWins: safeInt(item.humanWins),
      })),
    computedAtMs: nowMs,
  };
}

async function setLudoBotPilotControl(payload = {}) {
  const current = await readAdminBootstrap();
  const mode = normalizeLudoBotPilotMode(payload.mode || current.ludoBotPilotMode || "manual");
  const windowKey = normalizeLudoBotPilotWindow(payload.window || current.ludoBotPilotWindow || "today");
  const manualBotDifficulty = normalizeLudoBotDifficulty(
    payload.manualBotDifficulty
    || current.manualLudoBotDifficulty
    || current.ludoBotDifficulty
    || current.manualBotDifficulty
    || current.botDifficulty
  );

  let autoBotDifficulty = normalizeLudoBotDifficulty(
    current.autoLudoBotDifficulty
    || current.ludoBotDifficulty
    || current.autoBotDifficulty
    || current.botDifficulty
  );
  let appliedBotDifficulty = manualBotDifficulty;
  let snapshot = null;
  const nowMs = Date.now();

  if (mode === "auto") {
    snapshot = await computeLudoBotPilotSnapshot({ nowMs, window: windowKey });
    autoBotDifficulty = normalizeLudoBotDifficulty(snapshot.recommendedLevel || autoBotDifficulty);
    appliedBotDifficulty = autoBotDifficulty;
  }

  await db.collection("settings").doc(BOOTSTRAP_DOC_ID).set({
    ludoBotPilotMode: mode,
    ludoBotPilotWindow: windowKey,
    manualLudoBotDifficulty: manualBotDifficulty,
    autoLudoBotDifficulty: autoBotDifficulty,
    ludoBotDifficulty: appliedBotDifficulty,
    ludoBotPilotLastComputedAtMs: nowMs,
    ludoBotPilotUpdatedAt: admin.firestore.FieldValue.serverTimestamp(),
    ludoBotPilotMetricsSnapshot: snapshot ? {
      window: snapshot.window,
      startMs: snapshot.startMs,
      endMs: snapshot.endMs,
      roomsCount: safeInt(snapshot.roomsCount),
      collectedHtg: safeInt(snapshot.collectedHtg),
      payoutHtg: safeInt(snapshot.payoutHtg),
      netHtg: safeSignedInt(snapshot.netHtg),
      marginPct: safeFloat(snapshot.marginPct),
      currentEquityHtg: safeSignedInt(snapshot.currentEquityHtg),
      highWaterMarkHtg: safeSignedInt(snapshot.highWaterMarkHtg),
      drawdownHtg: safeInt(snapshot.drawdownHtg),
      drawdownPct: safeFloat(snapshot.drawdownPct),
      lastPeakAtMs: safeSignedInt(snapshot.lastPeakAtMs),
      botWins: safeInt(snapshot.botWins),
      humanWins: safeInt(snapshot.humanWins),
      botWinRatePct: safeFloat(snapshot.botWinRatePct),
      humanWinRatePct: safeFloat(snapshot.humanWinRatePct),
      recommendedLevel: normalizeLudoBotDifficulty(snapshot.recommendedLevel),
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

async function getLudoBotPilotSnapshot(payload = {}) {
  const settings = await readAdminBootstrap();
  const nowMs = Date.now();
  const mode = normalizeLudoBotPilotMode(payload.mode || settings.ludoBotPilotMode || "manual");
  const windowKey = normalizeLudoBotPilotWindow(payload.window || settings.ludoBotPilotWindow || "today");
  const snapshot = await computeLudoBotPilotSnapshot({ nowMs, window: windowKey });
  const appliedBotDifficulty = mode === "auto"
    ? normalizeLudoBotDifficulty(
      snapshot.recommendedLevel
      || settings.autoLudoBotDifficulty
      || settings.ludoBotDifficulty
      || settings.autoBotDifficulty
      || settings.botDifficulty
    )
    : normalizeLudoBotDifficulty(
      settings.manualLudoBotDifficulty
      || settings.ludoBotDifficulty
      || settings.manualBotDifficulty
      || settings.botDifficulty
    );

  return {
    ok: true,
    mode,
    window: windowKey,
    manualBotDifficulty: normalizeLudoBotDifficulty(
      settings.manualLudoBotDifficulty
      || settings.ludoBotDifficulty
      || settings.manualBotDifficulty
      || settings.botDifficulty
    ),
    autoBotDifficulty: normalizeLudoBotDifficulty(
      settings.autoLudoBotDifficulty
      || settings.ludoBotDifficulty
      || snapshot.recommendedLevel
      || settings.autoBotDifficulty
      || settings.botDifficulty
    ),
    appliedBotDifficulty,
    snapshot,
  };
}

async function refreshLudoBotPilotAutoNow() {
  const settings = await readAdminBootstrap();
  const mode = normalizeLudoBotPilotMode(settings.ludoBotPilotMode || "manual");
  if (mode !== "auto") return null;
  return setLudoBotPilotControl({
    mode: "auto",
    window: settings.ludoBotPilotWindow || "today",
    manualBotDifficulty: settings.manualLudoBotDifficulty || settings.ludoBotDifficulty || settings.manualBotDifficulty || settings.botDifficulty,
  });
}

function buildLudoSessionId(nowMs = Date.now()) {
  return `ludo_${Number(nowMs).toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

function buildLudoRewardDoes(stakeDoes = 0) {
  const safeStakeDoes = safeInt(stakeDoes);
  if (safeStakeDoes <= 0) return 0;
  return Math.floor((safeStakeDoes * LUDO_ODDS_NUMERATOR) / LUDO_ODDS_DENOMINATOR);
}

function readActiveLudoWagerStatus(currentWager = {}, nowMs = Date.now()) {
  const wagerStatus = String(currentWager.status || "").trim().toLowerCase();
  const sessionId = sanitizeText(currentWager.sessionId || "", 120);
  const lastEventAtMs = Math.max(
    safeSignedInt(currentWager.lastEventAtMs, 0),
    safeSignedInt(currentWager.startedAtMs, 0)
  );
  const expired = lastEventAtMs > 0
    ? (nowMs - lastEventAtMs) >= LUDO_ACTIVE_WAGER_STALE_MS
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
  DEFAULT_LUDO_BOT_DIFFICULTY,
  LUDO_ACTIVE_WAGER_STALE_MS,
  LUDO_ALLOWED_STAKES,
  LUDO_BOT_DIFFICULTY_LEVELS,
  LUDO_BOT_PILOT_MODES,
  LUDO_DISCONNECT_FORFEIT_MS,
  LUDO_MATCH_RESULTS_COLLECTION,
  LUDO_ODDS_DENOMINATOR,
  LUDO_ODDS_NUMERATOR,
  LUDO_RECENT_MATCH_IDS_LIMIT,
  LUDO_RECENT_OUTCOMES_LIMIT,
  buildLudoSessionId,
  buildLudoRewardDoes,
  computeLudoBotPilotSnapshot,
  getConfiguredLudoBotDifficulty,
  getLudoBotPilotSnapshot,
  normalizeLudoBotDifficulty,
  normalizeLudoBotPilotMode,
  normalizeLudoBotPilotWindow,
  readActiveLudoWagerStatus,
  refreshLudoBotPilotAutoNow,
  setLudoBotPilotControl,
};
