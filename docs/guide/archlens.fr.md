# ArchLens Intelligence Artificielle

Le module **ArchLens** fournit une analyse alimentée par l'IA de votre paysage d'architecture d'entreprise. Il utilise votre fournisseur d'IA configuré pour effectuer des analyses de fournisseurs, la détection de doublons, l'évaluation de modernisation et des recommandations d'architecture.

!!! note
    ArchLens nécessite un fournisseur d'IA commercial (Anthropic Claude, OpenAI, DeepSeek ou Google Gemini) configuré dans les [Paramètres IA](../admin/ai.md). Le module est automatiquement disponible lorsque l'IA est configurée.

!!! info "Credits"
    ArchLens est basé sur le projet open source [ArchLens](https://github.com/vinod-ea/archlens) par [Vinod](https://github.com/vinod-ea), publié sous la licence MIT. La logique d'analyse a été portée de Node.js vers Python et intégrée nativement dans Turbo EA.

## Tableau de bord

Le tableau de bord ArchLens fournit une vue d'ensemble de votre analyse de paysage :

| Indicateur | Description |
|-----------|-------------|
| **Total des cartes** | Nombre de cartes actives dans votre portefeuille |
| **Qualité moyenne** | Score moyen de qualité des données sur toutes les cartes |
| **Fournisseurs** | Nombre de fournisseurs de technologie analysés |
| **Clusters de doublons** | Nombre de groupes de doublons identifiés |
| **Modernisations** | Nombre d'opportunités de modernisation trouvées |

Le tableau de bord affiche également les cartes regroupées par type et met en évidence les principaux problèmes de qualité.

## Analyse des fournisseurs

L'analyse des fournisseurs utilise l'IA pour catégoriser vos fournisseurs de technologie dans plus de 45 catégories industrielles (par exemple, CRM, ERP, infrastructure cloud, sécurité).

**Comment l'utiliser :**

1. Naviguez vers **ArchLens > Fournisseurs**
2. Cliquez sur **Lancer l'analyse**
3. L'IA traite votre portefeuille de fournisseurs par lots, catégorisant chaque fournisseur avec un raisonnement
4. Les résultats montrent une répartition par catégorie et un tableau détaillé des fournisseurs

Chaque entrée de fournisseur inclut la catégorie, la sous-catégorie, le nombre d'applications associées, le coût annuel total et le raisonnement de l'IA pour la catégorisation.

## Résolution des fournisseurs

La résolution des fournisseurs construit une hiérarchie canonique des fournisseurs en résolvant les alias et en identifiant les relations parent-enfant.

**Comment l'utiliser :**

1. Naviguez vers **ArchLens > Résolution**
2. Cliquez sur **Résoudre les fournisseurs**
3. L'IA identifie les alias de fournisseurs (par exemple, « MSFT » = « Microsoft »), les sociétés mères et les groupements de produits
4. Les résultats montrent la hiérarchie résolue avec des scores de confiance

## Détection de doublons

La détection de doublons identifie les chevauchements fonctionnels dans votre portefeuille — des cartes qui remplissent le même objectif métier ou un objectif similaire.

**Comment l'utiliser :**

1. Naviguez vers **ArchLens > Doublons**
2. Cliquez sur **Détecter les doublons**
3. L'IA analyse les cartes Application, IT Component et Interface par lots
4. Les résultats montrent des clusters de doublons potentiels avec des preuves et des recommandations

Pour chaque cluster, vous pouvez :

- **Confirmer** — Marquer le doublon comme confirmé pour suivi
- **Investiguer** — Signaler pour investigation approfondie
- **Rejeter** — Rejeter si ce n'est pas un vrai doublon

## Évaluation de modernisation

L'évaluation de modernisation évalue les cartes pour les opportunités de mise à niveau en fonction des tendances technologiques actuelles.

**Comment l'utiliser :**

1. Naviguez vers **ArchLens > Doublons** (section Modernisation)
2. Sélectionnez un type de carte cible (Application, IT Component ou Interface)
3. Cliquez sur **Évaluer la modernisation**
4. Les résultats montrent chaque carte avec le type de modernisation, la recommandation, le niveau d'effort et la priorité

## Architecture AI

L'Architecture AI est un assistant conversationnel en 3 phases qui génère des recommandations d'architecture basées sur votre paysage existant.

**Comment l'utiliser :**

1. Naviguez vers **ArchLens > Architecte**
2. **Phase 1** — Décrivez votre besoin métier (par exemple, « Nous avons besoin d'un portail en libre-service client »). L'IA génère des questions de clarification métier.
3. **Phase 2** — Répondez aux questions de la Phase 1. L'IA génère des questions d'approfondissement technique.
4. **Phase 3** — Répondez aux questions de la Phase 2. L'IA génère une recommandation d'architecture complète comprenant :

| Section | Description |
|---------|-------------|
| **Diagramme d'architecture** | Diagramme Mermaid interactif avec zoom, téléchargement SVG et copie du code |
| **Couches de composants** | Organisées par couche d'architecture avec classification existant/nouveau/recommandé |
| **Lacunes et recommandations** | Lacunes de capacité avec recommandations de produits du marché classées par adéquation |
| **Intégrations** | Carte d'intégration montrant les flux de données, protocoles et directions |
| **Risques et prochaines étapes** | Évaluation des risques avec mesures d'atténuation et étapes de mise en œuvre priorisées |

## Historique des analyses

Toutes les exécutions d'analyse sont suivies dans **ArchLens > Historique**, affichant :

- Type d'analyse (analyse de fournisseurs, résolution de fournisseurs, détection de doublons, modernisation, architecte)
- Statut (en cours, terminé, échoué)
- Horodatages de début et de fin
- Messages d'erreur (le cas échéant)

## Permissions

| Permission | Description |
|------------|-------------|
| `archlens.view` | Voir les résultats d'analyse (accordé à admin, bpm_admin, member) |
| `archlens.manage` | Déclencher des analyses (accordé à admin) |
