# ArchLens AI Intelligence

Il modulo **ArchLens** fornisce un'analisi basata su intelligenza artificiale del panorama della tua architettura enterprise. Utilizza il provider AI configurato per eseguire analisi dei fornitori, rilevamento di duplicati, valutazione della modernizzazione e raccomandazioni architetturali.

!!! note
    ArchLens richiede un provider AI commerciale (Anthropic Claude, OpenAI, DeepSeek o Google Gemini) configurato nelle [Impostazioni AI](../admin/ai.md). Il modulo è automaticamente disponibile quando l'AI è configurata.

!!! info "Crediti"
    ArchLens è basato sul progetto open-source [ArchLens](https://github.com/vinod-ea/archlens) di [Vinod](https://github.com/vinod-ea), rilasciato sotto la licenza MIT. La logica di analisi è stata portata da Node.js a Python e integrata nativamente in Turbo EA.

## Panoramica

La panoramica di ArchLens offre una visione immediata dell'analisi del tuo panorama.

![Panoramica ArchLens](../assets/img/it/48_archlens_panoramica.png)

| Indicatore | Descrizione |
|------------|-------------|
| **Card totali** | Numero di card attive nel tuo portfolio |
| **Qualità media** | Punteggio medio di qualità dei dati su tutte le card |
| **Fornitori** | Numero di fornitori tecnologici analizzati |
| **Cluster di duplicati** | Numero di gruppi di duplicati identificati |
| **Modernizzazioni** | Numero di opportunità di modernizzazione trovate |
| **Costo annuale** | Costo annuale totale su tutte le card |

La panoramica mostra inoltre:

- **Card per tipo** — Ripartizione del numero di card per tipo
- **Distribuzione della qualità dei dati** — Card raggruppate nei livelli Bronze (<50%), Silver (50–80%) e Gold (>80%)
- **Principali problemi di qualità** — Card con i punteggi di qualità dei dati più bassi, con collegamenti diretti a ciascuna card

## Analisi dei fornitori

L'analisi dei fornitori utilizza l'AI per classificare i tuoi fornitori tecnologici in oltre 45 categorie di settore (ad es. CRM, ERP, Cloud Infrastructure, Security).

![Analisi dei fornitori](../assets/img/it/49_archlens_fornitori.png)

**Come utilizzare:**

1. Vai su **ArchLens > Fornitori**
2. Fai clic su **Esegui analisi**
3. L'AI elabora il tuo portfolio di fornitori in batch, classificando ciascun fornitore con una motivazione
4. I risultati mostrano una ripartizione per categoria e una tabella dettagliata dei fornitori

Ogni voce fornitore include la categoria, la sottocategoria, il numero di applicazioni associate, il costo annuale totale e la motivazione dell'AI per la classificazione. Passa dalla visualizzazione a griglia a quella a tabella utilizzando il selettore di visualizzazione.

## Risoluzione dei fornitori

La risoluzione dei fornitori costruisce una gerarchia canonica dei fornitori risolvendo gli alias e identificando le relazioni genitore-figlio.

![Risoluzione dei fornitori](../assets/img/it/50_archlens_risoluzione.png)

**Come utilizzare:**

1. Vai su **ArchLens > Risoluzione**
2. Fai clic su **Risolvi fornitori**
3. L'AI identifica gli alias dei fornitori (ad es. «MSFT» = «Microsoft»), le società madri e i raggruppamenti di prodotti
4. I risultati mostrano la gerarchia risolta con punteggi di affidabilità

La gerarchia organizza i fornitori in quattro livelli: fornitore, prodotto, piattaforma e modulo. Ogni voce mostra il numero di applicazioni e componenti IT collegati, il costo totale e una percentuale di affidabilità.

## Rilevamento dei duplicati

Il rilevamento dei duplicati identifica le sovrapposizioni funzionali nel tuo portfolio — card che svolgono la stessa funzione aziendale o una simile.

![Rilevamento dei duplicati](../assets/img/it/51_archlens_duplicati.png)

**Come utilizzare:**

1. Vai su **ArchLens > Duplicati**
2. Fai clic su **Rileva duplicati**
3. L'AI analizza le card di tipo Application, IT Component e Interface in batch
4. I risultati mostrano cluster di potenziali duplicati con evidenze e raccomandazioni

Per ciascun cluster è possibile:

- **Confermare** — Contrassegnare il duplicato come confermato per un follow-up
- **Investigare** — Segnalare per ulteriori indagini
- **Ignorare** — Ignorare se non si tratta di un vero duplicato

## Valutazione della modernizzazione

La valutazione della modernizzazione analizza le card per individuare opportunità di aggiornamento in base alle tendenze tecnologiche attuali.

**Come utilizzare:**

1. Vai su **ArchLens > Duplicati** (scheda Modernizzazione)
2. Seleziona un tipo di card di destinazione (Application, IT Component o Interface)
3. Fai clic su **Valuta modernizzazione**
4. I risultati mostrano ciascuna card con tipo di modernizzazione, raccomandazione, livello di impegno (basso/medio/alto) e priorità (bassa/media/alta/critica)

I risultati sono raggruppati per priorità, così puoi concentrarti prima sulle opportunità di modernizzazione più impattanti.

## Architecture AI

L'Architecture AI è una procedura guidata in 5 passaggi che genera raccomandazioni architetturali basate sul tuo panorama esistente. Collega i tuoi obiettivi aziendali e le tue capacità a proposte di soluzione concrete, analisi dei gap, mappatura delle dipendenze e un diagramma dell'architettura target.

![Architecture AI](../assets/img/it/52_archlens_architetto.png)

Un indicatore di avanzamento nella parte superiore tiene traccia del tuo progresso attraverso le cinque fasi: Requisiti, Business Fit, Technical Fit, Soluzione e Architettura target. Il tuo progresso viene salvato automaticamente nella sessione del browser, così puoi navigare altrove e tornare senza perdere il lavoro. Fai clic su **Nuova valutazione** per avviare un'analisi completamente nuova in qualsiasi momento.

### Passaggio 1: Requisiti

Inserisci il tuo requisito aziendale in linguaggio naturale (ad es. «Abbiamo bisogno di un portale self-service per i clienti»). Quindi:

- **Seleziona obiettivi aziendali** — Scegli una o più card Objective esistenti dal menu a tendina con completamento automatico. Questo ancora l'analisi dell'AI ai tuoi obiettivi strategici. È richiesto almeno un obiettivo.
- **Seleziona Business Capability** (facoltativo) — Scegli card Business Capability esistenti o digita nuovi nomi di capacità. Le nuove capacità appaiono come chip blu con l'etichetta «NUOVA: nome». Questo aiuta l'AI a concentrarsi su aree di capacità specifiche.

Fai clic su **Genera domande** per procedere.

### Passaggio 2: Business Fit (Fase 1)

L'AI genera domande di chiarimento aziendale personalizzate in base al tuo requisito e agli obiettivi selezionati. Le domande sono di diversi tipi:

- **Testo** — Campi di risposta libera
- **Scelta singola** — Fai clic su un chip opzione per selezionarlo
- **Scelta multipla** — Fai clic su più chip opzione; puoi anche digitare una risposta personalizzata e premere Invio

Ogni domanda può includere un contesto che spiega perché l'AI la pone (nota «Impatto»). Rispondi a tutte le domande e fai clic su **Invia** per procedere alla Fase 2.

### Passaggio 3: Technical Fit (Fase 2)

L'AI genera domande di approfondimento tecnico basate sulle risposte della Fase 1. Queste possono includere categorie NFR (requisiti non funzionali) come prestazioni, sicurezza o scalabilità. Rispondi a tutte le domande e fai clic su **Analizza capacità** per generare le opzioni di soluzione.

### Passaggio 4: Soluzione (Fase 3)

Questo passaggio comprende tre sotto-fasi:

#### 3a: Opzioni di soluzione

L'AI genera più opzioni di soluzione, ciascuna presentata come una card con:

| Elemento | Descrizione |
|----------|-------------|
| **Approccio** | Acquistare, Costruire, Estendere o Riutilizzare — chip con codice colore |
| **Riepilogo** | Breve descrizione dell'approccio |
| **Pro e contro** | Principali vantaggi e svantaggi |
| **Stime** | Costo, durata e complessità stimati |
| **Anteprima impatto** | Nuovi componenti, componenti modificati, componenti ritirati e nuove integrazioni che questa opzione introdurrebbe |

Fai clic su **Seleziona** sull'opzione che desideri perseguire.

#### 3b: Analisi dei gap

Dopo aver selezionato un'opzione, l'AI identifica i gap di capacità nel tuo panorama attuale. Ogni gap mostra:

- **Nome della capacità** con livello di urgenza (critico/alto/medio)
- **Descrizione dell'impatto** che spiega perché questo gap è rilevante
- **Raccomandazioni di mercato** — Raccomandazioni di prodotti classificate (oro n.1, argento n.2, bronzo n.3) con fornitore, motivazione, pro/contro, costo stimato e impegno di integrazione

Seleziona i prodotti che desideri includere facendo clic sulle card di raccomandazione (appaiono le caselle di controllo). Fai clic su **Analizza dipendenze** per procedere.

#### 3c: Analisi delle dipendenze

Dopo aver selezionato i prodotti, l'AI identifica infrastrutture, piattaforme o dipendenze middleware aggiuntive richieste dalle tue selezioni. Ogni dipendenza mostra:

- **Necessità** con livello di urgenza
- **Motivazione** che spiega perché questa dipendenza è richiesta
- **Opzioni** — Prodotti alternativi per soddisfare la dipendenza, con gli stessi dettagli delle raccomandazioni sui gap

Seleziona le dipendenze e fai clic su **Genera mappa delle capacità** per produrre l'architettura target finale.

### Passaggio 5: Architettura target

L'ultimo passaggio genera una mappatura completa delle capacità:

| Sezione | Descrizione |
|---------|-------------|
| **Riepilogo** | Narrativa di alto livello dell'architettura proposta |
| **Capacità** | Elenco di Business Capability corrispondenti — quelle esistenti (verde) e quelle di nuova proposta (blu) |
| **Card proposte** | Nuove card da creare nel tuo panorama, mostrate con le icone del tipo di card e i sottotipi |
| **Relazioni proposte** | Connessioni tra le card proposte e gli elementi del panorama esistente |
| **Diagramma delle dipendenze** | Diagramma C4 interattivo che mostra i nodi esistenti accanto a quelli proposti (bordi tratteggiati con badge verde «NUOVO»). Esplora l'architettura visivamente con pan e zoom |

Da questo passaggio, puoi fare clic su **Scegli un'alternativa** per tornare indietro e selezionare un'opzione di soluzione diversa, oppure su **Ricomincia** per avviare una valutazione completamente nuova.

## Cronologia delle analisi

Tutte le esecuzioni di analisi sono tracciate in **ArchLens > Cronologia**, con le seguenti informazioni:

![Cronologia delle analisi](../assets/img/it/53_archlens_cronologia.png)

- Tipo di analisi (analisi fornitori, risoluzione fornitori, rilevamento duplicati, modernizzazione, architetto)
- Stato (in esecuzione, completata, fallita)
- Timestamp di inizio e completamento
- Messaggi di errore (se presenti)

## Autorizzazioni

| Autorizzazione | Descrizione |
|----------------|-------------|
| `archlens.view` | Visualizza i risultati delle analisi (concessa ad admin, bpm_admin, member) |
| `archlens.manage` | Avvia le analisi (concessa ad admin) |
