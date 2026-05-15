# Personnalisez le métamodèle — légèrement

Le métamodèle de Turbo EA est entièrement **configurable par l'administrateur** — chaque type de fiche, champ, sous-type, relation et rôle de partie prenante est une donnée, pas du code. Vous serez tenté de le repenser. **Ne le faites pas.**

Les équipes qui réussissent ne personnalisent le métamodèle **que lorsque les champs par défaut ne peuvent pas répondre à leur question**. Les équipes qui échouent passent leur premier mois à renommer `Application` en `Solution`, à ajouter 30 champs personnalisés, et n'arrivent jamais à un rapport opérationnel.

## Le test des deux questions avant d'ajouter un champ

Avant d'ajouter un seul champ personnalisé, posez-vous :

1. **Vais-je filtrer, regrouper ou produire des rapports sur ce champ ?** Si non, sa place est dans la description ou dans un tag — pas dans un champ.
2. **La même réponse est-elle nécessaire sur chaque fiche de ce type ?** Si non, c'est une relation ou une pièce jointe, pas un champ.

Si vous ne pouvez pas répondre « oui » aux deux, n'ajoutez pas le champ.

## Exemple complet : ajouter une disposition TIME

Pour une Rationalisation du portefeuille applicatif, vous avez besoin d'une décision unique par application : **T**olérer / **I**nvestir / **M**igrer / **É**liminer (le cadre **TIME**, popularisé par Gartner). Le métamodèle intégré ne livre pas de champ `timeDisposition`, c'est donc l'un des rares cas où ajouter un champ personnalisé est la bonne décision.

Nous allons l'ajouter en tant que champ `single_select` sur le type `Application`, avec quatre options codées par couleur, poids 1 pour qu'il contribue à la qualité de données.

### Étape 1 — Ouvrir l'éditeur de type

1. Allez dans **Admin → Metamodel**.
2. Cliquez sur la fiche du type **Application**.
3. Le tiroir du type s'ouvre à droite. Basculez sur l'onglet **Fields**.

### Étape 2 — Ajouter le champ

1. Choisissez la section dans laquelle vous voulez que le champ atterrisse (ou créez-en une nouvelle nommée « Portfolio Decision »).
2. Cliquez sur **+ Ajouter un champ** dans cette section.
3. Renseignez :
    - **Clé** : `timeDisposition`  *(lower camel-case, sans espaces, devient la clé d'attribut en JSON)*
    - **Libellé** : *Portfolio Disposition (TIME)*
    - **Type** : `single_select`
    - **Poids** : `1`  *(contribue au score de Qualité de données)*
    - **Requis** : laisser **désactivé** — exiger le champ bloquerait l'approbation de toutes les fiches existantes.
4. Ajoutez les quatre options :

    | Clé | Libellé | Couleur |
    |-----|---------|---------|
    | `tolerate` | Tolérer | gris / neutre |
    | `invest` | Investir | vert |
    | `migrate` | Migrer | ambre |
    | `eliminate` | Éliminer | rouge |

5. **Ajoutez les traductions** pour le libellé et chaque option dans toutes les langues que vous prenez en charge — la page 4 d'[Admin → Métamodèle](../admin/metamodel.md) couvre l'éditeur de traductions. Sauter cette étape signifie que les utilisateurs non anglophones verront « timeDisposition » tel quel.
6. Enregistrez.

### Étape 3 — Confirmer que ça fonctionne

1. Ouvrez n'importe quelle fiche Application. Le nouveau champ apparaît dans sa section, vide.
2. Choisissez une valeur, enregistrez. L'anneau de Qualité de données devrait grimper de quelques points.
3. De retour dans l'**Inventaire**, le champ est désormais disponible dans l'onglet **Colonnes** et comme filtre — vous pouvez déjà filtrer les applications par TIME.

C'est tout. Un champ, dix minutes, immédiatement utile.

## Alternative : utiliser un Groupe de tags à la place

Si la valeur est informative plutôt qu'interrogeable, un **Groupe de tags** (Admin → Tags) est plus léger qu'un champ personnalisé — aucun changement de métamodèle, aucune migration, plus facile à faire évoluer. Utilisez un Groupe de tags quand :

- La valeur est descriptive (« Customer-facing », « Internal-only », « Acquired in 2024 »).
- Vous pouvez ajouter de nouvelles options fréquemment.
- Vous n'en avez pas besoin dans un menu déroulant de filtre, mais une puce de tag en recherche-à-la-frappe convient.

Utilisez un champ personnalisé quand :

- Vous avez besoin de la valeur sur les axes du Rapport de portefeuille (X, Y, couleur).
- Vous voulez qu'elle soit pondérée dans la Qualité de données.
- C'est un vocabulaire contrôlé qui ne changera pas souvent.

La disposition TIME est dans le camp des champs personnalisés car nous l'utiliserons comme axe couleur du Rapport de portefeuille à la page suivante.

## Anti-patterns à éviter

Voici les erreurs de métamodèle les plus courantes dans les premiers déploiements :

!!! warning "Ne renommez pas les types de fiches intégrés"
    Renommer `Application` en `Solution` paraît net mais casse la correspondance conceptuelle que la Carte thermique des capacités, le Rapport de portefeuille et les catalogues présupposent tous. Si votre organisation les appelle « Solutions », réglez la **traduction du libellé** — la `key` sous-jacente reste `Application`.

!!! warning "N'ajoutez pas 30 champs personnalisés dès le premier jour"
    Chaque champ personnalisé ajoute de la friction à la collecte de données et dilue le score de Qualité de données. Ajoutez un champ, utilisez-le pendant un mois, puis ajoutez le suivant.

!!! warning "Ne rendez pas les nouveaux champs `required` dès le premier jour"
    `Required` bloque l'approbation de toute fiche existante n'ayant pas de valeur. Ne rendez un champ requis qu'**après** l'avoir rempli pour plus de 80 % de la population.

!!! warning "Ne créez pas de types de fiches personnalisés à la place de champs personnalisés"
    « Mobile App » devrait être un sous-type d'`Application`, pas un nouveau type de fiche. Les nouveaux types ne bénéficient pas du mapping de capacités, des rapports de portefeuille ou des imports de catalogues gratuitement.

## Autres extensions légères que vous pourriez vouloir

Ce sont des extensions de second passage courantes, mais **ne les ajoutez pas avant d'en avoir réellement besoin** :

| Besoin | Où l'ajouter | Type |
|--------|--------------|------|
| Notation de valeur métier | Application | `single_select` (Haute/Moyenne/Basse) — pilote l'axe Y du Rapport de portefeuille |
| Notation d'aptitude technique | Application | `single_select` — pilote l'axe X |
| Cloud readiness | Application | `single_select` (Ready / Needs refactor / Stays on-prem) |
| Catégorie de risque de perte | Application, IT Component | `single_select` (Point de défaillance unique, etc.) |
| Découpage des coûts | Application | champs `cost` pour `costRunTotalAnnual`, `costChangeTotalAnnual` |

Chacune passe le test des deux questions pour l'analytique de portefeuille. Chacune est aussi un bon candidat pour une formule calculée plutôt qu'une saisie manuelle — ce que couvre la page suivante.

Suite : [Votre première analyse : Harmonisation applicative](your-first-analysis.md).
