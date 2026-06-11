import { auth, onAuthStateChanged } from "./firebase-init.js";
import {
  getDuelV2RoomStateSecure,
  joinMatchmakingDuelV2Secure,
  leaveRoomDuelV2Secure,
  touchRoomPresenceDuelV2Secure,
} from "./secure-functions.js";

const searchBtn = document.getElementById("dominoDuelSearchBtn");
const backBtn = document.getElementById("dominoDuelBackBtn");
const statusEl = document.getElementById("dominoDuelStatus");
const roomIdEl = document.getElementById("dominoDuelRoomId");
const roomStatusEl = document.getElementById("dominoDuelRoomStatus");
const seatEl = document.getElementById("dominoDuelSeat");
const playersEl = document.getElementById("dominoDuelPlayers");

let currentUser = null;
let currentRoomId = "";
let roomPollTimer = null;
let presenceTimer = null;
let busy = false;

function setStatus(message) {
  if (statusEl) statusEl.textContent = String(message || "");
}

function renderRoomState(data = null) {
  roomIdEl.textContent = data?.roomId || "--";
  roomStatusEl.textContent = data?.status || "--";
  seatEl.textContent = typeof data?.seatIndex === "number" && data.seatIndex >= 0 ? `Jwe ${data.seatIndex + 1}` : "--";
  const playerNames = Array.isArray(data?.playerNames) ? data.playerNames.filter(Boolean) : [];
  playersEl.textContent = playerNames.length ? playerNames.join(" / ") : "--";
}

function stopRoomLoops() {
  if (roomPollTimer) {
    window.clearInterval(roomPollTimer);
    roomPollTimer = null;
  }
  if (presenceTimer) {
    window.clearInterval(presenceTimer);
    presenceTimer = null;
  }
}

async function refreshRoomState() {
  if (!currentRoomId || !currentUser) return;
  try {
    const state = await getDuelV2RoomStateSecure({ roomId: currentRoomId });
    renderRoomState(state);
    if (state?.status === "waiting") {
      setStatus("N ap tann yon lot jw? antre nan sal la.");
    } else if (state?.status === "playing") {
      setStatus("2 jw? yo konekte. Mot? domino a se pwochen etap la.");
    } else if (state?.status === "ended") {
      setStatus("Match la fini sou room-cycle la. N ap branche r?s mot? a apre sa.");
      stopRoomLoops();
    }
  } catch (error) {
    setStatus(error?.message || "Nou pa rive li eta Duel V2 la.");
  }
}

async function touchPresence() {
  if (!currentRoomId || !currentUser) return;
  try {
    await touchRoomPresenceDuelV2Secure({ roomId: currentRoomId });
  } catch (error) {
    setStatus(error?.message || "Nou pa rive mete prezans Duel V2 la ajou.");
  }
}

function startRoomLoops() {
  stopRoomLoops();
  void refreshRoomState();
  void touchPresence();
  roomPollTimer = window.setInterval(() => {
    void refreshRoomState();
  }, 2500);
  presenceTimer = window.setInterval(() => {
    void touchPresence();
  }, 15000);
}

async function beginSearch() {
  if (!currentUser || busy) return;
  busy = true;
  searchBtn.disabled = true;
  setStatus("N ap ch?che yon adv?s? pou Duel V2 la...");
  try {
    const result = await joinMatchmakingDuelV2Secure({ stakeHtg: 25 });
    currentRoomId = String(result?.roomId || "").trim();
    renderRoomState(result);
    if (result?.status === "waiting") {
      setStatus("Sal la kreye. N ap tann yon adv?s? rantre.");
    } else if (result?.status === "playing") {
      setStatus("Duel V2 la louvri. Pwochen etap la se mot? domino a.");
    }
    startRoomLoops();
  } catch (error) {
    setStatus(error?.message || "Nou pa rive antre nan Duel V2 la.");
  } finally {
    busy = false;
    searchBtn.disabled = false;
  }
}

if (searchBtn) {
  searchBtn.addEventListener("click", () => {
    void beginSearch();
  });
}

if (backBtn) {
  backBtn.addEventListener("click", async () => {
    stopRoomLoops();
    if (currentRoomId && currentUser) {
      try {
        await leaveRoomDuelV2Secure({ roomId: currentRoomId });
      } catch (_) {}
    }
    window.location.href = "./index.html?view=public";
  });
}

window.addEventListener("pagehide", () => {
  stopRoomLoops();
  if (currentRoomId && currentUser && navigator.onLine !== false) {
    leaveRoomDuelV2Secure({ roomId: currentRoomId }).catch(() => null);
  }
});

onAuthStateChanged(auth, (user) => {
  currentUser = user || null;
  if (!currentUser) {
    stopRoomLoops();
    setStatus("Ou dwe konekte pou itilize Duel V2 la.");
    renderRoomState(null);
    return;
  }
  setStatus("Ou konekte. Ou ka ch?che yon adv?s? kounye a.");
});
