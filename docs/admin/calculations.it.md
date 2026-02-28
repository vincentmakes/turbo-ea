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

Le formule utilizzano un linguaggio di espressioni sicuro e sandboxed. Potete fare riferimento agli attributi della card, ai dati delle card correlate e alle informazioni sul ciclo di vita.

### Variabili di contesto

| Variabile | Descrizione | Esempio |
|-----------|-------------|---------|
| `fieldKey` | Qualsiasi attributo dalla card corrente | `businessCriticality` |
| `related_{type_key}` | Array di card correlate di un dato tipo | `related_applications` |
| `lifecycle_plan`, `lifecycle_active`, ecc. | Valori delle date del ciclo di vita | `lifecycle_endOfLife` |

### Funzioni predefinite

| Funzione | Descrizione | Esempio |
|----------|-------------|---------|
| `IF(condizione, val_vero, val_falso)` | Logica condizionale | `IF(riskLevel == "critical", 100, 25)` |
| `SUM(array)` | Somma dei valori numerici | `SUM(PLUCK(related_applications, "costTotalAnnual"))` |
| `AVG(array)` | Media dei valori numerici | `AVG(PLUCK(related_applications, "dataQuality"))` |
| `MIN(array)` | Valore minimo | `MIN(PLUCK(related_itcomponents, "riskScore"))` |
| `MAX(array)` | Valore massimo | `MAX(PLUCK(related_itcomponents, "costAnnual"))` |
| `COUNT(array)` | Numero di elementi | `COUNT(related_interfaces)` |
| `ROUND(valore, decimali)` | Arrotonda un numero | `ROUND(avgCost, 2)` |
| `ABS(valore)` | Valore assoluto | `ABS(delta)` |
| `COALESCE(a, b, ...)` | Primo valore non nullo | `COALESCE(customScore, 0)` |
| `LOWER(testo)` | Testo in minuscolo | `LOWER(status)` |
| `UPPER(testo)` | Testo in maiuscolo | `UPPER(category)` |
| `CONCAT(a, b, ...)` | Unisce stringhe | `CONCAT(firstName, " ", lastName)` |
| `CONTAINS(testo, ricerca)` | Verifica se il testo contiene una sottostringa | `CONTAINS(description, "legacy")` |
| `PLUCK(array, chiave)` | Estrae un campo da ogni elemento | `PLUCK(related_applications, "name")` |
| `FILTER(array, chiave, valore)` | Filtra gli elementi per valore del campo | `FILTER(related_interfaces, "status", "ACTIVE")` |
| `MAP_SCORE(valore, mappatura)` | Mappa valori categorici a punteggi | `MAP_SCORE(criticality, {"high": 3, "medium": 2, "low": 1})` |

### Formule di esempio

**Costo annuale totale dalle applicazioni correlate:**
```
SUM(PLUCK(related_applications, "costTotalAnnual"))
```

**Punteggio di rischio basato sulla criticità:**
```
IF(riskLevel == "critical", 100, IF(riskLevel == "high", 75, IF(riskLevel == "medium", 50, 25)))
```

**Conteggio delle interfacce attive:**
```
COUNT(FILTER(related_interfaces, "status", "ACTIVE"))
```

**I commenti** sono supportati utilizzando `#`:
```
# Calcola il punteggio di rischio ponderato
IF(businessCriticality == "missionCritical", riskScore * 2, riskScore)
```

## Esecuzione dei calcoli

I calcoli vengono eseguiti automaticamente quando una card viene salvata. Potete anche attivare manualmente un calcolo per eseguirlo su tutte le card del tipo target:

1. Trovate il calcolo nell'elenco
2. Cliccate sul pulsante **Esegui**
3. La formula viene valutata per ogni card corrispondente e i risultati vengono salvati

## Ordine di esecuzione

Quando più calcoli mirano allo stesso tipo di card, vengono eseguiti nell'ordine specificato dal loro valore di **ordine di esecuzione**. Questo è importante quando un calcolo dipende dal risultato di un altro — impostate la dipendenza per essere eseguita per prima (numero inferiore).
