# Pianificare il rollout

Prima di creare anche una sola card, dedicare un'ora a rispondere a quattro domande. I team che saltano questo passaggio finiscono con un inventario di cui nessuno si fida, perché nessuno ha concordato a cosa serve.

## 1. Definire un ambito ristretto

Il singolo errore più grande nei rollout EA è cercare di modellare l'intera azienda in una volta. Scegliere **uno** dei seguenti:

- Un **dominio di business** (es. Vendite, Finanza, Customer Service, Manifattura).
- Un'**entità legale** o **regione** (una controllata, un paese, una business unit acquisita di recente).
- Una **piattaforma** (es. lo stack e-commerce, la piattaforma dati, il parco ERP).

Un buon primo ambito contiene grosso modo **50–200 applicazioni**. Meno di così e non c'è nulla da analizzare; più di così e si esauriranno le energie prima di arrivare all'analisi.

!!! warning "Da evitare"
    Non scegliere "tutta l'azienda" o "tutto l'IT". Si passeranno tre mesi a inseguire dati senza mai arrivare a un report funzionante.

## 2. Scegliere il primo caso d'uso giusto

Il caso d'uso determina quali campi contano, quali stakeholder servono e quale report si mostrerà alla fine. Il più comune — e quello che questa guida presuppone dalla pagina 3 in poi — è:

> **Razionalizzazione del portfolio applicativo**
>
> Inventariare le applicazioni in ambito, classificare ciascuna per valore di business e idoneità tecnica, e decidere cosa **T**olerare, su cosa **I**nvestire, cosa **M**igrare o **E**liminare (il framework TIME).

Altri primi casi d'uso validi — ma sceglierne **uno**:

| Caso d'uso | Cosa popolerai principalmente | Cosa salterai |
|------------|------------------------------|---------------|
| **Razionalizzazione del portfolio applicativo** | Applicazioni, costi, ciclo di vita, valore di business | Modello di processo dettagliato, interfacce |
| **Pianificazione basata sulle capability** | Business Capability, Applicazioni, heatmap delle capability | Dettaglio dei costi, stack tecnologico |
| **Valutazione di cloud migration** | Applicazioni, IT Component, modello di deployment | Valore di business, processi |
| **Integrazione post M&A** | Entrambi i portfolio come Applicazioni, analisi sovrapposizioni | Date di ciclo di vita a lungo termine |

In caso di dubbio, **scegliere Razionalizzazione del portfolio applicativo**. È il punto di partenza più universalmente utile e il resto di questa guida è scritto attorno ad esso.

## 3. Identificare gli stakeholder

Turbo EA ha un modello **Stakeholder** integrato (vedere [Dettagli card](../guide/card-details.md)): ogni card porta con sé un elenco di persone in ruoli definiti (Business Owner, Technical Owner, ecc.), definiti per tipo di card nel metamodello. Decidere in anticipo chi ricopre ciascun ruolo per un'Applicazione:

- **Application Owner** — responsabile dell'applicazione nel business. Una persona per app. Approva la disposizione TIME.
- **Technical Owner** — responsabile del suo funzionamento. Spesso l'engineering manager.
- **Architect** — probabilmente sei tu. Agisce come revisore lato EA e approva le card.

Non è necessario assegnare gli stakeholder il primo giorno per ogni card, ma occorre sapere chi *saranno* — perché nella terza settimana si invieranno loro dei sondaggi per validare i dati.

!!! tip "Buona pratica"
    Un nome reale nel ruolo di Application Owner vale più di dieci campi personalizzati perfettamente compilati. Se si popola un solo campo oltre al nome e al ciclo di vita, deve essere l'Application Owner.

## 4. Fissare un obiettivo realistico di qualità dei dati

Turbo EA calcola un punteggio di **Data Quality** (0–100%) per ogni card, basato sui campi pesati definiti nel metamodello. È il singolo migliore indicatore anticipatore della fruibilità dell'inventario.

Obiettivi realistici per i primi 90 giorni:

| Fase | Qualità dei dati media obiettivo (Applicazioni) | Cosa è compilato |
|------|------------------------------------------------|-----------------|
| Fine settimana 2 (Crawl) | **40–60%** | Nome, Fase del ciclo di vita, Descrizione, Business Owner |
| Fine settimana 6 (Walk) | **60–75%** | + Mappatura capability, Costo, Disposizione TIME |
| Fine mese 3 (Run) | **75–90%** | + Stack tecnologico, interfacce, campi di dominio personalizzati |

Non puntare al 100%. L'ultimo 10% costa più del primo 60% e raramente cambia una decisione.

## 5. Impegnarsi su un singolo deliverable

Concludere la sessione di pianificazione con una dichiarazione scritta del tipo:

> *"Entro la fine della settimana 6, l'inventario del dominio Vendite conterrà ogni applicazione con costo annuo > 50k€, ciascuna mappata su almeno una Business Capability e con una disposizione TIME assegnata. Presenteremo il Portfolio Report al CIO Vendite nella settimana 7."*

Pubblicarla su un wiki, in una slide di kickoff, nella descrizione di un canale Slack — ovunque sia visibile. Quella frase è ciò che impedisce al rollout di scivolare nel purgatorio del "stiamo ancora raccogliendo dati".

Successivo: [Iniziare con l'inventario applicativo](start-with-applications.md).
