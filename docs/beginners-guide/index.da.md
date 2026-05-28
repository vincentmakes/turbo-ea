# Dine første 30 dage med Turbo EA

Så du har installeret Turbo EA. Login-skærmen virker, demodataene loader, alle menupunkter viser dig noget — og nu stirrer du på et tomt lager og spekulerer på, hvor du egentlig skal begynde. Denne guide er til dig.

Det er en sekventieret, holdningsdrevet gennemgang af det **første konkrete EA-initiativ**, de fleste organisationer kører på Turbo EA: at få et applikationslager under kontrol og bruge det til at besvare reelle porteføljespørgsmål. Den ignorerer bevidst de mere avancerede moduler (risikoregister, compliance, PPM, TurboLens AI) — de bliver først nyttige, når dit lager er levende, ikke før.

## Hvem denne guide er til

- **Enterprise-arkitekter**, der starter en ny EA-praksis eller migrerer fra regneark, Confluence eller et andet værktøj.
- **Løsningsarkitekter og applikationsejere**, der bliver bedt om at "udfylde EA-værktøjet" uden megen kontekst.
- **Administratorer**, der forbereder platformen til en bredere udrulning.

Du skal bruge **admin**-rollen (eller mindst `admin.metamodel` og `inventory.edit`) for at følge hvert trin. Skrivebeskyttede roller kan stadig drage nytte — de vil bare ikke kunne foretage metamodelændringerne på side 5.

## Kravl → gå → løb-buen

Forsøg ikke at modellere hele virksomheden i uge ét. Holdene, der lykkes med EA-værktøjer, følger en faseopdelt vej:

1. **Kravl** — Ét snævert område (et forretningsdomæne, et land, en platform). Én korttype (applikationer). Fem felter pr. kort. Få "god nok"-data på 50–200 kort.
2. **Gå** — Tilføj forretningskompetencer fra det medfølgende katalog. Knyt applikationer til kompetencer. Kør din første porteføljeanalyse. Vis den til en interessent.
3. **Løb** — Udvid til processer, grænseflader, dataobjekter. Tilføj flere brugerdefinerede felter. Åbn de mere avancerede moduler.

Denne guide dækker **kravl** og begyndelsen af **gå**. Når du er færdig, vil du have en fungerende applikationsportefølje med en TIME-disposition (**T**oler / **I**nvester / **M**igrer / **E**liminer) og en porteføljerapport, du kan lægge foran en CIO.

## Hvad er der i denne guide

| # | Side | Hvad du vil gøre |
|---|------|---------------|
| 1 | [Planlæg din udrulning](plan-your-rollout.md) | Afgræns initiativet, vælg interessenter, sæt et realistisk datakvalitetsmål |
| 2 | [Start med dit applikationslager](start-with-applications.md) | Befolk applikationer via import, ServiceNow eller manuel indtastning |
| 3 | [Udnyt referencekataloger](leverage-reference-catalogues.md) | Spring måneders håndmodellering over ved at importere kompetencer og processer |
| 4 | [Tilpas metamodellen — let](customise-the-metamodel.md) | Tilføj ét brugerdefineret felt (TIME) på den rigtige måde |
| 5 | [Din første analyse: applikationsharmonisering](your-first-analysis.md) | Knyt apps til kompetencer, kør porteføljerapporten og kompetenceheatmappet |

!!! tip "Bedste praksis"
    Læs alle fem sider i rækkefølge, før du åbner Turbo EA. Planen i dit hoved er mere værd end de første 50 kort i lageret.

## Forudsætninger

- En kørende Turbo EA-instans (se [Installation & opsætning](../getting-started/setup.md)).
- En administratorkonto (den første bruger, der registrerer sig, bliver automatisk administrator).
- **Valgfrit, men anbefalet for førstegangsbrugere:** start stakken med `SEED_DEMO=true` én gang for at se, hvordan et befolket lager ser ud (det fiktive firma NexaTech Industries). Du kan derefter nulstille med `RESET_DB=true` og starte på frisk med dine egne data.
- En grov idé om det **forretningsdomæne**, du vil modellere først. "Hele IT" er ikke et domæne.

## Hvad du springer over — for nu

Disse er stærke moduler, men de antager, at du allerede har et befolket lager. Åbn dem ikke endnu:

- **Risikoregister** og **compliance-scanning** — nyttige, når du har applikationer og kompetencer at knytte risici til.
- **PPM** (projektporteføljestyring) — nyttig, når du har en projektpipeline, der er værd at følge.
- **TurboLens AI** (leverandøranalyse, dubletdetektion, Architect-guide) — nyttig, når du har nok kort til, at AI kan finde mønstre.

Du finder en kort "hvad er det næste"-henvisning til hver af dem på [sidste side](your-first-analysis.md) i denne guide.

Klar? Gå til [Planlæg din udrulning](plan-your-rollout.md).
