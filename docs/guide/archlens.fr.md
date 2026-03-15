# ArchLens Intelligence IA

Le module **ArchLens** fournit une analyse assistée par IA de votre paysage d'architecture d'entreprise. Il utilise votre fournisseur d'IA configuré pour effectuer une analyse des fournisseurs, une détection des doublons, une évaluation de la modernisation et des recommandations d'architecture.

!!! note
    ArchLens nécessite un fournisseur d'IA commercial (Anthropic Claude, OpenAI, DeepSeek ou Google Gemini) configuré dans les [Paramètres IA](../admin/ai.md). Le module est automatiquement disponible lorsque l'IA est configurée.

!!! info "Crédits"
    ArchLens est basé sur le projet open source [ArchLens](https://github.com/vinod-ea/archlens) de [Vinod](https://github.com/vinod-ea), publié sous licence MIT. La logique d'analyse a été portée de Node.js vers Python et intégrée nativement dans Turbo EA.

## Tableau de bord

Le tableau de bord ArchLens offre une vue d'ensemble instantanée de l'analyse de votre paysage.

![Tableau de bord ArchLens](../assets/img/fr/48_archlens_tableau_bord.png)

| Indicateur | Description |
|------------|-------------|
| **Total des cartes** | Nombre de cartes actives dans votre portefeuille |
| **Qualité moyenne** | Score moyen de qualité des données sur l'ensemble des cartes |
| **Fournisseurs** | Nombre de fournisseurs technologiques analysés |
| **Groupes de doublons** | Nombre de groupes de doublons identifiés |
| **Modernisations** | Nombre d'opportunités de modernisation détectées |
| **Coût annuel** | Coût annuel total sur l'ensemble des cartes |

Le tableau de bord affiche également :

- **Cartes par type** — Répartition du nombre de cartes par type de carte
- **Distribution de la qualité des données** — Cartes regroupées en niveaux Bronze (<50 %), Argent (50–80 %) et Or (>80 %)
- **Principaux problèmes de qualité** — Cartes ayant les scores de qualité des données les plus faibles, avec des liens directs vers chaque carte

## Analyse des fournisseurs

L'analyse des fournisseurs utilise l'IA pour classer vos fournisseurs technologiques dans plus de 45 catégories sectorielles (par exemple, CRM, ERP, Infrastructure cloud, Sécurité).

![Analyse des fournisseurs](../assets/img/fr/49_archlens_fournisseurs.png)

**Mode d'emploi :**

1. Accédez à **ArchLens > Fournisseurs**
2. Cliquez sur **Lancer l'analyse**
3. L'IA traite votre portefeuille de fournisseurs par lots, en catégorisant chaque fournisseur avec une justification
4. Les résultats affichent une répartition par catégorie et un tableau détaillé des fournisseurs

Chaque entrée de fournisseur comprend la catégorie, la sous-catégorie, le nombre d'applications associées, le coût annuel total et le raisonnement de l'IA pour la catégorisation. Basculez entre les vues grille et tableau à l'aide du sélecteur de vue.

## Résolution des fournisseurs

La résolution des fournisseurs construit une hiérarchie canonique des fournisseurs en résolvant les alias et en identifiant les relations parent-enfant.

![Résolution des fournisseurs](../assets/img/fr/50_archlens_resolution.png)

**Mode d'emploi :**

1. Accédez à **ArchLens > Résolution**
2. Cliquez sur **Résoudre les fournisseurs**
3. L'IA identifie les alias de fournisseurs (par exemple, «MSFT» = «Microsoft»), les sociétés mères et les regroupements de produits
4. Les résultats affichent la hiérarchie résolue avec des scores de confiance

La hiérarchie organise les fournisseurs en quatre niveaux : fournisseur, produit, plateforme et module. Chaque entrée indique le nombre d'applications et de composants IT associés, le coût total et un pourcentage de confiance.

## Détection des doublons

La détection des doublons identifie les chevauchements fonctionnels dans votre portefeuille — des cartes qui servent le même objectif métier ou un objectif similaire.

![Détection des doublons](../assets/img/fr/51_archlens_doublons.png)

**Mode d'emploi :**

1. Accédez à **ArchLens > Doublons**
2. Cliquez sur **Détecter les doublons**
3. L'IA analyse les cartes Application, Composant IT et Interface par lots
4. Les résultats affichent des groupes de doublons potentiels avec des preuves et des recommandations

Pour chaque groupe, vous pouvez :

- **Confirmer** — Marquer le doublon comme confirmé pour un suivi
- **Investiguer** — Signaler pour une investigation approfondie
- **Ignorer** — Ignorer s'il ne s'agit pas d'un vrai doublon

## Évaluation de la modernisation

L'évaluation de la modernisation analyse les cartes pour identifier des opportunités de mise à niveau basées sur les tendances technologiques actuelles.

**Mode d'emploi :**

1. Accédez à **ArchLens > Doublons** (onglet Modernisation)
2. Sélectionnez un type de carte cible (Application, Composant IT ou Interface)
3. Cliquez sur **Évaluer la modernisation**
4. Les résultats affichent chaque carte avec le type de modernisation, la recommandation, le niveau d'effort (faible/moyen/élevé) et la priorité (faible/moyenne/élevée/critique)

Les résultats sont regroupés par priorité afin que vous puissiez vous concentrer en premier sur les opportunités de modernisation les plus impactantes.

## Architecture IA

L'Architecture IA est un assistant guidé en 5 étapes qui génère des recommandations d'architecture basées sur votre paysage existant. Elle relie vos objectifs métier et vos capacités à des propositions de solution concrètes, une analyse des écarts, une cartographie des dépendances et un diagramme d'architecture cible.

![Architecture IA](../assets/img/fr/52_archlens_architecte.png)

Un indicateur de progression en haut suit votre avancement à travers les cinq étapes : Exigences, Adéquation métier, Adéquation technique, Solution et Architecture cible. Votre progression est sauvegardée automatiquement dans la session du navigateur, vous pouvez donc naviguer ailleurs et revenir sans perdre votre travail. Cliquez sur **Nouvelle évaluation** pour démarrer une nouvelle analyse à tout moment.

### Étape 1 : Exigences

Saisissez votre exigence métier en langage naturel (par exemple, «Nous avons besoin d'un portail libre-service pour les clients»). Ensuite :

- **Sélectionner des objectifs métier** — Choisissez une ou plusieurs cartes Objectif existantes dans la liste déroulante de saisie semi-automatique. Cela ancre l'analyse de l'IA dans vos objectifs stratégiques. Au moins un objectif est requis.
- **Sélectionner des Business Capabilities** (facultatif) — Choisissez des cartes Business Capability existantes ou saisissez de nouveaux noms de capacités. Les nouvelles capacités apparaissent sous forme de puces bleues étiquetées «NOUVEAU : nom». Cela aide l'IA à se concentrer sur des domaines de capacités spécifiques.

Cliquez sur **Générer des questions** pour continuer.

### Étape 2 : Adéquation métier (Phase 1)

L'IA génère des questions de clarification métier adaptées à votre exigence et à vos objectifs sélectionnés. Les questions se présentent sous différents types :

- **Texte** — Champs de réponse libre
- **Choix unique** — Cliquez sur une puce d'option pour sélectionner
- **Choix multiple** — Cliquez sur plusieurs puces d'options ; vous pouvez également saisir une réponse personnalisée et appuyer sur Entrée

Chaque question peut inclure un contexte expliquant pourquoi l'IA pose cette question (note «Impact»). Répondez à toutes les questions et cliquez sur **Soumettre** pour passer à la Phase 2.

### Étape 3 : Adéquation technique (Phase 2)

L'IA génère des questions d'approfondissement technique basées sur vos réponses de la Phase 1. Celles-ci peuvent inclure des catégories NFR (exigences non fonctionnelles) telles que la performance, la sécurité ou la scalabilité. Répondez à toutes les questions et cliquez sur **Analyser les capacités** pour générer des options de solution.

### Étape 4 : Solution (Phase 3)

Cette étape comporte trois sous-phases :

#### 3a : Options de solution

L'IA génère plusieurs options de solution, chacune présentée sous forme de carte avec :

| Élément | Description |
|---------|-------------|
| **Approche** | Acheter, Construire, Étendre ou Réutiliser — puce avec code couleur |
| **Résumé** | Brève description de l'approche |
| **Avantages et inconvénients** | Principaux atouts et désavantages |
| **Estimations** | Coût, durée et complexité estimés |
| **Aperçu de l'impact** | Nouveaux composants, composants modifiés, composants retirés et nouvelles intégrations qu'introduirait cette option |

Cliquez sur **Sélectionner** pour l'option que vous souhaitez retenir.

#### 3b : Analyse des écarts

Après avoir sélectionné une option, l'IA identifie les lacunes de capacités dans votre paysage actuel. Chaque lacune affiche :

- **Nom de la capacité** avec niveau d'urgence (critique/élevé/moyen)
- **Description de l'impact** expliquant pourquoi cette lacune est importante
- **Recommandations du marché** — Recommandations de produits classées (or n°1, argent n°2, bronze n°3) avec fournisseur, justification, avantages/inconvénients, coût estimé et effort d'intégration

Sélectionnez les produits que vous souhaitez inclure en cliquant sur les cartes de recommandation (des cases à cocher apparaissent). Cliquez sur **Analyser les dépendances** pour continuer.

#### 3c : Analyse des dépendances

Après avoir sélectionné les produits, l'IA identifie les dépendances supplémentaires d'infrastructure, de plateforme ou de middleware requises par vos sélections. Chaque dépendance affiche :

- **Besoin** avec niveau d'urgence
- **Raison** expliquant pourquoi cette dépendance est requise
- **Options** — Produits alternatifs pour satisfaire la dépendance, avec le même niveau de détail que les recommandations sur les écarts

Sélectionnez les dépendances et cliquez sur **Générer la carte des capacités** pour produire l'architecture cible finale.

### Étape 5 : Architecture cible

La dernière étape génère une cartographie complète des capacités :

| Section | Description |
|---------|-------------|
| **Résumé** | Présentation générale de l'architecture proposée |
| **Capacités** | Liste des Business Capabilities correspondantes — existantes (vert) et nouvellement proposées (bleu) |
| **Cartes proposées** | Nouvelles cartes à créer dans votre paysage, affichées avec leurs icônes de type de carte et leurs sous-types |
| **Relations proposées** | Connexions entre les cartes proposées et les éléments du paysage existant |
| **Diagramme de dépendances** | Diagramme C4 interactif affichant les nœuds existants aux côtés des nœuds proposés (bordures en pointillés avec badge vert «NEW»). Déplacez, zoomez et explorez l'architecture visuellement |

À partir de cette étape, vous pouvez cliquer sur **Choisir une autre option** pour revenir en arrière et sélectionner une option de solution différente, ou sur **Recommencer** pour démarrer une évaluation entièrement nouvelle.

!!! warning "Évaluation assistée par IA"
    Cette évaluation utilise l'IA pour générer des recommandations, des options de solution et une architecture cible. Elle doit être réalisée par un professionnel IT qualifié (architecte d'entreprise, architecte de solutions, responsable IT) en collaboration avec les parties prenantes métier. Les résultats générés nécessitent un jugement professionnel et peuvent contenir des inexactitudes. Utilisez les résultats comme point de départ pour des discussions et un approfondissement ultérieurs.

### Sauvegarder et valider

Après avoir examiné l'architecture cible, vous disposez de deux options :

**Sauvegarder l'évaluation** — Enregistre l'évaluation pour une consultation ultérieure via l'onglet «Évaluations». Les évaluations sauvegardées sont accessibles à tout utilisateur disposant de la permission `archlens.view`.

**Valider et créer une initiative** — Convertit la proposition d'architecture en cartes réelles dans votre paysage :

- **Nom de l'initiative** est prérempli avec le titre de l'option de solution sélectionnée (modifiable avant la création)
- **Dates de début/fin** pour le calendrier de l'initiative
- **Nouvelles cartes proposées** avec des commutateurs pour inclure ou exclure des cartes individuelles, et des icônes d'édition pour renommer les cartes avant leur création. Cette liste inclut les nouvelles Business Capabilities identifiées lors de l'évaluation.
- **Relations proposées** avec des commutateurs pour inclure ou exclure
- Un indicateur de progression affiche l'état de création (initiative → cartes → relations → ADR)
- En cas de succès, un lien ouvre la nouvelle carte Initiative

### Garde-fous architecturaux

Le système garantit automatiquement l'intégrité architecturale :

- Chaque nouvelle application est liée à au moins une Business Capability
- Chaque nouvelle Business Capability est liée aux objectifs métier sélectionnés
- Les cartes sans relations (orphelines) sont automatiquement retirées de la proposition

### Architecture Decision Record

Un brouillon d'ADR est automatiquement créé avec l'initiative, comprenant :

- **Contexte** issu du résumé du mapping des capabilities
- **Décision** capturant l'approche et les produits sélectionnés
- **Alternatives considérées** issues des options de solution non retenues

### Changer d'approche

Cliquez sur **Choisir une autre option** pour sélectionner une option de solution différente. L'évaluation est réévaluée et sauvegardée à nouveau avec les données mises à jour, vous permettant de comparer les approches avant de valider.

## Historique des analyses

Toutes les exécutions d'analyse sont suivies dans **ArchLens > Historique**, affichant :

![Historique des analyses](../assets/img/fr/53_archlens_historique.png)

- Type d'analyse (analyse des fournisseurs, résolution des fournisseurs, détection des doublons, modernisation, architecte)
- Statut (en cours, terminé, échoué)
- Horodatages de début et de fin
- Messages d'erreur (le cas échéant)

## Permissions

| Permission | Description |
|------------|-------------|
| `archlens.view` | Consulter les résultats d'analyse (accordée aux rôles admin, bpm_admin, member) |
| `archlens.manage` | Déclencher des analyses (accordée au rôle admin) |
