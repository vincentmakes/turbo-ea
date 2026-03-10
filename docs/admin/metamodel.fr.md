# Métamodèle

Le **Métamodèle** définit l'ensemble de la structure de données de votre plateforme -- quels types de fiches existent, quels champs elles possèdent, comment elles sont reliées entre elles, et comment les pages de détail des fiches sont disposées. Tout est **piloté par les données** : vous configurez le métamodèle via l'interface d'administration, sans modifier le code.

![Configuration du métamodèle](../assets/img/en/20_admin_metamodel.png)

Naviguez vers **Admin > Métamodèle** pour accéder à l'éditeur de métamodèle. Il comporte six onglets : **Types de fiches**, **Types de relations**, **Calculs**, **Tags**, **Principes EA** et **Graphe du métamodèle**.

## Types de fiches

L'onglet Types de fiches liste tous les types du système. Turbo EA est livré avec 14 types intégrés répartis sur quatre couches d'architecture :

| Couche | Types |
|--------|-------|
| **Stratégie et transformation** | Objectif, Plateforme, Initiative |
| **Architecture métier** | Organisation, Capacité Métier, Contexte Métier, Processus Métier |
| **Application et données** | Application, Interface, Objet de Données |
| **Architecture technique** | Composant IT, Catégorie Technique, Fournisseur, Système |

### Création d'un type personnalisé

Cliquez sur **+ Nouveau type** pour créer un type de fiche personnalisé. Configurez :

| Champ | Description |
|-------|-------------|
| **Clé** | Identifiant unique (minuscules, sans espaces) -- ne peut pas être modifié après la création |
| **Libellé** | Nom d'affichage dans l'interface |
| **Icône** | Nom de l'icône Google Material Symbol |
| **Couleur** | Couleur de marque pour le type (utilisée dans l'inventaire, les rapports et les diagrammes) |
| **Catégorie** | Regroupement par couche d'architecture |
| **À une hiérarchie** | Si les fiches de ce type peuvent avoir des relations parent/enfant |

### Modification d'un type

Cliquez sur n'importe quel type pour ouvrir le **Tiroir de détail du type**. Vous pouvez y configurer :

#### Champs

Les champs définissent les attributs personnalisés disponibles sur les fiches de ce type. Chaque champ possède :

| Paramètre | Description |
|-----------|-------------|
| **Clé** | Identifiant unique du champ |
| **Libellé** | Nom d'affichage |
| **Type** | text, number, cost, boolean, date, url, single_select ou multiple_select |
| **Options** | Pour les champs de sélection : les choix disponibles avec libellés et couleurs optionnelles |
| **Obligatoire** | Si le champ doit être rempli pour le calcul du score de qualité des données |
| **Poids** | Contribution de ce champ au score de qualité des données (0-10) |
| **Lecture seule** | Empêche la modification manuelle (utile pour les champs calculés) |

Cliquez sur **+ Ajouter un champ** pour créer un nouveau champ, ou cliquez sur un champ existant pour le modifier dans le **Dialogue de l'éditeur de champs**.

#### Sections

Les champs sont organisés en **sections** sur la page de détail des fiches. Vous pouvez :

- Créer des sections nommées pour regrouper des champs liés
- Définir les sections en disposition **1 colonne** ou **2 colonnes**
- Organiser les champs en **groupes** au sein d'une section (rendus comme des sous-en-tetes repliables)
- Glisser les champs entre les sections et les réorganiser

Le nom de section special `__description` ajoute les champs à la section Description de la page de détail des fiches.

#### Sous-types (Sous-modèles)

Les sous-types agissent comme des **sous-modèles** au sein d'un type de fiche. Chaque sous-type peut contrôler quels champs sont visibles pour les fiches de ce sous-type, tandis que tous les champs restent définis au niveau du type de fiche.

Par exemple, le type Application a pour sous-types : Application Métier, Microservice, Agent IA et Déploiement. Un administrateur pourrait masquer les champs liés aux serveurs pour le sous-type SaaS, car ils ne sont pas pertinents.

**Configuration de la visibilité des champs par sous-type :**

1. Ouvrez un type de fiche dans l'administration du métamodèle.
2. Cliquez sur n'importe quelle puce de sous-type pour ouvrir le dialogue **Modèle de sous-type**.
3. Activez ou désactivez la visibilité des champs à l'aide des interrupteurs — les champs désactivés seront masqués pour les fiches de ce sous-type.
4. Les champs masqués sont exclus du score de qualité des données, de sorte que les utilisateurs ne sont pas pénalisés pour des champs qu'ils ne peuvent pas voir.

Lorsqu'aucun sous-type n'est sélectionné sur une fiche (ou que le type n'a pas de sous-types), tous les champs sont visibles. Les champs masqués conservent leurs données — si le sous-type d'une fiche change, les valeurs précédemment masquées sont préservées.

#### Rôles de parties prenantes

Définissez des rôles personnalisés pour ce type (par ex. « Responsable Applicatif », « Responsable Technique »). Chaque rôle porte des **permissions au niveau de la fiche** qui sont combinées avec le rôle au niveau de l'application de l'utilisateur lors de l'accès à une fiche. Voir [Utilisateurs et rôles](users.md) pour plus de détails sur le modèle de permissions.

### Suppression d'un type

- Les **types intégrés** sont masqués (suppression logique) et peuvent être restaurés
- Les **types personnalisés** sont supprimés définitivement

## Types de relations

Les types de relations définissent les connexions autorisées entre les types de fiches. Chaque type de relation spécifie :

| Champ | Description |
|-------|-------------|
| **Clé** | Identifiant unique |
| **Libellé** | Libellé dans le sens direct (par ex. « utilise ») |
| **Libellé inverse** | Libellé dans le sens inverse (par ex. « est utilisé par ») |
| **Type source** | Le type de fiche côté « depuis » |
| **Type cible** | Le type de fiche côté « vers » |
| **Cardinalité** | n:m (plusieurs-à-plusieurs) ou 1:n (un-à-plusieurs) |

Cliquez sur **+ Nouveau type de relation** pour créer une relation, ou cliquez sur un type existant pour modifier ses libellés et attributs.

## Calculs

Les champs calculés utilisent des formules définies par l'administrateur pour calculer automatiquement des valeurs lorsque les fiches sont sauvegardées. Voir [Calculs](calculations.md) pour le guide complet.

## Tags

Les groupes de tags et les tags peuvent être gérés depuis cet onglet. Voir [Tags](tags.md) pour le guide complet.

## Principes EA

L'onglet **Principes EA** vous permet de définir les principes d'architecture qui régissent le paysage IT de votre organisation. Ces principes servent de garde-fous stratégiques — par exemple, « Réutiliser avant d'acheter avant de construire » ou « Si nous achetons, nous achetons du SaaS ».

Chaque principe comporte quatre champs :

| Champ | Description |
|-------|-------------|
| **Titre** | Un nom concis pour le principe |
| **Énoncé** | Ce que le principe stipule |
| **Justification** | Pourquoi ce principe est important |
| **Implications** | Les conséquences pratiques du respect du principe |

Les principes peuvent être **activés** ou **désactivés** individuellement via l'interrupteur sur chaque carte.

### Comment les principes influencent les insights IA

Lorsque vous générez des **Insights IA du portefeuille** dans le [Rapport de portefeuille](../guide/reports.md#ai-portfolio-insights), tous les principes actifs sont inclus dans l'analyse. L'IA évalue vos données de portefeuille par rapport à chaque principe et rapporte :

- Si le portefeuille **est conforme** ou **enfreint** le principe
- Des points de données spécifiques comme preuves
- Des actions correctives recommandées

Par exemple, un principe « Acheter du SaaS » amènerait l'IA à signaler les applications hébergées on-premise ou en IaaS et à suggérer des priorités de migration cloud.

## Graphe du métamodèle

L'onglet **Graphe du métamodèle** affiche un diagramme SVG visuel de tous les types de fiches et de leurs types de relations. C'est une visualisation en lecture seule qui vous aide à comprendre les connexions de votre métamodèle en un coup d'oeil.

## Éditeur de mise en page des fiches

Pour chaque type de fiche, la section **Mise en page** dans le tiroir du type contrôle la structure de la page de détail des fiches :

- **Ordre des sections** -- Glissez les sections (Description, EOL, Cycle de vie, Hiérarchie, Relations et sections personnalisées) pour les réorganiser
- **Visibilité** -- Masquez les sections non pertinentes pour un type
- **Développement par défaut** -- Choisissez si chaque section commence développée ou repliée
- **Disposition en colonnes** -- Définissez 1 ou 2 colonnes par section personnalisée
