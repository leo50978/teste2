const { safeInt, safeSignedInt } = require("./safe");

const PLAYERS = ["P1", "P2"];
const STATE = {
  DICE_NOT_ROLLED: "DICE_NOT_ROLLED",
  DICE_ROLLED: "DICE_ROLLED",
  GAME_OVER: "GAME_OVER",
};

const BASE_POSITIONS = {
  P1: [500, 501, 502, 503],
  P2: [600, 601, 602, 603],
};

const START_POSITIONS = {
  P1: 0,
  P2: 26,
};

const HOME_ENTRANCE = {
  P1: [100, 101, 102, 103, 104],
  P2: [200, 201, 202, 203, 204],
};

const HOME_POSITIONS = {
  P1: 105,
  P2: 205,
};

const TURNING_POINTS = {
  P1: 50,
  P2: 24,
};

const SAFE_POSITIONS = [0, 8, 13, 21, 26, 34, 39, 47];

function clonePositions(source = {}) {
  return {
    P1: Array.isArray(source.P1) ? source.P1.slice(0, 4).map((value) => safeSignedInt(value)) : BASE_POSITIONS.P1.slice(),
    P2: Array.isArray(source.P2) ? source.P2.slice(0, 4).map((value) => safeSignedInt(value)) : BASE_POSITIONS.P2.slice(),
  };
}

function resolvePlayerBySeat(seatIndex = 0) {
  return PLAYERS[safeInt(seatIndex) % 2] || "P1";
}

function resolveSeatByPlayer(player = "P1") {
  return String(player || "").trim() === "P2" ? 1 : 0;
}

function createInitialFriendEngineState({ startingSeat = 0, nowMs = Date.now() } = {}) {
  const currentPlayer = resolvePlayerBySeat(startingSeat);
  return {
    currentPositions: clonePositions(),
    currentPlayer,
    turnIndex: resolveSeatByPlayer(currentPlayer),
    state: STATE.DICE_NOT_ROLLED,
    diceValue: 0,
    eligiblePieces: [],
    winnerPlayer: "",
    winnerSeat: -1,
    lastDicePlayer: "",
    turnStartedAtMs: safeSignedInt(nowMs),
    actionSeq: 0,
    lastMove: null,
  };
}

function isBasePosition(player, position) {
  return BASE_POSITIONS[player].includes(position);
}

function getIncrementedPositionFrom(player, currentPosition) {
  const current = safeSignedInt(currentPosition);
  if (current === TURNING_POINTS[player]) {
    return HOME_ENTRANCE[player][0];
  }
  if (HOME_ENTRANCE[player].includes(current)) {
    return current + 1;
  }
  return current === 51 ? 0 : current + 1;
}

function getProjectedPosition(positions, player, piece, moveBy) {
  let projectedPosition = safeSignedInt(positions[player][piece]);
  let remaining = safeInt(moveBy);

  if (isBasePosition(player, projectedPosition)) {
    return START_POSITIONS[player];
  }

  while (remaining > 0) {
    projectedPosition = getIncrementedPositionFrom(player, projectedPosition);
    remaining -= 1;
  }
  return projectedPosition;
}

function isPieceEligibleForRoll(positions, player, piece, diceValue) {
  const currentPosition = safeSignedInt(positions[player][piece]);
  const roll = safeInt(diceValue);
  if (currentPosition === HOME_POSITIONS[player]) {
    return false;
  }
  if (isBasePosition(player, currentPosition) && roll !== 6) {
    return false;
  }
  if (HOME_ENTRANCE[player].includes(currentPosition) && roll > (HOME_POSITIONS[player] - currentPosition)) {
    return false;
  }
  return true;
}

function getEligiblePiecesForRoll(positions, player, diceValue) {
  return [0, 1, 2, 3].filter((piece) => isPieceEligibleForRoll(positions, player, piece, diceValue));
}

function countCapturesAtPosition(positions, player, targetPosition) {
  const opponent = player === "P1" ? "P2" : "P1";
  if (SAFE_POSITIONS.includes(targetPosition)) {
    return 0;
  }
  let captures = 0;
  [0, 1, 2, 3].forEach((piece) => {
    if (safeSignedInt(positions[opponent][piece]) === safeSignedInt(targetPosition)) {
      captures += 1;
    }
  });
  return captures;
}

function hasPlayerWon(positions, player) {
  return [0, 1, 2, 3].every((piece) => safeSignedInt(positions[player][piece]) === HOME_POSITIONS[player]);
}

function buildStateSnapshot(engineState = {}) {
  return {
    currentPositions: clonePositions(engineState.currentPositions || {}),
    currentPlayer: resolvePlayerBySeat(resolveSeatByPlayer(engineState.currentPlayer || "P1")),
    turnIndex: resolveSeatByPlayer(engineState.currentPlayer || "P1"),
    state: String(engineState.state || STATE.DICE_NOT_ROLLED),
    diceValue: safeInt(engineState.diceValue),
    eligiblePieces: Array.isArray(engineState.eligiblePieces) ? engineState.eligiblePieces.map((value) => safeInt(value)) : [],
    winnerPlayer: String(engineState.winnerPlayer || "").trim(),
    winnerSeat: Number.isFinite(Number(engineState.winnerSeat)) ? Math.trunc(Number(engineState.winnerSeat)) : -1,
    lastDicePlayer: String(engineState.lastDicePlayer || "").trim() === "P2" ? "P2" : (String(engineState.lastDicePlayer || "").trim() === "P1" ? "P1" : ""),
    turnStartedAtMs: safeSignedInt(engineState.turnStartedAtMs),
    actionSeq: safeInt(engineState.actionSeq),
    lastMove: engineState.lastMove && typeof engineState.lastMove === "object" ? { ...engineState.lastMove } : null,
  };
}

function buildRoomSummaryFromEngine(engineState = {}) {
  const snapshot = buildStateSnapshot(engineState);
  return {
    currentPlayer: snapshot.currentPlayer,
    turnIndex: snapshot.turnIndex,
    state: snapshot.state,
    diceValue: snapshot.diceValue,
    lastDicePlayer: snapshot.lastDicePlayer,
    eligiblePieces: snapshot.eligiblePieces,
    turnStartedAtMs: snapshot.turnStartedAtMs,
    winnerPlayer: snapshot.winnerPlayer,
    winnerSeat: snapshot.winnerSeat,
    actionSeq: snapshot.actionSeq,
  };
}

function applyRoll(engineState = {}, { diceValue = 0, nowMs = Date.now() } = {}) {
  const next = buildStateSnapshot(engineState);
  if (next.state !== STATE.DICE_NOT_ROLLED) {
    throw new Error("ludo-friend-roll-not-allowed");
  }
  const player = next.currentPlayer;
  const roll = safeInt(diceValue);
  const eligiblePieces = getEligiblePiecesForRoll(next.currentPositions, player, roll);

  next.diceValue = roll;
  next.lastDicePlayer = player;
  next.actionSeq = safeInt(next.actionSeq) + 1;
  next.lastMove = null;

  if (!eligiblePieces.length) {
    next.currentPlayer = player === "P1" ? "P2" : "P1";
    next.turnIndex = resolveSeatByPlayer(next.currentPlayer);
    next.state = STATE.DICE_NOT_ROLLED;
    next.eligiblePieces = [];
    next.turnStartedAtMs = safeSignedInt(nowMs);
    return next;
  }

  next.state = STATE.DICE_ROLLED;
  next.eligiblePieces = eligiblePieces;
  next.turnStartedAtMs = safeSignedInt(nowMs);
  return next;
}

function applyMove(engineState = {}, { pieceIndex = 0, nowMs = Date.now() } = {}) {
  const next = buildStateSnapshot(engineState);
  if (next.state !== STATE.DICE_ROLLED) {
    throw new Error("ludo-friend-move-not-allowed");
  }

  const player = next.currentPlayer;
  const piece = safeInt(pieceIndex);
  const eligiblePieces = getEligiblePiecesForRoll(next.currentPositions, player, next.diceValue);
  if (!eligiblePieces.includes(piece)) {
    throw new Error("ludo-friend-illegal-move");
  }

  const currentPosition = safeSignedInt(next.currentPositions[player][piece]);
  let nextPosition = currentPosition;
  if (isBasePosition(player, currentPosition)) {
    nextPosition = START_POSITIONS[player];
  } else {
    nextPosition = getProjectedPosition(next.currentPositions, player, piece, next.diceValue);
  }
  next.currentPositions[player][piece] = nextPosition;

  const opponent = player === "P1" ? "P2" : "P1";
  const capturedPieces = [];
  if (!SAFE_POSITIONS.includes(nextPosition)) {
    [0, 1, 2, 3].forEach((opponentPiece) => {
      if (safeSignedInt(next.currentPositions[opponent][opponentPiece]) === nextPosition) {
        capturedPieces.push(opponentPiece);
      }
    });
  }
  capturedPieces.forEach((opponentPiece) => {
    next.currentPositions[opponent][opponentPiece] = BASE_POSITIONS[opponent][opponentPiece];
  });

  next.actionSeq = safeInt(next.actionSeq) + 1;
  next.lastMove = {
    player,
    piece,
    fromPosition: currentPosition,
    toPosition: nextPosition,
    captures: capturedPieces.length,
    diceValue: next.diceValue,
  };

  if (hasPlayerWon(next.currentPositions, player)) {
    next.state = STATE.GAME_OVER;
    next.winnerPlayer = player;
    next.winnerSeat = resolveSeatByPlayer(player);
    next.eligiblePieces = [];
    next.turnStartedAtMs = safeSignedInt(nowMs);
    return next;
  }

  const reachedHome = nextPosition === HOME_POSITIONS[player];
  const keepTurn = reachedHome || capturedPieces.length > 0 || next.diceValue === 6;
  if (keepTurn) {
    next.state = STATE.DICE_NOT_ROLLED;
    next.eligiblePieces = [];
    next.turnStartedAtMs = safeSignedInt(nowMs);
    return next;
  }

  next.currentPlayer = opponent;
  next.turnIndex = resolveSeatByPlayer(opponent);
  next.state = STATE.DICE_NOT_ROLLED;
  next.eligiblePieces = [];
  next.turnStartedAtMs = safeSignedInt(nowMs);
  return next;
}

module.exports = {
  BASE_POSITIONS,
  HOME_POSITIONS,
  PLAYERS,
  SAFE_POSITIONS,
  STATE,
  applyMove,
  applyRoll,
  buildRoomSummaryFromEngine,
  buildStateSnapshot,
  countCapturesAtPosition,
  createInitialFriendEngineState,
  getEligiblePiecesForRoll,
  getProjectedPosition,
  hasPlayerWon,
  resolvePlayerBySeat,
  resolveSeatByPlayer,
};
