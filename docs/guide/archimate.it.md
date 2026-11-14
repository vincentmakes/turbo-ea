# Diagrammi ArchiMate

L'editor **ArchiMate** disegna diagrammi [ArchiMate 3](https://pubs.opengroup.org/architecture/archimate3-doc/) sopra le tue schede: si posizionano gli elementi della notazione standard (Business Process, Application Component, Node e così via), li si collega con le relazioni che il linguaggio consente e, se si vuole, si collega ogni elemento a una scheda dell'inventario. Un diagramma viene salvato come **ArchiMate Model Exchange File** (il formato XML dell'Open Group, versione 3.1), quindi può essere scambiato con altri strumenti ArchiMate.

!!! warning "Stato della versione"
    Questa versione include le fondamenta di ArchiMate come **sandbox per gli amministratori**. Il modulo è disattivato per impostazione predefinita, i diagrammi non compaiono nel menu [Diagrammi](diagrams.md) e non possono ancora essere pubblicati né incorporati. Vedi [Limiti noti](#known-limits).

La prima riga mostra il nome del diagramma, i colori delle card, i dettagli da mostrare e **Sincronizza**. La sincronizzazione aggiorna i dati delle card collegate. I nomi degli elementi ArchiMate restano quelli del diagramma. Nella seconda riga trovate i comandi di disegno, lo zoom, l’esportazione SVG e il pannello delle proprietà. Con **Griglia a punti** potete mostrare o nascondere i puntini sullo sfondo. Il browser ricorda la scelta per ciascun diagramma.

## Attivare il modulo

1. Apri **Admin → Impostazioni** e trova la scheda **Diagrammi ArchiMate** (accanto agli altri interruttori dei moduli).
2. Attivala. La scheda mostra **ArchiMate è attivo**.
3. Puoi disattivarla in qualsiasi momento. I diagrammi vengono conservati; finché il modulo è disattivato le pagine sono irraggiungibili e chi segue un collegamento diretto vede il segnaposto standard «modulo disattivato».

## Aprire la sandbox

Finché il modulo è attivo, i diagrammi ArchiMate si creano e si aprono dalla pagina **Diagrammi** e dalla scheda **Risorse** di ogni card che referenziano. `/admin/architectureStudio` resta l'elenco dei tuoi diagrammi ArchiMate, dove puoi crearli, aprirli ed eliminarli; servono un permesso su almeno un livello ArchiMate e il modulo attivo. Nell'editor, **Indietro** riporta alla pagina da cui sei arrivato.

<!-- Planned screenshot (added with the screenshot capture): 102_archimate_sandbox -->

## Il primo diagramma

1. Nella sandbox scrivi un **Nome** sotto **Nuovo diagramma ArchiMate** e premi **Crea**. Si apre l'editor.
2. **Trascina gli elementi.** La tavolozza elenca i tipi di elemento raggruppati per livello (Strategia, Business, Applicazione, Tecnologia, Fisico, Motivazione, Implementazione e migrazione, Altro). Trascina una voce sull'area di disegno, oppure usa la tastiera: spostati su una voce e premi **Enter** o **Space** per inserire l'elemento al centro dell'area visibile. Un nuovo elemento apre subito il proprio nome in modifica.
3. **Disegna una relazione.** Seleziona un elemento: il riquadro contestuale attorno ad esso offre le voci **Disegna** *relazione*. Scegline una, poi fai clic sull'elemento di destinazione. Si possono collegare solo le coppie che la tabella delle relazioni ArchiMate consente: una voce viene offerta solo se il linguaggio ammette quella relazione da questo elemento verso almeno un tipo di elemento, e una destinazione non ammessa dalla tabella viene rifiutata. Seleziona una connessione per cambiarne il **tipo di accesso** (per Access) o la direzione (per Association).
4. **Collega un elemento a una scheda.** Seleziona l'elemento e usa il riquadro contestuale:
    - **Collega a una scheda** apre un selettore limitato ai tipi di scheda che corrispondono a questo tipo di elemento (vedi [La mappatura](#mapping)).
    - **Crea una scheda** chiede un tipo di scheda e un nome, crea la scheda e la collega in un solo passaggio.
    - **Apri la scheda collegata** e **Scollega la scheda** compaiono quando una scheda è collegata.

    I collegamenti sono sempre espliciti. Rilasciare un elemento **non** crea mai una scheda e rimuovere un elemento dal diagramma (**Rimuovi dal diagramma**) **non** elimina mai una scheda. Al salvataggio l'insieme delle schede a cui il diagramma è collegato viene sincronizzato, come per gli altri diagrammi.
5. **Salva.** L'editor salva da solo tre secondi dopo l'ultima modifica; il pulsante **Salva** salva subito. Lo stato mostra *Salvataggio…*, *Salvato* oppure *Modifiche non salvate*.

!!! warning "Un salvataggio fallito resta visibile"
    Se un salvataggio non riesce, l'errore resta visibile con un pulsante **Riprova**, il diagramma resta contrassegnato come non salvato e nulla viene scartato in silenzio. Lasciare la pagina (chiudere la scheda del browser, usare il pulsante Indietro del browser o aprire un'altra pagina dell'applicazione) con modifiche non salvate o non riuscite chiede prima una conferma.

## La mappatura {#mapping}

La **mappatura** indica a quale concetto ArchiMate corrisponde un tipo di scheda, un sottotipo o un tipo di relazione di Turbo EA. L'editor la legge per decidere quali schede si possono collegare a quale elemento. Ogni tipo di scheda, sottotipo e tipo di relazione porta un tipo di elemento o di relazione ArchiMate; una relazione porta anche un **flag di direzione** (se impostato, la relazione ArchiMate è disegnata dalla scheda di destinazione verso quella di origine: per esempio «Organizzazione *usa* Applicazione» è una relazione ArchiMate *Serving* dall'applicazione all'organizzazione) e, per Access, un **tipo di accesso**.

!!! note
    In questa versione la mappatura è **in sola lettura**: contiene i valori predefiniti riportati sotto. La schermata di amministrazione per modificarla (**ARCHI MAP** in **Admin → Metamodello**) arriverà in seguito. Questa versione non crea né modifica relazioni tra schede a partire da una relazione disegnata.

I nomi degli elementi e delle relazioni sono quelli del formato di scambio dell'Open Group. Un tipo di scheda il cui elemento è vuoto (`—`) non ha una mappatura predefinita, quindi le sue schede non possono essere collegate finché non si imposta un tipo di elemento. Un sottotipo usa la propria mappatura se ne ha una, altrimenti quella del tipo di scheda.

### Tipi di scheda e sottotipi

| Tipo di card | Elemento ArchiMate |
|---|---|
| Obiettivo | `Goal` |
| Obiettivo › Obiettivo di business | `Goal` |
| Obiettivo › Value Gate | `Assessment` |
| Piattaforma | `Grouping` |
| Iniziativa | `WorkPackage` |
| Organizzazione | `BusinessActor` |
| Organizzazione › Regione | `Location` |
| Capacità aziendale | `Capability` |
| Contesto aziendale | — |
| Contesto aziendale › Processo | `BusinessProcess` |
| Contesto aziendale › Flusso di valore | `ValueStream` |
| Contesto aziendale › Percorso del cliente | `BusinessProcess` |
| Contesto aziendale › Prodotto aziendale | `Product` |
| Contesto aziendale › Capacità ESG | `Capability` |
| Processo aziendale | `BusinessProcess` |
| Processo aziendale › Categoria di processo | `BusinessFunction` |
| Processo aziendale › Gruppo di processi | `BusinessFunction` |
| Applicazione | `ApplicationComponent` |
| Interfaccia | `ApplicationInterface` |
| Oggetto dati | `BusinessObject` |
| Componente IT | `Node` |
| Componente IT › Software | `SystemSoftware` |
| Componente IT › Hardware | `Device` |
| Componente IT › SaaS | `TechnologyService` |
| Componente IT › PaaS | `TechnologyService` |
| Componente IT › IaaS | `TechnologyService` |
| Componente IT › Servizio | `TechnologyService` |
| Componente IT › Modello IA | `SystemSoftware` |
| Categoria tecnologica | `Grouping` |
| Fornitore | `BusinessActor` |

### Tipi di relazione

Per una relazione Access, `crud` significa che il tipo di accesso segue i flag Create/Read/Update/Delete della relazione stessa: la sola lettura dà Read, qualsiasi creazione, aggiornamento o eliminazione dà Write, entrambe danno Read/Write e nessuna dà il semplice Access. Le relazioni «succede a» esistono per ogni tipo di scheda che le prevede e corrispondono ad Association, tranne quella di Business Context, che ha una riga propria nella tabella.

| Relazione | Relazione ArchiMate | Nota |
|---|---|---|
| Obiettivo → Capacità aziendale, *migliora* | `Association` | — |
| Piattaforma → Obiettivo, *supporta* | `Influence` | — |
| Piattaforma → Applicazione, *esegue* | `Aggregation` | — |
| Piattaforma → Componente IT, *implementa* | `Aggregation` | — |
| Iniziativa → Obiettivo, *supporta* | `Influence` | — |
| Iniziativa → Piattaforma, *influenza* | `Association` | — |
| Iniziativa → Capacità aziendale, *migliora* | `Association` | — |
| Iniziativa → Applicazione, *influenza* | `Association` | — |
| Iniziativa → Interfaccia, *influenza* | `Association` | — |
| Iniziativa → Oggetto dati, *influenza* | `Association` | — |
| Iniziativa → Componente IT, *influenza* | `Association` | — |
| Organizzazione → Obiettivo, *possiede* | `Association` | — |
| Organizzazione → Iniziativa, *possiede* | `Assignment` | — |
| Organizzazione → Contesto aziendale, *possiede* | `Association` | — |
| Organizzazione → Applicazione, *utilizza* | `Serving` | disegnata dalla destinazione verso l'origine |
| Organizzazione → Componente IT, *possiede* | `Association` | — |
| Applicazione → Capacità aziendale, *supporta* | `Realization` | — |
| Applicazione → Contesto aziendale, *supporta* | `Association` | — |
| Applicazione → Interfaccia, *fornisce / consuma* | `Association` | — |
| Applicazione → Oggetto dati, *CRUD* | `Access` | tipo di accesso dai flag CRUD |
| Applicazione → Componente IT, *utilizza* | `Serving` | disegnata dalla destinazione verso l'origine |
| Componente IT → Categoria tecnologica, *appartiene a* | `Aggregation` | disegnata dalla destinazione verso l'origine |
| Componente IT → Piattaforma, *implementa* | `Aggregation` | disegnata dalla destinazione verso l'origine |
| Interfaccia → Oggetto dati, *trasferisce* | `Association` | — |
| Interfaccia → Componente IT, *utilizza* | `Association` | — |
| Fornitore → Iniziativa, *supporta* | `Association` | — |
| Fornitore → Applicazione, *offre* | `Association` | — |
| Fornitore → Componente IT, *offre* | `Association` | — |
| Contesto aziendale → Capacità aziendale, *è associato a* | `Association` | — |
| Processo aziendale → Capacità aziendale, *supporta* | `Realization` | — |
| Processo aziendale → Applicazione, *è supportato da* | `Serving` | disegnata dalla destinazione verso l'origine |
| Processo aziendale → Oggetto dati, *utilizza* | `Access` | tipo di accesso dai flag CRUD |
| Processo aziendale → Componente IT, *utilizza* | `Serving` | disegnata dalla destinazione verso l'origine |
| Processo aziendale → Processo aziendale, *dipende da* | `Association` | — |
| Processo aziendale → Processo aziendale, *richiama* | `Triggering` | — |
| Processo aziendale → Organizzazione, *appartiene a* | `Assignment` | disegnata dalla destinazione verso l'origine |
| Processo aziendale → Iniziativa, *è influenzato da* | `Association` | — |
| Processo aziendale → Obiettivo, *supporta* | `Influence` | — |
| Processo aziendale → Contesto aziendale, *realizza* | `Realization` | — |
| Obiettivo → Contesto aziendale, *è obiettivo per* | `Association` | — |
| Contesto aziendale → Contesto aziendale, *succede a* | `Triggering` | disegnata dalla destinazione verso l'origine |

Fai clic con il tasto destro su una linea e scegli **Retto** o **Ortogonale**. La linea mantiene il percorso scelto quando sposti un nodo e dopo il salvataggio e la riapertura del diagramma.

## Il file Exchange {#exchange-file}

La barra degli strumenti offre **Esporta come file Exchange** e **Importa un file Exchange**, oltre a **Esporta come SVG** per un'immagine.

- **Esporta** scarica il diagramma come ArchiMate Model Exchange File (`.xml`, formato 3.1).
- **Importa** sostituisce tutto il contenuto del diagramma aperto, dopo una conferma (**Sostituire il diagramma?**). I diagrammi creati con altri strumenti (come Archi) si possono leggere se seguono il formato dell'Open Group.
- I file oltre 5 MB vengono rifiutati, così come quelli con una dichiarazione DOCTYPE o di entità.

**Cosa non viene mantenuto all'importazione:**

- **Cartelle** (la sezione `organizations`): vengono scartate e l'editor te lo segnala.
- **Note, gruppi e connessioni semplici** provenienti da altri strumenti: le etichette e i contenitori senza un elemento dietro, e le connessioni senza una relazione, vengono ignorati.
- **Tipi di proprietà diversi da string**: ogni definizione di proprietà viene letta come stringa.
- **Altre lingue di un nome**: per ogni elemento, relazione e vista si mantiene un solo nome.
- Caratteri e altri stili oltre l'essenziale non vengono mantenuti.

## Verificare il modello

Il pulsante **Verifica il modello** nella barra degli strumenti invia il diagramma corrente al server, che lo convalida secondo le regole di scambio dell'Open Group ed elenca ogni problema trovato (al massimo 100). Ogni messaggio ha un codice; il simbolo `…` rappresenta il nome o l'identificatore interessato:

| Code | Messaggio |
|---|---|
| `too_large` | Il modello supera i 5 MB. |
| `xml_invalid` | Il modello non è un XML ben formato. |
| `dtd_forbidden` | Le dichiarazioni DOCTYPE e di entità non sono consentite. |
| `wrong_root` | L'elemento radice non è un modello ArchiMate. |
| `missing_identifier` | Un elemento, una relazione o un nodo del diagramma non ha un identificatore. |
| `unknown_element_type` | Tipo di elemento sconosciuto: … |
| `unknown_relationship_type` | Tipo di relazione sconosciuto: … |
| `unknown_access_type` | Tipo di accesso sconosciuto su … |
| `duplicate_identifier` | Identificatore duplicato: … |
| `dangling_source` | La relazione … parte da qualcosa che non esiste. |
| `dangling_target` | La relazione … termina su qualcosa che non esiste. |
| `relationship_not_allowed` | ArchiMate non consente la relazione …: né tra questi due elementi, né da una relazione a sé stessa. |
| `dangling_element_ref` | Il nodo del diagramma … mostra un elemento che non esiste. |
| `dangling_relationship_ref` | La connessione del diagramma … mostra una relazione che non esiste. |
| `connection_endpoint_mismatch` | La connessione del diagramma … non collega i nodi della sua relazione. |

La verifica delle relazioni rifiuta anche una relazione che punta a un'altra relazione, a meno che non sia una Association, Aggregation o Composition. Se non c'è nulla da segnalare, la finestra dice **Nessun problema trovato.**

## Scorciatoie da tastiera

Premi **Scorciatoie da tastiera** nella barra degli strumenti per vedere l'elenco. Fai prima clic sull'area di disegno perché abbia il focus.

| Azione | Scorciatoia |
|--------|-------------|
| Annulla | `Ctrl+Z` |
| Ripeti | `Ctrl+Y` / `Ctrl+Shift+Z` |
| Copia | `Ctrl+C` |
| Incolla | `Ctrl+V` |
| Elimina | `Delete` / `Backspace` |
| Rinomina | `F2` / `Enter` |
| Seleziona tutto | `Ctrl+A` |
| Ingrandisci | `Ctrl++` |
| Riduci | `Ctrl+-` |
| Adatta allo schermo | `Ctrl+0` |

Sulla tavolozza, `Enter` o `Space` su una voce con il focus inserisce quell'elemento.

## Limiti noti {#known-limits}

- **Per ogni file si modifica una sola vista.** Se un file importato contiene più viste, si modifica la prima e le altre vengono mantenute intatte al salvataggio.
- **Le relazioni tra relazioni** (una Association, Aggregation o Composition che punta a un'altra relazione) vengono lette e scritte e il controllo le accetta, ma non vengono disegnate.
- **Disegnare una relazione richiede il mouse.** Con la tastiera si possono inserire gli elementi, ma non collegarli.
- **Gli inserimenti da tastiera si sovrappongono.** Ogni elemento inserito con `Enter` o `Space` finisce al centro dell'area visibile, quindi gli inserimenti successivi si sovrappongono finché non li sposti.
- **Ancora nessuna pubblicazione.** I diagrammi ArchiMate non possono essere pubblicati né incorporati e non compaiono nel menu **Diagrammi**; si raggiungono dall'elenco della sandbox o dalla scheda **Risorse** di una card che li referenzia.
- **Le giunzioni non hanno etichetta.** Una giunzione And o Or è un semplice punto.
- La mappatura è in sola lettura (vedi [La mappatura](#mapping)) e le cartelle vengono scartate all'importazione (vedi [Il file Exchange](#exchange-file)).

---

ArchiMate® è un marchio registrato di The Open Group. Turbo EA disegna la notazione ArchiMate e non è certificato da The Open Group.
