# Domino Duel V2 - correctif visuel fin de partie du 1 juin 2026

## Probleme

Quand une partie `Domino duel 2 joueurs` se terminait, en `grand chanm` comme en `salon prive`, l'utilisateur voyait surtout le bouton `Voir la table`. Les vraies actions de suite, notamment `Rejouer`, existaient dans le HTML mais restaient cachees ou pas assez mises en avant.

## Correction appliquee

- `GameEndActionsWrap` n'est plus cache par defaut.
- `showEndedOverlay()` force maintenant l'affichage des actions de fin.
- En `grand chanm`, le bouton principal affiche `Rejouer nan gran chanm`.
- En `salon prive`, le bouton principal affiche `Mande revanj`.
- Le bouton `Retour accueil` reste visible pour sortir clairement.
- `Voir la table seulement` devient une option secondaire.
- Si l'utilisateur choisit de regarder la table, un bouton flottant reste visible en bas :
  - `Rejouer` en grand chanm
  - `Mande revanj` en salon prive
- Cache-bust Duel passe a `20260601-duel-end-replay1`.

## Regle UX a conserver

- A la fin d'une partie, l'utilisateur ne doit jamais etre laisse avec seulement `Voir la table`.
- La premiere action visible doit toujours permettre de rejouer ou demander une revanche.
- Regarder la table doit rester possible, mais ce ne doit pas etre l'action principale.
