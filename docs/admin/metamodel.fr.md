# Métamodèle

Le **Métamodèle** définit l'ensemble de la structure de données de votre plateforme -- quels types de fiches existent, quels champs elles possèdent, comment elles sont reliées entre elles, et comment les pages de détail des fiches sont disposees. Tout est **piloté par les données** : vous configurez le métamodèle via l'interface d'administration, sans modifier le code.

![Configuration du metamodele](../assets/img/en/20_admin_metamodel.png)

Naviguez vers **Admin > Métamodèle** pour accéder à l'éditeur de métamodèle. Il comporte cinq onglets : **Types de fiches**, **Types de relations**, **Calculs**, **Tags** et **Graphe du métamodèle**.

## Types de fiches

L'onglet Types de fiches liste tous les types du système. Turbo EA est livre avec 14 types intégrés répartis sur quatre couches d'architecture :

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
| **Couleur** | Couleur de marque pour le type (utilisee dans l'inventaire, les rapports et les diagrammes) |
| **Catégorie** | Regroupement par couche d'architecture |
| **À une hiérarchie** | Si les fiches de ce type peuvent avoir des relations parent/enfant |

### Modification d'un type

Cliquez sur n'importe quel type pour ouvrir le **Tiroir de détail du type**. Vous pouvez y configurer :

#### Champs

Les champs definissent les attributs personnalisés disponibles sur les fiches de ce type. Chaque champ possédé :

| Paramètre | Description |
|-----------|-------------|
| **Clé** | Identifiant unique du champ |
| **Libellé** | Nom d'affichage |
| **Type** | text, number, cost, boolean, date, url, single_select ou multiple_select |
| **Options** | Pour les champs de sélection : les choix disponibles avec libelles et couleurs optionnelles |
| **Obligatoire** | Si le champ doit être rempli pour le calcul du score de qualité des données |
| **Poids** | Contribution de ce champ au score de qualité des données (0-10) |
| **Lecture seule** | Empeche la modification manuelle (utile pour les champs calculés) |

Cliquez sur **+ Ajouter un champ** pour créer un nouveau champ, ou cliquez sur un champ existant pour le modifier dans le **Dialogue de l'éditeur de champs**.

#### Sections

Les champs sont organises en **sections** sur la page de détail des fiches. Vous pouvez :

- Créer des sections nommees pour regrouper des champs liés
- Définir les sections en disposition **1 colonne** ou **2 colonnes**
- Organiser les champs en **groupes** au sein d'une section (rendus comme des sous-en-tetes repliables)
- Glisser les champs entre les sections et les réorganiser

Le nom de section special `__description` ajoute les champs à la section Description de la page de détail des fiches.

#### Sous-types

Les sous-types fournissent une classification secondaire au sein d'un type. Par exemple, le type Application a pour sous-types : Application Métier, Microservice, Agent IA et Déploiement. Chaque sous-type peut avoir des libelles traduits.

#### Rôles de parties prenantes

Définissez des rôles personnalisés pour ce type (par ex. « Responsable Applicatif », « Responsable Technique »). Chaque rôle porte des **permissions au niveau de la fiche** qui sont combinées avec le rôle au niveau de l'application de l'utilisateur lors de l'acces à une fiche. Voir [Utilisateurs et rôles](users.md) pour plus de détails sur le modèle de permissions.

### Suppression d'un type

- Les **types intégrés** sont masqués (suppression logique) et peuvent être restaurés
- Les **types personnalisés** sont supprimés définitivement

## Types de relations

Les types de relations definissent les connexions autorisées entre les types de fiches. Chaque type de relation spécifié :

| Champ | Description |
|-------|-------------|
| **Clé** | Identifiant unique |
| **Libellé** | Libellé dans le sens direct (par ex. « utilise ») |
| **Libellé inverse** | Libellé dans le sens inverse (par ex. « est utilise par ») |
| **Type source** | Le type de fiche côté « depuis » |
| **Type cible** | Le type de fiche côté « vers » |
| **Cardinalite** | n:m (plusieurs-a-plusieurs) ou 1:n (un-a-plusieurs) |

Cliquez sur **+ Nouveau type de relation** pour créer une relation, ou cliquez sur un type existant pour modifier ses libelles et attributs.

## Calculs

Les champs calculés utilisent des formules définies par l'administrateur pour calculer automatiquement des valeurs lorsque les fiches sont sauvegardées. Voir [Calculs](calculations.md) pour le guide complet.

## Tags

Les groupes de tags et les tags peuvent être gérés depuis cet onglet. Voir [Tags](tags.md) pour le guide complet.

## Graphe du métamodèle

L'onglet **Graphe du métamodèle** affiche un diagramme SVG visuel de tous les types de fiches et de leurs types de relations. C'est une visualisation en lecture seule qui vous aide a comprendre les connexions de votre métamodèle en un coup d'oeil.

## Éditeur de mise en page des fiches

Pour chaque type de fiche, la section **Mise en page** dans le tiroir du type contrôle la structure de la page de détail des fiches :

- **Ordre des sections** -- Glissez les sections (Description, EOL, Cycle de vie, Hiérarchie, Relations et sections personnalisees) pour les réorganiser
- **Visibilité** -- Masquez les sections non pertinentes pour un type
- **Développement par défaut** -- Choisissez si chaque section commence développée ou repliee
- **Disposition en colonnes** -- Définissez 1 ou 2 colonnes par section personnalisée
