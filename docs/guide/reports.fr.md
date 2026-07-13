# Rapports

Turbo EA inclut un puissant module de **rapports visuels** permettant d'analyser l'architecture d'entreprise sous différents angles. Tous les rapports peuvent être [sauvegardés pour réutilisation](saved-reports.md) avec leur configuration actuelle de filtres et d'axes.

![Menu des rapports disponibles](../assets/img/fr/09_menu_rapports.png)

## Rapport Portefeuille

![Rapport Portefeuille](../assets/img/fr/10_rapport_portfolio.png)

Le **Rapport Portefeuille** affiche un **graphique à bulles** (ou nuage de points) configurable de vos fiches. Vous choisissez ce que chaque axe représente :

- **Axe X** -- Sélectionnez n'importe quel champ numérique ou de sélection (par ex. Adéquation Technique)
- **Axe Y** -- Sélectionnez n'importe quel champ numérique ou de sélection (par ex. Criticité Métier)
- **Taille de la bulle** -- Associer à un champ numérique (par ex. Coût Annuel)
- **Couleur de la bulle** -- Associer à un champ de sélection ou à l'état du cycle de vie

C'est idéal pour l'analyse de portefeuille -- par exemple, positionner les applications par valeur métier vs adéquation technique pour identifier les candidats à l'investissement, au remplacement ou au retrait.

### Analyses IA du portefeuille

Lorsque l'IA est configurée et que les analyses de portefeuille sont activées par un administrateur, le rapport de portefeuille affiche un bouton **Analyses IA**. Un clic envoie un résumé de la vue actuelle au fournisseur IA, qui renvoie des analyses stratégiques sur les risques de concentration, les opportunités de modernisation, les préoccupations de cycle de vie et l'équilibre du portefeuille. Le panneau d'analyses est repliable et peut être régénéré après modification des filtres ou du regroupement.

## Portefeuille flexible

![Portefeuille flexible — portefeuille d'Objets de données regroupé par Application et coloré par Sensibilité des données](../assets/img/fr/57_rapport_portefeuille_flexible.png)

Le **Portefeuille flexible** utilise les mêmes contrôles que le Portefeuille applicatif mais ajoute un sélecteur **Type de carte** en haut de la barre d'outils. Il permet d'analyser un portefeuille de Capacités métier, d'Initiatives, de Composants IT ou de tout autre type de carte visible avec la même expérience de regroupement, de coloration et de filtrage.

La capture ci-dessus illustre un cas d'usage typique : choisissez **Objet de données** comme type de carte, **Regrouper par → Application** pour voir quelle application détient quelles données, et **Colorier par → Sensibilité des données** pour repérer d'un coup d'œil où se trouvent les données confidentielles.

Changer de type de carte réinitialise les sélections de regroupement, de coloration et de filtres (elles référencent des clés de champs qui n'existent pas sur le nouveau type) et le rapport est rechargé avec les champs, relations et tags applicables au type choisi. Le rapport partage la même permission que le Portefeuille applicatif (`reports.portfolio`) et est enregistré indépendamment.

### Sous-types de relation

Lorsque les relations d'une carte portent une valeur de « type » — par exemple le **type d'utilisation** (Propriétaire / Utilisateur / Partie prenante) sur les relations Organisation→Application, ou le **type de support** sur les relations Application→Capacité métier — vous pouvez colorer les cartes selon cette valeur et filtrer dessus. **Groupez le rapport par le type de carte lié** pour les utiliser (par ex. *Grouper par → Organisation* pour débloquer le *type d'utilisation*) : le sous-type apparaît alors sous le groupe **Sous-types de relation** dans la liste *Colorer par* et dans sa propre ligne de filtres. Comme chaque carte est affichée sous une carte liée, elle est colorée selon *cette* relation — une application qui est *Utilisateur* d'une organisation s'affiche comme Utilisateur à cet endroit, même si elle appartient à une autre.

### Groupes imbriqués

Lorsque vous regroupez par un type de carte lié prenant en charge la hiérarchie (par exemple Capacité métier ou Organisation), un interrupteur **Groupes imbriqués** apparaît à côté du sélecteur *Regrouper par*. Activez-le pour afficher les groupes sous forme de boîtes imbriquées suivant la hiérarchie parent/enfant du type lié — comme dans la carte de capacités. Le sélecteur **Profondeur d’affichage** contrôle le nombre de niveaux développés : chaque carte apparaît sous son groupe visible le plus profond, et les groupes situés au-delà de la limite de profondeur remontent leurs cartes vers l’ancêtre visible le plus proche. Les branches sans cartes sont masquées.

## Carte de capacités

![Carte de capacités métier](../assets/img/fr/11_carte_capacites.png)

La **Carte de capacités** affiche une **carte thermique hiérarchique** des capacités métier de l'organisation. Chaque bloc représente une capacité, avec :

- **Hiérarchie** -- Les capacités principales contiennent leurs sous-capacités
- **Coloration thermique** -- Les blocs sont colorés en fonction d'une métrique sélectionnée (par ex. nombre d'applications de support, qualité moyenne des données, ou niveau de risque)
- **Cliquer pour explorer** -- Cliquez sur n'importe quelle capacité pour approfondir ses détails et ses applications de support

## Rapport Cycle de vie

![Rapport Cycle de vie](../assets/img/fr/12_cycle_de_vie.png)

Le **Rapport Cycle de vie** affiche une **visualisation chronologique** indiquant quand les composants technologiques ont été introduits et quand leur retrait est prévu. Essentiel pour :

- **Planification du retrait** -- Voir quels composants approchent de la fin de vie
- **Planification des investissements** -- Identifier les lacunes où une nouvelle technologie est nécessaire
- **Coordination des migrations** -- Visualiser les périodes de chevauchement entre mise en service et retrait progressif

Les composants sont affichés sous forme de barres horizontales couvrant leurs phases de cycle de vie : Planification, Mise en service, Actif, Retrait progressif et Fin de vie.

## Rapport Dépendances

![Rapport Dépendances](../assets/img/fr/13_dependances.png)

Le **Rapport Dépendances** visualise les **connexions entre composants** sous forme de graphe réseau. Les nœuds représentent les fiches et les arêtes représentent les relations. Fonctionnalités :

- **Contrôle de profondeur** -- Limiter le nombre de sauts depuis le nœud central à afficher (limitation de profondeur BFS)
- **Filtrage par type** -- Afficher uniquement des types de fiches et types de relations spécifiques
- **Exploration interactive** -- Cliquer sur n'importe quel nœud pour recentrer le graphe sur cette fiche
- **Analyse d'impact** -- Comprendre le rayon d'impact des modifications sur un composant spécifique

### Layered Dependency View (vue de dépendances par couches)

![Layered Dependency View](../assets/img/en/13b_dependencies_c4.png)

Basculez vers la **Layered Dependency View** à l'aide des boutons de mode d'affichage dans la barre d'outils. Il s'agit de la notation maison de Turbo EA pour représenter les dépendances entre fiches selon les quatre couches EA — inspirée du principe de stratification d'ArchiMate et de la philosophie « bons défauts » du modèle C4, mais distincte des deux. La même vue est réutilisée sur la page de détail de fiche (montrant le voisinage de dépendances immédiat de la fiche) et dans l'assistant [TurboLens Architect](turbolens.md#architecture-ai), afin que les dépendances apparaissent de la même manière partout.

**Lire le diagramme**

- **Couloirs par couche** — Les fiches sont regroupées par couche architecturale (Stratégie & Transformation, Architecture Métier, Application & Données, Architecture Technique) dans des rectangles de périmètre en pointillés, dans un ordre fixe.
- **Nœuds colorés par type avec icônes** — Chaque nœud est coloré selon son type de fiche et affiche l'icône du type de fiche dans son coin supérieur gauche, de sorte que les types sont reconnaissables d'un coup d'œil, même sans couleur.
- **Arêtes orientées et étiquetées** — Les arêtes suivent la direction de la relation du métamodèle (source → cible) et portent l'étiquette directe de la relation (par ex. *utilise*, *supporte*, *s'exécute sur*). Lorsqu'une relation est qualifiée par une valeur (comme un Type de support *Principal*), celle-ci apparaît entre crochets après l'étiquette — par exemple *supporte [Principal]*.
- **Fiches proposées** — Dans l'assistant TurboLens Architect, les fiches non encore validées ont une bordure en pointillés et un badge vert **NOUVEAU**.

**Explorer et naviguer**

- **Déplacement, zoom, minimap** — Faites glisser le canevas pour vous déplacer, faites défiler pour zoomer et utilisez la minimap pour naviguer dans les grands diagrammes.
- **Cliquer pour inspecter** — Cliquez sur n'importe quel nœud pour ouvrir le panneau latéral de détail de la fiche.
- **Recentrer** — Maj+clic ou appui long sur une fiche pour centrer le diagramme dessus ; les boutons **Retour au sélecteur de cartes**, **Carte précédente** et **Carte suivante** de la barre d'outils parcourent votre historique de navigation.
- **Mode surbrillance** — Survolez une fiche pour mettre en surbrillance ses connexions ; sur les appareils tactiles, activez le **Mode surbrillance** dans le panneau de contrôle pour mettre en surbrillance par toucher.
- **Mode expansion** — Activez le **Mode expansion** dans le panneau de contrôle, puis cliquez sur une fiche pour révéler toutes ses relations à la demande.
- **Afficher le parent / Afficher les enfants** — Deux alternatives ciblées au mode expansion. Activez **Afficher le parent** (flèche vers le haut) ou **Afficher les enfants** (flèche vers le bas) dans le panneau de contrôle, puis cliquez sur une fiche pour n'ajouter au diagramme que son parent hiérarchique ou ses enfants directs. Les fiches affichées restent sur le diagramme — vous pouvez ainsi superposer parents et enfants — et disparaissent lorsque vous recentrez ou réinitialisez la vue.
- **Pas de fiche centrale requise** — Dans le Rapport Dépendances, la Layered Dependency View affiche toutes les fiches correspondant au filtre de type actuel, vous n'avez donc pas à choisir une fiche de départ au préalable.

**Personnaliser la vue** (depuis la barre d'outils)

- **Menu Affichage des fiches** — Activez l'étiquette de **type** et un **point de statut de cycle de vie**, activez les **repères de hiérarchie** (un petit chevron sur chaque fiche ayant un parent au-dessus ou des enfants en dessous non affichés — une indication pour utiliser les outils d'affichage) et choisissez des **champs d'attributs supplémentaires** à afficher sur chaque fiche — les deux premiers s'affichent sur la fiche et l'ensemble complet apparaît dans l'infobulle au survol. Les choix sont mémorisés d'une visite à l'autre.
- **Afficher les fiches en fin de vie** — Les fiches liées dont le cycle de vie a atteint la fin de vie sont masquées par défaut pour garder le graphe lisible ; activez cette option (dans le menu **Affichage des fiches**) pour les réafficher. La fiche sur laquelle vous êtes centré est toujours affichée, même si elle est elle-même en fin de vie.
- **Afficher les valeurs de relation** — De nombreuses relations peuvent être qualifiées par une valeur (par ex. une application *supporte* une capacité en tant que *Principal*, *Secondaire* ou *Aucun support*). Lorsque l'option est activée (par défaut), ces valeurs apparaissent entre crochets à côté de l'étiquette de la relation (*supporte [Principal]*) et sont incluses dans les exports d'image. Désactivez-la dans le menu **Affichage des fiches** pour une vue plus épurée ; les relations sans valeur restent inchangées dans tous les cas.
- **Réorganiser** — Faites glisser une fiche pour la déplacer au sein de sa couche, ou faites glisser un **bloc de couche** entier pour le déplacer avec toutes ses fiches. **Réinitialiser la vue** (dans la barre d'outils de gauche) restaure l'agencement automatique et efface toute exploration.
- **Arrière-plan** — Faites défiler l'arrière-plan du canevas entre grille, points et aucun.
- **Exporter et plein écran** — Exportez le diagramme en **PNG** ou **SVG**, ou ouvrez-le en **plein écran**.
- **Créer un diagramme** — Transformez la vue actuelle en un nouveau diagramme modifiable dans le [module Diagrammes](diagrams.md). Les cartes, les relations et les quatre couches d'architecture sont recréées, et chaque forme reste liée à sa carte d'inventaire. Un nom vous est demandé, puis vous êtes dirigé directement vers le nouveau diagramme. Disponible pour les utilisateurs autorisés à créer des diagrammes.

## Rapport Coûts

![Rapport Coûts](../assets/img/fr/34_rapport_couts.png)

Le **Rapport Coûts** fournit une analyse financière de votre paysage technologique :

- **Vue treemap** -- Rectangles imbriqués dimensionnés par coût, avec regroupement optionnel (par ex. par organisation ou capacité)
- **Vue graphique à barres** -- Comparaison des coûts entre composants
- **Type de carte** -- Choisissez le type de carte autour duquel le rapport est construit (Application, Composant IT, Fournisseur, …).

### Source des coûts

Lorsque le type de carte sélectionné possède au moins un type de relation pointant vers un type qui détient un champ de coût, un sélecteur **Source des coûts** apparaît à côté du **Type de carte**. Il permet de choisir d'où viennent les chiffres :

- **Direct (ce type de carte)** -- valeur par défaut ; additionne le champ de coût sur les cartes affichées elles-mêmes. À utiliser pour examiner directement les *Applications* ou les *Composants IT*.
- **Agréger depuis des cartes liées** -- cochez une ou plusieurs entrées `Type · Champ` (par exemple `Application · Coût annuel total`, `Composant IT · Coût annuel total`). La valeur de chaque carte primaire devient alors la somme de ce champ sur ses cartes liées.

Le sélecteur est **multi-sélection**, ce qui permet à une seule consolidation de combiner plusieurs types liés. Par exemple, en consultant le **Fournisseur** *Microsoft*, cocher à la fois `Application · Coût annuel total` et `Composant IT · Coût annuel total` montre l'empreinte complète de l'éditeur — Teams, M365, Azure et tout autre composant fourni par Microsoft — sous la forme d'un chiffre unique.

#### Pourquoi rien n'est compté deux fois

Le sélecteur est conçu pour rendre toute double-comptabilisation impossible par construction :

- Chaque entrée est une paire `(type cible, champ de coût)` unique -- la liste propose chaque paire exactement une fois, même lorsque plusieurs types de relation atteignent le même type cible.
- Au sein d'une même paire, deux cartes reliées par plusieurs types de relation ne contribuent leur coût qu'une seule fois.
- Entre entrées différentes, aucune carte ne peut contribuer deux fois : une carte n'a qu'un seul type, et différents champs de coût sur une même carte sont des valeurs indépendantes.

Une petite **icône d'aide (?)** placée à côté du sélecteur rappelle cette garantie au survol.

La liste des options est générée à partir de votre métamodèle -- les types de relation et les champs de coût sont découverts au moment du rendu, donc tout nouveau type de carte ou toute nouvelle relation devient automatiquement une source de coûts valide.

### Forer dans un rectangle

Dès qu'au moins une Source de coût est active, les rectangles du treemap deviennent **cliquables**. Un clic remplace le graphique par la décomposition du coût de ce rectangle — les fiches liées qui ont contribué à son agrégation, dimensionnées par leur coût direct. Un fil d'Ariane apparaît au-dessus du graphique, par exemple **Toutes les applications › NexaCore ERP** ; cliquez sur n'importe quel segment pour remonter.

- **Une seule Source de coût active** — le forage affiche un treemap des fiches liées (par exemple, cliquer sur *NexaCore ERP* avec `Composant SI · Coût annuel total` coché montre les composants SI liés à NexaCore ERP, dimensionnés par leur coût annuel).
- **Plusieurs Sources de coût actives** — le forage affiche **un treemap par source côte à côte** (1 colonne sur écran étroit, 2 sur écran large). Chaque panneau possède son propre en-tête, son propre total et son propre `% du total` dans l'infobulle — ainsi les différents types de fiches conservent leur échelle au lieu d'être tassés dans un seul graphique.

Le curseur de chronologie, la sélection de Source de coût et les autres filtres sont préservés pendant le forage, et le niveau de forage fait partie de la configuration du rapport sauvegardé — sauvegarder un rapport en cours de forage le rouvre directement à ce niveau. Sans Source de coût active, un clic sur un rectangle ouvre plutôt le panneau latéral de la fiche (il n'y a rien à décomposer).

## Rapport Matrice

![Rapport Matrice](../assets/img/fr/35_rapport_matrice.png)

Le **Rapport Matrice** crée une **grille de références croisées** entre deux types de fiches. Par exemple :

- **Lignes** -- Applications
- **Colonnes** -- Capacités Métier
- **Cellules** -- Indiquent si une relation existe (et combien)

Ceci est utile pour identifier les lacunes de couverture (capacités sans applications de support) ou les redondances (capacités supportées par trop d'applications).

Utilisez l'option **Masquer les cartes sans relation** pour masquer les lignes et colonnes des fiches qui n'ont aucune relation, en ne conservant que les fiches participant à au moins une relation. La vue complète affichant toutes les fiches reste le comportement par défaut.

## Rapport Qualité des données

![Rapport Qualité des données](../assets/img/fr/33_rapport_qualite_donnees.png)

Le **Rapport Qualité des données** est un **tableau de bord de complétude** qui montre à quel point vos données d'architecture sont bien renseignées. Basé sur les niveaux d'importance configurés dans l'onglet **Qualité des données** de chaque type de fiche (chaque champ ainsi que les facteurs intégrés Description, Cycle de vie, Relations obligatoires et Étiquettes obligatoires) :

- **Score global** -- Qualité moyenne des données sur toutes les fiches
- **Par type** -- Ventilation montrant quels types de fiches ont la meilleure/pire complétude
- **Fiches individuelles** -- Liste des fiches avec la qualité de données la plus faible, priorisées pour amélioration

## Rapport Fin de vie (EOL)

![Rapport Fin de vie](../assets/img/fr/32_rapport_eol.png)

Le **Rapport EOL** affiche le statut de support des produits technologiques liés via la fonctionnalité [Administration EOL](../admin/eol.md) :

- **Répartition des statuts** -- Combien de produits sont Supportés, Approchant la fin de vie, ou en Fin de vie
- **Chronologie** -- Quand les produits perdront leur support
- **Priorisation des risques** -- Se concentrer sur les composants critiques approchant la fin de vie

## Rapports sauvegardés

![Galerie de rapports sauvegardés](../assets/img/fr/36_rapports_sauvegardes.png)

Sauvegardez n'importe quelle configuration de rapport pour un accès rapide ultérieur. Les rapports sauvegardés incluent un aperçu en miniature et peuvent être partagés dans toute l'organisation.

## Exporter les rapports

Chaque rapport prend en charge **Exporter vers Excel (.xlsx)** et **Exporter vers PowerPoint (.pptx)** depuis le menu **⋮** de la barre de titre (à côté de Imprimer et Copier le lien).

- **Excel** — Produit une feuille par tableau de données actuellement affiché, avec des colonnes dimensionnées automatiquement et le formatage des devises / nombres préservé. Basculez en **vue Tableau** avant l'export pour capturer les lignes sous-jacentes.
- **PowerPoint** — Génère un diaporama dont la première diapositive combine le titre du rapport, l'horodatage de génération, le résumé des filtres actifs et le graphique en direct en qualité de présentation. Les diapositives suivantes paginent les tableaux pour des supports partageables.

Les filtres et options de regroupement actifs au moment de l'export sont consignés sur la diapositive de titre ou dans l'en-tête, pour que les exports restent explicites.

## Carte de processus

La **Carte de processus** visualise le paysage des processus métier de l'organisation sous forme de carte structurée, montrant les catégories de processus (Management, Cœur de métier, Support) et leurs relations hiérarchiques.
