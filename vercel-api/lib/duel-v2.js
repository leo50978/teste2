const crypto = require("crypto");

const { admin, db } = require("./firebase-admin");
const { buildRewardAmountHtg, buildStakeAmountHtg } = require("./domino-classic");
const { makeHttpError } = require("./http");
const { walletRef, assertWalletNotFrozen } = require("./player-wallet");
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
const DUEL_TURN_LIMIT_MS = 30 * 1000;
const DUEL_PRESENCE_GRACE_MS = 30 * 1000;
const FRIEND_ROOM_CODE_SIZE = 6;
const PUBLIC_DUEL_V2_STAKE_HTG = 25;
const MIN_PRIVATE_DUEL_V2_STAKE_HTG = 25;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

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
    botCount: 0,
    totalSeats: playerUids.filter(Boolean).length,
    entryFundingByUid: snapshot.entryFundingByUid && typeof snapshot.entryFundingByUid === "object"
      ? snapshot.entryFundingByUid
      : {},
    winnerSeat,
    winnerUid,
    winnerType: winnerUid ? "human" : "unknown",
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
  const duration = isFriendDuelV2Room(room) ? FRIEND_ROOM_WAIT_MS : ROOM_WAIT_MS;
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
    humanCount: playerUids.filter(Boolean).length,
    startRevealPending: room.startRevealPending === true,
    waitingDeadlineMs: safeSignedInt(room.waitingDeadlineMs, 0),
    startedAtMs: safeSignedInt(room.startedAtMs, 0),
    turnDeadlineMs: safeSignedInt(room.turnDeadlineMs, 0),
    inviteCode: String(room.inviteCode || "").trim(),
    stakeHtg: safeInt(room.stakeHtg || 25),
    rematchRequestUids,
    privateDeckOrder,
  };
}

function buildStartedDuelV2RoomTransaction(tx, roomRefDoc, room = {}, options = {}) {
  const nowMs = safeSignedInt(options.nowMs, Date.now()) || Date.now();
  const deckOrder = makeDeckOrder();
  const initialState = createInitialDuelGameState(room, deckOrder);
  const openingMove = buildOpeningMoveForDuelState(initialState);
  const openingApplied = applyResolvedDuelMove(initialState, room, openingMove, "server:opening");
  const finalState = openingApplied.state;
  tx.set(duelV2GameStateRef(roomRefDoc.id), buildDuelGameStateWrite(finalState), { merge: true });
  tx.set(duelV2ActionRef(roomRefDoc.id, String(openingApplied.record.seq)), {
    ...openingApplied.record,
    roomId: roomRefDoc.id,
    engineVersion: 2,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  const updates = {
    playerUids: Array.isArray(room.playerUids) ? room.playerUids.slice(0, 2) : ["", ""],
    playerNames: Array.isArray(room.playerNames) ? room.playerNames.slice(0, 2) : ["", ""],
    seats: room.seats && typeof room.seats === "object" ? { ...room.seats } : {},
    humanCount: 2,
    botCount: 0,
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
  Object.assign(updates, buildDuelRoomUpdateFromGameState(room, finalState, [openingApplied.record]));
  tx.set(roomRefDoc, updates, { merge: true });

  return {
    roomUpdate: updates,
    finalState,
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
  if (turnDeadlineMs > 0 && turnDeadlineMs <= nowMs) {
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

  return buildDuelV2PublicState(roomRefDoc.id, {
    ...room,
    privateDeckOrder: Array.isArray(liveState.deckOrder) ? liveState.deckOrder.slice(0, 28) : [],
  }, safeUid, liveState);
}

async function joinMatchmakingDuelV2({ uid, email, payload = {} }) {
  const stakeHtg = PUBLIC_DUEL_V2_STAKE_HTG;
  const stakeDoes = stakeHtg * RATE_HTG_TO_DOES;
  const rewardAmountDoes = Math.floor(stakeDoes * 1.85);
  const rewardAmountHtg = buildRewardAmountHtg(stakeDoes, rewardAmountDoes);
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

  const poolRef = duelV2MatchmakingPoolRef(`stake_${stakeHtg}`);
  return db.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const [poolSnap, walletSnap] = await Promise.all([
      tx.get(poolRef),
      tx.get(walletRef(uid)),
    ]);
    const walletData = walletSnap.exists ? (walletSnap.data() || {}) : {};
    assertWalletNotFrozen(walletData);

    const openRoomId = String(poolSnap.exists ? ((poolSnap.data() || {}).openRoomId || "") : "").trim();
    if (openRoomId) {
      const openRoomRef = duelV2RoomRef(openRoomId);
      const openRoomSnap = await tx.get(openRoomRef);
      if (openRoomSnap.exists) {
        const room = openRoomSnap.data() || {};
        const playerUids = Array.isArray(room.playerUids)
          ? room.playerUids.slice(0, 2).map((item) => String(item || "").trim())
          : ["", ""];
        const humans = playerUids.filter(Boolean).length;
        const status = String(room.status || "").trim();
        const openWaitingDeadlineMs = resolveDuelV2WaitDeadlineMs(room, nowMs);
        if (
          status === "waiting"
          && humans < 2
          && safeInt(room.stakeHtg || 25) === stakeHtg
          && !(openWaitingDeadlineMs > 0 && nowMs >= openWaitingDeadlineMs)
        ) {
          const seatIndex = playerUids.findIndex((item) => !item);
          if (seatIndex >= 0) {
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
            const currentFundingCurrencies = room.entryFundingCurrencyByUid && typeof room.entryFundingCurrencyByUid === "object"
              ? { ...room.entryFundingCurrencyByUid }
              : {};
            nextPlayerUids.forEach((playerUid) => {
              if (!playerUid) return;
              currentFundingCurrencies[playerUid] = normalizeFundingCurrency(currentFundingCurrencies[playerUid] || "htg");
            });

            try {
              const roomForCharge = {
                ...room,
                playerUids: nextPlayerUids,
                playerNames: nextPlayerNames,
                seats: nextSeats,
                roomPresenceMs: nextPresence,
                entryFundingCurrencyByUid: currentFundingCurrencies,
                stakeHtg,
                stakeDoes,
                entryCostDoes: stakeDoes,
                rewardAmountDoes,
                rewardAmountHtg,
              };
              const chargeResult = await chargeRoomEntriesTx(tx, roomForCharge, nextPlayerUids, stakeDoes);
              const joinedRoom = {
                ...roomForCharge,
                humanCount: 2,
                botCount: 0,
                started: true,
                entryFundingByUid: chargeResult.entryFundingByUid,
                settlementStatus: "pending",
                settlementAppliedAtMs: 0,
              };
              tx.set(openRoomRef, {
                playerUids: nextPlayerUids,
                playerNames: nextPlayerNames,
                seats: nextSeats,
                roomPresenceMs: nextPresence,
                humanCount: 2,
                botCount: 0,
                entryFundingByUid: chargeResult.entryFundingByUid,
                entryFundingCurrencyByUid: currentFundingCurrencies,
                stakeHtg,
                stakeDoes,
                entryCostDoes: stakeDoes,
                rewardAmountDoes,
                rewardAmountHtg,
                settlementStatus: "pending",
                settlementAppliedAtMs: 0,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAtMs: nowMs,
              }, { merge: true });
              const started = buildStartedDuelV2RoomTransaction(tx, openRoomRef, joinedRoom, { nowMs });
              clearDuelV2MatchmakingPool(tx, poolRef);
              if (String(started.finalState?.endedReason || "").trim()) {
                await settleDuelV2RoomTx(tx, openRoomRef, {
                  ...joinedRoom,
                  ...started.roomUpdate,
                }, started.finalState);
                await writeDuelV2RoomResultIfEndedTx(tx, openRoomRef, joinedRoom, started.roomUpdate);
              }

              const publicRoomSnapshot = {
                ...joinedRoom,
                status: String(started.roomUpdate.status || joinedRoom.status || "playing").trim() || "playing",
                currentPlayer: safeSignedInt(started.finalState.currentPlayer, -1),
                openingSeat: safeSignedInt(started.finalState.openingSeat, -1),
                openingTileId: safeSignedInt(started.finalState.openingTileId, -1),
                openingReason: String(started.finalState.openingReason || "").trim(),
                lastActionSeq: safeSignedInt(started.finalState.appliedActionSeq, -1),
                turnActual: Math.max(0, safeInt(started.finalState.appliedActionSeq) + 1),
                winnerSeat: safeSignedInt(started.finalState.winnerSeat, -1),
                winnerUid: String(started.finalState.winnerUid || "").trim(),
                endedReason: String(started.finalState.endedReason || "").trim(),
                turnDeadlineMs: safeSignedInt(started.roomUpdate.turnDeadlineMs, 0),
                startedAtMs: safeSignedInt(started.roomUpdate.startedAtMs, nowMs),
                waitingDeadlineMs: 0,
                startRevealPending: false,
                privateDeckOrder: started.privateDeckOrder,
              };

              return {
                ...buildDuelV2PublicState(openRoomRef.id, publicRoomSnapshot, uid, started.finalState),
                resumed: false,
                charged: true,
                does: safeInt(chargeResult.afterDoesByUid[uid]),
              };
            } catch (error) {
              if (String(error?.code || "") === "insufficient-funds") {
                tx.set(openRoomRef, {
                  status: "closed",
                  endedReason: "stale_balance",
                  endedAt: admin.firestore.FieldValue.serverTimestamp(),
                  endedAtMs: nowMs,
                  waitingDeadlineMs: admin.firestore.FieldValue.delete(),
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                  updatedAtMs: nowMs,
                }, { merge: true });
                clearDuelV2MatchmakingPool(tx, poolRef);
              } else {
                console.error("[DUEL_V2_JOIN_PUBLIC_MATCHMAKING] failed_to_fill_open_room", {
                  roomId: openRoomId,
                  joinerUid: uid,
                  ownerUid: String(room.ownerUid || "").trim(),
                  humans,
                  status,
                  seatIndex,
                  errorCode: String(error?.code || ""),
                  errorMessage: String(error?.message || "unknown_error"),
                });
                throw error;
              }
            }
          }
        }
      }
      clearDuelV2MatchmakingPool(tx, poolRef);
    }

    const roomRefDoc = duelV2RoomRef();
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
      waitingDeadlineMs: nowMs + ROOM_WAIT_MS,
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
    setDuelV2MatchmakingPoolOpen(tx, poolRef, roomRefDoc.id, stakeHtg);
    return {
      ...buildDuelV2PublicState(roomRefDoc.id, roomData, uid),
      resumed: false,
      charged: false,
    };
  });
}

async function createFriendDuelRoomV2({ uid, email, payload = {} }) {
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
    const nextState = {
      ...applied.state,
      idempotencyKeys: {
        ...(applied.state.idempotencyKeys && typeof applied.state.idempotencyKeys === "object" ? applied.state.idempotencyKeys : {}),
        [clientActionId]: true,
      },
    };
    const roomUpdate = buildDuelRoomUpdateFromGameState(room, nextState, [applied.record]);
    const settlementWalletSnaps = nextState.endedReason
      ? await preloadDuelSettlementWalletSnapsTx(tx, { ...room, ...roomUpdate }, nextState)
      : null;

    tx.set(duelV2GameStateRef(roomId), buildDuelGameStateWrite(nextState), { merge: true });
    tx.set(roomRefDoc, roomUpdate, { merge: true });
    tx.set(duelV2ActionRef(roomId, String(applied.record.seq)), {
      ...applied.record,
      roomId,
      engineVersion: 2,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

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
