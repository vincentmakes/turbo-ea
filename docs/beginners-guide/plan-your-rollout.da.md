# Planlæg din udrulning

Inden du opretter et eneste kort, så brug en time på at besvare fire spørgsmål. De hold, der springer dette trin over, ender med et lager, ingen stoler på, fordi ingen blev enige om, hvad det var til.

## 1. Definér et snævert område

Den største fejl i EA-udrulninger er at forsøge at modellere hele virksomheden på én gang. Vælg **én** af følgende:

- Et **forretningsdomæne** (f.eks. salg, økonomi, kundeservice, produktion).
- En **juridisk enhed** eller **region** (et datterselskab, et land, en nyligt opkøbt forretningsenhed).
- En **platform** (f.eks. e-handelsstakken, dataplatformen, ERP-landskabet).

Et godt første område indeholder omkring **50–200 applikationer**. Mindre end det, og der er intet at analysere; mere end det, og du løber tør for energi, før du når til analysen.

!!! warning "Lad være"
    Vælg ikke "hele virksomheden" eller "hele IT". Du vil bruge tre måneder på at jage data og aldrig nå frem til en fungerende rapport.

## 2. Vælg den rigtige første use case

Use casen afgør, hvilke felter der betyder noget, hvilke interessenter du har brug for, og hvilken rapport du vil vise til sidst. Den mest almindelige — og den, denne guide antager fra side 3 og fremefter — er:

> **Rationalisering af applikationsportefølje**
>
> Lav inventar over applikationerne i området, klassificér hver enkelt efter forretningsværdi og teknisk egnethed, og beslut, hvad der skal **T**oleres, **I**nvesteres i, **M**igreres eller **E**limineres (TIME-rammeværket).

Andre gyldige første use cases — men vælg **én**:

| Use case | Hvad du primært vil befolke | Hvad du springer over |
|----------|----------------------------|------------------|
| **Rationalisering af applikationsportefølje** | Applikationer, omkostninger, livscyklus, forretningsværdi | Detaljeret procesmodel, grænseflader |
| **Kompetencebaseret planlægning** | Forretningskompetencer, applikationer, kompetenceheatmap | Omkostningsdetaljer, teknologistak |
| **Vurdering af cloudmigration** | Applikationer, IT-komponenter, deployment-model | Forretningsværdi, processer |
| **M&A-integration** | Begge porteføljer som applikationer, overlapsanalyse | Langsigtede livscyklusdatoer |

Hvis du er i tvivl, **vælg rationalisering af applikationsportefølje**. Det er det mest universelt nyttige udgangspunkt, og resten af denne guide er skrevet ud fra det.

## 3. Identificér dine interessenter

Turbo EA har en indbygget **interessent**-model (se [Kortdetaljer](../guide/card-details.md)): hvert kort bærer en liste over personer i definerede roller (forretningsejer, teknisk ejer osv.), defineret pr. korttype i metamodellen. Beslut på forhånd, hvem der udfylder hver rolle for en applikation:

- **Applikationsejer** — ansvarlig for applikationen i forretningen. Én person pr. app. De godkender TIME-dispositionen.
- **Teknisk ejer** — ansvarlig for at holde den kørende. Ofte engineering-lederen.
- **Arkitekt** — det er dig, sandsynligvis. Fungerer som EA-side-anmelder og godkender kort.

Du behøver ikke tildele interessenter på dag ét for hvert kort, men du har brug for at vide, hvem de *vil* være — for i uge tre vil du sende dem undersøgelser for at validere dataene.

!!! tip "Bedste praksis"
    Et rigtigt navn i applikationsejerrollen er mere værd end ti perfekt udfyldte brugerdefinerede felter. Hvis du kun nogensinde udfylder ét felt ud over navn og livscyklus, så gør det applikationsejeren.

## 4. Sæt et realistisk datakvalitetsmål

Turbo EA beregner en **datakvalitets**-score (0–100 %) for hvert kort baseret på de vægtede felter, der er defineret i metamodellen. Det er den enkelt bedste ledende indikator for, om dit lager er anvendeligt.

Realistiske mål for de første 90 dage:

| Fase | Mål for gns. datakvalitet (applikationer) | Hvad der er udfyldt |
|-------|----------------------------------------|---------------|
| Slutningen af uge 2 (kravl) | **40–60 %** | Navn, livscyklusfase, beskrivelse, forretningsejer |
| Slutningen af uge 6 (gå) | **60–75 %** | + kompetencekortlægning, omkostning, TIME-disposition |
| Slutningen af måned 3 (løb) | **75–90 %** | + teknologistak, grænseflader, brugerdefinerede domænefelter |

Pres ikke for 100 %. De sidste 10 % koster mere end de første 60 % og ændrer sjældent en beslutning.

## 5. Forpligt dig til ét leverbart resultat

Afslut din planlægningssession med en skriftlig erklæring som:

> *"Ved udgangen af uge 6 vil salgsdomænets lager indeholde hver applikation med årlige omkostninger > 50.000 €, hver knyttet til mindst én forretningskompetence og bærende en TIME-disposition. Vi vil præsentere porteføljerapporten for salgs-CIO'en i uge 7."*

Sæt den på en wiki, i et kickoff-slide, i en Slack-kanalbeskrivelse — et synligt sted. Den sætning er det, der forhindrer udrulningen i at drive ind i "vi indsamler stadig data"-skærsilden.

Næste: [Start med dit applikationslager](start-with-applications.md).
