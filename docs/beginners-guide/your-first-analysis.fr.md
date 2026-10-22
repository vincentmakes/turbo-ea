# Votre première analyse : Harmonisation applicative

C'est la récompense. Vous disposez d'un inventaire applicatif, d'une carte des capacités et du champ intégré Modèle TIME. Maintenant, vous les reliez et produisez les deux rapports qui justifient tout le programme EA auprès d'un DSI :

- Le rapport **Portefeuille applicatif**, où chaque application est regroupée par **Criticité métier** et coloriée selon sa disposition **TIME** (**T**olérer / **I**nvestir / **M**igrer / **É**liminer).
- La **Carte des capacités**, une carte thermique qui montre où vous avez de la redondance (plusieurs applis par capacité) et de la fragilité (une seule appli par capacité).

## Étape 1 — Mapper les applications aux capacités

La relation la plus précieuse de tout le métamodèle est **Application → Capacité métier** (`prend en charge` / `est pris en charge par`). Vous la définirez pour chaque application du périmètre.

### Chemin en masse : mode édition de l'inventaire

1. Allez dans **Inventaire**, filtrez par Type = `Application`.
2. Assurez-vous que la colonne de relation **Capacité métier** est visible (onglet Colonnes → Relations).
3. Activez le mode **Grid Edit** dans la barre d'outils.
4. Cliquez sur la cellule de capacité de chaque ligne et choisissez une ou plusieurs capacités. Chaque modification est enregistrée dès que vous la faites.

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

## Étape 2 — Évaluer la criticité et l'adéquation

Trois champs intégrés de la section **Évaluation** de chaque fiche Application alimentent l'analyse. Remplissez-les avec l'Application Owner — lors d'un atelier d'une heure, vous pouvez typiquement évaluer 30 à 50 applications en utilisant l'**Édition grille** avec les trois colonnes visibles.

| Champ | Options | La question à laquelle il répond |
|-------|---------|----------------------------------|
| **Criticité métier** | Critique pour la mission / Critique pour l'entreprise / Opérationnel / Administratif | À quel point le métier dépend-il de cette appli ? |
| **Adéquation fonctionnelle** | Parfait / Approprié / Insuffisant / Inadéquat | Dans quelle mesure fait-elle ce dont le métier a besoin ? |
| **Adéquation technique** | Parfaitement adapté / Adéquat / Inadéquat / Inapproprié | Dans quel état est la technologie sous-jacente ? |

La Criticité métier regroupe le rapport de l'étape 4. Les deux évaluations d'adéquation sont ce que lit le calcul TIME de l'étape 3.

Modifier ces champs sur une fiche approuvée fait passer son statut d'approbation à **Rompu**. Ré-approuvez les fiches par lot après l'atelier.

## Étape 3 — Dériver TIME avec un champ calculé

Le champ intégré **Modèle TIME** sur Application (`timeModel`, quatre options : `tolerate` / `invest` / `migrate` / `eliminate`) est la colonne de décision qui pilote le reste de l'analyse. Plutôt que de demander à chaque Application Owner d'en choisir une, dérivez-la des deux évaluations d'adéquation avec un **calcul** — le placement classique de Gartner :

| | Adéquation technique haute | Adéquation technique basse |
|---|---|---|
| **Adéquation fonctionnelle haute** | **Investir** | **Migrer** |
| **Adéquation fonctionnelle basse** | **Tolérer** | **Éliminer** |

1. Allez dans **Admin → Métamodèle → Calculs** et cliquez sur **Nouveau calcul**.
2. Définissez **Type de fiche cible** = `Application` et **Champ cible** = **Modèle TIME**.
3. Collez la formule de [Personnalisez le métamodèle → Option : dériver un champ automatiquement avec un Calcul](customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation). Elle utilise les champs d'adéquation intégrés, aucun champ personnalisé n'est donc nécessaire.
4. Cliquez sur **Valider**, enregistrez, puis utilisez **Tester avec une fiche** sur quelques applications que vous connaissez bien pour vérifier le résultat.
5. Passez le calcul sur **Actif** dans la liste, puis cliquez sur **Tout recalculer** sur sa ligne pour remplir le Modèle TIME de chaque application.

Dès lors, le Modèle TIME est recalculé à chaque enregistrement d'une application, porte un badge **calculé** et ne peut plus être modifié à la main. Une application à laquelle il manque l'une des deux évaluations d'adéquation n'obtient pas de valeur TIME — c'est voulu : cela vous montre quelles évaluations manquent encore.

!!! warning "À éviter"
    Un TIME calculé est une **hypothèse de départ**, pas un verdict. Revoyez les résultats avec les Application Owners avant de les présenter. Lorsqu'une décision doit déroger à la formule, désactivez le calcul (l'interrupteur **Actif**) et modifiez le Modèle TIME à la main dans l'**Édition grille**.

Référence : [Admin → Calculs](../admin/calculations.md).

## Étape 4 — Lancer le rapport Portefeuille applicatif

1. Allez dans **Rapports → Portefeuille applicatif**.
2. Réglez **Regrouper par** = **Criticité métier**.
3. Réglez **Colorier les applications par** = **Modèle TIME**.
4. Cliquez sur l'icône de signet (**Enregistrer le rapport**) et nommez la vue (« Portefeuille applicatif — Domaine Ventes »). Vous la retrouverez sous **Rapports → Rapports enregistrés**.

Chaque niveau de Criticité métier devient un encadré, avec une puce par application coloriée selon sa disposition TIME et une barre montrant la répartition. Pour vous concentrer sur un domaine, utilisez le filtre **Lié par** avec les capacités de votre périmètre.

Ce qu'il faut regarder :

- **Applis « Critique pour la mission » et « Critique pour l'entreprise » marquées Migrer** — vos décisions de modernisation les plus lourdes de conséquences. Elles passent en premier.
- **Applis « Administratif » et « Opérationnel » marquées Éliminer ou Migrer** — vos gains de simplification les plus rapides : retirez-les ou consolidez-les sur une autre plateforme.
- **Applis « Critique pour la mission » marquées Investir** — vérifiez qu'elles obtiennent réellement l'investissement.
- **Applis sans couleur** (TIME *Non défini*) — l'une des deux évaluations d'adéquation manque. Revenez à l'étape 2.

Référence : [Rapports → Rapport Portefeuille](../guide/reports.md#rapport-portefeuille).

## Étape 5 — Lancer la Carte des capacités

1. Allez dans **Rapports → Carte des capacités**.
2. Laissez la **Métrique de la carte de chaleur** sur **Nombre d’applications** : l'intensité de couleur des cellules est proportionnelle au nombre d'applications soutenant cette capacité.
3. Facultatif : activez **Afficher les applications** et réglez **Colorier les applications par** = **Modèle TIME** pour voir la disposition TIME des applis au sein de chaque capacité.

Ce qu'il faut regarder :

- **Cellules chaudes** (beaucoup d'applis par capacité) — redondance candidate. Le cas métier le plus courant pour une Rationalisation du portefeuille applicatif réside ici.
- **Cellules froides** où vous attendriez des applications — lacunes dans votre mapping, ou capacités véritablement sous-soutenues.
- **Cellules blanches** au milieu d'une branche active — applications non mappées, ou capacités non modélisées.

Référence : [Rapports → Carte des capacités](../guide/reports.md#carte-de-capacites).

## Étape 6 — Présenter et itérer

Vous disposez maintenant d'une vue de portefeuille défendable. Placez les deux rapports devant le DSI Ventes (ou quiconque possède votre périmètre) et :

- Confirmez les décisions TIME sur les applications « Critique pour la mission » et « Critique pour l'entreprise ».
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
