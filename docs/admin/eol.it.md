# Gestione End-of-Life (EOL)

La pagina di amministrazione **EOL** (**Admin > Impostazioni > EOL**) aiuta a tracciare il ciclo di vita dei prodotti tecnologici collegando le vostre card al database pubblico [endoflife.date](https://endoflife.date/)

![Gestione End-of-Life](../assets/img/it/29_admin_impostazioni_eol.png)

## Perché tracciare l'EOL?

Sapere quando i prodotti tecnologici raggiungono l'end-of-life o la fine del supporto è fondamentale per:

- **Gestione del rischio** — Il software non supportato è una vulnerabilità di sicurezza
- **Pianificazione del budget** — Pianificate migrazioni e aggiornamenti prima che il supporto termini
- **Conformità** — Molte normative richiedono software supportato

## Ricerca massiva

La funzionalità di ricerca massiva analizza le card di un tipo che traccia il fine vita (**Application** e **IT Component** per impostazione predefinita, vedere [Fine vita su altri tipi di card](#fine-vita-su-altri-tipi-di-card)) e trova automaticamente i prodotti corrispondenti nel database endoflife.date.

### Eseguire una ricerca massiva

1. Navigate su **Admin > Impostazioni > EOL**
2. Selezionate il tipo di card da analizzare (qualsiasi tipo che traccia il fine vita)
3. Cliccate su **Cerca**
4. Il sistema esegue una **corrispondenza fuzzy** contro il catalogo prodotti endoflife.date

### Revisione dei risultati

Per ogni card, la ricerca restituisce:

- **Punteggio di corrispondenza** (0-100%) — Quanto il nome della card corrisponde a un prodotto noto
- **Nome del prodotto** — Il prodotto endoflife.date corrispondente
- **Versioni/cicli disponibili** — Le versioni di rilascio del prodotto con le rispettive date di supporto

### Filtro dei risultati

Utilizzate i controlli del filtro per concentrarvi su:

- **Tutti gli elementi** — Ogni card analizzata
- **Solo non collegati** — Card non ancora collegate a un prodotto EOL
- **Già collegati** — Card che hanno già un collegamento EOL

Un riepilogo delle statistiche mostra: card totali analizzate, già collegate, non collegate e corrispondenze trovate.

### Collegamento delle card ai prodotti

1. Revisionate la corrispondenza suggerita per ogni card
2. Selezionate la **versione/ciclo del prodotto** corretta dal menu a tendina
3. Cliccate su **Collega** per salvare l'associazione

Una volta collegata, la pagina di dettaglio della card mostra una **sezione EOL** con:

- **Nome del prodotto e versione**
- **Stato del supporto** — Con codice colore: Supportato (verde), In avvicinamento a EOL (arancione), End of Life (rosso)
- **Date chiave** — Data di rilascio, fine supporto attivo, fine supporto di sicurezza, data EOL

## Fine vita su altri tipi di card

Il fine vita è tracciato per impostazione predefinita su **Application** e **IT Component**. Anche qualsiasi altro tipo di card, predefinito o personalizzato, può tracciarlo: aprite **Admin > Metamodello**, scegliete il tipo e, nel suo **Layout scheda**, disattivate **Nascosta dal dettaglio scheda** nella sezione **Fine vita**. Lo stesso interruttore nasconde il fine vita su Application o IT Component se non lo tracciate lì.

Questo unico interruttore decide tutto ciò che riguarda il fine vita del tipo:

- la sezione **Fine vita** sulle sue card (e l'opzione di collegamento alla creazione di una card),
- il posto del tipo nel [Report EOL](../guide/reports.md), nel grafico **Copertura di fine vita** del report Qualità dei dati e nei filtri e raggruppamenti di fine vita delle dashboard,
- la colonna e il filtro **Fine vita** nell'[Inventario](../guide/inventory.md),
- il selettore del tipo della **Ricerca massiva** in questa pagina.

Nascondere la sezione non elimina mai nulla: le card mantengono i loro collegamenti e le date del ciclo di vita, e ricompaiono in tutti i report quando la sezione viene mostrata di nuovo.

## Prodotti EOL personalizzati

endoflife.date monitora i software più diffusi, ma non tutto ciò che utilizzate: una piattaforma interna, uno strumento di nicchia di un fornitore o un'appliance con licenza spesso non vi compaiono. Per questi, definite un **prodotto EOL personalizzato** — un vostro prodotto con i vostri cicli di rilascio — e collegatevi le schede esattamente come fareste con un prodotto di endoflife.date. I prodotti personalizzati alimentano lo stesso stato delle schede, la colonna **Fine vita** dell'inventario, il [Report EOL](../guide/reports.md) e gli indicatori di qualità dei dati.

I prodotti personalizzati sono elencati nella scheda **Prodotti personalizzati** di **Admin > Impostazioni > EOL**. Crearli e modificarli richiede il permesso **Gestire EOL** (`eol.manage`); chiunque possa vedere i dati EOL può consultarli.

![Prodotti EOL personalizzati](../assets/img/it/29b_admin_impostazioni_eol_personalizzati.png)

### Creare un prodotto personalizzato

Ci sono due modi per crearne uno:

- **Da una scheda** — nella sezione **Fine vita** della scheda, cercate il prodotto. Quando endoflife.date non ha corrispondenze, la sezione propone **Crea prodotto personalizzato**, precompilato con quanto avete digitato (o con il nome della scheda). Inserite il nome del prodotto e i primi cicli, poi salvate: la scheda viene collegata in un solo passaggio al nuovo prodotto e ciclo.
- **Dalla scheda Prodotti personalizzati** — fate clic su **Aggiungi prodotto**.

Ogni prodotto ha:

- **Nome del prodotto** — come viene mostrato ovunque.
- **Chiave** — un breve identificatore in minuscolo (lettere, cifre, punti, trattini, trattini bassi) suggerito dal nome. I collegamenti delle schede la memorizzano, quindi **non può essere modificata** dopo la creazione.
- **Link del fornitore o della politica di rilascio** e **Descrizione** — facoltativi.
- **Cicli di rilascio** — ciascuno con un nome (ad esempio `2.4`), una **Data di rilascio**, una fine del **Supporto attivo**, una **Fine vita** e, facoltativamente, l'**Ultima versione** e la sua data di rilascio.

Supporto attivo e fine vita accettano ciascuno una **data**, oppure una delle due risposte quando non si conosce alcuna data: *Ancora supportato* / *Supporto attivo terminato* e *Nessuna fine vita annunciata* / *Già a fine vita*. Lo stato (Supportato, In avvicinamento a EOL, Fine vita) viene calcolato da questi valori con la stessa regola dei prodotti di endoflife.date.

### Gestire i cicli nella griglia

La scheda Prodotti personalizzati mostra una riga per ciclo di rilascio, raggruppata per prodotto. Funziona come le altre griglie: bloccare e riordinare le colonne, mostrarle o nasconderle e filtrare per prodotto, stato o utilizzo dal pannello a sinistra. La colonna **Schede collegate** indica quante delle schede visibili utilizzano ciascun ciclo.

Fate clic su **Modifica nella griglia** per modificare direttamente le celle. Le date e le risposte di supporto aprono un piccolo editor ed è possibile trascinare il valore di una cella lungo una colonna (come in Excel) per copiarlo su più cicli. Il menu di riga (**⋮**) aggiunge un ciclo al prodotto, modifica nome, link e descrizione del prodotto oppure elimina un ciclo o il prodotto.

Un prodotto non può essere eliminato finché vi sono schede collegate. Eliminare un ciclo utilizzato da schede lascia il loro stato di fine vita **sconosciuto** finché qualcuno non sceglie un altro ciclo. Rinominare un ciclo sposta con sé le schede collegate.

È possibile aggiungere un ciclo mancante anche da una scheda: una volta selezionato un prodotto personalizzato nella sezione Fine vita della scheda, l'elenco dei cicli termina con **Aggiungi ciclo…**.

### Contribuire con un prodotto personalizzato a endoflife.date

Se un prodotto personalizzato è un prodotto pubblico di un fornitore, valutate di proporlo a endoflife.date, così che tutti ne traggano vantaggio. Scegliete **Proponi a endoflife.date** dal menu di riga:

1. Leggete l'avviso: la proposta pubblica il nome del prodotto e le sue date. Non proponete mai prodotti interni o riservati.
2. Scegliete la **categoria** di endoflife.date. La finestra mostra l'anteprima del file del prodotto nel formato di endoflife.date (`products/<key>.md`).
3. Fate clic su **Apri su GitHub**. GitHub apre un nuovo file nel repository di endoflife.date con il contenuto compilato (offre di creare un fork del repository se non potete scrivervi). Completate la descrizione e il riepilogo della politica di rilascio, poi aprite la pull request dal vostro account GitHub. Per i file lunghi, usate invece **Copia file** e incollatelo in un nuovo file.

Turbo EA non invia mai nulla a GitHub da solo e non memorizza credenziali GitHub. endoflife.date esamina ogni proposta in base alla propria [guida al contributo](https://github.com/endoflife-date/endoflife.date/blob/master/CONTRIBUTING.md).

### Passare a endoflife.date

Quando endoflife.date inizia a monitorare un prodotto che avevate mantenuto come personalizzato, la griglia mostra accanto un suggerimento **Su endoflife.date**. Fate clic sul suggerimento oppure scegliete **Passa a un prodotto di endoflife.date…** dal menu di riga:

1. Scegliete il prodotto di endoflife.date.
2. Per ciascuno dei vostri cicli, scegliete il ciclo di endoflife.date a cui le sue schede devono passare (i cicli con lo stesso nome vengono abbinati automaticamente), oppure mantenetelo sul prodotto personalizzato.
3. Facoltativamente, eliminate il prodotto personalizzato quando nessuna scheda lo collega più.

Vengono spostate solo le schede visibili. Le date del ciclo di vita sulle schede non vengono mai modificate.

## Report EOL

I dati EOL collegati alimentano il [Report EOL](../guide/reports.md), che fornisce una vista dashboard dello stato di supporto del vostro panorama tecnologico su tutte le card collegate.

## Trovare ciò che non è ancora collegato

Due punti fuori da questa pagina elencano le schede senza alcuna informazione di fine vita — né un collegamento qui né una data di fine vita propria:

- Il filtro e la colonna **Fine vita** nell'[Inventario](../guide/inventory.md): scegli un tipo di scheda, poi l'opzione **(vuoto)**.
- Il valore **Nessun dato di fine vita** nel [Report EOL](../guide/reports.md) e il grafico **Copertura di fine vita** in fondo al report Qualità dei dati.
