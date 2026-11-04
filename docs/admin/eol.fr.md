# Gestion de la fin de vie (EOL)

La page d'administration **EOL** (**Admin > Paramètres > EOL**) vous aide à suivre les cycles de vie des produits technologiques en liant vos fiches à la base de données publique [endoflife.date](https://endoflife.date/)

![Administration EOL](../assets/img/fr/29_admin_parametres_eol.png)

## Pourquoi suivre les EOL ?

Savoir quand les produits technologiques atteignent la fin de vie ou la fin de support est essentiel pour :

- **Gestion des risques** -- Les logiciels non supportés représentent un risque de sécurité
- **Planification budgétaire** -- Planifier les migrations et les mises à niveau avant la fin du support
- **Conformité** -- De nombreuses réglementations exigent des logiciels supportés

## Recherche en masse

La fonctionnalité de recherche en masse analyse vos fiches **Application** et **Composant IT** et trouve automatiquement les produits correspondants dans la base de données endoflife.date.

### Lancer une recherche en masse

1. Naviguez vers **Admin > Paramètres > EOL**
2. Sélectionnez le type de fiche à analyser (Application ou Composant IT)
3. Cliquez sur **Rechercher**
4. Le système effectue une **correspondance approximative** avec le catalogue de produits endoflife.date

### Examen des résultats

Pour chaque fiche, la recherche retourne :

- **Score de correspondance** (0-100%) -- À quel point le nom de la fiche correspond à un produit connu
- **Nom du produit** -- Le produit endoflife.date correspondant
- **Versions/cycles disponibles** -- Les versions du produit avec leurs dates de support

### Filtrage des résultats

Utilisez les contrôles de filtre pour vous concentrer sur :

- **Tous les éléments** -- Chaque fiche analysée
- **Non liés uniquement** -- Fiches pas encore liées à un produit EOL
- **Déjà liés** -- Fiches qui ont déjà un lien EOL

Un résumé statistique affiche : nombre total de fiches analysées, déjà liées, non liées et correspondances trouvées.

### Lier les fiches aux produits

1. Examinez la correspondance suggérée pour chaque fiche
2. Sélectionnez la bonne **version/cycle du produit** dans la liste déroulante
3. Cliquez sur **Lier** pour sauvegarder l'association

Une fois liée, la page de détail de la fiche affiche une **section EOL** avec :

- **Nom du produit et version**
- **Statut de support** -- Code couleur : Supporté (vert), Approchant la fin de vie (orange), Fin de vie (rouge)
- **Dates clés** -- Date de sortie, fin du support actif, fin du support sécurité, date de fin de vie

## Produits EOL personnalisés

endoflife.date suit les logiciels courants, mais pas tout ce que vous exploitez : une plateforme interne, un outil spécialisé d'un fournisseur ou une appliance sous licence n'y figurent souvent pas. Pour ceux-là, définissez un **produit EOL personnalisé** — votre propre produit, avec ses propres cycles de publication — et liez-y des fiches exactement comme vous le feriez avec un produit endoflife.date. Les produits personnalisés alimentent le même statut de fiche, la colonne **Fin de vie** de l'inventaire, le [rapport EOL](../guide/reports.md) et les indicateurs de qualité des données.

Les produits personnalisés sont listés dans l'onglet **Produits personnalisés** de **Admin > Paramètres > EOL**. Leur création et leur modification exigent la permission **Gérer l'EOL** (`eol.manage`) ; toute personne pouvant consulter les données EOL peut les voir.

![Produits EOL personnalisés](../assets/img/fr/29b_admin_parametres_eol_personnalises.png)

### Créer un produit personnalisé

Il y a deux façons d'en créer un :

- **Depuis une fiche** — dans la section **Fin de vie** de la fiche, recherchez le produit. Lorsque endoflife.date n'a aucune correspondance, la section propose **Créer un produit personnalisé**, prérempli avec ce que vous avez saisi (ou le nom de la fiche). Saisissez le nom du produit et ses premiers cycles, puis enregistrez : la fiche est alors liée en une seule fois au nouveau produit et au nouveau cycle.
- **Depuis l'onglet Produits personnalisés** — cliquez sur **Ajouter un produit**.

Chaque produit comporte :

- **Nom du produit** — la façon dont il est affiché partout.
- **Clé** — un court identifiant en minuscules (lettres, chiffres, points, tirets, tirets bas) proposé à partir du nom. Les liens des fiches la mémorisent, elle **ne peut donc plus être modifiée** après la création.
- **Lien du fournisseur ou de la politique de publication** et **Description** — facultatifs.
- **Cycles de publication** — chacun avec un nom (par exemple `2.4`), une **Date de publication**, une fin de **Support actif**, une **Fin de vie** et, facultativement, la **Dernière version** et sa date de publication.

Le support actif et la fin de vie acceptent chacun une **date**, ou l'une de deux réponses lorsqu'aucune date n'est connue : *Toujours pris en charge* / *Support actif terminé*, et *Aucune fin de vie annoncée* / *Déjà en fin de vie*. Le statut (Pris en charge, Approche de l'EOL, Fin de vie) en est déduit avec la même règle que pour les produits endoflife.date.

### Gérer les cycles dans la grille

L'onglet Produits personnalisés affiche une ligne par cycle de publication, regroupée par produit. Il fonctionne comme les autres grilles : figer et réorganiser les colonnes, les afficher ou les masquer, et filtrer par produit, statut ou utilisation depuis le panneau de gauche. La colonne **Fiches liées** indique combien des fiches que vous pouvez voir utilisent chaque cycle.

Cliquez sur **Modifier dans la grille** pour changer les cellules directement. Les dates et les réponses de support ouvrent un petit éditeur, et vous pouvez faire glisser la valeur d'une cellule vers le bas d'une colonne (comme dans Excel) pour la copier sur plusieurs cycles. Le menu de ligne (**⋮**) ajoute un cycle au produit, modifie le nom, le lien et la description du produit, ou supprime un cycle ou le produit.

Un produit ne peut pas être supprimé tant que des fiches y sont liées. Supprimer un cycle utilisé par des fiches laisse leur statut de fin de vie **inconnu** jusqu'à ce que quelqu'un choisisse un autre cycle. Renommer un cycle déplace avec lui les fiches qui y sont liées.

Vous pouvez aussi ajouter un cycle manquant depuis une fiche : une fois un produit personnalisé sélectionné dans la section Fin de vie de la fiche, la liste des cycles se termine par **Ajouter un cycle…**.

### Proposer un produit personnalisé à endoflife.date

Si un produit personnalisé est un produit public d'un fournisseur, envisagez de le proposer à endoflife.date pour que tout le monde en profite. Choisissez **Proposer à endoflife.date** dans le menu de ligne :

1. Lisez l'avertissement : proposer un produit publie son nom et ses dates. Ne proposez jamais de produits internes ou confidentiels.
2. Choisissez la **catégorie** endoflife.date. La boîte de dialogue affiche un aperçu du fichier produit au format d'endoflife.date (`products/<key>.md`).
3. Cliquez sur **Ouvrir sur GitHub**. GitHub ouvre un nouveau fichier dans le dépôt endoflife.date avec le contenu prérempli (il propose de dupliquer le dépôt si vous ne pouvez pas y écrire). Complétez la description et le résumé de la politique de publication, puis ouvrez la pull request depuis votre propre compte GitHub. Pour les fichiers longs, utilisez plutôt **Copier le fichier** et collez-le dans un nouveau fichier.

Turbo EA n'envoie jamais rien à GitHub lui-même et ne stocke aucun identifiant GitHub. endoflife.date examine chaque proposition selon son [guide de contribution](https://github.com/endoflife-date/endoflife.date/blob/master/CONTRIBUTING.md).

### Basculer vers endoflife.date

Lorsque endoflife.date commence à suivre un produit que vous aviez gardé comme personnalisé, la grille affiche à côté une indication **Sur endoflife.date**. Cliquez sur cette indication, ou choisissez **Basculer vers un produit endoflife.date…** dans le menu de ligne :

1. Choisissez le produit endoflife.date.
2. Pour chacun de vos cycles, choisissez le cycle endoflife.date vers lequel ses fiches doivent passer (les cycles de même nom sont associés automatiquement), ou conservez-le sur le produit personnalisé.
3. Vous pouvez éventuellement supprimer le produit personnalisé dès qu'aucune fiche n'y est plus liée.

Seules les fiches que vous pouvez voir sont déplacées. Les dates de cycle de vie des fiches ne sont jamais modifiées.

## Rapport EOL

Les données EOL liées alimentent le [Rapport EOL](../guide/reports.md), qui fournit une vue tableau de bord du statut de support de votre paysage technologique sur toutes les fiches liées.

## Trouver ce qui n'est pas encore lié

Deux endroits hors de cette page listent les fiches sans aucune information de fin de vie — ni lien ici, ni date de fin de vie propre :

- Le filtre et la colonne **Fin de vie** de l'[Inventaire](../guide/inventory.md) — choisissez un type de fiche, puis la pastille **(vide)**.
- L'indicateur **Aucune donnée de fin de vie** du [Rapport EOL](../guide/reports.md) et le graphique **Couverture de fin de vie** en fin de rapport Qualité des données.
