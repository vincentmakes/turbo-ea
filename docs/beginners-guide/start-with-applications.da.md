# Start med dit applikationslager

Turbo EA leveres med 13 korttyper ud af boksen. Du vil blive fristet til at befolke dem alle. Lad være.

**Start med applikationer**. Applikationer er den korttype med størst løftestang i enhver første udrulning:

- De er de letteste at finde — IT-afdelinger har næsten altid en liste et eller andet sted (CMDB, licenstracker, økonomisystem, endda et regneark).
- De forankrer alle andre lag — når du først har applikationer, bliver kortlægning til kompetencer, processer og IT-komponenter inkrementel berigelse i stedet for en greenfield-øvelse.
- De driver den første nyttige rapport (porteføljerationalisering) med færrest afhængigheder.

Andre korttyper kommer senere. En almindelig anden bølge er forretningskompetencer (side 4) og derefter grænseflader eller dataobjekter.

## Hvordan "minimalt levedygtigt" ser ud

For hvert applikationskort i dit oprindelige område, befolk disse felter og **kun** disse felter:

| Felt | Hvorfor det betyder noget | Hvor det kommer fra |
|-------|---------------|---------------------|
| **Navn** | Identitet. Brug det navn, folk faktisk bruger, ikke licensbetegnelsen. | Din eksisterende kilde |
| **Beskrivelse** | Én sætning: hvad gør denne app for forretningen? | Ejerinterview eller AI-forslag (se [Lager](../guide/inventory.md#ai-description-suggestions)) |
| **Livscyklusfase** | Plan / Faseind / Aktiv / Faseud / Udløb | CMDB eller ejerinterview |
| **Forretningsejer** (interessent) | Den person, der er ansvarlig for app'en | Organisationsdiagram |
| **Omkostning — total årlig** | Bruges af porteføljerapporten og TIME-formlen | Økonomi eller groft skøn |

Fem felter. Det er det. Datakvalitetsringen vil vise ~50 %, og det er fint — du kan forfine i runde to.

!!! warning "Lad være"
    Prøv ikke at udfylde **udløbsdato**, **leverandør**, **teknologistak** og 12 brugerdefinerede felter i første runde. Du vil brænde ud omkring kort 30.

## Tre måder at befolke lageret på

Vælg den vej, der matcher din datakilde. Du kan blande dem — importer massen, og ret derefter den lange hale manuelt.

### Vej A — Excel/CSV-import (anbefales til de fleste starter)

Hvis dine applikationer bor i et regneark (eller du kan eksportere dem fra en CMDB), er dette den hurtigste vej. **Start ikke med at håndlave regnearket** — lad Turbo EA give dig skabelonen.

1. **Opret ét dummy-applikationskort manuelt**. Gå til **Lager → + Opret**, type = `Application`, navngiv det noget i retning af *"_TEMPLATE — slet mig"*. Udfyld de fem minimumsfelter (beskrivelse, livscyklus, ejer, omkostning), så eksporten indeholder rigtige værdier, du kan bruge som eksempler.
2. **Filtrér lageret til Type = `Application`** og klik på **Eksporter** i værktøjslinjen. Du får en `.xlsx`-fil med én række rigtige data og en kolonne pr. felt — det er din skabelon. Kolonneoverskrifterne matcher de feltnøgler, importøren forventer.
3. **Rediger regnearket offline**: behold kolonnestrukturen, erstat den enkelte række med alle dine rigtige applikationer, og slet dummy-rækken til sidst (eller lad den stå — du fjerner kortet fra Turbo EA efter importen).
4. **Importer den redigerede fil**: **Lager → Importer**, træk `.xlsx`-filen ind. Valideringsrapporten viser dig nøjagtigt, hvilke rækker der vil oprette nye kort, hvilke der vil opdatere eksisterende kort (matchet efter navn eller ID), og hvilke der vil fejle.
5. Kør importen, og arkivér derefter `_TEMPLATE`-kortet.

Fuld reference: [Lager → Excel-import](../guide/inventory.md#excel-import).

**Tip til første import:** medtag kun de fem minimumsfelter plus en kolonne til forretningsejerens e-mail (importøren vil forsøge at matche den med eksisterende brugere). Spring alt andet over. Du kan lave en anden import senere med flere kolonner ved at gentage eksporter-rediger-importer-løkken.

### Vej B — ServiceNow-synkronisering

Hvis du har en ServiceNow-CMDB og administratoradgang til dens API, henter integrationen applikationsposter direkte.

1. Gå til **Admin → ServiceNow-integration**.
2. Opret en forbindelse (URL, legitimationsoplysninger — legitimationsoplysninger gemmes krypteret).
3. Definér en mapping: ServiceNow `cmdb_ci_business_app` → Turbo EA `Application`, med regler på feltniveau.
4. Kør en **pull**-synkronisering. Som standard lander poster i et **staging**-område til administratorgennemgang, før de anvendes.

Se [Admin → ServiceNow-integration](../admin/servicenow.md) for den fulde konfiguration. Behandl den første synkronisering som udforskende — gennemgå, hvad der kom ind, finjustér mappingen, og kør den derefter i fuld skala.

### Vej C — Manuel indtastning

For små miljøer (under ~30 apps), eller når der ikke findes en brugbar kilde:

1. **Lager** → **+ Opret** (øverst til højre).
2. Type = **Application**, udfyld navn og (valgfrit) beskrivelse.
3. Klik på **Foreslå med AI**, hvis du vil have en startbeskrivelse hentet fra en websøgning.
4. Gem og gå videre. Du udfylder resten fra kortdetaljesiden.

Manuel indtastning er langsom, men producerer den højeste datakvalitet, fordi hvert kort er ejer-berørt ved indtastning.

## Brug godkendelsesarbejdsprocessen som kvalitetsport

Hvert kort bærer en **godkendelsesstatus**: Udkast → Godkendt → (Brudt, hvis det redigeres væsentligt efter godkendelse).

En praktisk arbejdsproces:

1. Nye kort lander som **Udkast**. Arkitekten (dig) gennemgår dem hurtigt — navn korrekt, beskrivelse fornuftig, livscyklus rigtig.
2. Når minimumsfelterne er udfyldt, **godkend** kortet. Dette signalerer til downstream-forbrugere, at kortet er troværdigt.
3. Hvis nogen senere redigerer et væsentligt felt, vipper Turbo EA automatisk status til **Brudt**, indtil det godkendes igen.

Filtrér lageret efter `Godkendelsesstatus = Godkendt` for at få en ren visning til porteføljerapporten i slutningen af denne guide.

!!! tip "Bedste praksis"
    Godkend i bunker i slutningen af hver dag. Det tvinger dig til at genlæse, hvad du har importeret, og fange de værste datakvalitetsproblemer tidligt.

## Hvornår skal du holde op med at befolke og gå videre

Du er færdig med denne side, når:

- Hver applikation i dit område har et kort.
- Hvert kort har de fem minimumsfelter udfyldt.
- Den gennemsnitlige datakvalitet på tværs af sættet er **≥ 40 %**.
- Mindst 50 % af kortene er godkendt.

Vent ikke på perfektion. Gå videre til den næste side — [Udnyt referencekataloger](leverage-reference-catalogues.md) — og kom tilbage for at berige, efter du har kortlagt kompetencer.
