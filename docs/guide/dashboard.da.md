# Dashboard

Dashboardet er den første skærm, du ser efter login. Det giver et **hurtigt overblik** over hele enterprise-arkitekturstatussen.

![Dashboard - topvisning](../assets/img/da/01_dashboard.png)

## Topnavigationslinje

Øverst på skærmen finder du **hovednavigationslinjen** med følgende elementer:

- **Turbo EA** (logo): Klik for at vende tilbage til dashboardet fra en hvilken som helst sektion
- **Dashboard**: Oversigt over arkitekturstatussen
- **Lager**: Komplet fortegnelse over alle kort
- **Rapporter**: Visuelle og analytiske rapporter
- **BPM**: Business Process Management (hvis aktiveret)
- **Diagrammer**: Visuel arkitekturdiagrameditor
- **EA-levering**: Styring af arkitekturinitiativer
- **Opgaver**: Ventende opgaver og tildelte undersøgelser
- **Søg kort**: Hurtig søgelinje med autoudfyldning
- **+ Opret**: Knap til hurtigt at oprette nye kort
- **Notifikationsklokke**: Systemadvarsler og [notifikationer](notifications.md)
- **Profilikon**: Sprogvalg, temaskifter, notifikationspræferencer og adgang til administration
- **Støt**: En lilla-lyserød knap ved siden af versionsnummeret i profilmenuen åbner en dialog, der forklarer, hvorfor sponsorering er vigtig, med et link til bloggen og engangs- eller månedlige muligheder via GitHub Sponsors

## Dashboards og widgets

Startsiden består af **dashboards**, der vises som faner øverst på siden. Turbo EA leveres med tre dashboards:

| Dashboard | Hvad det viser |
|-----------|----------------|
| **Oversigt** | Tilstanden for hele landskabet: KPI-felter, diagrammer, de korttyper, der kan gennemses, og den seneste aktivitet |
| **Mit arbejdsområde** | Alt, der er tildelt dig — favoritter, roller, opgaver, undersøgelser og dine seneste ændringer (se [Arbejdsområde-fane](#workspace-tab)) |
| **Administration** | Brugeraktivitet, interessentdækning, ventende godkendelser og interessentkataloget (se [Admin-fane](#admin-tab-stakeholder-directory)) |

Hvert dashboard er et gitter af **widgets**. Du ser kun de widgets, som din rolle tillader — widgets i Oversigt kræver tilladelsen `reports.ea_dashboard`, admin-widgets kræver `admin.users` — og en fane forsvinder, når ingen af dens widgets er synlige for dig. Administratorer kan ændre de indbyggede dashboards og tilføje deres egne (se [Tilpasning af dashboards](#customizing-dashboards)).

Klik på **nåle**-ikonet på en fane for at gøre den til det dashboard, du lander på, når du åbner Turbo EA.

## KPI-felter

Rækken af felter øverst på dashboardet Oversigt viser landskabets nøgletal:

- **Kort i alt**: Antal af alle komponenter, der er registreret på platformen
- **Gennemsnitlig datakvalitet**: Den gennemsnitlige fuldstændighed af alle kort — klik på den for at åbne [datakvalitetsrapporten](reports.md)
- **Godkendt** og **Brudt**: Hvor mange kort der har den pågældende godkendelsesstatus

Hvert felt viser en **tendenspil**, der sammenligner dagens værdi med værdien ved starten af sammenligningsvinduet — 30 dage eller færre, mens historikken stadig indsamles. Billedteksten under felterne angiver det vindue, der faktisk er brugt. Der tages et øjebliksbillede hver dag kl. 02:00 UTC. Tendenser beskriver hele landskabet og vises derfor kun for brugere, der kan læse alle kort; en bruger, hvis rolle skjuler nogle kort, ser værdien uden pilen.

![Dashboard - bundvisning med diagrammer](../assets/img/da/02_dashboard_bottom.png)

## Diagrammer og lister

Under felterne viser dashboardet Oversigt:

- **Kort efter type**: Andelen af hver korttype i dit landskab
- **Godkendelsesstatus**: Hvor mange kort der er godkendte, afventende, brudte eller afviste
- **Fordeling af fuldstændighed**: Hvor mange kort der falder i hvert datakvalitetsinterval
- **Livscyklusoversigt**: Hvor mange kort der er i hver livscyklusfase
- **Gennemse efter type**: Hver korttype med sit antal — klik på en for at åbne [Inventar](inventory.md) forhåndsfiltreret til den type
- **Seneste aktivitet**: Et feed med de seneste ændringer — hvem der redigerede hvad og hvornår

Et klik på en søjle eller et udsnit i et diagram åbner det, der ligger bag: [Inventar](inventory.md) filtreret til de kort for en korttype eller en godkendelsesstatus, livscyklusrapporten for en livscyklusfase og datakvalitetsrapporten for et fuldstændighedsinterval.

## Arbejdsområde-fane { #workspace-tab }

Dashboardet **Mit arbejdsområde** samler alt, der er tildelt dig: favoritter, gemte rapporter, opgaver, ventende undersøgelser, de kort, du har oprettet, seneste aktivitet på dine kort og sektionen **Kort, hvor jeg har en rolle**. Hver af disse er en widget, så en administrator kan omarrangere dem eller placere dem på et andet dashboard.

Den sidste sektion grupperer kort efter den interessentrolle, du har (Application Owner, Business Owner osv.), og viser kortene under hver rolle. Hvis din rolle giver tilladelsen `stakeholders.view` (roller som admin, member og viewer som standard), lader et lille **personsøgnings**-ikon ved siden af sektionens titel dig pege den mod **en anden** — vælg en bruger i autofuldførelsen, og sektionen genindlæses med den brugers roller og kort. Titlen skifter til «Roller, som {name} har». Klik på det lille lukkeikon for at vende tilbage til dine egne roller. Nyttigt til at besvare «hvad ejer den person?» med ét klik.

## Admin-fane — interessentkatalog { #admin-tab-stakeholder-directory }

Dashboardet **Administration** vises for roller med `admin.users`. Ud over sine KPI-felter (aktive brugere, kort uden interessenter, forfaldne opgaver, fastlåste godkendelser, samlet kvalitet) og lister (de mest aktive bidragydere, interessentdækning, inaktive brugere, godkendelsespipeline, systemaktivitet, ikke-tildelte opgaver) slutter det med en widget, **Interessentkatalog**. Den viser hver korttype, der har mindst én interessent, med antallet af forskellige indehavere. Udvid en korttype for at se dens roller, og inde i hver rolle de brugere, der har den, sammen med antallet af kort, de dækker. Klik på en brugers chip for at udvide dennes kortliste direkte — hvert kortnavn er selv et link til kortets detaljeside. Hele træet (korttype → rolle → bruger → kort) hentes i ét enkelt kald, så navigationen er øjeblikkelig.

Et **navnefilter** øverst i widgetten indsnævrer træet til brugere, hvis navn eller e-mail matcher det indtastede; matchende korttyper udvides automatisk, så resultaterne er synlige uden et ekstra klik. Brug det til at besvare «hvor optræder Alice i organisationen?» på et sekund.

Ud over kataloget åbner en lille **hover-popover**, når markøren hviler på en interessents navn andre steder i appen — på et korts fane Interessenter, på en risikoejer i risikoregisteret eller på risikoens detaljeside — og viser den brugers fulde interessentportefølje grupperet efter rolle. Klik på et vilkårligt kort i popoveren for at springe til det. Popoveren henter data én gang pr. bruger pr. session.

## Tilpasning af dashboards { #customizing-dashboards }

Brugere, hvis rolle giver `admin.dashboards` (**Administrer dashboards på startsiden** — som standard Admin-rollen), kan ændre alle dashboards og oprette nye. Alle andre ser dashboards, som de er konfigureret.

![Dashboard - Tilpasningstilstand](../assets/img/da/03_dashboard_customize.png)

### Tilpasningstilstand

Klik på **Tilpas** ved siden af dashboardfanerne for at redigere det aktuelle dashboard. I tilpasningstilstand:

- **Flyt** en widget ved at trække i dens håndtag; gitteret er 12 kolonner bredt, og de andre widgets giver plads.
- **Tilpas størrelsen** på en widget fra dens højre kant, nederste kant eller hjørnet. Widgetten ved siden af giver plads: den bliver smallere, når naboen vokser, og bredere igen, når naboen skrumper; kan den ikke blive smallere, flyttes den til næste række. Rækkerne nedenunder flytter sig ned og op igen af sig selv.
- **Fjern** en widget med dens lukkeknap.
- **Konfigurer** et KPI-felt, et diagram eller aktivitetsfeedet med tandhjulsknappen.

Klik på **Gem** for at beholde ændringerne for alle, eller **Kassér ændringer** for at vende tilbage til dashboardet, som det var.

### Tilføjelse og gendannelse af widgets

**Tilføj widget** åbner en skuffe med alle widgets, grupperet som **KPI'er**, **Diagrammer**, **Oversigt**, **Mit arbejdsområde** og **Administration**. Klik på en for at tilføje den til dashboardet; et KPI-felt eller et diagram åbner først sin konfiguration. Hver indbygget widget forbliver i kataloget, så en widget, der er fjernet ved en fejl — for eksempel **Seneste aktivitet** — gendannes ved at tilføje den igen. Widgets, der kun kan forekomme én gang på et dashboard, er nedtonede og markeret som allerede tilføjet, når de er der.

En widget beholder sin egen tilladelse, uanset hvor den placeres: En admin-widget, der er tilføjet til dashboardet Oversigt, vises stadig kun for brugere med `admin.users`.

### Konfiguration af et KPI-felt

Et KPI-felt viser enten en af de indbyggede målinger (kort i alt, datakvalitet, åbne opgaver osv.) eller et tal, du selv definerer:

- **Korttype** (valgfri): Tæl kun kort af én type, eventuelt indsnævret til en undertype, en godkendelsesstatus eller en livscyklusfase.
- **Måling**: **Antal** kort eller **Sum** eller **Gennemsnit** af et tal-, omkostnings- eller procentfelt for den type.
- **En stigning er**: **God** eller **Dårlig** — bestemmer, om en stigende tendens vises i grønt eller rødt.

Et nyt KPI-felt registrerer sin første værdi i det øjeblik, dashboardet gemmes, så dets tendens starter den følgende dag. En sum eller et gennemsnit af et omkostningsfelt vises kun for brugere, der må se omkostninger.

### Konfiguration af et diagram

Et diagram grupperer kort efter én **dimension** og måler hver gruppe med en **måling**:

| Dimension | Grupperer kort efter |
|-----------|----------------------|
| **Korttype** | Korttype |
| **Undertype** | Undertype for den valgte korttype |
| **Godkendelsesstatus** | Godkendt, afventende, brudt, afvist |
| **Livscyklusfase** | Den aktuelle livscyklusfase |
| **Datakvalitet** | Datakvalitetsinterval (0–25 %, 25–50 %, …) |
| **Oprettelsesmåned** | Måneden, hvor kortet blev oprettet |
| **Et felt** | Ethvert enkeltvalgs- eller ja/nej-felt for den valgte korttype |

Målingen er **Antal kort** eller **Sum** eller **Gennemsnit** af et tal-, omkostnings- eller procentfelt. Der tilbydes kun de korttyper, du kan læse, og omkostningsfelter kun til brugere, der må se omkostninger.

| Diagram | Bedst til |
|---------|-----------|
| **Vandret søjle** / **Søjle** | Sammenligning af grupper, vandret eller lodret |
| **Linje** | En tendens over tid, f.eks. kort oprettet pr. måned |
| **Cirkel** / **Donut** | Andele af en helhed |
| **Måler** | Én værdi i forhold til et maksimum (ingen gruppering) |
| **Heatmap** | To dimensioner på én gang — for eksempel livscyklusfase mod godkendelsesstatus |
| **Treemap** | Andele, når der er mange grupper |
| **Sankey** | Strømmen af en relationstype mellem de kort, den forbinder |

Slå klik-igennem til, så læsere kan åbne [Inventar](inventory.md) eller rapporten bag en søjle eller et udsnit (søjle-, linje-, cirkel-, donut- og treemap-diagrammer). En forhåndsvisning i dialogen viser diagrammet, som det vil se ud.

### Administration af dashboards

Menuen **⋮** ved siden af fanerne virker på det aktuelle dashboard:

| Handling | Hvad den gør |
|----------|--------------|
| **Nyt dashboard** | Opretter et tomt dashboard, klar til at blive fyldt med widgets |
| **Duplikér** | Kopierer dashboardet med alle dets widgets — en hurtig start på en variant af et indbygget dashboard |
| **Indstillinger** | Navn, beskrivelse, ikon og **Adgang**: de roller, der må se dashboardet. Lad adgang være tom for at vise det for alle. Brugere med `admin.dashboards` ser altid alle dashboards |
| **Skjul** / **Vis** | Fjerner dashboardet fra alle andres faner uden at slette det |
| **Flyt til venstre** / **Flyt til højre** | Ændrer rækkefølgen af fanerne |
| **Nulstil til standard** | Kun indbyggede dashboards: gendanner de widgets og det layout, Turbo EA leveres med |
| **Slet** | Kun brugerdefinerede dashboards: sletter dashboardet for alle |

En opgradering af Turbo EA overskriver aldrig et dashboard, du har ændret. Når en udgivelse forbedrer et indbygget dashboard, henter **Nulstil til standard** den nye version.

Enhver ændring af et dashboard — oprettet, redigeret, duplikeret, nulstillet eller slettet, herunder hvilke widgets der blev tilføjet eller fjernet — registreres i [revisionsloggen](../admin/audit-log.md#administrative-actions). Dashboards følger med en [overførsel af arbejdsområde](../admin/workspace-transfer.md).
