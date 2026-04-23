# Tag

La funzionalità **Tag** (**Admin > Metamodello > scheda Tag**) consente di creare etichette di classificazione che gli utenti possono applicare alle card. I tag sono organizzati in **gruppi di tag**, ciascuno con la propria modalità di selezione, le proprie restrizioni per tipo e un flag opzionale di obbligatorietà che si integra con il workflow di approvazione e con il punteggio di qualità dei dati.

## Gruppi di tag

Un gruppo di tag è una categoria di tag. Ad esempio potreste creare gruppi come «Dominio aziendale», «Framework di conformità» o «Proprietà del team».

### Creare un gruppo di tag

Cliccate su **+ Nuovo gruppo di tag** e configurate:

| Campo | Descrizione |
|-------|-------------|
| **Nome** | Nome visualizzato sul dettaglio card, sui filtri dell'inventario e nei report. |
| **Descrizione** | Testo libero opzionale, visibile solo agli amministratori. |
| **Modalità** | **Selezione singola** — un tag per card. **Selezione multipla** — più tag per card. |
| **Obbligatorio** | Quando selezionato, il gruppo partecipa al gate di approvazione e al punteggio di qualità di ogni tipo di card al quale si applica. Vedi [Gruppi di tag obbligatori](#gruppi-di-tag-obbligatori) più avanti. |
| **Limita ai tipi** | Lista opzionale di tipi di card ammessi. Vuota significa che il gruppo è disponibile su tutti i tipi; altrimenti solo i tipi elencati vedono il gruppo nel dettaglio, nei filtri e nei portali. |

### Gestire i tag

All'interno di ogni gruppo potete aggiungere tag individuali:

1. Cliccate su **+ Aggiungi tag** all'interno di un gruppo di tag.
2. Inserite il **nome** del tag.
3. Opzionalmente impostate un **colore** per la distinzione visiva — il colore determina lo sfondo del chip sul dettaglio card, nell'inventario, nei report e nei portali web.

I tag compaiono nelle pagine di dettaglio delle card nella sezione **Tag**, dove gli utenti con il permesso adeguato possono applicarli o rimuoverli.

## Restrizioni per tipo

Impostare **Limita ai tipi** su un gruppo di tag lo limita ovunque contemporaneamente:

- **Dettaglio card** — il gruppo e i suoi tag compaiono solo sui tipi di card corrispondenti.
- **Barra laterale dei filtri dell'inventario** — il chip del gruppo compare nel `TagPicker` solo quando la vista inventario è filtrata su un tipo corrispondente.
- **Portali web** — il gruppo è proposto ai lettori del portale solo quando il portale mostra un tipo corrispondente.
- **Report** — i menu a tendina di raggruppamento / filtro includono il gruppo solo per i tipi corrispondenti.

L'interfaccia di amministrazione mostra i tipi assegnati come piccoli chip su ogni gruppo di tag, così da vedere l'ambito a colpo d'occhio.

## Gruppi di tag obbligatori

Contrassegnare un gruppo di tag come **Obbligatorio** lo trasforma in un requisito di governance: ogni card a cui il gruppo si applica deve avere almeno un tag del gruppo.

### Gate di approvazione

Una card non può passare ad **Approvata** finché un gruppo di tag obbligatorio applicabile non è soddisfatto. Tentare di approvarla restituisce l'errore `approval_blocked_mandatory_missing` e la pagina di dettaglio elenca quali gruppi mancano. Due precauzioni mantengono il gate sicuro:

- Un gruppo si applica a una card solo se la sua lista **Limita ai tipi** è vuota o include il tipo della card.
- Un gruppo obbligatorio che **non ha ancora tag configurati** viene ignorato silenziosamente — questo impedisce un gate di approvazione irraggiungibile a causa di una configurazione amministrativa incompleta.

Una volta aggiunti i tag richiesti, la card può essere approvata normalmente.

### Contributo alla qualità dei dati

I gruppi obbligatori applicabili alimentano anche il punteggio di qualità dei dati della card. Ogni gruppo soddisfatto aumenta il punteggio insieme agli altri elementi obbligatori (campi richiesti, lati di relazione obbligatori) che compongono il calcolo di completezza.

### Indicatori visivi

I gruppi obbligatori sono contrassegnati da un chip **Obbligatorio** sia nella lista di amministrazione sia nella sezione Tag del dettaglio card. I tag obbligatori mancanti compaiono nel banner dello stato di approvazione e nel tooltip dell'anello di qualità dei dati, così gli utenti sanno esattamente cosa aggiungere.

## Autorizzazioni

| Autorizzazione | Cosa consente |
|----------------|---------------|
| `tags.manage` | Creare, modificare ed eliminare gruppi e tag nell'interfaccia di amministrazione, e applicare/rimuovere tag su qualsiasi card indipendentemente dalle altre autorizzazioni. |
| `inventory.edit` + `card.edit` | Applicare o rimuovere tag sulle card che l'utente può modificare (tramite il ruolo applicativo o il ruolo di stakeholder su quella specifica card). |

`tags.manage` è concesso per impostazione predefinita al ruolo admin. `inventory.edit` appartiene ad admin, bpm_admin e member; `card.edit` è concesso attraverso gli incarichi di ruolo di stakeholder della card stessa.

I viewer **vedono** i tag ma non possono modificarli.

## Dove compaiono i tag

- **Dettaglio card** — la sezione Tag elenca i gruppi applicabili e i tag attualmente associati. I gruppi obbligatori mostrano un chip; i gruppi ristretti compaiono solo quando il tipo della card corrisponde.
- **Barra laterale dei filtri dell'inventario** — un `TagPicker` raggruppato permette di filtrare la griglia dell'inventario per uno o più tag. Gruppi e tag sono filtrati in base al tipo corrente.
- **Report** — la segmentazione per tag è disponibile nei report di portfolio, matrice e in altri report che supportano dimensioni di raggruppamento / filtro.
- **Portali web** — gli editor dei portali possono esporre filtri basati sui tag ai lettori anonimi, così che i consumatori esterni possano segmentare i paesaggi pubblici nello stesso modo.
- **Dialoghi di creazione / modifica** — lo stesso `TagPicker` compare alla creazione di una nuova card, così i tag richiesti possono essere impostati da subito — particolarmente utile per i gruppi obbligatori.
