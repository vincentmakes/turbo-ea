# MCP-integration (AI-værktøjsadgang)

Turbo EA inkluderer en indbygget **MCP-server** (Model Context Protocol), der gør det muligt for AI-værktøjer — såsom Claude Desktop, GitHub Copilot, Cursor og VS Code — at forespørge og opdatere dine EA-data direkte. AI-værktøjer kan også uploade artefakter (regneark, BPMN-diagrammer, DrawIO-diagrammer, fritformatede dokumenter) og omdanne dem til kort, relationer og diagrammer, der passer til den eksisterende metamodel. Brugere autentificerer sig gennem din eksisterende SSO-udbyder, og hver handling respekterer deres individuelle tilladelser.

Denne funktion er **valgfri** og **starter ikke automatisk**. Den kræver, at SSO er konfigureret, at MCP-profilen aktiveres i Docker Compose, og at en admin slår den til i indstillings-UI'et.

---

## Sådan fungerer det

```
AI Tool (Claude, Copilot, etc.)
    │
    │  MCP protocol (streamable HTTP)
    ▼
Turbo EA MCP Server (:8001, internal)
    │
    │  OAuth 2.1 with PKCE
    │  delegates to your SSO provider
    ▼
Turbo EA Backend (:8000)
    │
    │  Per-user RBAC
    ▼
PostgreSQL
```

1. En bruger tilføjer MCP-server-URL'en til sit AI-værktøj.
2. Ved første forbindelse åbner AI-værktøjet et browservindue til SSO-autentificering.
3. Efter login udsteder MCP-serveren sit eget access-token (understøttet af brugerens Turbo EA JWT).
4. AI-værktøjet bruger dette token til alle efterfølgende anmodninger. Tokens fornyes automatisk.
5. Hver forespørgsel går gennem det normale Turbo EA-tilladelsessystem — brugere ser kun data, de har adgang til.

---

## Forudsætninger

Før du aktiverer MCP, skal du have:

- **SSO konfigureret og fungerende** — MCP delegerer autentificering til din SSO-udbyder (Microsoft Entra ID, Google Workspace, Okta eller generisk OIDC). Se vejledningen [Autentificering og SSO](sso.md).
- **HTTPS med et offentligt domæne** — OAuth-flowet kræver en stabil redirect-URI. Implementér bag en TLS-terminerende reverse proxy (Caddy, Traefik, Cloudflare Tunnel osv.).

---

## Opsætning

### Trin 1: Start MCP-tjenesten

MCP-serveren er en opt-in Docker Compose-profil. Tilføj `--profile mcp` til din opstartskommando:

```bash
docker compose --profile mcp up --build -d
```

Dette starter en let Python-container (port 8001, kun intern) sammen med backend og frontend. Nginx proxyer `/mcp/`-anmodninger til den automatisk.

### Trin 2: Konfigurer miljøvariabler

Tilføj disse til din `.env`-fil:

```dotenv
TURBO_EA_PUBLIC_URL=https://your-domain.example.com
MCP_PUBLIC_URL=https://your-domain.example.com/mcp
```

| Variabel | Standard | Beskrivelse |
|----------|---------|-------------|
| `TURBO_EA_PUBLIC_URL` | `http://localhost:8920` | Den offentlige URL til din Turbo EA-instans |
| `MCP_PUBLIC_URL` | `http://localhost:8920/mcp` (docker compose) | Den offentlige URL til MCP-serveren (bruges i OAuth-redirect-URI'er). Når containeren køres selvstændigt, er kode-standarden `http://localhost:8001` |
| `MCP_PORT` | `8001` | Intern port for MCP-containeren (sjældent behov for at ændre) |

### Trin 3: Tilføj OAuth-redirect-URI'en til din SSO-app

I din SSO-udbyders app-registrering (den samme, du har opsat til Turbo EA-login), skal du tilføje denne redirect-URI:

```
https://your-domain.example.com/mcp/oauth/callback
```

Dette kræves for OAuth-flowet, der autentificerer brugere, når de forbinder fra deres AI-værktøj.

### Trin 4: Aktivér MCP i admin-indstillinger

1. Gå til **Indstillinger** i admin-området og vælg fanebladet **AI**.
2. Rul til afsnittet **MCP Integration (AI Tool Access)**.
3. Slå kontakten til for at **aktivere** MCP.
4. UI'et vil vise MCP-server-URL'en og opsætningsinstruktioner til at dele med dit team.

!!! warning
    Kontakten er deaktiveret, hvis SSO ikke er konfigureret. Opsæt SSO først.

---

## Tilslutning af AI-værktøjer

Når MCP er aktiveret, så del **MCP-server-URL'en** med dit team. Hver bruger tilføjer den til sit AI-værktøj:

### Claude Desktop

1. Åbn **Settings > Connectors > Add custom connector**.
2. Indtast MCP-server-URL'en: `https://your-domain.example.com/mcp`
3. Klik på **Connect** — et browservindue åbner for SSO-login.
4. Efter autentificering kan Claude forespørge dine EA-data.

### VS Code (GitHub Copilot / Cursor)

Tilføj til dit workspace `.vscode/mcp.json`:

```json
{
  "servers": {
    "turbo-ea": {
      "type": "http",
      "url": "https://your-domain.example.com/mcp"
    }
  }
}
```

Brug `https://your-domain.example.com/mcp` som endpoint. Den tidligere dobbelte form `https://your-domain.example.com/mcp/mcp` fungerer stadig, så eksisterende connectorer fortsætter med at fungere uden ændringer.

---

## Lokal test (stdio-tilstand)

Til lokal udvikling eller test uden SSO/HTTPS kan du køre MCP-serveren i **stdio-tilstand** — Claude Desktop spawnerer den direkte som en lokal proces.

**1. Installer MCP-serverpakken:**

```bash
pip install ./mcp-server
```

**2. Tilføj til din Claude Desktop-konfiguration** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "turbo-ea": {
      "command": "python",
      "args": ["-m", "turbo_ea_mcp", "--stdio"],
      "env": {
        "TURBO_EA_URL": "http://localhost:8000",
        "TURBO_EA_EMAIL": "your@email.com",
        "TURBO_EA_PASSWORD": "your-password"
      }
    }
  }
}
```

I denne tilstand autentificerer serveren sig med e-mail/adgangskode og fornyer tokenet automatisk i baggrunden.

---

## Tilgængelige funktioner

MCP-serveren eksponerer **47 værktøjer** på tværs af to grupper: **30 læseværktøjer**, der forespørger EA-data, og **17 skriveværktøjer** (13 additive, 4 destruktive), der opretter og vedligeholder kort, relationer, diagrammer, risici, ADR'er og mere — herunder omdannelse af artefakter, som et AI-værktøj har i sin egen kontekst (regneark, BPMN XML, DrawIO XML, dokumenter, billeder), til strukturerede EA-data. Hvert værktøj bærer MCP-`ToolAnnotations` (skrivebeskyttet / destruktiv / idempotent-hints), så connectors kan vise destruktivitet i deres UI.

### Dry-run-sikkerhed på skrivninger

Hvert skriveværktøj har **`dry_run=true`** som standard. I denne tilstand kører backenden hver validator og resolver, bygger den komplette plan og **ruller derefter transaktionen tilbage**, så intet persisteres. AI-værktøjet returnerer forhåndsvisningen til brugeren; først efter eksplicit bekræftelse skal det kalde værktøjet igen med `dry_run=false` for at committe. Dette forhindrer en entusiastisk agent i stille at seede hundredvis af kort på et fejltolket regneark.

### Læseværktøjer

Serveren eksponerer 30 læseværktøjer grupperet i otte klynger.

**Kort og metamodel**

| Værktøj | Beskrivelse |
|------|-------------|
| `search_cards` | Søg og filtrer kort efter type, status eller fri tekst |
| `get_card` | Få fulde detaljer for et kort efter UUID |
| `get_card_relations` | Få alle relationer forbundet til et kort |
| `get_card_hierarchy` | Få forfædre og børn af et kort |
| `list_card_types` | Liste over alle korttyper i metamodellen |
| `get_relation_types` | Liste over relationstyper, valgfrit filtreret efter korttype |
| `resolve_card_refs` | Forhåndsvalider navnebaserede kortreferencer (navn → UUID) før en bulk-import — opløser kun, skriver aldrig |
| `analyze_impact` | Afhængigheds-konsekvensanalyse (blast radius) for en foreslået ændring af et kort |

**Dashboards**

| Værktøj | Beskrivelse |
|------|-------------|
| `get_dashboard` | KPI-dashboard (antal, datakvalitet, godkendelser, aktivitet) |
| `get_landscape` | Kort af én type grupperet efter en relateret type |

**GRC — Risikoregister**

| Værktøj | Beskrivelse |
|------|-------------|
| `list_risks` | Pagineret, filterbar EA-risikoliste (TOGAF Phase G) |
| `get_risk` | Enkelt risikodetalje med tilknyttede kort + revisionsspor |
| `get_risk_metrics` | KPI'er + 4×4 initial/residual sandsynlighed × impact-matricer |
| `get_card_risks` | Alle risici, der i øjeblikket er tilknyttet et specifikt kort |

**GRC — Compliance**

| Værktøj | Beskrivelse |
|------|-------------|
| `list_compliance_findings` | Compliance-fund bundtet efter regulering |
| `get_compliance_overview` | Compliance-scores + per-regulering-statusmatrix + sidste scanning-metadata |

**Governance og Levering**

| Værktøj | Beskrivelse |
|------|-------------|
| `list_principles` | Publicerede EA-principper (statement, begrundelse, implikationer) |
| `list_adrs` | Architecture Decision Records, filterbare efter initiativ/status |
| `get_adr` | Enkelt ADR med sektioner, tilknyttede kort, signaturspor |
| `list_soaws` | Statements of Architecture Work for et initiativ |

**Rapporter**

| Værktøj | Beskrivelse |
|------|-------------|
| `get_portfolio_report` | Bubble-chart-data for en korttype (funktionel × teknisk fit som standard) |
| `get_cost_treemap` | Treemap over kortomkostninger, valgfrit grupperet efter en relateret type |
| `get_capability_heatmap` | Hierarkisk business-capability-heatmap |
| `get_data_quality_report` | Per-korttype-fuldførelsesopdeling |

**Kortkontekst**

| Værktøj | Beskrivelse |
|------|-------------|
| `get_card_stakeholders` | Brugere + roller tildelt et kort |
| `get_card_comments` | Trådede kommentarer på et kort |
| `get_card_documents` | Dokumentlinks vedhæftet et kort |

**Diagrammer**

| Værktøj | Beskrivelse |
|------|-------------|
| `list_diagrams` | Liste over fritformatede (DrawIO) diagrammer, valgfrit filtreret til ét kort |
| `get_diagram` | Hent et enkelt diagram efter id, inklusive dets DrawIO XML |

**Revision og ændringshistorik**

| Værktøj | Beskrivelse |
|------|-------------|
| `get_change_history` | Forespørg mutations-batch-hovedbogen (efter batch-id, aktør, værktøj eller oprindelse) for at rekonstruere præcis, hvad en tidligere MCP-commit ændrede |

Alle værktøjer er bundet af den autentificerede brugers RBAC — en viewer vil simpelthen få en tom liste (eller 403) for områder, de ikke kan se; intet på MCP-laget skal konfigureres pr. værktøj.

### Skriveværktøjer

Serveren eksponerer 17 skriveværktøjer, hver annoteret som **additiv** (opretter eller udvider data) eller **destruktiv** (ændrer eller fjerner eksisterende data), så connectors kan advare tilsvarende.

**Additive (13)**

| Værktøj | Beskrivelse |
|------|-------------|
| `create_cards_bulk` | Opret mange kort i ét kald (f.eks. regnearksrækker). Understøtter samme-batch-forældrereferencer efter navn med server-side topologisk sortering. |
| `transition_card_lifecycle` | Flyt et kort gennem godkendelses- eller livscyklusfaser. |
| `create_risks` | Opret poster i EA-risikoregisteret. |
| `update_risks` | Opdater risikoregister-poster (felter, tilknyttede kort). |
| `add_card_comment` | Skriv en kommentar på et kort — en ikke-destruktiv, gennemgåelig note i stedet for at mutere felter. |
| `create_soaw` | Opret et Statement of Architecture Work for et initiativ. |
| `assign_stakeholders` | Tildel eller fjern interessentroller på kort. |
| `update_cards_bulk` | Patches på feltniveau på mange kort i ét kald. |
| `create_adr` | Opret en Architecture Decision Record. |
| `update_adr` | Opdater en ADR (titel, sektioner, status, tilknyttede kort). |
| `sign_adr` | Signér en ADR (kræver tilladelsen `adr.sign`; ellers returneres et UI-dybdelink til at signere i browseren). |
| `create_diagram` | Opret et fritformatet DrawIO-diagram med valgfri links til eksisterende kort. |
| `import_bpmn` | Gem et BPMN 2.0 XML-diagram mod et **eksisterende** Business Process-kort. Hvis intet kort matcher det angivne navn, returnerer værktøjet en `card_not_found`-fejl, der peger agenten mod `create_cards_bulk` — dette tvinger agenten til at oprette kortet eksplicit med beskrivelse, undertype og egenskaber først, i stedet for at tage en genvej, der lander et sparsomt kort. |

**Destruktive (4)**

| Værktøj | Beskrivelse |
|------|-------------|
| `upsert_relations_bulk` | Opret eller slet relationer mellem kort. Kilde/mål/type valideres mod metamodellen. Sletning afvises, medmindre operatøren tilvælger det (se rettesnore). |
| `archive_cards` | Soft-delete af kort. Kan genoprettes — arkiverede kort kan gendannes i 30 dage før auto-udrensning. |
| `update_diagram` | Erstat et diagrams DrawIO XML, navn eller kortlinks. |
| `rollback_batch` | Tilbagerul de skrivninger, der blev udført under en tidligere mutations-batch. |

### Artefakt-upload

En delmængde af skriveværktøjerne (`create_cards_bulk`, `upsert_relations_bulk`, `create_diagram`, `import_bpmn`) lader en AI-agent omdanne artefakter til strukturerede EA-data. Agenten læser kildefilen fra sin egen kontekst (multimodal vision, filvedhæftninger), uddrager strukturerede rækker og kalder disse værktøjer. MCP-serveren selv parser aldrig filer — den forventer allerede-struktureret input.

Typisk arbejdsproces, når en bruger deler et regneark med AI-agenten:

1. Agenten kalder `list_card_types` og `get_relation_types` for at forstå metamodellen.
2. Agenten parser regnearket (i sin egen kontekst, ikke i MCP) og bygger række-dicts.
3. Agenten kalder `create_cards_bulk(cards=…, dry_run=True)` og viser forhåndsvisningen til brugeren.
4. Brugeren bekræfter; agenten kalder igen med `dry_run=False` for at committe.
5. Hvis relationskolonner er til stede, kalder agenten derefter `upsert_relations_bulk` med den samme dry-run/bekræft-cyklus.

### Skriveværktøjs-rettesnore

Forsvar i dybden ovenpå dry-run, så en LLM-fejltagelse ikke kan forårsage massiv skade:

- **Per-kald-størrelsesgrænser.** MCP-skriveværktøjerne håndhæver en meget mindre grænse end de underliggende Excel-importør-endpoints: 200 rækker for `create_cards_bulk`, 500 operationer for `upsert_relations_bulk`. Stort nok til enhver realistisk enkelt artefakt-upload, lille nok til, at en dry-run-forhåndsvisning stadig kan gennemses.
- **Ingen relationssletning som standard.** `upsert_relations_bulk` afviser `action: "delete"`-operationer — for at fjerne relationer, brug web-UI'et, hvor handlingen registreres under brugerens identitet. Operatører kan tilvælge ved at indstille `MCP_ALLOW_RELATION_DELETE=true`.
- **Kill switch.** `MCP_WRITES_ENABLED=false` slår alle 17 skriveværktøjer fra uden at re-deploye kode. De 30 læseværktøjer fortsætter med at virke.
- **Audit origin-tag.** Hver backend-anmodning fra MCP-serveren bærer en `X-Turbo-EA-Origin: mcp`-header. Hændelser udsendt fra disse anmodninger er tagget `origin: "mcp"` i revisions-log-payloaden, så admins kan filtrere MCP-drevne skrivninger ud af tidslinjen adskilt fra web-UI-handlinger.
- **Mutations-batches.** Hvert MCP-skrivekald åbner en mutations-batch før nogen skrivninger; hver hændelse udsendt under kaldet stemples med batch-id'et. Admins (eller værktøjet `get_change_history`) kan rekonstruere den fulde per-hændelses-diff for en commit fra ét id, og `rollback_batch` kan tilbagerulle den. Commits over `MCP_BATCH_CONFIRMATION_THRESHOLD` rækker skal ekko en engangs-`confirm_token` udstedt af den forudgående dry-run (15 minutters TTL), så en stor commit altid følger efter en gennemgået forhåndsvisning.
- **Ingen hård sletning.** Værktøjssættet udelader bevidst permanent kortsletning. `archive_cards` og `update_cards_bulk` *er* eksponeret, men arkivering er en genoprettelig soft-delete (30-dages gendannelsesvindue), og begge er destruktivitets-annoterede og dry-run-gatede. Tilføjelse af et værktøj, der udfører en irreversibel mutation (hård sletning, tvungen udrensning), ville kræve en eksplicit designgennemgang.

De seks rettesnore-miljøvariabler på MCP-containeren:

| Variabel | Standard | Effekt |
|----------|---------|--------|
| `MCP_WRITES_ENABLED` | `true` | Hovedkontakt for skriveværktøjer. `false` → skrivebeskyttet MCP. |
| `MCP_MAX_CARDS_PER_CALL` | `200` | Hård grænse på `create_cards_bulk`- / `update_cards_bulk`-rækker pr. anmodning. |
| `MCP_MAX_RELATIONS_PER_CALL` | `500` | Hård grænse på `upsert_relations_bulk`-operationer pr. anmodning. |
| `MCP_ALLOW_RELATION_DELETE` | `false` | Når `true`, accepterer `upsert_relations_bulk` `action: "delete"`-operationer. |
| `MCP_BATCH_CONFIRMATION_THRESHOLD` | `20` | Commits, der berører flere rækker end dette, kræver `confirm_token` fra en forudgående dry-run. |
| `MCP_REQUIRE_DRYRUN_FIRST` | `true` | Aktiverer confirm-token-gaten ovenfor. Sæt kun til `false` for betroede automatiseringspipelines, der eksplicit springer forhåndsvisnings-rundturen over. |

### Ressourcer

| URI | Beskrivelse |
|-----|-------------|
| `turbo-ea://types` | Alle korttyper i metamodellen |
| `turbo-ea://relation-types` | Alle relationstyper |
| `turbo-ea://dashboard` | Dashboard-KPI'er og oversigtsstatistik |

### Guidede prompts

| Prompt | Beskrivelse |
|--------|-------------|
| `analyze_landscape` | Flertrinsanalyse: dashboard-oversigt, typer, relationer |
| `find_card` | Søg efter et kort efter navn, få detaljer og relationer |
| `explore_dependencies` | Kortlæg, hvad et kort afhænger af, og hvad der afhænger af det |

---

## Tilladelser

| Rolle | Adgang |
|------|--------|
| **Admin** | Konfigurer MCP-indstillinger (`admin.mcp`-tilladelse). Fuld læse + skrive gennem MCP. |
| **Alle autentificerede brugere** | Læseadgang styres af deres eksisterende RBAC. Skriveværktøjer kræver de matchende backend-tilladelser — `inventory.create` / `inventory.edit` / `inventory.archive` (kort), `relations.manage` (relationer), `diagrams.manage` (diagrammer), `bpm.edit` (BPMN), `risks.manage` (risikoregister), `comments.create` (kommentarer), `stakeholders.manage` (interessenter), `soaw.create` (SoAW), `adr.create` / `adr.sign` (ADR'er). |

Tilladelsen `admin.mcp` styrer, hvem der kan administrere MCP-indstillinger. Den er kun tilgængelig for Admin-rollen som standard. Brugerdefinerede roller kan tildeles denne tilladelse gennem Roller-administrationssiden.

Dataadgang gennem MCP — læse eller skrive — følger den samme RBAC-model som web-UI'et. Hvis en bruger ikke kan oprette kort i lager-UI'et, kan de heller ikke oprette dem gennem MCP; der er ingen separate MCP-specifikke datatilladelser.

---

## Sikkerhed

- **SSO-delegeret autentificering**: Brugere autentificerer sig via deres virksomheds SSO-udbyder. MCP-serveren ser eller gemmer aldrig adgangskoder.
- **OAuth 2.1 med PKCE**: Autentificeringsflowet bruger Proof Key for Code Exchange (S256) for at forhindre autorisationskode-aflytning.
- **Per-bruger RBAC**: Hver MCP-forespørgsel — læse eller skrive — kører med den autentificerede brugers tilladelser. Ingen delte servicekonti.
- **Dry-run som standard på skrivninger**: Skriveværktøjer har som standard en valider-og-tilbageruk-forhåndsvisning. AI-værktøjet skal eksplicit kalde igen med `dry_run=false`, før noget persisteres, og hver ændring revideres under brugerens identitet.
- **Ingen filparsing i MCP**: MCP-serveren selv accepterer ikke PDF'er, Excel-filer, billeder eller andre binære artefakter. Det kaldende AI-værktøj parser dem i sin egen kontekst og sender strukturerede rækker. Dette holder angrebsfladen smal og undgår at eksponere serveren for misformet binær input.
- **Token-rotation**: Access-tokens udløber efter 1 time. Refresh-tokens varer 30 dage. Autorisationskoder er engangsbrug og udløber efter 10 minutter.
- **Kun intern port**: MCP-containeren eksponerer port 8001 kun på det interne Docker-netværk. Al ekstern adgang går gennem Nginx reverse proxy.

---

## Fejlfinding

| Problem | Løsning |
|-------|----------|
| MCP-kontakten er deaktiveret i indstillinger | SSO skal konfigureres først. Gå til fanebladet Indstillinger > Autentificering og opsæt en SSO-udbyder. |
| "host not found" i Nginx-logs | MCP-tjenesten kører ikke. Start den med `docker compose --profile mcp up -d`. Nginx-konfigurationen håndterer dette elegant (502-svar, intet nedbrud). |
| OAuth-callback fejler | Bekræft, at du har tilføjet `https://your-domain.example.com/mcp/oauth/callback` som en redirect-URI i din SSO-app-registrering. |
| AI-værktøjet kan ikke oprette forbindelse | Tjek, at `MCP_PUBLIC_URL` matcher den URL, der er tilgængelig fra brugerens maskine. Sørg for, at HTTPS virker. |
| Brugeren får tomme resultater | MCP respekterer RBAC-tilladelser. Hvis en bruger har begrænset adgang, vil de kun se de kort, deres rolle tillader. |
| Forbindelse droppes efter 1 time | AI-værktøjet bør håndtere token-fornyelse automatisk. Hvis ikke, genopret forbindelse. |
