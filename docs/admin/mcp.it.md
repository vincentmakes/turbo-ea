# Integrazione MCP (accesso per strumenti IA)

Turbo EA include un **server MCP** (Model Context Protocol) integrato che consente agli strumenti di IA — come Claude Desktop, GitHub Copilot, Cursor e VS Code — di interrogare e aggiornare i dati EA direttamente. Gli strumenti di IA possono inoltre caricare artefatti (fogli di calcolo, diagrammi BPMN, diagrammi DrawIO, documenti liberi) e trasformarli in card, relazioni e diagrammi che rispettano il metamodello esistente. Gli utenti si autenticano tramite il loro provider SSO esistente, e ogni azione rispetta i loro permessi individuali.

Questa funzionalità è **opzionale** e **non si avvia automaticamente**. Richiede che l'SSO sia configurato, che il profilo MCP sia attivato in Docker Compose e che un amministratore lo abiliti nell'interfaccia delle impostazioni.

---

## Come funziona

```
Strumento IA (Claude, Copilot, ecc.)
    │
    │  Protocollo MCP (streamable HTTP)
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

Prima di abilitare MCP, è necessario avere:

- **SSO configurato e funzionante** — MCP delega l'autenticazione al provider SSO (Microsoft Entra ID, Google Workspace, Okta o OIDC generico). Consultare la guida [Autenticazione e SSO](sso.md).
- **HTTPS con un dominio pubblico** — Il flusso OAuth richiede un URI di reindirizzamento stabile. Distribuire dietro un reverse proxy con terminazione TLS (Caddy, Traefik, Cloudflare Tunnel, ecc.).

---

## Configurazione

### Passaggio 1: Avviare il servizio MCP

Il server MCP è un profilo opzionale di Docker Compose. Aggiungere `--profile mcp` al comando di avvio:

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
| `TURBO_EA_PUBLIC_URL` | `http://localhost:8920` | L'URL pubblico dell'istanza Turbo EA |
| `MCP_PUBLIC_URL` | `http://localhost:8920/mcp` (docker compose) | L'URL pubblico del server MCP (usato negli URI di reindirizzamento OAuth). Quando il container viene eseguito in modalità standalone, il valore predefinito nel codice è `http://localhost:8001` |
| `MCP_PORT` | `8001` | Porta interna del container MCP (raramente necessita di modifica) |

### Passaggio 3: Aggiungere l'URI di reindirizzamento OAuth all'app SSO

Nella registrazione dell'applicazione del provider SSO (la stessa configurata per il login di Turbo EA), aggiungere questo URI di reindirizzamento:

```
https://il-tuo-dominio.esempio.com/mcp/oauth/callback
```

Questo è necessario per il flusso OAuth che autentica gli utenti quando si connettono dal loro strumento IA.

### Passaggio 4: Abilitare MCP nelle impostazioni di amministrazione

1. Andare su **Impostazioni** nell'area di amministrazione e selezionare la scheda **AI**.
2. Scorrere fino alla sezione **Integrazione MCP (Accesso strumenti IA)**.
3. Attivare l'interruttore per **abilitare** MCP.
4. L'interfaccia mostrerà l'URL del server MCP e le istruzioni di configurazione da condividere con il team.

!!! warning
    L'interruttore è disabilitato se l'SSO non è configurato. Configurare prima l'SSO.

---

## Connettere gli strumenti IA

Una volta abilitato MCP, condividere l'**URL del server MCP** con il team. Ogni utente lo aggiunge al proprio strumento IA:

### Claude Desktop

1. Aprire **Impostazioni > Connettori > Aggiungi connettore personalizzato**.
2. Inserire l'URL del server MCP: `https://il-tuo-dominio.esempio.com/mcp`
3. Fare clic su **Connetti** — si apre una finestra del browser per il login SSO.
4. Dopo l'autenticazione, Claude può interrogare i dati EA.

### VS Code (GitHub Copilot / Cursor)

Aggiungere al file `.vscode/mcp.json` del workspace:

```json
{
  "servers": {
    "turbo-ea": {
      "type": "http",
      "url": "https://il-tuo-dominio.esempio.com/mcp"
    }
  }
}
```

Utilizzare `https://il-tuo-dominio.esempio.com/mcp` come endpoint. La precedente forma doppia `https://il-tuo-dominio.esempio.com/mcp/mcp` continua a funzionare, quindi i connettori esistenti continuano a funzionare senza modifiche.

---

## Test locale (modalità stdio)

Per lo sviluppo locale o i test senza SSO/HTTPS, è possibile eseguire il server MCP in **modalità stdio** — Claude Desktop lo avvia direttamente come processo locale.

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

In questa modalità, il server si autentica con email/password e rinnova il token automaticamente in background.

---

## Funzionalità disponibili

Il server MCP espone **47 strumenti** suddivisi in due gruppi: **30 strumenti di lettura** che interrogano i dati EA e **17 strumenti di scrittura** (13 additivi, 4 distruttivi) che creano e mantengono card, relazioni, diagrammi, rischi, ADR e altro ancora — inclusa la trasformazione degli artefatti che uno strumento di IA ha nel proprio contesto (fogli di calcolo, BPMN XML, DrawIO XML, documenti, immagini) in dati EA strutturati. Ogni strumento porta `ToolAnnotations` MCP (indicazioni di sola lettura / distruttivo / idempotente) in modo che i connettori possano evidenziare la distruttività nella loro interfaccia.

### Sicurezza tramite esecuzione di prova nelle scritture

Ogni strumento di scrittura usa per impostazione predefinita **`dry_run=true`**. In questa modalità il backend esegue ogni validatore e risolutore, costruisce il piano completo e poi **annulla la transazione** in modo che nulla venga persistito. Lo strumento di IA restituisce l'anteprima all'utente; solo dopo conferma esplicita deve richiamare lo strumento con `dry_run=false` per confermare. Questo evita che un agente troppo zelante crei silenziosamente centinaia di card a partire da un foglio di calcolo interpretato male.

### Strumenti di lettura

Il server espone 30 strumenti di lettura raggruppati in otto cluster.

**Card & metamodello**

| Strumento | Descrizione |
|-----------|-------------|
| `search_cards` | Cercare e filtrare le card per tipo, stato o testo libero |
| `get_card` | Ottenere i dettagli completi di una card tramite UUID |
| `get_card_relations` | Ottenere tutte le relazioni connesse a una card |
| `get_card_hierarchy` | Ottenere antenati e figli di una card |
| `list_card_types` | Elencare tutti i tipi di card nel metamodello |
| `get_relation_types` | Elencare i tipi di relazione, con filtro opzionale per tipo di card |
| `resolve_card_refs` | Pre-validare i riferimenti alle card basati sul nome (nome → UUID) prima di un'importazione di massa — risolve soltanto, non scrive mai |
| `analyze_impact` | Analisi del raggio d'impatto delle dipendenze per una modifica proposta a una card |

**Dashboard**

| Strumento | Descrizione |
|-----------|-------------|
| `get_dashboard` | Dashboard KPI (conteggi, qualità dei dati, approvazioni, attività) |
| `get_landscape` | Card di un tipo raggruppate per un tipo correlato |

**GRC — Registro dei rischi**

| Strumento | Descrizione |
|-----------|-------------|
| `list_risks` | Elenco paginato e filtrabile dei rischi EA (TOGAF Fase G) |
| `get_risk` | Dettaglio di un rischio con card collegate e percorso di audit |
| `get_risk_metrics` | KPI + matrici 4×4 iniziale e residua |
| `get_card_risks` | Tutti i rischi attualmente collegati a una card |

**GRC — Conformità**

| Strumento | Descrizione |
|-----------|-------------|
| `list_compliance_findings` | Riscontri di conformità raggruppati per regolamento |
| `get_compliance_overview` | Punteggi di conformità + matrice di stato per regolamento + metadati dell'ultima scansione |

**Governance & Consegna**

| Strumento | Descrizione |
|-----------|-------------|
| `list_principles` | Principi EA pubblicati (enunciato, motivazione, implicazioni) |
| `list_adrs` | Architecture Decision Records, filtrabili per iniziativa / stato |
| `get_adr` | ADR singolo con sezioni, card collegate e percorso di firma |
| `list_soaws` | Statements of Architecture Work di un'iniziativa |

**Report**

| Strumento | Descrizione |
|-----------|-------------|
| `get_portfolio_report` | Dati di grafico a bolle per un tipo di card (default: fit funzionale × tecnico) |
| `get_cost_treemap` | Treemap dei costi, opzionalmente raggruppato per un tipo correlato |
| `get_capability_heatmap` | Heatmap gerarchica delle capacità di business |
| `get_data_quality_report` | Suddivisione della completezza per tipo di card |

**Contesto card**

| Strumento | Descrizione |
|-----------|-------------|
| `get_card_stakeholders` | Utenti + ruoli assegnati a una card |
| `get_card_comments` | Thread di commenti di una card |
| `get_card_documents` | Link a documenti allegati a una card (URL, non file) |

**Diagrammi**

| Strumento | Descrizione |
|-----------|-------------|
| `list_diagrams` | Elencare i diagrammi a disegno libero (DrawIO), con filtro opzionale su una card |
| `get_diagram` | Recuperare un singolo diagramma tramite id, incluso il suo XML DrawIO |

**Audit & cronologia delle modifiche**

| Strumento | Descrizione |
|-----------|-------------|
| `get_change_history` | Interrogare il registro dei batch di mutazione (per id del batch, attore, strumento o origine) per ricostruire esattamente cosa ha modificato un precedente commit MCP |

Tutti gli strumenti rispettano l'RBAC dell'utente autenticato — un visualizzatore riceverà semplicemente una lista vuota (o 403) per ciò che non può vedere; non serve alcuna configurazione per-tool a livello MCP.

### Strumenti di scrittura

Il server espone 17 strumenti di scrittura, ciascuno annotato come **additivo** (crea o estende dati) o **distruttivo** (modifica o rimuove dati esistenti), in modo che i connettori possano avvertire di conseguenza.

**Additivi (13)**

| Strumento | Descrizione |
|-----------|-------------|
| `create_cards_bulk` | Crea più card in una sola chiamata (per esempio righe di foglio di calcolo). Supporta riferimenti al genitore per nome all'interno dello stesso batch, con ordinamento topologico lato server. |
| `transition_card_lifecycle` | Fa avanzare una card attraverso le fasi di approvazione o del ciclo di vita. |
| `create_risks` | Crea voci nel Registro dei rischi EA. |
| `update_risks` | Aggiorna le voci del Registro dei rischi (campi, card collegate). |
| `add_card_comment` | Pubblica un commento su una card — una nota non distruttiva e revisionabile invece di modificare i campi. |
| `create_soaw` | Crea uno Statement of Architecture Work per un'iniziativa. |
| `assign_stakeholders` | Assegna o rimuove ruoli di stakeholder sulle card. |
| `update_cards_bulk` | Patch a livello di campo su molte card in una sola chiamata. |
| `create_adr` | Crea un Architecture Decision Record. |
| `update_adr` | Aggiorna un ADR (titolo, sezioni, stato, card collegate). |
| `sign_adr` | Firma un ADR (richiede il permesso `adr.sign`; altrimenti restituisce un deep-link all'interfaccia per firmare nel browser). |
| `create_diagram` | Crea un diagramma DrawIO libero con collegamenti opzionali a card esistenti. |
| `import_bpmn` | Salva un diagramma BPMN 2.0 XML su una card Processo di business **esistente**. Se nessuna card corrisponde al nome fornito, lo strumento restituisce un errore `card_not_found` che rimanda l'agente a `create_cards_bulk` — questo forza la creazione esplicita della card con descrizione, sottotipo e attributi prima, invece di una scorciatoia che produce una card scarna. |

**Distruttivi (4)**

| Strumento | Descrizione |
|-----------|-------------|
| `upsert_relations_bulk` | Crea o elimina relazioni tra card. Sorgente / destinazione / tipo sono validati contro il metamodello. L'eliminazione è rifiutata a meno che l'operatore non la abiliti esplicitamente (vedere le salvaguardie). |
| `archive_cards` | Archivia le card (soft-delete). Recuperabile — le card archiviate possono essere ripristinate per 30 giorni prima dell'eliminazione automatica. |
| `update_diagram` | Sostituisce l'XML DrawIO di un diagramma, il nome o i collegamenti alle card. |
| `rollback_batch` | Annulla le scritture eseguite in un precedente batch di mutazione. |

### Caricamento di artefatti

Un sottoinsieme degli strumenti di scrittura (`create_cards_bulk`, `upsert_relations_bulk`, `create_diagram`, `import_bpmn`) permette a un agente di IA di trasformare gli artefatti in dati EA strutturati. L'agente legge il file sorgente nel proprio contesto (visione multimodale, allegati), estrae righe strutturate e chiama questi strumenti. Il server MCP in sé non analizza mai i file — si aspetta un input già strutturato.

Flusso tipico quando un utente condivide un foglio di calcolo con l'agente di IA:

1. L'agente chiama `list_card_types` e `get_relation_types` per comprendere il metamodello.
2. L'agente analizza il foglio di calcolo (nel proprio contesto, non in MCP) e costruisce dizionari di riga.
3. L'agente chiama `create_cards_bulk(cards=…, dry_run=True)` e mostra l'anteprima all'utente.
4. L'utente conferma; l'agente richiama con `dry_run=False` per confermare.
5. Se sono presenti colonne di relazione, l'agente chiama poi `upsert_relations_bulk` con lo stesso ciclo esecuzione di prova / conferma.

### Salvaguardie degli strumenti di scrittura

Difesa in profondità sopra l'esecuzione di prova, in modo che un errore del LLM non possa causare danni massicci:

- **Limite di dimensione per chiamata.** Gli strumenti di scrittura MCP applicano un limite molto più piccolo rispetto agli endpoint sottostanti dell'importatore Excel: 200 righe per `create_cards_bulk`, 500 operazioni per `upsert_relations_bulk`. Sufficientemente grande per qualsiasi caricamento realistico di un singolo artefatto, sufficientemente piccolo perché un'anteprima di esecuzione di prova rimanga visionabile.
- **Nessuna eliminazione di relazioni per impostazione predefinita.** `upsert_relations_bulk` rifiuta le operazioni `action: "delete"` — per rimuovere relazioni, utilizzare l'interfaccia web dove l'azione viene registrata sotto l'identità dell'utente. Gli operatori possono abilitarla impostando `MCP_ALLOW_RELATION_DELETE=true`.
- **Interruttore di spegnimento.** `MCP_WRITES_ENABLED=false` disattiva tutti i 17 strumenti di scrittura senza ridistribuire codice. I 30 strumenti di lettura continuano a funzionare.
- **Etichetta di origine per l'audit.** Ogni richiesta al backend dal server MCP porta un'intestazione `X-Turbo-EA-Origin: mcp`. Gli eventi emessi da queste richieste vengono etichettati con `origin: "mcp"` nel payload del log di audit, in modo che gli amministratori possano filtrare le scritture guidate da MCP fuori dalla timeline, separate dalle azioni dell'interfaccia web.
- **Batch di mutazione.** Ogni chiamata di scrittura MCP apre un batch di mutazione prima di qualsiasi scrittura; ogni evento emesso durante la chiamata viene marcato con l'id del batch. Gli amministratori (o lo strumento `get_change_history`) possono ricostruire il diff completo per evento di un commit a partire da un singolo id, e `rollback_batch` può annullarlo. I commit che superano `MCP_BATCH_CONFIRMATION_THRESHOLD` righe devono restituire un `confirm_token` monouso emesso dalla precedente esecuzione di prova (TTL di 15 minuti), così un commit di grandi dimensioni segue sempre un'anteprima revisionata.
- **Nessuna eliminazione definitiva.** Il set di strumenti omette deliberatamente l'eliminazione permanente delle card. `archive_cards` e `update_cards_bulk` *sono* esposti, ma l'archiviazione è un soft-delete recuperabile (finestra di ripristino di 30 giorni) ed entrambi sono annotati come distruttivi e protetti dall'esecuzione di prova. Aggiungere uno strumento che esegua una mutazione irreversibile (eliminazione definitiva, force-purge) richiederebbe una revisione di progettazione esplicita.

Le sei variabili di ambiente di salvaguardia sul container MCP:

| Variabile | Predefinito | Effetto |
|-----------|-------------|---------|
| `MCP_WRITES_ENABLED` | `true` | Interruttore principale degli strumenti di scrittura. `false` → MCP in sola lettura. |
| `MCP_MAX_CARDS_PER_CALL` | `200` | Limite massimo di righe `create_cards_bulk` / `update_cards_bulk` per richiesta. |
| `MCP_MAX_RELATIONS_PER_CALL` | `500` | Limite massimo di operazioni `upsert_relations_bulk` per richiesta. |
| `MCP_ALLOW_RELATION_DELETE` | `false` | Quando `true`, `upsert_relations_bulk` accetta operazioni `action: "delete"`. |
| `MCP_BATCH_CONFIRMATION_THRESHOLD` | `20` | I commit che toccano più righe di questo valore richiedono il `confirm_token` di una precedente esecuzione di prova. |
| `MCP_REQUIRE_DRYRUN_FIRST` | `true` | Abilita il gate del token di conferma di cui sopra. Impostare `false` solo per pipeline di automazione fidate che saltano esplicitamente il ciclo di anteprima. |

### Risorse

| URI | Descrizione |
|-----|-------------|
| `turbo-ea://types` | Tutti i tipi di card nel metamodello |
| `turbo-ea://relation-types` | Tutti i tipi di relazione |
| `turbo-ea://dashboard` | KPI del dashboard e statistiche riepilogative |

### Prompt guidati

| Prompt | Descrizione |
|--------|-------------|
| `analyze_landscape` | Analisi a più passaggi: panoramica del dashboard, tipi, relazioni |
| `find_card` | Cercare una card per nome, ottenere dettagli e relazioni |
| `explore_dependencies` | Mappare le dipendenze di una card |

---

## Permessi

| Ruolo | Accesso |
|-------|---------|
| **Amministratore** | Configurare le impostazioni MCP (permesso `admin.mcp`). Accesso completo in lettura + scrittura tramite MCP. |
| **Tutti gli utenti autenticati** | Accesso in lettura governato dal loro RBAC esistente. Gli strumenti di scrittura richiedono i corrispondenti permessi backend — `inventory.create` / `inventory.edit` / `inventory.archive` (card), `relations.manage` (relazioni), `diagrams.manage` (diagrammi), `bpm.edit` (BPMN), `risks.manage` (Registro dei rischi), `comments.create` (commenti), `stakeholders.manage` (stakeholder), `soaw.create` (SoAW), `adr.create` / `adr.sign` (ADR). |

Il permesso `admin.mcp` controlla chi può gestire le impostazioni MCP. È disponibile solo per il ruolo Amministratore per impostazione predefinita. Ai ruoli personalizzati può essere concesso questo permesso tramite la pagina di amministrazione dei Ruoli.

L'accesso ai dati tramite MCP — in lettura o in scrittura — segue lo stesso modello RBAC dell'interfaccia web. Se un utente non può creare card nell'interfaccia di inventario, non può crearle nemmeno tramite MCP; non ci sono permessi dati specifici per MCP.

---

## Sicurezza

- **Autenticazione delegata tramite SSO**: Gli utenti si autenticano tramite il provider SSO aziendale. Il server MCP non vede né memorizza mai le password.
- **OAuth 2.1 con PKCE**: Il flusso di autenticazione utilizza Proof Key for Code Exchange (S256) per prevenire l'intercettazione dei codici di autorizzazione.
- **RBAC per utente**: Ogni azione MCP — in lettura o in scrittura — viene eseguita con i permessi dell'utente autenticato. Nessun account di servizio condiviso.
- **Esecuzione di prova predefinita sulle scritture**: Gli strumenti di scrittura propongono per impostazione predefinita un'anteprima valida-e-annulla. Lo strumento di IA deve richiamare esplicitamente con `dry_run=false` prima che qualunque dato venga persistito, e ogni modifica è registrata sotto l'identità dell'utente.
- **Nessuna analisi di file in MCP**: Il server MCP in sé non accetta PDF, file Excel, immagini o altri artefatti binari. Lo strumento di IA chiamante li analizza nel proprio contesto e invia righe strutturate. Questo mantiene la superficie di attacco ridotta ed evita di esporre il server a input binari malformati.
- **Rotazione dei token**: I token di accesso scadono dopo 1 ora. I token di rinnovo durano 30 giorni. I codici di autorizzazione sono monouso e scadono dopo 10 minuti.
- **Porta solo interna**: Il container MCP espone la porta 8001 solo sulla rete Docker interna. Tutto l'accesso esterno passa attraverso il reverse proxy Nginx.

---

## Risoluzione dei problemi

| Problema | Soluzione |
|----------|----------|
| L'interruttore MCP è disabilitato nelle impostazioni | L'SSO deve essere configurato prima. Andare su Impostazioni > scheda Autenticazione e configurare un provider SSO. |
| «host not found» nei log di Nginx | Il servizio MCP non è in esecuzione. Avviarlo con `docker compose --profile mcp up -d`. La configurazione di Nginx gestisce questo in modo elegante (risposta 502, nessun crash). |
| Il callback OAuth fallisce | Verificare di aver aggiunto `https://il-tuo-dominio.esempio.com/mcp/oauth/callback` come URI di reindirizzamento nella registrazione dell'app SSO. |
| Lo strumento IA non riesce a connettersi | Verificare che `MCP_PUBLIC_URL` corrisponda all'URL accessibile dalla macchina dell'utente. Assicurarsi che HTTPS funzioni. |
| L'utente ottiene risultati vuoti | MCP rispetta i permessi RBAC. Se un utente ha accesso limitato, vedrà solo le card consentite dal suo ruolo. |
| La connessione si interrompe dopo 1 ora | Lo strumento IA dovrebbe gestire il rinnovo dei token automaticamente. In caso contrario, riconnettersi. |
