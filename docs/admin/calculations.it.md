# Calcoli

La funzionalità **Calcoli** (**Admin > Metamodello > scheda Calcoli**) consente di definire **formule che calcolano automaticamente i valori dei campi** quando le card vengono salvate. Questo è potente per derivare metriche, punteggi e aggregazioni dai dati architetturali.

## Come funziona

1. Un amministratore definisce una formula che mira a un tipo di card e un campo specifico
2. Quando qualsiasi card di quel tipo viene creata o aggiornata, la formula viene eseguita automaticamente
3. Il risultato viene scritto nel campo target
4. Il campo target è contrassegnato come **sola lettura** nella pagina di dettaglio della card (gli utenti vedono un badge "calcolato")

## Creazione di un calcolo

Cliccate su **+ Nuovo calcolo** e configurate:

| Campo | Descrizione |
|-------|-------------|
| **Nome** | Nome descrittivo per il calcolo |
| **Tipo target** | Il tipo di card a cui si applica questo calcolo |
| **Campo target** | Il campo dove il risultato viene memorizzato |
| **Formula** | L'espressione da valutare (vedi la sintassi di seguito) |
| **Ordine di esecuzione** | Ordine di esecuzione quando esistono più calcoli per lo stesso tipo (il numero più basso viene eseguito per primo) |
| **Attivo** | Abilitare o disabilitare il calcolo |

## Sintassi delle formule

Le formule utilizzano un linguaggio di espressioni sicuro e sandboxed. Potete fare riferimento ai campi della card corrente, alle card correlate e figlie, alla card padre e alle date del ciclo di vita.

!!! warning "Usate la chiave del campo, non la sua etichetta"
    I campi si referenziano tramite la loro **chiave**, di solito in camelCase
    (`costTotalAnnual`), non tramite l'etichetta mostrata sulla card (`Costo annuale totale`).
    Un nome inesistente viene risolto in `None`, e qualsiasi operazione aritmetica su `None`
    fallisce con un **errore di valutazione** generico.

    Potete trovare la chiave in **Admin > Metamodello >** *(tipo di card)* aprendo il campo e
    leggendone la **Chiave**. Più semplice: nell'editor delle formule, i chip sotto il riquadro
    della formula elencano `data.<chiave>` per ogni campo del tipo selezionato, e digitando
    `data.` si apre il completamento automatico.

### Variabili di contesto

| Variabile | Descrizione | Esempio |
|-----------|-------------|---------|
| `data.<chiaveCampo>` | Qualsiasi campo personalizzato della card corrente, tramite la sua chiave | `data.costTotalAnnual` |
| `data.name`, `data.description`, `data.status`, `data.subtype`, `data.approval_status`, `data.reference` | Proprietà predefinite della card | `data.subtype` |
| `data.lifecycle.<fase>` | Date del ciclo di vita, dove la fase è `plan`, `phaseIn`, `active`, `phaseOut` o `endOfLife` | `data.lifecycle.endOfLife` |
| `relations.<chiaveTipoRelazione>` | Array delle card collegate da quel tipo di relazione, in entrambe le direzioni | `relations.relAppToITC` |
| `relation_count.<chiaveTipoRelazione>` | Numero di card collegate da quel tipo di relazione | `relation_count.relAppToITC` |
| `children` | Array delle card figlie dirette (tipi gerarchici) | `SUM(PLUCK(children, "attributes.costTotalAnnual"))` |
| `children_count` | Numero di figli diretti | `children_count` |
| `parent` | La card padre (oggetto con `id`, `name`, `type`, `subtype`, `attributes`), oppure `None` per una card radice | `IF(parent, parent.attributes.businessCriticality, data.businessCriticality)` |
| `hierarchy_level` | Profondità della card corrente nella sua gerarchia padre-figlio (`1` = radice, senza limite). `1` per i tipi di card non gerarchici | `hierarchy_level * 10` |

La chiave del tipo di relazione è quella riportata in **Admin > Metamodello > Relazioni**, ad
esempio `relAppToITC` o `relInitiativeToApp`. La direzione non conta: una card trova un tipo
di relazione sotto la stessa chiave sia che si trovi all'estremità sorgente sia a quella di
destinazione. Le card archiviate sono escluse da `relations`, `relation_count` e `children`.

### Leggere i campi di una card correlata

Ogni elemento di `relations.<chiaveTipoRelazione>` e di `children` è un oggetto
contenitore, non direttamente i campi della card correlata:

```json
{
  "id": "8f1c…",
  "name": "NexaCore ERP",
  "type": "Application",
  "attributes":     { "costTotalAnnual": 45000, "businessCriticality": "missionCritical" },
  "rel_attributes": { "costTotalAnnual": 12000 }
}
```

* `attributes` contiene i valori dei campi propri della card correlata.
* `rel_attributes` contiene i valori memorizzati **sul collegamento stesso**, se il tipo di
  relazione definisce uno schema di attributi. Ad esempio, `relAppToITC` porta con sé un
  proprio `costTotalAnnual`, così potete registrare quanto una singola applicazione spende per
  un singolo componente IT.

Questo conta per `PLUCK` e `FILTER`, che accettano un percorso di chiave e quindi richiedono
il prefisso `attributes.` per raggiungere un campo:

```
# Somma il costo annuale dei componenti IT usati da questa applicazione
SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))

# Somma invece il costo registrato su ogni collegamento applicazione-componente
SUM(PLUCK(relations.relAppToITC, "rel_attributes.costTotalAnnual"))
```

Estrarre una chiave semplice come `"costTotalAnnual"` la cerca sull'oggetto contenitore, non
trova nulla e restituisce un elenco di `None`, che `SUM` riporta come `0`. Una formula sulle
relazioni che restituisce ostinatamente `0` è quasi sempre un prefisso `attributes.` mancante.

### Gestire i valori vuoti

Un campo senza valore viene risolto in `None`, e `None` in un'espressione aritmetica genera un
errore. Racchiudete in `COALESCE` ogni campo che potrebbe essere vuoto:

```
COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0) + COALESCE(data.infraCost, 0)
```

`SUM`, `AVG`, `MIN` e `MAX` ignorano già le voci non numeriche, quindi non richiedono
protezione.

### Dati PPM sulle card Initiative

La radice `ppm` espone alle formule le righe di budget e di costo del modulo PPM, divise tra capex e opex e ripartite per esercizio — un dettaglio che gli attributi consolidati `data.costBudget` / `data.costActual` sulla card non possono fornire.

| Variabile | Descrizione |
|----------|-------------|
| `ppm.capexBudget`, `ppm.opexBudget`, `ppm.totalBudget` | Budget previsto, dalle righe di budget PPM |
| `ppm.capexPlanned`, `ppm.opexPlanned`, `ppm.totalPlanned` | Importi previsti sulle righe di costo PPM |
| `ppm.capexActual`, `ppm.opexActual`, `ppm.totalActual` | Consuntivi sulle righe di costo PPM |
| `ppm.byYear` | Le stesse nove misure per esercizio, come elenco `{year, capexBudget, …}` |
| `ppm.currentFiscalYear` | L'esercizio in cui cade la data odierna |
| `ppm.unscheduledPlanned`, `ppm.unscheduledActual` | Righe di costo senza data: contano nei totali, ma non appartengono ad alcun esercizio |

`byYear` è un elenco e non un oggetto indicizzato per anno, così le consuete funzioni `FILTER` e `PLUCK` vi funzionano sopra:

```
# Budget capex totale su tutti gli esercizi
ppm.capexBudget

# Solo il budget capex dell'esercizio corrente
SUM(PLUCK(FILTER(ppm.byYear, "year", ppm.currentFiscalYear), "capexBudget"))

# Budget capex di ogni Iniziativa collegata a questa card
SUM(PLUCK(relations.relInitiativeToApp, "ppm.capexBudget"))
```

* **Un esercizio prende il nome dall'anno solare in cui termina.** Con inizio a ottobre, il 15 ott 2025 ricade nell'esercizio 2026 e il 30 set 2025 nel 2025. Con l'inizio a gennaio predefinito l'esercizio coincide con l'anno solare.
* **Righe di budget e righe di costo ricavano l'esercizio da fonti diverse.** Una riga di budget porta l'esercizio che avete inserito; quello di una riga di costo è dedotto dalla sua data. Se la vostra organizzazione denomina gli esercizi dall'anno di *inizio*, i due divergeranno.
* `total*` è la somma di tutte le righe, non `capex + opex`. Una riga la cui categoria non è né l'una né l'altra (da un'importazione, per esempio) conta comunque nel totale.
* Una card che non è un'Iniziativa legge tutte le misure `ppm` come `0` con `byYear` vuoto: una formula sul tipo sbagliato restituisce zero anziché fallire.

Modificare una riga di budget o di costo PPM riesegue i calcoli dell'iniziativa, quindi tutto ciò che ne deriva si aggiorna subito. Le card che leggono i dati PPM di *un'altra* card tramite una relazione non vengono aggiornate.

### Funzioni predefinite

| Funzione | Descrizione | Esempio |
|----------|-------------|---------|
| `IF(condizione, val_vero, val_falso)` | Logica condizionale. Viene valutato solo il ramo scelto | `IF(data.businessCriticality == "missionCritical", 100, 25)` |
| `SUM(array)` | Somma dei valori numerici | `SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `AVG(array)` | Media dei valori numerici | `AVG(PLUCK(children, "attributes.numberOfUsers"))` |
| `MIN(array)` | Valore minimo | `MIN(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `MAX(array)` | Valore massimo | `MAX(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `COUNT(array)` | Numero di elementi | `COUNT(relations.relAppToInterface)` |
| `ROUND(valore, decimali)` | Arrotonda un numero | `ROUND(data.costTotalAnnual / 12, 2)` |
| `ABS(valore)` | Valore assoluto | `ABS(data.budgetVariance)` |
| `LN(valore)` | Logaritmo naturale. Restituisce `None` per zero, valori negativi e input non numerici | `LN(data.numberOfUsers)` |
| `COALESCE(a, b, ...)` | Primo valore non nullo | `COALESCE(data.customScore, 0)` |
| `LOWER(testo)` | Testo in minuscolo | `LOWER(data.productName)` |
| `UPPER(testo)` | Testo in maiuscolo | `UPPER(data.subtype)` |
| `CONCAT(a, b, ...)` | Unisce stringhe | `CONCAT(data.name, " (", data.subtype, ")")` |
| `CONTAINS(testo, ricerca)` | Verifica se il testo contiene una sottostringa | `CONTAINS(data.description, "legacy")` |
| `PLUCK(array, percorso)` | Estrae un percorso di chiave da ogni elemento | `PLUCK(relations.relAppToITC, "attributes.costTotalAnnual")` |
| `FILTER(array, percorso, valore)` | Mantiene gli elementi il cui percorso di chiave è uguale a un valore | `FILTER(relations.relOrgToApp, "attributes.hostingType", "onPremise")` |
| `MAP_SCORE(valore, mappatura)` | Mappa valori categorici a punteggi | `MAP_SCORE(data.businessCriticality, {"missionCritical": 3, "businessCritical": 2})` |

Sono disponibili anche le funzioni Python sicure `len`, `str`, `int`, `float`, `bool`, `abs`,
`round`, `min`, `max` e `sum`, oltre ai consueti operatori e confronti.

### Formule di esempio { #example-formulas }

**Somma di più campi di costo sulla stessa card:**
```
COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0) + COALESCE(data.infraCost, 0)
```

**Costo annuale totale dei componenti IT usati da un'applicazione:**
```
SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))
```

**Punteggio di rischio basato sulla criticità:**
```
IF(data.businessCriticality == "missionCritical", 100, IF(data.businessCriticality == "businessCritical", 75, 25))
```

**Conteggio delle interfacce correlate:**
```
relation_count.relAppToInterface
```

**Conteggio delle applicazioni on-premise in un'organizzazione:**
```
COUNT(FILTER(relations.relOrgToApp, "attributes.hostingType", "onPremise"))
```

**Consolidare un costo dalle card figlie:**
```
SUM(PLUCK(children, "attributes.costTotalAnnual"))
```

**Posizionamento TIME Model (Tolerate / Invest / Migrate / Eliminate)**, lo stesso esempio che si vedrà nel pannello **Formula Reference** all'interno di **Admin → Metamodello → Calcoli** quando si crea un nuovo calcolo. Tipo target = `Application`, campo target = `timeModel`. Si presuppone di aver aggiunto due campi `single_select` denominati `businessFit` e `technicalFit` con opzioni `excellent`, `adequate`, `insufficient`, `unreasonable`:
```
# ── TIME Model (Tolerate / Invest / Migrate / Eliminate) ──
# Assumes single_select fields: businessFit and technicalFit
# with options: excellent, adequate, insufficient, unreasonable.
#
# Scoring: Map each dimension to 1-4 numeric scale.
# Business Fit  = Y-axis (how well does it serve the business?)
# Technical Fit = X-axis (how healthy is the technology?)
#
# Quadrant logic (threshold at score 2.5):
#   Invest    = high business + high technical
#   Migrate   = high business + low technical
#   Tolerate  = low business  + high technical
#   Eliminate = low business  + low technical
#
bf = MAP_SCORE(data.businessFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
tf = MAP_SCORE(data.technicalFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
IF(bf is None or tf is None, None, IF(bf >= 2.5, IF(tf >= 2.5, "invest", "migrate"), IF(tf >= 2.5, "tolerate", "eliminate")))
```

Come mostra l'esempio, una formula può occupare più righe. Una riga nella forma
`nome = espressione` memorizza un valore intermedio riutilizzabile dalle righe successive, e
il valore dell'ultima riga è quello scritto nel campo target.

Questo è anche l'esempio funzionante referenziato dalla [Guida per principianti EA](../beginners-guide/customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation).

**I commenti** sono supportati utilizzando `#`:
```
# Calcola il punteggio di rischio ponderato
IF(data.businessCriticality == "missionCritical", data.riskScore * 2, data.riskScore)
```

## Validare e testare

L'editor delle formule offre due controlli distinti, che si comportano in modo diverso:

* **Valida** esegue la formula su una card sintetica. Ogni campo numerico riceve il valore
  fittizio `1`, e la card **non ha relazioni, né figli, né dati propri del padre**. Conferma
  che la sintassi viene analizzata correttamente e che i nomi usati esistono, ma una formula
  che aggrega su `relations` o `children` mostrerà sempre `0` o un risultato vuoto in questa
  sede. È il comportamento atteso e non indica una formula difettosa.
* **Testa**, disponibile su un calcolo salvato, viene eseguito su una card reale a vostra
  scelta. È l'opzione da usare per tutto ciò che coinvolge relazioni, figli o la card padre.
  Nulla viene scritto sulla card, il risultato viene soltanto mostrato.

## Leggere i risultati di un'esecuzione manuale

Eseguire un calcolo dall'elenco lo valuta per ogni scheda del tipo di destinazione e riferisce
che cosa è successo, non solo quante schede sono state elaborate. **Vedi dettagli** nel banner
del risultato apre il dettaglio:

* **Un blocco per calcolo**, con il numero di schede calcolate senza errori e quelle non
  riuscite. Tutti i calcoli attivi del tipo vengono eseguiti insieme, quindi è questo a indicare
  quale sia in difetto.
* **Una riga per ogni errore distinto**, con il numero di schede su cui si è verificato. Una
  formula sbagliata lo è allo stesso modo ovunque: ventuno errori sono di solito una sola
  correzione, non ventuno.
* **Le schede stesse**, elencate sotto ciascun errore e collegate, così da aprirne una e vedere
  i dati che l'hanno fatta fallire. Ne sono elencate al massimo dieci per errore; se sono di
  più, il resto è indicato come conteggio.

**Copia il rapporto** mette l'intero dettaglio negli appunti come testo semplice.

Il chip di stato nell'elenco dei calcoli riflette la stessa esecuzione: rosso se una scheda non
è riuscita, verde solo quando tutte sono state calcolate.

## Quando vengono eseguiti i calcoli

I calcoli di una card vengono rivalutati quando:

* la card viene creata o salvata;
* una relazione che tocca la card viene creata, modificata o eliminata (entrambe le estremità
  della relazione vengono ricalcolate);
* la card viene riassegnata a un nuovo padre, il che ricalcola l'intero sottoalbero;
* eseguite il calcolo manualmente dall'elenco, il che lo valuta per ogni card del tipo target
  e ne salva i risultati.

**Non** vengono rivalutati quando viene modificata un'altra card da cui la formula legge. Se
cambiate un costo su un componente IT, l'applicazione che lo aggrega non si muoverà finché
quell'applicazione non viene salvata, non cambia una sua relazione o non eseguite il calcolo
per il tipo. Per le aggregazioni su dati mantenuti da altri, eseguite il calcolo
periodicamente o dopo un'importazione massiva.

!!! note "Nota"
    Lo stesso vale per i valori derivati da `parent` e `hierarchy_level`: si aggiornano alla
    riassegnazione del padre e a un'esecuzione manuale, non a ogni modifica della card padre.
    Proteggete sempre un riferimento a `parent` con `IF(parent, …)` in modo che le card
    radice, dove `parent` è `None`, non generino errori.

## Ordine di esecuzione

Quando più calcoli mirano allo stesso tipo di card, vengono eseguiti nell'ordine specificato dal loro valore di **ordine di esecuzione**. Questo è importante quando un calcolo dipende dal risultato di un altro: impostate la dipendenza per essere eseguita per prima (numero inferiore).

Turbo EA rifiuta un insieme di calcoli che formerebbe un ciclo, ad esempio un campo A calcolato a partire dal campo B mentre B è calcolato a partire da A.
