import { auth, onAuthStateChanged } from "./firebase-init.js";
import { getMorpionLiveMatchmakingSignalSecure } from "./secure-functions.js";

const POLL_MS = 5000;
const SHOW_COOLDOWN_MS = 60000;
const AUTO_HIDE_MS = 3800;

let pollTimer = null;
let pollInFlight = false;
let isStarted = false;
let lastSeenSignalTsMs = 0;
let lastShownAtMs = 0;
let toastEl = null;
let hideTimer = null;
let lastBrowserNotificationAtMs = 0;

function ensureToast() {
  if (toastEl?.isConnected) return toastEl;
  const node = document.createElement("button");
  node.type = "button";
  node.id = "morpionLiveNoticeToast";
  node.style.position = "fixed";
  node.style.right = "12px";
  node.style.bottom = "12px";
  node.style.zIndex = "3800";
  node.style.maxWidth = "min(78vw, 320px)";
  node.style.padding = "10px 12px";
  node.style.borderRadius = "14px";
  node.style.border = "1px solid rgba(255,255,255,0.2)";
  node.style.background = "rgba(18,28,46,0.9)";
  node.style.backdropFilter = "blur(8px)";
  node.style.color = "#f3f7ff";
  node.style.fontSize = "0.84rem";
  node.style.lineHeight = "1.35";
  node.style.textAlign = "left";
  node.style.boxShadow = "0 8px 24px rgba(8,12,22,0.36)";
  node.style.display = "none";
  node.style.cursor = "pointer";
  node.textContent = "Des joueurs sont disponibles sur Morpion. Jouer maintenant.";
  node.addEventListener("click", () => {
    window.location.href = "./morpion.html?engine=v2&stake=500&fundingCurrency=htg&stakeHtg=25";
  });
  document.body.appendChild(node);
  toastEl = node;
  return node;
}

function hideToast() {
  if (hideTimer) {
    window.clearTimeout(hideTimer);
    hideTimer = null;
  }
  if (toastEl) toastEl.style.display = "none";
}

function showToast(message = "") {
  const nowMs = Date.now();
  if ((nowMs - lastShownAtMs) < SHOW_COOLDOWN_MS) return;
  const toast = ensureToast();
  toast.textContent = String(message || "Des joueurs sont disponibles sur Morpion. Jouer maintenant.");
  toast.style.display = "block";
  lastShownAtMs = nowMs;
  if (hideTimer) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    hideToast();
  }, AUTO_HIDE_MS);
}

function showBrowserNotification(message = "") {
  if (typeof window === "undefined" || !("Notification" in window)) return;
  if (Notification.permission !== "granted") return;
  const nowMs = Date.now();
  if ((nowMs - lastBrowserNotificationAtMs) < SHOW_COOLDOWN_MS) return;
  lastBrowserNotificationAtMs = nowMs;
  try {
    const notification = new Notification("Morpion", {
      body: String(message || "Des joueurs sont disponibles sur Morpion. Jouer maintenant."),
      tag: "morpion-live-players",
      icon: "./favicon.ico",
    });
    notification.onclick = () => {
      try { window.focus(); } catch (_) {}
      window.location.href = "./morpion.html?engine=v2&stake=500&fundingCurrency=htg&stakeHtg=25";
      notification.close();
    };
    window.setTimeout(() => {
      try { notification.close(); } catch (_) {}
    }, 6000);
  } catch (_) {
  }
}

async function pollSignal() {
  if (pollInFlight || !auth.currentUser?.uid) return;
  pollInFlight = true;
  try {
    const result = await getMorpionLiveMatchmakingSignalSecure({});
    const active = result?.active === true;
    const message = String(result?.message || "").trim();
    const signalTsMs = Number(result?.signalTsMs || 0);
    if (!active || signalTsMs <= 0) return;
    if (signalTsMs <= lastSeenSignalTsMs) return;
    lastSeenSignalTsMs = signalTsMs;
    const safeMessage = message || "Des joueurs sont disponibles sur Morpion. Jouer maintenant.";
    showToast(safeMessage);
    showBrowserNotification(safeMessage);
  } catch (_) {
  } finally {
    pollInFlight = false;
  }
}

function startPolling() {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    void pollSignal();
  }, POLL_MS);
  void pollSignal();
}

function stopPolling() {
  if (pollTimer) {
    window.clearInterval(pollTimer);
    pollTimer = null;
  }
  hideToast();
}

export function startMorpionLiveNotice() {
  if (isStarted) return;
  isStarted = true;
  onAuthStateChanged(auth, (user) => {
    if (!user?.uid) {
      stopPolling();
      return;
    }
    startPolling();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void pollSignal();
    }
  });
}
