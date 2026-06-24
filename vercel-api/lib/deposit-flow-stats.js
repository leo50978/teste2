const { admin, db } = require("./firebase-admin");
const { computeOrderAmount, getOrderResolutionStatus } = require("./deposits");
const { isWelcomeBonusOrder } = require("./player-wallet");
const { safeInt, safeSignedInt } = require("./safe");

const DEPOSIT_FLOW_STATS_COLLECTION = "dashboardDepositFlowStats";
const DEPOSIT_FLOW_TIMEZONE = "America/Port-au-Prince";
const DEPOSIT_FLOW_DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEPOSIT_FLOW_MAX_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;
const DEPOSIT_FLOW_REBUILD_LIMIT = 5000;

const localFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DEPOSIT_FLOW_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function localParts(ms = Date.now()) {
  const values = {};
  localFormatter.formatToParts(new Date(safeSignedInt(ms) || Date.now())).forEach((part) => {
    if (part.type !== "literal") values[part.type] = part.value;
  });
  return {
    year: safeSignedInt(values.year),
    month: safeSignedInt(values.month),
    day: safeSignedInt(values.day),
    hour: String(values.hour || "00") === "24" ? 0 : safeSignedInt(values.hour),
    minute: safeSignedInt(values.minute),
    second: safeSignedInt(values.second),
  };
}

function zonedTimestamp(parts = {}, hour = 0, minute = 0, second = 0, millisecond = 0) {
  const year = safeSignedInt(parts.year);
  const month = safeSignedInt(parts.month);
  const day = safeSignedInt(parts.day);
  if (year <= 0 || month <= 0 || day <= 0) return 0;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const observed = localParts(utcGuess);
  const targetAsUtc = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const observedAsUtc = Date.UTC(
    safeSignedInt(observed.year),
    Math.max(0, safeSignedInt(observed.month) - 1),
    safeSignedInt(observed.day),
    safeSignedInt(observed.hour),
    safeSignedInt(observed.minute),
    safeSignedInt(observed.second),
    millisecond
  );
  return utcGuess + (targetAsUtc - observedAsUtc);
}

function dayKeyFromParts(parts = {}) {
  const year = String(safeSignedInt(parts.year)).padStart(4, "0");
  const month = String(safeSignedInt(parts.month)).padStart(2, "0");
  const day = String(safeSignedInt(parts.day)).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDayPartsFromKey(dayKey = "") {
  const [year, month, day] = String(dayKey || "").split("-").map((item) => safeSignedInt(item));
  return { year, month, day };
}

function shiftDayParts(parts = {}, deltaDays = 0) {
  const shiftedUtc = Date.UTC(
    safeSignedInt(parts.year),
    Math.max(0, safeSignedInt(parts.month) - 1),
    safeSignedInt(parts.day) + safeSignedInt(deltaDays),
    12,
    0,
    0,
    0
  );
  const shifted = new Date(shiftedUtc);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function normalizeMethod(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (/mon\s*cash/.test(raw) || raw.includes("moncash")) return "moncash";
  if (/nat\s*cash/.test(raw) || raw.includes("natcash")) return "natcash";
  return "other";
}

function getOrderMethod(order = {}) {
  return normalizeMethod(`${String(order.methodId || "")} ${String(order.methodName || "")}`);
}

function getBucketInfo(ms = Date.now(), granularity = "day") {
  const parts = localParts(ms);
  const dayKey = dayKeyFromParts(parts);
  const dayStartMs = zonedTimestamp(parts, 0, 0, 0, 0);
  if (granularity === "hour") {
    const hour = Math.max(0, Math.min(23, safeSignedInt(parts.hour)));
    const hourKey = `${dayKey}T${String(hour).padStart(2, "0")}`;
    return {
      granularity: "hour",
      key: hourKey,
      docId: `hour_${hourKey}`,
      label: `${dayKey.slice(5)} ${String(hour).padStart(2, "0")}h`,
      startMs: zonedTimestamp(parts, hour, 0, 0, 0),
    };
  }
  return {
    granularity: "day",
    key: dayKey,
    docId: `day_${dayKey}`,
    label: dayKey.slice(5),
    startMs: dayStartMs,
  };
}

function statsRef(bucket = {}) {
  return db.collection(DEPOSIT_FLOW_STATS_COLLECTION).doc(String(bucket.docId || ""));
}

function incrementPatch(prefix = "", amountHtg = 0, method = "other", countDelta = 1) {
  const safeAmount = safeInt(amountHtg);
  const safeCount = safeInt(countDelta);
  const methodKey = method === "moncash" || method === "natcash" ? method : "other";
  return {
    [`${prefix}Count`]: admin.firestore.FieldValue.increment(safeCount),
    [`${prefix}Htg`]: admin.firestore.FieldValue.increment(safeAmount),
    [`${methodKey}${prefix[0].toUpperCase()}${prefix.slice(1)}Count`]: admin.firestore.FieldValue.increment(safeCount),
    [`${methodKey}${prefix[0].toUpperCase()}${prefix.slice(1)}Htg`]: admin.firestore.FieldValue.increment(safeAmount),
  };
}

function buildBasePatch(bucket = {}, nowMs = Date.now()) {
  return {
    granularity: bucket.granularity,
    key: bucket.key,
    label: bucket.label,
    startMs: safeSignedInt(bucket.startMs),
    timezone: DEPOSIT_FLOW_TIMEZONE,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAtMs: nowMs,
  };
}

function setBucketIncrement(tx, bucket = {}, patch = {}, nowMs = Date.now()) {
  tx.set(statsRef(bucket), {
    ...buildBasePatch(bucket, nowMs),
    ...patch,
  }, { merge: true });
}

function applyDepositCreatedStatsTx(tx, order = {}, nowMs = Date.now()) {
  if (isWelcomeBonusOrder(order)) return;
  const createdAtMs = safeSignedInt(order.createdAtMs) || nowMs;
  const amountHtg = Math.max(0, computeOrderAmount(order) || safeInt(order.amountHtg || order.amount));
  if (amountHtg <= 0) return;
  const method = getOrderMethod(order);
  const patch = {
    ...incrementPatch("requested", amountHtg, method, 1),
    ...incrementPatch("pending", amountHtg, method, 1),
  };
  setBucketIncrement(tx, getBucketInfo(createdAtMs, "hour"), patch, nowMs);
  setBucketIncrement(tx, getBucketInfo(createdAtMs, "day"), patch, nowMs);
}

function applyDepositResolvedStatsTx(tx, order = {}, decision = "", nowMs = Date.now()) {
  if (isWelcomeBonusOrder(order)) return;
  const normalizedDecision = String(decision || "").trim().toLowerCase();
  if (normalizedDecision !== "approve" && normalizedDecision !== "reject") return;
  const createdAtMs = safeSignedInt(order.createdAtMs) || nowMs;
  const amountHtg = Math.max(0, computeOrderAmount(order));
  if (amountHtg <= 0) return;
  const method = getOrderMethod(order);
  const statusPrefix = normalizedDecision === "approve" ? "approved" : "rejected";
  const patch = {
    ...incrementPatch("pending", -amountHtg, method, -1),
    ...incrementPatch(statusPrefix, amountHtg, method, 1),
  };
  setBucketIncrement(tx, getBucketInfo(createdAtMs, "hour"), patch, nowMs);
  setBucketIncrement(tx, getBucketInfo(createdAtMs, "day"), patch, nowMs);
}

function normalizeRange(options = {}, nowMs = Date.now()) {
  const safeNow = safeSignedInt(nowMs) || Date.now();
  let endMs = safeSignedInt(options.endMs ?? options.dateToMs ?? options.toMs) || safeNow;
  if (endMs <= 0 || endMs > safeNow) endMs = safeNow;
  const todayParts = localParts(endMs);
  const defaultStartMs = zonedTimestamp(todayParts, 0, 0, 0, 0) || (endMs - DEPOSIT_FLOW_DEFAULT_WINDOW_MS);
  let startMs = safeSignedInt(options.startMs ?? options.dateFromMs ?? options.fromMs) || defaultStartMs;
  if (startMs <= 0 || startMs >= endMs) startMs = defaultStartMs;
  if ((endMs - startMs) > DEPOSIT_FLOW_MAX_WINDOW_MS) {
    startMs = endMs - DEPOSIT_FLOW_MAX_WINDOW_MS;
  }
  const rangeMs = Math.max(1, endMs - startMs);
  const granularity = rangeMs <= (3 * 24 * 60 * 60 * 1000) ? "hour" : "day";
  return { startMs, endMs, rangeMs, granularity };
}

function makeEmptyBucket(bucket = {}) {
  return {
    startMs: safeSignedInt(bucket.startMs),
    key: String(bucket.key || ""),
    label: String(bucket.label || "-"),
    requestedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    pendingCount: 0,
    requestedHtg: 0,
    approvedHtg: 0,
    rejectedHtg: 0,
    pendingHtg: 0,
    moncashRequestedCount: 0,
    moncashApprovedCount: 0,
    moncashRejectedCount: 0,
    moncashPendingCount: 0,
    moncashRequestedHtg: 0,
    moncashApprovedHtg: 0,
    moncashRejectedHtg: 0,
    moncashPendingHtg: 0,
    natcashRequestedCount: 0,
    natcashApprovedCount: 0,
    natcashRejectedCount: 0,
    natcashPendingCount: 0,
    natcashRequestedHtg: 0,
    natcashApprovedHtg: 0,
    natcashRejectedHtg: 0,
    natcashPendingHtg: 0,
    otherRequestedCount: 0,
    otherApprovedCount: 0,
    otherRejectedCount: 0,
    otherPendingCount: 0,
    otherRequestedHtg: 0,
    otherApprovedHtg: 0,
    otherRejectedHtg: 0,
    otherPendingHtg: 0,
  };
}

function addStatsToBucket(target = {}, stats = {}) {
  Object.keys(makeEmptyBucket()).forEach((key) => {
    if (key === "key" || key === "label" || key === "startMs") return;
    target[key] = safeInt(target[key]) + safeInt(stats[key]);
  });
}

function buildBucketSeed(range = {}) {
  const buckets = [];
  if (range.granularity === "hour") {
    let cursor = getBucketInfo(range.startMs, "hour").startMs;
    while (cursor <= range.endMs) {
      buckets.push(makeEmptyBucket(getBucketInfo(cursor, "hour")));
      cursor += 60 * 60 * 1000;
    }
    return buckets;
  }

  let parts = localParts(range.startMs);
  let cursor = zonedTimestamp(parts, 0, 0, 0, 0);
  while (cursor <= range.endMs) {
    const bucket = getBucketInfo(cursor, "day");
    buckets.push(makeEmptyBucket(bucket));
    parts = shiftDayParts(getDayPartsFromKey(bucket.key), 1);
    cursor = zonedTimestamp(parts, 0, 0, 0, 0);
  }
  return buckets;
}

async function getStatsDocsForBuckets(buckets = [], granularity = "day") {
  const refs = buckets.map((bucket) => statsRef({
    docId: `${granularity}_${bucket.key}`,
  }));
  if (!refs.length) return [];
  return db.getAll(...refs);
}

async function computeDepositFlowStatsSnapshot(options = {}) {
  const nowMs = safeSignedInt(options.nowMs) || Date.now();
  const range = normalizeRange(options, nowMs);
  const buckets = buildBucketSeed(range);
  const snaps = await getStatsDocsForBuckets(buckets, range.granularity);
  const byId = new Map(snaps.map((snap) => [snap.id, snap.exists ? (snap.data() || {}) : null]));
  let aggregateDocs = 0;

  buckets.forEach((bucket) => {
    const doc = byId.get(`${range.granularity}_${bucket.key}`);
    if (!doc) return;
    aggregateDocs += 1;
    addStatsToBucket(bucket, doc);
  });

  const summary = makeEmptyBucket({ key: "summary", label: "summary", startMs: 0 });
  buckets.forEach((bucket) => addStatsToBucket(summary, bucket));
  let cumulativeApprovedHtg = 0;
  const normalizedBuckets = buckets.map((bucket) => {
    cumulativeApprovedHtg += safeInt(bucket.approvedHtg);
    return {
      ...bucket,
      requestedCount: Math.max(0, safeInt(bucket.requestedCount)),
      approvedCount: Math.max(0, safeInt(bucket.approvedCount)),
      rejectedCount: Math.max(0, safeInt(bucket.rejectedCount)),
      pendingCount: Math.max(0, safeInt(bucket.pendingCount)),
      pendingHtg: Math.max(0, safeInt(bucket.pendingHtg)),
      approvalRatePct: safeInt(bucket.requestedHtg) > 0
        ? Number(((safeInt(bucket.approvedHtg) / safeInt(bucket.requestedHtg)) * 100).toFixed(2))
        : 0,
      cumulativeApprovedHtg,
    };
  });

  const requestedHtg = safeInt(summary.requestedHtg);
  const approvedHtg = safeInt(summary.approvedHtg);
  const approvedRatePct = requestedHtg > 0 ? Number(((approvedHtg / requestedHtg) * 100).toFixed(2)) : 0;
  const rejectedRatePct = requestedHtg > 0 ? Number(((safeInt(summary.rejectedHtg) / requestedHtg) * 100).toFixed(2)) : 0;
  const moncashApprovedSharePct = approvedHtg > 0 ? Number(((safeInt(summary.moncashApprovedHtg) / approvedHtg) * 100).toFixed(2)) : 0;
  const natcashApprovedSharePct = approvedHtg > 0 ? Number(((safeInt(summary.natcashApprovedHtg) / approvedHtg) * 100).toFixed(2)) : 0;

  return {
    generatedAtMs: nowMs,
    timezone: DEPOSIT_FLOW_TIMEZONE,
    window: {
      startMs: range.startMs,
      endMs: range.endMs,
      rangeMs: range.rangeMs,
      granularity: range.granularity,
    },
    definitions: {
      inflowRule: "Les entrees HTG de l'entreprise correspondent aux montants de depots reels approuves.",
      rejectionRule: "Les bonus bienvenue sont exclus. Les montants rejetes reprennent le montant demande sur la commande.",
      source: "Source: dashboardDepositFlowStats pre-agrege.",
    },
    summary: {
      ...summary,
      requestedCount: Math.max(0, safeInt(summary.requestedCount)),
      approvedCount: Math.max(0, safeInt(summary.approvedCount)),
      rejectedCount: Math.max(0, safeInt(summary.rejectedCount)),
      pendingCount: Math.max(0, safeInt(summary.pendingCount)),
      pendingHtg: Math.max(0, safeInt(summary.pendingHtg)),
      approvedRatePct,
      rejectedRatePct,
      moncashApprovedSharePct,
      natcashApprovedSharePct,
    },
    series: {
      requestedHtg: normalizedBuckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.requestedHtg })),
      approvedHtg: normalizedBuckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.approvedHtg })),
      rejectedHtg: normalizedBuckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.rejectedHtg })),
      cumulativeApprovedHtg: normalizedBuckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.cumulativeApprovedHtg })),
      moncashApprovedHtg: normalizedBuckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.moncashApprovedHtg })),
      natcashApprovedHtg: normalizedBuckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.natcashApprovedHtg })),
      approvalsVsRejects: normalizedBuckets.map((item) => ({
        startMs: item.startMs,
        label: item.label,
        approvedHtg: item.approvedHtg,
        rejectedHtg: item.rejectedHtg,
      })),
    },
    buckets: normalizedBuckets,
    scannedOrderDocs: 0,
    aggregateDocs,
    truncated: false,
    scanLimit: 0,
    precomputed: true,
  };
}

function computeStatsObjectFromRows(rows = []) {
  const stats = makeEmptyBucket({ key: "rebuild", label: "rebuild", startMs: 0 });
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (isWelcomeBonusOrder(row)) return;
    const requestedHtg = Math.max(0, computeOrderAmount(row));
    if (requestedHtg <= 0) return;
    const method = getOrderMethod(row);
    const resolution = getOrderResolutionStatus(row);
    addStatsToBucket(stats, {
      ...incrementPlain("requested", requestedHtg, method, 1),
      ...(resolution === "approved"
        ? incrementPlain("approved", requestedHtg, method, 1)
        : resolution === "rejected"
          ? incrementPlain("rejected", requestedHtg, method, 1)
          : incrementPlain("pending", requestedHtg, method, 1)),
    });
  });
  return stats;
}

function incrementPlain(prefix = "", amountHtg = 0, method = "other", countDelta = 1) {
  const methodKey = method === "moncash" || method === "natcash" ? method : "other";
  return {
    [`${prefix}Count`]: safeInt(countDelta),
    [`${prefix}Htg`]: safeInt(amountHtg),
    [`${methodKey}${prefix[0].toUpperCase()}${prefix.slice(1)}Count`]: safeInt(countDelta),
    [`${methodKey}${prefix[0].toUpperCase()}${prefix.slice(1)}Htg`]: safeInt(amountHtg),
  };
}

async function rebuildDepositFlowStatsForRange(options = {}) {
  const nowMs = Date.now();
  const range = normalizeRange(options, nowMs);
  const maxDocs = Math.min(DEPOSIT_FLOW_REBUILD_LIMIT, Math.max(100, safeInt(options.maxDocs) || DEPOSIT_FLOW_REBUILD_LIMIT));
  const fields = [
    "amount",
    "items",
    "status",
    "resolutionStatus",
    "approvedAmountHtg",
    "createdAtMs",
    "createdAt",
    "methodId",
    "methodName",
    "orderType",
    "kind",
  ];
  let query = db.collectionGroup("orders")
    .where("createdAtMs", ">=", range.startMs)
    .where("createdAtMs", "<=", range.endMs)
    .orderBy("createdAtMs", "asc")
    .select(...fields)
    .limit(maxDocs);
  const snap = await query.get();
  const rowsByHour = new Map();
  const rowsByDay = new Map();
  snap.forEach((docSnap) => {
    const row = docSnap.data() || {};
    const createdAtMs = safeSignedInt(row.createdAtMs) || safeSignedInt(row.createdAt);
    if (!createdAtMs) return;
    const hour = getBucketInfo(createdAtMs, "hour");
    const day = getBucketInfo(createdAtMs, "day");
    rowsByHour.set(hour.docId, [...(rowsByHour.get(hour.docId) || []), row]);
    rowsByDay.set(day.docId, [...(rowsByDay.get(day.docId) || []), row]);
  });

  const batch = db.batch();
  const writeBucket = (docId, rows) => {
    const first = rows[0] || {};
    const createdAtMs = safeSignedInt(first.createdAtMs) || nowMs;
    const bucket = docId.startsWith("hour_") ? getBucketInfo(createdAtMs, "hour") : getBucketInfo(createdAtMs, "day");
    const stats = computeStatsObjectFromRows(rows);
    batch.set(statsRef(bucket), {
      ...buildBasePatch(bucket, nowMs),
      ...stats,
      rebuiltAt: admin.firestore.FieldValue.serverTimestamp(),
      rebuiltAtMs: nowMs,
    }, { merge: false });
  };
  rowsByHour.forEach((rows, docId) => writeBucket(docId, rows));
  rowsByDay.forEach((rows, docId) => writeBucket(docId, rows));
  await batch.commit();

  return {
    ok: true,
    scannedOrderDocs: snap.size,
    truncated: snap.size >= maxDocs,
    writtenBuckets: rowsByHour.size + rowsByDay.size,
    range,
  };
}

module.exports = {
  applyDepositCreatedStatsTx,
  applyDepositResolvedStatsTx,
  computeDepositFlowStatsSnapshot,
  rebuildDepositFlowStatsForRange,
};
