# Din første analyse: applikationsharmonisering

Dette er belønningen. Du har et applikationslager, et kompetencekort og det indbyggede felt TIME-model. Nu forbinder du dem og producerer de to rapporter, der retfærdiggør hele EA-programmet over for en CIO:

- Rapporten **Applikationsportefølje**, med hver applikation grupperet efter **Forretningskritikalitet** og farvet efter dens **TIME**-disposition (**T**olerér / **I**nvester / **M**igrér / **E**liminér).
- **Kompetencekortet**, et heatmap, der viser, hvor du har redundans (flere apps pr. kompetence) og skrøbelighed (én app pr. kompetence).

## Trin 1 — Knyt applikationer til kompetencer

Den enkelt mest værdifulde relation i hele metamodellen er **Applikation → Forretningskompetence** (`understøtter` / `understøttes af`). Du vil indstille den for hver applikation i området.

### Massevej: redigeringstilstand i lageret

1. Gå til **Lager**, filtrér efter Type = `Application`.
2. Sørg for, at relationskolonnen **Forretningskompetence** er synlig (fanen Kolonner → Relationer).
3. Slå **Gitterredigering**-tilstand til i værktøjslinjen.
4. Klik på kompetencecellen på hver række, og vælg en eller flere kompetencer. Hver ændring gemmes, så snart du foretager den.

For 50–200 apps tager dette en eftermiddag og en kop kaffe.

### Kort-for-kort-vej

For mappinger med høj dømmekraft (eller når en workshop med applikationsejeren er involveret), åbn hvert applikationskort og brug sektionen **Relationer**. Du får den fulde vælger med søgning, hierarkiforhåndsvisning og muligheden for at indstille relationsattributter.

### Hvor mange kompetencer pr. applikation?

| Antal mappinger | Hvad det betyder |
|--------------|---------------|
| **0** | Ikke-mappet — dit lager er ufuldstændigt. Filtrér efter disse, og ret dem. |
| **1** | Den rene, ideelle case — denne app understøtter præcis én kompetence. |
| **2–3** | Fint — mange apps spænder over et par beslægtede kompetencer. |
| **4+** | Mistænkeligt — du blander muligvis "bruger data fra" med "understøtter". Tjek igen. |

!!! tip "Bedste praksis"
    Den første mapping er hurtig og grov. Den anden runde — udført med applikationsejeren gennemgående — er det, der gør dataene troværdige. Planlæg for begge.

## Trin 2 — Vurdér kritikalitet og egnethed

Tre indbyggede felter i sektionen **Vurdering** på hvert applikationskort fodrer analysen. Udfyld dem sammen med applikationsejeren — i en en-times workshop kan du typisk vurdere 30–50 applikationer med **Gitterredigering** og de tre kolonner synlige.

| Felt | Muligheder | Hvad det besvarer |
|------|------------|-------------------|
| **Forretningskritikalitet** | Missionskritisk / Forretningskritisk / Forretningsoperationel / Administrativ | Hvor meget afhænger forretningen af denne app? |
| **Funktionel egnethed** | Perfekt / Passende / Utilstrækkelig / Urimelig | Hvor godt gør den det, forretningen har brug for? |
| **Teknisk egnethed** | Helt passende / Tilstrækkelig / Urimelig / Upassende | Hvor sund er teknologien nedenunder? |

Forretningskritikalitet grupperer rapporten i trin 4. De to egnethedsvurderinger er det, som TIME-beregningen i trin 3 læser.

Hvis du redigerer disse felter på et godkendt kort, skifter dets godkendelsesstatus til **Brudt**. Gengodkend kortene samlet efter workshoppen.

## Trin 3 — Udled TIME med et beregnet felt

Det indbyggede felt **TIME-model** på Application (`timeModel`, fire muligheder: `tolerate` / `invest` / `migrate` / `eliminate`) er beslutningskolonnen, der driver resten af analysen. I stedet for at bede hver applikationsejer om at vælge en, udleder du den fra de to egnethedsvurderinger med en **beregning** — den klassiske Gartner-placering:

| | Teknisk egnethed høj | Teknisk egnethed lav |
|---|---|---|
| **Funktionel egnethed høj** | **Invester** | **Migrér** |
| **Funktionel egnethed lav** | **Tolerér** | **Eliminér** |

1. Gå til **Admin → Metamodel → Beregninger**, og klik på **Ny beregning**.
2. Sæt **Målkorttype** = `Application` og **Målfelt** = **TIME-model**.
3. Indsæt formlen fra [Tilpas metamodellen → Mulighed: udled et felt automatisk med en beregning](customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation). Den bruger de indbyggede egnethedsfelter, så der er ikke brug for noget brugerdefineret felt.
4. Klik på **Validér**, gem, og brug derefter **Test** på et par applikationer, du kender godt, for at kontrollere resultatet.
5. Slå beregningen til (**Aktiv**) i listen, og klik derefter på **Genberegn alle** på dens række for at udfylde TIME-model på alle applikationer.

Fra da af genberegnes TIME-model, hver gang en applikation gemmes, viser et **beregnet**-mærke og kan ikke længere redigeres manuelt. En applikation, der mangler en af de to egnethedsvurderinger, får ingen TIME-værdi — det er bevidst: det viser dig, hvilke vurderinger der stadig mangler.

!!! warning "Lad være"
    En beregnet TIME er en **starthypotese**, ikke en dom. Gennemgå resultaterne med applikationsejerne, før du præsenterer dem. Hvor en beslutning skal tilsidesætte formlen, så slå beregningen fra (kontakten **Aktiv**), og redigér TIME-model manuelt i **Gitterredigering**.

Reference: [Admin → Beregninger](../admin/calculations.md).

## Trin 4 — Kør rapporten Applikationsportefølje

1. Gå til **Rapporter → Applikationsportefølje**.
2. Sæt **Gruppér efter** = **Forretningskritikalitet**.
3. Sæt **Farvelæg apps efter** = **TIME-model**.
4. Klik på bogmærkeikonet (**Gem rapport**), og navngiv visningen ("Applikationsportefølje — salgsdomæne"). Du finder den igen under **Rapporter → Gemte rapporter**.

Hvert niveau af forretningskritikalitet bliver en boks med én chip pr. applikation, farvet efter dens TIME-disposition, og en bjælke, der viser fordelingen. For at fokusere på ét domæne skal du bruge filteret **Relateret via** med kompetencerne i dit område.

Hvad du skal kigge efter:

- **»Missionskritisk«- og »Forretningskritisk«-apps markeret Migrér** — dine mest konsekvensrige moderniseringsbeslutninger. De kommer først.
- **»Administrativ«- og »Forretningsoperationel«-apps markeret Eliminér eller Migrér** — dine hurtigste forenklingsgevinster: udfas dem, eller konsolidér dem på en anden platform.
- **»Missionskritisk«-apps markeret Invester** — bekræft, at de faktisk får investeringen.
- **Apps uden farve** (TIME *Ikke angivet*) — en af de to egnethedsvurderinger mangler. Gå tilbage til trin 2.

Reference: [Rapporter → Porteføljerapport](../guide/reports.md#portefljerapport).

## Trin 5 — Kør kompetencekortet

1. Gå til **Rapporter → Kompetencekort**.
2. Behold **Heatmap-metrik** på **Antal applikationer**: cellefarveintensiteten er proportional med antallet af applikationer, der understøtter den kompetence.
3. Valgfrit: slå **Vis applikationer** til, og sæt **Farvelæg apps efter** = **TIME-model** for at se TIME-dispositionen for apps inden for hver kompetence.

Hvad du skal kigge efter:

- **Varme celler** (mange apps pr. kompetence) — kandidatredundans. Den mest almindelige business case for en rationalisering af applikationsportefølje bor her.
- **Kolde celler** med applikationer, du ville forvente — huller i din mapping eller reelt underdækkede kompetencer.
- **Hvide celler** midt i en aktiv gren — ikke-mappede applikationer eller umodellerede kompetencer.

Reference: [Rapporter → Kompetencekort](../guide/reports.md#kompetencekort).

## Trin 6 — Præsentér og iterer

Du har nu en forsvarlig porteføljevisning. Læg de to rapporter foran salgs-CIO'en (eller hvem der ejer dit område) og:

- Bekræft TIME-vurderingerne på »Missionskritisk«- og »Forretningskritisk«-applikationerne.
- Identificér de top-3 varme celler i heatmappet som kandidat-rationaliseringsprojekter.
- Fang opfølgninger som kommentarer eller opgaver på applikationerne selv — Turbo EA sporer dem pr. kort.

Det er det. Du har en fungerende EA-praksis på Turbo EA.

## Hvad er det næste

Når din applikationsportefølje er levende og troværdig, bliver disse højværdi-næste-trin. Ingen af dem er nyttige, før du har et befolket lager — hvilket er grunden til, at denne guide bevidst har udsat dem.

| Modul | Hvornår skal det åbnes | Hvor det findes |
|--------|----------------|------------------|
| **Risikoregister** | Når du er klar til at spore arkitekturrisici mod applikationer og kompetencer (TOGAF fase G). | [Risikoregister](../guide/risks.md) |
| **GRC / Compliance** | Når du har brug for at mappe applikationer og kompetencer mod regulativer (GDPR, NIS2, EU AI Act, DORA, SOC 2, ISO 27001). | [GRC](../guide/grc.md) |
| **PPM** | Når rationaliseringsbeslutningerne bliver projekter med budgetter, tidsplaner og statusrapporter. | [PPM](../guide/ppm.md) |
| **TurboLens AI** | Når du har nok kort til, at AI kan finde leverandørdubletter, moderniseringskandidater og arkitekturanbefalinger. | [TurboLens](../guide/turbolens.md) |
| **BPM** | Når du er klar til at modellere processerne, der sidder oven på dine applikationer. | [BPM](../guide/bpm.md) |
| **Diagrammer** | Når du har brug for frie arkitekturdiagrammer, der holder sig synkroniseret med lageret. | [Diagrammer](../guide/diagrams.md) |
| **EA-levering** | Når du begynder at producere TOGAF-stil Statements of Architecture Work og Architecture Decision Records. | [EA-levering](../guide/delivery.md) |

Velkommen til Turbo EA.
