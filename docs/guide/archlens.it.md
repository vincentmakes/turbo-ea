# ArchLens Intelligenza Artificiale

Il modulo **ArchLens** fornisce analisi basate sull'IA del vostro panorama di architettura aziendale. Utilizza il vostro provider di IA configurato per eseguire analisi dei fornitori, rilevamento dei duplicati, valutazione della modernizzazione e raccomandazioni architetturali.

!!! note
    ArchLens richiede un provider di IA commerciale (Anthropic Claude, OpenAI, DeepSeek o Google Gemini) configurato nelle [Impostazioni IA](../admin/ai.md). Il modulo è automaticamente disponibile quando l'IA è configurata.

!!! info "Credits"
    ArchLens si basa sul progetto open source [ArchLens](https://github.com/vinod-ea/archlens) di [Vinod](https://github.com/vinod-ea), rilasciato sotto la licenza MIT. La logica di analisi è stata portata da Node.js a Python e integrata nativamente in Turbo EA.

## Dashboard

La dashboard di ArchLens fornisce una panoramica dell'analisi del vostro panorama:

| Indicatore | Descrizione |
|-----------|-------------|
| **Totale schede** | Numero di schede attive nel vostro portafoglio |
| **Qualità media** | Punteggio medio di qualità dei dati su tutte le schede |
| **Fornitori** | Numero di fornitori di tecnologia analizzati |
| **Cluster di duplicati** | Numero di gruppi di duplicati identificati |
| **Modernizzazioni** | Numero di opportunità di modernizzazione trovate |

La dashboard mostra anche le schede raggruppate per tipo ed evidenzia i principali problemi di qualità.

## Analisi dei fornitori

L'analisi dei fornitori utilizza l'IA per categorizzare i vostri fornitori di tecnologia in oltre 45 categorie industriali (ad esempio, CRM, ERP, infrastruttura cloud, sicurezza).

**Come usarlo:**

1. Navigate a **ArchLens > Fornitori**
2. Cliccate su **Esegui analisi**
3. L'IA elabora il vostro portafoglio fornitori in lotti, categorizzando ogni fornitore con motivazione
4. I risultati mostrano una suddivisione per categoria e una tabella dettagliata dei fornitori

Ogni voce del fornitore include la categoria, sottocategoria, numero di applicazioni associate, costo annuale totale e la motivazione dell'IA per la categorizzazione.

## Risoluzione dei fornitori

La risoluzione dei fornitori costruisce una gerarchia canonica dei fornitori risolvendo gli alias e identificando le relazioni genitore-figlio.

**Come usarlo:**

1. Navigate a **ArchLens > Risoluzione**
2. Cliccate su **Risolvi fornitori**
3. L'IA identifica gli alias dei fornitori (ad esempio, «MSFT» = «Microsoft»), le società madri e i raggruppamenti di prodotti
4. I risultati mostrano la gerarchia risolta con punteggi di confidenza

## Rilevamento dei duplicati

Il rilevamento dei duplicati identifica sovrapposizioni funzionali nel vostro portafoglio — schede che servono lo stesso o un simile scopo aziendale.

**Come usarlo:**

1. Navigate a **ArchLens > Duplicati**
2. Cliccate su **Rileva duplicati**
3. L'IA analizza le schede Application, IT Component e Interface in lotti
4. I risultati mostrano cluster di potenziali duplicati con evidenze e raccomandazioni

Per ogni cluster, potete:

- **Confermare** — Contrassegnare il duplicato come confermato per il follow-up
- **Investigare** — Segnalare per ulteriori indagini
- **Scartare** — Scartare se non è un duplicato reale

## Valutazione della modernizzazione

La valutazione della modernizzazione valuta le schede per opportunità di aggiornamento basate sulle attuali tendenze tecnologiche.

**Come usarlo:**

1. Navigate a **ArchLens > Duplicati** (sezione Modernizzazione)
2. Selezionate un tipo di scheda obiettivo (Application, IT Component o Interface)
3. Cliccate su **Valuta modernizzazione**
4. I risultati mostrano ogni scheda con tipo di modernizzazione, raccomandazione, livello di impegno e priorità

## Architecture AI

L'Architecture AI è un assistente conversazionale a 3 fasi che genera raccomandazioni architetturali basate sul vostro panorama esistente.

**Come usarlo:**

1. Navigate a **ArchLens > Architetto**
2. **Fase 1** — Descrivete il vostro requisito aziendale (ad esempio, «Abbiamo bisogno di un portale self-service per i clienti»). L'IA genera domande di chiarimento aziendale.
3. **Fase 2** — Rispondete alle domande della Fase 1. L'IA genera domande di approfondimento tecnico.
4. **Fase 3** — Rispondete alle domande della Fase 2. L'IA genera una raccomandazione architetturale completa che include:

| Sezione | Descrizione |
|---------|-------------|
| **Diagramma di architettura** | Diagramma Mermaid interattivo con zoom, download SVG e copia del codice |
| **Livelli dei componenti** | Organizzati per livello di architettura con classificazione esistente/nuovo/raccomandato |
| **Lacune e raccomandazioni** | Lacune di capacità con raccomandazioni di prodotti di mercato classificate per idoneità |
| **Integrazioni** | Mappa di integrazione che mostra flussi di dati, protocolli e direzioni |
| **Rischi e prossimi passi** | Valutazione dei rischi con mitigazioni e passi di implementazione prioritizzati |

## Cronologia delle analisi

Tutte le esecuzioni di analisi sono tracciate in **ArchLens > Cronologia**, mostrando:

- Tipo di analisi (analisi dei fornitori, risoluzione dei fornitori, rilevamento dei duplicati, modernizzazione, architetto)
- Stato (in esecuzione, completato, fallito)
- Timestamp di inizio e completamento
- Messaggi di errore (se presenti)

## Permessi

| Permesso | Descrizione |
|----------|-------------|
| `archlens.view` | Visualizzare i risultati delle analisi (concesso a admin, bpm_admin, member) |
| `archlens.manage` | Eseguire le analisi (concesso a admin) |
