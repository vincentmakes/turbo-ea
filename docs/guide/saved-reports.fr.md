# Rapports sauvegardés

Turbo EA vous permet de **sauvegarder des configurations de rapports** afin de pouvoir revenir rapidement à des vues spécifiques sans reconfigurer les filtres et les axes à chaque fois.

## Sauvegarder un rapport

Depuis n'importe quelle page de rapport (Portefeuille, Carte de capacités, Cycle de vie, Dépendances, Coûts, Matrice, Qualité des données ou EOL) :

1. Configurez le rapport avec les filtres, regroupements et selections d'axes souhaites
2. Cliquez sur le bouton **Sauvegarder** dans la barre d'outils du rapport
3. Entrez un **nom** pour le rapport sauvegarde
4. Choisissez la **visibilité** :

| Visibilité | Qui peut le voir |
|------------|-----------------|
| **Prive** | Vous seul |
| **Partage** | Vous et les utilisateurs spécifiques que vous sélectionnez |
| **Public** | Tous les utilisateurs de la plateforme |

Pour les rapports partages, vous pouvez accorder des **permissions de modification** à des utilisateurs spécifiques, leur permettant de mettre à jour la configuration sauvegardée.

5. Cliquez sur **Sauvegarder** -- une miniature est automatiquement capturee à partir de la visualisation actuelle

## Galerie de rapports sauvegardés

Naviguez vers **Rapports > Rapports sauvegardés** pour parcourir tous les rapports sauvegardés auxquels vous avez acces. La galerie affiche des apercos en miniature organises en onglets :

- **Mes rapports** -- Rapports que vous avez créés
- **Partages avec moi** -- Rapports que d'autres ont partages avec vous
- **Publics** -- Rapports visibles par tous

### Actions

- **Ouvrir** -- Cliquer sur un rapport pour le charger avec la configuration sauvegardée
- **Modifier** -- Mettre à jour le nom, la visibilité ou les paramètres de partage
- **Dupliquer** -- Créer une copie avec un nouveau nom
- **Supprimer** -- Supprimer le rapport sauvegarde (seul le créateur ou les utilisateurs avec des permissions de modification peuvent supprimer)

## Rapports personnalisés avec votre assistant IA

Au-delà des types de rapports intégrés, Turbo EA peut créer des **rapports entièrement personnalisés** à partir d'une description en langage naturel, à l'aide d'un assistant IA connecté via le **serveur MCP**.

### Comment ça marche

1. Connectez le serveur MCP de Turbo EA à votre assistant IA (par exemple Claude Code) — voir le guide **Intégration MCP**.
2. Décrivez le rapport souhaité en langage naturel, par exemple *« Compter les applications par criticité métier sous forme de camembert »* ou *« Coût annuel total des composants informatiques regroupés par fournisseur »*.
3. L'assistant appelle `get_report_builder_schema` pour lire votre métamodèle en direct (types de cartes, champs, relations, étiquettes), assemble une **spécification** de rapport sûre et la prévisualise sur vos données réelles avec `preview_custom_report` — vous voyez donc de vrais résultats avant tout enregistrement.
4. Lorsque le résultat vous convient, l'assistant **publie** le rapport avec `create_saved_report`. Il apparaît dans la galerie **Rapports enregistrés** et s'ouvre comme un rapport natif et interactif.

### Ce que permettent les rapports personnalisés

- **Conscient du métamodèle** : vos types de cartes, sous-types, champs, relations et étiquettes sont reflétés automatiquement — sans programmation.
- **Regrouper et agréger** : regrouper par attribut, sous-type, phase de cycle de vie, groupe d'étiquettes ou carte liée, et mesurer avec le nombre, la somme, la moyenne, le minimum ou le maximum.
- **Filtrer et parcourir** : filtrer les cartes sources et, en option, suivre un saut de relation vers les cartes liées.
- **De nombreuses visualisations** : afficher sous forme de tableau, de graphique à barres/colonnes/secteurs/anneau/nuage de points/treemap/courbes, ou de tuiles KPI.
- **Sûr et gouverné** : les rapports sont en lecture seule, fonctionnent entièrement sur des règles déclaratives (pas de code, pas de SQL), et les champs de coût restent derrière l'autorisation **Voir les coûts** — exactement comme tout autre rapport.

Les rapports personnalisés sont enregistrés comme n'importe quel autre rapport ; les mêmes options de visibilité et de partage (privé / partagé / public) s'appliquent.

### Le créer à la main

L'assistant IA n'est pas obligatoire. Ouvrez **Rapports > Rapports enregistrés**, créez un rapport personnalisé et cliquez sur **Créer un rapport** pour ouvrir un éditeur visuel : choisissez un type de carte, ajoutez des filtres, définissez le regroupement (dimensions) et les mesures, puis sélectionnez un type de graphique. Un aperçu en direct se met à jour ; cliquez sur **Enregistrer** pour publier.
