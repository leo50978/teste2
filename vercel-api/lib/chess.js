const crypto = require("crypto");

const { admin, db } = require("./firebase-admin");
const { makeHttpError } = require("./http");
const { assertWalletNotFrozen, walletRef } = require("./player-wallet");
const { safeInt, safeSignedInt, sanitizeText } = require("./safe");
const { applyHtgRewardCredit, applyHtgStakeDebit } = require("./wallet-htg");

const CHESS_ROOMS_COLLECTION = "chessRooms";
const CHESS_ROOM_RESULTS_COLLECTION = "chessRoomResults";

const CHESS_PUBLIC_STAKE_HTG = 25;
const CHESS_PRIVATE_MIN_STAKE_HTG = 25;
const CHESS_REWARD_MULTIPLIER = 1.8;
const FRIEND_ROOM_WAIT_MS = 10 * 60 * 1000;
const PUBLIC_ROOM_WAIT_MS = 15 * 1000;
const FRIEND_ROOM_CODE_SIZE = 6;
const CHESS_PRESENCE_GRACE_MS = 30 * 1000;
const CHESS_TURN_LIMIT_MS = 30 * 1000;
const CHESS_HISTORY_LIMIT = 500;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function chessRoomRef(roomId = "") {
  const safeRoomId = String(roomId || "").trim();
  return safeRoomId
    ? db.collection(CHESS_ROOMS_COLLECTION).doc(safeRoomId)
    : db.collection(CHESS_ROOMS_COLLECTION).doc();
}

function chessRoomResultRef(resultId = "") {
  const safeResultId = String(resultId || "").trim();
  return safeResultId
    ? db.collection(CHESS_ROOM_RESULTS_COLLECTION).doc(safeResultId)
    : db.collection(CHESS_ROOM_RESULTS_COLLECTION).doc();
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
  const targetSize = Math.max(4, safeInt(size) || FRIEND_ROOM_CODE_SIZE);
  let out = "";
  for (let index = 0; index < targetSize; index += 1) {
    out += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return out;
}

function buildRewardAmountHtg(stakeHtg = 0) {
  return Math.max(0, Math.floor(safeInt(stakeHtg) * CHESS_REWARD_MULTIPLIER));
}

function assertPublicChessStake(value) {
  const stakeHtg = safeInt(value || CHESS_PUBLIC_STAKE_HTG);
  if (stakeHtg !== CHESS_PUBLIC_STAKE_HTG) {
    throw makeHttpError(400, "chess-public-stake-not-allowed", "Miz Echec piblik la fikse a 25 HTG.");
  }
  return stakeHtg;
}

function assertPrivateChessStake(value) {
  const stakeHtg = safeInt(value || CHESS_PRIVATE_MIN_STAKE_HTG);
  if (stakeHtg < CHESS_PRIVATE_MIN_STAKE_HTG) {
    throw makeHttpError(
      400,
      "chess-private-stake-too-low",
      `Miz salon prive Echec la dwe omwen ${CHESS_PRIVATE_MIN_STAKE_HTG} HTG.`
    );
  }
  return stakeHtg;
}

function getRoomSeats(room = {}) {
  return room?.seats && typeof room.seats === "object" ? room.seats : {};
}

function getSeatForUser(room = {}, uid = "") {
  const seats = getRoomSeats(room);
  const safeUid = String(uid || "").trim();
  return typeof seats[safeUid] === "number" ? seats[safeUid] : -1;
}

function isFriendChessRoom(room = {}) {
  return String(room.roomMode || "").trim() === "chess_friends";
}

function isPublicChessBotRoom(room = {}) {
  return String(room.roomMode || "").trim() === "chess_public_bot";
}

function getRoomStakeHtg(room = {}) {
  return Math.max(0, safeInt(room.stakeHtg));
}

function getRoomRewardHtg(room = {}) {
  const explicit = safeInt(room.rewardAmountHtg);
  if (explicit > 0) return explicit;
  return buildRewardAmountHtg(getRoomStakeHtg(room));
}

function getMoveCountBySeat(room = {}) {
  const raw = Array.isArray(room.moveCountBySeat) ? room.moveCountBySeat : [];
  return [0, 1].map((seat) => Math.max(0, safeInt(raw[seat])));
}

function shouldRefundBeforeOpening(room = {}) {
  const moves = getMoveCountBySeat(room);
  return moves[0] <= 0 || moves[1] <= 0;
}

function getWaitingDeadlineMs(room = {}, nowMs = Date.now()) {
  const explicit = safeSignedInt(room.waitingDeadlineMs, 0);
  if (explicit > 0) return explicit;
  const createdAtMs = safeSignedInt(room.createdAtMs, 0);
  if (createdAtMs > 0) {
    return createdAtMs + (isFriendChessRoom(room) ? FRIEND_ROOM_WAIT_MS : PUBLIC_ROOM_WAIT_MS);
  }
  return nowMs + (isFriendChessRoom(room) ? FRIEND_ROOM_WAIT_MS : PUBLIC_ROOM_WAIT_MS);
}

function normalizeMoveRecord(action = {}, seq = 0, seatIndex = 0, actorUid = "") {
  return {
    seq: safeInt(seq),
    seatIndex: safeInt(seatIndex),
    actorUid: String(actorUid || "").trim(),
    color: safeInt(seatIndex) === 0 ? "white" : "black",
    san: sanitizeText(action.san || "", 48),
    uci: sanitizeText(action.uci || "", 24),
    from: sanitizeText(action.from || "", 8),
    to: sanitizeText(action.to || "", 8),
    fenAfter: sanitizeText(action.fenAfter || action.fen || "", 200),
    pgn: sanitizeText(action.pgn || "", 2000),
    promotion: sanitizeText(action.promotion || "", 8),
    isCapture: action.isCapture === true,
    isCheck: action.isCheck === true,
    isMate: action.isMate === true,
    createdAtMs: Date.now(),
  };
}

function buildRoomStateResponse(roomId = "", room = {}, seatIndex = -1) {
  return {
    ok: true,
    roomId: String(roomId || "").trim(),
    roomMode: String(room.roomMode || "").trim(),
    status: String(room.status || "").trim() || "waiting",
    inviteCode: String(room.inviteCode || "").trim(),
    seatIndex,
    currentTurnSeat: safeSignedInt(room.currentTurnSeat, 0),
    stakeHtg: getRoomStakeHtg(room),
    rewardAmountHtg: getRoomRewardHtg(room),
    startedAtMs: safeSignedInt(room.startedAtMs, 0),
    endedAtMs: safeSignedInt(room.endedAtMs, 0),
    waitingDeadlineMs: getWaitingDeadlineMs(room),
    turnDeadlineMs: safeSignedInt(room.turnDeadlineMs, 0),
    endedReason: String(room.endedReason || "").trim(),
    winnerSeat: safeSignedInt(room.winnerSeat, -1),
    winnerUid: String(room.winnerUid || "").trim(),
    playerUids: Array.isArray(room.playerUids) ? room.playerUids.slice(0, 2) : ["", ""],
    playerNames: Array.isArray(room.playerNames) ? room.playerNames.slice(0, 2) : ["", ""],
    botCount: safeInt(room.botCount),
    humanCount: safeInt(room.humanCount),
    moveCountBySeat: getMoveCountBySeat(room),
    playedCount: safeInt(room.playedCount),
    openingReady: !shouldRefundBeforeOpening(room),
    engineVersion: 1,
    opponentDisplayName: String(room.opponentDisplayName || "").trim(),
    publicOpponentPoolName: String(room.publicOpponentPoolName || "").trim(),
    currentFen: sanitizeText(room.currentFen || "", 200),
    pgn: sanitizeText(room.pgn || "", 5000),
    moveHistory: Array.isArray(room.moveHistory) ? room.moveHistory.slice(-CHESS_HISTORY_LIMIT) : [],
  };
}

async function findActiveChessRoomForUser(uid = "") {
  const safeUid = String(uid || "").trim();
  if (!safeUid) return null;

  const membershipSnap = await db.collection(CHESS_ROOMS_COLLECTION)
    .where("playerUids", "array-contains", safeUid)
    .limit(8)
    .get();

  if (membershipSnap.empty) return null;

  const candidate = membershipSnap.docs
    .filter((docSnap) => {
      const data = docSnap.data() || {};
      const status = String(data.status || "").trim().toLowerCase();
      return status === "playing" || status === "waiting";
    })
    .sort((left, right) => {
      const leftData = left.data() || {};
      const rightData = right.data() || {};
      const leftScore = String(leftData.status || "") === "playing" ? 2 : 1;
      const rightScore = String(rightData.status || "") === "playing" ? 2 : 1;
      if (rightScore !== leftScore) return rightScore - leftScore;
      return safeSignedInt(rightData.updatedAtMs, 0) - safeSignedInt(leftData.updatedAtMs, 0);
    })[0] || null;

  if (!candidate) return null;
  const room = candidate.data() || {};
  return {
    roomId: candidate.id,
    room,
    seatIndex: getSeatForUser(room, safeUid),
  };
}

async function generateUniqueFriendChessInviteCode(size = FRIEND_ROOM_CODE_SIZE, maxAttempts = 18) {
  const targetSize = Math.max(4, safeInt(size) || FRIEND_ROOM_CODE_SIZE);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = normalizeCode(randomCode(targetSize));
    if (!candidate) continue;
    const existing = await db.collection(CHESS_ROOMS_COLLECTION)
      .where("inviteCodeNormalized", "==", candidate)
      .limit(1)
      .get();
    if (existing.empty) return candidate;
  }
  throw makeHttpError(409, "chess-invite-code-generation-failed", "Impossible de generer un code Echec unique.");
}

async function debitStakeTx(tx, uid = "", stakeHtg = 0) {
  const walletSnap = await tx.get(walletRef(uid));
  const walletData = walletSnap.exists ? (walletSnap.data() || {}) : {};
  assertWalletNotFrozen(walletData);
  const walletMutation = applyHtgStakeDebit(walletData, { stakeHtg });
  const nowMs = Date.now();
  tx.set(walletRef(uid), {
    ...walletMutation.balancesPatch,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSeenAtMs: nowMs,
  }, { merge: true });
  return {
    fundingCurrency: "htg",
    approvedHtg: safeInt(walletMutation.gameEntryFunding?.approvedHtg),
    provisionalHtg: safeInt(walletMutation.gameEntryFunding?.provisionalHtg),
    approvedDoes: safeInt(walletMutation.gameEntryFunding?.approvedDoes),
    provisionalDoes: safeInt(walletMutation.gameEntryFunding?.provisionalDoes),
    convertedHtg: safeInt(stakeHtg),
    beforeEntryPlayableHtg: safeInt(walletMutation.afterPlayableHtg) + safeInt(stakeHtg),
    afterEntryPlayableHtg: safeInt(walletMutation.afterPlayableHtg),
  };
}

async function refundStakeTx(tx, uid = "", stakeHtg = 0, entryFunding = null, roomRefDoc = null) {
  const walletSnap = await tx.get(walletRef(uid));
  const walletData = walletSnap.exists ? (walletSnap.data() || {}) : {};
  const walletMutation = applyHtgRewardCredit(walletData, {
    rewardHtg: stakeHtg,
    rewardEntryFunding: entryFunding,
  });
  const nowMs = Date.now();
  tx.set(walletRef(uid), {
    ...walletMutation.balancesPatch,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSeenAtMs: nowMs,
  }, { merge: true });
  if (roomRefDoc) {
    tx.set(roomRefDoc.collection("settlements").doc(`refund_${uid}`), {
      uid,
      refunded: true,
      rewardPaid: false,
      refundStakeHtg: safeInt(stakeHtg),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}

async function payWinnerTx(tx, uid = "", rewardAmountHtg = 0, entryFunding = null, roomRefDoc = null) {
  const walletSnap = await tx.get(walletRef(uid));
  const walletData = walletSnap.exists ? (walletSnap.data() || {}) : {};
  const walletMutation = applyHtgRewardCredit(walletData, {
    rewardHtg: rewardAmountHtg,
    rewardEntryFunding: entryFunding,
  });
  const nowMs = Date.now();
  tx.set(walletRef(uid), {
    ...walletMutation.balancesPatch,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
    lastSeenAtMs: nowMs,
  }, { merge: true });
  if (roomRefDoc) {
    tx.set(roomRefDoc.collection("settlements").doc(`winner_${uid}`), {
      uid,
      refunded: false,
      rewardPaid: true,
      rewardAmountHtg: safeInt(rewardAmountHtg),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
  }
}

async function settleChessRoomTx(tx, roomRefDoc, room = {}, nextRoom = {}) {
  const endedReason = String(nextRoom.endedReason || "").trim().toLowerCase();
  const playerUids = Array.isArray(room.playerUids)
    ? room.playerUids.slice(0, 2).map((value) => String(value || "").trim())
    : ["", ""];
  const stakeHtg = getRoomStakeHtg(room);
  const rewardAmountHtg = getRoomRewardHtg(room);
  const entryFundingByUid = room.entryFundingByUid && typeof room.entryFundingByUid === "object"
    ? room.entryFundingByUid
    : {};

  if (endedReason === "timeout_refund" || endedReason === "quit_refund_before_opening") {
    await Promise.all(
      playerUids
        .filter(Boolean)
        .map((playerUid) => refundStakeTx(tx, playerUid, stakeHtg, entryFundingByUid[playerUid] || null, roomRefDoc))
    );
    return { refunded: true, rewardPaid: false };
  }

  const winnerSeat = safeSignedInt(nextRoom.winnerSeat, -1);
  const winnerUid = winnerSeat >= 0 ? String(playerUids[winnerSeat] || "").trim() : "";
  if (winnerUid && rewardAmountHtg > 0) {
    await payWinnerTx(tx, winnerUid, rewardAmountHtg, entryFundingByUid[winnerUid] || null, roomRefDoc);
    return { refunded: false, rewardPaid: true, winnerUid, rewardAmountHtg };
  }

  return { refunded: false, rewardPaid: false };
}

async function writeChessRoomResultIfEndedTx(tx, roomRefDoc, room = {}, nextRoom = {}) {
  const endedReason = String(nextRoom.endedReason || "").trim();
  if (!endedReason) return;

  const roomId = String(roomRefDoc?.id || "").trim();
  const resultRef = chessRoomResultRef(roomId);
  const playerUids = Array.isArray(nextRoom.playerUids || room.playerUids)
    ? (nextRoom.playerUids || room.playerUids).slice(0, 2).map((value) => String(value || "").trim())
    : ["", ""];
  const winnerSeat = safeSignedInt(nextRoom.winnerSeat, -1);
  const winnerUid = String(nextRoom.winnerUid || "").trim()
    || (winnerSeat >= 0 ? String(playerUids[winnerSeat] || "").trim() : "");
  const winnerType = winnerSeat < 0
    ? "none"
    : (winnerUid ? "human" : "bot");

  tx.set(resultRef, {
    id: roomId,
    roomId,
    status: "ended",
    roomMode: String(room.roomMode || nextRoom.roomMode || "chess_public_bot").trim(),
    stakeHtg: getRoomStakeHtg(room),
    rewardAmountHtg: getRoomRewardHtg(room),
    fundingCurrency: "htg",
    rewardGranted: endedReason !== "timeout_refund" && endedReason !== "quit_refund_before_opening" && winnerSeat >= 0,
    winnerSeat,
    winnerUid,
    winnerType,
    humanCount: safeInt(room.humanCount),
    botCount: safeInt(room.botCount),
    playerUids,
    playerNames: Array.isArray(room.playerNames) ? room.playerNames.slice(0, 2) : ["", ""],
    entryFundingByUid: room.entryFundingByUid && typeof room.entryFundingByUid === "object"
      ? room.entryFundingByUid
      : {},
    opponentDisplayName: String(room.opponentDisplayName || "").trim(),
    startedAtMs: safeSignedInt(room.startedAtMs, 0),
    endedAtMs: safeSignedInt(nextRoom.endedAtMs, 0) || Date.now(),
    endedReason,
    currentFen: sanitizeText(nextRoom.currentFen || room.currentFen || "", 200),
    pgn: sanitizeText(nextRoom.pgn || room.pgn || "", 5000),
    moveCountBySeat: Array.isArray(nextRoom.moveCountBySeat) ? nextRoom.moveCountBySeat.slice(0, 2) : getMoveCountBySeat(room),
    playedCount: safeInt(nextRoom.playedCount || room.playedCount),
    archiveVersion: 1,
    archivedAtMs: Date.now(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

function buildStartedRoomPatch(room = {}, nowMs = Date.now(), extra = {}) {
  return {
    status: "playing",
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    startedAtMs: nowMs,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: nowMs,
    waitingDeadlineMs: 0,
    endedAtMs: 0,
    endedReason: "",
    winnerSeat: -1,
    winnerUid: "",
    moveCountBySeat: [0, 0],
    playedCount: 0,
    currentTurnSeat: 0,
    turnStartedAtMs: nowMs,
    turnDeadlineMs: nowMs + CHESS_TURN_LIMIT_MS,
    currentFen: sanitizeText(extra.currentFen || "startpos", 200),
    pgn: "",
    moveHistory: [],
    lastClientActionId: "",
    ...extra,
  };
}

async function joinMatchmakingChess({ uid = "", email = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }

  const activeRoom = await findActiveChessRoomForUser(safeUid);
  if (activeRoom) {
    return {
      ok: true,
      resumed: true,
      ...buildRoomStateResponse(activeRoom.roomId, activeRoom.room, activeRoom.seatIndex),
    };
  }

  const stakeHtg = assertPublicChessStake(payload.stakeHtg || CHESS_PUBLIC_STAKE_HTG);
  const botDifficulty = sanitizeText(payload.botDifficulty || "fo", 16).toLowerCase() || "fo";
  const publicOpponentName = sanitizeText(payload.publicOpponentName || payload.opponentDisplayName || "", 40);
  const nowMs = Date.now();
  const roomRefDoc = chessRoomRef();
  const playerSeatIndex = Math.random() < 0.5 ? 0 : 1;
  const botSeatIndex = playerSeatIndex === 0 ? 1 : 0;
  const playerUids = ["", ""];
  const playerNames = ["", ""];
  playerUids[playerSeatIndex] = safeUid;
  playerNames[playerSeatIndex] = sanitizePlayerLabel(email || safeUid, playerSeatIndex);
  playerNames[botSeatIndex] = publicOpponentName || "Joueur prive";

  const result = await db.runTransaction(async (tx) => {
    const entryFunding = await debitStakeTx(tx, safeUid, stakeHtg);
    const roomPatch = {
      roomMode: "chess_public_bot",
      fundingCurrency: "htg",
      stakeHtg,
      rewardAmountHtg: buildRewardAmountHtg(stakeHtg),
      playerUids,
      playerNames,
      seats: { [safeUid]: playerSeatIndex },
      ownerUid: safeUid,
      botCount: 1,
      humanCount: 1,
      allowBots: true,
      requiredHumans: 1,
      publicOpponentPoolName: publicOpponentName || "",
      opponentDisplayName: publicOpponentName || "",
      botDifficulty,
      roomPresenceMs: { [safeUid]: nowMs },
      entryFundingByUid: { [safeUid]: entryFunding },
      createdAtMs: nowMs,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      ...buildStartedRoomPatch({}, nowMs),
    };
    tx.set(roomRefDoc, roomPatch, { merge: true });
    return roomPatch;
  });

  return {
    ok: true,
    resumed: false,
    charged: true,
    ...buildRoomStateResponse(roomRefDoc.id, result, playerSeatIndex),
  };
}

async function createFriendChessRoom({ uid = "", email = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }

  const activeRoom = await findActiveChessRoomForUser(safeUid);
  if (activeRoom) {
    const activeMode = String(activeRoom.room.roomMode || "").trim();
    if (activeMode === "chess_friends") {
      return {
        ok: true,
        resumed: true,
        ...buildRoomStateResponse(activeRoom.roomId, activeRoom.room, activeRoom.seatIndex),
      };
    }
  }

  const stakeHtg = assertPrivateChessStake(payload.stakeHtg);
  const inviteCode = await generateUniqueFriendChessInviteCode();
  const nowMs = Date.now();
  const roomRefDoc = chessRoomRef();
  const hostSeatIndex = Math.random() < 0.5 ? 0 : 1;
  const playerUids = ["", ""];
  const playerNames = ["", ""];
  playerUids[hostSeatIndex] = safeUid;
  playerNames[hostSeatIndex] = sanitizePlayerLabel(email || safeUid, hostSeatIndex);

  const roomPatch = {
    roomMode: "chess_friends",
    status: "waiting",
    fundingCurrency: "htg",
    stakeHtg,
    rewardAmountHtg: buildRewardAmountHtg(stakeHtg),
    playerUids,
    playerNames,
    seats: { [safeUid]: hostSeatIndex },
    ownerUid: safeUid,
    ownerSeatIndex: hostSeatIndex,
    botCount: 0,
    humanCount: 1,
    allowBots: false,
    requiredHumans: 2,
    inviteCode,
    inviteCodeNormalized: normalizeCode(inviteCode),
    roomPresenceMs: { [safeUid]: nowMs },
    entryFundingByUid: {},
    createdAtMs: nowMs,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: nowMs,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    waitingDeadlineMs: nowMs + FRIEND_ROOM_WAIT_MS,
    moveCountBySeat: [0, 0],
    playedCount: 0,
    currentTurnSeat: 0,
    currentFen: "startpos",
    pgn: "",
    moveHistory: [],
  };
  await roomRefDoc.set(roomPatch, { merge: true });

  return {
    ok: true,
    resumed: false,
    charged: false,
    ...buildRoomStateResponse(roomRefDoc.id, roomPatch, hostSeatIndex),
  };
}

async function joinFriendChessRoomByCode({ uid = "", email = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }

  const inviteCode = normalizeCode(payload.inviteCode || payload.code);
  if (!inviteCode) {
    throw makeHttpError(400, "missing-invite-code", "Code salon prive requis.");
  }

  const activeRoom = await findActiveChessRoomForUser(safeUid);
  if (activeRoom && String(activeRoom.room.roomMode || "").trim() === "chess_friends") {
    return {
      ok: true,
      resumed: true,
      ...buildRoomStateResponse(activeRoom.roomId, activeRoom.room, activeRoom.seatIndex),
    };
  }

  const roomSnap = await db.collection(CHESS_ROOMS_COLLECTION)
    .where("inviteCodeNormalized", "==", inviteCode)
    .limit(1)
    .get();
  if (roomSnap.empty) {
    throw makeHttpError(404, "chess-friend-room-not-found", "Salon prive Echec introuvable.");
  }

  const roomDoc = roomSnap.docs[0];
  const roomRefDoc = chessRoomRef(roomDoc.id);
  return db.runTransaction(async (tx) => {
    const roomFreshSnap = await tx.get(roomRefDoc);
    if (!roomFreshSnap.exists) {
      throw makeHttpError(404, "chess-friend-room-not-found", "Salon prive Echec introuvable.");
    }

    const room = roomFreshSnap.data() || {};
    const existingSeat = getSeatForUser(room, safeUid);
    if (existingSeat >= 0) {
      return {
        ok: true,
        resumed: true,
        ...buildRoomStateResponse(roomRefDoc.id, room, existingSeat),
      };
    }

    if (String(room.status || "").trim().toLowerCase() !== "waiting") {
      throw makeHttpError(409, "chess-friend-room-not-waiting", "Salon prive Echec la pa disponib ankò.");
    }
    if (getWaitingDeadlineMs(room) <= Date.now()) {
      throw makeHttpError(409, "chess-friend-room-expired", "Code salon prive Echec sa a ekspire.");
    }

    const currentPlayerUids = Array.isArray(room.playerUids) ? room.playerUids.slice(0, 2) : ["", ""];
    const currentPlayerNames = Array.isArray(room.playerNames) ? room.playerNames.slice(0, 2) : ["", ""];
    const hostSeatIndex = currentPlayerUids.findIndex((candidateUid) => String(candidateUid || "").trim());
    const guestSeatIndex = hostSeatIndex === 0 ? 1 : 0;
    const hostUid = String(currentPlayerUids[hostSeatIndex] || "").trim();
    if (!hostUid) {
      throw makeHttpError(409, "chess-friend-room-invalid", "Salon prive Echec la pa valab.");
    }
    if (String(currentPlayerUids[guestSeatIndex] || "").trim()) {
      throw makeHttpError(409, "chess-friend-room-full", "Salon prive Echec la deja konple.");
    }

    const hostEntryFunding = await debitStakeTx(tx, hostUid, getRoomStakeHtg(room));
    const guestEntryFunding = await debitStakeTx(tx, safeUid, getRoomStakeHtg(room));
    const nowMs = Date.now();
    const nextPlayerUids = currentPlayerUids.slice(0, 2);
    const nextPlayerNames = currentPlayerNames.slice(0, 2);
    nextPlayerUids[guestSeatIndex] = safeUid;
    nextPlayerNames[hostSeatIndex] = String(
      currentPlayerNames[hostSeatIndex] || sanitizePlayerLabel(hostUid, hostSeatIndex)
    ).trim();
    nextPlayerNames[guestSeatIndex] = sanitizePlayerLabel(email || safeUid, guestSeatIndex);
    const nextRoom = {
      ...room,
      playerUids: nextPlayerUids,
      playerNames: nextPlayerNames,
      seats: { ...(room.seats || {}), [safeUid]: guestSeatIndex },
      humanCount: 2,
      botCount: 0,
      roomPresenceMs: {
        ...(room.roomPresenceMs && typeof room.roomPresenceMs === "object" ? room.roomPresenceMs : {}),
        [safeUid]: nowMs,
      },
      entryFundingByUid: {
        [hostUid]: hostEntryFunding,
        [safeUid]: guestEntryFunding,
      },
      ...buildStartedRoomPatch(room, nowMs),
    };
    tx.set(roomRefDoc, nextRoom, { merge: true });

    return {
      ok: true,
      resumed: false,
      charged: true,
      ...buildRoomStateResponse(roomRefDoc.id, nextRoom, guestSeatIndex),
    };
  });
}

async function resumeFriendChessRoom({ uid = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }

  const roomSnap = await chessRoomRef(roomId).get();
  if (!roomSnap.exists) {
    throw makeHttpError(404, "chess-room-not-found", "Salle Echec introuvable.");
  }
  const room = roomSnap.data() || {};
  const seatIndex = getSeatForUser(room, safeUid);
  if (seatIndex < 0) {
    throw makeHttpError(403, "chess-room-access-denied", "Ou pa nan sal Echec sa a.");
  }
  return {
    ok: true,
    resumed: true,
    ...buildRoomStateResponse(roomId, room, seatIndex),
  };
}

async function getChessRoomState({ uid = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }

  const roomSnap = await chessRoomRef(roomId).get();
  if (!roomSnap.exists) {
    throw makeHttpError(404, "chess-room-not-found", "Salle Echec introuvable.");
  }
  const room = roomSnap.data() || {};
  const seatIndex = getSeatForUser(room, safeUid);
  if (seatIndex < 0) {
    throw makeHttpError(403, "chess-room-access-denied", "Ou pa nan sal Echec sa a.");
  }

  return buildRoomStateResponse(roomId, room, seatIndex);
}

async function touchRoomPresenceChess({ uid = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }

  const roomRefDoc = chessRoomRef(roomId);
  return db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      return { ok: true, missing: true, status: "missing", engineVersion: 1 };
    }

    const room = roomSnap.data() || {};
    const seatIndex = getSeatForUser(room, safeUid);
    if (seatIndex < 0) {
      throw makeHttpError(403, "chess-room-access-denied", "Ou pa nan sal Echec sa a.");
    }

    const nowMs = Date.now();
    const roomPresenceMs = room.roomPresenceMs && typeof room.roomPresenceMs === "object"
      ? { ...room.roomPresenceMs }
      : {};
    roomPresenceMs[safeUid] = nowMs;

    const status = String(room.status || "").trim().toLowerCase();
    if (status === "ended") {
      tx.set(roomRefDoc, {
        roomPresenceMs,
        updatedAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return {
        ok: true,
        status: "ended",
        endedReason: String(room.endedReason || "").trim(),
        winnerSeat: safeSignedInt(room.winnerSeat, -1),
        engineVersion: 1,
      };
    }

    if (status !== "playing") {
      tx.set(roomRefDoc, {
        roomPresenceMs,
        updatedAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return {
        ok: true,
        status: status || "waiting",
        engineVersion: 1,
      };
    }

    const deadlineMs = safeSignedInt(room.turnDeadlineMs, 0);
    if (deadlineMs > 0 && deadlineMs <= nowMs) {
      const winnerSeat = safeSignedInt(room.currentTurnSeat, 0) === 0 ? 1 : 0;
      const endedReason = "timeout";
      const nextRoom = {
        ...room,
        status: "ended",
        endedReason,
        winnerSeat,
        winnerUid: String((room.playerUids || [])[winnerSeat] || "").trim(),
        endedAtMs: nowMs,
        roomPresenceMs,
      };
      const settlement = await settleChessRoomTx(tx, roomRefDoc, room, nextRoom);
      tx.set(roomRefDoc, {
        ...nextRoom,
        updatedAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await writeChessRoomResultIfEndedTx(tx, roomRefDoc, room, nextRoom);
      return {
        ok: true,
        status: "ended",
        endedReason,
        winnerSeat: safeSignedInt(nextRoom.winnerSeat, -1),
        settlement,
        engineVersion: 1,
      };
    }

    const opponentSeat = seatIndex === 0 ? 1 : 0;
    const opponentUid = String((room.playerUids || [])[opponentSeat] || "").trim();
    const opponentLastSeenMs = opponentUid ? safeSignedInt(roomPresenceMs[opponentUid], 0) : 0;
    const shouldForfeitOpponent = opponentUid
      && opponentLastSeenMs > 0
      && (nowMs - opponentLastSeenMs) >= CHESS_PRESENCE_GRACE_MS;

    if (shouldForfeitOpponent) {
      const endedReason = shouldRefundBeforeOpening(room) ? "quit_refund_before_opening" : "disconnect_forfeit";
      const nextRoom = {
        ...room,
        status: "ended",
        endedReason,
        winnerSeat: endedReason === "quit_refund_before_opening" ? -1 : seatIndex,
        winnerUid: endedReason === "quit_refund_before_opening" ? "" : safeUid,
        endedAtMs: nowMs,
        roomPresenceMs,
      };
      const settlement = await settleChessRoomTx(tx, roomRefDoc, room, nextRoom);
      tx.set(roomRefDoc, {
        ...nextRoom,
        updatedAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      await writeChessRoomResultIfEndedTx(tx, roomRefDoc, room, nextRoom);
      return {
        ok: true,
        status: "ended",
        endedReason,
        winnerSeat: safeSignedInt(nextRoom.winnerSeat, -1),
        settlement,
        engineVersion: 1,
      };
    }

    tx.set(roomRefDoc, {
      roomPresenceMs,
      updatedAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return {
      ok: true,
      status: "playing",
      engineVersion: 1,
    };
  });
}

async function leaveRoomChess({ uid = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }

  const roomRefDoc = chessRoomRef(roomId);
  return db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      return { ok: true, deleted: true, status: "missing", engineVersion: 1 };
    }
    const room = roomSnap.data() || {};
    const seatIndex = getSeatForUser(room, safeUid);
    if (seatIndex < 0) {
      throw makeHttpError(403, "chess-room-access-denied", "Ou pa nan sal Echec sa a.");
    }

    const status = String(room.status || "").trim().toLowerCase();
    const nowMs = Date.now();

    if (status === "waiting") {
      tx.delete(roomRefDoc);
      return { ok: true, deleted: true, status: "cancelled", engineVersion: 1 };
    }
    if (status === "ended") {
      return {
        ok: true,
        deleted: false,
        status: "ended",
        endedReason: String(room.endedReason || "").trim(),
        engineVersion: 1,
      };
    }

    const endedReason = shouldRefundBeforeOpening(room) ? "quit_refund_before_opening" : "quit";
    const winnerSeat = endedReason === "quit_refund_before_opening" ? -1 : (seatIndex === 0 ? 1 : 0);
    const nextRoom = {
      ...room,
      status: "ended",
      endedReason,
      winnerSeat,
      winnerUid: winnerSeat >= 0 ? String((room.playerUids || [])[winnerSeat] || "").trim() : "",
      endedAtMs: nowMs,
    };
    const settlement = await settleChessRoomTx(tx, roomRefDoc, room, nextRoom);
    tx.set(roomRefDoc, {
      ...nextRoom,
      updatedAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      endedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    await writeChessRoomResultIfEndedTx(tx, roomRefDoc, room, nextRoom);
    return {
      ok: true,
      deleted: false,
      status: "ended",
      endedReason,
      winnerSeat,
      settlement,
      engineVersion: 1,
    };
  });
}

async function submitActionChess({ uid = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }

  const roomRefDoc = chessRoomRef(roomId);
  return db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      throw makeHttpError(404, "chess-room-not-found", "Salle Echec introuvable.");
    }
    const room = roomSnap.data() || {};
    const requesterSeatIndex = getSeatForUser(room, safeUid);
    if (requesterSeatIndex < 0) {
      throw makeHttpError(403, "chess-room-access-denied", "Ou pa nan sal Echec sa a.");
    }
    if (String(room.status || "").trim() !== "playing") {
      throw makeHttpError(409, "chess-room-not-playing", "Match Echec la poko komanse.");
    }

    const clientActionId = String(payload.clientActionId || "").trim() || `chess_${Date.now().toString(36)}`;
    if (String(room.lastClientActionId || "").trim() === clientActionId) {
      return {
        ok: true,
        duplicate: true,
        roomId,
        status: String(room.status || "playing").trim(),
        engineVersion: 1,
      };
    }

    const forceFinalize = payload.forceFinalize === true && payload.matchEnded === true;
    const requestedActorSeat = safeSignedInt(payload.actorSeat, requesterSeatIndex);
    const canRelayBotMove = isPublicChessBotRoom(room)
      && safeInt(room.botCount) > 0
      && requestedActorSeat >= 0
      && requestedActorSeat <= 1
      && requestedActorSeat !== requesterSeatIndex
      && !String((room.playerUids || [])[requestedActorSeat] || "").trim();
    const seatIndex = canRelayBotMove ? 1 : requesterSeatIndex;
    const expectedSeat = safeSignedInt(room.currentTurnSeat, 0);
    if (!forceFinalize && expectedSeat !== seatIndex) {
      throw makeHttpError(409, "chess-not-your-turn", "Se pa tou pa ou.");
    }

    const action = payload.action && typeof payload.action === "object" ? payload.action : {};
    const nowMs = Date.now();
    const moveCountBySeat = getMoveCountBySeat(room);
    const nextHistory = Array.isArray(room.moveHistory) ? room.moveHistory.slice(-CHESS_HISTORY_LIMIT + 1) : [];
    let seq = safeInt(room.playedCount);
    let record = null;
    if (!forceFinalize || action.san || action.uci || action.from || action.to) {
      moveCountBySeat[seatIndex] += 1;
      seq += 1;
      record = normalizeMoveRecord(action, seq, seatIndex, safeUid);
      nextHistory.push(record);
    }

    const matchEnded = payload.matchEnded === true || action.isMate === true || payload.endedReason === "checkmate";
    const endedReasonRaw = sanitizeText(payload.endedReason || action.endedReason || "", 80).toLowerCase();
    const winnerSeatPayload = safeSignedInt(payload.winnerSeat, -1);
    let endedReason = "";
    let winnerSeat = -1;
    if (matchEnded) {
      endedReason = endedReasonRaw || "checkmate";
      if (endedReason.startsWith("draw") || endedReason === "stalemate" || endedReason === "agreement_draw") {
        winnerSeat = -1;
      } else if (winnerSeatPayload >= 0 && winnerSeatPayload <= 1) {
        winnerSeat = winnerSeatPayload;
      } else {
        winnerSeat = seatIndex;
      }
    }

    const nextRoom = {
      ...room,
      updatedAtMs: nowMs,
      currentFen: sanitizeText(action.fenAfter || action.fen || room.currentFen || "", 200),
      pgn: sanitizeText(action.pgn || payload.pgn || room.pgn || "", 5000),
      moveHistory: nextHistory,
      moveCountBySeat,
      playedCount: seq,
      lastClientActionId: clientActionId,
      currentTurnSeat: matchEnded ? safeSignedInt(room.currentTurnSeat, 0) : (seatIndex === 0 ? 1 : 0),
      turnStartedAtMs: nowMs,
      turnDeadlineMs: matchEnded ? 0 : (nowMs + CHESS_TURN_LIMIT_MS),
      status: matchEnded ? "ended" : "playing",
      endedReason,
      winnerSeat,
      winnerUid: winnerSeat >= 0 ? String((room.playerUids || [])[winnerSeat] || "").trim() : "",
    };

    let settlement = null;
    if (matchEnded) {
      nextRoom.endedAtMs = nowMs;
      settlement = await settleChessRoomTx(tx, roomRefDoc, room, nextRoom);
    }

    tx.set(roomRefDoc, {
      ...nextRoom,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(matchEnded ? { endedAt: admin.firestore.FieldValue.serverTimestamp() } : {}),
    }, { merge: true });
    if (matchEnded) {
      await writeChessRoomResultIfEndedTx(tx, roomRefDoc, room, nextRoom);
    }

    return {
      ok: true,
      duplicate: false,
      roomId,
      seq,
      record,
      status: matchEnded ? "ended" : "playing",
      currentTurnSeat: safeSignedInt(nextRoom.currentTurnSeat, 0),
      turnDeadlineMs: safeSignedInt(nextRoom.turnDeadlineMs, 0),
      endedReason: nextRoom.endedReason,
      winnerSeat: nextRoom.winnerSeat,
      settlement,
      engineVersion: 1,
    };
  });
}

async function recordChessMatchResult({ uid = "", payload = {} } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }

  const matchId = sanitizeText(payload.matchId || "", 120) || `chess_${safeUid}_${Date.now()}`;
  const resultDocId = `${safeUid}_${matchId}`;
  const roomId = sanitizeText(payload.roomId || "", 120);
  const roomMode = sanitizeText(payload.roomMode || "chess_local", 40) || "chess_local";
  const endedReason = sanitizeText(payload.endedReason || "match_end", 80).toLowerCase() || "match_end";
  const winnerSeat = safeSignedInt(payload.winnerSeat, -1);
  const stakeHtg = safeInt(payload.stakeHtg);
  const rewardAmountHtg = safeInt(payload.rewardAmountHtg || buildRewardAmountHtg(stakeHtg));
  const playerUids = Array.isArray(payload.playerUids)
    ? payload.playerUids.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 2)
    : [safeUid];
  const winnerUid = sanitizeText(payload.winnerUid || (winnerSeat >= 0 ? playerUids[winnerSeat] : ""), 160);
  const winnerType = endedReason === "timeout_refund" || endedReason === "quit_refund_before_opening"
    ? "none"
    : (payload.winnerType
      ? sanitizeText(payload.winnerType, 16).toLowerCase()
      : (winnerUid ? "human" : "bot"));

  await chessRoomResultRef(resultDocId).set({
    id: resultDocId,
    matchId,
    roomId,
    uid: safeUid,
    status: "ended",
    roomMode,
    fundingCurrency: "htg",
    playerUids,
    humanCount: Math.max(1, safeInt(payload.humanCount, playerUids.filter(Boolean).length)),
    botCount: Math.max(0, safeInt(payload.botCount)),
    winnerSeat,
    winnerUid,
    winnerType,
    stakeHtg,
    rewardAmountHtg: endedReason === "timeout_refund" || endedReason === "quit_refund_before_opening"
      ? 0
      : rewardAmountHtg,
    rewardGranted: payload.rewardGranted === true,
    startedAtMs: safeSignedInt(payload.startedAtMs, 0),
    endedAtMs: safeSignedInt(payload.endedAtMs, Date.now()) || Date.now(),
    endedReason,
    opponentDisplayName: sanitizeText(payload.opponentDisplayName || "", 40),
    currentFen: sanitizeText(payload.currentFen || "", 200),
    pgn: sanitizeText(payload.pgn || "", 5000),
    moveCountBySeat: Array.isArray(payload.moveCountBySeat) ? payload.moveCountBySeat.slice(0, 2) : [],
    playedCount: safeInt(payload.playedCount),
    archiveVersion: 1,
    archivedAtMs: Date.now(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    ok: true,
    resultDocId,
    matchId,
  };
}

module.exports = {
  CHESS_PUBLIC_STAKE_HTG,
  CHESS_PRIVATE_MIN_STAKE_HTG,
  createFriendChessRoom,
  getChessRoomState,
  joinFriendChessRoomByCode,
  joinMatchmakingChess,
  leaveRoomChess,
  recordChessMatchResult,
  resumeFriendChessRoom,
  submitActionChess,
  touchRoomPresenceChess,
};
