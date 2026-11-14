# ArchiMate-diagrammer

**ArchiMate**-editoren tegner [ArchiMate 3](https://pubs.opengroup.org/architecture/archimate3-doc/)-diagrammer oven på dine kort: du placerer elementer fra standardnotationen (Business Process, Application Component, Node osv.), forbinder dem med de relationer, som sproget tillader, og knytter om ønsket hvert element til et kort i din beholdning. Et diagram gemmes som en **ArchiMate Model Exchange File** (The Open Groups XML-format, version 3.1) og kan derfor udveksles med andre ArchiMate-værktøjer.

!!! warning "Versionens status"
    Denne version leverer ArchiMate-fundamentet som en **sandkasse for administratorer**. Modulet er som standard slået fra, diagrammerne vises ikke i menuen [Diagrammer](diagrams.md), og de kan endnu ikke publiceres eller indlejres. Se [Kendte begrænsninger](#known-limits).

Den øverste række viser diagramnavnet, kortfarver, kortindhold og synkronisering. Synkronisering opdaterer data for tilknyttede kort. Rækken nedenunder indeholder tegneværktøjer, zoom, SVG-eksport og egenskabspanelet. Brug **Punktgitter** til at vise eller skjule prikkerne i baggrunden. Browseren husker dit valg for hvert diagram.

## Slå modulet til

1. Åbn **Admin → Indstillinger** og find kortet **ArchiMate-diagrammer** (ved siden af de øvrige modulkontakter).
2. Slå det til. Kortet viser **ArchiMate er slået til**.
3. Du kan slå det fra igen når som helst. Diagrammerne bevares; mens modulet er slået fra, kan siderne ikke nås, og den, der følger et direkte link, ser den almindelige pladsholder for "modul deaktiveret".

## Åbn sandkassen

Mens modulet er slået til, oprettes og åbnes ArchiMate-diagrammer fra siden **Diagrammer** og fra fanen **Resources** på ethvert kort, de refererer til. `/admin/architectureStudio` er stadig listen over dine ArchiMate-diagrammer, hvor du kan oprette, åbne og slette dem; det kræver en tilladelse på mindst ét ArchiMate-lag og et slået-til modul. I editoren fører **Tilbage** til den side, du kom fra.

<!-- Planned screenshot (added with the screenshot capture): 102_archimate_sandbox -->

## Dit første diagram

1. Skriv i sandkassen et **Navn** under **Nyt ArchiMate-diagram**, og tryk på **Opret**. Editoren åbnes.
2. **Placér elementer.** Paletten viser elementtyperne grupperet efter lag (Strategi, Forretning, Applikation, Teknologi, Fysisk, Motivation, Implementering og migrering, Andet). Træk en post hen på lærredet, eller brug tastaturet: gå til en post, og tryk på **Enter** eller **Space** for at placere elementet midt i det synlige område. Et nyt element åbner straks sit navn til redigering.
3. **Tegn en relation.** Markér et element: kontekstpanelet omkring det tilbyder poster af typen **Tegn** *relation*. Vælg en, og klik derefter på målelementet. Kun de par, som ArchiMate-relationstabellen tillader, kan forbindes: en post tilbydes kun, hvis sproget tillader den relation fra dette element til mindst én elementtype, og et mål, som tabellen ikke tillader, afvises. Markér en forbindelse for at ændre dens **adgangstype** (for Access) eller retning (for Association).
4. **Knyt et element til et kort.** Markér elementet, og brug kontekstpanelet:
    - **Knyt til et kort** åbner en vælger, der er begrænset til de korttyper, som svarer til denne elementtype (se [Mappingen](#mapping)).
    - **Opret et kort** spørger om en korttype og et navn, opretter kortet og knytter det i ét trin.
    - **Åbn det tilknyttede kort** og **Fjern tilknytningen til kortet** vises, når et kort er knyttet.

    Tilknytninger er altid eksplicitte. At placere et element opretter **aldrig** et kort, og at fjerne et element fra diagrammet (**Fjern fra diagrammet**) sletter **aldrig** et kort. Ved gemning synkroniseres den mængde kort, diagrammet er knyttet til, som for andre diagrammer.
5. **Gem.** Editoren gemmer af sig selv tre sekunder efter din sidste ændring; knappen **Gem** gemmer med det samme. Status viser *Gemmer…*, *Gemt* eller *Ugemte ændringer*.

!!! warning "En mislykket gemning forbliver synlig"
    Hvis en gemning mislykkes, forbliver fejlen synlig med en knap **Prøv igen**, diagrammet forbliver markeret som ugemt, og intet kasseres i det stille. Hvis du forlader siden (lukker fanen, bruger browserens Tilbage-knap eller åbner en anden side i appen), mens der er ugemte eller mislykkede ændringer, bliver du først bedt om bekræftelse.

## Mappingen {#mapping}

**Mappingen** angiver, hvilket ArchiMate-begreb en korttype, undertype eller relationstype i Turbo EA svarer til. Editoren læser den for at afgøre, hvilke kort der kan knyttes til hvilket element. Hver korttype, undertype og relationstype bærer en ArchiMate-elementtype eller -relationstype; en relation bærer desuden et **retningsflag** (når det er sat, tegnes ArchiMate-relationen fra målkortet til kildekortet; for eksempel er "Organisation *bruger* Applikation" en ArchiMate-relation af typen *Serving* fra applikationen til organisationen) og, for Access, en **adgangstype**.

!!! note
    I denne version er mappingen **skrivebeskyttet**: Den indeholder standardværdierne nedenfor. Administrationsskærmen til at ændre den (**ARCHI MAP** under **Admin → Metamodel**) kommer senere. Denne version opretter eller ændrer ikke kortrelationer ud fra en tegnet relation.

Navnene på elementer og relationer er dem fra The Open Groups udvekslingsformat. En korttype, hvis element er tomt (`—`), har ingen standardmapping, så dens kort kan ikke knyttes, før en elementtype er angivet. En undertype bruger sin egen mapping, hvis den har en, og ellers korttypens.

### Korttyper og undertyper

| Korttype | ArchiMate-element |
|---|---|
| Mål | `Goal` |
| Mål › Forretningsmål | `Goal` |
| Mål › Værdiport | `Assessment` |
| Platform | `Grouping` |
| Initiativ | `WorkPackage` |
| Organisation | `BusinessActor` |
| Organisation › Region | `Location` |
| Forretningskompetence | `Capability` |
| Forretningskontekst | — |
| Forretningskontekst › Proces | `BusinessProcess` |
| Forretningskontekst › Værdistrøm | `ValueStream` |
| Forretningskontekst › Kunderejse | `BusinessProcess` |
| Forretningskontekst › Forretningsprodukt | `Product` |
| Forretningskontekst › ESG-kompetence | `Capability` |
| Forretningsproces | `BusinessProcess` |
| Forretningsproces › Proceskategori | `BusinessFunction` |
| Forretningsproces › Procesgruppe | `BusinessFunction` |
| Applikation | `ApplicationComponent` |
| Grænseflade | `ApplicationInterface` |
| Dataobjekt | `BusinessObject` |
| IT-komponent | `Node` |
| IT-komponent › Software | `SystemSoftware` |
| IT-komponent › Hardware | `Device` |
| IT-komponent › SaaS | `TechnologyService` |
| IT-komponent › PaaS | `TechnologyService` |
| IT-komponent › IaaS | `TechnologyService` |
| IT-komponent › Service | `TechnologyService` |
| IT-komponent › AI-model | `SystemSoftware` |
| Teknologikategori | `Grouping` |
| Udbyder | `BusinessActor` |

### Relationstyper

For en Access-relation betyder `crud`, at adgangstypen følger relationens egne Create/Read/Update/Delete-flag: kun læsning giver Read, enhver oprettelse, opdatering eller sletning giver Write, begge dele giver Read/Write, og ingen af dem giver almindelig Access. Relationer af typen "efterfølger" findes for hver korttype, der har dem, og svarer til Association, bortset fra den for Business Context, som har sin egen række i tabellen.

| Relation | ArchiMate-relation | Bemærkning |
|---|---|---|
| Mål → Forretningskompetence, *forbedrer* | `Association` | — |
| Platform → Mål, *understøtter* | `Influence` | — |
| Platform → Applikation, *kører* | `Aggregation` | — |
| Platform → IT-komponent, *implementerer* | `Aggregation` | — |
| Initiativ → Mål, *understøtter* | `Influence` | — |
| Initiativ → Platform, *påvirker* | `Association` | — |
| Initiativ → Forretningskompetence, *forbedrer* | `Association` | — |
| Initiativ → Applikation, *påvirker* | `Association` | — |
| Initiativ → Grænseflade, *påvirker* | `Association` | — |
| Initiativ → Dataobjekt, *påvirker* | `Association` | — |
| Initiativ → IT-komponent, *påvirker* | `Association` | — |
| Organisation → Mål, *ejer* | `Association` | — |
| Organisation → Initiativ, *ejer* | `Assignment` | — |
| Organisation → Forretningskontekst, *ejer* | `Association` | — |
| Organisation → Applikation, *bruger* | `Serving` | tegnet fra målet til kilden |
| Organisation → IT-komponent, *ejer* | `Association` | — |
| Applikation → Forretningskompetence, *understøtter* | `Realization` | — |
| Applikation → Forretningskontekst, *understøtter* | `Association` | — |
| Applikation → Grænseflade, *leverer / forbruger* | `Association` | — |
| Applikation → Dataobjekt, *CRUD* | `Access` | adgangstype ud fra CRUD-flagene |
| Applikation → IT-komponent, *bruger* | `Serving` | tegnet fra målet til kilden |
| IT-komponent → Teknologikategori, *tilhører* | `Aggregation` | tegnet fra målet til kilden |
| IT-komponent → Platform, *implementerer* | `Aggregation` | tegnet fra målet til kilden |
| Grænseflade → Dataobjekt, *overfører* | `Association` | — |
| Grænseflade → IT-komponent, *bruger* | `Association` | — |
| Udbyder → Initiativ, *understøtter* | `Association` | — |
| Udbyder → Applikation, *tilbyder* | `Association` | — |
| Udbyder → IT-komponent, *tilbyder* | `Association` | — |
| Forretningskontekst → Forretningskompetence, *er forbundet med* | `Association` | — |
| Forretningsproces → Forretningskompetence, *understøtter* | `Realization` | — |
| Forretningsproces → Applikation, *understøttes af* | `Serving` | tegnet fra målet til kilden |
| Forretningsproces → Dataobjekt, *bruger* | `Access` | adgangstype ud fra CRUD-flagene |
| Forretningsproces → IT-komponent, *bruger* | `Serving` | tegnet fra målet til kilden |
| Forretningsproces → Forretningsproces, *afhænger af* | `Association` | — |
| Forretningsproces → Forretningsproces, *kalder* | `Triggering` | — |
| Forretningsproces → Organisation, *ejes af* | `Assignment` | tegnet fra målet til kilden |
| Forretningsproces → Initiativ, *er påvirket af* | `Association` | — |
| Forretningsproces → Mål, *understøtter* | `Influence` | — |
| Forretningsproces → Forretningskontekst, *realiserer* | `Realization` | — |
| Mål → Forretningskontekst, *er mål for* | `Association` | — |
| Forretningskontekst → Forretningskontekst, *efterfølger* | `Triggering` | tegnet fra målet til kilden |

Højreklik på en forbindelseslinje, og vælg **Lige** eller **Retvinklet**. Linjen beholder ruten, når du flytter en node, og når du gemmer og genåbner diagrammet.

## Exchange-filen {#exchange-file}

Værktøjslinjen tilbyder **Eksportér som Exchange-fil** og **Importér en Exchange-fil** samt **Eksportér som SVG** til et billede.

- **Eksport** henter diagrammet som en ArchiMate Model Exchange File (`.xml`, format 3.1).
- **Import** erstatter alt i det åbne diagram efter en bekræftelse (**Erstat diagrammet?**). Diagrammer lavet med andre værktøjer (som Archi) kan læses, hvis de følger The Open Groups format.
- Filer på over 5 MB afvises, det samme gælder filer med en DOCTYPE- eller entitetsdeklaration.

**Hvad der ikke bevares ved import:**

- **Mapper** (sektionen `organizations`): De kasseres, og editoren fortæller dig det.
- **Noter, grupper og almindelige forbindelser** fra andre værktøjer: Etiketter og beholdere uden et element bag sig samt forbindelser uden en relation ignoreres.
- **Egenskabstyper andre end string**: Hver egenskabsdefinition læses som en streng.
- **Andre sprog for et navn**: Der bevares kun ét navn pr. element, relation og visning.
- Skrifttyper og anden formatering ud over det grundlæggende bevares ikke.

## Kontrollér modellen

Knappen **Kontrollér modellen** på værktøjslinjen sender det aktuelle diagram til serveren, som validerer det efter The Open Groups udvekslingsregler og viser hvert problem, den finder (højst 100). Hver meddelelse har en kode; tegnet `…` står for det berørte navn eller den berørte identifikator:

| Code | Meddelelse |
|---|---|
| `too_large` | Modellen er større end 5 MB. |
| `xml_invalid` | Modellen er ikke velformet XML. |
| `dtd_forbidden` | DOCTYPE- og entitetsdeklarationer er ikke tilladt. |
| `wrong_root` | Rodelementet er ikke en ArchiMate-model. |
| `missing_identifier` | Et element, en relation eller en diagramknude har ingen identifikator. |
| `unknown_element_type` | Ukendt elementtype: … |
| `unknown_relationship_type` | Ukendt relationstype: … |
| `unknown_access_type` | Ukendt adgangstype på … |
| `duplicate_identifier` | Dubleret identifikator: … |
| `dangling_source` | Relationen … starter fra noget, der ikke findes. |
| `dangling_target` | Relationen … ender ved noget, der ikke findes. |
| `relationship_not_allowed` | ArchiMate tillader ikke relationen …: hverken mellem disse to elementer eller fra en relation til sig selv. |
| `dangling_element_ref` | Diagramknuden … viser et element, der ikke findes. |
| `dangling_relationship_ref` | Diagramforbindelsen … viser en relation, der ikke findes. |
| `connection_endpoint_mismatch` | Diagramforbindelsen … forbinder ikke knuderne i sin relation. |

Relationskontrollen afviser også en relation, der peger på en anden relation, medmindre den er en Association, Aggregation eller Composition. Hvis der intet er at rapportere, står der i dialogen **Ingen problemer fundet.**

## Tastaturgenveje

Tryk på **Tastaturgenveje** på værktøjslinjen for at se listen. Klik først på lærredet, så det har fokus.

| Handling | Genvej |
|----------|--------|
| Fortryd | `Ctrl+Z` |
| Gentag | `Ctrl+Y` / `Ctrl+Shift+Z` |
| Kopiér | `Ctrl+C` |
| Indsæt | `Ctrl+V` |
| Slet | `Delete` / `Backspace` |
| Omdøb | `F2` / `Enter` |
| Markér alt | `Ctrl+A` |
| Zoom ind | `Ctrl++` |
| Zoom ud | `Ctrl+-` |
| Tilpas til skærmen | `Ctrl+0` |

På paletten placerer `Enter` eller `Space` på en post med fokus det pågældende element.

## Kendte begrænsninger {#known-limits}

- **Der redigeres én visning pr. fil.** Indeholder en importeret fil flere visninger, redigeres den første, og de øvrige bevares uændrede ved gemning.
- **Relationer mellem relationer** (en Association, Aggregation eller Composition, der peger på en anden relation) læses og skrives, og kontrollen accepterer dem, men de tegnes ikke.
- **Det kræver musen at tegne en relation.** Tastaturet kan placere elementer, men ikke forbinde dem.
- **Placeringer med tastaturet stables.** Hvert element, der placeres med `Enter` eller `Space`, havner midt i det synlige område, så efterfølgende placeringer overlapper, indtil du flytter dem.
- **Endnu ingen publicering.** ArchiMate-diagrammer kan ikke publiceres eller indlejres og vises ikke i menuen **Diagrammer**; du når dem fra sandkasselisten eller fra fanen **Resources** på et kort, de refererer til.
- **Samlingspunkter (junctions) har ingen etiket.** Et And- eller Or-samlingspunkt er blot en prik.
- Mappingen er skrivebeskyttet (se [Mappingen](#mapping)), og mapper kasseres ved import (se [Exchange-filen](#exchange-file)).

---

ArchiMate® er et registreret varemærke tilhørende The Open Group. Turbo EA tegner ArchiMate-notationen og er ikke certificeret af The Open Group.
