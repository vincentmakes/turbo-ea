# Suggerimenti di descrizione AI

![Impostazioni suggerimenti AI](../assets/img/en/26_admin_settings_ai.png)

Turbo EA può generare automaticamente le descrizioni delle card utilizzando una combinazione di **ricerca web** e un **Large Language Model (LLM)**. Quando un utente clicca il pulsante di suggerimento AI su una card, il sistema cerca sul web informazioni rilevanti sul componente, poi utilizza un LLM per produrre una descrizione concisa e contestualizzata per tipo — completa di punteggio di affidabilità e link alle fonti cliccabili.

Questa funzionalità è **opzionale** e **completamente controllata dall'amministratore**. Può funzionare interamente sulla vostra infrastruttura utilizzando un'istanza Ollama locale, oppure collegarsi a provider LLM commerciali.

---

## Come funziona

La pipeline di suggerimento AI ha due passaggi:

1. **Ricerca web** — Turbo EA interroga un provider di ricerca (DuckDuckGo, Google Custom Search o SearXNG) utilizzando il nome e il tipo della card come contesto. Ad esempio, una card Application denominata "SAP S/4HANA" genera una ricerca per "SAP S/4HANA software application".

2. **Estrazione LLM** — I risultati della ricerca vengono inviati al LLM configurato insieme a un prompt di sistema contestualizzato per tipo. Il modello produce una descrizione, un punteggio di affidabilità (0-100%) e elenca le fonti utilizzate.

Il risultato viene mostrato all'utente con:

- Una **descrizione modificabile** che possono rivedere e modificare prima di applicare
- Un **badge di affidabilità** che mostra quanto è affidabile il suggerimento
- **Link alle fonti** per consentire all'utente di verificare le informazioni

---

## Provider LLM supportati

| Provider | Tipo | Configurazione |
|----------|------|----------------|
| **Ollama** | Self-hosted | URL del provider (es. `http://ollama:11434`) + nome del modello |
| **OpenAI** | Commerciale | Chiave API + nome del modello (es. `gpt-4o`) |
| **Google Gemini** | Commerciale | Chiave API + nome del modello |
| **Azure OpenAI** | Commerciale | Chiave API + URL del deployment |
| **OpenRouter** | Commerciale | Chiave API + nome del modello |
| **Anthropic Claude** | Commerciale | Chiave API + nome del modello |

I provider commerciali richiedono una chiave API, che viene memorizzata crittografata nel database utilizzando la crittografia simmetrica Fernet.

---

## Provider di ricerca

| Provider | Configurazione | Note |
|----------|----------------|------|
| **DuckDuckGo** | Nessuna configurazione necessaria | Predefinito. Scraping HTML senza dipendenze. Nessuna chiave API richiesta. |
| **Google Custom Search** | Richiede chiave API e ID motore di ricerca personalizzato | Inserite come `API_KEY:CX` nel campo URL di ricerca. Risultati di qualità superiore. |
| **SearXNG** | Richiede un URL di un'istanza SearXNG self-hosted | Motore di meta-ricerca orientato alla privacy. API JSON. |

---

## Configurazione

### Opzione A: Ollama integrato (Docker Compose)

Il modo più semplice per iniziare. Turbo EA include un container Ollama opzionale nella sua configurazione Docker Compose.

**1. Avviate con il profilo AI:**

```bash
docker compose --profile ai up --build -d
```

**2. Abilitate l'auto-configurazione** aggiungendo queste variabili al vostro `.env`:

```dotenv
AI_AUTO_CONFIGURE=true
AI_MODEL=gemma3:4b          # oppure mistral, llama3:8b, ecc.
```

All'avvio, il backend:

- Rileva il container Ollama
- Salva le impostazioni di connessione nel database
- Scarica il modello configurato se non è già presente (eseguito in background, potrebbe richiedere alcuni minuti)

**3. Verificate** nell'interfaccia admin: andate su **Impostazioni > Suggerimenti AI** e confermate che lo stato mostra come connesso.

### Opzione B: Istanza Ollama esterna

Se gestite già Ollama su un server separato:

1. Andate su **Impostazioni > Suggerimenti AI** nell'interfaccia admin.
2. Selezionate **Ollama** come tipo di provider.
3. Inserite l'**URL del provider** (es. `http://your-server:11434`).
4. Cliccate su **Test connessione** — il sistema mostrerà i modelli disponibili.
5. Selezionate un **modello** dal menu a tendina.
6. Cliccate su **Salva**.

### Opzione C: Provider LLM commerciale

1. Andate su **Impostazioni > Suggerimenti AI** nell'interfaccia admin.
2. Selezionate il vostro provider (OpenAI, Google Gemini, Azure OpenAI, OpenRouter o Anthropic Claude).
3. Inserite la vostra **chiave API** — verrà crittografata prima della memorizzazione.
4. Inserite il **nome del modello** (es. `gpt-4o`, `gemini-pro`, `claude-sonnet-4-20250514`).
5. Cliccate su **Test connessione** per verificare.
6. Cliccate su **Salva**.

---

## Opzioni di configurazione

Una volta connessi, potete perfezionare la funzionalità in **Impostazioni > Suggerimenti AI**:

### Abilita/Disabilita per tipo di card

Non tutti i tipi di card beneficiano allo stesso modo dei suggerimenti AI. Potete abilitare o disabilitare l'AI per ogni tipo individualmente. Ad esempio, potreste abilitarla per le card Application e IT Component ma disabilitarla per le card Organization dove le descrizioni sono specifiche dell'azienda.

### Provider di ricerca

Scegliete quale provider di ricerca web utilizzare per raccogliere il contesto prima di inviarlo al LLM. DuckDuckGo funziona immediatamente senza configurazione. Google Custom Search e SearXNG richiedono una configurazione aggiuntiva (vedi la tabella dei Provider di ricerca sopra).

### Selezione del modello

Per Ollama, l'interfaccia admin mostra tutti i modelli attualmente scaricati sull'istanza Ollama. Per i provider commerciali, inserite direttamente l'identificativo del modello.

---

## Utilizzo dei suggerimenti AI

![Pannello suggerimento AI nel dettaglio card](../assets/img/en/27_ai_suggest_panel.png)

Una volta configurato da un amministratore, gli utenti con il permesso `ai.suggest` (concesso ai ruoli Admin, BPM Admin e Member per impostazione predefinita) vedranno un pulsante scintilla nelle pagine di dettaglio delle card e nella finestra di creazione card.

### Su una card esistente

1. Aprite la vista dettaglio di qualsiasi card.
2. Cliccate sul **pulsante scintilla** (visibile accanto alla sezione descrizione quando l'AI è abilitata per quel tipo di card).
3. Attendete qualche secondo per la ricerca web e l'elaborazione LLM.
4. Revisionate il suggerimento: leggete la descrizione generata, controllate il punteggio di affidabilità e verificate i link alle fonti.
5. **Modificate** il testo se necessario — il suggerimento è completamente modificabile prima dell'applicazione.
6. Cliccate su **Applica** per impostare la descrizione, o **Ignora** per scartarla.

### Quando create una nuova card

1. Aprite la finestra **Crea card**.
2. Dopo aver inserito il nome della card, il pulsante di suggerimento AI diventa disponibile.
3. Cliccatelo per pre-compilare la descrizione prima del salvataggio.

!!! note
    I suggerimenti AI generano solo il campo **descrizione**. Non popolano altri attributi come ciclo di vita, costi o campi personalizzati.

---

## Permessi

| Ruolo | Accesso |
|-------|---------|
| **Admin** | Accesso completo: configura le impostazioni AI e utilizza i suggerimenti |
| **BPM Admin** | Utilizza i suggerimenti |
| **Member** | Utilizza i suggerimenti |
| **Viewer** | Nessun accesso ai suggerimenti AI |

La chiave del permesso è`ai.suggest`. I ruoli personalizzati possono ricevere questo permesso attraverso la pagina di amministrazione dei Ruoli.

---

## Privacy e sicurezza

- **Opzione self-hosted**: Quando si utilizza Ollama, tutta l'elaborazione AI avviene sulla vostra infrastruttura. Nessun dato lascia la vostra rete.
- **Chiavi API crittografate**: Le chiavi API dei provider commerciali sono crittografate con crittografia simmetrica Fernet prima di essere memorizzate nel database.
- **Solo contesto di ricerca**: Il LLM riceve i risultati della ricerca web e il nome/tipo della card — non i dati interni della card, le relazioni o altri metadati sensibili.
- **Controllo dell'utente**: Ogni suggerimento deve essere revisionato e applicato esplicitamente da un utente. L'AI non modifica mai le card automaticamente.

---

## Risoluzione dei problemi

| Problema | Soluzione |
|----------|----------|
| Pulsante suggerimento AI non visibile | Verificate che l'AI sia abilitata per il tipo di card in Impostazioni > Suggerimenti AI, e che l'utente abbia il permesso `ai.suggest`. |
| Stato "AI non configurata" | Andate su Impostazioni > Suggerimenti AI e completate la configurazione del provider. Cliccate su Test connessione per verificare. |
| Modello non presente nel menu a tendina | Per Ollama: assicuratevi che il modello sia scaricato (`ollama pull nome-modello`). Per i provider commerciali: inserite il nome del modello manualmente. |
| Suggerimenti lenti | La velocità di inferenza del LLM dipende dall'hardware (per Ollama) o dalla latenza di rete (per i provider commerciali). I modelli più piccoli come `gemma3:4b` sono più veloci di quelli più grandi. |
| Punteggi di affidabilità bassi | Il LLM potrebbe non trovare abbastanza informazioni rilevanti tramite la ricerca web. Provate un nome di card più specifico, o considerate l'utilizzo di Google Custom Search per risultati migliori. |
| Test connessione fallito | Verificate che l'URL del provider sia raggiungibile dal container backend. Per le configurazioni Docker, assicuratevi che entrambi i container siano sulla stessa rete. |

---

## Variabili d'ambiente

Queste variabili d'ambiente forniscono la configurazione AI iniziale. Una volta salvate tramite l'interfaccia admin, le impostazioni del database hanno la precedenza.

| Variabile | Predefinito | Descrizione |
|-----------|-------------|-------------|
| `AI_PROVIDER_URL` | *(vuoto)* | URL del provider LLM compatibile con Ollama |
| `AI_MODEL` | *(vuoto)* | Nome del modello LLM (es. `gemma3:4b`, `mistral`) |
| `AI_SEARCH_PROVIDER` | `duckduckgo` | Provider di ricerca web: `duckduckgo`, `google` o `searxng` |
| `AI_SEARCH_URL` | *(vuoto)* | URL del provider di ricerca o credenziali API |
| `AI_AUTO_CONFIGURE` | `false` | Auto-abilita AI all'avvio se il provider è raggiungibile |
