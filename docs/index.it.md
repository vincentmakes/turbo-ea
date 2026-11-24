# Introduzione a Turbo EA

### Cos'è Turbo EA?

**Turbo EA** è una piattaforma moderna e self-hosted per la **gestione dell'Enterprise Architecture**. Consente alle organizzazioni di documentare, visualizzare e gestire tutti i componenti della propria architettura aziendale e tecnologica in un unico luogo.

### A chi è destinata questa guida?

Questa guida è destinata a **tutti gli utenti di Turbo EA** — enterprise architect, responsabili IT, analisti di business, sviluppatori e amministratori. Che stiate valutando la piattaforma, gestendo quotidianamente il panorama IT della vostra organizzazione o configurando il sistema come amministratori, troverete qui le informazioni necessarie. Non sono richieste conoscenze tecniche avanzate per iniziare.

### Vantaggi principali

- **Visibilità completa**: Visualizzate tutte le applicazioni, i processi, le capability e le tecnologie dell'organizzazione in un'unica piattaforma.
- **Decisioni informate**: Report visivi (portfolio, mappe delle capability, dipendenze, ciclo di vita, costi e altro) che facilitano la valutazione dello stato attuale dell'infrastruttura tecnologica.
- **Gestione del ciclo di vita**: Monitorate lo stato di ogni componente tecnologico attraverso cinque fasi — dalla pianificazione al ritiro.
- **Collaborazione**: Più utenti possono lavorare simultaneamente, con ruoli configurabili, assegnazioni di stakeholder, commenti, todo e notifiche.
- **Descrizioni generate dall'AI**: Generate descrizioni delle card con un solo clic. Turbo EA combina la ricerca web con un LLM locale o commerciale per produrre riassunti contestualizzati per tipo — completi di punteggi di affidabilità e link alle fonti. Funziona interamente sulla vostra infrastruttura per la privacy, oppure collegatevi a provider commerciali (OpenAI, Google Gemini, Anthropic Claude e altri). Completamente controllato dall'amministratore: scegliete quali tipi di card ricevono suggerimenti AI, selezionate il provider di ricerca e il modello.
- **Diagrammi visivi**: Create diagrammi architetturali con l'editor DrawIO integrato, completamente sincronizzato con il vostro inventario di card.
- **Modellazione dei processi aziendali**: Editor di flussi di processo BPMN 2.0 con collegamento degli elementi, workflow di approvazione e valutazioni della maturità.
- **Integrazione ServiceNow**: Sincronizzazione bidirezionale con ServiceNow CMDB per mantenere il vostro panorama EA connesso con i dati operativi IT.
- **Multi-lingua**: Disponibile in inglese, spagnolo, francese, tedesco, italiano, portoghese e cinese.

### Concetti chiave

| Termine | Significato |
|---------|-------------|
| **Card** | L'elemento base della piattaforma. Rappresenta qualsiasi componente architetturale: un'applicazione, un processo, una business capability, ecc. |
| **Tipo di card** | La categoria a cui appartiene una card (Application, Business Process, Organization, ecc.) |
| **Relazione** | Una connessione tra due card che descrive come sono correlate (es. "utilizza", "dipende da", "fa parte di") |
| **Metamodello** | La struttura che definisce quali tipi di card esistono, quali campi hanno e come si relazionano tra loro. Completamente configurabile dall'amministratore |
| **Ciclo di vita** | Le fasi temporali di un componente: Plan, Phase In, Active, Phase Out, End of Life |
| **Inventario** | Elenco ricercabile e filtrabile di tutte le card di ogni tipo. Modifica in blocco, import-export Excel/CSV e viste salvate con condivisione |
| **Report** | Visualizzazioni predefinite: Portfolio, Mappa delle Capability, Ciclo di Vita, Dipendenze, Costi, Matrice, Qualità dei Dati e End-of-Life |
| **BPM** | Business Process Management — modellate i processi con un editor BPMN 2.0, collegate gli elementi del diagramma alle card e valutate maturità, rischio e automazione |
| **PML** | Project Portfolio Management — gestite le card Initiative come progetti completi con report di stato, Work Breakdown Structures, board kanban e Gantt, budget, costi e un registro dei rischi per iniziativa |
| **TurboLens** | Intelligenza EA basata sull'AI — analisi fornitori, rilevamento duplicati, valutazione di modernizzazione, l'assistente Architecture AI in 5 fasi e le scansioni di Conformità (EU AI Act / GDPR / NIS2 / DORA / SOC 2 / ISO 27001) |
| **EA Delivery** | La superficie di delivery allineata a TOGAF — Statements of Architecture Work, Architecture Decision Records e il Registro dei Rischi a livello di panorama |
| **SoAW** | Statement of Architecture Work — documento formale TOGAF che delimita un'iniziativa architetturale |
| **ADR** | Architecture Decision Record — cattura contesto, alternative e conseguenze di una decisione, con workflow di stato e collegamento alle card |
| **Registro dei Rischi** | Registro dei rischi a livello di panorama (TOGAF Fase G), separato dai rischi a livello di iniziativa di PML. L'assegnazione di un proprietario crea automaticamente una Todo |
| **Portale Web** | Vista pubblica, basata su slug e di sola lettura di parte del panorama EA — condivisibile senza login |
| **Server MCP** | Accesso AI in sola lettura tramite Model Context Protocol — interrogate i dati EA da Claude Desktop, Cursor, GitHub Copilot e altri client MCP |
| **RBAC** | Role-Based Access Control — ruoli a livello di applicazione più ruoli di stakeholder per card, con oltre 50 permessi granulari |
