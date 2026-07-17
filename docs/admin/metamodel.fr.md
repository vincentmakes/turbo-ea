# Métamodèle

Le **Métamodèle** définit l'ensemble de la structure de données de votre plateforme -- quels types de fiches existent, quels champs elles possèdent, comment elles sont reliées entre elles, et comment les pages de détail des fiches sont disposées. Tout est **piloté par les données** : vous configurez le métamodèle via l'interface d'administration, sans modifier le code.

![Configuration du métamodèle](../assets/img/fr/20_admin_metamodele.png)

Naviguez vers **Admin > Métamodèle** pour accéder à l'éditeur de métamodèle. Il comporte sept onglets : **Types de fiches**, **Types de relations**, **Calculs**, **Tags**, **Graphe du métamodèle**, **Principes EA** et **Réglementations de conformité**.

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

#### Couleur du type

Chaque type de carte — y compris les types intégrés — possède une couleur personnalisable utilisée dans l'inventaire, les rapports, les vues de dépendances et les diagrammes. Vous pouvez ainsi aligner Turbo EA sur les conventions visuelles de votre organisation (par exemple les palettes TOGAF/ArchiMate : éléments métier en jaune/orange, applications en bleu).

- Choisissez une couleur avec la pastille de couleur du panneau. Un avertissement apparaît lorsque la couleur choisie offre un contraste très faible sur fond clair ou sombre.
- Les types intégrés affichent un bouton de **réinitialisation** à côté de la pastille dès que la couleur diffère de la valeur par défaut de Turbo EA, afin de toujours pouvoir revenir à la palette standard.
- Le texte affiché sur les couleurs de type (puces, formes de diagramme) bascule automatiquement entre noir et blanc pour rester lisible, en mode clair comme en mode sombre.
- Le sélecteur affiche un **aperçu en direct** à côté de la palette : nom du type, puce, icône de carte, sous-type, pastille d'ID de carte et nœud de vue de dépendances, rendus une fois en mode clair et une fois en mode sombre, mis à jour au fil de la sélection.

#### Champs

Les champs définissent les attributs personnalisés disponibles sur les fiches de ce type. Chaque champ possède :

| Paramètre | Description |
|-----------|-------------|
| **Clé** | Identifiant unique du champ |
| **Libellé** | Nom d'affichage |
| **Type** | text, multiline_text, number, cost, boolean, date, url, single_select ou multiple_select |
| **Options** | Pour les champs de sélection : les choix disponibles avec libellés et couleurs optionnelles |
| **Obligatoire** | Si le champ doit être rempli pour le calcul du score de qualité des données |
| **Qualité des données** | La contribution de chaque champ au score est gérée dans le panneau **Qualité des données** (voir ci-dessous) |
| **Lecture seule** | Empêche la modification manuelle (utile pour les champs calculés) |

Cliquez sur **+ Ajouter un champ** pour créer un nouveau champ, ou cliquez sur un champ existant pour le modifier dans le **Dialogue de l'éditeur de champs**.

#### Sections

Les champs sont organisés en **sections** sur la page de détail des fiches. Vous pouvez :

- Créer des sections nommées pour regrouper des champs liés
- Définir les sections en disposition **1 colonne** ou **2 colonnes**
- Organiser les champs en **groupes** au sein d'une section (rendus comme des sous-en-tetes repliables)
- Réorganiser les champs au sein d'une section par glisser-déposer, et déplacer un champ vers une autre section via son action **déplacer**

Le nom de section special `__description` ajoute les champs à la section Description de la page de détail des fiches.

#### ID de carte

Activez la **génération d'ID de carte** pour attribuer aux cartes de ce type un ID stable et lisible (par exemple `APP-00001`). L'ID apparaît sous forme de pastille copiable à côté du type de la carte, comme colonne optionnelle (triable et filtrable) dans l'inventaire, dans les exports Excel et dans les formules des champs calculés (via `data.reference`).

Le **numéro est toujours généré automatiquement** ; vous ne contrôlez que le **préfixe**. À l'activation, un préfixe suggéré (dérivé du nom du type, ex. `APP-`) s'affiche sous forme de texte — cliquez sur le crayon pour le modifier. Deux réglages ajustent le numéro :

- **Début** — le premier numéro de la série (par défaut `1`).
- **Chiffres min.** — largeur du remplissage par des zéros (par défaut `5`), donc `1` s'affiche `00001`. C'est un minimum ; les numéros s'allongent une fois dépassés. Un **Exemple** affiche en direct le premier ID.

Les ID sont **uniques globalement, en lecture seule, jamais réutilisés ni modifiés**. La séquence de numéros est suivie **par préfixe sur tout l'espace de travail** : deux types partageant un préfixe forment une seule série continue et sans collision. Dès qu'une carte de ce type a un ID, tout le format — préfixe, début et chiffres min. — est verrouillé (les champs deviennent en lecture seule) ; vous pouvez encore désactiver la génération. L'enregistrement n'attribue jamais d'ID aux cartes existantes ; utilisez le bouton dédié **Générer les ID** pour combler le retard à la demande (avec barre de progression et confirmation).

#### Évaluation de la qualité des données

Le score de **qualité des données** d'une fiche mesure de manière pondérée son niveau de complétude. Chaque facteur contributeur – chaque champ ainsi que cinq facteurs intégrés – est géré au même endroit : l'onglet **Qualité des données** de l'éditeur de type de fiche. (L'éditeur est organisé en onglets – Principal, Relations, Rôles des parties prenantes et Qualité des données – les traductions sont accessibles via l'icône de l'en-tête.)

L'importance de chaque facteur se règle avec un simple curseur à quatre niveaux, qui affiche aussi le nombre sous-jacent :

- **Ignorer (0)** – entièrement exclu du score.
- **Normale (1)** – compte une fois (par défaut).
- **Important (2)** – compte deux fois plus.
- **Critique (3)** – compte trois fois plus.

Le panneau liste les cinq **facteurs intégrés** – **Description**, **Cycle de vie** (selon qu'une date de cycle de vie est renseignée), **Relations obligatoires**, **Étiquettes obligatoires** et **Rôles des parties prenantes** (chaque rôle défini pour le type est satisfait dès qu'une partie prenante y est affectée) – suivis de chaque champ regroupé par section, avec le même curseur. Par exemple, réglez le **Cycle de vie** sur *Ignorer* pour un type dont les fiches ne portent légitimement jamais de dates, afin qu'elles ne soient pas pénalisées.

Une barre de **composition du score** en haut du panneau montre la part de chaque facteur dans le score maximal possible, pour voir d'un coup d'œil quels facteurs dominent. Dans la mise en page de la fiche de l'onglet **Principal**, chaque champ – ainsi que les sections intégrées Description, Cycle de vie et Relations – affiche un petit badge avec son niveau actuel, pour voir la pondération sans quitter cet onglet.

Modifier une importance recalcule immédiatement le score de chaque fiche existante de ce type. Les nouveaux champs sont *Normale* par défaut et comptent donc dans le score dès que vous les ajoutez.

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

#### Traductions

Cliquez sur le bouton **Traduire** dans la barre d'outils du tiroir de type pour ouvrir le **Dialogue de traductions**. Vous pouvez y fournir des traductions pour tous les libellés du métamodèle dans chaque langue supportée :

- **Libellé du type** — Le nom d'affichage du type de fiche
- **Sous-types** — Libellés pour chaque sous-type
- **Sections** — En-têtes de section sur la page de détail de la fiche
- **Champs** — Libellés des champs et des options de sélection
- **Rôles des parties prenantes** — Noms de rôles affichés dans l'interface d'attribution des parties prenantes

Les traductions sont stockées avec chaque type de fiche et sont résolues au moment du rendu en fonction de la langue sélectionnée par l'utilisateur. Les libellés non traduits utilisent la valeur anglaise par défaut.

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

### Attributs de relation

Certaines relations portent des attributs supplémentaires que vous définissez sur chaque lien plutôt que sur le type de relation. Par exemple, la relation intégrée **Organisation → Application** (« utilise ») possède un attribut **Type d'usage** — définissez-le sur **Propriétaire**, **Utilisateur** ou **Partie prenante** pour chaque lien. Vous pouvez ainsi modéliser une application *détenue par* une organisation et *utilisée par* d'autres au moyen d'un seul type de relation. La valeur choisie apparaît sous forme de puce colorée dans la section **Relations** de la fiche ; définissez-la lors de l'ajout de la relation, ou plus tard via l'icône de modification sur la ligne de la relation.

Un seul type de relation peut exister entre une paire donnée de types de cartes ; utilisez donc ces attributs pour préciser le sens d'un lien plutôt que de créer un second type de relation pour les mêmes source et cible.

### Gérer les valeurs de relation

Cliquez sur l'icône **Gérer les valeurs de relation** (étiquette) sur une ligne de relation pour modifier les valeurs de ses attributs « type ». Vous pouvez :

- **Ajouter vos propres valeurs** à un sélecteur existant — par exemple un nouveau Type d'usage au-delà de Propriétaire / Utilisateur / Partie prenante.
- **Ajouter un tout nouveau sélecteur de type** à une relation qui n'en a pas, via **Ajouter un type** — y compris sur les relations intégrées.

Les valeurs intégrées (Propriétaire, Utilisateur, Partie prenante, les valeurs de sens du flux…) sont **verrouillées** : elles ne peuvent pas être renommées, recolorées ni supprimées. Vous pouvez toutefois **masquer** une valeur intégrée pour qu'elle n'apparaisse plus dans le sélecteur sur les cartes — une valeur déjà définie reste visible. Vos propres valeurs sont entièrement modifiables et supprimables.

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

### Importer depuis le catalogue de principes

Turbo EA est livré avec un **catalogue de référence comprenant 10 principes EA standards de l'industrie** afin que vous n'ayez pas à partir d'une page blanche. Ouvrez le menu avatar en haut à droite et choisissez **Catalogues de référence → Catalogue de principes**. Vous pouvez alors :

- Rechercher et parcourir les principes inclus (titre, description, justification, implications).
- Sélectionner plusieurs entrées et cliquer sur **Importer** — les principes sélectionnés apparaissent dans l'onglet « Principes EA » comme des entrées standards entièrement modifiables.
- Réimporter en toute sécurité : les principes déjà existants (identifiés par leur ID de catalogue stable) sont ignorés, même si vous les avez renommés localement. Le catalogue affiche un badge vert « Déjà importé » pour ces entrées.

Utilisez le catalogue comme point de départ, puis adaptez le titre, l'énoncé, la justification et les implications de chaque principe à votre organisation.

### Comment les principes influencent les insights IA

Lorsque vous générez des **Insights IA du portefeuille** dans le [Rapport de portefeuille](../guide/reports.md#ai-portfolio-insights), tous les principes actifs sont inclus dans l'analyse. L'IA évalue vos données de portefeuille par rapport à chaque principe et rapporte :

- Si le portefeuille **est conforme** ou **enfreint** le principe
- Des points de données spécifiques comme preuves
- Des actions correctives recommandées

Par exemple, un principe « Acheter du SaaS » amènerait l'IA à signaler les applications hébergées on-premise ou en IaaS et à suggérer des priorités de migration cloud.

## Graphe du métamodèle

![Visualisation du graphe du métamodèle](../assets/img/fr/38_graphe_metamodele.png)

L'onglet **Graphe du métamodèle** affiche un diagramme SVG visuel de tous les types de fiches et de leurs types de relations. C'est une visualisation en lecture seule qui vous aide à comprendre les connexions de votre métamodèle en un coup d'oeil.

## Réglementations de conformité

L'onglet **Réglementations de conformité** gère les cadres réglementaires utilisés par le [scanner Conformité de GRC](../guide/grc.md#compliance). Six cadres sont activés par défaut :

| Réglementation | Périmètre |
|----------------|-----------|
| **AI Act européen** | Exigences applicables aux systèmes d'IA/ML mis sur le marché de l'UE |
| **RGPD** | Règlement général européen sur la protection des données |
| **NIS2** | Directive européenne sur la sécurité des réseaux et de l'information 2 |
| **DORA** | Règlement européen sur la résilience opérationnelle numérique des entités financières |
| **SOC 2** | Critères AICPA Service Organization Controls Trust Services |
| **ISO/IEC 27001** | Norme pour les systèmes de management de la sécurité de l'information |

Pour chaque ligne, vous pouvez :

- **Activer / désactiver** la réglementation via la bascule — les cadres désactivés sont ignorés lors de chaque scan suivant et leurs constats sont exclus des tableaux de bord. Les constats existants sont conservés (non supprimés) au cas où vous réactiveriez la réglementation plus tard.
- **Modifier** le titre, la description du périmètre et le contexte de prompt fourni au LLM.
- **Ajouter une réglementation personnalisée** avec **+ Nouvelle réglementation** — par exemple HIPAA, des politiques internes ou des cadres sectoriels. Les réglementations personnalisées sont de plein droit : elles apparaissent dans l'onglet dédié, contribuent au score global de conformité et prennent en charge les mêmes actions sur les constats (accuser, accepter, promouvoir en risque).
- **Supprimer** une réglementation personnalisée — les réglementations intégrées ne peuvent être supprimées, seulement désactivées.

Le scanner de conformité et le flux de promotion en risque fonctionnent **même sans fournisseur IA configuré** — la saisie manuelle de constats, les transitions de statut et le chemin de promotion en risque restent disponibles. L'IA n'est requise que lorsque vous lancez réellement un nouveau scan.

## Éditeur de mise en page des fiches

Pour chaque type de fiche, la section **Mise en page** dans le tiroir du type contrôle la structure de la page de détail des fiches :

- **Ordre des sections** -- Glissez les sections (Description, EOL, Cycle de vie, Hiérarchie, Relations et sections personnalisées) pour les réorganiser
- **Visibilité** -- Masquez les sections non pertinentes pour un type
- **Développement par défaut** -- Choisissez si chaque section commence développée ou repliée
- **Disposition en colonnes** -- Définissez 1 ou 2 colonnes par section personnalisée
- **Déplacer des champs entre sections** — Utiliser l'action **déplacer** d'un champ (à côté de ses boutons modifier et supprimer) pour le replacer dans une autre section, en conservant sa configuration

## Ressources

L'onglet **Ressources** gère les deux listes proposées dans l'onglet **Ressources** de chaque carte :

- **Types de liens** — la catégorie d'un lien de document (p. ex. *Documentation*, *Contrat*, *Sécurité*). Chaque type de lien porte aussi une **icône** affichée à côté du lien.
- **Catégories de fichiers** — la catégorie attribuée à un fichier joint téléversé.

Pour chaque liste, vous pouvez :

- **Ajouter une entrée** — avec une clé (un identifiant en minuscules stocké sur les cartes, figé après création), un libellé d'affichage et — pour les types de liens — une icône.
- **Modifier** le libellé, l'icône, l'ordre de tri et les traductions par langue de chaque entrée, y compris celles intégrées.
- **Activer / désactiver** une entrée avec le commutateur — les entrées désactivées disparaissent du sélecteur, mais les valeurs existantes sur les cartes sont conservées.
- **Supprimer** une entrée personnalisée — les entrées intégrées ne peuvent pas être supprimées, seulement désactivées.

Un type de lien **Contrat** intégré est activé par défaut. Les deux listes sont incluses dans le **Transfert d'espace de travail** et se clonent ainsi entre instances.
