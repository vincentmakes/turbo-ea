# Glossario dei termini

| Termine | Definizione |
|---------|------------|
| **ADR (Architecture Decision Record)** | Un documento formale che registra una decisione architetturale importante, includendo contesto, motivazioni, conseguenze e alternative considerate. Gli ADR supportano un flusso di firma e una catena di revisioni |
| **Anno fiscale** | Il periodo di 12 mesi utilizzato per il budget e la rendicontazione finanziaria. Configurabile tramite Admin > Impostazioni — il mese di inizio (da gennaio a dicembre) determina come vengono raggruppate le linee di budget PPM |
| **Stato di approvazione** | Lo stato di revisione di una card: Draft, Approved, Broken o Rejected. Le card approvate cambiano in Broken quando vengono modificate |
| **Segnalibro / Vista salvata** | Una configurazione salvata di filtri, colonne e ordinamento nell'Inventario che può essere ricaricata con un clic |
| **BPM** | Business Process Management — la disciplina della modellazione, analisi e miglioramento dei processi aziendali |
| **BPMN** | Business Process Model and Notation — la notazione standard per la modellazione dei processi aziendali (versione 2.0) |
| **Business Capability** | Ciò che un'organizzazione può fare, indipendentemente da come lo fa |
| **Calcolo** | Una formula definita dall'amministratore che calcola automaticamente il valore di un campo quando una card viene salvata |
| **Card** | L'unità base di informazione in Turbo EA che rappresenta qualsiasi componente architetturale |
| **Tipo di card** | La categoria a cui appartiene una card (es. Application, Business Process, Organization) |
| **Punteggio di affidabilità** | Una valutazione 0-100% che indica quanto è affidabile una descrizione generata dall'AI |
| **Voce di costo** | Una voce di budget o costo effettivo (CapEx/OpEx) in un'iniziativa PPM, utilizzata per monitorare le spese finanziarie |
| **Qualità dei dati** | Un punteggio di completezza 0-100% basato sui campi compilati e sui loro pesi configurati |
| **Diagramma** | Un diagramma architetturale visivo creato con l'editor DrawIO integrato |
| **Feed OData** | Un feed di dati JSON disponibile sulle viste dell'inventario salvate (segnalibri) per il consumo da parte di strumenti esterni come Power BI o Excel |
| **File allegato** | Un file binario (PDF, DOCX, XLSX, immagini, fino a 10 MB) caricato direttamente su una card tramite la scheda Risorse |
| **DrawIO** | Lo strumento di disegno open-source integrato utilizzato per i diagrammi architetturali visivi |
| **Enterprise Architecture (EA)** | La disciplina che organizza e documenta la struttura aziendale e tecnologica di un'organizzazione |
| **EOL (End of Life)** | La data in cui un prodotto tecnologico perde il supporto del fornitore. Tracciato tramite l'integrazione con endoflife.date |
| **Diagramma di Gantt** | Una linea temporale visiva con barre orizzontali che mostra il calendario, la durata e l'avanzamento del progetto |
| **Initiative** | Un progetto o programma che comporta modifiche all'architettura |
| **Ciclo di vita** | Le cinque fasi attraverso cui passa un componente: Plan, Phase In, Active, Phase Out, End of Life |
| **LLM** | Large Language Model — un modello AI che genera testo (es. Ollama, OpenAI, Anthropic Claude, Google Gemini) |
| **MCP** | Model Context Protocol — uno standard aperto che consente agli strumenti IA (Claude, Copilot, Cursor) di connettersi a fonti dati esterne. Il server MCP integrato di Turbo EA fornisce accesso in sola lettura ai dati EA con RBAC per utente |
| **Metamodello** | Il modello guidato dai dati che definisce la struttura della piattaforma: tipi di card, campi, relazioni e ruoli |
| **Milestone** | Un evento significativo o punto di completamento nella tempistica di un progetto, mostrato come indicatore a diamante nel diagramma di Gantt |
| **Notifica** | Un avviso in-app o via email attivato da eventi di sistema (todo assegnato, card aggiornata, commento aggiunto, ecc.) |
| **Ollama** | Uno strumento open-source per eseguire LLM localmente sul proprio hardware |
| **Ordine righe BPM** | L'ordine di visualizzazione delle righe dei tipi di processo (Core, Supporto, Management) nel navigatore dei processi BPM, configurabile trascinando le righe |
| **Portfolio** | Una collezione di applicazioni o tecnologie gestite come gruppo |
| **PPM** | Gestione del Portafoglio Progetti — la disciplina di gestione di un portafoglio di progetti e iniziative con budget, rischi, attività e report di stato |
| **Numero di riferimento** | Un identificatore sequenziale generato automaticamente per gli ADR (es. ADR-001, ADR-002) che fornisce un'etichetta univoca e leggibile |
| **Relazione** | Una connessione tra due card che descrive come sono correlate (es. "utilizza", "dipende da", "funziona su") |
| **Scheda Risorse** | Una scheda nella pagina di dettaglio della card che consolida Decisioni architetturali, file allegati e link ai documenti in un unico luogo |
| **Revisione (ADR)** | Una nuova versione di un ADR firmato che eredita il contenuto e i collegamenti alle card dalla versione precedente, con un numero di revisione incrementato |
| **Stato RAG** | Indicatore di salute Rosso-Ambra-Verde utilizzato nei report di stato PPM per calendario, costi e ambito |
| **Punteggio di rischio** | Un valore calcolato automaticamente (probabilità x impatto) che quantifica la gravità di un rischio del progetto |
| **Report salvato** | Una configurazione di report persistente con filtri, assi e impostazioni di visualizzazione che può essere ricaricata |
| **Sezione** | Un'area raggruppabile della pagina di dettaglio della card contenente campi correlati, configurabile per tipo di card |
| **Firmatario** | Un utente designato per esaminare e firmare un documento ADR o SoAW. Il flusso di firma traccia le firme in sospeso e completate |
| **SoAW** | Statement of Architecture Work — un documento formale TOGAF che definisce ambito e deliverable per un'iniziativa |
| **SSO** | Single Sign-On — login tramite credenziali aziendali attraverso un identity provider (Microsoft, Google, Okta, OIDC) |
| **Sottotipo** | Una classificazione secondaria all'interno di un tipo di card (es. Application ha i sottotipi: Business Application, Microservice, AI Agent, Deployment). Ogni sottotipo funge da sotto-modello che può controllare la visibilità dei campi |
| **Modello di sottotipo** | La configurazione di quali campi sono visibili o nascosti per un sottotipo specifico. Gli amministratori configurano questo nell'amministrazione del metamodello cliccando su un chip di sottotipo |
| **Stakeholder** | Una persona con un ruolo specifico su una card (es. Application Owner, Technical Owner) |
| **Sondaggio** | Un questionario di manutenzione dati rivolto a tipi di card specifici per raccogliere informazioni dagli stakeholder |
| **Tag / Gruppo di tag** | Un'etichetta di classificazione organizzata in gruppi con modalità selezione singola o selezione multipla |
| **TOGAF** | The Open Group Architecture Framework — una metodologia EA ampiamente utilizzata. La funzionalità SoAW di Turbo EA è allineata a TOGAF |
| **Report di stato** | Un report PPM mensile che monitora la salute del progetto tramite indicatori RAG per calendario, costi e ambito |
| **Portale web** | Una vista pubblica di sola lettura di card selezionate accessibile senza autenticazione tramite un URL univoco |
| **Struttura di Scomposizione del Lavoro (WBS)** | Una scomposizione gerarchica dell'ambito del progetto in pacchetti di lavoro |
| **Pacchetto di lavoro** | Un raggruppamento logico di attività all'interno di un calendario Gantt con proprie date di inizio/fine e percentuale di completamento |
| **Suggerimento AI** | Una descrizione di card auto-generata prodotta combinando risultati di ricerca web con un Large Language Model (LLM) |
