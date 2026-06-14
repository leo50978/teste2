const admin = require("firebase-admin");

function readRequiredEnv(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function buildCredentialConfig() {
  const projectId = readRequiredEnv("FIREBASE_PROJECT_ID");
  const clientEmail = readRequiredEnv("FIREBASE_CLIENT_EMAIL");
  const privateKey = readRequiredEnv("FIREBASE_PRIVATE_KEY").replace(/\\n/g, "\n");
  const storageBucket = String(process.env.FIREBASE_STORAGE_BUCKET || "").trim();

  return {
    projectId,
    clientEmail,
    privateKey,
    storageBucket,
  };
}

function getOrCreateApp() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  const config = buildCredentialConfig();
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: config.projectId,
      clientEmail: config.clientEmail,
      privateKey: config.privateKey,
    }),
    storageBucket: config.storageBucket || undefined,
  });
}

const app = getOrCreateApp();
const db = admin.firestore(app);
const auth = admin.auth(app);

module.exports = {
  admin,
  app,
  db,
  auth,
};
