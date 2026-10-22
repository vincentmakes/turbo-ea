# Tilpas metamodellen — let

Turbo EA's metamodel er fuldt **admin-konfigurerbar** — hver korttype, hvert felt, hver undertype, relation og interessentrolle er data, ikke kode. Du vil blive fristet til at redesigne den. **Lad være.**

De hold, der lykkes, tilpasser metamodellen **kun, når standardfelterne ikke kan besvare deres spørgsmål**. De hold, der fejler, bruger deres første måned på at omdøbe `Application` til `Solution`, tilføje 30 brugerdefinerede felter og kommer aldrig frem til en fungerende rapport.

## Hvad der allerede er i metamodellen

Inden du tilføjer noget, så vid, hvad du allerede har. Den indbyggede **Application**-korttype leveres med disse felter ud af boksen (blandt andre):

| Indbygget felt | Type | Hvad det er til |
|----------------|------|--------------|
| `businessCriticality` | `single_select` (påkrævet) | Missionskritisk / Forretningskritisk / Forretningsoperationel / Administrativ |
| `functionalSuitability` | `single_select` | Perfekt / Passende / Utilstrækkelig / Urimelig |
| `technicalSuitability` | `single_select` | Helt passende / Tilstrækkelig / Urimelig / Upassende |
| `timeModel` | `single_select` (påkrævet) | **Tolerér / Invester / Migrér / Eliminér** — den kanoniske Gartner-TIME-disposition |
| `costTotalAnnual` | `cost` | Samlet årlig omkostning |
| `lifecycle.*` | datoer | Plan / Faseind / Aktiv / Faseud / Udløb |

Alt, hvad en rationalisering af applikationsportefølje har brug for, er allerede der, inklusive **TIME-model**. Du behøver ikke at tilføje et TIME-felt — du udleder det med en beregning (nedenfor) eller udfylder det manuelt, se [Din første analyse](your-first-analysis.md). Det samme gælder for `functionalSuitability` og `technicalSuitability`, de to egnethedsdimensioner, der klassisk driver en TIME-placering, og for `businessCriticality`, som grupperer rapporten Applikationsportefølje.

## To-spørgsmåls-testen før du tilføjer et felt

Når du finder ud af, at du faktisk har brug for et felt, der ikke er i metamodellen, så spørg dig selv:

1. **Vil jeg filtrere, gruppere eller rapportere på dette felt?** Hvis nej, hører det hjemme i beskrivelsen eller et tag — ikke et felt.
2. **Er det samme svar nødvendigt på hvert kort af denne type?** Hvis nej, er det en relation eller en vedhæftet fil, ikke et felt.

Hvis du ikke kan svare "ja" til begge, så tilføj ikke feltet.

## Hvis du virkelig har brug for et brugerdefineret felt

I det sjældne tilfælde, hvor et reelt nyt felt er nødvendigt (f.eks. et `cloudReadiness`-flag, en regulatorisk klassifikation, en kundesegmentmarkør), er arbejdsgangen:

1. Gå til **Admin → Metamodel**, og klik på typen. Kortlayoutet findes på fanen **Generelt**.
2. Vælg sektionen (eller opret en med **Tilføj afsnit**), og klik på **+ Felt**.
3. Udfyld:
    - **Nøgle** i lower camel-case (f.eks. `cloudReadiness`) — bliver attributnøglen i JSON og i formler.
    - **Etiket** (og en oversættelse for hvert sprog, du understøtter — ikke-engelske brugere vil ellers se den rå nøgle).
    - **Type** — `text`, `multiline_text`, `number`, `cost`, `percentage`, `boolean`, `date`, `url`, `single_select`, `multiple_select`.
    - **Påkrævet** — lad det stå **fra** for den første udrulning; så længe et påkrævet felt er tomt, er kortets datakvalitetsscore låst til 0.
4. For select-typer, tilføj indstillingerne (nøgle + etiket + farve) og oversæt hver mulighed.
5. Gem.
6. Valgfrit: angiv, hvor meget feltet tæller i datakvaliteten, på typens fane **Datakvalitet**.

Feltet er straks tilgængeligt i **Lager** (kolonner, filtre), på kortdetaljen og i **beregnings**-formler som `<fieldKey>`. Fuld reference: [Admin → Metamodel](../admin/metamodel.md).

## Mulighed: udled et felt automatisk med en beregning { #option-derive-a-field-automatically-with-a-calculation }

Ud over standardmuligheden for at lade brugerne udfylde et felt manuelt, kan Turbo EA **beregne en feltværdi automatisk** ud fra andre felter på samme kort — inklusive de indbyggede — ved hjælp af **beregninger**-funktionen. Det beregnede felt bliver skrivebeskyttet og bærer et "beregnet"-mærke, så brugerne ikke kan afvige fra reglen.

Det kanoniske eksempel er **TIME-model**-beregningen, der udleder det indbyggede `timeModel`-felt på Application ud fra de to indbyggede egnethedsvurderinger. Opret den i **Admin → Metamodel → Beregninger** med **Ny beregning**: Målkorttype = `Application`, Målfelt = **TIME-model**, og denne formel:

```
# TIME Model from the built-in Functional and Technical Suitability (Gartner quadrants)
ff = MAP_SCORE(data.functionalSuitability, {"perfect": 4, "appropriate": 3, "insufficient": 2, "unreasonable": 1})
tf = MAP_SCORE(data.technicalSuitability, {"fullyAppropriate": 4, "adequate": 3, "unreasonable": 2, "inappropriate": 1})
IF(ff is None or tf is None, None, IF(ff >= 2.5, IF(tf >= 2.5, "invest", "migrate"), IF(tf >= 2.5, "tolerate", "eliminate")))
```

Hver vurdering omsættes til en score fra 4 (bedst) til 1 (dårligst), og de to scorer placerer applikationen i en af de fire kvadranter: høj funktionel + høj teknisk = **Invester**, høj funktionel + lav teknisk = **Migrér**, lav funktionel + høj teknisk = **Tolerér**, lav på begge = **Eliminér**. En applikation, der mangler en af vurderingerne, får ingen TIME-værdi, så hullerne forbliver synlige.

Det er det samme TIME-eksempel, som du finder i panelet **Formelreference** i beregningseditoren, så du kan også kopiere det derfra. Den læser kun felter, Application allerede har, så **du behøver ikke at tilføje noget felt** — og det bør du heller ikke (se *Dupliker ikke indbyggede felter* nedenfor). Mere formelsyntaks: [Admin → Beregninger](../admin/calculations.md).

Når du har gemt, så slå beregningen til (**Aktiv**), og klik på **Genberegn alle** på dens række, så hver eksisterende applikation får sin værdi. Trin-for-trin-gennemgangen findes i [Din første analyse → Trin 3](your-first-analysis.md).

!!! warning "Lad være"
    En beregnet TIME er en **starthypotese**, ikke en dom. Gennemgå hvert resultat med applikationsejeren, før du stoler på det.

Det hybridmønster, der fungerer godt i praksis: behold beregningen aktiv, mens du opbygger lageret og indsamler egnethedsvurderinger; gennemgå resultaterne i valideringsworkshoppen; og hvis beslutningerne skal afvige fra formlen, så slå beregningen fra (kontakten **Aktiv**), så feltet bliver redigerbart igen, og de manuelle beslutninger holder.

## Alternativ: brug en taggruppe i stedet

Hvis værdien er informativ snarere end forespørgbar, er en **taggruppe** (Admin → Metamodel → Tags) lettere end et brugerdefineret felt — ingen metamodelændring, ingen migration, lettere at udvikle. Brug en taggruppe, når:

- Værdien er beskrivende ("Kundevendt", "Kun internt", "Erhvervet i 2024").
- Du kan tilføje nye muligheder ofte.
- Du har ikke brug for det i en filter-dropdown, men en search-as-you-type-tagchip er fin.

Brug et brugerdefineret felt, når:

- Du vil gruppere eller farvelægge en rapport efter den (for eksempel Applikationsportefølje).
- Du vil have det vægtet ind i datakvaliteten.
- Det er et kontrolleret vokabular, der ikke ændres ofte.

## Antimønstre at undgå

Dette er de mest almindelige metamodelfejl i første udrulninger:

!!! warning "Omdøb ikke indbyggede korttyper"
    At omdøbe `Application` til `Solution` ser ryddeligt ud, men bryder den konceptuelle mapping, som kompetencekortet, rapporten Applikationsportefølje og kataloger alle antager. Hvis din organisation kalder dem "Solutions", så sæt **etiket**-oversættelsen — den underliggende `key` forbliver som `Application`.

!!! warning "Tilføj ikke 30 brugerdefinerede felter på dag ét"
    Hvert brugerdefineret felt tilføjer friktion til dataindsamling og udvander datakvalitetsscoren. Tilføj ét felt, brug det i en måned, tilføj derefter det næste.

!!! warning "Dupliker ikke indbyggede felter"
    Inden du tilføjer `timeDisposition`, `funcFit`, `techFit` eller `appCriticality`, så tjek den eksisterende feltliste — chancerne er, at et tilsvarende indbygget felt allerede findes (`timeModel`, `functionalSuitability`, `technicalSuitability`, `businessCriticality`). Dubletter splitter dine data og bryder rapporter.

!!! warning "Gør ikke nye felter `required` på dag ét"
    Så længe et påkrævet felt er tomt, er kortets datakvalitetsscore låst til 0, og et advarselsbanner viser, hvad der mangler — på alle eksisterende kort på én gang. Gør kun et felt påkrævet **efter**, du har udfyldt det for 80 %+ af populationen.

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
