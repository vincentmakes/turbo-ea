# Extensions

Le **magasin d'extensions** (Admin → Extensions) installe des extensions signées par l'éditeur qui ajoutent des capacités spécifiques au client — contenu de métamodèle supplémentaire, intégrations, tâches d'arrière-plan et même de nouvelles pages — sans modifier le cœur de Turbo EA (principe « clean core »).

Tout est livré sous forme de fichiers : l'extension est un paquet `.teax` signé et la licence un fichier texte signé, tous deux généralement envoyés par e-mail. Aucune activation en ligne, aucun compte de magasin ni connexion sortante n'est nécessaire ; le flux fonctionne donc à l'identique sur des instances **isolées (air-gapped)**.

## Fonctionnement de la confiance

Deux vérifications indépendantes protègent votre instance :

1. **Provenance (signature).** Chaque paquet porte une signature Ed25519 de la clé de l'éditeur. Turbo EA la vérifie au téléversement *et à chaque démarrage du backend*. Les paquets non signés, altérés ou tiers sont refusés — une extension installée est garantie être exactement ce que l'éditeur a construit.
2. **Activation (licence).** Un fichier de licence signé liste vos droits — un par extension, chacun avec sa propre échéance. Une extension installée ne fonctionne que tant qu'un droit utilisable existe.

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

## Permissions

La page entière et toutes ses routes d'API sont protégées par la permission dédiée `admin.manage_extensions` (accordée au rôle Admin intégré). Les extensions peuvent définir leurs propres clés de permission (`ext.<nom>.…`), qui apparaissent dans **Admin → Utilisateurs & Rôles** une fois l'extension chargée.
