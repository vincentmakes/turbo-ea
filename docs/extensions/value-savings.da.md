# EA Value Tracker

Enhver EA-funktion møder før eller siden det samme spørgsmål fra økonomidirektøren
eller IT-direktøren: *hvad er arkitektur egentlig værd for os?* Roadmaps og
diagrammer svarer ikke på det — det gør tal.

**EA Value Tracker** gør Turbo EA's [arkitekturbeslutninger](../guide/delivery.md)
til et revisionsegnet økonomisk regnskab over den værdi, jeres EA-praksis skaber.
Værdien anmeldes dér, hvor den opstår — på beslutningen — fastfryses ved
underskrift og afstemmes senere med det, der faktisk blev realiseret, efter
fire-øjne-princippet. Et dashboard samler det hele, så svaret ved budgetgennemgangen
er én rapport i stedet for en jagt gennem regneark.

## Kort fortalt

| | |
|---|---|
| **Licens** | Kommerciel — kræver en signeret licensrettighed |
| **Mindste Turbo EA-version** | 2.14.0 |
| **Rettigheder** | `ext.value-savings.record`, `ext.value-savings.approve` |
| **Tilladelser til dataadgang** | ingen |
| **Genstart af backend nødvendig** | ja — indeholder backend-kode |
| **Hvor den vises** | Panelet **Værdi & besparelser** på beslutninger · regnskabet **Værdirealisering** under underskriftsblokken · fire kolonner i beslutningstabellerne · **Rapporter → EA Value Tracker** |

## Livscyklussen

Værdien gennemløber fire trin, der vises som en kæde på hver beslutning:

**Anmeldt (kladde)** › **Anmeldt (godkendt)** › **Realiseret (afventer)** ›
**Realiseret (godkendt)**

1. Mens en beslutning skrives, vedhæfter arkitekterne **anmeldte besparelser**.
2. **Underskriften fastfryser dem.** De tal, underskriverne godkendte, bliver til
   godkendte anmeldelser og kan ikke længere redigeres.
3. Efter leverancen **registrerer nogen, hvad der faktisk blev realiseret**, over
   for hver anmeldelse.
4. En **anden person godkender** realiseringen — den, der registrerer, kan aldrig
   godkende sine egne tal.

## Anmeld værdi på en beslutning

Åbn en beslutningskladde (**EA-leverance → Beslutninger**) og rul ned til **Værdi &
besparelser**, lige efter konsekvenserne.

![Panelet «Værdi & besparelser» på en beslutningskladde](../assets/img/en/66_ext_value_tracker_claims.png)

Tryk på **Tilføj besparelse**, og udfyld dialogen:

| Felt | Bemærkninger |
|---|---|
| **Kategori** | **Hårde besparelser**, **Bløde besparelser**, **Omkostningsundgåelse**, **Omsætningsfremme** eller **Risikoundgåelse** |
| **Beløb** | I jeres arbejdsområdes valuta. Skal være større end nul |
| **Regnskabsår** | Udledt af regnskabsårets start i [Generelle indstillinger](../admin/settings.md) |
| **Type** | **Engangs** eller **Løbende** |
| **Ansvarlig** | En eller flere personer, der står inde for tallet |
| **Beskrivelse** | Valgfri fritekst |

Tilføj så mange anmeldelser, som beslutningen berettiger. Ved siden af panelets
overskrift vises en løbende sum, og nedenunder en markering pr. kategori.

!!! note "«Løbende» er en oplysning"
    En post markeret som **løbende** bliver i det regnskabsår, I har givet den —
    den fremskrives aldrig automatisk til senere år. Skelnen findes, så læseren kan
    se forskel på en tilbagevendende årlig besparelse og en engangsgevinst, og så
    dashboardet kan vise det årlige løbende beløb særskilt.

Redigering af anmeldelser kræver den sædvanlige rettighed `adr.manage`.

## Hvad der sker ved underskrift

Når underskriverne signerer beslutningen, fastfryser Turbo EA hele beslutningen —
inklusive anmeldelserne. Editoren forsvinder fra brødteksten, og:

- anmeldelserne bliver til **Anmeldt (godkendt)** og er kun til læsning;
- regnskabet **Værdirealisering** dukker op **under underskriftsblokken**;
- i beslutningens hoved vises knappen **Værdirealisering** samt markeringerne
  **Anmeldt** og **Realiseret**, ved siden af Dublér og Ny revision.

Vil I ændre et godkendt tal, skal I oprette en **ny revision** af beslutningen. Det
er tilsigtet: de tal, underskriverne godkendte, bliver stående præcis som godkendt.

## Registrér og godkend realiseret værdi

![Regnskabet «Værdirealisering» under underskriftsblokken](../assets/img/en/67_ext_value_tracker_realization.png)

**Registrering.** Alle med `ext.value-savings.record` ser en knap **Registrér** på
hver godkendt anmeldelse, der endnu ikke har en realisering. Dialogen beder om det
faktiske **beløb**, **regnskabsåret**, en **godkender** og en valgfri beskrivelse.

Godkenderen **skal være en anden end den, der registrerer** — et
fire-øjne-princip, som serveren håndhæver, ikke blot formularen. Når der gemmes,
oprettes rækken som **Afventer**, og der dannes en opgave til godkenderen
(«Godkend realiseret værdi: …») med link tilbage til beslutningen samt den
sædvanlige tildelingsnotifikation.

**Godkendelse.** Den udpegede person — som også skal have
`ext.value-savings.approve` — åbner beslutningen og trykker **Godkend** eller
**Afvis** i den afventende række. Opgaven lukkes, og tallet bliver til
**Realiseret (godkendt)**. Afviste rækker bevares af hensyn til revisionssporet.

**Rettelser.**

- Kun den, der traf afgørelsen, kan senere vende den eller trykke **Træk afgørelse
  tilbage** for at sætte rækken tilbage til afventende (hvorved opgaven genåbnes).
- Kun den, der registrerede, kan slette sin egen række, og kun mens den stadig
  afventer. Godkendere afviser i stedet for at slette.
- Skal et allerede godkendt tal rettes, registrér da en **ny korrektionspost** i
  stedet for at ændre historikken.

## Dashboardet

**Rapporter → EA Value Tracker** samler det hele.

![EA Value Tracker-dashboardet](../assets/img/en/68_ext_value_tracker_dashboard.png)

**Værktøjslinje**

- **Anmeldt** / **Realiseret** — grundlaget for hele rapporten: værdi *anmeldt* på
  beslutninger eller værdi, der faktisk er *realiseret*.
- **Regnskabsår** — indeværende regnskabsår er valgt på forhånd; fravælg alt for at
  se samtlige år.
- Filtrene **Kategori** og **Person**.
- **Medtag kladder** eller **Medtag afventende**.

**Nøgletal** — Realiseret (godkendt), Godkendte anmeldelser, Løbende (årligt),
Kladde samt antallet af bidragende beslutninger.

**Besparelsestragten** viser de fire trin ved siden af hinanden, så afstanden
mellem det lovede og det opnåede springer i øjnene.

![Besparelser efter kategori](../assets/img/en/69_ext_value_tracker_categories.png)

**Besparelser efter kategori** er en ring med totalen i midten. **Besparelser pr.
person (ligelig fordeling)** krediterer en post med *N* ansvarlige med *beløb ÷ N*
til hver, så ingen værdi tælles dobbelt.

![Besparelser pr. regnskabsår](../assets/img/en/70_ext_value_tracker_fiscal_years.png)

**Besparelser pr. regnskabsår** dækker et fast vindue fra fire år tilbage til to år
frem og ignorerer bevidst regnskabsårsfilteret, så udviklingen altid kan læses.

To tabeller fuldender billedet: **fordelingen pr. person** og **bidragende
beslutninger** — det fulde regnskab med et **Åbn**-link til hver beslutning.

Rapporten kan gemmes, deles, udskrives og eksporteres til XLSX og PPTX som enhver
kernerapport og kan derfor gå direkte i materialet til styregruppen.

## I beslutningstabellerne

Fire kolonner føjes til den fælles beslutningstabel, både under **EA-leverance →
Beslutninger** og **GRC → Governance → Beslutninger**:

| Kolonne | Viser |
|---|---|
| **Anmeldte besparelser** | Samlet anmeldt på den beslutning |
| **Realiseret** | Samlede godkendte realiseringer |
| **Besparelsesgodkender** | Hvem der godkendte realiseringerne |
| **Besparelsesfase** | Det længst nåede trin |

De opfører sig som indbyggede kolonner — sortering, hurtigfilter og tema virker —
og kan skjules eller fastlåses fra kolonnevælgeren.

## Rettigheder

| Rettighed | Tillader |
|---|---|
| `adr.view` (kerne) | At se panelerne, kolonnerne og dashboardet |
| `adr.manage` (kerne) | At tilføje, redigere og slette anmeldelser på en usigneret beslutning |
| `ext.value-savings.record` | At registrere en realisering over for en godkendt anmeldelse |
| `ext.value-savings.approve` | At godkende eller afvise en realisering — **og** være den person, der er udpeget som godkender |

Tildel udvidelsens to rettigheder under **Admin → Brugere og roller**. Bemærk, at
`ext.value-savings.approve` ikke er nok i sig selv: serveren kontrollerer også, at
det er jer, der står som udpeget godkender på netop den række.

## Hvis licensen udløber, eller udvidelsen deaktiveres

Panelerne, kolonnerne og dashboardet forsvinder, men **intet slettes**.
Anmeldelserne ligger i selve beslutningen og følger med ved en
arbejdsområdeoverførsel; realiseringerne bliver i udvidelsens egne tabeller. En
fornyet licens bringer det hele tilbage.

## Bemærkninger og begrænsninger

- Besparelser indgår bevidst **ikke** i Word-eksporten af beslutningen: den
  eksport er beslutningsdokumentet, ikke det økonomiske regnskab.
- Realiseringer registreres over for en godkendt anmeldelse, så en beslutning skal
  være underskrevet, før der kan realiseres værdi på den.
- Udvidelsen indeholder backend-kode, så installation og opdatering kræver én
  genstart af backend'en. Turbo EA viser en besked, når det er tilfældet.
