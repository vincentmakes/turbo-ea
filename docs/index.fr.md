# Introduction à Turbo EA

### Qu'est-ce que Turbo EA ?

**Turbo EA** est une plateforme moderne et auto-hébergée pour la **gestion de l'architecture d'entreprise**. Elle permet aux organisations de documenter, visualiser et gérer tous les composants de leur architecture métier et technologique en un seul endroit.

### À qui s'adresse ce guide ?

Ce guide s'adresse à **toutes les personnes utilisant Turbo EA** -- architectes d'entreprise, responsables informatiques, analystes métier, développeurs et administrateurs. Que vous évaluiez la plateforme, gériez le paysage informatique de votre organisation au quotidien, ou configuriez le système en tant qu'administrateur, vous trouverez ici les informations dont vous avez besoin. Aucune connaissance technique avancée n'est requise pour commencer.

### Avantages clés

- **Visibilité complète** : Visualisez toutes les applications, processus, capacités et technologies de l'organisation dans une seule plateforme.
- **Prise de décision éclairée** : Des rapports visuels (portefeuille, cartes de capacités, dépendances, cycle de vie, coûts, et plus) qui facilitent l'évaluation de l'état actuel de l'infrastructure technologique.
- **Gestion du cycle de vie** : Suivez le statut de chaque composant technologique à travers cinq phases -- de la planification jusqu'au retrait.
- **Collaboration** : Plusieurs utilisateurs peuvent travailler simultanément, avec des rôles configurables, des affectations de parties prenantes, des commentaires, des tâches et des notifications.
- **Descriptions assistées par IA** : Générez des descriptions de fiches en un seul clic. Turbo EA combine la recherche web avec un LLM local ou commercial pour produire des résumés adaptés au type -- avec des scores de confiance et des liens vers les sources. Fonctionne entièrement sur votre infrastructure pour la confidentialité, ou connectez-vous à des fournisseurs commerciaux (OpenAI, Google Gemini, Anthropic Claude, et plus). Entièrement contrôlé par l'administrateur : choisissez quels types de fiches bénéficient des suggestions IA, sélectionnez votre fournisseur de recherche et choisissez le modèle.
- **Diagrammes visuels** : Créez des diagrammes d'architecture avec l'éditeur DrawIO intégré, entièrement synchronisé avec votre inventaire de fiches.
- **Modélisation des processus métier** : Éditeur de flux de processus BPMN 2.0 avec liaison d'éléments, workflows d'approbation et évaluations de maturité.
- **Intégration ServiceNow** : Synchronisation bidirectionnelle avec ServiceNow CMDB pour maintenir votre paysage EA connecté aux données des opérations informatiques.
- **Multilingue** : Disponible en anglais, espagnol, français, allemand, italien, portugais et chinois.

### Concepts clés

| Terme | Signification |
|-------|---------------|
| **Fiche** | L'élément de base de la plateforme. Représente tout composant d'architecture : une application, un processus, une capacité métier, etc. |
| **Type de fiche** | La catégorie à laquelle appartient une fiche (Application, Processus Métier, Organisation, etc.) |
| **Relation** | Une connexion entre deux fiches qui décrit comment elles sont liées (par ex. « utilise », « dépend de », « fait partie de ») |
| **Métamodèle** | La structure qui définit quels types de fiches existent, quels champs elles possèdent, et comment elles sont reliées entre elles. Entièrement configurable par l'administrateur |
| **Cycle de vie** | Les phases temporelles d'un composant : Planification, Mise en service, Actif, Retrait progressif, Fin de vie |
| **Inventaire** | Liste recherchable et filtrable de toutes les fiches, tous types confondus. Édition en lot, import-export Excel/CSV et vues sauvegardées avec partage |
| **Rapports** | Visualisations préconçues : Portefeuille, Carte des capacités, Cycle de vie, Dépendances, Coûts, Matrice, Qualité des données et Fin de vie |
| **BPM** | Gestion des processus métier -- modélisez les processus avec un éditeur BPMN 2.0, liez les éléments du diagramme aux fiches et évaluez maturité, risque et automatisation |
| **PML** | Project Portfolio Management -- gérez les fiches Initiative comme des projets complets avec rapports d'état, Work Breakdown Structures, tableaux kanban et Gantt, budgets, coûts et un registre des risques par initiative |
| **TurboLens** | Intelligence EA pilotée par IA -- analyse fournisseurs, détection de doublons, évaluation de modernisation, l'assistant Architecture AI en 5 étapes et les scans de Conformité (EU AI Act / RGPD / NIS2 / DORA / SOC 2 / ISO 27001) |
| **EA Delivery** | La surface de livraison alignée TOGAF -- Statements of Architecture Work, Architecture Decision Records et le Registre des risques au niveau du paysage |
| **SoAW** | Statement of Architecture Work -- document TOGAF formel qui délimite le périmètre d'une initiative d'architecture |
| **ADR** | Architecture Decision Record -- capture le contexte, les alternatives et les conséquences d'une décision, avec workflow de statut et liaison aux fiches |
| **Registre des risques** | Registre des risques au niveau du paysage (TOGAF Phase G), distinct des risques au niveau initiative du PML. L'affectation d'un propriétaire crée automatiquement une tâche |
| **Portail Web** | Vue publique, basée sur un slug et en lecture seule, d'une partie du paysage EA -- partageable sans connexion |
| **Serveur MCP** | Accès IA en lecture seule via le Model Context Protocol -- interrogez vos données EA depuis Claude Desktop, Cursor, GitHub Copilot et d'autres clients MCP |
| **RBAC** | Contrôle d'accès basé sur les rôles -- rôles au niveau application plus rôles de partie prenante par fiche, avec plus de 50 permissions granulaires |
