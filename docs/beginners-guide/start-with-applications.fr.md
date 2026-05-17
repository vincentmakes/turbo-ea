# Commencez par votre inventaire applicatif

Turbo EA est livré avec 13 types de fiches d'office. Vous serez tenté de tous les peupler. Ne le faites pas.

**Commencez par les Applications.** Les Applications sont le type de fiche au plus fort effet de levier dans tout premier déploiement :

- Elles sont les plus faciles à sourcer — les départements IT disposent presque toujours d'une liste quelque part (CMDB, suivi de licences, système financier, voire un tableur).
- Elles ancrent toutes les autres couches — une fois les Applications en place, la cartographie vers les Capacités, les Processus et les Composants IT devient un enrichissement incrémental plutôt qu'un exercice ex nihilo.
- Elles alimentent le premier rapport utile (Rationalisation du portefeuille) avec le moins de dépendances.

Les autres types de fiches viendront plus tard. Une deuxième vague courante est constituée des capacités métier (page 4), puis des Interfaces ou Objets de données.

## À quoi ressemble le « minimum viable »

Pour chaque fiche Application de votre périmètre initial, peuplez ces champs et **uniquement** ces champs :

| Champ | Pourquoi c'est important | D'où il provient |
|-------|--------------------------|------------------|
| **Nom** | L'identité. Utilisez le nom que les gens utilisent réellement, pas l'intitulé de licence. | Votre source existante |
| **Description** | Une phrase : à quoi sert cette appli pour le métier ? | Interview du propriétaire, ou suggestion IA (voir [Inventaire](../guide/inventory.md#ai-description-suggestions)) |
| **Phase de cycle de vie** | Plan / Phase In / Active / Phase Out / End of Life | CMDB, ou interview du propriétaire |
| **Business Owner** (partie prenante) | La personne responsable de l'appli | Organigramme |
| **Coût — Total annuel** | Utilisé par le Rapport de portefeuille et la formule TIME | Finance, ou estimation approximative |

Cinq champs. C'est tout. L'anneau de Qualité de données affichera environ 50 % et c'est très bien — vous affinerez au second passage.

!!! warning "À éviter"
    N'essayez pas de remplir la **date de fin de vie**, le **Fournisseur**, la **pile technologique** et 12 champs personnalisés au premier passage. Vous craquerez vers la fiche 30.

## Trois façons de peupler l'inventaire

Choisissez le chemin qui correspond à votre source de données. Vous pouvez les combiner — importer le gros volume, puis corriger manuellement la longue traîne.

### Chemin A — Import Excel / CSV (recommandé pour la plupart des démarrages)

Si vos applications sont dans un tableur (ou si vous pouvez les exporter d'une CMDB), c'est le chemin le plus rapide. **Ne commencez pas par fabriquer la feuille à la main** — laissez Turbo EA vous fournir le modèle.

1. **Créez d'abord une fiche Application factice manuellement**. Allez dans **Inventaire → + Créer**, Type = `Application`, nommez-la par exemple *« _TEMPLATE — à supprimer »*. Remplissez les cinq champs minimums (description, cycle de vie, responsable, coût) afin que l'export contienne des valeurs réelles servant d'exemple.
2. **Filtrez l'inventaire sur Type = `Application`** et cliquez sur **Export** dans la barre d'outils. Vous obtenez un fichier `.xlsx` contenant une ligne de données réelles et une colonne par champ — c'est votre modèle. Les en-têtes de colonnes correspondent aux clés de champ attendues par l'importateur.
3. **Modifiez la feuille hors ligne** : conservez la structure des colonnes, remplacez la ligne unique par l'ensemble de vos applications réelles et supprimez la ligne factice à la fin (ou laissez-la — vous supprimerez la fiche de Turbo EA après l'import).
4. **Importez le fichier modifié** : **Inventaire → Import**, glissez-déposez le `.xlsx`. Le rapport de validation vous montre exactement quelles lignes créeront de nouvelles fiches, lesquelles mettront à jour des fiches existantes (appariées par nom ou ID) et lesquelles échoueront.
5. Lancez l'import, puis archivez la fiche `_TEMPLATE`.

Référence complète : [Inventaire → Import Excel](../guide/inventory.md#excel-import).

**Astuce pour le premier import :** incluez uniquement les cinq champs minimums, plus une colonne pour l'e-mail de l'Application Owner (l'importateur tentera de l'apparier avec les utilisateurs existants). Laissez le reste de côté. Vous pourrez faire un second import plus tard avec davantage de colonnes en répétant la boucle export-édition-import.

### Chemin B — Synchronisation ServiceNow

Si vous disposez d'une CMDB ServiceNow et d'un accès admin à son API, l'intégration tire directement les enregistrements d'Applications.

1. Allez dans **Admin → ServiceNow Integration**.
2. Créez une connexion (URL, identifiants — les identifiants sont stockés chiffrés).
3. Définissez un mapping : ServiceNow `cmdb_ci_business_app` → Turbo EA `Application`, avec des règles au niveau des champs.
4. Lancez une synchronisation **pull**. Par défaut, les enregistrements arrivent dans une zone de **staging** pour revue par l'administrateur avant application.

Voir [Admin → ServiceNow Integration](../admin/servicenow.md) pour la configuration complète. Considérez la première synchronisation comme exploratoire — examinez ce qui est arrivé, affinez le mapping, puis lancez-la pour de vrai.

### Chemin C — Saisie manuelle

Pour les petits parcs (moins d'environ 30 applis) ou lorsqu'aucune source utilisable n'existe :

1. **Inventaire** → **+ Créer** (en haut à droite).
2. Type = **Application**, remplissez Nom et (éventuellement) Description.
3. Cliquez sur **Suggérer avec l'IA** si vous souhaitez une description initiale tirée d'une recherche web.
4. Enregistrez et passez à la suivante. Vous remplirez le reste depuis la page de détail de la fiche.

La saisie manuelle est lente mais produit les données de plus haute qualité, car chaque fiche est touchée par son propriétaire à la saisie.

## Utilisez le workflow d'approbation comme barrière qualité

Chaque fiche porte un **Statut d'approbation** : Brouillon → Approuvée → (Cassée si modifiée substantiellement après approbation).

Un workflow pratique :

1. Les nouvelles fiches arrivent en **Brouillon**. L'Architecte (vous) effectue une revue rapide — nom correct, description sensée, cycle de vie juste.
2. Une fois les champs minimums remplis, **approuvez** la fiche. Cela signale aux consommateurs en aval que la fiche est fiable.
3. Si quelqu'un édite ensuite un champ substantiel, Turbo EA bascule automatiquement le statut en **Cassée** jusqu'à ré-approbation.

Filtrez l'inventaire par `Statut d'approbation = Approuvée` pour obtenir une vue propre destinée au rapport de portefeuille à la fin de ce guide.

!!! tip "Bonne pratique"
    Approuvez par lots en fin de journée. Cela vous oblige à relire ce que vous avez importé et à détecter tôt les pires problèmes de qualité.

## Quand arrêter le peuplement et passer à la suite

Vous en avez terminé avec cette page lorsque :

- Chaque application de votre périmètre a une fiche.
- Chaque fiche a ses cinq champs minimums remplis.
- La qualité moyenne sur l'ensemble est **≥ 40 %**.
- Au moins 50 % des fiches sont approuvées.

N'attendez pas la perfection. Passez à la page suivante — [Tirez parti des catalogues de référence](leverage-reference-catalogues.md) — et revenez enrichir après avoir cartographié les capacités.
