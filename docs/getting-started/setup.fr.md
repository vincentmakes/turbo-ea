# Installation et configuration

Ce guide vous accompagne dans l'installation de Turbo EA avec Docker, la configuration de l'environnement, le chargement des données de démonstration et le démarrage des services optionnels comme l'IA et le serveur MCP.

## Prérequis

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

## Étape 1 : Cloner et configurer

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
cp .env.example .env
```

Ouvrez `.env` dans un éditeur de texte et définissez les valeurs requises :

```dotenv
# Identifiants PostgreSQL (utilisés par le conteneur de base de données intégré)
POSTGRES_PASSWORD=choisissez-un-mot-de-passe-fort

# Clé de signature JWT — générez-en une avec :
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=votre-cle-generee

# Port sur lequel l'application sera accessible
HOST_PORT=8920
```

## Étape 2 : Choisir l'option de base de données

### Option A : Base de données intégrée (recommandée pour débuter)

Le fichier `docker-compose.db.yml` démarre un conteneur PostgreSQL avec le backend et le frontend. Aucune base de données externe n'est nécessaire — les données sont persistées dans un volume Docker.

```bash
docker compose -f docker-compose.db.yml up --build -d
```

### Option B : PostgreSQL externe

Si vous disposez déjà d'un serveur PostgreSQL (base de données gérée, conteneur séparé ou installation locale), utilisez le fichier de base `docker-compose.yml` qui ne démarre que le backend et le frontend.

Créez d'abord une base de données et un utilisateur :

```sql
CREATE USER turboea WITH PASSWORD 'votre-mot-de-passe';
CREATE DATABASE turboea OWNER turboea;
```

Puis configurez votre `.env` :

```dotenv
POSTGRES_HOST=votre-hote-postgresql
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=votre-mot-de-passe
```

Démarrez l'application :

```bash
docker compose up --build -d
```

!!! note
    Le fichier de base `docker-compose.yml` nécessite un réseau Docker nommé `guac-net`. Créez-le avec `docker network create guac-net` s'il n'existe pas.

## Étape 3 : Charger les données de démonstration (optionnel)

Turbo EA peut démarrer avec un métamodèle vide (uniquement les 14 types de cards intégrés et les types de relations) ou avec un jeu de données de démonstration complet. Les données de démonstration sont idéales pour évaluer la plateforme, animer des formations ou explorer les fonctionnalités.

### Options de chargement

Ajoutez ces variables à votre `.env` **avant le premier démarrage** :

| Variable | Par défaut | Description |
|----------|------------|-------------|
| `SEED_DEMO` | `false` | Charge le jeu complet de données NexaTech Industries, incluant BPM et PPM |
| `SEED_BPM` | `false` | Charge uniquement les processus de démonstration BPM (nécessite les données de base) |
| `SEED_PPM` | `false` | Charge uniquement les données de projet PPM (nécessite les données de base) |
| `RESET_DB` | `false` | Supprime toutes les tables et les recrée au démarrage |

### Démonstration complète (recommandée pour l'évaluation)

```dotenv
SEED_DEMO=true
```

Cela charge l'intégralité du jeu de données NexaTech Industries en un seul paramètre. Vous n'avez **pas** besoin de configurer `SEED_BPM` ou `SEED_PPM` séparément — ils sont inclus automatiquement.

### Compte administrateur de démonstration

Lors du chargement des données de démonstration, un compte administrateur par défaut est créé :

| Champ | Valeur |
|-------|--------|
| **E-mail** | `admin@turboea.demo` |
| **Mot de passe** | `TurboEA!2025` |
| **Rôle** | Administrateur |

!!! warning
    Le compte administrateur de démonstration utilise des identifiants connus. Changez le mot de passe ou créez votre propre compte administrateur pour tout environnement au-delà de l'évaluation locale.

### Ce que contiennent les données de démonstration

Le jeu de données NexaTech Industries comprend environ 150 cards sur toutes les couches d'architecture :

**Données EA principales** (toujours incluses avec `SEED_DEMO=true`) :

- **Organisations** — Hiérarchie d'entreprise : NexaTech Industries avec des unités commerciales (Ingénierie, Fabrication, Ventes et Marketing), régions, équipes et clients
- **Capacités métier** — Plus de 20 capacités dans une hiérarchie à plusieurs niveaux
- **Contextes métier** — Processus, flux de valeur, parcours clients, produits métier
- **Applications** — Plus de 15 applications (NexaCore ERP, Plateforme IoT, Salesforce CRM, etc.) avec des données complètes de cycle de vie et de coûts
- **Composants IT** — Plus de 20 éléments d'infrastructure (bases de données, serveurs, middleware, SaaS, modèles IA)
- **Interfaces et objets de données** — Définitions d'API et flux de données entre systèmes
- **Plateformes** — Plateformes Cloud et IoT avec sous-types
- **Objectifs et initiatives** — 6 initiatives stratégiques avec différents statuts d'approbation
- **Tags** — 5 groupes : Valeur Métier, Stack Technologique, Statut du Cycle de Vie, Niveau de Risque, Périmètre Réglementaire
- **Relations** — Plus de 60 relations liant les cards entre toutes les couches
- **Livraison EA** — Registres de décisions d'architecture et documents de travail d'architecture

**Données BPM** (incluses avec `SEED_DEMO=true` ou `SEED_BPM=true`) :

- ~30 processus métier organisés dans une hiérarchie à 4 niveaux (catégories, groupes, processus, variantes)
- Diagrammes BPMN 2.0 avec éléments de processus extraits (tâches, événements, passerelles, couloirs)
- Liens éléments-cards connectant les tâches BPMN aux applications, composants IT et objets de données
- Évaluations de processus avec scores de maturité, d'efficacité et de conformité

**Données PPM** (incluses avec `SEED_DEMO=true` ou `SEED_PPM=true`) :

- Rapports de statut pour 6 initiatives montrant la santé du projet dans le temps
- Structures de découpage du travail (WBS) avec décomposition hiérarchique et jalons
- ~60 tâches réparties entre les initiatives avec statuts, priorités, assignés et tags
- Lignes budgétaires (capex/opex par exercice fiscal) et lignes de coûts (dépenses réelles)
- Registre des risques avec scores de probabilité/impact et plans d'atténuation

### Réinitialiser la base de données

Pour tout effacer et recommencer :

```dotenv
RESET_DB=true
SEED_DEMO=true
```

Redémarrez les conteneurs, puis **supprimez `RESET_DB` de `.env`** pour éviter une réinitialisation à chaque redémarrage :

```bash
docker compose -f docker-compose.db.yml up --build -d
# Après confirmation du bon fonctionnement, supprimez RESET_DB=true de .env
```

## Étape 4 : Services optionnels

### Suggestions de description par IA

Turbo EA peut générer des descriptions de cards à l'aide d'un LLM local (Ollama) ou de fournisseurs commerciaux. Le conteneur Ollama intégré est le moyen le plus simple de commencer.

Ajoutez à `.env` :

```dotenv
AI_PROVIDER_URL=http://ollama:11434
AI_MODEL=gemma3:4b
AI_AUTO_CONFIGURE=true
```

Démarrez avec le profil `ai` :

```bash
docker compose -f docker-compose.db.yml --profile ai up --build -d
```

Le modèle est téléchargé automatiquement au premier démarrage (cela peut prendre quelques minutes selon votre connexion). Consultez [Fonctionnalités IA](../admin/ai.md) pour les détails de configuration.

### Serveur MCP (intégration d'outils IA)

Le serveur MCP permet aux outils IA comme Claude Desktop, Cursor et GitHub Copilot d'interroger vos données EA.

```bash
docker compose -f docker-compose.db.yml --profile mcp up --build -d
```

Consultez [Intégration MCP](../admin/mcp.md) pour les détails de configuration et d'authentification.

### Combiner les profils

Vous pouvez activer plusieurs profils simultanément :

```bash
docker compose -f docker-compose.db.yml --profile ai --profile mcp up --build -d
```

## Référence rapide : Commandes de démarrage courantes

| Scénario | Commande |
|----------|----------|
| **Démarrage minimal** (BD intégrée, vide) | `docker compose -f docker-compose.db.yml up --build -d` |
| **Démo complète** (BD intégrée, toutes les données) | Configurez `SEED_DEMO=true` dans `.env`, puis `docker compose -f docker-compose.db.yml up --build -d` |
| **Démo complète + IA** | Configurez `SEED_DEMO=true` + variables IA dans `.env`, puis `docker compose -f docker-compose.db.yml --profile ai up --build -d` |
| **BD externe** | Configurez les variables BD dans `.env`, puis `docker compose up --build -d` |
| **Réinitialiser et recharger** | Configurez `RESET_DB=true` + `SEED_DEMO=true` dans `.env`, redémarrez, puis supprimez `RESET_DB` |

## Étapes suivantes

- Ouvrez **http://localhost:8920** (ou votre `HOST_PORT` configuré) dans votre navigateur
- Si vous avez chargé les données de démonstration, connectez-vous avec `admin@turboea.demo` / `TurboEA!2025`
- Sinon, créez un nouveau compte — le premier utilisateur obtient automatiquement le rôle **Administrateur**
- Explorez le [Tableau de bord](../guide/dashboard.md) pour un aperçu de votre paysage EA
- Configurez le [Métamodèle](../admin/metamodel.md) pour personnaliser les types de cards et les champs
