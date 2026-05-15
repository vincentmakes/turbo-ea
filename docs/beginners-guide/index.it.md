# I primi 30 giorni con Turbo EA

Turbo EA è stato installato. La schermata di login funziona, i dati demo vengono caricati, ogni voce di menu mostra qualcosa — e ora ci si ritrova davanti a un inventario vuoto chiedendosi da dove iniziare davvero. Questa guida è pensata proprio per questo.

È una procedura sequenziale e ben definita per la **prima iniziativa concreta di EA** che la maggior parte delle organizzazioni intraprende con Turbo EA: mettere sotto controllo un inventario applicativo e usarlo per rispondere a domande reali sul portfolio. Ignora deliberatamente i moduli più avanzati (Risk Register, Compliance, PPM, TurboLens AI) — questi diventano utili una volta che l'inventario è vivo, non prima.

## A chi è rivolta questa guida

- **Enterprise Architect** che avviano una nuova pratica EA o migrano da fogli di calcolo, Confluence o un altro strumento.
- **Solution Architect e Application Owner** ai quali è stato chiesto di "popolare lo strumento EA" senza molto contesto.
- **Amministratori** che preparano la piattaforma per un rollout più ampio.

È necessario il ruolo **admin** (o almeno `admin.metamodel` e `inventory.edit`) per seguire ogni passaggio. I ruoli in sola lettura possono comunque trarne beneficio — semplicemente non potranno effettuare le modifiche al metamodello descritte a pagina 5.

## Il percorso crawl → walk → run

Non bisogna provare a modellare l'intera azienda nella prima settimana. I team che riescono con gli strumenti EA seguono un percorso a fasi:

1. **Crawl** — Un ambito ristretto (un dominio di business, un paese, una piattaforma). Un tipo di card (Applicazioni). Cinque campi per card. Ottenere dati "sufficientemente buoni" su 50–200 card.
2. **Walk** — Aggiungere le Business Capability dal catalogo incluso. Mappare le applicazioni sulle capability. Eseguire la prima analisi di portfolio. Mostrarla a uno stakeholder.
3. **Run** — Espandere a processi, interfacce, oggetti dati. Aggiungere più campi personalizzati. Aprire i moduli più avanzati.

Questa guida copre la fase **crawl** e l'inizio della fase **walk**. Alla fine si avrà un portfolio applicativo funzionante con una disposizione TIME (**T**olerate / **I**nvest / **M**igrate / **E**liminate) e un Portfolio Report da presentare a un CIO.

## Cosa contiene questa guida

| # | Pagina | Cosa farai |
|---|--------|-----------|
| 1 | [Pianificare il rollout](plan-your-rollout.md) | Definire l'ambito dell'iniziativa, scegliere gli stakeholder, fissare un obiettivo realistico di qualità dei dati |
| 2 | [Iniziare con l'inventario applicativo](start-with-applications.md) | Popolare le Applicazioni tramite import, ServiceNow o inserimento manuale |
| 3 | [Sfruttare i cataloghi di riferimento](leverage-reference-catalogues.md) | Risparmiare mesi di modellazione manuale importando capability e processi |
| 4 | [Personalizzare il metamodello — con leggerezza](customise-the-metamodel.md) | Aggiungere un campo personalizzato (TIME) nel modo corretto |
| 5 | [La prima analisi: Armonizzazione applicativa](your-first-analysis.md) | Mappare le applicazioni alle capability, eseguire il Portfolio Report e la Capability Heatmap |

!!! tip "Buona pratica"
    Leggere tutte e cinque le pagine in ordine prima di aprire Turbo EA. Il piano in mente vale più delle prime 50 card nell'inventario.

## Prerequisiti

- Un'istanza di Turbo EA in esecuzione (vedere [Installazione e configurazione](../getting-started/setup.md)).
- Un account amministratore (il primo utente che si registra diventa automaticamente admin).
- **Opzionale ma consigliato per gli utenti alle prime armi:** avviare lo stack una volta con `SEED_DEMO=true` per vedere come appare un inventario popolato (l'azienda fittizia NexaTech Industries). È poi possibile fare reset con `RESET_DB=true` e ripartire puliti sui dati reali.
- Un'idea approssimativa del **dominio di business** che si vuole modellare per primo. "Tutto l'IT" non è un dominio.

## Cosa salterai — per ora

Questi sono moduli potenti, ma presuppongono un inventario già popolato. Non aprirli subito:

- **Risk Register** e **scansione Compliance** — utili una volta che ci sono applicazioni e capability a cui collegare i rischi.
- **PPM** (Project Portfolio Management) — utile quando esiste una pipeline di progetti che vale la pena tracciare.
- **TurboLens AI** (analisi fornitori, rilevamento duplicati, wizard Architect) — utile quando ci sono abbastanza card perché l'AI possa trovare schemi.

Si troverà un breve riferimento "cosa fare dopo" per ciascuno di essi nell'[ultima pagina](your-first-analysis.md) di questa guida.

Pronti? Si prosegue con [Pianificare il rollout](plan-your-rollout.md).
