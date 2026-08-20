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

Quando il catalogo include categorie, ogni elemento mostra piccole pillole (free o commercial, più temi come integration) e sopra l'elenco compare una barra di filtri — fai clic sulle pillole per restringerlo (più pillole si combinano) e **All** ripristina la vista.

La scheda Store è in sola lettura e anonima: nessun account, nessun token, e nulla della tua istanza viene inviato — viene letto solo il catalogo pubblico del fornitore. Le istanze isolate non richiedono alcuna configurazione — la scheda mostra allora semplicemente un avviso cordiale — e usano il flusso basato su file qui sotto; il sito dello store del fornitore offre gli stessi acquisti e download da qualsiasi browser connesso a Internet. Se qualcosa tra la tua istanza e lo store blocca la richiesta — un proxy, un firewall o una protezione anti-bot davanti allo store —, la scheda lo segnala e indica lo stato HTTP ricevuto, così un'istanza bloccata non viene mai scambiata per una isolata.

L'istanza **controlla inoltre il catalogo una volta al giorno** e segnala i cambiamenti, così una nuova estensione — o una correzione di sicurezza per una già in uso — non deve attendere che qualcuno apra per caso questa pagina. Gli amministratori (chiunque abbia un ruolo che concede `admin.manage_extensions`) ricevono una notifica nella campanella quando una nuova estensione viene pubblicata nello store e un'altra quando un'estensione installata ha una versione più recente. Ogni cambiamento viene annunciato una sola volta e una giornata di rilasci intensa arriva come una notifica per tipo anziché una per estensione. Non viene scaricato né installato nulla: la notifica ti porta semplicemente qui. Il controllo giornaliero può essere disattivato del tutto in [Admin → Impostazioni → Notifiche di aggiornamento](settings.md#update-notifications).

## Prove

Alcune estensioni a pagamento offrono una **prova gratuita di 30 giorni** — cerca il pulsante **Avvia la prova di 30 giorni** nella scheda Store (o l'opzione di prova sul sito web dello store). Avviare una prova funziona come un acquisto senza pagamento: non serve alcuna carta di credito, la licenza si aggiorna automaticamente (una copia arriva anche via e-mail per le installazioni isolate) e l'estensione funziona con tutte le funzionalità per 30 giorni.

- Ogni istanza Turbo EA può provare una determinata estensione **una sola volta**.
- Una prova termina esattamente alla data di fine — non c'è periodo di tolleranza. L'estensione smette quindi di funzionare finché non ti abboni; **i tuoi dati non vengono mai eliminati** e tutto torna nel momento in cui viene applicata una licenza in abbonamento.
- La scheda «Installate» mostra i diritti di prova come **Prova fino al …**.
- Le prove terminano da sole — non c'è nulla da annullare e non viene mai addebitato nulla.

## Installare un'estensione

1. Se non lo hai già fatto, applica prima la licenza (vedi sotto).
2. Apri **Admin → Estensioni**, scegli **Installa da file…** nella scheda Store e carica il file `.teax` ricevuto.
3. Turbo EA verifica la firma e mostra un'**anteprima**: per le estensioni con contenuti è una simulazione di ogni tipo di scheda, gruppo di tag, scheda e relazione che l'estensione creerebbe o aggiornerebbe — non viene ancora scritto nulla.
4. Controlla l'anteprima e premi **Installa estensione**.
5. Se l'estensione contiene codice backend, un avviso chiede di riavviare il container backend (`docker compose restart backend`). Le estensioni di contenuto e di interfaccia sono attive subito — gli utenti vedono la nuova interfaccia al prossimo caricamento della pagina.

Caricare due volte lo stesso pacchetto è sicuro — l'anteprima mostra tutto come «saltato» e l'applicazione non cambia nulla.

## Aggiornare un'estensione

Quando lo store pubblica una versione più recente di un'estensione installata, la scheda Installate mostra un chip **Aggiorna a X** accanto alla versione (e il pulsante della scheda Store diventa **Aggiorna**). Un clic esegue la stessa verifica della firma, la stessa anteprima e la stessa applicazione di una nuova installazione. Valgono due protezioni:

- Aggiornare un'estensione che hai deliberatamente **disattivato** la lascia disattivata: la nuova versione arriva su disco, ma i suoi contenuti restano nascosti e nulla viene eseguito finché non la riattivi.
- Installare un pacchetto **più vecchio** della versione installata richiede prima una conferma esplicita: un downgrade potrebbe non comprendere i dati scritti dalla versione più recente. In nessun caso viene eliminato qualcosa.

## Licenze e rinnovo

Applica una licenza tramite **Inserisci licenza…** nella scheda Installate (incolla il testo o carica il file); il pulsante compare anche su ogni riga di estensione che ne ha bisogno. La pagina mostra quindi l'intestatario e un badge per ogni diritto con la sua scadenza.

La tua istanza mantiene **una sola licenza alla volta** — applicarne una nuova sostituisce la precedente. Le licenze emesse dallo Store contengono sempre tutti gli acquisti effettuati per la tua istanza, quindi la sostituzione è sicura. Se possiedi anche licenze emesse manualmente, chiedi al tuo fornitore una licenza combinata invece di applicare file per singola estensione; se una licenza applicata rimuovesse diritti ancora coperti da quella attuale, Turbo EA li elenca e chiede prima conferma (in nessun caso vengono eliminati dati).

Quando un diritto supera la scadenza entra in un **periodo di tolleranza** (30 giorni per impostazione predefinita): tutto continua a funzionare e gli amministratori vedono un avviso. Dopo la tolleranza l'estensione viene **disattivata dolcemente** — le sue pagine spariscono, la sua API rifiuta le richieste, i suoi processi in background si fermano. **Nessun dato viene mai cancellato.** Applicare una licenza rinnovata ripristina tutto all'istante, senza riavvio.

Le licenze acquistate tramite lo Store si rinnovano da sole sulle istanze connesse: dopo ogni pagamento andato a buon fine, l'istanza recupera automaticamente la licenza estesa — niente da incollare. Su un'istanza isolata il rinnovo è: incollare il file di licenza aggiornato ricevuto via e-mail (o richiederlo al fornitore) — nient'altro.

### Stato del rinnovo automatico e disdetta

Ogni chip di entitlement dice cosa accade alla sua data: **Si rinnova il {data}** per un abbonamento attivo, oppure **Scade il {data} — non sarà rinnovato** dopo una disdetta. L'informazione proviene dalla licenza firmata stessa, quindi è corretta anche sulle istanze isolate — il file di licenza inviato via e-mail dopo ogni modifica dell'abbonamento porta lo stato aggiornato; incollalo e il chip è attuale.

Per vedere la data di rinnovo, disdire o ripristinare il rinnovo automatico, cambiare il metodo di pagamento o scaricare le fatture, usa **Gestisci abbonamento** accanto al nome del licenziatario (visibile per le licenze acquistate nello Store). Apre il tuo portale di fatturazione in una nuova scheda — nessun account necessario. Su un'istanza isolata il pulsante non può raggiungere lo store; usa invece il link **Gestisci abbonamento** presente in ogni e-mail di licenza (serve Internet solo al tuo browser, non alla tua istanza Turbo EA).

La disdetta non spegne mai nulla immediatamente: l'estensione continua a funzionare fino alla fine del periodo pagato, poi si applica il normale flusso di tolleranza + disattivazione morbida. **I tuoi dati non vengono mai eliminati**, e riabbonarsi ripristina tutto.

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

## Grant di accesso ai dati

La maggior parte delle estensioni lavora solo con i propri dati. Un'estensione che si integra con i dati del core — ad esempio un connettore che sincronizza i todo con un task tracker esterno come Jira o MS Planner ([#921](https://github.com/vincentmakes/turbo-ea/discussions/921)) — deve dichiarare dei **grant** nel proprio manifest firmato:

- `core.todos.read` / `core.todos.write` — leggere o modificare i todo tramite l'SDK delle estensioni. La scrittura include la lettura. Sui todo di sistema (come le richieste di firma) un'estensione di sincronizzazione può solo impostare il riferimento esterno mostrato come chip — non può mai completarli, modificarli, riassegnarli o eliminarli, e i todo di un'altra estensione restano intoccabili.
- `core.events.todo` — ricevere gli eventi di modifica dei todo, così un connettore reagisce subito invece di attendere il prossimo ciclo di polling.
- `core.users.read` — consultare gli utenti (solo nome, e-mail e stato attivo) così che un connettore possa abbinare gli assegnatari agli account dello strumento esterno. Nessun dato su ruoli, accessi o preferenze viene esposto, e le estensioni non possono mai modificare gli utenti.
- `core.cards.read` — leggere schede, relazioni e il metamodello, ad esempio perché un connettore possa abbinare le vostre applicazioni ai record di un sistema esterno. Le schede archiviate restano fuori dalla vista.
- `core.cards.write` — creare, aggiornare o archiviare schede e aggiungere relazioni, con esattamente la stessa validazione applicata dall'editor dell'app. Gli aggiornamenti uniscono i valori dei campi invece di sostituirli, così un'estensione non può mai cancellare dati che non gestisce, e **non esiste l'eliminazione definitiva** — l'archiviazione, con la sua finestra di ripristino, è l'unica rimozione possibile per un'estensione.
- `core.events.card` — ricevere gli eventi di modifica di schede e relazioni, così che un connettore reagisca subito ai cambiamenti dell'inventario invece di attendere il prossimo ciclo di polling.

I grant fanno parte del bundle firmato dal fornitore: sono fissati al momento del confezionamento e visibili prima dell'installazione. Valgono solo finché l'estensione è installata, abilitata e con licenza — disabilitarla o lasciar scadere la licenza revoca l'accesso immediatamente, senza riavvio. Ogni modifica fatta da un'estensione è registrata in **Admin → Log di audit** con origine **Estensione**, e un todo replicato da un tracker esterno mostra un chip che rimanda all'elemento esterno.

Ogni modifica fatta da un'estensione compare in **Admin → Registro di audit** come batch `ext:<chiave>` con le differenze campo per campo, e da lì può essere annullata come qualsiasi altro batch. Gli operatori hanno l'ultima parola: la variabile d'ambiente `EXTENSION_WRITES_ENABLED=false` sospende all'istante tutte le scritture delle estensioni (le letture continuano, senza riavvio), e `EXTENSION_MAX_WRITES_PER_BATCH` / `EXTENSION_MAX_BATCHES_PER_MINUTE` limitano quanto una singola estensione può cambiare per batch e al minuto.

## Dove compaiono le pagine delle estensioni

Le pagine delle estensioni compaiono nella navigazione una volta che l'estensione è installata e provvista di licenza — di solito come una propria voce di menu di primo livello, anche se alcuni report vengono collocati sotto il menu **Report** accanto a quelli integrati.
