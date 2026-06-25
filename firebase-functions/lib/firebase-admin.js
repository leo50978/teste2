const admin = require("firebase-admin");

function getOrCreateApp() {
  if (admin.apps.length > 0) {
    return admin.app();
  }

  return admin.initializeApp();
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
