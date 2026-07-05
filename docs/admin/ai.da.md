# AI-funktioner

![AI-indstillinger](../assets/img/en/26_admin_settings_ai.png)

Turbo EA inkluderer AI-drevne funktioner, der bruger en **Large Language Model (LLM)** til at hjælpe brugere. Alle AI-funktioner deler en enkelt **AI-udbyderkonfiguration** — opsæt én gang, brug overalt.

Aktuelt tilgængelige AI-funktioner:

- **Beskrivelsesforslag** — Generér automatisk kortbeskrivelser ved hjælp af websøgning + LLM
- **Porteføljeindsigt** — Generér on-demand strategisk analyse af applikationsporteføljen

Alle funktioner er **valgfri** og **fuldt admin-styrede**. De kan køre helt på din egen infrastruktur ved hjælp af en lokal Ollama-instans eller forbinde til kommercielle LLM-udbydere.

---

## Sådan fungerer det

AI-forslagspipelinen har to trin:

1. **Websøgning** — Turbo EA forespørger en søgeudbyder (DuckDuckGo, Google Custom Search eller SearXNG) ved hjælp af kortets navn og type som kontekst. For eksempel genererer et Application-kort med navnet "SAP S/4HANA" en søgning efter "SAP S/4HANA software application".

2. **LLM-ekstraktion** — Søgeresultaterne sendes til den konfigurerede LLM sammen med en type-bevidst systemprompt. Modellen producerer en beskrivelse, en confidence-score (0-100%) og lister de kilder, den brugte.

Resultatet vises til brugeren med:

- En **redigerbar beskrivelse**, de kan gennemgå og ændre før anvendelse
- Et **confidence-badge**, der viser, hvor pålideligt forslaget er
- **Kildelinks**, så brugeren kan verificere informationen

---

## Understøttede LLM-udbydere

| Udbyder | Type | Konfiguration |
|----------|------|---------------|
| **Ollama** | Selvhostet | Udbyder-URL (f.eks. `http://ollama:11434`) + modelnavn |
| **OpenAI** | Kommerciel | API-nøgle + modelnavn (f.eks. `gpt-4o`) |
| **Google Gemini** | Kommerciel | API-nøgle + modelnavn |
| **Azure OpenAI** | Kommerciel | API-nøgle + deployment-URL |
| **OpenRouter** | Kommerciel | API-nøgle + modelnavn |
| **Anthropic Claude** | Kommerciel | API-nøgle + modelnavn |

Kommercielle udbydere kræver en API-nøgle, som gemmes krypteret i databasen ved hjælp af Fernet symmetrisk kryptering.

---

## Søgeudbydere

| Udbyder | Opsætning | Bemærkninger |
|----------|-------|-------|
| **DuckDuckGo** | Ingen konfiguration nødvendig | Standard. Zero-dependency HTML-skrabning. Ingen API-nøgle påkrævet. |
| **Google Custom Search** | Kræver API-nøgle og Custom Search Engine ID | Indtast som `API_KEY:CX` i søge-URL-feltet. Resultater af højere kvalitet. |
| **SearXNG** | Kræver en selvhostet SearXNG-instans-URL | Privatlivs-fokuseret metasøgemaskine. JSON API. |

---

## Opsætning

### Mulighed A: Medfølgende Ollama (Docker Compose)

Den enkleste måde at komme i gang på. Turbo EA inkluderer en valgfri Ollama-container i sin Docker Compose-konfiguration.

**1. Start med AI-profilen:**

```bash
docker compose --profile ai up --build -d
```

**2. Aktivér auto-konfiguration** ved at tilføje disse variabler til din `.env`:

```dotenv
AI_AUTO_CONFIGURE=true
AI_MODEL=gemma3:4b          # or mistral, llama3:8b, etc.
```

Ved opstart vil backenden:

- Registrere Ollama-containeren
- Gemme forbindelsesindstillingerne i databasen
- Hente den konfigurerede model, hvis den ikke allerede er downloadet (kører i baggrunden, kan tage et par minutter)

**3. Verificér** i admin-UI'et: gå til **Indstillinger > AI Suggestions** og bekræft, at statussen vises som forbundet.

### Mulighed B: Ekstern Ollama-instans

Hvis du allerede kører Ollama på en separat server:

1. Gå til **Indstillinger > AI Suggestions** i admin-UI'et.
2. Vælg **Ollama** som udbydertype.
3. Indtast **Udbyder-URL** (f.eks. `http://your-server:11434`).
4. Klik på **Test forbindelse** — systemet vil vise tilgængelige modeller.
5. Vælg en **model** fra dropdown.
6. Klik på **Gem**.

### Mulighed C: Kommerciel LLM-udbyder

1. Gå til **Indstillinger > AI Suggestions** i admin-UI'et.
2. Vælg din udbyder (OpenAI, Google Gemini, Azure OpenAI, OpenRouter eller Anthropic Claude).
3. Indtast din **API-nøgle** — den vil blive krypteret før lagring.
4. Indtast **modelnavnet** (f.eks. `gpt-4o`, `gemini-pro`, `claude-sonnet-4-20250514`).
5. Klik på **Test forbindelse** for at verificere.
6. Klik på **Gem**.

---

## Konfigurationsmuligheder

Når du er forbundet, kan du finjustere AI-funktionerne i **Indstillinger > AI**. Indstillingssiden er opdelt i tre sektioner:

1. **AI Provider** — Delt udbyderkonfiguration (type, URL, API-nøgle, model)
2. **AI Description Suggestions** — Aktivér/deaktivér beskrivelsesforslag og vælg, hvilke korttyper der understøtter dem
3. **Portfolio Insights** — Aktivér/deaktivér AI-drevne indsigter i porteføljerapporten

### Aktivér/deaktivér pr. korttype

Ikke alle korttyper drager lige meget gavn af AI-forslag. Du kan aktivere eller deaktivere AI for hver type individuelt. For eksempel kan du aktivere det for Application- og IT Component-kort, men deaktivere det for Organization-kort, hvor beskrivelser er virksomhedsspecifikke.

### Søgeudbyder

Vælg, hvilken websøgeudbyder der skal bruges til at indsamle kontekst, før der sendes til LLM'en. DuckDuckGo virker ud af kassen uden konfiguration. Google Custom Search og SearXNG kræver yderligere opsætning (se tabellen Søgeudbydere ovenfor).

### Modelvalg

For Ollama viser admin-UI'et alle modeller, der i øjeblikket er downloadet på Ollama-instansen. For kommercielle udbydere skal du indtaste modelidentifikatoren direkte.

---

## Brug af AI-forslag

![AI-forslagspanel på kortdetalje](../assets/img/en/27_ai_suggest_panel.png)

Når det er konfigureret af en admin, vil brugere med tilladelsen `ai.suggest` (tildelt Admin-, BPM Admin- og Member-roller som standard) se en sparkle-knap på kortdetaljesider og i opret-kort-dialogen.

### På et eksisterende kort

1. Åbn et kortdetaljevisning.
2. Klik på **sparkle-knappen** (synlig ud for beskrivelsessektionen, når AI er aktiveret for den korttype).
3. Vent et par sekunder på websøgning og LLM-behandling.
4. Gennemgå forslaget: læs den genererede beskrivelse, tjek confidence-scoren og verificér kildelinksene.
5. **Rediger** teksten, hvis det er nødvendigt — forslaget er fuldt redigerbart før anvendelse.
6. Klik på **Anvend** for at indstille beskrivelsen, eller **Afvis** for at kassere den.

### Når du opretter et nyt kort

1. Åbn dialogen **Opret kort**.
2. Efter at have indtastet kortnavnet bliver AI-forslagsknappen tilgængelig.
3. Klik på den for at præudfylde beskrivelsen før lagring.

### Application-specifikke forslag

For **Application**-kort kan AI'en også foreslå yderligere felter, når den finder bevis i websøgeresultater:

- **Kommerciel applikation** — slået til, hvis prisfastsættelse, licensinformation eller salgskontaktsider findes
- **Hostingtype** — foreslået som On-Premise, Cloud (SaaS), Cloud (PaaS), Cloud (IaaS) eller Hybrid baseret på produktets deployment-model

Disse felter foreslås kun, når AI'en finder klart bevis — de spekuleres ikke. Brugeren kan gennemgå og justere værdierne før anvendelse.

!!! note
    Bortset fra Application-specifikke felter genererer AI-forslag primært **beskrivelsesfeltet**. Brugerdefinerede felter for andre korttyper er endnu ikke dækket.

---

## Semantisk søgning (embeddings) { #semantic-search-embeddings }

Semantisk søgning lader brugere finde kort ud fra **betydning** frem for præcis ordlyd — en søgning efter «kundevendte betalingssystemer» finder et kort ved navn «NexaPay Gateway», som en almindelig tekstsøgning ville overse. Den driver MCP-værktøjet `semantic_search_cards`.

Under motorhjelmen bruger den en **embedding-model** (en lille tekst-til-vektor-model), ikke en chat-LLM, og fusionerer den betydningsbaserede rangering med den eksisterende delstrengsmatchning. Da embeddings er en særskilt egenskab — og Anthropic, en understøttet chat-udbyder, ikke har en embeddings-API — konfigureres embedding-udbyderen **separat** fra chat-AI-udbyderen ovenfor.

### Aktivér semantisk søgning

1. Gå til **Administration → Indstillinger → AI → Semantisk søgning (embeddings)**.
2. Slå **Semantisk søgning aktiveret** til.
3. Vælg en **embedding-udbyder**:
   - **Ollama** (standard, selvhostet, virker offline): angiv udbyder-URL'en (f.eks. `http://ollama:11434`) og en model, der udsender 768-dimensionelle vektorer — `nomic-embed-text` er den anbefalede standard. Hent den med `ollama pull nomic-embed-text`.
   - **OpenAI-kompatibel**: angiv udbyder-URL og API-nøgle; brug `text-embedding-3-small` (eller `-large`), som Turbo EA anmoder om i 768 dimensioner.
   - **Azure OpenAI**: angiv ressource-URL, API-nøgle og et embeddings-deployment-navn.
4. Klik på **Test** for at verificere forbindelsen — en vellykket test rapporterer vektordimensionen (768).
5. Klik på **Gem**.

> Embedding-modellen skal udsende **768-dimensionelle** vektorer. `nomic-embed-text` gør det nativt; OpenAI-modellerne `text-embedding-3-*` anmodes automatisk om i 768.

### Sådan holdes embeddings opdateret

Kort-embeddings genereres og opdateres automatisk af en baggrundsopgave — du behøver ikke udløse noget manuelt. Når du aktiverer funktionen første gang, **efterfylder** den det eksisterende inventar (dette kan tage fra få minutter til nogle timer på en stor bestand med en Ollama, der kun kører på CPU, og kører stille i baggrunden). Derefter genindlejres nye og redigerede kort inden for cirka et minut. Hvis du skifter embedding-model, genindlejres hvert kort automatisk.

Semantiske resultater respekterer de **samme tilladelser og samme sløring af omkostningsfelter** som den normale kortliste — en bruger ser aldrig et kort i de semantiske resultater, som vedkommende ikke kunne se i inventaret. Hvis embedding-udbyderen er utilgængelig, falder søgningen gennemsigtigt tilbage til delstrengsmatchning.

## Porteføljeindsigt

Når den er aktiveret, viser Application Portfolio-rapporten en **AI Insights**-knap. Et klik på den sender et resumé af den aktuelle porteføljevisning — gruppering, attributfordelinger og livscyklusdata — til den konfigurerede LLM, som returnerer 3-5 handlingsorienterede indsigter.

Indsigter fokuserer på:

- **Koncentrationsrisici** — for mange applikationer i én gruppe eller stat
- **Moderniseringsmuligheder** — baseret på livscyklus- og hostingdata
- **Porteføljebalance** — diversitet på tværs af undertyper, grupper og attributter
- **Livscyklusbekymringer** — applikationer nær udløb
- **Omkostnings- eller kompleksitetsdrivere** — baseret på attributfordelinger

Indsigtspanelet er sammenklappeligt og kan regenereres til enhver tid for at afspejle ændringer i filtre eller gruppering.

### Aktivering af Porteføljeindsigt

1. Gå til **Indstillinger > AI > Portfolio Insights**.
2. Slå **Portfolio insights** til.
3. Klik på **Gem**.

!!! note
    Porteføljeindsigter kræver, at AI-udbyderen er konfigureret først. Funktionen bruger den samme udbyder og model som beskrivelsesforslag.

---

## Tilladelser

| Rolle | Adgang |
|------|--------|
| **Admin** | Fuld adgang: konfigurer AI-indstillinger, brug forslag og generér porteføljeindsigter |
| **BPM Admin** | Brug forslag og generér porteføljeindsigter |
| **Member** | Brug forslag og generér porteføljeindsigter |
| **Viewer** | Ingen adgang til AI-funktioner |

To tilladelsesnøgler styrer AI-adgang:

- `ai.suggest` — Styrer adgang til AI-beskrivelsesforslag
- `ai.portfolio_insights` — Styrer adgang til AI-porteføljeindsigter

Brugerdefinerede roller kan tildeles disse tilladelser gennem Roller-administrationssiden.

---

## Privatliv og sikkerhed

- **Selvhostet mulighed**: Når du bruger Ollama, sker al AI-behandling på din egen infrastruktur. Ingen data forlader dit netværk.
- **Krypterede API-nøgler**: API-nøgler fra kommercielle udbydere krypteres med Fernet symmetrisk kryptering, før de gemmes i databasen.
- **Kun søgekontekst**: LLM'en modtager websøgeresultater og kortets navn/type — ikke dine interne kortdata, relationer eller andre følsomme metadata.
- **Brugerkontrol**: Hvert forslag skal gennemgås og eksplicit anvendes af en bruger. AI'en ændrer aldrig kort automatisk.

---

## Fejlfinding

| Problem | Løsning |
|-------|----------|
| AI-forslagsknap ikke synlig | Tjek, at AI er aktiveret for korttypen i Indstillinger > AI Suggestions, og at brugeren har `ai.suggest`-tilladelsen. |
| "AI not configured"-status | Gå til Indstillinger > AI Suggestions og fuldfør udbyderopsætningen. Klik på Test forbindelse for at verificere. |
| Model vises ikke i dropdown | For Ollama: sørg for, at modellen er downloadet (`ollama pull model-name`). For kommercielle udbydere: indtast modelnavnet manuelt. |
| Langsomme forslag | LLM-inferenshastighed afhænger af hardware (for Ollama) eller netværkslatens (for kommercielle udbydere). Mindre modeller som `gemma3:4b` er hurtigere end større. |
| Lave confidence-scores | LLM'en kan muligvis ikke finde nok relevant information via websøgning. Prøv et mere specifikt kortnavn, eller overvej at bruge Google Custom Search for bedre resultater. |
| Forbindelsestest mislykkes | Bekræft, at udbyder-URL'en er tilgængelig fra backend-containeren. For Docker-opsætninger skal du sikre dig, at begge containere er på samme netværk. |

---

## Miljøvariabler

Disse miljøvariabler giver indledende AI-konfiguration. Når de er gemt gennem admin-UI'et, har databaseindstillingerne forrang.

| Variabel | Standard | Beskrivelse |
|----------|---------|-------------|
| `AI_PROVIDER_URL` | *(tom)* | Ollama-kompatibel LLM-udbyder-URL |
| `AI_MODEL` | *(tom)* | LLM-modelnavn (f.eks. `gemma3:4b`, `mistral`) |
| `AI_SEARCH_PROVIDER` | `duckduckgo` | Websøgeudbyder: `duckduckgo`, `google` eller `searxng` |
| `AI_SEARCH_URL` | *(tom)* | Søgeudbyder-URL eller API-legitimationsoplysninger |
| `AI_AUTO_CONFIGURE` | `false` | Auto-aktivér AI ved opstart, hvis udbyderen er tilgængelig |
