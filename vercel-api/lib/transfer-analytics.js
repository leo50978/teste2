const { safeInt, safeSignedInt } = require("./safe");
const { getTransferDateKey, transferLedgerRef } = require("./player-wallet");

async function getTransferAnalytics(payload = {}) {
  const startMsInput = safeSignedInt(payload.startMs);
  const endMsInput = safeSignedInt(payload.endMs);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const defaultStartMs = todayStart.getTime();
  const startMs = startMsInput > 0 ? startMsInput : defaultStartMs;
  const endMs = endMsInput > 0 ? endMsInput : Date.now();
  const rangeStart = Math.min(startMs, endMs);
  const rangeEnd = Math.max(startMs, endMs);

  const snap = await transferLedgerRef()
    .where("createdAtMs", ">=", rangeStart)
    .where("createdAtMs", "<=", rangeEnd)
    .orderBy("createdAtMs", "asc")
    .limit(5000)
    .get();

  const dailyMap = new Map();
  const items = [];
  let totalGrossHtg = 0;
  let totalNetHtg = 0;
  let totalFeeHtg = 0;

  snap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const record = {
      transferId: String(data.transferId || docSnap.id || ""),
      createdAtMs: safeSignedInt(data.createdAtMs),
      grossAmountHtg: safeInt(data.grossAmountHtg),
      netAmountHtg: safeInt(data.netAmountHtg),
      feeHtg: safeInt(data.feeHtg),
      senderUid: String(data.senderUid || ""),
      senderUsername: String(data.senderUsername || ""),
      senderName: String(data.senderName || ""),
      recipientUid: String(data.recipientUid || ""),
      recipientUsername: String(data.recipientUsername || ""),
      recipientName: String(data.recipientName || ""),
      direction: String(data.direction || "sent"),
      dateKey: String(data.dateKey || getTransferDateKey(data.createdAtMs)),
    };
    items.push(record);
    totalGrossHtg += record.grossAmountHtg;
    totalNetHtg += record.netAmountHtg;
    totalFeeHtg += record.feeHtg;

    const bucket = dailyMap.get(record.dateKey) || {
      dateKey: record.dateKey,
      transferCount: 0,
      grossAmountHtg: 0,
      netAmountHtg: 0,
      feeHtg: 0,
    };
    bucket.transferCount += 1;
    bucket.grossAmountHtg += record.grossAmountHtg;
    bucket.netAmountHtg += record.netAmountHtg;
    bucket.feeHtg += record.feeHtg;
    dailyMap.set(record.dateKey, bucket);
  });

  const daily = Array.from(dailyMap.values()).sort((left, right) => String(left.dateKey).localeCompare(String(right.dateKey)));

  return {
    ok: true,
    range: {
      startMs: rangeStart,
      endMs: rangeEnd,
      startDateKey: getTransferDateKey(rangeStart),
      endDateKey: getTransferDateKey(rangeEnd),
    },
    totals: {
      transferCount: items.length,
      grossAmountHtg: totalGrossHtg,
      netAmountHtg: totalNetHtg,
      feeHtg: totalFeeHtg,
    },
    daily,
    recentTransfers: items.slice(-24).reverse(),
  };
}

module.exports = {
  getTransferAnalytics,
};
