# Jira Todo Sync

Fini les deux listes de tâches. **Jira Todo Sync** reflète les todos Turbo EA dans
un projet Jira Cloud de votre choix et maintient les deux côtés alignés : un todo
créé dans Turbo EA devient un ticket Jira en quelques secondes, sa clôture fait
passer le ticket en « terminé », et les tickets Jira correspondant à un filtre de
votre choix apparaissent comme des todos. Titres, échéances et personnes
assignées se synchronisent dans les deux sens.

## En bref

| | |
|---|---|
| **Licence** | Commerciale — un droit signé est requis |
| **Version minimale de Turbo EA** | 2.68.0 |
| **Permission** | `ext.jira-todos.admin` |
| **Autorisations d'accès aux données** | `core.todos.read`, `core.todos.write`, `core.events.todo`, `core.users.read` |
| **Redémarrage du backend requis** | oui — l'extension embarque du code backend |
| **Où elle apparaît** | **Admin → Paramètres → Intégrations → Jira Todo Sync** · pastilles de clé de ticket sur la page Todos et dans l'onglet Todos des fiches |

Seul **Jira Cloud** est pris en charge. La connexion est uniquement sortante :
Turbo EA appelle l'API REST de Jira avec un e-mail de compte et un jeton API. Il
n'y a aucun rappel OAuth à exposer, aucune application Jira à installer et aucun
accès réseau entrant — l'extension fonctionne donc sur une instance auto-hébergée
ou derrière un pare-feu.

## Mise en place

### 1. Créer un jeton API Atlassian

1. Rendez-vous sur
   <https://id.atlassian.com/manage-profile/security/api-tokens> et connectez-vous
   avec le compte Atlassian sous lequel la synchronisation doit agir. Utilisez de
   préférence un **compte de service dédié** — les tickets sont créés et
   transitionnés sous ce compte. (Ce lien direct est la voie fiable : la page des
   jetons n'est plus accessible par un chemin de menu évident.)
2. Cliquez sur **Create API token** — la variante simple, **pas** *Create API
   token with scopes*. **Les jetons à portées ne sont pas pris en charge.**
3. Nommez-le (par exemple `turbo-ea-sync`) et choisissez une échéance. Atlassian
   en exige une et la plafonne à **un an**.
4. **Copiez le jeton immédiatement** — il n'est affiché qu'une seule fois.

!!! warning "Les jetons expirent"
    À l'expiration, la synchronisation s'arrête sur des erreurs
    d'authentification jusqu'à la saisie d'un nouveau jeton. Notez la date
    d'expiration dès la création.

### 2. Connecter Turbo EA

Ouvrez **Admin → Paramètres → Intégrations** et choisissez le sous-onglet
**Jira Todo Sync**.

Sous **Connexion Jira Cloud**, renseignez :

| Champ | Remarques |
|---|---|
| **URL du site** | Par exemple `https://votre-site.atlassian.net` |
| **E-mail du compte** | Le compte Atlassian auquel appartient le jeton |
| **Jeton API** | Stocké chiffré. Laissez vide par la suite pour conserver le jeton enregistré |

Cliquez sur **Tester la connexion**. En cas de succès, *Connected as …* s'affiche.

### 3. Définir le périmètre

Sous **Périmètre de synchronisation** :

- **Projet Jira** — à choisir dans la liste chargée depuis Jira une fois les
  informations de connexion saisies. Les todos poussés y sont créés comme tickets
  de type **Task**.
- **Filtre de récupération (JQL)** — les tickets correspondant à ce JQL sont
  reflétés en todos. Laissez vide pour la valeur par défaut
  `project = "<KEY>" AND statusCategory != Done`.
- **Intervalle d'interrogation (secondes)** — fréquence d'interrogation de Jira.
  Par défaut 300, minimum 60.

Sous **Directions**, trois interrupteurs :

| Interrupteur | Défaut | Effet |
|---|---|---|
| **Pousser les todos vers Jira** | activé | Les todos créés dans Turbo EA deviennent des tickets Jira ; clore un todo fait transitionner son ticket |
| **Récupérer les tickets depuis Jira** | activé | Les tickets Jira correspondants apparaissent comme todos ; résoudre un ticket clôt son todo |
| **Refléter les todos de signature (sens unique)** | **désactivé** | Les signatures de risques, décisions et projets deviennent des tickets Jira avec un lien retour — elles doivent toujours être effectuées dans Turbo EA |

Cliquez sur **Enregistrer la configuration**. **Synchroniser maintenant** lance
un cycle immédiatement.

La correspondance des personnes assignées ne demande aucune configuration :
Turbo EA associe automatiquement les personnes aux comptes Jira par adresse
e-mail.

## Comportement de la synchronisation

| Événement | Effet |
|---|---|
| Todo créé dans Turbo EA | Un ticket Jira est créé en quelques secondes (titre, description avec lien retour, échéance, personne assignée) |
| Todo clos ou modifié | Le ticket passe en « terminé » ou ses champs sont mis à jour |
| Ticket correspondant au JQL | Il est reflété comme todo |
| Ticket résolu dans Jira | Le todo est clos à la prochaine interrogation (les todos récurrents passent au cycle suivant) |
| Ticket rouvert dans Jira | Le todo est rouvert |
| **Modifications des deux côtés** | **La modification la plus récente l'emporte ; à égalité, Jira l'emporte** |
| Todo supprimé dans Turbo EA | Le ticket n'est **jamais supprimé** — un commentaire signale la suppression |
| Ticket supprimé dans Jira | Un todo récupéré est supprimé ; un todo créé dans Turbo EA est conservé et signalé dans le journal |

**La poussée est quasi instantanée, la récupération est périodique.** Les
modifications faites dans Turbo EA atteignent Jira en quelques secondes. Celles
faites dans Jira sont prises en compte à l'interrogation suivante — par défaut
sous cinq minutes. Chaque cycle réconcilie en outre les deux côtés : une panne de
Jira ou un événement manqué se répare tout seul au lieu de perdre des
modifications.

Quatre champs sont maintenus alignés : **titre**, **échéance**, **statut
terminé** et **personne assignée**. Le titre correspond à la **première ligne**
du texte du todo ; renommer un ticket dans Jira remplace donc cette première
ligne et laisse intactes les lignes de détail suivantes.

### La pastille de clé de ticket

Un todo synchronisé porte sa clé de ticket Jira (par exemple `PROJ-123`) sous
forme de petit lien, à la fois sur la [page Todos](../guide/tasks.md) et dans
l'onglet Todos d'une fiche. Un clic ouvre le ticket dans Jira. La pastille sert de
repère — un todo se clôt toujours dans Turbo EA ou via la synchronisation.

### Les todos de signature

Les demandes de signature — un risque, une décision ou un projet en attente
d'approbation — sont des todos système et ne sont **jamais** poussées comme des
todos ordinaires. Si **Refléter les todos de signature** est activé, elles
obtiennent un ticket Jira **à sens unique** qui pointe directement vers la page où
la signature a réellement lieu.

Une signature ne peut jamais être donnée depuis Jira. Si quelqu'un ferme le ticket
miroir alors que l'obligation est encore ouverte, la synchronisation le rouvre
avec un commentaire renvoyant vers Turbo EA. Une fois la signature effectuée dans
Turbo EA, le miroir passe en « terminé » à l'interrogation suivante.

Désactiver l'interrupteur empêche la création de *nouveaux* miroirs ; les miroirs
existants continuent d'être entretenus.

## Supervision

La ligne **État** indique la date de la dernière synchronisation, l'erreur
éventuelle et un résumé de ce qui a été fait. **Activité récente**, en dessous,
liste les 50 actions les plus récentes avec l'heure, la direction
(**Turbo EA → Jira**, **Jira → Turbo EA** ou **Sync**), le ticket et un message de
détail. Avertissements et erreurs sont mis en couleur — c'est là qu'apparaissent
une personne assignée non résolue ou une transition refusée.

## Permissions

| Permission | Autorise |
|---|---|
| `ext.jira-todos.admin` | Configurer et exploiter la synchronisation — connexion, projet, filtres, exécution manuelle, journal d'activité |

Le sous-onglet est entièrement masqué pour quiconque ne la possède pas. **Les
utilisateurs finaux n'ont besoin d'aucune permission supplémentaire** : les todos
synchronisés apparaissent simplement dans leur liste habituelle, avec la pastille
de clé de ticket.

## Si la licence expire ou l'extension est désactivée

La tâche de synchronisation et son gestionnaire d'événements se mettent en pause
immédiatement, et les autorisations d'accès aux données sont révoquées. **Rien
n'est supprimé** : les todos conservent leurs pastilles et les réglages sont
préservés. Une licence renouvelée reprend la synchronisation là où elle s'était
arrêtée.

Le jeton API est stocké chiffré sur votre instance et exclu du transfert d'espace
de travail : il ne quitte jamais l'instance sur laquelle il a été saisi.

## Dépannage et limites

- **Jira Cloud uniquement.** Jira Data Center n'est pas pris en charge.
- **Un projet par instance**, et les tickets sont toujours créés au type
  **Task**.
- **Interrogation périodique, pas de webhooks.** Les modifications côté Jira
  arrivent à l'interrogation suivante. Les webhooks Jira Cloud exigeraient une
  application OAuth et une instance joignable depuis Internet, et nécessiteraient
  malgré tout une interrogation de réconciliation : la synchronisation est donc
  périodique par conception.
- **Correspondance des personnes et confidentialité des e-mails.** Turbo EA fait
  correspondre les personnes par adresse e-mail, puis se rabat sur une
  correspondance exacte du nom affiché parmi les personnes assignables du projet.
  Quelqu'un dont l'e-mail est masqué dans Jira *et* dont le nom affiché diffère
  entre les deux systèmes ne peut pas être associé ; ces assignations restent
  inchangées et le journal indique l'adresse qui n'a pas pu être résolue. Une
  personne Turbo EA non résolue ne désassigne jamais silencieusement le ticket
  Jira.
- **Effacer une échéance dans Jira n'est pas répercuté.** Effacez-la plutôt dans
  Turbo EA.
- **Les miroirs de todos de signature sont à sens unique et accusent jusqu'à un
  intervalle d'interrogation de retard**, car les processus de signature du cœur
  n'émettent pas d'événements de changement.
- **Synchroniser maintenant** répond *A sync is already running* si un cycle est
  déjà en cours.
- Après une rotation du `SECRET_KEY` de votre instance, le jeton stocké n'est plus
  déchiffrable et le panneau revient à *Not configured yet* — ressaisissez le
  jeton.
