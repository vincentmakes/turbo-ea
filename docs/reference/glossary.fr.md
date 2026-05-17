# Glossaire des termes

| Terme | Définition |
|-------|------------|
| **ADR (Architecture Decision Record)** | Un document formel qui enregistre une décision d'architecture importante, incluant le contexte, la justification, les conséquences et les alternatives envisagées. Les ADR supportent un processus de signature et une chaîne de révisions |
| **Année fiscale** | La période de 12 mois utilisée pour la budgétisation et les rapports financiers. Configurable via Admin > Paramètres — le mois de début (janvier à décembre) détermine le regroupement des lignes budgétaires PPM |
| **Statut d'approbation** | L'état de révision d'une fiche : Brouillon, Approuvé, Cassé ou Rejeté. Les fiches approuvées passent à Cassé lorsqu'elles sont modifiées |
| **Signet / Vue sauvegardée** | Une configuration sauvegardée de filtres, colonnes et tri dans l'Inventaire qui peut être rechargée en un clic |
| **BPM** | Gestion des processus métier -- la discipline de modélisation, d'analyse et d'amélioration des processus métier |
| **BPMN** | Business Process Model and Notation -- la notation standard pour la modélisation des processus métier (version 2.0) |
| **Capacité métier** | Ce qu'une organisation peut faire, indépendamment de la manière dont elle le fait |
| **Calcul** | Une formule définie par l'administrateur qui calcule automatiquement une valeur de champ lorsqu'une fiche est sauvegardée |
| **Fiche** | L'unité d'information de base dans Turbo EA représentant tout composant d'architecture |
| **Type de fiche** | La catégorie à laquelle appartient une fiche (par ex. Application, Processus Métier, Organisation) |
| **Score de confiance** | Une note de 0 à 100% indiquant la fiabilité d'une description générée par IA |
| **Ligne de coût** | Une entrée de budget ou de coût réel (CapEx/OpEx) dans une initiative PPM, utilisée pour suivre les dépenses financières |
| **Qualité des données** | Un score de complétude de 0 à 100% basé sur les champs remplis et leurs poids configurés |
| **Diagramme** | Un diagramme d'architecture visuel créé avec l'éditeur DrawIO intégré |
| **Fichier joint** | Un fichier binaire (PDF, DOCX, XLSX, images, jusqu'à 10 Mo) téléversé directement sur une fiche via l'onglet Ressources |
| **Flux OData** | Un flux de données JSON disponible sur les vues d'inventaire enregistrées (favoris) pour la consommation par des outils externes tels que Power BI ou Excel |
| **DrawIO** | L'outil de création de diagrammes open source intégré utilisé pour les diagrammes d'architecture visuels |
| **Architecture d'entreprise (EA)** | La discipline qui organise et documente la structure métier et technologique d'une organisation |
| **EOL (Fin de vie)** | La date à laquelle un produit technologique perd le support du fournisseur. Suivi via l'intégration avec endoflife.date |
| **Diagramme de Gantt** | Une chronologie visuelle avec des barres horizontales montrant le calendrier, la durée et l'avancement du projet |
| **Initiative** | Un projet ou programme impliquant des modifications de l'architecture |
| **Cycle de vie** | Les cinq phases par lesquelles passe un composant : Planification, Mise en service, Actif, Retrait progressif, Fin de vie |
| **LLM** | Grand modèle de langage -- un modèle d'IA qui génère du texte (par ex. Ollama, OpenAI, Anthropic Claude, Google Gemini) |
| **MCP** | Model Context Protocol -- un standard ouvert permettant aux outils d'IA (Claude, Copilot, Cursor) de se connecter à des sources de données externes. Le serveur MCP intégré de Turbo EA fournit un accès en lecture seule aux données EA avec RBAC par utilisateur |
| **Métamodèle** | Le modèle piloté par les données qui définit la structure de la plateforme : types de fiches, champs, relations et rôles |
| **Jalon** | Un événement significatif ou point d'achèvement dans le calendrier d'un projet, affiché comme un indicateur en losange dans le diagramme de Gantt |
| **Notification** | Une alerte dans l'application ou par e-mail déclenchée par des événements système (tâche assignée, fiche mise à jour, commentaire ajouté, etc.) |
| **Ollama** | Un outil open source pour exécuter des LLM localement sur votre propre matériel |
| **Ordre des lignes BPM** | L'ordre d'affichage des lignes de types de processus (Cœur, Support, Management) dans le navigateur de processus BPM, configurable en glissant les lignes |
| **Portefeuille** | Un ensemble d'applications ou de technologies gérées en tant que groupe |
| **PPM** | Gestion de Portefeuille de Projets — la discipline de gestion d'un portefeuille de projets et d'initiatives avec budgets, risques, tâches et rapports de statut |
| **Numéro de référence** | Un identifiant séquentiel généré automatiquement pour les ADR (par ex. ADR-001, ADR-002) fournissant une étiquette unique et lisible |
| **Relation** | Une connexion entre deux fiches qui décrit comment elles sont liées (par ex. « utilise », « dépend de », « s'exécute sur ») |
| **Onglet Ressources** | Un onglet de la page de détail de la fiche qui regroupe les Décisions d'architecture, les fichiers joints et les liens documentaires |
| **Révision (ADR)** | Une nouvelle version d'un ADR signé qui hérite du contenu et des liaisons avec les fiches de la version précédente, avec un numéro de révision incrémenté |
| **Statut RAG** | Indicateur de santé Rouge-Ambre-Vert utilisé dans les rapports de statut PPM pour le calendrier, les coûts et le périmètre |
| **Score de risque** | Une valeur calculée automatiquement (probabilité x impact) qui quantifie la gravité d'un risque projet |
| **Rapport sauvegardé** | Une configuration de rapport persistée avec des filtres, des axes et des paramètres de visualisation qui peut être rechargée |
| **Section** | Une zone regroupable de la page de détail de la fiche contenant des champs liés, configurable par type de fiche |
| **Signataire** | Un utilisateur désigné pour examiner et signer un document ADR ou SoAW. Le processus de signature suit les signatures en attente et terminées |
| **SoAW** | Statement of Architecture Work -- un document formel TOGAF définissant la portée et les livrables d'une initiative |
| **SSO** | Single Sign-On -- connexion utilisant les identifiants d'entreprise via un fournisseur d'identité (Microsoft, Google, Okta, OIDC) |
| **Sous-type** | Une classification secondaire au sein d'un type de fiche (par ex. Application a les sous-types : Application métier, Microservice, Agent IA, Déploiement). Chaque sous-type agit comme un sous-modèle pouvant contrôler la visibilité des champs |
| **Modèle de sous-type** | La configuration des champs visibles ou masqués pour un sous-type spécifique. Les administrateurs configurent cela dans l'administration du métamodèle en cliquant sur un chip de sous-type |
| **Partie prenante** | Une personne ayant un rôle spécifique sur une fiche (par ex. Responsable Applicatif, Responsable Technique) |
| **Enquête** | Un questionnaire de maintenance de données ciblant des types de fiches spécifiques pour collecter des informations auprès des parties prenantes |
| **Tag / Groupe de tags** | Une étiquette de classification organisée en groupes avec des modes de sélection unique ou multiple, des restrictions de type optionnelles et un indicateur d'obligation optionnel qui bloque l'approbation et alimente le score de qualité des données |
| **Groupe de tags obligatoire** | Un groupe de tags marqué comme requis. Les fiches applicables ne peuvent pas être approuvées tant qu'au moins un tag du groupe n'a pas été attaché ; sa satisfaction contribue au score de qualité des données de la fiche |
| **Détection sémantique de la Loi européenne sur l'IA** | Passe de conformité TurboLens qui demande au LLM de signaler les fiches intégrant des capacités IA / ML (LLM, moteurs de recommandation, vision par ordinateur, scoring, chatbots, …) même lorsqu'elles ne sont pas explicitement classées comme `AI Agent` / `AI Model`. Ces constats sont marqués **Détecté par IA** |
| **Risque initial vs. résiduel** | Deux évaluations capturées sur chaque risque du Registre des risques. `Initial` désigne la probabilité × l'impact non atténués ; `Résiduel` désigne la probabilité × l'impact après mitigation, modifiables une fois qu'un plan de mitigation existe. Les deux dérivent un niveau via la matrice 4×4 |
| **Référence de risque** | Identifiant monotone lisible (`R-000123`) attribué à la création d'un risque. Il reste visible sur les boutons de constats promus (**Ouvrir le risque R-000123**) et dans la description du Todo lié au propriétaire |
| **TOGAF** | The Open Group Architecture Framework -- une méthodologie EA largement utilisée. La fonctionnalité SoAW de Turbo EA est alignée sur TOGAF |
| **Rapport de statut** | Un rapport PPM mensuel suivant la santé du projet via des indicateurs RAG pour le calendrier, les coûts et le périmètre |
| **Portail web** | Une vue publique en lecture seule de fiches sélectionnées accessible sans authentification via une URL unique |
| **Structure de Découpage du Travail (WBS)** | Une décomposition hiérarchique du périmètre du projet en lots de travaux |
| **Lot de travaux** | Un regroupement logique de tâches dans un calendrier Gantt avec ses propres dates de début/fin et pourcentage d'achèvement |
| **Suggestion IA** | Une description de fiche générée automatiquement produite en combinant les résultats de recherche web avec un grand modèle de langage (LLM) |
| **Verdict IA** | La confirmation ou le rejet par l'utilisateur du classement IA effectué par le LLM sur une fiche (`hasAiFeatures = true / false`). Persiste à travers les re-scans afin qu'une dérive du LLM ne modifie pas silencieusement le périmètre de l'AI Act européen |
| **GRC** | Gouvernance, Risque et Conformité — l'espace de travail unifié à `/grc` regroupant trois onglets (Gouvernance, Risque, Conformité) qui consolident les Principes EA, les ADR, le Registre des risques et le scanner Sécurité & Conformité |
| **Phase G** | Phase ADM « Implementation Governance » de TOGAF. Source du vocabulaire et du cycle de vie du Registre des risques |
| **Registre des risques** | Registre paysage des risques d'architecture aligné sur TOGAF Phase G. Vit à `/grc?tab=risk`. Distinct des risques au périmètre d'une initiative dans PPM |
| **Propriétaire de risque** | L'utilisateur responsable d'un risque. L'attribution crée automatiquement un Todo système sur la page Todos du propriétaire et déclenche une notification `risk_assigned` |
| **Tâche de mitigation** | Élément de travail détenu rattaché à un Risque, qui capture l'activité concrète de mitigation. Peut être one-shot ou récurrente (quotidienne / hebdomadaire / mensuelle / annuelle). Les tâches récurrentes avancent calendairement correctement à la clôture |
| **Cycle de tâche de mitigation** | Une instance planifiée d'une Tâche de mitigation. Passe par `scheduled` → `open` → `done` / `skipped`. Capture un instantané du destinataire à l'ouverture et du propriétaire à la clôture, de sorte que les réponses d'audit survivent à la rotation des propriétaires |
| **Délai d'avance (Tâche de mitigation)** | Nombre de jours avant `due_date` où un cycle planifié est promu en `open` et atterrit sur la liste de Todos du destinataire. Valeurs par défaut intelligentes par unité (1 / 2 / 7 / 14 pour quotidien / hebdomadaire / mensuel / annuel), plafonnées à la moitié de la durée du cycle |
| **Constat de conformité** | Une ligne du registre Conformité contre une réglementation × article. Saisi manuellement par un examinateur ou produit par un scan IA TurboLens ; les deux types partagent le même cycle de vie et peuvent être promus en Risque |
| **Macro-capacité** | Regroupement de niveau 0 au-dessus de L1 dans le Catalogue des capacités. Atterrit comme une carte `BusinessCapability` avec `attributes.capabilityLevel = "Macro"` et un `catalogueId` préfixé `MC-`. Relâche la limite de profondeur de hiérarchie à 6 |
| **Vue de dépendances en couches (LDV)** | Notation maison de Turbo EA pour les diagrammes de dépendances : cartes regroupées dans les quatre couches EA comme des couloirs de nage, colorées par type de carte, avec les cartes proposées rendues comme des nœuds à bordure pointillée et un badge vert « NEW ». Utilisée par le rapport Dépendances, la section dépendances du détail de carte et l'architecture cible de TurboLens Architect |
| **TIME (Tolerate / Invest / Migrate / Eliminate)** | Un cadre de classification de portefeuille en quatre dispositions pour les applications, popularisé par Gartner. Chaque application reçoit une décision — Tolerate (conserver en l'état), Invest (financer des améliorations), Migrate (remplacer ou rehéberger) ou Eliminate (mettre hors service). Dans Turbo EA, il est généralement ajouté comme champ `single_select` sur le type Application et utilisé comme axe couleur du Rapport de portefeuille |
| **Rationalisation du portefeuille applicatif** | L'initiative EA initiale la plus courante sur Turbo EA : inventorier les applications du périmètre, les classer par valeur métier et adéquation technique, et leur affecter une disposition TIME pour piloter les décisions de consolidation, de remplacement ou de retrait |
| **Crawl-Walk-Run** | Le schéma de déploiement par phases recommandé dans le Guide du débutant EA. Crawl = périmètre étroit, Applications uniquement, cinq champs par fiche. Walk = ajouter la cartographie des capacités et une première analyse de portefeuille. Run = étendre aux processus, interfaces, données et aux modules avancés |
