# Domino Duel V2 - correctif background modals du 2 juin 2026

## Probleme

Les modals `Atansyon sou tan tour ou` et `Kijan pou chwazi bon bout la` avaient un panneau avec effet trop transparent. Visuellement, le contenu se melangeait avec le jeu derriere et la lecture etait moins professionnelle.

## Correction appliquee

- Le panneau de `DuelTurnWarningOverlay` devient opaque avec `bg-[#19243A]`.
- Le panneau de `DuelBranchChoiceGuideOverlay` devient opaque avec `bg-[#19243A]`.
- Le panneau de `DuelBranchChoiceHelpOverlay` recoit le meme traitement pour rester coherent.
- Les panneaux gardent une bordure claire et une ombre forte.
- Cache-bust Duel passe a `20260602-duel-modal-bg1`.

## Regle UX a conserver

- Les modals d'explication avant ou pendant le duel doivent avoir un panneau lisible et opaque.
- Le fond de page peut rester assombri/floute, mais le panneau du modal ne doit pas ressembler a une vitre transparente.
