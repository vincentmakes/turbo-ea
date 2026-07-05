# Lager

**Lageret** er hjertet i Turbo EA. Her listes alle **kort** (komponenter) i virksomheds­arkitekturen: applikationer, processer, forretningskompetencer, organisationer, leverandører, grænseflader og mere.

![Lager-visning med filterpanel](../assets/img/en/23_inventory_filters.png)

## Lager-skærmens struktur

### Venstre filterpanel

Det venstre sidepanel lader dig **filtrere** kort efter forskellige kriterier:

- **Søg** — Friform tekstsøgning på tværs af kortnavne
- **Typer** — Filtrer efter en eller flere korttyper: Objective, Platform, Initiative, Organization, Business Capability, Business Context, Business Process, Application, Interface, Data Object, IT Component, Tech Category, Provider, System
- **Undertyper** — Når en type er valgt, kan du filtrere yderligere efter undertype (f.eks. Application → Business Application, Microservice, AI Agent, Deployment)
- **Godkendelsesstatus** — Draft, Approved, Broken eller Rejected
- **Livscyklus** — Filtrer efter livscyklus-fase: Plan, Phase In, Active, Phase Out, End of Life
- **Datakvalitet** — Tærskel-baseret filtrering: Good (80%+), Medium (50–79%), Poor (under 50%)
- **Tags** — Filtrer efter tags fra en hvilken som helst tag-gruppe
- **Relationer** — Filtrer efter relaterede kort på tværs af relations­typer
- **Brugerdefinerede attributter** — Filtrer efter værdier i brugerdefinerede felter (tekstsøgning, select-muligheder)
- **Vis kun arkiverede** — Skift for at se arkiverede (soft-deleted) kort
- **Ryd alle** — Nulstil alle aktive filtre på én gang

> **Find kort uden værdi.** Filtrene Undertype, Livscyklus, Tags, Relationer og brugerdefinerede valg-attributter har hver en **(tom)**-mulighed. Vælg den for kun at vise de kort, der *ikke* har en værdi for det felt — for eksempel alle kort uden en angivet livscyklus. Den kan kombineres med normale værdier (matcher en af dem) og på tværs af flere filtre (matcher alle).

Et **aktivt-filter-tæller**-badge viser, hvor mange filtre der aktuelt er anvendt.

### Kolonner-fane

**Kolonner**-fanen i sidepanelet lader dig vælge, hvilke yderligere kolonner der skal vises i gitteret. Tilgængelige kolonner ændres dynamisk baseret på de valgte korttyper:

- **Enkelt type valgt** — Alle egenskabsfelter defineret for den type er tilgængelige, plus relations­kolonner og metadata-kolonner
- **Flere typer valgt** — Kun felter, der er **fælles på tværs af alle valgte typer**, er tilgængelige
- **Ingen type valgt** — En antydningsbesked beder dig vælge en korttype først

Kolonner er grupperet i fire kategorier:

| Kategori | Beskrivelse |
|----------|-------------|
| **Standardkolonner** | Altid-aktive kolonner: Type, Name, Path, Description, Subtype, Lifecycle, Approval Status, Data Quality. Afmarker en hvilken som helst af disse for at skjule dem fra gitteret — nyttigt ved stramning af en gemt visning til bare de kolonner, du faktisk bruger. |
| **Metadata** | Created, Modified, Created by, Modified by |
| **Attributes** | Brugerdefinerede felter defineret i metamodellen (text, number, cost, date, select, osv.) |
| **Relationer** | Relaterede korttyper (f.eks. applikationer linket til en Business Capability) |

Kolonnen **Path** viser kortets hierarki-brødkrumme (f.eks. `North America / Sales / Inside Sales`) uden at inkludere kortets eget navn, så du kan beholde både Name og Path på skærmen samtidig.

Hver kategori har et **Vælg alle**-afkrydsningsfelt til hurtigt at skifte alle kolonner i den gruppe. Et søgefelt øverst lader dig finde specifikke kolonner efter navn. Badget på hver sektionsoverskrift viser, hvor mange kolonner fra den gruppe der aktuelt er synlige.

Når en korttype vælges første gang, er **alle egenskabs- og relations­kolonner aktiveret som standard**. Du kan derefter afmarkere kolonner, du ikke har brug for. En **Nulstil**-knap nederst på Kolonner-fanen gendanner standard-kolonnevalget.

En **ændrings-indikator-prik** vises på Kolonner-fanens overskrift, når kolonnevalget afviger fra standarderne. Den samme indikator vises på **Filtre**-fanen, når filtre er aktive, hvilket gør det let med et øjekast at se, hvilke indstillinger der er ændret.

Dit kolonnevalg, **kolonnelayout** (rækkefølge fra venstre til højre, bredder og fastgjorte kolonner), aktive filtre og sorteringsrækkefølge **gemmes automatisk** i din browser. Når du vender tilbage til lager-siden, gendannes din tidligere konfiguration. Gemte visninger (bogmærker) bevarer også dette fulde layout, så når du skifter mellem visninger, gendannes præcis de kolonner, du havde konfigureret — og i samme arrangement, hvilket er vigtigt, når du deler en organiseret visning med interessenter.

### Hovedtabel

Lageret bruger en **AG Grid**-datatabel med kraftfulde funktioner:

| Kolonne | Beskrivelse |
|---------|-------------|
| **Type** | Korttype med farvekodet ikon |
| **Name** | Komponent-navn (klik for at åbne kortdetalje). Hver navne-celle har et 👁 øje-ikon — klik på det for at åbne kortdetaljen i et sidepanel uden at forlade gitteret. Ctrl/Cmd-klik på navnet for at åbne kortet i en ny browser-fane. |
| **Path** | Hierarki-brødkrumme op til kortets forælder — tom for rod-kort |
| **Description** | Kort beskrivelse |
| **Lifecycle** | Aktuel livscyklus-tilstand |
| **Approval Status** | Gennemgangs-status-badge |
| **Data Quality** | Fuldstændigheds-procent med visuel ring |
| **Relations** | Relations-tællere med klikbar popover, der viser relaterede kort |

**Tabel-funktioner:**

- **Sortering** — Klik på en kolonneoverskrift for at sortere stigende/faldende
- **Inline-redigering** — I gitter-redigeringstilstand redigeres feltværdier direkte i tabellen
- **Multi-valg** — Vælg flere rækker til masse­operationer
- **Hurtig forhåndsvisning** — Brug øje-ikonet ved siden af et navn for at åbne kortdetaljen i et sidepanel
- **Åbn i ny fane** — Ctrl/Cmd-klik på et navn for at åbne kortet i en ny browser-fane; hoved-nav-links understøtter dette også
- **Kolonne-konfiguration** — Vis, skjul og omarrangér kolonner (inklusive de altid-aktive standardkolonner)

### Værktøjslinje

- **Grid Edit** — Skift inline-redigerings-tilstand for at redigere flere kort i tabellen
- **Export** — Download data som en Excel (.xlsx)-fil
- **Import** — Bulk-upload data fra Excel-filer
- **+ Create** — Opret et nyt kort

![Opret kort-dialog](../assets/img/en/22_create_card.png)

## Sådan opretter du et nyt kort

1. Klik på knappen **+ Create** (blå, øverste højre hjørne)
2. I dialogen, der vises:
   - Vælg **Type** af kort (Application, Process, Objective, osv.)
   - Indtast **Name** på komponenten
   - Tilføj eventuelt en **Description**
3. Klik eventuelt på **Suggest with AI** for at generere en beskrivelse automatisk (se [AI-beskrivelsesforslag](#ai-description-suggestions) nedenfor)
4. Klik på **CREATE**

## AI-beskrivelsesforslag { #ai-description-suggestions }

Turbo EA kan bruge **AI til at generere en beskrivelse** for ethvert kort. Dette virker på både Opret kort-dialogen og eksisterende kortdetaljesider.

**Sådan virker det:**

1. Indtast et kortnavn og vælg en type
2. Klik på **stjerne-ikonet** i kortets sidehoved eller knappen **Suggest with AI** i Opret kort-dialogen
3. Systemet udfører en **websøgning** efter element-navnet (ved hjælp af type-bevidst kontekst — f.eks. "SAP S/4HANA software application"), og sender derefter resultaterne til en **LLM** for at generere en kortfattet, faktuel beskrivelse
4. Et forslagspanel vises med:
   - **Redigerbar beskrivelse** — gennemgå og rediger teksten før anvendelse
   - **Konfidens-score** — angiver, hvor sikker AI'en er (High / Medium / Low)
   - **Klikbare kilde-links** — websiderne, beskrivelsen blev udledt fra
   - **Model-navn** — hvilken LLM der genererede forslaget
5. Klik på **Apply description** for at gemme, eller **Dismiss** for at kassere

**Nøglekarakteristika:**

- **Type-bevidst**: AI'en forstår korttype-konteksten. En "Application"-søgning tilføjer "software application", en "Provider"-søgning tilføjer "technology vendor" osv.
- **Privacy-first**: Når du bruger Ollama, kører LLM'en lokalt — dine data forlader aldrig din infrastruktur. Kommercielle udbydere (OpenAI, Google Gemini, Anthropic Claude osv.) understøttes også
- **Admin-styret**: AI-forslag skal aktiveres af en administrator i [Indstillinger > AI-forslag](../admin/ai.md). Administratorer vælger, hvilke korttyper der viser forslags-knappen, konfigurerer LLM-udbyderen og vælger websøgnings-udbyderen
- **Tilladelsesbaseret**: Kun brugere med tilladelsen `ai.suggest` kan bruge denne funktion (aktiveret som standard for Admin-, BPM Admin- og Member-roller)

## Gemte visninger (bogmærker)

Du kan gemme din aktuelle filter-, kolonne- og sorteringskonfiguration som en **navngivet visning** til hurtig genbrug.

### Oprettelse af en gemt visning

1. Konfigurer lageret med dine ønskede filtre, kolonner og sortering
2. Klik på **bogmærke**-ikonet i filterpanelet
3. Indtast et **navn** for visningen
4. Vælg **synlighed**:
   - **Privat** — Kun du kan se den
   - **Delt** — Synlig for specifikke brugere (med valgfri redigerings­tilladelser)
   - **Offentlig** — Synlig for alle brugere

### Brug af gemte visninger

Gemte visninger vises i filterpanelets sidepanel. Klik på en visning for øjeblikkeligt at anvende dens konfiguration. Visninger er organiseret i:

- **My Views** — Visninger du har oprettet
- **Shared with Me** — Visninger andre har delt med dig
- **Public Views** — Visninger tilgængelige for alle

## Excel-import / -eksport { #excel-import }

Lager-eksporter og -importer bruger en **Excel-projektmappe med flere ark**, der rund-tur dit landskab — kort på tværs af et hvilket som helst antal typer plus relationerne mellem dem — uden nogensinde at kræve, at du kopierer en UUID.

### Projektmappe-layout

En enkelt eksport producerer:

- **Ét ark pr. korttype** til stede i eksporten (Application, Business Capability, IT Component, …). Hvert ark bærer typens kerne-kolonner, dets brugerdefinerede `attr_<field_key>`-kolonner, dets livscyklus-kolonner og dets `rel:<relation_type_key>`-relations-kolonner.
- **Et `Relations`-ark** for relations­typer, der bærer egenskaber (f.eks. omkostning, beskrivelse). Simple relationer lever inline på kort-arket; egenskabs-bærende relationer lever her.
- **Et `_Meta`-ark**, der bærer projektmappens format-version. Importøren læser det for at detektere ældre formater og udskrive et banner.

### Identifikation af kort (ingen GUID'er nødvendige)

Kort matches efter **navn**, når det er entydigt inden for deres type, ellers efter deres fulde **`parent_path`**. En relations-celle kan liste `NexaCore ERP` direkte, når kun én Application har det navn; hvis to gør, har cellen brug for `Sales / Customer Mgmt / CRM` (samme sti-format, som `parent_path`-kolonnen bruger på kort-arkene, med `\` og `/` escapes for navne, der indeholder disse tegn).

Det samme prioritetsforhold styrer kort-opdaterings-matchning: rækker med en UUID i `id`-kolonnen opdaterer det kort; rækker uden et `id` matches efter `(type, parent_path, name)`; rækker, der ikke matcher noget, bliver til nye kort.

#### Søskende-navne-entydighed

Fordi kort identificeres efter navn + sti, **kan to kort af samme type ikke dele både en forælder og et navn**. Nye kort, der ville skabe en sådan kollision, afvises ved oprettelses­tidspunktet (i Opret kort-dialogen, i inline-omdøbningen og under regneark-import). Kort, der allerede er i databasen, og som deler et navn med en søskende — fra tidligere seed-data eller importer — efterlades urørt; du kan redigere et hvilket som helst af deres felter, men at omdøbe ét tilbage til kollisionen (eller oprette et tredje) blokeres. Kontrollen er case- og whitespace-uafhængig for at matche importørens resolver.

### Inline relations-celler

På hvert kort-ark lader `rel:<relation_type_key>`-kolonner dig udtrykke udgående relationer som **semikolon-separerede** mål-referencer:

```text
rel:supports     →  NexaCore ERP; BillingApp; Salesforce
rel:depends_on   →  Sales / Customer Mgmt / CRM
```

Semikoloner (ikke kommaer) separerer mål, fordi kortnavne almindeligvis indeholder `,` (f.eks. `Acme, Inc.`). Inde i et navn skal `/` og `\` undgås som `\/` og `\\` — importøren læser cellen med de samme regler som `parent_path`, så et navn som `SAP S/4HANA` skrives som `SAP S\/4HANA`. Eksportøren gør dette automatisk for dig; kun hånd-skrevne celler har brug for escapes.

Celler er **deklarative**: sættet af mål i cellen bliver det komplette sæt af udgående relationer af den type fra den kilde efter import. **At fjerne et mål fra listen dropper den relation**; at tømme cellen dropper dem alle. At udelade kolonnen helt (ingen `rel:supports`-kolonne overhovedet) efterlader eksisterende relationer urørt.

For bagudkompatibilitet accepterer importøren også komma-separerede celler (projektmapper eksporteret før denne konvention). En celle, der indeholder et `;`, behandles altid som semikolon-separeret.

### Relations-ark

For relationer, der bærer egenskaber (f.eks. årlig omkostning på en `Application` → `IT Component`-link), brug det dedikerede `Relations`-ark:

| relation_type | source_ref | target_ref | action | attr_costTotalAnnual | description |
|---------------|------------|------------|--------|----------------------|-------------|
| app_to_itc    | NexaCore ERP | Oracle Database | upsert | 25000 | Production tier |
| app_to_itc    | OldApp | DB | delete |  |  |

`action` er som standard `upsert`. En række med `action = delete` fjerner den specifikke relation.

### Import

Klik på **Import** i værktøjslinjen, slip projektmappen, og gennemgå forhåndsvisningen før anvendelse. Forhåndsvisningen viser:

- **Kort der skal oprettes / opdateres** — samme som før
- **Relationer der skal tilføjes / fjernes** — hver relations-operation kø-stillet af projektmappen
- **Fejl og advarsler** — inklusive tvetydige relations-mål (med kandidat-stier, så du kan disambiguere)

Fejl blokerer anvendelsen. Advarsler (f.eks. ukendt tag, format-version-mismatch) gør det ikke.

### Eksport

Klik på **Export** i værktøjslinjen. Det aktuelle gitter-filter bestemmer indholdet:

- **Single-type-filter aktivt** → ét kort-ark for den type, plus Relations-arket for eventuelle egenskabs-bærende relationer, plus `_Meta`.
- **Intet filter eller multi-type-filter** → ét ark pr. type til stede, plus Relations-arket, plus `_Meta`. Projektmappen er fuldt redigerbar og kan re-importeres uden at miste pr.-type-egenskaber.

Du kan også vælge **Eksportér aktuel visning** i Export-menuen — et fladt enkelt-ark-øjebliksbillede, der afspejler det viste (kun de synlige kolonner, i deres aktuelle rækkefølge, for de filtrerede rækker). Det er beregnet til deling og er **ikke egnet til genimport**.

### Round-trip-tips

- Rediger projektmappen i Excel, gem som `.xlsx`, re-importer. Kort lander via `(type, parent_path, name)`-matchning, selv hvis du ikke beholdt `id`-kolonnen.
- At omdøbe et kort bryder den navn-baserede match. Hold `id`-kolonnen udfyldt, når du planlægger at omdøbe og re-importere i den samme projektmappe.
- Nye kort, der refererer til hinanden (forælder-barn eller relation source-target), virker i begge rækkefølger — serveren topologisk-sorterer før anvendelse.
