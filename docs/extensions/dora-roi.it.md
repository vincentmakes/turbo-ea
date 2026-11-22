# DORA Register of Information

Ogni entità finanziaria dell'UE deve tenere un **registro delle informazioni** su
tutti i propri accordi con fornitori terzi di servizi TIC e trasmetterlo
annualmente tramite la propria autorità di vigilanza: 15 modelli interconnessi,
consegnati come pacchetto xBRL-CSV leggibile da macchina conforme al quadro EBA.
Nella prova a vuoto 2024 delle AEV solo il 6,5 % dei registri ha superato tutti i
controlli di qualità dei dati.

I dati di cui il registro ha bisogno sono esattamente quelli che il vostro
repository EA già contiene. **DORA Register of Information** trasforma Turbo EA
nel vostro registro.

## Il registro vive sulle vostre schede

Questa estensione non tiene **alcuna tabella propria** per i contenuti del
registro. Ogni oggetto del registro è una scheda o una relazione:

| Oggetto del registro | In Turbo EA |
|---|---|
| Entità giuridiche nel perimetro | Schede **Organizzazione** con *In DORA register scope* attivo |
| Succursali | Schede **Organizzazione** con sottotipo **Branch**, figlie della propria sede |
| Fornitori terzi di servizi TIC | Schede **Provider** |
| Accordi contrattuali | Schede **ICT Arrangement** (un nuovo tipo di scheda) |
| Servizi TIC | Schede **ICT Service** (un nuovo tipo di scheda) |
| Funzioni critiche o importanti | Schede **Capacità di business** / **Processo di business** contrassegnate come funzioni del registro |
| Parti firmatarie, utilizzatrici e fornitrici, catene di subfornitura | **Relazioni** fra tali schede |

Questo è l'intero impianto: ogni campo si modifica nella vista scheda di Turbo EA,
con i suoi indicatori di obbligatorietà, la validazione, la guida contestuale e il
punteggio di qualità dei dati, e il registro viene assemblato dal vivo a partire
dalle schede a ogni validazione o esportazione.

![Schede ICT Service nell'inventario con il loro punteggio DORA](../assets/img/en/73_ext_dora_cards.png)

!!! note "Non c'è volutamente una scheda DORA sulla card"
    I campi aggiunti compaiono come normali sezioni di attributi su una scheda, e
    ogni collegamento del registro è una relazione ordinaria. Nulla nella tenuta
    del registro è una modalità speciale.

## In sintesi

| | |
|---|---|
| **Licenza** | Commerciale — è richiesto un diritto firmato |
| **Versione minima di Turbo EA** | 2.182.0 |
| **Permessi** | `ext.dora-roi.view`, `ext.dora-roi.manage`, `ext.dora-roi.submit`, `ext.dora-roi.admin` |
| **Autorizzazioni di accesso ai dati** | `core.cards.read`, `core.cards.write`, `metamodel.custom_field_types` |
| **Riavvio del backend necessario** | sì — include codice di backend |
| **Dove compare** | **Registro DORA** nel menu **GRC** (una voce di primo livello quando il menu GRC non è disponibile per voi) · **Report → Registro DORA - Cruscotto** · sezioni **DORA Register** e **DORA Function** sulle schede · sei modelli di sondaggio |

## Che cosa aggiunge al vostro metamodello

**Due nuovi tipi di scheda**

- **ICT Arrangement** — un accordo contrattuale sull'uso di servizi TIC. È
  **gerarchico**: gli accordi quadro sono i genitori, gli accordi successivi o
  associati i loro figli. Porta la spesa annua e la valuta.
- **ICT Service** — uno per ciascun servizio erogato nell'ambito di un accordo, con
  la riga di servizio (tipo, date, preavvisi, legge applicabile, ubicazioni,
  grado di dipendenza) e la relativa **valutazione** (sostituibilità, piano
  di uscita, reintegrazione, impatto di un'interruzione, fornitori alternativi). I
  suoi tre campi di ubicazione — **Country of provision of the services**,
  **Location of the data at rest** e **Location of data management** (dove i dati
  sono trattati) — offrono ciascuno **Not applicable**. Un servizio senza
  ubicazione del trattamento dei dati registrata impedisce di finalizzare
  un'istantanea: scegliete il Paese, oppure **Not applicable** se il servizio non
  comporta alcun trattamento di dati.

**Un nuovo sottotipo** — **Branch** su Organizzazione.

**Nuove sezioni su tipi di scheda esistenti**

| Tipo di scheda | Sezione | Contenuto |
|---|---|---|
| **Organizzazione** | DORA Register | Nel perimetro del registro DORA, LEI, Paese, Tipo di entità, Posizione nel gruppo, Autorità competente, Totale attivo, Valuta di segnalazione, Codice della succursale |
| **Provider** | DORA Register | LEI, Tipo di identificativo, EUID, Altro codice di identificazione, Tipo di persona, Paese della sede, Fornitore infragruppo, spesa annua, capogruppo ultima |
| **Capacità di business** / **Processo di business** | DORA Function | Funzione del registro DORA, Identificativo di funzione, Attività autorizzata, Valutazione di criticità o importanza, Motivi di criticità, Data dell'ultima valutazione, RTO, RPO, Impatto di un'interruzione |

Ogni sezione porta inoltre un **punteggio DORA (%)** di sola lettura: una barra di
completezza che mostra quanti dati di registro quella scheda deve ancora fornire.

**Nove tipi di relazione**, due dei quali portano attributi che impostate relazione
per relazione:

- **Organizzazione → ICT Arrangement** (*è parte di*) porta l'attributo **ruoli
  DORA**: **Entità firmataria**, **Utilizzo dei servizi TIC**, **Entità fornitrice
  (infragruppo)**.
- **ICT Service → Provider** (*è fornito da*) porta un **rango nella catena di
  fornitura**: il **rango 1** è il fornitore diretto, i ranghi successivi sono
  subfornitori.

L'estensione aggiunge inoltre una regolamentazione **DORA** allo
[scanner di conformità](../guide/compliance.md) del nucleo.

## Primi passi

L'area di lavoro si apre su un **Cruscotto** con una lista di controllo **Getting
started** che segue questi sette passi e ne mostra l'avanzamento.

![Il cruscotto del registro DORA](../assets/img/en/72_ext_dora_dashboard.png)

1. **Scegliete l'entità segnalante nelle Impostazioni** — l'entità di cui questo è
   il registro.
2. **Contrassegnate le vostre entità giuridiche.** Su ogni scheda Organizzazione
   compilate la sezione **DORA Register**: attivate *In DORA register scope* e
   indicate LEI, Paese, tipo di entità e posizione nel gruppo. Le succursali sono
   schede Organizzazione con sottotipo **Branch**, figlie della propria sede.
3. **Create una scheda ICT Arrangement per ogni accordo contrattuale.** Rendete i
   contratti successivi *figli* del contratto quadro: è da lì che si derivano il
   tipo di accordo e il riferimento dell'accordo quadro.
4. **Collegate ogni accordo** alla sua scheda Provider e alle entità che firmano,
   utilizzano o forniscono, impostando su ciascuna l'attributo **ruoli DORA**.
5. **Create una scheda ICT Service per ogni servizio**, poi collegatela al suo
   contratto, alle entità che lo utilizzano, alle funzioni che supporta e ai suoi
   fornitori **per rango**.
6. **Contrassegnate le funzioni.** Attivate *DORA register function* sulle schede
   Capacità di business o Processo di business che sono funzioni critiche o
   importanti e completate la loro sezione **DORA Function**, oppure accettate le
   proposte da [Suggerimenti](#suggerimenti).
7. **Validate il registro e risolvete i rilievi.**

!!! tip "Raccogliete i dati da chi li possiede"
    Sei modelli di sondaggio in **Admin → Sondaggi → Nuovo da modello**
    raccolgono i dati obbligatori dai responsabili delle schede: **DORA entity
    data**, **DORA provider data**, **DORA arrangement data**, **DORA ICT service
    data** e **DORA function data** per capacità e per processi. Ciascuno si apre
    come bozza.

### Ciò che non dovrete mai digitare

Il registro deriva quanto segue invece di chiederlo: il LEI della capogruppo
(dalla gerarchia delle schede), le date di integrazione e cessazione (dal ciclo di
vita della scheda), il tipo di accordo e il riferimento dell'accordo quadro (dalla
gerarchia degli accordi), la natura della succursale (dal sottotipo Branch), il
destinatario di un servizio subappaltato (dall'ordine di rango dei fornitori) e la
data di ultimo aggiornamento. Anche il **perimetro dei fornitori** è derivato:
entrano nel registro solo le schede Provider effettivamente richiamate da un
accordo o da una catena di fornitura, così i fornitori estranei restano
automaticamente fuori. Le convenzioni di compilazione delle ITS (`9999-12-31` per
le date senza termine, *not applicable* per gli accordi non successivi) sono
applicate per voi.

## L'area di lavoro

**Registro DORA** nel menu **GRC** ha cinque schede. Lo stesso
cruscotto è disponibile anche come report salvabile in **Report → Registro DORA - Cruscotto**.

### Cruscotto

Sei riquadri — **Register completeness**, **Blocking findings**, **Warnings**,
**Critical functions**, **Providers**, **Arrangements** — sopra un pulsante
**Validate now** e una riga che indica quante delle regole attive dell'EBA sono
state eseguite, con un collegamento **Rules not run** (vedi
[Validazione](#validazione)). Sotto, una barra di conteggi rimanda direttamente
all'inventario per ciascun oggetto del registro, e la tabella **Template
completeness** mostra righe e rilievi per modello.

![La tabella «Template completeness»](../assets/img/en/74_ext_dora_template_completeness.png)

Un clic su un numero di rilievi apre **Validation findings**: una riga per
rilievo, con gravità (**Blocking** o **Warning**), modello, riga di registro,
scheda, regola, colonna e messaggio, e filtri per gravità, modello, tipo di scheda
e regola. La regola è una tra **Missing**, **Missing key value**, **Invalid
value**, **Invalid LEI**, **Duplicate row**, **Broken reference**, **Unknown
column** o **EBA rule**. Un clic su un rilievo, o sulla sua azione **Open card**,
apre in un pannello laterale la scheda da correggere; un rilievo sulle
impostazioni di deposito offre invece **Open settings**. Il pulsante **Rules not
run** apre l'elenco descritto in [Validazione](#validazione).

### Registro

Sei viste — **Legal entities**, **Branches**, **Contractual arrangements**,
**ICT third-party providers**, **ICT services** e **Functions** — ciascuna come
tabella delle schede che compongono quella parte del registro, con un campo di
ricerca, un pulsante **New …** che crea una scheda con il tipo e i contrassegni
corretti e un collegamento **Open in inventory**. Un clic su una riga apre la
scheda in un pannello laterale.

### Suggerimenti

**Find suggestions** percorre le vostre relazioni Fornitore → Applicazione →
Capacità/Processo e propone aggiornamenti del registro — funzioni non
contrassegnate e innalzamenti di criticità — ciascuno con l'evidenza che lo
sostiene. Nulla viene scritto finché non premete **Accept** su una riga;
**Dismiss** la toglie dall'elenco.

### Invii

**New snapshot** fissa il registro a una **data di riferimento**. Ogni istantanea
attraversa poi tre stati:

1. **Draft** — premete **Validate** per controllarla. I rilievi sono elencati con
   gravità, modello, riga, colonna e messaggio.
2. **Validated** — premete **Finalize**. L'operazione è rifiutata finché resta un
   rilievo **bloccante** o non è impostata un'entità segnalante dotata di LEI. Sono
   rilievi bloccanti, tra gli altri, un servizio senza ubicazione del trattamento
   dei dati, qualsiasi altro campo chiave lasciato vuoto dove si applica e un LEI
   di fornitore che non rispetta il formato ISO 17442 o la somma di controllo
   (**Invalid LEI**).
3. **Final** — l'istantanea è immutabile, l'hash del suo pacchetto è fissato per
   l'audit, conserva i rilievi e la copertura delle regole con cui è stata
   controllata e non può più essere eliminata né rivalidata.

Due download sono sempre disponibili:

- **xBRL-CSV package** — un pacchetto di report DORA costruito secondo la
  tassonomia del quadro EBA 4.0 (modulo DORA 1.1.0), in formato `.zip`, con i
  metadati del report, gli indicatori di deposito, i parametri e un CSV per
  modello. Il nome del file riporta il codice paese ISO dell'entità segnalante. Un
  fornitore che ha sia un LEI sia un EUID è segnalato con entrambi: il LEI come
  codice di identificazione e l'EUID come codice di identificazione aggiuntivo. Il
  pacchetto è riproducibile byte per byte, e un nuovo download di un'istantanea
  finale viene verificato rispetto al suo hash fissato.
- **Excel workbook** — una cartella di revisione con copertina, un foglio per
  modello con le etichette e i codici di colonna dell'EBA e un foglio dei membri,
  per far circolare il registro internamente prima del deposito.

Prima di ogni versione che modifica l'esportazione, il pacchetto costruito dal
registro dimostrativo viene validato con Arelle, il processore XBRL open source,
rispetto alla tassonomia del quadro 4.0 pubblicata dall'EBA, comprese le
asserzioni di validazione della tassonomia stessa. Ciò copre la struttura del
pacchetto, non i controlli di ricezione dell'EBA né le sue consultazioni di
registri: se il portale della vostra autorità accetti il file è un test a parte,
che eseguite voi.

### Impostazioni

**Filing** — il **Filing scope** (**Consolidated (.CON)** o **Individual
(.IND)**), la **Reporting currency**, la **Taxonomy version** e la **Reporting
entity**, il cui LEI e Paese determinano il pacchetto di report.

**Definitions (B_99.01)** — definizioni libere facoltative per i termini a lista
chiusa usati dal vostro registro, depositate come modello B_99.01.

**Demo data** — **Load demo data** carica un registro di esempio completo (entità
di gruppo e una succursale, fornitori, accordi quadro e infragruppo, una catena di
fornitura a tre livelli, funzioni critiche, suggerimenti e un'istantanea in bozza)
per esplorare ogni funzionalità prima di toccare dati reali. Tutte le schede
dimostrative si chiamano *Demo DORA — …* e portano l'etichetta **Demo Dora**;
**Remove demo data** le rimuove.

## I 15 modelli

| Modello | Contenuto |
|---|---|
| B_01.01 | Entità che tiene il registro delle informazioni |
| B_01.02 | Elenco delle entità nel perimetro |
| B_01.03 | Elenco delle succursali |
| B_02.01 | Accordi contrattuali – informazioni generali |
| B_02.02 | Accordi contrattuali – informazioni specifiche |
| B_02.03 | Elenco degli accordi contrattuali infragruppo |
| B_03.01 / B_03.02 / B_03.03 | Parti firmatarie |
| B_04.01 | Entità che utilizzano i servizi TIC |
| B_05.01 | Fornitori terzi di servizi TIC |
| B_05.02 | Catene di fornitura dei servizi TIC |
| B_06.01 | Identificazione delle funzioni |
| B_07.01 | Valutazione dei servizi TIC |
| B_99.01 | Definizioni |

## Validazione

La validazione si svolge su quattro livelli: **struttura** (tipi di dato, somme di
controllo dei LEI, date, numeri e i campi obbligatori e chiave trattati come
bloccanti quando sono vuoti), **membri** (valori a lista chiusa confrontati con le
liste di codici della tassonomia), **chiavi** (completezza e univocità delle chiavi
primarie e riferimenti fra modelli) e le **regole di validazione dell'EBA
eseguibili offline**, con le gravità pubblicate. Le regole ritirate dall'EBA non
vengono eseguite.

L'EUID di un fornitore viene controllato rispetto al formato EUID: il codice paese
e l'identificativo del registro, un punto, poi il numero di registrazione. Un
valore senza punto, o un LEI inserito come EUID, viene segnalato come avviso. Un
controllo locale è più rigoroso di quello dell'EBA: un codice di identificazione
di fornitore dichiarato come LEI che non rispetta il formato ISO 17442 o la somma
di controllo è un rilievo bloccante **Invalid LEI**, mentre la regola propria
dell'EBA è un avviso. Un LEI non valido della capogruppo ultima di un fornitore
resta un avviso.

!!! warning "La copertura è parziale — e viene dichiarata con onestà"
    Turbo EA esegue le regole dell'EBA valutabili offline, e il cruscotto indica
    quante delle regole attive dell'EBA sono state eseguite. **Rules not run**,
    aperto da tale indicazione o dai rilievi di validazione, elenca tutte le altre
    regole con il loro modello, il testo proprio dell'EBA e il motivo per cui qui
    non vengono eseguite: una **EBA expression** che va oltre i controlli offline,
    che i sistemi dell'autorità di vigilanza valutano sul file che trasmettete, o
    un **Package check** che l'EBA applica al pacchetto di report trasmesso anziché
    al registro. Nomina inoltre le regole su LEI, EUID e Paese che qui girano solo
    come controlli offline di somma di controllo, formato e lista di codici, mentre
    l'EBA cerca i codici in GLEIF e nei registri delle imprese (BRIS).
    Considerate una validazione pulita come un solido controllo preliminare, non
    come una garanzia di accettazione da parte dell'autorità di vigilanza.

## Permessi

| Permesso | Consente |
|---|---|
| `ext.dora-roi.view` | Consultare il registro, i cruscotti e i risultati della validazione |
| `ext.dora-roi.manage` | Modificare i dati del registro e decidere sui suggerimenti |
| `ext.dora-roi.submit` | Fissare istantanee a una data di riferimento e scaricare i pacchetti di report |
| `ext.dora-roi.admin` | Configurare le impostazioni di deposito e caricare o rimuovere i dati dimostrativi |

Modificare i dati del registro richiede inoltre i vostri normali diritti di
modifica delle schede, poiché ogni campo del registro risiede su una scheda.

## Se la licenza scade o l'estensione viene disattivata

L'area di lavoro e i suoi report scompaiono e il ponte verso i dati delle schede
si arresta, ma **non viene eliminato nulla**. Il vostro registro vive su schede e
relazioni ordinarie, quindi ogni valore resta esattamente dov'è, visibile e
modificabile nell'inventario. Istantanee e impostazioni si conservano. Una licenza
rinnovata ripristina subito l'area di lavoro.

Se compare *The card-data bridge is unavailable*, l'estensione è installata ma non
licenziata, oppure il backend non è stato riavviato dopo l'installazione.

## Note e limiti

- **La versione 2.0.0 ha introdotto una modifica non compatibile.** I registri
  costruiti su versioni precedenti conservavano servizi e funzioni in tabelle
  proprie dell'estensione; quelle righe non vengono migrate. Reinseriteli come
  schede ICT Service e di funzione (oppure ricaricate i dati dimostrativi) ed
  eseguite di nuovo **Find suggestions**.
- Modelli, liste di codici e regole sono distribuiti come dati versionati generati
  dal quadro EBA pubblicato: una nuova versione del quadro arriva quindi come
  aggiornamento dell'estensione più un cambio di **Taxonomy version**.
- Il **punteggio DORA** di una scheda è un segnale di triage, non un verdetto di
  conformità. Fanno fede i rilievi del cruscotto.
- Non vengono prodotte varianti Excel specifiche per singola autorità; il pacchetto
  xBRL-CSV è l'artefatto di deposito.
