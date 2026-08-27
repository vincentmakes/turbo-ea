# DORA Register of Information

Ogni entità finanziaria dell'UE deve tenere un **registro delle informazioni** su
tutti i propri accordi con fornitori terzi di servizi TIC e trasmetterlo
annualmente tramite la propria autorità di vigilanza: 15 modelli interconnessi,
consegnati come pacchetto xBRL-CSV leggibile da macchina conforme al quadro EBA.
Nella prova a vuoto delle AEV il 93,5 % delle trasmissioni conteneva almeno un
errore nei dati, e l'86 % di questi era costituito da informazioni obbligatorie
mancanti.

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
| **Versione minima di Turbo EA** | 2.94.0 |
| **Permessi** | `ext.dora-roi.view`, `ext.dora-roi.manage`, `ext.dora-roi.submit`, `ext.dora-roi.admin` |
| **Autorizzazioni di accesso ai dati** | `core.cards.read`, `core.cards.write`, `metamodel.custom_field_types` |
| **Riavvio del backend necessario** | sì — include codice di backend |
| **Dove compare** | **Registro DORA** nella navigazione principale · **Report → Registro DORA** · sezioni **DORA Register** e **DORA Function** sulle schede · sei modelli di sondaggio |

## Che cosa aggiunge al vostro metamodello

**Due nuovi tipi di scheda**

- **ICT Arrangement** — un accordo contrattuale sull'uso di servizi TIC. È
  **gerarchico**: gli accordi quadro sono i genitori, gli accordi successivi o
  associati i loro figli. Porta la spesa annua e la valuta.
- **ICT Service** — uno per ciascun servizio erogato nell'ambito di un accordo, con
  la riga di servizio (tipo, date, preavvisi, legge applicabile, ubicazione dei
  dati, grado di dipendenza) e la relativa **valutazione** (sostituibilità, piano
  di uscita, reintegrazione, impatto di un'interruzione, fornitori alternativi).

**Un nuovo sottotipo** — **Branch** su Organizzazione.

**Nuove sezioni su tipi di scheda esistenti**

| Tipo di scheda | Sezione | Contenuto |
|---|---|---|
| **Organizzazione** | DORA Register | Nel perimetro del registro DORA, LEI, Paese, Tipo di entità, Posizione nel gruppo, Autorità competente, Totale attivo, Valuta di segnalazione, Codice della succursale |
| **Provider** | DORA Register | LEI, Tipo di identificativo, EUID, Tipo di persona, Paese della sede, Fornitore infragruppo, spesa annua, capogruppo ultima |
| **Capacità di business** / **Processo di business** | DORA Function | Funzione del registro DORA, Identificativo di funzione, Attività autorizzata, Valutazione di criticità, Motivi di criticità, RTO, RPO, Impatto di un'interruzione |

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

**Registro DORA** nella navigazione principale ha cinque schede. Lo stesso
cruscotto è disponibile anche come report salvabile in **Report → Registro DORA**.

### Cruscotto

Sei riquadri — **Register completeness**, **Blocking findings**, **Warnings**,
**Critical functions**, **Providers**, **Arrangements** — sopra un pulsante
**Validate now**. Sotto, una barra di conteggi rimanda direttamente all'inventario
per ciascun oggetto del registro, e la tabella **Template completeness** mostra
righe e rilievi per modello.

![La tabella «Template completeness»](../assets/img/en/74_ext_dora_template_completeness.png)

Un clic su un numero di rilievi apre il pannello **Validation findings**,
raggruppato per riga di registro, con ciascun rilievo classificato come
**Missing**, **Invalid value**, **Duplicate row**, **Broken reference**, **Unknown
column** o **EBA rule**, e contrassegnato **Blocking** o **Warning**. Ogni rilievo
dispone di un pulsante **Open card** che porta esattamente al campo da correggere.

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
   rilievo **bloccante** o non è impostata un'entità segnalante dotata di LEI.
3. **Final** — l'istantanea è immutabile, l'hash del suo pacchetto è fissato per
   l'audit e non può più essere eliminata né rivalidata.

Due download sono sempre disponibili:

- **xBRL-CSV package** — il pacchetto ufficiale del modulo DORA del quadro EBA 4.0
  in formato `.zip`, con i metadati del report, gli indicatori di deposito, i
  parametri e un CSV per modello. È riproducibile byte per byte, e un nuovo
  download di un'istantanea finale viene verificato rispetto al suo hash fissato.
- **Excel workbook** — una cartella di revisione con copertina, un foglio per
  modello con le etichette e i codici di colonna ufficiali e un foglio dei membri,
  per far circolare il registro internamente prima del deposito.

### Impostazioni

**Filing** — il **Filing scope** (**Consolidated (.CON)** o **Individual
(.IND)**), la **Reporting currency**, la **Taxonomy version** e la **Reporting
entity**, il cui LEI e Paese determinano il pacchetto di trasmissione.

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
controllo dei LEI, date, numeri e gli indicatori di campo obbligatorio trattati
come bloccanti), **membri** (valori a lista chiusa confrontati con i domini
ufficiali), **chiavi** (completezza e univocità delle chiavi primarie e riferimenti
fra modelli) e l'**inventario delle regole EBA** con le gravità pubblicate.

!!! warning "La copertura è parziale — e viene dichiarata con onestà"
    Turbo EA esegue le regole valutabili offline. Quelle che richiedono il motore
    di espressioni delle AEV o interrogazioni dal vivo dei registri GLEIF/BRIS non
    possono girare sulla vostra istanza. Anziché saltarle in silenzio, il
    cruscotto dichiara quante regole EBA sono state eseguite e quante no.
    Considerate una validazione pulita come un solido controllo preliminare, non
    come una garanzia di accettazione da parte dell'autorità di vigilanza.

## Permessi

| Permesso | Consente |
|---|---|
| `ext.dora-roi.view` | Consultare il registro, i cruscotti e i risultati della validazione |
| `ext.dora-roi.manage` | Modificare i dati del registro e decidere sui suggerimenti |
| `ext.dora-roi.submit` | Fissare istantanee a una data di riferimento e scaricare i pacchetti di trasmissione |
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
- I contenuti della tassonomia sono generati dal quadro EBA pubblicato: adottare
  una nuova versione equivale quindi a un aggiornamento di dati più un cambio di
  **Taxonomy version**.
- Il **punteggio DORA** di una scheda è un segnale di triage, non un verdetto di
  conformità. Fanno fede i rilievi del cruscotto.
- Non vengono prodotte varianti Excel specifiche per singola autorità; il pacchetto
  xBRL-CSV è l'artefatto di deposito.
