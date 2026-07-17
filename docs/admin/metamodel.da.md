# Metamodel

**Metamodellen** definerer hele platformens datastruktur — hvilke typer kort der findes, hvilke felter de har, hvordan de relaterer til hinanden, og hvordan kortdetaljesider er opbygget. Alt er **datadrevet**: du konfigurerer metamodellen gennem admin-UI'et, ikke ved at ændre kode.

![Metamodel-konfiguration](../assets/img/en/20_admin_metamodel.png)

Naviger til **Admin > Metamodel** for at få adgang til metamodel-editoren. Den har syv faneblade: **Korttyper**, **Relationstyper**, **Beregninger**, **Tags**, **Metamodel-graf**, **EA-principper** og **Compliance-reguleringer**.

## Korttyper

Fanebladet Korttyper viser alle typer i systemet. Turbo EA leveres med 14 indbyggede typer på tværs af fire arkitekturlag:

| Lag | Typer |
|-------|-------|
| **Strategy & Transformation** | Objective, Platform, Initiative |
| **Business Architecture** | Organization, Business Capability, Business Context, Business Process |
| **Application & Data** | Application, Interface, Data Object |
| **Technical Architecture** | IT Component, Tech Category, Provider, System |

### Oprettelse af en brugerdefineret type

Klik på **+ Ny type** for at oprette en brugerdefineret korttype. Konfigurer:

| Felt | Beskrivelse |
|-------|-------------|
| **Nøgle** | Unik identifikator (små bogstaver, ingen mellemrum) — kan ikke ændres efter oprettelse |
| **Etiket** | Visningsnavn vist i UI'et |
| **Ikon** | Google Material Symbol-ikonnavn |
| **Farve** | Brandfarve for typen (bruges i lager, rapporter og diagrammer) |
| **Kategori** | Arkitekturlag-gruppering |
| **Har hierarki** | Hvorvidt kort af denne type kan have forælder/barn-relationer |

### Redigering af en type

Klik på en hvilken som helst type for at åbne **Typedetaljepanelet**. Her kan du konfigurere:

#### Typefarve

Hver korttype — inklusive de indbyggede — har en farve, der kan tilpasses, og som bruges i inventaret, rapporter, afhængighedsvisninger og diagrammer. Det gør det muligt at tilpasse Turbo EA til organisationens visuelle konventioner (for eksempel TOGAF/ArchiMate-paletter: forretningselementer i gul/orange, applikationer i blå).

- Vælg en farve med farveprøven i panelet. Der vises et hint, når den valgte farve har meget lav kontrast mod lyse eller mørke baggrunde.
- Indbyggede typer viser en **nulstil**-knap ved siden af farveprøven, når farven afviger fra Turbo EA-standarden, så du altid kan vende tilbage til standardpaletten.
- Tekst oven på typefarver (chips, diagramformer) skifter automatisk mellem sort og hvid for læsbarhed, både i lys og mørk tilstand.
- Vælgeren viser en **live-forhåndsvisning** ved siden af paletten: typenavn, chip, kortikon, undertype, kort-ID-pille og en afhængighedsvisningsnode, gengivet én gang i lys og én gang i mørk tilstand, og opdateret mens du vælger.

#### Felter

Felter definerer de brugerdefinerede egenskaber, der er tilgængelige på kort af denne type. Hvert felt har:

| Indstilling | Beskrivelse |
|---------|-------------|
| **Nøgle** | Unik feltidentifikator |
| **Etiket** | Visningsnavn |
| **Type** | text, multiline_text, number, cost, boolean, date, url, single_select eller multiple_select |
| **Indstillinger** | For udvælgelsesfelter: de tilgængelige valg med etiketter og valgfri farver |
| **Påkrævet** | Hvorvidt feltet skal udfyldes for datakvalitetsscoring |
| **Datakvalitet** | Hvert felts bidrag til scoren håndteres i panelet **Datakvalitet** (se nedenfor) |
| **Skrivebeskyttet** | Forhindrer manuel redigering (nyttigt for beregnede felter) |

Klik på **+ Tilføj felt** for at oprette et nyt felt, eller klik på et eksisterende felt for at redigere det i **Feltredigeringsdialogen**.

#### Sektioner

Felter er organiseret i **sektioner** på kortdetaljesiden. Du kan:

- Oprette navngivne sektioner for at gruppere relaterede felter
- Indstille sektioner til **1-kolonne-** eller **2-kolonne**-layout
- Organisere felter i **grupper** inden for en sektion (gengivet som sammenklappelige underoverskrifter)
- Omarranger felter inden for et afsnit ved at trække, og flyt et felt til et andet afsnit via dets **flyt**-handling

Det særlige sektionsnavn `__description` tilføjer felter til Beskrivelsessektionen af kortdetaljesiden.

#### Kort-ID

Slå **generering af kort-ID** til for at give kort af denne type et stabilt, læsbart ID (for eksempel `APP-00001`). ID'et vises som en kopiér-pille ved siden af kortets type på detaljesiden, som en valgfri (sorterbar og filtrerbar) kolonne i inventaret, i Excel-eksporter og i formler for beregnede felter (via `data.reference`).

**Nummeret genereres altid automatisk**; du styrer kun **præfikset**. Når du slår til, vises et foreslået præfiks (udledt af typenavnet, f.eks. `APP-`) som tekst — klik på blyanten for at ændre det. To indstillinger justerer nummeret:

- **Start ved** — det første nummer i serien (standard `1`).
- **Min. cifre** — bredden af nuludfyldningen (standard `5`), så `1` vises som `00001`. Det er et minimum; numrene bliver længere, når de overstiger det. Et **Eksempel** viser live det første ID.

ID'er er **globalt unikke, skrivebeskyttede og genbruges eller ændres aldrig**. Nummersekvensen føres **pr. præfiks på tværs af hele arbejdsområdet**, så to typer med samme præfiks danner én sammenhængende, kollisionsfri serie. Når et kort af denne type har et ID, låses hele formatet — præfiks, start og min. cifre — (felterne bliver skrivebeskyttede); du kan stadig slå generering fra. Lagring tildeler aldrig ID'er til eksisterende kort; brug den dedikerede **Generér ID'er**-knap til at udfylde efterslæbet efter behov (med statuslinje og bekræftelse).

#### Datakvalitetsscore

Et korts **datakvalitetsscore** er et vægtet mål for, hvor komplet det er. Hver bidragende faktor – hvert felt samt fem indbyggede faktorer – håndteres ét sted: fanen **Datakvalitet** i korttypeeditoren. (Editoren er organiseret i faner – Generelt, Relationer, Interessentroller og Datakvalitet – oversættelser er tilgængelige via ikonet i headeren.)

Hver faktors vigtighed angives med en enkel skyder over fire niveauer, der også viser det underliggende tal:

- **Ignorér (0)** – udelukket helt fra scoren.
- **Normal (1)** – tæller én gang (standard).
- **Vigtig (2)** – tæller dobbelt.
- **Kritisk (3)** – tæller tredobbelt.

Panelet viser de fem **indbyggede faktorer** – **Beskrivelse**, **Livscyklus** (om der er angivet en livscyklusdato), **obligatoriske relationer**, **obligatoriske tags** og **Interessentroller** (hver rolle, der er defineret for typen, er opfyldt, når en interessent tildeles) – efterfulgt af hvert felt grupperet efter sin sektion, hver med den samme skyder. Sæt for eksempel **Livscyklus** til *Ignorér* for en type, hvis kort legitimt aldrig har datoer, så de ikke straffes.

En **scorens sammensætning**-bjælke øverst i panelet viser hver faktors andel af den maksimalt mulige score, så du med et blik kan se, hvilke faktorer der dominerer. I kortlayoutet på fanen **Generelt** viser hvert felt – og de indbyggede sektioner Beskrivelse, Livscyklus og Relationer – et lille mærke med sit aktuelle niveaunummer, så du kan se vægtningen uden at forlade fanen.

Ændring af en vigtighed genberegner straks scoren for alle eksisterende kort af den type. Nye felter er som standard *Normal* og tæller derfor med i scoren, så snart du tilføjer dem.

#### Undertyper (sub-skabeloner)

Undertyper fungerer som **sub-skabeloner** inden for en korttype. Hver undertype kan styre, hvilke felter der er synlige for kort af den undertype, mens alle felter forbliver defineret på korttypeniveau.

For eksempel har Application-typen undertyperne: Business Application, Microservice, AI Agent og Deployment. En admin kan skjule serverrelaterede felter for SaaS-undertypen, da de ikke er relevante.

**Konfiguration af feltsynlighed pr. undertype:**

1. Åbn en korttype i metamodel-administrationen.
2. Klik på en hvilken som helst undertype-chip for at åbne dialogen **Undertype-skabelon**.
3. Slå feltsynlighed til/fra ved hjælp af kontakterne — felter, der er slået fra, vil være skjulte for kort af den undertype.
4. Skjulte felter er udelukket fra datakvalitetsscoren, så brugere ikke straffes for felter, de ikke kan se.

Når der ikke er valgt nogen undertype på et kort (eller typen ikke har nogen undertyper), er alle felter synlige. Skjulte felter bevarer deres data — hvis et korts undertype ændres, bevares tidligere skjulte værdier.

#### Interessentroller

Definer brugerdefinerede roller for denne type (f.eks. "Application Owner", "Technical Owner"). Hver rolle bærer **tilladelser på kortniveau**, der kombineres med brugerens applikationsrolle, når der tilgås et kort. Se [Brugere og roller](users.md) for mere om tilladelsesmodellen.

#### Oversættelser

Klik på knappen **Oversæt** i typepanelets værktøjslinje for at åbne **Oversættelsesdialogen**. Her kan du levere oversættelser for alle metamodel-etiketter i hvert understøttet sprog:

- **Type-etiket** — Visningsnavnet for korttypen
- **Undertyper** — Etiketter for hver undertype
- **Sektioner** — Sektionsoverskrifter på kortdetaljesiden
- **Felter** — Feltetiketter og udvælgelsesindstillingsetiketter
- **Interessentroller** — Rollenavne vist i interessenttildelings-UI'et

Oversættelser gemmes sammen med hver korttype og opløses ved render-tid ved hjælp af brugerens valgte lokalitet. Uoversatte etiketter falder tilbage til den engelske standard.

### Sletning af en type

- **Indbyggede typer** soft-slettes (skjules) og kan gendannes
- **Brugerdefinerede typer** slettes permanent

## Relationstyper

Relationstyper definerer de tilladte forbindelser mellem korttyper. Hver relationstype specificerer:

| Felt | Beskrivelse |
|-------|-------------|
| **Nøgle** | Unik identifikator |
| **Etiket** | Etiket for fremadrettet retning (f.eks. "bruger") |
| **Omvendt etiket** | Etiket for baglæns retning (f.eks. "bruges af") |
| **Kildetype** | Korttypen på "fra"-siden |
| **Måltype** | Korttypen på "til"-siden |
| **Kardinalitet** | n:m (mange-til-mange) eller 1:n (en-til-mange) |

Klik på **+ Ny relationstype** for at oprette en relation, eller klik på en eksisterende for at redigere dens etiketter og egenskaber.

### Relationsegenskaber

Nogle relationer bærer ekstra egenskaber, som du angiver på hvert enkelt link i stedet for på relationstypen. For eksempel har den indbyggede relation **Organisation → Applikation** (»bruger«) en **Brugstype**-egenskab — angiv den til **Ejer**, **Bruger** eller **Interessent** på hvert link. Dermed kan du modellere en applikation, der *ejes af* én organisation og *bruges af* andre, via en enkelt relationstype. Den valgte værdi vises som en farvet chip i kortets **Relationer**-sektion; angiv den, når du tilføjer relationen, eller senere via redigeringsikonet på relationsrækken.

Der kan kun findes én relationstype mellem et givet par af korttyper, så brug disse egenskaber til at præcisere betydningen af et link i stedet for at oprette endnu en relationstype for den samme kilde og destination.

### Administrer relationsværdier

Klik på ikonet **Administrer relationsværdier** (etiket) på en relationsrække for at redigere værdierne for dens «type»-attributter. Du kan:

- **Tilføje dine egne værdier** til en eksisterende vælger — for eksempel en ny brugstype ud over Ejer / Bruger / Interessent.
- **Tilføje en helt ny type-vælger** til en relation, der ingen har, via **Tilføj type** — også på indbyggede relationer.

Indbyggede værdier (Ejer, Bruger, Interessent, flowretningsværdierne …) er **låst**: de kan ikke omdøbes, omfarves eller slettes. Du kan dog **skjule** en indbygget værdi, så den ikke længere vises i vælgeren på kort — en allerede valgt værdi forbliver synlig. Dine egne værdier kan redigeres og fjernes frit.

## Beregninger

Beregnede felter bruger admin-definerede formler til automatisk at beregne værdier, når kort gemmes. Se [Beregninger](calculations.md) for den fulde vejledning.

## Tags

Tag-grupper og tags kan administreres fra dette faneblad. Se [Tags](tags.md) for den fulde vejledning.

## EA-principper

Fanebladet **EA-principper** lader dig definere de arkitekturprincipper, der styrer din organisations IT-landskab. Disse principper fungerer som strategiske rettesnore — for eksempel "Genbrug før Køb før Byg" eller "Hvis vi køber, køber vi SaaS".

Hvert princip har fire felter:

| Felt | Beskrivelse |
|-------|-------------|
| **Titel** | Et koncist navn for princippet |
| **Statement** | Hvad princippet siger |
| **Begrundelse** | Hvorfor dette princip er vigtigt |
| **Implikationer** | Praktiske konsekvenser af at følge princippet |

Principper kan **aktiveres** eller **deaktiveres** individuelt ved hjælp af omskifteren på hvert kort.

### Import fra Principkataloget

Turbo EA leveres med et **kurateret referencekatalog med 10 industristandard EA-principper**, så du ikke skal starte fra en blank side. Åbn avatarmenuen i øverste højre hjørne og vælg **Referencekataloger → Principkatalog**. Derfra kan du:

- Søge og browse de medfølgende principper (titel, beskrivelse, begrundelse, implikationer).
- Multi-vælge de poster, du ønsker, og klikke på **Import** — valgte principper lander i EA-principper-fanebladet som standard, fuldt redigerbare rækker.
- Genimportere sikkert: principper, der allerede eksisterer (matchet af deres stabile katalog-ID), springes over, selv hvis du har omdøbt dem lokalt. Kataloget viser et grønt "Allerede importeret"-badge for disse.

Brug kataloget som udgangspunkt, og skræddersy derefter hvert princips titel, statement, begrundelse og implikationer til din organisation.

### Hvordan principper påvirker AI-indsigter

Når du genererer **AI Portfolio Insights** på [Porteføljerapporten](../guide/reports.md#ai-portfolio-insights), inkluderes alle aktive principper i analysen. AI'en evaluerer dine porteføljedata mod hvert princip og rapporterer:

- Hvorvidt porteføljen **stemmer overens med** eller **bryder** princippet
- Specifikke datapunkter som bevis
- Anbefalede korrigerende handlinger

For eksempel ville et "Køb SaaS"-princip få AI'en til at flage on-premise- eller IaaS-hostede applikationer og foreslå prioriteter for cloud-migrering.

## Metamodel-graf

![Metamodel-grafvisualisering](../assets/img/en/38_metamodel_graph.png)

Fanebladet **Metamodel-graf** viser et visuelt SVG-diagram over alle korttyper og deres relationstyper. Dette er en skrivebeskyttet visualisering, der hjælper dig med at forstå forbindelserne i din metamodel ved et blik.

## Compliance-reguleringer

Fanebladet **Compliance-reguleringer** administrerer de regulatoriske rammer, som [GRC → Compliance-scanneren](../guide/grc.md#compliance) kører imod. Seks rammer leveres aktiveret som standard:

| Regulering | Omfang |
|------------|-------|
| **EU AI Act** | Krav til AI-/ML-systemer placeret på EU-markedet |
| **GDPR** | EU's generelle databeskyttelsesforordning |
| **NIS2** | EU's net- og informationssikkerhedsdirektiv 2 |
| **DORA** | EU's Digital Operational Resilience Act for finansielle enheder |
| **SOC 2** | AICPA Service Organization Controls Trust Services Criteria |
| **ISO/IEC 27001** | Informationssikkerhedsledelsesstandard |

For hver række kan du:

- **Aktivere/deaktivere** reguleringen med kontakten — deaktiverede rammer springes over ved hver efterfølgende scanning, og deres fund udelades fra dashboards. Eksisterende fund bevares (slettes ikke), hvis du aktiverer dem igen senere.
- **Redigere** titlen, omfangsbeskrivelsen og promptkonteksten, der bruges af LLM'en.
- **Tilføje en brugerdefineret regulering** med **+ Ny regulering** — for eksempel HIPAA, interne politikker eller sektorspecifikke rammer. Brugerdefinerede reguleringer er førsteklasses: de vises i per-regulering-fanebladet, bidrager til den overordnede compliance-score og understøtter alle de samme fund-handlinger (anerkend, accepter, forfrem til Risiko).
- **Slette** en brugerdefineret regulering — indbyggede reguleringer kan ikke slettes, kun deaktiveres.

Compliance-scanneren og risiko-forfremmelsesflowet fungerer, **selv når ingen AI-udbyder er konfigureret** — manuel fund-indtastning, statusovergange og forfremmelsesstien til Risiko forbliver alle tilgængelige. AI er kun påkrævet, når du faktisk udløser en ny scanning.

## Kortlayout-editor

For hver korttype styrer afsnittet **Layout** i typepanelet, hvordan kortdetaljesiden er struktureret:

- **Sektionsrækkefølge** — Træk sektioner (Beskrivelse, EOL, Livscyklus, Hierarki, Relationer og brugerdefinerede sektioner) for at omarrangere dem
- **Synlighed** — Skjul sektioner, der ikke er relevante for en type
- **Standardudvidelse** — Vælg, om hver sektion starter udvidet eller sammenklappet
- **Kolonnelayout** — Indstil 1 eller 2 kolonner pr. brugerdefineret sektion
- **Flyt felter mellem afsnit** — Brug et felts **flyt**-handling (ved siden af knapperne rediger og slet) til at flytte det til et andet afsnit, mens dets konfiguration bevares

## Ressourcer

Fanen **Ressourcer** administrerer de to lister, der tilbydes på hver karts **Ressourcer**-fane:

- **Linktyper** — kategorien for et dokumentlink (f.eks. *Dokumentation*, *Kontrakt*, *Sikkerhed*). Hver linktype har også et **ikon**, der vises ved siden af linket.
- **Filkategorier** — kategorien, der tildeles en uploadet filvedhæftning.

For hver liste kan du:

- **Tilføje en post** — med en nøgle (en identifikator med små bogstaver, der gemmes på kort og er låst efter oprettelse), en visningsetiket og — for linktyper — et ikon.
- **Redigere** etiket, ikon, sorteringsrækkefølge og oversættelser pr. sprog for enhver post, inklusive de indbyggede.
- **Aktivere / deaktivere** en post med kontakten — deaktiverede poster forsvinder fra vælgeren, men eksisterende værdier på kort bevares.
- **Slette** en brugerdefineret post — indbyggede poster kan ikke slettes, kun deaktiveres.

En indbygget **Kontrakt**-linktype er aktiveret som standard. Begge lister indgår i **Workspace-overførsel**, så dine tilpasninger klones mellem instanser.
