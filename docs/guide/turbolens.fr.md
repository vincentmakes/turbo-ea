# TurboLens Intelligence IA

Le module **TurboLens** fournit une analyse assistée par IA de votre paysage d'architecture d'entreprise. Il utilise votre fournisseur d'IA configuré pour effectuer une analyse des fournisseurs, une détection des doublons, une évaluation de la modernisation et des recommandations d'architecture.

!!! note
    TurboLens nécessite un fournisseur d'IA commercial (Anthropic Claude, OpenAI, DeepSeek ou Google Gemini) configuré dans les [Paramètres IA](../admin/ai.md). Le module est automatiquement disponible lorsque l'IA est configurée.

!!! info "Crédits"
    TurboLens est basé sur le projet open source [ArchLens](https://github.com/vinod-ea/archlens) de [Vinod](https://github.com/vinod-ea), publié sous licence MIT. La logique d'analyse a été portée de Node.js vers Python et intégrée nativement dans Turbo EA.

## Tableau de bord

Le tableau de bord TurboLens offre une vue d'ensemble instantanée de l'analyse de votre paysage.

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

**Mode d'emploi :**

1. Accédez à **TurboLens > Fournisseurs**
2. Cliquez sur **Lancer l'analyse**
3. L'IA traite votre portefeuille de fournisseurs par lots, en catégorisant chaque fournisseur avec une justification
4. Les résultats affichent une répartition par catégorie et un tableau détaillé des fournisseurs

Chaque entrée de fournisseur comprend la catégorie, la sous-catégorie, le nombre d'applications associées, le coût annuel total et le raisonnement de l'IA pour la catégorisation. Basculez entre les vues grille et tableau à l'aide du sélecteur de vue.

## Résolution des fournisseurs

La résolution des fournisseurs construit une hiérarchie canonique des fournisseurs en résolvant les alias et en identifiant les relations parent-enfant.

**Mode d'emploi :**

1. Accédez à **TurboLens > Résolution**
2. Cliquez sur **Résoudre les fournisseurs**
3. L'IA identifie les alias de fournisseurs (par exemple, «MSFT» = «Microsoft»), les sociétés mères et les regroupements de produits
4. Les résultats affichent la hiérarchie résolue avec des scores de confiance

La hiérarchie organise les fournisseurs en quatre niveaux : fournisseur, produit, plateforme et module. Chaque entrée indique le nombre d'applications et de composants IT associés, le coût total et un pourcentage de confiance.

## Détection des doublons

La détection des doublons identifie les chevauchements fonctionnels dans votre portefeuille — des cartes qui servent le même objectif métier ou un objectif similaire.

**Mode d'emploi :**

1. Accédez à **TurboLens > Doublons**
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

1. Accédez à **TurboLens > Doublons** (onglet Modernisation)
2. Sélectionnez un type de carte cible (Application, Composant IT ou Interface)
3. Cliquez sur **Évaluer la modernisation**
4. Les résultats affichent chaque carte avec le type de modernisation, la recommandation, le niveau d'effort (faible/moyen/élevé) et la priorité (faible/moyenne/élevée/critique)

Les résultats sont regroupés par priorité afin que vous puissiez vous concentrer en premier sur les opportunités de modernisation les plus impactantes.

## Architecture IA

L'Architecture IA est un assistant guidé en 5 étapes qui génère des recommandations d'architecture basées sur votre paysage existant. Elle relie vos objectifs métier et vos capacités à des propositions de solution concrètes, une analyse des écarts, une cartographie des dépendances et un diagramme d'architecture cible.

<div style="text-align: center;">
<iframe width="560" height="315" src="https://www.youtube.com/embed/FDneDl0ULsA" title="Aperçu de l'Architecture IA" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
</div>

Un indicateur de progression en haut suit votre avancement à travers les cinq étapes : Exigences, Adéquation métier, Adéquation technique, Solution et Architecture cible. Vous pouvez cliquer sur n'importe quelle étape précédemment atteinte pour naviguer en arrière et consulter les phases antérieures — toutes les données en aval sont préservées et ne sont effacées que lorsque vous re-soumettez activement une phase. Votre progression est sauvegardée automatiquement dans la session du navigateur, vous pouvez donc naviguer ailleurs et revenir sans perdre votre travail. Vous pouvez également enregistrer les évaluations dans la base de données et les reprendre ultérieurement (voir [Sauvegarder et reprendre](#sauvegarder--reprendre) ci-dessous). Cliquez sur **Nouvelle évaluation** pour démarrer une nouvelle analyse à tout moment.

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

Cliquez sur **Sélectionner** pour l'option que vous souhaitez retenir. Si vous revenez à cette étape après avoir sélectionné une option, l'option précédemment choisie est visuellement mise en évidence avec un contour et un badge «Sélectionné» afin que vous puissiez facilement identifier votre choix actuel.

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

### Sauvegarder et reprendre

Après avoir examiné l'architecture cible, vous pouvez sauvegarder ou valider votre travail :

**Sauvegarder l'évaluation** — Enregistre un instantané complet de l'évaluation (toutes les réponses, les options sélectionnées, l'analyse des écarts, les dépendances et l'architecture cible) dans la base de données. Les évaluations sauvegardées apparaissent dans l'onglet **Évaluations**.

**Reprendre une évaluation sauvegardée** — Les évaluations non validées peuvent être rouvertes dans l'assistant interactif avec un état entièrement restauré :

- Depuis l'onglet **Évaluations**, cliquez sur le bouton **Reprendre** sur n'importe quelle ligne d'évaluation sauvegardée
- Depuis le **Visualiseur d'évaluation** en lecture seule, cliquez sur **Reprendre** dans l'en-tête
- L'assistant restaure la phase et l'état exacts où vous vous étiez arrêté, y compris toutes les questions générées par l'IA, vos réponses, les options sélectionnées et les sélections de produits
- Vous pouvez continuer là où vous vous étiez arrêté, choisir une approche différente ou valider pour créer une initiative
- Sauvegarder à nouveau met à jour l'évaluation existante (au lieu d'en créer une nouvelle)

!!! tip "Instantané complet"
    Une évaluation sauvegardée est un instantané complet de votre session d'assistant. Tant qu'elle n'a pas été validée dans une initiative, vous pouvez la reprendre, choisir une approche de solution différente et la re-sauvegarder autant de fois que nécessaire.

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

Cliquez sur **Choisir une autre option** pour revenir aux options de solution et sélectionner une approche différente. Toutes vos réponses de la Phase 1 et de la Phase 2 sont conservées — seules les données en aval (analyse des écarts, dépendances, architecture cible) sont réinitialisées. Après avoir sélectionné une nouvelle option, l'assistant reprend l'analyse des écarts et l'analyse des dépendances. Vous pouvez sauvegarder l'évaluation mise à jour ou valider lorsque vous êtes prêt.

## Sécurité et conformité

L'onglet **Sécurité et conformité** exécute une analyse à la demande sur le paysage en cours et produit un rapport de risques conforme aux standards ainsi qu'une analyse d'écart réglementaire.

### Ce qui est analysé

- **CVE** — chaque Application et Composant informatique non archivé est recherché dans la [National Vulnerability Database du NIST](https://nvd.nist.gov/) à l'aide des attributs `vendor`, `productName` / `version` de la fiche. Les résultats sont contextualisés par une passe IA qui évalue la **priorité** (critique / élevée / moyenne / faible) et la **probabilité** (très élevée / élevée / moyenne / faible) à partir de la criticité métier, de la phase du cycle de vie, du vecteur d'attaque, de l'exploitabilité et de la disponibilité des correctifs.
- **Conformité** — le même paysage est vérifié par le LLM configuré face à la **Loi européenne sur l'IA**, au **RGPD**, à **NIS2**, à **DORA**, à **SOC 2** et à l'**ISO/IEC 27001**. Chaque réglementation dispose de sa propre liste de contrôle ; les constats sont soit **spécifiques à une fiche** (une fiche précise est à l'origine de l'écart), soit **transversaux** (problème systémique).

### Exécuter une analyse

Seuls les utilisateurs disposant de `security_compliance.manage` peuvent lancer des analyses (admin par défaut). L'onglet Vue d'ensemble propose **deux cartes d'analyse indépendantes** :

- **Analyse CVE** — interroge le NVD + priorisation IA. Peut être relancée sans risque ; les constats de conformité restent intacts.
- **Analyse de conformité** — analyse d'écart par IA sur les réglementations cochées. Remplace les constats de conformité pour les réglementations ciblées lors de cette exécution.

Chaque analyse affiche sa propre barre de progression par phases (chargement des fiches → interrogation du NVD → priorisation IA → enregistrement, ou chargement des fiches → détection sémantique de l'IA → vérification par réglementation). Les deux peuvent s'exécuter simultanément.

Rafraîchir la page **n'interrompt pas une analyse en cours** — la tâche d'arrière-plan continue côté serveur et l'interface se raccroche automatiquement au sondage de progression au rechargement.

### Structure du rapport de risques

- **Vue d'ensemble** — bandeau de KPI (total des constats, nombres critiques / élevés / moyens, score global de conformité), une **matrice de risque probabilité × gravité** 5×5, les cinq constats critiques principaux et une carte thermique compacte de conformité avec navigation vers les détails. La matrice elle-même est **cliquable** : cliquer sur une cellule ouvre le sous-onglet CVE filtré sur ce compartiment, avec un chip supprimable au-dessus du tableau pour voir (et effacer) le filtre actif.
- **CVE** — tableau filtrable présentant la fiche, l'ID CVE (lié vers la page de détail du NVD), le score CVSS de base, la gravité, la priorité, la probabilité, la disponibilité des correctifs et le statut. Chaque ligne ouvre un panneau de détail comportant la description, le vecteur CVSS, le vecteur d'attaque, les scores d'exploitabilité / d'impact, les références, l'impact métier et la remédiation générés par IA, ainsi qu'une barre d'actions d'état (**Accuser réception → Passer en cours → Marquer comme atténué / Accepter le risque / Rouvrir**).
- **Conformité** — un onglet par réglementation avec un score global et une liste sous forme de cartes affichant le statut, l'article, la catégorie, l'exigence, la description de l'écart, la remédiation et les preuves. Un petit chip **Détecté par IA** met en évidence les fiches identifiées comme porteuses d'IA par le détecteur sémantique, même si elles ne sont pas étiquetées comme sous-types d'IA.
- **Exporter en CSV** — télécharge les constats CVE dans un ordre de colonnes inspiré d'OWASP/NIST (Fiche, Type, CVE, CVSS, Gravité, Vecteur d'attaque, Probabilité, Priorité, Correctif, Publié, Dernière modification, Statut, Éditeur, Produit, Version, Impact métier, Remédiation, Description).

### Promouvoir un constat vers le Registre des risques

Chaque panneau CVE et chaque carte de constat de conformité comporte une action primaire **Créer un risque**. Un clic ouvre la boîte de dialogue partagée de création de risque avec le titre, la description, la catégorie, la probabilité, l'impact, la mitigation et la fiche concernée **pré-remplis depuis le constat**. Vous pouvez modifier chaque champ avant de valider, attribuer un **propriétaire** et choisir une **date cible de résolution**. À la validation, la ligne du constat bascule en **Ouvrir le risque R-000123** pour conserver le lien visible — les promotions sont idempotentes côté serveur. Voir le [Registre des risques](risks.md) pour le cycle de vie complet aligné sur TOGAF et la façon dont l'attribution du propriétaire crée un Todo de suivi + une notification dans la cloche.

### Détection sémantique de la Loi européenne sur l'IA

Les fonctionnalités d'IA sont souvent embarquées dans des applications à usage général. La passe sur la Loi européenne sur l'IA **ne repose donc pas uniquement sur le filtrage par sous-type** : elle demande au LLM de signaler toute fiche dont le nom, la description, l'éditeur ou les interfaces liées évoquent des capacités d'IA / ML — LLM, moteurs de recommandation, vision par ordinateur, notation de fraude ou de crédit, chatbots, analytique prédictive, détection d'anomalies. Les constats produits par cette passe sémantique sont marqués **Détecté par IA** pour les distinguer des fiches déjà classées comme `AI Agent` / `AI Model`.

### Progression et reprise

Chaque analyse écrit sa progression par phases (chargement des fiches → interrogation du NVD → priorisation IA → enregistrement, ou chargement des fiches → détection sémantique de l'IA → vérification par réglementation) dans son enregistrement d'exécution. L'interface affiche une barre de progression en direct par analyse. **Rafraîchir la page n'interrompt pas une analyse** — la tâche d'arrière-plan continue côté serveur, et au montage, l'onglet Sécurité interroge `/turbolens/security/active-runs` et se raccroche à la boucle de sondage.

### Clé d'API NVD (optionnelle)

Sans clé, le NVD n'autorise que 5 requêtes par 30 secondes, ce qui peut ralentir les analyses de grands paysages. Demandez une clé gratuite à l'adresse <https://nvd.nist.gov/developers/request-an-api-key> et renseignez-la via la variable d'environnement `NVD_API_KEY` pour porter la limite à 50 requêtes par 30 secondes.

### Flux de statut

Chaque constat CVE suit le cycle : **ouvert** → **accusé réception** → **en cours** → **atténué** (ou **accepté**, lorsque l'équipe a formellement accepté le risque). La réouverture reste toujours possible. Les changements de statut sont pilotés par les utilisateurs disposant de `security_compliance.manage`. Pour les workflows de gouvernance (propriété, évaluation résiduelle, justification d'acceptation, Todos et notifications), promouvez le constat en Risque — le cycle complet vit dans le [Registre des risques](risks.md).

## Historique des analyses

Toutes les exécutions d'analyse sont suivies dans **TurboLens > Historique**, affichant :

- Type d'analyse (analyse des fournisseurs, résolution des fournisseurs, détection des doublons, modernisation, architecte, security_compliance)
- Statut (en cours, terminé, échoué)
- Horodatages de début et de fin
- Messages d'erreur (le cas échéant)

## Permissions

| Permission | Description |
|------------|-------------|
| `turbolens.view` | Consulter les résultats d'analyse (accordée aux rôles admin, bpm_admin, member) |
| `turbolens.manage` | Déclencher des analyses (accordée au rôle admin) |
| `security_compliance.view` | Consulter les constats CVE et de conformité (accordée aux rôles admin, bpm_admin, member, viewer) |
| `security_compliance.manage` | Déclencher des analyses de sécurité et mettre à jour le statut des constats (accordée au rôle admin) |
