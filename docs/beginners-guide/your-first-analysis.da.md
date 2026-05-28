# Din første analyse: applikationsharmonisering

Dette er belønningen. Du har et applikationslager, et kompetencekort og et TIME-dispositionsfelt. Nu forbinder du dem og producerer de to rapporter, der retfærdiggør hele EA-programmet over for en CIO:

- En **porteføljerapport**, der viser hver applikation størrelsesmæssigt efter omkostning, farvet efter TIME-disposition.
- Et **kompetenceheatmap**, der viser, hvor du har redundans (flere apps pr. kompetence) og skrøbelighed (én app pr. kompetence).

## Trin 1 — Knyt applikationer til kompetencer

Den enkelt mest værdifulde relation i hele metamodellen er **Applikation → Forretningskompetence** (`supports` / `supported by`). Du vil indstille den for hver applikation i området.

### Massevej: redigeringstilstand i lageret

1. Gå til **Lager**, filtrér efter Type = `Application`.
2. Sørg for, at relationskolonnen **Forretningskompetence** er synlig (fanen Kolonner → Relationer).
3. Slå **Gitter-redigering**-tilstand til i værktøjslinjen.
4. Klik på kompetencecellen på hver række, og vælg en eller flere kompetencer.
5. Gem.

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

## Trin 2 — Vælg, hvordan du udfylder TIME-modellen

Det indbyggede **TIME-model**-felt på Application (`timeModel`, påkrævet, fire muligheder: `tolerate` / `invest` / `migrate` / `eliminate`) er beslutningskolonnen, der driver resten af analysen. Du har to måder at befolke det på.

### Mulighed A — Manuel TIME-indtastning (anbefales til første runde)

Med applikationsejeren i en en-times workshop kan du typisk klassificere 30–50 applikationer:

- **Tolerere** — fungerer, lav omkostning, ikke en strategisk differentiator. Lad være.
- **Investere** — strategisk, vækstområde, finansier forbedringer.
- **Migrere** — erstat eller flyt til en ny platform inden for planlægningshorisonten.
- **Eliminere** — duplikat, udløb, nedlæg.

Brug lagerets **Gitter-redigering**-tilstand med kolonnen **TIME-model** synlig for at fange beslutninger i fart.

### Mulighed B — Beregnet TIME via en formel

I stedet for at bede hver applikationsejer om at sætte TIME manuelt, kan du udlede `timeModel` automatisk fra de to indbyggede egnethedsdimensioner (`functionalSuitability` × `technicalSuitability`) ved hjælp af **beregninger**-funktionen. Dette er den kanoniske Gartner-fire-kvadrant-placering.

Det gennemarbejdede eksempel — formlen, kvadranttabellen og det anbefalede hybridmønster — bor i [Tilpas metamodellen → Mulighed: udled et felt automatisk med en beregning](customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation). Brug det som en startanbefaling, som ejerne derefter validerer, ikke som en dom.

## Trin 3 — Kør porteføljerapporten

1. Gå til **Rapporter → Portefølje**.
2. Konfigurer akserne:
    - **Korttype**: `Application`
    - **X-akse**: `technicalSuitability` (det indbyggede teknisk-egnethedsfelt).
    - **Y-akse**: `functionalSuitability` eller `businessValue` (indbyggede forretnings-egnethedsfelter).
    - **Størrelse**: `costTotalAnnual` — jo større forbrug, jo større boble.
    - **Farve**: `timeModel` — det er det, der gør rapporten beslutningsklar.
3. Gem konfigurationen som en navngivet visning ("Applikationsportefølje — salgsdomæne"), så du kan komme tilbage til den.

Hvad du skal kigge efter:

- **Store røde bobler** (højomkostnings-Eliminer-kandidater) — dine hurtigste besparelser.
- **Store gule bobler** (højomkostnings-Migrer-kandidater) — dine mest konsekvente transformationsbeslutninger.
- **Klynger i øverste højre hjørne af matrixen**, der ikke er grønne — strategiske apps, der ikke får investering.

Reference: [Rapporter](../guide/reports.md).

## Trin 4 — Kør kompetenceheatmappet

1. Gå til **Rapporter → Kompetencekort**.
2. Heatmappet viser dit forretningskompetencehierarki med cellefarveintensitet proportional med **antallet af applikationer, der understøtter den kompetence**.

Hvad du skal kigge efter:

- **Varme celler** (mange apps pr. kompetence) — kandidatredundans. Den mest almindelige business case for en rationalisering af applikationsportefølje bor her.
- **Kolde celler** med applikationer, du ville forvente — huller i din mapping eller reelt underdækkede kompetencer.
- **Hvide celler** midt i en aktiv gren — ikke-mappede applikationer eller umodellerede kompetencer.

Reference: [Rapporter → Kompetencekort](../guide/reports.md).

## Trin 5 — Præsentér og iterer

Du har nu en forsvarlig porteføljevisning. Læg de to rapporter foran salgs-CIO'en (eller hvem der ejer dit område) og:

- Bekræft TIME-vurderingerne på de top-10 højest-omkostende applikationer.
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
