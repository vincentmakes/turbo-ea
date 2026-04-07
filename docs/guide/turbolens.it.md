# TurboLens AI Intelligence

Il modulo **TurboLens** fornisce un'analisi basata su intelligenza artificiale del panorama della tua architettura enterprise. Utilizza il provider AI configurato per eseguire analisi dei fornitori, rilevamento di duplicati, valutazione della modernizzazione e raccomandazioni architetturali.

!!! note
    TurboLens richiede un provider AI commerciale (Anthropic Claude, OpenAI, DeepSeek o Google Gemini) configurato nelle [Impostazioni AI](../admin/ai.md). Il modulo è automaticamente disponibile quando l'AI è configurata.

!!! info "Crediti"
    TurboLens è basato sul progetto open-source [ArchLens](https://github.com/vinod-ea/archlens) di [Vinod](https://github.com/vinod-ea), rilasciato sotto la licenza MIT. La logica di analisi è stata portata da Node.js a Python e integrata nativamente in Turbo EA.

## Panoramica

La panoramica di TurboLens offre una visione immediata dell'analisi del tuo panorama.

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

**Come utilizzare:**

1. Vai su **TurboLens > Fornitori**
2. Fai clic su **Esegui analisi**
3. L'AI elabora il tuo portfolio di fornitori in batch, classificando ciascun fornitore con una motivazione
4. I risultati mostrano una ripartizione per categoria e una tabella dettagliata dei fornitori

Ogni voce fornitore include la categoria, la sottocategoria, il numero di applicazioni associate, il costo annuale totale e la motivazione dell'AI per la classificazione. Passa dalla visualizzazione a griglia a quella a tabella utilizzando il selettore di visualizzazione.

## Risoluzione dei fornitori

La risoluzione dei fornitori costruisce una gerarchia canonica dei fornitori risolvendo gli alias e identificando le relazioni genitore-figlio.

**Come utilizzare:**

1. Vai su **TurboLens > Risoluzione**
2. Fai clic su **Risolvi fornitori**
3. L'AI identifica gli alias dei fornitori (ad es. «MSFT» = «Microsoft»), le società madri e i raggruppamenti di prodotti
4. I risultati mostrano la gerarchia risolta con punteggi di affidabilità

La gerarchia organizza i fornitori in quattro livelli: fornitore, prodotto, piattaforma e modulo. Ogni voce mostra il numero di applicazioni e componenti IT collegati, il costo totale e una percentuale di affidabilità.

## Rilevamento dei duplicati

Il rilevamento dei duplicati identifica le sovrapposizioni funzionali nel tuo portfolio — card che svolgono la stessa funzione aziendale o una simile.

**Come utilizzare:**

1. Vai su **TurboLens > Duplicati**
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

1. Vai su **TurboLens > Duplicati** (scheda Modernizzazione)
2. Seleziona un tipo di card di destinazione (Application, IT Component o Interface)
3. Fai clic su **Valuta modernizzazione**
4. I risultati mostrano ciascuna card con tipo di modernizzazione, raccomandazione, livello di impegno (basso/medio/alto) e priorità (bassa/media/alta/critica)

I risultati sono raggruppati per priorità, così puoi concentrarti prima sulle opportunità di modernizzazione più impattanti.

## Architecture AI

L'Architecture AI è una procedura guidata in 5 passaggi che genera raccomandazioni architetturali basate sul tuo panorama esistente. Collega i tuoi obiettivi aziendali e le tue capacità a proposte di soluzione concrete, analisi dei gap, mappatura delle dipendenze e un diagramma dell'architettura target.

<div style="text-align: center;">
<iframe width="560" height="315" src="https://www.youtube.com/embed/FDneDl0ULsA" title="Panoramica di Architecture AI" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
</div>

Un indicatore di avanzamento nella parte superiore tiene traccia del tuo progresso attraverso le cinque fasi: Requisiti, Business Fit, Technical Fit, Soluzione e Architettura target. Puoi fare clic su qualsiasi passaggio precedentemente raggiunto per tornare indietro e rivedere le fasi precedenti — tutti i dati a valle vengono preservati e vengono cancellati solo quando invii nuovamente una fase. Il tuo progresso viene salvato automaticamente nella sessione del browser, così puoi navigare altrove e tornare senza perdere il lavoro. Puoi anche salvare le valutazioni nel database e riprenderle in seguito (vedi [Salva e riprendi](#salva--riprendi) più avanti). Fai clic su **Nuova valutazione** per avviare un'analisi completamente nuova in qualsiasi momento.

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

Fai clic su **Seleziona** sull'opzione che desideri perseguire. Se torni a questo passaggio dopo aver selezionato un'opzione, l'opzione precedentemente scelta è evidenziata visivamente con un bordo e un badge «Selezionato» per consentirti di identificare facilmente la tua scelta attuale.

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

!!! warning "Valutazione assistita dall'IA"
    Questa valutazione utilizza l'IA per generare raccomandazioni, opzioni di soluzione e un'architettura target. Deve essere eseguita da un professionista IT qualificato (Enterprise Architect, Solution Architect, responsabile IT) in collaborazione con gli stakeholder aziendali. I risultati generati richiedono giudizio professionale e possono contenere imprecisioni. Utilizzare i risultati come punto di partenza per ulteriori discussioni e perfezionamenti.

### Salva e riprendi

Dopo aver esaminato l'architettura target, puoi salvare o confermare il tuo lavoro:

**Salva valutazione** — Salva uno snapshot completo della valutazione (tutte le risposte, le opzioni selezionate, l'analisi dei gap, le dipendenze e l'architettura target) nel database. Le valutazioni salvate appaiono nella scheda **Valutazioni**.

**Riprendi una valutazione salvata** — Le valutazioni non confermate possono essere riaperte nella procedura guidata interattiva con lo stato completamente ripristinato:

- Dalla scheda **Valutazioni**, fai clic sul pulsante **Riprendi** su qualsiasi riga di valutazione salvata
- Dal **Visualizzatore valutazione** in sola lettura, fai clic su **Riprendi** nell'intestazione
- La procedura guidata si ripristina alla fase e allo stato esatti in cui ti eri fermato, incluse tutte le domande generate dall'IA, le tue risposte, le opzioni selezionate e le selezioni dei prodotti
- Puoi continuare da dove ti eri fermato, scegliere un approccio diverso o confermare per creare un'iniziativa
- Salvare di nuovo aggiorna la valutazione esistente (anziché crearne una nuova)

!!! tip "Snapshot completo"
    Una valutazione salvata è uno snapshot completo della tua sessione della procedura guidata. Finché non è stata confermata in un'iniziativa, puoi riprenderla, scegliere un approccio di soluzione diverso e ri-salvarla tutte le volte che desideri.

**Conferma e crea iniziativa** — Converte la proposta architetturale in card reali nel tuo panorama:

- **Nome dell'iniziativa** è precompilato con il titolo dell'opzione di soluzione selezionata (modificabile prima della creazione)
- **Date di inizio/fine** per la tempistica dell'iniziativa
- **Nuove card proposte** con interruttori per includere o escludere singole card e icone di modifica per rinominare le card prima della creazione. Questo elenco include le nuove Business Capability identificate durante la valutazione.
- **Relazioni proposte** con interruttori per includere o escludere
- Un indicatore di avanzamento mostra lo stato di creazione (iniziativa → card → relazioni → ADR)
- In caso di successo, un collegamento apre la nuova card Iniziativa

### Guardrail architetturali

Il sistema garantisce automaticamente l'integrità architetturale:

- Ogni nuova applicazione è collegata ad almeno una Business Capability
- Ogni nuova Business Capability è collegata agli obiettivi di business selezionati
- Le card senza relazioni (orfane) vengono automaticamente rimosse dalla proposta

### Architecture Decision Record

Una bozza di ADR viene automaticamente creata insieme all'iniziativa con:

- **Contesto** dal riepilogo della mappatura delle capacità
- **Decisione** che cattura l'approccio e i prodotti selezionati
- **Alternative considerate** dalle opzioni di soluzione non selezionate

### Cambia approccio

Fai clic su **Scegli un'alternativa** per tornare alle opzioni di soluzione e selezionare un approccio diverso. Tutte le tue risposte della Fase 1 e della Fase 2 vengono preservate — solo i dati a valle (analisi dei gap, dipendenze, architettura target) vengono reimpostati. Dopo aver selezionato una nuova opzione, la procedura guidata ripercorre l'analisi dei gap e l'analisi delle dipendenze. Puoi salvare la valutazione aggiornata o confermare quando sei pronto.

## Cronologia delle analisi

Tutte le esecuzioni di analisi sono tracciate in **TurboLens > Cronologia**, con le seguenti informazioni:

- Tipo di analisi (analisi fornitori, risoluzione fornitori, rilevamento duplicati, modernizzazione, architetto)
- Stato (in esecuzione, completata, fallita)
- Timestamp di inizio e completamento
- Messaggi di errore (se presenti)

## Autorizzazioni

| Autorizzazione | Descrizione |
|----------------|-------------|
| `turbolens.view` | Visualizza i risultati delle analisi (concessa ad admin, bpm_admin, member) |
| `turbolens.manage` | Avvia le analisi (concessa ad admin) |
