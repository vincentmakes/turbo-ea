# Catalogue de capacités

Turbo EA est livré avec le **[Business Capability Reference Catalogue](https://capabilities.turbo-ea.org)** — un catalogue ouvert et organisé de capacités métier maintenu sur [github.com/vincentmakes/turbo-ea-capabilities](https://github.com/vincentmakes/turbo-ea-capabilities). La page Catalogue de capacités vous permet de parcourir ce référentiel et de créer en masse les cartes `BusinessCapability` correspondantes, plutôt que de les saisir une par une.

## Ouvrir la page

Cliquez sur l'icône utilisateur en haut à droite de l'application, puis sur **Catalogue de capacités**. La page est accessible à toute personne disposant de l'autorisation `inventory.view`.

## Ce que vous voyez

- **En-tête** — la version active du catalogue, le nombre de capacités qu'il contient et (pour les administrateurs) les contrôles permettant de vérifier et de récupérer les mises à jour.
- **Barre de filtres** — recherche en texte intégral sur l'identifiant, le nom, la description et les alias, ainsi que des chips de niveau (L1 → L4), un sélecteur multiple de secteurs et un commutateur « Afficher les obsolètes ».
- **Barre d'actions** — compteurs de correspondances, sélecteur global de niveau (déplie/replie tous les L1 d'un cran à la fois), tout déplier/replier, sélectionner les visibles, effacer la sélection.
- **Grille de L1** — une carte par capacité de premier niveau. Le nom de L1 occupe une bande d'en-tête bleu pâle ; les capacités enfants sont listées en dessous, indentées avec un fin filet vertical pour signaler la profondeur — la même convention de hiérarchie que le reste de l'application, afin que la page n'ait pas une identité visuelle propre. Les noms longs sont retournés sur plusieurs lignes plutôt que tronqués. Chaque en-tête de L1 expose aussi son propre stepper `−` / `+` : `+` ouvre le niveau de descendants suivant pour ce L1 uniquement, `−` referme le niveau ouvert le plus profond. Les deux boutons sont toujours visibles (la direction inactive est désactivée), l'action ne porte que sur ce L1 — les autres branches restent en place — et le sélecteur global en haut de la page n'est pas affecté.

## Sélectionner des capacités

Cochez la case à côté de toute capacité pour l'ajouter à la sélection. La sélection se propage dans le sous-arbre dans les deux sens mais ne touche jamais les ancêtres :

- **Cocher** une capacité non sélectionnée l'ajoute, ainsi que tous ses descendants sélectionnables.
- **Décocher** une capacité sélectionnée la retire, ainsi que tous ses descendants sélectionnables.

Décocher un seul enfant ne retire donc que cet enfant et ce qui se trouve en dessous — son parent et ses frères restent sélectionnés. Décocher un parent retire tout le sous-arbre en une action. Pour composer une sélection « L1 + quelques feuilles », choisissez le L1 (cela amorce tout le sous-arbre) puis décochez les capacités L2/L3 dont vous ne voulez pas — le L1 reste sélectionné et sa case reste cochée.

La page s'aligne automatiquement sur le thème clair/sombre de l'application — en mode sombre, la même mise en page neutre s'affiche sur un papier `#1e1e1e` avec un texte et des accents lavande.

Les capacités qui **existent déjà** dans votre inventaire apparaissent avec une **icône de coche verte** à la place de la case à cocher. Elles ne peuvent pas être sélectionnées — vous ne pouvez jamais créer deux fois la même Business Capability via le catalogue. Le rapprochement privilégie le marqueur `attributes.catalogueId` posé par un import précédent (la coche verte survit aux modifications de nom d'affichage) et, à défaut, recourt à une comparaison du nom d'affichage insensible à la casse pour les cartes que vous avez créées à la main.

## Création en masse de cartes

Lorsque au moins une capacité est sélectionnée, un bouton ancré **Créer N capacités** apparaît au bas de la page. Il utilise l'autorisation `inventory.create` standard — si votre rôle n'autorise pas la création de cartes, le bouton est désactivé.

Sur confirmation, Turbo EA :

- Crée une carte `BusinessCapability` par entrée de catalogue sélectionnée.
- **Préserve automatiquement la hiérarchie du catalogue** — lorsque le parent et l'enfant sont tous deux sélectionnés (ou que le parent existe déjà localement), le `parent_id` de la nouvelle carte enfant est câblé sur la bonne carte.
- **Ignore silencieusement les correspondances existantes**. La boîte de dialogue de résultat indique combien de cartes ont été créées et combien ont été ignorées.
- Estampille les `attributes` de chaque nouvelle carte avec `catalogueId`, `catalogueVersion`, `catalogueImportedAt` et `capabilityLevel` afin que vous puissiez retracer son origine.

Relancer le même import est sûr — il est idempotent.

**Liaison bidirectionnelle.** La hiérarchie est réparée dans les deux sens, l'ordre d'import n'a donc pas d'importance :

- Sélectionner uniquement un enfant dont le **parent du catalogue existe déjà** comme carte rattache automatiquement le nouvel enfant à ce parent existant.
- Sélectionner uniquement un parent dont les **enfants du catalogue existent déjà** comme cartes ré-attache ces enfants sous la nouvelle carte — quelle que soit leur position actuelle (au sommet ou imbriqués à la main sous une autre carte). À l'import, le catalogue fait foi pour la hiérarchie ; si vous préférez un autre parent pour une carte donnée, modifiez-la après l'import. La boîte de dialogue de résultat indique le nombre de cartes ré-associées en plus des compteurs de cartes créées et ignorées.

## Vue de détail

Cliquez sur le nom d'une capacité pour ouvrir une boîte de dialogue de détail montrant son fil d'Ariane, sa description, son secteur, ses alias, ses références et une vue entièrement déployée de son sous-arbre. Les correspondances existantes dans le sous-arbre sont signalées par une coche verte.

## Mettre à jour le catalogue (administrateurs)

Le catalogue est livré **embarqué** en tant que dépendance Python, la page fonctionne donc hors-ligne / dans des déploiements isolés. Les administrateurs (`admin.metamodel`) peuvent récupérer une version plus récente à la demande :

1. Cliquez sur **Vérifier les mises à jour**. Turbo EA interroge `https://capabilities.turbo-ea.org/api/version.json` et indique si une version plus récente est disponible.
2. Si oui, cliquez sur le bouton **Récupérer v…** qui apparaît. Turbo EA télécharge le catalogue le plus récent et le stocke comme remplacement côté serveur, prenant effet immédiatement pour tous les utilisateurs.

La version active du catalogue est toujours indiquée dans la chip d'en-tête. Le remplacement ne prime sur le paquet embarqué que lorsque sa version est strictement supérieure — une mise à jour de Turbo EA livrant un catalogue embarqué plus récent continuera donc à fonctionner comme prévu.

L'URL distante est configurable via la variable d'environnement `CAPABILITY_CATALOGUE_URL`, pour les déploiements auto-hébergés qui font miroir du catalogue public en interne.
