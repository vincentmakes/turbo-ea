# Enquêtes

Le module **Enquêtes** (**Admin > Enquêtes**) permet aux administrateurs de créer des **enquêtes de maintenance de données** qui collectent des informations structurees aupres des parties prenantes sur des fiches spécifiques.

## Cas d'utilisation

Les enquêtes aident à maintenir vos données d'architecture à jour en contactant les personnes les plus proches de chaque composant. Par exemple :

- Demander aux responsables applicatifs de confirmer la criticite métier et les dates de cycle de vie annuellement
- Collecter des évaluations d'adéquation technique aupres des équipes IT
- Recueillir des mises à jour de coûts aupres des responsables de budget

## Cycle de vie des enquêtes

Chaque enquête progresse à travers trois états :

| Statut | Signification |
|--------|---------------|
| **Brouillon** | En cours de conception, pas encore visible par les répondants |
| **Active** | Ouverte aux réponses, les parties prenantes assignees la voient dans leurs Tâches |
| **Fermee** | N'accepté plus de réponses |

## Création d'une enquête

1. Naviguez vers **Admin > Enquêtes**
2. Cliquez sur **+ Nouvelle enquête**
3. Le **Constructeur d'enquête** s'ouvre avec la configuration suivante :

### Type cible

Sélectionnez le type de fiche auquel l'enquête s'applique (par ex. Application, Composant IT). L'enquête sera envoyée pour chaque fiche de ce type correspondant à vos filtres.

### Filtres

Optionnellement, reduisez le perimetre en filtrant les fiches (par ex. uniquement les applications Actives, uniquement les fiches detenues par une organisation spécifique).

### Questions

Concevez vos questions. Chaque question peut être :

- **Texte libre** -- Réponse ouverte
- **Sélection unique** -- Choisir une option dans une liste
- **Sélection multiple** -- Choisir plusieurs options
- **Nombre** -- Saisie numérique
- **Date** -- Sélecteur de date
- **Booleen** -- Bascule Oui/Non

### Actions automatiques

Configurez des regles qui mettent automatiquement à jour les attributs des fiches en fonction des réponses à l'enquête. Par exemple, si un repondant sélectionné « Mission critique » pour la criticite métier, le champ `businessCriticality` de la fiche peut être mis à jour automatiquement.

## Envoi d'une enquête

Une fois votre enquête en statut **Active** :

1. Cliquez sur **Envoyer** pour distribuer l'enquête
2. Chaque fiche ciblee généré une tâche pour les parties prenantes assignees
3. Les parties prenantes voient l'enquête dans leur onglet **Mes enquêtes** sur la [page Tâches](../guide/tasks.md)

## Consultation des résultats

Naviguez vers **Admin > Enquêtes > [Nom de l'enquête] > Résultats** pour voir :

- Statut des réponses par fiche (répondu, en attente)
- Réponses individuelles avec les réponses par question
- Une action **Appliquer** pour valider les regles d'action automatique sur les attributs des fiches
