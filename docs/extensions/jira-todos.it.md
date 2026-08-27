# Jira Todo Sync

Basta con due elenchi di attività. **Jira Todo Sync** rispecchia i todo di
Turbo EA in un progetto Jira Cloud a vostra scelta e mantiene allineate entrambe
le parti: un todo creato in Turbo EA diventa un ticket Jira in pochi secondi,
completarlo porta il ticket in stato «fatto», e i ticket Jira che corrispondono a
un filtro a vostra scelta compaiono come todo. Titoli, scadenze e assegnatari si
sincronizzano in entrambe le direzioni.

## In sintesi

| | |
|---|---|
| **Licenza** | Commerciale — è richiesto un diritto firmato |
| **Versione minima di Turbo EA** | 2.68.0 |
| **Permesso** | `ext.jira-todos.admin` |
| **Autorizzazioni di accesso ai dati** | `core.todos.read`, `core.todos.write`, `core.events.todo`, `core.users.read` |
| **Riavvio del backend necessario** | sì — include codice di backend |
| **Dove compare** | **Admin → Impostazioni → Integrazioni → Jira Todo Sync** · etichette con la chiave del ticket nella pagina Todo e nella scheda Todo delle card |

È supportato solo **Jira Cloud**. La connessione è esclusivamente in uscita:
Turbo EA chiama l'API REST di Jira con un'e-mail dell'account e un token API. Non
c'è alcun callback OAuth da esporre, nessuna app Jira da installare e nessun
accesso di rete in entrata, quindi funziona su istanze self-hosted o dietro
firewall.

## Configurazione

### 1. Creare un token API Atlassian

1. Andate su
   <https://id.atlassian.com/manage-profile/security/api-tokens> e accedete con
   l'account Atlassian con cui deve operare la sincronizzazione. Usate un
   **account di servizio dedicato**, se ne avete uno: i ticket vengono creati e
   fatti transitare con questo account. (Questo collegamento diretto è la via
   affidabile; la pagina dei token non è più raggiungibile da un percorso di menu
   evidente.)
2. Fate clic su **Create API token** — la variante semplice, **non** *Create API
   token with scopes*. **I token con ambiti non sono supportati.**
3. Assegnategli un nome (per esempio `turbo-ea-sync`) e scegliete una scadenza.
   Atlassian ne richiede una e la limita a **un anno**.
4. **Copiate subito il token**: viene mostrato una sola volta.

!!! warning "I token scadono"
    Alla scadenza la sincronizzazione si ferma con errori di autenticazione finché
    non viene inserito un token nuovo. Annotate la data di scadenza al momento
    della creazione.

### 2. Collegare Turbo EA

Aprite **Admin → Impostazioni → Integrazioni** e scegliete la scheda **Jira Todo
Sync**.

In **Connessione a Jira Cloud** compilate:

| Campo | Note |
|---|---|
| **URL del sito** | Per esempio `https://vostro-sito.atlassian.net` |
| **E-mail dell'account** | L'account Atlassian a cui appartiene il token |
| **Token API** | Salvato cifrato. In seguito lasciatelo vuoto per conservare il token memorizzato |

Premete **Prova connessione**. In caso di esito positivo compare *Connected as …*.

### 3. Definire l'ambito

In **Ambito di sincronizzazione**:

- **Progetto Jira** — scegliete dall'elenco, che viene caricato da Jira non appena
  i dati di connessione sono compilati. I todo inviati vi vengono creati come
  ticket di tipo **Task**.
- **Filtro di importazione (JQL)** — i ticket che corrispondono a questo JQL sono
  rispecchiati come todo. Lasciatelo vuoto per il valore predefinito
  `project = "<KEY>" AND statusCategory != Done`.
- **Intervallo di polling (secondi)** — ogni quanto viene interrogato Jira.
  Predefinito 300, minimo 60.

In **Direzioni** ci sono tre interruttori:

| Interruttore | Predefinito | Effetto |
|---|---|---|
| **Invia i todo a Jira** | attivo | I todo creati in Turbo EA diventano ticket Jira; completare un todo fa transitare il suo ticket |
| **Importa i ticket da Jira** | attivo | I ticket corrispondenti compaiono come todo; risolvere un ticket completa il suo todo |
| **Rispecchia i todo di firma (unidirezionale)** | **disattivo** | Le firme di rischi, decisioni e progetti diventano ticket Jira con un collegamento di ritorno, ma vanno comunque completate in Turbo EA |

Premete **Salva configurazione**. **Sincronizza ora** esegue subito un ciclo.

La corrispondenza degli assegnatari non richiede configurazione: Turbo EA associa
automaticamente le persone agli account Jira tramite l'indirizzo e-mail.

## Come si comporta la sincronizzazione

| Evento | Effetto |
|---|---|
| Todo creato in Turbo EA | In pochi secondi viene creato un ticket Jira (titolo, descrizione con collegamento di ritorno, scadenza, assegnatario) |
| Todo completato o modificato | Il ticket passa a «fatto» oppure i suoi campi vengono aggiornati |
| Ticket che corrisponde al JQL | Viene rispecchiato come todo |
| Ticket risolto in Jira | Il todo viene completato al polling successivo (i todo ricorrenti passano al ciclo seguente) |
| Ticket riaperto in Jira | Il todo viene riaperto |
| **Modifiche su entrambi i lati** | **Vince la modifica più recente; a parità, vince Jira** |
| Todo eliminato in Turbo EA | Il ticket **non viene mai eliminato**: un commento ne dà conto |
| Ticket eliminato in Jira | Un todo importato viene rimosso; un todo creato in Turbo EA viene conservato e segnalato nel registro |

**L'invio è quasi istantaneo, l'importazione è periodica.** Le modifiche fatte in
Turbo EA raggiungono Jira in pochi secondi. Quelle fatte in Jira vengono raccolte
al polling successivo, per impostazione predefinita entro cinque minuti. Ogni
ciclo riconcilia inoltre entrambe le parti, così un'interruzione di Jira o un
evento perso si ripara da sé invece di perdere modifiche.

Vengono mantenuti allineati quattro campi: **titolo**, **scadenza**, **stato
completato** e **assegnatario**. Il titolo corrisponde alla **prima riga** del
testo del todo: rinominare un ticket in Jira sostituisce esattamente quella prima
riga e lascia intatte le righe di dettaglio successive.

### L'etichetta con la chiave del ticket

Un todo sincronizzato riporta la propria chiave ticket Jira (per esempio
`PROJ-123`) come piccolo collegamento, sia nella [pagina Todo](../guide/tasks.md)
sia nella scheda Todo di una card. Un clic apre il ticket in Jira. L'etichetta è
un riferimento: un todo si completa sempre in Turbo EA o tramite la
sincronizzazione.

### I todo di firma

Le richieste di firma — un rischio, una decisione o un progetto in attesa di
approvazione — sono todo di sistema e **non** vengono mai inviate come todo
ordinari. Se **Rispecchia i todo di firma** è attivo, ottengono un ticket Jira
**unidirezionale** che rimanda direttamente alla pagina in cui la firma avviene
davvero.

Una firma non può mai essere apposta da Jira. Se qualcuno chiude il ticket
speculare mentre l'obbligo è ancora aperto, la sincronizzazione lo riapre con un
commento che rimanda a Turbo EA. Quando la firma è completata in Turbo EA, lo
specchio passa a «fatto» al polling successivo.

Disattivare l'interruttore impedisce la creazione di *nuovi* specchi; quelli
esistenti continuano a essere mantenuti.

## Monitoraggio

La riga **Stato** indica quando è avvenuta l'ultima sincronizzazione, l'eventuale
errore e un riepilogo di quanto svolto. **Attività recente**, poco sotto, elenca
le 50 azioni più recenti con orario, direzione (**Turbo EA → Jira**,
**Jira → Turbo EA** o **Sync**), ticket e messaggio di dettaglio. Avvisi ed errori
sono evidenziati a colori: è lì che compaiono un assegnatario non risolto o una
transizione rifiutata.

## Permessi

| Permesso | Consente |
|---|---|
| `ext.jira-todos.admin` | Configurare e gestire la sincronizzazione: connessione, progetto, filtri, esecuzione manuale e registro attività |

La scheda è del tutto nascosta a chi non lo possiede. **Gli utenti finali non
hanno bisogno di alcun permesso aggiuntivo**: i todo sincronizzati compaiono
semplicemente nel loro elenco abituale, con l'etichetta della chiave ticket.

## Se la licenza scade o l'estensione viene disattivata

Il processo di sincronizzazione e il suo gestore di eventi si mettono subito in
pausa e le autorizzazioni di accesso ai dati vengono revocate. **Non viene
eliminato nulla**: i todo conservano le etichette e le impostazioni restano. Una
licenza rinnovata riprende la sincronizzazione dal punto in cui si era fermata.

Il token API è salvato cifrato sulla vostra istanza ed è escluso dal trasferimento
dello spazio di lavoro, quindi non lascia mai l'istanza in cui è stato inserito.

## Risoluzione dei problemi e limiti

- **Solo Jira Cloud.** Jira Data Center non è supportato.
- **Un progetto per istanza**, e i ticket sono sempre creati di tipo **Task**.
- **Polling, non webhook.** Le modifiche lato Jira arrivano al polling successivo.
  I webhook di Jira Cloud richiederebbero un'app OAuth e un'istanza raggiungibile
  da Internet, e servirebbe comunque un polling di riconciliazione: la
  sincronizzazione è quindi periodica per scelta progettuale.
- **Corrispondenza degli assegnatari e riservatezza delle e-mail.** Turbo EA
  associa le persone tramite l'indirizzo e-mail e, in mancanza, ricorre a una
  corrispondenza esatta del nome visualizzato tra le persone assegnabili del
  progetto. Chi ha l'e-mail nascosta in Jira *e* un nome visualizzato diverso tra
  i due sistemi non può essere associato; quelle assegnazioni restano invariate e
  il registro riporta l'indirizzo che non è stato risolto. Una persona di
  Turbo EA non risolta non toglie mai in silenzio l'assegnazione del ticket Jira.
- **Cancellare una scadenza in Jira non viene rispecchiato all'indietro.**
  Cancellatela in Turbo EA.
- **Gli specchi dei todo di firma sono unidirezionali e in ritardo fino a un
  intervallo di polling**, perché i flussi di firma del nucleo non emettono eventi
  di modifica.
- **Sincronizza ora** risponde *A sync is already running* se un ciclo è già in
  corso.
- Dopo una rotazione della `SECRET_KEY` della vostra istanza il token salvato non
  è più decifrabile e il pannello torna a *Not configured yet*: reinseritelo.
