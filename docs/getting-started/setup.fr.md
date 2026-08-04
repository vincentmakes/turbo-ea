# Installation et configuration

Ce guide vous accompagne dans l'installation de Turbo EA avec Docker, la configuration de l'environnement, le chargement des données de démonstration et le démarrage des services optionnels comme les suggestions IA et le serveur MCP.

## Prérequis

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

Environ 2 Go d'espace disque libre, quelques minutes de bande passante pour le premier pull d'images, et les ports `8920` (HTTP) et optionnellement `9443` (HTTPS) libres sur l'hôte.

## Étape 1 : Obtenir la configuration

Vous avez besoin de `docker-compose.yml` et d'un fichier `.env` configuré dans un répertoire de travail. Le plus simple est de cloner le dépôt :

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
cp .env.example .env
```

Ouvrez `.env` et définissez les deux valeurs obligatoires :

```dotenv
# Identifiants PostgreSQL (utilisés par le conteneur de base de données intégré).
# Choisissez un mot de passe robuste — il persiste dans le volume intégré.
POSTGRES_PASSWORD=choose-a-strong-password

# Clé de signature JWT. Générez-en une avec :
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=your-generated-secret
```

Tout le reste de `.env.example` a des valeurs par défaut raisonnables.

!!! note
    Le backend refuse de démarrer avec la `SECRET_KEY` d'exemple en dehors du développement. Générez-en une vraie avant d'aller plus loin.

## Étape 2 : Pull et démarrage

La pile intégrée (Postgres + backend + frontend + nginx en bordure) s'exécute à partir d'images multi-architecture préconstruites sur GHCR — aucune compilation locale requise :

```bash
docker compose pull
docker compose up -d
```

Ouvrez **http://localhost:8920** et enregistrez le premier utilisateur. Le premier utilisateur enregistré est automatiquement promu **Admin**.

Pour changer le port hôte, définissez `HOST_PORT` dans `.env` (par défaut `8920`). La terminaison HTTPS directe est traitée à l'[Étape 5](#étape-5--https-direct-optionnel).

## Étape 3 : Charger les données de démonstration (optionnel)

Turbo EA peut démarrer vide (juste le métamodèle intégré) ou avec le jeu de données de démonstration **NexaTech Industries**, idéal pour l'évaluation, la formation et l'exploration des fonctionnalités.

Définissez le flag de seed dans `.env` **avant le premier démarrage** :

```dotenv
SEED_DEMO=true
```

Puis `docker compose up -d` (si vous avez déjà démarré, consultez « Réinitialiser et re-semer » ci-dessous).

### Options de chargement

| Variable | Par défaut | Description |
|----------|------------|-------------|
| `SEED_DEMO` | `false` | Charge le jeu complet NexaTech Industries, incluant les données BPM et PPM |
| `SEED_BPM` | `false` | Charge uniquement les processus BPM de démo (sous-ensemble de `SEED_DEMO`) |
| `SEED_PPM` | `false` | Charge uniquement les données de projet PPM (sous-ensemble de `SEED_DEMO`) |
| `RESET_DB` | `false` | Supprime toutes les tables et les recrée au démarrage |

`SEED_DEMO=true` inclut déjà les données BPM et PPM — pas besoin de définir les flags de sous-ensemble séparément.

!!! note "Les données de démonstration ne sont chargées qu'une fois"
    Chaque chargeur s'exécute **une seule fois par installation** et le consigne.
    Supprimer un contenu de démonstration — un diagramme d'exemple, une enquête de
    démonstration — est définitif : il ne reviendra pas au prochain redémarrage,
    même si `SEED_DEMO=true` est toujours défini. Pour retrouver le jeu de données
    de démonstration, réinitialisez la base (voir *Réinitialiser et recharger*
    ci-dessous).

### Compte administrateur de démonstration

Lorsque les données de démonstration sont chargées, un compte administrateur par défaut est créé :

| Champ | Valeur |
|-------|--------|
| **Email** | `admin@turboea.demo` |
| **Mot de passe** | `TurboEA!2025` |
| **Rôle** | Admin |

!!! warning
    Le compte admin de démonstration utilise des identifiants connus et publics. Changez le mot de passe — ou créez votre propre compte admin et désactivez celui-ci — pour tout environnement au-delà de l'évaluation locale.

### Ce que contient la démonstration

Environ 150 cards à travers les quatre couches d'architecture, plus relations, étiquettes, commentaires, tâches, diagrammes BPM, données PPM, ADR et un Statement of Architecture Work :

- **Cœur EA** — Organisations, ~20 Capacités Métier, Contextes Métier, ~15 Applications, ~20 Composants IT, Interfaces, Objets de Données, Plateformes, Objectifs, 6 Initiatives, 5 groupes d'étiquettes, 60+ relations.
- **BPM** — ~30 processus métier dans une hiérarchie à 4 niveaux avec des diagrammes BPMN 2.0, des liens élément-vers-card et des évaluations de processus.
- **PPM** — Rapports d'état, Work Breakdown Structures, ~60 tâches, lignes de budget et de coût, et un registre des risques sur les 6 Initiatives de démonstration.
- **EA Delivery** — Architecture Decision Records et Statements of Architecture Work.

### Réinitialiser et re-semer

Pour effacer la base de données et recommencer :

```dotenv
RESET_DB=true
SEED_DEMO=true
```

Redémarrez la pile, puis **supprimez `RESET_DB=true` de `.env`** — le laisser activé réinitialisera la base à chaque redémarrage :

```bash
docker compose up -d
# Vérifiez que les nouvelles données sont là, puis modifiez .env pour retirer RESET_DB
```

## Étape 4 : Services optionnels (profils Compose)

Les deux modules complémentaires sont opt-in via des profils Docker Compose et s'exécutent à côté de la pile principale sans la perturber.

### Suggestions de description par IA

Générez des descriptions de cards avec un LLM local (Ollama intégré) ou un fournisseur commercial. Le conteneur Ollama intégré est le moyen le plus simple pour les configurations auto-hébergées.

Ajoutez à `.env` :

```dotenv
AI_PROVIDER_URL=http://ollama:11434
AI_MODEL=gemma3:4b
AI_AUTO_CONFIGURE=true
```

Démarrez avec le profil `ai` :

```bash
docker compose --profile ai up -d
```

Le modèle est téléchargé automatiquement au premier démarrage (quelques minutes selon votre connexion). Voir [Capacités IA](../admin/ai.md) pour la référence complète de configuration, incluant l'utilisation d'OpenAI / Gemini / Claude / DeepSeek à la place de l'Ollama intégré.

### Serveur MCP

Le serveur MCP permet aux outils IA — Claude Desktop, Cursor, GitHub Copilot, et d'autres — d'interroger vos données EA via le [Model Context Protocol](https://modelcontextprotocol.io/) avec un RBAC par utilisateur. Lecture seule.

```bash
docker compose --profile mcp up -d
```

Voir [Intégration MCP](../admin/mcp.md) pour la configuration OAuth et les détails des outils.

### Les deux ensemble

```bash
docker compose --profile ai --profile mcp up -d
```

## Étape 5 : HTTPS direct (optionnel)

Le nginx en bordure intégré peut terminer TLS lui-même — utile si vous n'avez pas de reverse-proxy externe. Ajoutez à `.env` :

```dotenv
TURBO_EA_TLS_ENABLED=true
TLS_CERTS_DIR=./certs
TURBO_EA_TLS_CERT_FILE=cert.pem
TURBO_EA_TLS_KEY_FILE=key.pem
HOST_PORT=80
TLS_HOST_PORT=443
```

Placez `cert.pem` et `key.pem` dans `./certs/` (le répertoire est monté en lecture seule dans le conteneur nginx). L'image dérive `server_name` et le schéma transféré de `TURBO_EA_PUBLIC_URL`, sert HTTP et HTTPS, et redirige HTTP vers HTTPS automatiquement.

Pour les déploiements derrière un reverse-proxy existant (Caddy, Traefik, Cloudflare Tunnel), laissez `TURBO_EA_TLS_ENABLED=false` et laissez le proxy gérer TLS.

## Autoriser l'intégration de diagrammes (optionnel)

Un [diagramme publié](../guide/diagrams.md) peut être intégré dans un autre site — une page Confluence, un portail intranet — mais uniquement si vous désignez ce site au préalable. Par défaut, aucun site externe ne peut placer Turbo EA dans un cadre.

```dotenv
TURBO_EA_EMBED_ALLOWED_ORIGINS=https://votreentreprise.atlassian.net
```

Séparez plusieurs origines par des virgules. Redémarrez la pile pour appliquer le changement.

Cela s'applique **uniquement** aux pages de diagrammes publiés. L'application elle-même — y compris l'éditeur de diagrammes — reste non intégrable dans tous les cas, et les liens publiés continuent de fonctionner à l'ouverture directe même sans ce paramètre.

## Épingler une version

`docker compose pull` prend `:latest` par défaut. Pour épingler une version spécifique en production, définissez `TURBO_EA_TAG` :

```bash
TURBO_EA_TAG=1.0.0 docker compose up -d
```

Les versions publiées sont étiquetées `:<full-version>`, `:<major>.<minor>`, `:<major>` et `:latest`. Le workflow de publication exclut les préversions (`-rc.N`) de `:latest` et des étiquettes courtes `:X.Y` / `:X`. Voir [Versions](../reference/releases.md) pour l'arborescence complète des étiquettes et la politique du canal de pré-publication.

## Utiliser un PostgreSQL existant

Si vous exécutez déjà une instance PostgreSQL gérée ou partagée, pointez-y le backend et passez sur le service `db` intégré.

Créez la base de données et l'utilisateur sur votre serveur existant :

```sql
CREATE USER turboea WITH PASSWORD 'your-password';
CREATE DATABASE turboea OWNER turboea;
```

Surchargez les variables de connexion dans `.env` :

```dotenv
POSTGRES_HOST=your-postgres-host
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=your-password
```

Puis démarrez comme d'habitude : `docker compose up -d`. Le service `db` intégré reste défini dans `docker-compose.yml` ; vous pouvez soit le laisser inactif, soit l'arrêter explicitement.

### Budget de connexions

Le backend s'exécute dans un processus unique et ouvre **jusqu'à `DB_POOL_SIZE + DB_MAX_OVERFLOW` connexions — 30 par défaut**. Le service `db` intégré en autorise 100 : les valeurs par défaut ne posent donc jamais problème. Une instance managée sur une offre d'entrée de gamme limite souvent la base bien en dessous de 30, et PostgreSQL répond alors :

```
too many connections for database "turboea"
```

Vérifiez vos limites avant de basculer :

```sql
SELECT datname, datconnlimit FROM pg_database WHERE datname = 'turboea';
SELECT rolname, rolconnlimit FROM pg_roles    WHERE rolname = 'turboea';
SHOW max_connections;
```

`-1` pour `datconnlimit` ou `rolconnlimit` signifie « aucune limite spécifique » ; toute valeur inférieure à 30 impose soit de relever le plafond, soit de réduire le pool :

```dotenv
DB_POOL_SIZE=8
DB_MAX_OVERFLOW=2
DB_POOL_TIMEOUT=30
```

Un pool plus petit signifie moins de requêtes servies simultanément, et non des requêtes perdues : une fois le pool saturé, une requête attend jusqu'à `DB_POOL_TIMEOUT` secondes qu'une connexion se libère. Laissez quelques connexions disponibles pour les sauvegardes et vos propres sessions `psql`.

## Vérifier les images

Depuis `1.0.0`, chaque image publiée est signée avec cosign keyless OIDC et embarque une SBOM SPDX générée par buildkit. Voir [Chaîne d'approvisionnement](../admin/supply-chain.md) pour la commande de vérification et comment récupérer la SBOM depuis le registre.

## Développement depuis les sources

Si vous voulez construire la pile depuis les sources (modifier le code backend ou frontend), utilisez la surcharge Compose de développement :

```bash
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml up -d --build
```

Ou la cible de commodité :

```bash
make up-dev
```

Le guide complet du développeur — nommage des branches, commandes de lint et de test, vérifications pre-commit — est dans [CONTRIBUTING.md](https://github.com/vincentmakes/turbo-ea/blob/main/CONTRIBUTING.md).

## Référence rapide

| Scénario | Commande |
|----------|----------|
| Premier démarrage (données vides) | `docker compose pull && docker compose up -d` |
| Premier démarrage avec données de démo | Définissez `SEED_DEMO=true` dans `.env`, puis la même commande |
| Ajouter les suggestions IA | Ajoutez les variables IA, puis `docker compose --profile ai up -d` |
| Ajouter le serveur MCP | `docker compose --profile mcp up -d` |
| Épingler une version | `TURBO_EA_TAG=1.0.0 docker compose up -d` |
| Réinitialiser et re-semer | `RESET_DB=true` + `SEED_DEMO=true`, redémarrez, puis retirez `RESET_DB` |
| Utiliser Postgres externe | Surchargez les variables `POSTGRES_*` dans `.env`, puis `docker compose up -d` |
| Construire depuis les sources | `make up-dev` |

## Étapes suivantes

- Ouvrez **http://localhost:8920** (ou votre `HOST_PORT` configuré) et connectez-vous. Si vous avez chargé les données de démo, utilisez `admin@turboea.demo` / `TurboEA!2025`. Sinon, enregistrez-vous — le premier utilisateur est automatiquement promu Admin.
- Explorez le [Tableau de bord](../guide/dashboard.md) pour un aperçu de votre paysage EA.
- Personnalisez les [types de cards et champs](../admin/metamodel.md) — le métamodèle est entièrement piloté par les données, sans modifications de code.
- Pour les déploiements de production, consultez [Politique de compatibilité](../reference/compatibility.md) et [Chaîne d'approvisionnement](../admin/supply-chain.md).
