import { auth, signOut } from "./firebase-init.js";

export function formatAuthError(err, fallback = "Erreur d'authentification") {
  const code = err && err.code ? String(err.code) : "";
  const map = {
    "auth/invalid-email": "Email invalide.",
    "auth/user-not-found": "Compte introuvable.",
    "auth/wrong-password": "Mot de passe incorrect.",
    "auth/invalid-credential": "Email ou mot de passe incorrect.",
    "auth/too-many-requests": "Twop tantativ. Tann yon ti moman epi eseye anko.",
    "auth/network-request-failed": "Pwoblem rezo. Verifye koneksyon ou.",
    "auth/requires-recent-login": "Tanpri rekonekte avan aksyon sa a.",
  };
  if (code && map[code]) return `${map[code]} (${code})`;
  if (code) return `${fallback} (${code})`;
  return String(err?.message || fallback);
}

export async function logoutCurrentUser() {
  return signOut(auth);
}
