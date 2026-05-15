# Votre première analyse : Harmonisation applicative

C'est la récompense. Vous disposez d'un inventaire applicatif, d'une carte des capacités et d'un champ de disposition TIME. Maintenant, vous les reliez et produisez les deux rapports qui justifient tout le programme EA auprès d'un DSI :

- Un **Rapport de portefeuille** qui montre chaque application dimensionnée par coût et colorée par disposition TIME.
- Une **Carte thermique des capacités** qui montre où vous avez de la redondance (plusieurs applis par capacité) et de la fragilité (une seule appli par capacité).

## Étape 1 — Mapper les applications aux capacités

La relation la plus précieuse de tout le métamodèle est **Application → Capacité métier** (`supports` / `supported by`). Vous la définirez pour chaque application du périmètre.

### Chemin en masse : mode édition de l'inventaire

1. Allez dans **Inventaire**, filtrez par Type = `Application`.
2. Assurez-vous que la colonne de relation **Capacité métier** est visible (onglet Colonnes → Relations).
3. Activez le mode **Grid Edit** dans la barre d'outils.
4. Cliquez sur la cellule de capacité de chaque ligne et choisissez une ou plusieurs capacités.
5. Enregistrez.

Pour 50 à 200 applis, cela prend un après-midi et un café.

### Chemin fiche par fiche

Pour les mappings à fort jugement (ou lorsqu'un atelier avec l'Application Owner est impliqué), ouvrez chaque fiche Application et utilisez la section **Relations**. Vous obtenez le sélecteur complet avec recherche, aperçu de hiérarchie et possibilité de définir des attributs de relation.

### Combien de capacités par application ?

| Nombre de mappings | Ce que cela signifie |
|--------------------|----------------------|
| **0** | Non mappée — votre inventaire est incomplet. Filtrez ces fiches et corrigez. |
| **1** | Le cas propre et idéal — cette appli soutient exactement une capacité. |
| **2–3** | Acceptable — beaucoup d'applis s'étendent sur quelques capacités liées. |
| **4+** | Suspect — vous confondez peut-être « utilise des données de » avec « soutient ». Revérifiez. |

!!! tip "Bonne pratique"
    Le premier passage de mapping est rapide et grossier. Le second passage — effectué avec l'Application Owner en revue — est ce qui rend la donnée fiable. Prévoyez les deux.

## Étape 2 — Choisir comment remplir le TIME Model

Le champ **TIME Model** intégré sur Application (`timeModel`, requis, quatre options : `tolerate` / `invest` / `migrate` / `eliminate`) est la colonne de décision qui pilote le reste de l'analyse. Vous avez deux manières de le remplir.

### Option A — Saisie manuelle de TIME (recommandée pour le premier passage)

Avec l'Application Owner lors d'un atelier d'une heure, vous pouvez typiquement classer 30 à 50 applications :

- **Tolérer** — fonctionne, faible coût, pas un différenciateur stratégique. Laisser tel quel.
- **Investir** — stratégique, zone de croissance, financer les améliorations.
- **Migrer** — remplacer ou déplacer vers une nouvelle plateforme dans l'horizon de planification.
- **Éliminer** — doublon, en fin de vie, décommissionner.

Utilisez le mode **Grid Edit** de l'inventaire avec la colonne **TIME Model** visible pour capturer les décisions à grande vitesse.

### Option B — TIME calculé via une formule

Si vous voulez une recommandation de départ que les propriétaires valident ensuite, la fonctionnalité [Calculations](../admin/calculations.md) peut dériver une valeur TIME par défaut à partir des deux dimensions de suitability intégrées — `functionalSuitability` (fait-elle ce dont le métier a besoin ?) et `technicalSuitability` (la technologie sous-jacente est-elle saine ?). C'est le quadrant TIME canonique de Gartner.

Configurez le calcul sous **Admin → Métamodèle → Calculations** avec **Type cible = `Application`**, **Champ cible = `timeModel`**, et la formule :

```
IF(functionalSuitability in ["perfect", "appropriate"],
   IF(technicalSuitability in ["fullyAppropriate", "adequate"], "invest", "migrate"),
   IF(technicalSuitability in ["fullyAppropriate", "adequate"], "tolerate", "eliminate"))
```

Ce qu'elle fait — le placement en quatre quadrants :

| Aptitude fonctionnelle | Aptitude technique | → TIME |
|------------------------|--------------------|--------|
| Élevée | Élevée | **Invest** — stratégique, sain — financer la croissance |
| Élevée | Faible | **Migrate** — le métier en a besoin mais la tech se dégrade — remplacer |
| Faible | Élevée | **Tolerate** — fonctionne mais la valeur métier s'estompe — laisser tel quel |
| Faible | Faible | **Eliminate** — ni nécessaire ni sain — décommissionner |

La formule s'exécute automatiquement à chaque enregistrement de fiche, et Turbo EA marque `timeModel` en lecture seule avec un badge « calculé » pour que les utilisateurs ne puissent pas accidentellement dériver de la règle. Le même exemple est documenté (et copiable-collable) dans [Admin → Calculations](../admin/calculations.md#exemples-de-formules).

!!! warning "À éviter"
    Un TIME calculé est une **hypothèse de départ**, pas un verdict. Soit vous revoyez chaque résultat avec le propriétaire avant de lui faire confiance, soit vous désactivez la calculation et vous reposez sur la saisie manuelle une fois l'atelier terminé.

Le motif hybride : laissez la calculation active pendant que vous construisez l'inventaire et que vous disposez surtout des données de suitability ; désactivez-la pour l'atelier de validation ; puis laissez-la désactivée pour que les décisions manuelles tiennent.

## Étape 3 — Lancer le Rapport de portefeuille

1. Allez dans **Rapports → Portefeuille**.
2. Configurez les axes :
    - **Type de fiche** : `Application`
    - **Axe X** : `technicalSuitability` (le champ intégré d'aptitude technique).
    - **Axe Y** : `functionalSuitability` ou `businessValue` (champs intégrés d'aptitude métier).
    - **Taille** : `costTotalAnnual` — plus la dépense est élevée, plus la bulle est grande.
    - **Couleur** : `timeModel` — c'est ce qui rend le rapport prêt à décision.
3. Enregistrez la configuration comme une vue nommée (« Application Portfolio — Sales Domain ») pour pouvoir y revenir.

Ce qu'il faut regarder :

- **Grosses bulles rouges** (candidates Éliminer à coût élevé) — vos économies les plus rapides.
- **Grosses bulles ambre** (candidates Migrer à coût élevé) — vos décisions de transformation les plus lourdes de conséquences.
- **Grappes en haut à droite de la matrice** qui ne sont pas vertes — applis stratégiques qui n'obtiennent pas l'investissement.

Référence : [Rapports](../guide/reports.md).

## Étape 4 — Lancer la Carte thermique des capacités

1. Allez dans **Rapports → Carte des capacités**.
2. La carte thermique montre votre hiérarchie de capacités métier avec une intensité de couleur de cellule proportionnelle au **nombre d'applications soutenant cette capacité**.

Ce qu'il faut regarder :

- **Cellules chaudes** (beaucoup d'applis par capacité) — redondance candidate. Le cas métier le plus courant pour une Rationalisation du portefeuille applicatif réside ici.
- **Cellules froides** où vous attendriez des applications — lacunes dans votre mapping, ou capacités véritablement sous-soutenues.
- **Cellules blanches** au milieu d'une branche active — applications non mappées, ou capacités non modélisées.

Référence : [Rapports → Carte des capacités](../guide/reports.md).

## Étape 5 — Présenter et itérer

Vous disposez maintenant d'une vue de portefeuille défendable. Placez les deux rapports devant le DSI Ventes (ou quiconque possède votre périmètre) et :

- Confirmez les décisions TIME sur les 10 applications au coût le plus élevé.
- Identifiez les 3 cellules chaudes principales de la carte thermique comme projets candidats de rationalisation.
- Capturez les suites à donner sous forme de commentaires ou de todos sur les applications elles-mêmes — Turbo EA les suit par fiche.

C'est tout. Vous avez une pratique EA opérationnelle sur Turbo EA.

## Et ensuite

Une fois votre portefeuille applicatif vivant et de confiance, ceux-ci deviennent des étapes suivantes à forte valeur. Aucun n'est utile avant d'avoir un inventaire peuplé — c'est pourquoi ce guide les a délibérément reportés.

| Module | Quand l'ouvrir | Où le trouver |
|--------|----------------|---------------|
| **Registre des risques** | Quand vous êtes prêt à suivre les risques d'architecture sur les applications et capacités (TOGAF Phase G). | [Registre des risques](../guide/risks.md) |
| **GRC / Conformité** | Quand vous devez cartographier applications et capacités face aux réglementations (RGPD, NIS2, EU AI Act, DORA, SOC 2, ISO 27001). | [GRC](../guide/grc.md) |
| **PPM** | Quand les décisions de rationalisation deviennent des projets avec budgets, plannings et rapports d'avancement. | [PPM](../guide/ppm.md) |
| **TurboLens AI** | Quand vous avez assez de fiches pour que l'IA trouve les doublons de fournisseurs, les candidats à la modernisation et les recommandations d'architecture. | [TurboLens](../guide/turbolens.md) |
| **BPM** | Quand vous êtes prêt à modéliser les processus qui reposent sur vos applications. | [BPM](../guide/bpm.md) |
| **Diagrammes** | Quand vous avez besoin de diagrammes d'architecture libres qui restent synchronisés avec l'inventaire. | [Diagrammes](../guide/diagrams.md) |
| **EA Delivery** | Quand vous commencez à produire des Statements of Architecture Work et des Architecture Decision Records de style TOGAF. | [EA Delivery](../guide/delivery.md) |

Bienvenue dans Turbo EA.
