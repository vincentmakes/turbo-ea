# EA Value Tracker

Ogni funzione EA prima o poi si sente rivolgere la stessa domanda dal CFO o dal
CIO: *quanto vale davvero l'architettura per noi?* Roadmap e diagrammi non
rispondono; i numeri sì.

**EA Value Tracker** trasforma le [decisioni di architettura](../guide/delivery.md)
di Turbo EA in un registro finanziario verificabile del valore creato dalla vostra
pratica EA. Il valore si dichiara dove nasce — sulla decisione —, viene congelato
alla firma e più tardi riconciliato con quanto realmente realizzato, sotto
approvazione a quattro occhi. Un cruscotto consolida il tutto: la risposta in sede
di revisione di budget è un report, non una caccia tra fogli di calcolo.

## In sintesi

| | |
|---|---|
| **Licenza** | Commerciale — è richiesto un diritto firmato |
| **Versione minima di Turbo EA** | 2.14.0 |
| **Permessi** | `ext.value-savings.record`, `ext.value-savings.approve` |
| **Autorizzazioni di accesso ai dati** | nessuna |
| **Riavvio del backend necessario** | sì — include codice di backend |
| **Dove compare** | Pannello **Valore e risparmi** sulle decisioni · registro **Realizzazione del valore** sotto il blocco firme · quattro colonne nelle tabelle delle decisioni · **Report → EA Value Tracker** |

## Il ciclo di vita

Il valore attraversa quattro fasi, mostrate come sequenza su ogni decisione:

**Dichiarato (bozza)** › **Dichiarato (approvato)** › **Realizzato (in attesa)** ›
**Realizzato (approvato)**

1. Mentre una decisione viene redatta, gli architetti vi allegano **risparmi
   dichiarati**.
2. **La firma li congela.** Le cifre approvate dai firmatari diventano
   dichiarazioni approvate e non sono più modificabili.
3. Dopo l'attuazione qualcuno **registra quanto è stato realmente realizzato** a
   fronte di ciascuna dichiarazione.
4. Una **seconda persona approva** la realizzazione: chi registra non può mai
   approvare le proprie cifre.

## Dichiarare valore su una decisione

Aprite una bozza di decisione (**EA Delivery → Decisioni**) e scorrete fino a
**Valore e risparmi**, subito dopo le conseguenze.

![Il pannello «Valore e risparmi» su una bozza di decisione](../assets/img/en/66_ext_value_tracker_claims.png)

Premete **Aggiungi risparmio** e compilate la finestra:

| Campo | Note |
|---|---|
| **Categoria** | **Risparmi diretti**, **Risparmi indiretti**, **Costi evitati**, **Abilitazione dei ricavi** o **Rischi evitati** |
| **Importo** | Nella valuta del vostro spazio di lavoro. Deve essere maggiore di zero |
| **Anno fiscale** | Derivato dall'inizio dell'esercizio definito nelle [Impostazioni generali](../admin/settings.md) |
| **Tipo** | **Una tantum** o **Ricorrente** |
| **Responsabile** | Una o più persone che rispondono della cifra |
| **Descrizione** | Testo libero facoltativo |

Aggiungete tutte le dichiarazioni che la decisione giustifica. Accanto al titolo
del pannello compare un totale progressivo e, sotto, un'etichetta per categoria.

!!! note "«Ricorrente» è un'informazione"
    Una voce **ricorrente** resta nell'anno fiscale che le avete assegnato: non
    viene mai estesa automaticamente agli esercizi successivi. La distinzione
    serve a far capire a chi legge la differenza tra un risparmio annuale
    ricorrente e uno una tantum, e a far esporre separatamente al cruscotto
    l'importo ricorrente annuo.

Modificare le dichiarazioni richiede il consueto permesso `adr.manage`.

## Che cosa accade alla firma

Quando i firmatari firmano la decisione, Turbo EA congela l'intera decisione,
dichiarazioni comprese. L'editor scompare dal corpo del documento e:

- le dichiarazioni passano a **Dichiarato (approvato)** e diventano di sola
  lettura;
- sotto il blocco firme compare il registro **Realizzazione del valore**;
- nell'intestazione della decisione compaiono un pulsante **Realizzazione del
  valore** e le etichette **Dichiarato** e **Realizzato**, accanto a Duplica e
  Nuova revisione.

Per cambiare una cifra approvata, create una **nuova revisione** della decisione.
È voluto: le cifre approvate dai firmatari restano esattamente come le hanno
approvate.

## Registrare e approvare il valore realizzato

![Il registro «Realizzazione del valore» sotto il blocco firme](../assets/img/en/67_ext_value_tracker_realization.png)

**Registrare.** Chi possiede `ext.value-savings.record` vede un pulsante
**Registra** su ogni dichiarazione approvata ancora priva di realizzazione. La
finestra chiede l'**importo** effettivo, l'**anno fiscale**, una persona
**approvatrice** e una descrizione facoltativa.

La persona approvatrice **deve essere diversa da chi registra**: una regola dei
quattro occhi applicata dal server, non solo dal modulo. Al salvataggio la riga
nasce come **In attesa** e viene creato un compito per chi approva («Approva il
valore realizzato: …») collegato alla decisione, con la consueta notifica di
assegnazione.

**Approvare.** La persona designata — che deve possedere anche
`ext.value-savings.approve` — apre la decisione e preme **Approva** o **Rifiuta**
sulla riga in attesa. Il compito viene chiuso e la cifra diventa **Realizzato
(approvato)**. Le righe rifiutate restano per la tracciabilità.

**Correzioni.**

- Solo chi ha deciso può ribaltare in seguito la propria decisione o premere
  **Ritira decisione** per riportare la riga in attesa (il che riapre il compito).
- Solo chi ha registrato può eliminare la propria riga, e soltanto finché è in
  attesa. Chi approva rifiuta anziché eliminare.
- Per correggere una cifra già approvata, registrate una **nuova voce di
  rettifica** invece di modificare lo storico.

## Il cruscotto

**Report → EA Value Tracker** consolida tutto.

![Il cruscotto di EA Value Tracker](../assets/img/en/68_ext_value_tracker_dashboard.png)

**Barra degli strumenti**

- **Dichiarato** / **Realizzato** — la base dell'intero report: valore
  *dichiarato* sulle decisioni oppure valore effettivamente *realizzato*.
- **Anno fiscale** — l'esercizio in corso è preselezionato; deselezionate tutto
  per vedere tutti gli anni.
- Filtri **Categoria** e **Persona**.
- **Includi le bozze** oppure **Includi quelle in attesa**.

**Indicatori** — Realizzato (approvato), Dichiarazioni approvate, Ricorrente
(annuo), Bozza e il numero di decisioni che contribuiscono.

L'**imbuto dei risparmi** mostra le quattro fasi affiancate: lo scarto tra
promesso e incassato salta subito all'occhio.

![Risparmi per categoria](../assets/img/en/69_ext_value_tracker_categories.png)

**Risparmi per categoria** è un anello con il totale al centro. **Risparmi per
persona (ripartizione equa)** attribuisce a una voce assegnata a *N* persone
*importo ÷ N* ciascuna, così nessun valore viene contato due volte.

![Risparmi per anno fiscale](../assets/img/en/70_ext_value_tracker_fiscal_years.png)

**Risparmi per anno fiscale** copre una finestra fissa da quattro anni indietro a
due anni avanti e ignora deliberatamente il filtro sull'esercizio, così
l'andamento resta sempre leggibile.

Due tabelle completano il quadro: la **ripartizione per persona** e le **decisioni
che contribuiscono**, il registro completo con un collegamento **Apri** a ciascuna
decisione.

Il report si salva, si condivide, si stampa e si esporta in XLSX e PPTX come
qualsiasi report del nucleo: può finire direttamente in un fascicolo per il
comitato di indirizzo.

## Nelle tabelle delle decisioni

Alla tabella condivisa delle decisioni vengono aggiunte quattro colonne, sia in
**EA Delivery → Decisioni** sia in **GRC → Governance → Decisioni**:

| Colonna | Mostra |
|---|---|
| **Risparmi dichiarati** | Totale dichiarato su quella decisione |
| **Realizzato** | Totale delle realizzazioni approvate |
| **Approvatore risparmi** | Chi ha approvato le realizzazioni |
| **Fase dei risparmi** | La fase più avanzata raggiunta |

Si comportano come colonne native — ordinamento, filtro rapido e tema funzionano —
e possono essere nascoste o bloccate dal selettore di colonne.

## Permessi

| Permesso | Consente |
|---|---|
| `adr.view` (nucleo) | Vedere i pannelli, le colonne e il cruscotto |
| `adr.manage` (nucleo) | Aggiungere, modificare ed eliminare dichiarazioni su una decisione non firmata |
| `ext.value-savings.record` | Registrare una realizzazione a fronte di una dichiarazione approvata |
| `ext.value-savings.approve` | Approvare o rifiutare una realizzazione — **ed** essere la persona indicata come approvatrice |

Assegnate i due permessi dell'estensione in **Admin → Utenti e ruoli**. Attenzione:
`ext.value-savings.approve` da solo non basta, perché il server verifica anche che
siate la persona approvatrice indicata su quella specifica riga.

## Se la licenza scade o l'estensione viene disattivata

I pannelli, le colonne e il cruscotto scompaiono, ma **non viene eliminato
nulla**. Le dichiarazioni risiedono nella decisione stessa e seguono un
trasferimento dello spazio di lavoro; le realizzazioni restano nelle tabelle
proprie dell'estensione. Una licenza rinnovata riporta tutto.

## Note e limiti

- I risparmi **non** sono deliberatamente inclusi nell'esportazione Word della
  decisione: quell'esportazione è il documento di decisione, non il registro
  finanziario.
- Le realizzazioni si registrano a fronte di una dichiarazione approvata, quindi
  una decisione deve essere firmata prima che vi si possa realizzare valore.
- L'estensione include codice di backend: installazione e aggiornamento
  richiedono un riavvio una tantum del backend. Turbo EA mostra allora un avviso.
