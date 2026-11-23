# EU AI Act Register

EU's AI-forordning finder anvendelse i etaper, og alle udbydere og idriftsættere
af AI-systemer skal besvare de samme fire spørgsmål: Hvilke af jeres systemer er
AI-systemer, hvilket risikoniveau har hvert af dem, hvilke forpligtelser følger af
jeres rolle, og hvor er dokumentationen?

**EU AI Act Register** besvarer dem på de kort, jeres EA-repository allerede
rummer. Det er til udbydere og idriftsættere af AI-systemer og
AI-modeller til almen brug (GPAI), som fører, eller gerne vil føre, deres
it-landskab i Turbo EA.

!!! warning "Det registrerer jeres vurdering — det er ikke juridisk rådgivning"
    Registret er opbygget efter forordning (EU) 2024/1689 som ændret ved
    forordning (EU) 2026/1744. Det registrerer og organiserer jeres
    organisations eget compliancearbejde og de beslutninger, jeres medarbejdere
    træffer. Det er ikke juridisk rådgivning og garanterer ikke
    overensstemmelse.

## Registret lever på jeres kort

Registret fører **ingen egne tabeller** til sit indhold. Hver regulatorisk
egenskab er et felt på et kort, som redigeres i Turbo EA's egen kortvisning med en
hjælpetekst, der henviser til artiklen:

| Registerobjekt | I Turbo EA |
|---|---|
| AI-systemer | **Applikations**-kort med *In AI Act scope* slået til |
| AI-modeller til almen brug | **It-komponent**-kort med *GPAI model (Art. 3(63))* slået til |
| En organisations AI-governance | **Organisations**-kort |

Udvidelsen tilføjer disse sektioner:

| Korttype | Sektion | Indeholder |
|---|---|---|
| **Applikation** | EU AI Act | In AI Act scope, Operator role, Risk tier, Annex III category, Annex I regime, Placed on the market before the high-risk date (Art. 111(2)), Art. 6(3) derogation claimed, Art. 6(3) rationale, Intended purpose, Art. 50 transparency duties, Substantially modified (Art. 25), AI Act classification completeness (%) |
| **Applikation** | EU AI Act — Provider obligations | én status pr. udbyderforpligtelse, fra Art. 9 til Art. 73 |
| **Applikation** | EU AI Act — Deployer obligations | én status pr. idriftsætterforpligtelse i Art. 26, FRIA'en (FRIA required, dens status og dato) og registreringen efter Art. 49(3) |
| **It-komponent** | EU AI Act — GPAI / Model | GPAI model (Art. 3(63)), Model origin, Systemic risk (Art. 51), Training compute (log10 FLOPs), statusserne for forpligtelserne i Art. 53 og Art. 55, AI Act classification completeness (%) |
| **Organisation** | AI governance (EU AI Act) | AI literacy programme (Art. 4), Body governed by public law, AI governance contact |

Hver forpligtelsesstatus er én af **Not started**, **In progress**,
**Implemented** eller **Not applicable**.

Felterne vises kun, hvor de er relevante. En Applikation viser kun kontakten *In
AI Act scope*, indtil den er gemt som omfattet. Derefter vises hver
forpligtelsesstatus kun, hvor forpligtelsen kan gælde for kortets rolle,
risikoniveau og betingelser, feltet *Placed on the market before the high-risk
date (Art. 111(2))* vises på højrisikosystemer, og en It-komponents GPAI-felter
følger dens GPAI-kontakt. En status, der allerede er udfyldt, forbliver synlig, så
den kan ryddes, og skjulte værdier bevares og slettes aldrig.

**Chippen i overskriften.** Hvert kort for et AI-system og en GPAI-model viser
**Obligations implemented** i sin overskrift — for eksempel *Obligations
implemented: 0 of 1*. Dens værktøjstip viser, hvad der stadig er åbent, med hver
forpligtelses status og forfaldsdato, og nævner enhver manglende
klassificeringsoplysning; et klik åbner det systems åbne forpligtelser i
arbejdsområdet. Hvor der intet er at tælle, står der **No AI Act obligations
apply**, **AI Act obligations: classify first** eller **Prohibited practice
(Art. 5)**.

![Et AI-systemkort med sin EU AI Act-sektion og chippen i overskriften](../assets/img/en/107_ext_eu_ai_act_card.png)

### To mål

Registret rapporterer to tal, og de besvarer forskellige spørgsmål — et system kan
være fuldt klassificeret og alligevel have intet implementeret.

| | Classification completeness | Obligations implemented |
|---|---|---|
| **Spørgsmål** | Hvor meget af klassificeringen er registreret? | Hvor mange af de gældende forpligtelser er opfyldt? |
| **AI-systemer** | Operator role, risikoniveau, tilsigtet formål og, for højrisikosystemer, kategorien i bilag III eller ordningen i bilag I | De forpligtelser, der gælder for systemet efter rolle, risikoniveau og valgte pligter |
| **GPAI-modeller** | Modellens oprindelse og klassificering af systemisk risiko | Forpligtelserne i Art. 53, plus Art. 55 for en model med systemisk risiko |
| **Vist** | Kortfeltet *AI Act classification completeness (%)*, overblikket | Chippen i kortets overskrift, overblikket, Register og fanen Obligations |

**Implemented** og **Not applicable** tæller som opfyldt; **In progress** og **Not
started** gør ikke. Hvor der ikke er nogen procentdel, siger registret hvorfor:
**No obligations apply**, **Classify first** (rolle eller risikoniveau endnu ikke
sat) eller **Prohibited practice** (intet at implementere — systemet skal
udfases eller omdesignes, så det kommer ud af Art. 5).

## Kort fortalt

| | |
|---|---|
| **Licens** | Kommerciel — en underskrevet rettighed er påkrævet |
| **Mindsteversion af Turbo EA** | 2.186.0 |
| **Tilladelser** | `ext.eu-ai-act.view`, `ext.eu-ai-act.manage`, `ext.eu-ai-act.submit`, `ext.eu-ai-act.admin` |
| **Dataadgangsrettigheder** | `core.cards.read`, `core.cards.write`, `core.users.read`, `metamodel.custom_field_types` |
| **Genstart af backend påkrævet** | Ja — den leveres med backend-kode |
| **Hvor den vises** | **EU's AI-forordning** i menuen **GRC**, med syv faneblade (et punkt på øverste niveau, når GRC-menuen ikke er tilgængelig for jer) · **Rapporter → EU's AI-forordning - Dashboard** (overblikket som en rapport, der kan gemmes) · sektionerne EU AI Act og chippen **Obligations implemented** på kort · fire spørgeskemaskabeloner · Excel-registerprojektmappen og Word-dokumenterne Annex IV / FRIA |

Den beriger også **EU AI Act**-reguleringen i kernens
[compliance-scanner](../guide/compliance.md), hvis AI-fund fodrer
[Forslag](#forslag).

## Kom i gang

1. **Åbn EU AI Act → Settings.** Kontroller **Taxonomy baseline**, sæt en
   **Reference date**, hvis frister skal vurderes mod en anden dato end i dag, og
   indlæs eventuelt demodata.
2. **Find de AI-systemer, I allerede har.** Tryk på **Find suggestions** under
   **Suggestions**, og acceptér de systemer og modeller, der hører med i
   omfanget.
3. **Klassificér hvert system** under **Classify**, og acceptér resultatet på dets
   kort.
4. **Følg forpligtelserne** under **Obligations**, og registrér hver status på
   kortet.
5. **Frys et øjebliksbillede** under **Audit**, og download registerprojektmappen
   samt dokumenterne Annex IV og FRIA fra **Register**.

!!! tip "Indsaml dataene hos dem, der ejer dem"
    Fire spørgeskemaskabeloner under **Administration → Undersøgelser → Ny fra
    skabelon** indsamler AI Act-felterne hos kortenes ejere: **AI system intake
    (EU AI Act)**, **Provider obligations check (EU AI Act)**, **Deployer
    obligations check (EU AI Act)** og **GPAI model check (EU AI Act)**. Hver åbner
    som en kladde, adresseret til kortenes ansvarlige interessenter.

## Arbejdsområdet

**EU's AI-forordning** i menuen **GRC** har syv faneblade: **Dashboard**, **Register**,
**Classify**, **Obligations**, **Suggestions**, **Audit** og **Settings**. Hver
liste i det er et Turbo EA-gitter med den samme sidepanel som Lager — en fane
**Filters** (søgning på tværs af alle kolonner samt facetter som risikoniveau,
rolle, status, alvorlighed eller frist) og en fane **Columns** (vis, skjul og frys
kolonner, husket pr. gitter). En række, der nævner et kort, åbner det i kortpanelet.

### Overblik

Fem fliser — **AI systems in scope**, **High-risk**, **Unclassified**, **GPAI
models** og **Overdue obligations** — der hver åbner rækkerne bag deres tal, og en
linje **Validation** med de blokerende fund og advarsler samt et link **Open
audit**. Nedenunder:

- **Risk-tier distribution** på tværs af systemerne i omfanget.
- **Compliance quadrant** — hvert system afsat efter regulatorisk eksponering (de
  gældende forpligtelser) mod **Obligations implemented**, i fire områder: **Act
  now**, **On track**, **Monitor** og **Comfortable**. Systemer på samme position
  deler én skive, der viser, hvor mange der er der. Systemer uden procentdel
  afsættes ikke; en linje under diagrammet tæller dem.
- **Ranked by urgency** — de samme systemer som en liste, med en kolonne for hvert
  mål. Et klik på et system åbner dets **statusdialog**: begge mål med deres
  opdeling, de klassificeringsoplysninger, der stadig mangler, og de åbne
  forpligtelser med status og forfaldsdato, med **Open card** og **Show in
  Obligations**.
- **Applicability timeline (Art. 113)** — milepælene i tabellen under
  [Forpligtelser](#forpligtelser), hver markeret som gældende eller under
  nedtælling.

![EU AI Act-overblikket](../assets/img/en/104_ext_eu_ai_act_dashboard.png)

### Register

To visninger — **AI systems** og **GPAI models** — hver et gitter over kortene i
registret. For et system viser det risikoniveau, rolle, klassificeringsgrundlag,
**Obligations implemented** (et klik åbner det systems åbne forpligtelser) og antal
forfaldne; for en model dens oprindelse, systemiske risiko, træningsberegning og de
systemer, der bruger den. **New AI system** og **New GPAI model** opretter et kort
med den rigtige type og kontakten forudindstillet, og **Open in inventory** viser de
samme kort i Lager. En registerrække *er* sit kort: klik på den for at redigere
AI Act-sektionerne i kortdetaljen.

Kolonnen **Documents** i visningen AI systems tilbyder to Word-downloads pr.
system, forududfyldt fra repositoryet: **Annex IV.docx**, den tekniske
dokumentation efter bilag IV, og **FRIA.docx**, skelettet til
konsekvensanalysen vedrørende grundlæggende rettigheder efter Art. 27. Begge
begynder med en note om den forenklede bilag IV-formular for SMV'er og små
mid-cap-virksomheder (Art. 11(1)) og om genbrug af konsekvensanalysen vedrørende
databeskyttelse (Art. 27(4)).

### Classify

Klassificeringsguiden stiller en række vejledte spørgsmål om ét system og foreslår
et risikoniveau med artiklen bag hver begrundelse. Vælg systemet under **Classify a
system**, og svar:

1. **AI system or not** — er dette et AI-system i Art. 3(1)'s forstand? Hvis ikke,
   er udfaldet **Out of scope**.
2. **Role** — jeres organisations operatørrolle for dette system, og om I har ændret
   det væsentligt, mærket det med jeres eget mærke eller ændret dets tilsigtede
   formål (hvilket kan gøre jer til dets udbyder efter Art. 25).
3. **Prohibited practices (Art. 5)** — herunder de to praksisser, som forordning
   (EU) 2026/1744 forbyder fra 2. december 2026: realistisk intimt eller seksuelt
   eksplicit materiale af en identificerbar person uden samtykke (Art. 5(1)(ba)) og
   materiale med seksuelt misbrug af børn (Art. 5(1)(bb)). Hver angiver, hvem der er
   berørt, som udbyder eller som idriftsætter. En udbyder af et system, der
   genererer billeder, video, lyd eller tekst, bliver også spurgt, om systemet kan
   frembringe sådant materiale, og om sikkerhedsforanstaltninger pålideligt
   forhindrer det; kun svaret, at sådanne foranstaltninger ikke er på plads, gør det
   til en forbudt praksis.
4. **High risk under Annex I** — et produkt eller et produkts sikkerhedskomponent
   under den opregnede EU-lovgivning. Efter en ordning spørger guiden, om et grundlag
   i Art. 6(1a)–(1c) tager systemet ud af Art. 6(1): det bruges udelukkende til
   aspekter, der ikke vedrører sikkerhed, eller produktet vurderes af en tredjepart
   kun for andre risici end sundhed og sikkerhed.
5. **High risk under Annex III** — om det tilsigtede formål falder ind under en
   anvendelse i bilag III, og om systemet profilerer fysiske personer.
6. **The Art. 6(3) derogation** — om en undtagelsesbetingelse gælder. En påberåbt
   undtagelse skal dokumenteres i **Art. 6(4) rationale**; den tekst skrives til
   kortet, og valideringen blokerer uden den.
7. **Transparency duties (Art. 50)** — oplysning om chatbots, mærkning af syntetisk
   indhold, meddelelser om følelsesgenkendelse samt mærkning af deepfakes og tekster
   af almen interesse.

**Evaluate** viser den **Proposed classification** med de artikelhenviste
begrundelser og skriver intet til kortet. **Accept & write to card** skriver
klassificeringsfelterne til kortet — rolle, risikoniveau, grundlag, undtagelse og
gennemsigtighedspligter — og registrerer vurderingen som den accepterede.

At køre guiden kræver udvidelsens administrationstilladelse og et kort, I må åbne;
at acceptere kræver desuden redigeringsret til det kort. Hvis I må åbne kortet, men
ikke redigere det, kan I stadig køre guiden og se forslaget, men **Accept & write to
card** er nedtonet og angiver årsagen: *You may not edit this card, so the
classification cannot be written to it.*

![Klassificeringsguiden med en foreslået klassificering](../assets/img/en/105_ext_eu_ai_act_classify.png)

**Vurderingshistorikken er revisionssporet.** Hver kørsel bevares — hvem der har
klassificeret hvilket system, hvornår og hvorfor — så spørgsmålet *«hvorfor er dette
system højrisiko, og hvem besluttede det?»* stadig kan besvares år senere. Hver række
nævner kortet (et arkiveret kort er markeret **archived**, et kort, der ikke længere
findes, vises som **Deleted card**), personen, der kørte den, under **By**,
risikoniveauet og status: **Draft**, **Accepted** eller **Superseded**. Køres guiden
igen, tilføjes en ny post; accepteres den, markeres den tidligere accepterede som
**Superseded** og ændres aldrig. En vurderings detaljer viser **Run by**,
**Accepted by** og, når en senere har erstattet den, **Superseded by** med datoen —
en erstattet post beholder, hvem der accepterede den. For poster, der blev erstattet
før version 1.6.0, kendes kun den person, der erstattede dem, så **Accepted by**
viser «—». Historikken viser kun vurderinger af kort, I må åbne. Kolonnen
**Taxonomy baseline** er skjult som standard; slå den til under **Columns**.

### Forpligtelser

Hver gældende forpligtelse for hvert AI-system — eller, når der skiftes til **GPAI
model**, for hver GPAI-model — i ét gitter: kortet, gruppen, forpligtelsen,
artiklen, status, forfaldsdato, milepælen og et **Evidence hint**, der siger,
hvilket bevis forpligtelsen forventer. Filtrér efter status, gruppe og frist
(forfalden, **Due soon**, **Later**), eller vælg ét enkelt kort på værktøjslinjen.
Statusserne er kortfelter, så I registrerer dem ved at åbne kortet; en forpligtelse,
der ikke er opfyldt til sin dato, er forfalden, og en, der endnu ikke forfalder,
viser **Due soon** fra 180 dage før sin dato.

Hvilke forpligtelser der gælder, følger af hvert systems rolle, risikoniveau og
betingelser — i alt 32 forpligtelser for udbydere, idriftsættere og GPAI-modeller på
det ændrede grundlag. Deres datoer er fasede som ændret ved forordning (EU)
2026/1744:

| Dato | Milepæl | Artikel |
|---|---|---|
| 2. februar 2025 | Forbudte praksisser og AI-færdigheder | Art. 113(a) |
| 2. august 2025 | Forpligtelser for AI-modeller til almen brug | Art. 113(b) |
| 2. august 2026 | Generel anvendelse (inkl. gennemsigtighed efter Art. 50) | Art. 113 |
| 2. december 2026 | Yderligere forbudte praksisser (Art. 5(1)(ba), (bb)) | Art. 113(a) |
| 2. december 2027 | Højrisiko-AI-systemer efter bilag III | Art. 113(c)(i) |
| 2. august 2028 | Højrisiko-AI i regulerede produkter efter bilag I | Art. 113(c)(ii) |
| 2. august 2030 | Højrisiko-AI, der allerede er på markedet, beregnet til offentlige myndigheder | Art. 111(2) |

Frister vurderes mod **Reference date** i Settings (i dag, når den er tom). Tre
regler former listen:

- **Bilag I afsnit B (Art. 2(2)).** Et system, der kun er højrisiko gennem et produkt
  omfattet af bilag I afsnit B — køretøjer, luftfart, skibsudstyr, jernbane og
  maskiner — bærer ingen AI Act-forpligtelse i registret og viser **No obligations
  apply**. Statusser, der allerede er registreret, bliver på kortet, uden at blive
  talt med. Et system, der også falder ind under en anvendelse i bilag III,
  beholder alle sine forpligtelser.
- **Systemer, der allerede er på markedet (Art. 111(2)).** Registrér på et
  højrisikosystems kort, om det var *Placed on the market before the high-risk date
  (Art. 111(2))*. Bragt i omsætning før den dato uden væsentlig ændring af designet:
  højrisikoforpligtelserne lægges til side (gennemsigtighed efter Art. 50 tæller
  stadig); bragt i omsætning før den dato og beregnet til brug af offentlige
  myndigheder: de flyttes til 2. august 2030; væsentligt ændret, ikke bragt i
  omsætning før den dato eller lades tomt: de gælder fuldt ud.
- **Registrering af et system med undtagelse (Art. 49(2)).** En udbyder, der
  påberåber sig undtagelsen i Art. 6(3), har endnu en forpligtelse: at registrere
  systemet i EU-databasen som vurderet til ikke at være højrisiko.

![Fanen Obligations på tværs af alle AI-systemer](../assets/img/en/106_ext_eu_ai_act_obligations.png)

### Forslag

**Find suggestions** gennemgår jeres kort og foreslår registerbeslutninger, hver med
sin dokumentation:

- **AI Act scope** — en Applikation, der endnu ikke er taget stilling til, og som har
  en af kernens AI-undertyper (**AI Agent**, **MCP Server**) eller er markeret af
  compliance-scanneren som havende AI-funktioner.
- **GPAI check** — en It-komponent, der endnu ikke er taget stilling til, med
  undertypen **AI Model**, et scannerflag, eller som bruges af systemer, der allerede
  er i omfanget.
- **Bootstrap checklist** — et højrisikosystem, hvor ingen af de gældende
  forpligtelser endnu har en status; at acceptere den sætter hver af dem til **Not
  started**, så arbejdet bliver synligt.

En stribe over listen linker til compliance-scannerens egne EU AI Act-fund.

Intet skrives til et kort, før en person trykker på **Accept** på en række;
**Dismiss** fjerner den fra listen. Statussen — **Proposed**, **Accepted** eller
**Dismissed** — vælges i sidepanelet. At acceptere kræver redigeringsret til kortet
ud over administrationstilladelsen; uden dem er **Accept** nedtonet og angiver: *You
may not edit this card, so the suggestion cannot be written to it.*

### Audit

- **Live validation** — fundene for registret, som det står på referencedatoen, hver
  med sin alvorlighed (**Blocking** eller **Warning**), regel, artikel, kort og
  meddelelse; **Open card** åbner det kort, der skal rettes.
- **Rule coverage** — de regler, en maskine ikke kan kontrollere. De rapporteres som
  ikke udført, fordi de kræver et menneske, i stedet for at blive sprunget stiltiende
  over.
- **Snapshots** — **Freeze snapshot** indfanger registret på en **Reference date**.
  Hvert øjebliksbillede gennemgår derefter tre tilstande:
    1. **Draft** — tryk på **Validate** for at kontrollere det.
    2. **Validated** — tryk på **Finalize**. Afvises, så længe et blokerende fund
       består.
    3. **Final** — øjebliksbilledet er uforanderligt, en del af revisionssporet og
       kan ikke længere valideres igen eller slettes.

  **XLSX** downloader et øjebliksbillede som Excel-registerprojektmappen (det
  kræver indsendelsestilladelsen). Et endeligt øjebliksbillede downloades altid
  uændret: dets indhold kontrolleres mod den hash, der blev fastlåst, da det blev
  færdiggjort. Et øjebliksbillede i kladde beholder de datoer og fund, det blev taget
  med — tag et nyt efter en opgradering, der ændrer reglerne.

### Indstillinger

**Taxonomy baseline** — den regulering, som alle projektioner og frister udledes af.
**ai-act-2026-omnibus**, forordningen som ændret ved forordning (EU) 2026/1744, er
standarden; **ai-act-2024**, forordningen som vedtaget med sine oprindelige datoer,
kan stadig vælges, så vurderinger og øjebliksbilleder taget mod den forbliver
læsbare.

**Reference date** — frister vurderes mod denne dato; tom betyder i dag.

**Demo data** — **Load demo data** opretter et lille demolandskab: alle risikoniveauer,
en GPAI-model med systemisk risiko, et spor af accepterede vurderinger og materiale
til forslag. Alle demokort har *(AI demo)* i navnet; **Remove demo data** sletter
dem igen.

## Hvem der ser og må hvad

- **I ser kun de systemer, hvis kort I må åbne.** Registret, forpligtelserne,
  overblikkets tal og tidslinje, fundene, forslagene, vurderingshistorikken og
  dokumenterne Annex IV / FRIA viser en person kun de systemer, hvis kort vedkommende
  må åbne i Lager, og hvert tal — antal, procentdele, forfaldne punkter, blokerende
  fund — beregnes ud fra det, vedkommende kan se. Et kort, som et synligt system
  henviser til, men som I ikke må åbne, vises som **Card not accessible**. Hvor noget
  er udeladt, siger overblikket og Register det i én linje: *Some systems are not
  shown because you do not have access to their cards.* Hvor der intet er tilbage at
  vise, viser overblikket og fanen Obligations den samme linje i stedet for en tom
  liste. En rolle, der kun har udvidelsens tilladelse og ingen adgang til kortene, ser
  derfor ingen systemer.
- **Øjebliksbilleder dækker hele registret.** Øjebliksbilleder og deres
  Excel-downloads er det officielle register: de rummer alle systemer og filtreres
  aldrig, uanset hvem der kigger. Alle med visningstilladelsen ser listen over
  øjebliksbilleder på fanen Audit; at downloade et kræver indsendelsestilladelsen.
  Gennem API'et returneres et øjebliksbilledes gemte indhold til personer med
  indsendelsestilladelsen og til personer, som registret intet skjuler for; andre
  modtager kun dets dato, grundlag og status.
- **At acceptere kræver to rettigheder.** **Accept & write to card** og at acceptere
  et forslag kræver udvidelsens tilladelse `ext.eu-ai-act.manage` **og**
  redigeringsret til kortet. Den, der må åbne kortet, men ikke redigere det, kan
  stadig køre guiden og se forslaget; knappen er nedtonet med sin årsag, og intet
  skrives. For at lade vedkommende acceptere skal I give vedkommendes rolle
  redigeringsret til korttypen eller gøre vedkommende til interessent på kortet i en
  rolle, der må redigere. At køre guiden eller at acceptere eller afvise et forslag
  på et kort, I ikke må åbne, afvises.
- **Kortets historik nævner, hvem der accepterede.** På Turbo EA 2.209.0 og senere
  registreres en ændring foretaget af **Accept & write to card** eller af et
  accepteret forslag under fanen Historik på kortet i navnet på den person, der
  foretog den, med chippen **Extension**. Tidligere versioner viser **System**.
  Indlæsning eller fjernelse af demodata registreres som udvidelsen.
- **Vurderingshistorikken viser kun visningsnavne** — aldrig en e-mailadresse. Hvor
  navne ikke kan læses, vises «—».

## Tilladelser

| Tilladelse | Giver |
|---|---|
| `ext.eu-ai-act.view` | Se registret over AI-systemer, overblik og valideringsresultater |
| `ext.eu-ai-act.manage` | Køre klassificeringer, redigere AI Act-data og træffe beslutning om forslag |
| `ext.eu-ai-act.submit` | Fryse øjebliksbilleder af registret og downloade registereksporter |
| `ext.eu-ai-act.admin` | Konfigurere AI Act-indstillinger (taksonomiversion, referencedato, demodata) |

Redigering af selve registerdataene bruger også jeres almindelige
kortredigeringsrettigheder, da hvert AI Act-felt lever på et kort.

## Hvis licensen udløber, eller udvidelsen deaktiveres

Arbejdsområdet og dets rapport forsvinder, men **intet slettes**. Jeres AI Act-data
ligger på almindelige kort, så hver værdi forbliver præcis, hvor den er, synlig og
redigerbar i lageret. Anvendelse af en fornyet licens genopretter arbejdsområdet med
det samme.

## Noter og begrænsninger

- Valideringen dækker det, en maskine kan kontrollere. De regler, den ikke kan
  kontrollere, er opført under **Rule coverage** som ikke udført; betragt en ren
  validering som en tjekliste, ikke som en dom om overensstemmelse.
- Kortfelterne deles af begge grundlag, og et kort kan ikke se, hvilket der er valgt.
  Under **ai-act-2024** skjuler et højrisikokort med en bilag I afsnit B-ordning
  forpligtelsesstatusser, som det grundlag stadig tæller, og feltet for Art. 111(2)
  vises, selv om det grundlag ignorerer det. Registret, overblikket og eksporterne
  følger altid det valgte grundlag.
- Guidens svarmuligheder vises på jeres sprog, hvor grundlaget leverer en
  oversættelse.
- Efter opgradering fra en tidligere version skal I køre guiden igen for AI i
  regulerede produkter (grundene i bilag I) og for indholdsgenererende systemer
  (spørgsmålet om sikkerhedsforanstaltninger) og registrere Art. 111(2)-statussen for
  højrisikosystemer, der allerede er på markedet.
