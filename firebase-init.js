import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getAuth,
  onAuthStateChanged,
  reauthenticateWithCredential,
  signInWithEmailAndPassword,
  signOut,
  updatePassword,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";
import {
  getAnalytics,
  isSupported as isAnalyticsSupported,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-analytics.js";
import {
  getFunctions,
  httpsCallable,
} from "https://www.gstatic.com/firebasejs/10.12.5/firebase-functions.js";

const firebaseConfig = {
  apiKey: "AIzaSyAROcyshONWCkiHfz-LSMPptA841eo7gds",
  authDomain: "kobpoch-5db87.firebaseapp.com",
  projectId: "kobpoch-5db87",
  storageBucket: "kobpoch-5db87.firebasestorage.app",
  messagingSenderId: "153695116743",
  appId: "1:153695116743:web:6001ef11fcd7b24e490de2",
  measurementId: "G-BBG9X4SK09",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const storage = getStorage(app);
const functions = getFunctions(app, "us-central1");

let analytics = null;

try {
  if (await isAnalyticsSupported()) {
    analytics = getAnalytics(app);
  }
} catch (error) {
  console.warn("[KOBPOSH_V2] analytics unavailable", error);
}

window.kobposhFirebase = {
  app,
  auth,
  db,
  storage,
  functions,
  analytics,
  firebaseConfig,
};

console.log("[KOBPOSH_V2] firebase ready", {
  projectId: firebaseConfig.projectId,
  authDomain: firebaseConfig.authDomain,
});

export {
  app,
  auth,
  createUserWithEmailAndPassword,
  db,
  EmailAuthProvider,
  collection,
  doc,
  getDoc,
  getDocs,
  getFunctions,
  httpsCallable,
  limit,
  onAuthStateChanged,
  onSnapshot,
  orderBy,
  query,
  reauthenticateWithCredential,
  serverTimestamp,
  setDoc,
  signInWithEmailAndPassword,
  storage,
  functions,
  signOut,
  updatePassword,
  where,
  analytics,
  firebaseConfig,
};
