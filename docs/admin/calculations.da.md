# Beregninger

Funktionen **Beregninger** (**Admin > Metamodel > Beregninger**-fanebladet) lader dig definere **formler, der automatisk beregner feltværdier**, når kort gemmes. Dette er kraftfuldt til at udlede metrikker, scores og aggregeringer fra dine arkitekturdata.

## Sådan fungerer det

1. En admin definerer en formel rettet mod en specifik korttype og felt
2. Når et hvilket som helst kort af den type oprettes eller opdateres, kører formlen automatisk
3. Resultatet skrives til målfeltet
4. Målfeltet markeres som **skrivebeskyttet** på kortdetaljesiden (brugere ser et "calculated"-badge)

## Oprettelse af en beregning

Klik på **+ Ny beregning** og konfigurer:

| Felt | Beskrivelse |
|-------|-------------|
| **Navn** | Beskrivende navn for beregningen |
| **Måltype** | Den korttype, denne beregning gælder for |
| **Målfelt** | Feltet, hvor resultatet gemmes |
| **Formel** | Udtrykket, der skal evalueres (se syntaks nedenfor) |
| **Udførelsesrækkefølge** | Udførelsesrækkefølge, når flere beregninger eksisterer for samme type (lavere kører først) |
| **Aktiv** | Aktivér eller deaktivér beregningen |

## Formel-syntaks

Formler bruger et sikkert, sandboxet udtrykssprog. Du kan referere til det aktuelle korts felter, relaterede kort og underkort, det overordnede kort samt livscyklusdatoer.

!!! warning "Brug feltets nøgle, ikke feltets etiket"
    Felter refereres via deres **nøgle**, typisk i camelCase (`costTotalAnnual`), ikke via den
    etiket, der vises på kortet (`Samlede årlige omkostninger`). Et navn, der ikke findes,
    opløses til `None`, og enhver regneoperation på `None` fejler med en generisk
    **evalueringsfejl**.

    Du finder nøglen under **Admin > Metamodel >** *(korttype)* ved at åbne feltet og aflæse
    dets **Nøgle**. Nemmere: I formeleditoren viser chipsene under formelfeltet
    `data.<nøgle>` for hvert felt i den valgte type, og når du skriver `data.`, åbner
    autofuldførelsen.

### Kontekstvariabler

| Variabel | Beskrivelse | Eksempel |
|----------|-------------|---------|
| `data.<feltNøgle>` | Ethvert brugerdefineret felt på det aktuelle kort, via dets nøgle | `data.costTotalAnnual` |
| `data.name`, `data.description`, `data.status`, `data.subtype`, `data.approval_status`, `data.reference` | Indbyggede kortegenskaber | `data.subtype` |
| `data.lifecycle.<fase>` | Livscyklusdatoer, hvor fasen er `plan`, `phaseIn`, `active`, `phaseOut` eller `endOfLife` | `data.lifecycle.endOfLife` |
| `relations.<relationstypeNøgle>` | Array af kort forbundet via den relationstype, i begge retninger | `relations.relAppToITC` |
| `relation_count.<relationstypeNøgle>` | Antal kort forbundet via den relationstype | `relation_count.relAppToITC` |
| `children` | Array af direkte underkort (hierarkiske typer) | `SUM(PLUCK(children, "attributes.costTotalAnnual"))` |
| `children_count` | Antal direkte underkort | `children_count` |
| `parent` | Overordnet kort (objekt med `id`, `name`, `type`, `subtype`, `attributes`) eller `None` for et rodkort | `IF(parent, parent.attributes.businessCriticality, data.businessCriticality)` |
| `hierarchy_level` | Dybden af det aktuelle kort i dets forælder-barn-hierarki (`1` = rod, ikke begrænset). `1` for ikke-hierarkiske korttyper | `hierarchy_level * 10` |

Relationstypens nøgle er nøglen fra **Admin > Metamodel > Relationer**, for eksempel
`relAppToITC` eller `relInitiativeToApp`. Retningen betyder ingenting: Et kort finder en
relationstype under den samme nøgle, uanset om det står i kilde- eller målenden. Arkiverede
kort er udeladt af `relations`, `relation_count` og `children`.

### Læsning af felter på et relateret kort

Hvert element i `relations.<relationstypeNøgle>` og i `children` er et indpakningsobjekt, ikke
det relaterede korts felter direkte:

```json
{
  "id": "8f1c…",
  "name": "NexaCore ERP",
  "type": "Application",
  "attributes":     { "costTotalAnnual": 45000, "businessCriticality": "missionCritical" },
  "rel_attributes": { "costTotalAnnual": 12000 }
}
```

* `attributes` indeholder det relaterede korts egne feltværdier.
* `rel_attributes` indeholder værdier, der er gemt **på selve forbindelsen**, hvis
  relationstypen definerer et attributskema. `relAppToITC` bærer for eksempel sit eget
  `costTotalAnnual`, så du kan registrere, hvad én applikation bruger på én IT-komponent.

Det har betydning for `PLUCK` og `FILTER`, som tager en nøglesti og derfor har brug for
præfikset `attributes.` for at nå et felt:

```
# Summér de årlige omkostninger for de IT-komponenter, denne applikation bruger
SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))

# Summér i stedet den omkostning, der er registreret på hver applikation-komponent-forbindelse
SUM(PLUCK(relations.relAppToITC, "rel_attributes.costTotalAnnual"))
```

En bar nøgle som `"costTotalAnnual"` bliver søgt på indpakningsobjektet, findes ikke og giver
en liste af `None`, som `SUM` rapporterer som `0`. En relationsformel, der stædigt returnerer
`0`, mangler næsten altid præfikset `attributes.`.

### Håndtering af tomme værdier

Et felt uden værdi opløses til `None`, og `None` i et regneudtryk udløser en fejl. Pak hvert
felt, der kan være tomt, ind i `COALESCE`:

```
COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0) + COALESCE(data.infraCost, 0)
```

`SUM`, `AVG`, `MIN` og `MAX` springer allerede ikke-numeriske poster over og behøver derfor
ingen beskyttelse.

### PPM-data på Initiative-kort

Roden `ppm` gør PPM-modulets budget- og omkostningslinjer tilgængelige for formler, opdelt i capex og opex og fordelt på regnskabsår — detaljer, som de sammenlagte attributter `data.costBudget` / `data.costActual` på kortet ikke kan give.

| Variabel | Beskrivelse |
|----------|-------------|
| `ppm.capexBudget`, `ppm.opexBudget`, `ppm.totalBudget` | Planlagt budget, fra PPM-budgetlinjerne |
| `ppm.capexPlanned`, `ppm.opexPlanned`, `ppm.totalPlanned` | Planlagte beløb på PPM-omkostningslinjerne |
| `ppm.capexActual`, `ppm.opexActual`, `ppm.totalActual` | Faktiske beløb på PPM-omkostningslinjerne |
| `ppm.byYear` | De samme ni mål pr. regnskabsår, som en liste `{year, capexBudget, …}` |
| `ppm.currentFiscalYear` | Det regnskabsår, dagens dato falder i |
| `ppm.unscheduledPlanned`, `ppm.unscheduledActual` | Omkostningslinjer uden dato: tæller med i totalerne, men hører til intet år |

`byYear` er en liste og ikke et objekt indekseret efter år, så de sædvanlige funktioner `FILTER` og `PLUCK` virker på den:

```
# Samlet capex-budget på tvaers af alle aar
ppm.capexBudget

# Kun indevaerende regnskabsaars capex-budget
SUM(PLUCK(FILTER(ppm.byYear, "year", ppm.currentFiscalYear), "capexBudget"))

# Capex-budget for hvert initiativ, der er knyttet til dette kort
SUM(PLUCK(relations.relInitiativeToApp, "ppm.capexBudget"))
```

* **Et regnskabsår har navn efter det kalenderår, det slutter i.** Med start i oktober falder 15. okt. 2025 i RÅ2026 og 30. sep. 2025 i RÅ2025. Med standardstarten i januar er regnskabsåret blot kalenderåret.
* **Budgetlinjer og omkostningslinjer henter deres år fra hver sin kilde.** En budgetlinje bærer det regnskabsår, du har indtastet; en omkostningslinjes år udledes af dens dato. Navngiver din organisation regnskabsår efter *startåret*, vil de to være uenige.
* `total*` er summen af alle linjer, ikke `capex + opex`. En linje med en anden kategori (fra en import, for eksempel) tæller stadig med i totalen.
* Et kort, der ikke er et initiativ, læser alle `ppm`-mål som `0` med et tomt `byYear`, så en formel på den forkerte korttype returnerer nul i stedet for at fejle.

Redigering af en PPM-budget- eller omkostningslinje kører initiativets beregninger igen, så alt afledt heraf opdateres med det samme. Kort, der læser et *andet* korts PPM-data via en relation, opdateres ikke.

### Indbyggede funktioner

| Funktion | Beskrivelse | Eksempel |
|----------|-------------|---------|
| `IF(condition, true_val, false_val)` | Betinget logik. Kun den valgte gren evalueres | `IF(data.businessCriticality == "missionCritical", 100, 25)` |
| `SUM(array)` | Sum af numeriske værdier | `SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `AVG(array)` | Gennemsnit af numeriske værdier | `AVG(PLUCK(children, "attributes.numberOfUsers"))` |
| `MIN(array)` | Minimumværdi | `MIN(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `MAX(array)` | Maksimumværdi | `MAX(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `COUNT(array)` | Antal elementer | `COUNT(relations.relAppToInterface)` |
| `ROUND(value, decimals)` | Afrund et tal | `ROUND(data.costTotalAnnual / 12, 2)` |
| `ABS(value)` | Absolut værdi | `ABS(data.budgetVariance)` |
| `LN(value)` | Naturlig logaritme. Returnerer `None` for nul, negative og ikke-numeriske input | `LN(data.numberOfUsers)` |
| `COALESCE(a, b, ...)` | Første ikke-null værdi | `COALESCE(data.customScore, 0)` |
| `LOWER(text)` | Små bogstaver | `LOWER(data.productName)` |
| `UPPER(text)` | Store bogstaver | `UPPER(data.subtype)` |
| `CONCAT(a, b, ...)` | Sammensæt strenge | `CONCAT(data.name, " (", data.subtype, ")")` |
| `CONTAINS(text, search)` | Tjek om tekst indeholder delstreng | `CONTAINS(data.description, "legacy")` |
| `PLUCK(array, nøglesti)` | Udtræk en nøglesti fra hvert element | `PLUCK(relations.relAppToITC, "attributes.costTotalAnnual")` |
| `FILTER(array, nøglesti, value)` | Behold de elementer, hvis nøglesti er lig en værdi | `FILTER(relations.relOrgToApp, "attributes.hostingType", "onPremise")` |
| `MAP_SCORE(value, mapping)` | Map kategoriske værdier til scores | `MAP_SCORE(data.businessCriticality, {"missionCritical": 3, "businessCritical": 2})` |

De sikre Python-indbyggede funktioner `len`, `str`, `int`, `float`, `bool`, `abs`, `round`,
`min`, `max` og `sum` er også tilgængelige sammen med de sædvanlige operatorer og
sammenligninger.

### Eksempelformler { #example-formulas }

**Sum af flere omkostningsfelter på samme kort:**
```
COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0) + COALESCE(data.infraCost, 0)
```

**Samlede årlige omkostninger for de IT-komponenter, en applikation bruger:**
```
SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))
```

**Risikoscore baseret på kritikalitet:**
```
IF(data.businessCriticality == "missionCritical", 100, IF(data.businessCriticality == "businessCritical", 75, 25))
```

**Antal relaterede grænseflader:**
```
relation_count.relAppToInterface
```

**Antal on-premise-applikationer i en organisation:**
```
COUNT(FILTER(relations.relOrgToApp, "attributes.hostingType", "onPremise"))
```

**Rul en omkostning op fra underkort:**
```
SUM(PLUCK(children, "attributes.costTotalAnnual"))
```

**TIME Model-placering (Tolerate / Invest / Migrate / Eliminate)**, det samme eksempel, som du vil se i panelet **Formula Reference** inde i **Admin → Metamodel → Beregninger**, når du opretter en ny beregning. Måltype = `Application`, målfelt = `timeModel`. Antager, at du har tilføjet to `single_select`-felter med navn `businessFit` og `technicalFit` med indstillinger `excellent`, `adequate`, `insufficient`, `unreasonable`:
```
# ── TIME Model (Tolerate / Invest / Migrate / Eliminate) ──
# Assumes single_select fields: businessFit and technicalFit
# with options: excellent, adequate, insufficient, unreasonable.
#
# Scoring: Map each dimension to 1-4 numeric scale.
# Business Fit  = Y-axis (how well does it serve the business?)
# Technical Fit = X-axis (how healthy is the technology?)
#
# Quadrant logic (threshold at score 2.5):
#   Invest    = high business + high technical
#   Migrate   = high business + low technical
#   Tolerate  = low business  + high technical
#   Eliminate = low business  + low technical
#
bf = MAP_SCORE(data.businessFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
tf = MAP_SCORE(data.technicalFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
IF(bf is None or tf is None, None, IF(bf >= 2.5, IF(tf >= 2.5, "invest", "migrate"), IF(tf >= 2.5, "tolerate", "eliminate")))
```

Som eksemplet viser, kan en formel strække sig over flere linjer. En linje på formen
`navn = udtryk` gemmer en mellemværdi, som senere linjer kan genbruge, og værdien af den
sidste linje er det, der skrives til målfeltet.

Dette er også det gennemarbejdede eksempel, der henvises til af [EA Beginner's Guide](../beginners-guide/customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation).

**Kommentarer** understøttes ved hjælp af `#`:
```
# Calculate weighted risk score
IF(data.businessCriticality == "missionCritical", data.riskScore * 2, data.riskScore)
```

## Validering og test

Formeleditoren tilbyder to forskellige kontroller, og de opfører sig ikke ens:

* **Validér** kører formlen mod et syntetisk kort. Hvert numerisk felt får dummyværdien `1`,
  og kortet har **ingen relationer, ingen underkort og ingen egne forælderdata**. Det
  bekræfter, at syntaksen kan fortolkes, og at de anvendte navne findes, men en formel, der
  aggregerer over `relations` eller `children`, vil altid vise `0` eller et tomt resultat her.
  Det er forventet og ikke tegn på en defekt formel.
* **Test**, som er tilgængelig på en gemt beregning, kører mod et rigtigt kort, du vælger. Det
  er den kontrol, du skal bruge til alt, der involverer relationer, underkort eller det
  overordnede kort. Der skrives intet til kortet, resultatet vises kun for dig.

## Sådan læser du resultatet af en manuel kørsel

At køre en beregning fra listen evaluerer den for hvert kort af måltypen og rapporterer, hvad
der skete — ikke bare hvor mange kort den berørte. **Vis detaljer** i resultatbanneret åbner
opdelingen:

* **Én blok pr. beregning**, med antallet af kort der blev beregnet uden fejl og antallet der
  mislykkedes. Alle aktive beregninger på typen kører sammen, så det er her, du kan se hvilken
  der fejler.
* **Én række pr. distinkt fejl**, med antallet af kort den optrådte på. En forkert formel er
  forkert på samme måde overalt, så enogtyve fejl er som regel én rettelse, ikke enogtyve.
* **Selve kortene**, angivet under hver fejl som links, så du kan åbne et og se de data der fik
  det til at fejle. Højst ti angives pr. fejl; er der flere, vises resten som et antal.

**Kopiér rapport** lægger hele opdelingen i udklipsholderen som almindelig tekst.

Statusmarkeringen på beregningslisten afspejler samme kørsel: rød hvis blot ét kort mislykkedes,
grøn kun når alle blev beregnet.

## Hvornår beregninger kører

Et korts beregninger evalueres igen, når:

* kortet oprettes eller gemmes;
* en relation, der berører kortet, oprettes, opdateres eller slettes (begge ender af
  relationen genberegnes);
* kortet får en ny forælder, hvilket genberegner hele dets undertræ;
* du kører beregningen manuelt fra listen, hvilket evaluerer den for hvert kort af måltypen og
  gemmer resultaterne.

De evalueres **ikke** igen, når et andet kort, som formlen læser fra, redigeres. Ændrer du en
omkostning på en IT-komponent, flytter en applikation, der aggregerer den, sig ikke, før den
applikation gemmes, en af dens relationer ændres, eller du kører beregningen for typen. For
aggregeringer over data, som andre vedligeholder, bør du køre beregningen med jævne mellemrum
eller efter en masseimport.

!!! note "Bemærk"
    Det samme gælder værdier afledt af `parent` og `hierarchy_level`: De opdateres, når kortet
    får en ny forælder, og ved en manuel kørsel, ikke ved hver redigering af det overordnede
    kort. Beskyt altid en `parent`-reference med `IF(parent, …)`, så rodkort, hvor `parent` er
    `None`, ikke giver fejl.

## Udførelsesrækkefølge

Når flere beregninger er rettet mod den samme korttype, kører de i den rækkefølge, der er specificeret af deres **udførelsesrækkefølge**-værdi. Dette er vigtigt, når én beregning afhænger af resultatet af en anden: Sæt afhængigheden til at køre først (lavere nummer).

Turbo EA afviser et sæt beregninger, der ville danne en cyklus, for eksempel et felt A, der beregnes ud fra felt B, mens B beregnes ud fra A.
