# Estensioni

Lo **store delle estensioni** (Admin → Estensioni) installa estensioni firmate dal fornitore che aggiungono funzionalità specifiche del cliente — contenuti aggiuntivi del metamodello, integrazioni, processi in background e persino nuove pagine — senza modificare il core di Turbo EA (principio «clean core»).

Tutto viene consegnato come file: l'estensione è un pacchetto `.teax` firmato e la licenza un file di testo firmato, entrambi inviati tipicamente via e-mail. Non servono attivazione online, account dello store né connessioni in uscita: il flusso funziona quindi in modo identico su istanze **isolate (air-gapped)**.

La pagina ha due schede: **Store** sfoglia il catalogo delle estensioni del fornitore con installazione a un clic (se l'istanza ha accesso a Internet), mentre **Installate** gestisce le licenze e installa da file.

## Come funziona la fiducia

Due verifiche indipendenti proteggono l'istanza:

1. **Provenienza (firma).** Ogni pacchetto porta una firma Ed25519 della chiave del fornitore. Turbo EA la verifica al caricamento *e di nuovo a ogni avvio del backend*. I pacchetti non firmati, manomessi o di terzi vengono rifiutati — un'estensione installata è garantita essere esattamente ciò che il fornitore ha costruito.
2. **Attivazione (licenza).** Un file di licenza firmato elenca i diritti — uno per estensione, ciascuno con la propria scadenza. Un'estensione installata funziona solo finché esiste un diritto utilizzabile.

## La scheda Store

La scheda **Store** funziona senza alcuna configurazione ed elenca le estensioni pubblicate dal fornitore con descrizione e prezzo:

- **Acquista** apre la pagina di pagamento in una nuova scheda del browser. Non appena il pagamento è confermato, la licenza viene applicata automaticamente (una copia arriva anche via e-mail).
- **Installa** (o **Aggiorna** quando è pubblicata una versione più recente) verifica prima la licenza — se l'estensione non è ancora licenziata, una finestra propone di acquistarla o incollare una licenza, poi continua automaticamente — e scarica il pacchetto con esattamente la stessa verifica della firma e la stessa anteprima di simulazione di un caricamento manuale.

La scheda Store è in sola lettura e anonima: nessun account, nessun token, e nulla della tua istanza viene inviato — viene letto solo il catalogo pubblico del fornitore. Le istanze isolate non richiedono alcuna configurazione — la scheda mostra allora semplicemente un avviso cordiale — e usano il flusso basato su file qui sotto; il sito dello store del fornitore offre gli stessi acquisti e download da qualsiasi browser connesso a Internet.

## Installare un'estensione

1. Se non lo hai già fatto, applica prima la licenza (vedi sotto).
2. Apri **Admin → Estensioni**, scegli **Installa da file…** nella scheda Store e carica il file `.teax` ricevuto.
3. Turbo EA verifica la firma e mostra un'**anteprima**: per le estensioni con contenuti è una simulazione di ogni tipo di scheda, gruppo di tag, scheda e relazione che l'estensione creerebbe o aggiornerebbe — non viene ancora scritto nulla.
4. Controlla l'anteprima e premi **Installa estensione**.
5. Se l'estensione contiene codice backend o UI, un avviso chiede di riavviare il container backend (`docker compose restart backend`). Le estensioni di solo contenuto sono attive subito.

Caricare due volte lo stesso pacchetto è sicuro — l'anteprima mostra tutto come «saltato» e l'applicazione non cambia nulla.

## Licenze e rinnovo

Applica una licenza tramite **Inserisci licenza…** nella scheda Installate (incolla il testo o carica il file); il pulsante compare anche su ogni riga di estensione che ne ha bisogno. La pagina mostra quindi l'intestatario e un badge per ogni diritto con la sua scadenza.

Quando un diritto supera la scadenza entra in un **periodo di tolleranza** (30 giorni per impostazione predefinita): tutto continua a funzionare e gli amministratori vedono un avviso. Dopo la tolleranza l'estensione viene **disattivata dolcemente** — le sue pagine spariscono, la sua API rifiuta le richieste, i suoi processi in background si fermano. **Nessun dato viene mai cancellato.** Applicare una licenza rinnovata ripristina tutto all'istante, senza riavvio.

Le licenze acquistate tramite lo Store si rinnovano da sole sulle istanze connesse: dopo ogni pagamento andato a buon fine, l'istanza recupera automaticamente la licenza estesa — niente da incollare. Su un'istanza isolata il rinnovo è: incollare il file di licenza aggiornato ricevuto via e-mail (o richiederlo al fornitore) — nient'altro.

## Abilitare, disabilitare e disinstallare

- L'interruttore **Abilitata** disattiva subito l'estensione (senza riavvio) e può essere riattivato in qualsiasi momento.
- **Disinstalla** rimuove i file dell'estensione. I dati creati — tipi di scheda, schede e le sue tabelle — vengono deliberatamente conservati e ricompaiono in caso di reinstallazione. Serve un riavvio per scaricare completamente il codice backend.

## Permessi

L'intera pagina e tutte le sue rotte API sono protette dal permesso dedicato `admin.manage_extensions` (assegnato al ruolo Admin integrato). Le estensioni possono definire chiavi di permesso proprie (`ext.<nome>.…`), che compaiono in **Admin → Utenti e ruoli** una volta caricata l'estensione.
