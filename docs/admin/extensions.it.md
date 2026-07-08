# Estensioni

Lo **store delle estensioni** (Admin → Estensioni) installa estensioni firmate dal fornitore che aggiungono funzionalità specifiche del cliente — contenuti aggiuntivi del metamodello, integrazioni, processi in background e persino nuove pagine — senza modificare il core di Turbo EA (principio «clean core»).

Tutto viene consegnato come file: l'estensione è un pacchetto `.teax` firmato e la licenza un file di testo firmato, entrambi inviati tipicamente via e-mail. Non servono attivazione online, account dello store né connessioni in uscita: il flusso funziona quindi in modo identico su istanze **isolate (air-gapped)**.

## Come funziona la fiducia

Due verifiche indipendenti proteggono l'istanza:

1. **Provenienza (firma).** Ogni pacchetto porta una firma Ed25519 della chiave del fornitore. Turbo EA la verifica al caricamento *e di nuovo a ogni avvio del backend*. I pacchetti non firmati, manomessi o di terzi vengono rifiutati — un'estensione installata è garantita essere esattamente ciò che il fornitore ha costruito.
2. **Attivazione (licenza).** Un file di licenza firmato elenca i diritti — uno per estensione, ciascuno con la propria scadenza. Un'estensione installata funziona solo finché esiste un diritto utilizzabile.

## Installare un'estensione

1. Se non lo hai già fatto, applica prima la licenza (vedi sotto).
2. Apri **Admin → Estensioni**, scegli **Installa estensione** e carica il file `.teax` ricevuto.
3. Turbo EA verifica la firma e mostra un'**anteprima**: per le estensioni con contenuti è una simulazione di ogni tipo di scheda, gruppo di tag, scheda e relazione che l'estensione creerebbe o aggiornerebbe — non viene ancora scritto nulla.
4. Controlla l'anteprima e premi **Installa estensione**.
5. Se l'estensione contiene codice backend o UI, un avviso chiede di riavviare il container backend (`docker compose restart backend`). Le estensioni di solo contenuto sono attive subito.

Caricare due volte lo stesso pacchetto è sicuro — l'anteprima mostra tutto come «saltato» e l'applicazione non cambia nulla.

## Licenze e rinnovo

Incolla il testo della licenza ricevuto (o carica il file) nella scheda **Licenza**. La pagina mostra quindi l'intestatario e un badge per ogni diritto con la sua scadenza.

Quando un diritto supera la scadenza entra in un **periodo di tolleranza** (30 giorni per impostazione predefinita): tutto continua a funzionare e gli amministratori vedono un avviso. Dopo la tolleranza l'estensione viene **disattivata dolcemente** — le sue pagine spariscono, la sua API rifiuta le richieste, i suoi processi in background si fermano. **Nessun dato viene mai cancellato.** Applicare una licenza rinnovata ripristina tutto all'istante, senza riavvio.

Il rinnovo su un'istanza isolata è quindi: richiedere al fornitore un nuovo file di licenza (via e-mail) e incollarlo — nient'altro.

## Abilitare, disabilitare e disinstallare

- L'interruttore **Abilitata** disattiva subito l'estensione (senza riavvio) e può essere riattivato in qualsiasi momento.
- **Disinstalla** rimuove i file dell'estensione. I dati creati — tipi di scheda, schede e le sue tabelle — vengono deliberatamente conservati e ricompaiono in caso di reinstallazione. Serve un riavvio per scaricare completamente il codice backend.

## Store online (opzionale)

Se il fornitore gestisce uno store online delle estensioni, puoi collegarti invece di scambiare file. Dopo un acquisto ricevi un **codice di attivazione** monouso: apri **Admin → Estensioni → Store**, inserisci l'URL dello store e il codice. L'istanza elenca quindi i pacchetti a cui hai diritto con **installazione** a un clic, e **Aggiorna licenza** recepisce all'istante rinnovi e nuovi acquisti — i pacchetti scaricati passano esattamente per la stessa verifica della firma e la stessa anteprima dei caricamenti manuali. Le istanze isolate semplicemente non si collegano mai; il flusso basato su file resta pienamente supportato.

## Permessi

L'intera pagina e tutte le sue rotte API sono protette dal permesso dedicato `admin.manage_extensions` (assegnato al ruolo Admin integrato). Le estensioni possono definire chiavi di permesso proprie (`ext.<nome>.…`), che compaiono in **Admin → Utenti e ruoli** una volta caricata l'estensione.
