# Registro dei Rischi

Il **Registro dei Rischi** cattura i rischi dell'architettura lungo l'intero ciclo di vita — dall'identificazione alla mitigazione, dalla valutazione residua al monitoraggio e alla chiusura (o all'accettazione formale). Vive come la scheda **Rischio** del [modulo GRC](grc.md) a `/grc?tab=risk`.

## Allineamento a TOGAF

Il registro implementa il processo di gestione dei rischi di architettura della **Fase G del TOGAF ADM — Governance dell'implementazione** (TOGAF 10 §27):

| Passo TOGAF | Cosa catturate |
|-------------|----------------|
| Classificazione del rischio | `Categoria` (security, compliance, operational, technology, financial, reputational, strategic) |
| Identificazione del rischio | `Titolo`, `Descrizione`, `Origine` (manuale o promossa da una evidenza TurboLens) |
| Valutazione iniziale | `Probabilità iniziale × Impatto iniziale → Livello iniziale` (derivato automaticamente) |
| Mitigazione | Una o più **attività di mitigazione** — voci di lavoro assegnate, una tantum o ricorrenti (vedi [Attività di mitigazione](#mitigation-tasks) sotto). Il rischio porta inoltre un `Proprietario` e una `Data obiettivo di risoluzione`. |
| Valutazione residua | `Probabilità residua × Impatto residuo → Livello residuo` (modificabile una volta pianificata la mitigazione). Resta una valutazione **manuale** — il completamento di un'attività non la modifica automaticamente. La pagina di dettaglio mostra accanto al blocco residuo un riepilogo «X/Y aperte · Z in ritardo» come contesto per il giudizio umano (allineato a ISO 31000). |
| Monitoraggio / accettazione | Flusso di `Stato`: identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed (con un ramo laterale `accepted` che richiede una motivazione esplicita) |

## Creare un rischio

Tre percorsi confluiscono nello stesso dialogo **Crea rischio** — ciascuna variante precompila campi diversi in modo che possiate modificare e inviare:

Tutte e tre le varianti includono i campi **Proprietario**, **Categoria** e **Data obiettivo di risoluzione**, così da assegnare responsabilità già in fase di creazione — senza riaprire il rischio.

La promozione è **idempotente** — una volta promossa un'evidenza, il suo pulsante diventa **Apri rischio R-000123** e porta direttamente alla pagina di dettaglio del rischio.

## Proprietà → Todo + notifica

Assegnare un **proprietario** (in fase di creazione o successivamente) genera automaticamente:

- Un **Todo di sistema** nella pagina Todos del proprietario. La descrizione è `[Risk R-000123] <titolo>`, la scadenza riflette la data obiettivo del rischio e il link torna al dettaglio del rischio. Il Todo è marcato **completato** automaticamente quando il rischio raggiunge `mitigated` / `monitoring` / `accepted` / `closed`.
- Una **notifica nella campanella** (`risk_assigned`) — visibile nel menu a tendina della campanella e nella pagina notifiche, con e-mail opzionale se l'utente ha abilitato la preferenza. Anche l'autoassegnazione fa suonare la campanella, così la traccia è coerente fra flussi di team e personali.

Rimuovere o riassegnare il proprietario mantiene il Todo sincronizzato — il vecchio viene rimosso / riassegnato.

La stessa logica scatta indipendentemente per **ogni attività di mitigazione** del rischio, in modo che un collaboratore veda solo il lavoro che gli compete — vedi [Attività di mitigazione](#mitigation-tasks) sotto.

## Collegare rischi alle card

I rischi sono **molti-a-molti** con le card. Un rischio può interessare più Applicazioni o Componenti IT, e una card può avere più rischi collegati:

- Dalla pagina di dettaglio del rischio: pannello **Schede interessate** → scegliete una scheda e aggiungetela. Cliccate una `×` per scollegare. Il selettore mostra subito un elenco navigabile (senza dover digitare), carica altre schede scorrendo e nasconde quelle già collegate.
- Da qualsiasi pagina di dettaglio card: la nuova scheda **Rischi** elenca ogni rischio collegato a quella card, con un ritorno in un clic al registro.

Le schede collegate sono **raggruppate per tipo di scheda**, ordinate alfabeticamente all'interno di ogni gruppo e colorate con il colore proprio del tipo, così un rischio che tocca una dozzina di schede di più tipi resta leggibile a colpo d'occhio. Lo stesso ordinamento e gli stessi colori valgono per la colonna **Schede** della griglia del registro, dove ogni scheda appare come chip nel colore del suo tipo — il tooltip della cella elenca l'insieme completo sotto le intestazioni di tipo.

## Attività di mitigazione {: #mitigation-tasks }

La mitigazione è catturata come **voci di lavoro assegnate**, non come testo libero. Sulla pagina di dettaglio del rischio il pannello **Attività di mitigazione** sostituisce il vecchio campo singolo «piano di mitigazione» — ogni riga è un'attività reale con proprio proprietario, scadenza, cronologia e (opzionalmente) regola di ricorrenza.

### Una tantum vs. ricorrente

Un'attività di mitigazione è **una tantum** per impostazione predefinita — adatta a «Distribuire MFA», «Firmare SCC aggiornate» o qualsiasi lavoro a forma di progetto. Attivate **Si ripete** nel dialogo dell'attività e ottenete una **revisione di controllo ricorrente**: ad es. «Ri-attestare la documentazione di trasferimento transfrontaliero ogni 12 mesi», «Eseguire il tabletop di risposta agli incidenti OT ogni 3 mesi», «Auditare le credenziali Jenkins ogni settimana».

Le attività ricorrenti accumulano un **ciclo** (`occurrence`) per periodo. Il ciclo successivo viene creato automaticamente alla chiusura del corrente — con aritmetica di calendario corretta: un'attività mensile con scadenza 31 gennaio passa al 28 febbraio, non al 3 marzo.

### La finestra di preavviso

Lo scopo di una revisione di controllo ricorrente è che la persona responsabile sia richiamata **poco prima della scadenza** — non nel momento in cui si è chiuso il ciclo precedente. Per questo ogni attività ricorrente ha un **Tempo di preavviso** (giorni) — quanti giorni prima di `due_date` il ciclo si attiva e atterra sulla lista `/todos` della persona assegnata.

Ogni ciclo attraversa tre stati visibili:

| Stato | Significato | Visibile su /todos? |
|-------|-------------|---------------------|
| **Programmata** | Il prossimo ciclo esiste per la pista di audit («prossima revisione: scade il 15/11/2026») ma è dormiente. Oggi è ancora fuori dalla finestra di preavviso. | No |
| **Aperta** | La finestra di preavviso si è aperta. Un Todo di sistema `[Risk R-000123] <titolo attività>` appare sulla lista della persona assegnata; viene emessa una notifica `task_assigned`. | Sì (scheda Aperte) |
| **Completata** / **Saltata** | La persona assegnata ha chiuso il ciclo. Il Todo passa a `done` e resta nella scheda **Completate** come record storico. | Sì (scheda Completate) |

Il dialogo suggerisce un preavviso sensato per unità di ricorrenza (1 giorno giornaliero, 2 settimanale, 7 mensile, 14 annuale — limitato a metà del ciclo, così la finestra non sovrappone mai il ciclo precedente). Il suggerimento si aggiorna al cambio di unità o intervallo, finché non modificate voi il campo.

Una volta al giorno alle **03:00 UTC** un processo in background scansiona tutti i cicli programmati e promuove quelli la cui finestra si è aperta. Volete iniziare una revisione prima? Cliccate **Attiva ora** (icona fulmine sulla riga dell'attività) per portare un ciclo programmato a aperto immediatamente — stessa logica di Todo e notifica, senza attesa.

### Cronologia di audit per ciclo

Cliccate sulla freccia di espansione di una riga di attività per vedere la cronologia completa dei cicli. Ogni occorrenza registra:

- La **data di scadenza obiettivo** al momento della pianificazione.
- Chi era **assegnato** all'apertura del ciclo (`assigned_owner_id`), così le revisioni storiche mantengono il proprietario originale anche se il ruolo cambia in seguito.
- Per i cicli chiusi: chi l'ha **completato** (`completed_by`), il timestamp, lo **snapshot proprietario-alla-chiusura** (può differire dall'assegnato se la rotazione è avvenuta a metà ciclo) e qualsiasi nota libera di chiusura.
- Per i cicli attivati: il **timestamp di attivazione** (in modo che l'audit possa verificare che la promozione giornaliera sia avvenuta nel giorno corretto).

Questo sopravvive pulitamente ad anni di rotazione del proprietario — la risposta di audit a «Chi ha firmato la revisione di gennaio 2024?» è a un clic dall'attività e non si perde nelle riallocazioni di responsabilità.

### Permessi e persone assegnate

- **Aggiungere / modificare / eliminare attività** — richiede `risks.manage` (admin / bpm_admin / member per default).
- **Completare il ciclo aperto** — `risks.manage` **oppure** l'utente attualmente assegnato a quel ciclo. Così un Viewer assegnato a una revisione di controllo può chiudere il proprio ciclo senza dover scalare.
- **Saltare un ciclo / Attiva ora** — richiedono sempre `risks.manage`. Saltare fa avanzare la ricorrenza senza pretendere che il lavoro sia stato svolto; attivare anticipa un ciclo programmato ed è un'azione di pianificazione.

### Promozione da un riscontro di conformità TurboLens

Quando cliccate **Crea rischio** su un riscontro non conforme (vedi [TurboLens](turbolens.md#promote-a-finding-to-the-risk-register)), il nuovo rischio riceve inoltre un'**attività di mitigazione una tantum** preimpostata dal testo di rimediazione del riscontro — l'analisi del gap diventa così immediatamente lavoro assegnato e azionabile.

### Esportazione {: #export }

Il pulsante **Esporta** del Registro dei Rischi scrive un `.xlsx` a due fogli: il foglio 1 è la griglia di rischi filtrata, il foglio 2 una riga per ciclo di ciascuna attività di ciascun rischio nello stesso filtro, inclusi tempo di preavviso e timestamp di attivazione. Usatelo per dossier di audit o per stakeholder senza accesso a Turbo EA. Ogni riga di attività nel pannello di dettaglio dispone inoltre del proprio pulsante **Esporta cronologia** per una cartella di lavoro per attività.

### Importazione {: #import }

Il pulsante **Importa** accanto a «Esporta» carica rischi in blocco da un file `.xlsx`. Fai clic su **Scarica modello** per ottenere una cartella di lavoro iniziale con le intestazioni corrette, inserisci un rischio per riga e caricala. Una riga il cui `reference` corrisponde a un rischio esistente viene **saltata** (l'importatore non aggiorna mai i rischi esistenti), così la reimportazione di un registro esportato in precedenza è idempotente; ogni altra riga crea un rischio **completamente nuovo** con un riferimento `R-NNNNNN` generato automaticamente. L'anteprima indica quante righe verranno saltate prima della conferma.

Colonne riconosciute: `title` (obbligatorio), `description`, `category`, `initial_probability`, `initial_impact`, `residual_probability`, `residual_impact`, `status`, `owner_email`, `target_resolution_date` (`YYYY-MM-DD`) e `cards` (nomi delle schede separati da punto e virgola). I responsabili vengono abbinati tramite e-mail e le schede tramite nome esatto, **per quanto possibile** — tutto ciò che non può essere abbinato viene saltato con un avviso non bloccante e il rischio viene comunque importato. Prima che venga scritto qualcosa, viene mostrata un'anteprima con quante righe verranno create, quali contengono errori e gli eventuali avvisi; nulla viene salvato finché non confermi. Richiede l'autorizzazione `risks.manage`.

## Matrice dei rischi

Sia la Panoramica Sicurezza di TurboLens sia la pagina del Registro dei Rischi mostrano una heatmap probabilità × impatto 4×4. Le celle sono **cliccabili** — cliccate su una per filtrare la lista sottostante su quel bucket, cliccate di nuovo (o sulla × del chip) per pulire. Nel Registro dei Rischi potete alternare la matrice fra le viste **Iniziale** e **Residua** per vedere visivamente il progresso della mitigazione.

## Griglia del registro

Il registro è un AG Grid che segue gli standard della pagina [Inventario](inventory.md): colonne ordinabili, filtrabili e ridimensionabili con preferenze utente persistite (colonne visibili, ordinamento, stato della sidebar). Il pulsante **+ Nuovo rischio** in barra strumenti apre il dialogo di creazione manuale. Il pulsante **Esporta** della barra strumenti scrive un `.xlsx` a due fogli con la griglia di rischi filtrata nel foglio 1 e una riga per ciclo di attività di mitigazione nel foglio 2 — vedi [Attività di mitigazione → Esportazione](#export) per il formato delle colonne.

### Filtrare per schede interessate

La barra laterale dei filtri a sinistra ha una sezione **Schede interessate** che risponde alle domande di paesaggio che il filtro di colonna non copre:

- **Schede** — scegliete una o più schede specifiche per vedere ogni rischio che interessa *una qualsiasi* di esse («mostra tutti i rischi che interessano le applicazioni A, B e C»). L'elenco offre ogni scheda collegata ad almeno un rischio, ricercabile per nome.
- **Tipo di scheda** — spuntate uno o più tipi per vedere ogni rischio che tocca *una qualsiasi* scheda di quei tipi («mostra tutti i rischi che interessano un'applicazione»), senza nominare singole schede.

Ogni elenco soddisfa **una qualsiasi** delle proprie selezioni; i due elenchi si combinano con **e**. Spuntare `Application` e scegliere la scheda *Payments Gateway* restituisce quindi i rischi che interessano Payments Gateway **e** toccano almeno un'applicazione.

Come ogni altro filtro della barra laterale, questi restringono l'intera pagina: i riquadri KPI, la matrice 4×4, la griglia e entrambi i fogli dell'esportazione `.xlsx` seguono la selezione attiva.

## Propagazione Rischio ↔ Riscontro

Se un Rischio è stato [promosso da un riscontro TurboLens](turbolens.md#promote-a-finding-to-the-risk-register), i cambi di stato fluiscono **in entrambe le direzioni**:

- Il riscontro porta un back-link **Apri rischio R-000123** dal momento della promozione (l'azione è idempotente — un nuovo click naviga al rischio esistente invece di crearne un duplicato).
- Quando il Rischio raggiunge `mitigated` / `monitoring` / `closed` / `accepted` (o viene eliminato), il motore di back-propagation transiziona automaticamente ogni riscontro di conformità collegato al valore corrispondente (`mitigated` / `verified` / `accepted` / `in_review`). La motivazione di accettazione catturata sul Rischio viene rispecchiata nella nota di revisione del riscontro così che la pista di audit resti coerente.

Questo mantiene allineati il Registro dei Rischi (vista governance) e la griglia di Conformità (vista operativa) senza manutenzione manuale.

## Flusso di stato

La pagina di dettaglio mostra sempre un unico pulsante primario **Passo successivo** più una piccola riga di azioni laterali, così che il percorso sequenziale sia ovvio ma le vie di uscita di governance restino a un clic:

| Stato attuale | Passo successivo (pulsante primario) | Azioni laterali |
|---|---|---|
| identified | Avvia analisi | Accetta rischio |
| analysed | Pianifica mitigazione | Accetta rischio |
| mitigation_planned | Avvia mitigazione | Accetta rischio |
| in_progress | Segna come mitigato | Accetta rischio |
| mitigated | Avvia monitoraggio | Riprendi mitigazione · Chiudi senza monitoraggio |
| monitoring | Chiudi | Riprendi mitigazione · Accetta rischio |
| accepted | — | Riapri · Chiudi |
| closed | — | Riapri |

Grafo completo delle transizioni (forzato lato server):

```
identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed
       │           │             │                │            ▲           ▲
       └───────────┴─────────────┴────────────────┴──── accepted (motivazione richiesta)
                                                              │
                              reopen → in_progress ◄──────────┘
```

- **Accettare** un rischio richiede una motivazione di accettazione. Utente, timestamp e motivazione vengono registrati sul record.
- **Riaprire** un rischio `accepted` / `closed` riporta a `in_progress`. Lo stato `mitigated` consente anche una «Riprendi mitigazione» manuale senza bisogno di una riapertura completa.

## Autorizzazioni

| Autorizzazione | Chi la riceve per impostazione predefinita |
|----------------|-------------------------------------------|
| `risks.view` | admin, bpm_admin, member, viewer |
| `risks.manage` | admin, bpm_admin, member |

I viewer possono vedere il registro e i rischi sulle card ma non possono creare, modificare o eliminare.
