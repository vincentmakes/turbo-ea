# Diagrammi

Il modulo **Diagrammi** consente di creare **diagrammi di architettura visivi** utilizzando un editor [DrawIO](https://www.drawio.com/) integrato -- completamente collegato all'inventario delle schede. Trascinate le schede sulla tela, collegatele con relazioni, scendete nelle gerarchie e ricolorate per qualsiasi attributo -- il diagramma resta sincronizzato con i dati EA.

![Galleria diagrammi](../assets/img/it/16_diagrammi.png)

## Galleria diagrammi

La galleria elenca ogni diagramma come una scheda compatta con miniatura, nome, autore e il numero di schede a cui fa riferimento. **Crea**, **Apri**, **Modifica dettagli**, organizza o **Elimina** qualsiasi diagramma.

### Trovare i diagrammi

- **Barra laterale dei filtri** — il pannello a sinistra restringe la galleria a **Tutti i diagrammi**, **Creati da me** o i tuoi **Preferiti**. Comprimila in una barra sottile con il chevron; su schermi piccoli il pulsante **Filtri** la apre come pannello a scomparsa.
- **Ricerca** — la casella di ricerca corrisponde al nome di un diagramma, al suo autore e ai nomi delle schede disegnate al suo interno, così puoi trovare un diagramma in base al suo contenuto.
- **Ordinamento** — per aggiornati di recente, creati di recente o nome.
- **Preferiti** — fai clic sulla stella di una scheda per aggiungerla ai tuoi preferiti personali; il filtro **Preferiti** li mostra tutti.

### Gruppi

Raggruppa i diagrammi correlati in **gruppi** — etichette condivise a livello di area di lavoro. Un diagramma può appartenere a più gruppi contemporaneamente. Nella vista a schede la galleria mostra ogni gruppo come intestazione comprimibile; gli elementi non assegnati compaiono in **Non raggruppati**.

- Usa **Gestisci gruppi** nella barra laterale per creare, rinominare, ricolorare o eliminare i gruppi.
- Usa **Aggiungi a gruppi…** dal menu di un diagramma per inserirlo in uno o più gruppi (puoi creare un nuovo gruppo al volo).
- La selezione di un gruppo nella barra laterale filtra la galleria solo su quel gruppo.


## L'editor di diagrammi

Aprire un diagramma avvia l'editor DrawIO a schermo intero in un iframe della stessa origine. La barra degli strumenti nativa di DrawIO è disponibile per forme, connettori, testo e layout -- ogni azione propria di Turbo EA è esposta tramite il menu contestuale del clic destro, il pulsante Sync della barra strumenti e il chevron sopra ogni scheda.

### Inserire schede

Usate la finestra **Inserisci schede** (dalla barra strumenti o dal menu contestuale) per aggiungere schede alla tela:

- I **chip di tipo con contatori in tempo reale** nella colonna sinistra filtrano i risultati.
- Cercate per nome nella colonna destra; ogni riga ha una casella di selezione.
- **Inserisci selezionate** aggiunge le schede scelte in una griglia; **Inserisci tutte** aggiunge ogni scheda che corrisponde al filtro corrente (con conferma oltre 50 risultati).

La stessa finestra si apre in modalità a selezione singola per **Cambia scheda collegata** e **Collega a scheda esistente**.

Ogni scheda sull'area di lavoro mostra la sua **icona del tipo di scheda** come un piccolo glifo bianco nell'angolo in alto a sinistra, accanto al colore del tipo — così il tipo di una scheda è indicato sia dall'icona sia dal colore. Questo corrisponde alle icone usate in tutta l'applicazione e migliora la leggibilità per gli utenti daltonici. L'icona compare sulle schede inserite d'ora in poi. Per aggiungere le icone alle schede già presenti su un diagramma più vecchio, fai clic su **Applica icone del tipo di scheda** nella barra degli strumenti dell'editor.

### Azioni del clic destro

- **Schede sincronizzate**: *Apri scheda*, *Cambia scheda collegata*, *Scollega scheda*, *Rimuovi dal diagramma*.
- **Forme semplici / celle non collegate**: *Collega a scheda esistente*, *Converti in scheda* (mantiene la geometria e trasforma la forma in una scheda in sospeso con la sua etichetta), *Converti in contenitore* (trasforma la forma in uno swimlane in cui annidare altre schede).

### Il menu di espansione

Ogni scheda sincronizzata porta un piccolo chevron. Un clic apre un menu con tre sezioni, ciascuna caricata in un unico round-trip:

- **Mostra dipendenze** -- vicini tramite relazioni uscenti o entranti, raggruppati per tipo di relazione con contatori. Ogni riga è una casella; confermate con **Inserisci (N)**.
- **Drill-Down** -- trasforma la scheda corrente in un contenitore swimlane con i suoi figli `parent_id` annidati. Scegliete quali figli includere o *Approfondisci tutti*.
- **Roll-Up** -- racchiude la scheda corrente e i fratelli selezionati (schede che condividono lo stesso `parent_id`) in un nuovo contenitore padre.

Le righe con contatore = 0 sono in grigio, e i vicini / figli già presenti sulla tela sono saltati automaticamente.

### La gerarchia sulla tela

I contenitori corrispondono al `parent_id` di una scheda:

- **Trascinare una scheda dentro** un contenitore dello stesso tipo apre «Aggiungere «figlio» come figlio di «genitore»?». **Sì** mette in coda una modifica gerarchica; **No** riporta la scheda alla posizione precedente.
- **Trascinare una scheda fuori** da un contenitore richiede il distacco (impostare `parent_id = null`).
- I **rilasci tra tipi diversi** tornano silenziosamente alla posizione -- la gerarchia è limitata a schede dello stesso tipo.
- Tutti i movimenti confermati finiscono nel bucket **Modifiche gerarchiche** del pannello Sync con azioni *Applica* e *Scarta*.

### Rimuovere schede dal diagramma

Eliminare una scheda dalla tela è trattato come un gesto **puramente visivo** -- «Non voglio vederla qui». La scheda resta nell'inventario; i suoi archi di relazione connessi scompaiono silenziosamente con essa. Le frecce disegnate a mano che non sono relazioni EA registrate non vengono mai rimosse automaticamente. **L'archiviazione è compito della pagina Inventario**, non del diagramma.

### Cancellazione di archi

Rimuovere un arco che porta una relazione reale apre «Eliminare la relazione tra ORIGINE e DESTINAZIONE?»:

- **Sì** mette in coda l'eliminazione nel pannello Sync; **Sincronizza tutto** invia il `DELETE /relations/{id}` al backend.
- **No** ripristina l'arco al suo posto (stile ed estremità preservati).

### Prospettive di visualizzazione

Il menu a tendina **Vista** nella barra strumenti ricolora ogni scheda sulla tela in base a un attributo:

- **Colori delle schede** (predefinito) -- ogni scheda usa il colore del proprio tipo.
- **Stato di approvazione** -- ricolora per `approvata` / `in attesa` / `rotta`.
- **Valori di campo** -- scegliete qualsiasi campo a selezione singola sui tipi di scheda presenti sulla tela (es. *Ciclo di vita*, *Stato*). Le celle senza valore cadono su un grigio neutro.

Una legenda fluttuante in basso a sinistra mostra la mappatura attiva. La vista scelta viene salvata col diagramma.

### Pannello Sync

Il pulsante **Sync** della barra strumenti apre il pannello laterale con tutto ciò che è in coda per la prossima sincronizzazione:

- **Nuove schede** -- forme convertite in schede in sospeso, pronte per essere inviate all'inventario.
- **Nuove relazioni** -- archi disegnati tra schede, pronti per essere creati nell'inventario.
- **Relazioni rimosse** -- archi di relazione cancellati dalla tela, in coda per `DELETE /relations/{id}`. *Mantieni in inventario* reinserisce l'arco.
- **Modifiche gerarchiche** -- spostamenti di trascinamento dentro / fuori dai contenitori confermati, in coda come aggiornamenti di `parent_id`.
- **Inventario modificato** -- schede aggiornate nell'inventario dall'apertura del diagramma, pronte per essere riportate sulla tela.

Il pulsante Sync della barra strumenti mostra una pillola pulsante «N non sincronizzate» finché esiste lavoro in sospeso. Lasciare la scheda con modifiche non sincronizzate attiva un avviso del browser, e la tela viene salvata automaticamente nello storage locale ogni cinque secondi per poter essere ripristinata dopo un aggiornamento accidentale.

### Collegare diagrammi alle schede

I diagrammi possono essere collegati a **qualsiasi scheda** dalla scheda **Risorse** della scheda stessa (vedi [Dettaglio scheda](card-details.it.md#scheda-risorse)). Quando un diagramma è collegato a una scheda **Iniziativa**, appare anche nel modulo [EA Delivery](delivery.md) accanto ai documenti SoAW.
