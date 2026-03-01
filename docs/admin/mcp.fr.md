# Intégration MCP (accès pour outils IA)

Turbo EA inclut un **serveur MCP** (Model Context Protocol) intégré qui permet aux outils d'IA — tels que Claude Desktop, GitHub Copilot, Cursor et VS Code — d'interroger vos données EA directement. Les utilisateurs s'authentifient via leur fournisseur SSO existant, et chaque requête respecte leurs permissions individuelles.

Cette fonctionnalité est **optionnelle** et **ne démarre pas automatiquement**. Elle nécessite que le SSO soit configuré, que le profil MCP soit activé dans Docker Compose et qu'un administrateur l'active dans l'interface de configuration.

---

## Fonctionnement

```
Outil IA (Claude, Copilot, etc.)
    │
    │  Protocole MCP (HTTP + SSE)
    ▼
Serveur MCP Turbo EA (:8001, interne)
    │
    │  OAuth 2.1 avec PKCE
    │  délègue au fournisseur SSO
    ▼
Backend Turbo EA (:8000)
    │
    │  RBAC par utilisateur
    ▼
PostgreSQL
```

1. Un utilisateur ajoute l'URL du serveur MCP à son outil IA.
2. Lors de la première connexion, l'outil ouvre une fenêtre de navigateur pour l'authentification SSO.
3. Après la connexion, le serveur MCP émet son propre jeton d'accès (adossé au JWT Turbo EA de l'utilisateur).
4. L'outil IA utilise ce jeton pour toutes les requêtes suivantes. Les jetons se renouvellent automatiquement.
5. Chaque requête passe par le système de permissions normal de Turbo EA — les utilisateurs ne voient que les données auxquelles ils ont accès.

---

## Prérequis

Avant d'activer MCP, vous devez avoir :

- **SSO configuré et fonctionnel** — MCP délègue l'authentification à votre fournisseur SSO (Microsoft Entra ID, Google Workspace, Okta ou OIDC générique). Consultez le guide [Authentification et SSO](sso.md).
- **HTTPS avec un domaine public** — Le flux OAuth nécessite une URI de redirection stable. Déployez derrière un proxy inverse avec terminaison TLS (Caddy, Traefik, Cloudflare Tunnel, etc.).

---

## Configuration

### Étape 1 : Démarrer le service MCP

Le serveur MCP est un profil optionnel de Docker Compose. Ajoutez `--profile mcp` à votre commande de démarrage :

```bash
docker compose --profile mcp up --build -d
```

Cela démarre un conteneur Python léger (port 8001, interne uniquement) aux côtés du backend et du frontend. Nginx redirige automatiquement les requêtes `/mcp/` vers celui-ci.

### Étape 2 : Configurer les variables d'environnement

Ajoutez celles-ci à votre fichier `.env` :

```dotenv
TURBO_EA_PUBLIC_URL=https://votre-domaine.exemple.com
MCP_PUBLIC_URL=https://votre-domaine.exemple.com/mcp
```

| Variable | Défaut | Description |
|----------|--------|-------------|
| `TURBO_EA_PUBLIC_URL` | `http://localhost:8920` | L'URL publique de votre instance Turbo EA |
| `MCP_PUBLIC_URL` | `http://localhost:8920/mcp` | L'URL publique du serveur MCP (utilisée dans les URIs de redirection OAuth) |
| `MCP_PORT` | `8001` | Port interne du conteneur MCP (rarement besoin de changer) |

### Étape 3 : Ajouter l'URI de redirection OAuth à votre application SSO

Dans l'enregistrement d'application de votre fournisseur SSO (le même que celui configuré pour la connexion Turbo EA), ajoutez cette URI de redirection :

```
https://votre-domaine.exemple.com/mcp/oauth/callback
```

Ceci est nécessaire pour le flux OAuth qui authentifie les utilisateurs lorsqu'ils se connectent depuis leur outil IA.

### Étape 4 : Activer MCP dans les paramètres d'administration

1. Allez dans **Paramètres** dans la zone d'administration et sélectionnez l'onglet **AI**.
2. Faites défiler jusqu'à la section **Intégration MCP (Accès aux outils IA)**.
3. Activez le commutateur pour **activer** MCP.
4. L'interface affichera l'URL du serveur MCP et les instructions de configuration à partager avec votre équipe.

!!! warning
    Le commutateur est désactivé si le SSO n'est pas configuré. Configurez d'abord le SSO.

---

## Connecter les outils IA

Une fois MCP activé, partagez l'**URL du serveur MCP** avec votre équipe. Chaque utilisateur l'ajoute à son outil IA :

### Claude Desktop

1. Ouvrez **Paramètres > Connecteurs > Ajouter un connecteur personnalisé**.
2. Entrez l'URL du serveur MCP : `https://votre-domaine.exemple.com/mcp`
3. Cliquez sur **Connecter** — une fenêtre de navigateur s'ouvre pour la connexion SSO.
4. Après l'authentification, Claude peut interroger vos données EA.

### VS Code (GitHub Copilot / Cursor)

Ajoutez à votre `.vscode/mcp.json` d'espace de travail :

```json
{
  "servers": {
    "turbo-ea": {
      "type": "http",
      "url": "https://votre-domaine.exemple.com/mcp/mcp"
    }
  }
}
```

Le double `/mcp/mcp` est intentionnel — le premier `/mcp/` est le chemin du proxy Nginx, le second est le point de terminaison du protocole MCP.

---

## Test local (mode stdio)

Pour le développement local ou les tests sans SSO/HTTPS, vous pouvez exécuter le serveur MCP en **mode stdio** — Claude Desktop le lance directement comme processus local.

**1. Installer le paquet du serveur MCP :**

```bash
pip install ./mcp-server
```

**2. Ajouter à la configuration de Claude Desktop** (`claude_desktop_config.json`) :

```json
{
  "mcpServers": {
    "turbo-ea": {
      "command": "python",
      "args": ["-m", "turbo_ea_mcp", "--stdio"],
      "env": {
        "TURBO_EA_URL": "http://localhost:8000",
        "TURBO_EA_EMAIL": "votre@email.com",
        "TURBO_EA_PASSWORD": "votre-mot-de-passe"
      }
    }
  }
}
```

Dans ce mode, le serveur s'authentifie avec email/mot de passe et renouvelle le jeton automatiquement en arrière-plan.

---

## Capacités disponibles

Le serveur MCP fournit un accès **en lecture seule** aux données EA. Il ne peut rien créer, modifier ou supprimer.

### Outils

| Outil | Description |
|-------|-------------|
| `search_cards` | Rechercher et filtrer les fiches par type, statut ou texte libre |
| `get_card` | Obtenir les détails complets d'une fiche par UUID |
| `get_card_relations` | Obtenir toutes les relations connectées à une fiche |
| `get_card_hierarchy` | Obtenir les ancêtres et enfants d'une fiche |
| `list_card_types` | Lister tous les types de fiche du métamodèle |
| `get_relation_types` | Lister les types de relation, avec filtre optionnel par type de fiche |
| `get_dashboard` | Obtenir les données du tableau de bord KPI (comptages, qualité des données, approbations) |
| `get_landscape` | Obtenir les fiches groupées par un type lié |

### Ressources

| URI | Description |
|-----|-------------|
| `turbo-ea://types` | Tous les types de fiche du métamodèle |
| `turbo-ea://relation-types` | Tous les types de relation |
| `turbo-ea://dashboard` | KPIs du tableau de bord et statistiques résumées |

### Prompts guidés

| Prompt | Description |
|--------|-------------|
| `analyze_landscape` | Analyse en plusieurs étapes : aperçu du tableau de bord, types, relations |
| `find_card` | Rechercher une fiche par nom, obtenir les détails et relations |
| `explore_dependencies` | Cartographier les dépendances d'une fiche |

---

## Permissions

| Rôle | Accès |
|------|-------|
| **Administrateur** | Configurer les paramètres MCP (permission `admin.mcp`) |
| **Tous les utilisateurs authentifiés** | Interroger les données EA via le serveur MCP (respecte leurs permissions existantes au niveau fiche et application) |

La permission `admin.mcp` contrôle qui peut gérer les paramètres MCP. Elle n'est disponible que pour le rôle Administrateur par défaut. Les rôles personnalisés peuvent recevoir cette permission via la page d'administration des Rôles.

L'accès aux données via MCP suit le même modèle RBAC que l'interface web — il n'y a pas de permissions de données spécifiques à MCP.

---

## Sécurité

- **Authentification déléguée par SSO** : Les utilisateurs s'authentifient via leur fournisseur SSO d'entreprise. Le serveur MCP ne voit ni ne stocke jamais les mots de passe.
- **OAuth 2.1 avec PKCE** : Le flux d'authentification utilise Proof Key for Code Exchange (S256) pour empêcher l'interception des codes d'autorisation.
- **RBAC par utilisateur** : Chaque requête MCP est exécutée avec les permissions de l'utilisateur authentifié. Pas de comptes de service partagés.
- **Accès en lecture seule** : Le serveur MCP ne peut que lire les données. Il ne peut pas créer, mettre à jour ou supprimer des fiches, relations ou autres ressources.
- **Rotation des jetons** : Les jetons d'accès expirent après 1 heure. Les jetons de renouvellement durent 30 jours. Les codes d'autorisation sont à usage unique et expirent après 10 minutes.
- **Port interne uniquement** : Le conteneur MCP expose le port 8001 uniquement sur le réseau Docker interne. Tout accès externe passe par le proxy inverse Nginx.

---

## Dépannage

| Problème | Solution |
|----------|----------|
| Le commutateur MCP est désactivé dans les paramètres | Le SSO doit être configuré d'abord. Allez dans Paramètres > onglet Authentification et configurez un fournisseur SSO. |
| «host not found» dans les journaux Nginx | Le service MCP n'est pas en cours d'exécution. Démarrez-le avec `docker compose --profile mcp up -d`. La configuration Nginx gère cela gracieusement (réponse 502, pas de plantage). |
| Le callback OAuth échoue | Vérifiez que vous avez ajouté `https://votre-domaine.exemple.com/mcp/oauth/callback` comme URI de redirection dans l'enregistrement de votre application SSO. |
| L'outil IA ne peut pas se connecter | Vérifiez que `MCP_PUBLIC_URL` correspond à l'URL accessible depuis la machine de l'utilisateur. Assurez-vous que HTTPS fonctionne. |
| L'utilisateur obtient des résultats vides | MCP respecte les permissions RBAC. Si un utilisateur a un accès restreint, il ne verra que les fiches que son rôle autorise. |
| La connexion s'interrompt après 1 heure | L'outil IA devrait gérer le renouvellement des jetons automatiquement. Sinon, reconnectez-vous. |
