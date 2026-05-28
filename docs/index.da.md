# Introduktion til Turbo EA

### Hvad er Turbo EA?

**Turbo EA** er en moderne, selv-hostet platform til **Enterprise Architecture Management**. Den gør det muligt for organisationer at dokumentere, visualisere og styre alle komponenter i deres forretnings- og teknologiarkitektur ét sted.

### Hvem er denne guide til?

Denne guide er til **alle, der bruger Turbo EA** — enterprisearkitekter, it-chefer, forretningsanalytikere, udviklere og administratorer. Uanset om du evaluerer platformen, styrer din organisations it-landskab i dagligdagen eller konfigurerer systemet som administrator, finder du her de oplysninger, du har brug for. Der kræves ingen avanceret teknisk viden for at komme i gang.

### Vigtigste fordele

- **Omfattende overblik**: Se alle applikationer, processer, kompetencer og teknologier på tværs af organisationen i én platform.
- **Informeret beslutningstagning**: Visuelle rapporter (portefølje, kompetencekort, afhængigheder, livscyklus, omkostninger og mere), der gør det lettere at vurdere den aktuelle tilstand af teknologiinfrastrukturen.
- **Livscyklusstyring**: Følg status for hver teknologikomponent gennem fem faser — fra planlægning til udfasning.
- **Samarbejde**: Flere brugere kan arbejde samtidigt, med konfigurerbare roller, interessenttildelinger, kommentarer, opgaver og notifikationer.
- **AI-genererede beskrivelser**: Generér kortbeskrivelser med ét klik. Turbo EA kombinerer websøgning med en lokal eller kommerciel LLM for at producere typebevidste resuméer — komplet med konfidensscore og kildelinks. Kører helt på din egen infrastruktur for privatlivets skyld, eller forbind til kommercielle udbydere (OpenAI, Google Gemini, Anthropic Claude og flere). Fuldt administratorstyret: vælg, hvilke korttyper der får AI-forslag, vælg din søgeudbyder og vælg modellen.
- **Visuelle diagrammer**: Opret arkitekturdiagrammer med den indlejrede DrawIO-editor, fuldt synkroniseret med dit kortlager.
- **Forretningsprocesmodellering**: BPMN 2.0-arbejdsproceseditor med elementtilknytning, godkendelsesarbejdsprocesser og modenhedsvurderinger.
- **ServiceNow-integration**: Tovejssynkronisering med ServiceNow CMDB for at holde dit EA-landskab forbundet med it-driftsdata.
- **Flersproget**: Tilgængelig på engelsk, spansk, fransk, tysk, italiensk, portugisisk, kinesisk, russisk og dansk.

### Nøglebegreber

| Begreb | Betydning |
|--------|-----------|
| **Kort** | Platformens grundlæggende element. Repræsenterer enhver arkitekturkomponent: en applikation, en proces, en forretningskompetence osv. |
| **Korttype** | Den kategori, et kort tilhører (Applikation, Forretningsproces, Organisation osv.) |
| **Relation** | En forbindelse mellem to kort, der beskriver, hvordan de er relaterede (f.eks. "bruger", "afhænger af", "er en del af") |
| **Metamodel** | Strukturen, der definerer, hvilke korttyper der findes, hvilke felter de har, og hvordan de er relateret til hinanden. Fuldt administratorkonfigurerbar |
| **Livscyklus** | En komponents tidsmæssige faser: Planlægning, Indfasning, Aktiv, Udfasning, End of Life |
| **Lager** | Søgbar, filtrérbar liste over alle kort på tværs af alle typer. Massredigering, Excel/CSV-import-eksport og gemte visninger med deling |
| **Rapporter** | Forudbyggede visualiseringer: Portefølje, Kompetencekort, Livscyklus, Afhængigheder, Omkostninger, Matrix, Datakvalitet og End-of-Life |
| **BPM** | Business Process Management — modellér forretningsprocesser med en BPMN 2.0-editor, kobl diagramelementer til kort, og vurder modenhed, risiko og automatisering |
| **PPM** | Project Portfolio Management — administrér Initiativ-kort som fulde projekter med statusrapporter, Work Breakdown Structures, kanban + Gantt-opgavetavler, budgetter, omkostninger og et risikoregister pr. initiativ |
| **TurboLens** | AI-drevet EA-intelligens — leverandøranalyse, dubletdetektion, moderniseringsvurdering, den 5-trins Architecture AI-guide og compliance-scanninger mod EU AI Act / GDPR / NIS2 / DORA / SOC 2 / ISO 27001 |
| **EA Delivery** | Den TOGAF-tilpassede leveranceflade — Statements of Architecture Work, Architecture Decision Records og det landskabsdækkende Risk Register |
| **SoAW** | Statement of Architecture Work — et formelt TOGAF-dokument, der afgrænser et arkitekturinitiativ |
| **ADR** | Architecture Decision Record — fanger en beslutnings kontekst, alternativer og konsekvenser, med statusarbejdsproces og kortkobling |
| **Risk Register** | Landskabsniveau TOGAF Phase G-risikoregister, adskilt fra initiativniveau-PPM-risici. Ejer-tildeling opretter automatisk en opgave |
| **Webportal** | Offentlig, slug-baseret, skrivebeskyttet visning af en del af EA-landskabet — kan deles uden login |
| **MCP Server** | Skrivebeskyttet AI-værktøjsadgang via Model Context Protocol — forespørg EA-data fra Claude Desktop, Cursor, GitHub Copilot og andre MCP-klienter |
| **RBAC** | Role-Based Access Control — app-niveau roller plus interessentroller pr. kort med 50+ granulære tilladelser |
