# Journal d'audit

Le **Journal d'audit**, sous **Admin → Paramètres → Journal d'audit** (`/admin/settings?tab=audit-log`), répond aux deux questions qu'une revue de sécurité pose à une instance qui détient la carte de tout le paysage informatique : *qu'est-ce qui y a changé*, et *qui s'est connecté, et comment*. Il est divisé en deux sous-onglets :

| Sous-onglet | URL | Ce qu'il enregistre |
|-------------|-----|---------------------|
| **Modifications** | `/admin/settings?tab=audit-log` | Chaque écriture dans le paysage — fiches, relations, risques, étiquettes, rôles de parties prenantes, brouillons de décision —, regroupée en lots de mutations, avec le diff de chaque événement et une **annulation (Rollback)** |
| **Sécurité et administration** | `/admin/settings?tab=audit-log&view=security` | Connexions et déconnexions, tentatives échouées, verrouillages, sessions SSO et proxy, événements de mot de passe et emprunt de rôle |

Les deux sont séparés à dessein. **Modifications** est un outil de travail — il sert à voir et à annuler une écriture erronée — et ne conserve qu'un historique court. **Sécurité et administration** est une piste de preuves : ses entrées ne peuvent être ni modifiées ni supprimées, et elle est conservée un an par défaut.

## Qui peut le consulter

Les deux sous-onglets exigent la permission **`admin.events`** (« Consulter la piste d'audit et le flux d'événements »), que seul le rôle **Admin** détient par défaut. Pour donner un accès en lecture à un responsable sécurité ou conformité sans en faire un administrateur, créez un rôle portant `admin.events` sous [Utilisateurs et rôles](users.md#roles) et attribuez-le-lui.

## Modifications

Le sous-onglet **Modifications** est le registre des lots de mutations. Chaque écriture qui modifie des données y arrive sous forme de lot, avec son auteur et sa provenance :

| Origine | Signification |
|---------|---------------|
| **Web** | L'interface web de Turbo EA |
| **API** | Un appel direct à l'API REST (un script, une intégration) |
| **Outil IA** | Un assistant IA connecté via le [serveur MCP](mcp.md) |
| **Extension** | Une [extension](extensions.md) installée, enregistrée comme lot `ext:<key>` |

Cliquez sur un lot pour ouvrir son panneau : le diff de chaque événement montre l'ancienne et la nouvelle valeur de chaque champ, et **Rollback** rétablit les écritures sur les fiches, relations, risques, rôles de parties prenantes, étiquettes et brouillons de décision qu'il a effectuées.

Les lots sont conservés **`MUTATION_BATCH_RETENTION_DAYS`** jours (une variable d'environnement, **15** par défaut), puis purgés automatiquement. Les événements eux-mêmes restent dans l'onglet **Historique** de chaque fiche une fois le lot disparu.

## Sécurité et administration

![Journal de sécurité et d'administration](../assets/img/fr/62_admin_journal_audit_securite.png)

Le sous-onglet **Sécurité et administration** liste une entrée par action ayant trait à la sécurité, les plus récentes en premier :

- connexions et déconnexions, par mot de passe, par SSO ou via un proxy inverse de confiance ;
- tentatives de connexion échouées, chacune avec un **code de motif** indiquant pourquoi elle a échoué ;
- verrouillages de compte après des échecs répétés ;
- inscriptions, ainsi que les mots de passe définis, réinitialisés ou modifiés ;
- emprunt de rôle — un administrateur qui démarre puis arrête **Voir en tant que rôle…** ;
- les exports de ce journal lui-même.

!!! note "Dans la prochaine version"
    Les **actions administratives** — modifications des utilisateurs, des rôles, des paramètres, du métamodèle, des extensions, des imports et des intégrations — et les **exports de données** (exports CSV/JSON de l'inventaire, exports de workspace et de migration) seront enregistrés dans ce même journal dans la prochaine version.

### Colonnes

| Colonne | Description |
|---------|-------------|
| **Quand** | Date et heure de l'action |
| **Catégorie** | `auth` (authentification), `admin` (actions administratives) ou `access` (exports et autres accès aux données) |
| **Action** | Ce qui s'est passé, par exemple `auth.login.failed` — voir le [catalogue des actions](#action-catalogue) |
| **Résultat** | **Succès** ou **Échec** |
| **Acteur** | L'utilisateur connecté qui a effectué l'action. Vide quand personne n'était connecté — lors d'une connexion échouée, par exemple |
| **Sujet** | Le compte concerné par l'action — l'adresse e-mail saisie lors d'une connexion échouée, ou l'utilisateur dont le mot de passe a été réinitialisé |
| **Cible** | L'objet visé, s'il y en a un — par exemple le rôle choisi au démarrage d'un emprunt de rôle |
| **IP** | L'adresse IP du client (voir [Adresse IP du client](#client-ip-address)) |
| **Origine** | La provenance de la requête : web, API, outil IA, extension, ops ou système |
| **Rôle emprunté** | Quand un administrateur consultait l'application sous un autre rôle, ce rôle. L'acteur reste l'administrateur réel |

Les colonnes s'affichent, se masquent, se réordonnent et se figent comme dans tout autre tableau de données ; **Quand** et **Action** sont toujours affichées.

### Filtres

Le panneau de filtres à gauche restreint la liste par **catégorie**, **résultat**, **action**, **acteur**, **adresse IP** et **plage de dates**. Chaque en-tête de section indique le nombre de valeurs sélectionnées, et le panneau replié affiche le nombre de filtres actifs. L'onglet **Colonnes** du même panneau affiche, masque et fige les colonnes. Vos filtres et la disposition des colonnes sont mémorisés dans ce navigateur.

Une recherche sur une adresse e-mail porte sur l'acteur, le sujet et la cible : saisir une seule adresse retrouve à la fois ce que cette personne a fait et ce qui a été tenté contre son compte.

### Détails d'une entrée

Cliquez sur une ligne pour ouvrir le panneau de l'entrée. Il affiche chaque champ, y compris l'agent utilisateur du navigateur et les **détails** enregistrés avec l'entrée — le code de motif d'une connexion échouée, l'heure de fin d'un verrouillage, le fournisseur d'identité d'une connexion SSO. Lorsqu'une entrée enregistre une modification, les détails s'affichent sous forme de tableau des anciennes et nouvelles valeurs. Les secrets ne sont jamais stockés : un mot de passe, un jeton ou un secret client est remplacé par `***` avant l'écriture de l'entrée.

Le panneau ne propose aucune action. Les entrées ne peuvent être ni modifiées ni supprimées.

### Exporter en CSV

**Exporter en CSV**, dans la barre d'outils, télécharge les entrées correspondant aux filtres actuels sous forme de fichier CSV, jusqu'à 50 000 lignes. L'export est lui-même enregistré, sous `access.audit_log.exported`, si bien qu'un export du journal de sécurité y laisse toujours une trace.

## Catalogue des actions { #action-catalogue }

| Action | Enregistrée lorsque |
|--------|---------------------|
| `auth.login.succeeded` | un utilisateur se connecte avec son e-mail et son mot de passe |
| `auth.login.failed` | une connexion par mot de passe est refusée. Le **code de motif** indique pourquoi (voir ci-dessous) |
| `auth.login.locked` | la cinquième tentative échouée d'affilée verrouille le compte pendant 15 minutes. Les détails indiquent l'heure de fin du verrouillage |
| `auth.logout` | un utilisateur connecté se déconnecte. Une déconnexion sans session valide n'enregistre rien |
| `auth.sso.succeeded` | un utilisateur se connecte via un fournisseur SSO. Les détails indiquent le fournisseur, le sujet du fournisseur d'identité et si le compte a été créé par cette connexion |
| `auth.sso.failed` | une connexion SSO est refusée — domaine non autorisé, adresse e-mail manquante, compte local avec le même e-mail, compte inactif. Les détails indiquent le fournisseur et le motif |
| `auth.proxy_session.succeeded` | un utilisateur se connecte via un [proxy inverse](sso.md#authentification-par-proxy-inverse) de confiance |
| `auth.proxy_session.failed` | une connexion via le proxy inverse est refusée |
| `auth.register` | un utilisateur crée un compte par auto-inscription |
| `auth.password.set` | un utilisateur invité définit son premier mot de passe |
| `auth.password.reset_requested` | quelqu'un demande un e-mail de réinitialisation du mot de passe. Toujours enregistrée comme un succès, avec la seule adresse saisie, de sorte que le journal ne révèle jamais si ce compte existe |
| `auth.password.reset` | un mot de passe est modifié via un lien de réinitialisation |
| `auth.password.changed` | un utilisateur connecté modifie son propre mot de passe |
| `auth.impersonation.started` | un administrateur démarre **Voir en tant que rôle…**. La cible est le rôle choisi |
| `auth.impersonation.stopped` | l'administrateur revient à son propre rôle |
| `access.audit_log.exported` | quelqu'un exporte le journal de sécurité en CSV |

**Codes de motif** de `auth.login.failed` :

| Motif | Signification |
|-------|---------------|
| `unknown_user` | Aucun compte ne porte cette adresse e-mail |
| `sso_account` | Le compte se connecte par SSO et n'a pas de mot de passe |
| `no_password` | Le compte n'a pas encore de mot de passe — une invitation jamais acceptée |
| `locked` | Le compte est verrouillé après des échecs répétés |
| `bad_password` | Le mot de passe est erroné |
| `inactive` | Le compte est désactivé |

Une rafale d'échecs `unknown_user` depuis une même adresse IP est la signature d'une pulvérisation de mots de passe (password spraying) ; une série de `bad_password` contre un compte suivie de `auth.login.locked` est une tentative de devinette contre ce compte.

## Ce qui n'est pas enregistré

- **Le renouvellement du jeton.** L'application web renouvelle sa session à intervalle régulier : chaque onglet ouvert ajouterait des entrées, sans qu'aucune ne signifie quoi que ce soit.
- **Les requêtes refusées pour un jeton de session expiré ou invalide.** Elles se produisent chaque fois qu'une session se termine normalement.
- **Les lectures de flux OData.** Excel et Power BI interrogent le flux OData d'une vue sauvegardée selon un calendrier ; chaque actualisation ajouterait une entrée.
- **Le simple accès en lecture** — ouvrir une fiche, exécuter un rapport, rechercher dans l'inventaire.

## Conservation { #retention }

Les entrées sont conservées **365 jours** par défaut. Modifiez cette durée sous **Admin → Paramètres → Général → Gestion des données → Conservation du journal de sécurité** : n'importe quel nombre de jours jusqu'à 3650, ou **0** pour conserver les entrées indéfiniment. Une tâche supprime chaque nuit les entrées plus anciennes que cette durée et relit le paramètre à chaque passage, de sorte qu'un changement prend effet sans redémarrage.

Cette tâche de conservation est la seule chose qui supprime jamais une entrée. Il n'existe aucune action de modification ou de suppression, ni dans l'interface ni dans l'API, pour aucun rôle.

Le journal ne fait volontairement **pas** partie du [Transfert de workspace](workspace-transfer.md) : il constitue l'historique de sécurité de cette instance, pas le contenu du workspace, et cloner une instance ne le copie pas.

## Le flux d'audit JSON

Chaque entrée est aussi écrite par le backend sous forme d'**une ligne JSON** sur le logger **`turbo_ea.audit`**, au moment même où elle est enregistrée. Le backend journalise sur la sortie standard, si bien que le flux parvient à tout ce qui collecte déjà les journaux de vos conteneurs — `docker compose logs backend`, la collecte de journaux de Kubernetes ou n'importe quel agent d'expédition vers un SIEM —, sans aucune configuration dans Turbo EA :

```bash
docker compose logs -f backend | grep turbo_ea.audit
```

Chaque ligne porte les mêmes champs que l'entrée :

| Champ | Contenu |
|-------|---------|
| `audit_id`, `created_at` | L'identifiant de l'entrée et le moment où elle a été écrite |
| `category`, `action`, `outcome` | Ce qui s'est passé et si cela a réussi |
| `actor_user_id`, `actor_email` | Qui l'a fait |
| `subject_email` | Le compte concerné |
| `target_type`, `target_id`, `target_label` | Ce sur quoi l'action a porté |
| `ip`, `user_agent` | Le client |
| `origin` | web, api, mcp, ext, ops ou system |
| `impersonator_user_id`, `impersonated_role` | Renseignés pendant qu'un administrateur consulte l'application sous un autre rôle |
| `details` | Codes de motif et anciennes/nouvelles valeurs, secrets déjà masqués |

Expédier ce flux vers un stockage central de journaux en conserve une copie hors de l'instance, hors de portée de quiconque peut l'administrer — c'est ce dont a besoin une revue des menaces internes. Voir [Journalisation et flux d'audit](operations.md#logging-and-the-audit-stream) pour le collecter.

## Adresse IP du client { #client-ip-address }

La colonne **IP** enregistre l'adresse du client, et non celle du proxy placé devant le backend. Le nginx de bordure fourni renseigne l'en-tête `X-Real-IP` avec l'adresse d'où il a reçu la connexion, et le backend lit cet en-tête parce que l'image backend publiée définit **`TRUST_PROXY_HEADERS=true`**. Une valeur qui n'est pas une adresse IP valide est écartée plutôt qu'enregistrée.

- **Laissez `TRUST_PROXY_HEADERS` activé** tant que chaque requête atteint le backend via le nginx fourni — la pile par défaut, le [chart Helm](kubernetes.md) et les [modèles de conteneurs managés](managed-containers.md) fonctionnent tous ainsi.
- **Désactivez-le** (`TRUST_PROXY_HEADERS=false`) si vous exposez directement le conteneur backend, sans le nginx fourni devant lui : un client pourrait alors envoyer son propre `X-Real-IP` et choisir l'adresse enregistrée.
- **Derrière un autre répartiteur de charge**, le nginx fourni voit l'adresse de ce répartiteur, et chaque entrée l'enregistre. Un paramètre permettant à nginx de faire confiance à l'adresse client transmise par votre répartiteur de charge (`NGINX_TRUSTED_PROXIES`) est prévu dans une version ultérieure.
