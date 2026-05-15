# Tirez parti des catalogues de référence

L'erreur classique à ce stade : passer trois semaines à co-construire un modèle de capacités métier sur mesure, deux semaines de plus à l'aligner avec les dirigeants, puis découvrir que le modèle est à 80 % identique à celui que toutes les autres entreprises de votre secteur utilisent.

**Ne modélisez pas à partir de zéro.** Turbo EA est livré avec trois catalogues curés qui vous donnent un point de départ éprouvé que vous pouvez adapter en quelques jours au lieu de plusieurs mois :

- **Catalogue de capacités métier** — hiérarchies de capacités à plusieurs niveaux par secteur (banque, retail, industrie, assurance, secteur public, etc.) plus des capacités macro inter-sectorielles.
- **Catalogue de processus** — processus métier de référence par secteur, prêts à être importés comme fiches `BusinessProcess`.
- **Catalogue de chaînes de valeur** — chaînes de valeur de bout en bout pour encadrer la carte des capacités.

Cette page se concentre sur le Catalogue de capacités métier, car c'est celui qui alimente la Carte thermique des capacités sur la dernière page. Les deux autres fonctionnent de la même manière.

## Pourquoi commencer par les capacités

Une **capacité métier** correspond à *ce que fait le métier*, exprimé dans un langage stable et indépendant de la technologie — « Gestion des commandes », « Onboarding client », « Gestion des sinistres ». Les capacités changent à peine au fil des années ; les applications, elles, changent en permanence. C'est pourquoi le mapping application-vers-capacité est la relation la plus utile de tout le métamodèle :

- Il vous permet de demander **« combien d'applications soutiennent l'Onboarding client ? »** — et de repérer la redondance.
- Il vous permet de demander **« quelles capacités dépendent d'une unique application vieillissante ? »** — et de repérer la fragilité.
- Il survit aux réorganisations, aux changements de fournisseur et aux migrations cloud.

Vous n'avez pas besoin de 500 capacités pour en tirer de la valeur. Vous avez besoin de **20 à 60 capacités, sur deux ou trois niveaux de profondeur**, sur votre périmètre.

## Importez une carte des capacités de départ

1. Naviguez vers **Capability Catalogue** dans le menu principal (sous User Guide).
2. Utilisez les filtres en haut :
    - **Industrie** — choisissez la vôtre (ou « Cross-industry » si rien ne correspond).
    - **Niveau** — commencez avec L1 et L2 visibles. Vous pourrez toujours descendre plus tard.
3. Parcourez l'arbre. Dépliez quelques branches pour vous faire une idée de la profondeur.
4. Cochez les capacités que vous souhaitez importer. **La sélection cascade** : cocher un L1 coche ses descendants ; cocher un L2 coche également son ancêtre L1 pour que la hiérarchie reste connectée.
5. Cliquez sur **Créer des fiches depuis la sélection**.

Turbo EA crée une fiche `BusinessCapability` par nœud coché, préserve la hiérarchie parent-enfant et estampille chaque fiche avec un `catalogueId` stable, ce qui rend les ré-imports **idempotents** — lancer l'import deux fois ne crée pas de doublons.

Référence complète : [Catalogue des capacités](../guide/capability-catalogue.md).

!!! tip "Bonne pratique"
    Choisissez un sous-arbre, pas le catalogue complet. Pour une Rationalisation du portefeuille applicatif dans le domaine Ventes, importer la capacité L1 « Sales & Customer Management » plus ses enfants L2 suffit généralement — soit 10 à 15 capacités, pas 300.

## Jusqu'à quelle profondeur descendre

La bonne profondeur dépend de ce que vous en ferez :

| Profondeur | Quand l'utiliser | Nombre de fiches typique |
|------------|------------------|--------------------------|
| **L1 uniquement** | Synthèses pour la direction, très petits périmètres | 8–12 |
| **L1 + L2** | Le bon dosage pour un premier déploiement — lisible en un écran, utile dans les rapports | 30–60 |
| **L1 + L2 + L3** | Planification par capacités détaillée, grandes entreprises | 100–250 |
| **L4 et au-delà** | Approfondissements spécifiques, pas pour une baseline de départ | variable |

Visez **L1 + L2** pour votre premier passage. Vous pourrez toujours importer des niveaux supplémentaires plus tard via le même catalogue — le ré-import idempotent les insérera sous les parents existants.

## Un mot sur les processus et les chaînes de valeur

Le **Catalogue de processus** et le **Catalogue de chaînes de valeur** fonctionnent de la même manière : filtrer, cocher, créer en masse. Si votre premier cas d'usage est la Rationalisation du portefeuille applicatif, vous pouvez les laisser de côté pour l'instant — la cartographie des capacités suffit à piloter l'analyse de la dernière page.

Vous les voudrez quand :

- Vous passerez de « rationaliser les applications » à « optimiser la chaîne de valeur order-to-cash ».
- Vous commencerez à construire des flux de processus BPMN sur les fiches `BusinessProcess` résultantes (voir [BPM](../guide/bpm.md)).

## Et si mon secteur n'est pas dans le catalogue ?

Deux options :

1. **Choisissez le secteur le plus proche** et élaguez. Les entrées « Cross-industry » (Finance, RH, IT, Achats) s'appliquent à pratiquement toutes les entreprises.
2. **Combinez les catalogues** — importez d'abord « Cross-industry », puis complétez avec quelques éléments d'un catalogue sectoriel spécifique.

Dans tous les cas, **importez d'abord, personnalisez ensuite**. Renommer une capacité importée ou ajouter un enfant est bien plus rapide que taper toute la structure de zéro. Et vous conservez le `catalogueId` afin que les futures mises à jour de catalogue se fusionnent proprement.

!!! warning "À éviter"
    Ne créez pas de types de fiches personnalisés pour les capacités ou les processus juste pour « les rendre vôtres ». Les types intégrés viennent avec les bons champs, les bons types de relations et les bons rapports — leurs équivalents personnalisés non.

## Vérifiez avant de passer à la suite

Vous en avez terminé avec cette page lorsque :

- La carte des capacités pour votre périmètre existe dans l'inventaire (filtrez par Type = `Business Capability`).
- La hiérarchie est intacte — ouvrez quelques capacités L2 et vérifiez que le fil d'Ariane parent affiche le bon L1.
- Le nombre de capacités est compris entre 20 et 60.

Vous n'avez encore mappé aucune application aux capacités — ce sera l'objet de la dernière page. D'abord, ajoutons un champ personnalisé aux Applications pour rendre l'analyse vraiment utile.

Suite : [Personnalisez le métamodèle — légèrement](customise-the-metamodel.md).
