const crypto = require("crypto");

const { admin, db } = require("./firebase-admin");
const { buildRewardAmountHtg, buildStakeAmountHtg } = require("./domino-classic");
const { getConfiguredDuelBotDifficulty, getConfiguredDuelBotWaitMs } = require("./duel-bot-pilot");
const { makeHttpError } = require("./http");
const { walletRef, assertWalletNotFrozen } = require("./player-wallet");
const { readPublicAppSettings } = require("./public-config");
const { safeInt, safeSignedInt, sanitizeText } = require("./safe");
const {
  RATE_HTG_TO_DOES,
  applyHtgRewardCredit,
  applyHtgStakeDebit,
  normalizeFundingCurrency,
} = require("./wallet-htg");

const DUEL_V2_ROOMS_COLLECTION = "duelRoomsV2";
const DUEL_V2_GAME_STATES_COLLECTION = "duelGameStatesV2";
const DUEL_V2_MATCHMAKING_POOLS_COLLECTION = "duelMatchmakingPoolsV2";
const DUEL_V2_ACTIONS_SUBCOLLECTION = "actions";
const DUEL_ROOM_RESULTS_COLLECTION = "duelRoomResults";

const ROOM_WAIT_MS = 15 * 1000;
const FRIEND_ROOM_WAIT_MS = 5 * 60 * 1000;
const DUEL_TURN_LIMIT_MS = 90 * 1000;
const DUEL_TURN_TIMEOUT_GRACE_MS = 12 * 1000;
const DUEL_PRESENCE_GRACE_MS = 45 * 1000;
const FRIEND_ROOM_CODE_SIZE = 6;
const PUBLIC_DUEL_V2_STAKE_HTG = 25;
const MIN_PRIVATE_DUEL_V2_STAKE_HTG = 25;
const PUBLIC_DUEL_BOT_WAIT_MS = 7 * 1000;
const PUBLIC_DUEL_BOT_DEFAULT_DIFFICULTY = "dominov1";
const HARD_DISABLE_DOMINO_DUEL = false;

function assertDuelV2HardAvailable() {
  if (HARD_DISABLE_DOMINO_DUEL) {
    throw makeHttpError(503, "duel-v2-temporarily-disabled", "Domino duel la gen yon pwoblem teknik. Nou femen li tanporeman pandan nap regle sa.", {
      game: "domino-duel",
      hardDisabled: true,
    });
  }
}

async function assertDuelV2PublicAvailable() {
  assertDuelV2HardAvailable();
  const publicSettings = await readPublicAppSettings();
  if (publicSettings.dominoDuelPublicEnabled === false) {
    throw makeHttpError(503, "duel-v2-temporarily-disabled", "Domino duel la gen yon pwoblem teknik. Nou femen li tanporeman pandan nap regle sa.", {
      game: "domino-duel",
    });
  }
  return publicSettings;
}
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PUBLIC_DUEL_BOT_NAMES = Object.freeze([
  "march56", "dexter5", "junior44", "leon73", "tiro45", "fega22", "marc456", "samy8", "jerry18", "nando51",
  "louis22", "kendy7", "alpha39", "bravo14", "carlos88", "dede57", "eddy31", "fabio90", "guy62", "henry16",
  "isaac40", "joel63", "kenzo12", "lester77", "mika24", "nixon53", "oscar11", "pablo69", "quentin5", "ricky34",
  "steven27", "tony84", "ulysse19", "vlad28", "willy55", "xavier13", "yohan60", "zico25", "benson41", "clark52",
  "damien17", "elvis64", "freddy29", "gilbert80", "harold33", "irvin71", "jordan26", "kevin58", "logan37", "mason86",
  "nelson20", "orlando43", "pierrot32", "quentel66", "roby15", "samson70", "travis23", "ulrick81", "valdo36", "wesley10",
  "xeno54", "yanick21", "zack72", "archer42", "bryan83", "cedric30", "dorian61", "emilio18", "franco79", "gerson24",
  "hector56", "ivan35", "jules68", "kurt14", "lucas47", "mario92", "noah27", "olivier50", "paulin19", "quent55",
  "rafael38", "silvio74", "thierry28", "uriel63", "victor16", "walter44", "xander57", "yves12", "zinedine82", "andre25",
  "brad49", "cyril53", "denis11", "ethan67", "felix31", "gael76", "hugo22", "jaden59", "karl18", "milo65"
]);

const TILE_VALUES = Object.freeze([
  [0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6],
  [1, 1], [1, 2], [1, 3], [1, 4], [1, 5], [1, 6],
  [2, 2], [2, 3], [2, 4], [2, 5], [2, 6],
  [3, 3], [3, 4], [3, 5], [3, 6],
  [4, 4], [4, 5], [4, 6],
  [5, 5], [5, 6],
  [6, 6],
]);

class HttpsError extends Error {
  constructor(code, message, details = undefined) {
    super(String(message || "Erreur"));
    this.name = "HttpsError";
    this.code = String(code || "internal");
    this.details = details && typeof details === "object" ? details : undefined;
    this.httpStatus = mapHttpsErrorStatus(this.code);
  }
}

function mapHttpsErrorStatus(code = "") {
  switch (String(code || "").trim().toLowerCase()) {
    case "invalid-argument": return 400;
    case "unauthenticated": return 401;
    case "permission-denied": return 403;
    case "not-found": return 404;
    case "already-exists": return 409;
    case "aborted": return 409;
    case "failed-precondition": return 412;
    case "resource-exhausted": return 429;
    default: return 500;
  }
}

function duelV2RoomRef(roomId = "") {
  const safeRoomId = String(roomId || "").trim();
  return safeRoomId
    ? db.collection(DUEL_V2_ROOMS_COLLECTION).doc(safeRoomId)
    : db.collection(DUEL_V2_ROOMS_COLLECTION).doc();
}

function duelV2ActionRef(roomId = "", actionId = "") {
  return duelV2RoomRef(roomId).collection(DUEL_V2_ACTIONS_SUBCOLLECTION).doc(String(actionId || "").trim());
}

function duelV2GameStateRef(roomId = "") {
  return db.collection(DUEL_V2_GAME_STATES_COLLECTION).doc(String(roomId || "").trim());
}

function duelRoomResultRef(roomId = "") {
  return db.collection(DUEL_ROOM_RESULTS_COLLECTION).doc(String(roomId || "").trim());
}

function duelV2MatchmakingPoolRef(stakeKey = "stake_25") {
  const safeStakeKey = String(stakeKey || "stake_25").trim() || "stake_25";
  return db.collection(DUEL_V2_MATCHMAKING_POOLS_COLLECTION).doc(safeStakeKey);
}

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

function randomCode(size = FRIEND_ROOM_CODE_SIZE) {
  let out = "";
  const targetSize = Math.max(4, safeInt(size) || FRIEND_ROOM_CODE_SIZE);
  for (let i = 0; i < targetSize; i += 1) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

function pickPublicDuelBotName() {
  const randomIndex = crypto.randomInt(0, PUBLIC_DUEL_BOT_NAMES.length);
  return String(PUBLIC_DUEL_BOT_NAMES[randomIndex] || "march56").trim() || "march56";
}

function getTileValues(tileId) {
  const safeTileId = safeSignedInt(tileId, -1);
  return safeTileId >= 0 && safeTileId < TILE_VALUES.length ? TILE_VALUES[safeTileId] : null;
}

function makeDeckOrder() {
  const arr = Array.from({ length: 28 }, (_, i) => i);
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

function normalizePrivateDeckOrder(raw) {
  if (!Array.isArray(raw) || raw.length !== 28) return [];
  const seen = new Set();
  const out = [];
  for (let i = 0; i < raw.length; i += 1) {
    const tileId = safeSignedInt(raw[i], -1);
    if (tileId < 0 || tileId >= 28 || seen.has(tileId)) return [];
    seen.add(tileId);
    out.push(tileId);
  }
  return out.length === 28 ? out : [];
}

function buildDuelSeatHands(deckOrder = []) {
  const safeDeck = normalizePrivateDeckOrder(deckOrder);
  return [
    safeDeck.slice(0, 7),
    safeDeck.slice(7, 14),
  ];
}

function buildDuelStockPile(deckOrder = []) {
  const safeDeck = normalizePrivateDeckOrder(deckOrder);
  return safeDeck.slice(14, 28);
}

function cloneDuelSeatHands(seatHands) {
  return [0, 1].map((seat) => Array.isArray(seatHands?.[seat]) ? seatHands[seat].slice() : []);
}

function readStoredDuelSeatHand(raw, seat) {
  if (Array.isArray(raw?.[seat])) return raw[seat];
  if (Array.isArray(raw?.[`seat${seat}`])) return raw[`seat${seat}`];
  if (Array.isArray(raw?.[String(seat)])) return raw[String(seat)];
  return null;
}

function serializeDuelSeatHands(seatHands) {
  const cloned = cloneDuelSeatHands(seatHands);
  return {
    seat0: cloned[0],
    seat1: cloned[1],
  };
}

function normalizeDuelSeatHands(raw, fallbackDeckOrder = []) {
  const fallback = buildDuelSeatHands(fallbackDeckOrder);
  return [0, 1].map((seat) => {
    const hand = readStoredDuelSeatHand(raw, seat);
    if (!Array.isArray(hand)) return fallback[seat].slice();
    return hand
      .map((tileId) => safeSignedInt(tileId, -1))
      .filter((tileId) => tileId >= 0 && tileId < 28);
  });
}

function normalizeDuelStockPile(raw, fallbackDeckOrder = []) {
  const fallback = buildDuelStockPile(fallbackDeckOrder);
  if (!Array.isArray(raw)) return fallback;
  return raw
    .map((tileId) => safeSignedInt(tileId, -1))
    .filter((tileId) => tileId >= 0 && tileId < 28);
}

function findDuelSeatSlotByTileId(seatHands, seat, tileId) {
  const hand = Array.isArray(seatHands?.[seat]) ? seatHands[seat] : [];
  return hand.findIndex((value) => safeSignedInt(value, -1) === safeSignedInt(tileId, -1));
}

function countRemainingTilesForDuelSeat(seatHands, seat) {
  const hand = Array.isArray(seatHands?.[seat]) ? seatHands[seat] : [];
  return hand.length;
}

function sumDuelSeatPips(seatHands, seat) {
  const hand = Array.isArray(seatHands?.[seat]) ? seatHands[seat] : [];
  return hand.reduce((sum, tileId) => {
    const values = getTileValues(tileId);
    return values ? sum + values[0] + values[1] : sum;
  }, 0);
}

function computeBlockedWinnerSeatForDuel(seatHands) {
  const score0 = sumDuelSeatPips(seatHands, 0);
  const score1 = sumDuelSeatPips(seatHands, 1);
  return score1 < score0 ? 1 : 0;
}

function compareDuelOpeningTiles(leftTileId, rightTileId) {
  const leftValues = getTileValues(leftTileId) || [0, 0];
  const rightValues = getTileValues(rightTileId) || [0, 0];
  const leftIsDouble = leftValues[0] === leftValues[1];
  const rightIsDouble = rightValues[0] === rightValues[1];
  if (leftIsDouble !== rightIsDouble) return leftIsDouble ? 1 : -1;
  if (leftIsDouble && rightIsDouble) {
    if (leftValues[0] !== rightValues[0]) return leftValues[0] > rightValues[0] ? 1 : -1;
    return 0;
  }
  const leftSum = leftValues[0] + leftValues[1];
  const rightSum = rightValues[0] + rightValues[1];
  if (leftSum !== rightSum) return leftSum > rightSum ? 1 : -1;
  const leftHigh = Math.max(leftValues[0], leftValues[1]);
  const rightHigh = Math.max(rightValues[0], rightValues[1]);
  if (leftHigh !== rightHigh) return leftHigh > rightHigh ? 1 : -1;
  return 0;
}

function resolveDuelOpeningConfig(seatHands = [[], []]) {
  let bestSeat = 0;
  let bestTileId = -1;
  for (let seat = 0; seat < 2; seat += 1) {
    const hand = Array.isArray(seatHands?.[seat]) ? seatHands[seat] : [];
    for (const tileId of hand) {
      if (bestTileId < 0 || compareDuelOpeningTiles(tileId, bestTileId) > 0) {
        bestTileId = tileId;
        bestSeat = seat;
      }
    }
  }
  const values = getTileValues(bestTileId) || [0, 0];
  const openingReason = values[0] === values[1] ? "highest_double" : "highest_tile";
  return {
    seat: bestSeat,
    tileId: bestTileId,
    reason: openingReason,
  };
}

function buildDuelHandProfile(hand = []) {
  const tiles = Array.isArray(hand) ? hand : [];
  const valueCounts = new Map();
  let pips = 0;
  let doubles = 0;
  let strongTiles = 0;
  tiles.forEach((tileId) => {
    const values = getTileValues(tileId);
    if (!values) return;
    pips += values[0] + values[1];
    if (values[0] === values[1]) doubles += 1;
    if ((values[0] + values[1]) >= 9) strongTiles += 1;
    valueCounts.set(values[0], (valueCounts.get(values[0]) || 0) + 1);
    if (values[1] !== values[0]) {
      valueCounts.set(values[1], (valueCounts.get(values[1]) || 0) + 1);
    }
  });
  const distinctValues = valueCounts.size;
  const maxValueFrequency = Array.from(valueCounts.values()).reduce((max, count) => Math.max(max, count), 0);
  return {
    size: tiles.length,
    pips,
    doubles,
    strongTiles,
    distinctValues,
    maxValueFrequency,
  };
}

function isCredibleRiggedHumanHand(profile = {}) {
  return (
    safeInt(profile.size) === 7
    && safeInt(profile.distinctValues) >= 4
    && safeInt(profile.maxValueFrequency) <= 5
    && safeInt(profile.pips) >= 30
    && safeInt(profile.pips) <= 54
    && safeInt(profile.doubles) <= 3
  );
}

function scoreRiggedHumanHandNormality(profile = {}, targetDoubles = 1) {
  let score = 0;
  score -= Math.abs(safeInt(profile.pips) - 42) * 7;
  score -= Math.abs(safeInt(profile.distinctValues) - 5) * 26;
  score -= Math.abs(safeInt(profile.maxValueFrequency) - 3) * 18;
  score -= Math.abs(safeInt(profile.doubles) - safeInt(targetDoubles, 1)) * 34;
  return score;
}

function canDuelTilePlayOnEnds(tileId, leftEnd = -1, rightEnd = -1) {
  const values = getTileValues(tileId);
  if (!values) return false;
  return (
    safeSignedInt(leftEnd, -1) < 0
    || safeSignedInt(rightEnd, -1) < 0
    || values[0] === leftEnd
    || values[1] === leftEnd
    || values[0] === rightEnd
    || values[1] === rightEnd
  );
}

function buildDuelHandValueCounts(hand = []) {
  const counts = new Map();
  const tiles = Array.isArray(hand) ? hand : [];
  tiles.forEach((tileId) => {
    const values = getTileValues(tileId);
    if (!values) return;
    counts.set(values[0], (counts.get(values[0]) || 0) + 1);
    counts.set(values[1], (counts.get(values[1]) || 0) + 1);
  });
  return counts;
}

function scoreRiggedStockTile(tileId, context = {}) {
  const values = getTileValues(tileId) || [0, 0];
  const leftEnd = safeSignedInt(context.leftEnd, -1);
  const rightEnd = safeSignedInt(context.rightEnd, -1);
  const currentSeat = safeSignedInt(context.currentSeat, -1);
  const forcedDrawSeat = safeSignedInt(context.forcedDrawSeat, -1);
  const botSeat = safeSignedInt(context.botSeat, -1);
  const humanSeat = safeSignedInt(context.humanSeat, -1);
  const botCounts = context.botValueCounts instanceof Map ? context.botValueCounts : new Map();
  const humanCounts = context.humanValueCounts instanceof Map ? context.humanValueCounts : new Map();
  const playableNow = canDuelTilePlayOnEnds(tileId, leftEnd, rightEnd);
  const botSynergy = (botCounts.get(values[0]) || 0) + (botCounts.get(values[1]) || 0);
  const humanSynergy = (humanCounts.get(values[0]) || 0) + (humanCounts.get(values[1]) || 0);
  const pipSum = values[0] + values[1];

  let score = 0;
  score += (botSynergy - humanSynergy) * 28;
  score += pipSum * 3;
  if (values[0] === values[1]) score += 12;
  if (playableNow) {
    score += currentSeat === botSeat ? 26 : -22;
    if (forcedDrawSeat === botSeat) score += 260;
    if (forcedDrawSeat === humanSeat) score -= 220;
  } else {
    score += currentSeat === humanSeat ? 16 : -8;
    if (forcedDrawSeat === humanSeat) score += 170;
    if (forcedDrawSeat === botSeat) score -= 140;
  }
  return {
    tileId,
    score,
    playableNow,
    botSynergy,
    humanSynergy,
    pipSum,
    tie: crypto.randomInt(0, 1000),
  };
}

function reorderRiggedStockForDominov1(stockPile = [], liveState = {}, room = {}) {
  const stock = Array.isArray(stockPile) ? stockPile.slice() : [];
  if (stock.length <= 1) return stock;

  const botSeat = getDuelBotSeat(room);
  const humanSeat = getOtherDuelSeat(botSeat);
  const currentSeat = safeSignedInt(liveState.currentPlayer, humanSeat);
  const forcedDrawSeat = getLegalMovesForDuelSeat(liveState, currentSeat).length <= 0 ? currentSeat : -1;
  const context = {
    leftEnd: liveState.leftEnd,
    rightEnd: liveState.rightEnd,
    currentSeat,
    forcedDrawSeat,
    botSeat,
    humanSeat,
    botValueCounts: buildDuelHandValueCounts(liveState.seatHands?.[botSeat]),
    humanValueCounts: buildDuelHandValueCounts(liveState.seatHands?.[humanSeat]),
  };

  const ranked = stock.map((tileId) => scoreRiggedStockTile(tileId, context));
  ranked.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return right.tie - left.tie;
  });

  if (forcedDrawSeat === humanSeat) {
    const dead = ranked.filter((item) => !item.playableNow);
    const live = ranked.filter((item) => item.playableNow)
      .sort((left, right) => {
        const leftPenalty = (left.humanSynergy * 30) - (left.botSynergy * 18) + left.pipSum;
        const rightPenalty = (right.humanSynergy * 30) - (right.botSynergy * 18) + right.pipSum;
        if (leftPenalty !== rightPenalty) return leftPenalty - rightPenalty;
        return left.tie - right.tie;
      });
    const topDeadCount = dead.length > 0 ? Math.min(dead.length, crypto.randomInt(1, Math.min(3, dead.length) + 1)) : 0;
    const front = [];
    front.push(...dead.slice(0, topDeadCount));
    if (live.length > 0) front.push(live[0]);
    const used = new Set(front.map((item) => item.tileId));
    const rest = ranked.filter((item) => !used.has(item.tileId));
    return front.concat(rest).map((item) => item.tileId);
  }

  if (forcedDrawSeat === botSeat) {
    const live = ranked.filter((item) => item.playableNow);
    const dead = ranked.filter((item) => !item.playableNow);
    const topLiveCount = live.length > 0 ? Math.min(live.length, crypto.randomInt(1, Math.min(3, live.length) + 1)) : 0;
    const front = [];
    front.push(...live.slice(0, topLiveCount));
    if (dead.length > 0) front.push(dead[0]);
    const used = new Set(front.map((item) => item.tileId));
    const rest = ranked.filter((item) => !used.has(item.tileId));
    return front.concat(rest).map((item) => item.tileId);
  }

  return ranked.map((item) => item.tileId);
}

function buildRiggedPublicBotDeckOrder(room = {}) {
  const botSeat = getDuelBotSeat(room);
  const humanSeat = getOtherDuelSeat(botSeat);
  const preferHumanOpening = crypto.randomInt(0, 100) < 14;
  const targetHumanDoubles = crypto.randomInt(0, 100) < 58 ? 1 : 2;
  let bestDeck = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let attempt = 0; attempt < 180; attempt += 1) {
    const candidateDeck = makeDeckOrder();
    const initialState = createInitialDuelGameState(room, candidateDeck);
    const humanHand = Array.isArray(initialState.seatHands?.[humanSeat]) ? initialState.seatHands[humanSeat] : [];
    const botHand = Array.isArray(initialState.seatHands?.[botSeat]) ? initialState.seatHands[botSeat] : [];
    const humanProfile = buildDuelHandProfile(humanHand);
    const botProfile = buildDuelHandProfile(botHand);
    if (!isCredibleRiggedHumanHand(humanProfile)) continue;

    const openingConfig = resolveDuelOpeningConfig(initialState.seatHands);
    const openingMove = buildOpeningMoveForDuelState(initialState);
    const openingApplied = applyResolvedDuelMove(initialState, room, openingMove, "rig:opening");
    const botProgress = runPublicDuelBotTurns(openingApplied.state, room);
    const postOpeningState = botProgress.state;
    const stockVision = buildDuelStockVisionProfile(postOpeningState, botSeat);
    const postOpeningScore = scoreDuelBotPosition(postOpeningState, room, botSeat);
    const botThreat = countImmediateWinningMovesForDuelSeat(postOpeningState, room, botSeat);
    const humanThreat = countImmediateWinningMovesForDuelSeat(postOpeningState, room, humanSeat);
    const pipDelta = safeInt(humanProfile.pips) - safeInt(botProfile.pips);

    let candidateScore = 0;
    candidateScore += postOpeningScore;
    candidateScore += pipDelta * 18;
    candidateScore += (safeInt(botProfile.strongTiles) - safeInt(humanProfile.strongTiles)) * 34;
    candidateScore += scoreRiggedHumanHandNormality(humanProfile, targetHumanDoubles);
    candidateScore += stockVision.playableTop5 * 28;
    candidateScore += stockVision.playableAll * 5;
    candidateScore += stockVision.humanPressureOnEnds <= stockVision.botPressureOnEnds ? 70 : -70;
    candidateScore += (botThreat.winCount * 160) + (botThreat.blockCount * 85);
    candidateScore -= (humanThreat.winCount * 210) + (humanThreat.blockCount * 120);
    candidateScore += openingConfig.seat === humanSeat
      ? (preferHumanOpening ? 180 : -35)
      : (preferHumanOpening ? -120 : 90);

    if (pipDelta < 4) candidateScore -= 260;
    if (pipDelta > 22) candidateScore -= 180;
    if (safeInt(botProfile.doubles) >= 4) candidateScore -= 110;
    if (safeInt(botProfile.maxValueFrequency) >= 6) candidateScore -= 90;
    if (safeInt(humanProfile.doubles) === 0) candidateScore -= 55;
    if (openingConfig.seat === botSeat && compareDuelOpeningTiles(openingConfig.tileId, 27) >= 0) {
      candidateScore -= 60;
    }

    if (candidateScore > bestScore || !bestDeck) {
      bestScore = candidateScore;
      bestDeck = [
        ...initialState.seatHands[0],
        ...initialState.seatHands[1],
        ...reorderRiggedStockForDominov1(initialState.stockPile, postOpeningState, room),
      ];
    }
  }

  return bestDeck || makeDeckOrder();
}

function makeDeckOrderForRoom(room = {}) {
  if (!isPublicBotOnlyDuelV2Room(room)) return makeDeckOrder();
  const difficulty = normalizeDuelBotDifficultyLevel(room.botDifficulty || PUBLIC_DUEL_BOT_DEFAULT_DIFFICULTY);
  if (difficulty !== "dominov1") return makeDeckOrder();
  return buildRiggedPublicBotDeckOrder(room);
}

function getLegalMovesForDuelSeat(state, seat) {
  const safeSeat = safeSignedInt(seat, -1);
  const hand = Array.isArray(state?.seatHands?.[safeSeat]) ? state.seatHands[safeSeat] : [];
  if (!hand.length) return [];
  const leftEnd = safeSignedInt(state?.leftEnd, -1);
  const rightEnd = safeSignedInt(state?.rightEnd, -1);
  if (leftEnd < 0 || rightEnd < 0) {
    return [];
  }
  const out = [];
  hand.forEach((tileId, index) => {
    const values = getTileValues(tileId);
    if (!values) return;
    if (values[0] === leftEnd || values[1] === leftEnd) {
      out.push({
        seat: safeSeat,
        tileId,
        tilePos: index,
        branch: "izquierda",
        tileLeft: values[0],
        tileRight: values[1],
      });
    }
    if (values[0] === rightEnd || values[1] === rightEnd) {
      out.push({
        seat: safeSeat,
        tileId,
        tilePos: index,
        branch: "derecha",
        tileLeft: values[0],
        tileRight: values[1],
      });
    }
  });
  return out;
}

function createInitialDuelGameState(room = {}, deckOrder = []) {
  const cleanDeckOrder = normalizePrivateDeckOrder(deckOrder);
  const seatHands = buildDuelSeatHands(cleanDeckOrder);
  const stockPile = buildDuelStockPile(cleanDeckOrder);
  const openingConfig = resolveDuelOpeningConfig(seatHands);
  return {
    deckOrder: cleanDeckOrder,
    seatHands,
    stockPile,
    leftEnd: -1,
    rightEnd: -1,
    passesInRow: 0,
    appliedActionSeq: -1,
    currentPlayer: openingConfig.seat,
    winnerSeat: -1,
    winnerUid: "",
    endedReason: "",
    idempotencyKeys: {},
    openingSeat: openingConfig.seat,
    openingTileId: openingConfig.tileId,
    openingReason: openingConfig.reason,
    actionCountsBySeat: [0, 0],
  };
}

function normalizeDuelGameState(raw = {}, room = {}) {
  const deckOrder = normalizePrivateDeckOrder(raw.deckOrder || room.deckOrder || []);
  const state = {
    deckOrder,
    seatHands: normalizeDuelSeatHands(raw.seatHands, deckOrder),
    stockPile: normalizeDuelStockPile(raw.stockPile, deckOrder),
    leftEnd: safeSignedInt(raw.leftEnd, -1),
    rightEnd: safeSignedInt(raw.rightEnd, -1),
    passesInRow: Math.max(0, safeInt(raw.passesInRow)),
    appliedActionSeq: safeSignedInt(raw.appliedActionSeq, -1),
    currentPlayer: safeSignedInt(raw.currentPlayer, 0),
    winnerSeat: safeSignedInt(raw.winnerSeat, -1),
    winnerUid: String(raw.winnerUid || "").trim(),
    endedReason: String(raw.endedReason || "").trim(),
    idempotencyKeys: raw.idempotencyKeys && typeof raw.idempotencyKeys === "object" ? { ...raw.idempotencyKeys } : {},
    openingSeat: safeSignedInt(raw.openingSeat, safeSignedInt(room.openingSeat, -1)),
    openingTileId: safeSignedInt(raw.openingTileId, safeSignedInt(room.openingTileId, -1)),
    openingReason: String(raw.openingReason || room.openingReason || "").trim(),
    actionCountsBySeat: Array.isArray(raw.actionCountsBySeat)
      ? [Math.max(0, safeInt(raw.actionCountsBySeat[0])), Math.max(0, safeInt(raw.actionCountsBySeat[1]))]
      : [0, 0],
  };
  return state;
}

function didBothSeatsActInDuel(state = {}) {
  const counts = Array.isArray(state.actionCountsBySeat) ? state.actionCountsBySeat : [0, 0];
  return safeInt(counts[0]) > 0 && safeInt(counts[1]) > 0;
}

function getOtherDuelSeat(seat) {
  return safeSignedInt(seat, 0) === 0 ? 1 : 0;
}

function normalizeDuelBotDifficultyLevel(value = "") {
  const level = String(value || "").trim().toLowerCase();
  if (level === "dominov1" || level === "v1" || level === "expert" || level === "ultra") return "dominov1";
  if (level === "userpro" || level === "amateur") return "userpro";
  return PUBLIC_DUEL_BOT_DEFAULT_DIFFICULTY;
}

function countMatchingEndsInDuelHand(hand = [], endValue = -1) {
  const safeEnd = safeSignedInt(endValue, -1);
  if (safeEnd < 0) return 0;
  return (Array.isArray(hand) ? hand : []).reduce((count, tileId) => {
    const values = getTileValues(tileId);
    return values && (values[0] === safeEnd || values[1] === safeEnd) ? count + 1 : count;
  }, 0);
}

function countDuelHandDoubles(hand = []) {
  return (Array.isArray(hand) ? hand : []).reduce((count, tileId) => {
    const values = getTileValues(tileId);
    return values && values[0] === values[1] ? count + 1 : count;
  }, 0);
}

function sumDuelEndPressureForHand(hand = [], valuesToCheck = []) {
  const targets = Array.from(new Set(
    (Array.isArray(valuesToCheck) ? valuesToCheck : [])
      .map((value) => safeSignedInt(value, -1))
      .filter((value) => value >= 0)
  ));
  return targets.reduce((sum, value) => sum + countMatchingEndsInDuelHand(hand, value), 0);
}

function buildDuelKillProfile(state = {}, seat = 1) {
  const liveState = normalizeDuelGameState(state);
  const otherSeat = getOtherDuelSeat(seat);
  const humanHand = Array.isArray(liveState.seatHands?.[otherSeat]) ? liveState.seatHands[otherSeat] : [];
  const stockSize = Array.isArray(liveState.stockPile) ? liveState.stockPile.length : 0;
  const humanCount = humanHand.length;
  const humanLegal = getLegalMovesForDuelSeat(liveState, otherSeat).length;

  let mode = "normal";
  let pressureMultiplier = 1;
  let searchBoost = 0;
  let blockBonus = 0;

  if (humanCount <= 2) {
    mode = "kill";
    pressureMultiplier = 2.2;
    searchBoost = 2;
    blockBonus = stockSize > 0 ? 260 : 1800;
  } else if (humanCount === 3) {
    mode = "panic";
    pressureMultiplier = 1.7;
    searchBoost = 1;
    blockBonus = stockSize > 0 ? 180 : 1100;
  } else if (humanCount === 4 && humanLegal <= 2) {
    mode = "tight";
    pressureMultiplier = 1.35;
    searchBoost = 1;
    blockBonus = stockSize > 0 ? 110 : 720;
  }

  return {
    mode,
    humanCount,
    humanLegal,
    stockSize,
    pressureMultiplier,
    searchBoost,
    blockBonus,
  };
}

function countPlayableTilesInStockForEnds(stockPile = [], leftEnd = -1, rightEnd = -1, limit = 0) {
  const safeLimit = Math.max(0, safeInt(limit));
  const stock = Array.isArray(stockPile) ? stockPile : [];
  const slice = safeLimit > 0 ? stock.slice(0, safeLimit) : stock.slice(0);
  return slice.reduce((count, tileId) => {
    const values = getTileValues(tileId);
    if (!values) return count;
    if (
      (leftEnd >= 0 && (values[0] === leftEnd || values[1] === leftEnd))
      || (rightEnd >= 0 && (values[0] === rightEnd || values[1] === rightEnd))
    ) {
      return count + 1;
    }
    return count;
  }, 0);
}

function buildDuelStockVisionProfile(state = {}, seat = 1) {
  const liveState = normalizeDuelGameState(state);
  const otherSeat = getOtherDuelSeat(seat);
  const stockPile = Array.isArray(liveState.stockPile) ? liveState.stockPile : [];
  const leftEnd = safeSignedInt(liveState.leftEnd, -1);
  const rightEnd = safeSignedInt(liveState.rightEnd, -1);
  const botHand = Array.isArray(liveState.seatHands?.[seat]) ? liveState.seatHands[seat] : [];
  const humanHand = Array.isArray(liveState.seatHands?.[otherSeat]) ? liveState.seatHands[otherSeat] : [];
  const topTileId = stockPile.length > 0 ? safeSignedInt(stockPile[0], -1) : -1;
  const topValues = getTileValues(topTileId);
  const topPlayableForBot = !!(topValues && (
    (leftEnd >= 0 && (topValues[0] === leftEnd || topValues[1] === leftEnd))
    || (rightEnd >= 0 && (topValues[0] === rightEnd || topValues[1] === rightEnd))
  ));

  return {
    stockSize: stockPile.length,
    topPlayableForBot,
    playableTop3: countPlayableTilesInStockForEnds(stockPile, leftEnd, rightEnd, 3),
    playableTop5: countPlayableTilesInStockForEnds(stockPile, leftEnd, rightEnd, 5),
    playableAll: countPlayableTilesInStockForEnds(stockPile, leftEnd, rightEnd, stockPile.length),
    botPressureOnEnds: sumDuelEndPressureForHand(botHand, [leftEnd, rightEnd]),
    humanPressureOnEnds: sumDuelEndPressureForHand(humanHand, [leftEnd, rightEnd]),
  };
}

function countImmediateWinningMovesForDuelSeat(state = {}, room = {}, seat = 0) {
  const safeSeat = safeSignedInt(seat, -1);
  const liveState = normalizeDuelGameState(state, room);
  if (safeSeat < 0) {
    return { winCount: 0, blockCount: 0, legalCount: 0 };
  }

  const legalMoves = getLegalMovesForDuelSeat(liveState, safeSeat);
  if (legalMoves.length <= 0) {
    return { winCount: 0, blockCount: 0, legalCount: 0 };
  }

  let winCount = 0;
  let blockCount = 0;
  for (const move of legalMoves) {
    const playMove = buildBotPlayMoveFromLegalMove(move, safeSeat);
    const applied = applyResolvedDuelMove(liveState, room, playMove, "sim:finish-scan");
    const nextState = applied.state;
    if (safeSignedInt(nextState.winnerSeat, -1) === safeSeat) {
      winCount += 1;
      continue;
    }
    const otherSeat = getOtherDuelSeat(safeSeat);
    const stockSize = Array.isArray(nextState.stockPile) ? nextState.stockPile.length : 0;
    const otherLegal = getLegalMovesForDuelSeat(nextState, otherSeat).length;
    if (stockSize <= 0 && otherLegal <= 0 && computeBlockedWinnerSeatForDuel(nextState.seatHands) === safeSeat) {
      blockCount += 1;
    }
  }

  return {
    winCount,
    blockCount,
    legalCount: legalMoves.length,
  };
}

function scoreDuelMovePressure(state = {}, room = {}, seat = 1, move = {}) {
  const liveState = normalizeDuelGameState(state, room);
  const otherSeat = getOtherDuelSeat(seat);
  const killProfile = buildDuelKillProfile(liveState, seat);
  const currentStockVision = buildDuelStockVisionProfile(liveState, seat);
  const currentHumanHand = Array.isArray(liveState.seatHands?.[otherSeat]) ? liveState.seatHands[otherSeat] : [];
  const currentBotHand = Array.isArray(liveState.seatHands?.[seat]) ? liveState.seatHands[seat] : [];
  const applied = applyResolvedDuelMove(liveState, room, buildBotPlayMoveFromLegalMove(move, seat), "sim:bot-pressure");
  const nextState = applied.state;
  const nextStockVision = buildDuelStockVisionProfile(nextState, seat);
  const nextHumanHand = Array.isArray(nextState.seatHands?.[otherSeat]) ? nextState.seatHands[otherSeat] : [];
  const nextBotHand = Array.isArray(nextState.seatHands?.[seat]) ? nextState.seatHands[seat] : [];
  const nextLeftEnd = safeSignedInt(nextState.leftEnd, -1);
  const nextRightEnd = safeSignedInt(nextState.rightEnd, -1);
  const tileValues = getTileValues(move.tileId) || [0, 0];

  const currentHumanLegal = getLegalMovesForDuelSeat(liveState, otherSeat).length;
  const nextHumanLegal = getLegalMovesForDuelSeat(nextState, otherSeat).length;
  const nextBotLegal = getLegalMovesForDuelSeat(nextState, seat).length;
  const currentHumanPressure = sumDuelEndPressureForHand(currentHumanHand, [liveState.leftEnd, liveState.rightEnd]);
  const nextHumanPressure = sumDuelEndPressureForHand(nextHumanHand, [nextLeftEnd, nextRightEnd]);
  const nextBotPressure = sumDuelEndPressureForHand(nextBotHand, [nextLeftEnd, nextRightEnd]);
  const currentHumanDoubles = countDuelHandDoubles(currentHumanHand);
  const nextHumanDoubles = countDuelHandDoubles(nextHumanHand);
  const nextHumanPips = sumDuelSeatPips(nextState.seatHands, otherSeat);
  const nextBotPips = sumDuelSeatPips(nextState.seatHands, seat);
  const nextStockSize = Array.isArray(nextState.stockPile) ? nextState.stockPile.length : 0;
  const nextHumanFinishThreat = (
    nextHumanHand.length <= 3
    || nextHumanLegal <= 2
    || nextStockSize <= 2
  )
    ? countImmediateWinningMovesForDuelSeat(nextState, room, otherSeat)
    : { winCount: 0, blockCount: 0, legalCount: nextHumanLegal };
  const nextBotCounterThreat = (
    nextBotHand.length <= 3
    || nextBotLegal <= 2
    || nextStockSize <= 2
  )
    ? countImmediateWinningMovesForDuelSeat(nextState, room, seat)
    : { winCount: 0, blockCount: 0, legalCount: nextBotLegal };

  let pressureScore = 0;
  pressureScore += (currentHumanLegal - nextHumanLegal) * 145;
  pressureScore += (currentHumanPressure - nextHumanPressure) * 52;
  pressureScore += (nextBotPressure - nextHumanPressure) * 24;
  pressureScore += (currentHumanDoubles - nextHumanDoubles) * 75;
  pressureScore += (nextBotLegal - nextHumanLegal) * 38;
  pressureScore += (nextHumanPips - nextBotPips) * 4;
  pressureScore += (currentStockVision.playableTop5 - nextStockVision.playableTop5) * 16;
  pressureScore += (currentStockVision.playableAll - nextStockVision.playableAll) * 5;

  if (nextHumanLegal === 0) pressureScore += Array.isArray(nextState.stockPile) && nextState.stockPile.length > 0 ? 240 : 1250;
  if (nextHumanLegal <= 1) pressureScore += 130;
  if (nextBotLegal <= 1) pressureScore -= 115;
  if (nextLeftEnd >= 0 && nextRightEnd >= 0 && nextLeftEnd === nextRightEnd) {
    pressureScore += countMatchingEndsInDuelHand(nextBotHand, nextLeftEnd) * 28;
    pressureScore -= countMatchingEndsInDuelHand(nextHumanHand, nextLeftEnd) * 44;
  }
  if (tileValues[0] === tileValues[1]) pressureScore -= 22;
  if (
    tileValues[0] !== tileValues[1]
    && (
      countMatchingEndsInDuelHand(currentHumanHand, tileValues[0]) > 0
      || countMatchingEndsInDuelHand(currentHumanHand, tileValues[1]) > 0
    )
  ) {
    pressureScore += 18;
  }
  if (killProfile.mode !== "normal") {
    pressureScore += (currentHumanHand.length - nextHumanHand.length) * 40;
    pressureScore += (killProfile.humanLegal - nextHumanLegal) * 70;
    if (nextHumanLegal <= 1) pressureScore += 180 * killProfile.pressureMultiplier;
    if (nextHumanLegal === 0) pressureScore += killProfile.blockBonus;
    if (nextStockVision.topPlayableForBot === true) pressureScore += 35;
    if (nextBotLegal >= 2) pressureScore += 45;
  }
  if (nextHumanFinishThreat.winCount > 0) {
    pressureScore -= nextHumanFinishThreat.winCount * 920;
  }
  if (nextHumanFinishThreat.blockCount > 0) {
    pressureScore -= nextHumanFinishThreat.blockCount * 420;
  }
  if (nextBotCounterThreat.winCount > 0) {
    pressureScore += nextBotCounterThreat.winCount * 180;
  }
  if (nextBotCounterThreat.blockCount > 0) {
    pressureScore += nextBotCounterThreat.blockCount * 110;
  }
  return pressureScore * killProfile.pressureMultiplier;
}

function buildBotPlayMoveFromLegalMove(move = {}, seat = 1) {
  return {
    type: "play",
    player: safeSignedInt(seat, 1),
    tileId: safeSignedInt(move.tileId, -1),
    tilePos: safeSignedInt(move.tilePos, -1),
    tileLeft: safeSignedInt(move.tileLeft, -1),
    tileRight: safeSignedInt(move.tileRight, -1),
    branch: String(move.branch || "").trim(),
  };
}

function scoreDuelBotPosition(state = {}, room = {}, botSeat = 1) {
  const liveState = normalizeDuelGameState(state, room);
  const humanSeat = getOtherDuelSeat(botSeat);
  const killProfile = buildDuelKillProfile(liveState, botSeat);
  const stockVision = buildDuelStockVisionProfile(liveState, botSeat);
  if (String(liveState.endedReason || "").trim()) {
    if (safeSignedInt(liveState.winnerSeat, -1) === botSeat) return 1000000;
    if (safeSignedInt(liveState.winnerSeat, -1) === humanSeat) return -1000000;
    return -25000;
  }

  const botHand = Array.isArray(liveState.seatHands?.[botSeat]) ? liveState.seatHands[botSeat] : [];
  const humanHand = Array.isArray(liveState.seatHands?.[humanSeat]) ? liveState.seatHands[humanSeat] : [];
  const botPips = sumDuelSeatPips(liveState.seatHands, botSeat);
  const humanPips = sumDuelSeatPips(liveState.seatHands, humanSeat);
  const botLegal = getLegalMovesForDuelSeat(liveState, botSeat).length;
  const humanLegal = getLegalMovesForDuelSeat(liveState, humanSeat).length;
  const leftEnd = safeSignedInt(liveState.leftEnd, -1);
  const rightEnd = safeSignedInt(liveState.rightEnd, -1);
  const botLeftMatches = countMatchingEndsInDuelHand(botHand, leftEnd);
  const botRightMatches = countMatchingEndsInDuelHand(botHand, rightEnd);
  const humanLeftMatches = countMatchingEndsInDuelHand(humanHand, leftEnd);
  const humanRightMatches = countMatchingEndsInDuelHand(humanHand, rightEnd);
  const botDoubles = countDuelHandDoubles(botHand);
  const humanDoubles = countDuelHandDoubles(humanHand);
  const stockSize = Array.isArray(liveState.stockPile) ? liveState.stockPile.length : 0;
  const botFinishThreat = (
    botHand.length <= 3
    || botLegal <= 2
    || stockSize <= 2
  )
    ? countImmediateWinningMovesForDuelSeat(liveState, room, botSeat)
    : { winCount: 0, blockCount: 0, legalCount: botLegal };
  const humanFinishThreat = (
    humanHand.length <= 3
    || humanLegal <= 2
    || stockSize <= 2
  )
    ? countImmediateWinningMovesForDuelSeat(liveState, room, humanSeat)
    : { winCount: 0, blockCount: 0, legalCount: humanLegal };

  let score = 0;
  score += (humanPips - botPips) * 12;
  score += (humanHand.length - botHand.length) * 48;
  score += (botLegal * 24) - (humanLegal * 34);
  score += ((botLeftMatches + botRightMatches) * 11) - ((humanLeftMatches + humanRightMatches) * 17);
  score += (humanDoubles - botDoubles) * 34;
  score += safeSignedInt(liveState.currentPlayer, -1) === botSeat ? 10 : -8;
  if (leftEnd >= 0 && rightEnd >= 0 && leftEnd === rightEnd) {
    score += ((botLeftMatches + botRightMatches) - (humanLeftMatches + humanRightMatches)) * 9;
  }
  if (leftEnd >= 0 && rightEnd >= 0) {
    score += (sumDuelEndPressureForHand(botHand, [leftEnd, rightEnd]) - sumDuelEndPressureForHand(humanHand, [leftEnd, rightEnd])) * 12;
  }
  score += (stockVision.playableTop3 * 18) + (stockVision.playableTop5 * 10) + (stockVision.playableAll * 3);
  score += (stockVision.botPressureOnEnds - stockVision.humanPressureOnEnds) * 4;
  if (killProfile.mode === "normal" && stockVision.topPlayableForBot === true) score += 6;
  if (humanLegal <= 0) {
    if (stockSize <= 0) {
      const blockedWinnerSeat = computeBlockedWinnerSeatForDuel(liveState.seatHands);
      score += blockedWinnerSeat === botSeat ? 3200 : -3200;
    } else {
      score += 180;
    }
  }
  if (stockSize <= 0) {
    const blockedWinnerSeat = computeBlockedWinnerSeatForDuel(liveState.seatHands);
    score += blockedWinnerSeat === botSeat ? 640 : -640;
  }
  if (humanLegal <= 1) score += 120;
  if (botLegal <= 1) score -= 90;
  if (killProfile.mode !== "normal") {
    score += (5 - Math.min(killProfile.humanCount, 5)) * 90;
    score += Math.max(0, 3 - humanLegal) * 85;
    if (humanLegal === 0) score += killProfile.blockBonus;
    if (botLegal >= 2) score += 60;
    if (botPips <= humanPips) score += 55;
  }
  score += botFinishThreat.winCount * 540;
  score += botFinishThreat.blockCount * 220;
  score -= humanFinishThreat.winCount * 760;
  score -= humanFinishThreat.blockCount * 280;
  return score;
}

function listDuelTurnCandidates(state = {}, room = {}, seat = 0) {
  const safeSeat = safeSignedInt(seat, -1);
  const liveState = normalizeDuelGameState(state, room);
  const legalMoves = getLegalMovesForDuelSeat(liveState, safeSeat);
  if (legalMoves.length > 0) {
    return legalMoves.map((move) => buildBotPlayMoveFromLegalMove(move, safeSeat));
  }
  if (Array.isArray(liveState.stockPile) && liveState.stockPile.length > 0) {
    return [buildDuelDrawMove(safeSeat, liveState.stockPile[0])];
  }
  return [buildDuelPassMove(safeSeat)];
}

function evaluateDuelBotFuture(state = {}, room = {}, botSeat = 1, depth = 0, alpha = Number.NEGATIVE_INFINITY, beta = Number.POSITIVE_INFINITY) {
  const liveState = normalizeDuelGameState(state, room);
  if (depth <= 0 || String(liveState.endedReason || "").trim()) {
    return scoreDuelBotPosition(liveState, room, botSeat);
  }

  const actorSeat = safeSignedInt(liveState.currentPlayer, -1);
  if (actorSeat < 0) {
    return scoreDuelBotPosition(liveState, room, botSeat);
  }
  const candidates = listDuelTurnCandidates(liveState, room, actorSeat);
  if (candidates.length <= 0) {
    return scoreDuelBotPosition(liveState, room, botSeat);
  }

  const maximizing = actorSeat === botSeat;
  let bestScore = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;

  for (const move of candidates) {
    const simulated = applyResolvedDuelMove(
      liveState,
      room,
      move,
      maximizing ? "sim:bot-search" : "sim:human-search"
    );
    const nextScore = evaluateDuelBotFuture(simulated.state, room, botSeat, depth - 1, alpha, beta);
    if (maximizing) {
      if (nextScore > bestScore) bestScore = nextScore;
      if (nextScore > alpha) alpha = nextScore;
    } else {
      if (nextScore < bestScore) bestScore = nextScore;
      if (nextScore < beta) beta = nextScore;
    }
    if (beta <= alpha) break;
  }

  return Number.isFinite(bestScore) ? bestScore : scoreDuelBotPosition(liveState, room, botSeat);
}

function pickDominov1BotMove(state = {}, room = {}, seat = 1, legalMoves = []) {
  const killProfile = buildDuelKillProfile(state, seat);
  const scoredMoves = legalMoves.map((move) => {
    const playMove = buildBotPlayMoveFromLegalMove(move, seat);
    const applied = applyResolvedDuelMove(state, room, playMove, "sim:bot-play");
    const tileValues = getTileValues(move.tileId) || [0, 0];
    const searchDepthBase = legalMoves.length <= 2 ? 7 : (legalMoves.length <= 4 ? 6 : 5);
    const searchDepth = searchDepthBase + killProfile.searchBoost;
    let score = evaluateDuelBotFuture(applied.state, room, seat, searchDepth);
    score += scoreDuelBotPosition(applied.state, room, seat) * 0.22;
    score += scoreDuelMovePressure(state, room, seat, move);
    score += (tileValues[0] + tileValues[1]) * 4;
    if (tileValues[0] === tileValues[1]) score += 10;
    if (killProfile.mode !== "normal") {
      const nextHumanLegal = getLegalMovesForDuelSeat(applied.state, getOtherDuelSeat(seat)).length;
      if (nextHumanLegal <= 1) score += 150 * killProfile.pressureMultiplier;
      if (nextHumanLegal === 0) score += killProfile.blockBonus;
    }
    if ((Array.isArray(applied.state.stockPile) ? applied.state.stockPile.length : 0) <= 2) {
      const finishThreat = countImmediateWinningMovesForDuelSeat(applied.state, room, getOtherDuelSeat(seat));
      score -= finishThreat.winCount * 1100;
      score -= finishThreat.blockCount * 480;
    }
    return {
      move,
      score,
      tie: crypto.randomInt(0, 1000),
    };
  });

  scoredMoves.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    return right.tie - left.tie;
  });

  return scoredMoves.length > 0 ? scoredMoves[0].move : null;
}

function isPublicBotOnlyDuelV2Room(room = {}) {
  return (
    String(room.roomMode || "").trim() === "duel_v2_public"
    && room.allowBots === true
    && safeInt(room.botCount, 0) > 0
  );
}

function getDuelBotSeat(room = {}) {
  if (!isPublicBotOnlyDuelV2Room(room)) return -1;
  return 1;
}

function buildOpeningMoveForDuelState(state) {
  const seat = safeSignedInt(state?.openingSeat, safeSignedInt(state?.currentPlayer, 0));
  const tileId = safeSignedInt(state?.openingTileId, -1);
  const values = getTileValues(tileId);
  if (!values) {
    throw new HttpsError("failed-precondition", "Aperti duel la pa valab.");
  }
  const tilePos = findDuelSeatSlotByTileId(state.seatHands, seat, tileId);
  if (tilePos < 0) {
    throw new HttpsError("failed-precondition", "Tuile d'ouverture introuvable.");
  }
  return {
    type: "play",
    player: seat,
    tileId,
    tilePos,
    tileLeft: values[0],
    tileRight: values[1],
    branch: "centro",
  };
}

function buildDuelPassMove(seat) {
  return {
    type: "pass",
    player: safeSignedInt(seat, 0),
  };
}

function buildDuelDrawMove(seat, tileId = null) {
  return {
    type: "draw",
    player: safeSignedInt(seat, 0),
    drawnTileIds: tileId == null ? [] : [safeSignedInt(tileId, -1)].filter((value) => value >= 0),
  };
}

function buildDuelV2TimeoutState(state = {}, room = {}) {
  const liveState = normalizeDuelGameState(state, room);
  const timedOutSeat = safeSignedInt(liveState.currentPlayer, -1);
  if (!didBothSeatsActInDuel(liveState)) {
    return {
      ...liveState,
      winnerSeat: -1,
      winnerUid: "",
      endedReason: "timeout_refund",
    };
  }
  const winnerSeat = timedOutSeat < 0 ? -1 : getOtherDuelSeat(timedOutSeat);
  const winnerUid = winnerSeat >= 0 ? String((room.playerUids || [])[winnerSeat] || "").trim() : "";
  return {
    ...liveState,
    winnerSeat,
    winnerUid,
    endedReason: "timeout",
    currentPlayer: winnerSeat >= 0 ? winnerSeat : liveState.currentPlayer,
  };
}

function buildDuelV2QuitState(state = {}, room = {}, leavingSeat = -1) {
  const liveState = normalizeDuelGameState(state, room);
  const safeLeavingSeat = safeSignedInt(leavingSeat, -1);
  if (!didBothSeatsActInDuel(liveState)) {
    return {
      ...liveState,
      winnerSeat: -1,
      winnerUid: "",
      endedReason: "quit_refund_before_opening",
    };
  }
  const winnerSeat = safeLeavingSeat >= 0 ? getOtherDuelSeat(safeLeavingSeat) : -1;
  const winnerUid = winnerSeat >= 0 ? String((room.playerUids || [])[winnerSeat] || "").trim() : "";
  return {
    ...liveState,
    winnerSeat,
    winnerUid,
    endedReason: "quit",
    currentPlayer: winnerSeat >= 0 ? winnerSeat : liveState.currentPlayer,
  };
}

function buildServerBotDuelMove(state = {}, room = {}) {
  const botSeat = getDuelBotSeat(room);
  if (botSeat < 0 || safeSignedInt(state.currentPlayer, -1) !== botSeat) return null;
  const legalMoves = getLegalMovesForDuelSeat(state, botSeat);
  if (legalMoves.length > 0) {
    const difficulty = normalizeDuelBotDifficultyLevel(room.botDifficulty || PUBLIC_DUEL_BOT_DEFAULT_DIFFICULTY);
    const bestMove = difficulty === "dominov1"
      ? (pickDominov1BotMove(state, room, botSeat, legalMoves) || legalMoves[0])
      : legalMoves[0];
    return {
      type: "play",
      player: botSeat,
      tileId: bestMove.tileId,
      tilePos: bestMove.tilePos,
      tileLeft: bestMove.tileLeft,
      tileRight: bestMove.tileRight,
      branch: bestMove.branch,
    };
  }
  if (Array.isArray(state.stockPile) && state.stockPile.length > 0) {
    return buildDuelDrawMove(botSeat, state.stockPile[0]);
  }
  return buildDuelPassMove(botSeat);
}

function runPublicDuelBotTurns(state = {}, room = {}) {
  if (!isPublicBotOnlyDuelV2Room(room)) {
    return {
      state: normalizeDuelGameState(state, room),
      records: [],
    };
  }

  let nextState = normalizeDuelGameState(state, room);
  const records = [];
  let guard = 0;
  while (!String(nextState.endedReason || "").trim() && safeSignedInt(nextState.currentPlayer, -1) === getDuelBotSeat(room) && guard < 64) {
    const botMove = buildServerBotDuelMove(nextState, room);
    if (!botMove) break;
    const applied = applyResolvedDuelMove(nextState, room, botMove, `bot:${String(room.botDifficulty || PUBLIC_DUEL_BOT_DEFAULT_DIFFICULTY).trim() || PUBLIC_DUEL_BOT_DEFAULT_DIFFICULTY}`);
    nextState = applied.state;
    records.push(applied.record);
    guard += 1;
  }

  return {
    state: nextState,
    records,
  };
}

function resolveRequestedDuelMove(state, seat, rawAction = {}) {
  const actionType = String(rawAction?.type || "").trim().toLowerCase();
  const safeSeat = safeSignedInt(seat, -1);
  if (actionType === "draw") {
    const legalMoves = getLegalMovesForDuelSeat(state, safeSeat);
    if (legalMoves.length > 0) {
      throw new HttpsError("failed-precondition", "Ou gen yon mouvman pou jwe deja.");
    }
    if (!Array.isArray(state.stockPile) || state.stockPile.length <= 0) {
      throw new HttpsError("failed-precondition", "Pa gen pyosh pou rale ankò.");
    }
    return buildDuelDrawMove(safeSeat, state.stockPile[0]);
  }

  if (actionType === "pass") {
    const legalMoves = getLegalMovesForDuelSeat(state, safeSeat);
    if (legalMoves.length > 0 || (Array.isArray(state.stockPile) && state.stockPile.length > 0)) {
      throw new HttpsError("failed-precondition", "Ou pa ka pase kounye a.");
    }
    return buildDuelPassMove(safeSeat);
  }

  if (actionType !== "play") {
    throw new HttpsError("invalid-argument", "Aksyon duel sa a pa sipote.");
  }

  const requestedTileId = safeSignedInt(rawAction.tileId, -1);
  const legalMoves = getLegalMovesForDuelSeat(state, safeSeat);
  const requestedBranch = String(rawAction.branch || "").trim().toLowerCase();
  const match = legalMoves.find((move) => {
    if (requestedTileId >= 0 && move.tileId !== requestedTileId) return false;
    if (requestedBranch && move.branch !== requestedBranch) return false;
    return true;
  });
  if (!match) {
    throw new HttpsError("failed-precondition", "Mouvman duel sa a pa valab.");
  }
  return {
    type: "play",
    player: safeSeat,
    tileId: match.tileId,
    tilePos: match.tilePos,
    tileLeft: match.tileLeft,
    tileRight: match.tileRight,
    branch: match.branch,
  };
}

function applyResolvedDuelMove(state, room, move, actorUid) {
  const liveState = normalizeDuelGameState(state, room);
  const nextState = {
    ...liveState,
    seatHands: cloneDuelSeatHands(liveState.seatHands),
    stockPile: Array.isArray(liveState.stockPile) ? liveState.stockPile.slice() : [],
    idempotencyKeys: { ...(liveState.idempotencyKeys || {}) },
    actionCountsBySeat: Array.isArray(liveState.actionCountsBySeat)
      ? liveState.actionCountsBySeat.slice(0, 2)
      : [0, 0],
  };
  const nextSeq = safeInt(liveState.appliedActionSeq + 1);
  nextState.appliedActionSeq = nextSeq;
  nextState.actionCountsBySeat[move.player] = safeInt(nextState.actionCountsBySeat[move.player]) + 1;

  let record = {
    seq: nextSeq,
    type: move.type,
    player: move.player,
    branch: String(move.branch || "").trim(),
    tileId: safeSignedInt(move.tileId, -1),
    tilePos: safeSignedInt(move.tilePos, -1),
    tileLeft: safeSignedInt(move.tileLeft, -1),
    tileRight: safeSignedInt(move.tileRight, -1),
    drawnTileIds: [],
    actorUid: String(actorUid || "").trim(),
  };

  if (move.type === "draw") {
    const drawnTileId = nextState.stockPile.shift();
    if (!Number.isFinite(drawnTileId)) {
      throw new HttpsError("failed-precondition", "Pyosh la vid deja.");
    }
    nextState.seatHands[move.player].push(drawnTileId);
    nextState.currentPlayer = move.player;
    nextState.passesInRow = 0;
    record = {
      ...record,
      drawnTileIds: [drawnTileId],
      tileId: -1,
      tilePos: -1,
      tileLeft: -1,
      tileRight: -1,
      branch: "",
    };
    return { state: nextState, record };
  }

  if (move.type === "pass") {
    nextState.currentPlayer = getOtherDuelSeat(move.player);
    nextState.passesInRow = safeInt(nextState.passesInRow) + 1;
    if (nextState.passesInRow >= 2) {
      const winnerSeat = computeBlockedWinnerSeatForDuel(nextState.seatHands);
      nextState.winnerSeat = winnerSeat;
      nextState.winnerUid = String((room.playerUids || [])[winnerSeat] || "").trim();
      nextState.endedReason = "blocked";
    }
    return { state: nextState, record };
  }

  const slot = findDuelSeatSlotByTileId(nextState.seatHands, move.player, move.tileId);
  if (slot < 0) {
    throw new HttpsError("failed-precondition", "Tuile introuvable dans la main du joueur.");
  }
  nextState.seatHands[move.player].splice(slot, 1);

  const values = getTileValues(move.tileId);
  if (!values) {
    throw new HttpsError("failed-precondition", "Tuile duel invalide.");
  }

  if (nextState.leftEnd < 0 || nextState.rightEnd < 0 || move.branch === "centro") {
    nextState.leftEnd = values[0];
    nextState.rightEnd = values[1];
  } else if (move.branch === "izquierda") {
    nextState.leftEnd = values[0] === nextState.leftEnd ? values[1] : values[0];
  } else {
    nextState.rightEnd = values[0] === nextState.rightEnd ? values[1] : values[0];
  }

  nextState.currentPlayer = getOtherDuelSeat(move.player);
  nextState.passesInRow = 0;

  if (countRemainingTilesForDuelSeat(nextState.seatHands, move.player) <= 0) {
    nextState.winnerSeat = move.player;
    nextState.winnerUid = String((room.playerUids || [])[move.player] || "").trim();
    nextState.endedReason = "out";
  }

  return { state: nextState, record };
}

function buildDuelRoomUpdateFromGameState(room, nextState, records = []) {
  const lastRecord = records.length > 0 ? records[records.length - 1] : null;
  const nowMs = Date.now();
  const status = String(nextState.endedReason || "").trim() ? "ended" : "playing";
  return {
    status,
    currentPlayer: safeSignedInt(nextState.currentPlayer, -1),
    openingSeat: safeSignedInt(nextState.openingSeat, -1),
    openingTileId: safeSignedInt(nextState.openingTileId, -1),
    openingReason: String(nextState.openingReason || "").trim(),
    lastActionSeq: safeSignedInt(nextState.appliedActionSeq, -1),
    turnActual: Math.max(0, safeInt(nextState.appliedActionSeq) + 1),
    winnerSeat: safeSignedInt(nextState.winnerSeat, -1),
    winnerUid: String(nextState.winnerUid || "").trim(),
    endedReason: String(nextState.endedReason || "").trim(),
    leftEnd: safeSignedInt(nextState.leftEnd, -1),
    rightEnd: safeSignedInt(nextState.rightEnd, -1),
    turnDeadlineMs: status === "playing" ? nowMs + DUEL_TURN_LIMIT_MS : 0,
    endedAtMs: status === "ended" ? nowMs : 0,
    updatedAtMs: nowMs,
    startRevealPending: false,
    privateDeckOrder: Array.isArray(nextState.deckOrder) ? nextState.deckOrder.slice(0, 28) : [],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    endedAt: status === "ended" ? admin.firestore.FieldValue.serverTimestamp() : admin.firestore.FieldValue.delete(),
    waitingDeadlineMs: admin.firestore.FieldValue.delete(),
    turnStartedAtMs: status === "playing" ? nowMs : 0,
    lastActionType: lastRecord ? String(lastRecord.type || "").trim() : "",
  };
}

function buildDuelGameStateWrite(nextState) {
  return {
    deckOrder: Array.isArray(nextState.deckOrder) ? nextState.deckOrder.slice(0, 28) : [],
    seatHands: serializeDuelSeatHands(nextState.seatHands),
    stockPile: Array.isArray(nextState.stockPile) ? nextState.stockPile.slice(0, 14) : [],
    leftEnd: safeSignedInt(nextState.leftEnd, -1),
    rightEnd: safeSignedInt(nextState.rightEnd, -1),
    passesInRow: Math.max(0, safeInt(nextState.passesInRow)),
    appliedActionSeq: safeSignedInt(nextState.appliedActionSeq, -1),
    currentPlayer: safeSignedInt(nextState.currentPlayer, -1),
    winnerSeat: safeSignedInt(nextState.winnerSeat, -1),
    winnerUid: String(nextState.winnerUid || "").trim(),
    endedReason: String(nextState.endedReason || "").trim(),
    idempotencyKeys: nextState.idempotencyKeys && typeof nextState.idempotencyKeys === "object" ? nextState.idempotencyKeys : {},
    openingSeat: safeSignedInt(nextState.openingSeat, -1),
    openingTileId: safeSignedInt(nextState.openingTileId, -1),
    openingReason: String(nextState.openingReason || "").trim(),
    actionCountsBySeat: Array.isArray(nextState.actionCountsBySeat)
      ? [Math.max(0, safeInt(nextState.actionCountsBySeat[0])), Math.max(0, safeInt(nextState.actionCountsBySeat[1]))]
      : [0, 0],
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

function buildStoredEntryFunding(gameEntryFunding = {}, stakeHtg = 0, afterPlayableHtg = 0) {
  return {
    fundingCurrency: "htg",
    convertedHtg: safeInt(stakeHtg),
    approvedHtg: safeInt(gameEntryFunding?.approvedHtg),
    provisionalHtg: safeInt(gameEntryFunding?.provisionalHtg),
    approvedDoes: safeInt(gameEntryFunding?.approvedDoes),
    provisionalDoes: safeInt(gameEntryFunding?.provisionalDoes),
    provisionalSources: Array.isArray(gameEntryFunding?.provisionalSources) ? gameEntryFunding.provisionalSources : [],
    beforeEntryPlayableHtg: Math.max(0, safeInt(afterPlayableHtg) + safeInt(stakeHtg)),
    afterEntryPlayableHtg: Math.max(0, safeInt(afterPlayableHtg)),
  };
}

async function chargeRoomEntriesTx(tx, room = {}, playerUids = [], stakeDoes = 0) {
  const normalizedStakeDoes = safeInt(stakeDoes);
  const stakeHtg = buildStakeAmountHtg(normalizedStakeDoes);
  if (normalizedStakeDoes <= 0 || stakeHtg <= 0) {
    throw makeHttpError(400, "invalid-stake", "Mise invalide.");
  }

  const uniquePlayerUids = Array.from(new Set(
    (Array.isArray(playerUids) ? playerUids : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  ));
  if (uniquePlayerUids.length <= 0) {
    throw makeHttpError(400, "missing-players", "Aucun joueur valide pour cette salle duel.");
  }

  const entryFundingCurrencyByUid = room.entryFundingCurrencyByUid && typeof room.entryFundingCurrencyByUid === "object"
    ? room.entryFundingCurrencyByUid
    : {};
  const walletSnaps = await Promise.all(uniquePlayerUids.map((playerUid) => tx.get(walletRef(playerUid))));
  const prepared = uniquePlayerUids.map((playerUid, index) => {
    const fundingCurrency = normalizeFundingCurrency(entryFundingCurrencyByUid[playerUid] || "htg");
    if (fundingCurrency !== "htg") {
      throw makeHttpError(400, "duel-v2-htg-only", "Seul le financement HTG est autorise pour Duel V2.", {
        uid: playerUid,
        fundingCurrency,
      });
    }
    const walletSnap = walletSnaps[index];
    const walletData = walletSnap.exists ? (walletSnap.data() || {}) : {};
    assertWalletNotFrozen(walletData);
    const walletMutation = applyHtgStakeDebit(walletData, { stakeHtg });
    return { playerUid, walletMutation };
  });

  const entryFundingByUid = {};
  const afterDoesByUid = {};
  const nowMs = Date.now();
  prepared.forEach(({ playerUid, walletMutation }) => {
    tx.set(walletRef(playerUid), {
      ...walletMutation.balancesPatch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAtMs: nowMs,
    }, { merge: true });
    entryFundingByUid[playerUid] = buildStoredEntryFunding(
      walletMutation.gameEntryFunding || {},
      stakeHtg,
      walletMutation.afterPlayableHtg
    );
    afterDoesByUid[playerUid] = safeInt(walletMutation.afterDoes);
  });

  return {
    entryFundingByUid,
    afterDoesByUid,
  };
}

async function rewardPlayersForRefundTx(tx, roomRefDoc, room = {}) {
  const playerUids = Array.isArray(room.playerUids)
    ? room.playerUids.slice(0, 2).map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (playerUids.length <= 0) return;

  const stakeHtg = resolveDuelV2StakeHtgFromRoom(room);
  if (stakeHtg <= 0) return;

  const preloadedWalletSnaps = room.__preloadedSettlementWalletSnaps && typeof room.__preloadedSettlementWalletSnaps === "object"
    ? room.__preloadedSettlementWalletSnaps
    : {};
  const walletSnaps = await Promise.all(playerUids.map((uid) => preloadedWalletSnaps[uid] || tx.get(walletRef(uid))));
  const nowMs = Date.now();
  playerUids.forEach((playerUid, index) => {
    const walletSnap = walletSnaps[index];
    const walletData = walletSnap.exists ? (walletSnap.data() || {}) : {};
    const entryFunding = room.entryFundingByUid && typeof room.entryFundingByUid === "object"
      ? (room.entryFundingByUid[playerUid] || null)
      : null;
    const walletMutation = applyHtgRewardCredit(walletData, {
      rewardHtg: stakeHtg,
      rewardEntryFunding: entryFunding,
    });
    tx.set(walletRef(playerUid), {
      ...walletMutation.balancesPatch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAtMs: nowMs,
    }, { merge: true });
    tx.set(roomRefDoc.collection("settlements").doc(`refund_${playerUid}`), {
      uid: playerUid,
      roomId: roomRefDoc.id,
      refunded: true,
      rewardPaid: false,
      refundStakeHtg: stakeHtg,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });
}

async function preloadDuelSettlementWalletSnapsTx(tx, room = {}, state = {}) {
  const endedReason = String(state?.endedReason || room?.endedReason || "").trim();
  if (!endedReason) return {};

  const targetUids = new Set();
  if (
    endedReason === "no_play_refund"
    || endedReason === "quit_refund_before_opening"
    || endedReason === "timeout_refund"
  ) {
    const playerUids = Array.isArray(room?.playerUids)
      ? room.playerUids.slice(0, 2).map((value) => String(value || "").trim()).filter(Boolean)
      : [];
    playerUids.forEach((playerUid) => targetUids.add(playerUid));
  } else {
    const winnerUid = String(state?.winnerUid || room?.winnerUid || "").trim();
    if (winnerUid) targetUids.add(winnerUid);
  }

  const uidList = Array.from(targetUids);
  if (uidList.length <= 0) return {};

  const walletSnaps = await Promise.all(uidList.map((playerUid) => tx.get(walletRef(playerUid))));
  return uidList.reduce((acc, playerUid, index) => {
    acc[playerUid] = walletSnaps[index];
    return acc;
  }, {});
}

function resolveDuelV2StakeHtg(payload = {}, fallback = PUBLIC_DUEL_V2_STAKE_HTG) {
  const raw = safeInt(payload.stakeHtg || payload.stake || fallback);
  return raw > 0 ? raw : fallback;
}

function assertPrivateDuelV2StakeHtg(payload = {}) {
  const stakeHtg = resolveDuelV2StakeHtg(payload, MIN_PRIVATE_DUEL_V2_STAKE_HTG);
  if (stakeHtg < MIN_PRIVATE_DUEL_V2_STAKE_HTG) {
    throw new HttpsError("invalid-argument", `Mise duel invalide. Minimum ${MIN_PRIVATE_DUEL_V2_STAKE_HTG} HTG.`);
  }
  return stakeHtg;
}

function resolveDuelV2StakeDoes(room = {}) {
  const explicit = safeInt(room.entryCostDoes || room.stakeDoes);
  if (explicit > 0) return explicit;
  const stakeHtg = safeInt(room.stakeHtg || 25);
  return stakeHtg > 0 ? stakeHtg * RATE_HTG_TO_DOES : 0;
}

function resolveDuelV2StakeHtgFromRoom(room = {}) {
  const explicit = safeInt(room.stakeHtg);
  if (explicit > 0) return explicit;
  return buildStakeAmountHtg(resolveDuelV2StakeDoes(room));
}

function resolveDuelV2RewardAmountDoes(room = {}) {
  const explicit = safeInt(room.rewardAmountDoes);
  if (explicit > 0) return explicit;
  const stakeDoes = resolveDuelV2StakeDoes(room);
  return stakeDoes > 0 ? Math.floor(stakeDoes * 1.85) : 0;
}

function resolveDuelV2RewardAmountHtg(room = {}) {
  const explicit = safeInt(room.rewardAmountHtg);
  if (explicit > 0) return explicit;
  const stakeDoes = resolveDuelV2StakeDoes(room);
  const rewardDoes = resolveDuelV2RewardAmountDoes(room);
  return buildRewardAmountHtg(stakeDoes, rewardDoes);
}

function buildDuelV2RoomResultDoc(roomId = "", room = {}, roomUpdate = {}) {
  const snapshot = { ...room, ...roomUpdate };
  const resultDocId = buildDuelV2RoomResultDocId(roomId, snapshot);
  const playerUids = Array.isArray(snapshot.playerUids)
    ? snapshot.playerUids.slice(0, 2).map((item) => String(item || "").trim())
    : ["", ""];
  const playerNames = Array.isArray(snapshot.playerNames)
    ? snapshot.playerNames.slice(0, 2).map((item) => String(item || "").trim())
    : ["", ""];
  const endedReason = String(snapshot.endedReason || "").trim();
  const isRefundResult = endedReason === "timeout_refund" || endedReason === "quit_refund_before_opening";
  const winnerSeat = isRefundResult ? -1 : safeSignedInt(snapshot.winnerSeat, -1);
  const winnerUid = isRefundResult ? "" : String(snapshot.winnerUid || "").trim();
  const stakeDoes = resolveDuelV2StakeDoes(snapshot);
  const stakeHtg = resolveDuelV2StakeHtgFromRoom(snapshot);
  const rewardAmountDoes = isRefundResult ? 0 : resolveDuelV2RewardAmountDoes(snapshot);
  const rewardAmountHtg = isRefundResult ? 0 : resolveDuelV2RewardAmountHtg(snapshot);
  const nowMs = Date.now();
  const firstFundingUid = playerUids.find(Boolean) || "";
  const fundingCurrencyByUid = snapshot.entryFundingCurrencyByUid && typeof snapshot.entryFundingCurrencyByUid === "object"
    ? snapshot.entryFundingCurrencyByUid
    : {};

  return {
    id: resultDocId,
    roomId: String(roomId || "").trim(),
    matchId: resultDocId,
    status: "ended",
    roomMode: String(snapshot.roomMode || "duel_v2_public").trim() || "duel_v2_public",
    fundingCurrency: normalizeFundingCurrency(fundingCurrencyByUid[firstFundingUid] || snapshot.fundingCurrency || "htg"),
    playerUids,
    playerNames,
    humanCount: Math.max(0, safeInt(snapshot.humanCount, playerUids.filter(Boolean).length)),
    botCount: Math.max(0, safeInt(snapshot.botCount, 0)),
    totalSeats: Math.max(
      playerUids.filter(Boolean).length,
      Math.max(0, safeInt(snapshot.humanCount, playerUids.filter(Boolean).length))
      + Math.max(0, safeInt(snapshot.botCount, 0))
    ),
    entryFundingByUid: snapshot.entryFundingByUid && typeof snapshot.entryFundingByUid === "object"
      ? snapshot.entryFundingByUid
      : {},
    winnerSeat,
    winnerUid,
    winnerType: winnerUid
      ? "human"
      : (winnerSeat >= 0 && Math.max(0, safeInt(snapshot.botCount, 0)) > 0 ? "bot" : "unknown"),
    endedReason,
    stakeDoes,
    stakeHtg,
    entryCostDoes: stakeDoes,
    rewardAmountDoes,
    rewardAmountHtg,
    createdAtMs: safeSignedInt(snapshot.createdAtMs, 0),
    startedAtMs: safeSignedInt(snapshot.startedAtMs, 0),
    endedAtMs: safeSignedInt(snapshot.endedAtMs, nowMs) || nowMs,
    archiveVersion: 1,
    archivedAtMs: nowMs,
    engineVersion: 2,
  };
}

function buildDuelV2RoomResultDocId(roomId = "", snapshot = {}) {
  const safeRoomId = String(roomId || "").trim();
  const endedAtMs = safeSignedInt(snapshot.endedAtMs, Date.now()) || Date.now();
  return `${safeRoomId}_${endedAtMs}`;
}

async function writeDuelV2RoomResultIfEndedTx(tx, roomRefDoc, room = {}, roomUpdate = {}) {
  const nextStatus = String(roomUpdate.status || room.status || "").trim().toLowerCase();
  if (nextStatus !== "ended") return;
  const snapshot = { ...room, ...roomUpdate };
  const resultDocId = buildDuelV2RoomResultDocId(roomRefDoc.id, snapshot);

  tx.set(duelRoomResultRef(resultDocId), {
    ...buildDuelV2RoomResultDoc(roomRefDoc.id, room, roomUpdate),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function settleDuelV2RoomTx(tx, roomRefDoc, room = {}, state = {}) {
  const endedReason = String(state.endedReason || room.endedReason || "").trim();
  if (!endedReason) {
    return { ok: true, settled: false, reason: "not-ended" };
  }
  const currentStatus = String(room.settlementStatus || "").trim().toLowerCase();
  if (currentStatus === "applied") {
    return { ok: true, settled: false, reason: "already-settled", roomId: roomRefDoc.id, endedReason };
  }

  const normalizedRoom = {
    ...room,
    winnerSeat: safeSignedInt(state.winnerSeat, safeSignedInt(room.winnerSeat, -1)),
    winnerUid: String(state.winnerUid || room.winnerUid || "").trim(),
    endedReason,
    status: "ended",
  };
  const preloadedWalletSnaps = normalizedRoom.__preloadedSettlementWalletSnaps && typeof normalizedRoom.__preloadedSettlementWalletSnaps === "object"
    ? normalizedRoom.__preloadedSettlementWalletSnaps
    : {};

  if (
    endedReason === "no_play_refund"
    || endedReason === "quit_refund_before_opening"
    || endedReason === "timeout_refund"
  ) {
    await rewardPlayersForRefundTx(tx, roomRefDoc, normalizedRoom);
    tx.set(roomRefDoc, {
      settlementStatus: "applied",
      settlementAppliedAtMs: Date.now(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, settled: true, roomId: roomRefDoc.id, endedReason, refundsApplied: true };
  }

  const winnerSeat = safeSignedInt(normalizedRoom.winnerSeat, -1);
  const winnerUid = String(normalizedRoom.winnerUid || "").trim();
  if (winnerSeat < 0 || !winnerUid) {
    tx.set(roomRefDoc, {
      settlementStatus: "applied",
      settlementAppliedAtMs: Date.now(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return { ok: true, settled: true, roomId: roomRefDoc.id, endedReason, rewardApplied: false };
  }

  const winnerWalletSnap = preloadedWalletSnaps[winnerUid] || await tx.get(walletRef(winnerUid));
  const winnerWalletData = winnerWalletSnap.exists ? (winnerWalletSnap.data() || {}) : {};
  const entryFundingRaw = normalizedRoom.entryFundingByUid && typeof normalizedRoom.entryFundingByUid === "object"
    ? (normalizedRoom.entryFundingByUid[winnerUid] || null)
    : null;
  const rewardHtg = resolveDuelV2RewardAmountHtg(normalizedRoom);
  const walletMutation = applyHtgRewardCredit(winnerWalletData, {
    rewardHtg,
    rewardEntryFunding: entryFundingRaw,
  });
  const nowMs = Date.now();
  tx.set(walletRef(winnerUid), {
    ...walletMutation.balancesPatch,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSeenAtMs: nowMs,
  }, { merge: true });
  tx.set(roomRefDoc.collection("settlements").doc(`winner_${winnerUid}`), {
    uid: winnerUid,
    roomId: roomRefDoc.id,
    rewardPaid: true,
    rewardHtg,
    endedReason,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  tx.set(roomRefDoc, {
    settlementStatus: "applied",
    settlementAppliedAtMs: nowMs,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
  return {
    ok: true,
    settled: true,
    roomId: roomRefDoc.id,
    endedReason,
    reward: {
      uid: winnerUid,
      rewardHtg,
    },
  };
}

function isFriendDuelV2Room(room = {}) {
  return String(room.roomMode || "").trim() === "duel_v2_friends";
}

function resolveDuelV2WaitDeadlineMs(room = {}, nowMs = Date.now()) {
  const explicit = safeSignedInt(room.waitingDeadlineMs, 0);
  if (explicit > 0) return explicit;
  const createdAtMs = safeSignedInt(room.createdAtMs, 0);
  const configuredPublicBotWaitMs = Math.max(1000, safeSignedInt(room.botWaitMs, safeSignedInt(room.botWaitSeconds, 0) * 1000));
  const duration = isFriendDuelV2Room(room)
    ? FRIEND_ROOM_WAIT_MS
    : (isPublicBotOnlyDuelV2Room(room) ? (configuredPublicBotWaitMs || PUBLIC_DUEL_BOT_WAIT_MS) : ROOM_WAIT_MS);
  return createdAtMs > 0 ? createdAtMs + duration : nowMs + duration;
}

function setDuelV2MatchmakingPoolOpen(tx, poolRef, roomId, stakeHtg = 25) {
  tx.set(poolRef, {
    openRoomId: String(roomId || "").trim(),
    stakeHtg: safeInt(stakeHtg),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

function clearDuelV2MatchmakingPool(tx, poolRef) {
  tx.set(poolRef, {
    openRoomId: "",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function generateUniqueFriendDuelV2InviteCode(size = FRIEND_ROOM_CODE_SIZE, maxAttempts = 18) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = normalizeCode(randomCode(size));
    if (!candidate) continue;
    const existing = await db
      .collection(DUEL_V2_ROOMS_COLLECTION)
      .where("inviteCodeNormalized", "==", candidate)
      .limit(1)
      .get();
    if (existing.empty) return candidate;
  }
  throw new HttpsError("aborted", "Impossible de generer un code Duel V2 unique.");
}

async function findActiveDuelV2RoomForUser(uid) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) return null;

  const membershipSnap = await db
    .collection(DUEL_V2_ROOMS_COLLECTION)
    .where("playerUids", "array-contains", safeUid)
    .limit(10)
    .get();

  if (membershipSnap.empty) return null;

  const nowMs = Date.now();
  const candidates = membershipSnap.docs.filter((docSnap) => {
    const data = docSnap.data() || {};
    const status = String(data.status || "").trim().toLowerCase();
    if (status === "playing") return true;
    if (status !== "waiting") return false;

    if (isPublicBotOnlyDuelV2Room(data)) {
      return true;
    }

    const humans = Array.isArray(data.playerUids)
      ? data.playerUids.map((item) => String(item || "").trim()).filter(Boolean).length
      : safeInt(data.humanCount);
    const waitingDeadlineMs = resolveDuelV2WaitDeadlineMs(data, nowMs);
    if (humans < 2 && waitingDeadlineMs > 0 && nowMs >= waitingDeadlineMs) {
      return false;
    }
    return true;
  });

  if (candidates.length <= 0) return null;

  candidates.sort((leftDoc, rightDoc) => {
    const left = leftDoc.data() || {};
    const right = rightDoc.data() || {};
    const leftStatus = String(left.status || "").trim().toLowerCase();
    const rightStatus = String(right.status || "").trim().toLowerCase();
    if (leftStatus !== rightStatus) {
      return leftStatus === "playing" ? -1 : 1;
    }
    return safeSignedInt(right.updatedAtMs || right.startedAtMs || right.createdAtMs)
      - safeSignedInt(left.updatedAtMs || left.startedAtMs || left.createdAtMs);
  });

  const candidate = candidates[0];
  const data = candidate.data() || {};
  const seats = data.seats && typeof data.seats === "object" ? data.seats : {};
  return {
    roomId: candidate.id,
    seatIndex: typeof seats[safeUid] === "number" ? seats[safeUid] : -1,
    status: String(data.status || "").trim(),
    roomMode: String(data.roomMode || "duel_v2_public").trim(),
    inviteCode: String(data.inviteCode || "").trim(),
    stakeHtg: safeInt(data.stakeHtg || 25),
    room: data,
  };
}

function buildDuelV2PublicState(roomId, room = {}, uid = "", stateOverride = null) {
  const playerUids = Array.isArray(room.playerUids)
    ? room.playerUids.slice(0, 2).map((item) => String(item || "").trim())
    : ["", ""];
  const seatIndex = playerUids.findIndex((item) => item === uid);
  const humanCount = Math.max(0, safeInt(room.humanCount, playerUids.filter(Boolean).length));
  const botCount = Math.max(0, safeInt(room.botCount, 0));
  const state = stateOverride ? normalizeDuelGameState(stateOverride, room) : null;
  const privateDeckOrder = state && Array.isArray(state.deckOrder)
    ? state.deckOrder.slice(0, 28)
    : (Array.isArray(room.privateDeckOrder) ? room.privateDeckOrder.slice(0, 28) : []);
  const rematchRequestUids = Array.isArray(room.rematchRequestUids)
    ? room.rematchRequestUids.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  return {
    ok: true,
    roomId,
    status: String(room.status || "waiting"),
    roomMode: String(room.roomMode || "duel_v2_public"),
    seatIndex,
    playerUids,
    playerNames: Array.isArray(room.playerNames) ? room.playerNames.slice(0, 2) : ["", ""],
    currentPlayer: state ? safeSignedInt(state.currentPlayer, -1) : safeSignedInt(room.currentPlayer, -1),
    openingSeat: state ? safeSignedInt(state.openingSeat, -1) : safeSignedInt(room.openingSeat, -1),
    openingTileId: state ? safeSignedInt(state.openingTileId, -1) : safeSignedInt(room.openingTileId, -1),
    openingReason: state ? String(state.openingReason || "").trim() : String(room.openingReason || "").trim(),
    lastActionSeq: state ? safeSignedInt(state.appliedActionSeq, -1) : safeSignedInt(room.lastActionSeq, -1),
    turnActual: safeSignedInt(room.turnActual, Math.max(0, safeSignedInt(room.lastActionSeq, -1) + 1)),
    winnerSeat: state ? safeSignedInt(state.winnerSeat, -1) : safeSignedInt(room.winnerSeat, -1),
    winnerUid: state ? String(state.winnerUid || "").trim() : String(room.winnerUid || "").trim(),
    endedReason: state ? String(state.endedReason || "").trim() : String(room.endedReason || "").trim(),
    humanCount,
    botCount,
    startRevealPending: room.startRevealPending === true,
    waitingDeadlineMs: safeSignedInt(room.waitingDeadlineMs, 0),
    startedAtMs: safeSignedInt(room.startedAtMs, 0),
    turnDeadlineMs: safeSignedInt(room.turnDeadlineMs, 0),
    inviteCode: String(room.inviteCode || "").trim(),
    stakeHtg: safeInt(room.stakeHtg || 25),
    botDifficulty: String(room.botDifficulty || "").trim(),
    rematchRequestUids,
    privateDeckOrder,
  };
}

function buildStartedDuelV2RoomTransaction(tx, roomRefDoc, room = {}, options = {}) {
  const nowMs = safeSignedInt(options.nowMs, Date.now()) || Date.now();
  const deckOrder = makeDeckOrderForRoom(room);
  const initialState = createInitialDuelGameState(room, deckOrder);
  const openingMove = buildOpeningMoveForDuelState(initialState);
  const openingApplied = applyResolvedDuelMove(initialState, room, openingMove, "server:opening");
  const botProgress = runPublicDuelBotTurns(openingApplied.state, room);
  const finalState = botProgress.state;
  const records = [openingApplied.record, ...botProgress.records];
  tx.set(duelV2GameStateRef(roomRefDoc.id), buildDuelGameStateWrite(finalState), { merge: true });
  records.forEach((record) => {
    tx.set(duelV2ActionRef(roomRefDoc.id, String(record.seq)), {
      ...record,
      roomId: roomRefDoc.id,
      engineVersion: 2,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  });

  const updates = {
    playerUids: Array.isArray(room.playerUids) ? room.playerUids.slice(0, 2) : ["", ""],
    playerNames: Array.isArray(room.playerNames) ? room.playerNames.slice(0, 2) : ["", ""],
    seats: room.seats && typeof room.seats === "object" ? { ...room.seats } : {},
    humanCount: Math.max(0, safeInt(room.humanCount, 2)),
    botCount: Math.max(0, safeInt(room.botCount, 0)),
    status: finalState.endedReason ? "ended" : "playing",
    started: true,
    startRevealPending: false,
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    startedAtMs: nowMs,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: nowMs,
    waitingDeadlineMs: admin.firestore.FieldValue.delete(),
    rematchRequestUids: admin.firestore.FieldValue.delete(),
    rematchRequestedAtMs: admin.firestore.FieldValue.delete(),
  };
  Object.assign(updates, buildDuelRoomUpdateFromGameState(room, finalState, records));
  tx.set(roomRefDoc, updates, { merge: true });

  return {
    roomUpdate: updates,
    finalState,
    actionRecords: records,
    privateDeckOrder: Array.isArray(finalState.deckOrder) ? finalState.deckOrder.slice(0, 28) : [],
  };
}

async function resolveOrReadActiveDuelV2RoomTx(tx, roomRefDoc, uid, nowMs = Date.now()) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) return null;

  const stateRef = duelV2GameStateRef(roomRefDoc.id);
  const [roomSnap, stateSnap] = await Promise.all([tx.get(roomRefDoc), tx.get(stateRef)]);
  if (!roomSnap.exists) return null;

  const room = roomSnap.data() || {};
  const playerUids = Array.isArray(room.playerUids)
    ? room.playerUids.slice(0, 2).map((item) => String(item || "").trim())
    : ["", ""];
  if (!playerUids.includes(safeUid)) {
    throw new HttpsError("permission-denied", "Tu ne fais pas partie de cette salle Duel V2.");
  }

  const status = String(room.status || "").trim();
  const state = stateSnap.exists ? normalizeDuelGameState(stateSnap.data(), room) : null;
  if (status === "waiting") {
    const waitingDeadlineMs = resolveDuelV2WaitDeadlineMs(room, nowMs);
    if (isPublicBotOnlyDuelV2Room(room) && waitingDeadlineMs > 0 && nowMs >= waitingDeadlineMs) {
      const stakeHtg = safeInt(room.stakeHtg || PUBLIC_DUEL_V2_STAKE_HTG);
      const stakeDoes = safeInt(room.entryCostDoes || room.stakeDoes || (stakeHtg * RATE_HTG_TO_DOES));
      const rewardAmountDoes = safeInt(room.rewardAmountDoes || Math.floor(stakeDoes * 1.85));
      const rewardAmountHtg = safeInt(room.rewardAmountHtg || buildRewardAmountHtg(stakeDoes, rewardAmountDoes));
      const nextFundingCurrencies = room.entryFundingCurrencyByUid && typeof room.entryFundingCurrencyByUid === "object"
        ? { ...room.entryFundingCurrencyByUid }
        : {};
      if (safeUid) nextFundingCurrencies[safeUid] = normalizeFundingCurrency(nextFundingCurrencies[safeUid] || "htg");
      const roomForCharge = {
        ...room,
        stakeHtg,
        stakeDoes,
        entryCostDoes: stakeDoes,
        rewardAmountDoes,
        rewardAmountHtg,
        entryFundingCurrencyByUid: nextFundingCurrencies,
        humanCount: 1,
        botCount: Math.max(1, safeInt(room.botCount, 1)),
        allowBots: true,
      };
      const chargeResult = await chargeRoomEntriesTx(tx, roomForCharge, [safeUid], stakeDoes);
      const joinedRoom = {
        ...roomForCharge,
        entryFundingByUid: chargeResult.entryFundingByUid,
        settlementStatus: "pending",
        settlementAppliedAtMs: 0,
        started: true,
      };
      tx.set(roomRefDoc, {
        entryFundingByUid: chargeResult.entryFundingByUid,
        entryFundingCurrencyByUid: nextFundingCurrencies,
        humanCount: 1,
        botCount: Math.max(1, safeInt(room.botCount, 1)),
        settlementStatus: "pending",
        settlementAppliedAtMs: 0,
        started: true,
        updatedAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      const started = buildStartedDuelV2RoomTransaction(tx, roomRefDoc, joinedRoom, { nowMs });
      if (String(started.finalState?.endedReason || "").trim()) {
        await settleDuelV2RoomTx(tx, roomRefDoc, {
          ...joinedRoom,
          ...started.roomUpdate,
        }, started.finalState);
        await writeDuelV2RoomResultIfEndedTx(tx, roomRefDoc, joinedRoom, started.roomUpdate);
      }
      return buildDuelV2PublicState(roomRefDoc.id, {
        ...joinedRoom,
        ...started.roomUpdate,
        startedAtMs: safeSignedInt(started.roomUpdate.startedAtMs, nowMs),
        openingSeat: safeSignedInt(started.finalState.openingSeat, -1),
        openingTileId: safeSignedInt(started.finalState.openingTileId, -1),
        openingReason: String(started.finalState.openingReason || "").trim(),
        privateDeckOrder: started.privateDeckOrder,
      }, safeUid, started.finalState);
    }
    return buildDuelV2PublicState(roomRefDoc.id, {
      ...room,
      privateDeckOrder: state && Array.isArray(state.deckOrder) ? state.deckOrder.slice(0, 28) : [],
    }, safeUid, state);
  }

  if (status !== "playing") {
    return buildDuelV2PublicState(roomRefDoc.id, {
      ...room,
      privateDeckOrder: state && Array.isArray(state.deckOrder) ? state.deckOrder.slice(0, 28) : [],
    }, safeUid, state);
  }

  const liveState = state || createInitialDuelGameState(room, room.privateDeckOrder || []);
  const turnDeadlineMs = safeSignedInt(room.turnDeadlineMs, 0);
  if (turnDeadlineMs > 0 && nowMs >= turnDeadlineMs + DUEL_TURN_TIMEOUT_GRACE_MS) {
    const nextState = buildDuelV2TimeoutState(liveState, room);
    const roomUpdate = buildDuelRoomUpdateFromGameState(room, nextState, []);
    const settlementWalletSnaps = await preloadDuelSettlementWalletSnapsTx(tx, { ...room, ...roomUpdate }, nextState);
    tx.set(stateRef, buildDuelGameStateWrite(nextState), { merge: true });
    tx.set(roomRefDoc, roomUpdate, { merge: true });
    await settleDuelV2RoomTx(tx, roomRefDoc, {
      ...room,
      ...roomUpdate,
      __preloadedSettlementWalletSnaps: settlementWalletSnaps,
    }, nextState);
    await writeDuelV2RoomResultIfEndedTx(tx, roomRefDoc, room, roomUpdate);
    return buildDuelV2PublicState(roomRefDoc.id, { ...room, ...roomUpdate }, safeUid, nextState);
  }

  if (isPublicBotOnlyDuelV2Room(room) && safeSignedInt(liveState.currentPlayer, -1) === getDuelBotSeat(room)) {
    const botApplied = runPublicDuelBotTurns(liveState, room);
    if (botApplied.records.length > 0 || String(botApplied.state.endedReason || "").trim()) {
      const roomUpdate = buildDuelRoomUpdateFromGameState(room, botApplied.state, botApplied.records);
      const settlementWalletSnaps = botApplied.state.endedReason
        ? await preloadDuelSettlementWalletSnapsTx(tx, { ...room, ...roomUpdate }, botApplied.state)
        : null;
      tx.set(stateRef, buildDuelGameStateWrite(botApplied.state), { merge: true });
      tx.set(roomRefDoc, roomUpdate, { merge: true });
      botApplied.records.forEach((record) => {
        tx.set(duelV2ActionRef(roomRefDoc.id, String(record.seq)), {
          ...record,
          roomId: roomRefDoc.id,
          engineVersion: 2,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      });
      if (botApplied.state.endedReason) {
        await settleDuelV2RoomTx(tx, roomRefDoc, {
          ...room,
          ...roomUpdate,
          __preloadedSettlementWalletSnaps: settlementWalletSnaps,
        }, botApplied.state);
        await writeDuelV2RoomResultIfEndedTx(tx, roomRefDoc, room, roomUpdate);
      }
      return buildDuelV2PublicState(roomRefDoc.id, { ...room, ...roomUpdate }, safeUid, botApplied.state);
    }
  }

  return buildDuelV2PublicState(roomRefDoc.id, {
    ...room,
    privateDeckOrder: Array.isArray(liveState.deckOrder) ? liveState.deckOrder.slice(0, 28) : [],
  }, safeUid, liveState);
}

async function joinMatchmakingDuelV2({ uid, email, payload = {} }) {
  await assertDuelV2PublicAvailable();
  const stakeHtg = PUBLIC_DUEL_V2_STAKE_HTG;
  const stakeDoes = stakeHtg * RATE_HTG_TO_DOES;
  const rewardAmountDoes = Math.floor(stakeDoes * 1.85);
  const rewardAmountHtg = buildRewardAmountHtg(stakeDoes, rewardAmountDoes);
  const configuredBotDifficulty = await getConfiguredDuelBotDifficulty();
  const configuredBotWaitMs = Math.max(1000, safeSignedInt(await getConfiguredDuelBotWaitMs(), PUBLIC_DUEL_BOT_WAIT_MS));
  const activeRoom = await findActiveDuelV2RoomForUser(uid);
  if (activeRoom) {
    const resolvedActiveRoom = await db.runTransaction(async (tx) => {
      return resolveOrReadActiveDuelV2RoomTx(tx, duelV2RoomRef(activeRoom.roomId), uid, Date.now());
    });
    if (resolvedActiveRoom && String(resolvedActiveRoom.status || "").trim().toLowerCase() !== "ended") {
      return {
        ...resolvedActiveRoom,
        resumed: true,
      };
    }
  }

  return db.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const walletSnap = await tx.get(walletRef(uid));
    const walletData = walletSnap.exists ? (walletSnap.data() || {}) : {};
    assertWalletNotFrozen(walletData);

    const roomRefDoc = duelV2RoomRef();
    const botName = pickPublicDuelBotName();
    const roomData = {
      ownerUid: uid,
      roomMode: "duel_v2_public",
      status: "waiting",
      started: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
      playerUids: [uid, ""],
      playerNames: [sanitizePlayerLabel(email || uid, 0), botName],
      seats: { [uid]: 0 },
      roomPresenceMs: { [uid]: nowMs },
      humanCount: 1,
      botCount: 1,
      currentPlayer: -1,
      winnerSeat: -1,
      winnerUid: "",
      endedReason: "",
      settlementStatus: "",
      settlementAppliedAtMs: 0,
      startRevealPending: false,
      waitingDeadlineMs: nowMs + configuredBotWaitMs,
      startedAtMs: 0,
      turnDeadlineMs: 0,
      stakeHtg,
      stakeDoes,
      entryCostDoes: stakeDoes,
      rewardAmountDoes,
      rewardAmountHtg,
      entryFundingByUid: {},
      entryFundingCurrencyByUid: { [uid]: "htg" },
      allowBots: true,
      botWaitMs: configuredBotWaitMs,
      botWaitSeconds: Math.max(1, Math.round(configuredBotWaitMs / 1000)),
      botDifficulty: configuredBotDifficulty || PUBLIC_DUEL_BOT_DEFAULT_DIFFICULTY,
      botProfileName: botName,
    };
    tx.set(roomRefDoc, roomData);
    return {
      ...buildDuelV2PublicState(roomRefDoc.id, roomData, uid),
      resumed: false,
      charged: false,
    };
  });
}

async function createFriendDuelRoomV2({ uid, email, payload = {} }) {
  assertDuelV2HardAvailable();
  const stakeHtg = assertPrivateDuelV2StakeHtg(payload);
  const stakeDoes = stakeHtg * RATE_HTG_TO_DOES;
  const rewardAmountDoes = Math.floor(stakeDoes * 1.85);
  const rewardAmountHtg = buildRewardAmountHtg(stakeDoes, rewardAmountDoes);

  const activeRoom = await findActiveDuelV2RoomForUser(uid);
  if (activeRoom) {
    const resolvedActiveRoom = await db.runTransaction(async (tx) => {
      return resolveOrReadActiveDuelV2RoomTx(tx, duelV2RoomRef(activeRoom.roomId), uid, Date.now());
    });
    if (resolvedActiveRoom && String(resolvedActiveRoom.status || "").trim().toLowerCase() !== "ended") {
      if (String(resolvedActiveRoom.roomMode || "").trim() === "duel_v2_friends") {
        return {
          ...resolvedActiveRoom,
          resumed: true,
        };
      }
      throw new HttpsError("failed-precondition", "Ou deja nan yon lot sal Domino duel aktif.", {
        roomId: activeRoom.roomId,
        status: activeRoom.status,
        roomMode: activeRoom.roomMode || "duel_v2_public",
      });
    }
  }

  const inviteCode = await generateUniqueFriendDuelV2InviteCode();
  return db.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const walletSnap = await tx.get(walletRef(uid));
    const walletData = walletSnap.exists ? (walletSnap.data() || {}) : {};
    assertWalletNotFrozen(walletData);
    applyHtgStakeDebit(walletData, { stakeHtg });

    const roomRefDoc = duelV2RoomRef();
    const roomData = {
      ownerUid: uid,
      roomMode: "duel_v2_friends",
      status: "waiting",
      started: false,
      isPrivate: true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
      inviteCode,
      inviteCodeNormalized: normalizeCode(inviteCode),
      playerUids: [uid, ""],
      playerNames: [sanitizePlayerLabel(email || uid, 0), ""],
      seats: { [uid]: 0 },
      roomPresenceMs: { [uid]: nowMs },
      humanCount: 1,
      botCount: 0,
      currentPlayer: -1,
      winnerSeat: -1,
      winnerUid: "",
      endedReason: "",
      settlementStatus: "",
      settlementAppliedAtMs: 0,
      startRevealPending: false,
      waitingDeadlineMs: nowMs + FRIEND_ROOM_WAIT_MS,
      startedAtMs: 0,
      turnDeadlineMs: 0,
      stakeHtg,
      stakeDoes,
      entryCostDoes: stakeDoes,
      rewardAmountDoes,
      rewardAmountHtg,
      entryFundingByUid: {},
      entryFundingCurrencyByUid: { [uid]: "htg" },
      allowBots: false,
    };
    tx.set(roomRefDoc, roomData);
    return {
      ...buildDuelV2PublicState(roomRefDoc.id, roomData, uid),
      resumed: false,
      charged: false,
    };
  });
}

async function resumeFriendDuelRoomV2({ uid, payload = {} }) {
  assertDuelV2HardAvailable();
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw new HttpsError("invalid-argument", "roomId requis.");
  }

  const roomSnap = await duelV2RoomRef(roomId).get();
  if (!roomSnap.exists) {
    throw new HttpsError("not-found", "Salon prive Duel V2 introuvable.");
  }

  const room = roomSnap.data() || {};
  if (!isFriendDuelV2Room(room)) {
    throw new HttpsError("failed-precondition", "Sa pa yon salon prive Duel V2 valab.");
  }

  const playerUids = Array.isArray(room.playerUids)
    ? room.playerUids.slice(0, 2).map((item) => String(item || "").trim())
    : ["", ""];
  if (!playerUids.includes(uid)) {
    throw new HttpsError("permission-denied", "Ou pa nan salon prive Duel sa a.");
  }
  return {
    ...buildDuelV2PublicState(roomId, room, uid),
    resumed: true,
  };
}

async function joinFriendDuelRoomByCodeV2({ uid, email, payload = {} }) {
  assertDuelV2HardAvailable();
  const inviteCodeNormalized = normalizeCode(payload.inviteCode || payload.code || "");
  if (!inviteCodeNormalized) {
    throw new HttpsError("invalid-argument", "Kod salon an obligatwa.");
  }

  const matchingSnap = await db
    .collection(DUEL_V2_ROOMS_COLLECTION)
    .where("inviteCodeNormalized", "==", inviteCodeNormalized)
    .limit(8)
    .get();
  const roomDoc = matchingSnap.docs.find((docSnap) => isFriendDuelV2Room(docSnap.data() || {})) || null;
  if (!roomDoc) {
    throw new HttpsError("not-found", "Kod salon prive Duel sa a pa egziste.");
  }

  const targetRoomId = String(roomDoc.id || "").trim();
  const activeRoom = await findActiveDuelV2RoomForUser(uid);
  if (activeRoom && activeRoom.roomId !== targetRoomId) {
    const resolvedActiveRoom = await db.runTransaction(async (tx) => {
      return resolveOrReadActiveDuelV2RoomTx(tx, duelV2RoomRef(activeRoom.roomId), uid, Date.now());
    });
    if (resolvedActiveRoom && String(resolvedActiveRoom.status || "").trim().toLowerCase() !== "ended") {
      throw new HttpsError("failed-precondition", "Ou deja nan yon lot sal Domino duel aktif.", {
        roomId: activeRoom.roomId,
        status: activeRoom.status,
        roomMode: activeRoom.roomMode || "duel_v2_public",
      });
    }
  }

  return db.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const roomRefDoc = duelV2RoomRef(targetRoomId);
    const [roomSnap, walletSnap] = await Promise.all([tx.get(roomRefDoc), tx.get(walletRef(uid))]);
    if (!roomSnap.exists) {
      throw new HttpsError("not-found", "Kod salon prive Duel sa a pa egziste.");
    }

    const walletData = walletSnap.exists ? (walletSnap.data() || {}) : {};
    assertWalletNotFrozen(walletData);
    const room = roomSnap.data() || {};
    if (!isFriendDuelV2Room(room)) {
      throw new HttpsError("failed-precondition", "Sa pa yon salon prive Duel V2 valab.");
    }

    const deadline = resolveDuelV2WaitDeadlineMs(room, nowMs);
    if (deadline > 0 && nowMs >= deadline && String(room.status || "").trim() === "waiting") {
      throw new HttpsError("failed-precondition", "Kod salon prive Duel sa a ekspire.");
    }

    const playerUids = Array.isArray(room.playerUids)
      ? room.playerUids.slice(0, 2).map((item) => String(item || "").trim())
      : ["", ""];
    const existingSeat = playerUids.findIndex((item) => item === uid);
    if (existingSeat >= 0) {
      const nextPresence = room.roomPresenceMs && typeof room.roomPresenceMs === "object"
        ? { ...room.roomPresenceMs }
        : {};
      nextPresence[uid] = nowMs;
      tx.set(roomRefDoc, {
        roomPresenceMs: nextPresence,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });
      return {
        ...buildDuelV2PublicState(roomRefDoc.id, {
          ...room,
          roomPresenceMs: nextPresence,
          updatedAtMs: nowMs,
        }, uid),
        resumed: true,
        charged: false,
      };
    }

    const status = String(room.status || "").trim();
    const humans = playerUids.filter(Boolean).length;
    if (status !== "waiting" || humans >= 2) {
      throw new HttpsError("failed-precondition", "Salon prive Duel sa a deja ranpli.");
    }

    const seatIndex = playerUids.findIndex((item) => !item);
    if (seatIndex < 0) {
      throw new HttpsError("failed-precondition", "Salon prive Duel sa a deja ranpli.");
    }

    const nextPlayerUids = playerUids.slice();
    nextPlayerUids[seatIndex] = uid;
    const nextPlayerNames = Array.isArray(room.playerNames) ? room.playerNames.slice(0, 2) : ["", ""];
    nextPlayerNames[seatIndex] = sanitizePlayerLabel(email || uid, seatIndex);
    const nextSeats = room.seats && typeof room.seats === "object" ? { ...room.seats } : {};
    nextSeats[uid] = seatIndex;
    const nextPresence = room.roomPresenceMs && typeof room.roomPresenceMs === "object"
      ? { ...room.roomPresenceMs }
      : {};
    nextPresence[uid] = nowMs;
    const roomStakeHtg = safeInt(room.stakeHtg || 25);
    const roomStakeDoes = safeInt(room.entryCostDoes || room.stakeDoes || (roomStakeHtg * RATE_HTG_TO_DOES));
    const roomRewardAmountDoes = safeInt(room.rewardAmountDoes || Math.floor(roomStakeDoes * 1.85));
    const roomRewardAmountHtg = safeInt(room.rewardAmountHtg || buildRewardAmountHtg(roomStakeDoes, roomRewardAmountDoes));
    const nextEntryFundingCurrencyByUid = room.entryFundingCurrencyByUid && typeof room.entryFundingCurrencyByUid === "object"
      ? { ...room.entryFundingCurrencyByUid }
      : {};
    nextPlayerUids.forEach((playerUid) => {
      if (playerUid) nextEntryFundingCurrencyByUid[playerUid] = "htg";
    });

    const roomForCharge = {
      ...room,
      playerUids: nextPlayerUids,
      playerNames: nextPlayerNames,
      seats: nextSeats,
      roomPresenceMs: nextPresence,
      stakeHtg: roomStakeHtg,
      stakeDoes: roomStakeDoes,
      entryCostDoes: roomStakeDoes,
      rewardAmountDoes: roomRewardAmountDoes,
      rewardAmountHtg: roomRewardAmountHtg,
      entryFundingCurrencyByUid: nextEntryFundingCurrencyByUid,
      allowBots: false,
    };
    const chargeResult = await chargeRoomEntriesTx(tx, roomForCharge, nextPlayerUids, roomStakeDoes);
    const joinedRoom = {
      ...roomForCharge,
      entryFundingByUid: chargeResult.entryFundingByUid,
      settlementStatus: "pending",
      settlementAppliedAtMs: 0,
      started: true,
      humanCount: 2,
      botCount: 0,
    };
    tx.set(roomRefDoc, {
      playerUids: nextPlayerUids,
      playerNames: nextPlayerNames,
      seats: nextSeats,
      roomPresenceMs: nextPresence,
      humanCount: 2,
      botCount: 0,
      stakeHtg: roomStakeHtg,
      stakeDoes: roomStakeDoes,
      entryCostDoes: roomStakeDoes,
      rewardAmountDoes: roomRewardAmountDoes,
      rewardAmountHtg: roomRewardAmountHtg,
      entryFundingByUid: chargeResult.entryFundingByUid,
      entryFundingCurrencyByUid: nextEntryFundingCurrencyByUid,
      settlementStatus: "pending",
      settlementAppliedAtMs: 0,
      updatedAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const started = buildStartedDuelV2RoomTransaction(tx, roomRefDoc, joinedRoom, { nowMs });
    if (String(started.finalState?.endedReason || "").trim()) {
      await settleDuelV2RoomTx(tx, roomRefDoc, {
        ...joinedRoom,
        ...started.roomUpdate,
      }, started.finalState);
      await writeDuelV2RoomResultIfEndedTx(tx, roomRefDoc, joinedRoom, started.roomUpdate);
    }

    return {
      ...buildDuelV2PublicState(roomRefDoc.id, {
        ...joinedRoom,
        ...started.roomUpdate,
        startedAtMs: safeSignedInt(started.roomUpdate.startedAtMs, nowMs),
        openingSeat: safeSignedInt(started.finalState.openingSeat, -1),
        openingTileId: safeSignedInt(started.finalState.openingTileId, -1),
        openingReason: String(started.finalState.openingReason || "").trim(),
        privateDeckOrder: started.privateDeckOrder,
      }, uid, started.finalState),
      resumed: false,
      charged: true,
      does: safeInt(chargeResult.afterDoesByUid[uid]),
    };
  });
}

async function getDuelV2RoomState({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw new HttpsError("invalid-argument", "roomId requis.");
  }
  const result = await db.runTransaction(async (tx) => {
    return resolveOrReadActiveDuelV2RoomTx(tx, duelV2RoomRef(roomId), uid, Date.now());
  });
  if (!result) {
    throw new HttpsError("not-found", "Salle Duel V2 introuvable.");
  }
  return result;
}

async function touchRoomPresenceDuelV2({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw new HttpsError("invalid-argument", "roomId requis.");
  }
  const result = await db.runTransaction(async (tx) => {
    const roomRefDoc = duelV2RoomRef(roomId);
    const stateRef = duelV2GameStateRef(roomId);
    const [roomSnap, stateSnap] = await Promise.all([tx.get(roomRefDoc), tx.get(stateRef)]);
    if (!roomSnap.exists) {
      throw new HttpsError("not-found", "Salle Duel V2 introuvable.");
    }
    const room = roomSnap.data() || {};
    const playerUids = Array.isArray(room.playerUids)
      ? room.playerUids.slice(0, 2).map((item) => String(item || "").trim())
      : ["", ""];
    if (!playerUids.includes(uid)) {
      throw new HttpsError("permission-denied", "Tu ne fais pas partie de cette salle Duel V2.");
    }
    const liveState = stateSnap.exists ? normalizeDuelGameState(stateSnap.data(), room) : null;
    const nowMs = Date.now();
    const nextPresence = room.roomPresenceMs && typeof room.roomPresenceMs === "object"
      ? { ...room.roomPresenceMs }
      : {};
    nextPresence[uid] = nowMs;

    if (String(room.status || "").trim() !== "playing") {
      tx.set(roomRefDoc, {
        roomPresenceMs: nextPresence,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });
      return buildDuelV2PublicState(roomId, {
        ...room,
        roomPresenceMs: nextPresence,
        updatedAtMs: nowMs,
      }, uid, liveState);
    }

    const staleSeat = playerUids.findIndex((playerUid, seat) => {
      if (!playerUid || playerUid === uid) return false;
      const lastSeenMs = safeSignedInt(nextPresence[playerUid], 0);
      return lastSeenMs > 0 && (nowMs - lastSeenMs) >= DUEL_PRESENCE_GRACE_MS;
    });
    if (staleSeat >= 0) {
      const nextState = didBothSeatsActInDuel(liveState || {})
        ? buildDuelV2QuitState(liveState || {}, room, staleSeat)
        : buildDuelV2TimeoutState(liveState || {}, room);
      const roomUpdate = buildDuelRoomUpdateFromGameState({
        ...room,
        roomPresenceMs: nextPresence,
      }, nextState, []);
      roomUpdate.roomPresenceMs = nextPresence;
      const settlementWalletSnaps = await preloadDuelSettlementWalletSnapsTx(tx, { ...room, ...roomUpdate }, nextState);
      tx.set(stateRef, buildDuelGameStateWrite(nextState), { merge: true });
      tx.set(roomRefDoc, roomUpdate, { merge: true });
      await settleDuelV2RoomTx(tx, roomRefDoc, {
        ...room,
        ...roomUpdate,
        __preloadedSettlementWalletSnaps: settlementWalletSnaps,
      }, nextState);
      await writeDuelV2RoomResultIfEndedTx(tx, roomRefDoc, room, roomUpdate);
      return buildDuelV2PublicState(roomId, { ...room, ...roomUpdate }, uid, nextState);
    }

    tx.set(roomRefDoc, {
      roomPresenceMs: nextPresence,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    }, { merge: true });
    return buildDuelV2PublicState(roomId, {
      ...room,
      roomPresenceMs: nextPresence,
      updatedAtMs: nowMs,
    }, uid, liveState);
  });
  return result;
}

async function leaveRoomDuelV2({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  const reason = sanitizeText(payload.reason || "", 80) || "leave";
  if (!roomId) {
    throw new HttpsError("invalid-argument", "roomId requis.");
  }

  return db.runTransaction(async (tx) => {
    const roomRefDoc = duelV2RoomRef(roomId);
    const stateRef = duelV2GameStateRef(roomId);
    const [roomSnap, stateSnap] = await Promise.all([tx.get(roomRefDoc), tx.get(stateRef)]);
    if (!roomSnap.exists) {
      return { ok: true, deleted: true, status: "missing" };
    }

    const room = roomSnap.data() || {};
    const playerUids = Array.isArray(room.playerUids)
      ? room.playerUids.slice(0, 2).map((item) => String(item || "").trim())
      : ["", ""];
    const localSeat = playerUids.findIndex((playerUid) => playerUid === uid);
    if (localSeat < 0) {
      throw new HttpsError("permission-denied", "Tu ne fais pas partie de cette salle Duel V2.");
    }

    const status = String(room.status || "").trim();
    if (status === "waiting") {
      tx.delete(roomRefDoc);
      if (stateSnap.exists) tx.delete(stateRef);
      return { ok: true, deleted: true, status: "waiting", reason };
    }

    const currentState = stateSnap.exists ? normalizeDuelGameState(stateSnap.data(), room) : createInitialDuelGameState(room, room.privateDeckOrder || []);
    if (String(currentState.endedReason || "").trim()) {
      return {
        ok: true,
        deleted: false,
        status: "ended",
        endedReason: String(currentState.endedReason || "").trim(),
      };
    }

    const nextState = buildDuelV2QuitState(currentState, room, localSeat);
    const roomUpdate = buildDuelRoomUpdateFromGameState(room, nextState, []);
    const settlementWalletSnaps = await preloadDuelSettlementWalletSnapsTx(tx, { ...room, ...roomUpdate }, nextState);
    tx.set(stateRef, buildDuelGameStateWrite(nextState), { merge: true });
    tx.set(roomRefDoc, roomUpdate, { merge: true });
    await settleDuelV2RoomTx(tx, roomRefDoc, {
      ...room,
      ...roomUpdate,
      __preloadedSettlementWalletSnaps: settlementWalletSnaps,
    }, nextState);
    await writeDuelV2RoomResultIfEndedTx(tx, roomRefDoc, room, roomUpdate);
    return {
      ok: true,
      deleted: false,
      status: String(roomUpdate.status || room.status || ""),
      endedReason: String(nextState.endedReason || "").trim(),
    };
  });
}

async function requestFriendDuelRematchV2({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw new HttpsError("invalid-argument", "roomId requis.");
  }

  return db.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const roomRefDoc = duelV2RoomRef(roomId);
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      throw new HttpsError("not-found", "Salle Duel V2 introuvable.");
    }

    const room = roomSnap.data() || {};
    if (!isFriendDuelV2Room(room)) {
      throw new HttpsError("failed-precondition", "Rejouer sa a mache selman nan salon prive Duel la.");
    }

    const playerUids = Array.isArray(room.playerUids)
      ? room.playerUids.slice(0, 2).map((item) => String(item || "").trim())
      : ["", ""];
    if (!playerUids.includes(uid)) {
      throw new HttpsError("permission-denied", "Tu ne fais pas partie de cette salle Duel V2.");
    }

    const status = String(room.status || "").trim().toLowerCase();
    if (status !== "ended") {
      throw new HttpsError("failed-precondition", "Rejouer prive a disponib selman apre duel la fini.");
    }

    const activePlayers = playerUids.filter(Boolean);
    if (activePlayers.length !== 2) {
      throw new HttpsError("failed-precondition", "Lot jw a pa disponib ankò pou rematch la.");
    }

    const roomPresenceMs = room.roomPresenceMs && typeof room.roomPresenceMs === "object"
      ? { ...room.roomPresenceMs }
      : {};
    roomPresenceMs[uid] = nowMs;
    const rematchRequestUids = Array.isArray(room.rematchRequestUids)
      ? room.rematchRequestUids.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const nextRematchRequestUids = Array.from(new Set([...rematchRequestUids, uid]));

    if (nextRematchRequestUids.length < 2) {
      const rematchRequestedAtMs = room.rematchRequestedAtMs && typeof room.rematchRequestedAtMs === "object"
        ? { ...room.rematchRequestedAtMs }
        : {};
      rematchRequestedAtMs[uid] = nowMs;
      tx.set(roomRefDoc, {
        rematchRequestUids: nextRematchRequestUids,
        rematchRequestedAtMs,
        roomPresenceMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });
      return {
        ...buildDuelV2PublicState(roomId, {
          ...room,
          roomPresenceMs,
          rematchRequestUids: nextRematchRequestUids,
          updatedAtMs: nowMs,
        }, uid),
        started: false,
        waitingForOpponent: true,
        requestedCount: nextRematchRequestUids.length,
      };
    }

    const actionsSnap = await tx.get(roomRefDoc.collection(DUEL_V2_ACTIONS_SUBCOLLECTION));
    const settlementsSnap = await tx.get(roomRefDoc.collection("settlements"));
    const roomStakeHtg = safeInt(room.stakeHtg || 25);
    const roomStakeDoes = safeInt(room.entryCostDoes || room.stakeDoes || (roomStakeHtg * RATE_HTG_TO_DOES));
    const roomRewardAmountDoes = safeInt(room.rewardAmountDoes || Math.floor(roomStakeDoes * 1.85));
    const roomRewardAmountHtg = safeInt(room.rewardAmountHtg || buildRewardAmountHtg(roomStakeDoes, roomRewardAmountDoes));
    const nextEntryFundingCurrencyByUid = room.entryFundingCurrencyByUid && typeof room.entryFundingCurrencyByUid === "object"
      ? { ...room.entryFundingCurrencyByUid }
      : {};
    activePlayers.forEach((playerUid) => {
      nextEntryFundingCurrencyByUid[playerUid] = normalizeFundingCurrency(nextEntryFundingCurrencyByUid[playerUid] || "htg");
    });
    const roomForCharge = {
      ...room,
      playerUids,
      playerNames: Array.isArray(room.playerNames) ? room.playerNames.slice(0, 2) : ["", ""],
      seats: room.seats && typeof room.seats === "object" ? { ...room.seats } : {},
      roomPresenceMs,
      stakeHtg: roomStakeHtg,
      stakeDoes: roomStakeDoes,
      entryCostDoes: roomStakeDoes,
      rewardAmountDoes: roomRewardAmountDoes,
      rewardAmountHtg: roomRewardAmountHtg,
      entryFundingCurrencyByUid: nextEntryFundingCurrencyByUid,
      humanCount: 2,
      botCount: 0,
      allowBots: false,
    };
    const chargeResult = await chargeRoomEntriesTx(tx, roomForCharge, activePlayers, roomStakeDoes);
    actionsSnap.docs.forEach((docSnap) => tx.delete(docSnap.ref));
    settlementsSnap.docs.forEach((docSnap) => tx.delete(docSnap.ref));
    const joinedRoom = {
      ...roomForCharge,
      entryFundingByUid: chargeResult.entryFundingByUid,
      settlementStatus: "pending",
      settlementAppliedAtMs: 0,
      started: true,
    };
    tx.set(roomRefDoc, {
      playerUids,
      playerNames: Array.isArray(room.playerNames) ? room.playerNames.slice(0, 2) : ["", ""],
      seats: room.seats && typeof room.seats === "object" ? { ...room.seats } : {},
      roomPresenceMs,
      humanCount: 2,
      botCount: 0,
      stakeHtg: roomStakeHtg,
      stakeDoes: roomStakeDoes,
      entryCostDoes: roomStakeDoes,
      rewardAmountDoes: roomRewardAmountDoes,
      rewardAmountHtg: roomRewardAmountHtg,
      entryFundingByUid: chargeResult.entryFundingByUid,
      entryFundingCurrencyByUid: nextEntryFundingCurrencyByUid,
      settlementStatus: "pending",
      settlementAppliedAtMs: 0,
      updatedAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const started = buildStartedDuelV2RoomTransaction(tx, roomRefDoc, joinedRoom, { nowMs });
    if (String(started.finalState?.endedReason || "").trim()) {
      await settleDuelV2RoomTx(tx, roomRefDoc, {
        ...joinedRoom,
        ...started.roomUpdate,
      }, started.finalState);
      await writeDuelV2RoomResultIfEndedTx(tx, roomRefDoc, joinedRoom, started.roomUpdate);
    }

    return {
      ...buildDuelV2PublicState(roomRefDoc.id, {
        ...joinedRoom,
        ...started.roomUpdate,
        startedAtMs: safeSignedInt(started.roomUpdate.startedAtMs, nowMs),
        openingSeat: safeSignedInt(started.finalState.openingSeat, -1),
        openingTileId: safeSignedInt(started.finalState.openingTileId, -1),
        openingReason: String(started.finalState.openingReason || "").trim(),
        privateDeckOrder: started.privateDeckOrder,
      }, uid, started.finalState),
      started: true,
      waitingForOpponent: false,
      requestedCount: 2,
      rematchRequestUids: [],
      charged: true,
      does: safeInt(chargeResult.afterDoesByUid[uid]),
    };
  });
}

async function submitActionDuelV2({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  const clientActionId = sanitizeText(payload.clientActionId || "", 120)
    || `duelv2_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
  const action = payload.action && typeof payload.action === "object" ? payload.action : null;
  if (!roomId || !action) {
    throw new HttpsError("invalid-argument", "roomId et action duel sont requis.");
  }

  const roomRefDoc = duelV2RoomRef(roomId);
  return db.runTransaction(async (tx) => {
    const [roomSnap, stateSnap] = await Promise.all([
      tx.get(roomRefDoc),
      tx.get(duelV2GameStateRef(roomId)),
    ]);
    if (!roomSnap.exists) {
      throw new HttpsError("not-found", "Salle Duel V2 introuvable.");
    }

    const room = roomSnap.data() || {};
    if (String(room.status || "").trim() !== "playing") {
      throw new HttpsError("failed-precondition", "Le duel n'est pas en cours.");
    }

    const playerUids = Array.isArray(room.playerUids)
      ? room.playerUids.slice(0, 2).map((item) => String(item || "").trim())
      : ["", ""];
    const localSeat = playerUids.findIndex((playerUid) => playerUid === uid);
    if (localSeat < 0) {
      throw new HttpsError("permission-denied", "Tu ne fais pas partie de ce duel.");
    }

    const currentState = stateSnap.exists ? normalizeDuelGameState(stateSnap.data(), room) : createInitialDuelGameState(room, room.privateDeckOrder || []);
    if (String(currentState.endedReason || "").trim()) {
      throw new HttpsError("failed-precondition", "Le duel est deja termine.");
    }
    if (currentState.idempotencyKeys && currentState.idempotencyKeys[clientActionId]) {
      return {
        ok: true,
        duplicate: true,
        roomId,
        status: String(room.status || ""),
        winnerSeat: safeSignedInt(currentState.winnerSeat, -1),
        endedReason: String(currentState.endedReason || ""),
      };
    }
    if (safeSignedInt(currentState.currentPlayer, -1) !== localSeat) {
      throw new HttpsError("failed-precondition", "Se pa tou pa ou.");
    }

    const resolvedMove = resolveRequestedDuelMove(currentState, localSeat, action);
    const applied = applyResolvedDuelMove(currentState, room, resolvedMove, uid);
    const postHumanState = {
      ...applied.state,
      idempotencyKeys: {
        ...(applied.state.idempotencyKeys && typeof applied.state.idempotencyKeys === "object" ? applied.state.idempotencyKeys : {}),
        [clientActionId]: true,
      },
    };
    const botProgress = runPublicDuelBotTurns(postHumanState, room);
    const nextState = botProgress.records.length > 0 || String(botProgress.state.endedReason || "").trim()
      ? botProgress.state
      : postHumanState;
    const records = [applied.record, ...botProgress.records];
    const roomUpdate = buildDuelRoomUpdateFromGameState(room, nextState, records);
    const settlementWalletSnaps = nextState.endedReason
      ? await preloadDuelSettlementWalletSnapsTx(tx, { ...room, ...roomUpdate }, nextState)
      : null;

    tx.set(duelV2GameStateRef(roomId), buildDuelGameStateWrite(nextState), { merge: true });
    tx.set(roomRefDoc, roomUpdate, { merge: true });
    records.forEach((record) => {
      tx.set(duelV2ActionRef(roomId, String(record.seq)), {
        ...record,
        roomId,
        engineVersion: 2,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    });

    const settlement = nextState.endedReason
      ? await settleDuelV2RoomTx(tx, roomRefDoc, {
        ...room,
        ...roomUpdate,
        __preloadedSettlementWalletSnaps: settlementWalletSnaps,
      }, nextState)
      : null;
    if (nextState.endedReason) {
      await writeDuelV2RoomResultIfEndedTx(tx, roomRefDoc, room, roomUpdate);
    }

    return {
      ok: true,
      roomId,
      status: String(roomUpdate.status || room.status || ""),
      winnerSeat: safeSignedInt(nextState.winnerSeat, -1),
      winnerUid: String(nextState.winnerUid || ""),
      endedReason: String(nextState.endedReason || ""),
      seq: safeInt(nextState.appliedActionSeq),
      currentPlayer: safeSignedInt(nextState.currentPlayer, -1),
      settlement,
    };
  });
}

module.exports = {
  createFriendDuelRoomV2,
  getDuelV2RoomState,
  joinFriendDuelRoomByCodeV2,
  joinMatchmakingDuelV2,
  leaveRoomDuelV2,
  requestFriendDuelRematchV2,
  resumeFriendDuelRoomV2,
  submitActionDuelV2,
  touchRoomPresenceDuelV2,
};
