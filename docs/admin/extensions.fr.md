# Extensions

Le **magasin d'extensions** (Admin → Extensions) installe des extensions signées par l'éditeur qui ajoutent des capacités spécifiques au client — contenu de métamodèle supplémentaire, intégrations, tâches d'arrière-plan et même de nouvelles pages — sans modifier le cœur de Turbo EA (principe « clean core »).

Les extensions s'installent de deux manières : **en un clic depuis la Boutique intégrée** (si l'instance a accès à Internet) ou en **téléversant directement les fichiers** — l'extension est un paquet `.teax` signé et la licence un fichier texte signé, tous deux généralement envoyés par e-mail. Le flux par fichiers ne nécessite ni compte de magasin ni connexion sortante ; il fonctionne donc à l'identique sur des instances **isolées (air-gapped)**.

La page comporte deux onglets : **Boutique** parcourt le catalogue d'extensions de votre fournisseur avec installation en un clic, et **Installées** gère les licences et installe à partir de fichiers.

**Les extensions sont conçues et signées par Turbo EA** — elles ne sont ni auto-développées ni ouvertes à des tiers. Si vous avez besoin d'une fonctionnalité adaptée à votre organisation, nous pouvons la développer et la licencier pour vous. Voir [le conseil Turbo EA](https://www.turbo-ea.org/consulting).

## Fonctionnement de la confiance

Deux vérifications indépendantes protègent votre instance :

1. **Provenance (signature).** Chaque paquet porte une signature Ed25519 de la clé de l'éditeur. Turbo EA la vérifie au téléversement *et à chaque démarrage du backend*. Les paquets non signés, altérés ou tiers sont refusés — une extension installée est garantie être exactement ce que l'éditeur a construit.
2. **Activation (licence).** Un fichier de licence signé liste vos droits — un par extension, chacun avec sa propre échéance. Une extension installée ne fonctionne que tant qu'un droit utilisable existe. Les licences sont **liées à l'ID de votre instance** — une licence émise pour une autre instance est refusée.

## Extensions gratuites

Certaines extensions sont **gratuites** et ne nécessitent aucune licence. Elles s'installent et s'exécutent immédiatement : aucune étape d'achat, aucun fichier de licence à coller. Les extensions gratuites sont signalées par un badge **Gratuit** dans les onglets Boutique et Installées, et les actions **Acheter** et **Renouveler** sont masquées pour elles. La vérification de signature s'applique toujours exactement comme pour les extensions payantes (une extension gratuite est elle aussi signée par l'éditeur), de sorte que la provenance est garantie dans tous les cas. Comme elles ne requièrent aucun droit, les extensions gratuites n'expirent jamais et n'entrent jamais dans une période de grâce.

## L'ID de votre instance

Chaque installation génère une seule fois un **ID d'instance** unique (`TEA-XXXX-XXXX-XXXX`), affiché en haut d'Admin → Extensions avec un bouton de copie. C'est votre identité de licence : indiquez-le lors de l'achat (la Boutique intégrée l'envoie automatiquement ; le paiement de la boutique en ligne le demande) afin que chaque extension achetée pour cette instance — par n'importe quel administrateur, sous n'importe quelle adresse e-mail — aboutisse dans une licence unique combinée. Il identifie seulement votre instance ; ce n'est jamais un identifiant secret, vous pouvez donc le partager sans risque avec votre fournisseur.

L'ID voyage avec un transfert d'espace de travail : une migration vers un nouvel hôte conserve donc une licence valide. Après une **réinstallation complète**, l'instance reçoit un nouvel ID — demandez à votre fournisseur de réémettre votre licence pour celui-ci (un simple « re-key » de son côté).

## L'onglet Boutique

L'onglet **Boutique** fonctionne sans aucune configuration et liste les extensions publiées par le fournisseur avec description et prix :

- **Acheter** ouvre la page de paiement dans un nouvel onglet du navigateur. Dès que le paiement est confirmé, votre licence s'applique automatiquement (une copie arrive aussi par e-mail).
- **Installer** (ou **Mettre à jour** lorsqu'une version plus récente est publiée) vérifie d'abord votre licence — si l'extension n'est pas encore licenciée, une boîte de dialogue propose d'acheter ou de coller une licence, puis continue automatiquement — et télécharge le paquet via exactement la même vérification de signature et le même aperçu à blanc qu'un téléversement manuel. Les extensions avec démo affichent un lien **Voir en action**, et une nouvelle version publiée transforme le bouton en **Mettre à jour**.

Lorsque le catalogue contient des catégories, chaque élément affiche de petites pastilles (free ou commercial, plus des thèmes comme integration) et une barre de filtres apparaît au-dessus de la liste — cliquez sur les pastilles pour la restreindre (plusieurs pastilles se combinent), et **All** réinitialise l'affichage.

L'onglet Boutique est en lecture seule et anonyme : pas de compte, pas de jeton, et aucune information sur votre instance n'est transmise — seul le catalogue public du fournisseur est lu. Les instances isolées n'ont rien à configurer — l'onglet affiche alors simplement une indication conviviale — et utilisent le flux basé sur les fichiers ci-dessous ; le site de la boutique du fournisseur offre les mêmes achats et téléchargements depuis n'importe quel navigateur connecté à Internet. Si quelque chose entre votre instance et la boutique bloque la requête — un proxy, un pare-feu ou une protection anti-bots devant la boutique —, l'onglet le signale et indique le statut HTTP reçu, afin qu'une instance bloquée ne soit jamais confondue avec une instance isolée.

L'instance **vérifie également le catalogue une fois par jour** et signale les changements, afin qu'une nouvelle extension — ou un correctif de sécurité pour une extension déjà utilisée — n'attende pas que quelqu'un ouvre cette page par hasard. Les administrateurs (toute personne dont le rôle accorde `admin.manage_extensions`) reçoivent une notification dans la cloche lorsqu'une nouvelle extension est publiée dans la boutique, et une autre lorsqu'une extension installée dispose d'une version plus récente. Chaque changement est annoncé une seule fois, et un jour de sortie chargé arrive sous la forme d'une notification par catégorie plutôt qu'une par extension. Rien n'est téléchargé ni installé — la notification vous amène simplement ici. La vérification quotidienne peut être totalement désactivée dans [Admin → Paramètres → Notifications de mise à jour](settings.md#update-notifications).

## Essais

Certaines extensions payantes proposent un **essai gratuit de 30 jours** — repérez le bouton **Démarrer l'essai de 30 jours** dans l'onglet Boutique (ou l'option d'essai sur le site de la boutique). Démarrer un essai fonctionne comme un achat sans paiement : aucune carte bancaire n'est requise, votre licence se met à jour automatiquement (une copie arrive aussi par e-mail pour les installations isolées), et l'extension fonctionne avec toutes ses fonctionnalités pendant 30 jours.

- Chaque instance Turbo EA peut essayer une extension donnée **une seule fois**.
- Un essai se termine exactement à sa date de fin — il n'y a pas de période de grâce. L'extension cesse alors de fonctionner jusqu'à ce que vous vous abonniez ; **vos données ne sont jamais supprimées**, et tout revient dès qu'une licence d'abonnement est appliquée.
- L'onglet « Installées » affiche les droits d'essai sous la forme **Essai jusqu'au …**.
- Les essais se terminent d'eux-mêmes — il n'y a rien à annuler et rien n'est jamais facturé.

## Installer une extension

1. Si ce n'est pas déjà fait, appliquez d'abord votre licence (voir ci-dessous).
2. Ouvrez **Admin → Extensions**, choisissez **Installer depuis un fichier…** dans l'onglet Boutique et téléversez le fichier `.teax` reçu.
3. Turbo EA vérifie la signature et affiche un **aperçu** : pour les extensions de contenu, il s'agit d'une simulation de chaque type de carte, groupe d'étiquettes, carte et relation que l'extension créerait ou mettrait à jour — rien n'est encore écrit.
4. Vérifiez l'aperçu puis cliquez sur **Installer l'extension**.
5. Si l'extension contient du code backend, un bandeau demande de redémarrer le conteneur backend (`docker compose restart backend`). Les extensions de contenu et d'interface sont actives immédiatement — les utilisateurs voient la nouvelle interface au prochain chargement de page.

Téléverser deux fois le même paquet est sans risque — l'aperçu montre tout comme « ignoré » et l'application ne change rien.

## Mettre à jour une extension

Lorsque la boutique publie une version plus récente d'une extension installée, l'onglet Installées affiche une puce **Mettre à jour vers X** à côté de la version (et le bouton de l'onglet Boutique devient **Mettre à jour**). Un clic déclenche la même vérification de signature, le même aperçu et la même application qu'une installation. Deux garde-fous s'appliquent :

- Mettre à jour une extension que vous avez délibérément **désactivée** la laisse désactivée — la nouvelle version est installée sur le disque, mais son contenu reste masqué et rien ne s'exécute tant que vous ne la réactivez pas.
- Installer un paquet **plus ancien** que la version installée demande d'abord une confirmation explicite : une rétrogradation peut ne pas comprendre les données écrites par la version plus récente. Rien n'est supprimé dans les deux cas.

## Licences et renouvellement

Appliquez une licence via **Saisir la licence…** dans l'onglet Installées (collez le texte ou téléversez le fichier) — le bouton apparaît aussi sur chaque ligne d'extension qui en a besoin. La page affiche ensuite le titulaire et une pastille par droit avec sa date d'expiration.

Votre instance ne détient **qu'une licence à la fois** — en appliquer une nouvelle remplace la précédente. Les licences émises par le Store contiennent toujours tous les achats effectués pour votre instance : le remplacement est donc sans risque. Si vous détenez aussi des licences émises manuellement, demandez à votre fournisseur une licence combinée plutôt que d'appliquer des fichiers par extension ; si une licence appliquée devait retirer des droits encore couverts par la licence actuelle, Turbo EA les liste et demande d'abord confirmation (aucune donnée n'est supprimée dans tous les cas).

Quand un droit dépasse son échéance, il entre dans un **délai de grâce** (30 jours par défaut) : tout continue de fonctionner et les administrateurs voient un bandeau d'avertissement. Passé ce délai, l'extension est **désactivée en douceur** — ses pages disparaissent, son API refuse les requêtes, ses tâches d'arrière-plan se mettent en pause. **Aucune donnée n'est jamais supprimée.** L'application d'un fichier de licence renouvelé restaure tout instantanément, sans redémarrage.

Les licences achetées via la Boutique se renouvellent d'elles-mêmes sur les instances connectées : après chaque paiement réussi, votre instance récupère automatiquement la licence prolongée — rien à coller. Sur une instance isolée, le renouvellement se résume à coller le fichier de licence mis à jour reçu par e-mail (ou à le demander à votre éditeur) — rien de plus.

### Statut de renouvellement automatique et résiliation

Chaque pastille d'entitlement indique ce qui se passe à sa date : **Se renouvelle le {date}** pour un abonnement actif, ou **Expire le {date} — ne sera pas renouvelé** après une résiliation. L'information provient de la licence signée elle-même : elle est donc exacte aussi sur les instances isolées — le fichier de licence envoyé par e-mail après tout changement d'abonnement porte le statut à jour ; collez-le et la pastille est actuelle.

Pour voir la date de renouvellement, résilier ou rétablir le renouvellement automatique, changer le moyen de paiement ou télécharger les factures, utilisez **Gérer l'abonnement** à côté du nom du licencié (affiché pour les licences achetées via la Boutique). Le bouton ouvre votre portail de facturation dans un nouvel onglet — aucun compte requis. Sur une instance isolée, le bouton ne peut pas joindre la boutique ; utilisez plutôt le lien **Gérer l'abonnement** présent dans chaque e-mail de licence (seul votre navigateur a besoin d'Internet, pas votre instance Turbo EA).

Résilier ne coupe jamais rien immédiatement : l'extension continue de fonctionner jusqu'à la fin de la période payée, puis le déroulé normal grâce + désactivation douce s'applique. **Vos données ne sont jamais supprimées**, et un réabonnement restaure tout.

## Activer, désactiver et désinstaller

- L'interrupteur **Activée** désactive une extension immédiatement en douceur (sans redémarrage) et peut être rebasculé à tout moment. Pour les packs de contenu, cela masque leurs types de cartes du métamodèle — les cartes restent en place.
- **Désinstaller** supprime les fichiers de l'extension et masque ses types de cartes du métamodèle. Les cartes et les tables propres à l'extension sont délibérément conservées, et tout — types compris — réapparaît en cas de réinstallation.

## Permissions

La page entière et toutes ses routes d'API sont protégées par la permission dédiée `admin.manage_extensions` (accordée au rôle Admin intégré). Les extensions peuvent définir leurs propres clés de permission (`ext.<nom>.…`), qui apparaissent dans **Admin → Utilisateurs & Rôles** une fois l'extension chargée.

## Fonctionnalités de champ avancées

Certaines extensions débloquent des façons avancées de décrire vos données que le cœur ne propose pas seul :

- **Texte d'aide de champ** — une aide repliable affichée sous un champ pendant la saisie, pour qu'un formulaire s'explique de lui-même.
- **Types de champ personnalisés** — de nouveaux types au-delà de l'ensemble intégré (par exemple une note configurable de 1 à 5 ou de 0 à 10).

Ces options n'apparaissent dans l'éditeur de champ du métamodèle **que tant que l'extension qui les fournit est installée et sous licence**. Si une telle extension est ensuite désactivée ou que sa licence expire, les valeurs déjà saisies continuent de s'afficher en texte simple, en lecture seule — rien n'est effacé ni supprimé — et les options d'édition disparaissent simplement jusqu'à ce que l'extension soit de nouveau active.

## Autorisations d'accès aux données

La plupart des extensions ne travaillent qu'avec leurs propres données. Une extension qui s'intègre aux données du cœur — par exemple un connecteur qui synchronise les todos avec un outil de suivi externe comme Jira ou MS Planner ([#921](https://github.com/vincentmakes/turbo-ea/discussions/921)) — doit déclarer des **grants** dans son manifeste signé :

- `core.todos.read` / `core.todos.write` — lire ou modifier les todos via le SDK d'extension. L'écriture inclut la lecture. Sur les todos système (comme les demandes de signature), une extension de synchronisation ne peut définir que la référence externe affichée en pastille — elle ne peut jamais les terminer, les modifier, les réassigner ni les supprimer, et les todos appartenant à une autre extension restent hors de portée.
- `core.events.todo` — recevoir les événements de changement des todos, afin qu'un connecteur réagisse immédiatement au lieu d'attendre son prochain cycle d'interrogation.
- `core.users.read` — consulter les utilisateurs (nom, e-mail et statut actif uniquement) afin qu'un connecteur puisse faire correspondre les responsables avec les comptes de l'outil externe. Aucune donnée de rôle, de connexion ou de préférence n'est exposée, et les extensions ne peuvent jamais modifier les utilisateurs.
- `core.cards.read` — lire les cartes, les relations et le métamodèle, par exemple pour qu'un connecteur puisse faire correspondre vos applications avec les enregistrements d'un système externe. Les cartes archivées restent hors de vue.
- `core.cards.write` — créer, modifier ou archiver des cartes et ajouter des relations, avec exactement la validation qu'applique l'éditeur de l'application. Les mises à jour fusionnent les valeurs de champs au lieu de les remplacer, si bien qu'une extension ne peut jamais effacer des données qu'elle ne gère pas, et il n'existe **aucune suppression définitive** — l'archivage, avec sa fenêtre de restauration, est la seule suppression possible pour une extension.
- `core.events.card` — recevoir les événements de modification des cartes et des relations, afin qu'un connecteur réagisse immédiatement aux changements de l'inventaire au lieu d'attendre son prochain cycle d'interrogation.

Les grants font partie du bundle signé par l'éditeur : ils sont figés à l'empaquetage et visibles avant l'installation. Ils ne s'appliquent que tant que l'extension est installée, activée et sous licence — la désactiver ou laisser la licence expirer révoque l'accès immédiatement, sans redémarrage. Chaque modification effectuée par une extension est consignée dans **Admin → Journal d'audit** sous l'origine **Extension**, et un todo miroité depuis un outil externe affiche une puce pointant vers l'élément externe.

Chaque modification faite par une extension apparaît dans **Admin → Journal d'audit** sous forme de lot `ext:<clé>` avec les différences champ par champ, et peut y être annulée comme n'importe quel autre lot. Les opérateurs gardent le dernier mot : la variable d'environnement `EXTENSION_WRITES_ENABLED=false` suspend instantanément toutes les écritures des extensions (les lectures continuent, sans redémarrage), et `EXTENSION_MAX_WRITES_PER_BATCH` / `EXTENSION_MAX_BATCHES_PER_MINUTE` plafonnent ce qu'une extension peut modifier par lot et par minute.

## Où apparaissent les pages d'extension

Les pages d'extension apparaissent dans la navigation une fois l'extension installée et sous licence — généralement comme leur propre entrée de menu de premier niveau, bien que certains rapports soient placés sous le menu **Rapports** aux côtés de ceux intégrés.
