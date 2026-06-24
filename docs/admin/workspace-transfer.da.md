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
- **Moduldata** — BPM (procesdiagrammer, elementer, flow-versioner, vurderinger), PPM (statusrapporter, omkostninger, budgetter, risici, opgaver, WBS, afhængigheder), GRC-risikoregistret (risici, afhjælpningsopgaver og forekomster, kort-links), arkitekturbeslutninger og Statements of Architecture Work, fritegnede diagrammer, gemte rapporter, bogmærker, webportaler og spørgeundersøgelser.
- **Aktiver** — binære filvedhæftninger, diagram- og BPMN-XML samt logoet/favicon rejser som separate filer inde i bundtets `assets/`-mappe.

## Hvad er aldrig inkluderet

Af sikkerhedshensyn **eksporteres hemmeligheder aldrig**:

- SMTP-adgangskode
- SSO-klienthemmelighed
- AI-udbyderens API-nøgle
- ServiceNow-legitimationsoplysninger

Du skal indtaste disse igen på målinstansen efter import. Dette er uundgåeligt ved design: krypterede værdier er bundet til kildeinstansens `SECRET_KEY` og kan ikke dekrypteres noget andet sted.

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

## Efter import

- Indtast igen eventuelle SMTP-, SSO- og AI-legitimationsoplysninger under deres respektive indstillingsfaneblade.
- Syntetiske brugere, som bundtet refererer til, oprettes **deaktiveret**; aktivér dem under **Admin → Brugere** efter behov.

## Tilladelser

Overførsel af arbejdsområde er bevogtet af to dedikerede tilladelser, begge tildelt administratorer:

- `admin.export_workspace` — eksportér bundtet.
- `admin.import_workspace` — forhåndsvis og anvend en import.
