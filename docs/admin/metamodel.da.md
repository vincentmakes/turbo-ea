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

#### Felter

Felter definerer de brugerdefinerede egenskaber, der er tilgængelige på kort af denne type. Hvert felt har:

| Indstilling | Beskrivelse |
|---------|-------------|
| **Nøgle** | Unik feltidentifikator |
| **Etiket** | Visningsnavn |
| **Type** | text, multiline_text, number, cost, boolean, date, url, single_select eller multiple_select |
| **Indstillinger** | For udvælgelsesfelter: de tilgængelige valg med etiketter og valgfri farver |
| **Påkrævet** | Hvorvidt feltet skal udfyldes for datakvalitetsscoring |
| **Vægt** | Hvor meget dette felt bidrager til datakvalitetsscoren (0-10) |
| **Skrivebeskyttet** | Forhindrer manuel redigering (nyttigt for beregnede felter) |

Klik på **+ Tilføj felt** for at oprette et nyt felt, eller klik på et eksisterende felt for at redigere det i **Feltredigeringsdialogen**.

#### Sektioner

Felter er organiseret i **sektioner** på kortdetaljesiden. Du kan:

- Oprette navngivne sektioner for at gruppere relaterede felter
- Indstille sektioner til **1-kolonne-** eller **2-kolonne**-layout
- Organisere felter i **grupper** inden for en sektion (gengivet som sammenklappelige underoverskrifter)
- Trække felter mellem sektioner og omarrangere dem

Det særlige sektionsnavn `__description` tilføjer felter til Beskrivelsessektionen af kortdetaljesiden.

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
