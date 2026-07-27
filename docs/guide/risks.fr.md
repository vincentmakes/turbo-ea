# Registre des risques

Le **Registre des risques** capture les risques d'architecture tout au long de leur cycle de vie — de l'identification à la mitigation, à l'évaluation résiduelle, à la surveillance et à la clôture (ou à l'acceptation formelle). Il vit comme l'onglet **Risque** du [module GRC](grc.md) à `/grc?tab=risk`.

## Alignement TOGAF

Le registre met en œuvre le processus de gestion des risques d'architecture de **TOGAF ADM Phase G — Implementation Governance** (TOGAF 10 §27) :

| Étape TOGAF | Ce que vous capturez |
|-------------|----------------------|
| Classification du risque | `Catégorie` (security, compliance, operational, technology, financial, reputational, strategic) |
| Identification du risque | `Titre`, `Description`, `Source` (manuelle ou promue depuis un constat TurboLens) |
| Évaluation initiale | `Probabilité initiale × Impact initial → Niveau initial` (dérivé automatiquement) |
| Mitigation | Une ou plusieurs **tâches de mitigation** — éléments de travail attribués, à un coup ou récurrents (voir [Tâches de mitigation](#mitigation-tasks) ci-dessous). Le risque porte aussi un `Propriétaire` et une `Date cible de résolution`. |
| Évaluation résiduelle | `Probabilité résiduelle × Impact résiduel → Niveau résiduel` (modifiable une fois la mitigation planifiée). Reste une évaluation **manuelle** — l'achèvement d'une tâche ne la modifie pas automatiquement. La page de détail affiche à côté du bloc résiduel un résumé «X/Y ouvertes · Z en retard» comme contexte pour le jugement humain (aligné sur ISO 31000). |
| Surveillance / acceptation | Flux de `Statut` : identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed (avec une branche `accepted` qui exige une justification explicite) |

## Créer un risque

Trois chemins mènent à la même boîte de dialogue **Créer un risque** — chaque variante pré-remplit des champs différents afin que vous puissiez modifier puis valider :

Les trois variantes incluent les champs **Propriétaire**, **Catégorie** et **Date cible de résolution** pour attribuer la responsabilité dès la création — sans avoir à rouvrir le risque.

La promotion est **idempotente** — une fois qu'un constat a été promu, son bouton bascule en **Ouvrir le risque R-000123** et navigue directement vers la page de détail du risque.

## Propriétaire → Todo + notification

Attribuer un **propriétaire** (à la création ou ultérieurement) crée automatiquement :

- Un **Todo système** sur la page Todos du propriétaire. La description est `[Risk R-000123] <titre>`, l'échéance reflète la date cible de résolution du risque, et le lien renvoie au détail du risque. Le Todo est marqué **fait** automatiquement lorsque le risque atteint `mitigated` / `monitoring` / `accepted` / `closed`.
- Une **notification de cloche** (`risk_assigned`) — visible dans le menu déroulant de la cloche et sur la page des notifications, avec un e-mail optionnel si l'utilisateur a activé cette préférence. L'auto-attribution déclenche aussi la cloche, afin que la trace reste cohérente entre les workflows d'équipe et personnels.

Effacer ou réattribuer le propriétaire maintient le Todo synchronisé — l'ancien est supprimé / réassigné.

La même mécanique se déclenche indépendamment pour **chaque tâche de mitigation** du risque, afin qu'un contributeur ne voie que le travail dont il est responsable — voir [Tâches de mitigation](#mitigation-tasks) ci-dessous.

## Lier les risques aux fiches

Les risques sont **plusieurs-à-plusieurs** avec les fiches. Un risque peut affecter plusieurs Applications ou Composants informatiques, et une fiche peut avoir plusieurs risques associés :

- Depuis la page de détail du risque : panneau **Fiches concernées** → choisissez une fiche et ajoutez-la. Cliquez sur un `×` pour délier. Le sélecteur affiche d'emblée une liste parcourable (inutile de taper), charge d'autres fiches au défilement et masque celles qui sont déjà liées.
- Depuis n'importe quelle page de détail de fiche : un nouvel onglet **Risques** liste chaque risque associé à cette fiche, avec un retour en un clic vers le registre.

Les fiches liées sont **regroupées par type de fiche**, triées alphabétiquement dans chaque groupe et colorées avec la couleur propre au type. Un risque touchant une douzaine de fiches de plusieurs types reste ainsi lisible d'un coup d'œil. Le même ordre et les mêmes couleurs s'appliquent à la colonne **Fiches** de la grille du registre, où chaque fiche apparaît comme une puce dans la couleur de son type — l'infobulle de la cellule liste l'ensemble sous des en-têtes de type.

## Tâches de mitigation {: #mitigation-tasks }

La mitigation est capturée sous forme d'**éléments de travail attribués**, et non en texte libre. Sur la page de détail du risque, le panneau **Tâches de mitigation** remplace l'ancien champ unique « plan de mitigation » — chaque ligne est une vraie tâche avec son propre propriétaire, sa date d'échéance, son historique et (en option) sa règle de récurrence.

### À un coup vs. récurrente

Une tâche de mitigation est **à un coup** par défaut — adaptée à « Déployer la MFA », « Signer les SCC mises à jour », ou tout travail à dimension projet. Activez **Se répète** dans la boîte de dialogue de la tâche et vous obtenez une **revue de contrôle récurrente** : par ex. « Ré-attester la documentation de transfert transfrontalier tous les 12 mois », « Mener l'exercice tabletop d'incident OT tous les 3 mois », « Auditer les identifiants Jenkins chaque semaine ».

Les tâches récurrentes accumulent un **cycle** (`occurrence`) par période. Le cycle suivant est créé automatiquement à la clôture du précédent — avec arithmétique calendaire correcte : une tâche mensuelle due le 31 janvier passe au 28 février, pas au 3 mars.

### La fenêtre de préavis

L'intérêt d'une revue de contrôle récurrente est que la personne responsable soit rappelée **juste avant l'échéance**, pas au moment où le cycle précédent s'est clos. Chaque tâche récurrente porte donc un **délai de préavis** (jours) — combien de jours avant `due_date` le cycle devient actif et atterrit sur la liste `/todos` du responsable.

Chaque cycle traverse trois états visibles :

| Statut | Signification | Visible sur /todos ? |
|--------|---------------|----------------------|
| **Planifiée** | Le cycle suivant existe pour l'audit (« prochaine revue : échéance 15/11/2026 ») mais est inactif. La date du jour est encore hors de la fenêtre de préavis. | Non |
| **Ouverte** | La fenêtre de préavis s'est ouverte. Un Todo système `[Risk R-000123] <titre de tâche>` apparaît sur la liste du responsable ; une notification `task_assigned` est déclenchée. | Oui (onglet Ouvertes) |
| **Terminée** / **Passée** | Le responsable a clos le cycle. Le Todo passe à `done` et reste dans l'onglet **Terminées** du responsable comme trace historique. | Oui (onglet Terminées) |

La boîte de dialogue suggère un délai de préavis sensé par unité de récurrence (1 jour pour quotidien, 2 pour hebdomadaire, 7 pour mensuel, 14 pour annuel — plafonné à la moitié du cycle pour que la fenêtre ne chevauche jamais le cycle précédent). La suggestion s'ajuste à mesure que vous changez l'unité ou l'intervalle, tant que vous ne modifiez pas le champ vous-même.

Une fois par jour à **03:00 UTC**, un processus de fond scrute tous les cycles planifiés et promeut ceux dont la fenêtre de préavis s'est ouverte. Besoin de démarrer une revue plus tôt ? Cliquez sur **Activer maintenant** (icône éclair sur la ligne de la tâche) pour basculer un cycle planifié à ouvert immédiatement — même machinerie de Todo et de notification, sans attendre.

### Historique d'audit par cycle

Cliquez sur le chevron d'expansion d'une ligne de tâche pour voir l'historique complet des cycles. Chaque occurrence enregistre :

- La **date d'échéance cible** au moment de la planification.
- Qui était **assigné** au moment de l'ouverture du cycle (`assigned_owner_id`), afin que les revues historiques conservent leur propriétaire d'origine même en cas de rotation du rôle.
- Pour les cycles clos : qui l'a **terminé** (`completed_by`), l'horodatage, l'**instantané propriétaire-à-la-clôture** (peut différer de l'assigné si une rotation a eu lieu en cours de cycle) et toute note libre de clôture.
- Pour les cycles activés : l'**horodatage d'activation** (afin que l'audit puisse vérifier que la promotion quotidienne a bien eu lieu le bon jour).

Cela survit proprement à des années de rotation de propriétaires — la réponse d'audit à « Qui a signé la revue de janvier 2024 ? » est à un clic de la tâche, et ne se perd pas dans les rééquilibrages de responsabilité.

### Permissions et personnes assignées

- **Ajouter / modifier / supprimer des tâches** — nécessite `risks.manage` (admin / bpm_admin / member par défaut).
- **Clôturer le cycle ouvert** — `risks.manage` **ou** l'utilisateur actuellement assigné à ce cycle. Ainsi un Viewer assigné à une revue de contrôle peut clore son propre cycle sans escalade.
- **Passer un cycle / Activer maintenant** — nécessitent toujours `risks.manage`. Passer fait avancer la récurrence sans prétendre que le travail a été fait ; activer tire un cycle planifié en avant et est une action de planification.

### Promotion depuis un constat de conformité TurboLens

Quand vous cliquez sur **Créer un risque** sur un constat non conforme (voir [TurboLens](turbolens.md#promote-a-finding-to-the-risk-register)), le nouveau risque reçoit aussi une **tâche de mitigation à un coup** initialisée depuis le texte de remédiation du constat — l'analyse d'écart devient ainsi immédiatement un travail attribué et exploitable.

### Export {: #export }

Le bouton **Exporter** du Registre des risques écrit un `.xlsx` à deux feuilles : la feuille 1 est la grille de risques filtrée, la feuille 2 est une ligne par cycle pour chaque tâche de chaque risque dans le même filtre, incluant le délai de préavis et l'horodatage d'activation. Utilisez-le pour les dossiers d'audit ou pour les parties prenantes sans compte Turbo EA. Chaque ligne de tâche dans le panneau de détail dispose aussi de son propre bouton **Exporter l'historique** pour un classeur par tâche.

### Importation {: #import }

Le bouton **Importer** à côté d'« Exporter » charge des risques en masse depuis un fichier `.xlsx`. Cliquez sur **Télécharger le modèle** pour obtenir un classeur de départ avec les bons en-têtes, renseignez un risque par ligne, puis téléchargez-le. Une ligne dont la `reference` correspond à un risque existant est **ignorée** (l'importateur ne met jamais à jour de risques existants), de sorte que la réimportation d'un registre précédemment exporté est idempotente ; chaque autre ligne crée un risque **entièrement nouveau** avec une référence `R-NNNNNN` générée automatiquement. L'aperçu indique combien de lignes seront ignorées avant que vous ne confirmiez.

Colonnes reconnues : `title` (obligatoire), `description`, `category`, `initial_probability`, `initial_impact`, `residual_probability`, `residual_impact`, `status`, `owner_email`, `target_resolution_date` (`YYYY-MM-DD`) et `cards` (noms de fiches séparés par des points-virgules). Les responsables sont identifiés par e-mail et les fiches par nom exact, **au mieux** — tout ce qui ne peut pas être identifié est ignoré avec un avertissement non bloquant et le risque est tout de même importé. Avant toute écriture, un aperçu indique combien de lignes seront créées, lesquelles comportent des erreurs et les éventuels avertissements ; rien n'est enregistré tant que vous n'avez pas confirmé. Nécessite l'autorisation `risks.manage`.

## Matrice des risques

La Vue d'ensemble Sécurité de TurboLens comme la page du Registre des risques affichent une carte thermique probabilité × impact 4×4. Les cellules sont **cliquables** — cliquez sur une cellule pour filtrer la liste en dessous sur ce compartiment, cliquez à nouveau (ou sur le × du chip) pour effacer. Dans le Registre des risques, vous pouvez basculer la matrice entre les vues **Initiale** et **Résiduelle** pour visualiser les progrès de la mitigation.

## Grille du registre

Le registre est une grille AG Grid qui reprend les standards de la page [Inventaire](inventory.md) : colonnes triables, filtrables et redimensionnables avec préférences utilisateur persistées (colonnes visibles, ordre de tri, état de la barre latérale). Un bouton **+ Nouveau risque** dans la barre d'outils ouvre le dialogue de création manuelle. Le bouton **Exporter** de la barre d'outils écrit un `.xlsx` à deux feuilles avec la grille de risques filtrée sur la feuille 1 et une ligne par cycle de tâche de mitigation sur la feuille 2 — voir [Tâches de mitigation → Export](#export) pour le format des colonnes.

### Filtrer par fiches concernées

La barre latérale de filtres à gauche comporte une section **Fiches concernées** qui répond aux questions de paysage que le filtre de colonne ne peut pas traiter :

- **Fiches** — choisissez une ou plusieurs fiches précises pour voir tous les risques affectant *l'une quelconque* d'entre elles («afficher tous les risques affectant les applications A, B et C»). La liste propose chaque fiche liée à au moins un risque, filtrable par nom.
- **Type de fiche** — cochez un ou plusieurs types pour voir tous les risques touchant *une quelconque* fiche de ces types («afficher tous les risques affectant une application»), sans nommer de fiche individuelle.

Chaque liste retient **l'une quelconque** de ses propres sélections ; les deux listes se combinent avec **et**. Cocher `Application` et choisir la fiche *Payments Gateway* renvoie donc les risques qui affectent Payments Gateway **et** touchent au moins une application.

Comme tous les autres filtres de la barre latérale, ils restreignent la page entière — les tuiles d'indicateurs, la matrice 4×4, la grille et les deux feuilles de l'export `.xlsx` suivent la sélection active.

## Propagation Risque ↔ Constat

Si un risque a été [promu depuis un constat TurboLens](turbolens.md#promote-a-finding-to-the-risk-register), les changements de statut se propagent **dans les deux sens** :

- Le constat porte un rétro-lien **Ouvrir le risque R-000123** dès la promotion (l'action est idempotente — cliquer à nouveau navigue vers le risque existant au lieu de créer un doublon).
- Quand le risque atteint `mitigated` / `monitoring` / `closed` / `accepted` (ou est supprimé), le moteur de rétro-propagation transitionne automatiquement chaque constat de conformité lié à la valeur correspondante (`mitigated` / `verified` / `accepted` / `in_review`). La justification d'acceptation capturée sur le risque est répercutée dans la note de revue du constat afin que la piste d'audit reste cohérente.

Cela maintient le Registre des risques (vue gouvernance) et la grille Conformité (vue opérationnelle) alignés sans entretien manuel.

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
