# CHAMPIONNA V2 - Contexte et journal de bord

## Objectif du fichier

Ce document sert de repere unique pour le chantier `Championna` dans `D:\kobposhv2`.

Il doit nous aider a:
- garder le contexte produit
- suivre les decisions prises
- eviter de casser ce qui marche
- avancer sans se perdre entre modal, wallet et inscription

---

## Contexte produit actuel

Le parcours Championna attendu sur la page d'accueil est:

1. utilisateur clique sur la section Championna
2. modal Championna s'ouvre avec les cartes des jeux
3. utilisateur clique sur un jeu
4. modal d'inscription du jeu s'ouvre
5. utilisateur clique sur `S'inscrire`
6. modal de confirmation cout s'ouvre et annonce `200 HTG`
7. utilisateur confirme
8. le montant est debite
9. son username apparait dans la liste des inscrits

Important:
- dans les echanges, `150 HTG` a ete mentionne puis remplace par `200 HTG`
- l'implementation actuelle est alignee sur `200 HTG`

---

## Fichiers impactes

- `D:\kobposhv2\index.html`
- `D:\kobposhv2\style.css`
- `D:\kobposhv2\app.js`
- `D:\kobposhv2\control-panel.html`
- `D:\kobposhv2\control-panel.js`
- `D:\kobposhv2\CHAMPIONNA_DASHBOARD_CONTEXT.md`

---

## Etat implemente (au 31 mai 2026)

### 1) Modal Championna

- les cartes jeux de la modal Championna ont ete refaites pour etre plus explicites
- style proche de la section Championna de l'accueil:
  - image de fond
  - overlay sombre
  - label Championna
  - CTA visible `Klike pou enskri nan championna a`

### 2) Compatibilite desktop

- bug corrige: la modal ne s'affichait pas sur desktop
- cause: une regle CSS cachait `.games-modal` a partir de `900px`
- correction: `.games-modal` reste visible sur desktop, panel centre

### 3) Modal d'inscription par jeu

- un 2e modal s'ouvre apres clic sur un jeu
- ce modal affiche:
  - le jeu choisi
  - bouton `S'inscrire`
  - bouton `Reg championna a`
  - bloc liste des inscrits (compteur + elements)

### 4) Confirmation de paiement avant inscription

- au clic sur `S'inscrire`, une modal de confirmation s'ouvre
- texte: cout inscription `200 HTG`
- bouton de confirmation: `Peye 200 HTG`

### 5) Debit wallet et inscription

- au clic sur confirmation:
  - appel `walletMutateSecure` avec:
    - `op: "game_entry"`
    - `amountDoes: 4000`
    - `amountGourdes: 200`
    - `fundingCurrency: "htg"`
  - ecriture Firestore dans `tournamentRegistrations`
  - identifiant doc: `${gameKey}_${uid}`
  - champs: `uid`, `username`, `gameKey`, `gameName`, `costHtg`, `createdAtMs`, `updatedAt`

### 6) Liste des inscrits en direct

- `onSnapshot` est branche sur `tournamentRegistrations` filtre par `gameKey`
- la liste dans la modal est mise a jour en live
- compteur d'inscrits visible

### 7) Tirage 8 joueurs + calendrier tournoi (ajout du 1 juin 2026)

- des qu'un jeu atteint `8` inscrits, un tirage au sort aleatoire est genere
- generation faite dans `tournamentBrackets/{gameKey}`
- structure du bracket:
  - 1er tour: `4` matchs (QF1 a QF4)
  - 2e tour: `2` matchs demi-finales (SF1, SF2)
  - 3e tour: `1` finale (F1)
- la modal d'inscription affiche maintenant un bloc `Kalandriye championna`
- ce bloc montre:
  - `Match k ap vini` (scheduled)
  - `Match fini` (completed) avec score final
- le calendrier est ecoute en live via `onSnapshot` sur le document bracket

### 8) Anti double inscription (ajout du 1 juin 2026)

- un user deja inscrit ne peut plus cliquer `S'inscrire`
- le bouton principal passe automatiquement a `N ap tann lot jwe yo`
- le bouton reste desactive tant que l'utilisateur est deja dans les inscrits

### 9) Modal professionnelle feedback (ajout du 1 juin 2026)

- suppression des `window.alert` navigateur pour le flux Championna
- remplacement par une modal UI interne:
  - succes inscription
  - erreurs inscription
  - affichage des regles

### 10) Blocage HTG en attente (ajout du 1 juin 2026)

- si un utilisateur a des `HTG an atant` (`provisionalHtgAvailable > 0`), il ne peut pas s'inscrire
- au clic sur `S'inscrire`, le systeme relit le funding live avant d'ouvrir la confirmation paiement
- si pending detecte, le systeme montre une modal explicite de blocage
- message attendu: l'utilisateur doit attendre la validation/rejet de ses HTG en attente avant inscription championna
- le backend `/api/wallet/mutate` bloque aussi si `provisionalHtgAvailable > 0`

---

## Points techniques importants

## gameKey normalise

Le `gameKey` est derive du nom jeu via normalisation:
- minuscule
- caracteres non alphanumeriques remplaces par `_`
- underscores de bord supprimes

Exemples:
- `Domino` -> `domino`
- `Mopyon` -> `mopyon`
- `Echec` -> `echec`

## username affiche

Le username d'inscription prend la meilleure source disponible:
1. `latestHomeClientData.username`
2. `latestHomeClientData.displayName`
3. `auth.currentUser.displayName`
4. prefix email
5. fallback `Utilisateur`

## debits et validation backend

Le debit passe par `walletMutate`.
Si le backend n'autorise pas ce montant, l'inscription echoue avec message.

---

## Risques connus

1. Regle backend "mise autorisee"
- `walletMutate` verifie les stakes autorises
- si `200 HTG` / `4000 does` n'est pas autorise dans la config backend, le debit sera refuse

2. Securite de la collection inscriptions
- si les regles Firestore ne permettent pas ecriture/lecture client sur `tournamentRegistrations`, la liste ou l'inscription peuvent echouer

3. Cohabitation avec d'autres changements locaux
- le repo contient d'autres modifs non liees (ludo, api, etc.)
- attention a ne pas melanger les commits

4. Creation bracket cote frontend
- la creation du tirage est declenchee par le frontend au seuil 8 inscrits
- sans transaction backend dediee, il existe un faible risque de course si plusieurs clients declenchent en meme temps
- pour durcir en production, prevoir une route backend/cron pour verrouiller la creation unique du bracket

---

## Regles de travail pour la suite

1. Toujours documenter chaque changement Championna ici
2. Garder les montants et textes aligns entre UI et backend
3. Ne pas introduire un nouveau cout sans mise a jour de ce fichier
4. Tester mobile + desktop a chaque changement modal
5. Verifier impact cache (`?v=...`) apres modif `index.html`, `style.css`, `app.js`

---

## Journal de bord

## 2026-05-31 - Etape 1

- creation/refonte modal Championna avec cartes explicites
- creation modal d'inscription par jeu
- ajout bouton `S'inscrire` et `Reg championna a`

## 2026-05-31 - Etape 2

- correction affichage desktop des modals
- suppression du blocage CSS qui cachait `.games-modal` sur desktop

## 2026-05-31 - Etape 3

- ajout modal de confirmation cout a `200 HTG`
- debit wallet branche via `walletMutateSecure`
- enregistrement inscription Firestore
- ajout liste live des inscrits dans modal

## 2026-06-01 - Etape 4

- correction desktop modals Championna
- correction focus/aria-hidden sur transitions modal
- remplacement des alert navigateur par modal feedback professionnelle
- bouton anti doublon `N ap tann lot jwe yo` pour users deja inscrits

## 2026-06-01 - Etape 5

- ajout tirage aleatoire automatique a 8 inscrits
- generation bracket `4 matchs + 2 demi + 1 finale`
- ajout interface calendrier dans la modal:
  - matchs a venir
  - matchs termines avec score final
- ajout route backend `POST /api/wallet/mutate` dans `vercel-api`

## 2026-06-01 - Etape 6

- ajout regle produit: `HTG an atant` bloque inscription championna
- ajout modal explicite quand utilisateur tente malgre le blocage
- correction: le check pending se fait maintenant avant meme d'ouvrir la modal de paiement
- ajout garde backend sur `/api/wallet/mutate`

## 2026-06-01 - Etape 7

- remplacement du popup simple `Reg championna a` par une vraie modal professionnelle
- ajout contenu regles officiel Championna:
  - format: 8 joueurs, quart de finale, demi-finale, finale
  - format match: premier joueur a gagner 2 parties gagne le match
  - gains: 1er `1100 HTG`, 2e `500 HTG`
  - discipline: triche, mauvais comportement, abandon = sanctions/disqualification
  - technique: perte de connexion et retours tardifs peuvent causer perte de partie/match
- modal regles optimisee desktop/mobile avec panneau large et zone scrollable

## 2026-06-01 - Etape 8

- enrichissement des regles Championna avec consignes operationnelles:
  - tous les matchs sous supervision d'un coordinateur (role arbitre)
  - apres inscription, chaque partie est payee normalement sur le site officiel
  - prix d'une partie fixe a `25 HTG`
  - communication officielle via groupe WhatsApp Championna
  - chaque joueur recoit un code pour entrer dans la partie (site -> choix jeu -> code)
  - matchs avec spectateurs autorises (invitation amis/famille)

## 2026-06-01 - Etape 9

- ajout dashboard admin Championna dans `control-panel`
- ajout choix jeu pour manager un bracket Championna
- ajout entree score par match (`2-0`, `2-1`, `0-2`, `1-2`)
- quand un score est sauvegarde:
  - le match passe en `completed`
  - le gagnant est envoye vers la phase suivante
  - le score apparait sur le site public via `tournamentBrackets/{gameKey}`
- ajout routes backend admin:
  - `/api/dashboard/championna/snapshot`
  - `/api/dashboard/championna/update-match`
- creation du document de suivi dedie `CHAMPIONNA_DASHBOARD_CONTEXT.md`

## 2026-06-01 - Etape 10

- creation d'un parcours de pages blog pour nouveaux visiteurs Championna:
  - `championna-bienvenue.html`
  - `championna-comment-jouer.html`
  - `championna-regles-prix.html`
- ajout d'une section de navigation sur l'accueil `Nouveau sou Kobposh?`
- ajout feuille de style dediee `championna-blog.css`
- mise a jour `sitemap.xml` avec les 3 nouvelles pages pour SEO/indexation
- creation du fichier de contexte dedie `CHAMPIONNA_BLOG_CONTEXT.md`

## 2026-06-01 - Etape 11

- ajout modal de bienvenue pour premiere visite du site
- contenu en kreyol ayisyen oriente nouveaux visiteurs Championna
- bouton principal `Kontakte sou WhatsApp` redirige vers le coordonateur `50943160977`
- bouton `Pa montre mesaj sa anko` sauvegarde le choix en localStorage:
  - cle: `kobposh_welcome_championna_dismissed_v1`
- le modal PWA attend si le modal de bienvenue est ouvert afin d'eviter deux popups en meme temps
- cache-busting site mis a jour:
  - `app.js?v=20260601-welcome-championna1`
  - `style.css?v=20260601-welcome-championna1`
  - service worker `kobposh-shell-v16`

---

## Checklist rapide avant push

- [ ] modal Championna visible mobile
- [ ] modal Championna visible desktop
- [ ] modal inscription jeu visible mobile/desktop
- [ ] bouton `S'inscrire` ouvre confirmation `200 HTG`
- [ ] bouton confirmation debite correctement
- [ ] username apparait dans la liste des inscrits
- [ ] aucun changement non lie inclus dans le commit
