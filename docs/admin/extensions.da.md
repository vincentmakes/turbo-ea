# Udvidelser

**Udvidelsesbutikken** (Admin → Udvidelser) installerer leverandørsignerede udvidelser, der tilføjer kundespecifikke funktioner — ekstra metamodel-indhold, integrationer, baggrundsjobs og endda nye sider — uden at ændre Turbo EA's kerne («clean core»-princippet).

Udvidelser installeres på to måder: **med ét klik fra den indbyggede Butik** (hvis instansen har internetadgang) eller ved at **uploade filerne direkte** — udvidelsen er en signeret `.teax`-pakke, og licensen er en signeret tekstfil, begge typisk sendt via e-mail. Den filbaserede fremgangsmåde kræver hverken butikskonto eller udgående forbindelse, så hele arbejdsgangen fungerer identisk på **isolerede (air-gapped)** installationer.

Siden har to faner: **Butik** gennemser leverandørens udvidelseskatalog med installation med ét klik, og **Installerede** håndterer licenser og installerer fra filer.

**Udvidelser bygges og signeres af Turbo EA** — de er ikke selvbyggede eller åbne for tredjeparter. Hvis du har brug for en funktion, der er skræddersyet til din organisation, kan vi bygge og licensere den til dig. Se [Turbo EA-rådgivning](https://www.turbo-ea.org/consulting).

## Sådan fungerer tilliden

To uafhængige kontroller beskytter din installation:

1. **Oprindelse (signatur).** Hver pakke bærer en Ed25519-signatur fra leverandørens nøgle. Turbo EA verificerer den ved upload *og igen ved hver backend-start*. Usignerede, manipulerede eller tredjepartspakker afvises — en installeret udvidelse er garanteret præcis det, leverandøren har bygget.
2. **Aktivering (licens).** En signeret licensfil oplister dine rettigheder — én pr. udvidelse, hver med sin egen udløbsdato. En installeret udvidelse kører kun, så længe der findes en gyldig rettighed. Licenser er **bundet til din instans-ID** — en licens udstedt til en anden instans afvises.

## Gratis udvidelser

Nogle udvidelser er **gratis** og kræver slet ingen licens. De installeres og kører med det samme — der er ingen købstrin og ingen licensfil at indsætte. Gratis udvidelser er markeret med et **Gratis**-mærke på fanerne Butik og Installeret, og handlingerne **Køb** og **Forny** er skjult for dem. Signaturkontrollen gælder stadig præcis som for betalte udvidelser (en gratis udvidelse er stadig signeret af leverandøren), så oprindelsen er garanteret uanset hvad. Da de ikke kræver nogen rettighed, udløber gratis udvidelser aldrig og går aldrig i en henstandsperiode.

## Din instans-ID

Hver installation genererer én gang en unik **instans-ID** (`TEA-XXXX-XXXX-XXXX`), som vises øverst på Admin → Udvidelser med en kopieringsknap. Det er din licensidentitet: Oplys den ved køb (den indbyggede Butik sender den automatisk; webbutikkens betaling beder om den), så hver udvidelse købt til denne instans — af enhver administrator, med enhver e-mail — ender i én samlet licens. Den identificerer kun din instans; den er aldrig en adgangsnøgle, så den kan trygt deles med din leverandør.

ID'et følger med en workspace-overførsel, så flytning til en ny vært holder licensen gyldig. Efter en **fuld geninstallation** får instansen et nyt ID — bed din leverandør om at genudstede licensen til det (et hurtigt «re-key» hos leverandøren).

## Fanen Butik

Fanen **Butik** virker uden nogen konfiguration og viser leverandørens udgivne udvidelser med beskrivelse og pris:

- **Køb** åbner betalingssiden i en ny browserfane. Så snart betalingen er bekræftet, anvendes din licens automatisk (en kopi ankommer også pr. e-mail).
- **Installer** (eller **Opdater**, når en nyere version er udgivet) tjekker først din licens — hvis udvidelsen endnu ikke er licenseret, tilbyder en dialog at købe eller indsætte en licens og fortsætter derefter automatisk — og downloader pakken gennem præcis den samme signaturkontrol og prøvekørselsforhåndsvisning som en manuel upload. Udvidelser med demo viser et **Se det i praksis**-link, og en udgivet nyere version gør knappen til **Opdater**.

Fanen Butik er skrivebeskyttet og anonym: ingen konto, intet token, og intet om din instans sendes nogen steder hen — kun leverandørens offentlige katalog læses. Isolerede instanser behøver ingen konfiguration — fanen viser i stedet blot et venligt hint — og bruger det filbaserede forløb nedenfor; leverandørens butikswebsted tilbyder de samme køb og downloads fra enhver browser med internetadgang.

## Installer en udvidelse

1. Hvis du ikke allerede har gjort det, skal du først anvende din licens (se nedenfor).
2. Åbn **Admin → Udvidelser**, vælg **Installer fra fil…** under fanen Butik, og upload den `.teax`-fil, du har modtaget.
3. Turbo EA verificerer signaturen og viser en **forhåndsvisning**: for indholdsbærende udvidelser er det en prøvekørsel af hver korttype, tag-gruppe, kort og relation, som udvidelsen ville oprette eller opdatere — intet skrives endnu.
4. Gennemgå forhåndsvisningen, og tryk på **Installer udvidelse**.
5. Hvis udvidelsen indeholder backend-kode, beder et banner dig om at genstarte backend-containeren (`docker compose restart backend`). Indholds- og UI-udvidelser er aktive med det samme — brugerne ser den nye brugerflade ved næste sideindlæsning.

Det er sikkert at uploade den samme pakke igen — forhåndsvisningen viser alt som «sprunget over», og anvendelse ændrer intet.

## Licenser og fornyelse

Anvend en licens via **Indtast licens…** under fanen Installerede (indsæt teksten eller upload filen) — knappen vises også på hver udvidelsesrække, der mangler en. Siden viser derefter licenstageren og en chip pr. rettighed med udløbsdato.

Når en rettighed passerer sin udløbsdato, starter en **henstandsperiode** (30 dage som standard): alt fungerer fortsat, og administratorer ser et advarselsbanner. Efter henstanden bliver udvidelsen **blødt deaktiveret** — dens sider forsvinder, dens API afviser forespørgsler, og dens baggrundsjobs pauser. **Der slettes aldrig data.** Anvendelse af en fornyet licensfil gendanner alt med det samme, uden genstart.

Licenser købt via Butikken fornyer sig selv på forbundne instanser: efter hver gennemført betaling henter din instans automatisk den forlængede licens — intet at indsætte. På en isoleret installation er fornyelse: indsæt den opdaterede licensfil fra fornyelses-e-mailen (eller anmod leverandøren om en) — intet andet.

## Aktivér, deaktivér og afinstaller

- Kontakten **Aktiveret** deaktiverer en udvidelse blødt med det samme (ingen genstart) og kan slås til igen når som helst. For indholdspakker skjuler dette deres korttyper fra metamodellen — kort bliver, hvor de er.
- **Afinstaller** fjerner udvidelsens filer og skjuler dens korttyper fra metamodellen. Kort og udvidelsens egne tabeller bevares bevidst, og alt — typer inklusive — dukker op igen, hvis du geninstallerer.

## Tilladelser

Hele siden og alle dens API-ruter er beskyttet af den dedikerede tilladelse `admin.manage_extensions` (tildelt den indbyggede Admin-rolle). Udvidelser kan definere deres egne tilladelsesnøgler (`ext.<navn>.…`), som vises under **Admin → Brugere & roller**, når udvidelsen er indlæst.

## Avancerede feltfunktioner

Nogle udvidelser låser op for avancerede måder at beskrive dine data på, som kernen ikke tilbyder af sig selv:

- **Felthjælpetekst** — en sammenklappelig vejledning under et felt under dataindtastning, så en formular forklarer sig selv.
- **Brugerdefinerede felttyper** — nye felttyper ud over det indbyggede sæt (for eksempel en konfigurerbar bedømmelse fra 1–5 eller 0–10).

Disse valgmuligheder vises i metamodellens felteditor **kun, mens den udvidelse, der leverer dem, er installeret og licenseret**. Hvis en sådan udvidelse senere deaktiveres, eller dens licens udløber, vises de værdier, du allerede har indtastet, fortsat som almindelig skrivebeskyttet tekst — intet tømmes eller slettes — og redigeringsmulighederne forsvinder blot, indtil udvidelsen er aktiv igen.

## Hvor udvidelsessider vises

Udvidelsessider vises i navigationen, når udvidelsen er installeret og licenseret — normalt som deres eget menupunkt på øverste niveau, selvom nogle rapporter placeres under menuen **Rapporter** sammen med de indbyggede.
