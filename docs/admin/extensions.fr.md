# Extensions

Le **magasin d'extensions** (Admin → Extensions) installe des extensions signées par l'éditeur qui ajoutent des capacités spécifiques au client — contenu de métamodèle supplémentaire, intégrations, tâches d'arrière-plan et même de nouvelles pages — sans modifier le cœur de Turbo EA (principe « clean core »).

Tout est livré sous forme de fichiers : l'extension est un paquet `.teax` signé et la licence un fichier texte signé, tous deux généralement envoyés par e-mail. Aucune activation en ligne, aucun compte de magasin ni connexion sortante n'est nécessaire ; le flux fonctionne donc à l'identique sur des instances **isolées (air-gapped)**.

La page comporte deux onglets : **Boutique** parcourt le catalogue d'extensions de votre fournisseur avec installation en un clic (si l'instance a accès à Internet), et **Installées** gère les licences et installe à partir de fichiers.

## Fonctionnement de la confiance

Deux vérifications indépendantes protègent votre instance :

1. **Provenance (signature).** Chaque paquet porte une signature Ed25519 de la clé de l'éditeur. Turbo EA la vérifie au téléversement *et à chaque démarrage du backend*. Les paquets non signés, altérés ou tiers sont refusés — une extension installée est garantie être exactement ce que l'éditeur a construit.
2. **Activation (licence).** Un fichier de licence signé liste vos droits — un par extension, chacun avec sa propre échéance. Une extension installée ne fonctionne que tant qu'un droit utilisable existe.

## L'onglet Boutique

L'onglet **Boutique** fonctionne sans aucune configuration et liste les extensions publiées par le fournisseur avec description et prix :

- **Acheter** ouvre la page de paiement dans un nouvel onglet du navigateur. Après l'achat, votre licence arrive par e-mail — collez-la dans l'onglet Installées.
- **Installer** (ou **Mettre à jour** lorsqu'une version plus récente est publiée) télécharge le paquet et le fait passer par exactement la même vérification de signature et le même aperçu à blanc qu'un téléversement manuel.

L'onglet Boutique est en lecture seule et anonyme : pas de compte, pas de jeton, et aucune information sur votre instance n'est transmise — seul le catalogue public du fournisseur est lu. Les instances isolées n'ont rien à configurer — l'onglet affiche alors simplement une indication conviviale — et utilisent le flux basé sur les fichiers ci-dessous ; le site de la boutique du fournisseur offre les mêmes achats et téléchargements depuis n'importe quel navigateur connecté à Internet.

## Installer une extension

1. Si ce n'est pas déjà fait, appliquez d'abord votre licence (voir ci-dessous).
2. Ouvrez **Admin → Extensions**, choisissez **Installer une extension** et téléversez le fichier `.teax` reçu.
3. Turbo EA vérifie la signature et affiche un **aperçu** : pour les extensions de contenu, il s'agit d'une simulation de chaque type de carte, groupe d'étiquettes, carte et relation que l'extension créerait ou mettrait à jour — rien n'est encore écrit.
4. Vérifiez l'aperçu puis cliquez sur **Installer l'extension**.
5. Si l'extension contient du code backend ou UI, un bandeau demande de redémarrer le conteneur backend (`docker compose restart backend`). Les extensions de contenu pur sont actives immédiatement.

Téléverser deux fois le même paquet est sans risque — l'aperçu montre tout comme « ignoré » et l'application ne change rien.

## Licences et renouvellement

Collez le texte de licence reçu (ou téléversez le fichier) dans la carte **Licence**. La page affiche alors le titulaire et une puce par droit avec sa date d'échéance.

Quand un droit dépasse son échéance, il entre dans un **délai de grâce** (30 jours par défaut) : tout continue de fonctionner et les administrateurs voient un bandeau d'avertissement. Passé ce délai, l'extension est **désactivée en douceur** — ses pages disparaissent, son API refuse les requêtes, ses tâches d'arrière-plan se mettent en pause. **Aucune donnée n'est jamais supprimée.** L'application d'un fichier de licence renouvelé restaure tout instantanément, sans redémarrage.

Le renouvellement sur une instance isolée se résume donc à : demander un nouveau fichier de licence à votre éditeur (par e-mail), puis le coller — rien de plus.

## Activer, désactiver et désinstaller

- L'interrupteur **Activée** désactive l'extension immédiatement en douceur (sans redémarrage) et peut être réactivé à tout moment.
- **Désinstaller** supprime les fichiers de l'extension. Les données qu'elle a créées — types de cartes, cartes et ses propres tables — sont volontairement conservées et réapparaissent en cas de réinstallation. Un redémarrage est nécessaire pour décharger complètement le code backend.

## Boutique en ligne (optionnel)

Si votre éditeur exploite une boutique d'extensions en ligne, vous pouvez vous y connecter au lieu d'échanger des fichiers. Après un achat, vous recevez un **code d'activation** à usage unique : ouvrez **Admin → Extensions → Boutique**, saisissez l'URL de la boutique et le code. Votre instance liste alors les paquets auxquels vous avez droit avec une **installation** en un clic, et le bouton **Actualiser la licence** prend en compte instantanément renouvellements et nouveaux achats — les paquets téléchargés passent par exactement la même vérification de signature et le même aperçu que les téléversements manuels. Les instances isolées ne se connectent simplement jamais ; le flux par fichiers ci-dessus reste entièrement pris en charge.

## Permissions

La page entière et toutes ses routes d'API sont protégées par la permission dédiée `admin.manage_extensions` (accordée au rôle Admin intégré). Les extensions peuvent définir leurs propres clés de permission (`ext.<nom>.…`), qui apparaissent dans **Admin → Utilisateurs & Rôles** une fois l'extension chargée.
