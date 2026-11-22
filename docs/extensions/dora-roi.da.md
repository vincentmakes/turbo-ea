# DORA Register of Information

Enhver finansiel enhed i EU skal føre et **informationsregister** over alle sine
aftaler med tredjepartsleverandører af IKT og indberette det årligt gennem sin
tilsynsmyndighed — 15 sammenhængende skemaer, afleveret som en maskinlæsbar
xBRL-CSV-pakke efter EBA's indberetningsramme. I ESA'ernes prøvekørsel i 2024
bestod kun 6,5 % af registrene alle datakvalitetskontroller.

De data, registret har brug for, er præcis dem, jeres EA-repository allerede
rummer. **DORA Register of Information** gør Turbo EA til jeres register.

## Registret lever på jeres kort

Denne udvidelse fører **ingen egne tabeller** over registerindholdet. Hvert
registerobjekt er et kort eller en relation:

| Registerobjekt | I Turbo EA |
|---|---|
| Juridiske enheder i omfanget | **Organisation**-kort med *In DORA register scope* slået til |
| Filialer | **Organisation**-kort med undertypen **Branch**, underlagt deres hovedkontor |
| IKT-tredjepartsleverandører | **Provider**-kort |
| Kontraktuelle aftaler | **ICT Arrangement**-kort (en ny korttype) |
| IKT-ydelser | **ICT Service**-kort (en ny korttype) |
| Kritiske eller vigtige funktioner | **Forretningskapabilitet**- / **Forretningsproces**-kort markeret som registerfunktioner |
| Underskrivende, anvendende og leverende parter samt underleverandørkæder | **Relationer** mellem disse kort |

Det er hele designet: hvert felt redigeres i Turbo EA's egen kortvisning — med
obligatoriske markeringer, validering, hjælpetekst og datakvalitetsscore — og
registret samles løbende ud fra kortene, hver gang I validerer eller eksporterer.

![ICT Service-kort i inventaret med deres DORA-score](../assets/img/en/73_ext_dora_cards.png)

!!! note "Der er bevidst ingen DORA-fane på kortet"
    De tilføjede felter vises som almindelige attributafsnit på et kort, og hver
    registerforbindelse er en helt normal relation. Intet ved at føre registret er
    en særlig tilstand.

## Kort fortalt

| | |
|---|---|
| **Licens** | Kommerciel — kræver en signeret licensrettighed |
| **Mindste Turbo EA-version** | 2.182.0 |
| **Rettigheder** | `ext.dora-roi.view`, `ext.dora-roi.manage`, `ext.dora-roi.submit`, `ext.dora-roi.admin` |
| **Tilladelser til dataadgang** | `core.cards.read`, `core.cards.write`, `metamodel.custom_field_types` |
| **Genstart af backend nødvendig** | ja — indeholder backend-kode |
| **Hvor den vises** | **DORA-register** i menuen **GRC** (et punkt på øverste niveau, når GRC-menuen ikke er tilgængelig for jer) · **Rapporter → DORA-register - Overblik** · afsnittene **DORA Register** og **DORA Function** på kort · seks undersøgelsesskabeloner |

## Hvad den føjer til jeres metamodel

**To nye korttyper**

- **ICT Arrangement** — en kontraktuel aftale om brug af IKT-ydelser. Den er
  **hierarkisk**: overordnede aftaler er forældre, og efterfølgende eller
  tilknyttede aftaler er deres børn. Bærer den årlige udgift og valutaen.
- **ICT Service** — én pr. ydelse leveret under en aftale, med både ydelseslinjen
  (type, datoer, opsigelsesvarsler, gældende lov, placeringer, afhængighedsgrad)
  og dens **vurdering** (substituerbarhed, exitplan, hjemtagning, konsekvens ved
  ophør, alternative leverandører). Dens tre placeringsfelter — **Country of
  provision of the services**, **Location of the data at rest** og **Location of
  data management** (hvor data behandles) — tilbyder hver **Not applicable**. En
  ydelse uden registreret placering af databehandlingen blokerer for at færdiggøre
  et øjebliksbillede: vælg landet, eller **Not applicable**, hvis ydelsen ikke
  indebærer databehandling.

**Én ny undertype** — **Branch** på Organisation.

**Nye afsnit på eksisterende korttyper**

| Korttype | Afsnit | Indhold |
|---|---|---|
| **Organisation** | DORA Register | I DORA-registerets omfang, LEI, land, enhedstype, placering i koncernen, kompetent myndighed, samlede aktiver, indberetningsvaluta, filialkode |
| **Provider** | DORA Register | LEI, identifikatortype, EUID, anden identifikationskode, persontype, hovedsædets land, koncernintern leverandør, årlig udgift, øverste moderselskab |
| **Forretningskapabilitet** / **Forretningsproces** | DORA Function | DORA-registerfunktion, funktionsidentifikator, tilladelseskrævende aktivitet, kritikalitets- eller vigtighedsvurdering, begrundelse for kritikalitet, dato for seneste vurdering, RTO, RPO, konsekvens ved ophør |

Hvert afsnit bærer desuden en skrivebeskyttet **DORA-score (%)** — en
fuldstændighedsbjælke, der viser, hvor mange registerdata det pågældende kort
stadig mangler.

**Ni relationstyper**, hvoraf to bærer attributter, I sætter pr. relation:

- **Organisation → ICT Arrangement** (*er part i*) bærer attributten **DORA-roller**:
  **underskrivende enhed**, **anvender IKT-ydelserne**, **leverende enhed
  (koncernintern)**.
- **ICT Service → Provider** (*leveres af*) bærer en **rang i
  forsyningskæden**: **rang 1** er den direkte leverandør, og dybere rangtrin er
  underleverandører.

Udvidelsen føjer desuden en **DORA**-regulering til kernens
[compliance-scanner](../guide/compliance.md).

## Kom i gang

Arbejdsområdet åbner på **Overblik** med en tjekliste **Getting started**, der
følger disse syv trin og viser fremdriften.

![DORA-registerets overblik](../assets/img/en/72_ext_dora_dashboard.png)

1. **Vælg den indberettende enhed under Indstillinger** — den enhed, registret
   tilhører.
2. **Markér jeres juridiske enheder.** Udfyld afsnittet **DORA Register** på hvert
   Organisation-kort: slå *In DORA register scope* til, og angiv LEI, land,
   enhedstype og placering i koncernen. Filialer er Organisation-kort med
   undertypen **Branch**, underlagt deres hovedkontor.
3. **Opret et ICT Arrangement-kort pr. kontraktuel aftale.** Gør efterfølgende
   kontrakter til *børn* af hovedkontrakten — det er derfra aftaletypen og
   henvisningen til den overordnede aftale udledes.
4. **Forbind hver aftale** med dens Provider-kort og med de enheder, der
   underskriver, anvender eller leverer, og sæt attributten **DORA-roller** på hver
   enkelt.
5. **Opret ét ICT Service-kort pr. ydelse**, og forbind det derefter med dets
   kontrakt, med de enheder der anvender det, med de funktioner det understøtter, og
   med dets leverandører **med rangangivelse**.
6. **Markér funktionerne.** Slå *DORA register function* til på de
   Forretningskapabilitet- eller Forretningsproces-kort, der er kritiske eller
   vigtige funktioner, og udfyld deres afsnit **DORA Function** — eller accepter
   forslagene fra [Forslag](#forslag).
7. **Validér registret, og ryd op i bemærkningerne.**

!!! tip "Indsaml data hos dem, der har dem"
    Seks undersøgelsesskabeloner under **Admin → Undersøgelser → Ny fra skabelon**
    indhenter de obligatoriske data hos de kortansvarlige: **DORA entity data**,
    **DORA provider data**, **DORA arrangement data**, **DORA ICT service data**
    samt **DORA function data** for kapabiliteter og for processer. Hver åbnes som
    udkast.

### Det I aldrig behøver at taste

Registret udleder følgende i stedet for at spørge: moderselskabets LEI (fra
korthierarkiet), integrations- og ophørsdatoer (fra kortets livscyklus),
aftaletypen og henvisningen til den overordnede aftale (fra aftalehierarkiet),
filialens karakter (fra undertypen Branch), modtageren af en underleveret ydelse
(fra leverandørrangeringen) samt datoen for seneste opdatering. Også
**leverandøromfanget** udledes: kun de Provider-kort, som en aftale eller en
forsyningskæde faktisk henviser til, kommer i registret, så uvedkommende
leverandører holdes automatisk udenfor. ITS-udfyldningskonventionerne
(`9999-12-31` for datoer uden ophør, *not applicable* for ikke-efterfølgende
aftaler) anvendes for jer.

## Arbejdsområdet

**DORA-register** i menuen **GRC** har fem faneblade. Det samme overblik findes
også som en rapport, der kan gemmes, under **Rapporter → DORA-register - Overblik**.

### Overblik

Seks felter — **Register completeness**, **Blocking findings**, **Warnings**,
**Critical functions**, **Providers**, **Arrangements** — over knappen **Validate
now** og en linje, der oplyser, hvor mange af EBA's aktive regler der blev udført,
med et link **Rules not run** (se [Validering](#validering)). Nedenunder fører en
række tællere direkte ind i inventaret for hvert registerobjekt, og tabellen
**Template completeness** viser rækker og bemærkninger pr. skema.

![Tabellen «Template completeness»](../assets/img/en/74_ext_dora_template_completeness.png)

Et klik på et antal bemærkninger åbner **Validation findings**: én række pr.
bemærkning med dens alvorlighed (**Blocking** eller **Warning**), skema,
registerrække, kort, regel, kolonne og besked samt filtre på alvorlighed, skema,
korttype og regel. Reglen er en af **Missing**, **Missing key value**, **Invalid
value**, **Invalid LEI**, **Duplicate row**, **Broken reference**, **Unknown
column** eller **EBA rule**. Et klik på en bemærkning eller på dens handling
**Open card** åbner det kort, der skal rettes, i et sidepanel; en bemærkning om
indberetningsindstillingerne tilbyder i stedet **Open settings**. Knappen **Rules
not run** åbner den liste, der er beskrevet under [Validering](#validering).

### Register

Seks visninger — **Legal entities**, **Branches**, **Contractual arrangements**,
**ICT third-party providers**, **ICT services** og **Functions** — hver som en
tabel over de kort, der udgør netop den del af registret, med et søgefelt, en knap
**New …**, der opretter et kort med den rette type og de rette markeringer, og et
link **Open in inventory**. Et klik på en række åbner kortet i et sidepanel.

### Forslag

**Find suggestions** gennemgår jeres relationer Leverandør → Applikation →
Kapabilitet/Proces og foreslår opdateringer af registret — funktioner I ikke har
markeret, og opjusteringer af kritikalitet — hver med den bagvedliggende
dokumentation. Intet skrives, før I trykker **Accept** på en række; **Dismiss**
fjerner den fra listen.

### Indberetninger

**New snapshot** fastholder registret på en **referencedato**. Hvert øjebliksbillede
gennemløber derefter tre tilstande:

1. **Draft** — tryk **Validate** for at kontrollere det. Bemærkningerne vises med
   alvorlighed, skema, række, kolonne og besked.
2. **Validated** — tryk **Finalize**. Handlingen afvises, så længe der er en
   **blokerende** bemærkning tilbage, eller så længe der ikke er sat en
   indberettende enhed med LEI. Blokerende bemærkninger omfatter en ydelse uden
   placering af databehandlingen, ethvert andet nøglefelt, der er tomt, hvor det
   gælder, og en leverandørs LEI, der ikke opfylder ISO 17442-formatet eller
   kontrolsummen (**Invalid LEI**).
3. **Final** — øjebliksbilledet er uforanderligt, dets pakkehash er låst fast til
   revision, det bevarer de bemærkninger og den regeldækning, det blev kontrolleret
   med, og det kan hverken slettes eller valideres igen.

To downloads er tilgængelige hele tiden:

- **xBRL-CSV package** — en DORA-rapportpakke bygget efter taksonomien i EBA-rammen
  4.0 (DORA-modul 1.1.0) som en `.zip` med rapportens metadata,
  indberetningsindikatorer, parametre og én CSV pr. skema. Dens filnavn bærer den
  indberettende enheds ISO-landekode. En leverandør med både LEI og EUID
  indberettes med begge: LEI som identifikationskode og EUID som yderligere
  identifikationskode. Pakken er byte for byte reproducerbar, og en fornyet
  download af et endeligt øjebliksbillede kontrolleres mod dets fastlåste hash.
- **Excel workbook** — en gennemgangsmappe med forside, ét ark pr. skema med EBA's
  kolonnenavne og -koder samt et arkregister, så registret kan cirkulere internt
  før indberetningen.

Før hver udgave, der ændrer eksporten, valideres pakken bygget ud fra
demoregistret med Arelle, den open source XBRL-processor, mod den taksonomi i
ramme 4.0, som EBA har offentliggjort, herunder taksonomiens egne
valideringspåstande. Det dækker pakkens struktur, ikke EBA's modtagelseskontroller
eller dens registeropslag: om jeres tilsynsmyndigheds portal godtager filen, er en
særskilt test, I selv foretager.

### Indstillinger

**Filing** — **Filing scope** (**Consolidated (.CON)** eller **Individual
(.IND)**), **Reporting currency**, **Taxonomy version** og **Reporting entity**,
hvis LEI og land bestemmer rapportpakken.

**Definitions (B_99.01)** — valgfrie fritekstdefinitioner af de termer fra lukkede
lister, jeres register anvender, indberettet som skema B_99.01.

**Demo data** — **Load demo data** indlæser et komplet eksempelregister
(koncernenheder og en filial, leverandører, overordnede og koncerninterne aftaler,
en forsyningskæde i tre led, kritiske funktioner, forslag og et øjebliksbillede i
kladde), så I kan afprøve alle funktioner, før I rører rigtige data. Alle
demokort hedder *Demo DORA — …* og er mærket **Demo Dora**; **Remove demo data**
fjerner dem igen.

## De 15 skemaer

| Skema | Indhold |
|---|---|
| B_01.01 | Enhed, der fører informationsregistret |
| B_01.02 | Liste over enheder i omfanget |
| B_01.03 | Liste over filialer |
| B_02.01 | Kontraktuelle aftaler – generelle oplysninger |
| B_02.02 | Kontraktuelle aftaler – specifikke oplysninger |
| B_02.03 | Liste over koncerninterne kontraktuelle aftaler |
| B_03.01 / B_03.02 / B_03.03 | Underskrivende parter |
| B_04.01 | Enheder, der anvender IKT-ydelserne |
| B_05.01 | IKT-tredjepartsleverandører |
| B_05.02 | Forsyningskæder for IKT-ydelser |
| B_06.01 | Identifikation af funktioner |
| B_07.01 | Vurdering af IKT-ydelserne |
| B_99.01 | Definitioner |

## Validering

Valideringen foregår i fire lag: **struktur** (datatyper, LEI-kontrolcifre, datoer,
tal samt obligatoriske felter og nøglefelter som blokerende, når de er tomme),
**medlemmer** (værdier fra lukkede lister holdt op mod taksonomiens kodelister),
**nøgler** (fuldstændighed og entydighed af primærnøgler samt henvisninger på tværs
af skemaer) og **de EBA-valideringsregler, der kan køre offline**, med de
offentliggjorte alvorlighedsgrader. Regler, som EBA har trukket tilbage, udføres
ikke.

En leverandørs EUID kontrolleres mod EUID-formatet: landekoden og registrets
identifikator, et punktum og derefter registreringsnummeret. En værdi uden punktum
eller en LEI indtastet som EUID rapporteres som en advarsel. Én lokal kontrol er
strengere end EBA's: en leverandørs identifikationskode erklæret som LEI, der ikke
opfylder ISO 17442-formatet eller kontrolsummen, er en blokerende bemærkning
**Invalid LEI**, mens EBA's egen regel er en advarsel. En ugyldig LEI for en
leverandørs øverste moderselskab forbliver en advarsel.

!!! warning "Dækningen er delvis — og det oplyses ærligt"
    Turbo EA udfører de EBA-regler, der kan afgøres offline, og overblikket oplyser,
    hvor mange af EBA's aktive regler der blev udført. **Rules not run**, som åbnes
    fra denne oplysning eller fra valideringsbemærkningerne, viser hver anden regel
    med dens skema, EBA's egen tekst og årsagen til, at den ikke kører her: et **EBA
    expression** ud over offline-kontrollerne, som tilsynsmyndighedens systemer
    evaluerer på den fil, I indsender, eller en **Package check**, som EBA anvender
    på den indsendte rapportpakke frem for på registret. Det nævner også de regler
    for LEI, EUID og land, der her kun kører som offline-kontroller af kontrolsum,
    format og kodeliste, hvor EBA slår koderne op i GLEIF og i
    virksomhedsregistrene (BRIS). Betragt en ren validering som en solid
    forkontrol — ikke som en garanti for, at tilsynsmyndigheden godtager
    indberetningen.

## Rettigheder

| Rettighed | Tillader |
|---|---|
| `ext.dora-roi.view` | At se registret, overblikkene og valideringsresultaterne |
| `ext.dora-roi.manage` | At redigere registerdata og træffe afgørelse om forslag |
| `ext.dora-roi.submit` | At låse øjebliksbilleder på en referencedato og hente rapportpakker |
| `ext.dora-roi.admin` | At konfigurere indberetningsindstillinger og indlæse eller fjerne demodata |

At redigere selve registerdataene kræver desuden jeres almindelige
redigeringsrettigheder til kort, eftersom hvert registerfelt ligger på et kort.

## Hvis licensen udløber, eller udvidelsen deaktiveres

Arbejdsområdet og dets rapporter forsvinder, og broen til kortdata standser, men
**intet slettes**. Jeres register lever på helt almindelige kort og relationer, så
hver værdi bliver præcis, hvor den er — synlig og redigerbar i inventaret.
Øjebliksbilleder og indstillinger bevares. En fornyet licens genskaber
arbejdsområdet med det samme.

Ser I *The card-data bridge is unavailable*, er udvidelsen installeret, men ikke
licenseret — eller backend'en er ikke genstartet, siden den blev installeret.

## Bemærkninger og begrænsninger

- **Version 2.0.0 var en brydende ændring.** Registre bygget på tidligere versioner
  gemte ydelser og funktioner i udvidelsens egne tabeller; de rækker overføres
  ikke. Indtast dem på ny som ICT Service- og funktionskort (eller genindlæs
  demodataene), og kør **Find suggestions** igen.
- Skabeloner, kodelister og regler leveres som versionerede data genereret ud fra
  den offentliggjorte EBA-ramme, så en ny udgave af rammen kommer som en
  opdatering af udvidelsen plus et skift af **Taxonomy version**.
- **DORA-scoren** på et kort er et triagesignal, ikke en afgørelse om compliance.
  Det er overblikkets bemærkninger, der er den autoritative liste over huller.
- Der laves ikke Excel-varianter målrettet den enkelte tilsynsmyndighed;
  xBRL-CSV-pakken er indberetningsartefaktet.
