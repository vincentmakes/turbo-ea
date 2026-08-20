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

Når kataloget indeholder kategorier, viser hvert element små piller (free eller commercial samt emner som integration), og en filterbjælke vises over listen — klik på pillerne for at indsnævre den (flere piller kombineres), og **All** nulstiller visningen.

Fanen Butik er skrivebeskyttet og anonym: ingen konto, intet token, og intet om din instans sendes nogen steder hen — kun leverandørens offentlige katalog læses. Isolerede instanser behøver ingen konfiguration — fanen viser i stedet blot et venligt hint — og bruger det filbaserede forløb nedenfor; leverandørens butikswebsted tilbyder de samme køb og downloads fra enhver browser med internetadgang. Hvis noget mellem din instans og butikken blokerer anmodningen — en proxy, en firewall eller botbeskyttelse foran butikken — siger fanen det og nævner den HTTP-status, den fik tilbage, så en blokeret instans aldrig forveksles med en isoleret.

Instansen **tjekker desuden kataloget én gang om dagen** og fortæller, hvad der er ændret, så en ny udvidelse — eller en sikkerhedsrettelse til en, du allerede kører — ikke skal vente på, at nogen tilfældigvis åbner denne side. Administratorer (alle, hvis rolle giver `admin.manage_extensions`) får en notifikation i klokken, når en ny udvidelse udgives i butikken, og en anden, når en installeret udvidelse har en nyere version. Hver ændring annonceres én gang, og en travl udgivelsesdag ankommer som én notifikation pr. type frem for én pr. udvidelse. Intet hentes eller installeres — notifikationen bringer dig blot hertil. Det daglige tjek kan slås helt fra under [Admin → Indstillinger → Opdateringsnotifikationer](settings.md#update-notifications).

## Prøveperioder

Nogle betalte udvidelser tilbyder en **gratis 30-dages prøveperiode** — kig efter knappen **Start 30-dages prøveperiode** på Butik-fanen (eller prøvemuligheden på butikkens websted). At starte en prøveperiode fungerer som et køb uden betaling: der kræves intet kreditkort, din licens opdateres automatisk (en kopi ankommer også via e-mail til isolerede installationer), og udvidelsen kører med fuld funktionalitet i 30 dage.

- Hver Turbo EA-instans kan prøve en given udvidelse **én gang**.
- En prøveperiode slutter præcis på slutdatoen — der er ingen henstandsperiode. Udvidelsen holder derefter op med at køre, indtil du abonnerer; **dine data slettes aldrig**, og alt vender tilbage, i det øjeblik en abonnementslicens anvendes.
- Fanen «Installerede» viser prøverettigheder som **Prøveperiode indtil …**.
- Prøveperioder slutter af sig selv — der er intet at opsige, og der opkræves aldrig noget.

## Installer en udvidelse

1. Hvis du ikke allerede har gjort det, skal du først anvende din licens (se nedenfor).
2. Åbn **Admin → Udvidelser**, vælg **Installer fra fil…** under fanen Butik, og upload den `.teax`-fil, du har modtaget.
3. Turbo EA verificerer signaturen og viser en **forhåndsvisning**: for indholdsbærende udvidelser er det en prøvekørsel af hver korttype, tag-gruppe, kort og relation, som udvidelsen ville oprette eller opdatere — intet skrives endnu.
4. Gennemgå forhåndsvisningen, og tryk på **Installer udvidelse**.
5. Hvis udvidelsen indeholder backend-kode, beder et banner dig om at genstarte backend-containeren (`docker compose restart backend`). Indholds- og UI-udvidelser er aktive med det samme — brugerne ser den nye brugerflade ved næste sideindlæsning.

Det er sikkert at uploade den samme pakke igen — forhåndsvisningen viser alt som «sprunget over», og anvendelse ændrer intet.

## Opdatering af en udvidelse

Når butikken udgiver en nyere version af en installeret udvidelse, viser fanen Installerede en chip **Opdater til X** ved siden af versionen (og knappen på fanen Butik bliver til **Opdater**). Ét klik kører den samme signaturkontrol, forhåndsvisning og anvendelse som en ny installation. To sikkerhedsforanstaltninger gælder:

- Opdatering af en udvidelse, du bevidst har **deaktiveret**, holder den deaktiveret — den nye version lander på disken, men dens indhold forbliver skjult, og intet kører, før du aktiverer den igen.
- Installation af en pakke, der er **ældre** end den installerede version, kræver først en udtrykkelig bekræftelse: en nedgradering forstår muligvis ikke data skrevet af den nyere version. Intet slettes i nogen af tilfældene.

## Licenser og fornyelse

Anvend en licens via **Indtast licens…** under fanen Installerede (indsæt teksten eller upload filen) — knappen vises også på hver udvidelsesrække, der mangler en. Siden viser derefter licenstageren og en chip pr. rettighed med udløbsdato.

Din instans har **kun én licens ad gangen** — at anvende en ny erstatter den forrige. Licenser udstedt via Store indeholder altid alle køb foretaget for din instans, så udskiftning er sikker. Hvis du også har manuelt udstedte licenser, så bed din leverandør om én samlet licens i stedet for at anvende filer pr. udvidelse; hvis en anvendt licens ville fjerne rettigheder, som den nuværende stadig dækker, viser Turbo EA dem og beder først om bekræftelse (der slettes under ingen omstændigheder data).

Når en rettighed passerer sin udløbsdato, starter en **henstandsperiode** (30 dage som standard): alt fungerer fortsat, og administratorer ser et advarselsbanner. Efter henstanden bliver udvidelsen **blødt deaktiveret** — dens sider forsvinder, dens API afviser forespørgsler, og dens baggrundsjobs pauser. **Der slettes aldrig data.** Anvendelse af en fornyet licensfil gendanner alt med det samme, uden genstart.

Licenser købt via Butikken fornyer sig selv på forbundne instanser: efter hver gennemført betaling henter din instans automatisk den forlængede licens — intet at indsætte. På en isoleret installation er fornyelse: indsæt den opdaterede licensfil fra fornyelses-e-mailen (eller anmod leverandøren om en) — intet andet.

### Status for automatisk fornyelse og opsigelse

Hver rettigheds-chip fortæller, hvad der sker på datoen: **Fornyes den {dato}** for et aktivt abonnement eller **Udløber den {dato} — fornyes ikke** efter en opsigelse. Oplysningen kommer fra selve den signerede licens og er derfor også korrekt på isolerede installationer — licensfilen, der sendes pr. e-mail efter enhver abonnementsændring, bærer den opdaterede status; indsæt den, og chippen er aktuel.

For at se fornyelsesdatoen, opsige eller genoprette automatisk fornyelse, ændre betalingsmetode eller hente fakturaer skal du bruge **Administrér abonnement** ved siden af licenstagerens navn (vises for licenser købt i Butikken). Knappen åbner din faktureringsportal i en ny fane — ingen konto nødvendig. På en isoleret installation kan knappen ikke nå butikken; brug i stedet linket **Administrér abonnement** i enhver licens-e-mail (kun din browser behøver internetadgang, ikke din Turbo EA-installation).

En opsigelse slukker aldrig for noget med det samme: Udvidelsen fungerer indtil udgangen af den betalte periode, hvorefter det normale forløb med henstandsperiode + blød deaktivering gælder. **Dine data slettes aldrig**, og et nyt abonnement genopretter alt.

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

## Dataadgangs-grants

De fleste udvidelser arbejder kun med deres egne data. En udvidelse, der integrerer med kernedata — for eksempel en connector, der synkroniserer todos med et eksternt opgavesystem som Jira eller MS Planner ([#921](https://github.com/vincentmakes/turbo-ea/discussions/921)) — skal deklarere **grants** i sit signerede manifest:

- `core.todos.read` / `core.todos.write` — læs eller ændr todos gennem udvidelses-SDK'et. Skriveadgang omfatter læseadgang. På system-todos (såsom underskriftsanmodninger) kan en synkroniseringsudvidelse kun sætte den eksterne reference, der vises som en chip — den kan aldrig fuldføre, redigere, omfordele eller slette dem, og todos, der ejes af en anden udvidelse, forbliver urørlige.
- `core.events.todo` — modtag hændelser om todo-ændringer, så en connector reagerer med det samme i stedet for at vente på næste polling-cyklus.
- `core.users.read` — slå brugere op (kun navn, e-mail og aktiv-status), så en connector kan matche ansvarlige med konti i det eksterne værktøj. Ingen data om roller, login eller præferencer eksponeres, og udvidelser kan aldrig ændre brugere.
- `core.cards.read` — læse kort, relationer og metamodellen, fx så en connector kan matche jeres applikationer med poster i et eksternt system. Arkiverede kort forbliver ude af syne.
- `core.cards.write` — oprette, opdatere eller arkivere kort og tilføje relationer, med præcis den validering appens egen editor anvender. Opdateringer fletter feltværdier i stedet for at erstatte dem, så en udvidelse aldrig kan slette data, den ikke administrerer, og der findes **ingen permanent sletning** — arkivering, med sit gendannelsesvindue, er den eneste fjernelse en udvidelse kan udføre.
- `core.events.card` — modtage ændringshændelser for kort og relationer, så en connector reagerer på ændringer i inventaret med det samme i stedet for ved næste afstemningscyklus.

Grants er en del af det leverandørsignerede bundle: de fastlægges ved pakningen og er synlige før installation. De gælder kun, mens udvidelsen er installeret, aktiveret og licenseret — deaktivering eller en udløbet licens tilbagekalder adgangen med det samme, uden genstart. Enhver ændring foretaget af en udvidelse registreres i **Admin → Auditlog** under oprindelsen **Udvidelse**, og en todo, der spejles fra et eksternt system, viser en chip med link til det eksterne element.

Hver ændring en udvidelse foretager, vises i **Admin → Auditlog** som en `ext:<nøgle>`-batch med felt-for-felt-forskelle og kan rulles tilbage derfra som enhver anden batch. Operatører har det sidste ord: miljøvariablen `EXTENSION_WRITES_ENABLED=false` sætter øjeblikkeligt alle udvidelsers skrivninger på pause (læsninger fortsætter, ingen genstart), og `EXTENSION_MAX_WRITES_PER_BATCH` / `EXTENSION_MAX_BATCHES_PER_MINUTE` begrænser, hvor meget en enkelt udvidelse kan ændre pr. batch og pr. minut.

## Hvor udvidelsessider vises

Udvidelsessider vises i navigationen, når udvidelsen er installeret og licenseret — normalt som deres eget menupunkt på øverste niveau, selvom nogle rapporter placeres under menuen **Rapporter** sammen med de indbyggede.
