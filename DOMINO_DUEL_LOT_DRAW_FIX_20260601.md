# Domino Duel V2 - correctif pioche Lot du 1 juin 2026

## Probleme

Dans `Domino duel 2 joueurs`, quand un joueur n'avait aucun domino jouable et que le `lot` contenait encore des dominos, l'interface ne montrait pas assez clairement qu'il fallait piocher. Le timer continuait donc a descendre, ce qui pouvait faire perdre le joueur sans signal visuel utile.

## Diagnostic

- `jeu-duel-v2.html` contenait deja le bouton `Lot`, la modal `DuelLotModal`, le callout et le style `duel-lot-cta`.
- La V2 ne branchait pas encore toute la logique JavaScript de la pioche dans `logiquejeu-duel-v2.js`.
- La V1 avait un flux complet : bouton mis en avant, modal de lot, selection d'un domino cache, puis envoi d'une action `draw`.
- `Domino_Partida_Duel.js` affichait un message base sur `data-idioma-*`; sur la page V2 en `fr`, ce message pouvait ne pas aider l'utilisateur.

## Correction appliquee

- Ajout d'un pont `Lot` dans `logiquejeu-duel-v2.js` :
  - detection du tour local
  - detection `aucune possibilite + stock disponible`
  - bouton `Lot` qui pulse avec `duel-lot-cta`
  - callout visible pour guider le joueur
  - ouverture/fermeture de la modal
  - rendu des dominos caches du lot dans `DuelLotViewport`
  - clic sur un domino cache qui envoie `pushAction({ type: "draw", tileId })`
- Ajout de `window.KobposhDuelPromptLot` pour permettre au moteur `Domino_Partida_Duel.js` de declencher le guidage quand il detecte qu'il faut piocher.
- Message moteur remplace par un texte visible directement :
  - `Ou pa gen domino pou jwe. Klike sou Lot pou piocher.`
- Ajout du texte d'aide `DuelLotHint` dans la modal.
- Cache-bust Duel passe a `20260601-duel-lot-draw1`.

## Regle UX a conserver

- Si le joueur peut jouer, le lot peut rester visible mais ne doit pas forcer une pioche.
- Si le joueur ne peut pas jouer et que le lot existe, le site doit guider visuellement vers `Lot`.
- Le joueur doit pouvoir ouvrir la modal et cliquer un domino cache pour piocher.
- Le timer ne doit jamais etre le seul signal visible dans cette situation.
