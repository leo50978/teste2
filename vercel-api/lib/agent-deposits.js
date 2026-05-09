const crypto = require("crypto");
const { buildBalancesPatch, readApprovedHtg, readProvisionalHtg, readWithdrawableHtg } = require("./wallet-htg");
const { computeOrderAmount, getOrderResolutionStatus, sanitizeEmail } = require("./deposits");
const { safeInt, sanitizePhone, sanitizeText } = require("./safe");

const AGENT_ASSISTED_METHOD_ID = "agent_assisted";
const AGENT_DEPOSIT_SEARCH_RESULT_LIMIT = 12;
const AGENT_DEPOSIT_SEARCH_FALLBACK_LIMIT = 250;
const AGENT_DEPOSIT_CONTEXT_ORDER_LIMIT = 12;
const DEPOSIT_BONUS_MIN_HTG = 100;
const DEPOSIT_BONUS_PERCENT = 10;
const MIN_ORDER_HTG = 25;

function normalizeSearchText(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function phoneDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function sanitizeUsername(value = "", maxLength = 24) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, Math.max(0, maxLength));
}

function computeDepositBonusSnapshot(amountHtg = 0) {
  const safeAmountHtg = Math.max(0, Number(amountHtg) || 0);
  const eligible = safeAmountHtg >= DEPOSIT_BONUS_MIN_HTG;
  const bonusHtgRaw = eligible ? (safeAmountHtg * DEPOSIT_BONUS_PERCENT) / 100 : 0;
  const bonusHtgAwarded = eligible ? Math.max(0, Math.floor(bonusHtgRaw)) : 0;
  return {
    eligible,
    thresholdHtg: DEPOSIT_BONUS_MIN_HTG,
    bonusPercent: DEPOSIT_BONUS_PERCENT,
    bonusHtgRaw,
    bonusHtgAwarded,
  };
}

function getAgentDepositMethodMeta(methodId = "", methodDoc = {}) {
  const normalized = sanitizeText(methodId || "", 80).toLowerCase();
  if (normalized === "moncash") {
    return {
      id: "moncash",
      name: sanitizeText(methodDoc.label || methodDoc.name || "MonCash", 80) || "MonCash",
      accountName: sanitizeText(methodDoc.accountName || "", 120),
      phoneNumber: sanitizePhone(methodDoc.phoneNumber || "", 40),
    };
  }
  if (normalized === "natcash") {
    return {
      id: "natcash",
      name: sanitizeText(methodDoc.label || methodDoc.name || "NatCash", 80) || "NatCash",
      accountName: sanitizeText(methodDoc.accountName || "", 120),
      phoneNumber: sanitizePhone(methodDoc.phoneNumber || "", 40),
    };
  }
  return {
    id: AGENT_ASSISTED_METHOD_ID,
    name: sanitizeText(methodDoc.label || methodDoc.name || "Depot via agent", 80) || "Depot via agent",
    accountName: sanitizeText(methodDoc.accountName || "", 120),
    phoneNumber: sanitizePhone(methodDoc.phoneNumber || "", 40),
  };
}

function buildAgentDepositSearchRecord(clientId = "", raw = {}) {
  const approvedHtgAvailable = readApprovedHtg(raw);
  const provisionalHtgAvailable = readProvisionalHtg(raw);
  const playableHtg = safeInt(raw.playableHtg ?? (approvedHtgAvailable + provisionalHtgAvailable));
  return {
    id: String(clientId || raw.uid || "").trim(),
    uid: String(raw.uid || clientId || "").trim(),
    name: sanitizeText(raw.name || raw.displayName || raw.username || "", 120),
    username: sanitizeUsername(raw.username || "", 24),
    email: sanitizeEmail(raw.email || "", 160),
    phone: sanitizePhone(raw.phone || raw.customerPhone || "", 40),
    createdAtMs: Number(raw.createdAtMs || 0) || 0,
    lastSeenAtMs: Number(raw.lastSeenAtMs || 0) || 0,
    approvedHtgAvailable,
    provisionalHtgAvailable,
    playableHtg,
    withdrawableHtg: readWithdrawableHtg(raw, approvedHtgAvailable),
    approvedDepositsHtg: safeInt(raw.approvedDepositsHtg),
    accountFrozen: raw.accountFrozen === true,
    hasApprovedDeposit: raw.hasApprovedDeposit === true || safeInt(raw.approvedDepositsHtg) > 0,
  };
}

function buildAgentDepositContextOrder(docSnap) {
  const data = docSnap?.data && typeof docSnap.data === "function" ? (docSnap.data() || {}) : (docSnap || {});
  return {
    id: String(docSnap?.id || data.id || data.orderId || "").trim(),
    orderId: String(data.orderId || docSnap?.id || "").trim(),
    amountHtg: computeOrderAmount(data),
    status: getOrderResolutionStatus(data),
    methodId: sanitizeText(data.methodId || "", 80).toLowerCase(),
    methodName: sanitizeText(data.methodName || "", 80),
    orderType: sanitizeText(data.orderType || data.kind || "deposit", 80).toLowerCase(),
    agentAssisted: data.agentAssisted === true,
    bonusHtgAwarded: safeInt(data.bonusHtgAwarded),
    createdAtMs: Number(data.createdAtMs || 0) || 0,
  };
}

function sortSearchResults(results = []) {
  return [...results]
    .sort((left, right) =>
      (Number(right.lastSeenAtMs || 0) - Number(left.lastSeenAtMs || 0))
      || (Number(right.createdAtMs || 0) - Number(left.createdAtMs || 0))
      || String(left.name || left.email || left.id).localeCompare(String(right.name || right.email || right.id), "fr")
    )
    .slice(0, AGENT_DEPOSIT_SEARCH_RESULT_LIMIT);
}

function buildAgentApprovedOrder({
  orderId,
  clientId,
  clientData = {},
  amountHtg,
  note = "",
  methodMeta = {},
  agentUid = "",
  agentEmail = "",
  nowMs = Date.now(),
}) {
  const nowIso = new Date(nowMs).toISOString();
  const depositBonusSnapshot = computeDepositBonusSnapshot(amountHtg);
  const bonusHtgAwarded = safeInt(depositBonusSnapshot.bonusHtgAwarded);

  return {
    id: String(orderId || "").trim(),
    orderId: String(orderId || "").trim(),
    uid: clientId,
    clientId,
    clientUid: clientId,
    orderType: "deposit",
    amount: amountHtg,
    amountHtg,
    requestedAmount: amountHtg,
    methodId: methodMeta.id || AGENT_ASSISTED_METHOD_ID,
    methodName: methodMeta.name || "Depot via agent",
    methodDetails: {
      name: methodMeta.name || "Depot via agent",
      accountName: methodMeta.accountName || "",
      phoneNumber: methodMeta.phoneNumber || "",
    },
    status: "approved",
    resolutionStatus: "approved",
    approvedAmountHtg: amountHtg,
    uniqueCode: `AGT-${crypto.randomBytes(4).toString("hex").toUpperCase()}-${Date.now().toString(36).toUpperCase()}`,
    proofRef: `agent_credit_${nowMs}`,
    customerName: sanitizeText(clientData.name || clientData.displayName || clientData.username || "", 120),
    customerEmail: sanitizeEmail(clientData.email || "", 160),
    customerPhone: sanitizePhone(clientData.phone || "", 40),
    depositorPhone: "",
    extractedText: "",
    extractedTextStatus: "agent_assisted",
    createdAtMs: nowMs,
    createdAt: nowIso,
    updatedAt: nowIso,
    updatedAtMs: nowMs,
    resolvedAtMs: nowMs,
    reviewResolvedAtMs: nowMs,
    approvedAtMs: nowMs,
    approvedAt: nowIso,
    fundingSettledAtMs: nowMs,
    source: AGENT_ASSISTED_METHOD_ID,
    agentAssisted: true,
    creditedByAgentUid: sanitizeText(agentUid || "", 160),
    creditedByAgentEmail: sanitizeEmail(agentEmail || "", 160),
    creditedAtMs: nowMs,
    creditedAt: nowIso,
    adminNote: sanitizeText(note || "", 240),
    bonusEligible: depositBonusSnapshot.eligible,
    bonusThresholdHtg: safeInt(depositBonusSnapshot.thresholdHtg),
    bonusPercent: safeInt(depositBonusSnapshot.bonusPercent),
    bonusHtgBasis: amountHtg,
    bonusHtgRaw: Number(depositBonusSnapshot.bonusHtgRaw || 0),
    bonusDoesAwarded: 0,
    bonusHtgAwarded,
    bonusAwardedAtMs: bonusHtgAwarded > 0 ? nowMs : 0,
    bonusAwardedAt: bonusHtgAwarded > 0 ? nowIso : "",
    bonusSettledAtMs: bonusHtgAwarded > 0 ? nowMs : 0,
    clientStatusNoticeEventAtMs: nowMs,
  };
}

function buildAgentCreditWalletPatch(clientData = {}, amountHtg = 0, bonusHtgAwarded = 0) {
  const approvedHtg = readApprovedHtg(clientData);
  const provisionalHtg = readProvisionalHtg(clientData);
  const withdrawableHtg = readWithdrawableHtg(clientData, approvedHtg);
  return buildBalancesPatch({
    approvedHtg: approvedHtg + safeInt(amountHtg) + safeInt(bonusHtgAwarded),
    provisionalHtg,
    withdrawableHtg: withdrawableHtg + safeInt(amountHtg) + safeInt(bonusHtgAwarded),
  });
}

module.exports = {
  AGENT_ASSISTED_METHOD_ID,
  AGENT_DEPOSIT_CONTEXT_ORDER_LIMIT,
  AGENT_DEPOSIT_SEARCH_FALLBACK_LIMIT,
  AGENT_DEPOSIT_SEARCH_RESULT_LIMIT,
  MIN_ORDER_HTG,
  buildAgentApprovedOrder,
  buildAgentCreditWalletPatch,
  buildAgentDepositContextOrder,
  buildAgentDepositSearchRecord,
  computeDepositBonusSnapshot,
  getAgentDepositMethodMeta,
  normalizeSearchText,
  phoneDigits,
  sanitizeUsername,
  sortSearchResults,
};
