const crypto = require("crypto");

const { admin, db } = require("./firebase-admin");
const { buildRewardAmountHtg, buildStakeAmountHtg, resolveGameEntryFundingRequest } = require("./domino-classic");
const { makeHttpError } = require("./http");
const { walletRef, assertWalletNotFrozen } = require("./player-wallet");
const { clamp, safeInt, safeSignedInt, sanitizeText } = require("./safe");
const {
  applyHtgRewardCredit,
  applyHtgStakeDebit,
  normalizeFundingCurrency,
} = require("./wallet-htg");

const DAME_ROOMS_COLLECTION = "dameRooms";
const DAME_GAME_STATES_COLLECTION = "dameGameStates";
const DAME_MATCHMAKING_POOLS_COLLECTION = "dameMatchmakingPools";
const DAME_ROOM_RESULTS_COLLECTION = "dameRoomResults";

const DEFAULT_DAME_STAKE_OPTIONS = Object.freeze([
  Object.freeze({ id: "dame_500", stakeDoes: 500, rewardDoes: 900, enabled: true, sortOrder: 10 }),
]);

const ROOM_WAIT_MS = 15 * 1000;
const FRIEND_ROOM_WAIT_MS = 10 * 60 * 1000;
const FRIEND_ROOM_CODE_SIZE = 6;
const DAME_TURN_LIMIT_MS = 30 * 1000;
const DAME_DRAW_MAX_HALF_MOVES = 160;
const DAME_DISCONNECT_GRACE_MS = 30 * 1000;
const MAX_FRIEND_DAME_STAKE_DOES = 100_000_000;
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function timestampToMillis(value) {
  if (value && typeof value.toMillis === "function") return value.toMillis();
  const raw = Number(value);
  return Number.isFinite(raw) ? raw : 0;
}

function resolveRoomCreatedAtMs(room = {}) {
  return safeSignedInt(room.createdAtMs) || timestampToMillis(room.createdAt);
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

function getBlockedRejoinSet(room = {}) {
  return new Set(
    Array.isArray(room.blockedRejoinUids)
      ? room.blockedRejoinUids.map((uid) => String(uid || "").trim()).filter(Boolean)
      : []
  );
}

function isFriendDameRoom(room = {}) {
  return String(room?.roomMode || "").trim() === "dame_friends";
}

function dameRoomRef(roomId = "") {
  const safeRoomId = String(roomId || "").trim();
  return safeRoomId
    ? db.collection(DAME_ROOMS_COLLECTION).doc(safeRoomId)
    : db.collection(DAME_ROOMS_COLLECTION).doc();
}

function dameGameStateRef(roomId = "") {
  return db.collection(DAME_GAME_STATES_COLLECTION).doc(String(roomId || "").trim());
}

function dameMatchmakingPoolRef(stakeConfigId = "", stakeDoes = 0) {
  const cleanStakeConfigId = String(stakeConfigId || "").trim() || `dame_${safeInt(stakeDoes)}`;
  return db.collection(DAME_MATCHMAKING_POOLS_COLLECTION).doc(`${cleanStakeConfigId}_${safeInt(stakeDoes)}`);
}

function setDameMatchmakingPoolOpen(tx, poolRef, roomId, stakeConfigId = "", stakeDoes = 0) {
  tx.set(poolRef, {
    openRoomId: String(roomId || "").trim(),
    stakeConfigId: String(stakeConfigId || "").trim(),
    stakeDoes: safeInt(stakeDoes),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

function clearDameMatchmakingPool(tx, poolRef) {
  tx.set(poolRef, {
    openRoomId: "",
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

function getDameStakeConfigByAmount(stakeDoes) {
  const targetStakeDoes = safeInt(stakeDoes);
  return DEFAULT_DAME_STAKE_OPTIONS.find((item) => item.enabled !== false && safeInt(item.stakeDoes) === targetStakeDoes) || null;
}

function buildPrivateDameRewardDoes(stakeDoes = 0) {
  const safeStakeDoes = safeInt(stakeDoes);
  if (safeStakeDoes <= 0) return 0;
  return Math.max(1, Math.round(safeStakeDoes * 1.8));
}

function resolveDameFriendStakeDoes(value) {
  const stakeDoes = safeInt(value);
  if (stakeDoes < 500) {
    throw makeHttpError(400, "invalid-stake", "Mise dame invalide. Minimum 25 HTG.");
  }
  if ((stakeDoes % 20) !== 0) {
    throw makeHttpError(400, "invalid-stake", "La mise dame doit correspondre a un montant HTG entier.");
  }
  if (stakeDoes > MAX_FRIEND_DAME_STAKE_DOES) {
    throw makeHttpError(400, "invalid-stake", "Mise dame trop elevee.");
  }
  return stakeDoes;
}

function resolveDameWaitingDeadlineMs(room = {}, nowMs = Date.now()) {
  const explicit = safeSignedInt(room.waitingDeadlineMs);
  if (explicit > 0) return explicit;
  const createdAtMs = resolveRoomCreatedAtMs(room);
  if (createdAtMs > 0) {
    return createdAtMs + (isFriendDameRoom(room) ? FRIEND_ROOM_WAIT_MS : ROOM_WAIT_MS);
  }
  return nowMs + (isFriendDameRoom(room) ? FRIEND_ROOM_WAIT_MS : ROOM_WAIT_MS);
}

function getSeatForUser(room = {}, uid = "") {
  const seats = room?.seats && typeof room.seats === "object" ? room.seats : {};
  return typeof seats[uid] === "number" ? seats[uid] : -1;
}

function getDameSeatForColor(room = {}, color = -1) {
  const targetColor = safeSignedInt(color, -1);
  if (targetColor < 0 || targetColor > 1) return -1;
  const redSeatIndex = Number.isFinite(Number(room.startingPlayerSeat)) ? Math.trunc(Number(room.startingPlayerSeat)) : 1;
  return targetColor === 1 ? redSeatIndex : (redSeatIndex ^ 1);
}

function resolveRoomStakeHtg(room = {}) {
  const explicit = safeInt(room.stakeHtg);
  if (explicit > 0) return explicit;
  return buildStakeAmountHtg(room.entryCostDoes || room.stakeDoes || 0);
}

function resolveRoomRewardHtg(room = {}) {
  const explicit = safeInt(room.rewardAmountHtg);
  if (explicit > 0) return explicit;
  return buildRewardAmountHtg(
    room.entryCostDoes || room.stakeDoes || 0,
    room.rewardAmountDoes || room.rewardDoes || 0
  );
}

function getDameMoveCountBySeat(room = {}) {
  const raw = Array.isArray(room.moveCountBySeat) ? room.moveCountBySeat : [];
  return [0, 1].map((seat) => Math.max(0, safeInt(raw[seat])));
}

function shouldRefundDameBeforeOpening(room = {}) {
  if (String(room.status || "").trim().toLowerCase() !== "playing") return false;
  if (String(room.endedReason || "").trim()) return false;
  const playerUids = Array.isArray(room.playerUids)
    ? room.playerUids.slice(0, 2).map((value) => String(value || "").trim())
    : ["", ""];
  if (!playerUids[0] || !playerUids[1]) return false;
  const moveCountBySeat = getDameMoveCountBySeat(room);
  return moveCountBySeat[0] <= 0 || moveCountBySeat[1] <= 0;
}

async function deleteCollectionInChunks(collectionRef, batchSize = 400) {
  while (true) {
    const snap = await collectionRef.limit(batchSize).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((item) => batch.delete(item.ref));
    await batch.commit();
  }
}

async function cleanupDameRoom(roomRefDoc) {
  await Promise.all([
    deleteCollectionInChunks(roomRefDoc.collection("actions")),
    deleteCollectionInChunks(roomRefDoc.collection("settlements")),
    dameGameStateRef(roomRefDoc.id).delete().catch(() => null),
  ]);
  await roomRefDoc.delete().catch(() => null);
}

function assertHtgFundingRequest(payload = {}, stakeDoes = 0) {
  const fundingRequest = resolveGameEntryFundingRequest(payload, stakeDoes, "htg");
  if (fundingRequest.fundingCurrency !== "htg") {
    throw makeHttpError(400, "dame-htg-only", "Seul le financement HTG est autorise pour Dame.", {
      fundingCurrency: fundingRequest.fundingCurrency,
    });
  }
  return fundingRequest;
}

async function findActiveDameRoomForUser(uid) {
  const safeUid = String(uid || "").trim();
  if (!safeUid) return null;

  const membershipSnap = await db
    .collection(DAME_ROOMS_COLLECTION)
    .where("playerUids", "array-contains", safeUid)
    .limit(8)
    .get();

  if (membershipSnap.empty) return null;

  const candidate = membershipSnap.docs
    .filter((docSnap) => {
      const data = docSnap.data() || {};
      if (getBlockedRejoinSet(data).has(safeUid)) return false;
      const status = String(data.status || "");
      return status === "playing" || status === "waiting";
    })
    .sort((left, right) => {
      const leftData = left.data() || {};
      const rightData = right.data() || {};
      const statusScore = (value) => (String(value || "") === "playing" ? 2 : 1);
      const statusDelta = statusScore(rightData.status) - statusScore(leftData.status);
      if (statusDelta !== 0) return statusDelta;
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
    status: String(data.status || ""),
    seatIndex: getSeatForUser(data, safeUid),
    stakeDoes: safeInt(data.entryCostDoes || data.stakeDoes),
    roomMode: String(data.roomMode || "dame_2p"),
    inviteCode: String(data.inviteCode || "").trim(),
  };
}

async function generateUniqueFriendDameInviteCode(size = FRIEND_ROOM_CODE_SIZE, maxAttempts = 18) {
  const targetSize = Math.max(4, safeInt(size) || FRIEND_ROOM_CODE_SIZE);
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const candidate = normalizeCode(randomCode(targetSize));
    if (!candidate) continue;
    const existing = await db
      .collection(DAME_ROOMS_COLLECTION)
      .where("inviteCodeNormalized", "==", candidate)
      .limit(1)
      .get();
    if (existing.empty) return candidate;
  }
  throw makeHttpError(409, "invite-code-generation-failed", "Impossible de generer un code dame unique.");
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

  const uniquePlayerUids = Array.from(
    new Set(
      (Array.isArray(playerUids) ? playerUids : [])
        .map((item) => String(item || "").trim())
        .filter(Boolean)
    )
  );
  if (uniquePlayerUids.length <= 0) {
    throw makeHttpError(400, "missing-players", "Aucun joueur valide pour cette salle dame.");
  }

  const entryFundingCurrencyByUid = room.entryFundingCurrencyByUid && typeof room.entryFundingCurrencyByUid === "object"
    ? room.entryFundingCurrencyByUid
    : {};
  const walletSnaps = await Promise.all(uniquePlayerUids.map((playerUid) => tx.get(walletRef(playerUid))));
  const prepared = uniquePlayerUids.map((playerUid, index) => {
    const fundingCurrency = normalizeFundingCurrency(entryFundingCurrencyByUid[playerUid] || "htg");
    if (fundingCurrency !== "htg") {
      throw makeHttpError(400, "dame-htg-only", "Seul le financement HTG est autorise pour Dame.", {
        uid: playerUid,
        fundingCurrency,
      });
    }
    const walletSnap = walletSnaps[index];
    const walletData = walletSnap.exists ? (walletSnap.data() || {}) : {};
    assertWalletNotFrozen(walletData);
    const walletMutation = applyHtgStakeDebit(walletData, { stakeHtg });
    return {
      playerUid,
      walletMutation,
    };
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

async function refundDameEntriesForNoPlayTimeoutTx(tx, roomRefDoc, room = {}) {
  const playerUids = Array.isArray(room.playerUids)
    ? room.playerUids.slice(0, 2).map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  if (playerUids.length <= 0) return;

  const stakeHtg = resolveRoomStakeHtg(room);
  if (stakeHtg <= 0) return;

  const walletSnaps = await Promise.all(playerUids.map((uid) => tx.get(walletRef(uid))));
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

function buildStartedDameRoomTransaction(tx, roomRefDoc, room = {}, options = {}) {
  const nowMs = safeSignedInt(options.nowMs, Date.now()) || Date.now();
  const roomId = String(roomRefDoc?.id || "").trim();
  const playerUids = Array.isArray(room.playerUids) ? room.playerUids.slice(0, 2).map((item) => String(item || "").trim()) : ["", ""];
  const playerNames = Array.isArray(room.playerNames) ? room.playerNames.slice(0, 2).map((item) => String(item || "").trim()) : ["", ""];
  const seats = room.seats && typeof room.seats === "object" ? { ...room.seats } : {};
  const humanCount = playerUids.filter(Boolean).length;
  const startedAtMs = safeSignedInt(room.startedAtMs) > 0 ? safeSignedInt(room.startedAtMs) : nowMs;
  const startingPlayerSeat = Number.isFinite(Number(room.startingPlayerSeat)) && Number(room.startingPlayerSeat) >= 0 && Number(room.startingPlayerSeat) < 2
    ? Math.trunc(Number(room.startingPlayerSeat))
    : crypto.randomInt(0, 2);
  const currentPlayer = 1;
  const lastActionSeq = Math.max(0, safeInt(room.lastActionSeq));
  const nextActionSeq = Math.max(lastActionSeq, safeInt(room.nextActionSeq, lastActionSeq));

  tx.set(roomRefDoc, {
    status: "playing",
    startedAt: admin.firestore.FieldValue.serverTimestamp(),
    startedAtMs,
    endedAt: admin.firestore.FieldValue.delete(),
    endedAtMs: 0,
    waitingDeadlineMs: admin.firestore.FieldValue.delete(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: nowMs,
    playerUids,
    playerNames,
    seats,
    humanCount,
    botCount: 0,
    allowBots: false,
    requiredHumans: 2,
    startingPlayerSeat,
    currentPlayer,
    turnStartedAtMs: nowMs,
    turnDeadlineMs: nowMs + DAME_TURN_LIMIT_MS,
    moveCountBySeat: [0, 0],
    lastActionSeq,
    nextActionSeq,
    drawHalfMoveCount: 0,
    roundIndex: Math.max(1, safeInt(room.roundIndex, 0) + (safeSignedInt(room.startedAtMs) > 0 ? 1 : 0)),
    endedReason: admin.firestore.FieldValue.delete(),
    winnerSeat: admin.firestore.FieldValue.delete(),
    winnerUid: admin.firestore.FieldValue.delete(),
    rematchRequestUids: admin.firestore.FieldValue.delete(),
    rematchRequestedAtMs: admin.firestore.FieldValue.delete(),
  }, { merge: true });

  return {
    ok: true,
    started: true,
    roomId,
    status: "playing",
    startedAtMs,
    waitingDeadlineMs: 0,
    humanCount,
    botCount: 0,
  };
}

async function forceRemoveUserFromDameRoom(roomId = "", uid = "") {
  const safeRoomId = String(roomId || "").trim();
  const safeUid = String(uid || "").trim();
  if (!safeRoomId || !safeUid) return { ok: true, deleted: false, status: "skipped" };

  const roomRefDoc = dameRoomRef(safeRoomId);
  return db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      return { ok: true, deleted: true, status: "missing" };
    }

    const room = roomSnap.data() || {};
    const seatIndex = getSeatForUser(room, safeUid);
    if (seatIndex < 0) {
      return { ok: true, deleted: false, status: String(room.status || "") };
    }

    const nowMs = Date.now();
    if (shouldRefundDameBeforeOpening(room)) {
      const nextPresence = room.roomPresenceMs && typeof room.roomPresenceMs === "object" ? { ...room.roomPresenceMs } : {};
      delete nextPresence[safeUid];
      const nextBlocked = Array.from(new Set([
        ...(Array.isArray(room.blockedRejoinUids) ? room.blockedRejoinUids : []),
        safeUid,
      ]));
      await refundDameEntriesForNoPlayTimeoutTx(tx, roomRefDoc, room);
      tx.set(roomRefDoc, {
        status: "ended",
        endedReason: "quit_refund_before_opening",
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        endedAtMs: nowMs,
        winnerSeat: -1,
        winnerUid: "",
        roomPresenceMs: nextPresence,
        blockedRejoinUids: nextBlocked,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });
      return { ok: true, deleted: false, status: "ended", refunded: true, reason: "quit_refund_before_opening" };
    }

    const nextPlayerUids = Array.isArray(room.playerUids) ? room.playerUids.slice(0, 2) : ["", ""];
    const nextPlayerNames = Array.isArray(room.playerNames) ? room.playerNames.slice(0, 2) : ["", ""];
    nextPlayerUids[seatIndex] = "";
    nextPlayerNames[seatIndex] = "";
    const nextSeats = room.seats && typeof room.seats === "object" ? { ...room.seats } : {};
    delete nextSeats[safeUid];
    const nextPresence = room.roomPresenceMs && typeof room.roomPresenceMs === "object" ? { ...room.roomPresenceMs } : {};
    delete nextPresence[safeUid];
    const nextBlocked = Array.from(new Set([
      ...(Array.isArray(room.blockedRejoinUids) ? room.blockedRejoinUids : []),
      safeUid,
    ]));
    const nextHumans = nextPlayerUids.filter(Boolean).length;
    const status = String(room.status || "").trim().toLowerCase();

    const updates = {
      playerUids: nextPlayerUids,
      playerNames: nextPlayerNames,
      seats: nextSeats,
      roomPresenceMs: nextPresence,
      blockedRejoinUids: nextBlocked,
      humanCount: nextHumans,
      botCount: 0,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    };

    if (status === "playing") {
      const originalPlayerUids = Array.isArray(room.playerUids)
        ? room.playerUids.slice(0, 2).map((value) => String(value || "").trim())
        : ["", ""];
      const winnerSeat = nextPlayerUids[0] ? 0 : (nextPlayerUids[1] ? 1 : -1);
      const winnerUid = winnerSeat >= 0 ? String(nextPlayerUids[winnerSeat] || "").trim() : "";
      Object.assign(updates, {
        status: "ended",
        endedReason: "player_left",
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        endedAtMs: nowMs,
        winnerSeat,
        winnerUid,
      });
      if (winnerUid && winnerSeat >= 0) {
        const forfeitResultDocId = `forfeit_${safeRoomId}_${safeUid}_${nowMs}`;
        tx.set(db.collection(DAME_ROOM_RESULTS_COLLECTION).doc(forfeitResultDocId), {
          id: forfeitResultDocId,
          roomId: safeRoomId,
          matchId: `dame_forfeit_${safeRoomId}_${nowMs}`,
          uid: safeUid,
          status: "ended",
          roomMode: String(room.roomMode || "dame_2p"),
          winnerType: "human",
          winnerSeat,
          winnerUid,
          playerUids: originalPlayerUids.filter(Boolean),
          entryFundingByUid: room.entryFundingByUid && typeof room.entryFundingByUid === "object"
            ? room.entryFundingByUid
            : {},
          fundingCurrency: normalizeFundingCurrency(room.entryFundingCurrencyByUid?.[safeUid] || "htg"),
          stakeDoes: safeInt(room.entryCostDoes || room.stakeDoes),
          stakeHtg: resolveRoomStakeHtg(room),
          rewardAmountDoes: safeInt(room.rewardAmountDoes || 0),
          rewardAmountHtg: resolveRoomRewardHtg(room),
          endedReason: "player_left",
          endedAtMs: nowMs,
          startedAtMs: safeSignedInt(room.startedAtMs),
          archiveVersion: 1,
          archivedAtMs: nowMs,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, { merge: true });
      }
    } else if (nextHumans <= 0) {
      Object.assign(updates, {
        status: "closed",
        endedReason: "empty_room",
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        endedAtMs: nowMs,
      });
    } else {
      Object.assign(updates, {
        status: "waiting",
      });
    }

    tx.set(roomRefDoc, updates, { merge: true });

    if (!isFriendDameRoom(room)) {
      const poolRef = dameMatchmakingPoolRef(String(room.stakeConfigId || ""), safeInt(room.entryCostDoes || room.stakeDoes));
      if (nextHumans <= 0 || status === "playing") {
        clearDameMatchmakingPool(tx, poolRef);
      } else {
        setDameMatchmakingPoolOpen(tx, poolRef, safeRoomId, String(room.stakeConfigId || ""), safeInt(room.entryCostDoes || room.stakeDoes));
      }
    }

    return { ok: true, deleted: false, status: String(updates.status || "") };
  });
}

async function joinMatchmakingDame({ uid, email, payload = {} }) {
  const stakeDoes = safeInt(payload.stakeDoes);
  const fundingRequest = assertHtgFundingRequest(payload, stakeDoes);
  const selectedStakeConfig = getDameStakeConfigByAmount(stakeDoes);
  if (!selectedStakeConfig) {
    throw makeHttpError(400, "invalid-stake", "Mise dame non autorisee.");
  }

  const activeRoom = await findActiveDameRoomForUser(uid);
  if (activeRoom?.roomId) {
    await forceRemoveUserFromDameRoom(activeRoom.roomId, uid).catch(() => null);
  }

  const rewardAmountDoes = selectedStakeConfig.rewardDoes;
  const rewardAmountHtg = buildRewardAmountHtg(stakeDoes, rewardAmountDoes);
  const poolRef = dameMatchmakingPoolRef(selectedStakeConfig.id, stakeDoes);

  return db.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const [poolSnap, walletSnap] = await Promise.all([
      tx.get(poolRef),
      tx.get(walletRef(uid)),
    ]);
    const walletData = walletSnap.exists ? (walletSnap.data() || {}) : {};
    assertWalletNotFrozen(walletData);

    const existingOpenRoomId = String(poolSnap.exists ? (poolSnap.data() || {}).openRoomId || "" : "").trim();
    if (existingOpenRoomId) {
      const openRoomRef = dameRoomRef(existingOpenRoomId);
      const roomSnap = await tx.get(openRoomRef);
      if (roomSnap.exists) {
        const room = roomSnap.data() || {};
        const status = String(room.status || "");
        const roomEntryCostDoes = safeInt(room.entryCostDoes || room.stakeDoes);
        const roomRewardAmountDoes = safeInt(room.rewardAmountDoes || 0);
        const playerUids = Array.from({ length: 2 }, (_, idx) => String((room.playerUids || [])[idx] || ""));
        const waitingDeadlineMs = resolveDameWaitingDeadlineMs(room, nowMs);
        const humans = playerUids.filter(Boolean).length;

        if (
          status === "waiting"
          && !getBlockedRejoinSet(room).has(uid)
          && roomEntryCostDoes === stakeDoes
          && roomRewardAmountDoes === rewardAmountDoes
        ) {
          const currentSeats = room.seats && typeof room.seats === "object" ? room.seats : {};
          const usedSeats = new Set(
            Object.values(currentSeats)
              .map((seat) => Number(seat))
              .filter((seat) => Number.isFinite(seat) && seat >= 0 && seat < 2)
          );
          const seatIndex = [0, 1].find((seat) => !usedSeats.has(seat));
          if (typeof seatIndex === "number" && humans < 2) {
            const nextPlayerUids = playerUids.slice();
            nextPlayerUids[seatIndex] = uid;
            const currentNames = Array.from({ length: 2 }, (_, idx) => String((room.playerNames || [])[idx] || ""));
            const nextPlayerNames = currentNames.slice();
            nextPlayerNames[seatIndex] = sanitizePlayerLabel(email || uid, seatIndex);
            const nextSeats = { ...currentSeats, [uid]: seatIndex };
            const nextHumans = nextPlayerUids.filter(Boolean).length;
            const nextPresence = room.roomPresenceMs && typeof room.roomPresenceMs === "object" ? { ...room.roomPresenceMs } : {};
            nextPresence[uid] = nowMs;
            const nextEntryFundingCurrency = room.entryFundingCurrencyByUid && typeof room.entryFundingCurrencyByUid === "object"
              ? { ...room.entryFundingCurrencyByUid }
              : {};
            nextEntryFundingCurrency[uid] = fundingRequest.fundingCurrency;

            if (nextHumans >= 2) {
              try {
                const chargeResult = await chargeRoomEntriesTx(tx, {
                  ...room,
                  entryFundingCurrencyByUid: nextEntryFundingCurrency,
                }, nextPlayerUids, stakeDoes);
                tx.set(openRoomRef, {
                  playerUids: nextPlayerUids,
                  playerNames: nextPlayerNames,
                  seats: nextSeats,
                  roomPresenceMs: nextPresence,
                  humanCount: nextHumans,
                  botCount: 0,
                  entryFundingByUid: chargeResult.entryFundingByUid,
                  entryFundingCurrencyByUid: nextEntryFundingCurrency,
                  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
                  updatedAtMs: nowMs,
                }, { merge: true });
                clearDameMatchmakingPool(tx, poolRef);
                return {
                  ok: true,
                  resumed: false,
                  charged: stakeDoes > 0,
                  roomId: openRoomRef.id,
                  seatIndex,
                  does: safeInt(chargeResult.afterDoesByUid[uid]),
                  roomMode: "dame_2p",
                  ...buildStartedDameRoomTransaction(tx, openRoomRef, {
                    ...room,
                    playerUids: nextPlayerUids,
                    playerNames: nextPlayerNames,
                    seats: nextSeats,
                    roomPresenceMs: nextPresence,
                    humanCount: nextHumans,
                    botCount: 0,
                    entryFundingByUid: chargeResult.entryFundingByUid,
                    entryFundingCurrencyByUid: nextEntryFundingCurrency,
                    waitingDeadlineMs,
                  }, { nowMs }),
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
                  clearDameMatchmakingPool(tx, poolRef);
                } else {
                  throw error;
                }
              }
            }
          }
        }
      }
    }

    const newRoomRef = dameRoomRef();
    tx.set(newRoomRef, {
      status: "waiting",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
      ownerUid: uid,
      roomMode: "dame_2p",
      gameMode: "dame_classic",
      engineVersion: 1,
      isPrivate: false,
      allowBots: false,
      requiredHumans: 2,
      playerUids: [uid, ""],
      playerNames: [sanitizePlayerLabel(email || uid, 0), ""],
      seats: { [uid]: 0 },
      roomPresenceMs: { [uid]: nowMs },
      blockedRejoinUids: [],
      entryFundingByUid: {},
      entryFundingCurrencyByUid: { [uid]: fundingRequest.fundingCurrency },
      humanCount: 1,
      botCount: 0,
      waitingDeadlineMs: nowMs + ROOM_WAIT_MS,
      startedAtMs: 0,
      endedAtMs: 0,
      currentPlayer: -1,
      startingPlayerSeat: crypto.randomInt(0, 2),
      lastActionSeq: 0,
      nextActionSeq: 0,
      stakeDoes,
      entryCostDoes: stakeDoes,
      rewardAmountDoes,
      rewardAmountHtg,
      stakeConfigId: selectedStakeConfig.id,
    });
    setDameMatchmakingPoolOpen(tx, poolRef, newRoomRef.id, selectedStakeConfig.id, stakeDoes);

    return {
      ok: true,
      resumed: false,
      charged: false,
      roomId: newRoomRef.id,
      seatIndex: 0,
      status: "waiting",
      roomMode: "dame_2p",
      waitingDeadlineMs: nowMs + ROOM_WAIT_MS,
      stakeDoes,
      rewardAmountDoes,
      rewardAmountHtg,
      humanCount: 1,
      botCount: 0,
    };
  });
}

async function createFriendDameRoom({ uid, email, payload = {} }) {
  const stakeDoes = resolveDameFriendStakeDoes(payload.stakeDoes ?? payload.amountDoes ?? payload.amount);
  const fundingRequest = assertHtgFundingRequest(payload, stakeDoes);
  const stakeHtg = buildStakeAmountHtg(stakeDoes);

  const activeRoom = await findActiveDameRoomForUser(uid);
  if (activeRoom?.roomId) {
    await forceRemoveUserFromDameRoom(activeRoom.roomId, uid).catch(() => null);
  }

  const inviteCode = await generateUniqueFriendDameInviteCode();
  const rewardAmountDoes = buildPrivateDameRewardDoes(stakeDoes);
  const rewardAmountHtg = buildRewardAmountHtg(stakeDoes, rewardAmountDoes);
  const roomRefDoc = dameRoomRef();

  return db.runTransaction(async (tx) => {
    const walletSnap = await tx.get(walletRef(uid));
    const walletData = walletSnap.exists ? (walletSnap.data() || {}) : {};
    assertWalletNotFrozen(walletData);
    applyHtgStakeDebit(walletData, { stakeHtg });

    const nowMs = Date.now();
    const waitingDeadlineMs = nowMs + FRIEND_ROOM_WAIT_MS;
    tx.set(roomRefDoc, {
      status: "waiting",
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtMs: nowMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
      ownerUid: uid,
      roomMode: "dame_friends",
      gameMode: "dame_classic",
      engineVersion: 1,
      isPrivate: true,
      allowBots: false,
      requiredHumans: 2,
      inviteCode,
      inviteCodeNormalized: normalizeCode(inviteCode),
      playerUids: [uid, ""],
      playerNames: [sanitizePlayerLabel(email || uid, 0), ""],
      seats: { [uid]: 0 },
      roomPresenceMs: { [uid]: nowMs },
      blockedRejoinUids: [],
      entryFundingByUid: {},
      entryFundingCurrencyByUid: { [uid]: fundingRequest.fundingCurrency },
      humanCount: 1,
      botCount: 0,
      waitingDeadlineMs,
      startedAtMs: 0,
      endedAtMs: 0,
      currentPlayer: -1,
      startingPlayerSeat: crypto.randomInt(0, 2),
      lastActionSeq: 0,
      nextActionSeq: 0,
      stakeDoes,
      entryCostDoes: stakeDoes,
      rewardAmountDoes,
      rewardAmountHtg,
      stakeConfigId: `dame_friends_${stakeDoes}`,
    });

    return {
      ok: true,
      roomId: roomRefDoc.id,
      seatIndex: 0,
      status: "waiting",
      roomMode: "dame_friends",
      charged: false,
      inviteCode,
      requiredHumans: 2,
      waitingDeadlineMs,
      stakeDoes,
      stakeHtg,
      rewardAmountDoes,
      rewardAmountHtg,
    };
  });
}

async function resumeFriendDameRoom({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }

  const roomSnap = await dameRoomRef(roomId).get();
  if (!roomSnap.exists) {
    throw makeHttpError(404, "room-not-found", "Salle dame introuvable.");
  }
  const room = roomSnap.data() || {};
  if (!isFriendDameRoom(room)) {
    throw makeHttpError(412, "invalid-room", "Cette salle dame n'est pas une salle privee valide.");
  }
  if (getBlockedRejoinSet(room).has(uid)) {
    throw makeHttpError(403, "blocked-rejoin", "Tu ne peux plus rejoindre cette salle dame.");
  }

  const seatIndex = getSeatForUser(room, uid);
  if (seatIndex < 0) {
    throw makeHttpError(403, "not-room-member", "Tu ne fais pas partie de cette salle dame.");
  }

  const status = String(room.status || "").trim().toLowerCase();
  const nowMs = Date.now();
  const waitingDeadlineMs = resolveDameWaitingDeadlineMs(room, nowMs);
  const humans = Array.isArray(room.playerUids)
    ? room.playerUids.map((item) => String(item || "").trim()).filter(Boolean).length
    : safeInt(room.humanCount);

  if (status === "closed") {
    throw makeHttpError(412, "room-unavailable", "Cette salle dame n'est plus disponible.");
  }
  if (status === "waiting" && waitingDeadlineMs > 0 && humans < 2 && nowMs >= waitingDeadlineMs) {
    throw makeHttpError(412, "room-expired", "Cette salle dame a expire.");
  }

  return {
    ok: true,
    roomId,
    seatIndex,
    status,
    roomMode: "dame_friends",
    stakeDoes: safeInt(room.entryCostDoes || room.stakeDoes),
    stakeHtg: resolveRoomStakeHtg(room),
    rewardAmountDoes: safeInt(room.rewardAmountDoes || buildPrivateDameRewardDoes(room.entryCostDoes || room.stakeDoes)),
    rewardAmountHtg: resolveRoomRewardHtg(room),
    inviteCode: String(room.inviteCode || "").trim(),
    waitingDeadlineMs,
  };
}

async function joinFriendDameRoomByCode({ uid, email, payload = {} }) {
  const inviteCodeNormalized = normalizeCode(payload.inviteCode || payload.code || "");
  if (!inviteCodeNormalized) {
    throw makeHttpError(400, "missing-invite-code", "Code de salle requis.");
  }

  const matchingSnap = await db
    .collection(DAME_ROOMS_COLLECTION)
    .where("inviteCodeNormalized", "==", inviteCodeNormalized)
    .limit(6)
    .get();
  const roomDoc = matchingSnap.docs.find((docSnap) => isFriendDameRoom(docSnap.data() || {})) || null;
  if (!roomDoc) {
    throw makeHttpError(404, "room-not-found", "Code de dame introuvable.");
  }

  const activeRoom = await findActiveDameRoomForUser(uid);
  if (activeRoom?.roomId && activeRoom.roomId !== roomDoc.id) {
    await forceRemoveUserFromDameRoom(activeRoom.roomId, uid).catch(() => null);
  }

  const roomRefDoc = roomDoc.ref;
  return db.runTransaction(async (tx) => {
    const [roomSnap, walletSnap] = await Promise.all([
      tx.get(roomRefDoc),
      tx.get(walletRef(uid)),
    ]);
    if (!roomSnap.exists) {
      throw makeHttpError(404, "room-not-found", "Salle dame introuvable.");
    }

    const room = roomSnap.data() || {};
    if (!isFriendDameRoom(room)) {
      throw makeHttpError(412, "invalid-room", "Cette salle dame n'est pas disponible.");
    }
    const roomStatus = String(room.status || "");
    const nowMs = Date.now();
    const waitingDeadlineMs = resolveDameWaitingDeadlineMs(room, nowMs);
    const playerUids = Array.from({ length: 2 }, (_, idx) => String((room.playerUids || [])[idx] || ""));
    const humans = playerUids.filter(Boolean).length;
    const roomStakeDoes = safeInt(room.entryCostDoes || room.stakeDoes);
    const roomRewardAmountDoes = safeInt(room.rewardAmountDoes || buildPrivateDameRewardDoes(roomStakeDoes));
    const roomInviteCode = String(room.inviteCode || inviteCodeNormalized || "").trim();

    const walletData = walletSnap.exists ? (walletSnap.data() || {}) : {};
    assertWalletNotFrozen(walletData);
    const fundingRequest = assertHtgFundingRequest(payload, roomStakeDoes);

    if (playerUids.includes(uid)) {
      if (roomStatus === "closed") {
        throw makeHttpError(412, "room-unavailable", "Cette salle dame est terminee.");
      }
      const seatIndex = getSeatForUser(room, uid);
      const nextPresence = room.roomPresenceMs && typeof room.roomPresenceMs === "object" ? { ...room.roomPresenceMs } : {};
      nextPresence[uid] = nowMs;
      tx.update(roomRefDoc, {
        roomPresenceMs: nextPresence,
        waitingDeadlineMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      });
      return {
        ok: true,
        resumed: true,
        charged: false,
        roomId: roomRefDoc.id,
        seatIndex: seatIndex >= 0 ? seatIndex : 0,
        status: roomStatus,
        roomMode: "dame_friends",
        stakeDoes: roomStakeDoes,
        stakeHtg: resolveRoomStakeHtg(room),
        rewardAmountDoes: roomRewardAmountDoes,
        rewardAmountHtg: resolveRoomRewardHtg(room),
        inviteCode: roomInviteCode,
        waitingDeadlineMs,
        rematchRequestUids: Array.isArray(room.rematchRequestUids)
          ? room.rematchRequestUids.map((item) => String(item || "").trim()).filter(Boolean)
          : [],
      };
    }

    if (roomStatus === "ended" || roomStatus === "closed") {
      throw makeHttpError(412, "room-unavailable", "Cette salle dame est terminee.");
    }
    if (roomStatus === "playing") {
      throw makeHttpError(412, "room-already-started", "Cette salle dame a deja demarre.");
    }
    if (roomStatus !== "waiting") {
      throw makeHttpError(412, "room-unavailable", "Cette salle dame n'est plus disponible.");
    }
    if (getBlockedRejoinSet(room).has(uid)) {
      throw makeHttpError(403, "blocked-rejoin", "Tu ne peux plus rejoindre cette salle dame.");
    }
    if (waitingDeadlineMs > 0 && nowMs >= waitingDeadlineMs && humans < 2) {
      tx.set(roomRefDoc, {
        status: "closed",
        endedReason: "expired",
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        endedAtMs: nowMs,
        waitingDeadlineMs: admin.firestore.FieldValue.delete(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });
      return { ok: false, expired: true, roomId: roomRefDoc.id };
    }

    const currentSeats = room.seats && typeof room.seats === "object" ? room.seats : {};
    const usedSeats = new Set(
      Object.values(currentSeats)
        .map((seat) => Number(seat))
        .filter((seat) => Number.isFinite(seat) && seat >= 0 && seat < 2)
    );
    const seatIndex = [0, 1].find((seat) => !usedSeats.has(seat));
    if (typeof seatIndex !== "number" || humans >= 2) {
      throw makeHttpError(412, "room-full", "Cette salle dame est complete.");
    }

    const nextPlayerUids = playerUids.slice();
    nextPlayerUids[seatIndex] = uid;
    const currentNames = Array.from({ length: 2 }, (_, idx) => String((room.playerNames || [])[idx] || ""));
    const nextPlayerNames = currentNames.slice();
    nextPlayerNames[seatIndex] = sanitizePlayerLabel(email || uid, seatIndex);
    const nextSeats = { ...currentSeats, [uid]: seatIndex };
    const nextPresence = room.roomPresenceMs && typeof room.roomPresenceMs === "object" ? { ...room.roomPresenceMs } : {};
    nextPresence[uid] = nowMs;
    const nextHumans = nextPlayerUids.filter(Boolean).length;
    const nextEntryFundingCurrency = room.entryFundingCurrencyByUid && typeof room.entryFundingCurrencyByUid === "object"
      ? { ...room.entryFundingCurrencyByUid }
      : {};
    nextEntryFundingCurrency[uid] = fundingRequest.fundingCurrency;

    if (nextHumans >= 2) {
      const chargeResult = await chargeRoomEntriesTx(tx, {
        ...room,
        entryFundingCurrencyByUid: nextEntryFundingCurrency,
      }, nextPlayerUids, roomStakeDoes);
      tx.set(roomRefDoc, {
        playerUids: nextPlayerUids,
        playerNames: nextPlayerNames,
        seats: nextSeats,
        roomPresenceMs: nextPresence,
        humanCount: nextHumans,
        botCount: 0,
        entryFundingByUid: chargeResult.entryFundingByUid,
        entryFundingCurrencyByUid: nextEntryFundingCurrency,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });

      return {
        ok: true,
        resumed: false,
        charged: true,
        roomId: roomRefDoc.id,
        seatIndex,
        does: safeInt(chargeResult.afterDoesByUid[uid]),
        roomMode: "dame_friends",
        inviteCode: roomInviteCode,
        stakeDoes: roomStakeDoes,
        stakeHtg: resolveRoomStakeHtg(room),
        rewardAmountDoes: roomRewardAmountDoes,
        rewardAmountHtg: buildRewardAmountHtg(roomStakeDoes, roomRewardAmountDoes),
        ...buildStartedDameRoomTransaction(tx, roomRefDoc, {
          ...room,
          playerUids: nextPlayerUids,
          playerNames: nextPlayerNames,
          seats: nextSeats,
          roomPresenceMs: nextPresence,
          humanCount: nextHumans,
          botCount: 0,
          entryFundingByUid: chargeResult.entryFundingByUid,
          entryFundingCurrencyByUid: nextEntryFundingCurrency,
          waitingDeadlineMs,
        }, { nowMs }),
      };
    }

    tx.update(roomRefDoc, {
      playerUids: nextPlayerUids,
      playerNames: nextPlayerNames,
      seats: nextSeats,
      roomPresenceMs: nextPresence,
      humanCount: nextHumans,
      botCount: 0,
      entryFundingCurrencyByUid: nextEntryFundingCurrency,
      waitingDeadlineMs,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    });
    return {
      ok: true,
      resumed: false,
      charged: false,
      roomId: roomRefDoc.id,
      seatIndex,
      status: "waiting",
      roomMode: "dame_friends",
      inviteCode: roomInviteCode,
      stakeDoes: roomStakeDoes,
      stakeHtg: resolveRoomStakeHtg(room),
      rewardAmountDoes: roomRewardAmountDoes,
      rewardAmountHtg: buildRewardAmountHtg(roomStakeDoes, roomRewardAmountDoes),
      waitingDeadlineMs,
    };
  }).then((result) => {
    if (result?.expired === true) {
      throw makeHttpError(412, "room-expired", "Ce code a expire.");
    }
    return result;
  });
}

async function ensureRoomReadyDame({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }

  const roomRefDoc = dameRoomRef(roomId);
  return db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      throw makeHttpError(404, "room-not-found", "Salle dame introuvable.");
    }
    const room = roomSnap.data() || {};
    const seatIndex = getSeatForUser(room, uid);
    if (seatIndex < 0) {
      throw makeHttpError(403, "not-room-member", "Tu ne fais pas partie de cette salle dame.");
    }

    const status = String(room.status || "");
    if (status !== "waiting") {
      const nowMsStatus = Date.now();
      if (status === "playing") {
        const refundBeforeOpening = shouldRefundDameBeforeOpening(room);
        const playerUidsLive = Array.isArray(room.playerUids) ? room.playerUids.slice(0, 2).map((value) => String(value || "").trim()) : ["", ""];
        const roomPresenceMs = room.roomPresenceMs && typeof room.roomPresenceMs === "object" ? room.roomPresenceMs : {};
        const staleSeat = playerUidsLive.findIndex((playerUid) => {
          if (!playerUid) return false;
          const lastSeenMs = safeSignedInt(roomPresenceMs[playerUid], 0);
          return lastSeenMs > 0 && (nowMsStatus - lastSeenMs) >= DAME_DISCONNECT_GRACE_MS;
        });
        if (staleSeat >= 0) {
          const winnerSeat = refundBeforeOpening ? -1 : (staleSeat ^ 1);
          const winnerUid = winnerSeat >= 0 ? String(playerUidsLive[winnerSeat] || "").trim() : "";
          if (refundBeforeOpening) {
            await refundDameEntriesForNoPlayTimeoutTx(tx, roomRefDoc, room);
          }
          tx.set(roomRefDoc, {
            status: "ended",
            endedReason: refundBeforeOpening ? "timeout_refund" : "disconnect_forfeit",
            endedAt: admin.firestore.FieldValue.serverTimestamp(),
            endedAtMs: nowMsStatus,
            winnerSeat,
            winnerUid,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtMs: nowMsStatus,
          }, { merge: true });
          return {
            ok: true,
            started: false,
            status: "ended",
            endedReason: refundBeforeOpening ? "timeout_refund" : "disconnect_forfeit",
            winnerSeat,
            winnerUid,
            waitingDeadlineMs: safeSignedInt(room.waitingDeadlineMs),
            humanCount: safeInt(room.humanCount),
            botCount: safeInt(room.botCount),
            currentPlayer: safeSignedInt(room.currentPlayer, -1),
            turnDeadlineMs: safeSignedInt(room.turnDeadlineMs),
            turnStartedAtMs: safeSignedInt(room.turnStartedAtMs),
          };
        }
        const turnDeadlineMs = safeSignedInt(room.turnDeadlineMs);
        const currentColor = safeSignedInt(room.currentPlayer, -1);
        if (turnDeadlineMs > 0 && currentColor >= 0 && nowMsStatus >= turnDeadlineMs) {
          const loserSeat = getDameSeatForColor(room, currentColor);
          const refundBeforeOpening = shouldRefundDameBeforeOpening(room);
          const winnerSeat = refundBeforeOpening ? -1 : (loserSeat >= 0 ? (loserSeat ^ 1) : -1);
          const playerUids = Array.isArray(room.playerUids) ? room.playerUids.slice(0, 2).map((value) => String(value || "").trim()) : ["", ""];
          const winnerUid = winnerSeat >= 0 ? String(playerUids[winnerSeat] || "").trim() : "";
          if (refundBeforeOpening) {
            await refundDameEntriesForNoPlayTimeoutTx(tx, roomRefDoc, room);
          }
          tx.set(roomRefDoc, {
            status: "ended",
            endedReason: refundBeforeOpening ? "timeout_refund" : "turn_timeout",
            endedAt: admin.firestore.FieldValue.serverTimestamp(),
            endedAtMs: nowMsStatus,
            winnerSeat,
            winnerUid,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAtMs: nowMsStatus,
          }, { merge: true });
          return {
            ok: true,
            started: false,
            status: "ended",
            endedReason: refundBeforeOpening ? "timeout_refund" : "turn_timeout",
            winnerSeat,
            winnerUid,
            waitingDeadlineMs: safeSignedInt(room.waitingDeadlineMs),
            humanCount: safeInt(room.humanCount),
            botCount: safeInt(room.botCount),
            currentPlayer: safeSignedInt(room.currentPlayer, -1),
            turnDeadlineMs,
            turnStartedAtMs: safeSignedInt(room.turnStartedAtMs),
          };
        }
      }
      return {
        ok: true,
        started: false,
        status,
        waitingDeadlineMs: safeSignedInt(room.waitingDeadlineMs),
        humanCount: safeInt(room.humanCount),
        botCount: safeInt(room.botCount),
        currentPlayer: safeSignedInt(room.currentPlayer, -1),
        turnDeadlineMs: safeSignedInt(room.turnDeadlineMs),
        turnStartedAtMs: safeSignedInt(room.turnStartedAtMs),
      };
    }

    const nowMs = Date.now();
    const humans = Array.isArray(room.playerUids) ? room.playerUids.filter(Boolean).length : safeInt(room.humanCount);
    const waitingDeadlineMs = resolveDameWaitingDeadlineMs(room, nowMs);
    if (safeSignedInt(room.waitingDeadlineMs) !== waitingDeadlineMs) {
      tx.update(roomRefDoc, {
        waitingDeadlineMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      });
    }

    if (humans < 2) {
      if (!isFriendDameRoom(room) && waitingDeadlineMs > 0 && nowMs >= waitingDeadlineMs) {
        tx.set(roomRefDoc, {
          status: "closed",
          endedReason: "expired",
          endedAt: admin.firestore.FieldValue.serverTimestamp(),
          endedAtMs: nowMs,
          waitingDeadlineMs: admin.firestore.FieldValue.delete(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtMs: nowMs,
        }, { merge: true });
        return {
          ok: true,
          started: false,
          expired: true,
          status: "closed",
          waitingDeadlineMs: 0,
          humanCount: humans,
          botCount: 0,
        };
      }
      return {
        ok: true,
        started: false,
        status: "waiting",
        waitingDeadlineMs,
        humanCount: humans,
        botCount: 0,
      };
    }

    let entryFundingByUid = room.entryFundingByUid && typeof room.entryFundingByUid === "object"
      ? { ...room.entryFundingByUid }
      : null;
    let afterDoesForCaller = 0;
    const playerUids = Array.isArray(room.playerUids) ? room.playerUids.slice(0, 2) : ["", ""];
    if (!entryFundingByUid || Object.keys(entryFundingByUid).length < humans) {
      const chargeResult = await chargeRoomEntriesTx(tx, room, playerUids, safeInt(room.entryCostDoes || room.stakeDoes));
      entryFundingByUid = chargeResult.entryFundingByUid;
      afterDoesForCaller = safeInt(chargeResult.afterDoesByUid[uid]);
      tx.set(roomRefDoc, {
        entryFundingByUid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });
    }

    if (!isFriendDameRoom(room)) {
      clearDameMatchmakingPool(tx, dameMatchmakingPoolRef(String(room.stakeConfigId || ""), safeInt(room.entryCostDoes || room.stakeDoes)));
    }
    return {
      does: afterDoesForCaller,
      charged: true,
      ...buildStartedDameRoomTransaction(tx, roomRefDoc, {
        ...room,
        entryFundingByUid,
        humanCount: humans,
        botCount: 0,
        waitingDeadlineMs,
      }, { nowMs }),
    };
  });
}

async function touchRoomPresenceDame({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }

  const roomRefDoc = dameRoomRef(roomId);
  return db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      throw makeHttpError(404, "room-not-found", "Salle dame introuvable.");
    }
    const room = roomSnap.data() || {};
    const seatIndex = getSeatForUser(room, uid);
    if (seatIndex < 0) {
      throw makeHttpError(403, "not-room-member", "Tu ne fais pas partie de cette salle dame.");
    }

    const nowMs = Date.now();
    const status = String(room.status || "").trim().toLowerCase();
    if (status === "playing") {
      const refundBeforeOpening = shouldRefundDameBeforeOpening(room);
      const playerUids = Array.isArray(room.playerUids)
        ? room.playerUids.slice(0, 2).map((value) => String(value || "").trim())
        : ["", ""];
      const roomPresenceMs = room.roomPresenceMs && typeof room.roomPresenceMs === "object"
        ? room.roomPresenceMs
        : {};
      const staleSeat = playerUids.findIndex((playerUid) => {
        if (!playerUid) return false;
        const lastSeenMs = safeSignedInt(roomPresenceMs[playerUid], 0);
        return lastSeenMs > 0 && (nowMs - lastSeenMs) >= DAME_DISCONNECT_GRACE_MS;
      });
      if (staleSeat >= 0) {
        const winnerSeat = refundBeforeOpening ? -1 : (staleSeat ^ 1);
        const winnerUid = winnerSeat >= 0 ? String(playerUids[winnerSeat] || "").trim() : "";
        if (refundBeforeOpening) {
          await refundDameEntriesForNoPlayTimeoutTx(tx, roomRefDoc, room);
        }
        tx.set(roomRefDoc, {
          status: "ended",
          endedReason: refundBeforeOpening ? "timeout_refund" : "disconnect_forfeit",
          endedAt: admin.firestore.FieldValue.serverTimestamp(),
          endedAtMs: nowMs,
          winnerSeat,
          winnerUid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAtMs: nowMs,
        }, { merge: true });
        return {
          ok: true,
          roomId,
          status: "ended",
          endedReason: refundBeforeOpening ? "timeout_refund" : "disconnect_forfeit",
          winnerSeat,
          winnerUid,
          currentPlayer: safeSignedInt(room.currentPlayer, -1),
          humanCount: Array.isArray(room.playerUids) ? room.playerUids.filter(Boolean).length : safeInt(room.humanCount),
          botCount: safeInt(room.botCount),
        };
      }
    }

    const nextPresence = room.roomPresenceMs && typeof room.roomPresenceMs === "object" ? { ...room.roomPresenceMs } : {};
    nextPresence[uid] = nowMs;
    tx.update(roomRefDoc, {
      roomPresenceMs: nextPresence,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    });

    return {
      ok: true,
      roomId,
      status: String(room.status || ""),
      currentPlayer: safeSignedInt(room.currentPlayer, -1),
      humanCount: Array.isArray(room.playerUids) ? room.playerUids.filter(Boolean).length : safeInt(room.humanCount),
      botCount: safeInt(room.botCount),
    };
  });
}

async function submitActionDame({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }

  const fromLine = safeSignedInt(payload?.from?.line, -1);
  const fromColumn = safeSignedInt(payload?.from?.column, -1);
  const toLine = safeSignedInt(payload?.to?.line, -1);
  const toColumn = safeSignedInt(payload?.to?.column, -1);
  const piecePlayer = safeSignedInt(payload.piecePlayer, -1);
  const changeTurn = payload.changeTurn !== false;
  const seatIndexInput = safeSignedInt(payload.seatIndex, -1);
  const clientActionId = sanitizeText(payload.clientActionId || "", 120);

  if (
    fromLine < 0 || fromLine > 7
    || fromColumn < 0 || fromColumn > 7
    || toLine < 0 || toLine > 7
    || toColumn < 0 || toColumn > 7
  ) {
    throw makeHttpError(400, "invalid-coordinates", "Coordonnees de coup invalides.");
  }

  const roomRefDoc = dameRoomRef(roomId);
  return db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      throw makeHttpError(404, "room-not-found", "Salle dame introuvable.");
    }

    const room = roomSnap.data() || {};
    const status = String(room.status || "").trim().toLowerCase();
    if (status !== "playing") {
      throw makeHttpError(412, "room-not-playing", "La partie dame n'est pas en cours.");
    }
    if (clientActionId && String(room.lastClientActionId || "") === clientActionId) {
      return {
        ok: true,
        duplicate: true,
        roomId,
        seq: safeInt(room.lastActionSeq),
        currentPlayer: safeSignedInt(room.currentPlayer, 0),
      };
    }

    const seatIndex = getSeatForUser(room, uid);
    if (seatIndex < 0) {
      throw makeHttpError(403, "not-room-member", "Tu ne fais pas partie de cette salle dame.");
    }
    if (seatIndexInput >= 0 && seatIndexInput !== seatIndex) {
      throw makeHttpError(403, "invalid-seat", "Seat invalide pour ce joueur.");
    }

    const currentPlayer = Number.isFinite(Number(room.currentPlayer))
      ? Math.trunc(Number(room.currentPlayer))
      : -1;
    const redSeatIndex = Number.isFinite(Number(room.startingPlayerSeat)) ? Math.trunc(Number(room.startingPlayerSeat)) : 1;
    const seatColor = seatIndex === redSeatIndex ? 1 : 0;
    if (currentPlayer < 0 || currentPlayer > 1 || currentPlayer !== seatColor) {
      throw makeHttpError(412, "not-your-turn", "Ce n'est pas ton tour.");
    }
    if (piecePlayer >= 0 && piecePlayer !== currentPlayer) {
      throw makeHttpError(412, "invalid-piece", "Piece invalide pour ce tour.");
    }
    const nowMs = Date.now();
    const turnDeadlineMs = safeSignedInt(room.turnDeadlineMs);
    if (turnDeadlineMs > 0 && nowMs >= turnDeadlineMs) {
      const loserSeat = getDameSeatForColor(room, currentPlayer);
      const refundBeforeOpening = shouldRefundDameBeforeOpening(room);
      const winnerSeat = refundBeforeOpening ? -1 : (loserSeat >= 0 ? (loserSeat ^ 1) : -1);
      const playerUids = Array.isArray(room.playerUids) ? room.playerUids.slice(0, 2).map((value) => String(value || "").trim()) : ["", ""];
      const winnerUid = winnerSeat >= 0 ? String(playerUids[winnerSeat] || "").trim() : "";
      if (refundBeforeOpening) {
        await refundDameEntriesForNoPlayTimeoutTx(tx, roomRefDoc, room);
      }
      tx.set(roomRefDoc, {
        status: "ended",
        endedReason: refundBeforeOpening ? "timeout_refund" : "turn_timeout",
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        endedAtMs: nowMs,
        winnerSeat,
        winnerUid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });
      throw makeHttpError(412, "turn-timeout", "Temps ecoule: la partie est terminee.");
    }

    const nextActionSeq = Math.max(1, safeInt(room.nextActionSeq, 0) + 1);
    const actionRef = roomRefDoc.collection("actions").doc(String(nextActionSeq));
    const nextPlayer = changeTurn === true ? (currentPlayer ^ 1) : currentPlayer;
    const nextHalfMoveCount = Math.max(0, safeInt(room.drawHalfMoveCount, 0) + 1);
    const nextMoveCountBySeat = getDameMoveCountBySeat(room);
    nextMoveCountBySeat[seatIndex] = Math.max(0, nextMoveCountBySeat[seatIndex]) + 1;
    const drawByMoveLimit = nextHalfMoveCount >= DAME_DRAW_MAX_HALF_MOVES;

    tx.set(actionRef, {
      seq: nextActionSeq,
      roomId,
      uid,
      seatIndex,
      from: { line: fromLine, column: fromColumn },
      to: { line: toLine, column: toColumn },
      piecePlayer: currentPlayer,
      changeTurn: changeTurn === true,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAtMs: nowMs,
    }, { merge: true });

    tx.set(roomRefDoc, {
      lastActionSeq: nextActionSeq,
      nextActionSeq,
      currentPlayer: nextPlayer,
      ...(changeTurn === true
        ? {
            turnStartedAtMs: nowMs,
            turnDeadlineMs: nowMs + DAME_TURN_LIMIT_MS,
          }
        : {}),
      moveCountBySeat: nextMoveCountBySeat,
      drawHalfMoveCount: nextHalfMoveCount,
      ...(drawByMoveLimit
        ? {
            status: "ended",
            endedReason: "draw_move_limit",
            endedAt: admin.firestore.FieldValue.serverTimestamp(),
            endedAtMs: nowMs,
            winnerSeat: -1,
            winnerUid: "",
          }
        : {}),
      ...(clientActionId ? { lastClientActionId: clientActionId } : {}),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    }, { merge: true });

    return {
      ok: true,
      roomId,
      seq: nextActionSeq,
      currentPlayer: nextPlayer,
      draw: drawByMoveLimit,
      endedReason: drawByMoveLimit ? "draw_move_limit" : "",
      status: drawByMoveLimit ? "ended" : "playing",
      drawHalfMoveCount: nextHalfMoveCount,
      moveCountBySeat: nextMoveCountBySeat,
      turnDeadlineMs: changeTurn === true ? (nowMs + DAME_TURN_LIMIT_MS) : safeSignedInt(room.turnDeadlineMs),
      turnStartedAtMs: changeTurn === true ? nowMs : safeSignedInt(room.turnStartedAtMs),
    };
  });
}

async function finalizeDameMatch({ uid, email, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }
  const endedReason = sanitizeText(payload.endedReason || "gameover", 80) || "gameover";
  const requestedWinnerSeat = safeSignedInt(payload.winnerSeat, -1);
  const roomRefDoc = dameRoomRef(roomId);

  const result = await db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      throw makeHttpError(404, "room-not-found", "Salle dame introuvable.");
    }

    const room = roomSnap.data() || {};
    const seatIndex = getSeatForUser(room, uid);
    if (seatIndex < 0) {
      throw makeHttpError(403, "not-room-member", "Tu ne fais pas partie de cette salle dame.");
    }

    const status = String(room.status || "").trim().toLowerCase();
    const playerUids = Array.isArray(room.playerUids) ? room.playerUids.slice(0, 2).map((value) => String(value || "").trim()) : ["", ""];
    const rewardAmountDoes = safeInt(room.rewardAmountDoes);
    const winnerSeat = requestedWinnerSeat >= 0 && requestedWinnerSeat < 2 ? requestedWinnerSeat : seatIndex;
    const winnerUid = String(playerUids[winnerSeat] || "").trim();

    if (!winnerUid || winnerUid !== uid) {
      throw makeHttpError(403, "winner-only", "Se sel gayan an ki ka finalize pati a.");
    }

    const settlementRef = roomRefDoc.collection("settlements").doc(uid);
    const settlementSnap = await tx.get(settlementRef);
    const settlementData = settlementSnap.exists ? (settlementSnap.data() || {}) : {};
    const alreadyPaid = settlementData.rewardPaid === true;

    let rewardGranted = false;
    let rewardAmountHtg = 0;
    let afterDoes = null;
    let afterApprovedHtgAvailable = null;

    if (!alreadyPaid && rewardAmountDoes > 0) {
      const entryFundingRaw = room.entryFundingByUid && typeof room.entryFundingByUid === "object"
        ? (room.entryFundingByUid[uid] || null)
        : null;
      rewardAmountHtg = resolveRoomRewardHtg(room);
      if (rewardAmountHtg <= 0) {
        throw makeHttpError(412, "invalid-reward", "Gain HTG invalide pour cette salle dame.");
      }
      const winnerWalletRef = walletRef(uid);
      const winnerWalletSnap = await tx.get(winnerWalletRef);
      const winnerWalletData = winnerWalletSnap.exists ? (winnerWalletSnap.data() || {}) : {};
      const walletMutation = applyHtgRewardCredit(winnerWalletData, {
        rewardHtg: rewardAmountHtg,
        rewardEntryFunding: entryFundingRaw,
      });
      const nowMs = Date.now();
      tx.set(winnerWalletRef, {
        ...walletMutation.balancesPatch,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
        lastSeenAtMs: nowMs,
      }, { merge: true });
      afterApprovedHtgAvailable = safeInt(walletMutation.afterApprovedHtgAvailable);
      afterDoes = safeInt(walletMutation.afterDoes);

      tx.set(settlementRef, {
        uid,
        roomId,
        rewardPaid: true,
        rewardAmountDoes,
        rewardAmountHtg: rewardAmountHtg > 0 ? rewardAmountHtg : 0,
        claimedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      rewardGranted = true;
    }

    const nowMs = Date.now();
    if (status !== "ended" && status !== "closed") {
      tx.set(roomRefDoc, {
        status: "ended",
        endedReason,
        endedAt: admin.firestore.FieldValue.serverTimestamp(),
        endedAtMs: nowMs,
        winnerSeat,
        winnerUid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });
    }

    const resultDocId = `${roomId}_${uid}_${nowMs}`;
    tx.set(db.collection(DAME_ROOM_RESULTS_COLLECTION).doc(resultDocId), {
      id: resultDocId,
      roomId,
      status: "ended",
      roomMode: String(room.roomMode || "dame_2p"),
      winnerType: "human",
      winnerSeat,
      winnerUid,
      playerUids,
      entryFundingByUid: room.entryFundingByUid && typeof room.entryFundingByUid === "object"
        ? room.entryFundingByUid
        : {},
      fundingCurrency: normalizeFundingCurrency(room.entryFundingCurrencyByUid?.[uid] || "htg"),
      stakeDoes: safeInt(room.entryCostDoes || room.stakeDoes),
      stakeHtg: resolveRoomStakeHtg(room),
      rewardAmountDoes,
      rewardAmountHtg: resolveRoomRewardHtg(room),
      endedReason,
      endedAtMs: safeSignedInt(room.endedAtMs) > 0 ? safeSignedInt(room.endedAtMs) : nowMs,
      startedAtMs: safeSignedInt(room.startedAtMs),
      archiveVersion: 1,
      archivedAtMs: nowMs,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });

    return {
      ok: true,
      roomId,
      status: status === "ended" || status === "closed" ? status : "ended",
      winnerSeat,
      winnerUid,
      rewardGranted,
      rewardAmountDoes,
      rewardAmountHtg,
      afterDoes,
      afterApprovedHtgAvailable,
      shouldCleanup: !isFriendDameRoom(room) && (status === "ended" || status === "closed" || rewardGranted),
    };
  });

  if (result?.shouldCleanup) {
    await cleanupDameRoom(roomRefDoc).catch(() => null);
  }
  delete result.shouldCleanup;
  return result;
}

async function restartDameAfterDraw({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }

  const roomRefDoc = dameRoomRef(roomId);
  const nowMs = Date.now();
  return db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      throw makeHttpError(404, "room-not-found", "Salle dame introuvable.");
    }
    const room = roomSnap.data() || {};
    const seatIndex = getSeatForUser(room, uid);
    if (seatIndex < 0) {
      throw makeHttpError(403, "not-room-member", "Tu ne fais pas partie de cette salle dame.");
    }

    const status = String(room.status || "").trim().toLowerCase();
    const endedReason = String(room.endedReason || "").trim().toLowerCase();
    const isRefund = endedReason === "timeout_refund" || endedReason === "quit_refund_before_opening";
    const winnerSeat = safeSignedInt(room.winnerSeat, -1);
    const isDraw = !isRefund && endedReason.startsWith("draw");
    if (status !== "ended" || !isDraw) {
      throw makeHttpError(412, "not-draw", "La partie n'est pas dans un etat nul.");
    }

    const players = Array.isArray(room.playerUids) ? room.playerUids.slice(0, 2).map((value) => String(value || "").trim()) : ["", ""];
    if (!players[0] || !players[1]) {
      throw makeHttpError(412, "missing-players", "Les deux joueurs doivent etre presents pour rejouer.");
    }

    const actionsSnap = await tx.get(roomRefDoc.collection("actions"));
    actionsSnap.docs.forEach((docSnap) => tx.delete(docSnap.ref));

    const previousStarter = Number.isFinite(Number(room.startingPlayerSeat))
      ? Math.trunc(Number(room.startingPlayerSeat))
      : crypto.randomInt(0, 2);
    const nextStarter = previousStarter === 0 ? 1 : 0;
    const nextRoundIndex = Math.max(1, safeInt(room.roundIndex, 1) + 1);

    tx.set(roomRefDoc, {
      status: "playing",
      startedAt: admin.firestore.FieldValue.serverTimestamp(),
      startedAtMs: nowMs,
      endedAt: admin.firestore.FieldValue.delete(),
      endedAtMs: 0,
      endedReason: "",
      currentPlayer: 1,
      turnStartedAtMs: nowMs,
      turnDeadlineMs: nowMs + DAME_TURN_LIMIT_MS,
      startingPlayerSeat: nextStarter,
      moveCountBySeat: [0, 0],
      lastActionSeq: 0,
      nextActionSeq: 0,
      drawHalfMoveCount: 0,
      winnerSeat: admin.firestore.FieldValue.delete(),
      winnerUid: admin.firestore.FieldValue.delete(),
      waitingDeadlineMs: admin.firestore.FieldValue.delete(),
      lastClientActionId: admin.firestore.FieldValue.delete(),
      roundIndex: nextRoundIndex,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    }, { merge: true });

    return {
      ok: true,
      roomId,
      status: "playing",
      restarted: true,
      startedAtMs: nowMs,
      currentPlayer: 1,
      startingPlayerSeat: nextStarter,
      drawHalfMoveCount: 0,
      roundIndex: nextRoundIndex,
    };
  });
}

async function requestFriendDameRematch({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }

  const roomRefDoc = dameRoomRef(roomId);
  const nowMs = Date.now();
  return db.runTransaction(async (tx) => {
    const roomSnap = await tx.get(roomRefDoc);
    if (!roomSnap.exists) {
      throw makeHttpError(404, "room-not-found", "Salle dame introuvable.");
    }

    const room = roomSnap.data() || {};
    if (!isFriendDameRoom(room)) {
      throw makeHttpError(412, "invalid-room", "Rejouer sa a mache selman nan salon prive Dame la.");
    }

    const seatIndex = getSeatForUser(room, uid);
    if (seatIndex < 0) {
      throw makeHttpError(403, "not-room-member", "Tu ne fais pas partie de cette salle dame.");
    }

    const status = String(room.status || "").trim().toLowerCase();
    if (status !== "ended") {
      throw makeHttpError(412, "room-not-ended", "Rejouer prive a disponib selman apre pati a fini.");
    }

    const endedReason = String(room.endedReason || "").trim().toLowerCase();
    if (endedReason.startsWith("draw")) {
      throw makeHttpError(412, "draw-restart-only", "Pou yon pati nul, itilize bouton depataj la.");
    }

    const playerUids = Array.isArray(room.playerUids)
      ? room.playerUids.slice(0, 2).map((value) => String(value || "").trim())
      : ["", ""];
    const activePlayers = playerUids.filter(Boolean);
    if (activePlayers.length !== 2) {
      throw makeHttpError(412, "missing-players", "Les deux joueurs doivent etre presents pour rejouer.");
    }

    const winnerUid = String(room.winnerUid || "").trim();
    const isRefund = endedReason === "timeout_refund" || endedReason === "quit_refund_before_opening";
    if (!isRefund && winnerUid) {
      const settlementRef = roomRefDoc.collection("settlements").doc(winnerUid);
      const settlementSnap = await tx.get(settlementRef);
      const settlementData = settlementSnap.exists ? (settlementSnap.data() || {}) : {};
      if (settlementData.rewardPaid !== true) {
        throw makeHttpError(412, "winner-finalize-required", "Gayan an dwe finalize premye pati a anvan revanj la.");
      }
    }

    const roomPresenceMs = room.roomPresenceMs && typeof room.roomPresenceMs === "object"
      ? { ...room.roomPresenceMs }
      : {};
    roomPresenceMs[uid] = nowMs;
    const rematchRequestUids = Array.isArray(room.rematchRequestUids)
      ? room.rematchRequestUids.map((value) => String(value || "").trim()).filter(Boolean)
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
        ok: true,
        roomId,
        status: "ended",
        roomMode: "dame_friends",
        started: false,
        waitingForOpponent: true,
        requestedCount: nextRematchRequestUids.length,
        rematchRequestUids: nextRematchRequestUids,
        stakeDoes: safeInt(room.entryCostDoes || room.stakeDoes),
        stakeHtg: resolveRoomStakeHtg(room),
        inviteCode: String(room.inviteCode || "").trim(),
      };
    }

    const actionsSnap = await tx.get(roomRefDoc.collection("actions"));
    const settlementsSnap = await tx.get(roomRefDoc.collection("settlements"));
    const stakeDoes = safeInt(room.entryCostDoes || room.stakeDoes);
    const nextEntryFundingCurrencyByUid = room.entryFundingCurrencyByUid && typeof room.entryFundingCurrencyByUid === "object"
      ? { ...room.entryFundingCurrencyByUid }
      : {};
    activePlayers.forEach((playerUid) => {
      nextEntryFundingCurrencyByUid[playerUid] = normalizeFundingCurrency(nextEntryFundingCurrencyByUid[playerUid] || "htg");
    });
    const chargeResult = await chargeRoomEntriesTx(tx, {
      ...room,
      entryFundingCurrencyByUid: nextEntryFundingCurrencyByUid,
    }, activePlayers, stakeDoes);
    actionsSnap.docs.forEach((docSnap) => tx.delete(docSnap.ref));
    settlementsSnap.docs.forEach((docSnap) => tx.delete(docSnap.ref));
    tx.set(roomRefDoc, {
      playerUids,
      playerNames: Array.isArray(room.playerNames) ? room.playerNames.slice(0, 2) : ["", ""],
      seats: room.seats && typeof room.seats === "object" ? { ...room.seats } : {},
      roomPresenceMs,
      humanCount: 2,
      botCount: 0,
      entryFundingByUid: chargeResult.entryFundingByUid,
      entryFundingCurrencyByUid: nextEntryFundingCurrencyByUid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    }, { merge: true });

    return {
      ok: true,
      roomId,
      roomMode: "dame_friends",
      inviteCode: String(room.inviteCode || "").trim(),
      stakeDoes,
      stakeHtg: resolveRoomStakeHtg(room),
      rewardAmountDoes: safeInt(room.rewardAmountDoes || buildPrivateDameRewardDoes(stakeDoes)),
      rewardAmountHtg: resolveRoomRewardHtg(room),
      started: true,
      waitingForOpponent: false,
      requestedCount: 2,
      rematchRequestUids: [],
      ...buildStartedDameRoomTransaction(tx, roomRefDoc, {
        ...room,
        playerUids,
        playerNames: Array.isArray(room.playerNames) ? room.playerNames.slice(0, 2) : ["", ""],
        seats: room.seats && typeof room.seats === "object" ? { ...room.seats } : {},
        roomPresenceMs,
        humanCount: 2,
        botCount: 0,
        entryFundingByUid: chargeResult.entryFundingByUid,
        entryFundingCurrencyByUid: nextEntryFundingCurrencyByUid,
      }, { nowMs }),
    };
  });
}

async function leaveRoomDame({ uid, payload = {} }) {
  const roomId = String(payload.roomId || "").trim();
  if (!roomId) {
    throw makeHttpError(400, "missing-room-id", "roomId requis.");
  }
  return forceRemoveUserFromDameRoom(roomId, uid);
}

async function recordDameMatchResult({ uid, payload = {} }) {
  const matchId = sanitizeText(payload.matchId || "", 120) || `dame_${uid}_${Date.now()}`;
  const resultDocId = `${uid}_${matchId}`;
  const winnerSeat = clamp(safeSignedInt(payload.winnerSeat, -1), -1, 1);
  const winnerTypeRaw = String(payload.winnerType || "").trim().toLowerCase();
  const winnerType = winnerTypeRaw === "bot" ? "bot" : "human";
  const stakeDoes = safeInt(payload.stakeDoes);
  const startedAtMs = safeSignedInt(payload.startedAtMs, 0);
  const endedAtMs = safeSignedInt(payload.endedAtMs, Date.now()) || Date.now();
  const endedReason = String(sanitizeText(payload.endedReason || "match_end", 80) || "match_end").trim().toLowerCase() || "match_end";
  const isRefundResult = endedReason === "timeout_refund" || endedReason === "quit_refund_before_opening";
  const isDrawResult = !isRefundResult && endedReason.startsWith("draw");
  const isNeutralResult = isRefundResult || isDrawResult;
  const roomMode = sanitizeText(payload.roomMode || "dame_local", 40) || "dame_local";
  const roomId = sanitizeText(payload.roomId || "", 120);
  const fundingCurrency = normalizeFundingCurrency(payload.fundingCurrency || payload.currency || "htg");
  const stakeHtg = fundingCurrency === "htg" ? buildStakeAmountHtg(stakeDoes) : 0;
  let playerUids = Array.isArray(payload.playerUids)
    ? payload.playerUids.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 2)
    : [];
  let winnerUid = sanitizeText(payload.winnerUid || "", 160);
  let rewardAmountDoes = safeInt(payload.rewardAmountDoes || payload.rewardDoes);
  let rewardAmountHtg = safeInt(payload.rewardAmountHtg);
  let humanCount = Math.max(0, safeInt(payload.humanCount, playerUids.length || 2));
  let botCount = Math.max(0, safeInt(payload.botCount, winnerType === "bot" ? 1 : 0));

  if (roomId) {
    try {
      const roomSnap = await dameRoomRef(roomId).get();
      if (roomSnap.exists) {
        const roomData = roomSnap.data() || {};
        const roomPlayerUids = Array.isArray(roomData.playerUids)
          ? roomData.playerUids.map((value) => String(value || "").trim()).filter(Boolean).slice(0, 2)
          : [];
        if (roomPlayerUids.length) {
          playerUids = roomPlayerUids;
        }
        const explicitWinnerUid = String(roomData.winnerUid || "").trim();
        if (explicitWinnerUid && !isNeutralResult) {
          winnerUid = explicitWinnerUid;
        } else if (!winnerUid && winnerSeat >= 0 && winnerSeat < playerUids.length) {
          winnerUid = String(playerUids[winnerSeat] || "").trim();
        }
        rewardAmountDoes = isNeutralResult
          ? 0
          : Math.max(0, safeInt(
            roomData.rewardAmountDoes
            || roomData.rewardDoes
            || rewardAmountDoes
          ));
        rewardAmountHtg = isNeutralResult
          ? 0
          : Math.max(0, safeInt(
            roomData.rewardAmountHtg
            || rewardAmountHtg
            || buildRewardAmountHtg(safeInt(roomData.entryCostDoes || roomData.stakeDoes || stakeDoes), rewardAmountDoes)
          ));
        humanCount = Math.max(0, safeInt(roomData.humanCount, playerUids.length || humanCount || 2));
        botCount = Math.max(0, safeInt(roomData.botCount, botCount));
      }
    } catch (_) {
    }
  }

  if (isNeutralResult) {
    winnerUid = "";
    rewardAmountDoes = 0;
    rewardAmountHtg = 0;
  }
  if (!isNeutralResult && !winnerUid && winnerSeat >= 0 && winnerSeat < playerUids.length) {
    winnerUid = String(playerUids[winnerSeat] || "").trim();
  }
  if (!isNeutralResult && rewardAmountHtg <= 0 && rewardAmountDoes > 0) {
    rewardAmountHtg = buildRewardAmountHtg(stakeDoes, rewardAmountDoes);
  }

  await db.collection(DAME_ROOM_RESULTS_COLLECTION).doc(resultDocId).set({
    id: resultDocId,
    matchId,
    roomId,
    uid,
    status: "ended",
    roomMode,
    winnerType,
    winnerSeat,
    winnerUid,
    playerUids,
    humanCount,
    botCount,
    entryFundingByUid: payload.entryFundingByUid && typeof payload.entryFundingByUid === "object"
      ? payload.entryFundingByUid
      : {},
    fundingCurrency,
    stakeDoes,
    stakeHtg,
    entryCostDoes: stakeDoes,
    rewardAmountDoes,
    rewardAmountHtg,
    startedAtMs,
    endedAtMs,
    endedReason,
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
  createFriendDameRoom,
  ensureRoomReadyDame,
  finalizeDameMatch,
  joinFriendDameRoomByCode,
  joinMatchmakingDame,
  leaveRoomDame,
  recordDameMatchResult,
  requestFriendDameRematch,
  restartDameAfterDraw,
  resumeFriendDameRoom,
  submitActionDame,
  touchRoomPresenceDame,
};
