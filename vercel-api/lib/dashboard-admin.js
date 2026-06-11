const { db } = require("./firebase-admin");
const { sanitizeEmail } = require("./deposits");
const { makeHttpError } = require("./http");

const BOOTSTRAP_DOC_ID = "dpayment_admin_bootstrap";

async function readBootstrapAdminEmail() {
  try {
    const snap = await db.collection("settings").doc(BOOTSTRAP_DOC_ID).get();
    if (!snap.exists) return "";
    return sanitizeEmail(snap.data()?.email || "");
  } catch (_) {
    return "";
  }
}

async function requireFinanceAdmin(decodedToken = null) {
  const token = decodedToken && typeof decodedToken === "object" ? decodedToken : {};
  const email = sanitizeEmail(token.email || "");
  const hasClaim = token.admin === true || token.financeAdmin === true;
  const bootstrapEmail = await readBootstrapAdminEmail();
  const allowedByEmail = !!email && !!bootstrapEmail && email === bootstrapEmail;

  if (!hasClaim && !allowedByEmail) {
    throw makeHttpError(403, "permission-denied", "Acces administrateur requis.");
  }

  return {
    uid: String(token.uid || "").trim(),
    email,
    bootstrapEmail,
  };
}

module.exports = {
  requireFinanceAdmin,
};
