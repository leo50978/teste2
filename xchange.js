import {
  auth,
  onAuthStateChanged,
} from "./firebase-init.js";
import { withButtonLoading } from "./loading-ui.js";
import { getDepositFundingStatusSecure, walletMutateSecure } from "./secure-functions.js";

const RATE_HTG_TO_DOES = 20;
const BALANCE_DEBUG = false;
const WELCOME_PROGRESS_DEBUG = false;
const WELCOME_LOCKED_SELL_STORAGE_KEY = "domino_welcome_locked_sell_attempt_v1";
const WALLET_CACHE = new Map();
const LAST_FUNDING_SNAPSHOT_BY_UID = new Map();
let walletUnsub = null;
let activeUid = null;
let soldeModulePromise = null;
const XCHANGE_REFRESH_MS = 2 * 60 * 1000;
let walletVisibilityBound = false;

function safeInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function safeSignedInt(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function safeMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.round(n * 100) / 100);
}

function safeSignedMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function bindHideOnErrorImages(root) {
  if (!root) return;
  root.querySelectorAll('img[data-hide-on-error="1"]').forEach((img) => {
    if (img.dataset.errorBound === "1") return;
    img.dataset.errorBound = "1";
    img.addEventListener("error", () => {
      img.style.display = "none";
    });
  });
}

function defaultWallet() {
  return {
    does: 0,
    doesApprovedBalance: 0,
    doesProvisionalBalance: 0,
    exchangeableDoesAvailable: 0,
    exchangedGourdes: 0,
    approvedHtgAvailable: 0,
    provisionalHtgAvailable: 0,
    welcomeBonusHtgAvailable: 0,
    welcomeBonusHtgConverted: 0,
    welcomeBonusHtgPlayed: 0,
    withdrawableHtg: 0,
    accountFrozen: false,
    freezeReason: "",
    rejectedDepositStrikeCount: 0,
    pendingPlayFromXchangeDoes: 0,
    pendingPlayFromReferralDoes: 0,
    pendingPlayFromWelcomeDoes: 0,
    totalExchangedHtgEver: 0,
    hasRealApprovedDeposit: false,
    loaded: false,
  };
}

function currentUid() {
  return auth.currentUser?.uid || "guest";
}

function getWelcomeLockedSellStorageKey(uid = currentUid()) {
  return `${WELCOME_LOCKED_SELL_STORAGE_KEY}:${String(uid || "").trim()}`;
}

function readWelcomeLockedSellAttempt(uid = currentUid()) {
  const safeUid = String(uid || "").trim();
  if (!safeUid || safeUid === "guest") return null;
  try {
    const raw = window.localStorage?.getItem(getWelcomeLockedSellStorageKey(safeUid)) || "";
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      amountDoes: safeInt(parsed?.amountDoes),
      updatedAtMs: safeSignedInt(parsed?.updatedAtMs),
    };
  } catch {
    return null;
  }
}

function writeWelcomeLockedSellAttempt(uid = currentUid(), amountDoes = 0) {
  const safeUid = String(uid || "").trim();
  const safeAmount = safeInt(amountDoes);
  if (!safeUid || safeUid === "guest" || safeAmount <= 0) return;
  try {
    window.localStorage?.setItem(
      getWelcomeLockedSellStorageKey(safeUid),
      JSON.stringify({
        uid: safeUid,
        amountDoes: safeAmount,
        updatedAtMs: Date.now(),
      })
    );
  } catch {}
}

function clearWelcomeLockedSellAttempt(uid = currentUid()) {
  const safeUid = String(uid || "").trim();
  if (!safeUid || safeUid === "guest") return;
  try {
    window.localStorage?.removeItem(getWelcomeLockedSellStorageKey(safeUid));
  } catch {}
}

function getVisibleLockedWelcomeDoes(state = {}, uid = currentUid()) {
  if (state?.hasRealApprovedDeposit === true) return 0;
  const pendingWelcome = safeInt(state?.pendingPlayFromWelcomeDoes);
  if (pendingWelcome <= 0) return 0;
  const savedAttempt = readWelcomeLockedSellAttempt(uid);
  const requestedLocked = safeInt(savedAttempt?.amountDoes);
  if (requestedLocked <= 0) return 0;
  const currentApprovedDoes = safeInt(state?.doesApprovedBalance ?? state?.does);
  return Math.min(requestedLocked, pendingWelcome, currentApprovedDoes || requestedLocked);
}

async function waitForXchangeBalanceHydration(uid = currentUid(), timeoutMs = 2600) {
  const safeUid = String(uid || "").trim();
  if (!safeUid || safeUid === "guest") return false;
  try {
    if (!soldeModulePromise) {
      soldeModulePromise = import("./solde.js");
    }
    const soldeModule = await soldeModulePromise;
    if (typeof soldeModule?.waitForBalanceHydration === "function") {
      return await soldeModule.waitForBalanceHydration(safeUid, timeoutMs);
    }
  } catch (error) {
    console.warn("[XCHANGE] waitForBalanceHydration unavailable", error);
  }
  return false;
}

function getCachedWallet(uid) {
  return WALLET_CACHE.get(uid) || defaultWallet();
}

function setCachedWallet(uid, data, loaded = true) {
  WALLET_CACHE.set(uid, {
    does: safeInt(data?.does),
    doesApprovedBalance: safeInt(
      typeof data?.doesApprovedBalance === "number"
        ? data.doesApprovedBalance
        : (safeInt(data?.does) - safeInt(data?.doesProvisionalBalance))
    ),
    doesProvisionalBalance: safeInt(data?.doesProvisionalBalance),
    exchangeableDoesAvailable: safeInt(
      typeof data?.doesApprovedBalance === "number"
        ? data.doesApprovedBalance
        : (safeInt(data?.does) - safeInt(data?.doesProvisionalBalance))
    ),
    exchangedGourdes: safeSignedMoney(data?.exchangedGourdes),
    approvedHtgAvailable: safeMoney(data?.approvedHtgAvailable),
    provisionalHtgAvailable: safeMoney(data?.provisionalHtgAvailable),
    welcomeBonusHtgAvailable: safeMoney(data?.welcomeBonusHtgAvailable),
    welcomeBonusHtgConverted: safeMoney(data?.welcomeBonusHtgConverted),
    welcomeBonusHtgPlayed: safeMoney(data?.welcomeBonusHtgPlayed),
    withdrawableHtg: safeMoney(data?.withdrawableHtg),
    accountFrozen: data?.accountFrozen === true,
    freezeReason: String(data?.freezeReason || ""),
    rejectedDepositStrikeCount: safeInt(data?.rejectedDepositStrikeCount),
    pendingPlayFromXchangeDoes: safeInt(data?.pendingPlayFromXchangeDoes),
    pendingPlayFromReferralDoes: safeInt(data?.pendingPlayFromReferralDoes),
    pendingPlayFromWelcomeDoes: safeInt(data?.pendingPlayFromWelcomeDoes),
    totalExchangedHtgEver: safeInt(data?.totalExchangedHtgEver),
    hasRealApprovedDeposit: data?.hasRealApprovedDeposit === true,
    loaded,
  });
}

function buildFundingDebugSnapshot(funding = {}) {
  return {
    approvedDepositsHtg: safeMoney(funding?.approvedDepositsHtg),
    approvedDepositBonusHtg: safeMoney(funding?.approvedDepositBonusHtg),
    reservedWithdrawalsHtg: safeMoney(funding?.reservedWithdrawalsHtg),
    exchangedApprovedHtg: safeMoney(funding?.exchangedApprovedHtg),
    transferSentHtgTotal: safeMoney(funding?.transferSentHtgTotal),
    transferReceivedHtgTotal: safeMoney(funding?.transferReceivedHtgTotal),
    nativeGameEntryApprovedHtgTotal: safeMoney(funding?.nativeGameEntryApprovedHtgTotal),
    nativeGameRewardApprovedHtgTotal: safeMoney(funding?.nativeGameRewardApprovedHtgTotal),
    approvedHtgAvailable: safeMoney(funding?.approvedHtgAvailable),
    provisionalHtgAvailable: safeMoney(funding?.provisionalHtgAvailable),
    playableHtg: safeMoney(funding?.playableHtg),
    withdrawableHtg: safeMoney(funding?.withdrawableHtg),
    pendingOrdersCount: Array.isArray(funding?.pendingOrders) ? funding.pendingOrders.length : 0,
  };
}

function computeFundingDebugDiff(previous = {}, next = {}) {
  const keys = Object.keys(next || {});
  const diff = {};
  keys.forEach((key) => {
    const prevValue = previous?.[key];
    const nextValue = next?.[key];
    if (prevValue !== nextValue) {
      diff[key] = { before: prevValue, after: nextValue };
    }
  });
  return diff;
}

async function syncWalletFundingState(uid = currentUid()) {
  const safeUid = String(uid || "").trim();
  if (!safeUid || safeUid === "guest") {
    return getXchangeState(window.__userBaseBalance || window.__userBalance || 0, safeUid);
  }

  try {
    const funding = await getDepositFundingStatusSecure({});
    if (BALANCE_DEBUG) {
      console.log("[BALANCE_DEBUG][XCHANGE] syncWalletFundingState", {
        uid: safeUid,
        funding,
      });
    }
    if (WELCOME_PROGRESS_DEBUG) {
      const snapshot = buildFundingDebugSnapshot(funding || {});
      const previous = LAST_FUNDING_SNAPSHOT_BY_UID.get(safeUid) || null;
      const diff = previous ? computeFundingDebugDiff(previous, snapshot) : {};
      console.log("[WELCOME_PROGRESS_DEBUG][XCHANGE] funding sync", {
        uid: safeUid,
        approvedHtgAvailable: funding?.approvedHtgAvailable,
        provisionalHtgAvailable: funding?.provisionalHtgAvailable,
        playableHtg: funding?.playableHtg,
        withdrawableHtg: funding?.withdrawableHtg,
        approvedDepositsHtg: funding?.approvedDepositsHtg,
        approvedDepositBonusHtg: funding?.approvedDepositBonusHtg,
        reservedWithdrawalsHtg: funding?.reservedWithdrawalsHtg,
        exchangedApprovedHtg: funding?.exchangedApprovedHtg,
        totalExchangedApprovedHtg: funding?.totalExchangedApprovedHtg,
        transferSentHtgTotal: funding?.transferSentHtgTotal,
        transferReceivedHtgTotal: funding?.transferReceivedHtgTotal,
        nativeGameEntryApprovedHtgTotal: funding?.nativeGameEntryApprovedHtgTotal,
        nativeGameRewardApprovedHtgTotal: funding?.nativeGameRewardApprovedHtgTotal,
        approvedDoesBalance: funding?.approvedDoesBalance,
        exchangeableDoesAvailable: funding?.exchangeableDoesAvailable,
        pendingPlayFromWelcomeDoes: funding?.pendingPlayFromWelcomeDoes,
        welcomeBonusHtgConverted: funding?.welcomeBonusHtgConverted,
        welcomeBonusHtgPlayed: funding?.welcomeBonusHtgPlayed,
        hasRealApprovedDeposit: funding?.hasRealApprovedDeposit === true,
        pendingOrders: Array.isArray(funding?.pendingOrders) ? funding.pendingOrders : [],
        debugOrders: Array.isArray(funding?.debugOrders) ? funding.debugOrders : [],
        previousSnapshot: previous,
        currentSnapshot: snapshot,
        changedFields: diff,
      });
      LAST_FUNDING_SNAPSHOT_BY_UID.set(safeUid, snapshot);
    }
    setCachedWallet(safeUid, {
      does: safeInt(funding?.doesBalance),
      doesApprovedBalance: safeInt(funding?.approvedDoesBalance),
      doesProvisionalBalance: safeInt(funding?.provisionalDoesBalance),
      exchangeableDoesAvailable: safeInt(funding?.exchangeableDoesAvailable),
      exchangedGourdes: safeSignedMoney(funding?.exchangedApprovedHtg),
      approvedHtgAvailable: safeMoney(funding?.approvedHtgAvailable),
      provisionalHtgAvailable: safeMoney(funding?.provisionalHtgAvailable),
      welcomeBonusHtgAvailable: safeMoney(funding?.welcomeBonusHtgAvailable),
      welcomeBonusHtgConverted: safeMoney(funding?.welcomeBonusHtgConverted),
      welcomeBonusHtgPlayed: safeMoney(funding?.welcomeBonusHtgPlayed),
      withdrawableHtg: safeMoney(funding?.withdrawableHtg),
      accountFrozen: funding?.accountFrozen === true,
      freezeReason: String(funding?.freezeReason || ""),
      rejectedDepositStrikeCount: safeInt(funding?.rejectedDepositStrikeCount),
      pendingPlayFromXchangeDoes: safeInt(funding?.pendingPlayFromXchangeDoes),
      pendingPlayFromReferralDoes: safeInt(funding?.pendingPlayFromReferralDoes),
      pendingPlayFromWelcomeDoes: safeInt(funding?.pendingPlayFromWelcomeDoes),
      totalExchangedHtgEver: safeInt(funding?.totalExchangedApprovedHtg),
      hasRealApprovedDeposit: funding?.hasRealApprovedDeposit === true,
    }, true);
    if (funding?.hasRealApprovedDeposit === true || safeInt(funding?.pendingPlayFromWelcomeDoes) <= 0) {
      clearWelcomeLockedSellAttempt(safeUid);
    }
    return emitXchangeUpdated(safeUid);
  } catch (error) {
    console.warn("[XCHANGE] syncWalletFundingState failed", error);
    return getXchangeState(window.__userBaseBalance || window.__userBalance || 0, safeUid);
  }
}

function emitXchangeUpdated(uid = currentUid()) {
  const updated = getXchangeState(window.__userBaseBalance || window.__userBalance || 0, uid);
  if (BALANCE_DEBUG) {
    console.log("[BALANCE_DEBUG][XCHANGE] emitXchangeUpdated", {
      uid,
      __userBaseBalance: window.__userBaseBalance,
      __userBalance: window.__userBalance,
      updated,
    });
  }
  window.dispatchEvent(new CustomEvent("xchangeUpdated", { detail: updated }));
  return updated;
}

function startWalletWatcher(uid) {
  if (walletUnsub) {
    clearInterval(walletUnsub);
    walletUnsub = null;
  }
  if (!uid || uid === "guest") return;
  void syncWalletFundingState(uid);
  walletUnsub = setInterval(() => {
    if (document.visibilityState !== "visible") return;
    if (String(auth.currentUser?.uid || "") !== String(uid || "")) return;
    void syncWalletFundingState(uid);
  }, XCHANGE_REFRESH_MS);

  if (!walletVisibilityBound) {
    walletVisibilityBound = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState !== "visible") return;
      const visibleUid = String(auth.currentUser?.uid || "");
      if (!visibleUid || visibleUid === "guest") return;
      void syncWalletFundingState(visibleUid);
    });
  }
}

async function applyWalletMutation({ uid, deltaDoes = 0, deltaExchangedGourdes = 0, type = "mutation", note = "", amountGourdes = 0, amountDoes = 0 }) {
  if (!uid || uid === "guest") {
    return { ok: false, does: 0, error: "Utilisateur non connecté" };
  }

  try {
    let result = null;
    if (type === "xchange_buy") {
      result = await walletMutateSecure({
        op: "xchange_buy",
        amountGourdes: safeInt(amountGourdes),
      });
    } else if (type === "xchange_sell") {
      result = await walletMutateSecure({
        op: "xchange_sell",
        amountDoes: safeInt(amountDoes),
      });
    } else if (type === "game_entry") {
      result = await walletMutateSecure({
        op: "game_entry",
        amountDoes: safeInt(amountDoes),
      });
    } else {
      throw new Error(`Mutation wallet non supportée côté client: ${type}`);
    }

    const nextDoes = safeInt(result?.does);
    const nextExchanged = safeSignedMoney(result?.exchangedGourdes);
    const nextApprovedDoes = safeInt(result?.doesApprovedBalance);
    const nextProvisionalDoes = safeInt(result?.doesProvisionalBalance);
    const nextExchangeableDoes = safeInt(result?.exchangeableDoesAvailable);
    const nextPendingFromXchange = safeInt(result?.pendingPlayFromXchangeDoes);
    const nextPendingFromReferral = safeInt(result?.pendingPlayFromReferralDoes);
    const nextPendingFromWelcome = safeInt(result?.pendingPlayFromWelcomeDoes);
    const nextTotalExchanged = safeInt(result?.totalExchangedHtgEver);
    const nextWelcomeBonusHtgAvailable = safeMoney(result?.welcomeBonusHtgAvailable);
    const nextWelcomeBonusHtgConverted = safeMoney(result?.welcomeBonusHtgConverted);
    const nextWelcomeBonusHtgPlayed = safeMoney(result?.welcomeBonusHtgPlayed);

    setCachedWallet(uid, {
      does: nextDoes,
      doesApprovedBalance: nextApprovedDoes,
      doesProvisionalBalance: nextProvisionalDoes,
      exchangeableDoesAvailable: nextExchangeableDoes,
      exchangedGourdes: nextExchanged,
      pendingPlayFromXchangeDoes: nextPendingFromXchange,
      pendingPlayFromReferralDoes: nextPendingFromReferral,
      pendingPlayFromWelcomeDoes: nextPendingFromWelcome,
      welcomeBonusHtgAvailable: nextWelcomeBonusHtgAvailable,
      welcomeBonusHtgConverted: nextWelcomeBonusHtgConverted,
      welcomeBonusHtgPlayed: nextWelcomeBonusHtgPlayed,
      totalExchangedHtgEver: nextTotalExchanged,
      hasRealApprovedDeposit: getCachedWallet(uid).hasRealApprovedDeposit === true,
    }, true);
    if (BALANCE_DEBUG) {
      console.log("[BALANCE_DEBUG][XCHANGE] applyWalletMutation success", {
        uid,
        type,
        deltaDoes,
        deltaExchangedGourdes,
        amountGourdes,
        amountDoes,
        afterDoes: nextDoes,
        afterApprovedDoes: nextApprovedDoes,
        afterProvisionalDoes: nextProvisionalDoes,
        exchangeableDoesAvailable: nextExchangeableDoes,
        afterExchanged: nextExchanged,
        pendingPlayFromXchangeDoes: nextPendingFromXchange,
        pendingPlayFromReferralDoes: nextPendingFromReferral,
        pendingPlayFromWelcomeDoes: nextPendingFromWelcome,
        welcomeBonusHtgAvailable: nextWelcomeBonusHtgAvailable,
        welcomeBonusHtgConverted: nextWelcomeBonusHtgConverted,
        welcomeBonusHtgPlayed: nextWelcomeBonusHtgPlayed,
        totalExchangedHtgEver: nextTotalExchanged,
      });
    }
    if (WELCOME_PROGRESS_DEBUG) {
      console.log("[WELCOME_PROGRESS_DEBUG][XCHANGE] mutation success", {
        uid,
        type,
        amountDoes,
        afterApprovedDoes: nextApprovedDoes,
        exchangeableDoesAvailable: nextExchangeableDoes,
        pendingPlayFromWelcomeDoes: nextPendingFromWelcome,
        welcomeBonusHtgConverted: nextWelcomeBonusHtgConverted,
        welcomeBonusHtgPlayed: nextWelcomeBonusHtgPlayed,
      });
    }
    emitXchangeUpdated(uid);
    return { ok: true, does: nextDoes };
  } catch (err) {
    if (type === "xchange_buy" || type === "xchange_sell") {
      await syncWalletFundingState(uid);
    }
    console.error("[XCHANGE] applyWalletMutation error", err);
    return {
      ok: false,
      does: getCachedWallet(uid).does,
      error: err?.message || "Erreur mutation wallet",
      code: err?.code || "",
      pendingPlayFromXchangeDoes: safeInt(err?.pendingPlayFromXchangeDoes),
      pendingPlayFromReferralDoes: safeInt(err?.pendingPlayFromReferralDoes),
      pendingPlayFromWelcomeDoes: safeInt(err?.pendingPlayFromWelcomeDoes),
      pendingPlayTotalDoes: safeInt(err?.pendingPlayTotalDoes),
      exchangeableDoesAvailable: safeInt(err?.exchangeableDoesAvailable),
    };
  }
}

export async function ensureXchangeState(uid = currentUid()) {
  const hydrated = await waitForXchangeBalanceHydration(uid, 2600);
  const state = await syncWalletFundingState(uid);
  if (BALANCE_DEBUG) {
    console.log("[BALANCE_DEBUG][XCHANGE] ensureXchangeState", {
      uid,
      hydrated,
      __userBaseBalance: window.__userBaseBalance,
      __userBalance: window.__userBalance,
      state,
    });
  }
  return state;
}

export function getXchangeState(balance = 0, uid = currentUid()) {
  const wallet = getCachedWallet(uid);
  const totalBalance = safeInt(balance);
  const exchanged = safeSignedInt(wallet.exchangedGourdes);
  const hasNonEmptyFundingBreakdown = (
    safeInt(wallet.approvedHtgAvailable) > 0
    || safeInt(wallet.provisionalHtgAvailable) > 0
    || safeInt(wallet.welcomeBonusHtgAvailable) > 0
    || safeInt(wallet.withdrawableHtg) > 0
    || safeInt(wallet.doesApprovedBalance) > 0
    || safeInt(wallet.doesProvisionalBalance) > 0
  );
  const shouldFallbackToLegacyBalance = wallet.loaded === true
    && !hasNonEmptyFundingBreakdown
    && totalBalance > 0;
  const hasFundingBreakdown = wallet.loaded === true && !shouldFallbackToLegacyBalance;
  const approvedGourdesAvailable = hasFundingBreakdown
    ? safeInt(wallet.approvedHtgAvailable)
    : Math.max(0, totalBalance - exchanged);
  const provisionalGourdesAvailable = hasFundingBreakdown
    ? safeInt(wallet.provisionalHtgAvailable)
    : 0;
  const welcomeBonusGourdesAvailable = hasFundingBreakdown
    ? safeInt(wallet.welcomeBonusHtgAvailable)
    : 0;
  const available = approvedGourdesAvailable + provisionalGourdesAvailable + welcomeBonusGourdesAvailable;
  return {
    totalBalance: hasFundingBreakdown ? available : totalBalance,
    availableGourdes: available,
    approvedGourdesAvailable,
    provisionalGourdesAvailable,
    welcomeBonusHtgAvailable: welcomeBonusGourdesAvailable,
    welcomeBonusHtgConverted: safeInt(wallet.welcomeBonusHtgConverted),
    welcomeBonusHtgPlayed: safeInt(wallet.welcomeBonusHtgPlayed),
    exchangedGourdes: exchanged,
    does: safeInt(wallet.does),
    doesApprovedBalance: safeInt(wallet.doesApprovedBalance),
    doesProvisionalBalance: safeInt(wallet.doesProvisionalBalance),
    exchangeableDoesAvailable: safeInt(wallet.exchangeableDoesAvailable),
    withdrawableHtg: safeInt(wallet.withdrawableHtg),
    accountFrozen: wallet.accountFrozen === true,
    freezeReason: String(wallet.freezeReason || ""),
    rejectedDepositStrikeCount: safeInt(wallet.rejectedDepositStrikeCount),
    pendingPlayFromXchangeDoes: safeInt(wallet.pendingPlayFromXchangeDoes),
    pendingPlayFromReferralDoes: safeInt(wallet.pendingPlayFromReferralDoes),
    pendingPlayFromWelcomeDoes: safeInt(wallet.pendingPlayFromWelcomeDoes),
    pendingPlayTotalDoes: safeInt(wallet.pendingPlayFromXchangeDoes) + safeInt(wallet.pendingPlayFromReferralDoes) + safeInt(wallet.pendingPlayFromWelcomeDoes),
    totalExchangedHtgEver: safeInt(wallet.totalExchangedHtgEver),
    hasRealApprovedDeposit: wallet.hasRealApprovedDeposit === true,
    rate: RATE_HTG_TO_DOES,
    loaded: wallet.loaded === true,
  };
}

function updateWelcomeLockUi(overlay, state) {
  const noticeEl = overlay?.querySelector("#xchangeWelcomeLockNotice");
  const titleEl = overlay?.querySelector("#xchangeWelcomeLockTitle");
  const bodyEl = overlay?.querySelector("#xchangeWelcomeLockBody");
  const inlineLineEl = overlay?.querySelector("#xchangeLockedWelcomeDoesLine");
  const inlineValueEl = overlay?.querySelector("#xchangeLockedWelcomeDoes");
  if (!noticeEl || !titleEl || !bodyEl || !inlineLineEl || !inlineValueEl) return;

  const blockedWelcomeDoes = getVisibleLockedWelcomeDoes(state, currentUid());
  const showNotice = blockedWelcomeDoes > 0;

  if (!showNotice) {
    noticeEl.classList.add("hidden");
    inlineLineEl.classList.add("hidden");
    return;
  }

  titleEl.textContent = "Does bonus temporairement bloques";
  bodyEl.textContent = `${blockedWelcomeDoes} Does de ta demande d'echange sont bloques jusqu'a l'approbation de ton premier depot reel.`;
  inlineValueEl.textContent = String(blockedWelcomeDoes);
  inlineLineEl.classList.remove("hidden");
  noticeEl.classList.remove("hidden");
}

export function getDoesBalance(uid = currentUid()) {
  return safeInt(getCachedWallet(uid).does);
}

export async function spendDoes(amount, uid = currentUid(), note = "Participation partie") {
  const cost = safeInt(amount);
  if (cost <= 0) return { ok: true, does: getDoesBalance(uid) };
  return applyWalletMutation({
    uid,
    deltaDoes: -cost,
    type: "game_entry",
    note,
    amountDoes: cost,
  });
}

export async function rewardDoes(amount, uid = currentUid(), note = "Gain de partie") {
  const bonus = safeInt(amount);
  if (bonus <= 0) return { ok: true, does: getDoesBalance(uid) };
  return {
    ok: false,
    does: getDoesBalance(uid),
    error: "Mutation game_reward désactivée côté client. Utilise claimWinReward.",
  };
}

async function exchangeHtgToDoes(amountHtg, uid = currentUid()) {
  const amount = safeInt(amountHtg);
  if (amount <= 0) return { ok: false, error: "Montant invalide" };
  return applyWalletMutation({
    uid,
    deltaDoes: amount * RATE_HTG_TO_DOES,
    deltaExchangedGourdes: amount,
    type: "xchange_buy",
    note: "Conversion HTG vers Does",
    amountGourdes: amount,
    amountDoes: amount * RATE_HTG_TO_DOES,
  });
}

async function exchangeDoesToHtg(amountDoes, uid = currentUid()) {
  const amount = safeInt(amountDoes);
  if (amount <= 0) return { ok: false, error: "Montant invalide" };
  const backToHtg = amount / RATE_HTG_TO_DOES;
  return applyWalletMutation({
    uid,
    deltaDoes: -amount,
    deltaExchangedGourdes: -backToHtg,
    type: "xchange_sell",
    note: "Conversion Does vers HTG",
    amountGourdes: backToHtg,
    amountDoes: amount,
  });
}

function ensureXchangeRuleModal() {
  const existing = document.getElementById("xchangeRuleModalOverlay");
  if (existing) return existing;

  const overlay = document.createElement("div");
  overlay.id = "xchangeRuleModalOverlay";
  overlay.className = "fixed inset-0 z-[3450] hidden items-center justify-center bg-black/50 p-4 backdrop-blur-sm";
  overlay.innerHTML = `
    <div id="xchangeRuleModalPanel" class="w-full max-w-md rounded-3xl border border-white/20 bg-[#3F4766]/75 p-5 text-white shadow-[14px_14px_34px_rgba(16,23,40,0.5),-10px_-10px_24px_rgba(112,126,165,0.2)] backdrop-blur-xl sm:p-6">
      <h3 id="xchangeRuleModalTitle" class="text-lg font-bold">Action bloquée</h3>
      <p id="xchangeRuleModalMessage" class="mt-2 text-sm text-white/90"></p>
      <div id="xchangeRuleModalDetails" class="mt-3 rounded-2xl border border-white/20 bg-white/10 p-3 text-xs text-white/85"></div>
      <button id="xchangeRuleModalClose" type="button" class="mt-4 h-11 w-full rounded-2xl border border-[#ffb26e] bg-[#F57C00] text-sm font-semibold text-white shadow-[8px_8px_18px_rgba(163,82,27,0.45),-6px_-6px_14px_rgba(255,175,102,0.22)]">
        Compris
      </button>
    </div>
  `;
  document.body.appendChild(overlay);

  const panel = overlay.querySelector("#xchangeRuleModalPanel");
  const closeBtn = overlay.querySelector("#xchangeRuleModalClose");
  const close = () => {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
  };
  if (closeBtn) closeBtn.addEventListener("click", close);
  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  if (panel) panel.addEventListener("click", (ev) => ev.stopPropagation());
  overlay.__close = close;
  return overlay;
}

function showXchangeRuleModal(payload = {}) {
  const overlay = ensureXchangeRuleModal();
  const titleEl = overlay.querySelector("#xchangeRuleModalTitle");
  const messageEl = overlay.querySelector("#xchangeRuleModalMessage");
  const detailsEl = overlay.querySelector("#xchangeRuleModalDetails");
  const lines = Array.isArray(payload.lines) ? payload.lines.filter(Boolean) : [];

  if (titleEl) titleEl.textContent = payload.title || "Action bloquée";
  if (messageEl) messageEl.textContent = payload.message || "Cette action n'est pas autorisée pour le moment.";
  if (detailsEl) {
    detailsEl.textContent = "";
    const safeLines = lines.length > 0 ? lines : ["Respecte les règles de conversion pour continuer."];
    safeLines.forEach((line) => {
      const p = document.createElement("p");
      p.textContent = String(line || "");
      detailsEl.appendChild(p);
    });
  }

  overlay.classList.remove("hidden");
  overlay.classList.add("flex");
}

function ensureXchangeModal() {
  const existing = document.getElementById("xchangeModalOverlay");
  if (existing) return existing;

  const overlay = document.createElement("div");
  overlay.id = "xchangeModalOverlay";
  overlay.className = "fixed inset-0 z-[3200] hidden items-center justify-center bg-black/45 p-4 backdrop-blur-sm";

  overlay.innerHTML = `
    <div id="xchangePanel" class="w-full max-w-md rounded-3xl border border-white/20 bg-[#3F4766]/55 p-5 shadow-[14px_14px_34px_rgba(16,23,40,0.5),-10px_-10px_24px_rgba(112,126,165,0.2)] backdrop-blur-xl sm:p-6">
      <div class="flex items-center justify-between">
        <div>
          <p class="text-xs font-semibold uppercase tracking-[0.16em] text-white/70">Xchange</p>
          <h3 class="mt-1 text-xl font-bold text-white">Xchange en crypto</h3>
        </div>
        <button id="xchangeClose" type="button" class="grid h-10 w-10 place-items-center rounded-full border border-white/20 bg-white/10 text-white">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div class="mt-4 rounded-2xl border border-white/20 bg-white/10 p-4 text-sm text-white/90">
        <p>1 Gourde = <span class="font-semibold text-white">20 Does</span></p>
        <p class="mt-1">Solde HTG: <span id="xchangeAvailableHtg" class="font-semibold text-white">0</span> HTG</p>
        <p class="mt-1">Solde Does: <span id="xchangeAvailableDoes" class="font-semibold text-white">0</span> Does</p>
        <p id="xchangeLockedWelcomeDoesLine" class="mt-1 hidden text-[#ffd89a]">Does bonus bloques: <span id="xchangeLockedWelcomeDoes" class="font-semibold text-[#fff3d1]">0</span> Does</p>
      </div>

      <div id="xchangeWelcomeLockNotice" class="mt-4 hidden rounded-2xl border border-[#f6c177]/40 bg-[#5b4020]/55 p-4 text-sm text-[#fff5df] shadow-[inset_6px_6px_12px_rgba(48,31,10,0.28),inset_-4px_-4px_10px_rgba(146,107,54,0.1)]">
        <p id="xchangeWelcomeLockTitle" class="font-semibold text-[#ffd89a]">Does bonus temporairement bloques</p>
        <p id="xchangeWelcomeLockBody" class="mt-1 text-[#fff1d4]"></p>
      </div>

      <div class="mt-4 grid grid-cols-2 gap-2 rounded-2xl border border-white/20 bg-white/10 p-2">
        <button id="xchangeModeBuy" type="button" class="h-10 rounded-xl border border-[#ffb26e] bg-[#F57C00] text-sm font-semibold text-white transition hover:-translate-y-0.5">
          HTG vers Does
        </button>
        <button id="xchangeModeSell" type="button" class="h-10 rounded-xl border border-white/20 bg-white/10 text-sm font-semibold text-white/85 transition hover:bg-white/15">
          Does vers HTG
        </button>
      </div>

      <div class="mt-4 rounded-2xl border border-white/20 bg-white/10 p-4 shadow-[inset_6px_6px_12px_rgba(19,26,43,0.42),inset_-6px_-6px_12px_rgba(120,134,172,0.22)]">
        <label for="xchangeAmount" id="xchangeAmountLabel" class="block text-sm font-medium text-white/90">Montant à échanger (HTG)</label>
        <input id="xchangeAmount" type="number" min="1" step="1" inputmode="numeric" class="mt-2 h-12 w-full rounded-xl border border-white/25 bg-white/10 px-4 text-white outline-none" />
        <p id="xchangeHint" class="mt-2 text-xs text-white/70">Décimales non autorisées.</p>
      </div>

      <div class="mt-4 rounded-2xl border border-white/20 bg-white/10 p-4 text-sm text-white/90">
        <div class="flex items-center gap-2">
          <img src="./does.png" alt="Does" class="h-5 w-5 rounded-full object-cover" data-hide-on-error="1" />
          <p id="xchangePreviewText">Vous recevrez: <span id="xchangePreview" class="font-semibold text-white">0</span> Does</p>
        </div>
      </div>

      <div id="xchangeError" class="mt-3 min-h-5 text-sm text-[#ffb0b0]"></div>

      <button id="xchangeSubmit" type="button" class="mt-2 h-12 w-full rounded-2xl border border-[#ffb26e] bg-[#F57C00] font-semibold text-white shadow-[9px_9px_20px_rgba(155,78,25,0.45),-7px_-7px_16px_rgba(255,173,96,0.2)] transition hover:-translate-y-0.5">
        Xchanger
      </button>
    </div>
  `;

  document.body.appendChild(overlay);
  bindHideOnErrorImages(overlay);

  const panel = overlay.querySelector("#xchangePanel");
  const closeBtn = overlay.querySelector("#xchangeClose");
  const amountInput = overlay.querySelector("#xchangeAmount");
  const previewTextEl = overlay.querySelector("#xchangePreviewText");
  const availableHtgEl = overlay.querySelector("#xchangeAvailableHtg");
  const availableDoesEl = overlay.querySelector("#xchangeAvailableDoes");
  const modeBuyBtn = overlay.querySelector("#xchangeModeBuy");
  const modeSellBtn = overlay.querySelector("#xchangeModeSell");
  const amountLabelEl = overlay.querySelector("#xchangeAmountLabel");
  const hintEl = overlay.querySelector("#xchangeHint");
  const errorEl = overlay.querySelector("#xchangeError");
  const submitBtn = overlay.querySelector("#xchangeSubmit");
  let mode = "buy";
  const getPreviewNode = () => overlay.querySelector("#xchangePreview");

  const setModeUi = (nextMode, state) => {
    mode = nextMode;
    const safeState = state || getXchangeState(window.__userBaseBalance || window.__userBalance || 0, currentUid());

    if (modeBuyBtn) {
      modeBuyBtn.className = mode === "buy"
        ? "h-10 rounded-xl border border-[#ffb26e] bg-[#F57C00] text-sm font-semibold text-white transition hover:-translate-y-0.5"
        : "h-10 rounded-xl border border-white/20 bg-white/10 text-sm font-semibold text-white/85 transition hover:bg-white/15";
    }
    if (modeSellBtn) {
      modeSellBtn.className = mode === "sell"
        ? "h-10 rounded-xl border border-[#ffb26e] bg-[#F57C00] text-sm font-semibold text-white transition hover:-translate-y-0.5"
        : "h-10 rounded-xl border border-white/20 bg-white/10 text-sm font-semibold text-white/85 transition hover:bg-white/15";
    }

    if (amountLabelEl) {
      amountLabelEl.textContent = mode === "buy"
        ? "Montant à échanger (HTG)"
        : "Montant à convertir (Does)";
    }
    if (hintEl) {
      hintEl.textContent = mode === "buy"
        ? "Décimales non autorisées."
        : `Décimales non autorisées. Le montant doit être multiple de ${RATE_HTG_TO_DOES} Does.`;
    }
    if (previewTextEl) {
      const currentPreview = String(getPreviewNode()?.textContent || "0");
      previewTextEl.textContent = "";
      const label = document.createTextNode("Vous recevrez: ");
      const value = document.createElement("span");
      value.id = "xchangePreview";
      value.className = "font-semibold text-white";
      value.textContent = currentPreview;
      const suffix = document.createTextNode(mode === "buy" ? " Does" : " HTG");
      previewTextEl.appendChild(label);
      previewTextEl.appendChild(value);
      previewTextEl.appendChild(suffix);
    }
    if (availableHtgEl) availableHtgEl.textContent = String(safeState.availableGourdes);
    if (availableDoesEl) availableDoesEl.textContent = String(safeState.does || 0);
    updateWelcomeLockUi(overlay, safeState);
  };

  const refreshPreview = () => {
    const raw = String(amountInput?.value || "").trim();
    const amount = /^\d+$/.test(raw) ? Number(raw) : 0;
    const value = mode === "buy" ? amount * RATE_HTG_TO_DOES : Math.floor(amount / RATE_HTG_TO_DOES);
    const previewNode = getPreviewNode();
    if (previewNode) previewNode.textContent = String(value);
  };

  const close = () => {
    overlay.classList.add("hidden");
    overlay.classList.remove("flex");
    if (errorEl) errorEl.textContent = "";
  };

  const open = async () => {
    const state = await ensureXchangeState(currentUid());
    if (state.accountFrozen) {
      showXchangeRuleModal({
        title: "Compte gelé",
        message: "Ton compte a été temporairement gelé après plusieurs dépôts refusés. Contacte l'assistance.",
        lines: [
          "Le dépôt, le retrait, le Xchange et les parties sont bloqués.",
          "Le support reste disponible pour demander un dégel.",
        ],
      });
      return;
    }
    if (availableHtgEl) availableHtgEl.textContent = String(state.availableGourdes);
    if (availableDoesEl) availableDoesEl.textContent = String(state.does || 0);
    updateWelcomeLockUi(overlay, state);
    if (amountInput) amountInput.value = "";
    if (errorEl) errorEl.textContent = "";
    setModeUi("buy", state);
    const previewNode = getPreviewNode();
    if (previewNode) previewNode.textContent = "0";
    overlay.classList.remove("hidden");
    overlay.classList.add("flex");
  };

  overlay.addEventListener("click", (ev) => {
    if (ev.target === overlay) close();
  });
  if (panel) panel.addEventListener("click", (ev) => ev.stopPropagation());
  if (closeBtn) closeBtn.addEventListener("click", close);
  if (amountInput) amountInput.addEventListener("input", refreshPreview);
  if (modeBuyBtn) {
    modeBuyBtn.addEventListener("click", async () => {
      await withButtonLoading(modeBuyBtn, async () => {
        const state = await ensureXchangeState(currentUid());
        if (amountInput) amountInput.value = "";
        if (errorEl) errorEl.textContent = "";
        setModeUi("buy", state);
        refreshPreview();
      }, { loadingLabel: "..." });
    });
  }
  if (modeSellBtn) {
    modeSellBtn.addEventListener("click", async () => {
      await withButtonLoading(modeSellBtn, async () => {
        const state = await ensureXchangeState(currentUid());
        if (amountInput) amountInput.value = "";
        if (errorEl) errorEl.textContent = "";
        setModeUi("sell", state);
        refreshPreview();
      }, { loadingLabel: "..." });
    });
  }

  if (submitBtn) {
    submitBtn.addEventListener("click", async () => {
      await withButtonLoading(submitBtn, async () => {
        const state = await ensureXchangeState(currentUid());
        const raw = String(amountInput?.value || "").trim();

        if (!/^\d+$/.test(raw)) {
          if (errorEl) errorEl.textContent = "Entrez un nombre entier valide.";
          return;
        }

        const amount = Number(raw);
        if (BALANCE_DEBUG) {
          console.log("[BALANCE_DEBUG][XCHANGE] submit attempt", {
            uid: currentUid(),
            mode,
            raw,
            amount,
            state,
          });
        }
        if (amount <= 0) {
          if (errorEl) errorEl.textContent = "Le montant doit être supérieur à zéro.";
          return;
        }

        if (mode === "buy") {
          if (state.accountFrozen) {
            if (errorEl) errorEl.textContent = "Compte gelé. Contacte l'assistance.";
            return;
          }
          if (amount > state.availableGourdes) {
            if (errorEl) errorEl.textContent = "Montant supérieur au solde disponible.";
            return;
          }
          const res = await exchangeHtgToDoes(amount, currentUid());
          if (!res.ok) {
            if (errorEl) errorEl.textContent = res.error || "Erreur de conversion.";
            return;
          }
        } else {
          if (state.accountFrozen) {
            if (errorEl) errorEl.textContent = "Compte gelé. Contacte l'assistance.";
            return;
          }
          if (amount > state.exchangeableDoesAvailable) {
            if (errorEl) errorEl.textContent = "Montant supérieur aux Does actuellement échangeables.";
            return;
          }
          const res = await exchangeDoesToHtg(amount, currentUid());
          if (!res.ok) {
            if (res.code === "account-frozen") {
              showXchangeRuleModal({
                title: "Compte gelé",
                message: res.error || "Ton compte a été temporairement gelé après plusieurs dépôts refusés.",
                lines: ["Contacte l'assistance pour demander un dégel."],
              });
            }
            if (res.code === "play-required-before-sell") {
              const pendingFromXchange = safeInt(res.pendingPlayFromXchangeDoes);
              const pendingFromReferral = safeInt(res.pendingPlayFromReferralDoes);
              const pendingFromWelcome = safeInt(res.pendingPlayFromWelcomeDoes);
              const pendingTotal = safeInt(res.pendingPlayTotalDoes || (pendingFromXchange + pendingFromReferral + pendingFromWelcome));
              const exchangeableDoesAvailable = safeInt(res.exchangeableDoesAvailable);
              const requestedBlockedDoes = Math.min(
                pendingFromWelcome,
                Math.max(0, amount - exchangeableDoesAvailable)
              );
              if (requestedBlockedDoes > 0) {
                writeWelcomeLockedSellAttempt(currentUid(), requestedBlockedDoes);
              }
              const lines = [
                `Reste a jouer (Does achetes): ${pendingFromXchange} Does`,
                `Reste a jouer (bonus parrainage): ${pendingFromReferral} Does`,
              ];
              if (pendingFromWelcome > 0) {
                lines.push(`Demande gelee jusqu'au premier depot approuve: ${requestedBlockedDoes} Does`);
              }
              lines.push(`Total encore bloque: ${pendingTotal} Does`);
              lines.push(
                pendingFromWelcome > 0
                  ? "Fais approuver un vrai depot pour debloquer les Does issus du bonus bienvenue."
                  : "Joue des parties pour debloquer plus de reconversion."
              );
              showXchangeRuleModal({
                title: "Conversion bloquée",
                message: pendingFromWelcome > 0
                  ? `Tu peux reconvertir ${exchangeableDoesAvailable} Does pour le moment. Une partie vient du bonus bienvenue et attend un depot approuve.`
                  : `Tu peux reconvertir ${exchangeableDoesAvailable} Does pour le moment. Le reste sera debloque en jouant.`,
                lines,
              });
            }
            if (errorEl) errorEl.textContent = res.error || "Erreur de conversion.";
            return;
          }
        }

        close();
      }, { loadingLabel: "Conversion..." });
    });
  }

  overlay.__openXchange = open;
  return overlay;
}

export function mountXchangeModal(options = {}) {
  const { triggerSelector = "#profileXchangeBtn" } = options;
  const overlay = ensureXchangeModal();
  const trigger = document.querySelector(triggerSelector);

  if (trigger && overlay.__openXchange && !trigger.dataset.boundXchange) {
    trigger.dataset.boundXchange = "1";
    trigger.addEventListener("click", () => {
      overlay.__openXchange();
    });
  }
}

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    activeUid = null;
    if (walletUnsub) {
      clearInterval(walletUnsub);
      walletUnsub = null;
    }
    emitXchangeUpdated("guest");
    return;
  }

  activeUid = user.uid;
  startWalletWatcher(activeUid);
  emitXchangeUpdated(activeUid);
});
