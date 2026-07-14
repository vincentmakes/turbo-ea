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

Formler bruger et sikkert, sandboxet udtrykssprog. Du kan referere til kortegenskaber, relaterede kortdata og livscyklusinformation.

### Kontekstvariabler

| Variabel | Beskrivelse | Eksempel |
|----------|-------------|---------|
| `fieldKey` | Enhver egenskab fra det nuværende kort | `businessCriticality` |
| `related_{type_key}` | Array af relaterede kort af en given type | `related_applications` |
| `lifecycle_plan`, `lifecycle_active`, osv. | Livscyklus-datoværdier | `lifecycle_endOfLife` |
| `parent` | Overordnet kort (objekt med `id`, `name`, `type`, `subtype`, `attributes`) eller `None` for et rodkort | `IF(parent, parent.attributes.businessCriticality, data.businessCriticality)` |
| `hierarchy_level` | Dybden af det aktuelle kort i dets forælder-barn-hierarki (`1` = rod, ikke begrænset). `1` for ikke-hierarkiske korttyper | `hierarchy_level * 10` |

!!! note "Bemærk"
    Værdier afledt af `parent` og `hierarchy_level` opdateres, når et kort får en ny forælder (hele dets undertræ genberegnes), og når du kører **Genberegn alle** for typen — ikke ved hver redigering af det overordnede kort. Beskyt altid en `parent`-reference med `IF(parent, …)`, så rodkort (hvor `parent` er `None`) ikke giver fejl.

### Indbyggede funktioner

| Funktion | Beskrivelse | Eksempel |
|----------|-------------|---------|
| `IF(condition, true_val, false_val)` | Betinget logik | `IF(riskLevel == "critical", 100, 25)` |
| `SUM(array)` | Sum af numeriske værdier | `SUM(PLUCK(related_applications, "costTotalAnnual"))` |
| `AVG(array)` | Gennemsnit af numeriske værdier | `AVG(PLUCK(related_applications, "dataQuality"))` |
| `MIN(array)` | Minimumværdi | `MIN(PLUCK(related_itcomponents, "riskScore"))` |
| `MAX(array)` | Maksimumværdi | `MAX(PLUCK(related_itcomponents, "costAnnual"))` |
| `COUNT(array)` | Antal elementer | `COUNT(related_interfaces)` |
| `ROUND(value, decimals)` | Afrund et tal | `ROUND(avgCost, 2)` |
| `ABS(value)` | Absolut værdi | `ABS(delta)` |
| `COALESCE(a, b, ...)` | Første ikke-null værdi | `COALESCE(customScore, 0)` |
| `LOWER(text)` | Små bogstaver | `LOWER(status)` |
| `UPPER(text)` | Store bogstaver | `UPPER(category)` |
| `CONCAT(a, b, ...)` | Sammensæt strenge | `CONCAT(firstName, " ", lastName)` |
| `CONTAINS(text, search)` | Tjek om tekst indeholder delstreng | `CONTAINS(description, "legacy")` |
| `PLUCK(array, key)` | Udtræk et felt fra hvert element | `PLUCK(related_applications, "name")` |
| `FILTER(array, key, value)` | Filtrer elementer efter feltværdi | `FILTER(related_interfaces, "status", "ACTIVE")` |
| `MAP_SCORE(value, mapping)` | Map kategoriske værdier til scores | `MAP_SCORE(criticality, {"high": 3, "medium": 2, "low": 1})` |

### Eksempelformler { #example-formulas }

**Samlede årlige omkostninger fra relaterede applikationer:**
```
SUM(PLUCK(related_applications, "costTotalAnnual"))
```

**Risikoscore baseret på kritikalitet:**
```
IF(riskLevel == "critical", 100, IF(riskLevel == "high", 75, IF(riskLevel == "medium", 50, 25)))
```

**Antal aktive grænseflader:**
```
COUNT(FILTER(related_interfaces, "status", "ACTIVE"))
```

**TIME Model-placering (Tolerate / Invest / Migrate / Eliminate)** — det samme eksempel, som du vil se i panelet **Formula Reference** inde i **Admin → Metamodel → Beregninger**, når du opretter en ny beregning. Måltype = `Application`, målfelt = `timeModel`. Antager, at du har tilføjet to `single_select`-felter med navn `businessFit` og `technicalFit` med indstillinger `excellent`, `adequate`, `insufficient`, `unreasonable`:
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

Dette er også det gennemarbejdede eksempel, der henvises til af [EA Beginner's Guide](../beginners-guide/customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation).

**Kommentarer** understøttes ved hjælp af `#`:
```
# Calculate weighted risk score
IF(businessCriticality == "missionCritical", riskScore * 2, riskScore)
```

## Kørsel af beregninger

Beregninger kører automatisk, når et kort gemmes. Du kan også manuelt udløse en beregning til at køre på tværs af alle kort af måltypen:

1. Find beregningen på listen
2. Klik på knappen **Kør**
3. Formlen evalueres for hvert matchende kort, og resultaterne gemmes

## Udførelsesrækkefølge

Når flere beregninger er rettet mod den samme korttype, kører de i den rækkefølge, der er specificeret af deres **udførelsesrækkefølge**-værdi. Dette er vigtigt, når én beregning afhænger af resultatet af en anden — sæt afhængigheden til at køre først (lavere nummer).
