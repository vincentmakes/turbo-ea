# Intégration MCP (accès pour outils IA)

Turbo EA inclut un **serveur MCP** (Model Context Protocol) intégré qui permet aux outils d'IA — tels que Claude Desktop, GitHub Copilot, Cursor et VS Code — d'interroger et de mettre à jour vos données EA directement. Les outils d'IA peuvent aussi téléverser des artefacts (tableurs, diagrammes BPMN, diagrammes DrawIO, documents libres) et les transformer en fiches, relations et diagrammes conformes au métamodèle existant. Les utilisateurs s'authentifient via leur fournisseur SSO existant, et chaque action respecte leurs permissions individuelles.

Cette fonctionnalité est **optionnelle** et **ne démarre pas automatiquement**. Elle nécessite que le SSO soit configuré, que le profil MCP soit activé dans Docker Compose et qu'un administrateur l'active dans l'interface de configuration.

---

## Fonctionnement

```
Outil IA (Claude, Copilot, etc.)
    │
    │  Protocole MCP (streamable HTTP)
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
| `MCP_PUBLIC_URL` | `http://localhost:8920/mcp` (docker compose) | L'URL publique du serveur MCP (utilisée dans les URIs de redirection OAuth). Lorsque le conteneur est exécuté de façon autonome, la valeur par défaut du code est `http://localhost:8001` |
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
      "url": "https://votre-domaine.exemple.com/mcp"
    }
  }
}
```

Utilisez `https://votre-domaine.exemple.com/mcp` comme point de terminaison. L'ancienne forme doublée `https://votre-domaine.exemple.com/mcp/mcp` fonctionne toujours, de sorte que les connecteurs existants continuent de fonctionner sans modification.

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

Le serveur MCP expose **47 outils** répartis en deux groupes : **30 outils de lecture** qui interrogent les données EA et **17 outils d'écriture** (13 additifs, 4 destructifs) qui créent et maintiennent fiches, relations, diagrammes, risques, ADRs et plus encore — y compris la transformation des artefacts qu'un outil d'IA a dans son propre contexte (tableurs, BPMN XML, DrawIO XML, documents, images) en données EA structurées. Chaque outil porte des `ToolAnnotations` MCP (indications lecture seule / destructif / idempotent) afin que les connecteurs puissent afficher la destructivité dans leur interface.

### Sécurité par exécution à blanc lors des écritures

Chaque outil d'écriture utilise par défaut **`dry_run=true`**. Dans ce mode, le backend exécute chaque validateur et résolveur, construit le plan complet puis **annule la transaction** afin que rien ne soit persisté. L'outil d'IA renvoie l'aperçu à l'utilisateur ; ce n'est qu'après confirmation explicite qu'il doit rappeler l'outil avec `dry_run=false` pour valider. Cela empêche un agent trop zélé d'introduire silencieusement des centaines de fiches à partir d'un tableur mal interprété.

### Outils de lecture

Le serveur expose 30 outils de lecture, regroupés en huit clusters.

**Fiches & métamodèle**

| Outil | Description |
|-------|-------------|
| `search_cards` | Rechercher et filtrer les fiches par type, statut ou texte libre |
| `get_card` | Obtenir les détails complets d'une fiche par UUID |
| `get_card_relations` | Obtenir toutes les relations connectées à une fiche |
| `get_card_hierarchy` | Obtenir les ancêtres et enfants d'une fiche |
| `list_card_types` | Lister tous les types de fiche du métamodèle |
| `get_relation_types` | Lister les types de relation, avec filtre optionnel par type de fiche |
| `resolve_card_refs` | Pré-valider les références de fiche basées sur le nom (nom → UUID) avant un import en masse — résout uniquement, n'écrit jamais |
| `analyze_impact` | Analyse du rayon d'impact des dépendances pour un changement proposé sur une fiche |

**Tableaux de bord**

| Outil | Description |
|-------|-------------|
| `get_dashboard` | Tableau de bord KPI (comptages, qualité des données, approbations, activité) |
| `get_landscape` | Fiches d'un type regroupées par un type lié |

**GRC — Registre des risques**

| Outil | Description |
|-------|-------------|
| `list_risks` | Liste paginée et filtrable du registre des risques EA (TOGAF Phase G) |
| `get_risk` | Détail d'un risque avec fiches liées et piste d'audit |
| `get_risk_metrics` | KPIs + matrices 4×4 initiales et résiduelles |
| `get_card_risks` | Tous les risques actuellement liés à une fiche |

**GRC — Conformité**

| Outil | Description |
|-------|-------------|
| `list_compliance_findings` | Constats de conformité regroupés par régulation |
| `get_compliance_overview` | Scores de conformité + matrice de statut par régulation + métadonnées du dernier scan |

**Gouvernance & Livraison**

| Outil | Description |
|-------|-------------|
| `list_principles` | Principes EA publiés (énoncé, justification, implications) |
| `list_adrs` | Architecture Decision Records, filtrables par initiative / statut |
| `get_adr` | ADR unique avec sections, fiches liées et piste de signature |
| `list_soaws` | Statements of Architecture Work d'une initiative |

**Rapports**

| Outil | Description |
|-------|-------------|
| `get_portfolio_report` | Données du graphique à bulles pour un type de fiche (défaut : fit fonctionnel × technique) |
| `get_cost_treemap` | Treemap des coûts, optionnellement groupé par un type lié |
| `get_capability_heatmap` | Heatmap hiérarchique des capacités métier |
| `get_data_quality_report` | Ventilation de la complétude par type de fiche |

**Contexte de fiche**

| Outil | Description |
|-------|-------------|
| `get_card_stakeholders` | Utilisateurs + rôles affectés à la fiche |
| `get_card_comments` | Fil de commentaires d'une fiche |
| `get_card_documents` | Liens documentaires attachés à une fiche (URL, pas de fichiers) |

**Diagrammes**

| Outil | Description |
|-------|-------------|
| `list_diagrams` | Lister les diagrammes libres (DrawIO), avec filtre optionnel sur une fiche |
| `get_diagram` | Récupérer un diagramme par id, y compris son XML DrawIO |

**Audit & historique des modifications**

| Outil | Description |
|-------|-------------|
| `get_change_history` | Interroger le registre des lots de mutation (par id de lot, acteur, outil ou origine) pour reconstruire exactement ce qu'un commit MCP précédent a modifié |

Tous les outils respectent le RBAC de l'utilisateur authentifié — un visualiseur recevra simplement une liste vide (ou 403) pour ce qu'il ne peut pas voir ; aucune configuration par outil n'est nécessaire au niveau MCP.

### Outils d'écriture

Le serveur expose 17 outils d'écriture, chacun annoté comme **additif** (crée ou étend des données) ou **destructif** (modifie ou supprime des données existantes) afin que les connecteurs puissent avertir en conséquence.

**Additifs (13)**

| Outil | Description |
|-------|-------------|
| `create_cards_bulk` | Crée plusieurs fiches en un seul appel (par exemple lignes de tableur). Prend en charge les références au parent par nom au sein du même lot, avec tri topologique côté serveur. |
| `transition_card_lifecycle` | Fait passer une fiche par les phases d'approbation ou de cycle de vie. |
| `create_risks` | Crée des entrées dans le registre des risques EA. |
| `update_risks` | Met à jour des entrées du registre des risques (champs, fiches liées). |
| `add_card_comment` | Publie un commentaire sur une fiche — une note non destructive et vérifiable au lieu de modifier des champs. |
| `create_soaw` | Crée un Statement of Architecture Work pour une initiative. |
| `assign_stakeholders` | Affecte ou retire des rôles de parties prenantes sur des fiches. |
| `update_cards_bulk` | Correctifs au niveau des champs sur plusieurs fiches en un seul appel. |
| `create_adr` | Crée un Architecture Decision Record. |
| `update_adr` | Met à jour un ADR (titre, sections, statut, fiches liées). |
| `sign_adr` | Signe un ADR (nécessite la permission `adr.sign` ; sinon renvoie un lien profond vers l'interface pour signer dans le navigateur). |
| `create_diagram` | Crée un diagramme DrawIO libre avec des liens optionnels vers des fiches existantes. |
| `import_bpmn` | Enregistre un diagramme XML BPMN 2.0 sur une fiche Processus métier **existante**. Si aucune fiche ne correspond au nom fourni, l'outil renvoie une erreur `card_not_found` qui renvoie l'agent vers `create_cards_bulk` — cela force la création explicite de la fiche avec description, sous-type et attributs au préalable, plutôt qu'un raccourci qui crée une fiche pauvre. |

**Destructifs (4)**

| Outil | Description |
|-------|-------------|
| `upsert_relations_bulk` | Crée ou supprime des relations entre fiches. Source / cible / type sont validés contre le métamodèle. La suppression est refusée sauf si l'opérateur l'a explicitement activée (voir garde-fous). |
| `archive_cards` | Suppression douce de fiches. Récupérable — les fiches archivées peuvent être restaurées pendant 30 jours avant la purge automatique. |
| `update_diagram` | Remplace le XML DrawIO, le nom ou les liens de fiches d'un diagramme. |
| `rollback_batch` | Annule les écritures effectuées dans un lot de mutation précédent. |

### Téléversement d'artefacts

Un sous-ensemble des outils d'écriture (`create_cards_bulk`, `upsert_relations_bulk`, `create_diagram`, `import_bpmn`) permet à un agent d'IA de transformer des artefacts en données EA structurées. L'agent lit le fichier source dans son propre contexte (vision multimodale, pièces jointes), extrait des lignes structurées et appelle ces outils. Le serveur MCP lui-même ne parse jamais les fichiers — il attend des entrées déjà structurées.

Flux typique lorsqu'un utilisateur partage un tableur avec l'agent d'IA :

1. L'agent appelle `list_card_types` et `get_relation_types` pour comprendre le métamodèle.
2. L'agent parse le tableur (dans son propre contexte, pas dans MCP) et construit des dicts de ligne.
3. L'agent appelle `create_cards_bulk(cards=…, dry_run=True)` et montre l'aperçu à l'utilisateur.
4. L'utilisateur confirme ; l'agent rappelle avec `dry_run=False` pour valider.
5. Si des colonnes de relation sont présentes, l'agent appelle ensuite `upsert_relations_bulk` selon le même cycle exécution à blanc / confirmation.

### Garde-fous des outils d'écriture

Défense en profondeur en plus de l'exécution à blanc, afin qu'une mauvaise interprétation du LLM ne puisse pas causer de dommages massifs :

- **Plafond de taille par appel.** Les outils d'écriture MCP appliquent un plafond beaucoup plus petit que les endpoints sous-jacents de l'importateur Excel : 200 lignes pour `create_cards_bulk`, 500 opérations pour `upsert_relations_bulk`. Suffisamment grand pour tout téléversement d'artefact unique réaliste, suffisamment petit pour qu'une prévisualisation d'exécution à blanc reste scannable.
- **Pas de suppression de relation par défaut.** `upsert_relations_bulk` refuse les opérations `action: "delete"` — pour supprimer des relations, utilisez l'interface web où l'action est consignée sous l'identité de l'utilisateur. Les opérateurs peuvent activer cette possibilité en définissant `MCP_ALLOW_RELATION_DELETE=true`.
- **Interrupteur d'arrêt.** `MCP_WRITES_ENABLED=false` désactive les 17 outils d'écriture sans redéployer de code. Les 30 outils de lecture continuent de fonctionner.
- **Étiquette d'origine d'audit.** Chaque requête backend du serveur MCP transporte un en-tête `X-Turbo-EA-Origin: mcp`. Les événements émis depuis ces requêtes sont étiquetés `origin: "mcp"` dans le payload du journal d'audit, ce qui permet aux administrateurs de filtrer les écritures pilotées par MCP hors de la chronologie, séparément des actions de l'interface web.
- **Lots de mutation.** Chaque appel d'écriture MCP ouvre un lot de mutation avant toute écriture ; chaque événement émis pendant l'appel est estampillé avec l'id du lot. Les administrateurs (ou l'outil `get_change_history`) peuvent reconstruire le diff complet, événement par événement, d'un commit à partir d'un seul id, et `rollback_batch` peut l'annuler. Les commits dépassant `MCP_BATCH_CONFIRMATION_THRESHOLD` lignes doivent renvoyer un `confirm_token` à usage unique émis par l'exécution à blanc précédente (validité de 15 minutes), de sorte qu'un gros commit suit toujours un aperçu relu.
- **Pas de suppression définitive.** L'ensemble d'outils omet délibérément la suppression permanente de fiches. `archive_cards` et `update_cards_bulk` *sont* exposés, mais l'archivage est une suppression douce récupérable (fenêtre de restauration de 30 jours) et les deux sont annotés comme destructifs et protégés par l'exécution à blanc. L'ajout d'un outil effectuant une mutation irréversible (suppression définitive, purge forcée) nécessiterait une revue de conception explicite.

Les six variables d'environnement de garde-fou sur le conteneur MCP :

| Variable | Défaut | Effet |
|----------|--------|-------|
| `MCP_WRITES_ENABLED` | `true` | Interrupteur principal des outils d'écriture. `false` → MCP en lecture seule. |
| `MCP_MAX_CARDS_PER_CALL` | `200` | Plafond strict du nombre de lignes `create_cards_bulk` / `update_cards_bulk` par requête. |
| `MCP_MAX_RELATIONS_PER_CALL` | `500` | Plafond strict du nombre d'opérations `upsert_relations_bulk` par requête. |
| `MCP_ALLOW_RELATION_DELETE` | `false` | Lorsque `true`, `upsert_relations_bulk` accepte les opérations `action: "delete"`. |
| `MCP_BATCH_CONFIRMATION_THRESHOLD` | `20` | Les commits touchant plus de lignes que ce seuil exigent le `confirm_token` issu d'une exécution à blanc préalable. |
| `MCP_REQUIRE_DRYRUN_FIRST` | `true` | Active la barrière confirm-token ci-dessus. Ne mettez `false` que pour des pipelines d'automatisation de confiance qui sautent explicitement l'aller-retour d'aperçu. |

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
| **Administrateur** | Configurer les paramètres MCP (permission `admin.mcp`). Accès complet en lecture + écriture via MCP. |
| **Tous les utilisateurs authentifiés** | Accès en lecture régi par leur RBAC existant. Les outils d'écriture exigent les permissions backend correspondantes — `inventory.create` / `inventory.edit` / `inventory.archive` (fiches), `relations.manage` (relations), `diagrams.manage` (diagrammes), `bpm.edit` (BPMN), `risks.manage` (registre des risques), `comments.create` (commentaires), `stakeholders.manage` (parties prenantes), `soaw.create` (SoAW), `adr.create` / `adr.sign` (ADRs). |

La permission `admin.mcp` contrôle qui peut gérer les paramètres MCP. Elle n'est disponible que pour le rôle Administrateur par défaut. Les rôles personnalisés peuvent recevoir cette permission via la page d'administration des Rôles.

L'accès aux données via MCP — en lecture ou en écriture — suit le même modèle RBAC que l'interface web. Si un utilisateur ne peut pas créer de fiches dans l'inventaire, il ne peut pas non plus en créer via MCP ; il n'y a pas de permissions de données spécifiques à MCP.

---

## Sécurité

- **Authentification déléguée par SSO** : Les utilisateurs s'authentifient via leur fournisseur SSO d'entreprise. Le serveur MCP ne voit ni ne stocke jamais les mots de passe.
- **OAuth 2.1 avec PKCE** : Le flux d'authentification utilise Proof Key for Code Exchange (S256) pour empêcher l'interception des codes d'autorisation.
- **RBAC par utilisateur** : Chaque action MCP — lecture ou écriture — s'exécute avec les permissions de l'utilisateur authentifié. Pas de comptes de service partagés.
- **Exécution à blanc par défaut sur les écritures** : Les outils d'écriture proposent par défaut un aperçu valider-puis-annuler. L'outil d'IA doit rappeler explicitement avec `dry_run=false` avant qu'aucune donnée ne soit persistée, et chaque modification est journalisée sous l'identité de l'utilisateur.
- **Pas d'analyse de fichiers dans MCP** : Le serveur MCP lui-même n'accepte pas de PDF, fichiers Excel, images ou autres artefacts binaires. L'outil d'IA appelant les parse dans son propre contexte et envoie des lignes structurées. Cela maintient la surface d'attaque réduite et évite d'exposer le serveur à des entrées binaires malformées.
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
