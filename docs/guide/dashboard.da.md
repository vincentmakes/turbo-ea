# Dashboard

Dashboardet er den første skærm, du ser efter login. Det giver et **hurtigt overblik** over hele enterprise-arkitekturstatussen.

![Dashboard - topvisning](../assets/img/en/01_dashboard.png)

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

## Oversigtskort

Hovedsektionen af dashboardet viser **oversigtskort**, der angiver:

- **Samlet antal kort**: Tælling af alle komponenter registreret på platformen
- **Fordeling efter type**: Hvor mange elementer af hver type, der findes (applikationer, organisationer, mål, kompetencer osv.)
- **Statusoversigt**: Hurtige visualiseringer af den samlede status

Ved at klikke på et typekort navigeres til [Lager](inventory.md) forfiltreret til den type.

![Dashboard - bundvisning med diagrammer](../assets/img/en/02_dashboard_bottom.png)

## Diagrammer og statistik

I den nederste sektion af dashboardet finder du:

- **Fordeling efter type-diagram**: Viser proportionen af hver korttype i dit landskab
- **Godkendelsesstatus**: Angiver, hvor mange kort der er godkendte, afventende, brudte eller afviste
- **Datakvalitet**: Samlet procentdel af informationsfuldstændighed på tværs af alle kort
- **Seneste aktivitet**: Et feed med de seneste ændringer — hvem redigerede hvad og hvornår

## Arbejdsområde-fane

Fanen **Arbejdsområde** samler alt, der er tildelt dig: favoritter, opgaver, ventende undersøgelser, seneste aktivitet på dine kort og sektionen **Kort, jeg har en rolle i**.

Den sidste sektion grupperer kort efter den interessentrolle, du har (applikationsejer, forretningsejer osv.) og lister kortene under hver. Hvis din rolle giver `stakeholders.view`-tilladelsen (admin-, member- og viewer-roller som standard), lader et lille **personsøgnings**-ikon ved siden af sektionstitlen dig pege den mod **en anden** — vælg en bruger fra autoudfyldningen, og sektionen genhentes og gengiver med den brugers roller og kort. Sektionstitlen skifter til "Roller besat af {name}". Klik på det lille luk-ikon for at vende tilbage til dine egne roller. Nyttigt til at besvare "hvad ejer denne person?" med ét klik.

## Admin-fane — interessentkatalog

Administratorer (enhver rolle med `admin.users`) får en **interessentkatalog**-widget nederst på admin-fanen. Den lister hver korttype, der har mindst én interessent, med tællingen af særskilte indehavere for hver. Udvid en korttype for at se dens roller, og inde i hver rolle de brugere, der har den, sammen med antallet af kort, de dækker. Klik på en brugerchip for at udvide dens kortliste inline — hvert kortnavn er selv et link til kortdetaljesiden. Hele træet (korttype → rolle → bruger → kort) kommer tilbage i et enkelt round-trip, så navigationen er øjeblikkelig.

Et **navnefilter** øverst på widgeten indsnævrer træet til brugere, der matcher det indtastede navn eller den indtastede e-mail; matchende korttyper udvides automatisk, så matchene er synlige uden et ekstra klik. Brug den til at besvare "hvor optræder Alice i organisationen?" på et sekund.

Ud over kataloget åbner en lille **hover-popover**, når markøren pauser på et interessentnavn et andet sted i appen — på et korts interessent-fane, på en risikoejer i risikoregisteret eller på risikodetaljesiden — og viser den brugers fulde rolle-grupperede interessentportefølje. Klik på et hvilket som helst kort i popoveren for at springe til det. Popoveren henter én gang pr. bruger pr. session.
