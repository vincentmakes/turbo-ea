# La prima analisi: Armonizzazione applicativa

Questo è il momento in cui si raccolgono i frutti. Si dispone di un inventario applicativo, di una mappa delle capability e di un campo di disposizione TIME. Ora li si collega e si producono i due report che giustificano l'intero programma EA davanti a un CIO:

- Un **Portfolio Report** che mostra ogni applicazione dimensionata per costo, colorata per disposizione TIME.
- Una **Capability Heatmap** che mostra dove c'è ridondanza (più app per capability) e fragilità (singola app per capability).

## Passo 1 — Mappare le applicazioni sulle capability

La singola relazione più preziosa in tutto il metamodello è **Application → Business Capability** (`supports` / `supported by`). La si imposterà per ogni applicazione in ambito.

### Percorso bulk: modalità edit dell'inventario

1. Andare in **Inventario**, filtrare per Type = `Application`.
2. Assicurarsi che la colonna relazione **Business Capability** sia visibile (tab Colonne → Relazioni).
3. Attivare la modalità **Grid Edit** nella toolbar.
4. Cliccare sulla cella della capability su ogni riga e scegliere una o più capability.
5. Salvare.

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

## Passo 2 — Scegliere come compilare il TIME Model

Il campo integrato **TIME Model** su Application (`timeModel`, required, quattro opzioni: `tolerate` / `invest` / `migrate` / `eliminate`) è la colonna decisionale che guida il resto dell'analisi. Esistono due modi per popolarlo.

### Opzione A — Inserimento manuale del TIME (consigliato per il primo passaggio)

Con l'Application Owner in un workshop di un'ora si possono in genere classificare 30–50 applicazioni:

- **Tollerare** — funziona, basso costo, non un differenziatore strategico. Lasciar stare.
- **Investire** — strategica, area di crescita, finanziare miglioramenti.
- **Migrare** — sostituire o spostare su una nuova piattaforma entro l'orizzonte di pianificazione.
- **Eliminare** — duplicata, end-of-life, dismettere.

Usare la modalità **Grid Edit** dell'inventario con la colonna **TIME Model** visibile per catturare le decisioni in velocità.

### Opzione B — TIME calcolato tramite formula

Anziché chiedere a ciascun Application Owner di impostare TIME manualmente, si può derivare `timeModel` automaticamente dalle due dimensioni di idoneità integrate (`functionalSuitability` × `technicalSuitability`) usando la funzionalità **Calcoli**. È il canonico posizionamento a quattro quadranti di Gartner.

L'esempio funzionante — la formula, la tabella dei quadranti e il pattern ibrido raccomandato — si trova in [Personalizzare il metamodello → Opzione: derivare un campo automaticamente con un Calcolo](customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation). Usarlo come raccomandazione di partenza che gli owner poi validano, non come verdetto.

## Passo 3 — Eseguire il Portfolio Report

1. Andare in **Report → Portfolio**.
2. Configurare gli assi:
    - **Tipo di card**: `Application`
    - **Asse X**: `technicalSuitability` (il campo integrato di idoneità tecnica).
    - **Asse Y**: `functionalSuitability` o `businessValue` (campi integrati di idoneità di business).
    - **Size**: `costTotalAnnual` — maggiore la spesa, maggiore la bolla.
    - **Colore**: `timeModel` — è questo che rende il report pronto per la decisione.
3. Salvare la configurazione come vista nominata ("Portfolio Applicativo — Dominio Vendite") in modo da poterci tornare.

Cosa cercare:

- **Grandi bolle rosse** (candidati Eliminate ad alto costo) — i risparmi più rapidi.
- **Grandi bolle ambra** (candidati Migrate ad alto costo) — le decisioni di trasformazione più rilevanti.
- **Cluster nell'angolo in alto a destra della matrice** che non sono verdi — app strategiche che non stanno ricevendo investimenti.

Riferimento: [Report](../guide/reports.md).

## Passo 4 — Eseguire la Capability Heatmap

1. Andare in **Report → Mappa delle capability**.
2. La heatmap mostra la gerarchia di business capability con intensità del colore delle celle proporzionale al **numero di applicazioni che supportano quella capability**.

Cosa cercare:

- **Celle calde** (molte app per capability) — candidate ridondanze. Il business case più comune per una Razionalizzazione del portfolio applicativo vive qui.
- **Celle fredde** con applicazioni che ci si aspetterebbe — lacune nella mappatura, o capability genuinamente sotto-supportate.
- **Celle bianche** in mezzo a un ramo attivo — applicazioni non mappate, o capability non modellate.

Riferimento: [Report → Mappa delle capability](../guide/reports.md).

## Passo 5 — Presentare e iterare

Si ha ora una vista di portfolio difendibile. Mettere i due report davanti al CIO Vendite (o a chi possiede il proprio ambito) e:

- Confermare le scelte TIME sulle 10 applicazioni a maggior costo.
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
