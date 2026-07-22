# Pianificazione dell’architettura

La pianificazione dell’architettura è uno strumento di pianificazione manuale in **EA Delivery** per modellare i cambiamenti del vostro panorama — sostituire un’applicazione con un’altra per una certa organizzazione, dismettere un sistema legacy o introdurre una nuova piattaforma — e comunicarli come un **unico diagramma prima/dopo**. Offre un risultato simile al TurboLens Architect, ma senza alcuna IA: mantenete il pieno controllo di ogni cambiamento proposto.

Il risultato è una Layered Dependency View che mostra lo stato attuale e quello pianificato in un’unica immagine, con indicatori di cambiamento:

- **Croce rossa** — una card o relazione contrassegnata per la rimozione
- **Più verde** — una card o relazione appena aggiunta
- **Frecce di scambio blu** — una sostituzione: la card successore e le connessioni che eredita

## Creare un piano

Aprite **EA Delivery** e usate **Aggiungi → Nuovo piano di architettura** su un’iniziativa (oppure create un piano non collegato e collegatelo in seguito). Un piano si costruisce in quattro passi:

1. **Obiettivi di business** *(facoltativo)* — indicate le card Obiettivo che questo cambiamento supporta. Appaiono nel livello Strategia del diagramma, così ogni stakeholder vede il *perché* accanto al *cosa*, e precompilano i collegamenti dell’iniziativa alla conferma del piano.
2. **Ambito e baseline** — scegliete una o più card di ambito (un’organizzazione, una business capability, singole applicazioni, …) e una profondità delle dipendenze (1–3). **Cattura baseline** scatta un’istantanea del panorama circostante come immagine «prima». Lo snapshot mantiene stabile il diagramma anche se l’inventario cambia; usate **Aggiorna baseline** per ricatturarla in seguito — ogni cambiamento pianificato il cui bersaglio è scomparso viene segnalato.
3. **Cambiamenti pianificati** — applicate operazioni di cambiamento dalla toolbox:
    - **Aggiungi card** — portate una card esistente nell’immagine, oppure proponetene una completamente nuova (nome + tipo).
    - **Rimuovi card** — contrassegnate una card per la dismissione. Le sue connessioni diventano rosse.
    - **Sostituisci card** — scegliete la card da sostituire e il suo successore (esistente o proposto). Il successore eredita le relazioni del predecessore, mostrate come archi di scambio blu; tagliate singole relazioni ereditate con **Rimuovi relazione**.
    - **Aggiungi / rimuovi relazione** — tracciate nuove connessioni o tagliate quelle esistenti. I tipi di relazione sono validati rispetto al metamodello.
4. **Anteprima dal vivo** — il diagramma prima/dopo unito si aggiorna mentre pianificate. Salvate il piano in qualsiasi momento; appare nella sezione **Deliverable** dell’iniziativa.

## Comprendere le conseguenze

La pianificazione dell’architettura è più di un editor di diagrammi: mentre pianificate, un pannello **Conseguenze** rende visibile l’impatto architetturale. Gli stessi numeri appaiono nell’anteprima condivisibile e confluiscono nell’ADR confermato:

- **Analisi dei gap** — un riepilogo in stile TOGAF Aggiunto / Rimosso / Modificato / Mantenuto.
- **Impatto / raggio d’azione** — rimuovere o sostituire una card mostra cosa dipende da essa (« *N applicazioni, M interfacce dipendono da questa* »), dall’analisi d’impatto della card.
- **Lacune di copertura delle capability** — se una business capability perde *tutte* le sue applicazioni di supporto nello stato target, viene segnalata.
- **Differenze di costo e rischio** — il costo annuo stimato prima → dopo (con la differenza) e il numero di rischi aperti sulle card interessate. Le card proposte contribuiscono con il loro costo stimato, scritto anche sulla card creata alla conferma.

## Confermare un piano

Un piano in bozza può essere **confermato** (richiede il permesso *Conferma piani di architettura*). La conferma:

- crea una card **Iniziativa** (con il nome e le date di inizio/fine scelti) collegata agli obiettivi supportati,
- crea le **card proposte** e le **relazioni** selezionate, collegando ogni nuova card all’iniziativa,
- imprime una data di **fine vita** (la data di fine dell’iniziativa) sulle card rimosse e sostituite, così i report sul ciclo di vita e le roadmap riflettono il piano,
- facoltativamente crea una **bozza di Architecture Decision Record** che documenta ogni cambiamento — comprese le relazioni tagliate, che vengono solo documentate e mai eliminate.

!!! note
    La conferma non archivia né elimina mai nulla. Le card rimosse ricevono una data di fine vita; la loro effettiva dismissione resta un passo umano deliberato attraverso i normali flussi dell’inventario.

Dopo la conferma il piano diventa di sola lettura e rimanda all’iniziativa creata.

## Permessi

| Permesso | Concede |
|----------|---------|
| `arch_plans.view` | Vedere i piani di architettura |
| `arch_plans.manage` | Creare, modificare ed eliminare i piani |
| `arch_plans.commit` | Confermare un piano (creare iniziativa, card, relazioni, bozza ADR, imprimere le date di fine vita) |

I membri possono vedere, gestire e confermare i piani per impostazione predefinita; i visualizzatori possono solo consultarli.
