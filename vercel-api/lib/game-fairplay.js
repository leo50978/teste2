const { admin, db } = require("./firebase-admin");
const { makeHttpError } = require("./http");
const { walletRef } = require("./player-wallet");
const { applyHtgRewardCredit, applyHtgStakeDebit } = require("./wallet-htg");
const { safeInt, safeSignedInt, sanitizeText } = require("./safe");

const FAIRPLAY_REQUESTS_COLLECTION = "fairPlayRequests";
const FAIRPLAY_WINDOW_MS = 60 * 60 * 1000;

const RESULT_COLLECTIONS = Object.freeze({
  roomResults: "roomResults",
  duelRoomResults: "duelRoomResults",
  duelRoomsV2: "duelRoomsV2",
  morpionRoomResults: "morpionRoomResults",
  dameRoomResults: "dameRoomResults",
  chessRoomResults: "chessRoomResults",
  ludoMatchResults: "ludoMatchResults",
});

function normalizeSourceKey(value = "") {
  const sourceKey = sanitizeText(value || "", 80);
  return RESULT_COLLECTIONS[sourceKey] ? sourceKey : "";
}

function getResultRef(sourceKey = "", resultId = "") {
  const normalizedSource = normalizeSourceKey(sourceKey);
  const safeResultId = sanitizeText(resultId || "", 180);
  if (!normalizedSource || !safeResultId) {
    throw makeHttpError(400, "fairplay-invalid-result", "Match fairplay invalide.");
  }
  return db.collection(RESULT_COLLECTIONS[normalizedSource]).doc(safeResultId);
}

function buildFairplayRequestId(sourceKey = "", resultId = "") {
  const normalizedSource = normalizeSourceKey(sourceKey);
  const safeResultId = sanitizeText(resultId || "", 180).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${normalizedSource}_${safeResultId}`.slice(0, 240);
}

function isNeutralEndedReason(endedReason = "") {
  const reason = String(endedReason || "").trim().toLowerCase();
  return reason === "timeout_refund"
    || reason === "quit_refund_before_opening"
    || reason === "no_play_refund"
    || reason.startsWith("draw");
}

function resolvePlayerUids(result = {}) {
  return Array.isArray(result.playerUids)
    ? result.playerUids.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 4)
    : [];
}

function resolveWinnerUid(result = {}) {
  const explicit = String(result.winnerUid || "").trim();
  if (explicit) return explicit;
  const playerUids = resolvePlayerUids(result);
  const winnerSeat = safeSignedInt(result.winnerSeat, -1);
  return winnerSeat >= 0 && winnerSeat < playerUids.length ? String(playerUids[winnerSeat] || "").trim() : "";
}

function resolveLoserUid(result = {}, winnerUid = "") {
  const safeWinnerUid = String(winnerUid || "").trim();
  return resolvePlayerUids(result).find((uid) => uid && uid !== safeWinnerUid) || "";
}

function isHumanVsHumanResult(sourceKey = "", result = {}) {
  const playerUids = resolvePlayerUids(result);
  if (playerUids.length !== 2) return false;
  if (safeInt(result.botCount) > 0) return false;
  const roomMode = String(result.roomMode || result.gameMode || result.mode || "").trim().toLowerCase();
  if (roomMode.includes("bot") || roomMode.includes("ai")) return false;
  if (sourceKey === "ludoMatchResults") return roomMode === "ludo_friends" || roomMode.includes("friend");
  if (sourceKey === "duelRoomResults" || sourceKey === "duelRoomsV2" || sourceKey === "roomResults") {
    return roomMode.includes("friend")
      || roomMode.includes("duel")
      || roomMode.includes("morpion")
      || roomMode.includes("dame")
      || roomMode.includes("chess")
      || roomMode.includes("echec");
  }
  return true;
}

function readStakeHtg(result = {}) {
  return Math.max(0, safeInt(result.stakeHtg || result.wageredHtg));
}

function readRewardHtg(result = {}) {
  return Math.max(0, safeInt(result.rewardAmountHtg || result.rewardExpectedHtg || result.wonHtg));
}

function getEntryFundingForUid(result = {}, uid = "") {
  const safeUid = String(uid || "").trim();
  const byUid = result.entryFundingByUid && typeof result.entryFundingByUid === "object"
    ? result.entryFundingByUid
    : {};
  if (safeUid && byUid[safeUid] && typeof byUid[safeUid] === "object") return byUid[safeUid];
  return null;
}

function assertFairplayEligible({
  sourceKey = "",
  result = {},
  requesterUid = "",
  nowMs = Date.now(),
} = {}) {
  const status = String(result.status || "").trim().toLowerCase();
  const endedAtMs = safeSignedInt(result.endedAtMs || result.endedAt || result.updatedAtMs);
  if (status !== "ended" || endedAtMs <= 0) {
    throw makeHttpError(409, "fairplay-match-not-ended", "Fairplay disponib selman apre match la fini.");
  }
  if (nowMs - endedAtMs > FAIRPLAY_WINDOW_MS) {
    throw makeHttpError(409, "fairplay-window-expired", "Delè fairplay la fini. Ou gen 1h apre match la.");
  }
  if (isNeutralEndedReason(result.endedReason || result.endReason)) {
    throw makeHttpError(409, "fairplay-neutral-match", "Match sa a te deja nul oswa rembourse.");
  }
  if (!isHumanVsHumanResult(sourceKey, result)) {
    throw makeHttpError(409, "fairplay-human-only", "Fairplay disponib selman pou match ant 2 moun.");
  }
  const winnerUid = resolveWinnerUid(result);
  const loserUid = resolveLoserUid(result, winnerUid);
  if (!winnerUid || !loserUid) {
    throw makeHttpError(409, "fairplay-missing-players", "Nou pa ka idantifye gagnan ak perdant match sa a.");
  }
  if (String(requesterUid || "").trim() !== loserUid) {
    throw makeHttpError(403, "fairplay-loser-only", "Se sel moun ki pedi a ki ka mande fairplay.");
  }
  const currentStatus = String(result?.fairplay?.status || "").trim().toLowerCase();
  if (currentStatus) {
    throw makeHttpError(409, "fairplay-already-exists", "Match sa a deja gen yon demann fairplay.");
  }
  const stakeHtg = readStakeHtg(result);
  const rewardHtg = readRewardHtg(result);
  const winnerProfitHtg = Math.max(0, rewardHtg - stakeHtg);
  if (stakeHtg <= 0 || winnerProfitHtg <= 0) {
    throw makeHttpError(409, "fairplay-invalid-amounts", "Montan match sa a pa pèmèt fairplay otomatik.");
  }
  return {
    endedAtMs,
    winnerUid,
    loserUid,
    stakeHtg,
    rewardHtg,
    winnerProfitHtg,
  };
}

async function requestGameFairplay({ uid = "", payload = {} } = {}) {
  const requesterUid = sanitizeText(uid || "", 160);
  const sourceKey = normalizeSourceKey(payload.sourceKey || payload.source || "");
  const resultId = sanitizeText(payload.resultId || payload.id || "", 180);
  const requestId = buildFairplayRequestId(sourceKey, resultId);
  const resultRef = getResultRef(sourceKey, resultId);
  const requestRef = db.collection(FAIRPLAY_REQUESTS_COLLECTION).doc(requestId);

  return db.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const [resultSnap, requestSnap] = await Promise.all([tx.get(resultRef), tx.get(requestRef)]);
    if (!resultSnap.exists) {
      throw makeHttpError(404, "fairplay-result-not-found", "Match sa a pa egziste ankò.");
    }
    if (requestSnap.exists) {
      throw makeHttpError(409, "fairplay-already-exists", "Match sa a deja gen yon demann fairplay.");
    }

    const result = resultSnap.data() || {};
    const eligibility = assertFairplayEligible({ sourceKey, result, requesterUid, nowMs });
    const fairplay = {
      status: "pending",
      requestId,
      requesterUid,
      approverUid: eligibility.winnerUid,
      loserUid: eligibility.loserUid,
      winnerUid: eligibility.winnerUid,
      loserRefundHtg: eligibility.stakeHtg,
      winnerProfitHtg: eligibility.winnerProfitHtg,
      requestedAtMs: nowMs,
      expiresAtMs: eligibility.endedAtMs + FAIRPLAY_WINDOW_MS,
    };

    tx.set(requestRef, {
      id: requestId,
      sourceKey,
      resultId,
      resultPath: resultRef.path,
      status: "pending",
      roomId: String(result.roomId || result.matchId || resultId).trim(),
      gameMode: String(result.roomMode || result.gameMode || "").trim(),
      playerUids: resolvePlayerUids(result),
      stakeHtg: eligibility.stakeHtg,
      rewardHtg: eligibility.rewardHtg,
      loserRefundHtg: eligibility.stakeHtg,
      winnerProfitHtg: eligibility.winnerProfitHtg,
      requesterUid,
      approverUid: eligibility.winnerUid,
      loserUid: eligibility.loserUid,
      winnerUid: eligibility.winnerUid,
      endedAtMs: eligibility.endedAtMs,
      requestedAtMs: nowMs,
      expiresAtMs: eligibility.endedAtMs + FAIRPLAY_WINDOW_MS,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    }, { merge: true });

    tx.set(resultRef, {
      fairplay,
      fairplayStatus: "pending",
      fairplayRequestId: requestId,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    }, { merge: true });

    return { ok: true, requestId, status: "pending", fairplay };
  });
}

async function respondGameFairplay({ uid = "", payload = {} } = {}) {
  const approverUid = sanitizeText(uid || "", 160);
  const sourceKey = normalizeSourceKey(payload.sourceKey || payload.source || "");
  const resultId = sanitizeText(payload.resultId || payload.id || "", 180);
  const requestId = sanitizeText(payload.requestId || buildFairplayRequestId(sourceKey, resultId), 240);
  const decision = String(payload.decision || "").trim().toLowerCase() === "accept" ? "accept" : "reject";
  const requestRef = db.collection(FAIRPLAY_REQUESTS_COLLECTION).doc(requestId);

  return db.runTransaction(async (tx) => {
    const nowMs = Date.now();
    const requestSnap = await tx.get(requestRef);
    if (!requestSnap.exists) {
      throw makeHttpError(404, "fairplay-request-not-found", "Demann fairplay sa a pa egziste.");
    }
    const request = requestSnap.data() || {};
    const requestStatus = String(request.status || "").trim().toLowerCase();
    if (requestStatus !== "pending") {
      throw makeHttpError(409, "fairplay-not-pending", "Demann fairplay sa a deja trete.");
    }
    if (String(request.approverUid || "").trim() !== approverUid) {
      throw makeHttpError(403, "fairplay-approver-only", "Se gagnan match la selman ki ka reponn fairplay.");
    }
    const expiresAtMs = safeSignedInt(request.expiresAtMs);
    if (expiresAtMs > 0 && nowMs > expiresAtMs) {
      tx.set(requestRef, {
        status: "expired",
        expiredAtMs: nowMs,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });
      throw makeHttpError(409, "fairplay-window-expired", "Delè fairplay la fini.");
    }

    const resultRef = getResultRef(request.sourceKey, request.resultId);
    const resultSnap = await tx.get(resultRef);
    if (!resultSnap.exists) {
      throw makeHttpError(404, "fairplay-result-not-found", "Match fairplay la pa egziste ankò.");
    }
    const result = resultSnap.data() || {};
    const loserUid = String(request.loserUid || "").trim();
    const winnerUid = String(request.winnerUid || "").trim();
    const loserRefundHtg = safeInt(request.loserRefundHtg);
    const winnerProfitHtg = safeInt(request.winnerProfitHtg);

    if (decision !== "accept") {
      const fairplay = {
        ...(result.fairplay && typeof result.fairplay === "object" ? result.fairplay : {}),
        status: "rejected",
        rejectedAtMs: nowMs,
        rejectedByUid: approverUid,
      };
      tx.set(requestRef, {
        status: "rejected",
        rejectedAtMs: nowMs,
        rejectedByUid: approverUid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });
      tx.set(resultRef, {
        fairplay,
        fairplayStatus: "rejected",
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAtMs: nowMs,
      }, { merge: true });
      return { ok: true, status: "rejected", requestId };
    }

    if (!loserUid || !winnerUid || loserRefundHtg <= 0 || winnerProfitHtg <= 0) {
      throw makeHttpError(409, "fairplay-invalid-amounts", "Montan fairplay sa a pa valab.");
    }

    const [winnerWalletSnap, loserWalletSnap] = await Promise.all([
      tx.get(walletRef(winnerUid)),
      tx.get(walletRef(loserUid)),
    ]);
    const winnerWallet = winnerWalletSnap.exists ? (winnerWalletSnap.data() || {}) : {};
    const loserWallet = loserWalletSnap.exists ? (loserWalletSnap.data() || {}) : {};
    const winnerDebit = applyHtgStakeDebit(winnerWallet, { stakeHtg: winnerProfitHtg });
    const loserCredit = applyHtgRewardCredit(loserWallet, {
      rewardHtg: loserRefundHtg,
      rewardEntryFunding: getEntryFundingForUid(result, loserUid),
    });

    const fairplay = {
      ...(result.fairplay && typeof result.fairplay === "object" ? result.fairplay : {}),
      status: "accepted",
      acceptedAtMs: nowMs,
      acceptedByUid: approverUid,
      loserRefundedHtg: loserRefundHtg,
      winnerProfitDebitedHtg: winnerProfitHtg,
    };

    tx.set(walletRef(winnerUid), {
      ...winnerDebit.balancesPatch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAtMs: nowMs,
    }, { merge: true });
    tx.set(walletRef(loserUid), {
      ...loserCredit.balancesPatch,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAtMs: nowMs,
    }, { merge: true });
    tx.set(requestRef, {
      status: "accepted",
      acceptedAtMs: nowMs,
      acceptedByUid: approverUid,
      loserRefundedHtg: loserRefundHtg,
      winnerProfitDebitedHtg: winnerProfitHtg,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    }, { merge: true });
    tx.set(resultRef, {
      fairplay,
      fairplayStatus: "accepted",
      fairplayAcceptedAtMs: nowMs,
      fairplayLoserRefundedHtg: loserRefundHtg,
      fairplayWinnerProfitDebitedHtg: winnerProfitHtg,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
    }, { merge: true });

    return {
      ok: true,
      status: "accepted",
      requestId,
      loserRefundedHtg: loserRefundHtg,
      winnerProfitDebitedHtg: winnerProfitHtg,
    };
  });
}

module.exports = {
  FAIRPLAY_WINDOW_MS,
  requestGameFairplay,
  respondGameFairplay,
};
