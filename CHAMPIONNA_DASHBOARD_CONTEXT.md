# CHAMPIONNA DASHBOARD - Contexte et journal de bord

## Objectif

Ce document suit le dashboard admin Championna ajoute dans `D:\kobposhv2`.

Le dashboard sert a:
- choisir un jeu Championna
- voir les inscrits et le calendrier existant
- entrer le score final d'un match
- marquer le match comme termine
- envoyer automatiquement le gagnant vers la phase suivante
- mettre a jour le calendrier affiche sur le site public

---

## Emplacement

Interface:
- `D:\kobposhv2\control-panel.html`
- `D:\kobposhv2\control-panel.js`

Helpers frontend:
- `D:\kobposhv2\secure-functions.js`

Routes backend Vercel:
- `D:\kobposhv2\vercel-api\api\dashboard\[section]\[action].js`
- `D:\kobposhv2\vercel-api\routes\dashboard\championna\snapshot.js`
- `D:\kobposhv2\vercel-api\routes\dashboard\championna\update-match.js`

---

## Donnees utilisees

Le dashboard lit et modifie les memes donnees que le site public:

- inscriptions: `tournamentRegistrations`
- calendrier: `tournamentBrackets/{gameKey}`

Le site public ecoute `tournamentBrackets/{gameKey}` avec `onSnapshot`.
Donc quand le dashboard met un score a jour, le score apparait automatiquement dans la modal Championna du site.

---

## Regle score

Dans un match Championna:
- chaque match contient plusieurs parties
- le premier joueur qui gagne `2` parties gagne le match
- score valide attendu:
  - `2 - 0`
  - `2 - 1`
  - `0 - 2`
  - `1 - 2`
- un score egal est refuse
- un score ou le gagnant a moins de `2` parties est refuse

---

## Passage de phase

Quand un score est valide:

1. le match passe en `completed`
2. `homeScore`, `awayScore`, `winnerUid`, `winnerName` sont sauvegardes
3. le gagnant est place dans le match suivant:
   - `QF1` + `QF2` alimentent `SF1`
   - `QF3` + `QF4` alimentent `SF2`
   - `SF1` + `SF2` alimentent `F1`
4. si la finale est terminee:
   - `championUid`, `championName`, `championPrizeHtg: 1100`
   - `runnerUpUid`, `runnerUpName`, `runnerUpPrizeHtg: 500`

---

## Securite

Les routes dashboard Championna demandent:
- utilisateur connecte Firebase
- role admin finance (`admin` ou `financeAdmin`) ou email bootstrap admin

La verification passe par:
- `requireAuth`
- `requireFinanceAdmin`

---

## Journal de bord

## 2026-06-01 - Etape 1

- ajout section `Dashboard Championna` dans `control-panel.html`
- ajout choix jeu Championna
- ajout resume inscrits / matchs finis / statut
- ajout cartes de matchs avec score `home` / `away`
- bouton `Sove score + pase faz`
- ajout helper frontend:
  - `getChampionnaDashboardSnapshotSecure`
  - `updateChampionnaMatchScoreSecure`
- ajout routes backend:
  - `POST /api/dashboard/championna/snapshot`
  - `POST /api/dashboard/championna/update-match`
- la mise a jour d'un score modifie directement `tournamentBrackets/{gameKey}`
- le calendrier public du site recoit les scores en live via Firestore

## 2026-06-01 - Etape 2

- correction: le dashboard Championna devait aussi exister dans le vrai hub admin `D:\dashboardkobposhv2`
- ajout page dashboard principale:
  - `D:\dashboardkobposhv2\Dchampionna.html`
  - `D:\dashboardkobposhv2\Dchampionna.js`
- ajout bouton `Championna` dans `D:\dashboardkobposhv2\index.html`
- ajout carte `Gestion Championna` dans la section `Jeux et analyse`
- ajout entree `Championna` dans `D:\dashboardkobposhv2\dashboard-nav-bubble.js`
- ajout wrappers dashboard:
  - `getChampionnaDashboardSnapshotSecure`
  - `updateChampionnaMatchScoreSecure`
- verification locale:
  - hub dashboard affiche le bouton/la carte Championna
  - `Dchampionna.html` charge sans erreur console

## 2026-06-01 - Etape 3

- correction du chargement module dashboard:
  - `Dchampionna.js` importe maintenant `secure-functions.js` avec cache-busting
  - `Dchampionna.html` charge `Dchampionna.js?v=20260601-championna-remove1`
- nettoyage interface `Dchampionna.html`:
  - retrait du gros bloc intro `Gestion des matchs et scores`
  - retrait des liens `Retour hub`, `Volume jeux`, `Analytics Morpion`
  - retrait du bouton top `Rafraichir Championna`
- ajout gestion des inscrits:
  - liste des inscrits du jeu choisi dans le dashboard
  - bouton `Retirer` par inscrit
  - endpoint backend `POST /api/dashboard/championna/remove-registration`
- regle de securite backend:
  - retrait autorise avant match termine
  - si un bracket existe sans match termine, il est supprime pour forcer un nouveau tirage propre apres retour a 8 inscrits
  - si un match est deja termine, retrait refuse pour eviter de casser le calendrier

---

## Checklist

- [ ] connecter un compte admin dans `control-panel.html`
- [ ] cliquer `Rafrechi Championna`
- [ ] choisir un jeu avec bracket existant
- [ ] entrer un score valide `2-0` ou `2-1`
- [ ] verifier que le match passe en termine
- [ ] verifier que le gagnant apparait dans le tour suivant
- [ ] verifier que le score apparait dans la modal Championna du site public
