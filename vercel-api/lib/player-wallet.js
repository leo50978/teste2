const crypto = require("crypto");

const { db } = require("./firebase-admin");
const { computeOrderAmount, getOrderResolutionStatus, sanitizeEmail } = require("./deposits");
const { makeHttpError } = require("./http");
const { safeInt, safeSignedInt, sanitizePhone, sanitizeText } = require("./safe");

const WELCOME_BONUS_ORDER_TYPE = "welcome_bonus";
const WELCOME_BONUS_HTG_AMOUNT = 25;
const WELCOME_BONUS_LAUNCH_AT_MS = 1774142207000;
const WELCOME_BONUS_END_AT_MS = Date.parse("2026-04-02T03:59:59.999Z");

const HTG_TRANSFER_MIN_HTG = 25;
const HTG_TRANSFER_FEE_HTG = 5;
const HTG_TRANSFER_TIME_ZONE = "America/Port-au-Prince";
const HTG_TRANSFER_COLLECTION = "htgTransfers";

const MIN_WITHDRAWAL_HTG = 50;
const MAX_WITHDRAWAL_HTG = 500000;

function walletRef(uid) {
  return db.collection("clients").doc(String(uid || "").trim());
}

function transferHistoryRef(uid) {
  return walletRef(uid).collection("transfers");
}

function transferLedgerRef() {
  return db.collection(HTG_TRANSFER_COLLECTION);
}

function sanitizeUsername(value = "", maxLength = 24) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, Math.max(0, maxLength));
}

function sanitizePublicAsset(value, maxLength = 400) {
  const out = sanitizeText(value, maxLength);
  if (!out) return "";
  if (/^(https:\/\/|\.\/|\/)/i.test(out)) return out;
  return "";
}

function normalizeWelcomeBonusPromptStatus(value = "") {
  const normalized = sanitizeText(value || "", 24).toLowerCase();
  return ["pending", "accepted", "declined"].includes(normalized) ? normalized : "";
}

function generateWelcomeBonusProofCode(uid = "") {
  const safeUid = String(uid || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const suffix = safeUid ? safeUid.slice(0, 6) : crypto.randomBytes(3).toString("hex").toUpperCase();
  return `CLIENT-${suffix}-BONUS`;
}

function generateReferralCode(uid = "") {
  const safeUid = String(uid || "").replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  const suffix = safeUid ? safeUid.slice(0, 8) : crypto.randomBytes(4).toString("hex").toUpperCase();
  return `KOB-${suffix}`;
}

function computeReservedWithdrawalAmount(withdrawal = {}) {
  return safeInt(withdrawal?.requestedAmount ?? withdrawal?.amount);
}

function getWithdrawalStatus(withdrawal = {}) {
  const resolution = String(withdrawal?.resolutionStatus || "").trim().toLowerCase();
  if (["approved", "rejected", "pending", "review", "cancelled", "canceled"].includes(resolution)) {
    return resolution;
  }

  const status = String(withdrawal?.status || "").trim().toLowerCase();
  if (["approved", "rejected", "pending", "review", "cancelled", "canceled"].includes(status)) {
    return status;
  }

  return "pending";
}

function isWithdrawalReservedStatus(withdrawalOrStatus = "") {
  const normalized = typeof withdrawalOrStatus === "object" && withdrawalOrStatus
    ? getWithdrawalStatus(withdrawalOrStatus)
    : String(withdrawalOrStatus || "").trim().toLowerCase();
  return normalized !== "rejected" && normalized !== "cancelled" && normalized !== "canceled";
}

function isWithdrawalClientCancellableStatus(withdrawalOrStatus = "") {
  const normalized = typeof withdrawalOrStatus === "object" && withdrawalOrStatus
    ? getWithdrawalStatus(withdrawalOrStatus)
    : String(withdrawalOrStatus || "").trim().toLowerCase();
  return normalized === "pending" || normalized === "review";
}

function buildFrozenAccountError(walletData = {}) {
  return makeHttpError(
    403,
    "account-frozen",
    "Ton compte a ete temporairement gele. Kontakte sipo a.",
    {
      accountFrozen: true,
      freezeReason: String(walletData.freezeReason || walletData.withdrawalHoldReason || "account_frozen"),
      rejectedDepositStrikeCount: safeInt(walletData.rejectedDepositStrikeCount),
    }
  );
}

function buildWithdrawalHoldError(walletData = {}) {
  return makeHttpError(
    403,
    "withdrawal-hold",
    "Kont ou a bloke pou retraits. Kontakte sipo a si ou bezwen asistans.",
    {
      withdrawalHold: true,
      withdrawalHoldReason: String(walletData.withdrawalHoldReason || "withdrawal_hold"),
      rejectedDepositStrikeCount: safeInt(walletData.rejectedDepositStrikeCount),
    }
  );
}

function assertWalletNotFrozen(walletData = {}) {
  if (walletData?.accountFrozen === true || walletData?.withdrawalHold === true) {
    throw buildFrozenAccountError(walletData);
  }
}

function assertWithdrawalAllowed(walletData = {}) {
  if (walletData?.accountFrozen === true) {
    throw buildFrozenAccountError(walletData);
  }
  if (walletData?.withdrawalHold === true) {
    throw buildWithdrawalHoldError(walletData);
  }
}

function isWelcomeBonusOfferActive(nowMs = Date.now()) {
  return safeSignedInt(nowMs) > 0 && safeSignedInt(nowMs) <= WELCOME_BONUS_END_AT_MS;
}

function isWelcomeBonusOrder(order = {}) {
  const orderType = String(order?.orderType || order?.kind || "").trim().toLowerCase();
  return orderType === WELCOME_BONUS_ORDER_TYPE || order?.isWelcomeBonus === true;
}

function hasWelcomeBonusOrder(orders = []) {
  return (Array.isArray(orders) ? orders : []).some((order) => isWelcomeBonusOrder(order));
}

function computeRealApprovedDepositsHtg(orders = []) {
  return (Array.isArray(orders) ? orders : []).reduce((sum, order) => {
    if (getOrderResolutionStatus(order) !== "approved") return sum;
    if (isWelcomeBonusOrder(order)) return sum;
    return sum + computeOrderAmount(order);
  }, 0);
}

function computeApprovedWelcomeBonusHtg(orders = []) {
  return (Array.isArray(orders) ? orders : []).reduce((sum, order) => {
    if (getOrderResolutionStatus(order) !== "approved") return sum;
    if (!isWelcomeBonusOrder(order)) return sum;
    return sum + computeOrderAmount(order);
  }, 0);
}

function resolveWelcomeBonusEligibility({
  clientData = {},
  orders = [],
  nowMs = Date.now(),
} = {}) {
  const createdAtMs = safeSignedInt(clientData.createdAtMs || clientData.signupCreatedAtMs);
  const isLegacyAccount = createdAtMs > 0 && createdAtMs < WELCOME_BONUS_LAUNCH_AT_MS;
  const offerEnded = !isWelcomeBonusOfferActive(nowMs);
  const alreadyClaimed = clientData.welcomeBonusClaimed === true
    || safeSignedInt(clientData.welcomeBonusReceivedAtMs) > 0
    || !!String(clientData.welcomeBonusOrderId || "").trim()
    || hasWelcomeBonusOrder(orders);
  const realApprovedDepositsHtg = computeRealApprovedDepositsHtg(orders);

  if (clientData.accountFrozen === true || clientData.withdrawalHold === true) {
    return {
      eligible: false,
      reason: "account-frozen",
      offerEnded,
      isLegacyAccount,
      launchAtMs: WELCOME_BONUS_LAUNCH_AT_MS,
      endAtMs: WELCOME_BONUS_END_AT_MS,
    };
  }

  if (alreadyClaimed) {
    return {
      eligible: false,
      reason: "already-claimed",
      offerEnded,
      isLegacyAccount,
      launchAtMs: WELCOME_BONUS_LAUNCH_AT_MS,
      endAtMs: WELCOME_BONUS_END_AT_MS,
    };
  }

  if (realApprovedDepositsHtg > 0) {
    return {
      eligible: false,
      reason: "real-deposit-exists",
      offerEnded,
      isLegacyAccount,
      launchAtMs: WELCOME_BONUS_LAUNCH_AT_MS,
      endAtMs: WELCOME_BONUS_END_AT_MS,
    };
  }

  if (isLegacyAccount) {
    return {
      eligible: false,
      reason: "legacy-account",
      offerEnded,
      isLegacyAccount,
      launchAtMs: WELCOME_BONUS_LAUNCH_AT_MS,
      endAtMs: WELCOME_BONUS_END_AT_MS,
    };
  }

  if (offerEnded) {
    return {
      eligible: false,
      reason: "offer-ended",
      offerEnded: true,
      isLegacyAccount,
      launchAtMs: WELCOME_BONUS_LAUNCH_AT_MS,
      endAtMs: WELCOME_BONUS_END_AT_MS,
    };
  }

  return {
    eligible: true,
    reason: "eligible",
    offerEnded: false,
    isLegacyAccount,
    launchAtMs: WELCOME_BONUS_LAUNCH_AT_MS,
    endAtMs: WELCOME_BONUS_END_AT_MS,
  };
}

function buildFundingStatusDecorations(clientData = {}, orders = []) {
  const realApprovedDepositsHtg = safeInt(computeRealApprovedDepositsHtg(orders));
  const welcomeBonusApprovedHtg = safeInt(computeApprovedWelcomeBonusHtg(orders));
  const eligibility = resolveWelcomeBonusEligibility({ clientData, orders });
  const welcomeBonusClaimed = clientData.welcomeBonusClaimed === true
    || safeSignedInt(clientData.welcomeBonusReceivedAtMs) > 0
    || hasWelcomeBonusOrder(orders);

  return {
    approvedDepositsHtg: realApprovedDepositsHtg,
    realApprovedDepositsHtg,
    hasApprovedDeposit: realApprovedDepositsHtg > 0,
    hasRealApprovedDeposit: realApprovedDepositsHtg > 0,
    welcomeBonusApprovedHtg,
    welcomeBonusClaimed,
    welcomeBonusOrderId: sanitizeText(clientData.welcomeBonusOrderId || "", 160),
    welcomeBonusReceivedAtMs: safeSignedInt(clientData.welcomeBonusReceivedAtMs),
    welcomeBonusPromptStatus: normalizeWelcomeBonusPromptStatus(clientData.welcomeBonusPromptStatus || ""),
    welcomeBonusPromptAnsweredAtMs: safeSignedInt(clientData.welcomeBonusPromptAnsweredAtMs),
    welcomeBonusProofCode: sanitizeText(clientData.welcomeBonusProofCode || "", 80).toUpperCase(),
    welcomeBonusTutorialCompletedAtMs: safeSignedInt(clientData.welcomeBonusTutorialCompletedAtMs),
    signupBonusModalSeenAtMs: safeSignedInt(clientData.signupBonusModalSeenAtMs),
    welcomeBonusEligible: eligibility.eligible === true,
    welcomeBonusEligibilityReason: String(eligibility.reason || ""),
    welcomeBonusLaunchAtMs: safeSignedInt(eligibility.launchAtMs),
    welcomeBonusEndAtMs: safeSignedInt(eligibility.endAtMs),
    welcomeBonusOfferEnded: eligibility.offerEnded === true,
    isLegacyAccount: eligibility.isLegacyAccount === true,
  };
}

function buildTransferRecipientRecord(clientId = "", raw = {}) {
  return {
    uid: String(raw.uid || clientId || "").trim(),
    username: sanitizeUsername(raw.username || "", 24),
    name: sanitizeText(raw.name || raw.displayName || raw.username || "", 120),
    email: sanitizeEmail(raw.email || "", 160),
    phone: sanitizePhone(raw.phone || "", 40),
    photoURL: sanitizePublicAsset(raw.photoURL || "", 400),
    approvedHtgAvailable: safeInt(raw.approvedHtgAvailable),
    transferSentHtgTotal: safeInt(raw.transferSentHtgTotal),
    transferReceivedHtgTotal: safeInt(raw.transferReceivedHtgTotal),
    transferFeePaidHtgTotal: safeInt(raw.transferFeePaidHtgTotal),
    accountFrozen: raw.accountFrozen === true,
    withdrawalHold: raw.withdrawalHold === true,
    updatedAtMs: safeSignedInt(raw.updatedAtMs),
  };
}

function getTransferDateKey(ms = Date.now(), timeZone = HTG_TRANSFER_TIME_ZONE) {
  const safeMs = safeSignedInt(ms);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(safeMs));
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year || "1970"}-${lookup.month || "01"}-${lookup.day || "01"}`;
}

function buildTransferHistoryRecord({
  transferId = "",
  direction = "sent",
  sender = {},
  recipient = {},
  grossAmountHtg = 0,
  feeHtg = HTG_TRANSFER_FEE_HTG,
  netAmountHtg = 0,
  clientRequestId = "",
  senderApprovedBefore = 0,
  senderApprovedAfter = 0,
  recipientApprovedBefore = 0,
  recipientApprovedAfter = 0,
  createdAtMs = Date.now(),
}) {
  const safeDirection = direction === "received" ? "received" : "sent";
  const counterpart = safeDirection === "sent" ? recipient : sender;

  return {
    transferId: sanitizeText(transferId || "", 160),
    sortKey: `${String(safeSignedInt(createdAtMs)).padStart(13, "0")}_${sanitizeText(transferId || "", 160)}`,
    uid: sanitizeText(safeDirection === "sent" ? sender.uid : recipient.uid, 160),
    direction: safeDirection,
    senderUid: sanitizeText(sender.uid || "", 160),
    senderUsername: sanitizeUsername(sender.username || "", 24),
    senderName: sanitizeText(sender.name || "", 120),
    recipientUid: sanitizeText(recipient.uid || "", 160),
    recipientUsername: sanitizeUsername(recipient.username || "", 24),
    recipientName: sanitizeText(recipient.name || "", 120),
    counterpartUid: sanitizeText(counterpart.uid || "", 160),
    counterpartUsername: sanitizeUsername(counterpart.username || "", 24),
    counterpartName: sanitizeText(counterpart.name || "", 120),
    grossAmountHtg: safeInt(grossAmountHtg),
    feeHtg: safeInt(feeHtg),
    netAmountHtg: safeInt(netAmountHtg),
    clientRequestId: sanitizeText(clientRequestId || "", 120),
    senderApprovedBefore: safeInt(senderApprovedBefore),
    senderApprovedAfter: safeInt(senderApprovedAfter),
    recipientApprovedBefore: safeInt(recipientApprovedBefore),
    recipientApprovedAfter: safeInt(recipientApprovedAfter),
    dateKey: getTransferDateKey(createdAtMs),
    createdAtMs: safeSignedInt(createdAtMs),
    createdAt: new Date(safeSignedInt(createdAtMs)).toISOString(),
    type: "peer_transfer",
  };
}

module.exports = {
  HTG_TRANSFER_FEE_HTG,
  HTG_TRANSFER_MIN_HTG,
  MAX_WITHDRAWAL_HTG,
  MIN_WITHDRAWAL_HTG,
  WELCOME_BONUS_END_AT_MS,
  WELCOME_BONUS_HTG_AMOUNT,
  WELCOME_BONUS_LAUNCH_AT_MS,
  assertWalletNotFrozen,
  assertWithdrawalAllowed,
  buildFundingStatusDecorations,
  buildFrozenAccountError,
  buildTransferHistoryRecord,
  buildTransferRecipientRecord,
  buildWithdrawalHoldError,
  computeRealApprovedDepositsHtg,
  computeReservedWithdrawalAmount,
  generateReferralCode,
  generateWelcomeBonusProofCode,
  getTransferDateKey,
  getWithdrawalStatus,
  isWithdrawalClientCancellableStatus,
  isWithdrawalReservedStatus,
  isWelcomeBonusOrder,
  normalizeWelcomeBonusPromptStatus,
  resolveWelcomeBonusEligibility,
  sanitizePublicAsset,
  sanitizeUsername,
  transferHistoryRef,
  transferLedgerRef,
  walletRef,
};
