# Sfruttare i cataloghi di riferimento

L'errore classico in questa fase: passare tre settimane a fare workshop per un modello di business capability su misura, altre due settimane ad allinearlo con gli executive, per poi scoprire che il modello è identico all'80% a quello che ogni altra azienda del settore utilizza.

**Non modellare da zero.** Turbo EA include tre cataloghi curati che forniscono un punto di partenza collaudato, adattabile in giorni anziché in mesi:

- **Catalogo Business Capability** — gerarchie di capability multilivello per settore (banking, retail, manifattura, assicurazioni, settore pubblico, ecc.) più capability macro cross-settoriali.
- **Catalogo dei processi** — processi di business di riferimento per settore, pronti da importare come card `BusinessProcess`.
- **Catalogo dei value stream** — value stream end-to-end che fanno da cornice alla mappa delle capability.

Questa pagina si concentra sul Catalogo Business Capability, perché è quello che alimenta la Capability Heatmap nell'ultima pagina. Gli altri due funzionano allo stesso modo.

## Perché iniziare dalle capability

Una **Business Capability** è *ciò che il business fa*, espresso in un linguaggio stabile e indipendente dalla tecnologia — "Order Management", "Customer Onboarding", "Claims Handling". Le capability cambiano a malapena negli anni; le applicazioni cambiano di continuo. È per questo che la mappatura applicazione-capability è la singola relazione più utile in tutto il metamodello:

- Permette di chiedere **"quante applicazioni supportano il Customer Onboarding?"** — e individuare ridondanze.
- Permette di chiedere **"quali capability dipendono da una singola applicazione obsoleta?"** — e individuare fragilità.
- Sopravvive a riorganizzazioni, sostituzioni di fornitori e migrazioni cloud.

Non servono 500 capability per ottenere valore. Servono **20–60 capability, profonde due o tre livelli**, nel proprio ambito.

## Importare una mappa di capability iniziale

1. Navigare a **Capability Catalogue** nel menu principale (sotto User Guide).
2. Usare i filtri in alto:
    - **Settore** — scegliere il proprio (o "Cross-industry" se nulla è adatto).
    - **Livello** — iniziare con L1 e L2 visibili. Si può sempre approfondire più tardi.
3. Esplorare l'albero. Espandere alcuni rami per farsi un'idea della profondità.
4. Spuntare le capability da importare. **La selezione si propaga**: spuntare una L1 spunta i suoi discendenti; spuntare una L2 spunta anche la sua L1 antenata in modo che la gerarchia rimanga connessa.
5. Cliccare **Crea card dalla selezione**.

Turbo EA crea una card `BusinessCapability` per ogni nodo spuntato, preserva la gerarchia padre-figlio e marca ogni card con un `catalogueId` stabile in modo che gli import successivi siano **idempotenti** — eseguire l'import due volte non crea duplicati.

Riferimento completo: [Capability Catalogue](../guide/capability-catalogue.md).

!!! tip "Buona pratica"
    Scegliere un sottoalbero, non l'intero catalogo. Per una Razionalizzazione del portfolio applicativo nel dominio Vendite, importare la capability L1 "Sales & Customer Management" più i suoi figli L2 è di solito sufficiente — sono 10–15 capability, non 300.

## Quanto andare in profondità

La profondità giusta dipende da cosa se ne farà:

| Profondità | Quando usarla | Numero tipico di card |
|-----------|--------------|----------------------|
| **Solo L1** | Riassunti executive, ambiti molto piccoli | 8–12 |
| **L1 + L2** | Lo sweet spot per un primo rollout — leggibile in una schermata, utile nei report | 30–60 |
| **L1 + L2 + L3** | Pianificazione di capability dettagliata, grandi aziende | 100–250 |
| **L4 e oltre** | Approfondimenti specifici, non per una baseline iniziale | varia |

Optare per **L1 + L2** per il primo passaggio. Si potranno sempre importare livelli aggiuntivi più tardi tramite lo stesso catalogo — il re-import idempotente li sistemerà sotto i padri esistenti.

## Una nota su processi e value stream

Il **Catalogo dei processi** e il **Catalogo dei value stream** funzionano allo stesso modo: filtrare, spuntare, creare in massa. Se il primo caso d'uso è la Razionalizzazione del portfolio applicativo, si possono saltare per ora — la mappatura delle capability è sufficiente per guidare l'analisi nell'ultima pagina.

Diventeranno utili quando:

- Si passa da "razionalizzare le applicazioni" a "ottimizzare il value stream order-to-cash".
- Si iniziano a costruire flussi di processo BPMN sulle card `BusinessProcess` risultanti (vedere [BPM](../guide/bpm.md)).

## E se il mio settore non è nel catalogo?

Due opzioni:

1. **Scegliere il settore più simile** e potare. Le voci "Cross-industry" (Finanza, HR, IT, Procurement) si applicano praticamente a ogni azienda.
2. **Combinare cataloghi** — importare prima "Cross-industry", poi integrare con alcuni elementi da un catalogo settoriale specifico.

In ogni caso, **prima importare, poi personalizzare**. Rinominare una capability importata o aggiungere un figlio è molto più veloce che digitare l'intera struttura da zero. E si mantiene il `catalogueId` in modo che i futuri aggiornamenti del catalogo si integrino senza problemi.

!!! warning "Da evitare"
    Non creare tipi di card personalizzati per capability o processi solo per "renderli propri". I tipi integrati arrivano con i campi giusti, i tipi di relazione giusti e i report giusti — equivalenti personalizzati non li avranno.

## Verificare prima di proseguire

Questa pagina è completata quando:

- La mappa delle capability per il proprio ambito esiste nell'inventario (filtrare per Type = `Business Capability`).
- La gerarchia è intatta — aprire alcune capability L2 e controllare che il breadcrumb del padre mostri la L1 giusta.
- Il numero di capability è compreso tra 20 e 60.

Non è ancora stata mappata alcuna applicazione sulle capability — quello è nell'ultima pagina. Prima, aggiungiamo un campo personalizzato alle Applicazioni per rendere l'analisi davvero utile.

Successivo: [Personalizzare il metamodello — con leggerezza](customise-the-metamodel.md).
