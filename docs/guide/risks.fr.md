# Registre des risques

Le **Registre des risques** capture les risques d'architecture tout au long de leur cycle de vie — de l'identification à la mitigation, à l'évaluation résiduelle, à la surveillance et à la clôture (ou à l'acceptation formelle). Il vit comme un onglet dans **EA Delivery → Risques**, aux côtés des Initiatives, des Principes d'EA et des Décisions d'architecture.

## Alignement TOGAF

Le registre met en œuvre le processus de gestion des risques d'architecture de **TOGAF ADM Phase G — Implementation Governance** (TOGAF 10 §27) :

| Étape TOGAF | Ce que vous capturez |
|-------------|----------------------|
| Classification du risque | `Catégorie` (security, compliance, operational, technology, financial, reputational, strategic) |
| Identification du risque | `Titre`, `Description`, `Source` (manuelle ou promue depuis un constat TurboLens) |
| Évaluation initiale | `Probabilité initiale × Impact initial → Niveau initial` (dérivé automatiquement) |
| Mitigation | `Plan de mitigation`, `Propriétaire`, `Date cible de résolution` |
| Évaluation résiduelle | `Probabilité résiduelle × Impact résiduel → Niveau résiduel` (modifiable une fois la mitigation planifiée) |
| Surveillance / acceptation | Flux de `Statut` : identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed (avec une branche `accepted` qui exige une justification explicite) |

## Créer un risque

Trois chemins mènent à la même boîte de dialogue **Créer un risque** — chaque variante pré-remplit des champs différents afin que vous puissiez modifier puis valider :

1. **Manuel** — onglet Risques → **+ Nouveau risque**. Formulaire vierge.
2. **Depuis un constat CVE** — TurboLens → Sécurité et conformité → panneau CVE → **Créer un risque**. Pré-remplit le titre (ID CVE sur la fiche), la description (texte NVD + impact métier + CVSS), la catégorie `security`, la probabilité / l'impact depuis le CVE, la mitigation depuis la remédiation du constat, et lie la fiche affectée.
3. **Depuis un constat de conformité** — TurboLens → Sécurité et conformité → onglet Conformité → **Créer un risque** sur un constat non conforme. Pré-remplit la catégorie `compliance`, la probabilité / l'impact depuis la gravité + le statut de la réglementation, la description depuis l'exigence + l'écart.

Les trois variantes incluent les champs **Propriétaire**, **Catégorie** et **Date cible de résolution** pour attribuer la responsabilité dès la création — sans avoir à rouvrir le risque.

La promotion est **idempotente** — une fois qu'un constat a été promu, son bouton bascule en **Ouvrir le risque R-000123** et navigue directement vers la page de détail du risque.

## Propriétaire → Todo + notification

Attribuer un **propriétaire** (à la création ou ultérieurement) crée automatiquement :

- Un **Todo système** sur la page Todos du propriétaire. La description est `[Risk R-000123] <titre>`, l'échéance reflète la date cible de résolution du risque, et le lien renvoie au détail du risque. Le Todo est marqué **fait** automatiquement lorsque le risque atteint `mitigated` / `monitoring` / `accepted` / `closed`.
- Une **notification de cloche** (`risk_assigned`) — visible dans le menu déroulant de la cloche et sur la page des notifications, avec un e-mail optionnel si l'utilisateur a activé cette préférence. L'auto-attribution déclenche aussi la cloche, afin que la trace reste cohérente entre les workflows d'équipe et personnels.

Effacer ou réattribuer le propriétaire maintient le Todo synchronisé — l'ancien est supprimé / réassigné.

## Lier les risques aux fiches

Les risques sont **plusieurs-à-plusieurs** avec les fiches. Un risque peut affecter plusieurs Applications ou Composants informatiques, et une fiche peut avoir plusieurs risques associés :

- Depuis la page de détail du risque : panneau **Fiches affectées** → rechercher et ajouter. Cliquez sur un `×` pour délier.
- Depuis n'importe quelle page de détail de fiche : un nouvel onglet **Risques** liste chaque risque associé à cette fiche, avec un retour en un clic vers le registre.

## Matrice des risques

La Vue d'ensemble Sécurité de TurboLens comme la page du Registre des risques affichent une carte thermique probabilité × impact 4×4. Les cellules sont **cliquables** — cliquez sur une cellule pour filtrer la liste en dessous sur ce compartiment, cliquez à nouveau (ou sur le × du chip) pour effacer. Dans le Registre des risques, vous pouvez basculer la matrice entre les vues **Initiale** et **Résiduelle** pour visualiser les progrès de la mitigation.

## Flux de statut

La page de détail affiche toujours un unique bouton primaire **Étape suivante** et une petite rangée d'actions latérales, de sorte que le chemin séquentiel soit évident mais que les sorties de gouvernance restent à un clic :

| État actuel | Étape suivante (bouton primaire) | Actions latérales |
|---|---|---|
| identified | Démarrer l'analyse | Accepter le risque |
| analysed | Planifier la mitigation | Accepter le risque |
| mitigation_planned | Démarrer la mitigation | Accepter le risque |
| in_progress | Marquer comme atténué | Accepter le risque |
| mitigated | Démarrer la surveillance | Reprendre la mitigation · Clore sans surveillance |
| monitoring | Clore | Reprendre la mitigation · Accepter le risque |
| accepted | — | Rouvrir · Clore |
| closed | — | Rouvrir |

Graphe complet de transitions (forcé côté serveur) :

```
identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed
       │           │             │                │            ▲           ▲
       └───────────┴─────────────┴────────────────┴──── accepted (justification requise)
                                                              │
                              reopen → in_progress ◄──────────┘
```

- **Accepter** un risque exige une justification d'acceptation. L'utilisateur, l'horodatage et la justification sont consignés dans l'enregistrement.
- **Rouvrir** un risque `accepted` / `closed` renvoie à `in_progress`. L'état `mitigated` autorise aussi une « Reprendre la mitigation » manuelle sans nécessiter une réouverture complète.

## Permissions

| Permission | Qui la reçoit par défaut |
|------------|---------------------------|
| `risks.view` | admin, bpm_admin, member, viewer |
| `risks.manage` | admin, bpm_admin, member |

Les lecteurs (viewers) peuvent voir le registre et les risques sur les fiches mais ne peuvent pas créer, modifier ou supprimer.
