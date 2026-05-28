# Tilpas metamodellen — let

Turbo EA's metamodel er fuldt **admin-konfigurerbar** — hver korttype, hvert felt, hver undertype, relation og interessentrolle er data, ikke kode. Du vil blive fristet til at redesigne den. **Lad være.**

De hold, der lykkes, tilpasser metamodellen **kun, når standardfelterne ikke kan besvare deres spørgsmål**. De hold, der fejler, bruger deres første måned på at omdøbe `Application` til `Solution`, tilføje 30 brugerdefinerede felter og kommer aldrig frem til en fungerende rapport.

## Hvad der allerede er i metamodellen

Inden du tilføjer noget, så vid, hvad du allerede har. Den indbyggede **Application**-korttype leveres med disse felter ud af boksen (blandt andre):

| Indbygget felt | Type | Hvad det er til |
|----------------|------|--------------|
| `businessCriticality` | `single_select` | Mission-kritisk / Vigtig / Nyttig / Marginal |
| `functionalSuitability` | `single_select` | Perfekt / Passende / Utilstrækkelig / Urimelig |
| `technicalSuitability` | `single_select` | Fuldt passende / Tilstrækkelig / Urimelig / Upassende |
| `timeModel` | `single_select` (påkrævet) | **Tolerere / Investere / Migrere / Eliminere** — den kanoniske Gartner-TIME-disposition |
| `riskLevel` | `single_select` | Lav / Medium / Høj / Kritisk |
| `businessValue` | `single_select` | Driver porteføljerapportens Y-akse |
| `costTotalAnnual` | `cost` | Total årlig omkostning |
| `lifecycle.*` | datoer | Plan / Faseind / Aktiv / Faseud / Udløb |

Alt, hvad en rationalisering af applikationsportefølje har brug for, er allerede der, inklusive **TIME-model**. Du behøver ikke at tilføje et TIME-felt — du udfylder det (manuelt eller via en beregning, se [Din første analyse](your-first-analysis.md)). Det samme gælder for `functionalSuitability` og `technicalSuitability`, de to egnethedsdimensioner, der klassisk driver en TIME-placering.

## To-spørgsmåls-testen før du tilføjer et felt

Når du finder ud af, at du faktisk har brug for et felt, der ikke er i metamodellen, så spørg dig selv:

1. **Vil jeg filtrere, gruppere eller rapportere på dette felt?** Hvis nej, hører det hjemme i beskrivelsen eller et tag — ikke et felt.
2. **Er det samme svar nødvendigt på hvert kort af denne type?** Hvis nej, er det en relation eller en vedhæftet fil, ikke et felt.

Hvis du ikke kan svare "ja" til begge, så tilføj ikke feltet.

## Hvis du virkelig har brug for et brugerdefineret felt

I det sjældne tilfælde, hvor et reelt nyt felt er nødvendigt (f.eks. et `cloudReadiness`-flag, en regulatorisk klassifikation, en kundesegmentmarkør), er arbejdsgangen:

1. Gå til **Admin → Metamodel**, klik på typen, skift til fanen **Felter**.
2. Vælg sektionen (eller opret en ny), og klik på **+ Tilføj felt**.
3. Udfyld:
    - **Nøgle** i lower camel-case (f.eks. `cloudReadiness`) — bliver attributnøglen i JSON og i formler.
    - **Etiket** (og en oversættelse for hvert sprog, du understøtter — ikke-engelske brugere vil ellers se den rå nøgle).
    - **Type** — `text`, `number`, `cost`, `boolean`, `date`, `url`, `single_select`, `multiple_select`.
    - **Vægt** — `0` for at udelukke fra datakvalitet, `1`+ for at inkludere og vægte det.
    - **Påkrævet** — lad det stå **fra** for den første udrulning; påkrævet blokerer godkendelse af alle eksisterende kort.
4. For select-typer, tilføj indstillingerne (nøgle + etiket + farve) og oversæt hver mulighed.
5. Gem.

Feltet er straks tilgængeligt i **Lager** (kolonner, filtre), på kortdetaljen og i **beregnings**-formler som `<fieldKey>`. Fuld reference: [Admin → Metamodel](../admin/metamodel.md).

## Mulighed: udled et felt automatisk med en beregning { #option-derive-a-field-automatically-with-a-calculation }

Ud over standardmuligheden for at lade brugerne udfylde et felt manuelt, kan Turbo EA **beregne en feltværdi automatisk** ud fra andre felter på samme kort — inklusive de indbyggede — ved hjælp af **beregninger**-funktionen. Det beregnede felt bliver skrivebeskyttet og bærer et "calculated"-mærke, så brugerne ikke kan afvige fra reglen.

Det kanoniske eksempel er **TIME-model**-beregningen, der udleder det indbyggede `timeModel`-felt på Application ud fra en forretningsegnetheds- og en teknisk egnetheds-dimension. Det leveres som en af posterne i panelet **Formelreference** inde i **Admin → Metamodel → Beregninger**, når du opretter en ny beregning, så du kan vælge det direkte fra panelet. Måltype = `Application`, målfelt = `timeModel`; den panel-leverede formel er gengivet i [Admin → Beregninger → Eksempler på formler](../admin/calculations.md#example-formulas).

Formlen antager to `single_select`-felter ved navn `businessFit` og `technicalFit` med indstillingerne `excellent` / `adequate` / `insufficient` / `unreasonable`. De er ikke i den indbyggede metamodel — tilføj dem på Application via trinene for brugerdefinerede felter ovenfor, hvis du vil bruge denne beregning.

!!! warning "Lad være"
    En beregnet TIME er en **starthypotese**, ikke en dom. Enten gennemgå hvert resultat med applikationsejeren, før du stoler på det, eller slå beregningen fra og stol på manuel indtastning, når valideringsworkshoppen er færdig.

Det hybridmønster, der fungerer godt i praksis: behold beregningen tændt, mens du opbygger lageret, og du primært har egnethedsdata; sluk den til valideringsworkshoppen; lad den derefter være slukket, så manuelle beslutninger holder.

## Alternativ: brug en taggruppe i stedet

Hvis værdien er informativ snarere end forespørgbar, er en **taggruppe** (Admin → Tags) lettere end et brugerdefineret felt — ingen metamodelændring, ingen migration, lettere at udvikle. Brug en taggruppe, når:

- Værdien er beskrivende ("Kundevendt", "Kun internt", "Erhvervet i 2024").
- Du kan tilføje nye muligheder ofte.
- Du har ikke brug for det i en filter-dropdown, men en search-as-you-type-tagchip er fin.

Brug et brugerdefineret felt, når:

- Du har brug for værdien på porteføljerapportens akser (X, Y, farve).
- Du vil have det vægtet ind i datakvaliteten.
- Det er et kontrolleret vokabular, der ikke ændres ofte.

## Antimønstre at undgå

Dette er de mest almindelige metamodelfejl i første udrulninger:

!!! warning "Omdøb ikke indbyggede korttyper"
    At omdøbe `Application` til `Solution` ser ryddeligt ud, men bryder den konceptuelle mapping, som kompetenceheatmap, porteføljerapport og kataloger alle antager. Hvis din organisation kalder dem "Solutions", så sæt **etiket**-oversættelsen — den underliggende `key` forbliver som `Application`.

!!! warning "Tilføj ikke 30 brugerdefinerede felter på dag ét"
    Hvert brugerdefineret felt tilføjer friktion til dataindsamling og udvander datakvalitetsscoren. Tilføj ét felt, brug det i en måned, tilføj derefter det næste.

!!! warning "Dupliker ikke indbyggede felter"
    Inden du tilføjer `timeDisposition`, `funcFit`, `techFit` eller `appBusinessValue`, så tjek den eksisterende feltliste — chancerne er, at et tilsvarende indbygget felt allerede findes (`timeModel`, `functionalSuitability`, `technicalSuitability`, `businessValue`). Dubletter splitter dine data og bryder rapporter.

!!! warning "Gør ikke nye felter `required` på dag ét"
    `Required` blokerer godkendelse for hvert eksisterende kort, der ikke har en værdi. Gør kun et felt påkrævet **efter**, du har udfyldt det for 80 %+ af populationen.

!!! warning "Opret ikke brugerdefinerede korttyper i stedet for brugerdefinerede felter"
    "Mobile App" skal være en undertype af `Application`, ikke en ny korttype. Nye typer får ikke kompetencekortlægning, porteføljerapporter eller katalogimport gratis.

## Andre lette udvidelser, du måske ønsker

Disse er almindelige anden-runde-udvidelser, men **tilføj dem ikke, før du faktisk har brug for dem**:

| Behov | Hvor det skal tilføjes | Type |
|------|-------------|------|
| Cloud-parathed | Application | `single_select` (Klar / Kræver refaktorering / Forbliver on-prem) |
| Kundevendt-flag | Application | `boolean` |
| Regulatorisk klassifikation | Application, DataObject | `multiple_select` (GDPR, PCI-DSS, …) |
| Risiko-for-tab-kategori | Application, IT Component | `single_select` (Single point of failure osv.) |
| Omkostningsopdeling | Application | yderligere `cost`-felter for `costRunTotalAnnual`, `costChangeTotalAnnual` |

Hver af dem består to-spørgsmåls-testen for porteføljeanalyse. Flere af dem er også fine kandidater til en **beregnet** formel i stedet for manuel indtastning — hvilket er det, den næste side dækker, med `timeModel` selv som det gennemarbejdede eksempel.

Næste: [Din første analyse: applikationsharmonisering](your-first-analysis.md).
