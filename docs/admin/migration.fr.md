# Migration de plateforme

> Plateformes source prises en charge aujourd'hui : **SAP LeanIX**. Des adaptateurs supplémentaires (Ardoq, Mega HOPEX, BiZZdesign, Avolution Abacus, …) se branchent sur la même pipeline de staging et d'application et apparaissent automatiquement dans la boîte de dialogue d'upload dès qu'ils sont livrés.

L'importateur de migration de plateforme (**Administration → Paramètres → Migration**) ingère un workspace LeanIX complet et le dépose sous forme de cartes, relations, tags, parties prenantes, documents, commentaires et d'un métamodèle entièrement étoffé dans Turbo EA en une seule opération en plusieurs étapes, révisable.

## À qui s'adresse-t-il ?

Aux clients qui migrent de LeanIX (SAP LeanIX) vers Turbo EA. L'importateur accepte le classeur xlsx **Full Snapshot** de LeanIX — l'export multi-feuilles comportant une feuille par type de fact sheet, une feuille par type de relation, ainsi que `TagGroups`, `Tags`, `Documents`, `Comments`, `Types` et une feuille de référence `ReadMe`. Les téléchargements dans d'autres formats sont rejetés dès l'upload avec un message d'erreur explicite.

## Comment obtenir l'export

Dans LeanIX, ouvrez **Administration → Export → Full Snapshot**. Cette action produit un unique classeur XLSX contenant toutes les fact sheets **actives**, ainsi que leurs relations, groupes de tags, tags, documents (appelés *resources* dans LeanIX) et commentaires.

**Les fact sheets archivées ne sont pas incluses** dans le Full Snapshot — restaurez-les d'abord dans LeanIX si vous souhaitez qu'elles atterrissent dans Turbo EA.

## Le flux de travail

1. **Charger** le snapshot via **Paramètres → Migration → Nouvelle migration**. Le fichier reste sur le disque du serveur ; la base de données ne stocke que des métadonnées. L'analyse s'exécute en arrière-plan et le statut passe automatiquement de `uploaded → parsed`.

2. **Examiner** chaque type d'entité dans la vue par onglets. Chaque ligne staged porte une action :
    - `create` — sera ajoutée à Turbo EA
    - `update` — existe déjà ; les champs du diff seront fusionnés
    - `skip` — existe déjà sans changement
    - `conflict` — endpoint manquant, type non mappé, collision avec un built-in, e-mail mal formé, etc. — voir la colonne *Note* pour la raison complète

    Chaque onglet affiche au-dessus du tableau une rangée de **pastilles de filtre** — une par type de carte le cas échéant, sinon par action — pour restreindre une liste longue (centaines de cartes, dizaines de types de fact sheets) à une tranche à la fois. L'onglet **Cartes** montre le **nom** de carte résolu à côté de l'UUID source. La colonne *Note* affiche le motif complet du conflit ; les lignes `update` listent les noms de champs modifiés avec une infobulle détaillant la transition `ancien → nouveau`.

    Les onglets **Nouveaux types**, **Champs personnalisés** et **Nouvelles relations** affichent le métamodèle personnalisé du tenant issu de votre workspace source. Par défaut, ils sont acceptés tels quels et créent les types de cartes / champs / types de relations non-built-in correspondants dans Turbo EA.

3. **Mapper les champs importés** (optionnel, dans l'onglet **Champs personnalisés**). Pour chaque colonne personnalisée de la plateforme source, choisissez l'une des trois options dans la liste déroulante à côté de la ligne :
    - **Importer comme nouveau champ personnalisé** (par défaut) — la colonne devient un nouvel attribut sur le type de carte cible, sous une section synthétique *Imported from {source}*.
    - **Mapper vers un champ Turbo EA existant** — la valeur est routée vers un champ built-in du type de carte cible (p. ex. envoyer `businessCriticality` LeanIX vers l'emplacement `businessCriticality` natif de TEA). La ligne du champ de métamodèle est alors ignorée lors de l'apply, donc aucune colonne orpheline n'est créée.
    - **Mapper vers une phase de cycle de vie** — pour les colonnes de date, la valeur est routée vers l'emplacement standard `plan` / `phaseIn` / `active` / `phaseOut` / `endOfLife` dans `card.lifecycle`. Les valeurs date/datetime sont automatiquement converties en `YYYY-MM-DD` (le suffixe `T00:00:00` que certaines plateformes écrivent pour les cellules datetime est supprimé) ; les valeurs non analysables sont écartées pour ne pas corrompre la map lifecycle.
    - **Ne pas importer ce champ** — la colonne est complètement ignorée, ni comme attribut ni comme champ de métamodèle.

    Le mapping est par migration et peut être édité tant que le statut est `parsed` ou `previewed`. Les colonnes de base de la plateforme source que l'adaptateur route directement vers les slots standards de Turbo EA (p. ex. LeanIX `name`, `displayName`, `description`, `status`, `category → subtype`, `lifecycle:*`, `qualitySeal`, `completion`) sont listées en haut de l'onglet dans une bannière d'information en lecture seule — aucune décision de mapping n'est requise pour celles-ci.

4. **Appliquer** quand vous êtes satisfait. Le pipeline d'application exécute 12 passes ordonnées par dépendances (types de métamodèle → champs de métamodèle → types de relations de métamodèle → utilisateurs → cartes → groupes de tags → tags → liaisons carte-tag → relations → souscriptions → documents → commentaires) dans des savepoints individuels — une ligne en échec n'empoisonne pas le reste de l'import. Le statut passe de `applying → applied` (ou `failed` si les erreurs franchissent le seuil de sécurité).

    Si le snapshot analysé contient des lignes en **conflit**, une bannière d'avertissement apparaît au-dessus des onglets de staging (avec des pastilles cliquables qui sautent vers l'onglet concerné) et cliquer sur **Appliquer** ouvre un dialogue de confirmation détaillant quels types portent des conflits. Vous devez reconnaître explicitement que les lignes en conflit seront ignorées avant que l'apply ne s'exécute. Le *Résultat d'apply* affiche un chip *conflits* dédié à côté de *créés / mis à jour / ignorés / erreurs* — les conflits ne sont pas des skips silencieux, c'est un résultat de premier ordre visible dans l'historique de migration.

## Ce qui est importé

| LeanIX | Turbo EA |
|---|---|
| Application, ITComponent, Business Capability, Business Context, Process, DataObject, Interface, Provider, TechCategory, Platform, Objective, Project / Initiative | Mapping direct 1:1 de type de carte |
| User Group | Organization avec le sous-type `team`, taggée `leanix_origin=UserGroup` |
| Phases de cycle de vie (plan / phaseIn / active / phaseOut / endOfLife) | Reportées telles quelles sur `cards.lifecycle` |
| Hiérarchie (`childParentRelation`) | Repliée dans `Card.parent_id` |
| Arêtes Successor/Predecessor (`*SuccessorRelation`) | Stockées comme relations ; la direction est inversée à l'import pour que la convention Turbo EA « source succède à target » corresponde à la sémantique LeanIX « X a pour successeur Y ». Les nouveaux types de cartes du tenant ont `has_successors=true` pour que la vue de lignage soit rendue. |
| Relations (50+ types d'arêtes par défaut de LeanIX, à la fois en notation xlsx `applicationITComponentRelation` et GraphQL `relApplicationToITComponent`) | Relations natives Turbo EA avec attributs d'arête |
| Types de relations définis par le tenant (Server↔Application, lxSystem*, lxDora*, microservice*, ESG*, etc.) | Nouvelles lignes `relation_types` non-built-in, créées automatiquement dans la même passe d'import pour que chaque arête atterrisse réellement |
| Tags (groupes single/multi) | Groupes de tags + tags + jointures par carte |
| Souscriptions (une par rôle RESPONSIBLE/OBSERVER) | Lignes de parties prenantes ; utilisateurs créés automatiquement désactivés (`is_active=false`) |
| Documents (URL) | Pièces jointes documents |
| Commentaires (top-level + réponses, aplatis) | Lignes de commentaires |
| Types de fact sheet personnalisés du tenant (p. ex. `ESGCapability`, `Server`, `System`, `TechPlatform`, `TechnicalStack`) | Nouveaux types de cartes non-built-in avec `has_hierarchy=true`, `has_successors=true` et une section `Imported from LeanIX` pré-remplie |
| Champs personnalisés du tenant | Ajoutés au `fields_schema` du type cible sous une section synthétique `Imported from LeanIX`. Le type de champ et la liste **complète** des options enum sont extraits de la feuille `ReadMe` du classeur — `currentMaturity` atterrit en single-select avec les 5 valeurs (`adHoc, repeatable, defined, managed, optimized`) même lorsque les données n'en utilisent qu'une |
| Types de relations personnalisés du tenant | Nouveaux types de relations non-built-in, types d'endpoints traduits via la table LX↔TEA (`UserGroup → Organization`, etc.) |

### Pourquoi la feuille ReadMe compte

La première feuille du xlsx (`ReadMe`) est la référence de champ autoritaire de LeanIX : chaque colonne documentée avec son type (`String`, `Integer`, `Percent`, `Datetime`, `Boolean`, `String list`) et, le cas échéant, sa contrainte enum complète (`Possible values: one of A, B, C.`). L'importateur lit cette feuille en premier et l'utilise comme source de vérité principale pour les métadonnées de champ — il ne se rabat sur la feuille in-data `Types` que lorsque la ReadMe ne couvre pas une colonne. C'est la différence entre un champ importé en texte libre et un véritable dropdown avec les bonnes options.

## Ce qui n'est **pas** importé

Le snapshot ne contient pas ces éléments — l'importateur signale ce qui manque dans la colonne *Note* par ligne :

- **Fichiers binaires de documents** — seules les URLs sont dans le snapshot ; l'importateur crée des documents de type lien. Réimportez les binaires manuellement.
- **Threading des commentaires** — les réponses sont aplaties en commentaires top-level pour préserver le texte ; les parents de fil nécessiteraient des métadonnées d'UI LeanIX absentes du snapshot.
- **Mots de passe utilisateurs et liens SSO** — les utilisateurs auto-créés atterrissent désactivés. Invitez-les ou liez-les à SSO ultérieurement.
- **Historique d'audit** antérieur à l'import — l'historique Turbo EA démarre au timestamp d'apply.
- **Diagrammes / vues posters / dashboards / recherches enregistrées / préférences de notifications / tokens API / webhooks** — pas d'équivalent dans Turbo EA, ou pas d'analogue dans le snapshot.

## Relance d'un import

L'idempotence est intégrée. La table `migration_identity_map` enregistre la correspondance UUID LeanIX → Turbo EA pour chaque entité importée. Un re-upload du même snapshot (ou d'un snapshot mis à jour du même workspace) détecte les entités existantes et écrit des lignes staged `update`/`skip` plutôt que des doublons de `create`. L'`external_id` de la carte porte le `factSheetId` LeanIX, donc le lien survit même si l'identity map est purgée.

Si vous devez refaire un import (p. ex. vous avez supprimé en masse les cartes importées dans l'UI et voulez les ré-importer), utilisez l'icône poubelle sur la ligne de migration pour la supprimer, puis re-uploadez. Les migrations `applied` sont supprimables ; cela libère le verrou d'idempotence par hash de fichier permettant de re-charger le même snapshot. Les lignes orphelines de `migration_identity_map` pointant vers des cartes inexistantes sont automatiquement élaguées lors de la prochaine passe de staging — un nettoyage manuel de l'identity map n'est jamais requis.

## Permission

Cette page est gardée par la permission `admin.migrate`. Par défaut, seul le rôle **admin** la possède ; accordez-la explicitement à d'autres rôles dans **Paramètres → Rôles** si vous voulez qu'un non-admin pilote la migration.

## Limitations à prévoir

- **Une migration en cours par hash de fichier.** Re-uploader exactement les mêmes octets pendant qu'une migration pour ce hash est encore active retourne l'enregistrement de migration existant (le hash SHA-256 est la clé naturelle d'idempotence). Supprimez l'enregistrement de migration d'abord si vous voulez vraiment ingérer à nouveau le même fichier.
- **Gros workspaces** (10k+ fact sheets) : le parser est en streaming, mais le pipeline d'apply écrit les lignes en une transaction par passe. Prévoyez ~15 minutes pour des imports très volumineux.
- **Les champs, valeurs et tags personnalisés sont tolérés, pas pré-mappés.** Toute colonne LeanIX qui n'est pas dans le métamodèle built-in de Turbo EA atterrit verbatim dans la map `attributes` de la carte importée et apparaît dans l'onglet **Champs personnalisés** pour qu'un admin puisse la traiter (la router vers un champ TEA existant, vers une phase de cycle de vie, ou l'ignorer — voir *Mapper les champs importés* dans le workflow ci-dessus). Idem pour les groupes de tags définis par le tenant et les types de relations ajoutés par les plateformes sources (p. ex. `lxSystemSystem*`, `*Lx*Dora*`, `microservice*`, `eSGCapability*`) — ils apparaissent inchangés dans les onglets **Nouveaux types** / **Nouvelles relations**, prêts pour une décision admin.
- **Les e-mails de souscription acceptent les deux séparateurs.** L'export « Full Snapshot » LeanIX sépare les e-mails dans les cellules `subscriptions:<RoleType>[:<RoleName>]` par `;` ; l'export GraphQL CSV utilise `,`. Le parser accepte les deux. Les lignes dont l'e-mail est mal formé (absence de `@`, ou séparateur non scindé) sont staged en `conflict` avec un motif clair plutôt que créées comme faux utilisateurs — corrigez l'export source et rechargez.

## Nettoyage

Supprimer un enregistrement de migration (Paramètres → Migration → icône poubelle) retire à la fois les lignes en base pour cette migration (les staged records cascadent) et le fichier snapshot sur disque. Les migrations dans les statuts `uploaded`, `parsed`, `previewed`, `failed`, `aborted` et `applied` sont toutes supprimables ; une migration `applying` doit d'abord terminer (ou échouer) avant de pouvoir être supprimée.
