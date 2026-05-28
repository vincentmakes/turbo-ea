# Risikoregister

**Risikoregistret** fanger arkitekturrisici gennem hele deres livscyklus — fra identifikation til afhjælpning, residualvurdering, overvågning og lukning (eller formel accept). Det lever som **Risk**-fanen i [GRC-modulet](grc.md) på `/grc?tab=risk`.

## TOGAF-tilpasning

Registret implementerer Architecture Risk Management-processen fra **TOGAF ADM Fase G — Implementation Governance** (TOGAF 10 §27):

| TOGAF-trin | Hvad du fanger |
|-----------|----------------|
| Risikoklassificering | `Category` (security, compliance, operational, technology, financial, reputational, strategic) |
| Risikoidentifikation | `Title`, `Description`, `Source` (manuel eller promoveret fra et TurboLens-fund) |
| Indledende vurdering | `Initial probability × Initial impact → Initial level` (afledes automatisk) |
| Afhjælpning | En eller flere **afhjælpningsopgaver** — ejede arbejdselementer, engangs eller tilbagevendende (se [Afhjælpningsopgaver](#mitigation-tasks) nedenfor). Risikoen har desuden en `Owner` og en `Target resolution date`. |
| Residualvurdering | `Residual probability × Residual impact → Residual level` (redigerbar når afhjælpning er planlagt). Forbliver en **manuel** vurdering — opgaveafslutning justerer den ikke automatisk. Detaljesiden viser et "X/Y åbne · Z overskredet"-opgaveresumé ved siden af residualblokken som kontekst for den menneskelige bedømmelse (ISO 31000-tilpasset). |
| Overvågning / accept | `Status`-arbejdsproces: identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed (med en `accepted`-sidegren, der kræver en eksplicit begrundelse) |

## Oprettelse af en risiko

To veje lander begge i samme dialog **Create risk** — hver variant udfylder forskellige felter på forhånd, så du kan redigere og indsende:

1. **Manuel** — Risk-fanen → **+ New risk**. Tomt formular.
2. **Fra et compliance-fund** — GRC → Compliance → **Create risk** på et ikke-overholdt fund. Udfylder kategori `compliance`, sandsynlighed/virkning fra regulering-sværhedsgrad + status, beskrivelse fra requirement + gap.

Begge varianter inkluderer felterne **Owner**, **Category** og **Target resolution date**, så du kan tildele ansvarlighed ved oprettelsestidspunktet — ingen grund til at åbne risikoen igen for at tilføje dem.

Promovering er **idempotent** — når et fund er blevet promoveret, skifter dets knap til **Open risk R-000123** og navigerer direkte til risikodetaljesiden.

## Ejerskab → Todo + notifikation

At tildele en **ejer** til risikoen (enten ved oprettelse eller senere) gør automatisk:

- Opretter en **system-Todo** på ejerens Todos-side. Beskrivelsen lyder `[Risk R-000123] <title>`, forfaldsdatoen spejler risikoens mål-løsningsdato, og linket hopper tilbage til risikodetaljen. Todo'en markeres automatisk som **udført**, når risikoen når `mitigated` / `monitoring` / `accepted` / `closed`.
- Affyrer en **klokke-notifikation** (`risk_assigned`) — vist i klokke-dropdownen og notifikationssiden, med valgfri e-mail, hvis brugeren har tilmeldt sig. Selv-tildeling affyrer også klokken, så sporet er konsistent på tværs af team- og personlige arbejdsprocesser.

At rydde eller om-tildele ejeren holder Todo'en synkroniseret — den gamle fjernes / om-tildeles.

Det samme system affyres uafhængigt for **hver afhjælpningsopgave** på risikoen, så en bidragsyder kun ser det arbejde, vedkommende ejer — se [Afhjælpningsopgaver](#mitigation-tasks) nedenfor.

## Linke risici til kort

Risici er **mange-til-mange** med kort. En risiko kan påvirke flere applikationer eller IT-komponenter, og et kort kan have flere risici linket til sig:

- Fra risikodetaljesiden: **Affected cards**-panelet → søg og tilføj. Klik på et `×` for at afkoble.
- Fra enhver Kortdetaljeside: en ny **Risks**-fane viser hver risiko linket til det kort med en ét-klik-vej tilbage til registret.

## Afhjælpningsopgaver

Afhjælpning fanges som **ejede arbejdselementer**, ikke friform-tekst. På risikodetaljesiden erstatter panelet **Mitigation tasks** det gamle enkelte felt "mitigation plan" — hver række er en rigtig opgave med sin egen ejer, forfaldsdato, historik og (valgfrit) en gentagelses-regel.

### Engangs vs. tilbagevendende

En afhjælpningsopgave er **engangs** som standard — egnet til "Roll out MFA", "Sign updated SCCs" eller et hvilket som helst projektformet stykke arbejde. Slå **Repeats** til i opgavedialogen, og du får en **tilbagevendende kontrolgennemgang**: f.eks. "Re-attest cross-border transfer documentation every 12 months", "Run the OT incident response tabletop every 3 months", "Audit Jenkins credentials every week".

Tilbagevendende opgaver akkumulerer én **cyklus** (`occurrence`) pr. periode. Næste cyklus oprettes automatisk, når du lukker den nuværende — kalenderkorrekt, så en månedlig opgave, der forfalder 31. januar, rulles til 28. februar, ikke 3. marts.

### Lead-time-vinduet

Hele pointen med en tilbagevendende kontrolgennemgang er, at den tildelte bliver mindet om det **lige inden forfaldsdatoen**, ikke i det øjeblik den foregående cyklus lukkede. Hver tilbagevendende opgave bærer en **Lead time** (dage) — hvor mange dage før `due_date` cyklussen bliver aktiv og lander på den tildeltes `/todos`-liste.

Hver cyklus bevæger sig derfor gennem tre synlige tilstande:

| Status | Hvad det betyder | Synlig på /todos? |
|--------|------------------|--------------------|
| **Scheduled** | Næste cyklus eksisterer til audit ("next review: due 2026-11-15"), men er dvalende. I dag er stadig uden for lead-vinduet. | Nej |
| **Open** | Lead-vinduet er åbnet. En system-Todo er på den tildeltes liste med `[Risk R-000123] <task title>`; en `task_assigned`-notifikation affyres. | Ja (Open-fane) |
| **Done** / **Skipped** | Den tildelte lukkede cyklussen. Todo'en skifter til `done`, så den forbliver i den tildeltes **Done**-fane som en historik-post. | Ja (Done-fane) |

Opgavedialogen foreslår en fornuftig lead time pr. gentagelses-enhed (1 dag for daglig, 2 for ugentlig, 7 for månedlig, 14 for årlig — begrænset til halvdelen af cyklussen, så vinduet aldrig overlapper den foregående forekomst). Antydningen opdateres automatisk, når du ændrer enhed eller interval, indtil du selv redigerer feltet.

Én gang om dagen kl. **03:00 UTC** scanner en baggrundsproces hver planlagt cyklus og promoverer dem, hvis lead-vindue er åbnet. Skal du starte en gennemgang tidligt? Klik på **Activate now** (lyn-ikonet på opgaverækken) for at skifte en planlagt cyklus til åben øjeblikkeligt — samme Todo + notifikations-maskineri, bare uden ventetiden.

### Audit-historik pr. cyklus

Klik på udvid-chevronet på en opgaverække for at se dens fulde cyklus-historik. Hver forekomst stempler:

- **Target due date** ved planlægningstidspunktet.
- Hvem der var **assigned** i det øjeblik, cyklussen åbnede (`assigned_owner_id`), så historiske gennemgange beholder deres oprindelige ejer, selv hvis du senere roterer rollen.
- For lukkede cyklusser: hvem der **fuldførte** den (`completed_by`), tidsstemplet, **owner-at-completion**-øjebliksbilledet (kan adskille sig fra den tildelte ejer, hvis du roterede midt i cyklussen) og eventuelle friform-afslutningsnoter.
- For aktiverede cyklusser: **activation timestamp** (så audit kan verificere, at det daglige promoveringsjob blev affyret på den rigtige dag).

Dette overlever år med ejer-rotation rent — audit-svaret på "hvem underskrev gennemgangen i januar 2024?" er en enkelt række væk fra opgaven, ikke tabt til ejerskabs-rebalancering.

### Tilladelser og tildelte

- **Add / edit / delete tasks** — kræver `risks.manage` (admin / bpm_admin / member som standard).
- **Complete the open cycle** — `risks.manage` **eller** brugeren, der aktuelt er tildelt den cyklus. Så en Viewer, der er tildelt en kontrolgennemgang, kan lukke sin egen cyklus uden at eskalere.
- **Skip a cycle / Activate now** — kræver altid fuld `risks.manage`. Skipping rykker gentagelsen frem uden at hævde, at arbejdet var udført; aktivering trækker en planlagt cyklus frem og er en planlægningshandling.

### Promovering fra et TurboLens compliance-fund

Når du klikker på **Create risk** på et ikke-overholdt fund (se [TurboLens](turbolens.md#promote-a-finding-to-the-risk-register)), får den nye risiko også en **engangs-afhjælpningsopgave** frø-startet fra fundets remediation-tekst — så mangelanalysen omdannes til handlingsorienteret, ejet arbejde på stedet.

### Eksport

Risikoregistrets **Export**-knap skriver et to-arks `.xlsx`: ark 1 er det filtrerede risikogitter, ark 2 er én række pr. cyklus på tværs af hver opgave på hver risiko i samme filter-sæt, inklusive lead-time og aktiverings-tidsstempler. Brug det til audit-pakker eller til overdragelse til interessenter, der ikke har et Turbo EA-login. Hver opgaverække i detaljepanelet har også sin egen **Export history**-knap til en pr.-opgave-projektmappe.

## Risikomatrix

Både TurboLens Security Overview og Risikoregister-siden gengiver et 4×4 sandsynlighed × virkning-heatmap. Celler er **klikbare** — klik på en for at filtrere listen nedenfor til bare den bøtte, klik igen (eller chip'ens ×) for at rydde. På Risikoregistret kan du skifte matricen mellem **Initial**- og **Residual**-visninger, så afhjælpningsfremskridt vises visuelt.

## Register-gitter

Registret er et AG Grid, der spejler [Inventar](inventory.md)-standarderne: sorterbare, filterbare, størrelses-justerbare kolonner med vedvarende pr.-bruger-præferencer (synlige kolonner, sorteringsrækkefølge, sidepanel-tilstand). En værktøjslinje **+ New risk** åbner dialogen til manuel oprettelse. Værktøjslinjens **Export**-knap skriver et to-arks `.xlsx` med det filtrerede risikogitter på ark 1 og én række pr. afhjælpningsopgave-cyklus på ark 2 — se [Afhjælpningsopgaver → Eksport](#export) for kolonneformen.

## Risiko ↔ Fund-propagering

Hvis en risiko blev [promoveret fra et TurboLens-fund](turbolens.md#promote-a-finding-to-the-risk-register), flyder tilstandsændringer **begge veje**:

- Fundet bærer et **Open risk R-000123**-tilbagelink fra det øjeblik, det promoveres (handlingen er idempotent — at klikke igen navigerer til den eksisterende risiko i stedet for at oprette en dublet).
- Når risikoen når `mitigated` / `monitoring` / `closed` / `accepted` (eller slettes), overgår tilbagepropagerings­motoren automatisk hvert linket compliance-fund, så det matcher (`mitigated` / `verified` / `accepted` / `in_review`). Den accept-begrundelse, du fanger på risikoen, spejles ind i fundets gennemgangs-note, så audit-sporet forbliver konsistent.

Dette holder Risikoregistret (governance-visningen) og Compliance-gitteret (operationel visning) tilpasset uden manuel vedligeholdelse.

## Status­arbejdsproces

Detaljesiden viser altid en enkelt primær **Next step**-knap plus en mindre række side-handlinger, så den sekventielle vej er åbenlys, men governance-flugtveje forbliver ét klik væk:

| Aktuel tilstand | Next step (primær knap) | Side-handlinger |
|---|---|---|
| identified | Start analysis | Accept risk |
| analysed | Plan mitigation | Accept risk |
| mitigation_planned | Start mitigation | Accept risk |
| in_progress | Mark mitigated | Accept risk |
| mitigated | Start monitoring | Resume mitigation · Close without monitoring |
| monitoring | Close | Resume mitigation · Accept risk |
| accepted | — | Reopen · Close |
| closed | — | Reopen |

Fuld overgangsgraf (håndhævet på serversiden):

```
identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed
       │           │             │                │            ▲           ▲
       └───────────┴─────────────┴────────────────┴──── accepted (rationale required)
                                                              │
                              reopen → in_progress ◄──────────┘
```

- **At acceptere** en risiko kræver en accept-begrundelse. Brugeren, tidsstemplet og begrundelsen registreres på posten.
- **At genåbne** en `accepted` / `closed`-risiko går tilbage til `in_progress`. `mitigated` tillader også en manuel "Resume mitigation" uden behov for en fuld genåbning.

## Tilladelser

| Tilladelse | Hvem får den som standard |
|------------|---------------------------|
| `risks.view` | admin, bpm_admin, member, viewer |
| `risks.manage` | admin, bpm_admin, member |

Viewers kan se registret og risici på kort, men kan ikke oprette, redigere eller slette.
