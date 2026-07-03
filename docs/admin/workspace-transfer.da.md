# Overførsel af arbejdsområde

Overførsel af arbejdsområde (**Admin → Indstillinger → Migrering → Overførsel af arbejdsområde**) flytter et helt Turbo EA-arbejdsområde fra én instans til en anden som ét enkelt, selvstændigt bundt. Den drivende anvendelse: du opbygger et arbejdsområde på en **lokal** instans og har brug for at forfremme alt til **produktion**.

![Overførsel af arbejdsområde](../assets/img/en/58_workspace_transfer.png)

## Hvad er inkluderet

Eksporten fanger hele arbejdsområdet som et `.zip`-bundt, der indeholder én Excel-projektmappe (alle strukturerede data, ét ark pr. domæne) og, hvor det er relevant, en `assets/`-mappe til ustrukturerede filer:

- **Metamodel** — korttyper og relationstyper, inklusive alle brugerdefinerede felter, undertyper, sektioner og oversættelser.
- **Konfiguration** — roller, per-type-interessentroller, tag-grupper og tags, beregnede felter, EA-principper og compliance-regulativer.
- **Indstillinger** — valuta, datoformat, feature-flags, login-branding, aktiverede sprog og resten af de generelle applikationsindstillinger.
- **Brugere** — e-mail, visningsnavn, rolle og aktiv-flag (bruges til at genlinke ejerskab og tildelinger på målet). Ingen adgangskoder eller SSO-identiteter.
- **Inventar** — hvert kort (med dets hierarki, livscyklus og egenskaber), kort-tags og relationer.
- **Kort-kontekst** — interessenter, dokumentlinks, kommentarer, todos og filvedhæftninger.
- **Moduldata** — BPM (procesdiagrammer, elementer, flow-versioner, vurderinger), PPM (statusrapporter, omkostninger, budgetter, risici, opgaver, WBS, afhængigheder), GRC-risikoregistret (risici, afhjælpningsopgaver og forekomster, kort-links), GRC-compliance-fund (med de analysekørsler, de refererer til), arkitekturbeslutninger og Statements of Architecture Work, fritegnede diagrammer, gemte rapporter, bogmærker (gemte inventarvisninger, inklusive deres delinger), webportaler og spørgeundersøgelser.
- **Aktiver** — binære filvedhæftninger, diagram- og BPMN-XML samt logoet/favicon rejser som separate filer inde i bundtets `assets/`-mappe.

## Hvad er aldrig inkluderet

Af sikkerhedshensyn **eksporteres hemmeligheder aldrig**:

- SMTP-adgangskode
- SSO-klienthemmelighed
- AI-udbyderens API-nøgle
- ServiceNow-legitimationsoplysninger

Du skal indtaste disse igen på målinstansen efter import. Dette er uundgåeligt ved design: krypterede værdier er bundet til kildeinstansens `SECRET_KEY` og kan ikke dekrypteres noget andet sted.

Nogle få andre ting bliver bevidst tilbage:

- **TurboLens-analyseresultater** (leverandøranalyse, dubletklynger, moderniseringsvurderinger, gemte arkitekturvurderinger) og dashboardets KPI-historik er instans-lokale — kør analyserne igen på målet. Compliance-fund er undtagelsen og overføres.
- **Browser-lokal tilstand** overføres aldrig: inventar-gitterets ad hoc-kolonnerækkefølge ligger i din browsers lokale lager, ikke i databasen. Kolonnelayout, som du har gemt **inde i en gemt visning**, overføres derimod med visningen.

## Eksport

1. Åbn **Admin → Indstillinger → Migrering → Overførsel af arbejdsområde**.
2. (Valgfrit) markér **Inkludér arkiverede kort** for at tilføje arkiveret inventar til bundtet.
3. Klik på **Eksportér bundt**. Din browser downloader `workspace_export_<timestamp>.zip`.

## Import

1. På **mål**-instansen skal du åbne **Admin → Indstillinger → Migrering → Overførsel af arbejdsområde**.
2. Under **Importér arbejdsområde** skal du klikke på **Vælg bundt…** og vælge den `.zip`, du eksporterede.
3. Turbo EA parser bundtet og viser en **dry-run-forhåndsvisning** — en tabel per sektion over, hvor mange entiteter der ville blive oprettet, opdateret, sprunget over eller er i konflikt. Intet skrives endnu.
4. Gennemgå forhåndsvisningen, og klik derefter på **Anvend import**.

Import er **idempotent**: metamodel og konfiguration matches efter nøgle, kort efter ekstern id eller efter type + hierarkisti, og brugere efter e-mail. Genimport af samme bundt er sikkert — allerede tilstedeværende entiteter springes over i stedet for at blive dublerede. Eksisterende indbyggede metamodel-typer bevarer deres identitet; kun deres redigerbare skema fusioneres.

### Sådan læses forhåndsvisningen

- **Sprunget over betyder »allerede til stede — ingen handling nødvendig«.** På en frisk installation vil du typisk se oversprungne poster for indhold, der leveres med Turbo EA (interessentroller, ressourcetyper, standardindstillinger), fordi bundtets kopi er identisk med det, målet allerede har. Udvid en sektionsrække (pilen til venstre) for at se opdelingen pr. årsag samt eventuelle konflikt- eller fejlmeddelelser.
- **Versionsadvisering.** Forhåndsvisningen viser, hvilken Turbo EA-version bundtet blev eksporteret fra, og advarer, når den afviger fra den importerende instans. Advarslen er kun vejledende — importen kører stadig — men at eksportere og importere på samme version er den sikreste vej.

## Efter import

- Indtast igen eventuelle SMTP-, SSO- og AI-legitimationsoplysninger under deres respektive indstillingsfaneblade.
- Syntetiske brugere, som bundtet refererer til, oprettes **deaktiveret**; aktivér dem under **Admin → Brugere** efter behov.
- **Brugerejede data følger brugeren, matchet efter e-mail.** Todos, gemte visninger, favoritter og andre personlige data tilhører den konto, hvis e-mail matcher den i bundtet. Hvis du logger ind på målet med en anden e-mail, end du brugte på kilden, vil dine personlige elementer se ud til at mangle — de er knyttet til den (muligvis deaktiverede) matchende konto. Log ind med den samme e-mail, eller aktivér den matchede konto under **Admin → Brugere**.
- Private gemte visninger er kun synlige for deres ejer; delte og offentlige visninger følger deres synlighedsindstillinger.

## Start forfra

Der findes ingen indbygget »fortryd import«. For at nulstille en målinstans og importere forfra skal du genstarte den én gang med `RESET_DB=true` (dropper og genopretter alle tabeller og seeder derefter igen) og derefter sætte den tilbage til `RESET_DB=false` **før** næste genstart, så du ikke sletter de netop importerede data.

## Tilladelser

Overførsel af arbejdsområde er bevogtet af to dedikerede tilladelser, begge tildelt administratorer:

- `admin.export_workspace` — eksportér bundtet.
- `admin.import_workspace` — forhåndsvis og anvend en import.
