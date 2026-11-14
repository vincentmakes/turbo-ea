# Gestion de Portefeuille de Projets (PPM)

Le module **PPM** fournit une solution complète de gestion de portefeuille de projets pour le suivi des initiatives, budgets, risques, tâches et calendriers. Il s'intègre directement avec le type de fiche Initiative pour enrichir chaque projet avec des rapports de statut, un suivi des coûts et une visualisation Gantt.

!!! note
    Le module PPM peut être activé ou désactivé par un administrateur dans les [Paramètres](../admin/settings.md). Lorsqu'il est désactivé, la navigation et les fonctionnalités PPM sont masquées.

## Tableau de Bord du Portefeuille

![Tableau de bord du portefeuille PPM](../assets/img/fr/40_ppm_portefeuille.png)

Le **Tableau de Bord du Portefeuille** est le point d'entrée principal pour PPM. Il fournit :

- **Cartes KPI** — Total des initiatives, budget total, coût réel total et résumés de l'état de santé
- **Graphiques circulaires de santé** — Distribution de la santé du calendrier, des coûts et du périmètre (En cours / À risque / Hors piste)
- **Distribution des statuts** — Répartition par sous-type d'initiative et statut
- **Aperçu Gantt** — Barres de chronologie montrant les dates de début et de fin de chaque initiative, avec des indicateurs de santé RAG

### Regroupement et filtrage

Utilisez la barre d'outils pour :

- **Regrouper par** tout type de fiche lié (p. ex., Organisation, Plateforme)
- **Regrouper par** un sous-type d'initiative (p. ex., Programme), proposé dans une seconde section du même menu, pour voir chaque programme avec toutes les initiatives situées en dessous (voir ci-dessous)
- **Filtrer par sous-type** (Idée, Programme, Projet, Épique)
- **Rechercher** par nom d'initiative
- **Afficher la hiérarchie** pour imbriquer les initiatives de chaque groupe sous leur initiative parente (voir ci-dessous)
- **Sous-grouper par sous-type** pour scinder chaque groupe par sous-type (voir ci-dessous)

Ces filtres sont conservés dans l'URL, donc l'actualisation de la page conserve votre vue actuelle. La hiérarchie, sa profondeur d’affichage et le sous-groupement sont eux aussi conservés dans l'URL.

#### Afficher la hiérarchie des initiatives

Lorsque certaines initiatives du portefeuille ont une initiative parente elle-même présente dans le portefeuille, la barre d'outils propose **Afficher la hiérarchie**. Une fois activée, chaque groupe présente ses initiatives sous forme d'arborescence : une initiative enfant apparaît en retrait sous son parent, le chevron placé devant le nom d'un parent replie ou déplie sa sous-arborescence, et chaque ligne affiche son sous-type, afin que le rôle de chaque niveau (par exemple Programme → Projet → Épique) reste visible. **Profondeur d’affichage** limite l'arborescence à ses premiers niveaux (*Niveau 1*, *Niveau 2*, … ou *Tous les niveaux*).

Le regroupement reste prioritaire : la hiérarchie s'imbrique **à l'intérieur de chaque groupe**, si bien qu'une initiative dont le parent appartient à un autre groupe apparaît comme ligne de premier niveau de son propre groupe. Les filtres s'appliquent d'abord et l'arborescence montre ce qui reste : lorsque la recherche ou le filtre de sous-type exclut un parent, ses enfants remontent au premier niveau, au lieu que le parent soit conservé comme contexte.

![Portefeuille PPM avec la hiérarchie affichée](../assets/img/fr/101_ppm_portefeuille_hierarchie.png)

#### Sous-grouper par sous-type

**Sous-grouper par sous-type** divise chaque groupe en un sous-groupe par sous-type, dans l'ordre où les sous-types sont définis sur le type Initiative, les initiatives sans sous-type venant en dernier. Chaque sous-groupe a son propre en-tête, se replie séparément et porte sa propre ligne de totaux ; les totaux du groupe couvrent toujours toutes ses initiatives. Le commutateur n'est pas disponible tant que la hiérarchie est affichée, car l'arborescence couvre déjà tous les sous-types.

#### Regrouper par un sous-type d'initiative

Le menu **Grouper par** comporte deux sections : **Types de fiches liés** et **Sous-types d’initiative**, les sous-types définis sur le type Initiative. Choisir un sous-type — par exemple **Programme** — affiche un groupe par initiative de type Programme. Le programme donne son nom au groupe et n'en est **que l'en-tête, jamais une ligne** ; le groupe contient **toutes les initiatives situées en dessous, à toute profondeur** et quel que soit leur sous-type, si bien qu'un programme imbriqué sous un autre programme est une ligne du groupe du programme le plus haut.

La ligne de bas de groupe remplace la ligne de totaux : libellée du nom du sous-type, elle affiche le budget, le réel et les dates **propres** au programme ou — lorsqu'il n'en a pas — les montants **dérivés** des initiatives situées en dessous, dessinés en contour, en pointillés et en italique comme décrit sous *Agréger les montants sur les initiatives parentes*. Les initiatives sans programme au-dessus d'elles figurent sous **Non groupé**. Une initiative intermédiaire que vous ne pouvez pas voir, qui est archivée ou qu'un portail ne publie pas **rompt la chaîne** : ce qui se trouve en dessous n'est plus regroupé sous le programme au-dessus. **Afficher la hiérarchie** n'apparaît que lorsque quelque chose est imbriqué sous les enfants directs d'un programme, et le filtre de sous-type ne propose pas le sous-type de regroupement, car ses initiatives sont des en-têtes et non des lignes.

#### Agréger les montants sur les initiatives parentes

Chaque initiative affiche ses propres montants dès qu'elle en a : les barres CapEx et OpEx d'un parent couvrent les lignes de budget et de coût saisies sur le parent, et sa barre de Gantt ses propres dates de début et de fin. Un parent **sans ligne de budget propre** affiche à la place le budget des initiatives situées en dessous, et un parent **sans ligne de coût propre** leur réel ; dans les deux cas, la barre est dessinée **en contour** avec des montants en italique, et son infobulle indique quelle moitié vient d'en dessous. Un parent **sans date de début ni de fin** couvre la période allant du début le plus précoce à la fin la plus tardive des initiatives situées en dessous, sous forme de barre **en pointillés** aux trimestres en italique. Une infobulle indique chaque fois combien d'initiatives sont couvertes. Les trois règles sont indépendantes — un programme qui porte le budget pendant que ses projets saisissent les dépenses affiche son propre budget face à leur réel, et un programme peut porter ses propres dates et afficher malgré tout les coûts de ses projets — et il suffit d'une ligne de budget, d'une ligne de coût ou d'une date sur le parent pour que cette partie revienne à ses propres montants. Seules comptent les initiatives que vous pouvez voir et, sur un portail, celles que le portail publie. Les totaux de groupe et la barre d'indicateurs continuent d'additionner les seules lignes saisies, de sorte que chaque montant n'est compté qu'une fois.

Les montants dérivés n'existent que sur le tableau PPM et sur les onglets **Vue d'ensemble** et **Budget et coûts** de l'initiative elle-même. Pour reporter un total agrégé dans l'inventaire, les rapports ou un portail, définissez un champ calculé qui ajoute le budget propre de chaque niveau aux totaux de ses enfants — voir [Agréger les montants PPM le long de la hiérarchie des initiatives](../admin/calculations.md#rolling-ppm-figures-up-the-initiative-hierarchy). Une modification PPM sur un enfant relance les calculs de toutes les initiatives situées au-dessus de lui, de sorte que le total du parent évolue immédiatement.

### Impression et export

Le portefeuille propose les mêmes actions de barre de titre que les rapports :

- **Imprimer / Enregistrer en PDF** — l'icône d'imprimante imprime le portefeuille tel qu'il apparaît à l'écran. La barre d'onglets, la barre de filtres et les fenêtres contextuelles de survol sont masquées, le regroupement, le sous-type et la recherche actifs sont imprimés sous forme de ligne de paramètres compacte, et la grille chronologique n'est plus rognée : toutes les colonnes tiennent dans la page. Lorsque la hiérarchie ou le sous-groupement est activé, la ligne de paramètres l'indique également, avec la profondeur d’affichage.
- **Exporter vers PowerPoint (.pptx)** — depuis le menu **⋮**. La première diapositive porte le titre, l'horodatage de génération et les filtres actifs, accompagnés du portefeuille en qualité de présentation ; les portefeuilles longs se poursuivent sur d'autres diapositives, découpées uniquement entre initiatives — jamais au milieu d'une ligne, d'un en-tête de groupe ou d'une ligne de totaux.
- **Exporter vers Excel (.xlsx)** — également depuis le menu **⋮**. Une ligne par initiative avec son groupe, son sous-type, son chef de projet, ses dates de début et de fin, les trois indicateurs de santé, le CapEx / OpEx prévu et réel, et la date du dernier rapport d'avancement. Les lignes suivent l'ordre affiché à l'écran ; lorsque la hiérarchie est affichée, une colonne **Parent** indique l'initiative parente de chaque initiative. Trois colonnes, **Origine du budget**, **Origine des coûts** et **Origine des dates**, indiquent si le budget, le réel et les dates d'une ligne sont les siens ou le total des initiatives situées en dessous. Lorsque le tableau est regroupé par un sous-type d'initiative, l'initiative de regroupement est la **première ligne de son groupe**, avec les montants qu'affiche sa ligne de bas de groupe.

## Vue Détaillée de l'Initiative

Cliquez sur n'importe quelle initiative pour ouvrir sa page de détail avec sept onglets :

### Onglet Vue d'Ensemble

![Vue d'ensemble de l'initiative PPM](../assets/img/fr/41_ppm_vue_ensemble.png)

La vue d'ensemble montre un résumé de la santé et des finances de l'initiative :

- **Résumé de santé** — Indicateurs de calendrier, coût et périmètre du dernier rapport de statut
- **Budget vs. Réel** — Carte KPI combinée montrant le budget total et les dépenses réelles avec écart
- **Montants venus d'en dessous** — Lorsque l'initiative n'a aucune ligne de budget propre, son budget total, ses barres de budget et l'écart affichent à la place le budget des initiatives situées en dessous : en italique, marqués d'une flèche ↳, avec la piste de budget en contour et une infobulle indiquant combien d'initiatives sont couvertes. Lorsqu'elle n'a aucune ligne de coût propre, son réel vient d'en dessous de la même façon, avec les barres de dépense en contour. Les deux côtés sont décidés séparément, et la saisie d'une première ligne propre fait revenir ce côté aux montants propres de l'initiative.
- **Sous cette initiative** — Lorsque l'initiative a des initiatives en dessous d'elle, une ligne sous les barres de budget indique leur nombre, leur budget et leurs dépenses réelles additionnés, ainsi que la période couverte par leurs dates. Elle s'affiche à côté des montants propres de l'initiative et ne s'y ajoute jamais. Lorsque le budget et le réel viennent déjà tous deux d'en dessous, la ligne ne garde que le nombre et la période couverte.
- **Activité récente** — Résumé du dernier rapport de statut

### Onglet Rapports de Statut

![Rapports de statut PPM](../assets/img/fr/42_ppm_rapports_statut.png)

Les rapports de statut mensuels suivent la santé du projet au fil du temps. Chaque rapport comprend :

| Champ | Description |
|-------|-------------|
| **Date du rapport** | La date de la période de rapport |
| **Santé du calendrier** | En cours, À risque ou Hors piste |
| **Santé des coûts** | En cours, À risque ou Hors piste |
| **Santé du périmètre** | En cours, À risque ou Hors piste |
| **Résumé** | Résumé exécutif du statut actuel |
| **Réalisations** | Ce qui a été accompli pendant cette période |
| **Prochaines étapes** | Activités planifiées pour la prochaine période |

### Onglet Budget et Coûts

![Budget et coûts PPM](../assets/img/fr/43_ppm_budget_couts.png)

Suivi des données financières avec deux types de lignes :

- **Lignes de budget** — Budget planifié par année fiscale et catégorie (CapEx / OpEx), avec une description facultative. Une même année fiscale et une même catégorie peuvent compter autant de lignes que nécessaire — une par licence, partenaire d'intégration ou lot de matériel — et la description permet de les distinguer ; les totaux les additionnent toutes. Les lignes budgétaires sont regroupées selon le **mois de début de l'exercice fiscal** configuré dans les [Paramètres](../admin/settings.md#début-de-lexercice-fiscal). Par exemple, si l'exercice fiscal commence en avril, une ligne budgétaire de juin 2026 appartient à l'EF 2026–2027
- **Lignes de coût** — Dépenses réelles avec date, description et catégorie

Les deux tableaux sont regroupés par exercice. Chaque exercice a une ligne d'en-tête avec ses sous-totaux CapEx, OpEx et total ainsi que le nombre de lignes qu'il contient ; la flèche de l'en-tête affiche ou masque les lignes de cet exercice. À l'ouverture de l'onglet, seul l'exercice en cours est déplié (ou le dernier exercice qui a des lignes, si l'exercice en cours n'en a aucune). Les montants figurent dans des colonnes **CapEx** et **OpEx** distinctes, et une ligne **Total, tous les exercices** sous chaque tableau additionne tous les exercices. Le bouton **+** de l'en-tête d'un exercice budgétaire ajoute une ligne de budget avec cet exercice déjà renseigné. Les lignes de coût sont regroupées selon l'exercice de leur date et triées par date au sein de celui-ci ; celles sans date sont réunies à la fin dans le groupe **Sans date** et comptent dans les totaux des coûts comme toute autre ligne.

Lorsque l'initiative n'a **aucune ligne de budget propre**, le tableau du budget affiche, à la place de son état vide, le budget des initiatives situées en dessous : une légende indique de combien d'initiatives il provient, une ligne en lecture seule par exercice donne le CapEx, l'OpEx et le total en italique, et la ligne **Total, tous les exercices** les additionne. Le tableau des coûts fait de même avec leur réel lorsque l'initiative n'a **aucune ligne de coût propre**, avec une ligne **Sans date** pour leurs lignes de coût sans date. La barre de synthèse signale ces montants en italique, avec une infobulle. Chaque tableau décide pour lui-même, rien n'est enregistré ni ajouté aux montants propres de l'initiative, et seules comptent les initiatives que vous pouvez voir. La saisie d'une première ligne avec **Ajouter une ligne budgétaire** ou **Ajouter un poste de coût** fait revenir ce tableau aux lignes propres de l'initiative ; les graphiques de dépense affichent toujours les lignes propres de l'initiative.

Les totaux de budget et de coûts sont automatiquement agrégés dans les attributs `costBudget` et `costActual` de la fiche Initiative.

#### Dépenses dans le temps

Au-dessus des tableaux de budget et de coûts, trois graphiques montrent comment les dépenses se cumulent mois après mois :

- **Dépenses cumulées par catégorie** — CapEx et OpEx cumulées pour l'exercice sélectionné, avec des lignes horizontales pointillées marquant le budget CapEx et OpEx de cet exercice
- **Dépenses totales cumulées** — le même exercice avec les deux catégories combinées, face à une ligne pointillée de budget total
- **Projet à ce jour** — CapEx et OpEx cumulées sur tous les mois du projet, face au budget total de tous les exercices

Le sélecteur d'exercice s'applique aux deux premiers graphiques et propose l'exercice en cours, tout autre exercice comportant des données, ainsi que **Tous les exercices**. Vos choix d'exercice et d'affichage replié ou déplié sont mémorisés d'une visite à l'autre.

Deux points à garder à l'esprit :

- Les courbes s'arrêtent au mois en cours au lieu de se prolonger à plat jusqu'à la fin de l'exercice, afin qu'un exercice en cours ne soit pas confondu avec un exercice où les dépenses se sont arrêtées
- Les postes de coût sans date ne peuvent pas être placés sur une chronologie et sont exclus. Une note sous les graphiques indique combien ont été exclus, ce qui permet de rapprocher les totaux des graphiques de la barre de synthèse

### Onglet Gestion des Risques

![Gestion des risques PPM](../assets/img/fr/44_ppm_gestion_risques.png)

Le registre des risques suit les risques de l'initiative. Chaque risque comporte :

| Champ | Description |
|-------|-------------|
| **Titre** | Brève description du risque |
| **Description** | Le risque dans son intégralité |
| **Probabilité** | Score de probabilité (1–5) |
| **Impact** | Score d'impact (1–5) |
| **Score de risque** | Calculé automatiquement comme probabilité × impact |
| **Statut** | Ouvert, En atténuation, Atténué, Fermé ou Accepté |
| **Atténuation** | Actions d'atténuation planifiées |
| **Responsable** | Utilisateur responsable de la gestion du risque |

Un bandeau de synthèse au-dessus de la grille affiche le **Total des risques**, le nombre de risques au statut **Ouvert** et les **Risques élevés**.

#### La grille des risques

Les risques sont listés dans une grille construite comme l'[Inventaire](inventory.md) et le [Registre des risques](risks.md#grille-du-registre). Le texte n'est jamais tronqué : chaque ligne affiche le titre du risque en gras avec sa **description complète** en dessous, ainsi que l'**atténuation complète**, sur autant de lignes que nécessaire. Les adresses web de la description et de l'atténuation sont cliquables.

| Colonne | Affiche |
|---------|---------|
| **Risque** | Le titre, avec la description en dessous |
| **Score de risque** | Le score sous forme de puce colorée, avec *probabilité × impact* à côté (par exemple **20** *4 × 5*) |
| **Statut** | La puce de statut |
| **Responsable** | Le responsable du risque, ou un tiret |
| **Atténuation** | L'atténuation planifiée, ou un tiret |
| *(boutons)* | **Modifier** et **Supprimer** |

**Probabilité** et **Impact** sont aussi disponibles en colonnes distinctes ; elles sont masquées par défaut — activez-les dans l'onglet **Colonnes** du panneau de filtres.

- **Trier** — cliquez sur un en-tête de colonne. Tant que vous n'avez pas choisi votre propre tri, le score le plus élevé apparaît en premier.
- **Filtrer une colonne** — utilisez les filtres des en-têtes, comme sur les autres grilles.
- **Figer une colonne** — cliquez sur l'épingle de son en-tête pour la maintenir sur le bord gauche lors du défilement horizontal ; cliquez à nouveau pour la libérer.
- **Réorganiser les colonnes** — faites glisser un en-tête de colonne.
- **Menu de cellule** — faites un clic droit sur une cellule (appui long sur un appareil tactile) pour ouvrir le même menu contextuel que sur les autres grilles.

#### Panneau de filtres

Le panneau de gauche comporte deux onglets :

- **Filtres**
    - **Rechercher** — porte sur le titre, la description, l'atténuation et le responsable.
    - **Statut** — cochez une ou plusieurs puces de statut.
    - **Score de risque** — les tranches de score **Élevé** (15 ou plus), **Moyen** (6 à 14) et **Faible** (moins de 6).
    - **Responsable** — les responsables présents dans la liste, plus **Aucun responsable**.
    - **Effacer tous les filtres** réinitialise tous les filtres d'un coup.
- **Colonnes** — la liste **Ordre des colonnes** (faites glisser une ligne pour déplacer une colonne, utilisez son épingle pour la figer, **Réinitialiser l'ordre** pour rétablir l'ordre par défaut) et la liste **Colonnes visibles** pour afficher ou masquer des colonnes, avec **Tout sélectionner** pour afficher toutes les colonnes. La colonne Risque et les boutons sont toujours affichés. Dès que les colonnes visibles diffèrent de celles par défaut, **Réinitialiser** y revient : toutes les colonnes sauf Probabilité et Impact.

Le panneau se replie en un rail étroit, qui indique combien de filtres sont actifs, et son bord peut être déplacé pour le redimensionner. Sur un téléphone, le panneau est un tiroir, ouvert avec le bouton de filtre de la barre d'outils.

#### Barre d'outils

La barre d'outils indique combien de risques sont listés et propose :

- **Grouper par** — regroupe les lignes par **Statut**, **Responsable** ou **Tranche de score**.
- **Exporter** — télécharge les risques actuellement affichés au format `.xlsx` (voir ci-dessous).
- **Importer** — charge des risques depuis un `.xlsx` (voir ci-dessous).
- **Ajouter un risque** — ouvre la boîte de dialogue pour enregistrer un nouveau risque.

Le tri, les colonnes figées, l'ordre des colonnes, les colonnes visibles, la largeur du panneau et le regroupement sont mémorisés dans votre navigateur.

#### Exporter les risques vers Excel

**Exporter** télécharge les risques que la grille affiche actuellement — après les filtres du panneau, dans l'ordre de la grille — sous forme de `.xlsx` avec une ligne par risque et les colonnes **ID du risque**, **Titre du risque**, **Description**, **Probabilité**, **Impact**, **Score de risque**, **Statut**, **Responsable** et **Atténuation**. Le fichier est aussi un fichier d'import valide : exportez, modifiez dans Excel, puis réimportez-le.

#### Importer des risques depuis Excel {: #importing-risks }

**Importer** charge un `.xlsx` pour ajouter ou mettre à jour les risques de l'initiative. **Télécharger le modèle**, dans la boîte de dialogue, fournit un classeur avec les bons en-têtes et une ligne d'exemple.

- Une ligne portant un **ID du risque** issu d'un export **met à jour** ce risque, et uniquement les champs modifiés.
- Une ligne **sans ID du risque** **crée** un nouveau risque.
- Un ID du risque que l'initiative ne possède pas, ou utilisé deux fois dans le fichier, entraîne le **rejet** de la ligne.
- Les risques absents du fichier ne sont pas touchés : **l'import ne supprime jamais rien**.

Avant toute écriture, un aperçu classe chaque ligne comme **Nouveau**, **Mise à jour** (avec les champs qui changent), **Inchangé** ou **Rejeté** (avec la raison), et compte les avertissements. Les lignes rejetées sont ignorées ; le bouton importe les autres modifications. Un résultat indique ensuite combien de risques ont été créés, mis à jour ou sont en échec.

| Colonne | Règle |
|---------|-------|
| **Titre du risque** | Obligatoire |
| **Probabilité**, **Impact** | Un nombre entier de 1 à 5. Vide signifie 3 sur une nouvelle ligne et laisse la valeur inchangée lors d'une mise à jour |
| **Statut** | Ouvert, En atténuation, Atténué, Fermé ou Accepté. Vide signifie Ouvert sur une nouvelle ligne et laisse le statut inchangé lors d'une mise à jour |
| **Responsable** | Identifié par e-mail, puis par nom. Un responsable qui ne correspond à personne, ou à plusieurs personnes, donne un avertissement : la ligne est tout de même importée et le responsable reste inchangé |
| **Description**, **Atténuation**, **Responsable** | Une cellule vide efface le champ lors d'une mise à jour |
| **Score de risque**, toute autre colonne | Ignorée — le score est toujours calculé |

Les colonnes sont reconnues par leur en-tête dans votre langue ou en anglais. Une colonne absente du fichier reste inchangée sur chaque risque mis à jour.

### Onglet Tâches

![Tableau de tâches PPM](../assets/img/fr/45_ppm_tableau_taches.png)

Le gestionnaire de tâches prend en charge les vues **tableau Kanban** et **liste** avec quatre colonnes de statut :

- **À faire** — Tâches pas encore commencées
- **En cours** — Tâches en cours de réalisation
- **Terminé** — Tâches terminées
- **Bloqué** — Tâches qui ne peuvent pas progresser

Les tâches peuvent être filtrées et regroupées par élément de Structure de Découpage du Travail (WBS). En mode regroupé, chaque lot de travaux apparaît comme un groupe — y compris un lot qui ne contient encore aucune tâche, qui affiche une indication et un bouton **Ajouter une tâche** ouvrant la boîte de dialogue de tâche avec ce lot présélectionné. Les jalons n'apparaissent qu'une fois qu'ils contiennent une tâche. Glissez-déposez les tâches entre les colonnes pour mettre à jour le statut.

Les filtres d'affichage (mode de vue, filtre WBS, bascule de regroupement) sont conservés dans l'URL entre les actualisations de page.

### Onglet Gantt

![Diagramme de Gantt PPM](../assets/img/fr/46_ppm_gantt.png)

Le diagramme de Gantt visualise le calendrier du projet avec :

- **Lots de travaux (WBS)** — Éléments hiérarchiques de structure de découpage du travail avec dates de début/fin
- **Tâches** — Barres de tâches individuelles liées aux lots de travaux
- **Jalons** — Dates clés marquées par des indicateurs en losange
- **Barres de progression** — Pourcentage d'achèvement visuel. Une tâche n'a pas de pourcentage propre : son remplissage suit son statut — **À faire (0%)**, **En cours (50%)**, **Terminé (100%)**. Cliquez sur la pastille de pourcentage d'une tâche pour ouvrir un curseur dont les trois crans portent le nom de ces statuts ; choisir un cran change le statut, et faire glisser le remplissage sur la barre de la tâche fait de même. Un lot de travaux feuille dispose d'un curseur libre par pas de 5%. Les lots de travaux qui ont des lots de travaux enfants **ou des tâches** affichent une pastille en lecture seule dont la valeur est calculée automatiquement à partir du sous-arbre.
- **Repères trimestriels** — Grille de chronologie pour l'orientation

Interagir avec le diagramme de Gantt :

- **Cliquez sur un en-tête de colonne** (Titre, %, Responsable, Date de début ou Date de fin) pour trier la liste selon cette colonne : croissant au premier clic, décroissant au deuxième, puis retour à l'ordre prévu au troisième. Une flèche à côté de l'en-tête indique le tri actif. Les éléments sont triés parmi leurs frères et sœurs, de sorte qu'un lot de travaux ou une tâche imbriqué reste sous son parent. Les éléments sans responsable ou sans date propre passent en dernier dans les deux sens, et la ligne **+** reste en bas. Le choix est mémorisé dans votre navigateur. Sur téléphone, où seuls Titre et % sont affichés, seules ces deux colonnes sont triables
- **Sélecteur d'échelle** — Choisissez entre Jour, Semaine, Mois, Trimestre et Année ; le choix est mémorisé dans votre navigateur
- **Boutons +/− de zoom** — Naviguez d'un cran à la fois dans la même série de cinq échelles
- **Points aux extrémités des barres** — Glissez du point droit d'une barre vers le point gauche d'une autre pour créer une dépendance « finish-to-start ». Fonctionne entre lots de travaux et tâches dans toutes les combinaisons. Les cycles sont rejetés automatiquement. **Double-cliquez sur une flèche** pour la supprimer.
- **La ligne +** en bas de la liste demande quoi créer — un lot de travaux, un jalon ou une tâche — de sorte qu'une tâche saisie là atterrit dans l'onglet Tâches.

### Onglet Détails de la Carte

Le dernier onglet affiche la vue complète des détails de la fiche, y compris toutes les sections standard.

### Rapport d'initiative

![Rapport d'initiative PPM](../assets/img/fr/103_ppm_rapport_initiative.png)

Le bouton **Rapport** dans l'en-tête de l'initiative, à côté de la puce du sous-type (une icône sur un téléphone), ouvre le **Rapport d'initiative** : une page en lecture seule qui rassemble ce que montrent les onglets, mise en page comme les autres rapports, avec le nom de l'initiative pour titre et une flèche de retour pour revenir à l'initiative. Les puces **Sections** de la barre d'outils affichent ou masquent chaque section ; toutes sont affichées la première fois, et votre choix est mémorisé dans votre navigateur :

| Section | Ce qui est affiché |
|---------|--------------------|
| **Vue d'ensemble** | Des tuiles pour **Budget total**, **Réel total**, **Écart** et **Achèvement** ; le **Résumé de santé** avec les trois indicateurs du dernier rapport de statut, en couleur et en toutes lettres ; les barres **Finances** pour le total, CapEx et OpEx ; l'encadré **Chronologie** avec les dates de début et de fin, le sous-type et le statut d'initiative ; et la description. Les montants issus des initiatives sous-jacentes sont signalés, avec une note qui les explique |
| **Rapports de statut** | Le dernier rapport en entier, avec ses indicateurs, puis les rapports précédents dans un tableau avec la date, l'auteur et les indicateurs de santé |
| **Budget et coûts** | Des tuiles pour le budget total, le réel et l'écart, et pour les CapEx et OpEx dépensées par rapport à leur budget ; les graphiques **Dépenses dans le temps** pour l'exercice fiscal indiqué dans leur puce et pour le projet entier ; puis les tableaux **Budget prévu** et **Postes de coûts**, avec chaque exercice fiscal déplié |
| **Gestion des risques** | Des tuiles pour **Total des risques**, **Ouvert** et **Risques élevés** ; la **Carte thermique des risques** croisant probabilité et impact, chaque cellule colorée selon la tranche de score et indiquant combien de risques elle contient, à côté d'un décompte **Par statut** ; puis chaque risque avec son score (et probabilité × impact), son statut, son responsable, sa description complète et son atténuation complète, le score le plus élevé en premier |
| **Tâches et planning** | Un tableau des lots de travail, chacun avec ses tâches en dessous, puis les tâches sans lot de travail, à côté d'une frise chronologique sur une échelle trimestrielle : une barre pour chaque lot de travail, remplie selon son achèvement, une barre pour chaque tâche dans la couleur de son statut, un losange pour un jalon (comme sur le diagramme de Gantt), un point pour un élément n'ayant qu'une seule date, et une ligne pour aujourd'hui lorsqu'il se trouve dans la période. Chaque ligne indique aussi son avancement ou son statut et sa priorité, et une légende explique les repères |

Pour imprimer le rapport ou l'enregistrer en PDF, utilisez le bouton **Imprimer / Enregistrer en PDF** de la barre de titre, comme pour tout rapport ; il ouvre la boîte de dialogue d'impression du navigateur, ou la feuille d'impression de Safari sur un iPhone ou un iPad, où vous pouvez aussi enregistrer en PDF. La page s'imprime en paysage, sans la barre d'outils ni la navigation de l'application, avec ses graphiques au format d'impression, et une ligne sous le titre indique le sous-type, le statut d'initiative, les dates de début et de fin et le moment où le rapport a été imprimé. Une section dans laquelle rien n'a été enregistré l'indique.

Pour reprendre le rapport dans une présentation, choisissez **Exporter vers PowerPoint (.pptx)** dans le menu **⋮** de la barre de titre. Le diaporama s'ouvre sur une diapositive de titre indiquant le nom de l'initiative, sa date de génération, ainsi que son sous-type, son statut et ses dates de début et de fin. Chaque section affichée sur la page suit sur sa propre diapositive, titrée du nom de la section, sous forme d'image de la section telle que vous la voyez ; une section longue se poursuit sur d'autres diapositives (« Budget et coûts — Page 2 / 3 »), et un tableau qui continue répète sa ligne d'en-tête. Le diaporama suit les puces **Sections** : une section que vous avez masquée, ou dans laquelle rien n'a été enregistré, est omise. Pendant la création du diaporama, le bouton du menu affiche un indicateur de chargement ; si l'export échoue, un message l'indique et vous pouvez réessayer.

Pour diffuser un **rapport de risques**, affichez uniquement **Gestion des risques**.

## Structure de Découpage du Travail (WBS)

La WBS fournit une décomposition hiérarchique du périmètre du projet :

- **Lots de travaux** — Regroupements logiques de tâches avec dates de début/fin et suivi de l'achèvement
- **Jalons** — Événements significatifs ou points d'achèvement
- **Hiérarchie** — Relations parent-enfant entre les éléments WBS
- **Auto-achèvement** — L'achèvement est calculé automatiquement à partir des tâches du sous-arbre d'un lot de travaux : chaque tâche compte pour 0% (À faire, Bloqué), 50% (En cours) ou 100% (Terminé), pondérée par sa durée en jours (un jour lorsqu'une date manque), puis cumulé récursivement jusqu'aux éléments parents. Un lot de travaux sans aucune tâche en dessous conserve la valeur saisie à la main. La moyenne des lots de travaux de premier niveau est la progression globale de l'initiative — le chiffre de l'onglet Vue d'ensemble, et la variable `ppm.completion` qu'un [champ calculé](../admin/calculations.md#ppm-data-on-initiative-cards) peut afficher sur la fiche et dans un portail

## Intégration avec les détails de la fiche

Lorsque le PPM est activé, les fiches **Initiative** affichent un onglet **PPM** en dernière position dans la [vue détaillée de la fiche](card-details.md). Cliquer sur cet onglet ouvre directement la vue détaillée PPM de l'initiative (onglet Aperçu). Cela offre un point d'accès rapide depuis n'importe quelle fiche Initiative vers sa page de projet PPM complète.

Inversement, l'onglet **Détails de la fiche** dans la vue détaillée PPM de l'initiative affiche les sections standard sans l'onglet PPM, évitant ainsi une navigation circulaire.

## Permissions

| Permission | Description |
|-----------|-------------|
| `ppm.view` | Voir le tableau de bord PPM, le diagramme de Gantt et les rapports d'initiatives, et lire les fiches d'initiative. Accordé à tous les rôles par défaut |
| `ppm.manage` | Créer et gérer les rapports de statut, tâches, coûts, risques et éléments WBS. Accordé aux rôles Admin, Admin BPM et Membre |
| `reports.ppm_dashboard` | Voir le tableau de bord du portefeuille PPM. Accordé à tous les rôles par défaut |
