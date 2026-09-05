# Slack Notifications

Votre équipe vit déjà dans Slack. **Slack Notifications** envoie à chaque personne
ses notifications Turbo EA sous forme de **message direct Slack** — un todo
assigné, une décision en attente de sa signature, un risque qui atterrit sur son
bureau — avec un bouton de retour direct vers la fiche.

Chacun garde la main : une colonne **Slack** apparaît dans ses propres préférences
de notification, à côté de Dans l'application et E-mail, et chacun coche
exactement les types de notification qui doivent y arriver. **Rien n'est activé
par défaut.**

## En bref

| | |
|---|---|
| **Licence** | Commerciale — un droit signé est requis |
| **Version minimale de Turbo EA** | 2.89.1 |
| **Permission** | `ext.slack-notify.admin` |
| **Autorisations d'accès aux données** | `core.notifications.channel`, `core.users.read` |
| **Redémarrage du backend requis** | oui — l'extension embarque du code backend |
| **Où elle apparaît** | **Admin → Paramètres → Intégrations → Slack** · une colonne **Slack** dans les [préférences de notification](../guide/notifications.md) de chacun |

Seul un **HTTPS sortant vers `slack.com`** est nécessaire — aucune URL entrante,
aucun rappel OAuth et aucune validation par le Slack Marketplace. L'extension
fonctionne donc sur une instance auto-hébergée ou derrière un pare-feu.

## Mise en place

Ouvrez **Admin → Paramètres → Intégrations** et choisissez le sous-onglet
**Slack**. Le panneau vous guide en trois étapes numérotées.

### 1. Créer l'application Slack

Le panneau affiche un **manifeste d'application** prêt à l'emploi. Dans Slack,
choisissez **Create New App → From a manifest**, sélectionnez votre espace de
travail, collez le manifeste (un bouton **Copier le manifeste** est prévu), puis
**Install to Workspace** et copiez le **Bot User OAuth Token** — il commence par
`xoxb-`.

Le manifeste demande quatre portées de bot et rien d'autre :

| Portée | Utilité |
|---|---|
| `chat:write` | Publier le message direct |
| `im:write` | Ouvrir la conversation directe avec une personne |
| `users:read` | Lire l'annuaire des membres |
| `users:read.email` | Associer un compte Turbo EA à un membre Slack par e-mail |

!!! warning "Laissez la rotation de jeton désactivée"
    Le manifeste désactive volontairement la **rotation de jeton** de Slack.
    Activée, elle fait expirer le jeton du bot toutes les 12 heures, ce que cette
    version ne sait pas renouveler : la remise s'interromprait deux fois par jour.

### 2. Connecter l'espace de travail

| Champ | Remarques |
|---|---|
| **Jeton OAuth du bot** | Le jeton `xoxb-…`. Stocké chiffré ; laissez vide par la suite pour le conserver |
| **Nom affiché dans les messages Slack** | *Turbo EA* par défaut. Utilisé dans le bouton et le pied du message |
| **Remettre les notifications dans Slack** | Activé par défaut — c'est un interrupteur de pause, pas une étape d'installation |

Cliquez sur **Enregistrer**, puis sur **Tester la connexion** ; une pastille
confirme *Connected to …*.

### 3. Associer les personnes

Les comptes sont associés **par adresse e-mail** la première fois qu'une personne
doit recevoir un message, et le résultat est mis en cache. La fiche **Personnes**
liste tout le monde, les cas problématiques d'abord, avec des pastilles indiquant
qui est **connecté**, **absent de Slack** ou **pas encore vérifié**.

Pour quelqu'un dont l'adresse Slack diffère de son e-mail Turbo EA, saisissez son
**identifiant de membre Slack** (comme `U01ABCDEF`) puis cliquez sur
**Enregistrer** — une association manuelle prime toujours sur la correspondance
par e-mail. **Envoyer un message de test** prouve qu'une association fonctionne de
bout en bout. Vider le champ rend la personne à la recherche par e-mail.

Les personnes que Slack ne reconnaît pas sont réessayées automatiquement une fois
par jour : quelqu'un qui rejoint l'espace de travail Slack après avoir obtenu son
compte Turbo EA est donc pris en compte sans intervention.

!!! note "Seuls les identifiants de membre sont stockés"
    L'extension stocke des identifiants de membre Slack et rien d'autre — les
    adresses e-mail restent dans Turbo EA.

## Ce que chacun contrôle

Dès que l'extension fonctionne, chacun dispose d'une colonne **Slack** dans ses
**préférences de notification**, aux côtés de Dans l'application et E-mail.

![La colonne « Slack » dans les préférences de notification](../assets/img/en/71_ext_slack_notification_preferences.png)

- **Chaque type est désactivé par défaut.** Personne ne reçoit de message Slack
  avant d'avoir activé ce type pour soi-même.
- Un pied de tableau indique à chacun si son compte est relié à Slack, ou qu'il
  doit demander l'association à un administrateur.
- L'annonce de mise à jour, réservée à l'application, n'est jamais remise dans
  Slack.

Turbo EA décide des types de notification existants et de qui les a activés ;
l'extension ne fait que transporter le message.

## À quoi ressemble un message

Un message direct Slack contient le **titre** de la notification en gras, son
texte, un bouton **Open in Turbo EA** (avec le nom que vous avez configuré) menant
à la fiche ou à la page concernée, et un petit pied de message rappelant le nom de
l'application et le type de notification.

La remise est strictement à sens unique — de Turbo EA vers Slack — et toujours
sous forme de message direct personnel. Rien n'est jamais publié dans un canal.

## Superviser la remise

La fiche **Journal de remise** indique combien de messages sont **en attente**,
**envoyés** et **en échec**, ainsi que les 50 lignes de journal les plus
récentes.

Les messages sont mis en file et envoyés en quelques secondes. Si Slack limite le
débit ou renvoie une erreur, l'extension réessaie avec un délai croissant et
abandonne après six tentatives ; les échecs définitifs — jeton révoqué, personne
supprimée, portée manquante — s'arrêtent immédiatement au lieu de réessayer
inutilement. Les lignes remises sont purgées au bout de 14 jours.

Une file qui n'avance pas a exactement deux causes, et le panneau indique celle
qui s'applique :

- **Aucun jeton de bot n'est enregistré** — collez le jeton et enregistrez.
- **La remise est désactivée** — réactivez *Remettre les notifications dans
  Slack*.

**Réessayer les échecs** remet en file tout ce qui a été abandonné et revérifie
les personnes que Slack ne connaissait pas. C'est la voie de rétablissement après
une panne ou un changement de jeton.

## Permissions

| Permission | Autorise |
|---|---|
| `ext.slack-notify.admin` | Configurer la connexion à l'espace de travail, associer les personnes, envoyer des messages de test, consulter le journal et relancer les échecs |

Le sous-onglet est masqué pour toutes les autres personnes. **Les utilisateurs
finaux n'ont besoin d'aucune permission supplémentaire** — ils cochent simplement
des cases dans leurs propres préférences de notification.

## Si la licence expire ou l'extension est désactivée

La remise se met en pause et la colonne **Slack** disparaît du dialogue, mais
**tous les réglages et toutes les adhésions sont conservés**. Une licence
renouvelée relance la remise. Il en va de même pour l'interrupteur *Remettre les
notifications dans Slack*, qui met la remise en pause sans rien désinstaller : les
messages en attente patientent simplement.

Le jeton du bot est stocké chiffré et exclu du transfert d'espace de travail.

## Limites

- **Messages directs uniquement** — aucune publication dans un canal.
- **Pas de boutons interactifs.** Des actions comme *Terminer* ou *Approuver*
  depuis Slack ne sont pas proposées dans cette version ; le message renvoie vers
  Turbo EA.
- **Pas de synthèses** — chaque notification est un message distinct plutôt qu'un
  résumé groupé.
- **N'activez pas la rotation de jeton Slack** (voir l'avertissement ci-dessus).
