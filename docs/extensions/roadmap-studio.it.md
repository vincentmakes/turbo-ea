# Roadmap Studio

A ogni funzione EA il proprio CIO pone le stesse due domande: *che aspetto avrà
il panorama fra tre anni* e *cosa succede se scegliamo diversamente?* Le
presentazioni rispondono male alla prima e per niente alla seconda: invecchiano
la settimana dopo il comitato di indirizzo e due di esse non sono
confrontabili.

**Roadmap Studio** risponde a entrambe a partire dall'inventario che già
mantenete. Uno **scenario** è un piano steso sopra il vostro panorama vivo —
dismettere questo, sostituire quello a questa data, aggiungere queste tre cose
che ancora non esistono — conservato come insieme di modifiche e non come copia
del vostro grafo. Nulla di ciò che esplorate tocca l'inventario finché un piano
non è approvato e applicato, e poiché il piano è letto rispetto a ciò che
l'inventario dice oggi, non si allontana mai in silenzio dalla realtà.

## In breve

| | |
|---|---|
| **Licenza** | Commerciale: serve un'abilitazione firmata |
| **Versione minima di Turbo EA** | 2.119.0 |
| **Permessi** | `ext.roadmap-studio.view`, `.manage`, `.apply`, `.admin` |
| **Concessioni di accesso ai dati** | Schede (lettura + scrittura), eventi di scheda, attività (lettura + scrittura), la rubrica utenti, i verbali di decisione |
| **Riavvio del backend necessario** | Sì: l'estensione porta codice backend |
| **Dove appare** | **Roadmap** nella navigazione principale · un chip sul dettaglio di una scheda · un pannello e una sezione di esportazione sulle decisioni |

## Trasformazioni e scenari

Una **trasformazione** è il programma a cui appartiene un insieme di piani
concorrenti — «Modernizzazione dell'ERP», per esempio — e nomina gli
[Obiettivi](../guide/reports.md) di cui il programma risponde. Sotto stanno gli
**scenari**: risposte alternative alla stessa domanda. Uno di essi può essere
segnato come **raccomandato**, così la stanza sa cosa propone l'architetto prima
di leggere i numeri.

Uno scenario fuori da ogni trasformazione è perfettamente valido; semplicemente
non ha alternative rispetto a cui essere scelto.

## L'inventario di pianificazione e la roadmap

![La roadmap: corsie, plateau e la fascia dei costi](../assets/img/en/73_ext_roadmap_studio_roadmap.png)

La **roadmap** disegna il piano come barre datate in corsie, con sotto una fascia
dei costi che mostra il costo di esercizio anno per anno — compreso il picco
durante un esercizio in parallelo, cioè proprio il numero che un business case di
migrazione tende a nascondere.

![L'inventario di pianificazione](../assets/img/en/74_ext_roadmap_studio_inventory.png)

L'**inventario di pianificazione** è lo stesso piano in forma di griglia: le
vostre schede vive più quelle pianificate, con ogni modifica a loro carico. Le
schede pianificate vivono dentro lo scenario e mai nell'inventario principale.

Una modifica la cui scheda bersaglio sia stata nel frattempo archiviata, spostata
o ridatata altrove viene **segnalata come obsoleta**, con il motivo: così un
piano scritto tre mesi fa vi dice cosa si è mosso sotto di esso.

## Plateau e la sezione di architettura

![L'architettura a un plateau](../assets/img/en/75_ext_roadmap_studio_architecture.png)

Poiché ogni modifica porta una data, l'architettura in un dato momento è
semplicemente lo scenario valutato a quella data. Date un nome ai momenti che
contano come **plateau** — «T1 · Consolidamento del nucleo, Q3 2027» — e
percorreteli: roadmap, vista delle dipendenze e numeri si muovono insieme.

## Confrontare gli scenari

![Scenari a confronto con il non fare nulla](../assets/img/en/76_ext_roadmap_studio_compare.png)

**Confronta** mette ogni scenario accanto alla linea di base del non fare nulla
su costo di esercizio all'orizzonte, spesa di trasformazione, numero di schede ed
esposizione al fine vita, con i **pro e contro** di ciascun piano scritti accanto
ai suoi numeri. Un tasso di sconto facoltativo si applica agli anni futuri.

## Dove il piano incontra la scheda

![Il posto di una scheda nei piani](../assets/img/en/77_ext_roadmap_studio_card_panel.png)

Aprite una qualsiasi scheda del vostro inventario e un chip vi dirà quali piani
la menzionano e come: come qualcosa che viene dismesso, come successore in una
sostituzione o come scheda che un piano colloca sotto un nuovo genitore.

## Revisione, decisione e applicazione

Questo è il percorso di governance, e separa tre cose davvero diverse: il
**consiglio**, **la decisione** e **la scrittura**.

### 1 · Chiedere una revisione

**Richiedi revisione** nomina le persone di cui volete l'opinione e crea per
ciascuna un'attività reale, che raggiunge la loro pagina Attività e la loro
campanella delle notifiche. Il selettore copre l'intera rubrica: un revisore è
chi può aiutare su *questo* piano — l'architetto della sicurezza per uno, il
partner finanziario per un altro.

Ogni revisore risponde nell'applicazione con **Sostieni**, **Chiedi modifiche** o
**Commenta**, più una nota. Le loro risposte sono consiglio. Non decidono nulla,
ed è per questo che non usano più le parole «approva» e «respingi».

### 2 · Discuterne

Chiunque possa leggere il piano può scrivere nella sua **discussione**. Il filo
porta l'intera storia nell'ordine in cui è accaduta: i commenti, ogni risposta di
revisione (non solo l'ultima) e poi gli invii e i voti. Il comitato legge la
stessa conversazione che hanno avuto i revisori, invece di ricevere un verdetto
senza gli argomenti che lo sostengono.

### 3 · Inviarlo al comitato di revisione

Un **comitato di revisione** è un gruppo di persone con un nome, associato a una
trasformazione (vedi sotto). Quando un piano ne ha uno, **Invia per la decisione**
lo manda lì:

- lo stato diventa **In attesa di decisione** e il contenuto del piano si
  **blocca**, così tutti votano sullo stesso documento;
- ogni membro riceve un'attività *Decidi su …*, con la consueta notifica di
  assegnazione;
- qui scegliete se l'approvazione debba depositare un **verbale di decisione** e
  creare le **iniziative**: si decide all'invio, perché chi vota veda cosa
  creerà il suo sì.

Il **filtro di approvazione** (Admin → Impostazioni, vedi sotto) può trattenere un
piano prima del suo comitato finché i revisori non hanno risposto.

### 4 · Il comitato vota

Ogni membro vota **Approva**, **Respingi** o **Astieniti**, con una nota
facoltativa, e può cambiare voto finché il turno è aperto. La finestra mostra il
conteggio, quante approvazioni mancano e cosa ha detto ciascun membro.

Il turno si chiude appena la **regola di decisione** del comitato è determinata:

| Regola | Approva quando | Respinge quando |
|---|---|---|
| **Maggioranza** (predefinita) | Più della metà approva | Hanno respinto in tanti da rendere impossibile la maggioranza |
| **Unanimità** | Tutti i membri approvano | Un membro respinge **o** si astiene |
| **Un membro qualsiasi** | Un membro approva | Tutti hanno votato senza approvare |

Il rifiuto arriva appena l'approvazione è diventata aritmeticamente impossibile,
e non dopo che tutti hanno votato su una questione già decisa.

Ciò che consente di votare è l'**appartenenza al comitato**:
`ext.roadmap-studio.apply` non serve. L'**autore del piano può votare** sul
proprio piano; la finestra lo dice chiaramente e il verbale nomina chi ha votato.

**Ritira** toglie un piano dalle mani del comitato prima che abbia deciso.
Possono farlo l'autore, chi lo ha inviato e qualsiasi membro: un comitato che
vuole una rilavorazione non dovrebbe dover respingere il piano per chiederla. Le
attività dei membri vengono rimosse, non segnate come fatte, e il piano torna in
revisione.

### 5 · Cosa fa l'approvazione

Il voto decisivo fa tutto in una volta: gli scenari concorrenti della stessa
trasformazione vengono **respinti**, il piano viene **bloccato**, le richieste
aperte sono saldate, si creano le **iniziative** (un programma per la
trasformazione, un progetto per plateau) e un **verbale di decisione** viene
depositato in bozza in [Consegna EA → Decisioni](../guide/delivery.md), con il
comitato, la sua regola, il conteggio, ogni voto con la sua nota, gli obiettivi,
i plateau, i numeri rispetto al non fare nulla e ogni alternativa respinta. Poi
si chiedono le firme ai membri che hanno votato a favore.

Un piano approvato è in sola lettura finché chi possiede
`ext.roadmap-studio.apply` non lo **riapre**, il che cancella l'approvazione.

### 6 · Applicarlo

**Applica** scrive il piano nel vostro inventario vivo, sotto
`ext.roadmap-studio.apply`. È un'azione separata, spesso mesi dopo la decisione.
Ogni scrittura passa dal meccanismo di batch tracciato, quindi compare in
**Admin → Registro di audit** e può essere annullata. Un utente `.manage` può
aprire lo stesso piano in sola lettura per verificare che verrebbe applicato
senza intoppi.

### Scenari senza comitato di revisione

Uno scenario fuori da una trasformazione, o la cui trasformazione non ha un
comitato, mantiene il percorso più semplice: chi possiede
`ext.roadmap-studio.apply` lo approva direttamente. Una piccola squadra senza un
organo di governance da convocare non deve inventarsene uno.

## Comitati di revisione

I comitati si gestiscono in un solo posto: **Impostazioni → Governance →
Gestisci comitati di revisione** nella pagina Roadmap (richiede
`ext.roadmap-studio.admin`). Un comitato ha un nome, una descrizione, fino a 25
membri e una **regola di decisione**. Associatelo a una o più trasformazioni da
entrambi i lati.

Eliminare un comitato scollega le trasformazioni che rivedeva; non le elimina
mai, e non tocca mai il verbale di ciò che ha deciso in passato.

## Impostazioni e cronologia

![Impostazioni e cronologia delle attività](../assets/img/en/79_ext_roadmap_studio_settings.png)

La scheda **Impostazioni** della pagina Roadmap (richiede
`ext.roadmap-studio.admin`) contiene:

| Impostazione | Cosa fa |
|---|---|
| **Modello di costo** | Quale attributo porta il costo annuo di esercizio di una scheda, quali tipi di scheda conta l'indicatore, quanto avanti guarda l'esposizione al fine vita e un tasso di sconto facoltativo |
| **Filtro di approvazione** | Se le risposte dei revisori trattengono un piano prima del comitato: mai, finché sono chieste modifiche, o finché tutti non hanno risposto |
| **Comitati di revisione** | Apre la finestra dei comitati |

La scheda **Cronologia** è un registro completo delle attività: ogni piano,
scheda, modifica, plateau, richiesta di revisione, risposta, invio, voto,
commento e decisione, con chi l'ha fatto e cosa è cambiato.

## Modalità presentazione e le slide

![Modalità presentazione](../assets/img/en/78_ext_roadmap_studio_present.png)

La **modalità presentazione** accompagna una stanza attraverso il piano plateau
per plateau, e l'esportazione in PowerPoint segue esattamente la sequenza appena
percorsa.

## Dati dimostrativi

Un clic nelle Impostazioni carica un panorama di esempio completo con due scenari
concorrenti, per provare tutto prima di inserire i vostri dati. Un altro clic ne
rimuove ogni traccia.

## Permessi

| Permesso | Consente |
|---|---|
| `ext.roadmap-studio.view` | Vedere scenari, confronti, plateau, la discussione e la decisione |
| `ext.roadmap-studio.manage` | Creare e modificare piani, richiedere revisioni, inviare per la decisione, ritirare |
| `ext.roadmap-studio.apply` | Applicare un piano approvato all'inventario vivo, riaprirlo e approvare un piano senza comitato di revisione |
| `ext.roadmap-studio.admin` | Impostazioni, comitati di revisione e dati dimostrativi |

Votare non è un permesso: deriva dall'**appartenenza al comitato** che decide su
quel piano, più `ext.roadmap-studio.view` per aprirlo. Chiunque abbia `.view` può
scrivere nella discussione.

## Se la licenza scade o l'estensione è disattivata

La pagina Roadmap e la sua API scompaiono, ma **non viene eliminato nulla**:
scenari, piani, voti e discussione restano nelle tabelle proprie dell'estensione.
Le schede che l'estensione ha creato nel vostro inventario sono schede normali e
non ne risentono. Applicare una licenza rinnovata riporta tutto.

## Note e limiti

- **Un piano alla volta** va al comitato all'interno della stessa trasformazione.
- **Nessuna presidenza e nessun voto ponderato.** Ogni voto conta una volta e non
  esiste voto decisivo del presidente.
- **Nessun promemoria.** Un turno resta aperto finché la regola non lo decide o
  qualcuno non lo ritira.
- **L'autore del piano può votare** sul proprio piano. È deliberato: un piccolo
  comitato il cui architetto non potesse votare non potrebbe decidere nulla, e
  ogni voto è nominato nel verbale.
- L'estensione porta codice backend, quindi installarla o aggiornarla richiede un
  riavvio una tantum del backend. Turbo EA mostra un avviso quando serve.
