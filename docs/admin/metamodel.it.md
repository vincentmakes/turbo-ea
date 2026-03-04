# Metamodello

Il **Metamodello** definisce l'intera struttura dati della piattaforma — quali tipi di card esistono, quali campi hanno, come si relazionano tra loro e come sono strutturate le pagine di dettaglio delle card. Tutto è **guidato dai dati**: configurate il metamodello attraverso l'interfaccia di amministrazione, non modificando il codice.

![Configurazione del metamodello](../assets/img/en/20_admin_metamodel.png)

Navigate su **Admin > Metamodello** per accedere all'editor del metamodello. Ha sei schede: **Tipi di card**, **Tipi di relazione**, **Calcoli**, **Tag**, **Principi EA** e **Grafo del metamodello**.

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

#### Campi

I campi definiscono gli attributi personalizzati disponibili sulle card di questo tipo. Ogni campo ha:

| Impostazione | Descrizione |
|--------------|-------------|
| **Key** | Identificatore univoco del campo |
| **Etichetta** | Nome visualizzato |
| **Tipo** | text, number, cost, boolean, date, url, single_select o multiple_select |
| **Opzioni** | Per i campi di selezione: le scelte disponibili con etichette e colori opzionali |
| **Obbligatorio** | Se il campo deve essere compilato per il punteggio di qualità dei dati |
| **Peso** | Quanto questo campo contribuisce al punteggio di qualità dei dati (0-10) |
| **Sola lettura** | Impedisce la modifica manuale (utile per i campi calcolati) |

Cliccate su **+ Aggiungi campo** per creare un nuovo campo, o cliccate su un campo esistente per modificarlo nella **Finestra editor campo**.

#### Sezioni

I campi sono organizzati in **sezioni** nella pagina di dettaglio della card. Potete:

- Creare sezioni con nome per raggruppare campi correlati
- Impostare le sezioni su layout a **1 colonna** o **2 colonne**
- Organizzare i campi in **gruppi** all'interno di una sezione (visualizzati come sotto-intestazioni comprimibili)
- Trascinare i campi tra le sezioni e riordinarli

Il nome speciale di sezione `__description` aggiunge campi alla sezione Descrizione della pagina di dettaglio della card.

#### Sottotipi

I sottotipi forniscono una classificazione secondaria all'interno di un tipo. Ad esempio, il tipo Application ha i sottotipi: Business Application, Microservice, AI Agent e Deployment. Ogni sottotipo può avere etichette tradotte.

#### Ruoli stakeholder

Definite ruoli personalizzati per questo tipo (es. "Application Owner", "Technical Owner"). Ogni ruolo porta **permessi a livello di card** che vengono combinati con il ruolo a livello di applicazione dell'utente quando accede a una card. Vedi [Utenti e ruoli](users.md) per maggiori informazioni sul modello dei permessi.

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

### Come i principi influenzano gli insight IA

Quando generate **Insight IA del portafoglio** nel [Report del portafoglio](../guide/reports.md#ai-portfolio-insights), tutti i principi attivi vengono inclusi nell'analisi. L'IA valuta i dati del vostro portafoglio rispetto a ciascun principio e riporta:

- Se il portafoglio è **conforme** o **viola** il principio
- Punti dati specifici come prove
- Azioni correttive raccomandate

Ad esempio, un principio «Acquistare SaaS» farebbe sì che l'IA segnali le applicazioni ospitate on-premise o in IaaS e suggerisca priorità di migrazione cloud.

## Grafo del metamodello

La scheda **Grafo del metamodello** mostra un diagramma SVG visivo di tutti i tipi di card e i loro tipi di relazione. Questa è una visualizzazione di sola lettura che aiuta a comprendere le connessioni nel vostro metamodello a colpo d'occhio.

## Editor layout card

Per ogni tipo di card, la sezione **Layout** nel cassetto del tipo controlla come è strutturata la pagina di dettaglio della card:

- **Ordine delle sezioni** — Trascinate le sezioni (Descrizione, EOL, Ciclo di vita, Gerarchia, Relazioni e sezioni personalizzate) per riordinarle
- **Visibilità** — Nascondete le sezioni che non sono rilevanti per un tipo
- **Espansione predefinita** — Scegliete se ogni sezione inizia espansa o compressa
- **Layout colonne** — Impostate 1 o 2 colonne per sezione personalizzata
