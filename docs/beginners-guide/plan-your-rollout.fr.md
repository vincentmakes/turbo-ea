# Planifiez votre déploiement

Avant de créer la moindre fiche, consacrez une heure à répondre à quatre questions. Les équipes qui sautent cette étape se retrouvent avec un inventaire que personne ne croit, parce que personne ne s'est mis d'accord sur ce à quoi il servait.

## 1. Définissez un périmètre étroit

La plus grande erreur dans les déploiements EA est d'essayer de modéliser toute l'entreprise d'un coup. Choisissez **l'un** des éléments suivants :

- Un **domaine métier** (par ex., Ventes, Finance, Service client, Production).
- Une **entité juridique** ou une **région** (une filiale, un pays, une unité métier récemment acquise).
- Une **plateforme** (par ex., la pile e-commerce, la plateforme de données, le parc ERP).

Un bon premier périmètre contient environ **50 à 200 applications**. Moins que cela et il n'y a rien à analyser ; plus que cela et vous épuiserez votre énergie avant d'arriver à l'analyse.

!!! warning "À éviter"
    Ne choisissez pas « toute l'entreprise » ou « tout l'IT ». Vous passerez trois mois à chasser les données sans jamais arriver à un rapport opérationnel.

## 2. Choisissez le bon premier cas d'usage

Le cas d'usage détermine quels champs comptent, quelles parties prenantes vous sont nécessaires et quel rapport vous présenterez à la fin. Le plus courant — et celui que ce guide suppose à partir de la page 3 — est :

> **Rationalisation du portefeuille applicatif**
>
> Inventorier les applications du périmètre, classer chacune selon sa valeur métier et son aptitude technique, et décider ce qu'il faut **T**olérer, dans quoi **I**nvestir, ce qu'il faut **M**igrer ou **É**liminer (le cadre TIME).

Autres premiers cas d'usage valables — mais n'en choisissez qu'**un** :

| Cas d'usage | Ce que vous peuplerez surtout | Ce que vous laisserez de côté |
|-------------|------------------------------|-------------------------------|
| **Rationalisation du portefeuille applicatif** | Applications, coûts, cycle de vie, valeur métier | Modèle de processus détaillé, interfaces |
| **Planification par capacités** | Capacités métier, Applications, carte thermique des capacités | Détail des coûts, pile technologique |
| **Évaluation de migration cloud** | Applications, Composants IT, modèle de déploiement | Valeur métier, processus |
| **Intégration M&A** | Les deux portefeuilles en tant qu'Applications, analyse des recouvrements | Dates de cycle de vie à long terme |

Si vous hésitez, **choisissez la Rationalisation du portefeuille applicatif**. C'est le point de départ le plus universellement utile et la suite de ce guide est rédigée autour.

## 3. Identifiez vos parties prenantes

Turbo EA inclut un modèle **Stakeholder** intégré (voir [Détails de la fiche](../guide/card-details.md)) : chaque fiche porte une liste de personnes avec des rôles définis (Propriétaire métier, Propriétaire technique, etc.), définis par type de fiche dans le métamodèle. Décidez d'emblée qui occupe chaque rôle pour une Application :

- **Application Owner** — responsable de l'application côté métier. Une personne par appli. Cette personne valide la disposition TIME.
- **Technical Owner** — responsable de son maintien en condition opérationnelle. Souvent le manager d'ingénierie.
- **Architect** — vous, probablement. Joue le rôle de relecteur côté EA et approuve les fiches.

Vous n'avez pas besoin d'assigner des parties prenantes dès le premier jour pour chaque fiche, mais vous devez savoir qui elles *seront* — car en semaine trois, vous leur enverrez des enquêtes pour valider les données.

!!! tip "Bonne pratique"
    Un vrai nom dans le rôle Application Owner vaut plus que dix champs personnalisés parfaitement remplis. Si vous ne remplissez qu'un seul champ au-delà du nom et du cycle de vie, faites-en l'Application Owner.

## 4. Fixez un objectif réaliste de qualité de données

Turbo EA calcule un score de **Qualité de données** (0–100 %) pour chaque fiche, fondé sur les champs pondérés définis dans le métamodèle. C'est le meilleur indicateur avancé de l'utilisabilité de votre inventaire.

Objectifs réalistes pour les 90 premiers jours :

| Phase | Qualité moyenne cible (Applications) | Ce qui est rempli |
|-------|--------------------------------------|-------------------|
| Fin de la semaine 2 (Crawl) | **40–60 %** | Nom, phase de cycle de vie, Description, Business Owner |
| Fin de la semaine 6 (Walk) | **60–75 %** | + Mapping capacités, Coût, disposition TIME |
| Fin du mois 3 (Run) | **75–90 %** | + Pile technologique, interfaces, champs métier personnalisés |

Ne visez pas 100 %. Les 10 derniers pour cent coûtent plus cher que les 60 premiers et changent rarement une décision.

## 5. Engagez-vous sur un livrable unique

Terminez votre session de planification par une déclaration écrite du type :

> *« D'ici la fin de la semaine 6, l'inventaire du domaine Ventes contiendra toutes les applications dont le coût annuel dépasse 50 k€, chacune cartographiée à au moins une capacité métier et portant une disposition TIME. Nous présenterons le Rapport de portefeuille au DSI Ventes en semaine 7. »*

Affichez-la sur un wiki, dans une slide de kickoff, dans la description d'un canal Slack — quelque part de visible. Cette phrase est ce qui empêche le déploiement de dériver vers le purgatoire du « on collecte encore des données ».

Suite : [Commencez par votre inventaire applicatif](start-with-applications.md).
