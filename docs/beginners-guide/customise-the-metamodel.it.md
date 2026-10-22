# Personalizzare il metamodello — con leggerezza

Il metamodello di Turbo EA è completamente **configurabile da amministratore** — ogni tipo di card, campo, sottotipo, relazione e ruolo stakeholder è dato, non codice. Si sarà tentati di ridisegnarlo. **Non farlo.**

I team che hanno successo personalizzano il metamodello **solo quando i campi di default non possono rispondere alla loro domanda**. I team che falliscono passano il primo mese a rinominare `Application` in `Solution`, aggiungendo 30 campi personalizzati, senza mai arrivare a un report funzionante.

## Cosa è già nel metamodello

Prima di aggiungere qualcosa, conoscere ciò di cui già si dispone. Il tipo di card **Application** integrato include questi campi out of the box (tra gli altri):

| Campo integrato | Tipo | A cosa serve |
|-----------------|------|--------------|
| `businessCriticality` | `single_select` (required) | Critico per la missione / Critico per il business / Operativo / Amministrativo |
| `functionalSuitability` | `single_select` | Perfetto / Appropriato / Insufficiente / Inadeguato |
| `technicalSuitability` | `single_select` | Pienamente appropriato / Adeguato / Inadeguato / Inappropriato |
| `timeModel` | `single_select` (required) | **Tollerare / Investire / Migrare / Eliminare** — la canonica disposizione TIME di Gartner |
| `costTotalAnnual` | `cost` | Costo annuale totale |
| `lifecycle.*` | date | Plan / Phase In / Active / Phase Out / End of Life |

Tutto ciò che serve a una Razionalizzazione del portfolio applicativo è già lì, incluso il **Modello TIME**. Non occorre aggiungere un campo TIME — lo si deriva con un calcolo (vedere sotto) o lo si compila a mano, vedere [La prima analisi](your-first-analysis.md). Lo stesso vale per `functionalSuitability` e `technicalSuitability`, le due dimensioni di idoneità che guidano classicamente un posizionamento TIME, e per `businessCriticality`, che raggruppa il report Portfolio applicazioni.

## Il test delle due domande prima di aggiungere un campo

Quando ci si trova davvero a dover aggiungere un campo che non è nel metamodello, chiedersi:

1. **Filtrerò, raggrupperò o farò report su questo campo?** Se no, appartiene alla descrizione o a un tag — non a un campo.
2. **La stessa risposta serve su ogni card di questo tipo?** Se no, è una relazione o un allegato, non un campo.

Se non si può rispondere "sì" a entrambe, non aggiungere il campo.

## Se serve davvero un campo personalizzato

Per il raro caso in cui occorra un campo genuinamente nuovo (ad es. un flag `cloudReadiness`, una classificazione regolatoria, un marcatore di segmento cliente), il flusso è:

1. Andare in **Admin → Metamodello** e cliccare sul tipo. Il layout della card si trova nella tab **Generale**.
2. Scegliere la sezione (o crearne una con **Aggiungi sezione**) e cliccare **+ Campo**.
3. Compilare:
    - **Key** in lower camel-case (ad es. `cloudReadiness`) — diventa la chiave attributo in JSON e nelle formule.
    - **Label** (e una traduzione per ogni locale supportato — altrimenti gli utenti non anglofoni vedranno la chiave grezza).
    - **Type** — `text`, `multiline_text`, `number`, `cost`, `percentage`, `boolean`, `date`, `url`, `single_select`, `multiple_select`.
    - **Required** — lasciare **off** per il primo rollout; finché un campo obbligatorio è vuoto, il punteggio di Data Quality della card resta bloccato a 0.
4. Per i tipi select, aggiungere le opzioni (key + label + colore) e tradurre ciascuna opzione.
5. Salvare.
6. Facoltativo: impostare quanto il campo conta ai fini della Data Quality nella tab **Qualità dei dati** del tipo.

Il campo è immediatamente disponibile in **Inventario** (Colonne, filtri), sul Dettaglio della card e nelle formule dei **Calcoli** come `<fieldKey>`. Riferimento completo: [Admin → Metamodello](../admin/metamodel.md).

## Opzione: derivare un campo automaticamente con un Calcolo { #option-derive-a-field-automatically-with-a-calculation }

Oltre all'opzione standard di far compilare un campo manualmente dagli utenti, Turbo EA può **calcolare automaticamente il valore di un campo** a partire da altri campi della stessa card — inclusi quelli integrati — usando la funzionalità **Calcoli**. Il campo calcolato diventa di sola lettura e porta un badge "calcolato" così gli utenti non possono deviare dalla regola.

L'esempio canonico è il calcolo del **Modello TIME**, che deriva il campo integrato `timeModel` su Application dalle due valutazioni di idoneità integrate. Lo si crea in **Admin → Metamodello → Calcoli** con **Nuovo calcolo**: Tipo di scheda destinazione = `Application`, Campo destinazione = **Modello TIME**, e questa formula:

```
# TIME Model from the built-in Functional and Technical Suitability (Gartner quadrants)
ff = MAP_SCORE(data.functionalSuitability, {"perfect": 4, "appropriate": 3, "insufficient": 2, "unreasonable": 1})
tf = MAP_SCORE(data.technicalSuitability, {"fullyAppropriate": 4, "adequate": 3, "unreasonable": 2, "inappropriate": 1})
IF(ff is None or tf is None, None, IF(ff >= 2.5, IF(tf >= 2.5, "invest", "migrate"), IF(tf >= 2.5, "tolerate", "eliminate")))
```

Ogni valutazione viene trasformata in un punteggio da 4 (migliore) a 1 (peggiore), e i due punteggi collocano l'applicazione in uno dei quattro quadranti: funzionale alta + tecnica alta = **Investire**, funzionale alta + tecnica bassa = **Migrare**, funzionale bassa + tecnica alta = **Tollerare**, bassa su entrambe = **Eliminare**. Un'applicazione a cui manca una delle due valutazioni non riceve alcun valore TIME, così le lacune restano visibili.

È lo stesso esempio TIME che trovate nel pannello **Riferimento formule** dell'editor dei calcoli, quindi potete anche copiarlo da lì. Legge solo campi che Application ha già, quindi **non occorre aggiungere alcun campo** — e non si dovrebbe farlo (vedere *Non duplicare campi integrati* più sotto). Altra sintassi delle formule: [Admin → Calcoli](../admin/calculations.md).

Dopo il salvataggio, attivare il calcolo (**Attivo**) e cliccare **Ricalcola tutto** sulla sua riga in modo che ogni applicazione esistente riceva il proprio valore. La procedura passo per passo si trova in [La prima analisi → Passo 3](your-first-analysis.md).

!!! warning "Da evitare"
    Un TIME calcolato è un'**ipotesi di partenza**, non un verdetto. Rivedere ogni risultato con l'Application Owner prima di fidarsi.

Il pattern ibrido che funziona bene nella pratica: tenere il calcolo attivo mentre si costruisce l'inventario e si raccolgono le valutazioni di idoneità; rivedere i risultati nel workshop di validazione; e se le decisioni devono discostarsi dalla formula, disattivare il calcolo (l'interruttore **Attivo**) in modo che il campo torni modificabile e le decisioni manuali restino.

## Alternativa: usare un Tag Group

Se il valore è informativo piuttosto che interrogabile, un **Tag Group** (Admin → Metamodello → Tag) è più leggero di un campo personalizzato — nessuna modifica al metamodello, nessuna migrazione, più facile da far evolvere. Usare un Tag Group quando:

- Il valore è descrittivo ("Customer-facing", "Solo interna", "Acquisita nel 2024").
- Si possono aggiungere nuove opzioni di frequente.
- Non serve in un menu a tendina di filtro ma va bene un tag chip con ricerca digitando.

Usare un campo personalizzato quando:

- Si vuole raggruppare o colorare un report in base al valore (per esempio il Portfolio applicazioni).
- Lo si vuole pesare nella Data Quality.
- È un vocabolario controllato che non cambierà spesso.

## Anti-pattern da evitare

Questi sono gli errori più comuni sul metamodello nei primi rollout:

!!! warning "Non rinominare i tipi di card integrati"
    Rinominare `Application` in `Solution` sembra ordinato ma rompe la mappatura concettuale che la Mappa delle capacità, il report Portfolio applicazioni e i cataloghi danno per scontata. Se la propria organizzazione li chiama "Solutions", impostare la traduzione della **label** — la `key` sottostante rimane `Application`.

!!! warning "Non aggiungere 30 campi personalizzati il primo giorno"
    Ogni campo personalizzato aggiunge attrito alla raccolta dati e diluisce il punteggio di Data Quality. Aggiungere un campo, usarlo per un mese, poi aggiungere il successivo.

!!! warning "Non duplicare campi integrati"
    Prima di aggiungere `timeDisposition`, `funcFit`, `techFit` o `appCriticality`, controllare l'elenco dei campi esistenti — è molto probabile che esista già un campo integrato equivalente (`timeModel`, `functionalSuitability`, `technicalSuitability`, `businessCriticality`). I duplicati spezzano i dati e rompono i report.

!!! warning "Non rendere `required` i nuovi campi il primo giorno"
    Finché un campo obbligatorio è vuoto, il punteggio di Data Quality della card resta bloccato a 0 e un banner di avviso elenca ciò che manca — su ogni card esistente contemporaneamente. Rendere un campo required solo **dopo** averlo compilato per oltre l'80% della popolazione.

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
