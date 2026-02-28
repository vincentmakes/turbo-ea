# Notifications

Turbo EA vous tient informe des modifications apportees aux fiches, tâches et documents qui vous concernent. Les notifications sont délivrées **dans l'application** (via la cloche de notification) et optionnellement **par e-mail** si le SMTP est configuré.

## Cloche de notification

L'**icône de cloche** dans la barre de navigation superieure affiche un badge avec le nombre de notifications non lues. Cliquez dessus pour ouvrir un menu deroulant avec vos 20 notifications les plus recentes.

Chaque notification affiche :

- **Icône** indiquant le type de notification
- **Résumé** de ce qui s'est passe (par ex. « Une tâche vous a été assignee sur SAP S/4HANA »)
- **Temps** ecoule depuis la création de la notification (par ex. « il y a 5 minutes »)

Cliquez sur n'importe quelle notification pour naviguer directement vers la fiche ou le document correspondant. Les notifications sont automatiquement marquees comme lues lorsque vous les consultez.

## Types de notifications

| Type | Declencheur |
|------|-------------|
| **Tâche assignee** | Une tâche vous est assignee |
| **Fiche mise à jour** | Une fiche sur laquelle vous etes partie prenante est mise à jour |
| **Commentaire ajoute** | Un nouveau commentaire est publié sur une fiche sur laquelle vous etes partie prenante |
| **Statut d'approbation modifié** | Le statut d'approbation d'une fiche change (approuve, rejete, casse) |
| **Demande de signature SoAW** | On vous demande de signer un Statement of Architecture Work |
| **SoAW signe** | Un SoAW que vous suivez reçoit une signature |
| **Demande d'enquête** | Une enquête vous est envoyée et nécessité votre réponse |

## Livraison en temps reel

Les notifications sont délivrées en temps reel via Server-Sent Events (SSE). Vous n'avez pas besoin de rafraîchir la page -- les nouvelles notifications apparaissent automatiquement et le badge se met à jour instantanement.

## Préférences de notification

Cliquez sur l'**icône d'engrenage** dans le menu deroulant des notifications (ou allez dans votre menu de profil) pour configurer vos préférences de notification.

Pour chaque type de notification, vous pouvez activer/désactiver independamment :

- **Dans l'application** -- Si elle apparaît dans la cloche de notification
- **E-mail** -- Si un e-mail est également envoyé (nécessité que le SMTP soit configuré par un administrateur)

Certains types de notifications (par ex. demandes d'enquête) peuvent avoir la livraison par e-mail imposee par le système et ne peuvent pas être désactivés.
