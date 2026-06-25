import { auth, onAuthStateChanged } from "../firebase-init.js";
import { ensureXchangeState, getXchangeState } from "../xchange.js";
import {
  getChessRoomStateSecure,
  joinFriendChessRoomByCodeSecure,
  joinMatchmakingChessSecure,
  leaveRoomChessSecure,
  resumeFriendChessRoomSecure,
  submitActionChessSecure,
  touchRoomPresenceChessSecure,
} from "../secure-functions.js?v=20260625-morpion-firebase1";

(function () {
  const params = new URLSearchParams(window.location.search);
  const PUBLIC_STAKE_HTG = Math.max(25, Number.parseInt(params.get("stakeHtg") || "25", 10) || 25);
  const ROOM_MODE = String(params.get("roomMode") || "chess_public_bot").trim().toLowerCase();
  const BOT_LEVEL = String(params.get("botDifficulty") || "fo").trim().toLowerCase();
  const FRIEND_ACTION = String(params.get("friendAction") || "").trim().toLowerCase();
  const INVITE_CODE = String(params.get("inviteCode") || "").trim().toUpperCase();
  const FRIEND_ROOM_ID = String(params.get("friendChessRoomId") || params.get("roomId") || "").trim();
  const NO_PLAYER_PROBABILITY = 0.28;
  const PUBLIC_WAIT_MS = 1800;
  const PRESENCE_HEARTBEAT_MS = 10000;
  const PRIVATE_ROOM_POLL_MS = 2200;
  const CHESS_TURN_LIMIT_MS = 90 * 1000;
  const OPPONENT_NAMES = [
    "march56", "dexter5", "junior44", "leon73", "mika21", "toto88", "fega22", "samy14", "jude40", "nixon77",
    "alex31", "brice28", "tiyo90", "rolo19", "pipo34", "dany58", "manno46", "evens29", "franco61", "lucky35",
    "benny20", "roby15", "tony62", "jerry24", "johan55", "cesar38", "smith10", "wilno63", "nando41", "mario27",
    "djo64", "kerv31", "joni48", "rudy16", "stony42", "nelio57", "polo13", "basta70", "faby26", "kendy60",
    "santo52", "mitch39", "kings11", "rony47", "jeff59", "maki22", "dani71", "sacha30", "rich12", "tibo50",
    "evan36", "jimy45", "momo17", "teddy53", "mikael32", "dylan69", "fritz18", "sam46", "feno54", "lester23",
    "bobby67", "kenny21", "niko33", "jonas65", "hertz25", "papy72", "mendy14", "cyril51", "rocco37", "nash49",
    "tiger66", "vlad20", "yves43", "willy28", "lino56", "gabi24", "marv40", "jepy34", "mason63", "renel19",
    "sven58", "ricky31", "elvis44", "sandy27", "tino68", "bryan22", "denis47", "fafa35", "luis52", "paul18",
    "jules60", "matho26", "steve71", "ralph15", "cory42", "jimy09", "bruno57", "herby30", "kiko48", "nelo13"
  ];

  const overlayEl = document.getElementById("kobposhChessSearchOverlay");
  const overlayTitleEl = document.getElementById("kobposhChessOverlayTitle");
  const overlayTextEl = document.getElementById("kobposhChessOverlayText");
  const overlayBadgeEl = document.getElementById("kobposhChessOverlayBadge");
  const retryBtn = document.getElementById("kobposhChessRetryBtn");
  const homeBtn = document.getElementById("kobposhChessHomeBtn");
  const startBtn = document.getElementById("kobposhChessStartBtn");
  const restartBtn = document.getElementById("kobposhChessRestartBtn");
  const backBtn = document.getElementById("kobposhChessBackBtn");
  const replayBtn = document.getElementById("kobposhChessReplayBtn");
  const closeInfoBtn = document.getElementById("kobposhChessCloseInfoBtn");
  const modeBadgeEl = document.getElementById("kobposhChessModeBadge");
  const stakeBadgeEl = document.getElementById("kobposhChessStakeBadge");
  const botBadgeEl = document.getElementById("kobposhChessBotBadge");
  const roomCodeBadgeEl = document.getElementById("kobposhChessRoomCodeBadge");
  const opponentNameEl = document.getElementById("kobposhChessOpponentName");
  const opponentMetaEl = document.getElementById("kobposhChessOpponentMeta");
  const statusTextEl = document.getElementById("kobposhChessStatusText");
  const turnTimerEl = document.getElementById("kobposhChessTurnTimer");
  const balanceBadgeEl = document.getElementById("kobposhChessBalanceBadge");
  const youMetaEl = document.getElementById("kobposhChessYouMeta");
  const controlCopyEl = document.getElementById("kobposhChessControlCopy");

  let currentLaunchTimer = 0;
  let activeRoomId = "";
  let activeOpponentName = "";
  let activeBotLevel = BOT_LEVEL === "weak" ? "weak" : "fo";
  let activeRoomEnded = false;
  let activeRoomFinalized = false;
  let activeSeatIndex = 0;
  let activeMoveHistoryLength = 0;
  let presenceTimer = 0;
  let roomStateTimer = 0;
  let turnTimer = 0;
  let activeTurnDeadlineMs = 0;
  let activeTurnSeat = -1;
  let activeGameStatus = "";
  let lastObservedTurn = "";
  let timeoutResolving = false;
  let checkmateObserverAttached = false;
  let moveBridgeAttached = false;
  let bootstrapStarted = false;
  let privateGameStarted = false;
  let suppressMoveSync = false;
  let pendingMovePromise = Promise.resolve();
  const FRIEND_ROOM_STORAGE_KEY = "kobposh_chess_friend_room_v1";

  function delay(ms = 0) {
    return new Promise((resolve) => window.setTimeout(resolve, Math.max(0, Number(ms) || 0)));
  }

  function waitForCurrentUser(timeoutMs = 12000) {
    if (auth.currentUser) return Promise.resolve(auth.currentUser);
    return new Promise((resolve) => {
      let settled = false;
      const timer = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        unsubscribe();
        resolve(auth.currentUser || null);
      }, timeoutMs);
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (settled || !user) return;
        settled = true;
        window.clearTimeout(timer);
        unsubscribe();
        resolve(user);
      }, () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        unsubscribe();
        resolve(auth.currentUser || null);
      });
    });
  }

  function clearPresenceHeartbeat() {
    if (presenceTimer) {
      window.clearInterval(presenceTimer);
      presenceTimer = 0;
    }
  }

  function clearRoomStatePolling() {
    if (roomStateTimer) {
      window.clearInterval(roomStateTimer);
      roomStateTimer = 0;
    }
  }

  function queueMoveSync(task) {
    pendingMovePromise = pendingMovePromise.catch(() => null).then(() => task()).catch(() => null);
    return pendingMovePromise;
  }

  function persistFriendRoomState() {
    if (ROOM_MODE !== "chess_friends") return;
    try {
      if (!activeRoomId || activeRoomEnded) {
        window.localStorage.removeItem(FRIEND_ROOM_STORAGE_KEY);
        return;
      }
      window.localStorage.setItem(FRIEND_ROOM_STORAGE_KEY, JSON.stringify({
        roomId: activeRoomId,
        inviteCode: INVITE_CODE,
        stakeHtg: PUBLIC_STAKE_HTG,
        savedAtMs: Date.now(),
      }));
    } catch (_) {
    }
  }

  function readPersistedFriendRoomState() {
    try {
      const raw = window.localStorage.getItem(FRIEND_ROOM_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      const roomId = String(parsed.roomId || "").trim();
      if (!roomId) return null;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  function clearPersistedFriendRoomState() {
    try {
      window.localStorage.removeItem(FRIEND_ROOM_STORAGE_KEY);
    } catch (_) {
    }
  }

  function closeOverlay() {
    overlayEl?.classList.remove("is-open");
    if (overlayEl) overlayEl.setAttribute("aria-hidden", "true");
  }

  function openOverlay({ badge = "Match", title = "", text = "", showRetry = false } = {}) {
    if (overlayBadgeEl) overlayBadgeEl.textContent = badge;
    if (overlayTitleEl) overlayTitleEl.textContent = title;
    if (overlayTextEl) overlayTextEl.textContent = text;
    if (retryBtn) retryBtn.style.display = showRetry ? "" : "none";
    if (overlayEl) {
      overlayEl.classList.add("is-open");
      overlayEl.setAttribute("aria-hidden", "false");
    }
  }

  function chooseOpponentName() {
    return OPPONENT_NAMES[Math.floor(Math.random() * OPPONENT_NAMES.length)] || "march56";
  }

  async function waitForChessEngineReady(timeoutMs = 15000) {
    const deadline = Date.now() + Math.max(1000, Number(timeoutMs) || 15000);
    while (Date.now() < deadline) {
      const hasBoard = !!document.querySelector(".board");
      const hasMove = typeof window.move === "function";
      const hasPlay = typeof window.play === "function";
      const hasSelectAi = typeof window.selectai === "function";
      const hasSelectPlayer = typeof window.selectplayer === "function";
      const hasReset = typeof window.generateInitialPosition === "function";
      if (hasBoard && hasMove && hasPlay && hasSelectAi && hasSelectPlayer && hasReset) {
        return true;
      }
      await delay(120);
    }
    return false;
  }

  function updateStatus(text = "") {
    if (statusTextEl) statusTextEl.textContent = text;
  }

  function formatHtg(amount) {
    return `${Math.max(0, Math.trunc(Number(amount) || 0))} HTG`;
  }

  async function refreshWallet() {
    if (!balanceBadgeEl) return;
    const user = auth.currentUser || await waitForCurrentUser(4000);
    const uid = String(user?.uid || "").trim();
    if (!uid) {
      balanceBadgeEl.textContent = "HTG: --";
      return;
    }
    try {
      await ensureXchangeState(uid);
      const baseBalance = window.__userBaseBalance || window.__userBalance || 0;
      const state = getXchangeState(baseBalance, uid);
      balanceBadgeEl.textContent = `HTG: ${formatHtg(state?.totalBalance)}`;
    } catch (_) {
      balanceBadgeEl.textContent = "HTG: --";
    }
  }

  function getObservedTurnSeat() {
    const turn = String(window.turn || "").trim().toLowerCase();
    if (turn === "b") return 1;
    if (turn === "w") return 0;
    return activeTurnSeat >= 0 ? activeTurnSeat : 0;
  }

  function renderTurnTimer() {
    if (!turnTimerEl) return;
    if (activeGameStatus !== "playing") {
      turnTimerEl.textContent = "Tan kou: --";
      turnTimerEl.title = "Tan kou: --";
      turnTimerEl.classList.remove("danger");
      return;
    }

    if (!activeRoomId) {
      const observedTurn = String(window.turn || "").trim().toLowerCase();
      if (observedTurn && observedTurn !== lastObservedTurn) {
        lastObservedTurn = observedTurn;
        activeTurnSeat = getObservedTurnSeat();
        activeTurnDeadlineMs = Date.now() + CHESS_TURN_LIMIT_MS;
      }
      if (!activeTurnDeadlineMs) {
        activeTurnSeat = getObservedTurnSeat();
        activeTurnDeadlineMs = Date.now() + CHESS_TURN_LIMIT_MS;
      }
    }

    const remainingSec = activeTurnDeadlineMs > 0
      ? Math.max(0, Math.ceil((activeTurnDeadlineMs - Date.now()) / 1000))
      : 0;
    const myTurn = activeTurnSeat === activeSeatIndex;
    const label = activeTurnDeadlineMs > 0
      ? `${myTurn ? "Tan ou" : "Tan advese a"}: ${remainingSec}s`
      : "Tan kou: --";
    turnTimerEl.textContent = label;
    turnTimerEl.title = label;
    turnTimerEl.classList.toggle("danger", activeTurnDeadlineMs > 0 && remainingSec <= 10);
    if (activeTurnDeadlineMs > 0 && remainingSec <= 0) {
      void resolveTurnTimeout();
    }
  }

  function startTurnTimerLoop() {
    if (turnTimer) window.clearInterval(turnTimer);
    renderTurnTimer();
    turnTimer = window.setInterval(renderTurnTimer, 250);
  }

  function stopTurnTimerLoop() {
    if (turnTimer) {
      window.clearInterval(turnTimer);
      turnTimer = 0;
    }
    activeGameStatus = "";
    activeTurnDeadlineMs = 0;
    activeTurnSeat = -1;
    lastObservedTurn = "";
    renderTurnTimer();
  }

  function applyTurnState(state = {}) {
    activeGameStatus = String(state?.status || activeGameStatus || "").trim().toLowerCase();
    activeTurnSeat = Number.isFinite(Number(state?.currentTurnSeat)) ? Number(state.currentTurnSeat) : activeTurnSeat;
    activeTurnDeadlineMs = Number.isFinite(Number(state?.turnDeadlineMs)) ? Number(state.turnDeadlineMs) : activeTurnDeadlineMs;
    startTurnTimerLoop();
  }

  function describeEndedState(state = {}) {
    const winnerSeat = Number.isFinite(Number(state?.winnerSeat)) ? Number(state.winnerSeat) : -1;
    const endedReason = String(state?.endedReason || "").trim().toLowerCase();
    const isDraw = winnerSeat < 0 || endedReason.startsWith("draw") || endedReason === "stalemate";
    if (isDraw) {
      return {
        title: "Match nil",
        text: "Pati a fini san gayan.",
      };
    }
    const userWon = winnerSeat === activeSeatIndex;
    if (endedReason === "timeout") {
      return {
        title: userWon ? "Ou genyen" : "Ou pedi",
        text: userWon ? "Tan advese a fini avan li jwe." : "Tan ou fini avan ou jwe.",
      };
    }
    if (endedReason === "disconnect_forfeit" || endedReason === "quit") {
      return {
        title: userWon ? "Ou genyen" : "Ou pedi",
        text: userWon ? "Advese a kite pati a." : "Ou kite pati a.",
      };
    }
    return {
      title: userWon ? "Ou genyen" : "Ou pedi",
      text: userWon ? "Ou ranpote pati a." : "Advese a ranpote pati a.",
    };
  }

  function handleEndedState(state = {}) {
    activeRoomEnded = true;
    activeRoomFinalized = true;
    clearPresenceHeartbeat();
    clearRoomStatePolling();
    clearPersistedFriendRoomState();
    stopTurnTimerLoop();
    const copy = describeEndedState(state);
    updateStatus("Pati a fini.");
    openOverlay({
      badge: ROOM_MODE === "chess_friends" ? "Salon prive" : "Match",
      title: copy.title,
      text: copy.text,
      showRetry: true,
    });
    window.setTimeout(() => void refreshWallet(), 800);
  }

  async function resolveTurnTimeout() {
    if (timeoutResolving || activeGameStatus !== "playing" || activeRoomEnded) return;
    timeoutResolving = true;
    const timedOutSeat = activeTurnSeat >= 0 ? activeTurnSeat : getObservedTurnSeat();
    const winnerSeat = timedOutSeat === 0 ? 1 : 0;
    try {
      if (activeRoomId) {
        const result = await touchRoomPresenceChessSecure({ roomId: activeRoomId });
        if (result?.status === "ended") {
          handleEndedState(result);
          return;
        }
        activeTurnDeadlineMs = Date.now() + 1000;
        return;
      }
      handleEndedState({
        status: "ended",
        endedReason: "timeout",
        winnerSeat,
      });
    } catch (_) {
      activeTurnDeadlineMs = Date.now() + 1000;
    } finally {
      timeoutResolving = false;
    }
  }

  function updateOpponent(name = "", meta = "") {
    if (opponentNameEl) opponentNameEl.textContent = name;
    if (opponentMetaEl) opponentMetaEl.textContent = meta;
  }

  function configureDifficulty() {
    const slider = document.querySelector(".lvlinput");
    const label = document.querySelector(".pslider");
    const normalized = activeBotLevel === "weak" ? "weak" : "fo";
    const movetimeValue = normalized === "weak" ? 520 : 2200;
    if (typeof window.movetime !== "undefined") window.movetime = movetimeValue;
    if (typeof window.playerdepth !== "undefined") window.playerdepth = normalized === "weak" ? 1 : 2;
    if (typeof window.configureKobposhChessBot === "function") {
      window.configureKobposhChessBot({
        level: normalized,
        movetime: movetimeValue,
        playerdepth: normalized === "weak" ? 1 : 2,
      });
    }
    if (slider) slider.value = String(movetimeValue);
    if (label) label.textContent = `${(movetimeValue / 1000).toFixed(movetimeValue >= 1000 ? 1 : 2)}s`;
    if (botBadgeEl) botBadgeEl.textContent = ROOM_MODE === "chess_friends" ? "PRIVE" : "MATCH";
  }

  function isChessBackendUnavailable(error) {
    const code = String(error?.code || "").trim().toLowerCase();
    const status = Number(error?.httpStatus || 0);
    return code === "chess-backend-unavailable"
      || code === "route-not-found"
      || code === "http-backend-not-configured"
      || status === 404
      || status === 503;
  }

  function configureLabels() {
    if (modeBadgeEl) modeBadgeEl.textContent = ROOM_MODE === "chess_friends" ? "Salon prive" : "Match";
    if (stakeBadgeEl) stakeBadgeEl.textContent = `${PUBLIC_STAKE_HTG} HTG`;
    if (roomCodeBadgeEl) {
      const code = INVITE_CODE || "";
      roomCodeBadgeEl.hidden = ROOM_MODE !== "chess_friends";
      roomCodeBadgeEl.textContent = code ? `Room ${code}` : "Room prive";
    }
    if (controlCopyEl) {
      controlCopyEl.textContent = "";
    }
  }

  function inferEndedReasonFromLabel(rawText = "") {
    const text = String(rawText || "").trim().toLowerCase();
    if (!text) return "";
    if (text.includes("white won by checkmate") || text.includes("black won by checkmate")) return "checkmate";
    if (text.includes("stalemate")) return "stalemate";
    if (text.includes("50 moves")) return "draw_50_moves";
    if (text.includes("repetition")) return "draw_repetition";
    if (text.includes("insufficient material")) return "draw_insufficient_material";
    if (text.includes("draw")) return "draw";
    return "";
  }

  function getSeatColorPrefix(seatIndex = 0) {
    return seatIndex === 1 ? "b" : "w";
  }

  function getSeatColorLabel(seatIndex = 0) {
    return seatIndex === 1 ? "Nwa" : "Blan";
  }

  function forceBoardOrientationForSeat(seatIndex = 0) {
    const boardEl = document.querySelector(".board");
    const gameEl = document.querySelector(".game");
    const shouldInvert = seatIndex === 1;
    boardEl?.classList.toggle("inverted", shouldInvert);
    gameEl?.classList.toggle("inverted", shouldInvert);
  }

  function startLocalBotGame() {
    updateOpponent(activeOpponentName || chooseOpponentName(), "Advese");
    updateStatus("Pati an kou.");
    if (!Number.isFinite(Number(activeSeatIndex))) {
      activeSeatIndex = 0;
    }
    if (activeSeatIndex !== 0 && activeSeatIndex !== 1) {
      activeSeatIndex = Math.random() < 0.5 ? 0 : 1;
    }
    if (youMetaEl) youMetaEl.textContent = getSeatColorLabel(activeSeatIndex);
    if (typeof window.selectai === "function") window.selectai();
    if (activeSeatIndex === 1 && typeof window.selectblack === "function") {
      window.selectblack();
    } else if (typeof window.selectwhite === "function") {
      window.selectwhite();
    }
    forceBoardOrientationForSeat(activeSeatIndex);
    configureDifficulty();
    closeOverlay();
    if (typeof window.play === "function") window.play();
    activeGameStatus = "playing";
    activeTurnSeat = 0;
    activeTurnDeadlineMs = Date.now() + CHESS_TURN_LIMIT_MS;
    lastObservedTurn = String(window.turn || "w").trim().toLowerCase() || "w";
    startTurnTimerLoop();
  }

  function startPrivateHumanGame(state = {}) {
    if (privateGameStarted) return;
    activeSeatIndex = Number.isFinite(Number(state?.seatIndex)) ? Number(state.seatIndex) : activeSeatIndex;
    privateGameStarted = true;
    if (typeof window.selectplayer === "function") window.selectplayer();
    if (activeSeatIndex === 1 && typeof window.selectblack === "function") {
      window.selectblack();
    } else if (typeof window.selectwhite === "function") {
      window.selectwhite();
    }
    forceBoardOrientationForSeat(activeSeatIndex);
    activeOpponentName = String((state?.playerNames || [])[activeSeatIndex === 0 ? 1 : 0] || activeOpponentName || "Advese").trim() || "Advese";
    updateOpponent(activeOpponentName, `Salon prive - ${getSeatColorLabel(activeSeatIndex === 0 ? 1 : 0)}`);
    updateStatus("Pati an kou.");
    if (youMetaEl) youMetaEl.textContent = getSeatColorLabel(activeSeatIndex);
    if (controlCopyEl) {
      controlCopyEl.textContent = `Salon prive konekte. Kod la: ${String(state?.inviteCode || INVITE_CODE || "").trim() || "------"}.`;
    }
    if (roomCodeBadgeEl) {
      const code = String(state?.inviteCode || INVITE_CODE || "").trim();
      roomCodeBadgeEl.hidden = false;
      roomCodeBadgeEl.textContent = code ? `Room ${code}` : "Room prive";
    }
    persistFriendRoomState();
    closeOverlay();
    if (typeof window.play === "function") window.play();
    applyTurnState({
      status: "playing",
      currentTurnSeat: Number.isFinite(Number(state?.currentTurnSeat)) ? Number(state.currentTurnSeat) : 0,
      turnDeadlineMs: Number(state?.turnDeadlineMs || 0),
    });
  }

  async function safeLeaveActiveRoom() {
    if (!activeRoomId || activeRoomEnded) return;
    const roomId = activeRoomId;
    activeRoomId = "";
    activeRoomEnded = true;
    clearPresenceHeartbeat();
    clearRoomStatePolling();
    stopTurnTimerLoop();
    clearPersistedFriendRoomState();
    try {
      await leaveRoomChessSecure({ roomId });
    } catch (_) {
    }
  }

  async function finalizeRoomFromCheckmateText(rawText = "") {
    if (!activeRoomId || activeRoomEnded || activeRoomFinalized) return;
    const text = String(rawText || "").trim().toLowerCase();
    const endedReason = inferEndedReasonFromLabel(text);
    if (!endedReason) return;

    let winnerSeat = -1;
    if (text.includes("white won by checkmate")) winnerSeat = 0;
    if (text.includes("black won by checkmate")) winnerSeat = 1;

    activeRoomFinalized = true;
    clearPresenceHeartbeat();
    clearRoomStatePolling();
    try {
      const result = await submitActionChessSecure({
        roomId: activeRoomId,
        clientActionId: `chess_finalize_${Date.now().toString(36)}`,
        matchEnded: true,
        forceFinalize: true,
        winnerSeat,
        endedReason,
        action: {
          fenAfter: typeof window.generateFENString === "function" ? window.generateFENString() : "",
          pgn: typeof window.movesHistory === "string" ? window.movesHistory : "",
        },
      });
      handleEndedState({
        ...result,
        status: "ended",
        endedReason,
        winnerSeat,
      });
    } catch (_) {
      activeRoomFinalized = false;
    }
  }

  function attachCheckmateObserver() {
    if (checkmateObserverAttached) return;
    const target = document.querySelector(".checkmate");
    const label = document.querySelector(".checkmate p");
    if (!target || !label) return;
    const maybeFinalize = () => {
      if (window.getComputedStyle(target).display === "none") return;
      finalizeRoomFromCheckmateText(label.textContent || "");
    };
    const observer = new MutationObserver(maybeFinalize);
    observer.observe(target, { attributes: true, attributeFilter: ["style", "class"] });
    observer.observe(label, { childList: true, characterData: true, subtree: true });
    checkmateObserverAttached = true;
  }

  async function applyRemoteMoveRecord(record = {}) {
    const from = String(record?.from || "").trim();
    const to = String(record?.to || "").trim();
    if (!from || !to || typeof window.move !== "function") return;
    suppressMoveSync = true;
    try {
      window.move(from, to);
    } finally {
      suppressMoveSync = false;
    }
  }

  async function syncPrivateRoomState(state = {}) {
    if (!state || typeof state !== "object") return;
    activeSeatIndex = Number.isFinite(Number(state.seatIndex)) ? Number(state.seatIndex) : activeSeatIndex;
    activeRoomId = String(state.roomId || activeRoomId || "").trim();
    const status = String(state.status || "").trim().toLowerCase();

    if (status === "ended") {
      handleEndedState(state);
      return;
    }

    if (status === "waiting") {
      updateOpponent("Ap tann lot jwe a", "Salon prive");
      updateStatus("Salon prive a kreye. N ap tann lot jwe a.");
      applyTurnState({ status: "waiting", currentTurnSeat: -1, turnDeadlineMs: 0 });
      openOverlay({
        badge: "Salon prive",
        title: "Salon prive a pare",
        text: `Pataje kod sa a ak lot jwe a: ${String(state.inviteCode || INVITE_CODE || "------").trim() || "------"}`,
        showRetry: false,
      });
      if (roomCodeBadgeEl) {
        const code = String(state.inviteCode || INVITE_CODE || "").trim();
        roomCodeBadgeEl.hidden = false;
        roomCodeBadgeEl.textContent = code ? `Room ${code}` : "Room prive";
      }
      persistFriendRoomState();
      return;
    }

    if (status !== "playing") {
      updateStatus("N ap senkronize salon prive a.");
      return;
    }

    if (!privateGameStarted) {
      startPrivateHumanGame(state);
    }
    applyTurnState(state);

    const moveHistory = Array.isArray(state.moveHistory) ? state.moveHistory : [];
    if (moveHistory.length > activeMoveHistoryLength) {
      const missingMoves = moveHistory.slice(activeMoveHistoryLength);
      for (const moveRecord of missingMoves) {
        const isOwnMove = Number(moveRecord?.seatIndex) === activeSeatIndex;
        if (!isOwnMove) {
          await applyRemoteMoveRecord(moveRecord);
        }
        activeMoveHistoryLength += 1;
      }
    }

  }

  function startPresenceHeartbeat() {
    clearPresenceHeartbeat();
    if (!activeRoomId || activeRoomEnded) return;
    presenceTimer = window.setInterval(async () => {
      if (!activeRoomId || activeRoomEnded) return;
      try {
        const result = await touchRoomPresenceChessSecure({ roomId: activeRoomId });
        if (result?.status === "ended") {
          handleEndedState(result);
        }
      } catch (_) {
      }
    }, PRESENCE_HEARTBEAT_MS);
  }

  function startRoomStatePolling() {
    clearRoomStatePolling();
    if (ROOM_MODE !== "chess_friends" || !activeRoomId || activeRoomEnded) return;
    roomStateTimer = window.setInterval(async () => {
      if (!activeRoomId || activeRoomEnded) return;
      try {
        const state = await getChessRoomStateSecure({ roomId: activeRoomId });
        await syncPrivateRoomState(state);
      } catch (_) {
      }
    }, PRIVATE_ROOM_POLL_MS);
  }

  function attachMoveBridge() {
    if (moveBridgeAttached || typeof window.move !== "function") return;
    const originalMove = window.move;
    window.move = function bridgedMove(from, to) {
      if (
        ROOM_MODE === "chess_friends"
        && !suppressMoveSync
        && activeRoomId
        && !activeRoomEnded
        && Array.isArray(window.positions)
      ) {
        const fromX = String(from || "").split("")[0];
        const fromY = String(from || "").split("")[1];
        const pieceCode = window.positions?.[fromX]?.[fromY];
        if (String(pieceCode || "").split("")[0] !== getSeatColorPrefix(activeSeatIndex)) {
          return;
        }
      }

      const beforeMovesHistory = typeof window.movesHistory === "string" ? window.movesHistory : "";
      const beforeMoveNumber = Number.isFinite(Number(window.moveNumber)) ? Number(window.moveNumber) : 0;
      const beforeTurn = typeof window.turn === "string" ? window.turn : "";
      const result = originalMove.apply(this, arguments);
      const afterMovesHistory = typeof window.movesHistory === "string" ? window.movesHistory : "";
      const afterMoveNumber = Number.isFinite(Number(window.moveNumber)) ? Number(window.moveNumber) : beforeMoveNumber;
      const afterTurn = typeof window.turn === "string" ? window.turn : beforeTurn;
      const moveAccepted = afterMoveNumber > beforeMoveNumber || afterMovesHistory !== beforeMovesHistory;

      if (moveAccepted && activeRoomId && !activeRoomEnded && !suppressMoveSync) {
        const actorSeat = beforeTurn === "w" ? 0 : 1;
        const endedReason = inferEndedReasonFromLabel(document.querySelector(".checkmate p")?.textContent || "");
        const matchEnded = Boolean(endedReason);
        const winnerSeat = endedReason === "checkmate" ? (afterTurn === "b" ? 0 : 1) : -1;
        const fenAfter = typeof window.generateFENString === "function" ? window.generateFENString() : "";
        const pgn = typeof window.movesHistory === "string" ? window.movesHistory : "";
        if (ROOM_MODE === "chess_friends") {
          activeMoveHistoryLength = Math.max(activeMoveHistoryLength, afterMoveNumber);
        }
        queueMoveSync(async () => {
          const syncResult = await submitActionChessSecure({
            roomId: activeRoomId,
            clientActionId: `chess_move_${afterMoveNumber}_${from}_${to}`,
            actorSeat,
            matchEnded,
            winnerSeat,
            endedReason,
            action: {
              from,
              to,
              uci: `${from}${to}`,
              fenAfter,
              pgn,
              isMate: endedReason === "checkmate",
            },
          });
          if (matchEnded) {
            handleEndedState(syncResult);
            return;
          }
          applyTurnState(syncResult);
        });
      }

      return result;
    };
    moveBridgeAttached = true;
  }

  async function handlePublicLaunch() {
    window.clearTimeout(currentLaunchTimer);
    clearPresenceHeartbeat();
    clearRoomStatePolling();
    activeRoomId = "";
    activeOpponentName = "";
    activeRoomEnded = false;
    activeRoomFinalized = false;
    activeMoveHistoryLength = 0;
    privateGameStarted = false;
    updateOpponent("Ap tann advese", "N ap prepare pati a");
    updateStatus("N ap chache yon lot jwe");
    openOverlay({
      badge: "Match",
      title: "N ap chache yon lot jwe",
      text: `N ap prepare yon pati Echec a ${PUBLIC_STAKE_HTG} HTG pou ou kounye a.`,
      showRetry: false,
    });
    currentLaunchTimer = window.setTimeout(async () => {
      if (Math.random() < NO_PLAYER_PROBABILITY) {
        updateStatus("Pa gen jwe ki disponib pou kounye a.");
        openOverlay({
          badge: "Match",
          title: "Pa gen jwe ki disponib pou kounye a",
          text: "Ou ka retounen dakey oswa relanse rechech la san okenn HTG pa soti.",
          showRetry: true,
        });
        return;
      }
      try {
        const user = await waitForCurrentUser();
        if (!user) {
          goHome();
          return;
        }
        activeOpponentName = chooseOpponentName();
        console.log("[CHESS_MONEY_DEBUG] joinMatchmaking:start", {
          stakeHtg: PUBLIC_STAKE_HTG,
          botDifficulty: BOT_LEVEL,
          apiBaseUrl: window.__KOBPOSH_RUNTIME_CONFIG__?.apiBaseUrl || "",
        });
        const result = await joinMatchmakingChessSecure({
          stakeHtg: PUBLIC_STAKE_HTG,
          botDifficulty: BOT_LEVEL,
          publicOpponentName: activeOpponentName,
        });
        console.log("[CHESS_MONEY_DEBUG] joinMatchmaking:result", {
          charged: result?.charged === true,
          roomId: String(result?.roomId || "").trim(),
          seatIndex: result?.seatIndex,
          status: result?.status,
          stakeHtg: result?.stakeHtg,
          rewardAmountHtg: result?.rewardAmountHtg,
        });
        activeRoomId = String(result?.roomId || "").trim();
        activeSeatIndex = Number.isFinite(Number(result?.seatIndex)) ? Number(result.seatIndex) : 0;
        activeRoomEnded = String(result?.status || "").trim().toLowerCase() === "ended";
        activeRoomFinalized = activeRoomEnded;
        if (String(result?.opponentDisplayName || "").trim()) {
          activeOpponentName = String(result.opponentDisplayName).trim();
        }
        activeBotLevel = String(result?.botDifficulty || activeBotLevel || "fo").trim().toLowerCase() === "weak" ? "weak" : "fo";
        window.setTimeout(() => void refreshWallet(), 700);
        startPresenceHeartbeat();
        startLocalBotGame();
      } catch (error) {
        updateStatus("Nou pa rive lanse pati a.");
        openOverlay({
          badge: "Match",
          title: "Nou pa rive lanse pati a",
          text: String(error?.message || "Tanpri eseye anko."),
          showRetry: true,
        });
      }
    }, PUBLIC_WAIT_MS);
  }

  async function handlePrivateLaunch() {
    window.clearTimeout(currentLaunchTimer);
    clearPresenceHeartbeat();
    clearRoomStatePolling();
    activeRoomId = "";
    activeRoomEnded = false;
    activeRoomFinalized = false;
    activeMoveHistoryLength = 0;
    privateGameStarted = false;
    updateOpponent("Salon prive", "N ap prepare room la");
    updateStatus("N ap prepare salon prive a");
    openOverlay({
      badge: "Salon prive",
      title: "N ap prepare salon prive a",
      text: "Tann yon ti moman pandan room la ap konekte.",
      showRetry: false,
    });
    try {
      const user = await waitForCurrentUser(6000);
      if (!user?.uid) {
        window.location.href = "../index.html?auth=login";
        return;
      }
      let result = null;
      if (FRIEND_ACTION === "join" && INVITE_CODE) {
        clearPersistedFriendRoomState();
        result = await joinFriendChessRoomByCodeSecure({ inviteCode: INVITE_CODE });
      } else {
        const persistedRoom = !FRIEND_ROOM_ID ? readPersistedFriendRoomState() : null;
        if (FRIEND_ROOM_ID) {
          result = await resumeFriendChessRoomSecure({ roomId: FRIEND_ROOM_ID });
        } else if (persistedRoom?.roomId) {
          result = await resumeFriendChessRoomSecure({ roomId: String(persistedRoom.roomId || "").trim() });
        } else {
          clearPersistedFriendRoomState();
          window.location.href = "../index.html";
          return;
        }
      }
      activeRoomId = String(result?.roomId || "").trim();
      activeSeatIndex = Number.isFinite(Number(result?.seatIndex)) ? Number(result.seatIndex) : 0;
      activeOpponentName = String((result?.playerNames || [])[activeSeatIndex === 0 ? 1 : 0] || "").trim();
      window.setTimeout(() => void refreshWallet(), 700);
      persistFriendRoomState();
      startPresenceHeartbeat();
      startRoomStatePolling();
      await syncPrivateRoomState(result);
    } catch (error) {
      updateStatus("Nou pa rive louvri salon prive a.");
      openOverlay({
        badge: "Salon prive",
        title: "Nou pa rive louvri salon prive a",
        text: String(error?.message || "Tanpri eseye anko."),
        showRetry: true,
      });
    }
  }

  async function restartGame() {
    if (typeof window.generateInitialPosition === "function") {
      window.generateInitialPosition();
    }
    stopTurnTimerLoop();
    await safeLeaveActiveRoom();
    if (ROOM_MODE === "chess_friends") {
      await handlePrivateLaunch();
      return;
    }
    await handlePublicLaunch();
  }

  function closeInfoPanel() {
    if (typeof window.closecheck === "function") window.closecheck();
  }

  function goHome() {
    safeLeaveActiveRoom().finally(() => {
      window.location.href = "../index.html";
    });
  }

  async function bootstrap() {
    if (bootstrapStarted) return;
    bootstrapStarted = true;

    configureLabels();
    openOverlay({
      badge: ROOM_MODE === "chess_friends" ? "Salon prive" : "Match",
      title: ROOM_MODE === "chess_friends" ? "N ap prepare salon prive a" : "N ap prepare pati a",
      text: "Tann yon ti moman pandan tablo a ap chaje.",
      showRetry: false,
    });

    const engineReady = await waitForChessEngineReady();
    if (!engineReady) {
      updateStatus("Tablo a pa rive chaje.");
      openOverlay({
        badge: ROOM_MODE === "chess_friends" ? "Salon prive" : "Match",
        title: "Nou pa rive prepare tablo a",
        text: "Rechaje paj la oswa eseye anko nan yon ti moman.",
        showRetry: true,
      });
      return;
    }

    attachMoveBridge();
    attachCheckmateObserver();
    void refreshWallet();
    window.addEventListener("xchangeUpdated", () => void refreshWallet());
    if (backBtn) backBtn.addEventListener("click", goHome);
    if (homeBtn) homeBtn.addEventListener("click", goHome);
    if (retryBtn) retryBtn.addEventListener("click", restartGame);
    if (startBtn) startBtn.addEventListener("click", restartGame);
    if (restartBtn) restartBtn.addEventListener("click", restartGame);
    if (replayBtn) replayBtn.addEventListener("click", restartGame);
    if (closeInfoBtn) closeInfoBtn.addEventListener("click", closeInfoPanel);

    if (ROOM_MODE === "chess_friends") {
      handlePrivateLaunch();
      return;
    }
    handlePublicLaunch();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootstrap, { once: true });
  } else {
    bootstrap();
  }

  window.addEventListener("pagehide", () => {
    safeLeaveActiveRoom();
  });
})();
