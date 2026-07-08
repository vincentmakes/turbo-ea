# Ordliste

| Begreb | Definition |
|--------|------------|
| **ADR (Architecture Decision Record)** | Et formelt dokument, der fanger en vigtig arkitekturbeslutning, herunder konteksten, beslutningens begrundelse, konsekvenser og overvejede alternativer. ADR'er understøtter en sign-off-arbejdsproces og en revisionskæde |
| **Godkendelsesstatus** | Et korts gennemgangstilstand: Kladde, Godkendt, Brudt eller Afvist. Godkendte kort skifter til Brudt, når de redigeres |
| **Bogmærke / Gemt visning** | En gemt filter-, kolonne- og sorteringskonfiguration i lageret, der kan genindlæses med ét klik |
| **BPM** | Business Process Management — disciplinen at modellere, analysere og forbedre forretningsprocesser |
| **BPM rækkefølge** | Visningsrækkefølgen af procestyperækker (Core, Support, Management) i BPM-procesnavigatoren, kan konfigureres ved at trække rækker |
| **BPMN** | Business Process Model and Notation — standardnotationen for modellering af forretningsprocesser (version 2.0) |
| **Forretningskompetence** | Hvad en organisation kan, uanset hvordan den gør det |
| **Beregning** | En administratordefineret formel, der automatisk beregner en feltværdi, når et kort gemmes |
| **Kort** | Den grundlæggende informationsenhed i Turbo EA, der repræsenterer enhver arkitekturkomponent |
| **Korttype** | Den kategori, et kort tilhører (f.eks. Applikation, Forretningsproces, Organisation) |
| **Konfidensscore** | En 0–100 % vurdering, der angiver, hvor pålidelig en AI-genereret beskrivelse er |
| **Datakvalitet** | En 0–100 % fuldstændighedsscore baseret på udfyldte felter og deres konfigurerede vægte |
| **Diagram** | Et visuelt arkitekturdiagram oprettet med den indlejrede DrawIO-editor |
| **Filvedhæftning** | En binær fil (PDF, DOCX, XLSX, billeder, op til 10 MB) uploadet direkte til et kort via fanen Ressourcer |
| **Regnskabsår** | 12-månedersperioden, der bruges til budgettering og økonomisk rapportering. Kan konfigureres via Admin > Indstillinger — startmåneden (januar til december) bestemmer, hvordan PPM-budgetlinjer grupperes |
| **DrawIO** | Det indlejrede open source-diagramværktøj, der bruges til visuelle arkitekturdiagrammer |
| **Omkostningslinje** | En budget- eller faktisk omkostningspost (CapEx/OpEx) i et PPM-initiativ, brugt til at spore økonomiske udgifter |
| **Enterprise Architecture (EA)** | Disciplinen, der organiserer og dokumenterer en organisations forretnings- og teknologistruktur |
| **EOL (End of Life)** | Datoen, hvor et teknologiprodukt mister leverandørsupport. Spores via integration med endoflife.date |
| **Extension (udvidelse)** | Et leverandørsigneret tilføjelsesprogram, installeret via Admin → Udvidelser, der tilføjer kundespecifikke funktioner (indhold, integrationer, sider) uden at ændre Turbo EA's kerne. Kræver en licensrettighed |
| **Extension Bundle (.teax)** | Den signerede zip-fil, en udvidelse leveres som. Ed25519-signaturen verificeres ved upload og ved hver backend-start; usignerede eller manipulerede pakker afvises |
| **Entitlement (rettighed)** | Én linje i en signeret udvidelseslicens: retten til at køre en bestemt udvidelse indtil en udløbsdato, efterfulgt af en henstandsperiode før blød deaktivering |
| **Content Pack (indholdspakke)** | Den rene datadel af en udvidelse: korttyper, tags, kort og relationer anvendt gennem samme idempotente motor som workspace-overførsel, med forhåndsvisning |
| **Gantt-diagram** | En visuel tidslinje med vandrette bjælker, der viser projektplan, varighed og fremskridt for hver arbejdspakke og opgave |
| **Initiativ** | Et projekt eller program, der involverer ændringer af arkitekturen |
| **Livscyklus** | De fem faser, en komponent gennemgår: Planlægning, Indfasning, Aktiv, Udfasning, End of Life |
| **LLM** | Large Language Model — en AI-model, der genererer tekst (f.eks. Ollama, OpenAI, Anthropic Claude, Google Gemini) |
| **MCP** | Model Context Protocol — en åben standard, der lader AI-værktøjer (Claude, Copilot, Cursor) forbinde til eksterne datakilder. Turbo EA's indbyggede MCP-server giver skrivebeskyttet adgang til EA-data med RBAC pr. bruger |
| **Metamodel** | Den datadrevne model, der definerer platformens struktur: korttyper, felter, relationer og roller |
| **Milepæl** | En vigtig begivenhed eller fuldførelsespunkt i en projekttidslinje, vist som en diamantindikator i Gantt-diagrammet |
| **Notifikation** | En in-app- eller e-mail-besked udløst af systembegivenheder (opgave tildelt, kort opdateret, kommentar tilføjet osv.) |
| **OData-feed** | En JSON-datafeed tilgængelig på gemte lagervisninger (bogmærker) til forbrug af eksterne værktøjer som Power BI eller Excel |
| **Ollama** | Et open source-værktøj til at køre LLM'er lokalt på din egen hardware |
| **Portefølje** | En samling af applikationer eller teknologier, der administreres som en gruppe |
| **PPM** | Project Portfolio Management — disciplinen at administrere en portefølje af projekter og initiativer med budgetter, risici, opgaver og statusrapportering |
| **Referencenummer** | En automatisk genereret sekventiel identifikator for ADR'er (f.eks. ADR-001, ADR-002), der giver en unik, menneskeligt læsbar etiket |
| **Tilbagevendende opgave** | En kortopgave, der gentages efter en tidsplan (hver N dage/uger/måneder/år). Når den fuldføres, oprettes den næste forekomst; fjerne forekomster forbliver «planlagt», indtil et varslingsvindue åbner, hvorefter de vises på Opgaver-siden og giver den ansvarlige besked |
| **Relation** | En forbindelse mellem to kort, der beskriver, hvordan de er relaterede (f.eks. "bruger", "afhænger af", "kører på") |
| **Fanen Ressourcer** | En kortdetaljefane, der konsoliderer Architecture Decision Records, filvedhæftninger og dokumentlinks ét sted |
| **RAG-status** | Rød-Gul-Grøn sundhedsindikator brugt i PPM-statusrapporter for tidsplan, omkostninger og omfang (mappet til Off Track, At Risk, On Track) |
| **Risikoscore** | En automatisk beregnet værdi (sandsynlighed x indvirkning), der kvantificerer alvoren af en projektrisiko i PPM-risikoregistret |
| **Gemt rapport** | En persisteret rapportkonfiguration med filtre, akser og visualiseringsindstillinger, der kan genindlæses |
| **Revision (ADR)** | En ny version af en signeret ADR, der arver indholdet og kortkæderne fra den forrige version med et inkrementeret revisionsnummer |
| **Sektion** | Et grupperbart område af kortdetaljesiden, der indeholder relaterede felter, kan konfigureres pr. korttype |
| **Underskriver** | En bruger udpeget til at gennemgå og underskrive et ADR- eller SoAW-dokument. Underskrivelsesarbejdsprocessen sporer ventende og fuldførte underskrifter |
| **SoAW** | Statement of Architecture Work — et formelt TOGAF-dokument, der definerer omfang og leverancer for et initiativ |
| **SSO** | Single Sign-On — login ved hjælp af virksomhedslegitimationsoplysninger via en identitetsudbyder (Microsoft, Google, Okta, OIDC) |
| **Undertype** | En sekundær klassifikation inden for en korttype (f.eks. har Applikation undertyperne: Business Application, Microservice, AI Agent, Deployment). Hver undertype fungerer som en underskabelon, der kan styre feltsynlighed |
| **Undertypeskabelon** | Konfigurationen af, hvilke felter der er synlige eller skjulte for en specifik undertype. Administratorer konfigurerer dette i metamodel-administrationen ved at klikke på en undertype-chip |
| **Interessent** | En person med en bestemt rolle på et kort (f.eks. Application Owner, Technical Owner) |
| **Undersøgelse** | Et datavedligeholdelsesspørgeskema rettet mod specifikke korttyper for at indsamle oplysninger fra interessenter |
| **Tag / Taggruppe** | En klassifikationsetiket organiseret i grupper med single-select- eller multi-select-tilstand, valgfri typebegrænsninger og et valgfrit obligatorisk flag, der blokerer godkendelse og bidrager til datakvalitetsscoren |
| **Obligatorisk taggruppe** | En taggruppe markeret som påkrævet. Anvendelige kort kan ikke godkendes, før mindst ét tag fra gruppen er vedhæftet, og opfyldelse heraf bidrager til kortets datakvalitetsscore |
| **EU AI Act semantisk detektion** | En TurboLens compliance-gennemgang, der beder LLM'en om at flage kort, der indlejrer AI-/ML-kompetencer (LLM'er, anbefalingsmotorer, computer vision, scoring, chatbots, …), selv når de ikke er eksplicit klassificeret som `AI Agent` / `AI Model`. Sådanne fund markeres **AI-detekteret** |
| **Initial vs. residuel risiko** | To vurderinger fanget på hver risiko i Risk Register. `Initial` er den umitigerede sandsynlighed × indvirkning; `Residuel` er sandsynlighed × indvirkning efter mitigation, redigerbar når en mitigeringsplan eksisterer. Begge afleder et niveau via 4×4-matricen |
| **Risikoreference** | En monotonisk menneskeligt læsbar identifikator (`R-000123`) tildelt ved risikooprettelse. Den forbliver synlig i forfremmet-fund-knapper (**Åbn risiko R-000123**) og i ejerens linkede opgavebeskrivelse |
| **TOGAF** | The Open Group Architecture Framework — en bredt anvendt EA-metodologi. Turbo EA's SoAW-funktion er tilpasset TOGAF |
| **Statusrapport** | En månedlig PPM-rapport, der sporer projekttilstand via RAG-indikatorer for tidsplan, omkostninger og omfang sammen med opnåede resultater og næste trin |
| **Webportal** | En offentlig, skrivebeskyttet visning af udvalgte kort tilgængelig uden godkendelse via en unik URL |
| **Work Breakdown Structure (WBS)** | En hierarkisk nedbrydning af projektomfang i arbejdspakker, hver med start-/slutdatoer og fuldførelsessporing. Bruges i PPM Gantt-diagrammet |
| **Arbejdspakke** | En logisk gruppering af opgaver inden for en Gantt-tidslinje, der har sin egen startdato, slutdato og fuldførelsesprocent |
| **AI-forslag** | En automatisk genereret kortbeskrivelse produceret ved at kombinere websøgeresultater med en Large Language Model (LLM) |
| **AI-verdict** | En brugers bekræftelse eller afvisning af LLM'ens AI-bærende klassifikation for et kort (`hasAiFeatures = true / false`). Persisterer på tværs af nye scanninger, så LLM-drift ikke stille kan ændre EU AI Act-omfanget |
| **GRC** | Governance, Risk and Compliance — det samlede arbejdsområde på `/grc` med tre faner (Governance, Risk, Compliance), der konsoliderer EA-principper, ADR'er, Risk Register og Security & Compliance-scanneren |
| **Phase G** | TOGAF ADM "Implementation Governance"-fasen. Kilden til Risk Registrets ordforråd og livscyklus |
| **Risk Register** | Landskabsniveau-register over arkitekturrisici tilpasset TOGAF Phase G. Bor på `/grc?tab=risk`. Adskilt fra de initiativomfangede risici fanget i PPM |
| **Risikoejer** | Den bruger, der er ansvarlig for en risiko. Tildeling opretter automatisk en systemopgave på ejerens Opgaver-side og udløser en `risk_assigned`-notifikation |
| **Mitigeringsopgave** | Et ejet arbejdselement vedhæftet en risiko, der fanger konkret mitigeringsaktivitet. Kan være engangsbaseret eller tilbagevendende (dagligt / ugentligt / månedligt / årligt). Tilbagevendende opgaver ruller fremad kalenderkorrekt ved fuldførelse |
| **Mitigeringsopgaveforekomst** | En planlagt instans af en mitigeringsopgave. Bevæger sig gennem `scheduled` → `open` → `done` / `skipped`. Tager snapshots af modtageren ved åbning og ejer-ved-fuldførelse ved lukning, så audit-svar overlever ejerrotation |
| **Lead Time (mitigeringsopgave)** | Dage før `due_date` en planlagt cyklus forfremmes til `open` og lander på modtagerens opgaver. Smarte standardværdier pr. enhed (1 / 2 / 7 / 14 for dagligt / ugentligt / månedligt / årligt) afgrænset til halvdelen af cyklussen |
| **Compliance-fund** | En række i compliance-registret mod en regulering × artikel. Forfattet manuelt af en anmelder eller produceret af en TurboLens AI-scanning; begge typer deler samme livscyklus og kan forfremmes til en risiko |
| **Macro Capability** | Niveau-0-gruppering over L1 i Capability Catalogue. Lander som et `BusinessCapability`-kort med `attributes.capabilityLevel = "Macro"` og et `catalogueId` med præfikset `MC-`. Lemper hierarki-dybdegrænsen til 6 |
| **Layered Dependency View (LDV)** | Turbo EA's husnotation for afhængighedsdiagrammer: kort grupperet i de fire EA-lag som svømmebaner, farvet efter korttype, med foreslåede kort renderet som noder med stiplet ramme og et grønt "NEW"-badge. Bruges af Afhængighedsrapporten, kortdetaljens afhængighedssektion og TurboLens Architects målarkitektur |
| **TIME (Tolerate / Invest / Migrate / Eliminate)** | Et firevejs porteføljeklassifikationsframework for applikationer, populariseret af Gartner. Hver applikation tagges med én disposition — Tolerate (behold som-er), Invest (finansiér forbedringer), Migrate (erstat eller rehost) eller Eliminate (decommissionér). I Turbo EA tilføjes det almindeligvis som et `single_select`-felt på Applikation-korttypen og bruges som farveakse for porteføljerapporten |
| **Applikationsporteføljerationalisering** | Det mest almindelige første EA-initiativ på Turbo EA: opgør de applikationer, der er i scope, klassificér hver efter forretningsværdi og teknisk egnethed, og tildel en TIME-disposition, der driver konsolidér / erstat / udfas-beslutninger |
| **Crawl-Walk-Run** | Det fasede udrulningsmønster anbefalet i EA Beginner's Guide. Crawl = snævert omfang, kun applikationer, fem felter pr. kort. Walk = tilføj kompetencekortlægning og en første porteføljeanalyse. Run = udvid til processer, grænseflader, data og de avancerede moduler |
