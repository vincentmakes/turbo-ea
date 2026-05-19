# Migration de plateforme (LeanIX)

L'importateur de migration de plateforme (**Administration → Paramètres → Migration**) ingère un workspace LeanIX complet et le dépose sous forme de cartes, relations, tags, parties prenantes, documents, commentaires et d'un métamodèle entièrement étoffé dans Turbo EA en une seule opération en plusieurs étapes, révisable.

## À qui s'adresse-t-il ?

Aux clients qui migrent de LeanIX (SAP LeanIX) vers Turbo EA. L'importateur accepte **deux formats de snapshot**, tous deux détectés automatiquement selon le contenu du fichier :

- **Export complet `.xlsx`** (par défaut pour la plupart des clients) — le classeur multi-feuilles produit par LeanIX via *Reports → Full Export*. Une feuille par type de fact sheet, une feuille par type de relation, ainsi que `TagGroups`, `Tags`, `Documents`, `Comments`, `Types` et une feuille de référence `ReadMe`. N'importe quel utilisateur LeanIX peut le produire ; aucun accès admin requis.
- **Snapshot JSON gzippé** (`workspace-<id>-<date>.json.gz`) — le snapshot de clonage de tenant produit via **Administration → Workspace → Conduct a Data Snapshot**. Admin uniquement.

Les deux formats atterrissent sur le même modèle interne — le parser détecte automatiquement lequel a été chargé en analysant le contenu du fichier (magic ZIP `PK\x03\x04` pour xlsx, magic gzip `\x1f\x8b` pour le JSON), donc une extension mal nommée est correctement routée.

## Comment obtenir l'export

- **Export complet xlsx** — Dans LeanIX, **Reports → … → Full Export** produit un fichier comme `20260518_snapshot_demo.xlsx`. Il contient toutes les fact sheets actives, toutes les relations, les métadonnées tag/document/commentaire et une feuille `ReadMe` décrivant chaque colonne et ses valeurs autorisées.
- **Snapshot JSON Workspace** — Dans LeanIX, **Administration → Workspace → Conduct a Data Snapshot** déclenche le snapshot de clonage. Le fichier de sortie s'appelle typiquement `workspace-<id>-<date>.json.gz`. Un accès admin LeanIX est requis.

Si vous n'avez pas d'accès admin LeanIX mais disposez d'un token API au niveau tenant, la combinaison des requêtes GraphQL `allFactSheets`, `subscriptions`, `relations` et `documents` produit un dataset JSON conforme au format snapshot — l'importateur l'accepte également.

## Le flux de travail

1. **Charger** le snapshot via **Paramètres → Migration → Nouvelle migration**. Le fichier reste sur le disque du serveur ; la base de données ne stocke que des métadonnées. L'analyse s'exécute en arrière-plan et le statut passe automatiquement de `uploaded → parsed`.

2. **Examiner** chaque type d'entité dans la vue par onglets. Chaque ligne staged porte une action :
    - `create` — sera ajoutée à Turbo EA
    - `update` — existe déjà ; les champs du diff seront fusionnés
    - `skip` — existe déjà sans changement
    - `conflict` — endpoint manquant, type non mappé ou collision avec un built-in — voir la colonne *Note* pour la raison

    Les onglets **Nouveaux types**, **Champs personnalisés** et **Nouvelles relations** affichent le métamodèle personnalisé du tenant issu de votre workspace LeanIX. Par défaut, ils sont acceptés tels quels et créent les types de cartes / champs / types de relations non-built-in correspondants dans Turbo EA. Pour un contrôle plus fin, éditez la clé/le libellé/le type proposés dans le JSON du staged record avant d'appliquer.

3. **Appliquer** quand vous êtes satisfait. Le pipeline d'application exécute 12 passes ordonnées par dépendances dans des savepoints individuels — une ligne en échec n'empoisonne pas le reste de l'import. Le statut passe de `applying → applied` (ou `failed` si les erreurs franchissent le seuil de sécurité).

## Ce qui est importé

| LeanIX | Turbo EA |
|---|---|
| Application, ITComponent, Business Capability, Business Context, Process, DataObject, Interface, Provider, TechCategory, Platform, Objective, Project / Initiative | Mapping direct 1:1 de type de carte |
| User Group | Organization avec le sous-type `team`, taggée `leanix_origin=UserGroup` |
| Phases de cycle de vie (plan / phaseIn / active / phaseOut / endOfLife) | Reportées telles quelles sur `cards.lifecycle` |
| Hiérarchie (`childParentRelation`) | Repliée dans `Card.parent_id` |
| Arêtes Successor/Predecessor (`*SuccessorRelation`) | Stockées comme relations ; les nouveaux types de cartes du tenant ont `has_successors=true` pour que la vue de lignage soit rendue |
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

L'idempotence est intégrée. La table `leanix_identity_map` enregistre la correspondance UUID LeanIX → Turbo EA pour chaque entité importée. Un re-upload du même snapshot (ou d'un snapshot mis à jour du même workspace) détecte les entités existantes et écrit des lignes staged `update`/`skip` plutôt que des doublons de `create`. L'`external_id` de la carte porte le `factSheetId` LeanIX, donc le lien survit même si l'identity map est purgée.

Si vous devez refaire un import (p. ex. vous avez supprimé en masse les cartes importées dans l'UI et voulez les ré-importer), utilisez l'icône poubelle sur la ligne de migration pour la supprimer, puis re-uploadez. Les migrations `applied` sont supprimables ; cela libère le verrou d'idempotence par hash de fichier permettant de re-charger le même snapshot. Les lignes orphelines de `leanix_identity_map` pointant vers des cartes inexistantes sont automatiquement élaguées lors de la prochaine passe de staging — un nettoyage manuel de l'identity map n'est jamais requis.

## Permission

Cette page est gardée par la permission `admin.migrate`. Par défaut, seul le rôle **admin** la possède ; accordez-la explicitement à d'autres rôles dans **Paramètres → Rôles** si vous voulez qu'un non-admin pilote la migration.

## Limitations à prévoir

- **Une migration en cours par hash de fichier.** Re-uploader exactement les mêmes octets pendant qu'une migration pour ce hash est encore active retourne l'enregistrement de migration existant (le hash SHA-256 est la clé naturelle d'idempotence). Supprimez l'enregistrement de migration d'abord si vous voulez vraiment ingérer à nouveau le même fichier.
- **Gros workspaces** (10k+ fact sheets) : le parser est en streaming, mais le pipeline d'apply écrit les lignes en une transaction par passe. Prévoyez ~15 minutes pour des imports très volumineux.
- **Les champs, valeurs et tags personnalisés sont tolérés, pas pré-mappés.** Toute colonne LeanIX qui n'est pas dans le métamodèle built-in de Turbo EA atterrit verbatim dans la map `attributes` de la carte importée et apparaît dans l'onglet **Champs personnalisés** pour qu'un admin puisse la promouvoir. Idem pour les groupes de tags définis par le tenant et les types de relations ajoutés par les clients LeanIX (p. ex. `lxSystemSystem*`, `*Lx*Dora*`, `microservice*`, `eSGCapability*`) — ils apparaissent inchangés dans les onglets **Nouveaux types** / **Nouvelles relations**, prêts pour une décision admin.

## Nettoyage

Supprimer un enregistrement de migration (Paramètres → Migration → icône poubelle) retire à la fois les lignes en base pour cette migration (les staged records cascadent) et le fichier snapshot sur disque. Les migrations dans les statuts `uploaded`, `parsed`, `previewed`, `failed`, `aborted` et `applied` sont toutes supprimables ; une migration `applying` doit d'abord terminer (ou échouer) avant de pouvoir être supprimée.
