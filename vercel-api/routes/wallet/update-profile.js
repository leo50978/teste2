const { admin, db } = require("../../lib/firebase-admin");
const { requireAuth } = require("../../lib/auth");
const {
  handlePreflight,
  makeHttpError,
  normalizeError,
  parseJsonBody,
  sendJson,
  sendMethodNotAllowed,
} = require("../../lib/http");
const { sanitizeEmail } = require("../../lib/deposits");
const { normalizeHaitiMobilePhone, safeSignedInt, sanitizePhone, sanitizeText } = require("../../lib/safe");
const {
  generateReferralCode,
  generateWelcomeBonusProofCode,
  normalizeWelcomeBonusPromptStatus,
  sanitizePublicAsset,
  sanitizeUsername,
  walletRef,
} = require("../../lib/player-wallet");

module.exports = async function handler(req, res) {
  if (handlePreflight(req, res)) return;
  if (req.method !== "POST") {
    sendMethodNotAllowed(req, res, ["POST", "OPTIONS"]);
    return;
  }

  try {
    const decoded = await requireAuth(req);
    const uid = String(decoded.uid || "").trim();
    const email = sanitizeEmail(decoded.email || "", 160);
    const payload = await parseJsonBody(req);
    const clientRef = walletRef(uid);
    const snap = await clientRef.get();
    const current = snap.exists ? (snap.data() || {}) : {};

    const usernameInput = sanitizeUsername(payload.username || "", 24);
    const currentUsername = sanitizeUsername(current.username || "", 24);
    if (usernameInput && usernameInput !== currentUsername) {
      const existingUsernameSnap = await db.collection("clients")
        .where("username", "==", usernameInput)
        .limit(1)
        .get();
      if (!existingUsernameSnap.empty && existingUsernameSnap.docs[0].id !== uid) {
        throw makeHttpError(409, "username-taken", "Non itilizate sa a deja itilize.");
      }
    }

    const name = sanitizeText(payload.name || "", 80);
    const rawPhone = sanitizeText(payload.phone || "", 40);
    const phone = rawPhone ? normalizeHaitiMobilePhone(rawPhone, 40) : "";
    const photoURL = sanitizePublicAsset(payload.photoURL || "", 400);
    const oneClickIdInput = sanitizeText(payload.oneClickId || "", 64).toUpperCase();
    const welcomeBonusPromptStatusInput = normalizeWelcomeBonusPromptStatus(payload.welcomeBonusPromptStatus || "");
    const completeWelcomeBonusTutorial = payload.welcomeBonusTutorialCompleted === true;
    const markSignupBonusModalSeen = payload.signupBonusModalSeen === true;
    const dameWhatsappNumberInput = sanitizePhone(payload.dameWhatsappNumber || "", 40);
    const dameWaitingNotificationRequested = payload.dameWaitingNotificationRequested === true;
    const dameWaitingNotificationRequestedAtMsInput = safeSignedInt(payload.dameWaitingNotificationRequestedAtMs);

    if (rawPhone && !phone) {
      throw makeHttpError(
        400,
        "invalid-phone",
        "Numero a pa bon mete on bon numero haiti ossinon ou pap k fe retre"
      );
    }

    const isNewProfile = !snap.exists;
    const currentPhone = sanitizeText(current.phone || "", 40);
    if (phone && phone !== currentPhone) {
      const existingPhoneSnap = await db.collection("clients")
        .where("phone", "==", phone)
        .limit(1)
        .get();
      if (!existingPhoneSnap.empty && existingPhoneSnap.docs[0].id !== uid) {
        throw makeHttpError(409, "phone-taken", "Numero sa a deja lye ak yon lot kont.");
      }
    }
    let nextWelcomeBonusPromptStatus = normalizeWelcomeBonusPromptStatus(current.welcomeBonusPromptStatus || "")
      || (isNewProfile ? "pending" : "");
    let nextWelcomeBonusPromptAnsweredAtMs = safeSignedInt(current.welcomeBonusPromptAnsweredAtMs);
    let nextWelcomeBonusProofCode = sanitizeText(current.welcomeBonusProofCode || "", 80).toUpperCase();
    let nextWelcomeBonusTutorialCompletedAtMs = safeSignedInt(current.welcomeBonusTutorialCompletedAtMs);
    let nextSignupBonusModalSeenAtMs = safeSignedInt(current.signupBonusModalSeenAtMs);

    if (
      (welcomeBonusPromptStatusInput === "accepted" || welcomeBonusPromptStatusInput === "declined")
      && nextWelcomeBonusPromptStatus !== "accepted"
      && nextWelcomeBonusPromptStatus !== "declined"
    ) {
      nextWelcomeBonusPromptStatus = welcomeBonusPromptStatusInput;
      nextWelcomeBonusPromptAnsweredAtMs = Date.now();
      if (welcomeBonusPromptStatusInput === "accepted" && !nextWelcomeBonusProofCode) {
        nextWelcomeBonusProofCode = generateWelcomeBonusProofCode(uid);
      }
    } else if (welcomeBonusPromptStatusInput === "pending" && !nextWelcomeBonusPromptStatus) {
      nextWelcomeBonusPromptStatus = "pending";
    }

    if (completeWelcomeBonusTutorial && nextWelcomeBonusTutorialCompletedAtMs <= 0) {
      nextWelcomeBonusTutorialCompletedAtMs = Date.now();
    }
    if (markSignupBonusModalSeen && nextSignupBonusModalSeenAtMs <= 0) {
      nextSignupBonusModalSeenAtMs = Date.now();
    }

    const nowMs = Date.now();
    const patch = {
      uid,
      email: email || String(current.email || ""),
      name: name || sanitizeText(current.name || String(email || "").split("@")[0] || "Player", 80),
      phone: phone || currentPhone,
      photoURL: photoURL || sanitizePublicAsset(current.photoURL || "", 400),
      username: usernameInput || currentUsername,
      oneClickId: oneClickIdInput || sanitizeText(current.oneClickId || "", 64).toUpperCase(),
      referralCode: sanitizeText(current.referralCode || generateReferralCode(uid), 32).toUpperCase(),
      welcomeBonusPromptStatus: nextWelcomeBonusPromptStatus,
      welcomeBonusPromptAnsweredAtMs: nextWelcomeBonusPromptAnsweredAtMs,
      welcomeBonusProofCode: nextWelcomeBonusProofCode,
      welcomeBonusTutorialCompletedAtMs: nextWelcomeBonusTutorialCompletedAtMs,
      signupBonusModalSeenAtMs: nextSignupBonusModalSeenAtMs,
      dameWhatsappNumber: dameWhatsappNumberInput || sanitizePhone(current.dameWhatsappNumber || "", 40),
      dameWhatsappVisible: payload.dameWhatsappVisible === true || current.dameWhatsappVisible === true,
      dameWaitingNotificationRequested: dameWaitingNotificationRequested || current.dameWaitingNotificationRequested === true,
      dameWaitingNotificationRequestedAtMs: dameWaitingNotificationRequested
        ? (dameWaitingNotificationRequestedAtMsInput > 0 ? dameWaitingNotificationRequestedAtMsInput : nowMs)
        : safeSignedInt(current.dameWaitingNotificationRequestedAtMs),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAtMs: nowMs,
      lastSeenAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSeenAtMs: nowMs,
    };

    await clientRef.set(patch, { merge: true });

    sendJson(req, res, 200, {
      ok: true,
      uid,
      profile: {
        uid,
        email: patch.email,
        name: patch.name,
        phone: patch.phone,
        photoURL: patch.photoURL,
        username: patch.username,
        oneClickId: patch.oneClickId,
        referralCode: patch.referralCode,
        welcomeBonusPromptStatus: patch.welcomeBonusPromptStatus,
        welcomeBonusProofCode: patch.welcomeBonusProofCode,
        dameWhatsappNumber: patch.dameWhatsappNumber,
        dameWaitingNotificationRequested: patch.dameWaitingNotificationRequested,
      },
    });
  } catch (error) {
    const normalized = normalizeError(error, "Impossible de mettre a jour le profil.");
    sendJson(req, res, normalized.httpStatus || 500, {
      ok: false,
      code: normalized.code || "internal",
      message: normalized.message,
      details: normalized.details || null,
    });
  }
};
