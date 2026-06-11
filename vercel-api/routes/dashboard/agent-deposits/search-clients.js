const { db } = require("../../../lib/firebase-admin");
const { requireAuth } = require("../../../lib/auth");
const { requireFinanceAdmin } = require("../../../lib/dashboard-admin");
const { handlePreflight, normalizeError, parseJsonBody, sendJson, sendMethodNotAllowed } = require("../../../lib/http");
const {
  AGENT_DEPOSIT_SEARCH_FALLBACK_LIMIT,
  buildAgentDepositSearchRecord,
  normalizeSearchText,
  phoneDigits,
  sanitizeUsername,
  sortSearchResults,
} = require("../../../lib/agent-deposits");
const { sanitizeEmail } = require("../../../lib/deposits");
const { normalizeHaitiMobilePhone, sanitizePhone, sanitizeText } = require("../../../lib/safe");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    await requireFinanceAdmin(decoded);
    const payload = await parseJsonBody(req);
    const rawQuery = sanitizeText(payload.query || "", 160);
    const normalizedQuery = normalizeSearchText(rawQuery);
    const queryDigits = phoneDigits(rawQuery);
    const queryUsername = sanitizeUsername(rawQuery || "", 24);
    const queryEmail = sanitizeEmail(rawQuery || "", 160);
    const results = new Map();

    if (!rawQuery) {
      sendJson(req, res, 200, { ok: true, results: [] });
      return;
    }

    const addClientSnap = (docSnap) => {
      if (!docSnap?.exists) return;
      results.set(docSnap.id, buildAgentDepositSearchRecord(docSnap.id, docSnap.data() || {}));
    };
    const addClientDocs = (snap) => {
      (snap?.docs || []).forEach((docSnap) => addClientSnap(docSnap));
    };

    if (rawQuery.length >= 20 && /^[A-Za-z0-9_-]+$/.test(rawQuery)) {
      addClientSnap(await db.collection("clients").doc(rawQuery).get());
    }

    const exactLookups = [];
    if (queryEmail) {
      exactLookups.push(db.collection("clients").where("email", "==", queryEmail).limit(6).get());
    }
    if (queryUsername) {
      exactLookups.push(db.collection("clients").where("username", "==", queryUsername).limit(6).get());
    }
    if (queryDigits.length >= 8) {
      const normalizedPhone = normalizeHaitiMobilePhone(rawQuery, 40);
      exactLookups.push(
        db.collection("clients")
          .where("phone", "==", normalizedPhone || sanitizePhone(rawQuery, 40))
          .limit(6)
          .get()
      );
    }

    if (exactLookups.length) {
      const exactSnaps = await Promise.allSettled(exactLookups);
      exactSnaps.forEach((entry) => {
        if (entry.status === "fulfilled") {
          addClientDocs(entry.value);
        }
      });
    }

    if (results.size < 12 && normalizedQuery.length >= 2) {
      let fallbackSnap = null;
      try {
        fallbackSnap = await db.collection("clients").orderBy("lastSeenAtMs", "desc").limit(AGENT_DEPOSIT_SEARCH_FALLBACK_LIMIT).get();
      } catch (_) {
        fallbackSnap = await db.collection("clients").limit(AGENT_DEPOSIT_SEARCH_FALLBACK_LIMIT).get();
      }

      (fallbackSnap?.docs || []).forEach((docSnap) => {
        if (results.size >= 12) return;
        const raw = docSnap.data() || {};
        const haystack = [
          docSnap.id,
          raw.uid,
          raw.name,
          raw.displayName,
          raw.username,
          raw.email,
          raw.phone,
        ].map((value) => normalizeSearchText(value)).filter(Boolean).join(" ");

        const phoneHaystack = [
          phoneDigits(raw.phone || ""),
          phoneDigits(raw.customerPhone || ""),
        ].filter(Boolean).join(" ");

        const match = haystack.includes(normalizedQuery)
          || (queryDigits.length >= 4 && phoneHaystack.includes(queryDigits));
        if (match) {
          addClientSnap(docSnap);
        }
      });
    }

    sendJson(req, res, 200, {
      ok: true,
      query: rawQuery,
      results: sortSearchResults(Array.from(results.values())),
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de rechercher le client.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
