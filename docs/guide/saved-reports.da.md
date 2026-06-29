# Gemte rapporter

Turbo EA lader dig **gemme rapportkonfigurationer**, så du hurtigt kan vende tilbage til specifikke visninger uden at omkonfigurere filtre og akser hver gang.

## Lagring af en rapport

Fra enhver rapportside (Portefølje, Kompetencekort, Livscyklus, Afhængigheder, Omkostning, Matrix, Datakvalitet eller EOL):

1. Konfigurer rapporten med dine ønskede filtre, grupperinger og aksevalg
2. Klik på **Gem**-knappen i rapportens værktøjslinje
3. Indtast et **navn** for den gemte rapport
4. Vælg **synligheden**:

| Synlighed | Hvem kan se den |
|------------|---------------|
| **Privat** | Kun dig |
| **Delt** | Dig og specifikke brugere, du vælger |
| **Offentlig** | Alle brugere af platformen |

For delte rapporter kan du give **redigeringstilladelser** til specifikke brugere, hvilket tillader dem at opdatere den gemte konfiguration.

5. Klik på **Gem** — et miniaturebillede fanges automatisk fra den aktuelle visualisering

## Galleri af gemte rapporter

Naviger til **Rapporter > Gemte rapporter** for at gennemse alle gemte rapporter, du har adgang til. Galleriet viser miniatureforhåndsvisninger organiseret i faner:

- **Mine rapporter** — Rapporter, du har oprettet
- **Delt med mig** — Rapporter, andre har delt med dig
- **Offentlig** — Rapporter synlige for alle

### Handlinger

- **Åbn** — Klik på en rapport for at indlæse den med den gemte konfiguration
- **Rediger** — Opdater navn, synlighed eller delingsindstillinger
- **Dupliker** — Opret en kopi med et nyt navn
- **Slet** — Fjern den gemte rapport (kun opretteren eller brugere med redigeringstilladelser kan slette)

## Tilpassede rapporter med din AI-assistent

Ud over de indbyggede rapporttyper kan Turbo EA bygge **fuldt tilpassede rapporter** ud fra en beskrivelse i naturligt sprog ved hjælp af en AI-assistent, der er forbundet via **MCP-serveren**.

### Sådan fungerer det

1. Forbind Turbo EA MCP-serveren til din AI-assistent (for eksempel Claude Code) — se vejledningen **MCP-integration**.
2. Beskriv den rapport, du ønsker, i naturligt sprog, for eksempel »Tæl applikationer efter forretningskritikalitet som et cirkeldiagram« eller »Samlede årlige omkostninger for IT-komponenter grupperet efter leverandør«.
3. Assistenten kalder `get_report_builder_schema` for at læse din live-metamodel (korttyper, felter, relationer, tags), samler en sikker rapport **specifikation** og forhåndsviser den mod dine rigtige arbejdsområdedata med `preview_custom_report` — så du ser faktiske resultater, før noget gemmes.
4. Når du er tilfreds, **udgiver** assistenten rapporten med `create_saved_report`. Den vises i galleriet **Gemte rapporter** og åbnes som en indbygget, interaktiv rapport.

### Hvad tilpassede rapporter kan

- **Metamodel-bevidst**: dine korttyper, undertyper, felter, relationer og tags afspejles automatisk — uden kodning.
- **Gruppér og aggreger**: gruppér efter attribut, undertype, livscyklusfase, tag-gruppe eller relateret kort, og mål med antal, sum, gennemsnit, minimum eller maksimum.
- **Filtrér og naviger**: filtrér kildekortene og følg eventuelt ét relationshop til relaterede kort.
- **Mange visualiseringer**: vis som tabel, søjle-/kolonne-/cirkel-/ring-/punkt-/treemap-/linjediagram eller som KPI-felter.
- **Sikker og styret**: rapporter er skrivebeskyttede, kører helt på deklarative regler (ingen kode, ingen SQL), og omkostningsfelter forbliver bag tilladelsen **Vis omkostninger** — præcis som enhver anden rapport.

Tilpassede rapporter gemmes ligesom enhver anden rapport, så de samme indstillinger for synlighed og deling (privat / delt / offentlig) gælder.

### Byg en i hånden

Du behøver ikke AI-assistenten. Åbn **Rapporter > Gemte rapporter**, opret en tilpasset rapport, og klik på **Opret en rapport** for at åbne en visuel editor: vælg en korttype, tilføj filtre, bestem grupperingen (dimensioner) og målene, og vælg en diagramtype. En live-forhåndsvisning opdateres undervejs; klik på **Gem** for at udgive.
