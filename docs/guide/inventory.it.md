# Inventario

L'**Inventario** è il cuore di Turbo EA. Qui sono elencate tutte le **card** (componenti) dell'enterprise architecture: applicazioni, processi, business capability, organizzazioni, fornitori, interfacce e altro.

![Vista inventario con pannello filtri](../assets/img/en/23_inventory_filters.png)

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

![Finestra di creazione card](../assets/img/en/22_create_card.png)

## Come creare una nuova card

1. Cliccate sul pulsante **+ Crea** (blu, angolo in alto a destra)
2. Nella finestra di dialogo che appare:
   - Selezionate il **Tipo** di card (Application, Process, Objective, ecc.)
   - Inserite il **Nome** del componente
   - Opzionalmente, aggiungete una **Descrizione**
3. Opzionalmente, cliccate su **Suggerisci con AI** per generare automaticamente una descrizione (vedi [Suggerimenti di descrizione AI](#suggerimenti-di-descrizione-ai) di seguito)
4. Cliccate su **CREA**

## Suggerimenti di descrizione AI

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

## Importazione Excel

Cliccate su **Importa** nella barra degli strumenti per creare o aggiornare card in blocco da un file Excel.

1. **Selezionate un file** — Trascinate un file `.xlsx` o cliccate per sfogliare
2. **Scegliete il tipo di card** — Opzionalmente limitate l'importazione a un tipo specifico
3. **Validazione** — Il sistema analizza il file e mostra un rapporto di validazione:
   - Righe che creeranno nuove card
   - Righe che aggiorneranno card esistenti (corrispondenza per nome o ID)
   - Avvisi ed errori
4. **Importa** — Cliccate per procedere. Una barra di avanzamento mostra lo stato in tempo reale
5. **Risultati** — Un riepilogo mostra quante card sono state create, aggiornate o fallite

## Esportazione Excel

Cliccate su **Esporta** per scaricare la vista attuale dell'inventario come file Excel:

- **Esportazione multi-tipo** — Esporta tutte le card visibili con le colonne principali (nome, tipo, descrizione, sottotipo, ciclo di vita, stato di approvazione)
- **Esportazione singolo tipo** — Quando filtrate per un tipo, l'esportazione include colonne espanse per gli attributi personalizzati (una colonna per campo)
- **Espansione ciclo di vita** — Colonne separate per ogni data di fase del ciclo di vita (Plan, Phase In, Active, Phase Out, End of Life)
- **Nome file con data** — Il file è nominato con la data di esportazione per una facile organizzazione
