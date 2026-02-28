# Notifications

Turbo EA vous tient informé des modifications apportées aux fiches, tâches et documents qui vous concernent. Les notifications sont délivrées **dans l'application** (via la cloche de notification) et optionnellement **par e-mail** si le SMTP est configuré.

## Cloche de notification

L'**icône de cloche** dans la barre de navigation supérieure affiche un badge avec le nombre de notifications non lues. Cliquez dessus pour ouvrir un menu déroulant avec vos 20 notifications les plus récentes.

Chaque notification affiche :

- **Icône** indiquant le type de notification
- **Résumé** de ce qui s'est passé (par ex. « Une tâche vous a été assignée sur SAP S/4HANA »)
- **Temps** écoulé depuis la création de la notification (par ex. « il y a 5 minutes »)

Cliquez sur n'importe quelle notification pour naviguer directement vers la fiche ou le document correspondant. Les notifications sont automatiquement marquées comme lues lorsque vous les consultez.

## Types de notifications

| Type | Déclencheur |
|------|-------------|
| **Tâche assignée** | Une tâche vous est assignée |
| **Fiche mise à jour** | Une fiche sur laquelle vous êtes partie prenante est mise à jour |
| **Commentaire ajouté** | Un nouveau commentaire est publié sur une fiche sur laquelle vous êtes partie prenante |
| **Statut d'approbation modifié** | Le statut d'approbation d'une fiche change (approuvé, rejeté, cassé) |
| **Demande de signature SoAW** | On vous demande de signer un Statement of Architecture Work |
| **SoAW signé** | Un SoAW que vous suivez reçoit une signature |
| **Demande d'enquête** | Une enquête vous est envoyée et nécessite votre réponse |

## Livraison en temps réel

Les notifications sont délivrées en temps réel via Server-Sent Events (SSE). Vous n'avez pas besoin de rafraîchir la page -- les nouvelles notifications apparaissent automatiquement et le badge se met à jour instantanément.

## Préférences de notification

Cliquez sur l'**icône d'engrenage** dans le menu déroulant des notifications (ou allez dans votre menu de profil) pour configurer vos préférences de notification.

Pour chaque type de notification, vous pouvez activer/désactiver indépendamment :

- **Dans l'application** -- Si elle apparaît dans la cloche de notification
- **E-mail** -- Si un e-mail est également envoyé (nécessite que le SMTP soit configuré par un administrateur)

Certains types de notifications (par ex. demandes d'enquête) peuvent avoir la livraison par e-mail imposée par le système et ne peuvent pas être désactivés.
