const pageParams = new URLSearchParams(window.location.search);
const isEmbeddedClassicShell = pageParams.get("embedded") === "1";
const initialStakeHtg = Math.max(0, Math.trunc(Number(pageParams.get("stakeHtg") || 0)));
const initialSessionId = String(pageParams.get("sessionId") || "").trim();
const requestedBotDifficulty = String(pageParams.get("botDifficulty") || "").trim().toLowerCase();
const CLASSIC_LOCAL_BOT_USERNAMES = Object.freeze([
  "jhon34", "louis22", "mika91", "dany48", "pedro17", "ralph05", "kevin73", "jonas44",
  "franco12", "yvens88", "teddy39", "levy26", "sony57", "pyer14", "nixon63", "willy32",
  "samy95", "dave41", "cliff28", "junior84", "ricky16", "manno53", "colin67", "brice21",
  "mario76", "henry18", "dylan92", "sael47", "fritz30", "jonel64", "erick09", "benjy55",
  "stevy71", "ronel24", "alex83", "kervens11", "lucky69", "stany36", "mendel58", "wilguens15",
  "robens97", "jeanro45", "billy62", "fredo20", "dano74", "vick99", "renel27", "linder52",
  "marvens13", "olrich87", "kendy35", "tiwil60", "jocelyn19", "tonton81", "feguens43", "lyndor68",
  "davens08", "stiv50", "roby72", "calix25", "neguens94", "yverson31", "jude66", "pepo07",
  "wenson59", "kenley42", "belony86", "vlad23", "mitch70", "gerry10", "stanio54", "ferdy29",
  "jems90", "tedson37", "pipo61", "woody18", "grenson82", "kenol46", "jefri12", "nino75",
  "romel33", "sherby96", "manix14", "steven57", "rony04", "yolette65", "tifred22", "hervens89",
  "loulou38", "kervin56", "patrick17", "sando49", "marlon93", "dudley26", "jeferson79", "wilner40",
  "cedric06", "hans51", "charly85", "lovens34"
]);

let currentClassicLocalIdentity = null;
let classicHudChromeHidden = false;

function normalizeClassicBotDifficulty(value = "") {
  const level = String(value || "").trim().toLowerCase();
  if (level === "dominov1" || level === "v1") return "dominov1";
  if (level === "ultra" || level === "expert") return "ultra";
  if (level === "userpro" || level === "amateur") return "userpro";
  return "userpro";
}

function getClassicOpponentHudLabel() {
  const normalized = normalizeClassicBotDifficulty(requestedBotDifficulty || "userpro");
  if (normalized === "dominov1") return "adves\u00E8 yo";
  if (normalized === "ultra") return "3 advese yo";
  return "3 adves\u00E8 yo";
}

function safeText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = String(value || "");
}

function safeHtml(id, value) {
  const node = document.getElementById(id);
  if (node) node.innerHTML = String(value || "");
}

function safeTitle(id, value) {
  const node = document.getElementById(id);
  if (node) node.title = String(value || "");
}

function hideNode(id) {
  const node = document.getElementById(id);
  if (node) node.style.display = "none";
}

function showNode(id, displayValue = "") {
  const node = document.getElementById(id);
  if (!node) return;
  node.style.display = displayValue || "";
}

function isNodeVisible(node) {
  if (!node) return false;
  if (node.classList.contains("hidden")) return false;
  if (node.style.display === "none") return false;
  return true;
}

function postClassicShellMessage(type, payload = {}) {
  if (!isEmbeddedClassicShell || window.parent === window) return;
  window.parent.postMessage(
    {
      type,
      payload,
    },
    window.location.origin,
  );
}

function isLocalTeamWinner(winnerSeat) {
  const safeWinnerSeat = Math.max(0, Math.trunc(Number(winnerSeat)));
  if (normalizeClassicBotDifficulty(requestedBotDifficulty || "userpro") === "dominov1") {
    return safeWinnerSeat === 0;
  }
  return safeWinnerSeat % 2 === 0;
}

function shuffleClassicUsernames(sourceList) {
  const copy = Array.isArray(sourceList) ? sourceList.slice() : [];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    const tmp = copy[index];
    copy[index] = copy[swapIndex];
    copy[swapIndex] = tmp;
  }
  return copy;
}

function getClassicLocalIdentity(forceNew = false) {
  if (!forceNew && currentClassicLocalIdentity) return currentClassicLocalIdentity;

  const shuffled = shuffleClassicUsernames(CLASSIC_LOCAL_BOT_USERNAMES);
  const botNames = shuffled.slice(0, 3);
  currentClassicLocalIdentity = {
    localName: "Ou",
    botNames,
    hudNames: botNames.join(" / "),
    allNames: ["Ou", ...botNames],
  };
  window.__KOBPOSH_DOMINO_CLASSIC_LOCAL_IDENTITY__ = currentClassicLocalIdentity;
  return currentClassicLocalIdentity;
}

function applyLocalHudMode(forceNew = false) {
  const identity = getClassicLocalIdentity(forceNew);
  document.body.classList.add("game-hud-minimal");
  document.body.classList.add("classic-local-shell");
  hideNode("OnlineUsersHud");
  hideNode("LeaveRoomTopBtn");
  hideNode("FullscreenHint");
  safeText("LocalTurnLabel", getClassicOpponentHudLabel());
  safeHtml(
    "LocalTurnValue",
    identity.botNames
      .map((name) => `<span class="classic-opponent-pill">${name}</span>`)
      .join(""),
  );
  safeTitle("LocalTurnValue", identity.hudNames);
  if (initialStakeHtg > 0) {
    safeText("LocalDoesValue", initialStakeHtg);
    showNode("LocalTurnDoesWrap", "inline-flex");
  }
}

function updateClassicHudViewToggleUi() {
  const btn = document.getElementById("HudViewToggleBtn");
  const icon = document.getElementById("HudViewToggleIcon");
  if (!btn) return;

  const isHiddenMode = classicHudChromeHidden === true;
  btn.setAttribute("aria-pressed", isHiddenMode ? "true" : "false");
  btn.setAttribute("aria-label", isHiddenMode ? "Montre panno yo" : "Kache panno yo");
  btn.setAttribute("title", isHiddenMode ? "Montre panno yo" : "Kache panno yo");
  if (icon) {
    icon.innerHTML = isHiddenMode
      ? '<path d="M3 12s3.6-6 9-6c2.1 0 3.94.6 5.55 1.6"></path><path d="M14.12 14.12A3 3 0 0 1 9.88 9.88"></path><path d="M17.94 17.94C16.3 19.22 14.3 20 12 20c-6.4 0-10-6-10-6a21.8 21.8 0 0 1 4.18-4.95"></path><path d="m3 3 18 18"></path>'
      : '<path d="M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12Z"></path><circle cx="12" cy="12" r="2.8"></circle>';
  }
}

function setClassicHudChromeHidden(hidden = false) {
  classicHudChromeHidden = !!hidden;
  document.body.classList.toggle("classic-hud-chrome-hidden", classicHudChromeHidden);
  updateClassicHudViewToggleUi();
}

function syncFloatingHudVisibility() {
  const hudBtn = document.getElementById("HudViewToggleBtn");
  const overlay = document.getElementById("GameEndOverlay");
  const goBtn = document.getElementById("GameEndGoBtn");
  const overlayVisible = isNodeVisible(overlay);
  const goVisible = isNodeVisible(goBtn);
  if (hudBtn) {
    hudBtn.style.display = (overlayVisible || goVisible) ? "none" : "";
  }
  const lightsBtn = document.getElementById("PlayerLightsToggleBtn");
  if (lightsBtn) {
    if (overlayVisible || goVisible || classicHudChromeHidden) {
      lightsBtn.style.display = "none";
    } else if (document.body.classList.contains("classic-local-shell")) {
      lightsBtn.style.display = "inline-flex";
    } else {
      lightsBtn.style.display = "";
    }
  }
  updateClassicHudViewToggleUi();
}

function installClassicHudViewToggleBridge() {
  const btn = document.getElementById("HudViewToggleBtn");
  if (!btn) return;
  if (btn.dataset.kobposhHudToggleBound === "1") {
    window.syncFloatingHudVisibility = syncFloatingHudVisibility;
    updateClassicHudViewToggleUi();
    return;
  }

  btn.dataset.kobposhHudToggleBound = "1";
  btn.addEventListener("click", () => {
    setClassicHudChromeHidden(!classicHudChromeHidden);
    syncFloatingHudVisibility();
  });

  window.syncFloatingHudVisibility = syncFloatingHudVisibility;
  updateClassicHudViewToggleUi();
}

function configureBackActions() {
  const endBackBtn = document.getElementById("GameEndBackBtn");
  if (endBackBtn) {
    endBackBtn.textContent = "Akey";
  }
  if (endBackBtn) {
    endBackBtn.addEventListener("click", () => {
      if (isEmbeddedClassicShell) {
        postClassicShellMessage("dominoClassic:returnHome", {
          sessionId: initialSessionId,
        });
        return;
      }
      window.location.href = "./index.html?view=public";
    });
  }
}

function configurePlayerNames(forceNew = false) {
  if (!window.Domino || !window.Domino.Partida || !window.Domino.Partida.Opciones) return;
  const identity = getClassicLocalIdentity(forceNew);
  const options = window.Domino.Partida.Opciones;
  if (typeof options.AsignarNombreJugador === "function") {
    options.AsignarNombreJugador("1", identity.localName);
    options.AsignarNombreJugador("2", identity.botNames[0] || "jhon34");
    options.AsignarNombreJugador("3", identity.botNames[1] || "louis22");
    options.AsignarNombreJugador("4", identity.botNames[2] || "mika91");
  }
}

function refreshClassicLocalIdentity(forceNew = false) {
  applyLocalHudMode(forceNew);
  configurePlayerNames(forceNew);
}

function primeClassicLocalRoundSession() {
  const nowMs = Date.now();
  const previous = (window.GameSession && typeof window.GameSession === "object")
    ? window.GameSession
    : {};
  window.GameSession = {
    ...previous,
    localClassicIntroAtMs: nowMs,
    localClassicIntroNonce: `classic_local_${nowMs}_${Math.random().toString(36).slice(2, 8)}`,
    botDifficulty: normalizeClassicBotDifficulty(requestedBotDifficulty || previous.botDifficulty),
  };
}

function installClassicIdentityRefreshBridge() {
  const startBtn = document.getElementById("BotonEmpezar");
  if (!startBtn || startBtn.dataset.kobposhClassicIdentityBound === "1") return;
  startBtn.dataset.kobposhClassicIdentityBound = "1";
  startBtn.addEventListener("click", () => {
    primeClassicLocalRoundSession();
    refreshClassicLocalIdentity(true);
  }, true);
}

function autostartIfRequested() {
  if (pageParams.get("autostart") !== "1") return;
  const startBtn = document.getElementById("BotonEmpezar");
  if (!startBtn) return;
  window.setTimeout(() => {
    startBtn.click();
  }, 120);
}

function installEmbeddedEndBridge() {
  if (!isEmbeddedClassicShell) return;

  const replayBtn = document.getElementById("GameEndReplayBtn");
  if (replayBtn && replayBtn.dataset.kobposhEmbeddedBridge !== "1") {
    replayBtn.dataset.kobposhEmbeddedBridge = "1";
    replayBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      postClassicShellMessage("dominoClassic:playAgain", {
        sessionId: initialSessionId,
        stakeHtg: initialStakeHtg,
      });
    }, true);
  }

  const backBtn = document.getElementById("GameEndBackBtn");
  if (backBtn && backBtn.dataset.kobposhEmbeddedBridge !== "1") {
    backBtn.dataset.kobposhEmbeddedBridge = "1";
    backBtn.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      postClassicShellMessage("dominoClassic:returnHome", {
        sessionId: initialSessionId,
      });
    }, true);
  }
}

function bridgeWinnerToClassicShell() {
  if (!isEmbeddedClassicShell) return;
  if (!window.UI || typeof window.UI.MostrarGanador !== "function") return;
  if (window.UI.__kobposhClassicShellWinnerBridge === true) return;

  const originalShowWinner = window.UI.MostrarGanador.bind(window.UI);
  let reported = false;

  window.UI.MostrarGanador = function patchedMostrarGanador(winnerSeat, motif, options) {
    const result = originalShowWinner(winnerSeat, motif, options);
    if (!reported) {
      reported = true;
      const safeWinnerSeat = Math.max(0, Math.trunc(Number(winnerSeat)));
      postClassicShellMessage("dominoClassic:matchResult", {
        matchId: `domino_classic_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`,
        sessionId: initialSessionId,
        winnerSeat: safeWinnerSeat,
        winner: isLocalTeamWinner(safeWinnerSeat) ? "user" : "ai",
        motif: String(motif || ""),
        stakeHtg: initialStakeHtg,
      });
    }
    return result;
  };

  window.UI.__kobposhClassicShellWinnerBridge = true;
}

window.addEventListener("load", () => {
  primeClassicLocalRoundSession();
  refreshClassicLocalIdentity(false);
  installClassicHudViewToggleBridge();
  configureBackActions();
  installClassicIdentityRefreshBridge();
  installEmbeddedEndBridge();
  bridgeWinnerToClassicShell();
  autostartIfRequested();
  syncFloatingHudVisibility();
});
