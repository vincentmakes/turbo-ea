# Automations

La majeure partie de la gouvernance EA est une liste de choses que quelqu'un a
promis de faire à la main : signaler un risque quand une application franchit un
seuil de coût sans responsable, relancer le responsable technique quand un
composant atteint sa fin de vie, prévenir le responsable métier quand une fiche
approuvée est modifiée. La liste est juste ; c'est l'exécution qui dérape, parce
que chaque point est un rappel dans la tête de quelqu'un plutôt qu'une règle que
la plateforme fait respecter.

**Automations** transforme ces promesses en règles que Turbo EA exécute pour
vous. Une règle se compose entièrement à partir de listes déroulantes — *quand*
quelque chose se produit dans le paysage, *si* des conditions sont remplies,
*alors* agir — et chaque exécution est enregistrée comme lot de mutations dans
le Journal d'audit, si bien qu'une règle qui a mal tourné s'annule en un clic.

## En bref

| | |
|---|---|
| **Licence** | Commerciale — une habilitation signée est nécessaire |
| **Version minimale de Turbo EA** | 2.128.0 |
| **Permissions** | `ext.automations.view`, `ext.automations.manage` |
| **Autorisations d'accès aux données** | Fiches (lecture + écriture), événements de fiche et de tâche, tâches (lecture + écriture), l'annuaire des utilisateurs, risques (lecture + écriture), décisions, notifications, rôles de parties prenantes |
| **Redémarrage du backend nécessaire** | Oui — l'extension embarque du code backend |
| **Où elle apparaît** | **Automations** dans la section **Admin** du menu utilisateur · une puce comptant les exécutions sur le détail d'une fiche |

## Une règle : quand, si, alors

![La grille des règles](../assets/img/en/86_ext_automations_rules.png)

L'onglet **Règles** liste chaque règle avec son déclencheur, son type de fiche,
ses actions, un interrupteur d'activation, sa dernière exécution et un bouton
de lecture. Ouvrez-en une pour voir l'éditeur.

![L'éditeur de règle](../assets/img/en/87_ext_automations_editor.png)

L'éditeur vous relit la règle en clair tout en haut, puis parcourt ses trois
parties :

**Quand** — ce qui lance une exécution. Une règle surveille un type de fiche et
se déclenche sur l'un de ces événements :

| Déclencheur | Se déclenche quand |
|---|---|
| une fiche est créée / modifiée / archivée / restaurée | cette fiche change |
| une relation est ajoutée / retirée | une relation, d'un type donné facultatif, touche la fiche |
| une tâche est terminée | une tâche rattachée à la fiche est clôturée |
| selon un planning | une expression cron à cinq champs (UTC) arrive à échéance — la règle vérifie alors chaque fiche du type |

**Si** — les conditions, sous forme de groupes imbriqués **toutes les conditions
suivantes** / **au moins une des conditions suivantes**. Chaque ligne est un
champ, un opérateur et une valeur choisis dans des listes déroulantes : les
champs propres de la fiche et ses phases de cycle de vie, ses étiquettes, ses
rôles de parties prenantes (*n'est tenu par personne*, *est tenu par*…), ses
relations, son statut de fin de vie sur les Applications et les Composants IT,
et — sur *une fiche est modifiée* — **ce qui a changé**, pour qu'une règle ne se
déclenche que lorsqu'une valeur est passée d'un état à un autre. Laissez le
groupe vide pour agir sur chaque fiche.

**Alors** — les actions, exécutées dans l'ordre. Une action en échec arrête
l'exécution, et la ligne d'exécution indique quelle étape a échoué.

| Action | Effet | Nécessite |
|---|---|---|
| Définir / vider un champ, définir une date de cycle de vie, définir le sous-type, le parent, le nom ou la description | Modifie la fiche | écriture dans l'inventaire |
| Définir des étiquettes | Remplace, ajoute ou retire des étiquettes, en respectant les groupes à choix unique | écriture dans l'inventaire |
| Créer une fiche liée, lier une relation | Ajoute une fiche d'un autre type et la connecte, ou connecte deux fiches existantes | écriture dans l'inventaire |
| Archiver la fiche | L'archive (récupérable pendant 30 jours) | écriture dans l'inventaire |
| Attribuer / retirer un rôle de partie prenante | Donne un rôle à une personne, à un titulaire de rôle, au titulaire de rôle de la fiche parente ou à la personne qui a déclenché la règle | rôles de parties prenantes |
| Créer une tâche | Une tâche sur la fiche pour une personne assignée, avec une échéance | tâches |
| Notifier des personnes | Une notification dans l'application ou par e-mail, selon les préférences propres de chaque destinataire | notifications |
| Signaler un risque, mettre à jour un risque | Dépose un risque dans le Registre des risques avec catégorie, probabilité et impact, lié à la fiche et confié à un responsable ; une exécution ultérieure peut en mettre à jour le titre, le responsable ou la date cible | risques |
| Créer un brouillon de décision | Un brouillon de décision d'architecture (Architecture Decision Record) lié à la fiche — jamais signé par une règle | décisions |
| Appeler un webhook | Une requête HTTPS signée vers un système externe, portant la fiche, ce qui a changé et la règle | — |
| S'arrêter | Met fin à la liste d'actions | — |

Les titres, descriptions et messages sont des modèles de texte : `{{card.name}}`,
`{{card.attributes.costTotalAnnual}}`, `{{actor.name}}`, `{{change.old}}` et
consorts sont renseignés fiche par fiche, et l'éditeur propose les variables
dans un menu.

Deux options se trouvent sous les actions. **Déclencher une fois par fiche**
(activée par défaut) se souvient de ce pour quoi une règle s'est déclenchée,
pour qu'une règle nocturne ne signale pas le même risque chaque nuit ; elle se
redéclenche quand les valeurs qu'elle lit changent. **Rattrapage nocturne**
revérifie chaque fiche à 03:00 UTC, pour qu'un événement manqué soit rattrapé de
lui-même.

## Simuler et Exécuter maintenant

**Simuler** exécute la règle sur chaque fiche de son type en mode aperçu — rien
n'est écrit — et montre combien de fiches correspondent et, fiche par fiche,
exactement ce que ferait chaque action. Activer une règle qui n'a jamais été
simulée vous invite à la simuler d'abord ; vous pouvez tout de même l'activer
sans.

**Exécuter maintenant** fait la même chose pour de vrai : la règle se déclenche
immédiatement pour chaque fiche correspondante, en respectant *déclencher une
fois par fiche* sauf si vous cochez *redéclencher aussi pour les fiches déjà
traitées*. La boîte de dialogue de résultat montre ce qui a été fait, fiche par
fiche, et renvoie au lot d'audit.

![Résultats d'exécution](../assets/img/en/88_ext_automations_run_results.png)

## Les exécutions et le Journal d'audit

![L'onglet des exécutions](../assets/img/en/89_ext_automations_runs.png)

Chaque exécution est une ligne de l'onglet **Exécutions** : quelle règle, sur
quelle fiche, comment elle a démarré (un événement, le planning, le rattrapage
nocturne, Exécuter maintenant), comment elle s'est terminée et chaque ligne
d'action. Filtrez par règle ou par résultat ; le nombre d'exécutions propre à
une fiche apparaît sous forme de puce sur sa page de détail.

Chaque écriture faite par une exécution arrive dans **Admin → Paramètres →
Journal d'audit** sous forme de lot d'extension, avec les différences événement
par événement. Une **analyse** — un planning, le rattrapage nocturne ou Exécuter
maintenant — constitue **un seul lot pour toutes les fiches sur lesquelles elle
s'est déclenchée**, si bien qu'une règle qui a mal tourné se corrige par un seul
**Annuler**, et non un par fiche. L'annulation rétablit les écritures sur les
fiches et les relations et, à partir de Turbo EA 2.127.0, les risques que
l'exécution a signalés ou modifiés, les rôles qu'elle a attribués, les
étiquettes qu'elle a définies et les brouillons de décision qu'elle a créés. Les
tâches et les notifications sont délibérément laissées en place — une demande
adressée à une personne et un message remis ne se défont pas en les supprimant
— et l'aperçu de l'annulation le dit avant que quoi que ce soit ne soit
appliqué.

## Les notifications sont regroupées

Une règle n'envoie jamais une notification par fiche. Une analyse rassemble ce
que chaque personne doit recevoir et envoie **une seule** notification par
personne et par règle à la fin — une fiche seule arrive comme son propre
message, plusieurs comme un récapitulatif qui nomme les fiches, dont vous
définissez le titre dans l'action (*Titre du récapitulatif*). Les changements
qui arrivent un par un — un import touchant trois cents fiches — envoient la
première notification immédiatement et retiennent les suivantes pendant la
**fenêtre de regroupement** des Paramètres ; la minute suivante envoie ce qui
s'est accumulé en un seul récapitulatif. Les préférences de notification propres
à chaque personne décident toujours de la cloche, de l'e-mail ou d'un canal
d'extension.

Un clic sur une notification regroupée dans la cloche ouvre ses **détails** sur place — le résumé complet et une puce par fiche qui mène à cette fiche —, car l'onglet Exécutions derrière elle est une page d'administration ; seules les personnes disposant de `ext.automations.view` obtiennent en plus un bouton **Ouvrir** vers celui-ci. Une notification portant sur une seule fiche mène toujours directement à la fiche. Chaque notification des automatisations utilise sa propre ligne **Notifications des automatisations** dans vos préférences de notification (dans l'application activé, e-mail désactivé par défaut), distincte de l'avis d'extension générique.

## Modèles

L'onglet **Modèles** est une galerie de règles prêtes à l'emploi — une
application coûteuse sans responsable, une fin de vie à moins de 180 jours, une
nouvelle application sans capacité métier, une fiche approuvée qui a été
modifiée, une qualité des données faible depuis un mois, une application entrant
en retrait progressif, une fiche archivée avec des relations ouvertes, une
initiative qui devient active, une application critique sans responsable
technique, un nouveau fournisseur enregistré, un composant IT en fin de vie.
Chacun s'ouvre dans l'éditeur, désactivé, pour que vous l'ajustiez et le
simuliez.

## Paramètres

![Paramètres](../assets/img/en/90_ext_automations_settings.png)

| Paramètre | Effet |
|---|---|
| **Personne de secours** | Reçoit la tâche, le risque ou la notification quand une règle ne trouve personne dans le rôle demandé |
| **Liste des hôtes webhook autorisés** | Les hôtes que l'action *Appeler un webhook* peut joindre, un par ligne ; vide autorise tout hôte HTTPS public. Les adresses privées et internes sont toujours refusées |
| **Fiches vérifiées par exécution planifiée** | Combien de fiches une analyse planifiée examine avant de s'arrêter et de laisser le reste à la suivante |
| **Regrouper les notifications reçues en moins de** | La fenêtre de regroupement, en minutes ; 0 envoie chacune à la minute suivante |

## Données de démonstration

**Charger les données de démo** dans les Paramètres installe les modèles et
trois règles de démonstration sur le paysage d'exemple, en active la plupart et
en exécute quelques-unes une fois, pour que les onglets Règles, Exécutions et
Journal d'audit aient quelque chose à montrer. **Supprimer** retire exactement
cela — les règles, les exécutions, ainsi que les tâches et les risques qu'elles
ont créés.

## Permissions

| Permission | Autorise |
|---|---|
| `ext.automations.view` | Voir les règles, leurs exécutions et la galerie de modèles, ainsi que la puce comptant les exécutions sur les fiches |
| `ext.automations.manage` | Créer, modifier, activer, simuler, exécuter et supprimer des règles ; changer les paramètres ; charger les données de démonstration |

## Si la licence expire ou l'extension est désactivée

La page disparaît du menu, les plannings s'arrêtent et les événements ne sont
plus distribués. Rien n'est supprimé : les règles, leurs exécutions et tout ce
qu'elles ont écrit — fiches, risques, tâches, décisions — restent exactement en
l'état. Renouveler la licence ou réactiver l'extension ramène les règles,
toujours actives.

## Notes et limites

- Turbo EA accorde à une extension 60 lots audités par minute. Une analyse sur
  un très grand inventaire marque une pause à ce plafond et reprend au tic
  suivant ; Exécuter maintenant le signale dans son résultat et l'analyse
  suivante reprend les fiches restantes.
- Une règle surveillant *une fiche est modifiée* ne voit que les changements
  survenus après son activation ; utilisez Exécuter maintenant ou attendez le
  rattrapage nocturne pour le paysage existant. Les conditions sur **ce qui a
  changé** ne correspondent qu'aux mises à jour en direct.
- Les webhooks sont HTTPS uniquement, signés avec un secret propre à
  l'instance, ne suivent jamais les redirections et expirent après 10 secondes ;
  la réponse est enregistrée sur l'exécution.
- Une règle ne peut mettre à jour que les risques qu'elle a signalés, et elle
  ne peut jamais signer une décision, faire changer un risque de statut ou
  terminer une tâche — ces gestes restent humains.
