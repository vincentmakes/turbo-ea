# Tableau de bord

Le tableau de bord est le premier écran que vous voyez après la connexion. Il fournit un **aperçu rapide** de l'état global de l'architecture d'entreprise.

![Tableau de bord - Vue supérieure](../assets/img/fr/01_tableau_de_bord.png)

## Barre de navigation supérieure

En haut de l'écran, vous trouverez la **barre de navigation principale** avec les éléments suivants :

- **Turbo EA** (logo) : Cliquez pour revenir au tableau de bord depuis n'importe quelle section
- **Tableau de bord** : Aperçu de l'état de l'architecture
- **Inventaire** : Liste complète de toutes les fiches
- **Rapports** : Rapports visuels et analytiques
- **BPM** : Gestion des processus métier (si activé)
- **Diagrammes** : Éditeur visuel de diagrammes d'architecture
- **EA Delivery** : Gestion des initiatives d'architecture
- **Tâches** : Tâches en attente et enquêtes assignées
- **Rechercher des fiches** : Barre de recherche rapide avec autocompletion
- **+ Créer** : Bouton pour créer rapidement de nouvelles fiches
- **Cloche de notification** : Alertes système et [notifications](notifications.md)
- **Icône de profil** : Sélection de la langue, bascule de thème, préférences de notification et accès à l'administration
- **Soutenir** : Un bouton violet-rose à côté du numéro de version dans le menu de profil ouvre une boîte de dialogue expliquant pourquoi le parrainage est important, avec un lien vers le blog et des options ponctuelles ou mensuelles via GitHub Sponsors

## Fiches récapitulatives

La section principale du tableau de bord affiche des **fiches récapitulatives** indiquant :

- **Nombre total de fiches** : Comptage de tous les composants enregistrés dans la plateforme
- **Répartition par type** : Combien d'éléments de chaque type existent (Applications, Organisations, Objectifs, Capacités, etc.)
- **Aperçu des statuts** : Visualisations rapides de l'état général

Cliquer sur une fiche de type redirige vers l'[Inventaire](inventory.md) pré-filtré sur ce type.

![Tableau de bord - Vue inférieure avec graphiques](../assets/img/fr/02_tableau_de_bord_bas.png)

## Graphiques et statistiques

Dans la section inférieure du tableau de bord, vous trouverez :

- **Graphique de répartition par type** : Montre la proportion de chaque type de fiche dans votre paysage
- **Statut d'approbation** : Indique combien de fiches sont approuvées, en attente, cassées ou rejetées
- **Qualité des données** : Pourcentage global de complétude des informations sur toutes les fiches
- **Activité récente** : Un fil des derniers changements -- qui a modifié quoi et quand

## Onglet «Espace de travail»

L'onglet **Espace de travail** rassemble tout ce qui vous est assigné : favoris, tâches, sondages en attente, activité récente sur vos cartes et la section **Cartes où j'ai un rôle**.

Cette dernière groupe les cartes par rôle de partie prenante que vous occupez (Application Owner, Business Owner, etc.) et liste les cartes sous chaque rôle. Si votre rôle accorde la permission `stakeholders.view` (admin, member et viewer par défaut), une petite icône **person_search** apparaît à côté du titre de la section : sélectionnez un utilisateur dans l'autocomplétion et la section se recharge avec ses rôles et ses cartes. Le titre devient «Rôles tenus par {name}». Cliquez sur la petite icône de fermeture pour revenir à vos propres rôles. Utile pour répondre à «que possède cette personne ?» en un clic.

## Onglet «Administration» — Annuaire des parties prenantes

Les administrateurs (tout rôle disposant de `admin.users`) voient un widget **Annuaire des parties prenantes** en bas de l'onglet Administration. Il liste chaque type de carte ayant au moins une partie prenante, avec le nombre de titulaires distincts. Dépliez un type de carte pour voir ses rôles, et dans chaque rôle les utilisateurs avec le nombre de cartes qu'ils couvrent. Cliquez sur un chip d'utilisateur pour déplier sa liste de cartes juste en dessous — chaque nom de carte est un lien vers la fiche de détail. Tout l'arbre (type de carte → rôle → utilisateur → cartes) revient en un seul aller-retour, la navigation est instantanée.

Un **filtre par nom** en haut du widget restreint l'arbre aux utilisateurs correspondant au nom ou à l'e-mail saisi ; les types de carte correspondants s'auto-déplient afin que les correspondances soient visibles sans clic supplémentaire. Pratique pour répondre à «où apparaît Alice dans l'organisation ?» en une seconde.

Au-delà de l'annuaire, un petit **popover de survol** s'ouvre dès que le curseur s'attarde sur un nom de partie prenante ailleurs dans l'application — dans l'onglet Parties prenantes d'une carte, sur un propriétaire de risque dans le Registre des risques ou sur la page de détail d'un risque — et affiche le portefeuille complet de cette personne groupé par rôle. Cliquez sur une carte dans le popover pour y accéder. Le popover n'effectue qu'une seule récupération par utilisateur et par session.
