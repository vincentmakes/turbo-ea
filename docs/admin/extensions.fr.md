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

L'onglet Boutique est en lecture seule et anonyme : pas de compte, pas de jeton, et aucune information sur votre instance n'est transmise — seul le catalogue public du fournisseur est lu. Les instances isolées n'ont rien à configurer — l'onglet affiche alors simplement une indication conviviale — et utilisent le flux basé sur les fichiers ci-dessous ; le site de la boutique du fournisseur offre les mêmes achats et téléchargements depuis n'importe quel navigateur connecté à Internet.

## Installer une extension

1. Si ce n'est pas déjà fait, appliquez d'abord votre licence (voir ci-dessous).
2. Ouvrez **Admin → Extensions**, choisissez **Installer depuis un fichier…** dans l'onglet Boutique et téléversez le fichier `.teax` reçu.
3. Turbo EA vérifie la signature et affiche un **aperçu** : pour les extensions de contenu, il s'agit d'une simulation de chaque type de carte, groupe d'étiquettes, carte et relation que l'extension créerait ou mettrait à jour — rien n'est encore écrit.
4. Vérifiez l'aperçu puis cliquez sur **Installer l'extension**.
5. Si l'extension contient du code backend, un bandeau demande de redémarrer le conteneur backend (`docker compose restart backend`). Les extensions de contenu et d'interface sont actives immédiatement — les utilisateurs voient la nouvelle interface au prochain chargement de page.

Téléverser deux fois le même paquet est sans risque — l'aperçu montre tout comme « ignoré » et l'application ne change rien.

## Licences et renouvellement

Appliquez une licence via **Saisir la licence…** dans l'onglet Installées (collez le texte ou téléversez le fichier) — le bouton apparaît aussi sur chaque ligne d'extension qui en a besoin. La page affiche ensuite le titulaire et une pastille par droit avec sa date d'expiration.

Quand un droit dépasse son échéance, il entre dans un **délai de grâce** (30 jours par défaut) : tout continue de fonctionner et les administrateurs voient un bandeau d'avertissement. Passé ce délai, l'extension est **désactivée en douceur** — ses pages disparaissent, son API refuse les requêtes, ses tâches d'arrière-plan se mettent en pause. **Aucune donnée n'est jamais supprimée.** L'application d'un fichier de licence renouvelé restaure tout instantanément, sans redémarrage.

Les licences achetées via la Boutique se renouvellent d'elles-mêmes sur les instances connectées : après chaque paiement réussi, votre instance récupère automatiquement la licence prolongée — rien à coller. Sur une instance isolée, le renouvellement se résume à coller le fichier de licence mis à jour reçu par e-mail (ou à le demander à votre éditeur) — rien de plus.

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

## Où apparaissent les pages d'extension

Les pages d'extension apparaissent dans la navigation une fois l'extension installée et sous licence — généralement comme leur propre entrée de menu de premier niveau, bien que certains rapports soient placés sous le menu **Rapports** aux côtés de ceux intégrés.
