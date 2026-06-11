const { RATE_HTG_TO_DOES, htgToDoes } = require("./wallet-htg");
const { safeInt, sanitizePhone, sanitizeText } = require("./safe");

const MIN_ORDER_HTG = 25;
const PROVISIONAL_FUNDING_VERSION = 2;
const PROVISIONAL_CREDIT_MODE = "provisional_htg";
const ORDER_TYPE_DEPOSIT = "deposit";

function sanitizeEmail(value, maxLength = 160) {
  return String(value || "").trim().toLowerCase().slice(0, Math.max(0, maxLength));
}

function normalizeOrderResolutionLikeStatus(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (["approved", "success", "succeeded", "completed", "done", "validated", "accepted"].includes(raw)) return "approved";
  if (["rejected", "refused", "failed", "declined"].includes(raw)) return "rejected";
  if (["cancelled", "canceled"].includes(raw)) return "cancelled";
  if (["review", "pending_review", "verifying", "processing", "in_review"].includes(raw)) return "review";
  if (["pending", "waiting", "queued", "hold"].includes(raw)) return "pending";
  return "";
}

function getOrderResolutionStatus(order = {}) {
  const resolution = normalizeOrderResolutionLikeStatus(order?.resolutionStatus);
  const status = normalizeOrderResolutionLikeStatus(order?.status);

  if (
    (resolution === "pending" || resolution === "review")
    && (status === "approved" || status === "rejected" || status === "cancelled")
  ) {
    return status;
  }

  if (resolution) return resolution;
  if (status) return status;
  return "pending";
}

function computeOrderAmount(order = {}) {
  const approvedAmountHtg = Number(order?.approvedAmountHtg);
  if (Number.isFinite(approvedAmountHtg) && approvedAmountHtg > 0) return safeInt(approvedAmountHtg);

  const amountHtg = Number(order?.amountHtg);
  if (Number.isFinite(amountHtg) && amountHtg > 0) return safeInt(amountHtg);

  const amount = Number(order?.amount);
  if (Number.isFinite(amount) && amount > 0) return safeInt(amount);

  const requestedAmount = Number(order?.requestedAmount);
  if (Number.isFinite(requestedAmount) && requestedAmount > 0) return safeInt(requestedAmount);

  if (!Array.isArray(order?.items)) return 0;
  return safeInt(order.items.reduce((sum, item) => {
    const price = Number(item?.price) || 0;
    const quantity = Number(item?.quantity) || 1;
    return sum + (price * quantity);
  }, 0));
}

function buildOrderUniqueCode(orderId = "", createdAtMs = Date.now()) {
  const suffix = String(orderId || "").replace(/[^a-zA-Z0-9]/g, "").slice(-6).toUpperCase() || "ORDER";
  const stamp = Number(createdAtMs) > 0
    ? Number(createdAtMs).toString(36).toUpperCase()
    : Date.now().toString(36).toUpperCase();
  return `DEP-${stamp}-${suffix}`;
}

function listPendingOrders(orders = []) {
  return (Array.isArray(orders) ? orders : []).filter((order) => {
    const status = getOrderResolutionStatus(order);
    return status === "pending" || status === "review";
  });
}

function summarizePendingOrders(orders = []) {
  return listPendingOrders(orders).map((order) => ({
    id: String(order?.id || order?.orderId || "").trim(),
    uniqueCode: String(order?.uniqueCode || "").trim(),
    status: getOrderResolutionStatus(order),
    amountHtg: computeOrderAmount(order),
    approvedAmountHtg: safeInt(order?.approvedAmountHtg),
    provisionalHtgRemaining: safeInt(order?.provisionalHtgRemaining),
    methodId: String(order?.methodId || "").trim(),
    methodName: String(order?.methodName || "").trim(),
    createdAtMs: safeInt(order?.createdAtMs),
  }));
}

function hasBlockingPendingOrder(orders = []) {
  return summarizePendingOrders(orders).some((order) => order.amountHtg > 0);
}

function getPendingOrderAmountForSettlement(order = {}) {
  const remaining = safeInt(order?.provisionalHtgRemaining);
  if (remaining > 0) return remaining;
  return computeOrderAmount(order);
}

function buildDepositOrderRecord({
  orderId,
  uid,
  amountHtg,
  method,
  customerName,
  customerEmail,
  customerPhone,
  depositorPhone,
  proofRef,
  extractedText,
  extractedTextStatus,
  proofStepDurationMs,
  nowMs,
}) {
  const safeAmountHtg = safeInt(amountHtg);
  const provisionalDoes = htgToDoes(safeAmountHtg);
  const methodId = sanitizeText(method?.id || "", 120);
  const methodName = sanitizeText(method?.label || method?.name || "", 120);

  return {
    id: String(orderId || "").trim(),
    orderId: String(orderId || "").trim(),
    clientId: sanitizeText(uid || "", 160),
    uid: sanitizeText(uid || "", 160),
    orderType: ORDER_TYPE_DEPOSIT,
    status: "pending",
    resolutionStatus: "pending",
    methodId,
    methodName,
    uniqueCode: buildOrderUniqueCode(orderId, nowMs),
    amountHtg: safeAmountHtg,
    amount: safeAmountHtg,
    requestedAmount: safeAmountHtg,
    approvedAmountHtg: 0,
    creditedProvisionally: true,
    creditMode: PROVISIONAL_CREDIT_MODE,
    fundingVersion: PROVISIONAL_FUNDING_VERSION,
    fundingCurrency: "htg",
    provisionalHtgConverted: safeAmountHtg,
    provisionalHtgRemaining: safeAmountHtg,
    provisionalDoesRemaining: provisionalDoes,
    provisionalDoesPlayed: 0,
    provisionalGainDoes: 0,
    fundingSettledAtMs: 0,
    bonusEligible: safeAmountHtg >= 100,
    bonusPercent: 10,
    bonusThresholdHtg: 100,
    bonusRateHtgToDoes: RATE_HTG_TO_DOES,
    bonusHtgBasis: safeAmountHtg,
    bonusHtgRaw: 0,
    bonusDoesAwarded: 0,
    proofName: sanitizeText(proofRef || "", 180),
    proofRef: sanitizeText(proofRef || "", 180),
    extractedText: sanitizeText(extractedText || "", 500),
    extractedTextStatus: ["pending", "success", "empty", "failed"].includes(String(extractedTextStatus || ""))
      ? String(extractedTextStatus || "")
      : "pending",
    proofStepDurationMs: safeInt(proofStepDurationMs),
    customerName: sanitizeText(customerName || "", 120),
    customerEmail: sanitizeEmail(customerEmail || "", 160),
    customerPhone: sanitizePhone(customerPhone || "", 40),
    depositorPhone: sanitizePhone(depositorPhone || "", 40),
    items: [
      {
        productId: "direct_deposit",
        name: "Depot direct",
        price: safeAmountHtg,
        quantity: 1,
      },
    ],
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };
}

module.exports = {
  MIN_ORDER_HTG,
  buildDepositOrderRecord,
  computeOrderAmount,
  getOrderResolutionStatus,
  getPendingOrderAmountForSettlement,
  hasBlockingPendingOrder,
  sanitizeEmail,
  summarizePendingOrders,
};
