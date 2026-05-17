# Inventario

L'**Inventario** è il cuore di Turbo EA. Qui sono elencate tutte le **card** (componenti) dell'enterprise architecture: applicazioni, processi, business capability, organizzazioni, fornitori, interfacce e altro.

![Vista inventario con pannello filtri](../assets/img/it/23_inventario_filtri.png)

## Struttura della schermata dell'inventario

### Pannello filtri a sinistra

Il pannello laterale sinistro consente di **filtrare** le card secondo diversi criteri:

- **Ricerca** — Ricerca libera per testo nel nome delle card
- **Tipi** — Filtra per uno o più tipi di card: Objective, Platform, Initiative, Organization, Business Capability, Business Context, Business Process, Application, Interface, Data Object, IT Component, Tech Category, Provider, System
- **Sottotipi** — Quando un tipo è selezionato, filtra ulteriormente per sottotipo (es. Application -> Business Application, Microservice, AI Agent, Deployment)
- **Stato di approvazione** — Draft, Approved, Broken o Rejected
- **Ciclo di vita** — Filtra per fase del ciclo di vita: Plan, Phase In, Active, Phase Out, End of Life
- **Qualità dei dati** — Filtro basato su soglia: Buona (80%+), Media (50-79%), Scarsa (sotto il 50%)
- **Tag** — Filtra per tag di qualsiasi gruppo di tag
- **Relazioni** — Filtra per card correlate attraverso i tipi di relazione
- **Attributi personalizzati** — Filtra per valori nei campi personalizzati (ricerca testuale, opzioni di selezione)
- **Mostra solo archiviate** — Attiva/disattiva per visualizzare le card archiviate (eliminate temporaneamente)
- **Cancella tutto** — Reimposta tutti i filtri attivi in una volta

Un **badge con il conteggio dei filtri attivi** mostra quanti filtri sono attualmente applicati.

### Scheda Colonne

La scheda **Colonne** nel pannello laterale consente di scegliere quali colonne aggiuntive visualizzare nella griglia. Le colonne disponibili cambiano dinamicamente in base ai tipi di schede selezionati:

- **Un solo tipo selezionato** — Tutti i campi attributo definiti per quel tipo sono disponibili, oltre alle colonne di relazioni e metadati
- **Più tipi selezionati** — Sono disponibili solo i campi **comuni a tutti i tipi selezionati**
- **Nessun tipo selezionato** — Un messaggio suggerisce di selezionare prima un tipo di scheda

Le colonne sono raggruppate in quattro categorie:

| Categoria | Descrizione |
|-----------|-------------|
| **Colonne predefinite** | Colonne sempre attive: Tipo, Nome, Percorso, Descrizione, Sottotipo, Ciclo di vita, Stato di approvazione, Qualità dei dati. Toglile dalla selezione per nasconderle dalla griglia — utile per restringere una vista salvata alle sole colonne che usi davvero. |
| **Metadati** | Creato, Modificato, Creato da, Modificato da |
| **Attributi** | Campi personalizzati definiti nel metamodello (testo, numero, costo, data, selezione, ecc.) |
| **Relazioni** | Tipi di schede correlati (ad es., Applicazioni collegate a una Capacità Aziendale) |

La colonna **Percorso** mostra la gerarchia della scheda (per es. «Nord America / Vendite / Vendite interne») senza il nome della scheda stessa, così puoi tenere Nome e Percorso visibili contemporaneamente.

Ogni categoria ha una casella di controllo **Seleziona tutto** per attivare o disattivare rapidamente tutte le colonne di quel gruppo. Un campo di ricerca in alto consente di trovare colonne specifiche per nome. Il badge su ogni intestazione di sezione mostra quante colonne di quel gruppo sono attualmente visibili.

Quando un tipo di scheda viene selezionato per la prima volta, **tutte le colonne di attributi e relazioni sono abilitate per impostazione predefinita**. È possibile deselezionare le colonne non necessarie. Un pulsante **Ripristina** in fondo alla scheda «Colonne» ripristina la selezione predefinita delle colonne.

Un **punto indicatore di modifica** appare sull'intestazione della scheda «Colonne» quando la selezione delle colonne differisce dai valori predefiniti. Lo stesso indicatore appare sulla scheda **Filtri** quando sono attivi dei filtri, rendendo facile vedere a colpo d'occhio quali impostazioni sono state modificate.

La selezione delle colonne, i filtri attivi e l'ordine di ordinamento vengono **salvati automaticamente** nel browser. Quando si torna alla pagina dell'inventario, la configurazione precedente viene ripristinata. Le viste salvate (segnalibri) conservano anche la selezione completa delle colonne, in modo che il passaggio tra le viste ripristini esattamente le colonne configurate.

### Tabella principale

L'inventario utilizza una tabella dati **AG Grid** con funzionalità avanzate:

| Colonna | Descrizione |
|---------|-------------|
| **Tipo** | Tipo di card con icona colorata |
| **Nome** | Nome del componente (cliccate per aprire il dettaglio della card) |
| **Descrizione** | Breve descrizione |
| **Ciclo di vita** | Stato attuale del ciclo di vita |
| **Stato di approvazione** | Badge dello stato di revisione |
| **Qualità dei dati** | Percentuale di completezza con anello visivo |
| **Relazioni** | Conteggio delle relazioni con popover cliccabile che mostra le card correlate |

**Funzionalità della tabella:**

- **Ordinamento** — Cliccate sull'intestazione di qualsiasi colonna per ordinare in modo crescente/decrescente
- **Modifica in linea** — In modalità modifica griglia, modificate i valori dei campi direttamente nella tabella
- **Selezione multipla** — Selezionate più righe per operazioni in blocco
- **Visualizzazione gerarchica** — Le relazioni genitore/figlio sono mostrate come percorsi breadcrumb
- **Configurazione colonne** — Mostrate, nascondete e riordinate le colonne

### Barra degli strumenti

- **Modifica griglia** — Attiva/disattiva la modalità di modifica in linea per modificare più card nella tabella
- **Esporta** — Scaricate i dati come file Excel (.xlsx)
- **Importa** — Caricamento massivo di dati da file Excel
- **+ Crea** — Crea una nuova card

![Finestra di creazione card](../assets/img/it/22_crea_scheda.png)

## Come creare una nuova card

1. Cliccate sul pulsante **+ Crea** (blu, angolo in alto a destra)
2. Nella finestra di dialogo che appare:
   - Selezionate il **Tipo** di card (Application, Process, Objective, ecc.)
   - Inserite il **Nome** del componente
   - Opzionalmente, aggiungete una **Descrizione**
3. Opzionalmente, cliccate su **Suggerisci con AI** per generare automaticamente una descrizione (vedi [Suggerimenti di descrizione AI](#suggerimenti-di-descrizione-ai) di seguito)
4. Cliccate su **CREA**

## Suggerimenti di descrizione AI { #ai-description-suggestions }

Turbo EA può utilizzare l'**AI per generare una descrizione** per qualsiasi card. Questo funziona sia nella finestra di creazione card che nelle pagine di dettaglio delle card esistenti.

**Come funziona:**

1. Inserite il nome della card e selezionate un tipo
2. Cliccate sull'**icona scintilla** nell'intestazione della card, o sul pulsante **Suggerisci con AI** nella finestra di creazione card
3. Il sistema effettua una **ricerca web** per il nome dell'elemento (utilizzando un contesto specifico per tipo — es. "SAP S/4HANA software application"), poi invia i risultati a un **LLM** per generare una descrizione concisa e fattuale
4. Appare un pannello di suggerimento con:
   - **Descrizione modificabile** — rivedete e modificate il testo prima di applicarlo
   - **Punteggio di affidabilità** — indica quanto l'AI è sicura (Alto / Medio / Basso)
   - **Link alle fonti cliccabili** — le pagine web da cui la descrizione è stata derivata
   - **Nome del modello** — quale LLM ha generato il suggerimento
5. Cliccate su **Applica descrizione** per salvare, o **Ignora** per scartare

**Caratteristiche principali:**

- **Contestualizzato per tipo**: L'AI comprende il contesto del tipo di card. Una ricerca per "Application" aggiunge "software application", una ricerca per "Provider" aggiunge "technology vendor", ecc.
- **Privacy al primo posto**: Quando si utilizza Ollama, il LLM funziona localmente — i vostri dati non lasciano mai la vostra infrastruttura. Sono supportati anche provider commerciali (OpenAI, Google Gemini, Anthropic Claude, ecc.)
- **Controllato dall'amministratore**: I suggerimenti AI devono essere abilitati da un amministratore in [Impostazioni > Suggerimenti AI](../admin/ai.md). Gli amministratori scelgono quali tipi di card mostrano il pulsante di suggerimento, configurano il provider LLM e selezionano il provider di ricerca web
- **Basato sui permessi**: Solo gli utenti con il permesso `ai.suggest` possono utilizzare questa funzionalità (abilitata per impostazione predefinita per i ruoli Admin, BPM Admin e Member)

## Viste salvate (Segnalibri)

Potete salvare la configurazione attuale di filtri, colonne e ordinamento come una **vista con nome** per un riutilizzo rapido.

### Creare una vista salvata

1. Configurate l'inventario con i filtri, le colonne e l'ordinamento desiderati
2. Cliccate sull'icona **segnalibro** nel pannello filtri
3. Inserite un **nome** per la vista
4. Scegliete la **visibilità**:
   - **Privata** — Solo voi potete vederla
   - **Condivisa** — Visibile a utenti specifici (con permessi di modifica opzionali)
   - **Pubblica** — Visibile a tutti gli utenti

### Utilizzare le viste salvate

Le viste salvate appaiono nel pannello laterale dei filtri. Cliccate su qualsiasi vista per applicare istantaneamente la sua configurazione. Le viste sono organizzate in:

- **Le mie viste** — Viste da voi create
- **Condivise con me** — Viste condivise da altri con voi
- **Viste pubbliche** — Viste disponibili per tutti

## Importazione / Esportazione Excel { #excel-import }

Le importazioni ed esportazioni dell'inventario usano una **cartella di lavoro Excel a più fogli** che ricostruisce un intero sotto-paesaggio — schede di qualsiasi numero di tipi e le relazioni tra di esse — senza dover mai copiare un UUID.

### Struttura della cartella di lavoro

- **Un foglio per ogni tipo di scheda** (Application, Business Capability, IT Component, …) con le colonne principali, le colonne `attr_<campo>`, le colonne di ciclo di vita e le colonne di relazione `rel:<tipo_di_relazione>`.
- **Un foglio `Relations`** per i tipi di relazione che portano attributi (costo, descrizione, …). Le relazioni semplici restano in linea sul foglio della scheda di origine.
- **Un foglio `_Meta`** con la versione del formato della cartella di lavoro.

### Identificazione senza GUID

Le schede sono identificate per **nome** quando è univoco nel suo tipo, altrimenti per **`parent_path`** completo. Una cella di relazione può contenere `NexaCore ERP` direttamente se solo una Application ha quel nome; in caso di ambiguità usare `Sales / Customer Mgmt / CRM`.

#### Univocità tra fratelli

Poiché le schede sono identificate per nome + percorso, **due schede dello stesso tipo non possono condividere contemporaneamente lo stesso genitore e lo stesso nome**. Le nuove schede che provocherebbero una collisione vengono rifiutate alla creazione (nella finestra di dialogo Crea, nel rinominamento in linea e durante l'importazione Excel). Eventuali duplicati già presenti nel database — ereditati da seed o import precedenti — restano intatti: potete modificarne qualsiasi campo, ma creare un terzo duplicato o rinominare una scheda riportandola in collisione viene bloccato. Il controllo è case- e whitespace-insensitive, come il risolutore dell'importatore.

### Celle di relazione in linea

Ogni colonna `rel:<tipo_di_relazione>` esprime le relazioni in uscita come elenco **separato da punti e virgola** (per esempio `NexaCore ERP; BillingApp`). Punto e virgola invece di virgola perché i nomi delle schede contengono spesso virgole (`Acme, Inc.`). All'interno di un nome, `/` e `\` vengono fatti precedere dall'escape `\/` e `\\` — l'esportatore lo gestisce automaticamente (es. `SAP S/4HANA` → `SAP S\/4HANA`). Le celle sono **dichiarative**: il loro contenuto sostituisce l'insieme delle relazioni in uscita di quel tipo dalla sorgente. Rimuovere un target elimina la relazione corrispondente; svuotare la cella le elimina tutte. Per retrocompatibilità, anche le celle separate da virgole (formato precedente) vengono accettate.

### Foglio `Relations`

Per relazioni con attributi, usate il foglio dedicato con le colonne `relation_type`, `source_ref`, `target_ref`, `action` (predefinito `upsert`, in alternativa `delete`), `attr_<campo>` e `description`.

### Importare

Cliccate su **Importa** nella barra degli strumenti, rilasciate la cartella di lavoro e verificate l'anteprima prima di applicare. Vedrete sia le schede da creare / aggiornare sia le relazioni da aggiungere / rimuovere. Gli errori (per esempio, un target ambiguo con i suoi percorsi candidati) bloccano l'applicazione.

### Esportare

Cliccate su **Esporta**. Il filtro corrente determina il contenuto: con un filtro per tipo singolo, un foglio per quel tipo; senza filtro, un foglio per ogni tipo presente. In ogni caso la cartella di lavoro include `Relations` e `_Meta` e può essere reimportata senza perdere gli attributi specifici del tipo.
