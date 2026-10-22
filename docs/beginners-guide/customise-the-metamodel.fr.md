# Personnalisez le métamodèle — légèrement

Le métamodèle de Turbo EA est entièrement **configurable par l'administrateur** — chaque type de fiche, champ, sous-type, relation et rôle de partie prenante est une donnée, pas du code. Vous serez tenté de le repenser. **Ne le faites pas.**

Les équipes qui réussissent ne personnalisent le métamodèle **que lorsque les champs par défaut ne peuvent pas répondre à leur question**. Les équipes qui échouent passent leur premier mois à renommer `Application` en `Solution`, à ajouter 30 champs personnalisés, et n'arrivent jamais à un rapport opérationnel.

## Ce qui est déjà dans le métamodèle

Avant d'ajouter quoi que ce soit, sachez ce que vous avez déjà. Le type de fiche **Application** intégré est livré avec ces champs prêts à l'emploi (entre autres) :

| Champ intégré | Type | À quoi il sert |
|---------------|------|----------------|
| `businessCriticality` | `single_select` (requis) | Critique pour la mission / Critique pour l'entreprise / Opérationnel / Administratif |
| `functionalSuitability` | `single_select` | Parfait / Approprié / Insuffisant / Inadéquat |
| `technicalSuitability` | `single_select` | Parfaitement adapté / Adéquat / Inadéquat / Inapproprié |
| `timeModel` | `single_select` (requis) | **Tolérer / Investir / Migrer / Éliminer** — la disposition TIME canonique de Gartner |
| `costTotalAnnual` | `cost` | Coût annuel total |
| `lifecycle.*` | dates | Plan / Phase In / Active / Phase Out / End of Life |

Tout ce dont une Rationalisation du portefeuille applicatif a besoin est déjà là, y compris le **Modèle TIME**. Vous n'avez pas besoin d'ajouter un champ TIME — vous le dérivez avec un calcul (voir ci-dessous) ou vous le remplissez à la main, voir [Votre première analyse](your-first-analysis.md). Il en va de même pour `functionalSuitability` et `technicalSuitability`, les deux dimensions d'adéquation qui pilotent classiquement un placement TIME, ainsi que pour `businessCriticality`, qui sert à regrouper le rapport Portefeuille applicatif.

## Le test des deux questions avant d'ajouter un champ

Lorsque vous vous retrouvez à avoir besoin d'un champ qui n'est véritablement pas dans le métamodèle, posez-vous :

1. **Vais-je filtrer, regrouper ou produire des rapports sur ce champ ?** Si non, sa place est dans la description ou dans un tag — pas dans un champ.
2. **La même réponse est-elle nécessaire sur chaque fiche de ce type ?** Si non, c'est une relation ou une pièce jointe, pas un champ.

Si vous ne pouvez pas répondre « oui » aux deux, n'ajoutez pas le champ.

## Si vous avez vraiment besoin d'un champ personnalisé

Pour le cas rare où un champ véritablement nouveau est nécessaire (par exemple, un drapeau `cloudReadiness`, une classification réglementaire, un marqueur de segment client), le flux de travail est :

1. Allez dans **Admin → Métamodèle** et cliquez sur le type. La mise en page de la fiche se trouve dans l'onglet **Général**.
2. Choisissez la section (ou créez-en une avec **Ajouter une section**) et cliquez sur **+ Champ**.
3. Renseignez :
    - **Clé** en lower camel-case (par exemple, `cloudReadiness`) — devient la clé d'attribut en JSON et dans les formules.
    - **Libellé** (et une traduction pour chaque locale prise en charge — sinon les utilisateurs non anglophones verront la clé brute).
    - **Type** — `text`, `multiline_text`, `number`, `cost`, `percentage`, `boolean`, `date`, `url`, `single_select`, `multiple_select`.
    - **Obligatoire** — laisser **désactivé** pour le premier déploiement ; tant qu'un champ obligatoire est vide, le score de Qualité des données de la fiche reste bloqué à 0.
4. Pour les types select, ajoutez les options (clé + libellé + couleur) et traduisez chaque option.
5. Enregistrez.
6. Facultatif : définissez le poids du champ dans la Qualité des données depuis l'onglet **Qualité des données** du type.

Le champ est immédiatement disponible dans l'**Inventaire** (Colonnes, filtres), sur le Détail de la fiche, et dans les formules de **Calculations** sous la forme `<fieldKey>`. Référence complète : [Admin → Métamodèle](../admin/metamodel.md).

## Option : dériver un champ automatiquement avec un Calcul { #option-derive-a-field-automatically-with-a-calculation }

En complément de l'option standard consistant à faire remplir un champ manuellement par les utilisateurs, Turbo EA peut **calculer automatiquement la valeur d'un champ** à partir d'autres champs de la même fiche — y compris les champs intégrés — grâce à la fonctionnalité **Calculations**. Le champ calculé devient en lecture seule et porte un badge « calculé » afin que les utilisateurs ne puissent pas s'écarter de la règle.

L'exemple canonique est le calcul du **Modèle TIME**, qui dérive le champ intégré `timeModel` sur Application à partir des deux évaluations d'adéquation intégrées. Créez-le dans **Admin → Métamodèle → Calculs** avec **Nouveau calcul** : Type de fiche cible = `Application`, Champ cible = **Modèle TIME**, et cette formule :

```
# TIME Model from the built-in Functional and Technical Suitability (Gartner quadrants)
ff = MAP_SCORE(data.functionalSuitability, {"perfect": 4, "appropriate": 3, "insufficient": 2, "unreasonable": 1})
tf = MAP_SCORE(data.technicalSuitability, {"fullyAppropriate": 4, "adequate": 3, "unreasonable": 2, "inappropriate": 1})
IF(ff is None or tf is None, None, IF(ff >= 2.5, IF(tf >= 2.5, "invest", "migrate"), IF(tf >= 2.5, "tolerate", "eliminate")))
```

Chaque évaluation est convertie en un score de 4 (meilleur) à 1 (pire), et les deux scores placent l'application dans l'un des quatre quadrants : adéquation fonctionnelle haute + technique haute = **Investir**, fonctionnelle haute + technique basse = **Migrer**, fonctionnelle basse + technique haute = **Tolérer**, basse sur les deux = **Éliminer**. Une application à laquelle il manque l'une des deux évaluations n'obtient pas de valeur TIME, de sorte que les lacunes restent visibles.

C'est le même exemple TIME que celui du panneau **Référence des formules** de l'éditeur de calcul ; vous pouvez donc aussi le copier depuis ce panneau. Il ne lit que des champs dont Application dispose déjà : **vous n'avez donc besoin d'ajouter aucun champ** — et vous ne devriez pas le faire (voir *Ne dupliquez pas les champs intégrés* ci-dessous). Pour plus de syntaxe de formule : [Admin → Calculs](../admin/calculations.md).

Après l'enregistrement, passez le calcul sur **Actif** et cliquez sur **Tout recalculer** sur sa ligne pour que chaque application existante reçoive sa valeur. La procédure pas à pas se trouve dans [Votre première analyse → Étape 3](your-first-analysis.md).

!!! warning "Don't"
    Un TIME calculé est une **hypothèse de départ**, pas un verdict. Revoyez chaque résultat avec l'Application Owner avant de lui faire confiance.

Le motif hybride qui fonctionne bien en pratique : laissez le calcul actif pendant que vous construisez l'inventaire et recueillez les évaluations d'adéquation ; revoyez les résultats lors de l'atelier de validation ; et si des décisions doivent s'écarter de la formule, désactivez le calcul (l'interrupteur **Actif**) afin que le champ redevienne modifiable et que les décisions manuelles tiennent.

## Alternative : utiliser un Groupe de tags à la place

Si la valeur est informative plutôt qu'interrogeable, un **Groupe de tags** (Admin → Métamodèle → Étiquettes) est plus léger qu'un champ personnalisé — aucun changement de métamodèle, aucune migration, plus facile à faire évoluer. Utilisez un Groupe de tags quand :

- La valeur est descriptive (« Customer-facing », « Internal-only », « Acquired in 2024 »).
- Vous pouvez ajouter de nouvelles options fréquemment.
- Vous n'en avez pas besoin dans un menu déroulant de filtre, mais une puce de tag en recherche-à-la-frappe convient.

Utilisez un champ personnalisé quand :

- Vous voulez regrouper ou colorier un rapport selon cette valeur (par exemple le Portefeuille applicatif).
- Vous voulez qu'elle soit pondérée dans la Qualité de données.
- C'est un vocabulaire contrôlé qui ne changera pas souvent.

## Anti-patterns à éviter

Voici les erreurs de métamodèle les plus courantes dans les premiers déploiements :

!!! warning "Ne renommez pas les types de fiches intégrés"
    Renommer `Application` en `Solution` paraît net mais casse la correspondance conceptuelle que la Carte des capacités, le rapport Portefeuille applicatif et les catalogues présupposent tous. Si votre organisation les appelle « Solutions », réglez la **traduction du libellé** — la `key` sous-jacente reste `Application`.

!!! warning "N'ajoutez pas 30 champs personnalisés dès le premier jour"
    Chaque champ personnalisé ajoute de la friction à la collecte de données et dilue le score de Qualité de données. Ajoutez un champ, utilisez-le pendant un mois, puis ajoutez le suivant.

!!! warning "Ne dupliquez pas les champs intégrés"
    Avant d'ajouter `timeDisposition`, `funcFit`, `techFit` ou `appCriticality`, vérifiez la liste des champs existants — il y a de fortes chances qu'un champ intégré équivalent existe déjà (`timeModel`, `functionalSuitability`, `technicalSuitability`, `businessCriticality`). Les doublons fractionnent vos données et cassent les rapports.

!!! warning "Ne rendez pas les nouveaux champs `required` dès le premier jour"
    Tant qu'un champ obligatoire est vide, le score de Qualité des données de la fiche reste bloqué à 0 et un bandeau d'avertissement liste ce qui manque — sur toutes les fiches existantes à la fois. Ne rendez un champ obligatoire qu'**après** l'avoir rempli pour plus de 80 % de la population.

!!! warning "Ne créez pas de types de fiches personnalisés à la place de champs personnalisés"
    « Mobile App » devrait être un sous-type d'`Application`, pas un nouveau type de fiche. Les nouveaux types ne bénéficient pas du mapping de capacités, des rapports de portefeuille ou des imports de catalogues gratuitement.

## Autres extensions légères que vous pourriez vouloir

Ce sont des extensions de second passage courantes, mais **ne les ajoutez pas avant d'en avoir réellement besoin** :

| Besoin | Où l'ajouter | Type |
|--------|--------------|------|
| Cloud readiness | Application | `single_select` (Ready / Needs refactor / Stays on-prem) |
| Drapeau face-client | Application | `boolean` |
| Classification réglementaire | Application, DataObject | `multiple_select` (RGPD, PCI-DSS, …) |
| Catégorie de risque de perte | Application, IT Component | `single_select` (Point de défaillance unique, etc.) |
| Découpage des coûts | Application | champs `cost` supplémentaires pour `costRunTotalAnnual`, `costChangeTotalAnnual` |

Chacune passe le test des deux questions pour l'analytique de portefeuille. Plusieurs d'entre elles sont aussi de bons candidats pour une formule **calculée** plutôt qu'une saisie manuelle — ce que couvre la page suivante, en utilisant `timeModel` lui-même comme exemple opérationnel.

Suite : [Votre première analyse : Harmonisation applicative](your-first-analysis.md).
