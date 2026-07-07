# TurboLens AI-intelligens

**TurboLens**-modulet tilbyder AI-drevet analyse af dit virksomheds­arkitekturlandskab. Det bruger din konfigurerede AI-udbyder til at udføre leverandøranalyse, dubletdetektion, modernisations­vurdering og arkitekturanbefalinger.

!!! note
    TurboLens kræver en kommerciel AI-udbyder (Anthropic Claude, OpenAI, DeepSeek eller Google Gemini) konfigureret i [AI-indstillinger](../admin/ai.md). Modulet er automatisk tilgængeligt, når AI er konfigureret.

## Dashboard

TurboLens-dashboardet giver et øjebliks overblik over din landskabsanalyse.

| Indikator | Beskrivelse |
|-----------|-------------|
| **Total Cards** | Antal aktive kort i din portefølje |
| **Avg Quality** | Gennemsnitlig datakvalitets-score på tværs af alle kort |
| **Vendors** | Antal analyserede teknologileverandører |
| **Duplicate Clusters** | Antal identificerede dublet-grupper |
| **Modernizations** | Antal modernisations­muligheder fundet |
| **Annual Cost** | Samlet årlig omkostning på tværs af alle kort |

Dashboardet viser også:

- **Cards by type** — Nedbrydning af korttællere pr. korttype
- **Datakvalitets-fordeling** — Kort grupperet i Bronze (<50%), Silver (50–80%) og Gold (>80%) kvalitets-niveauer
- **Top kvalitetsproblemer** — Kort med den laveste datakvalitets-score, med direkte links til hvert kort

## Leverandøranalyse

Leverandøranalyse bruger AI til at kategorisere dine teknologileverandører i 45+ branchekategorier (f.eks. CRM, ERP, Cloud Infrastructure, Security).

**Sådan bruger du den:**

1. Naviger til **TurboLens > Vendors**
2. Klik på **Run Analysis**
3. AI'en behandler din leverandørportefølje i batches og kategoriserer hver leverandør med begrundelse
4. Resultaterne viser en kategori-nedbrydning og en detaljeret leverandør-tabel

Hver leverandør-post indeholder kategorien, sub-kategorien, antal tilknyttede applikationer, samlet årlig omkostning og AI'ens begrundelse for kategoriseringen. Skift mellem gitter- og tabel-visninger ved hjælp af visnings-skifteren.

## Leverandør-resolution

Leverandør-resolution bygger et kanonisk leverandør-hierarki ved at løse aliasser og identificere forælder-barn-relationer.

**Sådan bruger du den:**

1. Naviger til **TurboLens > Resolution**
2. Klik på **Resolve Vendors**
3. AI'en identificerer leverandør-aliasser (f.eks. "MSFT" = "Microsoft"), moderselskaber og produkt-grupperinger
4. Resultaterne viser det løste hierarki med konfidens-scorer

Hierarkiet organiserer leverandører i fire niveauer: vendor, product, platform og module. Hver post viser antallet af linkede applikationer og IT-komponenter, samlet omkostning og en konfidens-procent.

## Dublet-detektion

Dublet-detektion identificerer funktionelle overlap i din portefølje — kort, der tjener samme eller lignende forretningsformål.

**Sådan bruger du den:**

1. Naviger til **TurboLens > Duplicates**
2. Klik på **Detect Duplicates**
3. AI'en analyserer Application-, IT Component- og Interface-kort i batches
4. Resultaterne viser klynger af potentielle dubletter med beviser og anbefalinger

For hver klynge kan du:

- **Confirm** — Marker dubletten som bekræftet til opfølgning
- **Investigate** — Markér til yderligere undersøgelse
- **Dismiss** — Afvis hvis ikke en rigtig dublet

## Modernisations­vurdering

Modernisations­vurdering evaluerer kort for opgraderings­muligheder baseret på aktuelle teknologi-tendenser.

**Sådan bruger du den:**

1. Naviger til **TurboLens > Duplicates** (Modernization-fanen)
2. Vælg en mål-korttype (Application, IT Component eller Interface)
3. Klik på **Assess Modernization**
4. Resultaterne viser hvert kort med modernisations­type, anbefaling, indsats-niveau (low/medium/high) og prioritet (low/medium/high/critical)

Resultater grupperes efter prioritet, så du kan fokusere på de mest virkningsfulde modernisations­muligheder først.

## Architecture AI

Architecture AI er en 5-trins guidet wizard, der genererer arkitekturanbefalinger baseret på dit eksisterende landskab. Den linker dine forretningsmål og kompetencer til konkrete løsningsforslag, mangelanalyse, afhængigheds­kortlægning og et målarkitektur-diagram.

<div style="text-align: center;">
<iframe width="560" height="315" src="https://www.youtube.com/embed/FDneDl0ULsA" title="Architecture AI Overview" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
</div>

En stepper øverst sporer dit fremskridt gennem de fem stadier: Requirements, Business Fit, Technical Fit, Solution og Target Architecture. Du kan klikke på et hvilket som helst tidligere nået trin for at navigere tilbage og gennemgå tidligere faser — alle downstream-data bevares og ryddes kun, når du aktivt gen-indsender en fase. Dit fremskridt gemmes automatisk i browser-sessionen, så du kan navigere væk og vende tilbage uden at miste dit arbejde. Du kan også gemme vurderinger i databasen og genoptage dem senere (se [Save & Resume](#save--resume) nedenfor). Klik på **New Assessment** for at starte en frisk analyse når som helst.

### Trin 1: Krav

Indtast dit forretningskrav på naturligt sprog (f.eks. "We need a customer self-service portal"). Derefter:

- **Vælg forretningsmål** — Vælg et eller flere eksisterende Objective-kort fra autocomplete-dropdownen. Dette grunder AI'ens analyse i dine strategiske mål. Mindst ét mål er påkrævet.
- **Vælg forretningskompetencer** (valgfrit) — Vælg eksisterende Business Capability-kort eller skriv nye kompetence-navne. Nye kompetencer vises som blå chips mærket "NEW: name". Dette hjælper AI'en med at fokusere på specifikke kompetenceområder.

Klik på **Generate Questions** for at fortsætte.

### Trin 2: Business Fit (Fase 1)

AI'en genererer forretningsklargørings-spørgsmål skræddersyet til dit krav og valgte mål. Spørgsmål kommer i forskellige typer:

- **Text** — Friform svarfelter
- **Single choice** — Klik på én mulighedschip for at vælge
- **Multi choice** — Klik på flere mulighedschips; du kan også skrive et brugerdefineret svar og trykke Enter

Hvert spørgsmål kan inkludere kontekst, der forklarer, hvorfor AI'en spørger ("Impact"-note). Besvar alle spørgsmål og klik på **Submit** for at fortsætte til Fase 2.

### Trin 3: Technical Fit (Fase 2)

AI'en genererer tekniske deep-dive-spørgsmål baseret på dine Fase 1-svar. Disse kan inkludere NFR-kategorier (ikke-funktionelle krav) såsom ydeevne, sikkerhed eller skalerbarhed. Besvar alle spørgsmål og klik på **Analyse Capabilities** for at generere løsningsforslag.

### Trin 4: Løsning (Fase 3)

Dette trin har tre underfaser:

#### 3a: Løsningsforslag

AI'en genererer flere løsningsforslag, hver præsenteret som et kort med:

| Element | Beskrivelse |
|---------|-------------|
| **Approach** | Buy, Build, Extend eller Reuse — farvekodet chip |
| **Summary** | Kort beskrivelse af tilgangen |
| **Pros & Cons** | Nøgle-fordele og -ulemper |
| **Estimates** | Estimeret omkostning, varighed og kompleksitet |
| **Impact Preview** | Nye komponenter, ændrede komponenter, pensionerede komponenter og nye integrationer, som denne mulighed ville introducere |

Klik på **Select** på den mulighed, du vil forfølge. Hvis du vender tilbage til dette trin efter at have valgt en mulighed, fremhæves den tidligere valgte mulighed visuelt med en kant og et "Selected"-badge, så du let kan identificere dit nuværende valg.

#### 3b: Gap Analysis

Efter at have valgt en mulighed identificerer AI'en kompetence-huller i dit nuværende landskab. Hvert hul viser:

- **Kompetence-navn** med uopsætteligheds-niveau (critical/high/medium)
- **Impact-beskrivelse**, der forklarer, hvorfor dette hul betyder noget
- **Markedsanbefalinger** — Rangerede produktanbefalinger (gold #1, silver #2, bronze #3) med leverandør, begrundelse, fordele/ulemper, estimeret omkostning og integrations­indsats

Vælg de produkter, du vil inkludere, ved at klikke på anbefalings-kortene (afkrydsningsfelter vises). Klik på **Analyse Dependencies** for at fortsætte.

#### 3c: Afhængighedsanalyse

Efter at have valgt produkter identificerer AI'en yderligere infrastruktur-, platform- eller middleware-afhængigheder, som dine valg kræver. Hver afhængighed viser:

- **Need** med uopsætteligheds-niveau
- **Reason**, der forklarer, hvorfor denne afhængighed er påkrævet
- **Options** — Alternative produkter til at opfylde afhængigheden, med samme detalje som hul-anbefalinger

Vælg afhængigheder og klik på **Generate Capability Map** for at producere den endelige målarkitektur.

### Trin 5: Målarkitektur

Det sidste trin genererer en omfattende kompetence-kortlægning:

| Sektion | Beskrivelse |
|---------|-------------|
| **Summary** | Højniveau-fortælling om den foreslåede arkitektur |
| **Capabilities** | Liste over matchede Business Capabilities — eksisterende (grøn) og nyligt foreslåede (blå) |
| **Proposed Cards** | Nye kort der skal oprettes i dit landskab, vist med deres korttype-ikoner og undertyper |
| **Proposed Relations** | Forbindelser mellem foreslåede kort og eksisterende landskabs­elementer |
| **Dependency Diagram** | Interaktiv [Lagdelt afhængighedsvisning](reports.md#layered-dependency-view), der viser eksisterende noder sammen med foreslåede noder (stiplede kanter med grønt "NEW"-badge). Panorer, zoom og udforsk arkitekturen visuelt |

Fra dette trin kan du klikke på **Choose Different** for at gå tilbage og vælge en anden løsningsmulighed, eller **Start Over** for at starte en helt ny vurdering.

!!! warning "AI-assisteret vurdering"
    Denne vurdering udnytter AI til at generere anbefalinger, løsningsforslag og en målarkitektur. Den skal udføres af en kvalificeret IT-professionel (Enterprise Architect, Solution Architect, IT Leader) i samarbejde med forretnings­interessenter. Det genererede output kræver professionel bedømmelse og kan indeholde unøjagtigheder. Brug resultaterne som et udgangspunkt for yderligere diskussion og forfining.

### Gem og genoptag

Efter at have gennemgået målarkitekturen kan du gemme eller committe dit arbejde:

**Save Assessment** — Bevarer et fuldt øjebliksbillede af vurderingen (alle svar, valgte muligheder, mangelanalyse, afhængigheder og målarkitektur) i databasen. Gemte vurderinger vises i **Assessments**-fanen.

**Genoptag en gemt vurdering** — Ikke-committede vurderinger kan genåbnes i den interaktive wizard med fuld tilstand gendannet:

- Fra **Assessments**-fanen, klik på **Resume**-knappen på en hvilken som helst gemt vurderings-række
- Fra den skrivebeskyttede **Assessment Viewer**, klik på **Resume** i sidehovedet
- Wizardet gendannes til den eksakte fase og tilstand, hvor du forlod, inklusive alle AI-genererede spørgsmål, dine svar, valgte muligheder og produktvalg
- Du kan fortsætte fra hvor du stoppede, vælge en anden tilgang eller committe for at oprette et initiativ
- At gemme igen opdaterer den eksisterende vurdering (i stedet for at oprette en ny)

!!! tip "Fuldt øjebliksbillede"
    En gemt vurdering er et komplet øjebliksbillede af din wizard-session. Så længe den ikke er blevet committet til et initiativ, kan du genoptage den, vælge en anden løsningstilgang og gemme igen så mange gange som nødvendigt.

**Commit & Create Initiative** — Konverterer arkitekturforslaget til rigtige kort i dit landskab:

- **Initiative-navn** er som standard den valgte løsningsmuligheds titel (redigerbar før oprettelse)
- **Start-/slutdatoer** for initiativets tidslinje
- **Proposed New Cards** med skifte-kontakter til at inkludere eller ekskludere individuelle kort, og redigerings-ikoner til at omdøbe kort før oprettelse. Denne liste inkluderer nye Business Capabilities identificeret under vurderingen.
- **Proposed Relations** med skifte-kontakter til at inkludere eller ekskludere
- En fremgangsindikator viser oprettelses­status (initiative → kort → relationer → ADR)
- Ved succes åbner et link det nye Initiative-kort

### Arkitektur-rækværk

Systemet håndhæver automatisk arkitektonisk integritet:

- Hver ny Application linkes til mindst én Business Capability
- Hver ny Business Capability linkes til de valgte Business Objectives
- Kort uden relationer (forældreløse) fjernes automatisk fra forslaget

### Architecture Decision Record

En kladde-ADR oprettes automatisk sammen med initiativet med:

- **Context** fra kompetence-kortlægnings-resuméet
- **Decision**, der fanger den valgte tilgang og produkter
- **Alternatives considered** fra ikke-valgte løsningsforslag

### Skift tilgang

Klik på **Choose Different** for at vende tilbage til løsningsforslagene og vælge en anden tilgang. Alle dine Fase 1- og Fase 2-svar bevares — kun downstream-dataene (mangelanalyse, afhængigheder, målarkitektur) nulstilles. Efter at have valgt en ny mulighed fortsætter wizardet gennem mangelanalyse og afhængighedsanalyse igen. Du kan gemme den opdaterede vurdering eller committe, når du er klar.

## Compliance-scanninger

Compliance-scanneren er en TurboLens-analyse, der producerer compliance-fund mod de aktiverede reguleringer. Fundene, livscyklus, manuel-forfatter-stien, promote-to-Risk-flowet og masse-handlinger er alle dokumenteret i den dedikerede [**Compliance-guide**](compliance.md) — kun selve scan-trigger-knappen lever bag TurboLens-flaget.

Compliance-fund kan også **forfattes manuelt** uden en AI-udbyder konfigureret, så Compliance-fanen virker i deployments, der ikke har en LLM opsat.

## Analyse-historik

Alle analyse-kørsler spores i **TurboLens > History** og viser:

- Analyse-type (vendor analysis, vendor resolution, duplicate detection, modernization, architect, compliance)
- Status (kører, fuldført, fejlede)
- Start- og fuldførelses-tidsstempler
- Fejlmeddelelser (hvis nogen)

## Tilladelser

| Tilladelse | Beskrivelse |
|------------|-------------|
| `turbolens.view` | Se analyse-resultater (givet til admin, bpm_admin, member) |
| `turbolens.manage` | Udløs analyser (givet til admin) |
| `compliance.view` | Se compliance-fund (givet til admin, bpm_admin, member, viewer) |
| `compliance.manage` | Udløs compliance-scanninger og opdater fund-status (givet til admin) |
