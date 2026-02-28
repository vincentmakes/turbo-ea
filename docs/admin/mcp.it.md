# Integrazione MCP (accesso per strumenti IA)

Turbo EA include un **server MCP** (Model Context Protocol) integrato che consente agli strumenti di IA — come Claude Desktop, GitHub Copilot, Cursor e VS Code — di interrogare i dati EA direttamente. Gli utenti si autenticano tramite il loro provider SSO esistente, e ogni query rispetta i loro permessi individuali.

Questa funzionalita e **opzionale** e **non si avvia automaticamente**. Richiede che l'SSO sia configurato, che il profilo MCP sia attivato in Docker Compose e che un amministratore lo abiliti nell'interfaccia delle impostazioni.

---

## Come funziona

```
Strumento IA (Claude, Copilot, ecc.)
    │
    │  Protocollo MCP (HTTP + SSE)
    ▼
Server MCP di Turbo EA (:8001, interno)
    │
    │  OAuth 2.1 con PKCE
    │  delega al provider SSO
    ▼
Backend Turbo EA (:8000)
    │
    │  RBAC per utente
    ▼
PostgreSQL
```

1. Un utente aggiunge l'URL del server MCP al proprio strumento IA.
2. Alla prima connessione, lo strumento IA apre una finestra del browser per l'autenticazione SSO.
3. Dopo il login, il server MCP emette il proprio token di accesso (supportato dal JWT Turbo EA dell'utente).
4. Lo strumento IA utilizza questo token per tutte le richieste successive. I token si rinnovano automaticamente.
5. Ogni query passa attraverso il normale sistema di permessi di Turbo EA — gli utenti vedono solo i dati a cui hanno accesso.

---

## Prerequisiti

Prima di abilitare MCP, e necessario avere:

- **SSO configurato e funzionante** — MCP delega l'autenticazione al provider SSO (Microsoft Entra ID, Google Workspace, Okta o OIDC generico). Consultare la guida [Autenticazione e SSO](sso.md).
- **HTTPS con un dominio pubblico** — Il flusso OAuth richiede un URI di reindirizzamento stabile. Distribuire dietro un reverse proxy con terminazione TLS (Caddy, Traefik, Cloudflare Tunnel, ecc.).

---

## Configurazione

### Passaggio 1: Avviare il servizio MCP

Il server MCP e un profilo opzionale di Docker Compose. Aggiungere `--profile mcp` al comando di avvio:

```bash
docker compose --profile mcp up --build -d
```

Questo avvia un container Python leggero (porta 8001, solo interno) accanto al backend e frontend. Nginx reindirizza automaticamente le richieste `/mcp/` verso di esso.

### Passaggio 2: Configurare le variabili d'ambiente

Aggiungere queste al file `.env`:

```dotenv
TURBO_EA_PUBLIC_URL=https://il-tuo-dominio.esempio.com
MCP_PUBLIC_URL=https://il-tuo-dominio.esempio.com/mcp
```

| Variabile | Predefinito | Descrizione |
|-----------|------------|-------------|
| `TURBO_EA_PUBLIC_URL` | `http://localhost:8920` | L'URL pubblica dell'istanza Turbo EA |
| `MCP_PUBLIC_URL` | `http://localhost:8920/mcp` | L'URL pubblica del server MCP (usata negli URI di reindirizzamento OAuth) |
| `MCP_PORT` | `8001` | Porta interna del container MCP (raramente necessita di modifica) |

### Passaggio 3: Aggiungere l'URI di reindirizzamento OAuth all'app SSO

Nella registrazione dell'applicazione del provider SSO (la stessa configurata per il login di Turbo EA), aggiungere questo URI di reindirizzamento:

```
https://il-tuo-dominio.esempio.com/mcp/oauth/callback
```

Questo e necessario per il flusso OAuth che autentica gli utenti quando si connettono dal loro strumento IA.

### Passaggio 4: Abilitare MCP nelle impostazioni di amministrazione

1. Andare su **Impostazioni** nell'area di amministrazione e selezionare la scheda **AI**.
2. Scorrere fino alla sezione **Integrazione MCP (Accesso strumenti IA)**.
3. Attivare l'interruttore per **abilitare** MCP.
4. L'interfaccia mostrera l'URL del server MCP e le istruzioni di configurazione da condividere con il team.

!!! warning
    L'interruttore e disabilitato se l'SSO non e configurato. Configurare prima l'SSO.

---

## Connettere gli strumenti IA

Una volta abilitato MCP, condividere l'**URL del server MCP** con il team. Ogni utente lo aggiunge al proprio strumento IA:

### Claude Desktop

1. Aprire **Impostazioni > Connettori > Aggiungi connettore personalizzato**.
2. Inserire l'URL del server MCP: `https://il-tuo-dominio.esempio.com/mcp`
3. Fare clic su **Connetti** — si apre una finestra del browser per il login SSO.
4. Dopo l'autenticazione, Claude puo interrogare i dati EA.

### VS Code (GitHub Copilot / Cursor)

Aggiungere al file `.vscode/mcp.json` del workspace:

```json
{
  "servers": {
    "turbo-ea": {
      "type": "http",
      "url": "https://il-tuo-dominio.esempio.com/mcp/mcp"
    }
  }
}
```

Il doppio `/mcp/mcp` e intenzionale — il primo `/mcp/` e il percorso del proxy Nginx, il secondo e l'endpoint del protocollo MCP.

---

## Test locale (modalita stdio)

Per lo sviluppo locale o i test senza SSO/HTTPS, e possibile eseguire il server MCP in **modalita stdio** — Claude Desktop lo avvia direttamente come processo locale.

**1. Installare il pacchetto del server MCP:**

```bash
pip install ./mcp-server
```

**2. Aggiungere alla configurazione di Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "turbo-ea": {
      "command": "python",
      "args": ["-m", "turbo_ea_mcp", "--stdio"],
      "env": {
        "TURBO_EA_URL": "http://localhost:8000",
        "TURBO_EA_EMAIL": "tua@email.com",
        "TURBO_EA_PASSWORD": "tua-password"
      }
    }
  }
}
```

In questa modalita, il server si autentica con email/password e rinnova il token automaticamente in background.

---

## Funzionalita disponibili

Il server MCP fornisce accesso **in sola lettura** ai dati EA. Non puo creare, modificare o eliminare nulla.

### Strumenti

| Strumento | Descrizione |
|-----------|-------------|
| `search_cards` | Cercare e filtrare le card per tipo, stato o testo libero |
| `get_card` | Ottenere i dettagli completi di una card tramite UUID |
| `get_card_relations` | Ottenere tutte le relazioni connesse a una card |
| `get_card_hierarchy` | Ottenere antenati e figli di una card |
| `list_card_types` | Elencare tutti i tipi di card nel metamodello |
| `get_relation_types` | Elencare i tipi di relazione, con filtro opzionale per tipo di card |
| `get_dashboard` | Ottenere i dati del dashboard KPI (conteggi, qualita dei dati, approvazioni) |
| `get_landscape` | Ottenere le card raggruppate per un tipo correlato |

### Risorse

| URI | Descrizione |
|-----|-------------|
| `turbo-ea://types` | Tutti i tipi di card nel metamodello |
| `turbo-ea://relation-types` | Tutti i tipi di relazione |
| `turbo-ea://dashboard` | KPI del dashboard e statistiche riepilogative |

### Prompt guidati

| Prompt | Descrizione |
|--------|-------------|
| `analyze_landscape` | Analisi a piu passaggi: panoramica del dashboard, tipi, relazioni |
| `find_card` | Cercare una card per nome, ottenere dettagli e relazioni |
| `explore_dependencies` | Mappare le dipendenze di una card |

---

## Permessi

| Ruolo | Accesso |
|-------|---------|
| **Amministratore** | Configurare le impostazioni MCP (permesso `admin.mcp`) |
| **Tutti gli utenti autenticati** | Interrogare i dati EA tramite il server MCP (rispetta i permessi esistenti a livello di card e applicazione) |

Il permesso `admin.mcp` controlla chi puo gestire le impostazioni MCP. E disponibile solo per il ruolo Amministratore per impostazione predefinita. Ai ruoli personalizzati puo essere concesso questo permesso tramite la pagina di amministrazione dei Ruoli.

L'accesso ai dati tramite MCP segue lo stesso modello RBAC dell'interfaccia web — non ci sono permessi dati specifici per MCP.

---

## Sicurezza

- **Autenticazione delegata tramite SSO**: Gli utenti si autenticano tramite il provider SSO aziendale. Il server MCP non vede ne memorizza mai le password.
- **OAuth 2.1 con PKCE**: Il flusso di autenticazione utilizza Proof Key for Code Exchange (S256) per prevenire l'intercettazione dei codici di autorizzazione.
- **RBAC per utente**: Ogni query MCP viene eseguita con i permessi dell'utente autenticato. Nessun account di servizio condiviso.
- **Accesso in sola lettura**: Il server MCP puo solo leggere i dati. Non puo creare, aggiornare o eliminare card, relazioni o altre risorse.
- **Rotazione dei token**: I token di accesso scadono dopo 1 ora. I token di rinnovo durano 30 giorni. I codici di autorizzazione sono monouso e scadono dopo 10 minuti.
- **Porta solo interna**: Il container MCP espone la porta 8001 solo sulla rete Docker interna. Tutto l'accesso esterno passa attraverso il reverse proxy Nginx.

---

## Risoluzione dei problemi

| Problema | Soluzione |
|----------|----------|
| L'interruttore MCP e disabilitato nelle impostazioni | L'SSO deve essere configurato prima. Andare su Impostazioni > scheda Autenticazione e configurare un provider SSO. |
| «host not found» nei log di Nginx | Il servizio MCP non e in esecuzione. Avviarlo con `docker compose --profile mcp up -d`. La configurazione di Nginx gestisce questo in modo elegante (risposta 502, nessun crash). |
| Il callback OAuth fallisce | Verificare di aver aggiunto `https://il-tuo-dominio.esempio.com/mcp/oauth/callback` come URI di reindirizzamento nella registrazione dell'app SSO. |
| Lo strumento IA non riesce a connettersi | Verificare che `MCP_PUBLIC_URL` corrisponda all'URL accessibile dalla macchina dell'utente. Assicurarsi che HTTPS funzioni. |
| L'utente ottiene risultati vuoti | MCP rispetta i permessi RBAC. Se un utente ha accesso limitato, vedra solo le card consentite dal suo ruolo. |
| La connessione si interrompe dopo 1 ora | Lo strumento IA dovrebbe gestire il rinnovo dei token automaticamente. In caso contrario, riconnettersi. |
