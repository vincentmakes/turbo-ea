# Udvidelser

**Udvidelsesbutikken** (Admin → Udvidelser) installerer leverandørsignerede udvidelser, der tilføjer kundespecifikke funktioner — ekstra metamodel-indhold, integrationer, baggrundsjobs og endda nye sider — uden at ændre Turbo EA's kerne («clean core»-princippet).

Alt leveres som filer: udvidelsen er en signeret `.teax`-pakke, og licensen er en signeret tekstfil, begge typisk sendt via e-mail. Der kræves hverken onlineaktivering, butikskonto eller udgående forbindelser, så hele arbejdsgangen fungerer identisk på **isolerede (air-gapped)** installationer.

Siden har to faner: **Butik** gennemser leverandørens udvidelseskatalog med installation med ét klik (hvis instansen har internetadgang), og **Installerede** håndterer licenser og installerer fra filer.

## Sådan fungerer tilliden

To uafhængige kontroller beskytter din installation:

1. **Oprindelse (signatur).** Hver pakke bærer en Ed25519-signatur fra leverandørens nøgle. Turbo EA verificerer den ved upload *og igen ved hver backend-start*. Usignerede, manipulerede eller tredjepartspakker afvises — en installeret udvidelse er garanteret præcis det, leverandøren har bygget.
2. **Aktivering (licens).** En signeret licensfil oplister dine rettigheder — én pr. udvidelse, hver med sin egen udløbsdato. En installeret udvidelse kører kun, så længe der findes en gyldig rettighed.

## Fanen Butik

Fanen **Butik** virker uden nogen konfiguration og viser leverandørens udgivne udvidelser med beskrivelse og pris:

- **Køb** åbner betalingssiden i en ny browserfane. Så snart betalingen er bekræftet, anvendes din licens automatisk (en kopi ankommer også pr. e-mail).
- **Installer** (eller **Opdater**, når en nyere version er udgivet) tjekker først din licens — hvis udvidelsen endnu ikke er licenseret, tilbyder en dialog at købe eller indsætte en licens og fortsætter derefter automatisk — og downloader pakken gennem præcis den samme signaturkontrol og prøvekørselsforhåndsvisning som en manuel upload.

Fanen Butik er skrivebeskyttet og anonym: ingen konto, intet token, og intet om din instans sendes nogen steder hen — kun leverandørens offentlige katalog læses. Isolerede instanser behøver ingen konfiguration — fanen viser i stedet blot et venligt hint — og bruger det filbaserede forløb nedenfor; leverandørens butikswebsted tilbyder de samme køb og downloads fra enhver browser med internetadgang.

## Installer en udvidelse

1. Hvis du ikke allerede har gjort det, skal du først anvende din licens (se nedenfor).
2. Åbn **Admin → Udvidelser**, vælg **Installer fra fil…** under fanen Butik, og upload den `.teax`-fil, du har modtaget.
3. Turbo EA verificerer signaturen og viser en **forhåndsvisning**: for indholdsbærende udvidelser er det en prøvekørsel af hver korttype, tag-gruppe, kort og relation, som udvidelsen ville oprette eller opdatere — intet skrives endnu.
4. Gennemgå forhåndsvisningen, og tryk på **Installer udvidelse**.
5. Hvis udvidelsen indeholder backend- eller UI-kode, beder et banner dig om at genstarte backend-containeren (`docker compose restart backend`). Rene indholdsudvidelser er aktive med det samme.

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
