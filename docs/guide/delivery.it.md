# EA Delivery

Il modulo **EA Delivery** gestisce le **iniziative architetturali e i relativi artefatti** — diagrammi, Statement of Architecture Work (SoAW) e Architecture Decision Records (ADR). Fornisce una vista unica di tutti i progetti architetturali in corso e i loro deliverable.

Quando PPM è abilitato — la configurazione tipica — EA Delivery vive **dentro il modulo PPM**: aprite **PPM** nella navigazione in alto e passate alla scheda **EA Delivery** (`/ppm?tab=ea-delivery`). Quando PPM è disabilitato, **EA Delivery** appare nel menu **IT Governance** con il nome **EA Governance** (collegamento a `/reports/ea-delivery`); se GRC è disattivato, o il vostro ruolo non può aprire IT Governance, appare invece come voce di primo livello **Consegna EA**. L'URL legacy `/ea-delivery` continua a funzionare come redirect in entrambi i casi, così i segnalibri esistenti restano risolvibili.

![Gestione EA Delivery](../assets/img/it/17_consegna_ea.png)

## Spazio di lavoro delle iniziative

EA Delivery è uno **spazio di lavoro a due pannelli** (senza schede interne):

- **Barra laterale a sinistra** — un albero indentato e filtrabile di tutte le iniziative (con le iniziative figlie nidificate). Cerca per nome, filtra per Stato / Sottotipo / Artefatti o segna i preferiti.
- **Spazio di lavoro a destra** — i deliverable, le iniziative figlie e i dettagli dell'iniziativa selezionata a sinistra. Selezionando un'altra riga, lo spazio di lavoro si aggiorna.

La selezione fa parte dell'URL (`?initiative=<id>`), quindi è possibile condividere un link diretto a un'iniziativa o aggiornare la pagina senza perdere il contesto.

Un pulsante principale **+ Nuovo artefatto ▾** in alto nella pagina permette di creare un nuovo SoAW, diagramma o ADR — automaticamente collegato all'iniziativa selezionata (o non collegato se nessuna selezione è attiva). I gruppi di deliverable vuoti nello spazio di lavoro mostrano anche un pulsante **+ Aggiungi …**, in modo che la creazione sia sempre a un solo clic.

Ogni riga dell'albero mostra:

| Elemento | Significato |
|----------|-------------|
| **Nome** | Nome dell'iniziativa |
| **Chip di conteggio** | Totale degli artefatti collegati (SoAW + diagrammi + ADR) |
| **Punto di stato** | Pallino colorato per On Track / At Risk / Off Track / On Hold / Completed |
| **Stella** | Toggle dei preferiti — i preferiti risalgono in cima |

La riga sintetica **Artefatti non collegati** in cima all'albero compare quando ci sono SoAW, diagrammi o ADR non ancora collegati a un'iniziativa. Aprila per ricollegarli.

### Chi vede cosa

EA Delivery si apre per qualsiasi ruolo che abbia **Visualizzare i documenti SoAW** (`soaw.view`) o **Visualizzare i registri delle decisioni di architettura** (`adr.view`). Ogni tipo di artefatto segue poi il proprio permesso:

| Artefatto | Elencato con | Creato con |
|----------|-------------|--------------|
| **SoAW** | `soaw.view` | `soaw.manage` |
| **Diagramma** | `diagrams.view` | `diagrams.manage` (necessario anche per collegare o scollegare un diagramma) |
| **ADR** | `adr.view` | `adr.manage` |

Un gruppo che non si può visualizzare è escluso dall'area di lavoro, e **+ Nuovo artefatto** e **+ Aggiungi …** offrono solo i tipi che si possono creare — un ruolo che può solo leggere non vede nessuno dei due pulsanti. Così un ruolo con solo `adr.view` ottiene la pagina con le decisioni di ogni iniziativa e nulla sui SoAW.

## Statement of Architecture Work (SoAW)

Uno **Statement of Architecture Work (SoAW)** è un documento formale definito dallo [standard TOGAF](https://pubs.opengroup.org/togaf-standard/) (The Open Group Architecture Framework). Stabilisce l'ambito, l'approccio, i deliverable e la governance per un impegno architetturale. In TOGAF, il SoAW viene prodotto durante la **Fase preliminare** e la **Fase A (Visione dell'architettura)** e serve come accordo tra il team di architettura e i suoi stakeholder.

Turbo EA fornisce un editor SoAW integrato con template di sezioni allineati a TOGAF, editing di testo ricco e funzionalità di esportazione — così potete creare e gestire documenti SoAW direttamente insieme ai vostri dati architetturali.

### Creazione di un SoAW

1. Selezionate l'iniziativa a sinistra (facoltativo — potete anche creare un SoAW non collegato).
2. Cliccate su **+ Nuovo artefatto ▾** in alto nella pagina (oppure sul pulsante **+ Aggiungi** nella sezione *Deliverable*) e scegliete **Nuovo Statement of Architecture Work**.
3. Inserite il titolo del documento.
4. L'editor si apre con **template di sezioni predefiniti** basati sullo standard TOGAF.

### L'editor SoAW

L'editor fornisce:

- **Editing di testo ricco** — Barra degli strumenti di formattazione completa (intestazioni, grassetto, corsivo, elenchi, link) alimentata dall'editor TipTap
- **Link** — Un URL digitato o incollato diventa un link mentre scrivi, e ogni link di un documento si apre in una nuova scheda. Gli indirizzi nei documenti scritti prima del supporto ai link vengono collegati al momento della visualizzazione
- **Template di sezioni** — Sezioni predefinite seguendo gli standard TOGAF (es. Descrizione del problema, Obiettivi, Approccio, Stakeholder, Vincoli, Piano di lavoro)
- **Tabelle modificabili in linea** — Aggiungete e modificate tabelle all'interno di qualsiasi sezione
- **Menzioni** — digitate **@** nel testo di una sezione per menzionare una card o una decisione (vedere [Discussione, menzioni e cronologia](#soaw-collaboration))
- **Cronologia versioni del documento** — una tabella che gli autori compilano a mano (versione, data, revisionato da, descrizione). Fa parte del documento e non è la vista [Cronologia](#soaw-collaboration)
- **Workflow degli stati** — I documenti progrediscono attraverso fasi definite:

| Stato | Significato |
|-------|-------------|
| **Draft** | In fase di scrittura, non ancora pronto per la revisione |
| **In Review** | Inviato per la firma — bloccato finché le firme non vengono ritirate |
| **Approved** | Revisionato e accettato |
| **Signed** | Formalmente firmato |

### Workflow di firma

Da un SoAW in bozza o approvato, potete richiedere le firme dagli stakeholder. Cliccate su **Richiedi firme** e utilizzate il campo di ricerca per trovare e aggiungere firmatari per nome o e-mail. Il sistema traccia chi ha firmato e invia notifiche ai firmatari in attesa.

Un SoAW in revisione è **bloccato**, così i firmatari firmano esattamente ciò che è stato loro inviato: solo la sua iniziativa può ancora cambiare. Per modificarne il contenuto, cliccate su **Ritirare le firme**, che lo riporta in bozza. Anche un firmatario che clicca su **Rifiutare** lo riporta in bozza, con lo stesso numero di revisione. Solo un SoAW in bozza può essere eliminato.

### Revisioni

Un SoAW firmato è in sola lettura. Cliccate su **Nuova revisione** per avviare una nuova bozza a partire da esso, con lo stesso nome e il numero di revisione successivo. Esiste una sola revisione aperta alla volta: mentre una revisione è in fase di redazione, il SoAW firmato lo segnala e offre **Apri la revisione** invece di avviarne un'altra. Solo l'ultima revisione può essere revisionata, e un rifiuto non cambia il numero di revisione.

Una revisione precedente mostra un banner con un collegamento a quella corrente, e la striscia **Revisioni** su ogni revisione le elenca tutte. Gli elenchi di SoAW — i deliverable dell'iniziativa, la scheda SoAW, il report EA Delivery — mostrano la revisione corrente di ogni documento e l'eventuale revisione in fase di redazione.

### Discussione, menzioni e cronologia {: #soaw-collaboration }

Un SoAW ha la stessa discussione, le stesse menzioni e la stessa cronologia di una decisione: la discussione in un pannello accanto al suo editor e alla sua anteprima, la cronologia dietro il pulsante **Cronologia** in cima alla pagina. Il comportamento comune è descritto una sola volta, nella guida GRC: [Discussione](grc.md#decision-discussion), [Menzioni](grc.md#decision-mentions), [Cronologia](grc.md#decision-history) e [Limiti noti](grc.md#collaboration-limits). Ciò che cambia per un SoAW:

- **Chi può pubblicare.** Pubblicare, rispondere, risolvere e riaprire richiedono il permesso `soaw.comment`, che membri e amministratori hanno per impostazione predefinita e i visualizzatori no; la lettura della discussione segue `soaw.view`. I firmatari del SoAW possono sempre commentarlo. Chiunque possa modificare i SoAW (`soaw.manage`) può eliminare qualsiasi commento.
- **Sezioni.** Un thread è associato con un chip di sezione a una delle sezioni proprie del SoAW, oppure a nessuna (un thread generale). Un SoAW ha molte sezioni, quindi il riquadro di scrittura mostra un chip per ogni sezione già discussa e per quella scelta; **Altre…** apre un elenco ricercabile delle altre. I chip in cima alla discussione la filtrano per sezione, come per una decisione. Un thread associato a una sezione personalizzata poi rimossa mostra *Sezione rimossa*. Ogni sezione porta accanto alla sua intestazione la stessa icona di chat di una decisione, nell'editor e nell'anteprima, con il numero di thread aperti quando c'è una discussione; fate clic su di essa per aprire la discussione su quella sezione con la sezione già selezionata per un nuovo commento.
- **Rifiuto.** Qualsiasi firmatario che abbia il permesso di firma (`soaw.sign`) — o il permesso di modifica — può rifiutare un SoAW, come per le decisioni; finora il rifiuto richiedeva il permesso di modifica. Il motivo apre nella discussione un thread **Motivo del rifiuto**.
- **Menzioni.** Un SoAW non ha card collegate, quindi quando dopo **@** non è stato digitato nulla le card sono elencate in ordine alfabetico; in un commento, tra le persone vengono prima i firmatari del SoAW. **Sfoglia…** funziona come per una decisione.
- **Nota di firma.** **Firma** apre ora una finestra di dialogo in cui il firmatario può aggiungere una nota facoltativa; compare nella discussione come **Nota di firma** e nella Cronologia.
- **Cronologia.** Una versione contiene il nome del SoAW, le sue informazioni sul documento, la sua tabella Cronologia versioni del documento e ogni sezione; l'iniziativa non fa parte di una versione. La Cronologia registra ciò che accade al documento; la tabella Cronologia versioni del documento contiene solo ciò che gli autori vi scrivono. Un SoAW nello stato **Approvato** può ancora essere modificato, quindi, come per una bozza, i suoi salvataggi sono conservati come versioni e una versione precedente può esservi ripristinata.

### Anteprima ed esportazione

- **Modalità anteprima** — Vista di sola lettura del documento SoAW completo
- **Esportazione DOCX** — Scaricate il SoAW come documento Word formattato per la condivisione offline o la stampa
- **Esportazione PDF** — Apre una vista pronta per la stampa in una nuova scheda; usate *Salva come PDF* del browser. Consentite i pop-up per questo sito se non si apre nulla.

### Scheda SoAW sulle card di Iniziativa

![Card iniziativa — scheda SoAW](../assets/img/it/55_iniziativa_soaw_tab.png)

Le iniziative espongono inoltre una scheda **SoAW** dedicata direttamente nella loro pagina di dettaglio. La scheda elenca la revisione corrente di ogni SoAW collegato a quell'iniziativa, più l'eventuale revisione in fase di redazione (titolo, chip di stato, numero di revisione, data dell'ultima modifica) con un pulsante **+ Nuovo SoAW** che preseleziona l'iniziativa corrente — così è possibile redigere o saltare a un SoAW senza lasciare la card su cui si sta lavorando. La creazione riutilizza lo stesso dialogo della pagina EA Delivery, e il nuovo documento compare in entrambi i posti. La scheda è mostrata ai ruoli che hanno **Visualizzare i documenti SoAW** (`soaw.view`); il pulsante **+ Nuovo SoAW** e l'azione di eliminazione di una bozza richiedono **Creare e modificare i documenti SoAW** (`soaw.manage`), che si possa o meno modificare l'iniziativa stessa.

## Architecture Decision Records (ADR)

Un **Architecture Decision Record (ADR)** registra un'importante decisione architetturale insieme al suo contesto, alle conseguenze e alle alternative considerate. Lo spazio di lavoro EA Delivery mostra gli ADR **collegati all'iniziativa selezionata** in linea, sotto la sezione di deliverable *Decisioni di Architettura* — così potete leggerli e aprirli senza lasciare la vista dell'iniziativa. Usate la split-button **+ Nuovo artefatto ▾** (oppure **+ Aggiungi** nella sezione) per creare un nuovo ADR pre-collegato all'iniziativa selezionata.

Il **registro principale degli ADR** — dove ogni ADR a livello di landscape viene filtrato, cercato, firmato, revisionato e visualizzato in anteprima — vive nel modulo GRC sotto **GRC → Governance → [Decisioni](grc.md#governance)**. Consultate la guida GRC per il ciclo di vita completo dell'ADR (colonne della griglia, barra laterale di filtri, workflow di firma, revisioni, anteprima).

## Scheda Risorse

![Scheda Risorse della card](../assets/img/it/17c_scheda_risorse.png)

Le card ora includono una scheda **Risorse** che consolida:

- **Decisioni architetturali** — gli ADR non sono più elencati qui. Ogni card dispone ora di una propria scheda **ADR**; vedere [Dettaglio della card](card-details.md) per sapere che cosa mostra e come collegare, creare o scollegare decisioni da una card.
- **Allegati file** — Caricate e gestite file (documenti, fogli di calcolo, presentazioni, file OpenDocument e Office legacy, immagini, archivi, messaggi Outlook ed e-mail, CSV, Markdown, JSON e XML — fino a 20 MB). Durante il caricamento, selezionate una **categoria documento** tra: Architettura, Sicurezza, Conformità, Operazioni, Note di riunione, Design o Altro. La categoria viene visualizzata come chip accanto a ogni file.
- **Link ai documenti** — Riferimenti a documenti basati su URL. Quando aggiungete un link, selezionate un **tipo di link** tra: Documentazione, Sicurezza, Conformità, Architettura, Operazioni, Supporto o Altro. Il tipo di link viene visualizzato come chip accanto a ogni link e l'icona cambia in base al tipo selezionato.
