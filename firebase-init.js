// ============= FIREBASE INIT - MODULAR V9 =============
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-app.js';
import { 
  getFirestore, 
  enableIndexedDbPersistence, 
  CACHE_SIZE_UNLIMITED 
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-firestore.js';
import { 
  getAuth, 
  setPersistence, 
  browserLocalPersistence,
  GoogleAuthProvider
} from 'https://www.gstatic.com/firebasejs/10.7.0/firebase-auth.js';

const firebaseConfig = {
  apiKey: "AIzaSyANkKGDkA-t8Ijce4SNwqNcL8ArP9jPVqE",
  authDomain: "allin-f65df.firebaseapp.com",
  projectId: "allin-f65df",
  storageBucket: "allin-f65df.firebasestorage.app",
  messagingSenderId: "955152530266",
  appId: "1:955152530266:web:19952842f4559b10af9163"
};

let db = null;
let auth = null;
let googleProvider = null;

try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
  
  // Configuration du provider Google
  googleProvider.setCustomParameters({
    prompt: 'select_account'
  });
  
  // Persistance de session
  setPersistence(auth, browserLocalPersistence)
    .then(() => {})
    .catch(err => console.warn("⚠️ Persistance auth non activée:", err.code));
  
  // Persistance offline Firestore
  enableIndexedDbPersistence(db, { cacheSizeBytes: CACHE_SIZE_UNLIMITED })
    .then(() => {})
    .catch((err) => {
      if (err.code === 'failed-precondition') {
        console.warn("⚠️ Persistance offline non disponible (onglets multiples)");
      } else if (err.code === 'unimplemented') {
        console.warn("⚠️ Persistance offline non supportée");
      }
    });
  
} catch (error) {
  console.error("❌ Firebase initialization error:", error);
}

export { db, auth, googleProvider };
