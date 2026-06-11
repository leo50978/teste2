const { admin, db } = require("./firebase-admin");
const { computeOrderAmount, getOrderResolutionStatus } = require("./deposits");
const { isWelcomeBonusOrder } = require("./player-wallet");
const { RATE_HTG_TO_DOES } = require("./wallet-htg");
const { safeInt, safeSignedInt } = require("./safe");

const CLIENTS_COLLECTION = "clients";
const ROOMS_COLLECTION = "rooms";
const ROOM_RESULTS_COLLECTION = "roomResults";
const DOMINO_CLASSIC_MATCH_RESULTS_COLLECTION = "dominoClassicMatchResults";
const DUEL_ROOM_RESULTS_COLLECTION = "duelRoomResults";
const MORPION_ROOM_RESULTS_COLLECTION = "morpionRoomResults";
const DAME_ROOM_RESULTS_COLLECTION = "dameRoomResults";
const CHESS_ROOM_RESULTS_COLLECTION = "chessRoomResults";
const PONG_MATCH_RESULTS_COLLECTION = "pongMatchResults";
const LUDO_MATCH_RESULTS_COLLECTION = "ludoMatchResults";
const ANALYTICS_META_COLLECTION = "analyticsMeta";
const ANALYTICS_SITE_VISIT_SESSIONS_COLLECTION = "analyticsSiteVisitSessions";
const ANALYTICS_SITE_VISITS_DAILY_COLLECTION = "analyticsSiteVisitsDaily";
const ANALYTICS_SITE_VISITS_HOURLY_COLLECTION = "analyticsSiteVisitsHourly";
const ANALYTICS_SITE_VISITS_HOUR_COLLECTION = "analyticsSiteVisitsHours";
const ANALYTICS_SITE_VISITS_WEEKDAY_COLLECTION = "analyticsSiteVisitsWeekdays";
const ANALYTICS_PRESENCE_SNAPSHOTS_COLLECTION = "analyticsPresenceSnapshots";
const ANALYTICS_PRESENCE_DAILY_COLLECTION = "analyticsPresenceDaily";
const ANALYTICS_PRESENCE_HOUR_COLLECTION = "analyticsPresenceHours";
const ANALYTICS_PRESENCE_WEEKDAY_COLLECTION = "analyticsPresenceWeekdays";
const SITE_VISITS_META_DOC = "siteVisits";
const PRESENCE_ANALYTICS_TIMEZONE = "America/Port-au-Prince";
const PRESENCE_ANALYTICS_CLIENT_WINDOW_MS = 15 * 60 * 1000;
const PRESENCE_ANALYTICS_ROOM_WINDOW_MS = 60 * 1000;
const PRESENCE_ANALYTICS_RECENT_SNAPSHOT_DAYS = 7;
const PRESENCE_ANALYTICS_RECENT_DAYS_LIMIT = 120;
const ACQUISITION_DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const ACQUISITION_MAX_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;
const ACQUISITION_ACTIVE_LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const ACQUISITION_FIDELITY_MIN_AGE_MS = 3 * 24 * 60 * 60 * 1000;
const ACQUISITION_PAGE_FETCH_SIZE = 1000;
const ACQUISITION_DOC_LIMIT = 10000;
const DEPOSIT_ANALYTICS_DEFAULT_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const DEPOSIT_ANALYTICS_MAX_WINDOW_MS = 180 * 24 * 60 * 60 * 1000;
const DEPOSIT_ANALYTICS_PAGE_FETCH_SIZE = 1000;
const DEPOSIT_ANALYTICS_DOC_LIMIT = 12000;
const CLIENT_ORDER_FALLBACK_CLIENT_PAGE_SIZE = 250;
const CLIENT_ORDER_FALLBACK_CONCURRENCY = 5;
const CLIENT_DELETION_REVIEW_PENDING_STATUS = "pending_review";
const CLIENT_DELETION_REVIEW_CONTACTED_STATUS = "contacted";

const presenceDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PRESENCE_ANALYTICS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const presenceWeekdayFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: PRESENCE_ANALYTICS_TIMEZONE,
  weekday: "short",
});

const gamesAnalyticsDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: PRESENCE_ANALYTICS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function getGamesAnalyticsLocalParts(nowMs = Date.now()) {
  const parts = gamesAnalyticsDateTimeFormatter.formatToParts(new Date(nowMs));
  const values = {};
  parts.forEach((part) => {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
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

function getGamesAnalyticsZonedTimestamp(parts = {}, hour = 0, minute = 0, second = 0, millisecond = 0) {
  const year = safeSignedInt(parts.year);
  const month = safeSignedInt(parts.month);
  const day = safeSignedInt(parts.day);
  if (year <= 0 || month <= 0 || day <= 0) return 0;
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const observed = getGamesAnalyticsLocalParts(utcGuess);
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

function getGamesAnalyticsShiftedDayParts(nowMs = Date.now(), deltaDays = 0) {
  const current = getGamesAnalyticsLocalParts(nowMs);
  const shiftedUtc = Date.UTC(current.year, Math.max(0, current.month - 1), current.day + safeSignedInt(deltaDays), 12, 0, 0, 0);
  const shifted = new Date(shiftedUtc);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

function analyticsMetaRef(docId = "") {
  return db.collection(ANALYTICS_META_COLLECTION).doc(String(docId || "").trim());
}

function siteVisitSessionRef(sessionId = "") {
  return db.collection(ANALYTICS_SITE_VISIT_SESSIONS_COLLECTION).doc(String(sessionId || "").trim());
}

function siteVisitsDailyCollection() {
  return db.collection(ANALYTICS_SITE_VISITS_DAILY_COLLECTION);
}

function siteVisitsHourlyCollection() {
  return db.collection(ANALYTICS_SITE_VISITS_HOURLY_COLLECTION);
}

function siteVisitsHourCollection() {
  return db.collection(ANALYTICS_SITE_VISITS_HOUR_COLLECTION);
}

function siteVisitsWeekdayCollection() {
  return db.collection(ANALYTICS_SITE_VISITS_WEEKDAY_COLLECTION);
}

function presenceSnapshotsCollection() {
  return db.collection(ANALYTICS_PRESENCE_SNAPSHOTS_COLLECTION);
}

function presenceDailyCollection() {
  return db.collection(ANALYTICS_PRESENCE_DAILY_COLLECTION);
}

function presenceHourCollection() {
  return db.collection(ANALYTICS_PRESENCE_HOUR_COLLECTION);
}

function presenceWeekdayCollection() {
  return db.collection(ANALYTICS_PRESENCE_WEEKDAY_COLLECTION);
}

function getHourBucketStartMs(nowMs = Date.now()) {
  const safeNow = safeSignedInt(nowMs) || Date.now();
  return safeNow - (safeNow % (60 * 60 * 1000));
}

function getDayBucketStartMs(nowMs = Date.now()) {
  const safeNow = safeSignedInt(nowMs) || Date.now();
  const date = new Date(safeNow);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function getPresenceLocalKeys(nowMs = Date.now()) {
  const parts = presenceDateTimeFormatter.formatToParts(new Date(nowMs));
  const values = {};
  parts.forEach((part) => {
    if (part.type !== "literal") {
      values[part.type] = part.value;
    }
  });
  const year = String(values.year || "0000");
  const month = String(values.month || "01");
  const day = String(values.day || "01");
  let hour = String(values.hour || "00");
  if (hour === "24") hour = "00";
  const weekday = String(presenceWeekdayFormatter.format(new Date(nowMs)) || "Sun").toLowerCase();
  return {
    timezone: PRESENCE_ANALYTICS_TIMEZONE,
    dayKey: `${year}-${month}-${day}`,
    monthKey: `${year}-${month}`,
    hourKey: hour.padStart(2, "0"),
    weekdayKey: weekday,
  };
}

function getSiteVisitLocalKeys(nowMs = Date.now()) {
  return getPresenceLocalKeys(nowMs);
}

function normalizeSiteVisitPath(value = "") {
  const raw = String(value || "").trim();
  if (!raw) return "/";
  const withoutOrigin = raw.replace(/^https?:\/\/[^/]+/i, "");
  const normalized = withoutOrigin.startsWith("/") ? withoutOrigin : `/${withoutOrigin}`;
  return normalized.replace(/\/{2,}/g, "/") || "/";
}

function buildSiteVisitDailyRecord(dayKey = "", existing = {}, nowMs = Date.now()) {
  const safeNow = safeSignedInt(nowMs) || Date.now();
  return {
    dayKey: String(dayKey || ""),
    dayStartMs: getDayBucketStartMs(safeNow),
    visitCount: safeInt(existing.visitCount) + 1,
    updatedAtMs: safeNow,
    updatedAt: new Date(safeNow).toISOString(),
  };
}

function buildSiteVisitHourlyRecord(bucketKey = "", localKeys = {}, existing = {}, nowMs = Date.now()) {
  const safeNow = safeSignedInt(nowMs) || Date.now();
  return {
    bucketKey: String(bucketKey || ""),
    dayKey: String(localKeys.dayKey || ""),
    hourKey: String(localKeys.hourKey || "").padStart(2, "0"),
    weekdayKey: String(localKeys.weekdayKey || "").toLowerCase(),
    bucketStartMs: getHourBucketStartMs(safeNow),
    visitCount: safeInt(existing.visitCount) + 1,
    updatedAtMs: safeNow,
    updatedAt: new Date(safeNow).toISOString(),
  };
}

function buildSiteVisitDimensionRecord(keyField = "", keyValue = "", existing = {}, nowMs = Date.now()) {
  const safeNow = safeSignedInt(nowMs) || Date.now();
  return {
    [String(keyField || "key")]: String(keyValue || ""),
    visitCount: safeInt(existing.visitCount) + 1,
    updatedAtMs: safeNow,
    updatedAt: new Date(safeNow).toISOString(),
  };
}

function toMillis(value) {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (value instanceof admin.firestore.Timestamp) return value.toMillis();
  if (typeof value?.toMillis === "function") return value.toMillis();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value?.seconds === "number") return value.seconds * 1000;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function toSerializableValue(value) {
  if (value == null) return value;
  if (value instanceof Date) return value.getTime();
  if (value instanceof admin.firestore.Timestamp) return value.toMillis();
  if (Array.isArray(value)) return value.map((item) => toSerializableValue(item));
  if (typeof value === "object") {
    const out = {};
    Object.keys(value).forEach((key) => {
      out[key] = toSerializableValue(value[key]);
    });
    return out;
  }
  return value;
}

function normalizeFirestoreErrorCode(error) {
  const rawCode = String(error?.code || error?.details?.code || "").trim().toLowerCase();
  const rawMessage = String(error?.message || error?.details || "").trim().toLowerCase();
  if (rawCode.includes("/")) {
    const parts = rawCode.split("/");
    return parts[parts.length - 1] || rawCode;
  }
  if (rawCode === "9" || rawMessage.includes("failed_precondition") || rawMessage.includes("failed-precondition")) {
    return "failed-precondition";
  }
  if (!rawCode) return "";
  return rawCode;
}

function shouldFallbackOrderCollectionGroup(error) {
  const code = normalizeFirestoreErrorCode(error);
  return code === "failed-precondition";
}

async function recordSiteVisit(payload = {}) {
  const sessionId = String(payload.sessionId || "").trim().slice(0, 120);
  const path = normalizeSiteVisitPath(payload.path || payload.pathname || "/");
  const referrer = String(payload.referrer || "").trim().slice(0, 160);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const localKeys = getSiteVisitLocalKeys(nowMs);
  const hourBucketKey = `${localKeys.dayKey} ${localKeys.hourKey}:00`;
  const sessionRef = siteVisitSessionRef(sessionId || `${path}:${nowMs}`);
  const metaRef = analyticsMetaRef(SITE_VISITS_META_DOC);
  const dailyRef = siteVisitsDailyCollection().doc(localKeys.dayKey);
  const hourlyRef = siteVisitsHourlyCollection().doc(hourBucketKey);
  const hourRef = siteVisitsHourCollection().doc(localKeys.hourKey);
  const weekdayRef = siteVisitsWeekdayCollection().doc(localKeys.weekdayKey);

  return db.runTransaction(async (tx) => {
    const [sessionSnap, metaSnap, dailySnap, hourlySnap, hourSnap, weekdaySnap] = await Promise.all([
      tx.get(sessionRef),
      tx.get(metaRef),
      tx.get(dailyRef),
      tx.get(hourlyRef),
      tx.get(hourRef),
      tx.get(weekdayRef),
    ]);

    if (sessionSnap.exists) {
      const existing = sessionSnap.data() || {};
      tx.set(sessionRef, {
        lastSeenAtMs: nowMs,
        lastSeenAt: nowIso,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });
      return {
        ok: true,
        counted: false,
        sessionId: String(existing.sessionId || sessionId || ""),
        path,
      };
    }

    const meta = metaSnap.exists ? (metaSnap.data() || {}) : {};
    tx.set(sessionRef, {
      sessionId,
      path,
      referrer,
      createdAtMs: nowMs,
      createdAt: nowIso,
      lastSeenAtMs: nowMs,
      lastSeenAt: nowIso,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    tx.set(metaRef, {
      totalVisitCount: safeInt(meta.totalVisitCount) + 1,
      lastVisitAtMs: nowMs,
      lastVisitAt: nowIso,
      updatedAtMs: nowMs,
      updatedAt: nowIso,
    }, { merge: true });
    tx.set(
      dailyRef,
      buildSiteVisitDailyRecord(localKeys.dayKey, dailySnap.exists ? (dailySnap.data() || {}) : {}, nowMs),
      { merge: true }
    );
    tx.set(
      hourlyRef,
      buildSiteVisitHourlyRecord(hourBucketKey, localKeys, hourlySnap.exists ? (hourlySnap.data() || {}) : {}, nowMs),
      { merge: true }
    );
    tx.set(
      hourRef,
      buildSiteVisitDimensionRecord("hourKey", localKeys.hourKey, hourSnap.exists ? (hourSnap.data() || {}) : {}, nowMs),
      { merge: true }
    );
    tx.set(
      weekdayRef,
      buildSiteVisitDimensionRecord(
        "weekdayKey",
        localKeys.weekdayKey,
        weekdaySnap.exists ? (weekdaySnap.data() || {}) : {},
        nowMs
      ),
      { merge: true }
    );

    return {
      ok: true,
      counted: true,
      sessionId: String(sessionId || ""),
      path,
    };
  });
}

async function mapWithConcurrency(items, mapper, concurrency = 4) {
  const safeItems = Array.isArray(items) ? items : [];
  if (!safeItems.length) return [];
  const limit = Math.max(1, Number(concurrency) || 1);
  const results = new Array(safeItems.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, safeItems.length) }, async () => {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= safeItems.length) return;
      results[currentIndex] = await mapper(safeItems[currentIndex], currentIndex);
    }
  });

  await Promise.all(workers);
  return results;
}

async function listClientIdsForOrderFallback() {
  const clientIds = [];
  let lastDoc = null;

  while (true) {
    let query = db.collection(CLIENTS_COLLECTION)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(CLIENT_ORDER_FALLBACK_CLIENT_PAGE_SIZE);

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snap = await query.get();
    if (snap.empty) break;

    snap.forEach((docSnap) => {
      if (docSnap?.id) {
        clientIds.push(String(docSnap.id).trim());
      }
    });

    lastDoc = snap.docs[snap.docs.length - 1] || null;
    if (snap.size < CLIENT_ORDER_FALLBACK_CLIENT_PAGE_SIZE) break;
  }

  return clientIds.filter(Boolean);
}

async function fetchOrdersForClientRange(clientId = "", startMs = 0, endMs = 0, fields = []) {
  const normalizedClientId = String(clientId || "").trim();
  if (!normalizedClientId) return [];

  let query = db.collection(CLIENTS_COLLECTION)
    .doc(normalizedClientId)
    .collection("orders")
    .where("createdAtMs", ">=", startMs)
    .where("createdAtMs", "<=", endMs)
    .orderBy("createdAtMs", "asc");

  if (Array.isArray(fields) && fields.length) {
    query = query.select(...fields);
  }

  const snap = await query.get();
  if (snap.empty) return [];

  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    clientId: normalizedClientId,
    ...(docSnap.data() || {}),
  }));
}

async function fetchOrdersAcrossClientsForRange(startMs = 0, endMs = 0, fields = [], maxDocs = DEPOSIT_ANALYTICS_DOC_LIMIT) {
  const docLimit = Math.min(DEPOSIT_ANALYTICS_DOC_LIMIT, Math.max(100, safeInt(maxDocs) || DEPOSIT_ANALYTICS_DOC_LIMIT));
  const clientIds = await listClientIdsForOrderFallback();
  const perClientRows = await mapWithConcurrency(
    clientIds,
    (clientId) => fetchOrdersForClientRange(clientId, startMs, endMs, fields),
    CLIENT_ORDER_FALLBACK_CONCURRENCY
  );

  const rows = perClientRows
    .flat()
    .sort((left, right) =>
      (safeSignedInt(left?.createdAtMs) - safeSignedInt(right?.createdAtMs))
      || String(left?.id || "").localeCompare(String(right?.id || ""), "fr")
    )
    .slice(0, docLimit);

  return {
    rows,
    truncated: perClientRows.flat().length > docLimit,
    fallbackUsed: true,
  };
}

async function fetchOrdersForClientReviewedRange(clientId = "", startMs = 0, endMs = 0, fields = []) {
  const normalizedClientId = String(clientId || "").trim();
  if (!normalizedClientId) return [];

  let query = db.collection(CLIENTS_COLLECTION)
    .doc(normalizedClientId)
    .collection("orders")
    .where("reviewedAtMs", ">=", startMs)
    .where("reviewedAtMs", "<=", endMs)
    .orderBy("reviewedAtMs", "asc");

  if (Array.isArray(fields) && fields.length) {
    query = query.select(...fields);
  }

  const snap = await query.get();
  if (snap.empty) return [];

  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    clientId: normalizedClientId,
    ...(docSnap.data() || {}),
  }));
}

async function fetchReviewedOrdersAcrossClientsForRange(startMs = 0, endMs = 0, fields = []) {
  const clientIds = await listClientIdsForOrderFallback();
  const perClientRows = await mapWithConcurrency(
    clientIds,
    (clientId) => fetchOrdersForClientReviewedRange(clientId, startMs, endMs, fields),
    CLIENT_ORDER_FALLBACK_CONCURRENCY
  );

  const flattened = perClientRows.flat();
  const rows = flattened
    .sort((left, right) =>
      (safeSignedInt(left?.reviewedAtMs) - safeSignedInt(right?.reviewedAtMs))
      || String(left?.id || "").localeCompare(String(right?.id || ""), "fr")
    )
    .slice(0, DEPOSIT_ANALYTICS_DOC_LIMIT);

  return {
    rows,
    truncated: flattened.length > DEPOSIT_ANALYTICS_DOC_LIMIT,
    fallbackUsed: true,
  };
}

async function fetchWithdrawalsForClientReviewedRange(clientId = "", startMs = 0, endMs = 0, fields = []) {
  const normalizedClientId = String(clientId || "").trim();
  if (!normalizedClientId) return [];

  let query = db.collection(CLIENTS_COLLECTION)
    .doc(normalizedClientId)
    .collection("withdrawals")
    .where("reviewedAtMs", ">=", startMs)
    .where("reviewedAtMs", "<=", endMs)
    .orderBy("reviewedAtMs", "asc");

  if (Array.isArray(fields) && fields.length) {
    query = query.select(...fields);
  }

  const snap = await query.get();
  if (snap.empty) return [];

  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    clientId: normalizedClientId,
    ...(docSnap.data() || {}),
  }));
}

async function fetchReviewedWithdrawalsAcrossClientsForRange(startMs = 0, endMs = 0, fields = []) {
  const clientIds = await listClientIdsForOrderFallback();
  const perClientRows = await mapWithConcurrency(
    clientIds,
    (clientId) => fetchWithdrawalsForClientReviewedRange(clientId, startMs, endMs, fields),
    CLIENT_ORDER_FALLBACK_CONCURRENCY
  );

  const flattened = perClientRows.flat();
  const rows = flattened
    .sort((left, right) =>
      (safeSignedInt(left?.reviewedAtMs) - safeSignedInt(right?.reviewedAtMs))
      || String(left?.id || "").localeCompare(String(right?.id || ""), "fr")
    )
    .slice(0, DEPOSIT_ANALYTICS_DOC_LIMIT);

  return {
    rows,
    truncated: flattened.length > DEPOSIT_ANALYTICS_DOC_LIMIT,
    fallbackUsed: true,
  };
}

function snapshotRecord(docSnap) {
  return {
    id: docSnap.id,
    ...toSerializableValue(docSnap.data() || {}),
  };
}

function getOrderApprovedRealAmountHtg(order = {}) {
  if (isWelcomeBonusOrder(order)) return 0;
  if (getOrderResolutionStatus(order) !== "approved") return 0;
  const explicitAmount = safeInt(order?.approvedAmountHtg);
  return explicitAmount > 0 ? explicitAmount : computeOrderAmount(order);
}

function normalizeAcquisitionGranularity(value = "", rangeMs = 0) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "hour" && rangeMs > 0 && rangeMs <= (7 * 24 * 60 * 60 * 1000)) {
    return "hour";
  }
  return "day";
}

function normalizeAcquisitionRange(options = {}, nowMs = Date.now()) {
  const safeNow = safeSignedInt(nowMs) || Date.now();
  let endMs = safeSignedInt(options.endMs ?? options.dateToMs ?? options.toMs) || safeNow;
  if (endMs <= 0 || endMs > safeNow) endMs = safeNow;

  let startMs = safeSignedInt(options.startMs ?? options.dateFromMs ?? options.fromMs)
    || (endMs - ACQUISITION_DEFAULT_WINDOW_MS);
  if (startMs <= 0 || startMs >= endMs) {
    startMs = endMs - ACQUISITION_DEFAULT_WINDOW_MS;
  }

  if ((endMs - startMs) > ACQUISITION_MAX_WINDOW_MS) {
    startMs = endMs - ACQUISITION_MAX_WINDOW_MS;
  }

  const rangeMs = Math.max(1, endMs - startMs);
  return {
    startMs,
    endMs,
    rangeMs,
    granularity: normalizeAcquisitionGranularity(
      options.granularity || options.bucket || options.resolution,
      rangeMs
    ),
  };
}

function getUtcDayKey(ms = 0) {
  if (!ms) return "";
  const date = new Date(ms);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

function getUtcHourKey(ms = 0) {
  if (!ms) return "";
  const date = new Date(ms);
  return `${getUtcDayKey(ms)} ${String(date.getUTCHours()).padStart(2, "0")}:00`;
}

function getAcquisitionBucketSizeMs(granularity = "day") {
  return granularity === "hour" ? (60 * 60 * 1000) : (24 * 60 * 60 * 1000);
}

function getAcquisitionBucketStartMs(ms = 0, granularity = "day") {
  const safeMs = safeSignedInt(ms);
  if (!safeMs) return 0;
  const bucketSizeMs = getAcquisitionBucketSizeMs(granularity);
  return safeMs - (safeMs % bucketSizeMs);
}

function getAcquisitionBucketKey(ms = 0, granularity = "day") {
  if (!ms) return "";
  return granularity === "hour" ? getUtcHourKey(ms) : getUtcDayKey(ms);
}

function getAcquisitionBucketLabel(ms = 0, granularity = "day") {
  if (!ms) return "-";
  const date = new Date(ms);
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  if (granularity === "hour") {
    const hh = String(date.getUTCHours()).padStart(2, "0");
    return `${dd}/${mm} ${hh}h`;
  }
  return `${dd}/${mm}`;
}

function buildAcquisitionBucketSeed(startMs = 0, endMs = 0, granularity = "day") {
  const bucketSizeMs = getAcquisitionBucketSizeMs(granularity);
  const firstBucketStartMs = getAcquisitionBucketStartMs(startMs, granularity);
  const lastBucketStartMs = getAcquisitionBucketStartMs(endMs, granularity);
  const buckets = [];

  for (let cursor = firstBucketStartMs; cursor <= lastBucketStartMs; cursor += bucketSizeMs) {
    buckets.push({
      startMs: cursor,
      key: getAcquisitionBucketKey(cursor, granularity),
      label: getAcquisitionBucketLabel(cursor, granularity),
      signups: 0,
      depositingSignups: 0,
      activeSignups: 0,
      fidelizedSignups: 0,
      welcomeBonusSignups: 0,
      frozenSignups: 0,
      cumulativeAccounts: 0,
    });
  }

  return buckets;
}

async function getAggregationCount(query) {
  const aggregateSnap = await query.count().get();
  const data = typeof aggregateSnap?.data === "function" ? (aggregateSnap.data() || {}) : {};
  return safeInt(data.count);
}

async function fetchClientSignupRowsForRange(startMs = 0, endMs = 0) {
  const startAt = new Date(Math.max(0, safeSignedInt(startMs)));
  const endAt = new Date(Math.max(0, safeSignedInt(endMs)));
  const rows = [];
  let lastDoc = null;
  let truncated = false;

  while (rows.length < ACQUISITION_DOC_LIMIT) {
    let query = db.collection(CLIENTS_COLLECTION)
      .where("createdAt", ">=", startAt)
      .where("createdAt", "<=", endAt)
      .orderBy("createdAt", "asc")
      .select(
        "createdAt",
        "createdAtMs",
        "lastSeenAt",
        "lastSeenAtMs",
        "hasApprovedDeposit",
        "welcomeBonusClaimed",
        "accountFrozen"
      )
      .limit(Math.min(ACQUISITION_PAGE_FETCH_SIZE, ACQUISITION_DOC_LIMIT - rows.length));

    if (lastDoc) {
      query = query.startAfter(lastDoc);
    }

    const snap = await query.get();
    if (snap.empty) break;

    snap.forEach((docSnap) => {
      rows.push(docSnap.data() || {});
    });

    lastDoc = snap.docs[snap.docs.length - 1] || null;
    if (snap.size < ACQUISITION_PAGE_FETCH_SIZE) break;
  }

  if (lastDoc) {
    const moreSnap = await db.collection(CLIENTS_COLLECTION)
      .where("createdAt", ">=", startAt)
      .where("createdAt", "<=", endAt)
      .orderBy("createdAt", "asc")
      .startAfter(lastDoc)
      .limit(1)
      .get();
    truncated = !moreSnap.empty;
  }

  return { rows, truncated };
}

async function computeClientAcquisitionSnapshot(options = {}) {
  const nowMs = safeSignedInt(options.nowMs) || Date.now();
  const range = normalizeAcquisitionRange(options, nowMs);
  const activeCutoffMs = Math.max(0, range.endMs - ACQUISITION_ACTIVE_LOOKBACK_MS);
  const rangeStartAt = new Date(range.startMs);
  const clientsCollection = db.collection(CLIENTS_COLLECTION);

  const [
    totalAccounts,
    accountsBeforeWindow,
    activeAccounts,
    realClients,
    frozenAccounts,
    signupRowsResult,
  ] = await Promise.all([
    getAggregationCount(clientsCollection),
    getAggregationCount(clientsCollection.where("createdAt", "<", rangeStartAt)),
    getAggregationCount(
      clientsCollection
        .where("lastSeenAtMs", ">=", activeCutoffMs)
        .where("lastSeenAtMs", "<=", range.endMs)
    ),
    getAggregationCount(clientsCollection.where("hasApprovedDeposit", "==", true)),
    getAggregationCount(clientsCollection.where("accountFrozen", "==", true)),
    fetchClientSignupRowsForRange(range.startMs, range.endMs),
  ]);

  const bucketSeed = buildAcquisitionBucketSeed(range.startMs, range.endMs, range.granularity);
  const bucketMap = new Map(bucketSeed.map((item) => [item.key, item]));
  let signupsCount = 0;
  let depositingSignupsCount = 0;
  let activeSignupsCount = 0;
  let fidelizedSignupsCount = 0;
  let welcomeBonusSignupsCount = 0;
  let frozenSignupsCount = 0;

  signupRowsResult.rows.forEach((row) => {
    const createdAtMs = safeSignedInt(row.createdAtMs) || toMillis(row.createdAt);
    if (createdAtMs < range.startMs || createdAtMs > range.endMs) return;

    const lastSeenAtMs = safeSignedInt(row.lastSeenAtMs) || toMillis(row.lastSeenAt);
    const hasApprovedDeposit = row.hasApprovedDeposit === true;
    const welcomeBonusClaimed = row.welcomeBonusClaimed === true;
    const accountFrozen = row.accountFrozen === true;
    const isActive = lastSeenAtMs >= activeCutoffMs;
    const isFidelized = hasApprovedDeposit && lastSeenAtMs >= (createdAtMs + ACQUISITION_FIDELITY_MIN_AGE_MS);
    const bucket = bucketMap.get(getAcquisitionBucketKey(createdAtMs, range.granularity));
    if (!bucket) return;

    signupsCount += 1;
    bucket.signups += 1;

    if (hasApprovedDeposit) {
      depositingSignupsCount += 1;
      bucket.depositingSignups += 1;
    }
    if (isActive) {
      activeSignupsCount += 1;
      bucket.activeSignups += 1;
    }
    if (isFidelized) {
      fidelizedSignupsCount += 1;
      bucket.fidelizedSignups += 1;
    }
    if (welcomeBonusClaimed) {
      welcomeBonusSignupsCount += 1;
      bucket.welcomeBonusSignups += 1;
    }
    if (accountFrozen) {
      frozenSignupsCount += 1;
      bucket.frozenSignups += 1;
    }
  });

  let runningAccounts = accountsBeforeWindow;
  const buckets = bucketSeed.map((bucket) => {
    runningAccounts += safeInt(bucket.signups);
    const signups = safeInt(bucket.signups);
    const depositingSignups = safeInt(bucket.depositingSignups);
    const activeSignups = safeInt(bucket.activeSignups);
    const fidelizedSignups = safeInt(bucket.fidelizedSignups);
    return {
      startMs: safeSignedInt(bucket.startMs),
      key: String(bucket.key || ""),
      label: String(bucket.label || "-"),
      signups,
      depositingSignups,
      activeSignups,
      fidelizedSignups,
      welcomeBonusSignups: safeInt(bucket.welcomeBonusSignups),
      frozenSignups: safeInt(bucket.frozenSignups),
      signupToDepositRatePct: signups > 0 ? Number(((depositingSignups / signups) * 100).toFixed(2)) : 0,
      signupToActiveRatePct: signups > 0 ? Number(((activeSignups / signups) * 100).toFixed(2)) : 0,
      signupToFidelizedRatePct: signups > 0 ? Number(((fidelizedSignups / signups) * 100).toFixed(2)) : 0,
      cumulativeAccounts: runningAccounts,
    };
  });

  return {
    generatedAtMs: nowMs,
    timezone: "UTC",
    window: {
      startMs: range.startMs,
      endMs: range.endMs,
      rangeMs: range.rangeMs,
      granularity: range.granularity,
    },
    definitions: {
      activeLookbackDays: Math.round(ACQUISITION_ACTIVE_LOOKBACK_MS / (24 * 60 * 60 * 1000)),
      fidelizedMinAgeDays: Math.round(ACQUISITION_FIDELITY_MIN_AGE_MS / (24 * 60 * 60 * 1000)),
      fidelizedRule: "Compte avec vrai depot approuve et retour constate au moins 3 jours apres l'inscription.",
      cohortScope: "Les taux de conversion et de fidelisation portent sur les comptes inscrits dans la periode choisie.",
    },
    summary: {
      totalAccounts,
      accountsBeforeWindow,
      signupsCount,
      activeAccounts,
      realClients,
      frozenAccounts,
      depositingSignupsCount,
      activeSignupsCount,
      fidelizedSignupsCount,
      welcomeBonusSignupsCount,
      frozenSignupsCount,
      activeRatePct: totalAccounts > 0 ? Number(((activeAccounts / totalAccounts) * 100).toFixed(2)) : 0,
      realClientRatePct: totalAccounts > 0 ? Number(((realClients / totalAccounts) * 100).toFixed(2)) : 0,
      signupToDepositRatePct: signupsCount > 0 ? Number(((depositingSignupsCount / signupsCount) * 100).toFixed(2)) : 0,
      signupToActiveRatePct: signupsCount > 0 ? Number(((activeSignupsCount / signupsCount) * 100).toFixed(2)) : 0,
      signupToFidelizedRatePct: signupsCount > 0 ? Number(((fidelizedSignupsCount / signupsCount) * 100).toFixed(2)) : 0,
    },
    series: {
      signups: buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.signups })),
      cumulativeAccounts: buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.cumulativeAccounts })),
      depositingSignups: buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.depositingSignups })),
      activeSignups: buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.activeSignups })),
      fidelizedSignups: buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.fidelizedSignups })),
    },
    buckets,
    truncated: signupRowsResult.truncated === true,
    scannedSignupDocs: safeInt(signupRowsResult.rows.length),
    scanLimit: ACQUISITION_DOC_LIMIT,
  };
}

function normalizeDepositAnalyticsGranularity(rawValue = "", rangeMs = 0) {
  const raw = String(rawValue || "").trim().toLowerCase();
  if (raw === "hour" || raw === "day" || raw === "week") return raw;
  if (rangeMs <= (3 * 24 * 60 * 60 * 1000)) return "hour";
  if (rangeMs <= (75 * 24 * 60 * 60 * 1000)) return "day";
  return "week";
}

function normalizeDepositAnalyticsRange(options = {}, nowMs = Date.now()) {
  const safeNow = safeSignedInt(nowMs) || Date.now();
  let endMs = safeSignedInt(options.endMs ?? options.dateToMs ?? options.toMs) || safeNow;
  if (endMs <= 0 || endMs > safeNow) endMs = safeNow;

  let startMs = safeSignedInt(options.startMs ?? options.dateFromMs ?? options.fromMs)
    || (endMs - DEPOSIT_ANALYTICS_DEFAULT_WINDOW_MS);
  if (startMs <= 0 || startMs >= endMs) {
    startMs = endMs - DEPOSIT_ANALYTICS_DEFAULT_WINDOW_MS;
  }

  if ((endMs - startMs) > DEPOSIT_ANALYTICS_MAX_WINDOW_MS) {
    startMs = endMs - DEPOSIT_ANALYTICS_MAX_WINDOW_MS;
  }

  const rangeMs = Math.max(1, endMs - startMs);
  return {
    startMs,
    endMs,
    rangeMs,
    granularity: normalizeDepositAnalyticsGranularity(
      options.granularity || options.bucket || options.resolution,
      rangeMs
    ),
  };
}

function getUtcWeekStartMs(ms = 0) {
  const safeMs = safeSignedInt(ms);
  if (!safeMs) return 0;
  const date = new Date(safeMs);
  const weekday = date.getUTCDay();
  const mondayOffset = weekday === 0 ? -6 : (1 - weekday);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate() + mondayOffset,
    0, 0, 0, 0
  );
}

function getDepositAnalyticsBucketStartMs(ms = 0, granularity = "day") {
  const safeMs = safeSignedInt(ms);
  if (!safeMs) return 0;
  if (granularity === "hour") return getAcquisitionBucketStartMs(safeMs, "hour");
  if (granularity === "week") return getUtcWeekStartMs(safeMs);
  return getAcquisitionBucketStartMs(safeMs, "day");
}

function getDepositAnalyticsBucketKey(ms = 0, granularity = "day") {
  if (!ms) return "";
  if (granularity === "hour") return getUtcHourKey(ms);
  if (granularity === "week") {
    const startMs = getUtcWeekStartMs(ms);
    return `W:${getUtcDayKey(startMs)}`;
  }
  return getUtcDayKey(ms);
}

function getDepositAnalyticsBucketLabel(ms = 0, granularity = "day") {
  if (!ms) return "-";
  const date = new Date(ms);
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  if (granularity === "hour") {
    const hh = String(date.getUTCHours()).padStart(2, "0");
    return `${dd}/${mm} ${hh}h`;
  }
  if (granularity === "week") {
    const end = new Date(ms + ((7 * 24 * 60 * 60 * 1000) - 1));
    const endDd = String(end.getUTCDate()).padStart(2, "0");
    const endMm = String(end.getUTCMonth() + 1).padStart(2, "0");
    return `${dd}/${mm} - ${endDd}/${endMm}`;
  }
  return `${dd}/${mm}`;
}

function buildDepositAnalyticsBucketSeed(startMs = 0, endMs = 0, granularity = "day") {
  const firstBucketStartMs = getDepositAnalyticsBucketStartMs(startMs, granularity);
  const lastBucketStartMs = getDepositAnalyticsBucketStartMs(endMs, granularity);
  const buckets = [];
  let cursor = firstBucketStartMs;

  while (cursor <= lastBucketStartMs) {
    buckets.push({
      startMs: cursor,
      key: getDepositAnalyticsBucketKey(cursor, granularity),
      label: getDepositAnalyticsBucketLabel(cursor, granularity),
      requestedCount: 0,
      approvedCount: 0,
      rejectedCount: 0,
      pendingCount: 0,
      requestedHtg: 0,
      approvedHtg: 0,
      rejectedHtg: 0,
      pendingHtg: 0,
      moncashRequestedHtg: 0,
      natcashRequestedHtg: 0,
      otherRequestedHtg: 0,
      moncashApprovedHtg: 0,
      natcashApprovedHtg: 0,
      otherApprovedHtg: 0,
      moncashRejectedHtg: 0,
      natcashRejectedHtg: 0,
      otherRejectedHtg: 0,
      cumulativeApprovedHtg: 0,
    });

    cursor += granularity === "hour"
      ? (60 * 60 * 1000)
      : granularity === "week"
        ? (7 * 24 * 60 * 60 * 1000)
        : (24 * 60 * 60 * 1000);
  }

  return buckets;
}

function normalizeDepositAnalyticsMethod(order = {}) {
  if (isWelcomeBonusOrder(order)) return "welcome_bonus";
  const raw = `${String(order?.methodId || "")} ${String(order?.methodName || "")}`.trim().toLowerCase();
  if (!raw) return "other";
  if (/mon\s*cash/.test(raw) || raw.includes("moncash")) return "moncash";
  if (/nat\s*cash/.test(raw) || raw.includes("natcash")) return "natcash";
  return "other";
}

async function fetchDepositAnalyticsRowsForRange(startMs = 0, endMs = 0, maxDocs = DEPOSIT_ANALYTICS_DOC_LIMIT) {
  const docLimit = Math.min(DEPOSIT_ANALYTICS_DOC_LIMIT, Math.max(100, safeInt(maxDocs) || DEPOSIT_ANALYTICS_DOC_LIMIT));
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
  const rows = [];
  let lastDoc = null;
  let truncated = false;

  try {
    while (rows.length < docLimit) {
      let query = db.collectionGroup("orders")
        .where("createdAtMs", ">=", startMs)
        .where("createdAtMs", "<=", endMs)
        .orderBy("createdAtMs", "asc")
        .select(...fields)
        .limit(Math.min(DEPOSIT_ANALYTICS_PAGE_FETCH_SIZE, docLimit - rows.length));

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snap = await query.get();
      if (snap.empty) break;

      snap.forEach((docSnap) => {
        rows.push(docSnap.data() || {});
      });

      lastDoc = snap.docs[snap.docs.length - 1] || null;
      if (snap.size < DEPOSIT_ANALYTICS_PAGE_FETCH_SIZE) break;
    }

    if (lastDoc) {
      const moreSnap = await db.collectionGroup("orders")
        .where("createdAtMs", ">=", startMs)
        .where("createdAtMs", "<=", endMs)
        .orderBy("createdAtMs", "asc")
        .startAfter(lastDoc)
        .limit(1)
        .get();
      truncated = !moreSnap.empty;
    }

    return { rows, truncated, fallbackUsed: false };
  } catch (error) {
    if (!shouldFallbackOrderCollectionGroup(error)) {
      throw error;
    }
    return fetchOrdersAcrossClientsForRange(startMs, endMs, fields, docLimit);
  }
}

async function computeDepositAnalyticsSnapshot(options = {}) {
  const nowMs = safeSignedInt(options.nowMs) || Date.now();
  const range = normalizeDepositAnalyticsRange(options, nowMs);
  const docLimit = Math.min(DEPOSIT_ANALYTICS_DOC_LIMIT, Math.max(100, safeInt(options.maxDocs || options.docLimit) || DEPOSIT_ANALYTICS_DOC_LIMIT));
  const rowsResult = await fetchDepositAnalyticsRowsForRange(range.startMs, range.endMs, docLimit);
  const bucketSeed = buildDepositAnalyticsBucketSeed(range.startMs, range.endMs, range.granularity);
  const bucketMap = new Map(bucketSeed.map((item) => [item.key, item]));

  const summary = {
    requestedCount: 0,
    approvedCount: 0,
    rejectedCount: 0,
    pendingCount: 0,
    requestedHtg: 0,
    approvedHtg: 0,
    rejectedHtg: 0,
    pendingHtg: 0,
    moncashRequestedHtg: 0,
    moncashApprovedHtg: 0,
    moncashRejectedHtg: 0,
    moncashRequestedCount: 0,
    moncashApprovedCount: 0,
    moncashRejectedCount: 0,
    natcashRequestedHtg: 0,
    natcashApprovedHtg: 0,
    natcashRejectedHtg: 0,
    natcashRequestedCount: 0,
    natcashApprovedCount: 0,
    natcashRejectedCount: 0,
    otherRequestedHtg: 0,
    otherApprovedHtg: 0,
    otherRejectedHtg: 0,
    otherRequestedCount: 0,
    otherApprovedCount: 0,
    otherRejectedCount: 0,
  };

  rowsResult.rows.forEach((row) => {
    if (isWelcomeBonusOrder(row)) return;
    const createdAtMs = safeSignedInt(row.createdAtMs) || toMillis(row.createdAt);
    if (createdAtMs < range.startMs || createdAtMs > range.endMs) return;

    const bucket = bucketMap.get(getDepositAnalyticsBucketKey(createdAtMs, range.granularity));
    if (!bucket) return;

    const method = normalizeDepositAnalyticsMethod(row);
    const requestedHtg = Math.max(0, computeOrderAmount(row));
    const approvedHtg = Math.max(0, getOrderApprovedRealAmountHtg(row));
    const resolution = getOrderResolutionStatus(row);
    const rejectedHtg = resolution === "rejected" ? requestedHtg : 0;
    const pendingHtg = resolution === "pending" || resolution === "review" ? requestedHtg : 0;

    summary.requestedCount += 1;
    summary.requestedHtg += requestedHtg;
    bucket.requestedCount += 1;
    bucket.requestedHtg += requestedHtg;

    if (resolution === "approved") {
      summary.approvedCount += 1;
      summary.approvedHtg += approvedHtg;
      bucket.approvedCount += 1;
      bucket.approvedHtg += approvedHtg;
    } else if (resolution === "rejected") {
      summary.rejectedCount += 1;
      summary.rejectedHtg += rejectedHtg;
      bucket.rejectedCount += 1;
      bucket.rejectedHtg += rejectedHtg;
    } else {
      summary.pendingCount += 1;
      summary.pendingHtg += pendingHtg;
      bucket.pendingCount += 1;
      bucket.pendingHtg += pendingHtg;
    }

    if (method === "moncash") {
      summary.moncashRequestedCount += 1;
      summary.moncashRequestedHtg += requestedHtg;
      bucket.moncashRequestedHtg += requestedHtg;
      if (resolution === "approved") {
        summary.moncashApprovedCount += 1;
        summary.moncashApprovedHtg += approvedHtg;
        bucket.moncashApprovedHtg += approvedHtg;
      } else if (resolution === "rejected") {
        summary.moncashRejectedCount += 1;
        summary.moncashRejectedHtg += rejectedHtg;
        bucket.moncashRejectedHtg += rejectedHtg;
      }
    } else if (method === "natcash") {
      summary.natcashRequestedCount += 1;
      summary.natcashRequestedHtg += requestedHtg;
      bucket.natcashRequestedHtg += requestedHtg;
      if (resolution === "approved") {
        summary.natcashApprovedCount += 1;
        summary.natcashApprovedHtg += approvedHtg;
        bucket.natcashApprovedHtg += approvedHtg;
      } else if (resolution === "rejected") {
        summary.natcashRejectedCount += 1;
        summary.natcashRejectedHtg += rejectedHtg;
        bucket.natcashRejectedHtg += rejectedHtg;
      }
    } else {
      summary.otherRequestedCount += 1;
      summary.otherRequestedHtg += requestedHtg;
      bucket.otherRequestedHtg += requestedHtg;
      if (resolution === "approved") {
        summary.otherApprovedCount += 1;
        summary.otherApprovedHtg += approvedHtg;
        bucket.otherApprovedHtg += approvedHtg;
      } else if (resolution === "rejected") {
        summary.otherRejectedCount += 1;
        summary.otherRejectedHtg += rejectedHtg;
        bucket.otherRejectedHtg += rejectedHtg;
      }
    }
  });

  let cumulativeApprovedHtg = 0;
  const buckets = bucketSeed.map((bucket) => {
    cumulativeApprovedHtg += safeInt(bucket.approvedHtg);
    return {
      startMs: safeSignedInt(bucket.startMs),
      key: String(bucket.key || ""),
      label: String(bucket.label || "-"),
      requestedCount: safeInt(bucket.requestedCount),
      approvedCount: safeInt(bucket.approvedCount),
      rejectedCount: safeInt(bucket.rejectedCount),
      pendingCount: safeInt(bucket.pendingCount),
      requestedHtg: safeInt(bucket.requestedHtg),
      approvedHtg: safeInt(bucket.approvedHtg),
      rejectedHtg: safeInt(bucket.rejectedHtg),
      pendingHtg: safeInt(bucket.pendingHtg),
      moncashRequestedHtg: safeInt(bucket.moncashRequestedHtg),
      natcashRequestedHtg: safeInt(bucket.natcashRequestedHtg),
      otherRequestedHtg: safeInt(bucket.otherRequestedHtg),
      moncashApprovedHtg: safeInt(bucket.moncashApprovedHtg),
      natcashApprovedHtg: safeInt(bucket.natcashApprovedHtg),
      otherApprovedHtg: safeInt(bucket.otherApprovedHtg),
      moncashRejectedHtg: safeInt(bucket.moncashRejectedHtg),
      natcashRejectedHtg: safeInt(bucket.natcashRejectedHtg),
      otherRejectedHtg: safeInt(bucket.otherRejectedHtg),
      approvalRatePct: safeInt(bucket.requestedHtg) > 0
        ? Number(((safeInt(bucket.approvedHtg) / safeInt(bucket.requestedHtg)) * 100).toFixed(2))
        : 0,
      cumulativeApprovedHtg,
    };
  });

  const approvedRatePct = summary.requestedHtg > 0
    ? Number(((summary.approvedHtg / summary.requestedHtg) * 100).toFixed(2))
    : 0;
  const rejectedRatePct = summary.requestedHtg > 0
    ? Number(((summary.rejectedHtg / summary.requestedHtg) * 100).toFixed(2))
    : 0;
  const moncashApprovedSharePct = summary.approvedHtg > 0
    ? Number(((summary.moncashApprovedHtg / summary.approvedHtg) * 100).toFixed(2))
    : 0;
  const natcashApprovedSharePct = summary.approvedHtg > 0
    ? Number(((summary.natcashApprovedHtg / summary.approvedHtg) * 100).toFixed(2))
    : 0;

  return {
    generatedAtMs: nowMs,
    timezone: "UTC",
    window: {
      startMs: range.startMs,
      endMs: range.endMs,
      rangeMs: range.rangeMs,
      granularity: range.granularity,
    },
    definitions: {
      inflowRule: "Les entrees HTG de l'entreprise correspondent aux montants de depots reels approuves.",
      rejectionRule: "Les bonus bienvenue sont exclus. Les montants rejetes reprennent le montant demande sur la commande.",
      source: "Source: collectionGroup(orders), excluant welcome_bonus.",
    },
    summary: {
      ...summary,
      approvedRatePct,
      rejectedRatePct,
      moncashApprovedSharePct,
      natcashApprovedSharePct,
    },
    series: {
      requestedHtg: buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.requestedHtg })),
      approvedHtg: buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.approvedHtg })),
      rejectedHtg: buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.rejectedHtg })),
      cumulativeApprovedHtg: buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.cumulativeApprovedHtg })),
      moncashApprovedHtg: buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.moncashApprovedHtg })),
      natcashApprovedHtg: buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.natcashApprovedHtg })),
      approvalsVsRejects: buckets.map((item) => ({
        startMs: item.startMs,
        label: item.label,
        approvedHtg: item.approvedHtg,
        rejectedHtg: item.rejectedHtg,
      })),
    },
    buckets,
    scannedOrderDocs: safeInt(rowsResult.rows.length),
    truncated: rowsResult.truncated === true,
    scanLimit: docLimit,
  };
}

function normalizeApprovedDepositSource(order = {}) {
  if (order?.agentAssisted === true) return "agent";
  const source = String(order?.source || "").trim().toLowerCase();
  if (source === "agent_assisted") return "agent";
  if (String(order?.creditedByAgentUid || "").trim()) return "agent";
  if (String(order?.creditedByAgentEmail || "").trim()) return "agent";
  return "direct";
}

function normalizeApprovedDepositSourceLabel(source = "direct", order = {}) {
  if (source === "agent") {
    const agentEmail = String(order?.creditedByAgentEmail || "").trim();
    return agentEmail ? `Agent (${agentEmail})` : "Depot agent";
  }
  return "Depot direct";
}

async function fetchApprovedDepositRowsForRange(startMs = 0, endMs = 0) {
  const fields = [
    "amount",
    "amountHtg",
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
    "customerName",
    "customerEmail",
    "customerPhone",
    "uniqueCode",
    "source",
    "agentAssisted",
    "creditedByAgentUid",
    "creditedByAgentEmail",
  ];
  const rows = [];
  let lastDoc = null;
  let truncated = false;

  try {
    while (rows.length < DEPOSIT_ANALYTICS_DOC_LIMIT) {
      let query = db.collectionGroup("orders")
        .where("createdAtMs", ">=", startMs)
        .where("createdAtMs", "<=", endMs)
        .orderBy("createdAtMs", "asc")
        .select(...fields)
        .limit(Math.min(DEPOSIT_ANALYTICS_PAGE_FETCH_SIZE, DEPOSIT_ANALYTICS_DOC_LIMIT - rows.length));

      if (lastDoc) {
        query = query.startAfter(lastDoc);
      }

      const snap = await query.get();
      if (snap.empty) break;

      snap.forEach((docSnap) => {
        const data = docSnap.data() || {};
        rows.push({
          id: docSnap.id,
          clientId: String(docSnap?.ref?.parent?.parent?.id || "").trim(),
          ...data,
        });
      });

      lastDoc = snap.docs[snap.docs.length - 1] || null;
      if (snap.size < DEPOSIT_ANALYTICS_PAGE_FETCH_SIZE) break;
    }

    if (lastDoc) {
      const moreSnap = await db.collectionGroup("orders")
        .where("createdAtMs", ">=", startMs)
        .where("createdAtMs", "<=", endMs)
        .orderBy("createdAtMs", "asc")
        .startAfter(lastDoc)
        .limit(1)
        .get();
      truncated = !moreSnap.empty;
    }

    return { rows, truncated, fallbackUsed: false };
  } catch (error) {
    if (!shouldFallbackOrderCollectionGroup(error)) {
      throw error;
    }
    return fetchOrdersAcrossClientsForRange(startMs, endMs, fields);
  }
}

async function computeApprovedDepositsSnapshot(options = {}) {
  const nowMs = safeSignedInt(options.nowMs) || Date.now();
  const range = normalizeDepositAnalyticsRange(options, nowMs);
  const rowLimit = Math.min(500, Math.max(25, safeInt(options.listLimit || options.limit || 250) || 250));
  const rowsResult = await fetchApprovedDepositRowsForRange(range.startMs, range.endMs);
  const bucketSeed = buildDepositAnalyticsBucketSeed(range.startMs, range.endMs, range.granularity);
  const bucketMap = new Map(bucketSeed.map((item) => [item.key, item]));

  const summary = {
    totalApprovedCount: 0,
    totalApprovedHtg: 0,
    directApprovedCount: 0,
    directApprovedHtg: 0,
    agentApprovedCount: 0,
    agentApprovedHtg: 0,
    moncashApprovedCount: 0,
    moncashApprovedHtg: 0,
    natcashApprovedCount: 0,
    natcashApprovedHtg: 0,
    otherApprovedCount: 0,
    otherApprovedHtg: 0,
  };

  const approvedRows = [];

  rowsResult.rows.forEach((row) => {
    if (isWelcomeBonusOrder(row)) return;
    if (getOrderResolutionStatus(row) !== "approved") return;

    const createdAtMs = safeSignedInt(row.createdAtMs) || toMillis(row.createdAt);
    if (createdAtMs < range.startMs || createdAtMs > range.endMs) return;

    const approvedHtg = Math.max(0, getOrderApprovedRealAmountHtg(row));
    if (approvedHtg <= 0) return;

    const method = normalizeDepositAnalyticsMethod(row);
    const source = normalizeApprovedDepositSource(row);
    const sourceLabel = normalizeApprovedDepositSourceLabel(source, row);
    const bucket = bucketMap.get(getDepositAnalyticsBucketKey(createdAtMs, range.granularity));
    if (bucket) {
      bucket.approvedCount += 1;
      bucket.approvedHtg += approvedHtg;
      if (!bucket.directApprovedCount) bucket.directApprovedCount = 0;
      if (!bucket.directApprovedHtg) bucket.directApprovedHtg = 0;
      if (!bucket.agentApprovedCount) bucket.agentApprovedCount = 0;
      if (!bucket.agentApprovedHtg) bucket.agentApprovedHtg = 0;
      if (source === "agent") {
        bucket.agentApprovedCount += 1;
        bucket.agentApprovedHtg += approvedHtg;
      } else {
        bucket.directApprovedCount += 1;
        bucket.directApprovedHtg += approvedHtg;
      }
    }

    summary.totalApprovedCount += 1;
    summary.totalApprovedHtg += approvedHtg;

    if (source === "agent") {
      summary.agentApprovedCount += 1;
      summary.agentApprovedHtg += approvedHtg;
    } else {
      summary.directApprovedCount += 1;
      summary.directApprovedHtg += approvedHtg;
    }

    if (method === "moncash") {
      summary.moncashApprovedCount += 1;
      summary.moncashApprovedHtg += approvedHtg;
    } else if (method === "natcash") {
      summary.natcashApprovedCount += 1;
      summary.natcashApprovedHtg += approvedHtg;
    } else {
      summary.otherApprovedCount += 1;
      summary.otherApprovedHtg += approvedHtg;
    }

    approvedRows.push({
      id: String(row.id || "").trim(),
      clientId: String(row.clientId || row.uid || "").trim(),
      customerName: String(row.customerName || "").trim(),
      customerEmail: String(row.customerEmail || "").trim(),
      customerPhone: String(row.customerPhone || "").trim(),
      uniqueCode: String(row.uniqueCode || "").trim(),
      methodId: String(row.methodId || "").trim(),
      methodName: String(row.methodName || "").trim(),
      source,
      sourceLabel,
      agentAssisted: source === "agent",
      creditedByAgentEmail: String(row.creditedByAgentEmail || "").trim(),
      approvedAmountHtg: approvedHtg,
      createdAtMs,
    });
  });

  approvedRows.sort((left, right) =>
    (Number(right.createdAtMs || 0) - Number(left.createdAtMs || 0))
    || String(left.id || "").localeCompare(String(right.id || ""), "fr")
  );

  let cumulativeApprovedHtg = 0;
  const buckets = bucketSeed.map((bucket) => {
    cumulativeApprovedHtg += safeInt(bucket.approvedHtg);
    return {
      startMs: safeSignedInt(bucket.startMs),
      key: String(bucket.key || ""),
      label: String(bucket.label || "-"),
      approvedCount: safeInt(bucket.approvedCount),
      approvedHtg: safeInt(bucket.approvedHtg),
      directApprovedCount: safeInt(bucket.directApprovedCount),
      directApprovedHtg: safeInt(bucket.directApprovedHtg),
      agentApprovedCount: safeInt(bucket.agentApprovedCount),
      agentApprovedHtg: safeInt(bucket.agentApprovedHtg),
      cumulativeApprovedHtg,
    };
  });

  const avgApprovedHtgPerDeposit = summary.totalApprovedCount > 0
    ? Number((summary.totalApprovedHtg / summary.totalApprovedCount).toFixed(2))
    : 0;
  const agentSharePct = summary.totalApprovedHtg > 0
    ? Number(((summary.agentApprovedHtg / summary.totalApprovedHtg) * 100).toFixed(2))
    : 0;

  return {
    generatedAtMs: nowMs,
    timezone: "UTC",
    range: {
      startMs: range.startMs,
      endMs: range.endMs,
      rangeMs: range.rangeMs,
      granularity: range.granularity,
      isGlobal: range.windowKey === "global",
      windowKey: String(range.windowKey || ""),
    },
    snapshot: {
      definitions: {
        source: "Source: collectionGroup(orders), approved only, welcome_bonus exclu.",
        agentRule: "Un depot agent est un order approuve avec agentAssisted=true ou des metadonnees de credit agent.",
        directRule: "Un depot direct est un order approuve sans marqueur agent.",
      },
      summary: {
        ...summary,
        avgApprovedHtgPerDeposit,
        agentSharePct,
      },
      series: {
        approvedHtg: buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.approvedHtg })),
        directApprovedHtg: buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.directApprovedHtg })),
        agentApprovedHtg: buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.agentApprovedHtg })),
      },
      buckets,
      recentApprovedDeposits: approvedRows.slice(0, rowLimit),
      sourceMix: [
        { key: "direct", label: "Depot direct", count: summary.directApprovedCount, amountHtg: summary.directApprovedHtg },
        { key: "agent", label: "Depot agent", count: summary.agentApprovedCount, amountHtg: summary.agentApprovedHtg },
      ],
      methodMix: [
        { key: "moncash", label: "MonCash", count: summary.moncashApprovedCount, amountHtg: summary.moncashApprovedHtg },
        { key: "natcash", label: "NatCash", count: summary.natcashApprovedCount, amountHtg: summary.natcashApprovedHtg },
        { key: "other", label: "Autres", count: summary.otherApprovedCount, amountHtg: summary.otherApprovedHtg },
      ],
    },
    scannedOrderDocs: safeInt(rowsResult.rows.length),
    truncated: rowsResult.truncated === true || approvedRows.length > rowLimit,
    scanLimit: DEPOSIT_ANALYTICS_DOC_LIMIT,
  };
}

function getCashflowResolutionTimestampMs(record = {}) {
  return (
    safeSignedInt(record.approvedAtMs)
    || safeSignedInt(record.reviewedAtMs)
    || safeSignedInt(record.resolvedAtMs)
    || safeSignedInt(record.updatedAtMs)
    || safeSignedInt(record.createdAtMs)
    || toMillis(record.updatedAt)
    || toMillis(record.createdAt)
    || 0
  );
}

function getApprovedWithdrawalAmountHtg(withdrawal = {}) {
  return Math.max(
    0,
    safeInt(
      withdrawal.approvedAmountHtg
      ?? withdrawal.requestedAmount
      ?? withdrawal.amountHtg
      ?? withdrawal.amount
    )
  );
}

async function fetchApprovedCashInRowsForRange(startMs = 0, endMs = 0) {
  const fields = [
    "amount",
    "amountHtg",
    "items",
    "status",
    "resolutionStatus",
    "approvedAmountHtg",
    "createdAtMs",
    "createdAt",
    "updatedAtMs",
    "updatedAt",
    "resolvedAtMs",
    "reviewedAtMs",
    "approvedAtMs",
    "approvedAt",
    "methodId",
    "methodName",
    "orderType",
    "kind",
    "customerName",
    "customerEmail",
    "customerPhone",
    "uniqueCode",
    "source",
    "agentAssisted",
    "creditedByAgentUid",
    "creditedByAgentEmail",
  ];

  try {
    const query = db.collectionGroup("orders")
      .where("resolutionStatus", "==", "approved")
      .where("reviewedAtMs", ">=", startMs)
      .where("reviewedAtMs", "<=", endMs)
      .orderBy("reviewedAtMs", "asc")
      .select(...fields)
      .limit(DEPOSIT_ANALYTICS_DOC_LIMIT);

    const snap = await query.get();
    return {
      rows: snap.docs.map((docSnap) => ({
        id: docSnap.id,
        clientId: String(docSnap?.ref?.parent?.parent?.id || "").trim(),
        ...(docSnap.data() || {}),
      })),
      truncated: snap.size >= DEPOSIT_ANALYTICS_DOC_LIMIT,
      fallbackUsed: false,
    };
  } catch (error) {
    if (!shouldFallbackOrderCollectionGroup(error)) {
      throw error;
    }
    return fetchReviewedOrdersAcrossClientsForRange(startMs, endMs, fields);
  }
}

async function fetchApprovedWithdrawalRowsForRange(startMs = 0, endMs = 0) {
  const fields = [
    "status",
    "resolutionStatus",
    "requestedAmount",
    "amount",
    "amountHtg",
    "approvedAmountHtg",
    "createdAtMs",
    "createdAt",
    "updatedAtMs",
    "updatedAt",
    "reviewedAtMs",
    "resolvedAtMs",
    "approvedAtMs",
    "approvedAt",
    "customerName",
    "customerEmail",
    "customerPhone",
    "methodId",
    "methodName",
    "destinationType",
    "destinationValue",
    "clientUid",
    "clientId",
    "uid",
  ];

  try {
    const query = db.collectionGroup("withdrawals")
      .where("status", "==", "approved")
      .where("reviewedAtMs", ">=", startMs)
      .where("reviewedAtMs", "<=", endMs)
      .orderBy("reviewedAtMs", "asc")
      .select(...fields)
      .limit(DEPOSIT_ANALYTICS_DOC_LIMIT);
    const snap = await query.get();
    return {
      rows: snap.docs.map((docSnap) => ({
        id: docSnap.id,
        clientId: String(docSnap?.ref?.parent?.parent?.id || "").trim(),
        ...(docSnap.data() || {}),
      })),
      truncated: snap.size >= DEPOSIT_ANALYTICS_DOC_LIMIT,
      fallbackUsed: false,
    };
  } catch (error) {
    const code = safeSignedInt(error?.code);
    if (code !== 9 && !String(error?.message || "").includes("FAILED_PRECONDITION")) {
      throw error;
    }
    return fetchReviewedWithdrawalsAcrossClientsForRange(startMs, endMs, fields);
  }
}

function inferCashflowHumanCount(gameKey = "", result = {}) {
  const explicit = safeInt(result.humanCount || result.humanPlayers || result.humanPlayerCount);
  if (explicit > 0) return explicit;

  const playerUids = Array.isArray(result.playerUids)
    ? result.playerUids.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const playerCount = playerUids.length;
  const botCount = safeInt(result.botCount);
  const roomMode = String(result.roomMode || result.gameMode || "").trim().toLowerCase();
  const aiProfile = String(result.aiProfile || "").trim().toLowerCase();

  if (gameKey === "domino_classic") return 1;
  if (gameKey === "ludo") return roomMode === "ludo_friends" ? 2 : 1;
  if (gameKey === "chess") {
    if (botCount > 0 || aiProfile || roomMode.includes("bot")) return 1;
    return Math.max(1, Math.min(2, playerCount || 2));
  }
  if (gameKey === "pong") {
    if (botCount > 0 || aiProfile) return 1;
    return Math.max(1, Math.min(2, playerCount || 1));
  }
  if (gameKey === "duel") {
    if (botCount > 0 || aiProfile) return 1;
    return Math.max(1, Math.min(2, playerCount || 2));
  }
  if (gameKey === "morpion" || gameKey === "dame") {
    return Math.max(1, Math.min(2, playerCount || 2));
  }
  return Math.max(1, playerCount || 1);
}

function inferCashflowRewardGranted(gameKey = "", result = {}) {
  const rewardAmountHtg = safeInt(result?.rewardAmountHtg || result?.rewardExpectedHtg);
  const hasRewardFlag = Object.prototype.hasOwnProperty.call(result || {}, "rewardGranted");
  let rewardGranted = result?.rewardGranted === true || (!hasRewardFlag && rewardAmountHtg > 0);
  if (gameKey === "chess") {
    const winnerType = String(result?.winnerType || result?.winner || result?.resultType || "").trim().toLowerCase();
    const winnerUid = String(result?.winnerUid || "").trim();
    rewardGranted = rewardGranted && (winnerType === "human" || winnerType === "user" || winnerType === "player" || !!winnerUid);
  }
  return rewardGranted;
}

function buildCashflowBucketSeed(startMs = 0, endMs = 0, granularity = "day") {
  const bucketSizeMs = granularity === "hour" ? (60 * 60 * 1000) : (24 * 60 * 60 * 1000);
  const firstBucketStartMs = startMs - (startMs % bucketSizeMs);
  const lastBucketStartMs = endMs - (endMs % bucketSizeMs);
  const buckets = [];

  for (let cursor = firstBucketStartMs; cursor <= lastBucketStartMs; cursor += bucketSizeMs) {
    buckets.push({
      startMs: cursor,
      key: String(cursor),
      label: formatTimelineBucketLabel(granularity, cursor),
      approvedDepositsHtg: 0,
      directApprovedDepositsHtg: 0,
      agentApprovedDepositsHtg: 0,
      approvedWithdrawalsHtg: 0,
      usersStakeHtg: 0,
      usersPayoutHtg: 0,
      usersNetHtg: 0,
      operatorGameEdgeHtg: 0,
      netCashHtg: 0,
      netBusinessHtg: 0,
    });
  }

  return buckets;
}

async function computeHtgCashflowSnapshot(options = {}) {
  const nowMs = safeSignedInt(options.nowMs) || Date.now();
  const range = getTimelineAnalyticsRange(options, nowMs);
  const includeRecent = options.includeRecent !== false;
  const includeBuckets = options.includeBuckets !== false;
  const rawRowLimit = Number(options.listLimit ?? options.limit);
  const resolvedRowLimit = Number.isFinite(rawRowLimit) ? Math.trunc(rawRowLimit) : 120;
  const rowLimit = includeRecent ? Math.min(300, Math.max(0, resolvedRowLimit)) : 0;
  const bucketSeed = includeBuckets ? buildCashflowBucketSeed(range.startMs, range.endMs, range.granularity) : [];
  const bucketMap = includeBuckets ? new Map(bucketSeed.map((item) => [String(item.key), item])) : new Map();

  const [depositRowsResult, withdrawalRowsResult] = await Promise.all([
    fetchApprovedCashInRowsForRange(range.startMs, range.endMs),
    fetchApprovedWithdrawalRowsForRange(range.startMs, range.endMs),
  ]);

  const summary = {
    approvedDepositsHtg: 0,
    directApprovedDepositsHtg: 0,
    agentApprovedDepositsHtg: 0,
    approvedDepositsCount: 0,
    approvedWithdrawalsHtg: 0,
    approvedWithdrawalsCount: 0,
    usersStakeHtg: 0,
    usersPayoutHtg: 0,
    usersNetHtg: 0,
    operatorGameEdgeHtg: 0,
    netCashHtg: 0,
    netBusinessHtg: 0,
  };

  const recentDeposits = [];
  const recentWithdrawals = [];
  const recentGames = [];

  depositRowsResult.rows.forEach((row) => {
    if (isWelcomeBonusOrder(row)) return;
    const resolutionStatus = getOrderResolutionStatus(row);
    if (resolutionStatus !== "approved") return;
    const resolvedAtMs = getCashflowResolutionTimestampMs(row);
    if (resolvedAtMs < range.startMs || resolvedAtMs > range.endMs) return;
    const approvedHtg = Math.max(0, getOrderApprovedRealAmountHtg(row));
    if (approvedHtg <= 0) return;

    const bucket = bucketMap.get(String(resolvedAtMs - (resolvedAtMs % (range.granularity === "hour" ? (60 * 60 * 1000) : (24 * 60 * 60 * 1000)))));
    const source = normalizeApprovedDepositSource(row);

    summary.approvedDepositsHtg += approvedHtg;
    summary.approvedDepositsCount += 1;
    if (source === "agent") {
      summary.agentApprovedDepositsHtg += approvedHtg;
    } else {
      summary.directApprovedDepositsHtg += approvedHtg;
    }

    if (bucket) {
      bucket.approvedDepositsHtg += approvedHtg;
      if (source === "agent") bucket.agentApprovedDepositsHtg += approvedHtg;
      else bucket.directApprovedDepositsHtg += approvedHtg;
    }

    if (includeRecent) {
      recentDeposits.push({
        id: String(row.id || "").trim(),
        kind: "deposit",
        resolvedAtMs,
        amountHtg: approvedHtg,
        source,
        sourceLabel: normalizeApprovedDepositSourceLabel(source, row),
        methodName: String(row.methodName || row.methodId || "").trim(),
        customerName: String(row.customerName || "").trim(),
        customerEmail: String(row.customerEmail || "").trim(),
        uniqueCode: String(row.uniqueCode || "").trim(),
      });
    }
  });

  withdrawalRowsResult.rows.forEach((row) => {
    const status = String(row.status || row.resolutionStatus || "").trim().toLowerCase();
    if (status !== "approved") return;
    const resolvedAtMs = getCashflowResolutionTimestampMs(row);
    if (resolvedAtMs < range.startMs || resolvedAtMs > range.endMs) return;
    const approvedHtg = getApprovedWithdrawalAmountHtg(row);
    if (approvedHtg <= 0) return;

    const bucket = bucketMap.get(String(resolvedAtMs - (resolvedAtMs % (range.granularity === "hour" ? (60 * 60 * 1000) : (24 * 60 * 60 * 1000)))));
    summary.approvedWithdrawalsHtg += approvedHtg;
    summary.approvedWithdrawalsCount += 1;
    if (bucket) bucket.approvedWithdrawalsHtg += approvedHtg;

    if (includeRecent) {
      recentWithdrawals.push({
        id: String(row.id || "").trim(),
        kind: "withdrawal",
        resolvedAtMs,
        amountHtg: approvedHtg,
        methodName: String(row.methodName || row.destinationType || row.methodId || "").trim(),
        customerName: String(row.customerName || "").trim(),
        customerEmail: String(row.customerEmail || "").trim(),
        destinationValue: String(row.destinationValue || "").trim(),
      });
    }
  });

  const collections = [
    { key: "domino_classic", label: "Domino classique", ref: db.collection(DOMINO_CLASSIC_MATCH_RESULTS_COLLECTION) },
    { key: "duel", label: "Domino duel", ref: db.collection(DUEL_ROOM_RESULTS_COLLECTION) },
    { key: "morpion", label: "Mopyon", ref: db.collection(MORPION_ROOM_RESULTS_COLLECTION) },
    { key: "dame", label: "Dame", ref: db.collection(DAME_ROOM_RESULTS_COLLECTION) },
    { key: "chess", label: "Echec", ref: db.collection(CHESS_ROOM_RESULTS_COLLECTION) },
    { key: "ludo", label: "Ludo", ref: db.collection(LUDO_MATCH_RESULTS_COLLECTION) },
  ];

  const gameSnaps = await Promise.all(collections.map(({ key, ref }) => {
    let query = ref.orderBy("endedAtMs", "asc");
    if (range.startMs > 0) query = query.where("endedAtMs", ">=", range.startMs);
    if (range.endMs > 0) query = query.where("endedAtMs", "<=", range.endMs);
    return safeAnalyticsQueryGet(query, ref, `${key}Cashflow`);
  }));

  gameSnaps.forEach((snap, index) => {
    const collectionMeta = collections[index];
    snap.docs.forEach((docSnap) => {
      const row = docSnap.data() || {};
      if (String(row.status || "").trim().toLowerCase() !== "ended") return;
      const endedAtMs = safeSignedInt(row.endedAtMs);
      if (endedAtMs < range.startMs || endedAtMs > range.endMs) return;
      const stakeHtg = Math.max(0, safeInt(row.stakeHtg || row.entryCostHtg || doesToHtg(row.stakeDoes || row.entryCostDoes)));
      if (stakeHtg <= 0) return;
      const rewardGranted = inferCashflowRewardGranted(collectionMeta.key, row);
      const payoutHtg = rewardGranted ? Math.max(0, safeInt(row.rewardAmountHtg || row.rewardExpectedHtg)) : 0;
      const humanCount = inferCashflowHumanCount(collectionMeta.key, row);
      const usersStakeHtg = Math.max(0, stakeHtg * humanCount);
      const usersNetHtg = payoutHtg - usersStakeHtg;
      const operatorGameEdgeHtg = usersStakeHtg - payoutHtg;
      const bucket = bucketMap.get(String(endedAtMs - (endedAtMs % (range.granularity === "hour" ? (60 * 60 * 1000) : (24 * 60 * 60 * 1000)))));

      summary.usersStakeHtg += usersStakeHtg;
      summary.usersPayoutHtg += payoutHtg;
      summary.usersNetHtg += usersNetHtg;
      summary.operatorGameEdgeHtg += operatorGameEdgeHtg;

      if (bucket) {
        bucket.usersStakeHtg += usersStakeHtg;
        bucket.usersPayoutHtg += payoutHtg;
        bucket.usersNetHtg += usersNetHtg;
        bucket.operatorGameEdgeHtg += operatorGameEdgeHtg;
      }

      if (includeRecent) {
        recentGames.push({
          id: String(docSnap.id || "").trim(),
          kind: "game",
          resolvedAtMs: endedAtMs,
          gameLabel: collectionMeta.label,
          stakeHtg,
          usersStakeHtg,
          payoutHtg,
          usersNetHtg,
          operatorGameEdgeHtg,
          roomMode: String(row.roomMode || row.gameMode || "").trim(),
        });
      }
    });
  });

  const buckets = bucketSeed.map((bucket) => {
    const netCashHtg = safeSignedInt(bucket.approvedDepositsHtg - bucket.approvedWithdrawalsHtg);
    const netBusinessHtg = safeSignedInt(netCashHtg + bucket.operatorGameEdgeHtg);
    return {
      startMs: safeSignedInt(bucket.startMs),
      key: String(bucket.key || ""),
      label: String(bucket.label || "-"),
      approvedDepositsHtg: safeInt(bucket.approvedDepositsHtg),
      directApprovedDepositsHtg: safeInt(bucket.directApprovedDepositsHtg),
      agentApprovedDepositsHtg: safeInt(bucket.agentApprovedDepositsHtg),
      approvedWithdrawalsHtg: safeInt(bucket.approvedWithdrawalsHtg),
      usersStakeHtg: safeInt(bucket.usersStakeHtg),
      usersPayoutHtg: safeInt(bucket.usersPayoutHtg),
      usersNetHtg: safeSignedInt(bucket.usersNetHtg),
      operatorGameEdgeHtg: safeSignedInt(bucket.operatorGameEdgeHtg),
      netCashHtg,
      netBusinessHtg,
    };
  });

  summary.netCashHtg = safeSignedInt(summary.approvedDepositsHtg - summary.approvedWithdrawalsHtg);
  summary.netBusinessHtg = safeSignedInt(summary.netCashHtg + summary.operatorGameEdgeHtg);

  if (includeRecent) {
    recentDeposits.sort((left, right) => safeSignedInt(right.resolvedAtMs) - safeSignedInt(left.resolvedAtMs));
    recentWithdrawals.sort((left, right) => safeSignedInt(right.resolvedAtMs) - safeSignedInt(left.resolvedAtMs));
    recentGames.sort((left, right) => safeSignedInt(right.resolvedAtMs) - safeSignedInt(left.resolvedAtMs));
  }

  return {
    ok: true,
    generatedAtMs: nowMs,
    timezone: PRESENCE_ANALYTICS_TIMEZONE,
    range: {
      startMs: range.startMs,
      endMs: range.endMs,
      granularity: range.granularity,
      isGlobal: range.isGlobal === true,
      windowKey: String(range.windowKey || ""),
    },
    snapshot: {
      definitions: {
        depositsRule: "Entrees HTG = depots approuves dans la periode, separes en depot direct et depot agent.",
        withdrawalsRule: "Sorties HTG = retraits approuves dans la periode.",
        gamesRule: "Net joueurs = payouts HTG aux utilisateurs moins total des mises HTG engagees par les humains.",
        businessRule: "Resultat exploitation = net cash (entrees - sorties) + marge jeux (mises humaines - payouts joueurs).",
      },
      summary,
      series: {
        approvedDepositsHtg: includeBuckets ? buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.approvedDepositsHtg })) : [],
        approvedWithdrawalsHtg: includeBuckets ? buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.approvedWithdrawalsHtg })) : [],
        operatorGameEdgeHtg: includeBuckets ? buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.operatorGameEdgeHtg })) : [],
        netBusinessHtg: includeBuckets ? buckets.map((item) => ({ startMs: item.startMs, label: item.label, value: item.netBusinessHtg })) : [],
      },
      buckets: includeBuckets ? buckets : [],
      recentApprovedDeposits: includeRecent ? recentDeposits.slice(0, rowLimit) : [],
      recentApprovedWithdrawals: includeRecent ? recentWithdrawals.slice(0, rowLimit) : [],
      recentGameEconomics: includeRecent ? recentGames.slice(0, rowLimit) : [],
    },
    scanned: {
      approvedDepositDocs: safeInt(depositRowsResult.rows.length),
      approvedWithdrawalDocs: safeInt(withdrawalRowsResult.rows.length),
      approvedDepositFallbackUsed: depositRowsResult.fallbackUsed === true,
      approvedWithdrawalFallbackUsed: withdrawalRowsResult.fallbackUsed === true,
    },
    truncated: depositRowsResult.truncated === true || withdrawalRowsResult.truncated === true,
  };
}

function normalizeDuelAnalyticsWindow(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "today" || normalized === "7d" || normalized === "30d" || normalized === "global"
    ? normalized
    : "30d";
}

function getDuelAnalyticsDayKey(ms = 0) {
  if (!ms) return "";
  const parts = getGamesAnalyticsLocalParts(ms);
  const year = String(parts.year || 0);
  const month = String(parts.month || 0).padStart(2, "0");
  const day = String(parts.day || 0).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDuelAnalyticsHourKey(ms = 0) {
  if (!ms) return "";
  const parts = getGamesAnalyticsLocalParts(ms);
  const hour = String(parts.hour || 0).padStart(2, "0");
  return `${getDuelAnalyticsDayKey(ms)} ${hour}:00`;
}

function getDuelAnalyticsBucketKey(granularity = "day", ms = 0) {
  return granularity === "hour" ? getDuelAnalyticsHourKey(ms) : getDuelAnalyticsDayKey(ms);
}

function getDuelAnalyticsBucketLabel(granularity = "day", ms = 0) {
  if (!ms) return "-";
  if (granularity === "hour") {
    return new Date(ms).toLocaleString("fr-FR", {
      timeZone: PRESENCE_ANALYTICS_TIMEZONE,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return new Date(ms).toLocaleDateString("fr-FR", {
    timeZone: PRESENCE_ANALYTICS_TIMEZONE,
    day: "2-digit",
    month: "short",
  });
}

function getDuelAnalyticsRange(options = {}, nowMs = Date.now()) {
  const customStartMs = safeSignedInt(options.startMs);
  const customEndMs = safeSignedInt(options.endMs);
  if (customStartMs > 0 && customEndMs > 0 && customEndMs >= customStartMs) {
    const rangeMs = Math.max(1, customEndMs - customStartMs);
    return {
      windowKey: "custom",
      startMs: customStartMs,
      endMs: customEndMs,
      granularity: rangeMs <= (2 * 24 * 60 * 60 * 1000) ? "hour" : "day",
      isGlobal: false,
    };
  }

  const windowKey = normalizeDuelAnalyticsWindow(options.window || "30d");
  const todayParts = getGamesAnalyticsShiftedDayParts(nowMs, 0);
  const todayStartMs = getGamesAnalyticsZonedTimestamp(todayParts, 0, 0, 0, 0);
  if (windowKey === "today") {
    return { windowKey, startMs: todayStartMs, endMs: nowMs, granularity: "hour", isGlobal: false, timezone: PRESENCE_ANALYTICS_TIMEZONE };
  }
  if (windowKey === "7d") {
    return {
      windowKey,
      startMs: getGamesAnalyticsZonedTimestamp(getGamesAnalyticsShiftedDayParts(nowMs, -6), 0, 0, 0, 0),
      endMs: nowMs,
      granularity: "day",
      isGlobal: false,
      timezone: PRESENCE_ANALYTICS_TIMEZONE,
    };
  }
  if (windowKey === "30d") {
    return {
      windowKey,
      startMs: getGamesAnalyticsZonedTimestamp(getGamesAnalyticsShiftedDayParts(nowMs, -29), 0, 0, 0, 0),
      endMs: nowMs,
      granularity: "day",
      isGlobal: false,
      timezone: PRESENCE_ANALYTICS_TIMEZONE,
    };
  }
  return { windowKey: "global", startMs: 0, endMs: nowMs, granularity: "day", isGlobal: true, timezone: PRESENCE_ANALYTICS_TIMEZONE };
}

function normalizeGlobalAnalyticsWindow(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "today" || normalized === "7d" || normalized === "30d" || normalized === "global"
    ? normalized
    : "today";
}

function getTimelineAnalyticsRange(options = {}, nowMs = Date.now()) {
  const customStartMs = safeSignedInt(options.startMs);
  const customEndMs = safeSignedInt(options.endMs);
  if (customStartMs > 0 && customEndMs > 0 && customEndMs >= customStartMs) {
    const rangeMs = Math.max(1, customEndMs - customStartMs);
    return {
      windowKey: "custom",
      startMs: customStartMs,
      endMs: customEndMs,
      granularity: rangeMs <= (2 * 24 * 60 * 60 * 1000) ? "hour" : "day",
      isGlobal: false,
    };
  }

  const windowKey = normalizeGlobalAnalyticsWindow(options.window || "today");
  const todayParts = getGamesAnalyticsShiftedDayParts(nowMs, 0);
  const todayStartMs = getGamesAnalyticsZonedTimestamp(todayParts, 0, 0, 0, 0);
  if (windowKey === "today") {
    return { windowKey, startMs: todayStartMs, endMs: nowMs, granularity: "hour", isGlobal: false, timezone: PRESENCE_ANALYTICS_TIMEZONE };
  }
  if (windowKey === "7d") {
    return {
      windowKey,
      startMs: getGamesAnalyticsZonedTimestamp(getGamesAnalyticsShiftedDayParts(nowMs, -6), 0, 0, 0, 0),
      endMs: nowMs,
      granularity: "day",
      isGlobal: false,
      timezone: PRESENCE_ANALYTICS_TIMEZONE,
    };
  }
  if (windowKey === "30d") {
    return {
      windowKey,
      startMs: getGamesAnalyticsZonedTimestamp(getGamesAnalyticsShiftedDayParts(nowMs, -29), 0, 0, 0, 0),
      endMs: nowMs,
      granularity: "day",
      isGlobal: false,
      timezone: PRESENCE_ANALYTICS_TIMEZONE,
    };
  }
  return { windowKey: "global", startMs: 0, endMs: nowMs, granularity: "day", isGlobal: true, timezone: PRESENCE_ANALYTICS_TIMEZONE };
}

function formatTimelineBucketLabel(granularity = "day", ms = 0) {
  if (!ms) return "-";
  if (granularity === "hour") {
    return new Date(ms).toLocaleString("fr-FR", {
      timeZone: PRESENCE_ANALYTICS_TIMEZONE,
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return new Date(ms).toLocaleDateString("fr-FR", {
    timeZone: PRESENCE_ANALYTICS_TIMEZONE,
    day: "2-digit",
    month: "short",
  });
}

async function safeAnalyticsQueryGet(primaryQuery, fallbackQuery = null, label = "") {
  try {
    return await primaryQuery.get();
  } catch (error) {
    const code = safeSignedInt(error?.code);
    if ((code === 9 || String(error?.message || "").includes("FAILED_PRECONDITION")) && fallbackQuery) {
      console.warn("[DASHBOARD_ANALYTICS] range query fallback", {
        label,
        code,
        message: String(error?.message || ""),
      });
      return fallbackQuery.get();
    }
    throw error;
  }
}

function inferClassicGameComposition(result = {}) {
  const botCount = safeInt(result.botCount);
  return botCount > 0 ? "with_bot" : "human_only";
}

function inferPongResultBotCount(result = {}) {
  const explicit = safeInt(result.botCount);
  if (explicit > 0) return explicit;
  const aiProfile = String(result.aiProfile || "").trim().toLowerCase();
  if (aiProfile) return 1;
  const winnerRaw = String(result.winner || result.winnerType || "").trim().toLowerCase();
  if (winnerRaw === "ai" || winnerRaw === "bot" || winnerRaw === "human" || winnerRaw === "user") {
    return 1;
  }
  return 0;
}

async function computeGamesVolumeAnalyticsSnapshot(options = {}) {
  const nowMs = safeSignedInt(options.nowMs) || Date.now();
  const range = getTimelineAnalyticsRange(options, nowMs);

  let classicQuery = db.collection(DOMINO_CLASSIC_MATCH_RESULTS_COLLECTION).orderBy("endedAtMs", "asc");
  let duelQuery = db.collection(DUEL_ROOM_RESULTS_COLLECTION).orderBy("endedAtMs", "asc");
  let morpionQuery = db.collection(MORPION_ROOM_RESULTS_COLLECTION).orderBy("endedAtMs", "asc");
  let dameQuery = db.collection(DAME_ROOM_RESULTS_COLLECTION).orderBy("endedAtMs", "asc");
  let chessQuery = db.collection(CHESS_ROOM_RESULTS_COLLECTION).orderBy("endedAtMs", "asc");
  let ludoQuery = db.collection(LUDO_MATCH_RESULTS_COLLECTION).orderBy("endedAtMs", "asc");

  if (range.startMs > 0) {
    classicQuery = classicQuery.where("endedAtMs", ">=", range.startMs);
    duelQuery = duelQuery.where("endedAtMs", ">=", range.startMs);
    morpionQuery = morpionQuery.where("endedAtMs", ">=", range.startMs);
    dameQuery = dameQuery.where("endedAtMs", ">=", range.startMs);
    chessQuery = chessQuery.where("endedAtMs", ">=", range.startMs);
    ludoQuery = ludoQuery.where("endedAtMs", ">=", range.startMs);
  }
  if (range.endMs > 0) {
    classicQuery = classicQuery.where("endedAtMs", "<=", range.endMs);
    duelQuery = duelQuery.where("endedAtMs", "<=", range.endMs);
    morpionQuery = morpionQuery.where("endedAtMs", "<=", range.endMs);
    dameQuery = dameQuery.where("endedAtMs", "<=", range.endMs);
    chessQuery = chessQuery.where("endedAtMs", "<=", range.endMs);
    ludoQuery = ludoQuery.where("endedAtMs", "<=", range.endMs);
  }

  const [classicSnap, duelSnap, morpionSnap, dameSnap, chessSnap, ludoSnap] = await Promise.all([
    safeAnalyticsQueryGet(classicQuery, db.collection(DOMINO_CLASSIC_MATCH_RESULTS_COLLECTION), "dominoClassicMatchResults"),
    safeAnalyticsQueryGet(duelQuery, db.collection(DUEL_ROOM_RESULTS_COLLECTION), "duelRoomResults"),
    safeAnalyticsQueryGet(morpionQuery, db.collection(MORPION_ROOM_RESULTS_COLLECTION), "morpionRoomResults"),
    safeAnalyticsQueryGet(dameQuery, db.collection(DAME_ROOM_RESULTS_COLLECTION), "dameRoomResults"),
    safeAnalyticsQueryGet(chessQuery, db.collection(CHESS_ROOM_RESULTS_COLLECTION), "chessRoomResults"),
    safeAnalyticsQueryGet(ludoQuery, db.collection(LUDO_MATCH_RESULTS_COLLECTION), "ludoMatchResults"),
  ]);

  const trendMap = new Map();
  const recentMatches = [];

  const summary = {
    totalMatches: 0,
    classicMatches: 0,
    duelMatches: 0,
    morpionMatches: 0,
    dameMatches: 0,
    chessMatches: 0,
    ludoMatches: 0,
    classicWithBots: 0,
    duelWithBots: 0,
    morpionWithBots: 0,
    dameWithBots: 0,
    chessWithBots: 0,
    ludoWithBots: 0,
  };

  const addMatch = (gameKey, label, data = {}, docId = "") => {
    const status = String(data.status || "").trim().toLowerCase();
    const endedAtMs = safeSignedInt(data.endedAtMs);
    if (status !== "ended" || endedAtMs <= 0) return;
    if (range.startMs > 0 && endedAtMs < range.startMs) return;
    if (range.endMs > 0 && endedAtMs > range.endMs) return;

    summary.totalMatches += 1;
    if (gameKey === "classic") summary.classicMatches += 1;
    if (gameKey === "duel") summary.duelMatches += 1;
    if (gameKey === "morpion") summary.morpionMatches += 1;
    if (gameKey === "dame") summary.dameMatches += 1;
    if (gameKey === "chess") summary.chessMatches += 1;
    if (gameKey === "ludo") summary.ludoMatches += 1;

    const botCount = safeInt(data.botCount) || (String(data.roomMode || data.gameMode || "").toLowerCase().includes("bot") ? 1 : 0);
    if (gameKey === "classic" && inferClassicGameComposition(data) === "with_bot") summary.classicWithBots += 1;
    if (gameKey === "duel" && botCount > 0) summary.duelWithBots += 1;
    if (gameKey === "morpion" && botCount > 0) summary.morpionWithBots += 1;
    if (gameKey === "dame" && botCount > 0) summary.dameWithBots += 1;
    if (gameKey === "chess" && botCount > 0) summary.chessWithBots += 1;
    if (gameKey === "ludo" && botCount > 0) summary.ludoWithBots += 1;

    const bucketKey = getDuelAnalyticsBucketKey(range.granularity, endedAtMs);
    const bucket = trendMap.get(bucketKey) || {
      key: bucketKey,
      label: getDuelAnalyticsBucketLabel(range.granularity, endedAtMs),
      periodMs: endedAtMs,
      totalMatches: 0,
      classicMatches: 0,
      duelMatches: 0,
      morpionMatches: 0,
      dameMatches: 0,
      chessMatches: 0,
      ludoMatches: 0,
    };
    bucket.totalMatches += 1;
    if (gameKey === "classic") bucket.classicMatches += 1;
    if (gameKey === "duel") bucket.duelMatches += 1;
    if (gameKey === "morpion") bucket.morpionMatches += 1;
    if (gameKey === "dame") bucket.dameMatches += 1;
    if (gameKey === "chess") bucket.chessMatches += 1;
    if (gameKey === "ludo") bucket.ludoMatches += 1;
    if (endedAtMs > safeSignedInt(bucket.periodMs)) {
      bucket.periodMs = endedAtMs;
      bucket.label = getDuelAnalyticsBucketLabel(range.granularity, endedAtMs);
    }
    trendMap.set(bucketKey, bucket);

    recentMatches.push({
      id: String(docId || ""),
      gameKey,
      gameLabel: label,
      endedAtMs,
      stakeHtg: safeInt(data.stakeHtg),
      roomMode: String(data.roomMode || "").trim(),
      botCount,
    });
  };

  classicSnap.forEach((docSnap) => addMatch("classic", "Domino classique", docSnap.data() || {}, docSnap.id));
  duelSnap.forEach((docSnap) => addMatch("duel", "Duel 2 joueurs", docSnap.data() || {}, docSnap.id));
  morpionSnap.forEach((docSnap) => addMatch("morpion", "Morpion 5", docSnap.data() || {}, docSnap.id));
  dameSnap.forEach((docSnap) => addMatch("dame", "Jeu de dame", docSnap.data() || {}, docSnap.id));
  chessSnap.forEach((docSnap) => addMatch("chess", "Echec", docSnap.data() || {}, docSnap.id));
  ludoSnap.forEach((docSnap) => addMatch("ludo", "Ludo", {
    botCount: 1,
    ...docSnap.data(),
  }, docSnap.id));

  recentMatches.sort((left, right) => safeSignedInt(right.endedAtMs) - safeSignedInt(left.endedAtMs));

  const trend = Array.from(trendMap.values())
    .sort((left, right) => safeSignedInt(left.periodMs) - safeSignedInt(right.periodMs))
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      periodMs: safeSignedInt(bucket.periodMs),
      totalMatches: safeInt(bucket.totalMatches),
      classicMatches: safeInt(bucket.classicMatches),
      duelMatches: safeInt(bucket.duelMatches),
      morpionMatches: safeInt(bucket.morpionMatches),
      dameMatches: safeInt(bucket.dameMatches),
      chessMatches: safeInt(bucket.chessMatches),
      ludoMatches: safeInt(bucket.ludoMatches),
    }));

  const peakBucket = trend
    .slice()
    .sort((left, right) => safeInt(right.totalMatches) - safeInt(left.totalMatches) || safeSignedInt(right.periodMs) - safeSignedInt(left.periodMs))
    .at(0) || null;

  return {
    ok: true,
    generatedAtMs: nowMs,
    range,
    snapshot: {
      summary: {
        ...summary,
        avgMatchesPerBucket: trend.length > 0 ? Math.round(summary.totalMatches / trend.length) : summary.totalMatches,
        peakBucketMatches: safeInt(peakBucket?.totalMatches),
        peakBucketLabel: String(peakBucket?.label || ""),
      },
      mix: [
        { key: "classic", label: "Domino classique", count: summary.classicMatches },
        { key: "duel", label: "Duel 2 joueurs", count: summary.duelMatches },
        { key: "morpion", label: "Morpion 5", count: summary.morpionMatches },
        { key: "dame", label: "Jeu de dame", count: summary.dameMatches },
        { key: "chess", label: "Echec", count: summary.chessMatches },
        { key: "ludo", label: "Ludo", count: summary.ludoMatches },
      ],
      trend,
      recentMatches: recentMatches.slice(0, 12),
    },
  };
}

function normalizeMorpionAnalyticsComposition(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "human_only" || normalized === "human-vs-human") return "human_only";
  if (normalized === "with_bot" || normalized === "human-vs-bot" || normalized === "bot") return "with_bot";
  return "all";
}

function normalizeAnalyticsWinnerFilter(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "human" || normalized === "bot") return normalized;
  return "all";
}

function getMorpionCompositionMeta(humanCount = 0, botCount = 0) {
  const safeHumanCount = safeInt(humanCount);
  const safeBotCount = safeInt(botCount);
  if (safeHumanCount >= 2 && safeBotCount <= 0) {
    return { key: "human_only", label: "2 humains" };
  }
  if (safeHumanCount >= 1 && safeBotCount >= 1) {
    return { key: "with_bot", label: "1 humain + 1 bot" };
  }
  return { key: "other", label: "Autre" };
}

async function computeMorpionAnalyticsSnapshot(options = {}) {
  const nowMs = safeSignedInt(options.nowMs) || Date.now();
  const range = getDuelAnalyticsRange(options, nowMs);
  const compositionFilter = normalizeMorpionAnalyticsComposition(options.composition);
  const winnerFilter = normalizeAnalyticsWinnerFilter(options.winnerType);
  const stakeDoes = safeInt(options.stakeDoes) || (safeInt(options.stakeHtg) > 0 ? safeInt(options.stakeHtg) * RATE_HTG_TO_DOES : 0);

  let query = db.collection(MORPION_ROOM_RESULTS_COLLECTION).orderBy("endedAtMs", "asc");
  if (range.startMs > 0) {
    query = query.where("endedAtMs", ">=", range.startMs);
  }
  if (range.endMs > 0) {
    query = query.where("endedAtMs", "<=", range.endMs);
  }

  const querySnap = await query.get();
  let matchesPlayed = 0;
  let matchesWithBot = 0;
  let matchesHumanOnly = 0;
  let botWins = 0;
  let humanWins = 0;
  let botMatchBotWins = 0;
  let botMatchHumanWins = 0;
  let totalDurationMs = 0;
  let durationSamples = 0;
  let totalStakeDoes = 0;
  const trendMap = new Map();
  const stakeMixMap = new Map();
  const compositionMixMap = new Map([
    ["human_only", { key: "human_only", label: "2 humains", count: 0 }],
    ["with_bot", { key: "with_bot", label: "1 humain + 1 bot", count: 0 }],
  ]);
  const recentResults = [];

  querySnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const status = String(data.status || "").trim().toLowerCase();
    const endedAtMs = safeSignedInt(data.endedAtMs);
    if (status !== "ended") return;
    if (range.startMs > 0 && endedAtMs < range.startMs) return;
    if (range.endMs > 0 && endedAtMs > range.endMs) return;

    const humanCount = safeInt(data.humanCount);
    const botCount = safeInt(data.botCount);
    const composition = getMorpionCompositionMeta(humanCount, botCount);
    if (compositionFilter !== "all" && composition.key !== compositionFilter) return;

    const winnerType = String(data.winnerType || "").trim().toLowerCase();
    if (winnerFilter !== "all" && winnerType !== winnerFilter) return;

    const rowStakeDoes = safeInt(data.entryCostDoes || data.stakeDoes);
    if (stakeDoes > 0 && rowStakeDoes !== stakeDoes) return;

    matchesPlayed += 1;
    totalStakeDoes += rowStakeDoes;

    if (composition.key === "with_bot") matchesWithBot += 1;
    if (composition.key === "human_only") matchesHumanOnly += 1;
    if (winnerType === "bot") {
      botWins += 1;
      if (composition.key === "with_bot") botMatchBotWins += 1;
    }
    if (winnerType === "human") {
      humanWins += 1;
      if (composition.key === "with_bot") botMatchHumanWins += 1;
    }

    const compositionEntry = compositionMixMap.get(composition.key);
    if (compositionEntry) compositionEntry.count += 1;

    const stakeEntry = stakeMixMap.get(String(rowStakeDoes)) || {
      stakeDoes: rowStakeDoes,
      stakeHtg: Math.round(rowStakeDoes / RATE_HTG_TO_DOES),
      label: `${rowStakeDoes} Does`,
      labelHtg: `${Math.round(rowStakeDoes / RATE_HTG_TO_DOES)} HTG`,
      count: 0,
    };
    stakeEntry.count += 1;
    stakeMixMap.set(String(rowStakeDoes), stakeEntry);

    const startedAtMs = safeSignedInt(data.startedAtMs);
    const durationMs = startedAtMs > 0 && endedAtMs >= startedAtMs
      ? Math.max(0, endedAtMs - startedAtMs)
      : 0;
    if (durationMs > 0) {
      totalDurationMs += durationMs;
      durationSamples += 1;
    }

    const bucketKey = getDuelAnalyticsBucketKey(range.granularity, endedAtMs);
    const bucket = trendMap.get(bucketKey) || {
      key: bucketKey,
      label: getDuelAnalyticsBucketLabel(range.granularity, endedAtMs),
      periodMs: endedAtMs,
      matchesPlayed: 0,
      matchesWithBot: 0,
      matchesHumanOnly: 0,
      botWins: 0,
      humanWins: 0,
      botMatchBotWins: 0,
      botMatchHumanWins: 0,
      totalStakeDoes: 0,
      totalDurationMs: 0,
      durationSamples: 0,
    };
    bucket.matchesPlayed += 1;
    if (composition.key === "with_bot") bucket.matchesWithBot += 1;
    if (composition.key === "human_only") bucket.matchesHumanOnly += 1;
    if (winnerType === "bot") {
      bucket.botWins += 1;
      if (composition.key === "with_bot") bucket.botMatchBotWins += 1;
    }
    if (winnerType === "human") {
      bucket.humanWins += 1;
      if (composition.key === "with_bot") bucket.botMatchHumanWins += 1;
    }
    bucket.totalStakeDoes += rowStakeDoes;
    if (durationMs > 0) {
      bucket.totalDurationMs += durationMs;
      bucket.durationSamples += 1;
    }
    if (endedAtMs > safeSignedInt(bucket.periodMs)) {
      bucket.periodMs = endedAtMs;
      bucket.label = getDuelAnalyticsBucketLabel(range.granularity, endedAtMs);
    }
    trendMap.set(bucketKey, bucket);

    recentResults.push({
      roomId: docSnap.id,
      endedAtMs,
      startedAtMs,
      durationMs,
      stakeDoes: rowStakeDoes,
      stakeHtg: Math.round(rowStakeDoes / RATE_HTG_TO_DOES),
      humanCount,
      botCount,
      compositionKey: composition.key,
      compositionLabel: composition.label,
      winnerType,
      winnerSeat: safeSignedInt(data.winnerSeat),
      endedReason: String(data.endedReason || "").trim(),
      botDifficulty: String(data.botDifficulty || "").trim().toLowerCase() || "userpro",
    });
  });

  recentResults.sort((left, right) => safeSignedInt(right.endedAtMs) - safeSignedInt(left.endedAtMs));

  const trend = Array.from(trendMap.values())
    .sort((left, right) => safeSignedInt(left.periodMs) - safeSignedInt(right.periodMs))
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      periodMs: safeSignedInt(bucket.periodMs),
      matchesPlayed: safeInt(bucket.matchesPlayed),
      matchesWithBot: safeInt(bucket.matchesWithBot),
      matchesHumanOnly: safeInt(bucket.matchesHumanOnly),
      botWins: safeInt(bucket.botWins),
      humanWins: safeInt(bucket.humanWins),
      botMatchBotWins: safeInt(bucket.botMatchBotWins),
      botMatchHumanWins: safeInt(bucket.botMatchHumanWins),
      avgStakeDoes: safeInt(bucket.matchesPlayed) > 0 ? Math.round(bucket.totalStakeDoes / bucket.matchesPlayed) : 0,
      avgStakeHtg: safeInt(bucket.matchesPlayed) > 0 ? Math.round(bucket.totalStakeDoes / bucket.matchesPlayed / RATE_HTG_TO_DOES) : 0,
      avgDurationMs: safeInt(bucket.durationSamples) > 0 ? Math.round(bucket.totalDurationMs / bucket.durationSamples) : 0,
    }));

  const stakeMix = Array.from(stakeMixMap.values())
    .sort((left, right) => safeInt(left.stakeDoes) - safeInt(right.stakeDoes))
    .map((item) => ({
      stakeDoes: safeInt(item.stakeDoes),
      stakeHtg: safeInt(item.stakeHtg),
      label: String(item.label || `${safeInt(item.stakeDoes)} Does`),
      labelHtg: String(item.labelHtg || `${safeInt(item.stakeHtg)} HTG`),
      count: safeInt(item.count),
    }));

  const compositionMix = Array.from(compositionMixMap.values())
    .filter((item) => safeInt(item.count) > 0 || item.key === "human_only" || item.key === "with_bot")
    .map((item) => ({ key: String(item.key || ""), label: String(item.label || ""), count: safeInt(item.count) }));

  return {
    ok: true,
    generatedAtMs: nowMs,
    filters: {
      composition: compositionFilter,
      winnerType: winnerFilter,
      stakeDoes,
      stakeHtg: stakeDoes > 0 ? Math.round(stakeDoes / RATE_HTG_TO_DOES) : 0,
    },
    range: {
      window: range.windowKey,
      startMs: range.startMs,
      endMs: range.endMs,
      granularity: range.granularity,
      isGlobal: range.isGlobal,
    },
    summary: {
      matchesPlayed,
      matchesWithBot,
      matchesHumanOnly,
      botWins,
      humanWins,
      botMatchBotWins,
      botMatchHumanWins,
      avgDurationMs: durationSamples > 0 ? Math.round(totalDurationMs / durationSamples) : 0,
      avgStakeDoes: matchesPlayed > 0 ? Math.round(totalStakeDoes / matchesPlayed) : 0,
      avgStakeHtg: matchesPlayed > 0 ? Math.round(totalStakeDoes / matchesPlayed / RATE_HTG_TO_DOES) : 0,
      withBotRatePct: matchesPlayed > 0 ? matchesWithBot / matchesPlayed : 0,
      humanOnlyRatePct: matchesPlayed > 0 ? matchesHumanOnly / matchesPlayed : 0,
      botWinRatePct: matchesPlayed > 0 ? botWins / matchesPlayed : 0,
      humanWinRatePct: matchesPlayed > 0 ? humanWins / matchesPlayed : 0,
      botMatchBotWinRatePct: matchesWithBot > 0 ? botMatchBotWins / matchesWithBot : 0,
      botMatchHumanWinRatePct: matchesWithBot > 0 ? botMatchHumanWins / matchesWithBot : 0,
    },
    compositionMix,
    stakeMix,
    trend,
    recentResults: recentResults.slice(0, 12),
  };
}

function weekdayOrderIndex(weekdayKey = "") {
  const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const idx = order.indexOf(String(weekdayKey || "").toLowerCase());
  return idx >= 0 ? idx : order.length;
}

function weekdayLabel(weekdayKey = "") {
  const labels = {
    mon: "Lun",
    tue: "Mar",
    wed: "Mer",
    thu: "Jeu",
    fri: "Ven",
    sat: "Sam",
    sun: "Dim",
  };
  const safeKey = String(weekdayKey || "").toLowerCase();
  return labels[safeKey] || safeKey || "-";
}

function siteVisitHourSeriesFromDocs(docs = []) {
  const buckets = new Map();
  (Array.isArray(docs) ? docs : []).forEach((item) => {
    const hourKey = String(item.hourKey || "").padStart(2, "0");
    const current = buckets.get(hourKey) || { hourKey, label: `${hourKey}h`, visitCount: 0 };
    current.visitCount += safeInt(item.visitCount);
    buckets.set(hourKey, current);
  });
  return Array.from({ length: 24 }, (_, hour) => {
    const hourKey = String(hour).padStart(2, "0");
    return buckets.get(hourKey) || { hourKey, label: `${hourKey}h`, visitCount: 0 };
  });
}

function siteVisitWeekdaySeriesFromDocs(docs = []) {
  const buckets = new Map();
  (Array.isArray(docs) ? docs : []).forEach((item) => {
    const weekdayKey = String(item.weekdayKey || "").toLowerCase();
    const current = buckets.get(weekdayKey) || { weekdayKey, label: weekdayLabel(weekdayKey), visitCount: 0 };
    current.visitCount += safeInt(item.visitCount);
    buckets.set(weekdayKey, current);
  });

  return Array.from(buckets.values())
    .sort((left, right) => weekdayOrderIndex(left.weekdayKey) - weekdayOrderIndex(right.weekdayKey));
}

function buildSiteVisitTrend(range = {}, dailyDocs = [], hourlyDocs = []) {
  if (range.granularity === "hour") {
    return (Array.isArray(hourlyDocs) ? hourlyDocs : [])
      .slice()
      .sort((left, right) => safeSignedInt(left.bucketStartMs) - safeSignedInt(right.bucketStartMs))
      .map((item) => ({
        key: String(item.bucketKey || ""),
        label: formatTimelineBucketLabel("hour", safeSignedInt(item.bucketStartMs)),
        bucketMs: safeSignedInt(item.bucketStartMs),
        visitCount: safeInt(item.visitCount),
      }));
  }

  return (Array.isArray(dailyDocs) ? dailyDocs : [])
    .slice()
    .sort((left, right) => safeSignedInt(left.dayStartMs) - safeSignedInt(right.dayStartMs))
    .map((item) => ({
      key: String(item.dayKey || ""),
      label: formatTimelineBucketLabel("day", safeSignedInt(item.dayStartMs)),
      bucketMs: safeSignedInt(item.dayStartMs),
      visitCount: safeInt(item.visitCount),
    }));
}

async function computeSiteVisitsAnalyticsSnapshot(options = {}) {
  const nowMs = safeSignedInt(options.nowMs) || Date.now();
  const range = getTimelineAnalyticsRange(options, nowMs);
  const todayLocalKeys = getSiteVisitLocalKeys(nowMs);
  const [metaSnap, todaySnap] = await Promise.all([
    analyticsMetaRef(SITE_VISITS_META_DOC).get(),
    siteVisitsDailyCollection().doc(todayLocalKeys.dayKey).get(),
  ]);

  const meta = metaSnap.exists ? (metaSnap.data() || {}) : {};
  const allTimeVisits = safeInt(meta.totalVisitCount);
  const todayVisits = todaySnap.exists ? safeInt(todaySnap.data()?.visitCount) : 0;

  let dailyDocs = [];
  let hourlyDocs = [];
  let hourOfDay = [];
  let weekday = [];

  if (range.isGlobal) {
    const [dailySnap, hourSnap, weekdaySnap] = await Promise.all([
      siteVisitsDailyCollection().orderBy("dayStartMs", "asc").get(),
      siteVisitsHourCollection().orderBy("hourKey", "asc").get(),
      siteVisitsWeekdayCollection().orderBy("weekdayKey", "asc").get(),
    ]);
    dailyDocs = dailySnap.docs.map(snapshotRecord);
    hourOfDay = siteVisitHourSeriesFromDocs(hourSnap.docs.map(snapshotRecord));
    weekday = siteVisitWeekdaySeriesFromDocs(weekdaySnap.docs.map(snapshotRecord));
  } else {
    const startDayMs = getDayBucketStartMs(range.startMs);
    const endDayMs = getDayBucketStartMs(range.endMs);
    const startHourMs = getHourBucketStartMs(range.startMs);
    const endHourMs = getHourBucketStartMs(range.endMs);
    const [dailySnap, hourlySnap] = await Promise.all([
      siteVisitsDailyCollection()
        .where("dayStartMs", ">=", startDayMs)
        .where("dayStartMs", "<=", endDayMs)
        .orderBy("dayStartMs", "asc")
        .get(),
      siteVisitsHourlyCollection()
        .where("bucketStartMs", ">=", startHourMs)
        .where("bucketStartMs", "<=", endHourMs)
        .orderBy("bucketStartMs", "asc")
        .get(),
    ]);
    dailyDocs = dailySnap.docs.map(snapshotRecord);
    hourlyDocs = hourlySnap.docs.map(snapshotRecord);
    hourOfDay = siteVisitHourSeriesFromDocs(hourlyDocs);
    weekday = siteVisitWeekdaySeriesFromDocs(hourlyDocs);
  }

  const trend = buildSiteVisitTrend(range, dailyDocs, hourlyDocs);
  const rangeVisits = range.isGlobal
    ? allTimeVisits
    : (range.granularity === "hour"
      ? hourlyDocs.reduce((sum, item) => sum + safeInt(item.visitCount), 0)
      : dailyDocs.reduce((sum, item) => sum + safeInt(item.visitCount), 0));
  const peakBucket = trend
    .slice()
    .sort((left, right) => safeInt(right.visitCount) - safeInt(left.visitCount) || safeSignedInt(right.bucketMs) - safeSignedInt(left.bucketMs))
    .at(0) || null;

  return {
    ok: true,
    generatedAtMs: nowMs,
    range,
    snapshot: {
      summary: {
        allTimeVisits,
        rangeVisits,
        todayVisits,
        activeBuckets: Math.max(1, trend.length),
        avgPerBucket: trend.length > 0 ? Math.round(rangeVisits / trend.length) : rangeVisits,
        peakBucketVisits: safeInt(peakBucket?.visitCount),
        peakBucketLabel: String(peakBucket?.label || ""),
      },
      trend,
      hourOfDay,
      weekday,
    },
  };
}

async function collectPresenceAnalyticsNow(nowMs = Date.now()) {
  const safeNow = safeSignedInt(nowMs) || Date.now();
  const clientCutoffMs = safeNow - PRESENCE_ANALYTICS_CLIENT_WINDOW_MS;
  const roomCutoffMs = safeNow - PRESENCE_ANALYTICS_ROOM_WINDOW_MS;

  const [clientsSnap, roomsSnap] = await Promise.all([
    db.collection(CLIENTS_COLLECTION)
      .where("lastSeenAtMs", ">=", clientCutoffMs)
      .limit(5000)
      .get(),
    db.collection(ROOMS_COLLECTION)
      .where("status", "in", ["waiting", "playing"])
      .limit(200)
      .get(),
  ]);

  const onlineUsers = new Set();
  const inGameUsers = new Set();
  let playingRooms = 0;
  let waitingRooms = 0;
  let activeRooms = 0;

  clientsSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const uid = String(data.uid || docSnap.id || "").trim();
    const lastSeenMs = safeSignedInt(data.lastSeenAtMs);
    if (!uid || lastSeenMs < clientCutoffMs) return;
    onlineUsers.add(uid);
  });

  roomsSnap.docs.forEach((docSnap) => {
    const room = docSnap.data() || {};
    const status = String(room.status || "");
    if (status === "playing") playingRooms += 1;
    if (status === "waiting") waitingRooms += 1;

    const roomPresence = room.roomPresenceMs && typeof room.roomPresenceMs === "object"
      ? room.roomPresenceMs
      : {};
    let roomHasPresence = false;

    Object.keys(roomPresence).forEach((uidRaw) => {
      const uid = String(uidRaw || "").trim();
      const lastSeenMs = safeSignedInt(roomPresence[uidRaw]);
      if (!uid || lastSeenMs < roomCutoffMs) return;
      roomHasPresence = true;
      inGameUsers.add(uid);
      onlineUsers.add(uid);
    });

    if (roomHasPresence) activeRooms += 1;
  });

  return {
    sampledAtMs: safeNow,
    onlineUsers: onlineUsers.size,
    onlineInGameUsers: inGameUsers.size,
    activeRooms,
    playingRooms,
    waitingRooms,
  };
}

async function computePresenceAnalyticsSnapshot(options = {}) {
  const nowMs = safeSignedInt(options.nowMs) || Date.now();
  const range = getTimelineAnalyticsRange(options, nowMs);
  const live = await collectPresenceAnalyticsNow(nowMs);
  const defaultSnapshotsStartMs = nowMs - (PRESENCE_ANALYTICS_RECENT_SNAPSHOT_DAYS * 24 * 60 * 60 * 1000);
  const snapshotsStartMs = range.startMs > 0
    ? Math.max(range.startMs, defaultSnapshotsStartMs)
    : defaultSnapshotsStartMs;
  const startDayKey = range.startMs > 0 ? getPresenceLocalKeys(range.startMs).dayKey : "";
  const endDayKey = getPresenceLocalKeys(range.endMs || nowMs).dayKey;

  let dailyQuery = presenceDailyCollection().orderBy("dayKey", "desc");
  if (startDayKey) {
    dailyQuery = dailyQuery.where("dayKey", ">=", startDayKey);
  }
  if (endDayKey) {
    dailyQuery = dailyQuery.where("dayKey", "<=", endDayKey);
  }

  const [
    snapshotsSnap,
    dailySnap,
    hourSnap,
    weekdaySnap,
  ] = await Promise.all([
    presenceSnapshotsCollection()
      .where("bucketMs", ">=", snapshotsStartMs)
      .where("bucketMs", "<=", range.endMs || nowMs)
      .orderBy("bucketMs", "asc")
      .get(),
    dailyQuery.limit(PRESENCE_ANALYTICS_RECENT_DAYS_LIMIT).get(),
    presenceHourCollection().orderBy("hourKey", "asc").get(),
    presenceWeekdayCollection().orderBy("weekdayKey", "asc").get(),
  ]);

  const snapshots = snapshotsSnap.docs.map(snapshotRecord);
  const daily = dailySnap.docs.map(snapshotRecord).reverse();
  const hourOfDay = hourSnap.docs.map(snapshotRecord);
  const weekday = weekdaySnap.docs.map(snapshotRecord);

  const trend = daily.map((item) => {
    const samples = Math.max(1, safeInt(item.samples));
    return {
      label: String(item.dayKey || ""),
      peakVisitors: safeInt(item.onlineUsersMax),
      avgVisitors: Math.round(safeInt(item.onlineUsersSum) / samples),
      peakPlayers: safeInt(item.onlineInGameUsersMax),
      avgPlayers: Math.round(safeInt(item.onlineInGameUsersSum) / samples),
      peakRooms: safeInt(item.playingRoomsMax),
      samples,
    };
  });

  const snapshotTrend = snapshots.map((item) => ({
    bucketMs: safeSignedInt(item.bucketMs),
    label: String(item.dayKey || ""),
    onlineUsers: safeInt(item.onlineUsers),
    onlineInGameUsers: safeInt(item.onlineInGameUsers),
    playingRooms: safeInt(item.playingRooms),
    waitingRooms: safeInt(item.waitingRooms),
  }));

  const peakMoments = snapshots
    .map((item) => ({
      bucketMs: safeSignedInt(item.bucketMs),
      onlineUsers: safeInt(item.onlineUsers),
      onlineInGameUsers: safeInt(item.onlineInGameUsers),
      playingRooms: safeInt(item.playingRooms),
    }))
    .sort((a, b) => b.onlineUsers - a.onlineUsers || b.onlineInGameUsers - a.onlineInGameUsers || a.bucketMs - b.bucketMs)
    .slice(0, 8);

  const activeDays = Math.max(1, trend.length);
  const avgDailyPeakVisitors = trend.length > 0
    ? Math.round(trend.reduce((sum, item) => sum + safeInt(item.peakVisitors), 0) / activeDays)
    : safeInt(live.onlineUsers);
  const avgDailyPeakPlayers = trend.length > 0
    ? Math.round(trend.reduce((sum, item) => sum + safeInt(item.peakPlayers), 0) / activeDays)
    : safeInt(live.onlineInGameUsers);
  const peakVisitors = Math.max(
    safeInt(live.onlineUsers),
    ...trend.map((item) => safeInt(item.peakVisitors)),
    ...snapshotTrend.map((item) => safeInt(item.onlineUsers))
  );
  const peakPlayers = Math.max(
    safeInt(live.onlineInGameUsers),
    ...trend.map((item) => safeInt(item.peakPlayers)),
    ...snapshotTrend.map((item) => safeInt(item.onlineInGameUsers))
  );
  const peakPlayingRooms = Math.max(
    safeInt(live.playingRooms),
    ...trend.map((item) => safeInt(item.peakRooms)),
    ...snapshotTrend.map((item) => safeInt(item.playingRooms))
  );

  const peakDay = trend
    .slice()
    .sort((a, b) => b.peakVisitors - a.peakVisitors || b.peakPlayers - a.peakPlayers)
    .at(0) || null;

  return {
    ok: true,
    generatedAtMs: nowMs,
    range,
    snapshot: {
      live,
      summary: {
        activeDays,
        currentOnlineUsers: safeInt(live.onlineUsers),
        currentInGameUsers: safeInt(live.onlineInGameUsers),
        currentPlayingRooms: safeInt(live.playingRooms),
        currentWaitingRooms: safeInt(live.waitingRooms),
        currentActiveRooms: safeInt(live.activeRooms),
        peakVisitors,
        peakPlayers,
        peakPlayingRooms,
        avgDailyPeakVisitors,
        avgDailyPeakPlayers,
        peakDayLabel: String(peakDay?.label || ""),
      },
      trend,
      snapshotTrend,
      peakMoments,
      hourOfDay,
      weekday,
      snapshotsCoverage: {
        startMs: snapshotsStartMs,
        endMs: range.endMs || nowMs,
        limitedToRecentWindow: snapshotsStartMs > safeSignedInt(range.startMs),
      },
    },
  };
}

function clampPercentScore(value = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.min(100, num));
}

function getAiAdvisorReportConfig(rawReportType = "") {
  const reportType = String(rawReportType || "daily").trim().toLowerCase() === "global"
    ? "global"
    : "daily";
  return reportType === "global"
    ? {
        reportType,
        analyticsWindow: "30d",
        label: "30 derniers jours",
        goal: "Vue globale recente pour piloter la croissance, la retention et la monetisation sans charger tout l'historique brut.",
      }
    : {
        reportType,
        analyticsWindow: "today",
        label: "Aujourd'hui",
        goal: "Vue quotidienne pour savoir quoi corriger, surveiller ou pousser dans les prochaines heures.",
      };
}

function normalizeAiAdvisorCustomRange(options = {}, nowMs = Date.now()) {
  const requestedStartMs = safeSignedInt(options.startMs);
  const requestedEndMs = safeSignedInt(options.endMs);
  if (requestedStartMs <= 0 || requestedEndMs <= 0) {
    return {
      enabled: false,
      startMs: 0,
      endMs: 0,
      label: "",
    };
  }

  let endMs = Math.min(requestedEndMs, nowMs);
  let startMs = Math.min(requestedStartMs, endMs);
  if (startMs <= 0 || endMs <= 0 || endMs < startMs) {
    return {
      enabled: false,
      startMs: 0,
      endMs: 0,
      label: "",
    };
  }

  const maxRangeMs = 180 * 24 * 60 * 60 * 1000;
  if ((endMs - startMs) > maxRangeMs) {
    startMs = endMs - maxRangeMs;
  }

  const label = `${new Date(startMs).toLocaleDateString("fr-FR", { dateStyle: "medium" })} -> ${new Date(endMs).toLocaleDateString("fr-FR", { dateStyle: "medium" })}`;

  return {
    enabled: true,
    startMs,
    endMs,
    label,
  };
}

function buildAiTrendDigest(trend = [], key = "") {
  const rows = Array.isArray(trend) ? trend : [];
  const values = rows
    .map((item) => Number(item?.[key]))
    .filter((value) => Number.isFinite(value) && value >= 0);

  if (values.length <= 0) {
    return {
      direction: "flat",
      changePct: 0,
      baselineAvg: 0,
      recentAvg: 0,
      latest: 0,
      samples: 0,
    };
  }

  const splitIndex = Math.max(1, Math.floor(values.length / 2));
  const baseline = values.slice(0, splitIndex);
  const recent = values.slice(splitIndex);
  const safeRecent = recent.length > 0 ? recent : baseline;
  const baselineAvg = baseline.length > 0
    ? baseline.reduce((sum, value) => sum + value, 0) / baseline.length
    : 0;
  const recentAvg = safeRecent.reduce((sum, value) => sum + value, 0) / Math.max(1, safeRecent.length);
  const latest = values[values.length - 1] || 0;
  const changePct = baselineAvg > 0
    ? Number((((recentAvg - baselineAvg) / baselineAvg) * 100).toFixed(2))
    : (recentAvg > 0 ? 100 : 0);

  let direction = "flat";
  if (changePct >= 8) direction = "up";
  else if (changePct <= -8) direction = "down";

  return {
    direction,
    changePct,
    baselineAvg: Number(baselineAvg.toFixed(2)),
    recentAvg: Number(recentAvg.toFixed(2)),
    latest: Number(latest.toFixed(2)),
    samples: values.length,
  };
}

function computeAiAdvisorHealth(snapshot = {}) {
  const visitsSummary = snapshot.siteVisits?.summary || {};
  const presenceSummary = snapshot.presence?.summary || {};
  const gamesSummary = snapshot.games?.summary || {};
  const acquisitionSummary = snapshot.acquisition?.summary || {};
  const depositsSummary = snapshot.deposits?.summary || {};
  const operationsSummary = snapshot.operations || {};

  const rangeVisits = safeInt(visitsSummary.rangeVisits);
  const peakVisitors = safeInt(presenceSummary.peakVisitors);
  const peakPlayers = safeInt(presenceSummary.peakPlayers);
  const totalMatches = safeInt(gamesSummary.totalMatches);
  const approvedHtg = safeInt(depositsSummary.approvedHtg);
  const totalAccounts = Math.max(1, safeInt(acquisitionSummary.totalAccounts));
  const activeRatePct = Number(acquisitionSummary.activeRatePct || 0);
  const signupToActiveRatePct = Number(acquisitionSummary.signupToActiveRatePct || 0);
  const signupToFidelizedRatePct = Number(acquisitionSummary.signupToFidelizedRatePct || 0);
  const signupToDepositRatePct = Number(acquisitionSummary.signupToDepositRatePct || 0);
  const approvedRatePct = Number(depositsSummary.approvedRatePct || 0);
  const rejectedRatePct = Number(depositsSummary.rejectedRatePct || 0);
  const pendingDeposits = safeInt(depositsSummary.pendingCount);
  const pendingWithdrawals = safeInt(operationsSummary.pendingWithdrawalsCount);
  const frozenAccounts = safeInt(acquisitionSummary.frozenAccounts);
  const openDeletionReviewCount = safeInt(operationsSummary.openDeletionReviewCount);
  const activeGames = [
    safeInt(gamesSummary.classicMatches) > 0,
    safeInt(gamesSummary.duelMatches) > 0,
    safeInt(gamesSummary.morpionMatches) > 0,
    safeInt(gamesSummary.dameMatches) > 0,
    safeInt(gamesSummary.chessMatches) > 0,
    safeInt(gamesSummary.ludoMatches) > 0,
  ].filter(Boolean).length;

  const trafficScore = clampPercentScore(
    Math.min(42, Math.log10(rangeVisits + 1) * 19)
    + Math.min(28, Math.log10(peakVisitors + 1) * 15)
    + Math.min(30, Math.log10(totalMatches + 1) * 15)
  );

  const matchPerVisit = rangeVisits > 0 ? (totalMatches / rangeVisits) : 0;
  const livePlayRatio = peakVisitors > 0 ? (peakPlayers / peakVisitors) : 0;
  const engagementScore = clampPercentScore(
    Math.min(45, matchPerVisit * 95)
    + Math.min(25, (activeGames / 6) * 25)
    + Math.min(30, livePlayRatio * 60)
  );

  const monetizationScore = clampPercentScore(
    Math.min(50, Math.log10(approvedHtg + 1) * 12)
    + Math.min(30, approvedRatePct * 0.3)
    + Math.min(20, signupToDepositRatePct * 0.67)
  );

  const retentionScore = clampPercentScore(
    Math.min(45, activeRatePct * 0.55)
    + Math.min(30, signupToActiveRatePct * 0.6)
    + Math.min(25, signupToFidelizedRatePct * 0.8)
  );

  const frozenRatePct = totalAccounts > 0 ? ((frozenAccounts / totalAccounts) * 100) : 0;
  const operationsScore = clampPercentScore(
    100
    - Math.min(22, pendingDeposits * 4)
    - Math.min(18, pendingWithdrawals * 4)
    - Math.min(24, rejectedRatePct * 0.45)
    - Math.min(20, frozenRatePct * 1.15)
    - Math.min(16, openDeletionReviewCount * 2)
  );

  const dimensions = [
    { key: "traffic", label: "Trafic", score: Math.round(trafficScore) },
    { key: "engagement", label: "Engagement", score: Math.round(engagementScore) },
    { key: "monetization", label: "Monetisation", score: Math.round(monetizationScore) },
    { key: "retention", label: "Retention", score: Math.round(retentionScore) },
    { key: "operations", label: "Operations", score: Math.round(operationsScore) },
  ];

  const overallScore = Math.round(
    dimensions.reduce((sum, item) => sum + safeInt(item.score), 0) / Math.max(1, dimensions.length)
  );

  let level = "avance";
  let tone = "good";
  if (overallScore < 35) {
    level = "malade";
    tone = "critical";
  } else if (overallScore < 55) {
    level = "amateur";
    tone = "warning";
  } else if (overallScore < 75) {
    level = "moyen";
    tone = "watch";
  }

  return {
    overallScore,
    level,
    tone,
    weakestDimensions: dimensions.slice().sort((left, right) => left.score - right.score).slice(0, 2),
    strongestDimensions: dimensions.slice().sort((left, right) => right.score - left.score).slice(0, 2),
    dimensions,
  };
}

function buildAiAdvisorNarrative(snapshot = {}) {
  const visitsSummary = snapshot.siteVisits?.summary || {};
  const gamesSummary = snapshot.games?.summary || {};
  const acquisitionSummary = snapshot.acquisition?.summary || {};
  const depositsSummary = snapshot.deposits?.summary || {};
  const operationsSummary = snapshot.operations || {};
  const health = snapshot.health || {};
  const weakestLabels = Array.isArray(health.weakestDimensions)
    ? health.weakestDimensions.map((item) => String(item.label || "").trim()).filter(Boolean)
    : [];
  const strongestLabels = Array.isArray(health.strongestDimensions)
    ? health.strongestDimensions.map((item) => String(item.label || "").trim()).filter(Boolean)
    : [];

  const alerts = [];
  const strengths = [];
  const priorities = [];

  if (safeInt(visitsSummary.rangeVisits) <= 0) {
    alerts.push("Aucun trafic visiteur pertinent n'a ete mesure sur la fenetre selectionnee.");
  }
  if (safeInt(gamesSummary.totalMatches) <= 0) {
    alerts.push("Aucune partie terminee n'a ete detectee: verifier l'acquisition, l'entree en salle ou la conversion vers le jeu.");
  }
  if (Number(depositsSummary.approvedRatePct || 0) < 55 && safeInt(depositsSummary.requestedCount) >= 5) {
    alerts.push("Le taux d'approbation des depots est faible: cela peut casser la confiance et ralentir la croissance.");
  }
  if (safeInt(depositsSummary.pendingCount) >= 3) {
    alerts.push(`Il y a ${safeInt(depositsSummary.pendingCount)} depot(s) en attente, ce qui cree un risque operationnel.`);
  }
  if (safeInt(operationsSummary.pendingWithdrawalsCount) >= 3) {
    alerts.push(`Il y a ${safeInt(operationsSummary.pendingWithdrawalsCount)} retrait(s) en attente, ce qui peut tendre le support et la satisfaction.`);
  }
  if (Number(acquisitionSummary.signupToDepositRatePct || 0) < 10 && safeInt(acquisitionSummary.signupsCount) >= 5) {
    alerts.push("La conversion inscription vers premier depot est faible: il faut simplifier le tunnel et mieux orienter le nouveau client.");
  }
  if (safeInt(acquisitionSummary.frozenAccounts) > 0) {
    alerts.push(`Le site compte ${safeInt(acquisitionSummary.frozenAccounts)} compte(s) gele(s): surveiller les motifs de gel et leur impact produit.`);
  }
  if (safeInt(operationsSummary.openDeletionReviewCount) > 0) {
    alerts.push(`Des comptes inactifs sont en revue de suppression (${safeInt(operationsSummary.openDeletionReviewCount)} ouverts): pense a qualifier leur vraie valeur business.`);
  }

  if (safeInt(visitsSummary.rangeVisits) > 0 && safeInt(gamesSummary.totalMatches) > 0) {
    strengths.push("Le site convertit deja une partie du trafic en activite de jeu mesurable.");
  }
  if (Number(depositsSummary.approvedRatePct || 0) >= 75 && safeInt(depositsSummary.approvedCount) > 0) {
    strengths.push("Le traitement des depots approuves reste solide sur la periode observee.");
  }
  if (Number(acquisitionSummary.signupToActiveRatePct || 0) >= 35) {
    strengths.push("Une part correcte des nouvelles inscriptions reste active apres l'entree sur le site.");
  }
  if (strongestLabels.length > 0) {
    strengths.push(`Les zones les plus solides actuellement sont: ${strongestLabels.join(", ")}.`);
  }

  if (weakestLabels.includes("Trafic")) {
    priorities.push("Priorite P1: relancer le trafic qualifie et la visibilite du site avant d'ajouter de nouvelles fonctionnalites.");
  }
  if (weakestLabels.includes("Engagement")) {
    priorities.push("Priorite P1: augmenter l'entree en partie, la frequence de jeu et la repartition entre les jeux.");
  }
  if (weakestLabels.includes("Monetisation")) {
    priorities.push("Priorite P1: travailler le tunnel inscription -> depot -> premiere partie jouee.");
  }
  if (weakestLabels.includes("Retention")) {
    priorities.push("Priorite P1: renforcer le retour des nouveaux inscrits et la fidelisation des comptes actifs.");
  }
  if (weakestLabels.includes("Operations")) {
    priorities.push("Priorite P1: fluidifier les traitements operations/support pour eviter que les frictions detruisent la conversion.");
  }
  if (priorities.length <= 0) {
    priorities.push("Priorite P1: consolider ce qui marche deja et choisir 1 a 2 optimisations a fort impact au lieu de disperser les efforts.");
  }

  return {
    alerts: alerts.slice(0, 6),
    strengths: strengths.slice(0, 5),
    priorities: priorities.slice(0, 4),
  };
}

async function computeAiAdvisorSnapshot(options = {}) {
  const nowMs = safeSignedInt(options.nowMs) || Date.now();
  const reportConfig = getAiAdvisorReportConfig(options.reportType || options.mode || options.type || "daily");
  const customRange = normalizeAiAdvisorCustomRange(options, nowMs);
  const sharedOptions = {
    window: reportConfig.analyticsWindow,
    nowMs,
    ...(customRange.enabled ? { startMs: customRange.startMs, endMs: customRange.endMs } : {}),
  };
  const resolvedRange = getTimelineAnalyticsRange(sharedOptions, nowMs);

  const clientsCollection = db.collection(CLIENTS_COLLECTION);
  const [
    presenceResult,
    siteVisitsResult,
    gamesResult,
    acquisitionResult,
    depositsResult,
    pendingWithdrawalsCount,
    deletionReviewPendingCount,
    deletionReviewContactedCount,
  ] = await Promise.all([
    computePresenceAnalyticsSnapshot(sharedOptions),
    computeSiteVisitsAnalyticsSnapshot(sharedOptions),
    computeGamesVolumeAnalyticsSnapshot(sharedOptions),
    computeClientAcquisitionSnapshot(sharedOptions),
    computeDepositAnalyticsSnapshot(sharedOptions),
    getAggregationCount(db.collectionGroup("withdrawals").where("status", "==", "pending")),
    getAggregationCount(clientsCollection.where("deletionReviewStatus", "==", CLIENT_DELETION_REVIEW_PENDING_STATUS)),
    getAggregationCount(clientsCollection.where("deletionReviewStatus", "==", CLIENT_DELETION_REVIEW_CONTACTED_STATUS)),
  ]);

  const snapshot = {
    generatedAtMs: nowMs,
    reportType: reportConfig.reportType,
    reportLabel: reportConfig.label,
    reportGoal: reportConfig.goal,
    windows: {
      analyticsWindow: reportConfig.analyticsWindow,
      startMs: safeSignedInt(resolvedRange.startMs),
      endMs: safeSignedInt(resolvedRange.endMs) || nowMs,
      customRangeApplied: customRange.enabled,
      customRangeLabel: customRange.enabled ? customRange.label : "",
    },
    presence: {
      summary: presenceResult?.snapshot?.summary || {},
      trendDigest: buildAiTrendDigest(presenceResult?.snapshot?.trend || [], "peakVisitors"),
    },
    siteVisits: {
      summary: siteVisitsResult?.snapshot?.summary || {},
      trendDigest: buildAiTrendDigest(siteVisitsResult?.snapshot?.trend || [], "visitCount"),
    },
    games: {
      summary: gamesResult?.snapshot?.summary || {},
      mix: Array.isArray(gamesResult?.snapshot?.mix) ? gamesResult.snapshot.mix : [],
      trendDigest: buildAiTrendDigest(gamesResult?.snapshot?.trend || [], "totalMatches"),
    },
    acquisition: {
      summary: acquisitionResult?.summary || {},
      truncated: acquisitionResult?.truncated === true,
      trendDigest: buildAiTrendDigest(acquisitionResult?.series?.signups || [], "value"),
    },
    deposits: {
      summary: depositsResult?.summary || {},
      truncated: depositsResult?.truncated === true,
      trendDigest: buildAiTrendDigest(depositsResult?.series?.approvedHtg || [], "value"),
    },
    operations: {
      pendingWithdrawalsCount: safeInt(pendingWithdrawalsCount),
      deletionReviewPendingCount: safeInt(deletionReviewPendingCount),
      deletionReviewContactedCount: safeInt(deletionReviewContactedCount),
      openDeletionReviewCount: safeInt(deletionReviewPendingCount) + safeInt(deletionReviewContactedCount),
    },
  };

  snapshot.health = computeAiAdvisorHealth(snapshot);
  snapshot.narrative = buildAiAdvisorNarrative(snapshot);

  return {
    ok: true,
    generatedAtMs: nowMs,
    snapshot,
  };
}

module.exports = {
  computeAiAdvisorSnapshot,
  computeHtgCashflowSnapshot,
  computeClientAcquisitionSnapshot,
  computeApprovedDepositsSnapshot,
  computeDepositAnalyticsSnapshot,
  computeGamesVolumeAnalyticsSnapshot,
  computeMorpionAnalyticsSnapshot,
  computePresenceAnalyticsSnapshot,
  computeSiteVisitsAnalyticsSnapshot,
  recordSiteVisit,
};
