# GRC

Il modulo **GRC** riunisce Governance, Rischio e Conformità in un unico spazio di lavoro a `/grc`. Consolida attività che prima vivevano tra Consegna EA e TurboLens, in modo che un'architetta, un proprietario di rischio e un revisore di conformità lavorino su un terreno comune.

!!! note
    Il modulo GRC può essere abilitato o disabilitato da un amministratore nelle [Impostazioni](../admin/settings.md). Quando disabilitato, la navigazione e le funzionalità GRC sono nascoste.

GRC ha tre schede:

Puoi puntare direttamente a una scheda con `/grc?tab=governance`, `/grc?tab=risk` o `/grc?tab=compliance`.

![GRC — scheda Governance](../assets/img/it/52_grc_governance.png)

## Governance

La scheda Governance si divide in due **sotto-schede**, deep-linkabili tramite `/grc?tab=governance&sub=principles` (predefinita) e `/grc?tab=governance&sub=decisions`:

### Principi

Visualizzatore in sola lettura dei Principi EA pubblicati nel metamodello (enunciato, motivazione, implicazioni). Il catalogo si modifica da **Amministrazione → Metamodello → Principi**.

### Decisioni

![GRC — sotto-scheda Decisioni](../assets/img/it/52a_grc_decisioni.png)

La sotto-scheda Decisioni è il **registro principale degli Architecture Decision Records (ADR)** — ogni ADR a livello di landscape, indipendentemente dall'iniziativa a cui è collegato. Sostituisce la vecchia scheda Decisioni di EA Delivery, dissolta con l'arrivo del modulo GRC.

Gli ADR documentano importanti decisioni architetturali insieme al loro contesto, alle conseguenze e alle alternative considerate. Le decisioni emesse dalla procedura guidata TurboLens Architect arrivano qui come bozze da approvare.

Il registro risponde innanzitutto a una domanda: **quali decisioni sono in vigore oggi?** Ogni decisione firmata ha una [vigenza](#standing) che Turbo EA ricava dalle sue date, dalle sue revisioni e dalle altre decisioni che agiscono su di essa, e la griglia elenca solo la revisione corrente di ogni decisione, a meno che non chiediate anche quelle precedenti.

La griglia può anche essere **raggruppata per stato** o **per vigenza** tramite il pulsante *Raggruppa per* accanto alla casella di ricerca: ogni stato o vigenza si comprime sotto la propria intestazione (raggruppando per stato, ogni esito della revisione ha il proprio gruppo), e la casella di controllo nell'intestazione seleziona l'intero gruppo per un'esportazione in blocco.

#### Stato e vigenza {: #standing }

Una decisione ha due stati distinti:

- Lo **Stato** è il workflow di firma, ed è ciò su cui agite: **Bozza** → **In Revisione** (firme richieste) → **Firmato**. Una decisione presa al di fuori di Turbo EA e [registrata come presa](#recording-a-past-decision) mostra **Registrato** al posto di Firmato.
- La **Vigenza** indica la situazione odierna di una decisione firmata o registrata. È derivata — mai impostata a mano — e una bozza o una decisione in revisione non ne ha alcuna (*Non ancora firmata*).

Una bozza può anche portare un **esito della revisione**, che indica come si è conclusa senza firma la sua ultima revisione. Compare al posto di *Bozza* sul chip di stato e un banner sulla decisione indica chi, quando e perché (*Rifiutata da Ada Lovelace il 27 nov 2026: …*):

| Esito | Significato |
|-------|-------------|
| **Modifiche richieste** | Un firmatario ha rimandato indietro la decisione per la rielaborazione. È una bozza modificabile; l'etichetta scompare quando vengono richieste di nuovo le firme |
| **Rifiutata** | Un firmatario ha rifiutato la decisione. È **chiusa** |
| **Ritirata** | Il lato dell'autore ha ritirato la decisione. È **chiusa** |

Una decisione **chiusa** resta registrata ma è bloccata come una in revisione: solo le sue card collegate e i suoi [diagrammi](#decision-diagrams) possono ancora cambiare, e il suo autore non può inviarla in revisione, registrarla, ripristinarla o eliminarla (eliminarla richiede il permesso `adr.delete`). Per lavorarci di nuovo, cliccate su **Riaprire**, che la rende una semplice bozza. Il registro nasconde le decisioni chiuse finché non si attiva **Mostra chiuse**. Una bozza la cui ultima revisione è stata rifiutata prima della versione 2.221.0 — quando un rifiuto riportava ancora la decisione in bozza — riporta **Modifiche richieste**.

Il ciclo di vita è fisso: i tre stati, le sei vigenze e i tre esiti sono gli stessi in ogni spazio di lavoro e non possono essere configurati, né da un amministratore né da un'estensione.

| Vigenza | Significato |
|---------|-------------|
| **Programmata** | Firmata, ma la data *In vigore dal* non è ancora arrivata |
| **In vigore** | Firmata ed efficace |
| **In vigore (modificata)** | In vigore, e un'altra decisione firmata la modifica; la modifica non è ancora integrata in una [revisione consolidata](#amendments-and-consolidated-revisions) |
| **Sostituita** | Una revisione successiva della stessa decisione, o una decisione che la sostituisce, è entrata in vigore |
| **Revocata** | Una decisione firmata che la revoca è entrata in vigore |
| **Scaduta** | La sua data *Valida fino al* è passata (è in vigore fino a quel giorno compreso) |

La pagina della decisione ne indica il motivo con un banner — *Questa decisione è stata sostituita da …*, *Questa decisione entra in vigore il …*, *La revisione 3 entra in vigore il …* — con un collegamento alla decisione interessata.

#### Colonne della tabella

La griglia ADR rispecchia il layout della griglia Inventario:

| Colonna | Descrizione |
|---------|-------------|
| **N. rif.** | Numero di riferimento generato automaticamente (ADR-001, ADR-002, …) con un punto di stato; una revisione successiva alla prima aggiunge il proprio numero (ADR-012 · Rev. 2) |
| **Stato** | Chip colorato — Bozza, In Revisione, Firmato o Registrato, oppure l'esito della revisione (Modifiche richieste, Rifiutata, Ritirata) di una bozza che ne ha uno |
| **Vigenza** | La situazione odierna di una decisione firmata — vedere [Stato e vigenza](#standing); vuota finché non è firmata |
| **Titolo** | Titolo dell'ADR |
| **Decisione** | Estratto in testo semplice della decisione |
| **Card collegate** | Pillole colorate corrispondenti al colore del tipo di ogni card collegata |
| **Creato da** | Autore dell'ADR |
| **Creato** | Data di creazione |
| **Modificato** | Data di ultima modifica |
| **Firmato** | Data di firma |
| **Firmato da** | Una pillola per ogni firmatario che ha firmato |
| **Decisa il** / **In vigore dal** / **Valida fino al** | Le [date](#decision-dates) della decisione |
| **Decisori** | Le persone che hanno preso la decisione |

Ogni colonna dispone di un **filtro di intestazione** — filtri di testo sulle colonne testuali, filtri di data sulle colonne di data — ciascuno con il proprio pulsante **Ripristina**. Non appena un filtro di colonna è attivo, nella barra degli strumenti della griglia compare il pulsante **Cancella filtri di colonna** per cancellarli tutti in una volta. Larghezza, ordine e ordinamento delle colonne e i filtri attivi vengono memorizzati per browser.

#### Barra laterale dei filtri

La barra laterale persistente a sinistra ha due schede:

- **Filtri** — filtri a faccette sull'elenco degli ADR:
    - **In vigore** — un clic mostra solo le decisioni in vigore oggi (In vigore e In vigore (modificata)); un secondo clic lo disattiva
    - **Mostra revisioni precedenti** — disattivato per impostazione predefinita, così ogni decisione compare una sola volta, come revisione corrente (più un'eventuale revisione in fase di redazione). Attivatelo per elencare anche le revisioni precedenti; il pulsante **Esporta** segue la stessa impostazione
    - **Mostra chiuse** — disattivato per impostazione predefinita, così le decisioni rifiutate e ritirate restano da parte. Attivatelo per elencarle anch'esse
    - **Tipi di card** — caselle di controllo con punti colorati che filtrano per tipi di card collegate
    - **Card collegate** — filtra per card collegate specifiche
    - **Stato** — Bozza / In Revisione / Firmato (una decisione registrata conta come firmata)
    - **Vigenza** — Programmata / In vigore / In vigore (modificata) / Sostituita / Revocata / Scaduta / Non ancora firmata
    - **Esito** — Modifiche richieste / Rifiutata / Ritirata / Nessun esito. Scegliere **Rifiutata** o **Ritirata** elenca quelle decisioni anche con **Mostra chiuse** disattivato
    - **Firmato da** — filtra per firmatario
    - **Data di creazione / modifica / firma / della decisione** — intervalli di date da/a (**Data della decisione** corrisponde alla data *Decisa il* di una decisione firmata o registrata)
- **Colonne** — scegliete quali colonne della griglia sono visibili. **N. rif.** e **Titolo** sono sempre mostrati; **Ripristina** ripristina la selezione predefinita. La scelta viene memorizzata per browser.

Usate la barra del **filtro rapido** per la ricerca full-text. Fate clic destro su una riga per un menu contestuale (**Modifica**, **Anteprima**, **Duplica**, **Elimina** e, su una decisione chiusa, **Riaprire** per chi ha `adr.manage`). **Elimina** è offerto su una bozza; su una decisione chiusa, solo a chi ha `adr.delete`.

#### Esportare e importare le decisioni {: #decisions-import }

**Esporta** (accanto a **+ Nuova decisione**) scarica come file `.xlsx` le decisioni attualmente mostrate dalla barra laterale dei filtri, una riga per revisione di decisione. Le colonne, nell'ordine: `reference_number`, `title`, `status`, `revision_number`, le quattro sezioni (`context`, `decision`, `consequences`, `alternatives_considered`) come testo semplice, `cards` e `related_decisions` (separate da punto e virgola), `author`, `signatories`, `signed_at`, `created_at`, `updated_at`, poi i dati propri del registro — `standing` (come chiave, ad esempio `in_force`), `decided_on`, `effective_from`, `valid_until`, `decision_makers`, `participants`, e i collegamenti tipizzati `replaces`, `amends`, `revokes` e `consolidates` come riferimenti. La formattazione, come il grassetto o i collegamenti, non viene riportata nel foglio di calcolo, e ogni riga di una tabella in una sezione viene scritta su una sola riga, con le celle separate da ` | `. Per condividere decisioni con tutta la formattazione, seleziona le righe nella griglia e usa il pulsante **Export** della griglia, che genera un documento Word.

**Importa** crea decisioni in blocco da un file `.xlsx`. Fai clic su **Scarica il modello** per ottenere una cartella di lavoro di partenza, compila una decisione per riga e caricala:

- Ogni riga diventa una nuova decisione in **bozza** con il successivo riferimento `ADR-NNN`. Stato e firme non vengono mai importati — una decisione viene firmata tramite il **workflow di firma** — e l'anteprima segnala una riga il cui `status` non sia bozza (draft).
- Una riga il cui `reference_number` appartiene già a una decisione viene **saltata**: l'importazione non modifica mai una decisione esistente, quindi reimportare un'esportazione non cambia nulla.
- `title` è obbligatorio. Nelle quattro colonne delle sezioni, una riga vuota inizia un nuovo paragrafo, le righe che iniziano con `- ` diventano un elenco puntato e quelle che iniziano con `1. ` un elenco numerato.
- `cards` collega le schede tramite il nome esatto, tra quelle che puoi vedere; una scheda non trovata, o il cui nome è condiviso da più schede, viene saltata con un avviso e la decisione viene comunque importata.
- `related_decisions` elenca riferimenti, sia di decisioni esistenti sia di altre righe dello stesso file (anche righe successive); ognuno diventa un collegamento **È correlata a**. Un riferimento con più revisioni si collega a quella corrente.
- Tutte le altre colonne — vigenza, date, persone e collegamenti tipizzati compresi — vengono ignorate: un'importazione crea bozze, mai decisioni firmate o registrate.
- Un'esportazione contiene una riga per revisione, quindi un file può contenere più righe per lo stesso riferimento (una revisione aperta, o le revisioni precedenti quando **Mostra revisioni precedenti** è attivo). Sull'istanza di provenienza vengono saltate tutte; altrove viene importata solo la riga con il `revision_number` più alto (l'ultima riga quando i numeri sono uguali o mancanti) e ogni altra riga viene saltata con l'avviso *Revisione precedente di ADR-012 saltata*. Una voce di `related_decisions` che indica quel riferimento si collega alla riga importata.

L'anteprima mostra quante righe verranno create, saltate e quante falliranno, con ogni errore e avviso elencato per riga; nulla viene scritto finché non confermi. L'importazione richiede il permesso `adr.manage`.

#### Creare un ADR

Gli ADR possono essere creati da tre punti — tutti aprono lo stesso editor e alimentano lo stesso registro:

1. **GRC → Governance → Decisioni**: cliccate su **+ Nuovo ADR**, compilate il titolo e opzionalmente collegate card (incluse le iniziative).
2. **Spazio di lavoro EA Delivery**: selezionate un'iniziativa, cliccate su **+ Nuovo artefatto ▾** in alto (oppure **+ Aggiungi** nella sezione *Decisioni di Architettura*) e scegliete **Nuova Decisione di Architettura** — l'iniziativa è pre-collegata.
3. **Card → scheda Risorse**: cliccate su **Crea ADR** — la card corrente è pre-collegata.

In tutti i casi potete cercare e collegare card aggiuntive durante la creazione. Le iniziative sono collegate attraverso lo stesso meccanismo di collegamento di card di qualsiasi altra card, quindi un ADR può fare riferimento a più iniziative. L'editor si apre con sezioni per **Contesto**, **Decisione**, **Conseguenze** e **Alternative considerate**.

#### L'editor ADR

L'editor fornisce:

- Editing di testo ricco per ogni sezione (Contesto, Decisione, Conseguenze, Alternative considerate): grassetto, corsivo, sottolineato, barrato, **Codice in linea**, un'**Intestazione** e una **Sottointestazione**, elenchi puntati e numerati, citazioni, un **Blocco di codice** per un comando o un estratto di configurazione (mantenuto su righe proprie in un carattere a spaziatura fissa) e divisori
- **Link** — collegate il testo selezionato a una pagina web o a un indirizzo e-mail (vedere [Link nel testo](#decision-text-links))
- **Tabelle** — inserite e modificate una tabella in una sezione (vedere [Tabelle](#decision-tables))
- **Menzioni** — digitate **@** in una sezione per menzionare una card o un'altra decisione (vedere [Menzioni](#decision-mentions))
- **Immagini** — inserite uno screenshot o un diagramma in una sezione (vedere [Immagini](#decision-pictures))
- **Discussione** — un pannello accanto al documento con la sua discussione (vedere [Discussione](#decision-discussion))
- **Cronologia** — un pulsante in cima alla pagina che apre la sequenza temporale della decisione e le sue versioni salvate (vedere [Cronologia](#decision-history))
- Collegamento di card — collegate l'ADR alle card pertinenti (applicazioni, componenti IT, iniziative, …). Le iniziative sono collegate tramite la funzionalità standard di collegamento di card, non tramite un campo dedicato, consentendo a un ADR di fare riferimento a più iniziative
- **Date** — *Decisa il*, *In vigore dal* e un *Valida fino al* facoltativo (vedere [Date](#decision-dates))
- **Persone** — i *Decisori* e i *Partecipanti* (vedere [Persone](#decision-people))
- **Questa decisione…** — collegamenti tipizzati ad altre decisioni (vedere [Collegamenti tra decisioni](#decision-links))
- **Riepilogo delle modifiche** — solo su una revisione: che cosa è cambiato in questa revisione e perché
- **File allegati** — documenti allegati alla decisione (vedere [File allegati](#decision-files))
- **Diagrammi** — diagrammi del modulo Diagrammi allegati alla decisione (vedere [Diagrammi](#decision-diagrams))

#### Immagini {: #decision-pictures }

Ognuna delle quattro sezioni può contenere immagini — uno screenshot, un diagramma esportato, la foto di una lavagna. Cliccate su **Inserisci immagine** nella barra degli strumenti della sezione e scegliete un file, incollate un'immagine dagli appunti oppure trascinate un file immagine sulla sezione. L'immagine viene caricata al momento dell'inserimento e appare su una riga a sé.

- **Ridimensionare.** Trascinate l'angolo di un'immagine per ridimensionarla: le sue proporzioni vengono mantenute.
- **Allineare.** Selezionate l'immagine e cliccate su **Allinea a sinistra**, **Allinea al centro** o **Allinea a destra** nella barra degli strumenti.
- **Formati.** PNG, JPEG, GIF e WebP, fino a 5 MB per immagine. Un'immagine più grande viene rifiutata, non ridotta. SVG non è accettato.
- **Dove appare.** Le immagini appaiono nell'[anteprima](#preview), nella copia PDF / stampata e nell'esportazione Word. Nella [Cronologia](#decision-history) una versione mostra le sue immagini, e **Modifiche** segnala un'immagine aggiunta o rimossa come *[Immagine]*. Una revisione, un duplicato e una versione ripristinata mantengono le immagini del testo da cui provengono.
- **Solo immagini caricate qui.** Una decisione mantiene solo le immagini caricate nelle decisioni. Un'immagine che rimanda a un altro sito web, o una copiata da un SoAW, viene rimossa quando la decisione viene salvata.
- **I commenti** nella [discussione](#decision-discussion) non accettano immagini.
- **Quando il caricamento di file è disattivato.** Il pulsante **Inserisci immagine**, l'incolla e il trascinamento delle immagini scompaiono quando un amministratore ha [disattivato il caricamento di file](../admin/resources.md#when-file-uploads-are-disabled). Le immagini già presenti nel testo restano visibili.

#### Link nel testo {: #decision-text-links }

Selezionate alcune parole e fate clic su **Link** nella barra degli strumenti della sezione, oppure premete **Ctrl+K** (**Cmd+K** su Mac), per collegarle. Digitate l'**Indirizzo** e fate clic su **Applica**. Se non è selezionato nulla, la finestra di dialogo chiede anche il **Testo da visualizzare**; se lo lasciate vuoto, viene mostrato l'indirizzo stesso. Un indirizzo web o e-mail digitato o incollato nel testo diventa automaticamente un link.

- **Cosa può essere un link.** Indirizzi web (`http://`, `https://`) e indirizzi e-mail (`mailto:`). Un indirizzo senza schema viene completato: `example.com` diventa `https://example.com` e `ann@example.com` un link e-mail. Qualsiasi altra cosa — un altro schema, o un indirizzo interno a Turbo EA come `/cards/…` — viene rifiutata con *Inserire un indirizzo web (https://…) o un indirizzo e-mail*.
- **Modificare o rimuovere un link.** Posizionate il cursore nel link e fate di nuovo clic su **Link** o premete Ctrl/Cmd+K: la finestra di dialogo si apre con l'indirizzo già compilato e offre anche **Rimuovi link** e **Apri in una nuova scheda**.
- **Seguire un link.** Durante la modifica, un clic su un link vi posiziona il cursore, così lo si può modificare come qualsiasi altro testo; **Ctrl+clic** (**Cmd+clic** su Mac) lo apre in una nuova scheda. Nell'anteprima, nella cronologia e in una decisione bloccata o firmata, un clic lo apre in una nuova scheda.
- **Ctrl/Cmd+K.** All'interno di una sezione che state modificando, la scorciatoia apre la finestra di dialogo del link invece della [ricerca globale](inventory.md); altrove apre ancora la ricerca.
- **I commenti** nella [discussione](#decision-discussion) accettano link allo stesso modo.
- **Dove compaiono.** I link restano cliccabili nell'anteprima, nella copia PDF / stampata e nell'esportazione Word. Nella [Cronologia](#decision-history), **Modifiche** segnala come modifica un indirizzo di link cambiato.

#### Tabelle {: #decision-tables }

Ognuna delle quattro sezioni può contenere tabelle. Fate clic su **Tabella** nella barra degli strumenti della sezione e scegliete **Inserisci tabella**: viene inserita una tabella di tre righe e tre colonne, la cui prima riga è una riga di intestazione. Una cella contiene testo come il resto della sezione: formattazione, link, menzioni e immagini vi funzionano.

Le azioni di una tabella si raggiungono in tre modi, e ognuno agisce sulla cella che contiene il cursore o sulle celle che avete selezionato:

- **Il menu Tabella della barra degli strumenti** — con il cursore in una tabella, **Tabella** elenca tutte le azioni descritte sotto.
- **Clic destro** in una cella — le stesse azioni si aprono in corrispondenza del puntatore.
- **Le maniglie** attorno alla tabella — una maniglia accanto a una riga o sopra una colonna apre le azioni di quella riga o colonna, e un **+** ne inserisce una (vedere *Maniglie* più sotto).

Le azioni:

- **Seleziona riga** e **Seleziona colonna** selezionano l'intera riga o colonna del cursore, o di ogni cella selezionata.
- **Aggiungi riga sopra**, **Aggiungi riga sotto**, **Aggiungi colonna prima** e **Aggiungi colonna dopo**. **Aggiungi riga sopra** non è disponibile nella riga di intestazione: una nuova riga va sempre sotto di essa.
- **Sposta riga su**, **Sposta riga giù**, **Sposta colonna prima** e **Sposta colonna dopo** spostano la riga o la colonna di una posizione e la mantengono selezionata. Uno spostamento non è disponibile al bordo della tabella, attraverso la riga di intestazione, con più di una riga o colonna selezionata, né in una tabella in cui una cella unita si estende su più righe (per le righe) o su più colonne (per le colonne).
- **Elimina riga** ed **Elimina colonna** eliminano ogni riga o colonna della selezione e ne indicano il numero (*Elimina 2 righe*). Una tabella conserva almeno una riga e una colonna: con tutte le righe selezionate **Elimina riga** non è disponibile, e con tutte le colonne selezionate non lo è **Elimina colonna**.
- **Riga di intestazione** attiva o disattiva la formattazione di intestazione della prima riga.
- **Unisci celle** unisce le celle che avete selezionato trascinandovi sopra, e **Dividi cella** divide di nuovo una cella unita.
- **Elimina tabella**.

Prima e dopo seguono il senso di lettura: in una lingua che si scrive da destra a sinistra, la colonna prima è quella a destra.

**Maniglie.** Durante la modifica, la tabella ha attorno un margine stretto che ospita le sue maniglie. Compaiono per la cella sotto il puntatore e, mentre lavorate nella sezione, per la cella che contiene il cursore:

- **Una maniglia di riga** accanto alla riga e **una maniglia di colonna** sopra la colonna. Un clic seleziona la riga o la colonna e ne apre le azioni: per una riga **Aggiungi riga sopra**, **Aggiungi riga sotto**, **Sposta riga su**, **Sposta riga giù**, **Elimina riga** e, sulla prima riga, **Riga di intestazione**; per una colonna **Aggiungi colonna prima**, **Aggiungi colonna dopo**, **Sposta colonna prima**, **Sposta colonna dopo** ed **Elimina colonna**. Un clic destro su una maniglia fa lo stesso. Su una cella unita la maniglia rappresenta ogni riga o colonna su cui la cella si estende, e il suo menu lo indica (*Elimina 2 righe*).
- **Un +** sul bordo inferiore di una riga inserisce una riga sotto di essa, e **un +** sul bordo finale di una colonna inserisce una colonna dopo di essa. L'ultima riga e l'ultima colonna hanno invece le barre.
- **Una barra** sotto l'ultima riga aggiunge una riga alla fine, e **una barra** dopo l'ultima colonna aggiunge una colonna alla fine.

Una riga o colonna aggiunta in questo modo porta il cursore nella sua prima cella, e un solo annullamento la rimuove. Su uno schermo touch le maniglie sono più grandi e compaiono per la cella che avete toccato.

**Il menu del clic destro.** Un clic destro in una cella apre le azioni della tabella in corrispondenza del puntatore. Se il clic avviene all'interno di celle che avete selezionato, la selezione viene mantenuta, così le azioni si applicano a tutte; altrove, il cursore si sposta prima nella cella cliccata.

- **Maiusc+clic destro** apre invece il menu proprio del browser, per i suoi suggerimenti ortografici o **Incolla**.
- Un clic destro su un **link** o su un'**immagine** in una cella apre anch'esso il menu del browser, per aprirli o copiarli.
- Su uno schermo touch, una pressione prolungata seleziona il testo come di consueto; lì usate le maniglie.
- Da tastiera, **Maiusc+F10** o il tasto **Menu** apre lo stesso menu sulla cella del cursore.

**Tastiera.** **Tab** passa alla cella successiva e **Maiusc+Tab** alla precedente; Tab nell'ultima cella aggiunge una riga. Il menu **Tabella** della barra degli strumenti raggiunge ogni azione da tastiera; le maniglie sono pensate per il puntatore e il touch e non fanno parte dell'ordine di tabulazione.

**Larghezze e tabelle larghe.** Trascinate il bordo tra due colonne per cambiarne la larghezza. Una tabella più larga della sezione scorre lateralmente; la maniglia di una riga esce allora dalla vista insieme alla prima colonna, mentre il menu del clic destro e il menu **Tabella** della barra degli strumenti raggiungono comunque ogni azione.

Una decisione bloccata o firmata mostra le sue tabelle senza maniglie, e un clic destro lì apre il menu del browser.

- **Dove compaiono.** Le tabelle compaiono nell'[anteprima](#preview) e nella [Cronologia](#decision-history), dove **Modifiche** legge ogni riga della tabella come una sola riga, con le celle separate da ` | `. Nella copia PDF / stampata una tabella mantiene le proporzioni delle sue colonne e si adatta alla larghezza della pagina. L'esportazione Word scrive una vera tabella Word, con le sue celle unite, le larghezze delle colonne e una riga di intestazione ripetuta in cima a ogni pagina.
- **I commenti** nella [discussione](#decision-discussion) non accettano tabelle: una tabella incollata in un commento diventa il testo delle sue celle.

#### Date {: #decision-dates }

- **Decisa il** — il giorno in cui la decisione è stata presa. Non può essere nel futuro.
- **In vigore dal** — il giorno in cui entra in vigore. Fino ad allora una decisione firmata è **Programmata**.
- **Valida fino al** — facoltativa, per una decisione a tempo determinato come una deroga. Il giorno successivo la decisione è **Scaduta**. Non può essere precedente a *In vigore dal*, né già passata quando la decisione viene inviata per la revisione.

Se lasciate vuote, *Decisa il* e *In vigore dal* assumono la data della firma finale. Il rinnovo di una decisione scaduta è una nuova revisione o una nuova decisione, firmata come qualsiasi altra.

#### Persone {: #decision-people }

I **Decisori** sono le persone che hanno preso la decisione; i **Partecipanti** sono le persone che vi hanno preso parte. Scegliete un utente di Turbo EA, oppure digitate un nome e premete Invio per qualcuno che non ha un account. Entrambi sono registrati separatamente dai **firmatari**, che approvano il record in Turbo EA. Quando richiedete le firme, **Aggiungi decisori** nella finestra di dialogo aggiunge con un solo clic ai firmatari ogni decisore che è un utente di Turbo EA.

#### Collegamenti tra decisioni {: #decision-links }

La sezione **Questa decisione…** di una decisione la collega ad altre. Scegliete il tipo di collegamento e la decisione, e aggiungete facoltativamente una nota per un caso parziale — ad esempio *solo la sezione 3*:

| Collegamento | Mostrato sull'altra decisione come | Effetto quando questa decisione è firmata ed efficace |
|--------------|------------------------------------|-------------------------------------------------------|
| **Sostituisce** | Sostituita da | L'altra decisione diventa **Sostituita** |
| **Modifica** | Modificata da | L'altra decisione diventa **In vigore (modificata)** |
| **Revoca** | Revocata da | L'altra decisione diventa **Revocata** |
| **È correlata a** | Correlata a | Nessuno — un riferimento incrociato |

I collegamenti sono mostrati su entrambe le decisioni e puntano alla revisione corrente della decisione. Agiscono sull'intera decisione, tutte le sue revisioni comprese, e solo quando la decisione che li porta è firmata ed efficace: una bozza che ne revoca un'altra non cambia nulla finché non è firmata, e una con una data *In vigore dal* successiva agisce a quella data (l'altra decisione indica *Questa decisione sarà revocata da … il …*). Una decisione non può collegarsi a una delle proprie revisioni, e ogni decisione a cui si collega deve essere firmata prima che venga inviata per la revisione o registrata.

Questi sono collegamenti tra decisioni; per i link a pagine web nel testo di una sezione, vedere [Link nel testo](#decision-text-links).

#### Revocare o sostituire una decisione

Una decisione firmata non viene mai ritirata a mano: viene revocata o sostituita da un'altra decisione firmata, così il registro conserva chi l'ha decisa e quando. Aprite la decisione firmata e usate il menu **Revisiona**:

- **Revisiona questa decisione** — una nuova revisione della stessa decisione, con lo stesso riferimento (vedere [Revisioni](#revisions)).
- **Sostituisci con una nuova decisione** — una nuova bozza intitolata *Sostituisce: …* che porta già un collegamento **Sostituisce** e le stesse card collegate.
- **Revoca** — una nuova bozza intitolata *Revoca di ADR-012 — …* che porta già un collegamento **Revoca** e le stesse card collegate.

Completate la nuova bozza e inviatela al workflow di firma come qualsiasi altra decisione. Il menu non è disponibile su una revisione precedente (aprite quella corrente) né su una decisione già revocata o sostituita. Quando una decisione firmata ne sostituisce, modifica o revoca un'altra, l'autore di quest'ultima riceve una notifica **Vigenza ADR modificata**.

#### Modifiche e revisioni consolidate {: #amendments-and-consolidated-revisions }

Una decisione modificata da un'altra resta in vigore, e la sua pagina elenca le decisioni che la modificano. Per offrire ai lettori un unico testo aggiornato, cliccate su **Crea revisione consolidata** in quel banner: viene avviata una revisione della decisione modificata che indica la decisione modificante (*Consolida la modifica di …*). Integrate la modifica nel testo, descrivetela nel **Riepilogo delle modifiche** e inviate la revisione per la firma. Una volta firmata ed efficace, la decisione torna **In vigore**, e la decisione modificante mostra *La modifica apportata da questa decisione è consolidata in …*. Una modifica smette di contare anche quando la decisione modificante viene revocata, sostituita o scade — ma non quando viene semplicemente revisionata: la sua revisione mantiene la modifica, e il banner indica la revisione corrente della decisione modificante.

#### File allegati {: #decision-files }

La sezione **File allegati** allega documenti a una decisione — un verbale firmato, un'analisi di supporto. I file accettano gli stessi formati degli [allegati delle card](card-details.md#resources-tab), fino a 20 MB ciascuno, e possono essere caricati solo mentre il caricamento di file è abilitato (eliminarne uno è sempre possibile). Possono essere aggiunti ed eliminati solo su una bozza salvata: una volta che la decisione è inviata per la revisione, sono bloccati insieme a essa. Una revisione riprende i file della sua decisione.

#### Diagrammi {: #decision-diagrams }

La sezione **Diagrammi**, dopo **File allegati**, allega a una decisione diagrammi del modulo [Diagrammi](diagrams.md) — ad esempio il diagramma di contesto di cui tratta la decisione. Fate clic su **Allega diagramma**, cercate nell'elenco e sceglietene uno; viene allegato subito, senza salvare. Ogni diagramma allegato mostra la sua miniatura e il suo nome, e un clic lo apre. Per staccarne uno, fate clic sul suo pulsante di rimozione e confermate: il diagramma stesso viene mantenuto.

- **Sempre il diagramma attuale.** La decisione rimanda al diagramma, non ne conserva una copia: mostra sempre il diagramma com'è adesso, anche dopo la firma della decisione. Eliminare il diagramma lo rimuove da ogni decisione a cui era allegato, comprese quelle firmate.
- **Quando può cambiare.** I diagrammi possono essere allegati e staccati finché la decisione è una bozza o è in revisione. Una volta firmata la decisione, sono fissati: per cambiarli, create una nuova revisione.
- **Chi li vede.** Per vedere la sezione serve il permesso di visualizzare i diagrammi (`diagrams.view`); per allegare e staccare serve anche `adr.manage`. Un lettore senza `diagrams.view` non vede alcuna sezione Diagrammi. Anche una decisione che non può essere modificata e non ha diagrammi non mostra la sezione.
- **Dove compaiono.** L'[anteprima](#preview) mostra i diagrammi in sola lettura; la copia PDF / stampata e l'esportazione Word ne elencano i nomi. Una revisione e un duplicato riportano i diagrammi. I diagrammi non fanno parte di una versione della [Cronologia](#decision-history).

#### Workflow di firma {: #sign-off-workflow }

Gli ADR supportano un processo formale di firma:

1. Create l'ADR con stato **Bozza**.
2. Cliccate su **Richiedi firme** e cercate i firmatari per nome o e-mail (oppure cliccate su **Aggiungi decisori**). Le firme possono essere richieste solo da una bozza.
3. L'ADR passa a **In Revisione** — ogni firmatario riceve una notifica e un Todo.
4. I firmatari esaminano e cliccano su **Firma**, **Richiedere modifiche** o **Rifiutare**.
5. Quando tutti i firmatari hanno firmato, l'ADR passa automaticamente allo stato **Firmato**.

**Una decisione in revisione è bloccata**, così i firmatari firmano esattamente ciò che è stato loro inviato: il testo, le date, le persone, i collegamenti ad altre decisioni, i file e i pannelli delle estensioni sono in sola lettura, e solo le card collegate e i [diagrammi](#decision-diagrams) allegati possono ancora cambiare. Per modificarla, cliccate su **Ritirare le firme**, che la riporta in bozza.

Un firmatario in sospeso che non firma ha due possibilità, ciascuna con un motivo (fino a 4.000 caratteri) di cui vengono notificati tutti gli altri firmatari e l'autore:

- **Richiedere modifiche** rimanda indietro la decisione per la rielaborazione: torna a essere una bozza modificabile, con lo stesso numero di revisione, contrassegnata come **Modifiche richieste**. Modificatela e richiedete di nuovo le firme; l'etichetta scompare allora. Fino alla versione 2.221.0 era ciò che faceva **Rifiutare**.
- **Rifiutare** chiude la decisione: resta una bozza, contrassegnata come **Rifiutata**, ed è bloccata finché qualcuno non la riapre. Basta un solo firmatario per rifiutare.

Lato autore, chi ha `adr.manage` può **Ritirare** una bozza salvata o una decisione in revisione, con un motivo: le richieste di firma in sospeso vengono annullate, i loro firmatari notificati e la decisione viene chiusa, contrassegnata come **Ritirata**. **Riaprire** riporta una decisione rifiutata o ritirata a una semplice bozza che può essere modificata e inviata di nuovo in revisione. Ogni passaggio compare nella sequenza temporale della [Cronologia](#decision-history).

Gli ADR firmati sono bloccati e non possono essere modificati — per apportare modifiche create una nuova revisione.

#### Registrare una decisione passata {: #recording-a-past-decision }

Una decisione presa al di fuori di Turbo EA — ad esempio in una riunione del consiglio prima che il registro esistesse — può essere inserita come presa senza raccogliere firme. Redigetela come bozza, indicate almeno un decisore, quindi cliccate su **Registra come decisa** e fornite la data **Decisa il** (non nel futuro) e, se diversa, la data **In vigore dal** (per impostazione predefinita è la data della decisione).

La decisione viene quindi bloccata come una decisione firmata e riceve la sua vigenza, ma il suo stato è **Registrato**, e la sua pagina indica *Registrata da … il …, non firmata in Turbo EA*. La registrazione richiede il permesso `adr.record`, che per impostazione predefinita ha solo il ruolo Admin, e ogni registrazione compare nel [registro Sicurezza e amministrazione](../admin/audit-log.md) come `admin.adr.recorded`. Anche una bozza di revisione può essere registrata, purché la sua data di decisione non sia precedente a quella della revisione precedente.

#### Revisioni {: #revisions }

Aprite un ADR firmato e scegliete **Revisiona → Revisiona questa decisione** per creare una nuova bozza basata sulla versione firmata. La revisione mantiene il riferimento della decisione e prende il numero di revisione successivo — **ADR-012 · Rev. 2** — ed eredita il contenuto, le card collegate, i diagrammi allegati, i collegamenti **È correlata a**, le persone, i file e la data *Valida fino al*. Non eredita le date di decisione e di entrata in vigore, i firmatari, il riepilogo delle modifiche né i collegamenti sostituisce / modifica / revoca, che restano sulla revisione che li ha creati. Ogni revisione conserva la propria traccia di firma.

- **Una sola revisione aperta alla volta.** Mentre una revisione è in fase di redazione, la revisione corrente lo segnala e il menu **Revisiona** apre quella bozza invece di avviarne un'altra.
- **La revisione corrente è quella in vigore.** Quando una revisione è firmata ed efficace, quelle precedenti diventano **Sostituite** e mostrano un banner con un collegamento a quella corrente. La striscia **Revisioni** su ogni revisione elenca l'intera catena e contrassegna quella corrente.
- **Solo la revisione corrente può essere revisionata**, e non più una volta che la decisione è stata revocata o sostituita. Una decisione scaduta o modificata può ancora essere revisionata.
- **Un rifiuto non conta come revisione**: il numero di revisione cambia solo quando viene creata una nuova revisione.
- **Una revisione rifiutata o ritirata resta la revisione aperta.** Continua a bloccare una nuova revisione della sua decisione, e il menu **Rivedi** la nomina (*Apri la revisione in corso di stesura (ADR-012 · Rev 3, Rifiutata)*). Per riprovare, apritela e cliccate su **Riaprire**; oppure eliminatela per avviare una nuova revisione.
- Le decisioni revisionate prima della versione 2.199.0 mantengono i numeri di riferimento con cui sono state emesse, e si leggono comunque come un'unica decisione con un'unica striscia di revisioni.

#### Anteprima {: #preview }

Cliccate sull'icona di anteprima per visualizzare una versione in sola lettura e formattata dell'ADR — utile per la revisione prima della firma. Mostra anche i diagrammi allegati, e i suoi link si aprono in una nuova scheda.

Dall'anteprima, fate clic su **PDF** per aprire una copia pronta per la stampa in una nuova scheda — metadati e date, le quattro sezioni, persone, schede collegate, collegamenti ad altre decisioni, nomi dei file, nomi dei diagrammi, sezioni delle estensioni e blocco firme (o la riga di registrazione), con approvatore e data di stampa a piè di pagina. L'editor ha lo stesso pulsante **PDF** più **Word**, che scarica la decisione come `.docx` finché non è firmata; entrambi esportano lo stato corrente dell'editor, modifiche non salvate comprese. Nel documento Word la formattazione e i link sono mantenuti ovunque — anche in elenchi, citazioni e intestazioni —, i link sono cliccabili, il codice mantiene un carattere a spaziatura fissa e le tabelle sono vere tabelle Word.

#### Discussione {: #decision-discussion }

Ogni decisione ha la propria **Discussione**, così una decisione può essere definita in Turbo EA anziché in una chat separata. Apritela con il pulsante della discussione nell'editor o nell'anteprima della decisione: su uno schermo largo si apre come pannello accanto al documento, su uno più stretto come pannello a scomparsa. Il titolo del pannello mostra quanti thread sono aperti. La [Cronologia](#decision-history) della decisione non si trova in questo pannello: si apre dal pulsante **Cronologia** in cima alla pagina.

- **Thread e risposte.** Scrivete nella casella in cima al pannello e fate clic su **Pubblica** (oppure premete Ctrl+Invio, Cmd+Invio su un Mac) per avviare un thread. Per associarlo a una sezione, fate clic su uno dei chip di sezione sopra la casella — *Contesto*, *Decisione*, *Alternative considerate* o *Conseguenze*; fate di nuovo clic sul chip scelto per togliere l'associazione. Un thread senza sezione è un thread generale. Ogni thread accetta risposte, su un solo livello; un thread conserva la sezione con cui è stato avviato, e il suo chip di sezione compare in cima al thread.
- **Filtrare per sezione.** Non appena un thread ha una sezione, una riga di chip in cima alla discussione elenca ogni sezione che ha thread, con il loro numero (*Decisione (2)*), e un chip **Generale** quando alcuni thread non hanno sezione. Fate clic su un chip per mostrare solo i suoi thread; attivatene diversi per vedere i thread di ciascuno di essi, fate di nuovo clic su uno per disattivarlo, oppure fate clic su **Azzera**. Un clic sul chip di sezione di un thread attiva il relativo filtro. Il filtro funziona con i thread risolti raccolti o meno e con le revisioni precedenti mostrate, e conta solo i thread elencati. Non viene conservato quando lasciate il documento, e un thread aperto da una notifica viene sempre mostrato.
- **Discussione su una sezione.** Ogni sezione mostra una piccola icona di chat accanto alla sua intestazione, nell'editor e nell'anteprima, per le persone che possono commentare (chi può solo leggere la vede soltanto sulle sezioni che hanno thread): il numero di thread aperti quando la sezione ha una discussione, oppure un'icona attenuata quando sono tutti risolti. Fate clic su di essa per aprire la discussione filtrata su quella sezione, con i thread risolti espansi quando nessuno di essi è aperto e la sezione già selezionata per un nuovo commento (l'icona non viene mai stampata né esportata).
- **Risolvere e riaprire.** Fate clic su **Risolvi** quando un thread è definito e su **Riapri** se non lo è. I thread risolti vengono raccolti dietro **Mostra N thread risolti**.
- **Formattazione.** Un commento accetta grassetto, corsivo, barrato, **Codice in linea**, elenchi puntati e numerati, citazioni e [link](#decision-text-links) (il pulsante **Link** o Ctrl/Cmd+K). Intestazioni, blocchi di codice, immagini e tabelle vanno nelle sezioni, non nei commenti.
- **Chi può pubblicare.** La lettura della discussione segue chi può aprire la decisione (`adr.view`). Pubblicare, rispondere, risolvere e riaprire richiedono il permesso `adr.comment`, che membri e amministratori hanno per impostazione predefinita e i visualizzatori no; un amministratore può modificarlo per ruolo. I firmatari della decisione possono sempre commentarla, comprese le persone a cui è stato chiesto di firmarla in un precedente giro di revisione ritirato o rifiutato.
- **Durante la revisione e dopo la firma.** Il [blocco durante la revisione](#workflow-di-firma) riguarda il contenuto, non la conversazione: la discussione resta aperta mentre la decisione è in revisione e dopo che è stata firmata.
- **Note di revisione.** Quando un firmatario rifiuta una decisione, il motivo apre un thread contrassegnato **Motivo del rifiuto** (*Nessun motivo indicato* se il firmatario lo ha lasciato vuoto), a cui si risponde e che si risolve come qualsiasi altro; una richiesta di modifiche ne apre uno contrassegnato **Modifiche richieste**. Il motivo di un ritiro è conservato sulla decisione e nella Cronologia, non nella discussione. Un firmatario può aggiungere una nota facoltativa al momento della firma; compare nella discussione come **Nota di firma**. Nessuna delle due va più persa quando le firme vengono ritirate, ed entrambe sono mostrate anche nella [Cronologia](#decision-history).
- **Thread aperti prima della revisione.** **Richiedi firme**, **Firma**, **Richiedere modifiche**, **Rifiutare** e **Ritirare** avvisano quando la decisione ha ancora thread aperti (*2 thread di discussione aperti su questo documento.*). È solo un avviso: nulla viene bloccato.
- **Notifiche.** Un nuovo commento notifica l'autore della decisione, i suoi firmatari, i suoi decisori e partecipanti che sono utenti di Turbo EA e le persone che hanno già commentato — mai chi lo ha pubblicato. Digitate **@** in un commento per menzionare un collega: riceverà invece una notifica di menzione. Una persona menzionata che non può aprire la decisione non viene avvisata, e il pannello ve lo segnala (*… non sono stati notificati: non possono aprire questo documento.*). Le notifiche non contengono il testo del commento, e un clic su una di esse apre l'anteprima della decisione con il pannello su quel thread. Vedere [Notifiche](notifications.md#tipi-di-notifica).
- **Modifica ed eliminazione.** Potete modificare i vostri commenti; un commento modificato è contrassegnato *(modificato)*. Potete eliminare i vostri commenti, e chiunque possa modificare la decisione (`adr.manage`) può eliminare qualsiasi commento; un commento eliminato si riduce al suo posto a una piccola riga, con il suo autore, la sua data e *Commento eliminato*. Eliminare il primo commento di un thread chiude il thread: le risposte già presenti restano, ma nessuno può più rispondervi, risolverlo o riaprirlo. Un motivo di rifiuto, una richiesta di modifiche e una nota di firma non possono essere modificati né eliminati: i primi due vengono invece risolti.
- **Revisioni precedenti.** Un thread appartiene alla revisione su cui è stato avviato. Attivate **Mostra la discussione sulle revisioni precedenti** per leggere i thread delle revisioni precedenti della decisione, raggruppati per revisione.

#### Menzioni {: #decision-mentions }

Mentre scrivete una decisione, digitate **@** in una qualsiasi delle sue quattro sezioni per menzionare una **card** o un'altra **decisione**. Un popup elenca le card e le decisioni corrispondenti mentre digitate; usate i tasti freccia e Invio (o fate clic) per sceglierne una, ed Esc per chiuderlo. In un commento, **@** propone anche **persone**. Ogni voce indica di cosa si tratta: una card mostra il colore e l'icona del suo tipo, il suo tipo, il suo sottotipo e la card sotto cui si trova (*Application · Microservice · in Finance Suite*, quando potete vedere quella card); una decisione mostra il suo riferimento (*ADR-012 · Rev 2*), il suo titolo e il suo stato; una persona mostra un nome e un indirizzo e-mail. Una menzione compare come chip con il nome attuale di ciò a cui rimanda — il nome di una card, il riferimento e il titolo di una decisione — così rinominare una card non cambia mai il testo. Fate clic su un chip di card o di decisione per aprirla.

- **Cosa viene prima.** Quando dopo **@** non è stato digitato nulla, vengono prima le card collegate alla decisione, poi le altre card in ordine alfabetico; in un commento, tra le persone vengono prima i firmatari, i decisori e i partecipanti della decisione. Mentre digitate, i risultati migliori vengono prima come ovunque in Turbo EA, e a parità di corrispondenza sono in testa le card collegate e le persone della decisione.
- **Sfoglia.** L'ultima voce del popup, **Sfoglia…**, e il pulsante **Menziona…** (**@**) nella barra degli strumenti dell'editor aprono una finestra di dialogo con i selettori standard: **Schede** (il selettore di card del resto di Turbo EA, con il suo elenco di tipi, la gerarchia e la ricerca), **Decisioni** (un elenco ricercabile) e, in un commento, **Persone**. Sceglietene quanti ve ne servono in qualsiasi scheda e fate clic su **Inserisci**: viene inserita una menzione per ogni scelta, nell'ordine in cui le avete scelte, separate da spazi — al posto di ciò che avete digitato dopo **@** quando la finestra di dialogo è stata aperta dal popup. **Annulla** non inserisce nulla.
- Un lettore che non può vedere una card menzionata vede **Scheda riservata** al posto del suo nome, ovunque: nell'editor, nell'anteprima, negli export PDF e Word, nella tabella, nella cronologia e nella discussione. Un lettore che non può aprire le decisioni vede **Decisione riservata**. Il salvataggio del testo conserva tali menzioni così come sono, anche quando chi salva non può vederle.
- Una card menzionata che è stata poi eliminata appare come **Scheda eliminata** (una decisione eliminata, **Decisione eliminata**), perché il testo non memorizza nomi.
- Una menzione non collega la card. Quando il testo menziona card non collegate, l'editor le elenca sotto *Menzionate nel testo ma non collegate:*, ciascuna con un pulsante **Collega questa scheda**. Il collegamento delle card nell'editor usa lo stesso selettore di card del resto di Turbo EA.
- **Menzionata in.** La [scheda ADR](card-details.md#scheda-adr) di una card e l'anteprima di una decisione elencano, sotto **Menzionata in**, le decisioni e i SoAW il cui testo menziona quella card o decisione, e quelli la cui discussione lo fa (contrassegnati *nella discussione*). L'elenco mostra solo i documenti che potete aprire.

#### Cronologia {: #decision-history }

Il pulsante **Cronologia** in cima all'editor o all'anteprima della decisione, accanto alla barra delle revisioni quando la decisione ha più revisioni, apre un'unica vista ampia: la sequenza temporale a sinistra, la versione selezionata a destra. La sequenza temporale registra ciò che è accaduto alla decisione, dal più recente: creata, salvata, inviata per la revisione, ogni firma (con la sua nota), modifiche richieste, rifiutata e ritirata (ciascuna con il motivo), riaperta, firme ritirate, completamente firmata, registrata come decisa, una revisione avviata, una versione precedente ripristinata. Chiunque possa aprire la decisione vede questa cronologia. Gli eventi di revisione — inviata per la revisione, firmata, ritirata, rifiutata — sono conservati a partire dalla versione 2.200.0; prima venivano mostrati in tempo reale ma mai memorizzati. Le decisioni esistenti prima di quella versione iniziano con una cronologia ricostruita da ciò che era memorizzato: creata, revisionata, inviata per la revisione (per una decisione in revisione al momento dell'aggiornamento, con i firmatari a cui era stata inviata), ogni firma, firmata e registrata.

La Cronologia non è la tabella **Cronologia versioni del documento** compilata a mano di uno [Statement of Architecture Work](delivery.md#leditor-soaw), che registra ciò che gli autori scelgono di scriverci.

- **Versioni.** Una versione viene conservata ogni volta che una bozza viene salvata con modifiche. Contiene il titolo, le quattro sezioni, le date, il riepilogo delle modifiche e le persone; collegamenti ad altre decisioni, card collegate, file e diagrammi non fanno parte di una versione. I passaggi che contengono una versione sono contrassegnati nella sequenza temporale; le persone che possono modificare la decisione e i suoi firmatari ne selezionano uno per mostrarlo a destra, e all'apertura della vista è selezionata la versione più recente. Gli altri lettori vedono la sequenza temporale senza le versioni (*Le versioni salvate sono visibili solo a editor e firmatari.*). Su uno schermo stretto la vista mostra prima la sequenza temporale, poi la versione selezionata con un pulsante **Indietro**.
- **Modifiche.** Sopra la versione selezionata, **Versione** la mostra così come è stata salvata e **Modifiche** mostra cosa è cambiato tra essa e la versione precedente, parola per parola per sezione, insieme alle date e alle persone modificate; scegliete qualsiasi altra versione in **Confronta con**. Si possono confrontare solo le versioni già caricate nella sequenza temporale: quando la versione precedente a quella selezionata non è ancora caricata, **Modifiche** lo segnala, e **Carica altro** la carica. Una modifica della sola formattazione viene segnalata come *Solo formattazione: le parole sono le stesse.*; un link il cui indirizzo è cambiato conta come modifica, e una riga di tabella si legge come una sola riga, con le celle separate da ` | `.
- **Ripristina.** Su una bozza, chi può modificare la decisione può ripristinare la versione selezionata con **Ripristina questa versione**. Il ripristino procede solo in avanti: il testo, le date e le persone della versione sostituiscono quelli della bozza e sono conservati come nuova versione, e lo stato della bozza prima del ripristino resta nella cronologia. Collegamenti ad altre decisioni, card collegate, file e diagrammi non vengono ripristinati. Quando l'editor contiene modifiche non salvate, la conferma avvisa che andranno perse. Dopo il ripristino, la pagina mostra la decisione ripristinata e la vista si chiude. Una decisione in revisione, firmata o chiusa (rifiutata o ritirata) non può essere ripristinata; riaprite prima una chiusa.

#### Limiti noti {: #collaboration-limits }

- Una card eliminata appare come **Scheda eliminata** ovunque fosse menzionata: il testo non memorizza nomi, quindi il vecchio nome non può essere mostrato.
- Due persone che salvano la stessa bozza si sovrascrivono ancora a vicenda: vince l'ultimo salvataggio. La cronologia conserva entrambi i salvataggi, così la formulazione sovrascritta può essere ritrovata e ripristinata.
- La discussione non fa parte degli export PDF, Word o foglio di calcolo, né della copia stampata.
- Un ruolo che può aprire le decisioni ma non ha accesso all'inventario non può cercare card nel popup delle menzioni (*Il tuo ruolo non può cercare schede; puoi comunque menzionare le decisioni.*).
- Il testo copiato da un documento a un altro perde i suoi chip **Riservato**: una menzione riservata può essere conservata solo nel documento in cui è stata scritta.
- Chi è stato invitato a firmare in un giro di revisione rifiutato o ritirato prima della versione 2.200.0 non può essere ricostruito, quindi quelle persone non contano come firmatari di quella revisione. Un giro ancora aperto al momento dell'aggiornamento conserva i suoi firmatari.

## Rischio

![GRC — Registro dei rischi](../assets/img/it/53_grc_registro_rischi.png)

Incorpora il **Registro dei rischi** TOGAF Fase G. Ciclo di vita completo, workflow degli stati, interruttori della matrice e comportamento dei proprietari sono documentati nella [guida del Registro dei rischi](risks.md). I punti più rilevanti:

## Conformità

![GRC — Registro di conformità](../assets/img/it/54_grc_conformita.png)


La scheda Conformità è un registro a doppia fonte — le rilevazioni possono essere **scritte manualmente** da un revisore **oppure** prodotte da una **scansione IA** on-demand contro le regolamentazioni abilitate (EU AI Act, GDPR, NIS2, DORA, SOC 2, ISO 27001 sono abilitate per default). Entrambi i tipi di rilevazione condividono lo stesso ciclo di vita, possono essere promossi a un Rischio e bulk-azionabili dalla griglia. Vedi la [guida Conformità](compliance.md) per il ciclo di vita completo, il dialogo di creazione manuale, il workflow di scansione, il rilevatore semantico EU AI Act e il loop di promozione a Rischio.

La stessa scheda Conformità appare anche nel Dettaglio della card (auto-nascosta quando la card non ha rilevazioni collegate), in modo che un Application Owner possa triagiare le proprie rilevazioni senza lasciare la card.

## Permessi

| Permesso | Ruoli predefiniti |
|----------|-------------------|
| `grc.view` | admin, bpm_admin, member, viewer |
| `grc.manage` | admin, bpm_admin, member |
| `adr.view` / `adr.manage` / `adr.sign` | `adr.view`: admin, bpm_admin, member, viewer; `adr.manage` e `adr.sign`: admin, bpm_admin, member |
| `adr.record` | admin — [registrare una decisione passata come presa](#recording-a-past-decision) |
| `adr.comment` | admin, bpm_admin, member — pubblicare nella [discussione](#decision-discussion) di una decisione; i firmatari di una decisione possono sempre commentarla |
| `risks.view` / `risks.manage` | vedi [Registro dei rischi § Permessi](risks.md) |
| `compliance.view` / `compliance.manage` | vedi [TurboLens § Security & Compliance](turbolens.md) |

La sezione [Diagrammi](#decision-diagrams) di una decisione richiede anche `diagrams.view` (admin, bpm_admin, member, viewer per impostazione predefinita): senza di esso un lettore non vede diagrammi in nessuna decisione.

`grc.view` controlla la visibilità della rotta GRC stessa — senza di esso, la voce del menu superiore è nascosta. Ogni scheda inoltre impone il proprio permesso di dominio, così che una visualizzatrice possa leggere il registro senza poter avviare una scansione LLM, ad esempio.
