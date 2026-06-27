# Kortdetaljer

Når du klikker på et kort i lageret, åbnes **detaljevisningen**, hvor du kan se og redigere alle oplysninger om komponenten.

![Kortdetalje­visning](../assets/img/en/04_card_detail.png)

## Kortets sidehoved

Toppen af kortet viser:

- **Type-ikon og etikette** — Farvekodet korttype-indikator
- **Kortnavn** — Redigerbar inline
- **Undertype** — Sekundær klassifikation (hvis relevant)
- **Godkendelsesstatus-badge** — Draft, Approved, Broken eller Rejected
- **AI suggest-knap** — Klik for at generere en beskrivelse med AI (synlig når AI er aktiveret for denne korttype, og brugeren har redigeringstilladelse)
- **Datakvalitets­ring** — Visuel indikator for informationsfuldstændighed (0–100%)
- **Handlingsmenu** — Arkivér, slet og godkendelseshandlinger. Indeholder også en ét-klik **Observe this card**-skifter (når korttypen definerer en Observer-rolle), så enhver bruger med læseadgang kan følge kortet uden at skulle gå gennem Stakeholders-fanen.

### Godkendelses­arbejdsproces

Kort kan gå gennem en godkendelses­cyklus:

| Status | Betydning |
|--------|-----------|
| **Draft** | Standardtilstand, endnu ikke gennemgået |
| **Approved** | Gennemgået og accepteret af en ansvarlig part |
| **Broken** | Var godkendt, men er blevet redigeret siden — kræver gen-gennemgang |
| **Rejected** | Gennemgået og afvist, kræver rettelser |

Når et godkendt kort redigeres, ændres dets status automatisk til **Broken** for at angive, at det kræver gen-gennemgang.

## Detalje-fane (hoved)

Detalje-fanen er organiseret i **sektioner**, der kan omarrangeres og konfigureres af en administrator pr. korttype (se [Kortlayout-editor](../admin/metamodel.md#card-layout-editor)).

### Beskrivelses-sektion

- **Description** — Rich text-beskrivelse af komponenten. Understøtter AI-forslagsfunktionen til automatisk generering
- **Yderligere beskrivelsesfelter** — Nogle korttyper inkluderer ekstra felter i beskrivelses-sektionen (f.eks. alias, ekstern ID)

### Livscyklus-sektion

Livscyklus-modellen sporer en komponent gennem fem faser:

| Fase | Beskrivelse |
|------|-------------|
| **Plan** | Under overvejelse, endnu ikke startet |
| **Phase In** | Bliver implementeret eller udrullet |
| **Active** | Aktuelt operationel |
| **Phase Out** | Bliver afviklet |
| **End of Life** | Ikke længere i brug eller understøttet |

Hver fase har en **datovælger**, så du kan registrere, hvornår komponenten er trådt eller vil træde ind i den fase. En visuel tidslinje-bjælke viser komponentens position i sin livscyklus.

### Brugerdefinerede egenskabs-sektioner

Afhængigt af korttypen vil du se yderligere sektioner med **brugerdefinerede felter** konfigureret i metamodellen. Felttyper inkluderer:

- **Text** — Friform tekstindtastning
- **Multi-line Text** — Friform tekstindtastning, der bevarer linjeskift, gengivet som et auto-voksende tekstområde
- **Number** — Numerisk værdi
- **Cost** — Numerisk værdi vist med platformens konfigurerede valuta
- **Boolean** — On/off-skifter
- **Date** — Datovælger
- **URL** — Klikbart link (valideret for http/https/mailto)
- **Single select** — Dropdown med foruddefinerede muligheder
- **Multiple select** — Multi-valg med chip-visning

Felter markeret som **calculated** viser et badge og kan ikke redigeres manuelt — deres værdier beregnes af [admin-definerede formler](../admin/calculations.md).

### Hierarki-sektion

For korttyper der understøtter hierarki (f.eks. Organization, Business Capability, Application):

- **Parent** — Kortets forælder i hierarkiet (klik for at navigere)
- **Children** — Liste over barnekort (klik på et for at navigere)
- **Hierarki-brødkrumme** — Viser den fulde sti fra rod til aktuelt kort

### Relations-sektion

Viser alle forbindelser til andre kort, grupperet efter relations­type. For hver relation:

- **Relateret kortnavn** — Klik for at navigere til det relaterede kort
- **Relations­type** — Forbindelsens karakter (f.eks. "uses", "runs on", "depends on")
- **Tilføj relation** — Klik på **+** for at oprette en ny relation; vælgeren viser matchende kort, så snart den åbnes (sorteret efter navn, flere indlæses, når du ruller), og indtastning filtrerer listen
- **Fjern relation** — Klik på slet-ikonet for at fjerne en relation

### Tags-sektion

Anvend tags fra de konfigurerede [tag-grupper](../admin/tags.md). Afhængigt af gruppe-tilstanden kan du vælge ét tag (single select) eller flere tags (multi select).

### Resources-fane

**Resources**-fanen konsoliderer al understøttende materiale for et kort:

- **Architecture Decisions** — ADR'er linket til dette kort, vist som farvede piller, der matcher deres korttype-farver (f.eks. blå for Application, lilla for Data Object). Du kan linke eksisterende ADR'er eller oprette en ny ADR direkte fra Resources-fanen — den nye ADR linkes automatisk til kortet.
- **Filvedhæftninger** — Upload og administrer filer (PDF, DOCX, XLSX, billeder, op til 10 MB). Når du uploader, skal du vælge en **dokumentkategori** fra: Architecture, Security, Compliance, Operations, Meeting Notes, Design eller Other. Kategorien vises som en chip ved siden af hver fil.
- **Dokumentlinks** — URL-baserede dokumentreferencer. Når du tilføjer et link, skal du vælge en **linktype** fra: Documentation, Security, Compliance, Architecture, Operations, Support eller Other. Linktypen vises som en chip ved siden af hvert link, og ikonet skifter baseret på den valgte type.
- **Diagrams** — Link eksisterende [diagrammer](diagrams.md) til dette kort. Linkede diagrammer vises som miniature-forhåndsvisninger, som du kan klikke på for at åbne i diagramredaktøren. Brug knappen **Link Diagram** til at søge efter og vedhæfte et eksisterende diagram, eller klik på afkoblingsikonet for at fjerne tilknytningen.

### EOL-sektion

Hvis kortet er linket til et [endoflife.date](https://endoflife.date/)-produkt (via [EOL-administration](../admin/eol.md)):

- **Produktnavn og version**
- **Support-status** — Farvekodet: Supported, Approaching EOL, End of Life
- **Nøgle-datoer** — Udgivelsesdato, aktiv support slut, sikkerheds-support slut, EOL-dato

## Kommentarer-fane

![Kortets kommentar­sektion](../assets/img/en/05_card_comments.png)

- **Tilføj kommentarer** — Efterlad noter, spørgsmål eller beslutninger om komponenten
- **Trådede svar** — Svar på specifikke kommentarer for at oprette samtaletråde
- **Tidsstempler** — Se hvornår hver kommentar blev sendt og af hvem

## Todos-fane

![Todos tilknyttet et kort](../assets/img/en/06_card_todos.png)

- **Opret todos** — Tilføj opgaver linket til dette specifikke kort
- **Tildel** — Sæt en ansvarlig person for hver opgave
- **Forfaldsdato** — Sæt frister
- **Status** — Skift mellem Open og Done
- **Tilbagevendende** — Slå **Gentag** til, så en opgave gentages efter en tidsplan (hver N dage, uger, måneder eller år); når den fuldføres, oprettes den næste forekomst automatisk

## Stakeholders-fane

![Kortets interessenter](../assets/img/en/07_card_stakeholders.png)

Interessenter er personer med en specifik **rolle** på dette kort. De tilgængelige roller afhænger af korttypen (konfigureret i [metamodellen](../admin/metamodel.md)). Almindelige roller inkluderer:

- **Application Owner** — Ansvarlig for forretningsbeslutninger
- **Technical Owner** — Ansvarlig for tekniske beslutninger
- **Brugerdefinerede roller** — Yderligere roller som defineret af din administrator

Interessenttildelinger påvirker **tilladelser**: en brugers effektive tilladelser på et kort er kombinationen af deres app-niveau-rolle og enhver interessentrolle, de har på det kort.

### Søgning og invitation

Vælg en interessent via den **søgbare autocomplete** — begynd at skrive, og dropdownen filtrerer på både navn og e-mail (e-mail vises som den sekundære linje, så to brugere med samme navn kan skelnes med et øjekast).

Hvis den e-mail, du skriver, ikke matcher en eksisterende bruger, vises muligheden **"Invite «email» as a new user"** i slutningen af dropdownen. Vælger du den, udvides en inline mini-formular lige inde i vælgeren — vælg en rolle (Member eller Viewer som standard), rediger eventuelt visningsnavnet, og indsend. Den nye bruger inviteres via standard-invitations-e-mailen **og** tildeles den valgte interessentrolle på kortet i én enkelt handling, så du aldrig behøver at forlade kortet for at onboarde en bidragsyder.

Invitations-stien kræver tilladelsen **`users.invite`**, en delegeret form af `admin.users`, som administratorer kan give til betroede medlemmer. En privilegie-eskalerings-vagt forhindrer ikke-administratorer i at invitere brugere ind i admin-roller — rolle-dropdownen filtrerer stille til roller, som indbyderen har lov til at delegere.

## History-fane

![Kortets ændringshistorik](../assets/img/en/08_card_history.png)

Viser det **komplette audit-spor** over ændringer foretaget på kortet: **hvem** der foretog ændringen, **hvornår** den blev foretaget, og **hvad** der blev ændret (tidligere værdi vs. ny værdi). Dette giver fuld sporbarhed over alle ændringer over tid.

## Risks-fane (GRC aktiveret, når til stede)

Når [GRC-modulet](grc.md) er aktiveret **og** kortet har mindst én linket risiko, vises en **Risks**-fane, der viser hver risiko linket til kortet med en ét-klik-vej tilbage til [Risikoregistret](risks.md). Fanen er auto-skjult, når ingen risiko er linket, så kort uden GRC-aktivitet ikke bærer en tom fane.

## Compliance-fane (GRC aktiveret, når til stede)

Når [GRC-modulet](grc.md) er aktiveret **og** kortet har mindst ét linket compliance-fund, vises en **Compliance**-fane, der viser hvert fund, der aktuelt er linket til kortet. De samme Acknowledge / Accept / **Create risk** / **Open risk**-handlinger som [GRC Compliance-gitteret](compliance.md) er tilgængelige, så kortets ejer kan triagere sine egne fund uden at forlade kortet. Auto-skjult, når intet fund er linket.

## Process Flow-fane (kun forretningsproceskort)

For **Business Process**-kort vises en yderligere **Process Flow**-fane med en indlejret BPMN-diagram-viewer/-editor. Se [BPM](bpm.md) for detaljer om procesflow-styring.

## PPM-fane (kun Initiative-kort)

Når [PPM-modulet](ppm.md) er aktiveret, viser **Initiative**-kort en yderligere **PPM**-fane som den sidste fane. Klikker du på denne fane, navigeres til PPM Initiativ-detaljevisningen, hvor du kan administrere statusrapporter, budgetter, risici, opgaver og Gantt-tidslinjer.

## Arkivering

Kort kan **arkiveres** (soft-deleted) via handlingsmenuen. Arkiverede kort:

- Er skjult fra standard-lager-visningen (synlige kun med "Show archived"-filteret)
- Bliver automatisk **permanent slettet efter 30 dage**
- Kan gendannes inden 30-dages-vinduet udløber
