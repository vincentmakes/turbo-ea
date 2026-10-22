# La prima analisi: Armonizzazione applicativa

Questo è il momento in cui si raccolgono i frutti. Si dispone di un inventario applicativo, di una mappa delle capability e del campo integrato Modello TIME. Ora li si collega e si producono i due report che giustificano l'intero programma EA davanti a un CIO:

- Il report **Portfolio applicazioni**, con ogni applicazione raggruppata per **Criticità aziendale** e colorata in base alla sua disposizione **TIME** (**T**ollerare / **I**nvestire / **M**igrare / **E**liminare).
- La **Mappa delle capacità**, una heatmap che mostra dove c'è ridondanza (più app per capability) e fragilità (singola app per capability).

## Passo 1 — Mappare le applicazioni sulle capability

La singola relazione più preziosa in tutto il metamodello è **Application → Business Capability** (`supporta` / `è supportato da`). La si imposterà per ogni applicazione in ambito.

### Percorso bulk: modalità edit dell'inventario

1. Andare in **Inventario**, filtrare per Type = `Application`.
2. Assicurarsi che la colonna relazione **Business Capability** sia visibile (tab Colonne → Relazioni).
3. Attivare la modalità **Modifica griglia** nella toolbar.
4. Cliccare sulla cella della capability su ogni riga e scegliere una o più capability. Ogni modifica viene salvata non appena la si effettua.

Per 50–200 app, ci vuole un pomeriggio e una tazza di caffè.

### Percorso card per card

Per mappature ad alto giudizio (o quando è coinvolto un workshop con l'Application Owner), aprire ciascuna card Applicazione e usare la sezione **Relazioni**. Si ottiene il picker completo con ricerca, anteprima della gerarchia e la possibilità di impostare attributi della relazione.

### Quante capability per applicazione?

| Numero di mappature | Cosa significa |
|--------------------|----------------|
| **0** | Non mappata — l'inventario è incompleto. Filtrare per queste e sistemare. |
| **1** | Il caso pulito e ideale — questa app supporta esattamente una capability. |
| **2–3** | Va bene — molte app coprono un paio di capability correlate. |
| **4+** | Sospetto — si potrebbe star confondendo "usa dati da" con "supporta". Ricontrollare. |

!!! tip "Buona pratica"
    La mappatura al primo passaggio è veloce e grezza. Il secondo passaggio — fatto con l'Application Owner che rivede — è ciò che rende i dati affidabili. Pianificare entrambi.

## Passo 2 — Valutare criticità e idoneità

Tre campi integrati nella sezione **Valutazione** di ogni card Applicazione alimentano l'analisi. Compilarli con l'Application Owner — in un workshop di un'ora si possono in genere valutare 30–50 applicazioni usando **Modifica griglia** con le tre colonne visibili.

| Campo | Opzioni | A cosa risponde |
|-------|---------|-----------------|
| **Criticità aziendale** | Critico per la missione / Critico per il business / Operativo / Amministrativo | Quanto dipende il business da questa app? |
| **Idoneità funzionale** | Perfetto / Appropriato / Insufficiente / Inadeguato | Quanto bene fa ciò di cui il business ha bisogno? |
| **Idoneità tecnica** | Pienamente appropriato / Adeguato / Inadeguato / Inappropriato | Quanto è sana la tecnologia sottostante? |

La Criticità aziendale raggruppa il report del Passo 4. Le due valutazioni di idoneità sono ciò che legge il calcolo TIME del Passo 3.

Modificare questi campi su una card approvata porta il suo stato di approvazione a **Interrotto**. Riapprovare le card in blocco dopo il workshop.

## Passo 3 — Derivare il TIME con un campo calcolato

Il campo integrato **Modello TIME** su Application (`timeModel`, quattro opzioni: `tolerate` / `invest` / `migrate` / `eliminate`) è la colonna decisionale che guida il resto dell'analisi. Anziché chiedere a ogni Application Owner di sceglierne una, la si deriva dalle due valutazioni di idoneità con un **calcolo** — il classico posizionamento di Gartner:

| | Idoneità tecnica alta | Idoneità tecnica bassa |
|---|---|---|
| **Idoneità funzionale alta** | **Investire** | **Migrare** |
| **Idoneità funzionale bassa** | **Tollerare** | **Eliminare** |

1. Andare in **Admin → Metamodello → Calcoli** e cliccare **Nuovo calcolo**.
2. Impostare **Tipo di scheda destinazione** = `Application` e **Campo destinazione** = **Modello TIME**.
3. Incollare la formula da [Personalizzare il metamodello → Opzione: derivare un campo automaticamente con un Calcolo](customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation). Usa i campi di idoneità integrati, quindi non serve alcun campo personalizzato.
4. Cliccare **Valida**, salvare, poi usare **Prova** su alcune applicazioni che si conoscono bene per verificare il risultato.
5. Attivare il calcolo (**Attivo**) nell'elenco, poi cliccare **Ricalcola tutto** sulla sua riga per compilare il Modello TIME su ogni applicazione.

Da quel momento il Modello TIME viene ricalcolato ogni volta che un'applicazione viene salvata, mostra un badge **calcolato** e non può più essere modificato a mano. Un'applicazione a cui manca una delle due valutazioni di idoneità non riceve alcun valore TIME — è voluto: mostra quali valutazioni mancano ancora.

!!! warning "Da evitare"
    Un TIME calcolato è un'**ipotesi di partenza**, non un verdetto. Rivedere i risultati con gli Application Owner prima di presentarli. Dove una decisione deve prevalere sulla formula, disattivare il calcolo (l'interruttore **Attivo**) e modificare il Modello TIME a mano in **Modifica griglia**.

Riferimento: [Admin → Calcoli](../admin/calculations.md).

## Passo 4 — Eseguire il report Portfolio applicazioni

1. Andare in **Report → Portfolio applicazioni**.
2. Impostare **Raggruppa per** = **Criticità aziendale**.
3. Impostare **Colora applicazioni per** = **Modello TIME**.
4. Cliccare l'icona del segnalibro (**Salva report**) e dare un nome alla vista ("Portfolio Applicativo — Dominio Vendite"). La si ritrova in **Report → Report salvati**.

Ogni livello di Criticità aziendale diventa un riquadro, con un chip per applicazione colorato in base alla sua disposizione TIME e una barra che mostra la composizione. Per concentrarsi su un dominio, usare il filtro **Correlato per** con le capability del proprio ambito.

Cosa cercare:

- **App «Critico per la missione» e «Critico per il business» marcate Migrare** — le decisioni di modernizzazione più rilevanti. Vengono per prime.
- **App «Amministrativo» e «Operativo» marcate Eliminare o Migrare** — le vittorie di semplificazione più rapide: dismetterle o consolidarle su un'altra piattaforma.
- **App «Critico per la missione» marcate Investire** — verificare che stiano davvero ricevendo l'investimento.
- **App senza colore** (TIME *Non impostato*) — manca una delle due valutazioni di idoneità. Tornare al Passo 2.

Riferimento: [Report → Report Portfolio](../guide/reports.md#report-portfolio).

## Passo 5 — Eseguire la Mappa delle capacità

1. Andare in **Report → Mappa delle capacità**.
2. Lasciare la **Metrica heatmap** su **Numero applicazioni**: l'intensità del colore delle celle è proporzionale al numero di applicazioni che supportano quella capability.
3. Facoltativo: attivare **Mostra applicazioni** e impostare **Colora applicazioni per** = **Modello TIME** per vedere la disposizione TIME delle app all'interno di ogni capability.

Cosa cercare:

- **Celle calde** (molte app per capability) — candidate ridondanze. Il business case più comune per una Razionalizzazione del portfolio applicativo vive qui.
- **Celle fredde** con applicazioni che ci si aspetterebbe — lacune nella mappatura, o capability genuinamente sotto-supportate.
- **Celle bianche** in mezzo a un ramo attivo — applicazioni non mappate, o capability non modellate.

Riferimento: [Report → Mappa delle capability](../guide/reports.md#mappa-delle-capability).

## Passo 6 — Presentare e iterare

Si ha ora una vista di portfolio difendibile. Mettere i due report davanti al CIO Vendite (o a chi possiede il proprio ambito) e:

- Confermare le scelte TIME sulle applicazioni «Critico per la missione» e «Critico per il business».
- Identificare le 3 celle più calde della heatmap come candidati progetti di razionalizzazione.
- Catturare i follow-up come commenti o todo sulle applicazioni stesse — Turbo EA li traccia per ogni card.

Tutto qui. Si ha una pratica EA funzionante su Turbo EA.

## Cosa fare dopo

Una volta che il portfolio applicativo è vivo e affidabile, questi diventano passi successivi ad alto valore. Nessuno di essi è utile prima di avere un inventario popolato — ed è per questo che questa guida li ha deliberatamente rinviati.

| Modulo | Quando aprirlo | Dove trovarlo |
|--------|----------------|---------------|
| **Risk Register** | Quando si è pronti a tracciare rischi di architettura su applicazioni e capability (TOGAF Fase G). | [Risk Register](../guide/risks.md) |
| **GRC / Compliance** | Quando serve mappare applicazioni e capability su normative (GDPR, NIS2, EU AI Act, DORA, SOC 2, ISO 27001). | [GRC](../guide/grc.md) |
| **PPM** | Quando le decisioni di razionalizzazione diventano progetti con budget, schedulazioni e status report. | [PPM](../guide/ppm.md) |
| **TurboLens AI** | Quando ci sono abbastanza card perché l'AI trovi duplicati di fornitori, candidati alla modernizzazione e raccomandazioni di architettura. | [TurboLens](../guide/turbolens.md) |
| **BPM** | Quando si è pronti a modellare i processi che stanno sopra le applicazioni. | [BPM](../guide/bpm.md) |
| **Diagrammi** | Quando servono diagrammi di architettura in forma libera che restino sincronizzati con l'inventario. | [Diagrammi](../guide/diagrams.md) |
| **EA Delivery** | Quando si iniziano a produrre Statement of Architecture Work e Architecture Decision Record in stile TOGAF. | [EA Delivery](../guide/delivery.md) |

Benvenuti in Turbo EA.
