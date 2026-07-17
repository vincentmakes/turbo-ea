# Metamodello

Il **Metamodello** definisce l'intera struttura dati della piattaforma — quali tipi di card esistono, quali campi hanno, come si relazionano tra loro e come sono strutturate le pagine di dettaglio delle card. Tutto è **guidato dai dati**: configurate il metamodello attraverso l'interfaccia di amministrazione, non modificando il codice.

![Configurazione del metamodello](../assets/img/it/20_admin_metamodello.png)

Navigate su **Admin > Metamodello** per accedere all'editor del metamodello. Ha sette schede: **Tipi di card**, **Tipi di relazione**, **Calcoli**, **Tag**, **Grafo del metamodello**, **Principi EA** e **Regolamenti di conformità**.

## Tipi di card

La scheda Tipi di card elenca tutti i tipi nel sistema. Turbo EA viene fornito con 14 tipi predefiniti distribuiti su quattro livelli architetturali:

| Livello | Tipi |
|---------|------|
| **Strategy & Transformation** | Objective, Platform, Initiative |
| **Business Architecture** | Organization, Business Capability, Business Context, Business Process |
| **Application & Data** | Application, Interface, Data Object |
| **Technical Architecture** | IT Component, Tech Category, Provider, System |

### Creazione di un tipo personalizzato

Cliccate su **+ Nuovo tipo** per creare un tipo di card personalizzato. Configurate:

| Campo | Descrizione |
|-------|-------------|
| **Key** | Identificatore univoco (minuscolo, senza spazi) — non può essere modificato dopo la creazione |
| **Etichetta** | Nome visualizzato nell'interfaccia |
| **Icona** | Nome dell'icona Google Material Symbol |
| **Colore** | Colore del brand per il tipo (utilizzato nell'inventario, nei report e nei diagrammi) |
| **Categoria** | Raggruppamento per livello architetturale |
| **Ha gerarchia** | Se le card di questo tipo possono avere relazioni genitore/figlio |

### Modifica di un tipo

Cliccate su qualsiasi tipo per aprire il **Cassetto dettaglio tipo**. Qui potete configurare:

#### Colore del tipo

Ogni tipo di scheda — inclusi quelli predefiniti — ha un colore personalizzabile usato nell'inventario, nei report, nelle viste delle dipendenze e nei diagrammi. Questo consente di allineare Turbo EA alle convenzioni visive della propria organizzazione (ad esempio le palette TOGAF/ArchiMate: elementi di business in giallo/arancione, applicazioni in blu).

- Scegliere un colore con il campione di colore nel pannello. Un avviso appare quando il colore scelto ha un contrasto molto basso su sfondi chiari o scuri.
- I tipi predefiniti mostrano un pulsante di **ripristino** accanto al campione di colore quando il colore differisce dal valore predefinito di Turbo EA, così è sempre possibile tornare alla palette standard.
- Il testo mostrato sopra i colori del tipo (chip, forme dei diagrammi) passa automaticamente dal nero al bianco per la leggibilità, sia in modalità chiara sia in modalità scura.
- Il selettore mostra un'**anteprima dal vivo** accanto alla palette: nome del tipo, chip, icona della scheda, sottotipo, pillola dell'ID scheda e un nodo della vista delle dipendenze, resi una volta in modalità chiara e una in modalità scura, aggiornati durante la selezione.

#### Campi

I campi definiscono gli attributi personalizzati disponibili sulle card di questo tipo. Ogni campo ha:

| Impostazione | Descrizione |
|--------------|-------------|
| **Key** | Identificatore univoco del campo |
| **Etichetta** | Nome visualizzato |
| **Tipo** | text, multiline_text, number, cost, boolean, date, url, single_select o multiple_select |
| **Opzioni** | Per i campi di selezione: le scelte disponibili con etichette e colori opzionali |
| **Obbligatorio** | Se il campo deve essere compilato per il punteggio di qualità dei dati |
| **Qualità dei dati** | Il contributo di ciascun campo al punteggio è gestito nel pannello **Qualità dei dati** (vedi sotto) |
| **Sola lettura** | Impedisce la modifica manuale (utile per i campi calcolati) |

Cliccate su **+ Aggiungi campo** per creare un nuovo campo, o cliccate su un campo esistente per modificarlo nella **Finestra editor campo**.

#### Sezioni

I campi sono organizzati in **sezioni** nella pagina di dettaglio della card. Potete:

- Creare sezioni con nome per raggruppare campi correlati
- Impostare le sezioni su layout a **1 colonna** o **2 colonne**
- Organizzare i campi in **gruppi** all'interno di una sezione (visualizzati come sotto-intestazioni comprimibili)
- Riordinare i campi all'interno di una sezione trascinandoli e spostare un campo in un'altra sezione tramite la sua azione **sposta**

Il nome speciale di sezione `__description` aggiunge campi alla sezione Descrizione della pagina di dettaglio della card.

#### ID scheda

Attiva la **generazione ID scheda** per assegnare alle schede di questo tipo un ID stabile e leggibile (ad esempio `APP-00001`). L'ID appare come pillola copiabile accanto al tipo della scheda, come colonna opzionale (ordinabile e filtrabile) nell'inventario, nelle esportazioni Excel e nelle formule dei campi calcolati (tramite `data.reference`).

Il **numero è sempre generato automaticamente**; puoi controllare solo il **prefisso**. All'attivazione viene mostrato come testo un prefisso suggerito (derivato dal nome del tipo, es. `APP-`) — clicca la matita per modificarlo. Due impostazioni regolano il numero:

- **Inizia da** — il primo numero della serie (predefinito `1`).
- **Cifre min.** — larghezza del riempimento con zeri (predefinito `5`), così `1` diventa `00001`. È un minimo; i numeri si allungano una volta superato. Un **Esempio** mostra in tempo reale il primo ID.

Gli ID sono **univoci a livello globale, di sola lettura e non vengono mai riutilizzati o modificati**. La sequenza numerica è tracciata **per prefisso in tutto il workspace**, quindi due tipi che condividono un prefisso formano un'unica serie continua e senza collisioni. Una volta che una scheda di questo tipo ha un ID, l'intero formato — prefisso, inizio e cifre min. — è bloccato (i campi diventano di sola lettura); puoi comunque disattivare la generazione. Il salvataggio non assegna mai ID alle schede esistenti; usa il pulsante dedicato **Genera ID** per colmare l'arretrato su richiesta (con barra di avanzamento e conferma).

#### Punteggio di qualità dei dati

Il punteggio di **qualità dei dati** di una card misura in modo ponderato quanto è completa. Ogni fattore che contribuisce — ogni campo e cinque fattori integrati — è gestito in un unico posto: la scheda **Qualità dei dati** dell'editor del tipo di card. (L'editor è organizzato in schede – Generale, Relazioni, Ruoli degli stakeholder e Qualità dei dati – le traduzioni sono disponibili dall'icona nell'intestazione.)

L'importanza di ciascun fattore si imposta con un semplice cursore a quattro livelli, che mostra anche il numero sottostante:

- **Ignora (0)** — escluso completamente dal punteggio.
- **Normale (1)** — conta una volta (predefinito).
- **Importante (2)** — conta il doppio.
- **Critico (3)** — conta il triplo.

Il pannello elenca i cinque **fattori integrati** — **Descrizione**, **Ciclo di vita** (se è impostata almeno una data del ciclo di vita), **Relazioni obbligatorie**, **Tag obbligatori** e **Ruoli degli stakeholder** (ogni ruolo definito per il tipo è soddisfatto quando vi viene assegnato uno stakeholder) — seguiti da ogni campo raggruppato per sezione, ciascuno con lo stesso cursore. Ad esempio, imposta il **Ciclo di vita** su *Ignora* per un tipo le cui card legittimamente non riportano mai date, così da non penalizzarle.

Una barra di **composizione del punteggio** in cima al pannello mostra la quota di ciascun fattore sul punteggio massimo possibile, per vedere a colpo d'occhio quali fattori dominano. Nel layout della card della scheda **Generale**, ogni campo — e le sezioni integrate Descrizione, Ciclo di vita e Relazioni — mostra un piccolo badge con il livello attuale, per vedere la ponderazione senza lasciare quella scheda.

La modifica di qualsiasi importanza ricalcola immediatamente il punteggio di ogni card esistente di quel tipo. I nuovi campi sono *Normale* per impostazione predefinita e quindi contano per il punteggio non appena li aggiungi.

#### Sottotipi (Sotto-modelli)

I sottotipi agiscono come **sotto-modelli** all'interno di un tipo di card. Ogni sottotipo può controllare quali campi sono visibili per le card di quel sottotipo, mentre tutti i campi restano definiti a livello del tipo di card.

Ad esempio, il tipo Application ha i sottotipi: Business Application, Microservice, AI Agent e Deployment. Un amministratore potrebbe nascondere i campi relativi ai server per il sottotipo SaaS, poiché non sono pertinenti.

**Configurare la visibilità dei campi per sottotipo:**

1. Aprite un tipo di card nell'amministrazione del metamodello.
2. Cliccate su qualsiasi chip di sottotipo per aprire il dialogo **Modello di sottotipo**.
3. Attivate o disattivate la visibilità dei campi utilizzando gli interruttori — i campi disattivati saranno nascosti per le card di quel sottotipo.
4. I campi nascosti sono esclusi dal punteggio di qualità dei dati, in modo che gli utenti non vengano penalizzati per campi che non possono vedere.

Quando nessun sottotipo è selezionato su una card (o il tipo non ha sottotipi), tutti i campi sono visibili. I campi nascosti conservano i propri dati — se il sottotipo di una card cambia, i valori precedentemente nascosti vengono mantenuti.

#### Ruoli stakeholder

Definite ruoli personalizzati per questo tipo (es. "Application Owner", "Technical Owner"). Ogni ruolo porta **permessi a livello di card** che vengono combinati con il ruolo a livello di applicazione dell'utente quando accede a una card. Vedi [Utenti e ruoli](users.md) per maggiori informazioni sul modello dei permessi.

#### Traduzioni

Cliccate sul pulsante **Traduci** nella barra degli strumenti del drawer del tipo per aprire il **Dialogo delle traduzioni**. Qui potete fornire traduzioni per tutte le etichette del metamodello in ogni lingua supportata:

- **Etichetta del tipo** — Il nome visualizzato del tipo di card
- **Sottotipi** — Etichette per ogni sottotipo
- **Sezioni** — Intestazioni delle sezioni nella pagina di dettaglio della card
- **Campi** — Etichette dei campi e delle opzioni di selezione
- **Ruoli degli stakeholder** — Nomi dei ruoli visualizzati nell'interfaccia di assegnazione degli stakeholder

Le traduzioni sono memorizzate insieme a ciascun tipo di card e vengono risolte al momento del rendering in base alla lingua selezionata dall'utente. Le etichette non tradotte utilizzano il valore predefinito in inglese.

### Eliminazione di un tipo

- I **tipi predefiniti** vengono eliminati temporaneamente (nascosti) e possono essere ripristinati
- I **tipi personalizzati** vengono eliminati definitivamente

## Tipi di relazione

I tipi di relazione definiscono le connessioni consentite tra i tipi di card. Ogni tipo di relazione specifica:

| Campo | Descrizione |
|-------|-------------|
| **Key** | Identificatore univoco |
| **Etichetta** | Etichetta della direzione in avanti (es. "utilizza") |
| **Etichetta inversa** | Etichetta della direzione inversa (es. "è utilizzato da") |
| **Tipo sorgente** | Il tipo di card sul lato "da" |
| **Tipo destinazione** | Il tipo di card sul lato "a" |
| **Cardinalità** | n:m (molti-a-molti) o 1:n (uno-a-molti) |

Cliccate su **+ Nuovo tipo di relazione** per creare una relazione, o cliccate su una esistente per modificare le etichette e gli attributi.

### Attributi della relazione

Alcune relazioni includono attributi aggiuntivi che si impostano su ogni singolo collegamento anziché sul tipo di relazione. Ad esempio, la relazione integrata **Organizzazione → Applicazione** («utilizza») ha un attributo **Tipo di utilizzo**: impostatelo su **Proprietario**, **Utente** o **Stakeholder** per ogni collegamento. In questo modo potete modellare un'applicazione *di proprietà di* un'organizzazione e *utilizzata da* altre tramite un unico tipo di relazione. Il valore scelto appare come un chip colorato nella sezione **Relazioni** della card; impostatelo quando aggiungete la relazione, oppure in seguito tramite l'icona di modifica sulla riga della relazione.

Tra una determinata coppia di tipi di card può esistere un solo tipo di relazione, quindi utilizzate questi attributi per qualificare il significato di un collegamento anziché creare un secondo tipo di relazione per la stessa origine e destinazione.

### Gestire i valori di relazione

Cliccate sull'icona **Gestisci valori di relazione** (etichetta) su una riga di relazione per modificare i valori dei suoi attributi di «tipo». Potete:

- **Aggiungere i vostri valori** a un selettore esistente — ad esempio un nuovo Tipo di utilizzo oltre a Proprietario / Utente / Stakeholder.
- **Aggiungere un selettore di tipo completamente nuovo** a una relazione che non ne ha, tramite **Aggiungi tipo** — anche sulle relazioni integrate.

I valori integrati (Proprietario, Utente, Stakeholder, i valori della direzione del flusso…) sono **bloccati**: non possono essere rinominati, ricolorati o eliminati. Potete però **nascondere** un valore integrato in modo che non compaia più nel selettore sulle card — un valore già impostato resta visibile. I vostri valori sono completamente modificabili ed eliminabili.

## Calcoli

I campi calcolati utilizzano formule definite dall'amministratore per calcolare automaticamente i valori quando le card vengono salvate. Vedi [Calcoli](calculations.md) per la guida completa.

## Tag

I gruppi di tag e i tag possono essere gestiti da questa scheda. Vedi [Tag](tags.md) per la guida completa.

## Principi EA

La scheda **Principi EA** consente di definire i principi architetturali che governano il panorama IT della vostra organizzazione. Questi principi fungono da guardrail strategici — ad esempio, «Riutilizzare prima di acquistare prima di costruire» o «Se acquistiamo, acquistiamo SaaS».

Ogni principio ha quattro campi:

| Campo | Descrizione |
|-------|-------------|
| **Titolo** | Un nome conciso per il principio |
| **Enunciato** | Cosa stabilisce il principio |
| **Motivazione** | Perché questo principio è importante |
| **Implicazioni** | Conseguenze pratiche del rispetto del principio |

I principi possono essere **attivati** o **disattivati** individualmente tramite l'interruttore su ciascuna scheda.

### Importare dal Catalogo dei principi

Turbo EA include un **catalogo di riferimento curato con 10 principi EA standard del settore** in modo da non dover partire da una pagina vuota. Apri il menu dell'avatar in alto a destra e seleziona **Cataloghi di riferimento → Catalogo dei principi**. Da qui puoi:

- Cercare e sfogliare i principi inclusi (titolo, descrizione, motivazione, implicazioni).
- Selezionare più voci e fare clic su **Importa** — i principi selezionati appaiono nella scheda «Principi EA» come voci standard completamente modificabili.
- Reimportare in sicurezza: i principi già esistenti (riconosciuti tramite il loro ID catalogo stabile) vengono saltati, anche se li hai rinominati localmente. Il catalogo mostra un badge verde «Già importato» per queste voci.

Usa il catalogo come punto di partenza e poi adatta titolo, enunciato, motivazione e implicazioni di ciascun principio alla tua organizzazione.

### Come i principi influenzano gli insight IA

Quando generate **Insight IA del portafoglio** nel [Report del portafoglio](../guide/reports.md#ai-portfolio-insights), tutti i principi attivi vengono inclusi nell'analisi. L'IA valuta i dati del vostro portafoglio rispetto a ciascun principio e riporta:

- Se il portafoglio è **conforme** o **viola** il principio
- Punti dati specifici come prove
- Azioni correttive raccomandate

Ad esempio, un principio «Acquistare SaaS» farebbe sì che l'IA segnali le applicazioni ospitate on-premise o in IaaS e suggerisca priorità di migrazione cloud.

## Grafo del metamodello

![Grafo del metamodello](../assets/img/it/38_grafo_metamodello.png)

La scheda **Grafo del metamodello** mostra un diagramma SVG visivo di tutti i tipi di card e i loro tipi di relazione. Questa è una visualizzazione di sola lettura che aiuta a comprendere le connessioni nel vostro metamodello a colpo d'occhio.

## Regolamenti di conformità

La scheda **Regolamenti di conformità** gestisce i framework normativi su cui esegue lo [scanner Conformità di GRC](../guide/grc.md#compliance). Sei framework sono abilitati per default:

| Regolamento | Ambito |
|-------------|--------|
| **AI Act dell'UE** | Requisiti per sistemi di IA / ML immessi sul mercato dell'UE |
| **GDPR** | Regolamento Generale sulla Protezione dei Dati dell'UE |
| **NIS2** | Direttiva 2 dell'UE sulla sicurezza delle reti e dei sistemi informativi |
| **DORA** | Regolamento europeo sulla resilienza operativa digitale per le entità finanziarie |
| **SOC 2** | Criteri AICPA Service Organization Controls Trust Services |
| **ISO/IEC 27001** | Standard per i sistemi di gestione della sicurezza delle informazioni |

Per ciascuna riga potete:

- **Abilitare / disabilitare** il regolamento tramite l'interruttore — i framework disabilitati vengono saltati in ogni scansione successiva e i loro riscontri esclusi dalle dashboard. I riscontri esistenti vengono conservati (non eliminati) nel caso lo riabilitiate in seguito.
- **Modificare** il titolo, la descrizione dell'ambito e il contesto di prompt fornito al LLM.
- **Aggiungere un regolamento personalizzato** con **+ Nuovo regolamento** — ad esempio HIPAA, policy interne o framework di settore. I regolamenti personalizzati sono a pieno titolo: compaiono nella scheda dedicata, contribuiscono al punteggio globale di conformità e supportano le stesse azioni sui riscontri (riconoscere, accettare, promuovere a Rischio).
- **Eliminare** un regolamento personalizzato — i regolamenti integrati non possono essere eliminati, solo disabilitati.

Lo scanner di conformità e il flusso di promozione a Rischio funzionano **anche senza un provider AI configurato** — l'inserimento manuale dei riscontri, le transizioni di stato e il percorso di promozione a Rischio restano disponibili. L'AI è richiesta solo quando avviate effettivamente una nuova scansione.

## Editor layout card

Per ogni tipo di card, la sezione **Layout** nel cassetto del tipo controlla come è strutturata la pagina di dettaglio della card:

- **Ordine delle sezioni** — Trascinate le sezioni (Descrizione, EOL, Ciclo di vita, Gerarchia, Relazioni e sezioni personalizzate) per riordinarle
- **Visibilità** — Nascondete le sezioni che non sono rilevanti per un tipo
- **Espansione predefinita** — Scegliete se ogni sezione inizia espansa o compressa
- **Layout colonne** — Impostate 1 o 2 colonne per sezione personalizzata
- **Spostare campi tra le sezioni** — Usare l'azione **sposta** di un campo (accanto ai pulsanti di modifica ed elimina) per ricollocarlo in un'altra sezione, mantenendone la configurazione

## Risorse

La scheda **Risorse** gestisce i due elenchi proposti nella scheda **Risorse** di ogni carta:

- **Tipi di link** — la categoria di un link a un documento (es. *Documentazione*, *Contratto*, *Sicurezza*). Ogni tipo di link porta anche un'**icona** mostrata accanto al link.
- **Categorie di file** — la categoria assegnata a un allegato caricato.

Per ogni elenco puoi:

- **Aggiungere una voce** — con una chiave (un identificatore minuscolo memorizzato sulle carte, fisso dopo la creazione), un'etichetta visualizzata e — per i tipi di link — un'icona.
- **Modificare** etichetta, icona, ordinamento e traduzioni per lingua di qualsiasi voce, incluse quelle integrate.
- **Attivare / disattivare** una voce con l'interruttore — le voci disattivate scompaiono dal selettore, ma i valori esistenti sulle carte vengono mantenuti.
- **Eliminare** una voce personalizzata — le voci integrate non possono essere eliminate, solo disattivate.

Un tipo di link **Contratto** integrato è attivo per impostazione predefinita. Entrambi gli elenchi sono inclusi nel **Trasferimento dell'area di lavoro** e si clonano così tra le istanze.
