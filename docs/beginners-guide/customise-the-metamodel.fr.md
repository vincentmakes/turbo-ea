# Personnalisez le métamodèle — légèrement

Le métamodèle de Turbo EA est entièrement **configurable par l'administrateur** — chaque type de fiche, champ, sous-type, relation et rôle de partie prenante est une donnée, pas du code. Vous serez tenté de le repenser. **Ne le faites pas.**

Les équipes qui réussissent ne personnalisent le métamodèle **que lorsque les champs par défaut ne peuvent pas répondre à leur question**. Les équipes qui échouent passent leur premier mois à renommer `Application` en `Solution`, à ajouter 30 champs personnalisés, et n'arrivent jamais à un rapport opérationnel.

## Ce qui est déjà dans le métamodèle

Avant d'ajouter quoi que ce soit, sachez ce que vous avez déjà. Le type de fiche **Application** intégré est livré avec ces champs prêts à l'emploi (entre autres) :

| Champ intégré | Type | À quoi il sert |
|---------------|------|----------------|
| `businessCriticality` | `single_select` | Mission-critique / Important / Utile / Marginal |
| `functionalSuitability` | `single_select` | Parfait / Approprié / Insuffisant / Déraisonnable |
| `technicalSuitability` | `single_select` | Totalement approprié / Adéquat / Déraisonnable / Inapproprié |
| `timeModel` | `single_select` (requis) | **Tolérer / Investir / Migrer / Éliminer** — la disposition TIME canonique de Gartner |
| `riskLevel` | `single_select` | Faible / Moyen / Élevé / Critique |
| `businessValue` | `single_select` | Pilote l'axe Y du Rapport de portefeuille |
| `costTotalAnnual` | `cost` | Coût annuel total |
| `lifecycle.*` | dates | Plan / Phase In / Active / Phase Out / End of Life |

Tout ce dont une Rationalisation du portefeuille applicatif a besoin est déjà là, y compris le **TIME Model**. Vous n'avez pas besoin d'ajouter un champ TIME — vous le remplissez (manuellement ou via un calcul, voir [Votre première analyse](your-first-analysis.md)). Il en va de même pour `functionalSuitability` et `technicalSuitability`, les deux dimensions de suitability qui pilotent classiquement un placement TIME.

## Le test des deux questions avant d'ajouter un champ

Lorsque vous vous retrouvez à avoir besoin d'un champ qui n'est véritablement pas dans le métamodèle, posez-vous :

1. **Vais-je filtrer, regrouper ou produire des rapports sur ce champ ?** Si non, sa place est dans la description ou dans un tag — pas dans un champ.
2. **La même réponse est-elle nécessaire sur chaque fiche de ce type ?** Si non, c'est une relation ou une pièce jointe, pas un champ.

Si vous ne pouvez pas répondre « oui » aux deux, n'ajoutez pas le champ.

## Si vous avez vraiment besoin d'un champ personnalisé

Pour le cas rare où un champ véritablement nouveau est nécessaire (par exemple, un drapeau `cloudReadiness`, une classification réglementaire, un marqueur de segment client), le flux de travail est :

1. Allez dans **Admin → Métamodèle**, cliquez sur le type, basculez sur l'onglet **Fields**.
2. Choisissez la section (ou créez-en une nouvelle) et cliquez sur **+ Ajouter un champ**.
3. Renseignez :
    - **Clé** en lower camel-case (par exemple, `cloudReadiness`) — devient la clé d'attribut en JSON et dans les formules.
    - **Libellé** (et une traduction pour chaque locale prise en charge — sinon les utilisateurs non anglophones verront la clé brute).
    - **Type** — `text`, `number`, `cost`, `boolean`, `date`, `url`, `single_select`, `multiple_select`.
    - **Poids** — `0` pour exclure de la Qualité de données, `1`+ pour l'inclure et le pondérer.
    - **Requis** — laisser **désactivé** pour le premier déploiement ; requis bloque l'approbation de chaque fiche existante.
4. Pour les types select, ajoutez les options (clé + libellé + couleur) et traduisez chaque option.
5. Enregistrez.

Le champ est immédiatement disponible dans l'**Inventaire** (Colonnes, filtres), sur le Détail de la fiche, et dans les formules de **Calculations** sous la forme `<fieldKey>`. Référence complète : [Admin → Métamodèle](../admin/metamodel.md).

## Option : dériver un champ automatiquement avec un Calcul { #option-derive-a-field-automatically-with-a-calculation }

En complément de l'option standard consistant à faire remplir un champ manuellement par les utilisateurs, Turbo EA peut **calculer automatiquement la valeur d'un champ** à partir d'autres champs de la même fiche — y compris les champs intégrés — grâce à la fonctionnalité **Calculations**. Le champ calculé devient en lecture seule et porte un badge « calculé » afin que les utilisateurs ne puissent pas s'écarter de la règle.

L'exemple canonique est le calcul **TIME Model** qui dérive le champ intégré `timeModel` sur Application à partir d'une dimension business-fit et d'une dimension technical-fit. Il est livré comme l'une des entrées du panneau **Formula Reference** dans **Admin → Métamodèle → Calculations** lorsque vous créez un nouveau calcul, vous pouvez donc le sélectionner directement depuis le panneau. Type cible = `Application`, champ cible = `timeModel` ; la formule fournie par le panneau est reproduite dans [Admin → Calculations → Exemples de formules](../admin/calculations.md#example-formulas).

La formule suppose deux champs `single_select` nommés `businessFit` et `technicalFit` avec les options `excellent` / `adequate` / `insufficient` / `unreasonable`. Ils ne font pas partie du métamodèle intégré — ajoutez-les sur Application en suivant les étapes des champs personnalisés ci-dessus si vous souhaitez utiliser ce calcul.

!!! warning "Don't"
    Un TIME calculé est une **hypothèse de départ**, pas un verdict. Soit vous revoyez chaque résultat avec l'Application Owner avant de lui faire confiance, soit vous désactivez la calculation et vous reposez sur la saisie manuelle une fois l'atelier de validation terminé.

Le motif hybride qui fonctionne bien en pratique : laissez la calculation active pendant que vous construisez l'inventaire et que vous disposez surtout des données de suitability ; désactivez-la pour l'atelier de validation ; puis laissez-la désactivée pour que les décisions manuelles tiennent.

## Alternative : utiliser un Groupe de tags à la place

Si la valeur est informative plutôt qu'interrogeable, un **Groupe de tags** (Admin → Tags) est plus léger qu'un champ personnalisé — aucun changement de métamodèle, aucune migration, plus facile à faire évoluer. Utilisez un Groupe de tags quand :

- La valeur est descriptive (« Customer-facing », « Internal-only », « Acquired in 2024 »).
- Vous pouvez ajouter de nouvelles options fréquemment.
- Vous n'en avez pas besoin dans un menu déroulant de filtre, mais une puce de tag en recherche-à-la-frappe convient.

Utilisez un champ personnalisé quand :

- Vous avez besoin de la valeur sur les axes du Rapport de portefeuille (X, Y, couleur).
- Vous voulez qu'elle soit pondérée dans la Qualité de données.
- C'est un vocabulaire contrôlé qui ne changera pas souvent.

## Anti-patterns à éviter

Voici les erreurs de métamodèle les plus courantes dans les premiers déploiements :

!!! warning "Ne renommez pas les types de fiches intégrés"
    Renommer `Application` en `Solution` paraît net mais casse la correspondance conceptuelle que la Carte thermique des capacités, le Rapport de portefeuille et les catalogues présupposent tous. Si votre organisation les appelle « Solutions », réglez la **traduction du libellé** — la `key` sous-jacente reste `Application`.

!!! warning "N'ajoutez pas 30 champs personnalisés dès le premier jour"
    Chaque champ personnalisé ajoute de la friction à la collecte de données et dilue le score de Qualité de données. Ajoutez un champ, utilisez-le pendant un mois, puis ajoutez le suivant.

!!! warning "Ne dupliquez pas les champs intégrés"
    Avant d'ajouter `timeDisposition`, `funcFit`, `techFit` ou `appBusinessValue`, vérifiez la liste des champs existants — il y a de fortes chances qu'un champ intégré équivalent existe déjà (`timeModel`, `functionalSuitability`, `technicalSuitability`, `businessValue`). Les doublons fractionnent vos données et cassent les rapports.

!!! warning "Ne rendez pas les nouveaux champs `required` dès le premier jour"
    `Required` bloque l'approbation de toute fiche existante n'ayant pas de valeur. Ne rendez un champ requis qu'**après** l'avoir rempli pour plus de 80 % de la population.

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
