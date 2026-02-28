# Integration MCP (acces pour outils IA)

Turbo EA inclut un **serveur MCP** (Model Context Protocol) integre qui permet aux outils d'IA — tels que Claude Desktop, GitHub Copilot, Cursor et VS Code — d'interroger vos donnees EA directement. Les utilisateurs s'authentifient via leur fournisseur SSO existant, et chaque requete respecte leurs permissions individuelles.

Cette fonctionnalite est **optionnelle** et **ne demarre pas automatiquement**. Elle necessite que le SSO soit configure, que le profil MCP soit active dans Docker Compose et qu'un administrateur l'active dans l'interface de configuration.

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
    │  delegue au fournisseur SSO
    ▼
Backend Turbo EA (:8000)
    │
    │  RBAC par utilisateur
    ▼
PostgreSQL
```

1. Un utilisateur ajoute l'URL du serveur MCP a son outil IA.
2. Lors de la premiere connexion, l'outil ouvre une fenetre de navigateur pour l'authentification SSO.
3. Apres la connexion, le serveur MCP emet son propre jeton d'acces (adosse au JWT Turbo EA de l'utilisateur).
4. L'outil IA utilise ce jeton pour toutes les requetes suivantes. Les jetons se renouvellent automatiquement.
5. Chaque requete passe par le systeme de permissions normal de Turbo EA — les utilisateurs ne voient que les donnees auxquelles ils ont acces.

---

## Prerequis

Avant d'activer MCP, vous devez avoir :

- **SSO configure et fonctionnel** — MCP delegue l'authentification a votre fournisseur SSO (Microsoft Entra ID, Google Workspace, Okta ou OIDC generique). Consultez le guide [Authentification et SSO](sso.md).
- **HTTPS avec un domaine public** — Le flux OAuth necessite une URI de redirection stable. Deployez derriere un proxy inverse avec terminaison TLS (Caddy, Traefik, Cloudflare Tunnel, etc.).

---

## Configuration

### Etape 1 : Demarrer le service MCP

Le serveur MCP est un profil optionnel de Docker Compose. Ajoutez `--profile mcp` a votre commande de demarrage :

```bash
docker compose --profile mcp up --build -d
```

Cela demarre un conteneur Python leger (port 8001, interne uniquement) aux cotes du backend et du frontend. Nginx redirige automatiquement les requetes `/mcp/` vers celui-ci.

### Etape 2 : Configurer les variables d'environnement

Ajoutez celles-ci a votre fichier `.env` :

```dotenv
TURBO_EA_PUBLIC_URL=https://votre-domaine.exemple.com
MCP_PUBLIC_URL=https://votre-domaine.exemple.com/mcp
```

| Variable | Defaut | Description |
|----------|--------|-------------|
| `TURBO_EA_PUBLIC_URL` | `http://localhost:8920` | L'URL publique de votre instance Turbo EA |
| `MCP_PUBLIC_URL` | `http://localhost:8920/mcp` | L'URL publique du serveur MCP (utilisee dans les URIs de redirection OAuth) |
| `MCP_PORT` | `8001` | Port interne du conteneur MCP (rarement besoin de changer) |

### Etape 3 : Ajouter l'URI de redirection OAuth a votre application SSO

Dans l'enregistrement d'application de votre fournisseur SSO (le meme que celui configure pour la connexion Turbo EA), ajoutez cette URI de redirection :

```
https://votre-domaine.exemple.com/mcp/oauth/callback
```

Ceci est necessaire pour le flux OAuth qui authentifie les utilisateurs lorsqu'ils se connectent depuis leur outil IA.

### Etape 4 : Activer MCP dans les parametres d'administration

1. Allez dans **Parametres** dans la zone d'administration et selectionnez l'onglet **AI**.
2. Faites defiler jusqu'a la section **Integration MCP (Acces aux outils IA)**.
3. Activez le commutateur pour **activer** MCP.
4. L'interface affichera l'URL du serveur MCP et les instructions de configuration a partager avec votre equipe.

!!! warning
    Le commutateur est desactive si le SSO n'est pas configure. Configurez d'abord le SSO.

---

## Connecter les outils IA

Une fois MCP active, partagez l'**URL du serveur MCP** avec votre equipe. Chaque utilisateur l'ajoute a son outil IA :

### Claude Desktop

1. Ouvrez **Parametres > Connecteurs > Ajouter un connecteur personnalise**.
2. Entrez l'URL du serveur MCP : `https://votre-domaine.exemple.com/mcp`
3. Cliquez sur **Connecter** — une fenetre de navigateur s'ouvre pour la connexion SSO.
4. Apres l'authentification, Claude peut interroger vos donnees EA.

### VS Code (GitHub Copilot / Cursor)

Ajoutez a votre `.vscode/mcp.json` d'espace de travail :

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

Pour le developpement local ou les tests sans SSO/HTTPS, vous pouvez executer le serveur MCP en **mode stdio** — Claude Desktop le lance directement comme processus local.

**1. Installer le paquet du serveur MCP :**

```bash
pip install ./mcp-server
```

**2. Ajouter a la configuration de Claude Desktop** (`claude_desktop_config.json`) :

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

Dans ce mode, le serveur s'authentifie avec email/mot de passe et renouvelle le jeton automatiquement en arriere-plan.

---

## Capacites disponibles

Le serveur MCP fournit un acces **en lecture seule** aux donnees EA. Il ne peut rien creer, modifier ou supprimer.

### Outils

| Outil | Description |
|-------|-------------|
| `search_cards` | Rechercher et filtrer les fiches par type, statut ou texte libre |
| `get_card` | Obtenir les details complets d'une fiche par UUID |
| `get_card_relations` | Obtenir toutes les relations connectees a une fiche |
| `get_card_hierarchy` | Obtenir les ancetres et enfants d'une fiche |
| `list_card_types` | Lister tous les types de fiche du metamodele |
| `get_relation_types` | Lister les types de relation, avec filtre optionnel par type de fiche |
| `get_dashboard` | Obtenir les donnees du tableau de bord KPI (comptages, qualite des donnees, approbations) |
| `get_landscape` | Obtenir les fiches groupees par un type lie |

### Ressources

| URI | Description |
|-----|-------------|
| `turbo-ea://types` | Tous les types de fiche du metamodele |
| `turbo-ea://relation-types` | Tous les types de relation |
| `turbo-ea://dashboard` | KPIs du tableau de bord et statistiques resumees |

### Prompts guides

| Prompt | Description |
|--------|-------------|
| `analyze_landscape` | Analyse en plusieurs etapes : apercu du tableau de bord, types, relations |
| `find_card` | Rechercher une fiche par nom, obtenir les details et relations |
| `explore_dependencies` | Cartographier les dependances d'une fiche |

---

## Permissions

| Role | Acces |
|------|-------|
| **Administrateur** | Configurer les parametres MCP (permission `admin.mcp`) |
| **Tous les utilisateurs authentifies** | Interroger les donnees EA via le serveur MCP (respecte leurs permissions existantes au niveau fiche et application) |

La permission `admin.mcp` controle qui peut gerer les parametres MCP. Elle n'est disponible que pour le role Administrateur par defaut. Les roles personnalises peuvent recevoir cette permission via la page d'administration des Roles.

L'acces aux donnees via MCP suit le meme modele RBAC que l'interface web — il n'y a pas de permissions de donnees specifiques a MCP.

---

## Securite

- **Authentification deleguee par SSO** : Les utilisateurs s'authentifient via leur fournisseur SSO d'entreprise. Le serveur MCP ne voit ni ne stocke jamais les mots de passe.
- **OAuth 2.1 avec PKCE** : Le flux d'authentification utilise Proof Key for Code Exchange (S256) pour empecher l'interception des codes d'autorisation.
- **RBAC par utilisateur** : Chaque requete MCP est executee avec les permissions de l'utilisateur authentifie. Pas de comptes de service partages.
- **Acces en lecture seule** : Le serveur MCP ne peut que lire les donnees. Il ne peut pas creer, mettre a jour ou supprimer des fiches, relations ou autres ressources.
- **Rotation des jetons** : Les jetons d'acces expirent apres 1 heure. Les jetons de renouvellement durent 30 jours. Les codes d'autorisation sont a usage unique et expirent apres 10 minutes.
- **Port interne uniquement** : Le conteneur MCP expose le port 8001 uniquement sur le reseau Docker interne. Tout acces externe passe par le proxy inverse Nginx.

---

## Depannage

| Probleme | Solution |
|----------|----------|
| Le commutateur MCP est desactive dans les parametres | Le SSO doit etre configure d'abord. Allez dans Parametres > onglet Authentification et configurez un fournisseur SSO. |
| «host not found» dans les journaux Nginx | Le service MCP n'est pas en cours d'execution. Demarrez-le avec `docker compose --profile mcp up -d`. La configuration Nginx gere cela gracieusement (reponse 502, pas de plantage). |
| Le callback OAuth echoue | Verifiez que vous avez ajoute `https://votre-domaine.exemple.com/mcp/oauth/callback` comme URI de redirection dans l'enregistrement de votre application SSO. |
| L'outil IA ne peut pas se connecter | Verifiez que `MCP_PUBLIC_URL` correspond a l'URL accessible depuis la machine de l'utilisateur. Assurez-vous que HTTPS fonctionne. |
| L'utilisateur obtient des resultats vides | MCP respecte les permissions RBAC. Si un utilisateur a un acces restreint, il ne verra que les fiches que son role autorise. |
| La connexion s'interrompt apres 1 heure | L'outil IA devrait gerer le renouvellement des jetons automatiquement. Sinon, reconnectez-vous. |
