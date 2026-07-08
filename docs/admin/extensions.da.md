# Udvidelser

**Udvidelsesbutikken** (Admin → Udvidelser) installerer leverandørsignerede udvidelser, der tilføjer kundespecifikke funktioner — ekstra metamodel-indhold, integrationer, baggrundsjobs og endda nye sider — uden at ændre Turbo EA's kerne («clean core»-princippet).

Alt leveres som filer: udvidelsen er en signeret `.teax`-pakke, og licensen er en signeret tekstfil, begge typisk sendt via e-mail. Der kræves hverken onlineaktivering, butikskonto eller udgående forbindelser, så hele arbejdsgangen fungerer identisk på **isolerede (air-gapped)** installationer.

## Sådan fungerer tilliden

To uafhængige kontroller beskytter din installation:

1. **Oprindelse (signatur).** Hver pakke bærer en Ed25519-signatur fra leverandørens nøgle. Turbo EA verificerer den ved upload *og igen ved hver backend-start*. Usignerede, manipulerede eller tredjepartspakker afvises — en installeret udvidelse er garanteret præcis det, leverandøren har bygget.
2. **Aktivering (licens).** En signeret licensfil oplister dine rettigheder — én pr. udvidelse, hver med sin egen udløbsdato. En installeret udvidelse kører kun, så længe der findes en gyldig rettighed.

## Installer en udvidelse

1. Hvis du ikke allerede har gjort det, skal du først anvende din licens (se nedenfor).
2. Åbn **Admin → Udvidelser**, vælg **Installer udvidelse**, og upload den modtagne `.teax`-fil.
3. Turbo EA verificerer signaturen og viser en **forhåndsvisning**: for indholdsbærende udvidelser er det en prøvekørsel af hver korttype, tag-gruppe, kort og relation, som udvidelsen ville oprette eller opdatere — intet skrives endnu.
4. Gennemgå forhåndsvisningen, og tryk på **Installer udvidelse**.
5. Hvis udvidelsen indeholder backend- eller UI-kode, beder et banner dig om at genstarte backend-containeren (`docker compose restart backend`). Rene indholdsudvidelser er aktive med det samme.

Det er sikkert at uploade den samme pakke igen — forhåndsvisningen viser alt som «sprunget over», og anvendelse ændrer intet.

## Licenser og fornyelse

Indsæt den modtagne licenstekst (eller upload filen) i kortet **Licens**. Siden viser derefter licenstageren og et mærke pr. rettighed med udløbsdato.

Når en rettighed passerer sin udløbsdato, starter en **henstandsperiode** (30 dage som standard): alt fungerer fortsat, og administratorer ser et advarselsbanner. Efter henstanden bliver udvidelsen **blødt deaktiveret** — dens sider forsvinder, dens API afviser forespørgsler, og dens baggrundsjobs pauser. **Der slettes aldrig data.** Anvendelse af en fornyet licensfil gendanner alt med det samme, uden genstart.

Fornyelse på en isoleret installation er derfor: anmod leverandøren om en ny licensfil (via e-mail), og indsæt den — intet andet.

## Aktivér, deaktivér og afinstaller

- Kontakten **Aktiveret** deaktiverer udvidelsen blødt med det samme (uden genstart) og kan altid slås til igen.
- **Afinstaller** fjerner udvidelsens filer. Data, den har oprettet — korttyper, kort og dens egne tabeller — bevares bevidst og dukker op igen ved geninstallation. En genstart er nødvendig for helt at aflæsse backend-kode.

## Onlinebutik (valgfrit)

Hvis din leverandør driver en online-udvidelsesbutik, kan du forbinde dig i stedet for at udveksle filer. Efter et køb modtager du en engangs-**aktiveringskode**: åbn **Admin → Udvidelser → Butik**, indtast butikkens URL og koden. Din installation viser derefter de pakker, du har ret til, med **installation** med ét klik, og **Opdater licens** opfanger fornyelser og nye køb med det samme — downloadede pakker gennemgår nøjagtig samme signaturkontrol og forhåndsvisning som manuelle uploads. Isolerede installationer forbinder sig simpelthen aldrig; det filbaserede flow ovenfor er fortsat fuldt understøttet.

## Tilladelser

Hele siden og alle dens API-ruter er beskyttet af den dedikerede tilladelse `admin.manage_extensions` (tildelt den indbyggede Admin-rolle). Udvidelser kan definere deres egne tilladelsesnøgler (`ext.<navn>.…`), som vises under **Admin → Brugere & roller**, når udvidelsen er indlæst.
