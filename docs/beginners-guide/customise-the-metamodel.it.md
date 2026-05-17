# Personalizzare il metamodello — con leggerezza

Il metamodello di Turbo EA è completamente **configurabile da amministratore** — ogni tipo di card, campo, sottotipo, relazione e ruolo stakeholder è dato, non codice. Si sarà tentati di ridisegnarlo. **Non farlo.**

I team che hanno successo personalizzano il metamodello **solo quando i campi di default non possono rispondere alla loro domanda**. I team che falliscono passano il primo mese a rinominare `Application` in `Solution`, aggiungendo 30 campi personalizzati, senza mai arrivare a un report funzionante.

## Cosa è già nel metamodello

Prima di aggiungere qualcosa, conoscere ciò di cui già si dispone. Il tipo di card **Application** integrato include questi campi out of the box (tra gli altri):

| Campo integrato | Tipo | A cosa serve |
|-----------------|------|--------------|
| `businessCriticality` | `single_select` | Mission-critical / Important / Useful / Marginal |
| `functionalSuitability` | `single_select` | Perfect / Appropriate / Insufficient / Unreasonable |
| `technicalSuitability` | `single_select` | Fully Appropriate / Adequate / Unreasonable / Inappropriate |
| `timeModel` | `single_select` (required) | **Tolerate / Invest / Migrate / Eliminate** — la canonica disposizione TIME di Gartner |
| `riskLevel` | `single_select` | Low / Medium / High / Critical |
| `businessValue` | `single_select` | Guida l'asse Y del Portfolio Report |
| `costTotalAnnual` | `cost` | Costo annuale totale |
| `lifecycle.*` | date | Plan / Phase In / Active / Phase Out / End of Life |

Tutto ciò che serve a una Razionalizzazione del portfolio applicativo è già lì, incluso il **TIME Model**. Non occorre aggiungere un campo TIME — lo si compila (manualmente o tramite un calcolo, vedere [La prima analisi](your-first-analysis.md)). Lo stesso vale per `functionalSuitability` e `technicalSuitability`, le due dimensioni di idoneità che guidano classicamente un posizionamento TIME.

## Il test delle due domande prima di aggiungere un campo

Quando ci si trova davvero a dover aggiungere un campo che non è nel metamodello, chiedersi:

1. **Filtrerò, raggrupperò o farò report su questo campo?** Se no, appartiene alla descrizione o a un tag — non a un campo.
2. **La stessa risposta serve su ogni card di questo tipo?** Se no, è una relazione o un allegato, non un campo.

Se non si può rispondere "sì" a entrambe, non aggiungere il campo.

## Se serve davvero un campo personalizzato

Per il raro caso in cui occorra un campo genuinamente nuovo (ad es. un flag `cloudReadiness`, una classificazione regolatoria, un marcatore di segmento cliente), il flusso è:

1. Andare in **Admin → Metamodello**, cliccare sul tipo, passare alla tab **Campi**.
2. Scegliere la sezione (o crearne una nuova) e cliccare **+ Aggiungi campo**.
3. Compilare:
    - **Key** in lower camel-case (ad es. `cloudReadiness`) — diventa la chiave attributo in JSON e nelle formule.
    - **Label** (e una traduzione per ogni locale supportato — altrimenti gli utenti non anglofoni vedranno la chiave grezza).
    - **Type** — `text`, `number`, `cost`, `boolean`, `date`, `url`, `single_select`, `multiple_select`.
    - **Weight** — `0` per escludere dalla Data Quality, `1`+ per includerlo e pesarlo.
    - **Required** — lasciare **off** per il primo rollout; required blocca l'approvazione di ogni card esistente.
4. Per i tipi select, aggiungere le opzioni (key + label + colore) e tradurre ciascuna opzione.
5. Salvare.

Il campo è immediatamente disponibile in **Inventario** (Colonne, filtri), sul Dettaglio della card e nelle formule dei **Calcoli** come `<fieldKey>`. Riferimento completo: [Admin → Metamodello](../admin/metamodel.md).

## Opzione: derivare un campo automaticamente con un Calcolo { #option-derive-a-field-automatically-with-a-calculation }

Oltre all'opzione standard di far compilare un campo manualmente dagli utenti, Turbo EA può **calcolare automaticamente il valore di un campo** a partire da altri campi della stessa card — inclusi quelli integrati — usando la funzionalità **Calcoli**. Il campo calcolato diventa di sola lettura e porta un badge "calculated" così gli utenti non possono deviare dalla regola.

L'esempio canonico è il calcolo del **TIME Model** che deriva il campo integrato `timeModel` su Application a partire da una dimensione di business-fit e una di technical-fit. È fornito come una delle voci nel pannello **Formula Reference** all'interno di **Admin → Metamodello → Calcoli** quando si crea un nuovo calcolo, così lo si può selezionare direttamente dal pannello. Tipo target = `Application`, campo target = `timeModel`; la formula fornita dal pannello è riportata in [Admin → Calcoli → Example Formulas](../admin/calculations.md#example-formulas).

La formula presuppone due campi `single_select` denominati `businessFit` e `technicalFit` con opzioni `excellent` / `adequate` / `insufficient` / `unreasonable`. Non sono presenti nel metamodello integrato — aggiungerli su Application seguendo i passi sui campi personalizzati sopra se si vuole utilizzare questo calcolo.

!!! warning "Da evitare"
    Un TIME calcolato è un'**ipotesi di partenza**, non un verdetto. O si rivede ogni risultato con l'Application Owner prima di fidarsi, oppure si disattiva il calcolo e ci si affida all'inserimento manuale una volta concluso il workshop di validazione.

Il pattern ibrido che funziona bene nella pratica: tenere il calcolo attivo mentre si costruisce l'inventario e si hanno per lo più dati di idoneità; disattivarlo per il workshop di validazione; poi lasciarlo disattivato in modo che le decisioni manuali restino.

## Alternativa: usare un Tag Group

Se il valore è informativo piuttosto che interrogabile, un **Tag Group** (Admin → Tag) è più leggero di un campo personalizzato — nessuna modifica al metamodello, nessuna migrazione, più facile da far evolvere. Usare un Tag Group quando:

- Il valore è descrittivo ("Customer-facing", "Solo interna", "Acquisita nel 2024").
- Si possono aggiungere nuove opzioni di frequente.
- Non serve in un menu a tendina di filtro ma va bene un tag chip con ricerca digitando.

Usare un campo personalizzato quando:

- Serve il valore sugli assi del Portfolio Report (X, Y, colore).
- Lo si vuole pesare nella Data Quality.
- È un vocabolario controllato che non cambierà spesso.

## Anti-pattern da evitare

Questi sono gli errori più comuni sul metamodello nei primi rollout:

!!! warning "Non rinominare i tipi di card integrati"
    Rinominare `Application` in `Solution` sembra ordinato ma rompe la mappatura concettuale che Capability Heatmap, Portfolio Report e i cataloghi danno per scontata. Se la propria organizzazione li chiama "Solutions", impostare la traduzione della **label** — la `key` sottostante rimane `Application`.

!!! warning "Non aggiungere 30 campi personalizzati il primo giorno"
    Ogni campo personalizzato aggiunge attrito alla raccolta dati e diluisce il punteggio di Data Quality. Aggiungere un campo, usarlo per un mese, poi aggiungere il successivo.

!!! warning "Non duplicare campi integrati"
    Prima di aggiungere `timeDisposition`, `funcFit`, `techFit` o `appBusinessValue`, controllare l'elenco dei campi esistenti — è molto probabile che esista già un campo integrato equivalente (`timeModel`, `functionalSuitability`, `technicalSuitability`, `businessValue`). I duplicati spezzano i dati e rompono i report.

!!! warning "Non rendere `required` i nuovi campi il primo giorno"
    `Required` blocca l'approvazione per ogni card esistente che non ha un valore. Rendere un campo required solo **dopo** averlo compilato per oltre l'80% della popolazione.

!!! warning "Non creare tipi di card personalizzati al posto di campi personalizzati"
    "Mobile App" dovrebbe essere un sottotipo di `Application`, non un nuovo tipo di card. I nuovi tipi non ottengono gratis mappatura delle capability, portfolio report o import dai cataloghi.

## Altre estensioni leggere che potrebbero servire

Queste sono comuni estensioni di secondo passaggio, ma **non aggiungerle finché non servono davvero**:

| Esigenza | Dove aggiungerla | Tipo |
|----------|------------------|------|
| Cloud readiness | Application | `single_select` (Ready / Needs refactor / Stays on-prem) |
| Flag customer-facing | Application | `boolean` |
| Classificazione regolatoria | Application, DataObject | `multiple_select` (GDPR, PCI-DSS, …) |
| Categoria di rischio di perdita | Application, IT Component | `single_select` (Single point of failure, ecc.) |
| Suddivisione dei costi | Application | campi `cost` aggiuntivi per `costRunTotalAnnual`, `costChangeTotalAnnual` |

Ciascuno supera il test delle due domande per l'analytics di portfolio. Diversi di essi sono anche ottimi candidati per una formula **calcolata** anziché un inserimento manuale — che è ciò che copre la pagina successiva, usando `timeModel` stesso come esempio funzionante.

Successivo: [La prima analisi: Armonizzazione applicativa](your-first-analysis.md).
