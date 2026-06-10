const crypto = require("crypto");

const { admin, db } = require("./firebase-admin");
const { makeHttpError } = require("./http");
const { assertWalletNotFrozen } = require("./player-wallet");
const { safeInt, safeSignedInt, sanitizeText } = require("./safe");
const {
  applyHtgRewardCredit,
  applyHtgStakeDebit,
  htgToDoes,
  readApprovedHtg,
  readProvisionalHtg,
} = require("./wallet-htg");

const CLIENTS_COLLECTION = "clients";
const MORPION_ROOM_RESULTS_COLLECTION = "morpionRoomResults";
const MORPION_V3_GAME_STATES_COLLECTION = "morpionGameStatesV3";
const MORPION_V3_MATCHMAKING_POOLS_COLLECTION = "morpionMatchmakingPoolsV3";
const MORPION_V3_ROOMS_COLLECTION = "morpionRoomsV3";

const BOARD_SIZE = 15;
const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE;
const FRIEND_ROOM_CODE_SIZE = 6;
const FRIEND_ROOM_WAIT_MS = 10 * 60 * 1000;
const MORPION_PUBLIC_STAKE_HTG = 25;
const MORPION_PRIVATE_MIN_STAKE_HTG = 25;
const MORPION_IDEMPOTENCY_LIMIT = 200;
const MORPION_REWARD_MULTIPLIER = 1.8;
const MORPION_TURN_LIMIT_MS = 30 * 1000;
const MORPION_V3_PRESENCE_GRACE_MS = 15 * 1000;
const ROOM_WAIT_MS = 15 * 1000;

const INVITE_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function clientRef(uid = "") {
  return db.collection(CLIENTS_COLLECTION).doc(String(uid || "").trim());
}

function morpionRoomResultRef(roomId = "") {
  return db.collection(MORPION_ROOM_RESULTS_COLLECTION).doc(String(roomId || "").trim());
}

function morpionV3GameStateRef(roomId = "") {
  return db.collection(MORPION_V3_GAME_STATES_COLLECTION).doc(String(roomId || "").trim());
}

function morpionV3MatchmakingPoolRef(stakeHtg = 25) {
  return db.collection(MORPION_V3_MATCHMAKING_POOLS_COLLECTION).doc(`htg_${safeInt(stakeHtg)}`);
}

function morpionV3RoomRef(roomId = "") {
  const safeRoomId = String(roomId || "").trim();
  return safeRoomId
    ? db.collection(MORPION_V3_ROOMS_COLLECTION).doc(safeRoomId)
    : db.collection(MORPION_V3_ROOMS_COLLECTION).doc();
}

function assertPublicMorpionV3Stake(value) {
  const stakeHtg = safeInt(value || MORPION_PUBLIC_STAKE_HTG);
  if (stakeHtg !== MORPION_PUBLIC_STAKE_HTG) {
    throw makeHttpError(400, "morpion-v3-stake-not-allowed", "Miz Mopyon sa a poko disponib.");
  }
  return stakeHtg;
}

function assertPrivateMorpionV3Stake(value) {
  const stakeHtg = safeInt(value || MORPION_PRIVATE_MIN_STAKE_HTG);
  if (stakeHtg < MORPION_PRIVATE_MIN_STAKE_HTG) {
    throw makeHttpError(
      400,
      "morpion-v3-private-stake-too-low",
      `Miz salon prive Mopyon an dwe omwen ${MORPION_PRIVATE_MIN_STAKE_HTG} HTG.`
    );
  }
  return stakeHtg;
}

function readPlayableHtg(clientData = {}) {
  return Math.max(0, safeInt(readApprovedHtg(clientData)) + safeInt(readProvisionalHtg(clientData)));
}

function assertWalletCanCoverMorpionStake(clientData = {}, requiredHtg = 0, {
  code = "morpion-v3-insufficient-funds",
  message = "Solde HTG insuffisant.",
  culpritUid = "",
  culpritRole = "player",
} = {}) {
  assertWalletNotFrozen(clientData);
  const safeRequiredHtg = safeInt(requiredHtg);
  const playableHtg = readPlayableHtg(clientData);
  if (safeRequiredHtg > 0 && playableHtg < safeRequiredHtg) {
    throw makeHttpError(409, code, message, {
      culpritUid: String(culpritUid || "").trim(),
      culpritRole: String(culpritRole || "player").trim() || "player",
      playableHtg,
      requiredHtg: safeRequiredHtg,
      missingHtg: Math.max(0, safeRequiredHtg - playableHtg),
    });
  }
  return {
    playableHtg,
    requiredHtg: safeRequiredHtg,
  };
}

function buildRewardAmountDoes(stakeHtg = 0) {
  return Math.floor(htgToDoes(stakeHtg) * MORPION_REWARD_MULTIPLIER);
}

function buildRewardAmountHtg(stakeHtg = 0) {
  return Math.floor(safeInt(stakeHtg) * MORPION_REWARD_MULTIPLIER);
}

function buildEmptyMorpionBoard() {
  return Array.from({ length: TOTAL_CELLS }, () => -1);
}

function normalizeMorpionBoard(raw = []) {
  if (!Array.isArray(raw) || raw.length !== TOTAL_CELLS) {
    return buildEmptyMorpionBoard();
  }
  return raw.map((cell) => {
    const parsed = Number(cell);
    return parsed === 0 || parsed === 1 ? parsed : -1;
  });
}

function normalizeCode(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "");
}

function randomCode(size = FRIEND_ROOM_CODE_SIZE) {
  let out = "";
  for (let index = 0; index < size; index += 1) {
    out += INVITE_CODE_CHARS[Math.floor(Math.random() * INVITE_CODE_CHARS.length)];
  }
  return out;
}

function sanitizePlayerLabel(email, fallbackSeat = 0) {
  const local = String(email || "").split("@")[0] || "";
  const cleaned = local.replace(/[^a-z0-9 _.-]/gi, "").trim().slice(0, 24);
  return cleaned || `Joueur ${safeInt(fallbackSeat) + 1}`;
}

function getRoomSeats(room = {}) {
  return room?.seats && typeof room.seats === "object" ? room.seats : {};
}

function getSeatForUser(room = {}, uid = "") {
  const seats = getRoomSeats(room);
  const safeUid = String(uid || "").trim();
  return typeof seats[safeUid] === "number" ? seats[safeUid] : -1;
}

function isFriendMorpionV3Room(room = {}) {
  return String(room.roomMode || "").trim() === "morpion_friends_v3";
}

function isMorpionSeatHuman(room = {}, seat = -1) {
  const safeSeat = safeSignedInt(seat, -1);
  if (safeSeat < 0 || safeSeat > 1) return false;
  const playerUids = Array.isArray(room.playerUids) ? room.playerUids : [];
  return String(playerUids[safeSeat] || "").trim().length > 0;
}

function resolveMorpionWaitingDeadlineMs(room = {}, nowMs = Date.now()) {
  const explicit = safeSignedInt(room.waitingDeadlineMs, 0);
  if (explicit > 0) return explicit;
  const createdAtMs = safeSignedInt(room.createdAtMs, 0);
  const waitMs = isFriendMorpionV3Room(room) ? FRIEND_ROOM_WAIT_MS : ROOM_WAIT_MS;
  if (createdAtMs > 0) return createdAtMs + waitMs;
  return nowMs + waitMs;
}

function getMorpionRowCol(index) {
  const safeIndex = Math.max(0, Math.min(TOTAL_CELLS - 1, safeInt(index)));
  return {
    row: Math.floor(safeIndex / BOARD_SIZE),
    col: safeIndex % BOARD_SIZE,
  };
}

function getMorpionCellIndex(row, col) {
  return (row * BOARD_SIZE) + col;
}

function checkMorpionWinningLine(board = [], cellIndex = 0, seat = 0) {
  const { row, col } = getMorpionRowCol(cellIndex);
  const directions = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];

  for (const [deltaRow, deltaCol] of directions) {
    const line = [cellIndex];
    let nextRow = row + deltaRow;
    let nextCol = col + deltaCol;

    while (nextRow >= 0 && nextRow < BOARD_SIZE && nextCol >= 0 && nextCol < BOARD_SIZE) {
      const nextIndex = getMorpionCellIndex(nextRow, nextCol);
      if (board[nextIndex] !== seat) break;
      line.push(nextIndex);
      nextRow += deltaRow;
      nextCol += deltaCol;
    }

    nextRow = row - deltaRow;
    nextCol = col - deltaCol;
    while (nextRow >= 0 && nextRow < BOARD_SIZE && nextCol >= 0 && nextCol < BOARD_SIZE) {
      const nextIndex = getMorpionCellIndex(nextRow, nextCol);
      if (board[nextIndex] !== seat) break;
      line.unshift(nextIndex);
      nextRow -= deltaRow;
      nextCol -= deltaCol;
    }

    if (line.length >= 5) return line.slice(0, 5);
  }

  return [];
}

function isMorpionBoardFull(board = []) {
  return Array.isArray(board) && board.length === TOTAL_CELLS && board.every((cell) => cell === 0 || cell === 1);
}

function resolveInitialMorpionCurrentPlayer() {
  return crypto.randomInt(0, 2);
}

function createInitialMorpionGameState() {
  return {
    board: buildEmptyMorpionBoard(),
    currentPlayer: resolveInitialMorpionCurrentPlayer(),
    moveCount: 0,
    placedCountBySeat: [0, 0],
    winnerSeat: -1,
    winnerUid: "",
    endedReason: "",
    winningLine: [],
    appliedActionSeq: 0,
    idempotencyKeys: {},
  };
}

function normalizeMorpionGameState(raw = {}, room = {}) {
  const winnerSeat = safeSignedInt(raw.winnerSeat, -1);
  const placedCountBySeatRaw = Array.isArray(raw.placedCountBySeat) ? raw.placedCountBySeat : [];
  return {
    board: normalizeMorpionBoard(raw.board),
    currentPlayer: safeSignedInt(raw.currentPlayer, 0),
    moveCount: safeInt(raw.moveCount),
    placedCountBySeat: [0, 1].map((seat) => Math.max(0, safeInt(placedCountBySeatRaw[seat]))),
    winnerSeat: winnerSeat >= 0 ? winnerSeat : -1,
    winnerUid: String(raw.winnerUid || "").trim(),
    endedReason: String(raw.endedReason || "").trim(),
    winningLine: Array.isArray(raw.winningLine)
      ? raw.winningLine.map((item) => safeInt(item)).filter((item) => item >= 0 && item < TOTAL_CELLS).slice(0, 5)
      : [],
    appliedActionSeq: safeInt(raw.appliedActionSeq),
    idempotencyKeys: raw.idempotencyKeys && typeof raw.idempotencyKeys === "object"
      ? { ...raw.idempotencyKeys }
      : {},
    playerUids: Array.from({ length: 2 }, (_, idx) => String((room.playerUids || [])[idx] || "")),
  };
}

function trimIdempotencyKeys(keys = {}, maxEntries = MORPION_IDEMPOTENCY_LIMIT) {
  const entries = Object.entries(keys || {}).slice(-Math.max(1, safeInt(maxEntries) || MORPION_IDEMPOTENCY_LIMIT));
  return Object.fromEntries(entries);
}

function buildMorpionGameStateWrite(nextState = {}) {
  return {
    board: Array.isArray(nextState.board) ? nextState.board.slice(0, TOTAL_CELLS) : buildEmptyMorpionBoard(),
    currentPlayer: safeSignedInt(nextState.currentPlayer, 0),
    moveCount: safeInt(nextState.moveCount),
    placedCountBySeat: [0, 1].map((seat) => Math.max(0, safeInt((nextState.placedCountBySeat || [])[seat]))),
    winnerSeat: safeSignedInt(nextState.winnerSeat, -1),
    winnerUid: String(nextState.winnerUid || "").trim(),
    endedReason: String(nextState.endedReason || "").trim(),
    winningLine: Array.isArray(nextState.winningLine) ? nextState.winningLine.slice(0, 5) : [],
    appliedActionSeq: safeInt(nextState.appliedActionSeq),
    idempotencyKeys: trimIdempotencyKeys(nextState.idempotencyKeys),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
}

function buildMorpionRoomUpdateFromGameState(room = {}, nextState = {}, records = [], nowMs = Date.now()) {
  const lastRecord = records.length > 0 ? records[records.length - 1] : null;
  const nextActionSeq = safeInt(safeSignedInt(nextState.appliedActionSeq, 0) + 1);
  const nextTurnStartedAtMs = nextState.endedReason ? 0 : safeSignedInt(nowMs, Date.now());
  const turnDeadlineMs = nextState.endedReason ? 0 : (nextTurnStartedAtMs + MORPION_TURN_LIMIT_MS);

  const update = {
    nextActionSeq,
    lastActionSeq: safeInt(nextState.appliedActionSeq),
    currentPlayer: safeSignedInt(nextState.currentPlayer, 0),
    turnActual: nextActionSeq,
    turnStartedAt: nextState.endedReason
      ? admin.firestore.FieldValue.delete()
      : admin.firestore.FieldValue.serverTimestamp(),
    turnStartedAtMs: nextTurnStartedAtMs,
    turnDeadlineMs,
    playedCount: safeInt(room.playedCount) + records.length,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: safeSignedInt(nowMs, Date.now()),
    turnLockedUntilMs: 0,
    symbolBySeat: ["X", "O"],
  };

  if (lastRecord) {
    update.lastMove = {
      seq: safeInt(lastRecord.seq),
      type: String(lastRecord.type || "place").trim(),
      player: safeSignedInt(lastRecord.player, -1),
      symbol: String(lastRecord.symbol || "").trim(),
      cellIndex: safeInt(lastRecord.cellIndex),
      row: safeInt(lastRecord.row),
      col: safeInt(lastRecord.col),
    };
  }

  if (nextState.endedReason) {
    update.status = "ended";
    update.winnerSeat = safeSignedInt(nextState.winnerSeat, -1);
    update.winnerUid = String(nextState.winnerUid || "").trim();
    update.endedReason = String(nextState.endedReason || "").trim();
    update.endedAt = admin.firestore.FieldValue.serverTimestamp();
    update.endedAtMs = safeSignedInt(nowMs, Date.now());
  }

  return update;
}

function applyMorpionMove(state = {}, room = {}, move = {}, actorUid = "") {
  const seat = safeSignedInt(move.seat, -1);
  const cellIndex = safeSignedInt(move.cellIndex, -1);

  if (seat < 0 || seat > 1) {
    throw makeHttpError(400, "morpion-v3-invalid-seat", "Joueur Mopyon invalide.");
  }
  if (cellIndex < 0 || cellIndex >= TOTAL_CELLS) {
    throw makeHttpError(400, "morpion-v3-invalid-cell", "Case Mopyon invalide.");
  }
  if (safeSignedInt(state.currentPlayer, -1) !== seat) {
    throw makeHttpError(409, "morpion-v3-not-your-turn", "Se pa tou pa ou.");
  }
  if ((state.board || [])[cellIndex] !== -1) {
    throw makeHttpError(409, "morpion-v3-cell-occupied", "Ka sa a deja pran.");
  }

  const board = Array.isArray(state.board) ? state.board.slice(0, TOTAL_CELLS) : buildEmptyMorpionBoard();
  board[cellIndex] = seat;
  const winningLine = checkMorpionWinningLine(board, cellIndex, seat);
  const winnerSeat = winningLine.length >= 5 ? seat : -1;
  const nextPlayer = winnerSeat >= 0 ? seat : (seat === 0 ? 1 : 0);
  const nextMoveCount = safeInt(state.moveCount) + 1;
  const placedCountBySeat = [0, 1].map((currentSeat) => Math.max(0, safeInt((state.placedCountBySeat || [])[currentSeat])));
  placedCountBySeat[seat] += 1;
  const draw = winnerSeat < 0 && isMorpionBoardFull(board);
  const { row, col } = getMorpionRowCol(cellIndex);

  const nextState = {
    ...state,
    board,
    currentPlayer: nextPlayer,
    moveCount: nextMoveCount,
    placedCountBySeat,
    winnerSeat: draw ? -1 : winnerSeat,
    winnerUid: winnerSeat >= 0 && isMorpionSeatHuman(room, winnerSeat)
      ? String((room.playerUids || [])[winnerSeat] || "").trim()
      : "",
    endedReason: winnerSeat >= 0 ? "line" : (draw ? "draw" : ""),
    winningLine,
    appliedActionSeq: safeInt(state.appliedActionSeq) + 1,
  };

  const record = {
    seq: nextState.appliedActionSeq,
    type: "place",
    player: seat,
    symbol: seat === 0 ? "X" : "O",
    cellIndex,
    row,
    col,
    actorUid: String(actorUid || "").trim(),
  };

  return { state: nextState, record };
}

function buildMorpionV3TimeoutState(state = {}, room = {}) {
  const timedOutSeat = safeSignedInt(state.currentPlayer, -1);
  const placedCountBySeat = [0, 1].map((seat) => Math.max(0, safeInt((state.placedCountBySeat || [])[seat])));
  const shouldRefund = placedCountBySeat[0] <= 0 || placedCountBySeat[1] <= 0;

  if (shouldRefund) {
    return {
      ...state,
      placedCountBySeat,
      winnerSeat: -1,
      winnerUid: "",
      endedReason: "timeout_refund",
      currentPlayer: timedOutSeat >= 0 ? timedOutSeat : safeSignedInt(state.currentPlayer, 0),
      winningLine: [],
      appliedActionSeq: safeInt(state.appliedActionSeq) + 1,
    };
  }

  const winnerSeat = timedOutSeat === 0 ? 1 : 0;
  return {
    ...state,
    placedCountBySeat,
    winnerSeat,
    winnerUid: isMorpionSeatHuman(room, winnerSeat) ? String((room.playerUids || [])[winnerSeat] || "").trim() : "",
    endedReason: "timeout",
    currentPlayer: winnerSeat,
    winningLine: [],
    appliedActionSeq: safeInt(state.appliedActionSeq) + 1,
  };
}

function buildMorpionV3QuitState(state = {}, room = {}, leavingSeat = -1) {
  const safeLeavingSeat = safeSignedInt(leavingSeat, -1);
  const placedCountBySeat = [0, 1].map((seat) => Math.max(0, safeInt((state.placedCountBySeat || [])[seat])));
  const shouldRefund = placedCountBySeat[0] <= 0 || placedCountBySeat[1] <= 0;

  if (shouldRefund) {
    return {
      ...state,
      placedCountBySeat,
      winnerSeat: -1,
      winnerUid: "",
      endedReason: "quit_refund_before_opening",
      currentPlayer: safeLeavingSeat >= 0 ? safeLeavingSeat : safeSignedInt(state.currentPlayer, 0),
      winningLine: [],
      appliedActionSeq: safeInt(state.appliedActionSeq) + 1,
    };
  }

  const winnerSeat = safeLeavingSeat === 0 ? 1 : 0;
  return {
    ...state,
    placedCountBySeat,
    winnerSeat,
    winnerUid: isMorpionSeatHuman(room, winnerSeat) ? String((room.playerUids || [])[winnerSeat] || "").trim() : "",
    endedReason: "quit",
    currentPlayer: winnerSeat,
    winningLine: [],
    appliedActionSeq: safeInt(state.appliedActionSeq) + 1,
  };
}

function resolveStoredEntryFunding(room = {}, playerUid = "") {
  const safeUid = String(playerUid || "").trim();
  const entryFundingByUid = room.entryFundingByUid && typeof room.entryFundingByUid === "object"
    ? room.entryFundingByUid
    : {};
  const fallbackStakeHtg = safeInt(room.stakeHtg);
  const fallbackStakeDoes = safeInt(room.entryCostDoes || room.stakeDoes || htgToDoes(fallbackStakeHtg));
  const raw = entryFundingByUid[safeUid] && typeof entryFundingByUid[safeUid] === "object"
    ? entryFundingByUid[safeUid]
    : {};

  return {
    fundingCurrency: "htg",
    approvedHtg: safeInt(raw.approvedHtg),
    provisionalHtg: safeInt(raw.provisionalHtg),
    approvedDoes: safeInt(raw.approvedDoes || htgToDoes(raw.approvedHtg)),
    provisionalDoes: safeInt(raw.provisionalDoes || htgToDoes(raw.provisionalHtg)),
    welcomeDoes: 0,
    beforeEntryPlayableHtg: safeInt(raw.beforeEntryPlayableHtg),
    afterEntryPlayableHtg: safeInt(raw.afterEntryPlayableHtg),
    convertedHtg: safeInt(raw.convertedHtg || raw.approvedHtg || raw.provisionalHtg || fallbackStakeHtg),
    convertedDoes: safeInt(raw.convertedDoes || fallbackStakeDoes),
  };
}

function buildEntryFundingRecord(clientData = {}, walletMutation = {}, stakeHtg = 0) {
  const beforePlayableHtg = Math.max(0, readApprovedHtg(clientData) + readProvisionalHtg(clientData));
  return {
    fundingCurrency: "htg",
    approvedHtg: safeInt(walletMutation?.gameEntryFunding?.approvedHtg),
    provisionalHtg: safeInt(walletMutation?.gameEntryFunding?.provisionalHtg),
    approvedDoes: safeInt(walletMutation?.gameEntryFunding?.approvedDoes),
    provisionalDoes: safeInt(walletMutation?.gameEntryFunding?.provisionalDoes),
    welcomeDoes: 0,
    beforeEntryPlayableHtg: beforePlayableHtg,
    afterEntryPlayableHtg: safeInt(walletMutation?.afterPlayableHtg),
    convertedHtg: safeInt(stakeHtg),
    convertedDoes: htgToDoes(stakeHtg),
  };
}

async function chargeMorpionEntriesTx(tx, room = {}, playerUids = [], stakeHtg = 0, options = {}) {
  const uniquePlayerUids = Array.from(new Set(
    (Array.isArray(playerUids) ? playerUids : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  ));
  const actorUid = String(options.actorUid || "").trim();
  const ownerUid = String(
    options.ownerUid
    || room.ownerUid
    || (Array.isArray(room.playerUids) ? room.playerUids[0] : "")
    || ""
  ).trim();

  const nowMs = Date.now();
  const clientSnapshots = await Promise.all(uniquePlayerUids.map(async (playerUid) => {
    const clientSnap = await tx.get(clientRef(playerUid));
    return {
      playerUid,
      clientData: clientSnap.exists ? (clientSnap.data() || {}) : {},
    };
  }));

  const entryFundingByUid = {};
  clientSnapshots.forEach(({ playerUid, clientData }) => {
    const safePlayerUid = String(playerUid || "").trim();
    const culpritRole = safePlayerUid && safePlayerUid === actorUid
      ? "requester"
      : (safePlayerUid && safePlayerUid === ownerUid ? "owner" : "player");
    const isFriendRoom = isFriendMorpionV3Room(room);
    const code = culpritRole === "owner" && isFriendRoom
      ? "morpion-v3-owner-insufficient-funds"
      : "morpion-v3-insufficient-funds";
    const message = culpritRole === "owner" && isFriendRoom
      ? "Kreyate salon an pa gen ase HTG anko pou lanse match la."
      : (culpritRole === "requester"
        ? "Ou pa gen ase HTG pou antre nan salon prive sa a."
        : "Youn nan jwe yo pa gen ase HTG pou match Mopyon sa a.");
    assertWalletCanCoverMorpionStake(clientData, stakeHtg, {
      code,
      message,
      culpritUid: safePlayerUid,
      culpritRole,
    });
  });
  clientSnapshots.forEach(({ playerUid, clientData }) => {
    const walletMutation = applyHtgStakeDebit(clientData, { stakeHtg });
    entryFundingByUid[playerUid] = buildEntryFundingRecord(clientData, walletMutation, stakeHtg);
    tx.set(clientRef(playerUid), {
      uid: playerUid,
      ...walletMutation.balancesPatch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAtMs: nowMs,
    }, { merge: true });
  });

  return {
    entryFundingByUid,
  };
}

async function generateUniqueFriendMorpionV3InviteCode(size = FRIEND_ROOM_CODE_SIZE, maxAttempts = 18) {
  const targetSize = Math.max(4, safeInt(size) || FRIEND_ROOM_CODE_SIZE);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = normalizeCode(randomCode(targetSize));
    if (!candidate) continue;
    const existing = await db
      .collection(MORPION_V3_ROOMS_COLLECTION)
      .where("inviteCodeNormalized", "==", candidate)
      .limit(1)
      .get();
    if (existing.empty) return candidate;
  }
  throw makeHttpError(409, "morpion-v3-invite-exhausted", "Impossible de generer yon kod salon prive inik.");
}

async function findActiveMorpionV3RoomForUser(uid = "") {
  const safeUid = String(uid || "").trim();
  if (!safeUid) return null;

  const nowMs = Date.now();
  const membershipSnap = await db
    .collection(MORPION_V3_ROOMS_COLLECTION)
    .where("playerUids", "array-contains", safeUid)
    .limit(8)
    .get();

  if (membershipSnap.empty) return null;

  const candidates = membershipSnap.docs.filter((docSnap) => {
    const data = docSnap.data() || {};
    const status = String(data.status || "").trim().toLowerCase();
    if (status === "playing") return true;
    if (status !== "waiting") return false;

    const humanCount = Array.isArray(data.playerUids)
      ? data.playerUids.filter(Boolean).length
      : safeInt(data.humanCount);
    const waitingDeadlineMs = resolveMorpionWaitingDeadlineMs(data, nowMs);
    if (humanCount < 2 && waitingDeadlineMs > 0 && nowMs >= waitingDeadlineMs) {
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

  const activeDoc = candidates[0];
  const room = activeDoc.data() || {};

  return {
    roomId: activeDoc.id,
    seatIndex: getSeatForUser(room, safeUid),
    status: String(room.status || "").trim(),
    stakeHtg: safeInt(room.stakeHtg),
    room,
  };
}

function buildStartedMorpionV3RoomTransaction(tx, roomRefDoc, room = {}, nowMs = Date.now()) {
  const initialState = createInitialMorpionGameState();
  tx.set(morpionV3GameStateRef(roomRefDoc.id), buildMorpionGameStateWrite(initialState), { merge: true });

  const turnDeadlineMs = safeSignedInt(nowMs, Date.now()) + MORPION_TURN_LIMIT_MS;
  const playerUids = Array.isArray(room.playerUids)
    ? room.playerUids.slice(0, 2).map((item) => String(item || "").trim())
    : ["", ""];
  const roomPresenceMs = {};
  playerUids.filter(Boolean).forEach((playerUid) => {
    roomPresenceMs[playerUid] = safeSignedInt(nowMs, Date.now());
  });

  tx.set(roomRefDoc, {
    engineVersion: 3,
    playerUids,
    playerNames: Array.isArray(room.playerNames) ? room.playerNames.slice(0, 2) : ["", ""],
    seats: getRoomSeats(room),
    entryFundingByUid: room.entryFundingByUid && typeof room.entryFundingByUid === "object"
      ? room.entryFundingByUid
      : {},
    entryFundingCurrencyByUid: room.entryFundingCurrencyByUid && typeof room.entryFundingCurrencyByUid === "object"
      ? room.entryFundingCurrencyByUid
      : {},
    humanCount: 2,
    botCount: 0,
    status: "playing",
    currentPlayer: safeSignedInt(initialState.currentPlayer, 0),
    symbolBySeat: ["X", "O"],
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    startedAtMs: safeSignedInt(nowMs, Date.now()),
    waitingDeadlineMs: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: safeSignedInt(nowMs, Date.now()),
    turnStartedAt: admin.firestore.FieldValue.serverTimestamp(),
    turnStartedAtMs: safeSignedInt(nowMs, Date.now()),
    turnDeadlineMs,
    turnLockedUntilMs: 0,
    roomPresenceMs,
    nextActionSeq: 1,
    lastActionSeq: 0,
    playedCount: 0,
    winnerSeat: admin.firestore.FieldValue.delete(),
    winnerUid: admin.firestore.FieldValue.delete(),
    endedReason: admin.firestore.FieldValue.delete(),
    endedAt: admin.firestore.FieldValue.delete(),
    endedAtMs: admin.firestore.FieldValue.delete(),
    rematchRequestUids: admin.firestore.FieldValue.delete(),
    rematchRequestedAtMs: admin.firestore.FieldValue.delete(),
  }, { merge: true });

  return {
    ok: true,
    started: true,
    status: "playing",
    currentPlayer: safeSignedInt(initialState.currentPlayer, 0),
    humanCount: 2,
    botCount: 0,
    turnDeadlineMs,
  };
}

function buildRoomStateResponse(roomId = "", room = {}, state = {}, seatIndex = -1) {
  const rematchRequestUids = Array.isArray(room.rematchRequestUids)
    ? room.rematchRequestUids.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const lastMove = room.lastMove && typeof room.lastMove === "object"
    ? {
      seq: safeInt(room.lastMove.seq),
      type: String(room.lastMove.type || "place").trim(),
      player: safeSignedInt(room.lastMove.player, -1),
      symbol: String(room.lastMove.symbol || "").trim(),
      cellIndex: safeSignedInt(room.lastMove.cellIndex, -1),
      row: safeSignedInt(room.lastMove.row, -1),
      col: safeSignedInt(room.lastMove.col, -1),
    }
    : null;
  return {
    ok: true,
    roomId: String(roomId || "").trim(),
    seatIndex: safeSignedInt(seatIndex, -1),
    status: String(room.status || "").trim(),
    roomMode: String(room.roomMode || "").trim() || "morpion_2p",
    inviteCode: String(room.inviteCode || "").trim(),
    isPrivate: room.isPrivate === true,
    stakeHtg: safeInt(room.stakeHtg),
    humanCount: Array.isArray(room.playerUids) ? room.playerUids.filter(Boolean).length : safeInt(room.humanCount),
    currentPlayer: safeSignedInt(state.currentPlayer, safeSignedInt(room.currentPlayer, -1)),
    waitingDeadlineMs: safeSignedInt(room.waitingDeadlineMs, 0),
    playerUids: Array.isArray(room.playerUids) ? room.playerUids.slice(0, 2) : ["", ""],
    playerNames: Array.isArray(room.playerNames) ? room.playerNames.slice(0, 2) : ["", ""],
    board: Array.isArray(state.board) ? state.board.slice(0, TOTAL_CELLS) : buildEmptyMorpionBoard(),
    moveCount: safeInt(state.moveCount),
    placedCountBySeat: Array.isArray(state.placedCountBySeat) ? state.placedCountBySeat.slice(0, 2) : [0, 0],
    winnerSeat: safeSignedInt(state.winnerSeat, -1),
    winnerUid: String(state.winnerUid || "").trim(),
    endedReason: String(state.endedReason || "").trim(),
    winningLine: Array.isArray(state.winningLine) ? state.winningLine.slice(0, 5) : [],
    lastMove,
    turnDeadlineMs: safeSignedInt(room.turnDeadlineMs, 0),
    rematchRequestUids,
    engineVersion: 3,
  };
}

function buildMorpionRoomResultDocId(roomId = "", snapshot = {}) {
  const safeRoomId = String(roomId || "").trim();
  const endedAtMs = safeSignedInt(snapshot.endedAtMs, Date.now()) || Date.now();
  return `${safeRoomId}_${endedAtMs}`;
}

async function settleMorpionV3RoomTx(tx, roomRefDoc, room = {}, state = {}, options = {}) {
  const endedReason = String(state.endedReason || room.endedReason || "").trim();
  if (!endedReason) {
    return {
      ok: true,
      settled: false,
      roomId: roomRefDoc.id,
      endedReason: "",
      refunds: [],
      reward: null,
    };
  }

  const normalizedRoom = {
    ...room,
    winnerSeat: safeSignedInt(state.winnerSeat, safeSignedInt(room.winnerSeat, -1)),
    winnerUid: String(state.winnerUid || room.winnerUid || "").trim(),
    endedReason,
    status: "ended",
  };
  const uniquePlayerUids = Array.from(new Set(
    (Array.isArray(normalizedRoom.playerUids) ? normalizedRoom.playerUids : [])
      .map((item) => String(item || "").trim())
      .filter(Boolean)
  ));
  const claimUid = sanitizeText(options.claimUid || "", 160);
  const settlementSummary = {
    ok: true,
    settled: true,
    roomId: roomRefDoc.id,
    endedReason,
    refunds: [],
    reward: null,
  };

  const preloadEntries = await Promise.all(uniquePlayerUids.map(async (playerUid) => {
    const clientSnap = await tx.get(clientRef(playerUid));
    return {
      playerUid,
      clientData: clientSnap.exists ? (clientSnap.data() || {}) : {},
    };
  }));
  const preloadedByUid = new Map(preloadEntries.map((entry) => [entry.playerUid, entry]));
  const nowMs = Date.now();

  if (["draw", "quit_refund_before_opening", "timeout_refund"].includes(endedReason)) {
    const refundTargets = claimUid
      ? uniquePlayerUids.filter((playerUid) => playerUid === claimUid)
      : uniquePlayerUids;

    for (const playerUid of refundTargets) {
      const preload = preloadedByUid.get(playerUid) || { clientData: {} };
      const entryFunding = resolveStoredEntryFunding(normalizedRoom, playerUid);
      const refundHtg = Math.max(
        0,
        safeInt(entryFunding.convertedHtg)
        || safeInt(entryFunding.approvedHtg) + safeInt(entryFunding.provisionalHtg)
        || safeInt(normalizedRoom.stakeHtg)
      );
      if (refundHtg <= 0) continue;

      const walletMutation = applyHtgRewardCredit(preload.clientData, {
        rewardHtg: refundHtg,
        rewardEntryFunding: entryFunding,
      });
      tx.set(clientRef(playerUid), {
        uid: playerUid,
        ...walletMutation.balancesPatch,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAtMs: nowMs,
      }, { merge: true });

      settlementSummary.refunds.push({
        uid: playerUid,
        refundedHtg: refundHtg,
        afterPlayableHtg: safeInt(walletMutation.afterPlayableHtg),
      });
    }

    return settlementSummary;
  }

  const winnerUid = String(normalizedRoom.winnerUid || "").trim();
  if (!winnerUid || !uniquePlayerUids.includes(winnerUid)) {
    return settlementSummary;
  }

  const rewardHtg = safeInt(normalizedRoom.rewardAmountHtg || buildRewardAmountHtg(normalizedRoom.stakeHtg));
  if (rewardHtg <= 0) {
    return settlementSummary;
  }

  const preload = preloadedByUid.get(winnerUid) || { clientData: {} };
  const entryFunding = resolveStoredEntryFunding(normalizedRoom, winnerUid);
  const walletMutation = applyHtgRewardCredit(preload.clientData, {
    rewardHtg,
    rewardEntryFunding: entryFunding,
  });
  tx.set(clientRef(winnerUid), {
    uid: winnerUid,
    ...walletMutation.balancesPatch,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSeenAtMs: nowMs,
  }, { merge: true });

  settlementSummary.reward = {
    uid: winnerUid,
    rewardAmountHtg: rewardHtg,
    afterPlayableHtg: safeInt(walletMutation.afterPlayableHtg),
  };

  return settlementSummary;
}

function buildRoomResultBalanceMaps(snapshot = {}) {
  const playerUids = Array.isArray(snapshot.playerUids)
    ? snapshot.playerUids.map((item) => String(item || "").trim()).filter(Boolean)
    : [];
  const beforeBalanceHtgByUid = {};
  const afterBalanceHtgByUid = {};
  const winnerUid = String(snapshot.winnerUid || "").trim();
  const endedReason = String(snapshot.endedReason || "").trim();
  const refundAll = ["draw", "quit_refund_before_opening", "timeout_refund"].includes(endedReason);
  const rewardHtg = safeInt(snapshot.rewardAmountHtg);

  playerUids.forEach((playerUid) => {
    const entryFunding = resolveStoredEntryFunding(snapshot, playerUid);
    const beforeEntryPlayableHtg = safeInt(entryFunding.beforeEntryPlayableHtg);
    const afterEntryPlayableHtg = safeInt(entryFunding.afterEntryPlayableHtg);
    if (beforeEntryPlayableHtg <= 0 && afterEntryPlayableHtg <= 0) return;

    beforeBalanceHtgByUid[playerUid] = beforeEntryPlayableHtg;
    if (refundAll) {
      afterBalanceHtgByUid[playerUid] = beforeEntryPlayableHtg;
      return;
    }
    if (winnerUid && winnerUid === playerUid) {
      afterBalanceHtgByUid[playerUid] = Math.max(0, afterEntryPlayableHtg + rewardHtg);
      return;
    }
    afterBalanceHtgByUid[playerUid] = Math.max(0, afterEntryPlayableHtg);
  });

  return {
    beforeBalanceHtgByUid,
    afterBalanceHtgByUid,
  };
}

function buildMorpionRoomResultDoc(roomId = "", room = {}, roomUpdate = {}) {
  const snapshot = { ...room, ...roomUpdate };
  const resultDocId = buildMorpionRoomResultDocId(roomId, snapshot);
  const playerUids = Array.isArray(snapshot.playerUids)
    ? snapshot.playerUids.map((item) => String(item || "").trim()).slice(0, 2)
    : ["", ""];
  const playerNames = Array.isArray(snapshot.playerNames)
    ? snapshot.playerNames.map((item) => String(item || "").trim()).slice(0, 2)
    : ["", ""];
  const winnerSeat = safeSignedInt(snapshot.winnerSeat, -1);
  const winnerUid = String(snapshot.winnerUid || playerUids[winnerSeat] || "").trim();
  const fundingCurrency = "htg";
  const stakeHtg = safeInt(snapshot.stakeHtg);
  const rewardAmountHtg = safeInt(snapshot.rewardAmountHtg || buildRewardAmountHtg(stakeHtg));
  const entryCostDoes = safeInt(snapshot.entryCostDoes || snapshot.stakeDoes || htgToDoes(stakeHtg));
  const rewardAmountDoes = safeInt(snapshot.rewardAmountDoes || buildRewardAmountDoes(stakeHtg));
  const { beforeBalanceHtgByUid, afterBalanceHtgByUid } = buildRoomResultBalanceMaps(snapshot);

  return {
    id: resultDocId,
    roomId: String(roomId || "").trim(),
    matchId: resultDocId,
    status: String(snapshot.status || "ended").trim().toLowerCase() || "ended",
    roomMode: String(snapshot.roomMode || "").trim(),
    isPrivate: snapshot.isPrivate === true,
    ownerUid: String(snapshot.ownerUid || "").trim(),
    inviteCode: String(snapshot.inviteCode || "").trim(),
    fundingCurrency,
    entryCostDoes,
    rewardAmountDoes,
    stakeHtg,
    rewardAmountHtg,
    humanCount: playerUids.filter(Boolean).length,
    botCount: 0,
    totalSeats: playerUids.filter(Boolean).length,
    playerUids,
    playerNames,
    entryFundingByUid: snapshot.entryFundingByUid && typeof snapshot.entryFundingByUid === "object"
      ? snapshot.entryFundingByUid
      : {},
    entryFundingCurrencyByUid: snapshot.entryFundingCurrencyByUid && typeof snapshot.entryFundingCurrencyByUid === "object"
      ? snapshot.entryFundingCurrencyByUid
      : {},
    winnerSeat,
    winnerUid,
    winnerType: winnerUid ? "human" : "unknown",
    endedReason: sanitizeText(snapshot.endedReason || "", 40),
    createdAtMs: safeSignedInt(snapshot.createdAtMs, 0),
    startedAtMs: safeSignedInt(snapshot.startedAtMs, 0),
    endedAtMs: safeSignedInt(snapshot.endedAtMs, Date.now()),
    beforeBalanceHtgByUid,
    afterBalanceHtgByUid,
    engineVersion: 3,
  };
}

async function writeMorpionRoomResultIfEndedTx(tx, roomRefDoc, room = {}, roomUpdate = {}) {
  const nextStatus = String(roomUpdate.status || room.status || "").trim().toLowerCase();
  if (nextStatus !== "ended") return;
  const snapshot = { ...room, ...roomUpdate };
  const resultDocId = buildMorpionRoomResultDocId(roomRefDoc.id, snapshot);

  tx.set(morpionRoomResultRef(resultDocId), {
    ...buildMorpionRoomResultDoc(roomRefDoc.id, room, roomUpdate),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function joinMatchmakingMorpionV3({ uid = "", email = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }

  const stakeHtg = assertPublicMorpionV3Stake(payload.stakeHtg || MORPION_PUBLIC_STAKE_HTG);
  const stakeDoes = htgToDoes(stakeHtg);
  const rewardAmountDoes = buildRewardAmountDoes(stakeHtg);
  const rewardAmountHtg = buildRewardAmountHtg(stakeHtg);

  const activeRoom = await findActiveMorpionV3RoomForUser(safeUid);
  if (activeRoom) {
    return {
      ok: true,
      resumed: true,
      roomId: activeRoom.roomId,
      seatIndex: activeRoom.seatIndex,
      status: activeRoom.status,
      stakeHtg: safeInt(activeRoom.stakeHtg || stakeHtg),
      engineVersion: 3,
    };
  }

  const poolRef = morpionV3MatchmakingPoolRef(stakeHtg);
  return db.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const poolSnap = await tx.get(poolRef);
    const openRoomId = String(poolSnap.exists ? (poolSnap.data() || {}).openRoomId || "" : "").trim();

    if (openRoomId) {
      const openRoomRef = morpionV3RoomRef(openRoomId);
      const openRoomSnap = await tx.get(openRoomRef);
      if (openRoomSnap.exists) {
        const openRoom = openRoomSnap.data() || {};
        const playerUids = Array.isArray(openRoom.playerUids)
          ? openRoom.playerUids.slice(0, 2).map((item) => String(item || "").trim())
          : ["", ""];
        const humans = playerUids.filter(Boolean).length;
        const openStatus = String(openRoom.status || "").trim();
        const openWaitingDeadlineMs = resolveMorpionWaitingDeadlineMs(openRoom, nowMs);
        const seatIndex = humans === 1 && !playerUids.includes(safeUid)
          ? (playerUids[0] ? 1 : 0)
          : -1;

        if (
          openStatus === "waiting"
          && seatIndex >= 0
          && safeInt(openRoom.stakeHtg) === stakeHtg
          && !(humans < 2 && openWaitingDeadlineMs > 0 && nowMs >= openWaitingDeadlineMs)
        ) {
          const nextPlayerUids = playerUids.slice();
          nextPlayerUids[seatIndex] = safeUid;
          const nextPlayerNames = Array.isArray(openRoom.playerNames)
            ? openRoom.playerNames.slice(0, 2)
            : ["", ""];
          nextPlayerNames[seatIndex] = sanitizePlayerLabel(email || safeUid, seatIndex);
          const nextSeats = openRoom.seats && typeof openRoom.seats === "object" ? { ...openRoom.seats } : {};
          nextSeats[safeUid] = seatIndex;
          const nextEntryFundingCurrencyByUid = openRoom.entryFundingCurrencyByUid && typeof openRoom.entryFundingCurrencyByUid === "object"
            ? { ...openRoom.entryFundingCurrencyByUid }
            : {};
          nextEntryFundingCurrencyByUid[safeUid] = "htg";
          const roomForCharge = {
            ...openRoom,
            fundingCurrency: "htg",
            stakeHtg,
            stakeDoes,
            entryCostDoes: stakeDoes,
            rewardAmountDoes,
            rewardAmountHtg,
            playerUids: nextPlayerUids,
            playerNames: nextPlayerNames,
            seats: nextSeats,
            humanCount: 2,
            botCount: 0,
            entryFundingCurrencyByUid: nextEntryFundingCurrencyByUid,
          };
          const chargeResult = await chargeMorpionEntriesTx(tx, roomForCharge, nextPlayerUids, stakeHtg, {
            actorUid: safeUid,
            ownerUid: nextPlayerUids[0],
          });

          tx.set(openRoomRef, {
            fundingCurrency: "htg",
            stakeDoes,
            entryCostDoes: stakeDoes,
            rewardAmountDoes,
            rewardAmountHtg,
            playerUids: nextPlayerUids,
            playerNames: nextPlayerNames,
            seats: nextSeats,
            entryFundingByUid: chargeResult.entryFundingByUid,
            entryFundingCurrencyByUid: nextEntryFundingCurrencyByUid,
            humanCount: 2,
            botCount: 0,
            updatedAtMs: nowMs,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });
          tx.set(poolRef, {
            openRoomId: "",
            updatedAtMs: nowMs,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, { merge: true });

          const started = buildStartedMorpionV3RoomTransaction(tx, openRoomRef, {
            ...roomForCharge,
            entryFundingByUid: chargeResult.entryFundingByUid,
          }, nowMs);

          return {
            ok: true,
            resumed: false,
            roomId: openRoomRef.id,
            seatIndex,
            stakeHtg,
            engineVersion: 3,
            ...started,
          };
        }
      }

      tx.set(poolRef, {
        openRoomId: "",
        updatedAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
    }

    const roomRefDoc = morpionV3RoomRef();
    tx.set(roomRefDoc, {
      roomId: roomRefDoc.id,
      engineVersion: 3,
      roomMode: "morpion_2p",
      variant: "public_v3",
      fundingCurrency: "htg",
      stakeHtg,
      stakeDoes,
      entryCostDoes: stakeDoes,
      rewardAmountDoes,
      rewardAmountHtg,
      playerUids: [safeUid, ""],
      playerNames: [sanitizePlayerLabel(email || safeUid, 0), ""],
      seats: { [safeUid]: 0 },
      entryFundingByUid: {},
      entryFundingCurrencyByUid: { [safeUid]: "htg" },
      humanCount: 1,
      botCount: 0,
      status: "waiting",
      currentPlayer: -1,
      nextActionSeq: 1,
      lastActionSeq: 0,
      playedCount: 0,
      turnActual: 0,
      turnStartedAtMs: 0,
      turnDeadlineMs: 0,
      turnLockedUntilMs: 0,
      roomPresenceMs: { [safeUid]: nowMs },
      waitingDeadlineMs: nowMs + ROOM_WAIT_MS,
      symbolBySeat: ["X", "O"],
      createdAtMs: nowMs,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(poolRef, {
      openRoomId: roomRefDoc.id,
      stakeHtg,
      updatedAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      ok: true,
      resumed: false,
      roomId: roomRefDoc.id,
      seatIndex: 0,
      status: "waiting",
      started: false,
      stakeHtg,
      engineVersion: 3,
    };
  });
}

async function createFriendMorpionRoomV3({ uid = "", email = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }

  const stakeHtg = assertPrivateMorpionV3Stake(payload.stakeHtg || MORPION_PRIVATE_MIN_STAKE_HTG);
  const stakeDoes = htgToDoes(stakeHtg);
  const rewardAmountDoes = buildRewardAmountDoes(stakeHtg);
  const rewardAmountHtg = buildRewardAmountHtg(stakeHtg);

  const activeRoom = await findActiveMorpionV3RoomForUser(safeUid);
  if (activeRoom) {
    const activeMode = String(activeRoom.room?.roomMode || "").trim();
    if (activeMode === "morpion_friends_v3") {
      return {
        ok: true,
        resumed: true,
        roomId: activeRoom.roomId,
        seatIndex: activeRoom.seatIndex,
        status: activeRoom.status,
        roomMode: activeMode,
        inviteCode: String(activeRoom.room?.inviteCode || "").trim(),
        waitingDeadlineMs: safeSignedInt(activeRoom.room?.waitingDeadlineMs, 0),
        stakeHtg: safeInt(activeRoom.room?.stakeHtg || stakeHtg),
        engineVersion: 3,
      };
    }
    throw makeHttpError(409, "morpion-v3-active-room-exists", "Ou deja nan yon lot sal Mopyon aktif.", {
      roomId: activeRoom.roomId,
      status: activeRoom.status,
      roomMode: activeMode || "morpion_2p",
    });
  }

  const inviteCode = await generateUniqueFriendMorpionV3InviteCode();
  return db.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const walletSnap = await tx.get(clientRef(safeUid));
    const walletData = walletSnap.exists ? (walletSnap.data() || {}) : {};
    assertWalletCanCoverMorpionStake(walletData, stakeHtg, {
      code: "morpion-v3-insufficient-funds",
      message: "Ou pa gen ase HTG pou kreye salon prive sa a.",
      culpritUid: safeUid,
      culpritRole: "requester",
    });

    const roomRefDoc = morpionV3RoomRef();
    const waitingDeadlineMs = nowMs + FRIEND_ROOM_WAIT_MS;
    tx.set(roomRefDoc, {
      roomId: roomRefDoc.id,
      engineVersion: 3,
      roomMode: "morpion_friends_v3",
      variant: "friend_v3",
      isPrivate: true,
      allowBots: false,
      inviteCode,
      inviteCodeNormalized: normalizeCode(inviteCode),
      fundingCurrency: "htg",
      stakeHtg,
      stakeDoes,
      entryCostDoes: stakeDoes,
      rewardAmountDoes,
      rewardAmountHtg,
      playerUids: [safeUid, ""],
      playerNames: [sanitizePlayerLabel(email || safeUid, 0), ""],
      seats: { [safeUid]: 0 },
      entryFundingByUid: {},
      entryFundingCurrencyByUid: { [safeUid]: "htg" },
      humanCount: 1,
      botCount: 0,
      status: "waiting",
      currentPlayer: -1,
      nextActionSeq: 1,
      lastActionSeq: 0,
      playedCount: 0,
      turnActual: 0,
      turnStartedAtMs: 0,
      turnDeadlineMs: 0,
      turnLockedUntilMs: 0,
      roomPresenceMs: { [safeUid]: nowMs },
      waitingDeadlineMs,
      symbolBySeat: ["X", "O"],
      createdAtMs: nowMs,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      ok: true,
      resumed: false,
      roomId: roomRefDoc.id,
      seatIndex: 0,
      status: "waiting",
      roomMode: "morpion_friends_v3",
      inviteCode,
      waitingDeadlineMs,
      stakeHtg,
      engineVersion: 3,
    };
  });
}

async function resumeFriendMorpionRoomV3({ uid = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }

  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }

  const roomSnap = await morpionV3RoomRef(roomId).get();
  if (!roomSnap.exists) {
    throw makeHttpError(404, "morpion-v3-room-not-found", "Salon prive Mopyon an pa egziste.");
  }

  const room = roomSnap.data() || {};
  if (!isFriendMorpionV3Room(room)) {
    throw makeHttpError(409, "morpion-v3-not-friend-room", "Sal sa a pa yon salon prive Mopyon valab.");
  }

  const seatIndex = getSeatForUser(room, safeUid);
  if (seatIndex < 0) {
    throw makeHttpError(403, "morpion-v3-room-access-denied", "Ou pa nan salon prive sa a.");
  }

  const status = String(room.status || "").trim().toLowerCase();
  const nowMs = Date.now();
  const humans = Array.isArray(room.playerUids)
    ? room.playerUids.map((item) => String(item || "").trim()).filter(Boolean).length
    : safeInt(room.humanCount);
  const waitingDeadlineMs = resolveMorpionWaitingDeadlineMs(room, nowMs);

  if (status === "closed") {
    throw makeHttpError(409, "morpion-v3-room-closed", "Salon prive sa a pa disponib anko.");
  }
  if (status === "waiting" && humans < 2 && waitingDeadlineMs > 0 && nowMs >= waitingDeadlineMs) {
    throw makeHttpError(409, "morpion-v3-room-expired", "Salon prive sa a ekspire.");
  }

  return {
    ok: true,
    roomId,
    seatIndex,
    status,
    roomMode: "morpion_friends_v3",
    inviteCode: String(room.inviteCode || "").trim(),
    waitingDeadlineMs,
    stakeHtg: safeInt(room.stakeHtg || 25),
    engineVersion: 3,
  };
}

async function joinFriendMorpionRoomByCodeV3({ uid = "", email = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }

  const inviteCodeNormalized = normalizeCode(payload.inviteCode || payload.code || "");
  if (!inviteCodeNormalized) {
    throw makeHttpError(400, "missing-invite-code", "Kod salon an obligatwa.");
  }

  const matchingSnap = await db
    .collection(MORPION_V3_ROOMS_COLLECTION)
    .where("inviteCodeNormalized", "==", inviteCodeNormalized)
    .limit(8)
    .get();
  const roomDoc = matchingSnap.docs.find((docSnap) => isFriendMorpionV3Room(docSnap.data() || {})) || null;
  if (!roomDoc) {
    throw makeHttpError(404, "morpion-v3-invite-not-found", "Kod salon prive Mopyon sa a pa egziste.");
  }

  const targetRoomId = String(roomDoc.id || "").trim();
  const activeRoom = await findActiveMorpionV3RoomForUser(safeUid);
  if (activeRoom && String(activeRoom.roomId || "").trim() !== targetRoomId) {
    throw makeHttpError(409, "morpion-v3-active-room-exists", "Ou deja nan yon lot sal Mopyon aktif.", {
      roomId: activeRoom.roomId,
      status: activeRoom.status,
      roomMode: String(activeRoom.room?.roomMode || "").trim() || "morpion_2p",
    });
  }

  return db.runTransaction(async (tx) => {
    const [roomSnap, walletSnap] = await Promise.all([
      tx.get(roomDoc.ref),
      tx.get(clientRef(safeUid)),
    ]);

    if (!roomSnap.exists) {
      throw makeHttpError(404, "morpion-v3-room-not-found", "Salon prive Mopyon an pa egziste.");
    }

    const room = roomSnap.data() || {};
    if (!isFriendMorpionV3Room(room)) {
      throw makeHttpError(409, "morpion-v3-not-friend-room", "Sal sa a pa yon salon prive Mopyon valab.");
    }

    const walletData = walletSnap.exists ? (walletSnap.data() || {}) : {};
    assertWalletNotFrozen(walletData);

    const roomStatus = String(room.status || "").trim().toLowerCase();
    const nowMs = Date.now();
    const roomStakeHtg = safeInt(room.stakeHtg || 25);
    const requestedStakeHtg = safeInt(payload.stakeHtg);
    const roomStakeDoes = safeInt(room.entryCostDoes || room.stakeDoes || htgToDoes(roomStakeHtg));
    const roomRewardAmountDoes = safeInt(room.rewardAmountDoes || buildRewardAmountDoes(roomStakeHtg));
    const roomRewardAmountHtg = safeInt(room.rewardAmountHtg || buildRewardAmountHtg(roomStakeHtg));
    const roomInviteCode = String(room.inviteCode || inviteCodeNormalized).trim();
    const playerUids = Array.isArray(room.playerUids)
      ? room.playerUids.slice(0, 2).map((item) => String(item || "").trim())
      : ["", ""];
    const humans = playerUids.filter(Boolean).length;
    const waitingDeadlineMs = resolveMorpionWaitingDeadlineMs(room, nowMs);

    if (playerUids.includes(safeUid)) {
      const seatIndex = getSeatForUser(room, safeUid);
      const nextPresence = room.roomPresenceMs && typeof room.roomPresenceMs === "object"
        ? { ...room.roomPresenceMs }
        : {};
      nextPresence[safeUid] = nowMs;
      tx.update(roomDoc.ref, {
        roomPresenceMs: nextPresence,
        updatedAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return {
        ok: true,
        resumed: true,
        charged: false,
        roomId: roomDoc.ref.id,
        seatIndex: seatIndex >= 0 ? seatIndex : 0,
        status: roomStatus,
        roomMode: "morpion_friends_v3",
        inviteCode: roomInviteCode,
        waitingDeadlineMs,
        stakeHtg: roomStakeHtg,
        engineVersion: 3,
      };
    }

    if (roomStatus === "playing") {
      throw makeHttpError(409, "morpion-v3-room-already-started", "Salon prive sa a deja komanse.");
    }
    if (roomStatus !== "waiting") {
      throw makeHttpError(409, "morpion-v3-room-not-available", "Salon prive sa a pa disponib anko.");
    }
    if (requestedStakeHtg > 0 && requestedStakeHtg !== roomStakeHtg) {
      console.warn("[MORPION_V3][friend-join][stake-mismatch-tolerated]", {
        roomId: roomDoc.ref.id,
        inviteCode: roomInviteCode,
        roomStakeHtg,
        requestedStakeHtg,
        uid: safeUid,
      });
    }
    if (waitingDeadlineMs > 0 && humans < 2 && nowMs >= waitingDeadlineMs) {
      tx.set(roomDoc.ref, {
        status: "closed",
        endedReason: "expired",
        endedAtMs: nowMs,
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      throw makeHttpError(409, "morpion-v3-room-expired", "Kod salon prive sa a ekspire.");
    }

    assertWalletCanCoverMorpionStake(walletData, roomStakeHtg, {
      code: "morpion-v3-insufficient-funds",
      message: "Ou pa gen ase HTG pou antre nan salon prive sa a.",
      culpritUid: safeUid,
      culpritRole: "requester",
    });

    const currentSeats = room.seats && typeof room.seats === "object" ? { ...room.seats } : {};
    const usedSeats = new Set(
      Object.values(currentSeats)
        .map((seat) => Number(seat))
        .filter((seat) => Number.isFinite(seat) && seat >= 0 && seat < 2)
    );
    const seatIndex = [0, 1].find((seat) => !usedSeats.has(seat));
    if (typeof seatIndex !== "number" || humans >= 2) {
      throw makeHttpError(409, "morpion-v3-room-full", "Salon prive sa a gentan plen.");
    }

    const nextPlayerUids = playerUids.slice();
    nextPlayerUids[seatIndex] = safeUid;
    const nextPlayerNames = Array.isArray(room.playerNames) ? room.playerNames.slice(0, 2) : ["", ""];
    nextPlayerNames[seatIndex] = sanitizePlayerLabel(email || safeUid, seatIndex);
    const nextSeats = { ...currentSeats, [safeUid]: seatIndex };
    const nextPresence = room.roomPresenceMs && typeof room.roomPresenceMs === "object"
      ? { ...room.roomPresenceMs }
      : {};
    nextPresence[safeUid] = nowMs;
    const nextEntryFundingCurrencyByUid = room.entryFundingCurrencyByUid && typeof room.entryFundingCurrencyByUid === "object"
      ? { ...room.entryFundingCurrencyByUid }
      : {};
    nextEntryFundingCurrencyByUid[safeUid] = "htg";

    const roomForCharge = {
      ...room,
      fundingCurrency: "htg",
      stakeHtg: roomStakeHtg,
      stakeDoes: roomStakeDoes,
      entryCostDoes: roomStakeDoes,
      rewardAmountDoes: roomRewardAmountDoes,
      rewardAmountHtg: roomRewardAmountHtg,
      playerUids: nextPlayerUids,
      playerNames: nextPlayerNames,
      seats: nextSeats,
      humanCount: 2,
      botCount: 0,
      entryFundingCurrencyByUid: nextEntryFundingCurrencyByUid,
      roomPresenceMs: nextPresence,
    };
    const chargeResult = await chargeMorpionEntriesTx(tx, roomForCharge, nextPlayerUids, roomStakeHtg, {
      actorUid: safeUid,
      ownerUid: playerUids[0],
    });

    tx.set(roomDoc.ref, {
      fundingCurrency: "htg",
      stakeDoes: roomStakeDoes,
      entryCostDoes: roomStakeDoes,
      rewardAmountDoes: roomRewardAmountDoes,
      rewardAmountHtg: roomRewardAmountHtg,
      playerUids: nextPlayerUids,
      playerNames: nextPlayerNames,
      seats: nextSeats,
      entryFundingByUid: chargeResult.entryFundingByUid,
      entryFundingCurrencyByUid: nextEntryFundingCurrencyByUid,
      roomPresenceMs: nextPresence,
      humanCount: 2,
      botCount: 0,
      updatedAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    const started = buildStartedMorpionV3RoomTransaction(tx, roomDoc.ref, {
      ...roomForCharge,
      entryFundingByUid: chargeResult.entryFundingByUid,
    }, nowMs);

    return {
      ok: true,
      resumed: false,
      charged: true,
      roomId: roomDoc.ref.id,
      seatIndex,
      roomMode: "morpion_friends_v3",
      inviteCode: roomInviteCode,
      stakeHtg: roomStakeHtg,
      engineVersion: 3,
      ...started,
    };
  });
}

async function getMorpionV3RoomState({ uid = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }

  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }

  const [roomSnap, stateSnap] = await Promise.all([
    morpionV3RoomRef(roomId).get(),
    morpionV3GameStateRef(roomId).get(),
  ]);
  if (!roomSnap.exists) {
    throw makeHttpError(404, "morpion-v3-room-not-found", "Salle Mopyon introuvable.");
  }

  const room = roomSnap.data() || {};
  const seatIndex = getSeatForUser(room, safeUid);
  if (seatIndex < 0) {
    throw makeHttpError(403, "morpion-v3-room-access-denied", "Ou pa nan sal Mopyon sa a.");
  }

  const state = stateSnap.exists
    ? normalizeMorpionGameState(stateSnap.data(), room)
    : createInitialMorpionGameState();

  return buildRoomStateResponse(roomId, room, state, seatIndex);
}

async function touchRoomPresenceMorpionV3({ uid = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }

  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }

  const roomRefDoc = morpionV3RoomRef(roomId);
  const stateRef = morpionV3GameStateRef(roomId);
  return db.runTransaction(async (tx) => {
    const [roomSnap, stateSnap] = await Promise.all([tx.get(roomRefDoc), tx.get(stateRef)]);
    if (!roomSnap.exists) {
      return { ok: true, missing: true, status: "missing", engineVersion: 3 };
    }

    const room = roomSnap.data() || {};
    const seatIndex = getSeatForUser(room, safeUid);
    if (seatIndex < 0) {
      throw makeHttpError(403, "morpion-v3-room-access-denied", "Ou pa nan sal Mopyon sa a.");
    }

    const nowMs = Date.now();
    const roomPresenceMs = room.roomPresenceMs && typeof room.roomPresenceMs === "object"
      ? { ...room.roomPresenceMs }
      : {};
    roomPresenceMs[safeUid] = nowMs;

    if (String(room.status || "").trim() === "ended") {
      const currentState = stateSnap.exists
        ? normalizeMorpionGameState(stateSnap.data(), room)
        : createInitialMorpionGameState();
      tx.set(roomRefDoc, {
        roomPresenceMs,
        updatedAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return {
        ok: true,
        status: "ended",
        endedReason: String(currentState.endedReason || room.endedReason || "").trim(),
        winnerSeat: safeSignedInt(currentState.winnerSeat, safeSignedInt(room.winnerSeat, -1)),
        engineVersion: 3,
      };
    }

    if (String(room.status || "").trim() !== "playing") {
      tx.set(roomRefDoc, {
        roomPresenceMs,
        updatedAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return {
        ok: true,
        status: String(room.status || "").trim() || "waiting",
        endedReason: "",
        winnerSeat: -1,
        engineVersion: 3,
      };
    }

    const currentState = stateSnap.exists
      ? normalizeMorpionGameState(stateSnap.data(), room)
      : createInitialMorpionGameState();
    if (currentState.endedReason) {
      tx.set(roomRefDoc, {
        roomPresenceMs,
        updatedAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return {
        ok: true,
        status: "ended",
        endedReason: currentState.endedReason,
        winnerSeat: safeSignedInt(currentState.winnerSeat, -1),
        engineVersion: 3,
      };
    }

    const deadlineMs = safeSignedInt(room.turnDeadlineMs, 0);
    if (deadlineMs > 0 && deadlineMs <= nowMs) {
      const nextState = buildMorpionV3TimeoutState(currentState, room);
      const settlement = await settleMorpionV3RoomTx(tx, roomRefDoc, room, nextState);
      const roomUpdate = buildMorpionRoomUpdateFromGameState({ ...room, roomPresenceMs }, nextState, [], nowMs);
      roomUpdate.roomPresenceMs = roomPresenceMs;
      tx.set(stateRef, buildMorpionGameStateWrite(nextState), { merge: true });
      tx.set(roomRefDoc, { ...roomUpdate, engineVersion: 3 }, { merge: true });
      await writeMorpionRoomResultIfEndedTx(tx, roomRefDoc, room, roomUpdate);
      return {
        ok: true,
        status: "ended",
        endedReason: String(nextState.endedReason || "").trim(),
        winnerSeat: safeSignedInt(nextState.winnerSeat, -1),
        settlement,
        engineVersion: 3,
      };
    }

    const opponentSeat = seatIndex === 0 ? 1 : 0;
    const opponentUid = String((room.playerUids || [])[opponentSeat] || "").trim();
    const opponentLastSeenMs = opponentUid ? safeSignedInt(roomPresenceMs[opponentUid], 0) : 0;
    const shouldForfeitOpponent = String(room.status || "").trim() === "playing"
      && Boolean(opponentUid)
      && opponentLastSeenMs > 0
      && (nowMs - opponentLastSeenMs) >= MORPION_V3_PRESENCE_GRACE_MS;

    if (shouldForfeitOpponent) {
      const nextState = buildMorpionV3QuitState(currentState, room, opponentSeat);
      const settlement = await settleMorpionV3RoomTx(tx, roomRefDoc, room, nextState);
      const roomUpdate = buildMorpionRoomUpdateFromGameState({ ...room, roomPresenceMs }, nextState, [], nowMs);
      roomUpdate.roomPresenceMs = roomPresenceMs;
      tx.set(stateRef, buildMorpionGameStateWrite(nextState), { merge: true });
      tx.set(roomRefDoc, { ...roomUpdate, engineVersion: 3 }, { merge: true });
      await writeMorpionRoomResultIfEndedTx(tx, roomRefDoc, room, roomUpdate);
      return {
        ok: true,
        status: "ended",
        endedReason: String(nextState.endedReason || "").trim(),
        winnerSeat: safeSignedInt(nextState.winnerSeat, -1),
        settlement,
        engineVersion: 3,
      };
    }

    tx.set(roomRefDoc, {
      roomPresenceMs,
      updatedAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      ok: true,
      status: String(room.status || "").trim() || "waiting",
      endedReason: "",
      winnerSeat: -1,
      engineVersion: 3,
    };
  });
}

async function requestFriendMorpionRematchV3({ uid = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }

  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }

  const roomRefDoc = morpionV3RoomRef(roomId);
  return db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      throw makeHttpError(404, "morpion-v3-room-not-found", "Salle Mopyon introuvable.");
    }

    const room = roomSnap.data() || {};
    if (!isFriendMorpionV3Room(room)) {
      throw makeHttpError(409, "morpion-v3-not-friend-room", "Rejouer sa a mache selman nan salon prive Mopyon an.");
    }

    const seatIndex = getSeatForUser(room, safeUid);
    if (seatIndex < 0) {
      throw makeHttpError(403, "morpion-v3-room-access-denied", "Ou pa nan sal Mopyon sa a.");
    }

    const status = String(room.status || "").trim().toLowerCase();
    if (status !== "ended") {
      throw makeHttpError(409, "morpion-v3-room-not-ended", "Rejouer prive a disponib selman apre match la fini.");
    }

    const playerUids = Array.isArray(room.playerUids)
      ? room.playerUids.slice(0, 2).map((item) => String(item || "").trim())
      : ["", ""];
    const activePlayers = playerUids.filter(Boolean);
    if (activePlayers.length !== 2) {
      throw makeHttpError(409, "morpion-v3-rematch-missing-players", "Lot jwe a pa disponib ankò pou rematch la.");
    }

    const rematchRequestUids = Array.isArray(room.rematchRequestUids)
      ? room.rematchRequestUids.map((item) => String(item || "").trim()).filter(Boolean)
      : [];
    const nextRematchRequestUids = Array.from(new Set([...rematchRequestUids, safeUid]));
    const nowMs = Date.now();
    const roomPresenceMs = room.roomPresenceMs && typeof room.roomPresenceMs === "object"
      ? { ...room.roomPresenceMs }
      : {};
    roomPresenceMs[safeUid] = nowMs;

    if (nextRematchRequestUids.length < 2) {
      const nextRematchRequestedAtMs = room.rematchRequestedAtMs && typeof room.rematchRequestedAtMs === "object"
        ? { ...room.rematchRequestedAtMs }
        : {};
      nextRematchRequestedAtMs[safeUid] = nowMs;
      tx.set(roomRefDoc, {
        rematchRequestUids: nextRematchRequestUids,
        rematchRequestedAtMs: nextRematchRequestedAtMs,
        roomPresenceMs,
        updatedAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return {
        ok: true,
        roomId,
        status: "ended",
        roomMode: "morpion_friends_v3",
        started: false,
        waitingForOpponent: true,
        requestedCount: nextRematchRequestUids.length,
        rematchRequestUids: nextRematchRequestUids,
        engineVersion: 3,
      };
    }

    const roomStakeHtg = safeInt(room.stakeHtg || 25);
    const chargeResult = await chargeMorpionEntriesTx(tx, room, activePlayers, roomStakeHtg, {
      actorUid: safeUid,
      ownerUid: activePlayers[0],
    });
    const started = buildStartedMorpionV3RoomTransaction(tx, roomRefDoc, {
      ...room,
      playerUids,
      playerNames: Array.isArray(room.playerNames) ? room.playerNames.slice(0, 2) : ["", ""],
      seats: getRoomSeats(room),
      entryFundingByUid: chargeResult.entryFundingByUid,
      entryFundingCurrencyByUid: room.entryFundingCurrencyByUid && typeof room.entryFundingCurrencyByUid === "object"
        ? { ...room.entryFundingCurrencyByUid }
        : {},
      roomPresenceMs,
      humanCount: 2,
      botCount: 0,
    }, nowMs);

    return {
      ok: true,
      roomId,
      roomMode: "morpion_friends_v3",
      inviteCode: String(room.inviteCode || "").trim(),
      stakeHtg: roomStakeHtg,
      started: true,
      waitingForOpponent: false,
      requestedCount: 2,
      rematchRequestUids: [],
      engineVersion: 3,
      ...started,
    };
  });
}

async function leaveRoomMorpionV3({ uid = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }

  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }

  const roomRefDoc = morpionV3RoomRef(roomId);
  const stateRef = morpionV3GameStateRef(roomId);
  return db.runTransaction(async (tx) => {
    const [roomSnap, stateSnap] = await Promise.all([tx.get(roomRefDoc), tx.get(stateRef)]);
    if (!roomSnap.exists) {
      return { ok: true, deleted: true, status: "missing", engineVersion: 3 };
    }

    const room = roomSnap.data() || {};
    const seatIndex = getSeatForUser(room, safeUid);
    if (seatIndex < 0) {
      throw makeHttpError(403, "morpion-v3-room-access-denied", "Ou pa nan sal Mopyon sa a.");
    }

    const status = String(room.status || "").trim().toLowerCase();
    const nowMs = Date.now();

    if (status === "waiting") {
      tx.delete(roomRefDoc);
      tx.delete(stateRef);
      if (!isFriendMorpionV3Room(room)) {
        const poolRef = morpionV3MatchmakingPoolRef(safeInt(room.stakeHtg, 25));
        tx.set(poolRef, {
          openRoomId: "",
          updatedAtMs: nowMs,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
      return { ok: true, deleted: true, status: "cancelled", engineVersion: 3 };
    }

    const currentState = stateSnap.exists
      ? normalizeMorpionGameState(stateSnap.data(), room)
      : createInitialMorpionGameState();
    if (currentState.endedReason) {
      return {
        ok: true,
        deleted: false,
        status: "ended",
        endedReason: currentState.endedReason,
        engineVersion: 3,
      };
    }

    const nextState = buildMorpionV3QuitState(currentState, room, seatIndex);
    const settlement = await settleMorpionV3RoomTx(tx, roomRefDoc, room, nextState);
    const roomUpdate = buildMorpionRoomUpdateFromGameState(room, nextState, [], nowMs);
    tx.set(stateRef, buildMorpionGameStateWrite(nextState), { merge: true });
    tx.set(roomRefDoc, { ...roomUpdate, engineVersion: 3 }, { merge: true });
    await writeMorpionRoomResultIfEndedTx(tx, roomRefDoc, room, roomUpdate);

    return {
      ok: true,
      deleted: false,
      status: "ended",
      endedReason: nextState.endedReason,
      winnerSeat: nextState.winnerSeat,
      settlement,
      engineVersion: 3,
    };
  });
}

async function submitActionMorpionV3({ uid = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }

  const roomId = String(payload.roomId || "").trim();
  const clientActionId = String(payload.clientActionId || "").trim() || `morpion_v3_${Date.now().toString(36)}`;
  const cellIndex = safeSignedInt(payload?.action?.cellIndex, -1);
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }

  return db.runTransaction(async (tx) => {
    const roomRefDoc = morpionV3RoomRef(roomId);
    const stateRef = morpionV3GameStateRef(roomId);
    const [roomSnap, stateSnap] = await Promise.all([tx.get(roomRefDoc), tx.get(stateRef)]);
    if (!roomSnap.exists) {
      throw makeHttpError(404, "morpion-v3-room-not-found", "Salle Mopyon introuvable.");
    }

    const room = roomSnap.data() || {};
    if (String(room.status || "").trim() !== "playing") {
      throw makeHttpError(409, "morpion-v3-room-not-playing", "Match Mopyon an poko komanse.");
    }

    const seatIndex = getSeatForUser(room, safeUid);
    if (seatIndex < 0) {
      throw makeHttpError(403, "morpion-v3-room-access-denied", "Ou pa nan sal Mopyon sa a.");
    }

    const currentState = stateSnap.exists
      ? normalizeMorpionGameState(stateSnap.data(), room)
      : createInitialMorpionGameState();
    if (currentState.endedReason) {
      throw makeHttpError(409, "morpion-v3-room-ended", "Match Mopyon an deja fini.");
    }
    if (currentState.idempotencyKeys[clientActionId] === true) {
      return {
        ok: true,
        duplicate: true,
        seq: safeSignedInt(currentState.appliedActionSeq, 0),
        nextPlayer: currentState.currentPlayer,
        status: room.status,
        engineVersion: 3,
      };
    }

    const applied = applyMorpionMove(currentState, room, { seat: seatIndex, cellIndex }, safeUid);
    applied.state.idempotencyKeys[clientActionId] = true;
    const settlement = applied.state.endedReason
      ? await settleMorpionV3RoomTx(tx, roomRefDoc, room, applied.state)
      : null;

    tx.set(stateRef, buildMorpionGameStateWrite(applied.state), { merge: true });
    const roomUpdate = buildMorpionRoomUpdateFromGameState(room, applied.state, [applied.record], Date.now());
    tx.set(roomRefDoc, { ...roomUpdate, engineVersion: 3 }, { merge: true });
    if (applied.state.endedReason) {
      await writeMorpionRoomResultIfEndedTx(tx, roomRefDoc, room, roomUpdate);
    }

    return {
      ok: true,
      duplicate: false,
      seq: applied.record.seq,
      nextPlayer: applied.state.currentPlayer,
      status: applied.state.endedReason ? "ended" : "playing",
      winnerSeat: applied.state.winnerSeat,
      winnerUid: applied.state.winnerUid,
      endedReason: applied.state.endedReason,
      record: applied.record,
      settlement,
      engineVersion: 3,
    };
  });
}

module.exports = {
  createFriendMorpionRoomV3,
  getMorpionV3RoomState,
  joinFriendMorpionRoomByCodeV3,
  joinMatchmakingMorpionV3,
  leaveRoomMorpionV3,
  requestFriendMorpionRematchV3,
  resumeFriendMorpionRoomV3,
  submitActionMorpionV3,
  touchRoomPresenceMorpionV3,
};
