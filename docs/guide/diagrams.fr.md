# Diagrammes

Le module **Diagrammes** vous permet de créer des **diagrammes d'architecture visuels** en utilisant un éditeur [DrawIO](https://www.drawio.com/) intégré -- entièrement connecté à votre inventaire de fiches. Glissez des fiches sur le canevas, reliez-les par des relations, descendez dans les hiérarchies, et recolorez selon n'importe quel attribut -- le diagramme reste synchronisé avec vos données EA.

![Galerie de diagrammes](../assets/img/fr/16_diagrammes.png)

## Galerie de diagrammes

La galerie présente chaque diagramme sous forme de carte compacte avec une miniature, un nom, un auteur et le nombre de cartes référencées. **Créez**, **Ouvrez**, **Modifiez les détails**, organisez ou **Supprimez** n'importe quel diagramme.

### Trouver des diagrammes

- **Barre latérale de filtres** — le volet de gauche restreint la galerie à **Tous les diagrammes**, **Créés par moi** ou vos **Favoris**. Le chevron permet de la réduire en une fine barre ; sur petits écrans, le bouton **Filtres** l'ouvre en panneau coulissant.
- **Recherche** — le champ de recherche correspond au nom d'un diagramme, à son auteur et aux noms des cartes qui y sont dessinées, afin de retrouver un diagramme par son contenu.
- **Tri** — par récemment mis à jour, récemment créé ou nom.
- **Favoris** — cliquez sur l'étoile d'une carte pour l'ajouter à vos favoris personnels ; le filtre **Favoris** les affiche tous.

### Groupes

Regroupez les diagrammes associés dans des **groupes** — des étiquettes partagées à l'échelle de l'espace de travail. Un diagramme peut appartenir à plusieurs groupes à la fois. En vue carte, la galerie affiche chaque groupe sous forme d'en-tête repliable ; les diagrammes non affectés apparaissent sous **Non groupé**.

- Utilisez **Gérer les groupes** dans la barre latérale pour créer, renommer, recolorer ou supprimer des groupes.
- Utilisez **Ajouter à des groupes…** depuis le menu d'un diagramme pour le placer dans un ou plusieurs groupes (vous pouvez créer un nouveau groupe au passage).
- Sélectionner un groupe dans la barre latérale filtre la galerie sur ce seul groupe.


## L'éditeur de diagrammes

Ouvrir un diagramme lance l'éditeur DrawIO plein écran dans une iframe de même origine. La barre d'outils native de DrawIO est disponible pour les formes, connecteurs, texte et mise en page -- chaque action propre à Turbo EA est exposée via le menu contextuel (clic droit), le bouton Sync de la barre d'outils, et la pastille en chevron qui surmonte chaque fiche.

### Insertion de fiches

Utilisez le dialogue **Insérer des fiches** (depuis la barre d'outils ou le menu contextuel) pour ajouter des fiches au canevas :

- Les **puces de types avec compteurs en direct** dans le rail gauche filtrent les résultats.
- Recherchez par nom dans le rail droit ; chaque ligne porte une case à cocher.
- **Insérer la sélection** ajoute les fiches choisies en grille ; **Tout insérer** ajoute toutes les fiches du filtre actif (avec une confirmation au-delà de 50 résultats).

Le même dialogue s'ouvre en mode sélection unique pour **Changer la fiche liée** et **Lier à une fiche existante**.

Chaque fiche sur le canevas affiche son **icône de type de fiche** sous la forme d'un petit glyphe blanc dans le coin supérieur gauche, à côté de la couleur du type — le type d'une fiche est ainsi indiqué à la fois par l'icône et par la couleur. Cela correspond aux icônes utilisées dans toute l'application et améliore la lisibilité pour les utilisateurs daltoniens. L'icône apparaît sur les fiches insérées à partir de maintenant. Pour ajouter des icônes aux fiches déjà présentes sur un diagramme plus ancien, cliquez sur **Appliquer les icônes de type de fiche** dans la barre d'outils de l'éditeur.

### Actions du clic droit

- **Fiches synchronisées** : *Ouvrir la fiche*, *Changer la fiche liée*, *Délier la fiche*, *Retirer du diagramme*.
- **Formes simples / cellules déliées** : *Lier à une fiche existante*, *Convertir en fiche* (conserve la géométrie, transforme la forme en fiche en attente avec son libellé), *Convertir en conteneur* (transforme la forme en swimlane pour y imbriquer d'autres fiches).

### Le menu d'expansion

Chaque fiche synchronisée porte une petite pastille en chevron. Un clic ouvre un menu avec trois sections, chacune chargée en un seul aller-retour :

- **Afficher les dépendances** -- voisins via relations sortantes ou entrantes, groupés par type de relation avec compteurs. Chaque ligne est une case à cocher ; validez avec **Insérer (N)**.
- **Descente (Drill-Down)** -- transforme la fiche courante en conteneur swimlane avec ses enfants `parent_id` imbriqués. Choisissez les enfants à inclure ou *Descendre dans tous*.
- **Remontée (Roll-Up)** -- englobe la fiche courante + les frères sélectionnés (fiches partageant le même `parent_id`) dans un nouveau conteneur parent.

Les lignes avec un compteur à zéro sont grisées, et les voisins / enfants déjà présents sur le canevas sont automatiquement ignorés.

### La hiérarchie sur le canevas

Les conteneurs correspondent au `parent_id` d'une fiche :

- **Glisser une fiche dans** un conteneur de même type ouvre *« Ajouter «enfant» comme enfant de «parent» ? »*. **Oui** met en file une modification hiérarchique ; **Non** ramène la fiche à sa position.
- **Glisser une fiche hors** d'un conteneur propose le détachement (mise à `parent_id = null`).
- Les **glisser-déposer entre types** retournent silencieusement à la position d'origine -- la hiérarchie est restreinte aux fiches du même type.
- Tous les mouvements confirmés atterrissent dans le bucket **Modifications hiérarchiques** du tiroir de synchronisation avec les actions *Appliquer* et *Annuler*.

### Retirer une fiche du diagramme

Supprimer une fiche du canevas est traité comme un geste **purement visuel** -- *« Je ne veux plus la voir ici »*. La fiche reste dans l'inventaire ; ses arêtes de relation connectées disparaissent silencieusement avec elle. Les flèches dessinées à la main qui ne sont pas des relations EA enregistrées ne sont jamais supprimées automatiquement. **L'archivage est une tâche de la page Inventaire**, pas du diagramme.

### Suppression d'arêtes

Supprimer une arête portant une vraie relation ouvre *« Supprimer la relation entre SOURCE et CIBLE ? »* :

- **Oui** met la suppression en file dans le tiroir Sync ; **Tout synchroniser** émet le `DELETE /relations/{id}` côté backend.
- **Non** restaure l'arête en place (style et extrémités préservés).

### Perspectives de vue

Le menu déroulant **Vue** dans la barre d'outils recolore chaque fiche du canevas selon un attribut :

- **Couleurs des fiches** (par défaut) -- chaque fiche utilise la couleur de son type.
- **Statut d'approbation** -- recolore par `approuvée` / `en attente` / `cassée`.
- **Valeurs de champ** -- choisissez n'importe quel champ à sélection unique sur les types de fiches présents sur le canevas (p. ex. *Cycle de vie*, *Statut*). Les cellules sans valeur retombent sur un gris neutre.

Une légende flottante en bas à gauche du canevas affiche la correspondance active. La vue choisie est enregistrée avec le diagramme.

### Tiroir de synchronisation

Le bouton **Sync** de la barre d'outils ouvre le tiroir latéral avec tout ce qui est en file pour la prochaine synchronisation :

- **Nouvelles fiches** -- formes converties en fiches en attente, prêtes à être poussées vers l'inventaire.
- **Nouvelles relations** -- arêtes dessinées entre fiches, prêtes à être créées dans l'inventaire.
- **Relations supprimées** -- arêtes de relation supprimées du canevas, en file pour `DELETE /relations/{id}`. *Conserver dans l'inventaire* réinsère l'arête.
- **Modifications hiérarchiques** -- déplacements glisser-dans / glisser-hors confirmés, en file comme mises à jour de `parent_id`.
- **Inventaire modifié** -- fiches mises à jour dans l'inventaire depuis l'ouverture du diagramme, prêtes à être ramenées sur le canevas.

Le bouton Sync de la barre d'outils affiche une pastille pulsée « N non synchronisé(s) » dès qu'un travail est en attente. Quitter l'onglet avec des changements non synchronisés déclenche un avertissement navigateur, et le canevas est sauvegardé localement toutes les cinq secondes pour pouvoir être restauré après un rafraîchissement accidentel.

### Lier des diagrammes aux fiches

Les diagrammes peuvent être liés à **n'importe quelle fiche** depuis l'onglet **Ressources** de la fiche (voir [Détail des fiches](card-details.fr.md#onglet-ressources)). Lorsqu'un diagramme est lié à une fiche **Initiative**, il apparaît également dans le module [EA Delivery](delivery.md) aux côtés des documents SoAW.
