const crypto = require("crypto");

const { admin, db } = require("./firebase-admin");
const { buildRewardAmountHtg, buildStakeAmountHtg, resolveGameEntryFundingRequest } = require("./domino-classic");
const { makeHttpError } = require("./http");
const {
  STATE: LUDO_FRIEND_ENGINE_STATE,
  applyMove: applyFriendLudoMove,
  applyRoll: applyFriendLudoRoll,
  buildStateSnapshot: buildFriendLudoStateSnapshot,
  createInitialFriendEngineState,
  resolvePlayerBySeat,
  resolveSeatByPlayer,
} = require("./ludo-friend-engine");
const { walletRef, assertWalletNotFrozen } = require("./player-wallet");
const { safeInt, safeSignedInt, sanitizeText } = require("./safe");
const {
  applyHtgRewardCredit,
  applyHtgStakeDebit,
  readApprovedHtg,
  readProvisionalHtg,
} = require("./wallet-htg");
const { doesToHtg } = require("./wallet-htg");

const BOOTSTRAP_DOC_ID = "dpayment_admin_bootstrap";
const LUDO_MATCH_RESULTS_COLLECTION = "ludoMatchResults";
const LUDO_ALLOWED_STAKES = new Set([500]);
const LUDO_FRIEND_ROOMS_COLLECTION = "ludoFriendRooms";
const LUDO_FRIEND_ALLOWED_STAKES = new Set([500, 1000, 2000, 5000, 10000]);
const LUDO_FRIEND_TURN_LIMIT_MS = 30 * 1000;
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
const LUDO_FRIEND_WAIT_MS = 15 * 60 * 1000;
const LUDO_FRIEND_CODE_SIZE = 6;
const LUDO_FRIEND_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const LUDO_FRIEND_ACTION_LOG_LIMIT = 50;

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

function sanitizePlayerLabel(email, fallbackSeat = 0) {
  const local = String(email || "").split("@")[0] || "";
  const cleaned = local.replace(/[^a-z0-9 _.-]/gi, "").trim().slice(0, 24);
  return cleaned || `Joueur ${Number(fallbackSeat) + 1}`;
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
}

function randomFriendCode(size = LUDO_FRIEND_CODE_SIZE) {
  let out = "";
  const targetSize = Math.max(4, safeInt(size) || LUDO_FRIEND_CODE_SIZE);
  for (let i = 0; i < targetSize; i += 1) {
    out += LUDO_FRIEND_CODE_CHARS[Math.floor(Math.random() * LUDO_FRIEND_CODE_CHARS.length)];
  }
  return out;
}

function ludoFriendRoomRef(roomId = "") {
  const safeRoomId = String(roomId || "").trim();
  return safeRoomId
    ? db.collection(LUDO_FRIEND_ROOMS_COLLECTION).doc(safeRoomId)
    : db.collection(LUDO_FRIEND_ROOMS_COLLECTION).doc();
}

function isFriendLudoRoom(room = {}) {
  return String(room?.roomMode || "").trim() === "ludo_friends";
}

function resolveLudoFriendStakeDoes(value) {
  const stakeDoes = safeInt(value);
  if (!LUDO_FRIEND_ALLOWED_STAKES.has(stakeDoes)) {
    throw makeHttpError(400, "ludo-friend-invalid-stake", "Miz salon prive Ludo a pa valab.");
  }
  return stakeDoes;
}

function assertHtgFundingRequest(payload = {}, stakeDoes = 0) {
  const fundingRequest = resolveGameEntryFundingRequest(payload, stakeDoes, "htg");
  if (fundingRequest.fundingCurrency !== "htg") {
    throw makeHttpError(400, "ludo-friend-htg-only", "Se HTG selman ki aksepte pou Ludo prive.", {
      fundingCurrency: fundingRequest.fundingCurrency,
    });
  }
  return fundingRequest;
}

function resolveLudoFriendWaitingDeadlineMs(room = {}, nowMs = Date.now()) {
  const explicit = safeSignedInt(room.waitingDeadlineMs);
  if (explicit > 0) return explicit;
  const createdAtMs = safeSignedInt(room.createdAtMs);
  if (createdAtMs > 0) {
    return createdAtMs + LUDO_FRIEND_WAIT_MS;
  }
  return nowMs + LUDO_FRIEND_WAIT_MS;
}

function resolveLudoFriendStakeHtg(room = {}) {
  const explicit = safeInt(room.stakeHtg);
  if (explicit > 0) return explicit;
  return buildStakeAmountHtg(room.stakeDoes || room.entryCostDoes || 0);
}

function resolveLudoFriendRewardDoes(stakeDoes = 0) {
  return buildLudoRewardDoes(stakeDoes);
}

function resolveLudoFriendRewardHtg(room = {}) {
  const explicit = safeInt(room.rewardAmountHtg);
  if (explicit > 0) return explicit;
  return buildRewardAmountHtg(
    room.stakeDoes || room.entryCostDoes || 0,
    room.rewardAmountDoes || resolveLudoFriendRewardDoes(room.stakeDoes || room.entryCostDoes || 0)
  );
}

function getLudoFriendSeatForUser(room = {}, uid = "") {
  const seats = room?.seats && typeof room.seats === "object" ? room.seats : {};
  return typeof seats[uid] === "number" ? seats[uid] : -1;
}

function buildFriendRoomSummary(room = {}, {
  roomId = "",
  seatIndex = -1,
  resumed = false,
  joined = false,
} = {}) {
  const playerUids = Array.isArray(room.playerUids)
    ? room.playerUids.slice(0, 2).map((value) => String(value || "").trim())
    : ["", ""];
  const playerNames = Array.isArray(room.playerNames)
    ? room.playerNames.slice(0, 2).map((value) => sanitizeText(value || "", 48))
    : ["", ""];
  const humanCount = playerUids.filter(Boolean).length;
  const stakeDoes = safeInt(room.stakeDoes || room.entryCostDoes);
  const waitingDeadlineMs = resolveLudoFriendWaitingDeadlineMs(room);
  const engineState = room.engineState && typeof room.engineState === "object"
    ? buildFriendLudoStateSnapshot(room.engineState)
    : null;
  return {
    ok: true,
    roomId: String(roomId || "").trim(),
    resumed: resumed === true,
    joined: joined === true,
    status: String(room.status || "").trim() || "waiting",
    roomMode: "ludo_friends",
    inviteCode: String(room.inviteCode || "").trim(),
    stakeDoes,
    stakeHtg: resolveLudoFriendStakeHtg(room),
    rewardAmountDoes: safeInt(room.rewardAmountDoes || resolveLudoFriendRewardDoes(stakeDoes)),
    rewardAmountHtg: resolveLudoFriendRewardHtg(room),
    fundingCurrency: "htg",
    hostUid: String(room.hostUid || playerUids[0] || "").trim(),
    guestUid: String(room.guestUid || playerUids[1] || "").trim(),
    seatIndex,
    humanCount,
    requiredHumans: 2,
    waitingDeadlineMs,
    readyToStart: humanCount >= 2,
    playerUids,
    playerNames,
    startedAtMs: safeSignedInt(room.startedAtMs),
    endedAtMs: safeSignedInt(room.endedAtMs),
    closedAtMs: safeSignedInt(room.closedAtMs),
    endReason: String(room.endReason || "").trim(),
    engineState,
  };
}

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

async function generateUniqueFriendLudoInviteCode(size = LUDO_FRIEND_CODE_SIZE, maxAttempts = 18) {
  for (let attempt = 0; attempt < Math.max(4, safeInt(maxAttempts) || 18); attempt += 1) {
    const candidate = randomFriendCode(size);
    const snap = await db
      .collection(LUDO_FRIEND_ROOMS_COLLECTION)
      .where("inviteCodeNormalized", "==", candidate)
      .limit(1)
      .get();
    if (snap.empty) {
      return candidate;
    }
  }
  throw makeHttpError(503, "ludo-friend-code-generation-failed", "Nou pa rive kreye yon kod salon prive kounye a.");
}

async function findActiveFriendLudoRoomForUser(uid) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) return null;

  const snap = await db
    .collection(LUDO_FRIEND_ROOMS_COLLECTION)
    .where("playerUids", "array-contains", safeUid)
    .limit(8)
    .get();

  if (snap.empty) return null;

  const candidate = snap.docs
    .filter((docSnap) => {
      const data = docSnap.data() || {};
      const status = String(data.status || "").trim().toLowerCase();
      return status === "waiting" || status === "playing";
    })
    .sort((left, right) => {
      const leftData = left.data() || {};
      const rightData = right.data() || {};
      const rightUpdated = Math.max(
        safeSignedInt(rightData.updatedAtMs),
        safeSignedInt(rightData.startedAtMs),
        safeSignedInt(rightData.createdAtMs)
      );
      const leftUpdated = Math.max(
        safeSignedInt(leftData.updatedAtMs),
        safeSignedInt(leftData.startedAtMs),
        safeSignedInt(leftData.createdAtMs)
      );
      return rightUpdated - leftUpdated;
    })[0] || null;

  if (!candidate) return null;
  const data = candidate.data() || {};
  return {
    roomId: candidate.id,
    status: String(data.status || "").trim(),
    seatIndex: getLudoFriendSeatForUser(data, safeUid),
    stakeDoes: safeInt(data.stakeDoes || data.entryCostDoes),
  };
}

async function resolveBlockingFriendLudoRoomForCreate(uid, {
  allowReplaceWaitingSoloHost = false,
} = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) return null;

  const activeRoom = await findActiveFriendLudoRoomForUser(safeUid);
  if (!activeRoom?.roomId) return null;

  const roomRefDoc = ludoFriendRoomRef(activeRoom.roomId);
  return db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      return null;
    }

    const room = roomSnap.data() || {};
    if (!isFriendLudoRoom(room)) {
      return null;
    }

    const status = String(room.status || "").trim().toLowerCase();
    if (status !== "waiting" && status !== "playing") {
      return null;
    }

    const nowMs = Date.now();

    if (status === "waiting") {
      const playerUids = resolveFriendRoomPlayerUids(room);
      const humanCount = playerUids.filter(Boolean).length;
      const hostUid = String(room.hostUid || playerUids[0] || "").trim();
      const isSoloHostWaitingRoom = humanCount < 2 && hostUid === safeUid;

      if (isExpiredWaitingFriendLudoRoom(room, nowMs)) {
        await closeExpiredWaitingFriendLudoRoomTx(tx, { roomRefDoc, room, nowMs });
        return null;
      }

      if (allowReplaceWaitingSoloHost && isSoloHostWaitingRoom) {
        tx.set(roomRefDoc, {
          status: "closed",
          closedAtMs: nowMs,
          endedAtMs: safeSignedInt(room.endedAtMs) || nowMs,
          endReason: "replaced_by_new_room",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtMs: nowMs,
        }, { merge: true });
        return null;
      }
    }

    if (status === "playing") {
      const autoOutcome = computeFriendLudoAutoOutcome(room, nowMs);
      if (autoOutcome) {
        await finalizeFriendLudoOutcomeTx(tx, {
          roomRefDoc,
          room,
          winnerSeat: autoOutcome.winnerSeat,
          endReason: autoOutcome.reason,
          nowMs,
        });
        return null;
      }
    }

    return buildFriendRoomSummary(room, {
      roomId: roomRefDoc.id,
      seatIndex: getLudoFriendSeatForUser(room, safeUid),
      resumed: true,
    });
  });
}

async function assertLudoFriendWalletReady(uid, stakeHtg) {
  const walletSnap = await walletRef(uid).get();
  const walletData = walletSnap.exists ? (walletSnap.data() || {}) : {};
  assertWalletNotFrozen(walletData);
  const totalPlayableHtg = Math.max(0, readApprovedHtg(walletData) + readProvisionalHtg(walletData));
  if (totalPlayableHtg < stakeHtg) {
    throw makeHttpError(409, "ludo-friend-insufficient-balance", "Ou pa gen ase HTG pou salon prive Ludo sa a.", {
      stakeHtg,
      playableHtg: totalPlayableHtg,
    });
  }
}

function buildLudoFriendResultDocId(roomId = "", roundIndex = 1) {
  return `${String(roomId || "").trim()}_${safeInt(roundIndex) || 1}`;
}

function resolveFriendRoomPlayerUids(room = {}) {
  return Array.isArray(room.playerUids)
    ? room.playerUids.slice(0, 2).map((value) => String(value || "").trim())
    : ["", ""];
}

function buildNextFriendLudoActionLog(room = {}, entry = {}) {
  const currentLog = Array.isArray(room.actionLog) ? room.actionLog : [];
  const normalizeEntry = (item = {}) => ({
    seq: safeInt(item.seq),
    type: String(item.type || "").trim().toLowerCase(),
    uid: String(item.uid || "").trim(),
    turnIndex: safeInt(item.turnIndex),
    diceValue: safeInt(item.diceValue),
    pieceIndex: item.pieceIndex === null || item.pieceIndex === undefined ? null : safeInt(item.pieceIndex),
    createdAtMs: safeSignedInt(item.createdAtMs),
  });

  return currentLog
    .filter((item) => item && typeof item === "object")
    .map((item) => normalizeEntry(item))
    .concat(normalizeEntry(entry))
    .slice(-LUDO_FRIEND_ACTION_LOG_LIMIT);
}

function isExpiredWaitingFriendLudoRoom(room = {}, nowMs = Date.now()) {
  const status = String(room.status || "").trim().toLowerCase();
  if (status !== "waiting") return false;
  const playerUids = resolveFriendRoomPlayerUids(room);
  const humanCount = playerUids.filter(Boolean).length;
  if (humanCount >= 2) return false;
  const waitingDeadlineMs = resolveLudoFriendWaitingDeadlineMs(room, nowMs);
  return waitingDeadlineMs > 0 && nowMs >= waitingDeadlineMs;
}

async function closeExpiredWaitingFriendLudoRoomTx(tx, {
  roomRefDoc,
  room = {},
  nowMs = Date.now(),
} = {}) {
  const roomPatch = {
    status: "closed",
    closedAtMs: nowMs,
    endedAtMs: safeSignedInt(room.endedAtMs) || nowMs,
    endReason: "waiting_expired",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: nowMs,
  };

  tx.set(roomRefDoc, roomPatch, { merge: true });
  return {
    ...room,
    ...roomPatch,
  };
}

function computeFriendLudoAutoOutcome(room = {}, nowMs = Date.now()) {
  const status = String(room.status || "").trim().toLowerCase();
  if (status !== "playing") return null;
  const playerUids = resolveFriendRoomPlayerUids(room);
  if (!playerUids[0] || !playerUids[1]) return null;

  const currentPlayerSeat = safeInt(room.currentPlayerSeat);
  const turnStartedAtMs = safeSignedInt(room.turnStartedAtMs);
  if (turnStartedAtMs > 0 && (nowMs - turnStartedAtMs) >= LUDO_FRIEND_TURN_LIMIT_MS) {
    const winnerSeat = currentPlayerSeat === 1 ? 0 : 1;
    return {
      winnerSeat,
      winnerUid: playerUids[winnerSeat] || "",
      reason: "turn_timeout",
    };
  }

  const heartbeats = room.lastHeartbeatByUid && typeof room.lastHeartbeatByUid === "object"
    ? room.lastHeartbeatByUid
    : {};
  const staleSeat = [0, 1].find((seat) => {
    const uid = playerUids[seat];
    const lastHeartbeatAtMs = safeSignedInt(heartbeats[uid]);
    return uid && lastHeartbeatAtMs > 0 && (nowMs - lastHeartbeatAtMs) >= LUDO_DISCONNECT_FORFEIT_MS;
  });
  if (typeof staleSeat === "number" && staleSeat >= 0) {
    const winnerSeat = staleSeat === 1 ? 0 : 1;
    return {
      winnerSeat,
      winnerUid: playerUids[winnerSeat] || "",
      reason: "disconnect_forfeit",
    };
  }

  return null;
}

async function archiveFriendLudoResultTx(tx, {
  roomRefDoc,
  room = {},
  winnerUid = "",
  winnerSeat = -1,
  endReason = "",
  rewardEntryFunding = null,
  winnerWalletData = null,
  nowMs = Date.now(),
} = {}) {
  const roomId = roomRefDoc?.id || "";
  const playerUids = resolveFriendRoomPlayerUids(room);
  const stakeDoes = safeInt(room.stakeDoes || room.entryCostDoes);
  const stakeHtg = resolveLudoFriendStakeHtg(room);
  const rewardAmountDoes = safeInt(room.rewardAmountDoes || resolveLudoFriendRewardDoes(stakeDoes));
  const rewardAmountHtg = resolveLudoFriendRewardHtg(room);
  const safeWinnerUid = String(winnerUid || "").trim();
  const safeWinnerSeat = Number.isFinite(Number(winnerSeat)) ? Math.trunc(Number(winnerSeat)) : -1;

  if (safeWinnerUid && winnerWalletData) {
    const walletMutation = applyHtgRewardCredit(winnerWalletData, {
      rewardHtg: rewardAmountHtg,
      rewardEntryFunding,
    });
    tx.set(walletRef(safeWinnerUid), {
      ...walletMutation.balancesPatch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAtMs: nowMs,
    }, { merge: true });
  }

  const resultRef = db.collection(LUDO_MATCH_RESULTS_COLLECTION).doc(buildLudoFriendResultDocId(roomId, room.roundIndex || 1));
  tx.set(resultRef, {
    roomId,
    roomMode: "ludo_friends",
    gameMode: "ludo_friends",
    status: "ended",
    playerUids,
    stakeDoes,
    stakeHtg,
    rewardAmountDoes,
    rewardAmountHtg,
    winnerUid: safeWinnerUid,
    winnerSeat: safeWinnerSeat,
    endReason: String(endReason || "").trim() || "match_end",
    endedAtMs: nowMs,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    fundingCurrency: "htg",
  }, { merge: true });
}

async function finalizeFriendLudoOutcomeTx(tx, {
  roomRefDoc,
  room = {},
  winnerSeat = -1,
  endReason = "",
  nowMs = Date.now(),
} = {}) {
  const playerUids = resolveFriendRoomPlayerUids(room);
  const safeWinnerSeat = Number.isFinite(Number(winnerSeat)) ? Math.trunc(Number(winnerSeat)) : -1;
  const winnerUid = safeWinnerSeat >= 0 ? (playerUids[safeWinnerSeat] || "") : "";
  const entryFundingByUid = room.entryFundingByUid && typeof room.entryFundingByUid === "object"
    ? room.entryFundingByUid
    : {};
  const rewardEntryFunding = winnerUid ? (entryFundingByUid[winnerUid] || null) : null;
  const winnerWalletSnap = winnerUid ? await tx.get(walletRef(winnerUid)) : null;
  const winnerWalletData = winnerWalletSnap?.exists ? (winnerWalletSnap.data() || {}) : null;

  const nextEngineState = buildFriendLudoStateSnapshot(room.engineState || {});
  nextEngineState.state = LUDO_FRIEND_ENGINE_STATE.GAME_OVER;
  nextEngineState.winnerSeat = safeWinnerSeat;
  nextEngineState.winnerPlayer = resolvePlayerBySeat(safeWinnerSeat);
  nextEngineState.eligiblePieces = [];
  nextEngineState.turnStartedAtMs = nowMs;

  await archiveFriendLudoResultTx(tx, {
    roomRefDoc,
    room,
    winnerUid,
    winnerSeat: safeWinnerSeat,
    endReason,
    rewardEntryFunding,
    winnerWalletData,
    nowMs,
  });

  tx.set(roomRefDoc, {
    status: "ended",
    endedAtMs: nowMs,
    winnerUid,
    winnerSeat: safeWinnerSeat,
    endReason: String(endReason || "").trim() || "match_end",
    engineState: nextEngineState,
    currentPlayerSeat: resolveSeatByPlayer(nextEngineState.currentPlayer || "P1"),
    turnStartedAtMs: safeSignedInt(nextEngineState.turnStartedAtMs),
    actionSeq: safeInt(nextEngineState.actionSeq),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: nowMs,
  }, { merge: true });

  return {
    ...room,
    status: "ended",
    endedAtMs: nowMs,
    winnerUid,
    winnerSeat: safeWinnerSeat,
    endReason: String(endReason || "").trim() || "match_end",
    engineState: nextEngineState,
    currentPlayerSeat: resolveSeatByPlayer(nextEngineState.currentPlayer || "P1"),
    turnStartedAtMs: safeSignedInt(nextEngineState.turnStartedAtMs),
    actionSeq: safeInt(nextEngineState.actionSeq),
    updatedAtMs: nowMs,
  };
}

async function createFriendLudoRoom({ uid, email, payload = {} }) {
  const stakeDoes = resolveLudoFriendStakeDoes(payload.stakeDoes ?? payload.amountDoes ?? payload.amount);
  const fundingRequest = assertHtgFundingRequest(payload, stakeDoes);
  const stakeHtg = buildStakeAmountHtg(stakeDoes);
  const activeRoom = await resolveBlockingFriendLudoRoomForCreate(uid, {
    allowReplaceWaitingSoloHost: true,
  });
  if (activeRoom?.roomId) {
    throw makeHttpError(409, "ludo-friend-room-already-active", "Ou deja gen yon salon prive Ludo aktif.", {
      roomId: activeRoom.roomId,
      status: activeRoom.status,
    });
  }

  await assertLudoFriendWalletReady(uid, stakeHtg);
  const inviteCode = await generateUniqueFriendLudoInviteCode();
  const roomRefDoc = ludoFriendRoomRef();
  const nowMs = Date.now();
  const waitingDeadlineMs = nowMs + LUDO_FRIEND_WAIT_MS;
  const rewardAmountDoes = resolveLudoFriendRewardDoes(stakeDoes);
  const rewardAmountHtg = buildRewardAmountHtg(stakeDoes, rewardAmountDoes);

  await roomRefDoc.set({
    status: "waiting",
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAtMs: nowMs,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: nowMs,
    roomMode: "ludo_friends",
    gameMode: "ludo_friends",
    hostUid: uid,
    guestUid: "",
    playerUids: [uid, ""],
    playerNames: [sanitizePlayerLabel(email || uid, 0), ""],
    seats: { [uid]: 0 },
    humanCount: 1,
    requiredHumans: 2,
    inviteCode,
    inviteCodeNormalized: normalizeCode(inviteCode),
    stakeDoes,
    stakeHtg,
    rewardAmountDoes,
    rewardAmountHtg,
    fundingCurrency: fundingRequest.fundingCurrency,
    stakeTierId: `ludo_friend_${stakeDoes}`,
    entryFundingByUid: {},
    presenceByUid: { [uid]: nowMs },
    lastHeartbeatByUid: { [uid]: nowMs },
    waitingDeadlineMs,
    startedAtMs: 0,
    endedAtMs: 0,
    winnerUid: "",
    winnerSeat: -1,
    endReason: "",
    engineState: null,
    turnState: null,
    roundIndex: 1,
    rematchRequestUids: [],
    actionLog: [],
  });

  return buildFriendRoomSummary({
    status: "waiting",
    roomMode: "ludo_friends",
    inviteCode,
    hostUid: uid,
    guestUid: "",
    playerUids: [uid, ""],
    playerNames: [sanitizePlayerLabel(email || uid, 0), ""],
    seats: { [uid]: 0 },
    stakeDoes,
    stakeHtg,
    rewardAmountDoes,
    rewardAmountHtg,
    waitingDeadlineMs,
  }, {
    roomId: roomRefDoc.id,
    seatIndex: 0,
  });
}

async function resumeFriendLudoRoom_legacy_unused({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "ludo-friend-missing-room-id", "roomId obligatwa.");
  }

  const roomSnap = await ludoFriendRoomRef(roomId).get();
  if (!roomSnap.exists) {
    throw makeHttpError(404, "ludo-friend-room-not-found", "Salon prive Ludo a pa egziste.");
  }
  const room = roomSnap.data() || {};
  if (!isFriendLudoRoom(room)) {
    throw makeHttpError(412, "ludo-friend-invalid-room", "Room sa a pa yon salon prive Ludo valab.");
  }

  const seatIndex = getLudoFriendSeatForUser(room, uid);
  if (seatIndex < 0) {
    throw makeHttpError(403, "ludo-friend-not-room-member", "Ou pa ladan salon prive Ludo sa a.");
  }

  const nowMs = Date.now();
  const waitingDeadlineMs = resolveLudoFriendWaitingDeadlineMs(room, nowMs);
  const status = String(room.status || "").trim().toLowerCase();
  const humanCount = Array.isArray(room.playerUids)
    ? room.playerUids.slice(0, 2).map((value) => String(value || "").trim()).filter(Boolean).length
    : safeInt(room.humanCount);

  if (status === "closed" || status === "ended") {
    throw makeHttpError(412, "ludo-friend-room-closed", "Salon prive Ludo sa a pa disponib ankò.");
  }
  if (status === "waiting" && humanCount < 2 && nowMs >= waitingDeadlineMs) {
    throw makeHttpError(412, "ludo-friend-room-expired", "Salon prive Ludo sa a ekspire.");
  }

  return buildFriendRoomSummary(room, {
    roomId,
    seatIndex,
    resumed: true,
  });
}

async function joinFriendLudoRoomByCode({ uid, email, payload = {} }) {
  const inviteCodeNormalized = normalizeCode(payload.inviteCode || payload.code || "");
  if (!inviteCodeNormalized) {
    throw makeHttpError(400, "ludo-friend-missing-invite-code", "Kod salon prive a obligatwa.");
  }

  const matchingSnap = await db
    .collection(LUDO_FRIEND_ROOMS_COLLECTION)
    .where("inviteCodeNormalized", "==", inviteCodeNormalized)
    .limit(4)
    .get();
  const roomDoc = matchingSnap.docs.find((docSnap) => isFriendLudoRoom(docSnap.data() || {})) || null;
  if (!roomDoc) {
    throw makeHttpError(404, "ludo-friend-room-not-found", "Nou pa jwenn salon prive Ludo sa a.");
  }

  const roomRefDoc = roomDoc.ref;
  return db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      throw makeHttpError(404, "ludo-friend-room-not-found", "Nou pa jwenn salon prive Ludo sa a.");
    }

    const room = roomSnap.data() || {};
    if (!isFriendLudoRoom(room)) {
      throw makeHttpError(412, "ludo-friend-invalid-room", "Room sa a pa disponib pou Ludo prive.");
    }

    const roomId = roomRefDoc.id;
    const status = String(room.status || "").trim().toLowerCase();
    const nowMs = Date.now();
    const waitingDeadlineMs = resolveLudoFriendWaitingDeadlineMs(room, nowMs);
    const playerUids = Array.isArray(room.playerUids)
      ? room.playerUids.slice(0, 2).map((value) => String(value || "").trim())
      : ["", ""];
    const playerNames = Array.isArray(room.playerNames)
      ? room.playerNames.slice(0, 2).map((value) => sanitizeText(value || "", 48))
      : ["", ""];
    const humanCount = playerUids.filter(Boolean).length;
    const stakeDoes = safeInt(room.stakeDoes || room.entryCostDoes);
    const stakeHtg = resolveLudoFriendStakeHtg(room);

    assertHtgFundingRequest(payload, stakeDoes);

    if (playerUids[0] === uid) {
      return buildFriendRoomSummary(room, {
        roomId,
        seatIndex: 0,
        resumed: true,
      });
    }
    if (playerUids[1] === uid) {
      return buildFriendRoomSummary(room, {
        roomId,
        seatIndex: 1,
        resumed: true,
      });
    }
    if (status !== "waiting") {
      throw makeHttpError(412, "ludo-friend-room-not-playable", "Salon prive Ludo sa a pa ouvè pou nouvo jwè ankò.");
    }
    if (humanCount >= 2 || playerUids[1]) {
      throw makeHttpError(409, "ludo-friend-room-full", "Salon prive Ludo sa a deja plen.");
    }
    if (nowMs >= waitingDeadlineMs) {
      await closeExpiredWaitingFriendLudoRoomTx(tx, { roomRefDoc, room, nowMs });
      throw makeHttpError(412, "ludo-friend-room-expired", "Salon prive Ludo sa a ekspire deja.");
    }
    if (String(room.hostUid || playerUids[0] || "").trim() === uid) {
      throw makeHttpError(409, "ludo-friend-self-join-forbidden", "Ou pa ka antre nan pwop salon pa w ak menm kont la.");
    }

    const hostUid = String(room.hostUid || playerUids[0] || "").trim();
    if (!hostUid) {
      throw makeHttpError(412, "ludo-friend-invalid-room", "Salon prive Ludo sa a pa gen create a byen anrejistre.");
    }

    const [hostWalletSnap, guestWalletSnap] = await Promise.all([
      tx.get(walletRef(hostUid)),
      tx.get(walletRef(uid)),
    ]);
    const hostWalletData = hostWalletSnap.exists ? (hostWalletSnap.data() || {}) : {};
    const guestWalletData = guestWalletSnap.exists ? (guestWalletSnap.data() || {}) : {};
    assertWalletNotFrozen(hostWalletData);
    assertWalletNotFrozen(guestWalletData);

    const hostWalletMutation = applyHtgStakeDebit(hostWalletData, { stakeHtg });
    const guestWalletMutation = applyHtgStakeDebit(guestWalletData, { stakeHtg });
    const startingSeat = crypto.randomInt(0, 2);
    const engineState = createInitialFriendEngineState({ startingSeat, nowMs });

    const nextPlayerUids = [playerUids[0] || "", uid];
    const nextPlayerNames = [playerNames[0] || sanitizePlayerLabel(room.hostUid || "", 0), sanitizePlayerLabel(email || uid, 1)];
    const nextPresence = room.presenceByUid && typeof room.presenceByUid === "object" ? { ...room.presenceByUid } : {};
    const nextHeartbeat = room.lastHeartbeatByUid && typeof room.lastHeartbeatByUid === "object" ? { ...room.lastHeartbeatByUid } : {};
    const nextSeats = room.seats && typeof room.seats === "object" ? { ...room.seats } : {};
    nextPresence[uid] = nowMs;
    nextHeartbeat[uid] = nowMs;
    nextSeats[uid] = 1;

    tx.set(walletRef(hostUid), {
      ...hostWalletMutation.balancesPatch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAtMs: nowMs,
    }, { merge: true });
    tx.set(walletRef(uid), {
      ...guestWalletMutation.balancesPatch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAtMs: nowMs,
    }, { merge: true });

    tx.set(roomRefDoc, {
      status: "playing",
      guestUid: uid,
      playerUids: nextPlayerUids,
      playerNames: nextPlayerNames,
      seats: nextSeats,
      humanCount: 2,
      presenceByUid: nextPresence,
      lastHeartbeatByUid: nextHeartbeat,
      entryFundingByUid: {
        [hostUid]: hostWalletMutation.gameEntryFunding,
        [uid]: guestWalletMutation.gameEntryFunding,
      },
      startedAtMs: nowMs,
      turnStartedAtMs: safeSignedInt(engineState.turnStartedAtMs),
      engineState,
      currentPlayerSeat: startingSeat,
      actionSeq: safeInt(engineState.actionSeq),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    }, { merge: true });

    return buildFriendRoomSummary({
      ...room,
      status: "playing",
      guestUid: uid,
      playerUids: nextPlayerUids,
      playerNames: nextPlayerNames,
      seats: nextSeats,
      humanCount: 2,
      presenceByUid: nextPresence,
      lastHeartbeatByUid: nextHeartbeat,
      entryFundingByUid: {
        [hostUid]: hostWalletMutation.gameEntryFunding,
        [uid]: guestWalletMutation.gameEntryFunding,
      },
      startedAtMs: nowMs,
      turnStartedAtMs: safeSignedInt(engineState.turnStartedAtMs),
      engineState,
      currentPlayerSeat: startingSeat,
      actionSeq: safeInt(engineState.actionSeq),
      updatedAtMs: nowMs,
    }, {
      roomId,
      seatIndex: 1,
      joined: true,
    });
  });
}

async function getFriendLudoRoomState({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "ludo-friend-missing-room-id", "roomId obligatwa.");
  }

  const roomRefDoc = ludoFriendRoomRef(roomId);
  return db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      throw makeHttpError(404, "ludo-friend-room-not-found", "Salon prive Ludo a pa egziste.");
    }
    const room = roomSnap.data() || {};
    if (!isFriendLudoRoom(room)) {
      throw makeHttpError(412, "ludo-friend-invalid-room", "Room sa a pa yon salon prive Ludo valab.");
    }
    const seatIndex = getLudoFriendSeatForUser(room, uid);
    if (seatIndex < 0) {
      throw makeHttpError(403, "ludo-friend-not-room-member", "Ou pa ladan salon prive Ludo sa a.");
    }
    const nowMs = Date.now();
    const expiredWaitingRoom = isExpiredWaitingFriendLudoRoom(room, nowMs)
      ? await closeExpiredWaitingFriendLudoRoomTx(tx, { roomRefDoc, room, nowMs })
      : null;
    const autoOutcome = expiredWaitingRoom ? null : computeFriendLudoAutoOutcome(room, nowMs);
    const effectiveRoom = expiredWaitingRoom
      || (autoOutcome
        ? await finalizeFriendLudoOutcomeTx(tx, {
            roomRefDoc,
            room,
            winnerSeat: autoOutcome.winnerSeat,
            endReason: autoOutcome.reason,
            nowMs,
          })
        : room);
    return buildFriendRoomSummary(effectiveRoom, {
      roomId,
      seatIndex,
      resumed: true,
    });
  });
}

async function touchFriendLudoPresence({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "ludo-friend-missing-room-id", "roomId obligatwa.");
  }
  const roomRefDoc = ludoFriendRoomRef(roomId);
  return db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      throw makeHttpError(404, "ludo-friend-room-not-found", "Salon prive Ludo a pa egziste.");
    }
    const room = roomSnap.data() || {};
    if (!isFriendLudoRoom(room)) {
      throw makeHttpError(412, "ludo-friend-invalid-room", "Room sa a pa yon salon prive Ludo valab.");
    }
    const seatIndex = getLudoFriendSeatForUser(room, uid);
    if (seatIndex < 0) {
      throw makeHttpError(403, "ludo-friend-not-room-member", "Ou pa ladan salon prive Ludo sa a.");
    }
    const nowMs = Date.now();
    const expiredWaitingRoom = isExpiredWaitingFriendLudoRoom(room, nowMs)
      ? await closeExpiredWaitingFriendLudoRoomTx(tx, { roomRefDoc, room, nowMs })
      : null;
    if (expiredWaitingRoom) {
      return buildFriendRoomSummary(expiredWaitingRoom, {
        roomId,
        seatIndex,
        resumed: true,
      });
    }

    const autoOutcome = computeFriendLudoAutoOutcome(room, nowMs);
    if (autoOutcome) {
      const endedRoom = await finalizeFriendLudoOutcomeTx(tx, {
        roomRefDoc,
        room,
        winnerSeat: autoOutcome.winnerSeat,
        endReason: autoOutcome.reason,
        nowMs,
      });
      return buildFriendRoomSummary(endedRoom, {
        roomId,
        seatIndex,
        resumed: true,
      });
    }
    const nextPresence = room.presenceByUid && typeof room.presenceByUid === "object" ? { ...room.presenceByUid } : {};
    const nextHeartbeat = room.lastHeartbeatByUid && typeof room.lastHeartbeatByUid === "object" ? { ...room.lastHeartbeatByUid } : {};
    nextPresence[uid] = nowMs;
    nextHeartbeat[uid] = nowMs;
    tx.set(roomRefDoc, {
      presenceByUid: nextPresence,
      lastHeartbeatByUid: nextHeartbeat,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    }, { merge: true });
    return buildFriendRoomSummary({
      ...room,
      presenceByUid: nextPresence,
      lastHeartbeatByUid: nextHeartbeat,
      updatedAtMs: nowMs,
    }, {
      roomId,
      seatIndex,
      resumed: true,
    });
  });
}

async function submitFriendLudoAction({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  const action = String(payload.action || "").trim().toLowerCase();
  if (!roomId) {
    throw makeHttpError(400, "ludo-friend-missing-room-id", "roomId obligatwa.");
  }
  if (action !== "roll" && action !== "move") {
    throw makeHttpError(400, "ludo-friend-invalid-action", "Aksyon Ludo prive a pa valab.");
  }

  const roomRefDoc = ludoFriendRoomRef(roomId);
  return db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      throw makeHttpError(404, "ludo-friend-room-not-found", "Salon prive Ludo a pa egziste.");
    }
    const room = roomSnap.data() || {};
    if (!isFriendLudoRoom(room)) {
      throw makeHttpError(412, "ludo-friend-invalid-room", "Room sa a pa yon salon prive Ludo valab.");
    }
    const seatIndex = getLudoFriendSeatForUser(room, uid);
    if (seatIndex < 0) {
      throw makeHttpError(403, "ludo-friend-not-room-member", "Ou pa ladan salon prive Ludo sa a.");
    }
    if (String(room.status || "").trim().toLowerCase() !== "playing") {
      throw makeHttpError(412, "ludo-friend-room-not-playable", "Salon prive Ludo sa a poko nan faz jwe a.");
    }
    const nowMs = Date.now();
    const autoOutcome = computeFriendLudoAutoOutcome(room, nowMs);
    if (autoOutcome) {
      const endedRoom = await finalizeFriendLudoOutcomeTx(tx, {
        roomRefDoc,
        room,
        winnerSeat: autoOutcome.winnerSeat,
        endReason: autoOutcome.reason,
        nowMs,
      });
      return buildFriendRoomSummary(endedRoom, {
        roomId,
        seatIndex,
        resumed: true,
      });
    }

    const engineState = room.engineState && typeof room.engineState === "object"
      ? buildFriendLudoStateSnapshot(room.engineState)
      : createInitialFriendEngineState({ startingSeat: safeInt(room.currentPlayerSeat), nowMs });
    const expectedPlayer = resolvePlayerBySeat(seatIndex);
    if (String(engineState.currentPlayer || "").trim() !== expectedPlayer) {
      throw makeHttpError(409, "ludo-friend-not-your-turn", "Se pa tou pa w la nan salon prive Ludo a.");
    }
    const nextPresence = room.presenceByUid && typeof room.presenceByUid === "object" ? { ...room.presenceByUid } : {};
    const nextHeartbeat = room.lastHeartbeatByUid && typeof room.lastHeartbeatByUid === "object" ? { ...room.lastHeartbeatByUid } : {};
    nextPresence[uid] = nowMs;
    nextHeartbeat[uid] = nowMs;

    let nextEngineState = engineState;
    try {
      if (action === "roll") {
        const diceValue = 1 + Math.floor(Math.random() * 6);
        nextEngineState = applyFriendLudoRoll(engineState, { diceValue, nowMs });
      } else {
        nextEngineState = applyFriendLudoMove(engineState, {
          pieceIndex: safeInt(payload.pieceIndex ?? payload.piece),
          nowMs,
        });
      }
    } catch (error) {
      const code = String(error?.message || "").trim().toLowerCase();
      if (code === "ludo-friend-roll-not-allowed" || code === "ludo-friend-move-not-allowed") {
        throw makeHttpError(409, "ludo-friend-room-not-playable", "Aksyon sa a pa valab nan eta aktyel room nan.");
      }
      if (code === "ludo-friend-illegal-move") {
        throw makeHttpError(409, "ludo-friend-illegal-move", "Pyon sa a pa ka jwe ak de sa a.");
      }
      throw error;
    }

    const nextActionLog = buildNextFriendLudoActionLog(room, {
      seq: safeInt(nextEngineState.actionSeq),
      type: action,
      uid,
      turnIndex: seatIndex,
      diceValue: action === "roll" ? safeInt(nextEngineState.diceValue) : safeInt(engineState.diceValue),
      pieceIndex: action === "move" ? safeInt(payload.pieceIndex ?? payload.piece) : null,
      createdAtMs: nowMs,
    });

    const roomPatch = {
      engineState: nextEngineState,
      currentPlayerSeat: resolveSeatByPlayer(nextEngineState.currentPlayer || "P1"),
      turnStartedAtMs: safeSignedInt(nextEngineState.turnStartedAtMs),
      actionSeq: safeInt(nextEngineState.actionSeq),
      actionLog: nextActionLog,
      presenceByUid: nextPresence,
      lastHeartbeatByUid: nextHeartbeat,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    };

    if (String(nextEngineState.state || "") === LUDO_FRIEND_ENGINE_STATE.GAME_OVER) {
      const winnerSeat = safeInt(nextEngineState.winnerSeat);
      const winnerUid = resolveFriendRoomPlayerUids(room)[winnerSeat] || "";
      const entryFundingByUid = room.entryFundingByUid && typeof room.entryFundingByUid === "object"
        ? room.entryFundingByUid
        : {};
      const rewardEntryFunding = winnerUid ? (entryFundingByUid[winnerUid] || null) : null;
      const winnerWalletData = winnerUid
        ? ((await tx.get(walletRef(winnerUid))).data() || {})
        : null;

      roomPatch.status = "ended";
      roomPatch.endedAtMs = nowMs;
      roomPatch.winnerUid = winnerUid;
      roomPatch.winnerSeat = winnerSeat;
      roomPatch.endReason = "match_end";

      await archiveFriendLudoResultTx(tx, {
        roomRefDoc,
        room,
        winnerUid,
        winnerSeat,
        endReason: "match_end",
        rewardEntryFunding,
        winnerWalletData,
        nowMs,
      });
    }

    tx.set(roomRefDoc, roomPatch, { merge: true });
    return buildFriendRoomSummary({
      ...room,
      ...roomPatch,
      engineState: nextEngineState,
    }, {
      roomId,
      seatIndex,
      resumed: true,
    });
  });
}

async function leaveFriendLudoRoom({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "ludo-friend-missing-room-id", "roomId obligatwa.");
  }

  const roomRefDoc = ludoFriendRoomRef(roomId);
  return db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      throw makeHttpError(404, "ludo-friend-room-not-found", "Salon prive Ludo a pa egziste.");
    }
    const room = roomSnap.data() || {};
    if (!isFriendLudoRoom(room)) {
      throw makeHttpError(412, "ludo-friend-invalid-room", "Room sa a pa yon salon prive Ludo valab.");
    }

    const seatIndex = getLudoFriendSeatForUser(room, uid);
    if (seatIndex < 0) {
      throw makeHttpError(403, "ludo-friend-not-room-member", "Ou pa ladan salon prive Ludo sa a.");
    }

    const status = String(room.status || "").trim().toLowerCase();
    const nowMs = Date.now();

    if (status === "ended" || status === "closed") {
      return buildFriendRoomSummary(room, {
        roomId,
        seatIndex,
        resumed: true,
      });
    }

    if (status === "waiting") {
      const roomPatch = {
        status: "closed",
        closedAtMs: nowMs,
        endedAtMs: safeSignedInt(room.endedAtMs) || nowMs,
        endReason: "player_quit",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      };
      tx.set(roomRefDoc, roomPatch, { merge: true });
      return buildFriendRoomSummary({
        ...room,
        ...roomPatch,
      }, {
        roomId,
        seatIndex,
        resumed: true,
      });
    }

    if (status === "playing") {
      const winnerSeat = seatIndex === 1 ? 0 : 1;
      const endedRoom = await finalizeFriendLudoOutcomeTx(tx, {
        roomRefDoc,
        room,
        winnerSeat,
        endReason: "player_quit",
        nowMs,
      });
      return buildFriendRoomSummary(endedRoom, {
        roomId,
        seatIndex,
        resumed: true,
      });
    }

    return buildFriendRoomSummary(room, {
      roomId,
      seatIndex,
      resumed: true,
    });
  });
}

async function resumeFriendLudoRoom({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "ludo-friend-missing-room-id", "roomId obligatwa.");
  }

  const roomRefDoc = ludoFriendRoomRef(roomId);
  return db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      throw makeHttpError(404, "ludo-friend-room-not-found", "Salon prive Ludo a pa egziste.");
    }
    const room = roomSnap.data() || {};
    if (!isFriendLudoRoom(room)) {
      throw makeHttpError(412, "ludo-friend-invalid-room", "Room sa a pa yon salon prive Ludo valab.");
    }

    const seatIndex = getLudoFriendSeatForUser(room, uid);
    if (seatIndex < 0) {
      throw makeHttpError(403, "ludo-friend-not-room-member", "Ou pa ladan salon prive Ludo sa a.");
    }

    const status = String(room.status || "").trim().toLowerCase();
    if (status === "closed" || status === "ended") {
      return buildFriendRoomSummary(room, {
        roomId,
        seatIndex,
        resumed: true,
      });
    }

    const nowMs = Date.now();
    const effectiveRoom = isExpiredWaitingFriendLudoRoom(room, nowMs)
      ? await closeExpiredWaitingFriendLudoRoomTx(tx, { roomRefDoc, room, nowMs })
      : room;

    return buildFriendRoomSummary(effectiveRoom, {
      roomId,
      seatIndex,
      resumed: true,
    });
  });
}

module.exports = {
  DEFAULT_LUDO_BOT_DIFFICULTY,
  LUDO_ACTIVE_WAGER_STALE_MS,
  LUDO_ALLOWED_STAKES,
  LUDO_BOT_DIFFICULTY_LEVELS,
  LUDO_BOT_PILOT_MODES,
  LUDO_DISCONNECT_FORFEIT_MS,
  LUDO_FRIEND_ALLOWED_STAKES,
  LUDO_FRIEND_ROOMS_COLLECTION,
  LUDO_FRIEND_WAIT_MS,
  LUDO_MATCH_RESULTS_COLLECTION,
  LUDO_ODDS_DENOMINATOR,
  LUDO_ODDS_NUMERATOR,
  LUDO_RECENT_MATCH_IDS_LIMIT,
  LUDO_RECENT_OUTCOMES_LIMIT,
  buildLudoSessionId,
  buildFriendRoomSummary,
  buildLudoRewardDoes,
  computeLudoBotPilotSnapshot,
  createFriendLudoRoom,
  findActiveFriendLudoRoomForUser,
  getFriendLudoRoomState,
  isFriendLudoRoom,
  joinFriendLudoRoomByCode,
  normalizeCode,
  getConfiguredLudoBotDifficulty,
  getLudoBotPilotSnapshot,
  normalizeLudoBotDifficulty,
  normalizeLudoBotPilotMode,
  normalizeLudoBotPilotWindow,
  leaveFriendLudoRoom,
  readActiveLudoWagerStatus,
  refreshLudoBotPilotAutoNow,
  resolveLudoFriendStakeDoes,
  resumeFriendLudoRoom,
  setLudoBotPilotControl,
  submitFriendLudoAction,
  touchFriendLudoPresence,
};
