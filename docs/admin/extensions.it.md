# Estensioni

Lo **store delle estensioni** (Admin → Estensioni) installa estensioni firmate dal fornitore che aggiungono funzionalità specifiche del cliente — contenuti aggiuntivi del metamodello, integrazioni, processi in background e persino nuove pagine — senza modificare il core di Turbo EA (principio «clean core»).

Le estensioni si installano in due modi: **con un clic dallo Store integrato** (se l'istanza ha accesso a Internet) oppure **caricando direttamente i file** — l'estensione è un pacchetto `.teax` firmato e la licenza un file di testo firmato, entrambi inviati tipicamente via e-mail. Il flusso basato su file non richiede account dello store né connessione in uscita, quindi funziona in modo identico su istanze **isolate (air-gapped)**.

La pagina ha due schede: **Store** sfoglia il catalogo delle estensioni del fornitore con installazione a un clic, mentre **Installate** gestisce le licenze e installa da file.

**Le estensioni sono realizzate e firmate da Turbo EA** — non sono auto-sviluppate né aperte a terzi. Se ti serve una funzionalità su misura per la tua organizzazione, possiamo realizzarla e concederla in licenza per te. Vedi [la consulenza Turbo EA](https://www.turbo-ea.org/consulting).

## Come funziona la fiducia

Due verifiche indipendenti proteggono l'istanza:

1. **Provenienza (firma).** Ogni pacchetto porta una firma Ed25519 della chiave del fornitore. Turbo EA la verifica al caricamento *e di nuovo a ogni avvio del backend*. I pacchetti non firmati, manomessi o di terzi vengono rifiutati — un'estensione installata è garantita essere esattamente ciò che il fornitore ha costruito.
2. **Attivazione (licenza).** Un file di licenza firmato elenca i diritti — uno per estensione, ciascuno con la propria scadenza. Un'estensione installata funziona solo finché esiste un diritto utilizzabile. Le licenze sono **vincolate all'ID della tua istanza** — una licenza emessa per un'altra istanza viene rifiutata.

## Estensioni gratuite

Alcune estensioni sono **gratuite** e non richiedono alcuna licenza. Si installano e funzionano subito: nessun passaggio di acquisto e nessun file di licenza da incollare. Le estensioni gratuite sono contrassegnate da un'etichetta **Gratis** nelle schede Store e Installate, e le azioni **Acquista** e **Rinnova** sono nascoste per esse. Il controllo della firma continua ad applicarsi esattamente come per le estensioni a pagamento (anche un'estensione gratuita è firmata dal fornitore), quindi la provenienza è garantita in ogni caso. Poiché non richiedono alcun diritto, le estensioni gratuite non scadono mai e non entrano mai in un periodo di tolleranza.

## L'ID della tua istanza

Ogni installazione genera una sola volta un **ID istanza** univoco (`TEA-XXXX-XXXX-XXXX`), mostrato in cima ad Admin → Estensioni con un pulsante di copia. È la tua identità di licenza: indicalo all'acquisto (lo Store integrato lo invia automaticamente; il checkout dello store online lo richiede) così ogni estensione acquistata per questa istanza — da qualsiasi amministratore, con qualsiasi e-mail — confluisce in un'unica licenza combinata. Identifica soltanto la tua istanza; non è mai una credenziale, quindi puoi condividerlo con il fornitore senza rischi.

L'ID viaggia con un trasferimento del workspace, quindi il passaggio a un nuovo host mantiene valida la licenza. Dopo una **reinstallazione completa** l'istanza riceve un nuovo ID — chiedi al fornitore di riemettere la licenza per quello (un rapido «re-key» da parte sua).

## La scheda Store

La scheda **Store** funziona senza alcuna configurazione ed elenca le estensioni pubblicate dal fornitore con descrizione e prezzo:

- **Acquista** apre la pagina di pagamento in una nuova scheda del browser. Non appena il pagamento è confermato, la licenza viene applicata automaticamente (una copia arriva anche via e-mail).
- **Installa** (o **Aggiorna** quando è pubblicata una versione più recente) verifica prima la licenza — se l'estensione non è ancora licenziata, una finestra propone di acquistarla o incollare una licenza, poi continua automaticamente — e scarica il pacchetto con esattamente la stessa verifica della firma e la stessa anteprima di simulazione di un caricamento manuale. Le estensioni con demo mostrano un link **Guardalo in azione**, e una versione più recente pubblicata trasforma il pulsante in **Aggiorna**.

La scheda Store è in sola lettura e anonima: nessun account, nessun token, e nulla della tua istanza viene inviato — viene letto solo il catalogo pubblico del fornitore. Le istanze isolate non richiedono alcuna configurazione — la scheda mostra allora semplicemente un avviso cordiale — e usano il flusso basato su file qui sotto; il sito dello store del fornitore offre gli stessi acquisti e download da qualsiasi browser connesso a Internet.

## Installare un'estensione

1. Se non lo hai già fatto, applica prima la licenza (vedi sotto).
2. Apri **Admin → Estensioni**, scegli **Installa da file…** nella scheda Store e carica il file `.teax` ricevuto.
3. Turbo EA verifica la firma e mostra un'**anteprima**: per le estensioni con contenuti è una simulazione di ogni tipo di scheda, gruppo di tag, scheda e relazione che l'estensione creerebbe o aggiornerebbe — non viene ancora scritto nulla.
4. Controlla l'anteprima e premi **Installa estensione**.
5. Se l'estensione contiene codice backend, un avviso chiede di riavviare il container backend (`docker compose restart backend`). Le estensioni di contenuto e di interfaccia sono attive subito — gli utenti vedono la nuova interfaccia al prossimo caricamento della pagina.

Caricare due volte lo stesso pacchetto è sicuro — l'anteprima mostra tutto come «saltato» e l'applicazione non cambia nulla.

## Licenze e rinnovo

Applica una licenza tramite **Inserisci licenza…** nella scheda Installate (incolla il testo o carica il file); il pulsante compare anche su ogni riga di estensione che ne ha bisogno. La pagina mostra quindi l'intestatario e un badge per ogni diritto con la sua scadenza.

Quando un diritto supera la scadenza entra in un **periodo di tolleranza** (30 giorni per impostazione predefinita): tutto continua a funzionare e gli amministratori vedono un avviso. Dopo la tolleranza l'estensione viene **disattivata dolcemente** — le sue pagine spariscono, la sua API rifiuta le richieste, i suoi processi in background si fermano. **Nessun dato viene mai cancellato.** Applicare una licenza rinnovata ripristina tutto all'istante, senza riavvio.

Le licenze acquistate tramite lo Store si rinnovano da sole sulle istanze connesse: dopo ogni pagamento andato a buon fine, l'istanza recupera automaticamente la licenza estesa — niente da incollare. Su un'istanza isolata il rinnovo è: incollare il file di licenza aggiornato ricevuto via e-mail (o richiederlo al fornitore) — nient'altro.

## Abilitare, disabilitare e disinstallare

- L'interruttore **Abilitata** disattiva subito l'estensione (senza riavvio) e può essere riattivato in qualsiasi momento. Per i pacchetti di contenuto questo nasconde i loro tipi di scheda dal metamodello — le schede restano dove sono.
- **Disinstalla** rimuove i file dell'estensione e nasconde i suoi tipi di scheda dal metamodello. Le schede e le tabelle proprie dell'estensione vengono deliberatamente conservate, e tutto — tipi inclusi — ricompare in caso di reinstallazione.

## Permessi

L'intera pagina e tutte le sue rotte API sono protette dal permesso dedicato `admin.manage_extensions` (assegnato al ruolo Admin integrato). Le estensioni possono definire chiavi di permesso proprie (`ext.<nome>.…`), che compaiono in **Admin → Utenti e ruoli** una volta caricata l'estensione.

## Funzionalità di campo avanzate

Alcune estensioni sbloccano modi avanzati di descrivere i tuoi dati che il core non offre da solo:

- **Testo di aiuto del campo** — una guida comprimibile mostrata sotto un campo durante l'inserimento dei dati, così che un modulo si spieghi da sé.
- **Tipi di campo personalizzati** — nuovi tipi oltre a quelli integrati (ad esempio una valutazione configurabile da 1 a 5 o da 0 a 10).

Queste opzioni compaiono nell'editor dei campi del metamodello **solo finché l'estensione che le fornisce è installata e provvista di licenza**. Se tale estensione viene in seguito disattivata o la sua licenza scade, i valori già inseriti continuano a essere mostrati come testo di sola lettura — nulla viene svuotato o eliminato — e le opzioni di modifica scompaiono semplicemente finché l'estensione non è di nuovo attiva.

## Dove compaiono le pagine delle estensioni

Le pagine delle estensioni compaiono nella navigazione una volta che l'estensione è installata e provvista di licenza — di solito come una propria voce di menu di primo livello, anche se alcuni report vengono collocati sotto il menu **Report** accanto a quelli integrati.
