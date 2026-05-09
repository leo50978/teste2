const { auth } = require("./firebase-admin");
const { makeHttpError } = require("./http");

function readBearerToken(req) {
  const header = String(req.headers.authorization || "").trim();
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}

async function requireAuth(req) {
  const token = readBearerToken(req);
  if (!token) {
    throw makeHttpError(401, "missing-auth-token", "Connexion requise.");
  }

  try {
    const decoded = await auth.verifyIdToken(token, true);
    return decoded;
  } catch (error) {
    throw makeHttpError(401, "invalid-auth-token", "Session invalide ou expiree.", {
      firebaseCode: String(error?.code || ""),
    });
  }
}

module.exports = {
  requireAuth,
};
