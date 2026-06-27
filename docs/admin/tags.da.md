# Tags

Funktionen **Tags** (**Admin > Metamodel > Tags**-fanebladet) lader dig oprette klassifikationsetiketter, som brugere kan anvende på kort. Tags er organiseret i **tag-grupper**, hver med sin egen valgtilstand, typebegrænsninger og et valgfrit obligatorisk flag, der knytter sig til godkendelsesarbejdsprocessen og datakvalitetsscoren.

## Tag-grupper

En tag-gruppe er en kategori af tags. For eksempel kan du oprette grupper som "Forretningsdomæne", "Compliance-ramme" eller "Team-ejerskab".

### Oprettelse af en tag-gruppe

Klik på **+ Ny tag-gruppe** og konfigurer:

| Felt | Beskrivelse |
|-------|-------------|
| **Navn** | Visningsnavn vist på kortdetalje, lagerfiltre og rapporter. |
| **Beskrivelse** | Valgfri fri tekst-forklaring, synlig når administratorer administrerer gruppen. |
| **Tilstand** | **Single select** — ét tag pr. kort. **Multi select** — flere tags pr. kort. |
| **Obligatorisk** | Når markeret, deltager gruppen i godkendelsesporten og datakvalitetsscoren for hver korttype, den gælder for. Se [Obligatoriske tag-grupper](#obligatoriske-tag-grupper) nedenfor. |
| **Begræns til typer** | Valgfri tilladelsesliste over korttyper. Tom betyder, at gruppen er tilgængelig på alle typer; ellers ser kun de listede typer den i kortdetalje, filtre og portaler. |

### Administration af tags

Inden for hver gruppe kan du tilføje individuelle tags:

1. Klik på **+ Tilføj tag** inde i en tag-gruppe.
2. Indtast tag-**navnet**.
3. Tilføj eventuelt en **beskrivelse** — en kort note, der forklarer, hvad tagget betyder, vist som et værktøjstip, når administratorer administrerer tags.
4. Indstil eventuelt en **farve** til visuel skelnen — farven driver chip-baggrunden på kortdetalje, lager, rapporter og webportaler.

Tags vises på kortdetaljesider i **Tags**-sektionen, hvor brugere med den rigtige tilladelse kan anvende eller fjerne dem.

## Typebegrænsninger

Indstilling af **Begræns til typer** på en tag-gruppe afgrænser den overalt på én gang:

- **Kortdetalje** — gruppen og dens tags vises kun på matchende korttyper.
- **Lager-filtersidebar** — gruppens chip vises kun i `TagPicker`, når lagervisningen er filtreret til en matchende type.
- **Webportaler** — gruppen annonceres kun til portallæsere, når portalen viser en matchende type.
- **Rapporter** — gruppering/filter-dropdowns inkluderer kun gruppen for matchende typer.

Admin-UI'et viser de afgrænsede typer som små chips på hver tag-gruppe, så du kan se omfanget ved et blik.

## Obligatoriske tag-grupper

Markering af en tag-gruppe som **Obligatorisk** gør den til et governance-krav: hvert kort, gruppen gælder for, skal bære mindst ét tag fra gruppen.

### Godkendelsesport

Et kort kan ikke flytte til **Godkendt**, mens en gældende obligatorisk tag-gruppe er uopfyldt. Forsøg på at godkende returnerer en `approval_blocked_mandatory_missing`-fejl, og kortdetaljesiden viser, hvilke grupper der mangler. To forfininger holder porten sikker:

- En gruppe gælder kun for et kort, hvis dens **Begræns til typer**-liste er tom eller inkluderer kortets type.
- En obligatorisk gruppe, der **endnu ikke har tags konfigureret**, springes stille over — dette forhindrer en uopnåelig godkendelsesport fra en ufuldstændig admin-opsætning.

Når du tilføjer de nødvendige tags, kan kortet godkendes normalt.

### Datakvalitetsbidrag

Gældende obligatoriske tag-grupper indgår også i kortets datakvalitetsscore. Hver opfyldt gruppe hæver scoren sammen med de andre obligatoriske elementer (påkrævede felter, obligatoriske relationssider), der udgør fuldførelsesberegningen.

### Visuelle indikatorer

Obligatoriske grupper er markeret med en **Obligatorisk**-chip i admin-listen og på kortdetalje-Tags-sektionen. Manglende påkrævede tags vises i godkendelsesstatusbanneret og i datakvalitetsringens tooltip, så brugere ved præcis, hvad de skal tilføje.

## Tilladelser

| Tilladelse | Hvad den tillader |
|------------|----------------|
| `tags.manage` | Opret, rediger og slet tag-grupper og tags i admin-UI'et, og anvend/fjern tags på ethvert kort uanset andre tilladelser. |
| `inventory.edit` + `card.edit` | Anvend eller fjern tags på kort, som brugeren har redigeringsadgang til (via app-rolle eller interessentrolle på det specifikke kort). |

`tags.manage` tildeles admin-rollen som standard. `inventory.edit` tilhører admin, bpm_admin og member; `card.edit` tildeles gennem kortets egne interessentrolletildelinger.

Viewere kan **se** tags, men kan ikke ændre dem.

## Hvor tags vises

- **Kortdetalje** — Tags-sektionen viser gældende grupper og de tags, der i øjeblikket er tilknyttet. Obligatoriske grupper viser en chip; begrænsede grupper vises kun, når kortets type matcher.
- **Lager-filtersidebar** — en grupperet `TagPicker` lader dig filtrere lagergittret efter et eller flere tags. Grupper og tags filtreres til det aktuelle typeomfang.
- **Rapporter** — tag-baseret opdeling er tilgængelig i portefølje-, matrix- og andre rapporter, der understøtter grupperings-/filterdimensioner.
- **Webportaler** — portalredaktører kan eksponere tag-baserede filtre for anonyme læsere, så eksterne forbrugere kan opdele offentlige landskaber på samme måde.
- **Opret/rediger-dialoger** — den samme `TagPicker` dukker op, når du opretter et nyt kort, så de nødvendige tags kan opsættes på forhånd, hvilket er særligt nyttigt for obligatoriske grupper.
