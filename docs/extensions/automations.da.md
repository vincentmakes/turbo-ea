# Automations

Det meste EA-governance er en liste over ting, nogen har lovet at gøre i hånden:
rejse en risiko, når en applikation krydser en omkostningstærskel uden en ejer,
rykke den tekniske ejer, når en komponent når end-of-life, advare
forretningsejeren, når et godkendt kort redigeres. Listen er rigtig; det er
udførelsen, der glider, fordi hvert punkt er en påmindelse i nogens hoved frem
for en regel, platformen holder.

**Automations** gør disse løfter til regler, som Turbo EA kører for dig. En regel
bygges udelukkende af dropdowns — *når* noget sker i landskabet, *hvis*
betingelserne er opfyldt, *så* udføres handlinger — og hver kørsel registreres
som en mutationsbatch i Auditloggen, så en regel, der gik galt, fortrydes med
ét klik.

## Kort fortalt

| | |
|---|---|
| **Licens** | Kommerciel — en signeret rettighed er påkrævet |
| **Mindste Turbo EA-version** | 2.128.0 |
| **Tilladelser** | `ext.automations.view`, `ext.automations.manage` |
| **Dataadgange** | Kort (læs + skriv), kort- og opgavehændelser, opgaver (læs + skriv), brugerkataloget, risici (læs + skriv), beslutningsdokumenter, notifikationer, interessentroller |
| **Kræver genstart af backend** | Ja — udvidelsen indeholder backend-kode |
| **Hvor den optræder** | **Automations** i afsnittet **Admin** i brugermenuen · en chip med antal kørsler på kortdetaljen |

## En regel: når, hvis, så

![Regelgitteret](../assets/img/en/86_ext_automations_rules.png)

Fanen **Regler** viser hver regel med dens udløser, korttype, handlinger, en
aktiveringskontakt, seneste kørsel og en afspilningsknap. Åbn en regel for at se
editoren.

![Regeleditoren](../assets/img/en/87_ext_automations_editor.png)

Editoren læser øverst reglen op for dig med almindelige ord og går derefter
gennem dens tre dele:

**Når** — det, der starter en kørsel. En regel overvåger én korttype og udløses
af én af følgende:

| Udløser | Udløses når |
|---|---|
| et kort oprettes / opdateres / arkiveres / gendannes | det kort ændres |
| en relation tilføjes / fjernes | en relation af en valgfrit angivet type rører kortet |
| en opgave fuldføres | en opgave knyttet til kortet lukkes |
| efter en tidsplan | et cron-udtryk med fem felter (UTC) indtræffer — reglen kontrollerer derefter hvert kort af typen |

**Hvis** — betingelserne, som indlejrede grupper af typen **alle af** / **enhver
af**. Hver række er et felt, en operator og en værdi valgt fra dropdowns: kortets
egne felter og livscyklusfaser, dets tags, dets interessentroller (*besættes af
ingen*, *besættes af*…), dets relationer, dets end-of-life-status på
applikationer og IT-komponenter og — ved *et kort opdateres* — hvad der
**ændrede sig**, så en regel kun udløses, når en værdi gik fra én tilstand til en
anden. Lad gruppen stå tom for at køre for hvert kort.

**Så** — handlingerne, udført i rækkefølge. En handling, der fejler, stopper
kørslen, og kørselsrækken fortæller, hvilket trin der fejlede.

| Handling | Hvad den gør | Kræver |
|---|---|---|
| Sæt / ryd et felt, sæt en livscyklusdato, sæt undertypen, forælderen, navnet eller beskrivelsen | Redigerer kortet | skrivning i inventaret |
| Sæt tags | Erstatter, tilføjer eller fjerner tags under hensyn til grupper med ét valg | skrivning i inventaret |
| Opret et relateret kort, knyt en relation | Tilføjer et kort af en anden type og forbinder det, eller forbinder to eksisterende kort | skrivning i inventaret |
| Arkivér kortet | Arkiverer det (kan gendannes i 30 dage) | skrivning i inventaret |
| Tildel / fjern en interessentrolle | Giver en rolle til en person, en rolleindehaver, forælderens rolleindehaver eller den person, der udløste reglen | interessentroller |
| Opret en opgave | En opgave på kortet til en ansvarlig, med en frist | opgaver |
| Giv personer besked | En notifikation i appen / pr. e-mail efter modtagernes egne præferencer | notifikationer |
| Rejs en risiko, opdatér en risiko | Registrerer en risiko i Risikoregistret med kategori, sandsynlighed og indvirkning, knyttet til kortet og ejet af nogen; en senere kørsel kan opdatere dens titel, ejer eller måldato | risici |
| Arkivér et beslutningsudkast | Et Architecture Decision Record som kladde, knyttet til kortet — underskrives aldrig af en regel | beslutningsdokumenter |
| Kald en webhook | En signeret HTTPS-forespørgsel til et eksternt system med kortet, det ændrede og reglen | — |
| Stop | Afslutter handlingslisten | — |

Titler, beskrivelser og beskeder er skabeloner: `{{card.name}}`,
`{{card.attributes.costTotalAnnual}}`, `{{actor.name}}`, `{{change.old}}` og
lignende udfyldes pr. kort, og editoren tilbyder variablerne fra en menu.

To indstillinger ligger under handlingerne. **Udløs én gang pr. kort** (slået til
som standard) husker, hvad en regel er udløst for, så en natlig regel ikke rejser
den samme risiko hver nat; den udløses igen, når de værdier, den læser, ændrer
sig. **Natlig opsamling** kontrollerer hvert kort igen kl. 03:00 UTC, så en
overset hændelse retter sig selv.

## Simulér og Kør nu

**Simulér** kører reglen mod hvert kort af dens type i forhåndsvisningstilstand —
intet skrives — og viser, hvor mange kort der matcher, og pr. kort præcis hvad
hver handling ville gøre. Aktiverer du en regel, der aldrig er blevet simuleret,
bliver du bedt om at simulere først; du kan stadig aktivere den uden.

**Kør nu** gør det samme i virkeligheden: den udløses straks for hvert matchende
kort under hensyn til *udløs én gang pr. kort*, medmindre du markerer *udløs igen
for kort, den allerede har behandlet*. Resultatdialogen viser, hvad der blev
gjort, kort for kort, og linker til auditbatchen.

![Kørselsresultater](../assets/img/en/88_ext_automations_run_results.png)

## Kørsler og Auditloggen

![Fanen Kørsler](../assets/img/en/89_ext_automations_runs.png)

Hver kørsel er en række på fanen **Kørsler**: hvilken regel, på hvilket kort,
hvordan den startede (en hændelse, tidsplanen, den natlige opsamling, Kør nu),
hvordan den endte og hver handlingslinje. Filtrér efter regel eller udfald; et
korts eget antal kørsler sidder som en chip på dets detaljeside.

Hver skrivning, en kørsel foretager, lander i **Admin → Indstillinger →
Auditlog** som en udvidelsesbatch med forskelle pr. hændelse. En **scanning** — en
tidsplan, den natlige opsamling eller Kør nu — er **én batch for hvert kort, den
blev udløst for**, så en regel, der gik galt, er én **tilbagerulning** (**Rul
tilbage**), ikke én pr. kort. Tilbagerulningen omgør skrivningerne på kort og
relationer og, fra Turbo EA 2.127.0, de risici, kørslen rejste eller redigerede,
de roller, den tildelte, de tags, den satte, og de beslutningsudkast, den
arkiverede. Opgaver og notifikationer lades bevidst stå — en anmodning til en
person og en leveret besked fortrydes ikke ved at slette dem — og
forhåndsvisningen af tilbagerulningen siger det, før noget anvendes.

## Notifikationer grupperes

En regel sender aldrig én notifikation pr. kort. En scanning samler, hvad hver
person har til gode, og sender til sidst **én** notifikation pr. person og regel —
et enkelt kort ankommer som sin egen besked, flere som et sammendrag, der
navngiver kortene, og hvis titel du sætter i handlingen (*Sammendragets titel*).
Ændringer, der ankommer én ad gangen — en import, der rører tre hundrede kort —
sender den første notifikation med det samme og holder resten tilbage i
**grupperingsvinduet** i Indstillinger; det næste minut sendes det ophobede som
ét sammendrag. Hver persons egne notifikationspræferencer afgør stadig klokke,
e-mail eller en udvidelseskanal.

Et klik på en grupperet notifikation i klokken åbner dens **detaljer** på stedet — den fulde oversigt og én chip pr. kort, der fører til det kort — fordi fanen Kørsler bag den er en administratorside; kun personer med `ext.automations.view` får desuden en **Åbn**-knap dertil. En notifikation om et enkelt kort fører stadig direkte til kortet. Hver automatiseringsnotifikation bruger sin egen række **Automatiseringsnotifikationer** i dine notifikationsindstillinger (i appen slået til, e-mail slået fra som standard), adskilt fra den generiske udvidelsesbesked.

## Skabeloner

Fanen **Skabeloner** er et galleri af færdige regler — en dyr applikation uden
ejer, end-of-life inden for 180 dage, en ny applikation uden
forretningskompetence, et godkendt kort, der er blevet redigeret, lav
datakvalitet i en måned, en applikation på vej i udfasning, et kort arkiveret
med åbne relationer, et initiativ, der bliver aktivt, en kritisk applikation uden
teknisk ejer, en ny leverandør registreret, en IT-komponent ved end-of-life.
Hver åbnes i editoren, deaktiveret, så du kan justere og simulere den.

## Indstillinger

![Indstillinger](../assets/img/en/90_ext_automations_settings.png)

| Indstilling | Hvad den gør |
|---|---|
| **Reserveperson** | Modtager opgaven, risikoen eller notifikationen, når en regel ikke finder nogen i den rolle, den bad om |
| **Tilladte webhook-værter** | Værter, som handlingen *Kald en webhook* må nå, én pr. linje; tom tillader enhver offentlig HTTPS-vært. Private og interne adresser afvises altid |
| **Kort kontrolleret pr. planlagt kørsel** | Hvor mange kort én planlagt scanning ser på, før den stopper og overlader resten til den næste |
| **Gruppér notifikationer, der ankommer inden for** | Grupperingsvinduet i minutter; 0 sender hver enkelt ved næste minut |

## Demodata

**Indlæs demodata** i Indstillinger installerer skabelonerne og tre
demonstrationsregler på eksempellandskabet, aktiverer de fleste af dem og kører
nogle få én gang, så fanerne Regler, Kørsler og Auditlog har noget at vise.
**Fjern** tager præcis det ud igen — regler, kørsler, de opgaver og risici, de
oprettede.

## Tilladelser

| Tilladelse | Giver |
|---|---|
| `ext.automations.view` | Se reglerne, deres kørsler og skabelongalleriet samt chippen med antal kørsler på kort |
| `ext.automations.manage` | Oprette, redigere, aktivere, simulere, køre og slette regler; ændre indstillingerne; indlæse demodata |

## Hvis licensen udløber, eller udvidelsen deaktiveres

Siden forsvinder fra menuen, tidsplanerne stopper, og hændelser sendes ikke
længere videre. Intet slettes: reglerne, deres kørsler og alt, hvad de skrev —
kort, risici, opgaver, beslutninger — bliver stående præcis, som de er. En fornyet
licens eller en genaktiveret udvidelse bringer reglerne tilbage, stadig
aktiverede.

## Bemærkninger og begrænsninger

- Turbo EA tillader en udvidelse 60 auditerede batches i minuttet. En scanning
  over et meget stort inventar holder pause ved den grænse og fortsætter ved
  næste tik; Kør nu siger det i sit resultat, og den næste scanning samler de
  resterende kort op.
- En regel, der overvåger *et kort opdateres*, ser kun ændringer foretaget, efter
  at den blev aktiveret; brug Kør nu, eller vent på den natlige opsamling for det
  eksisterende landskab. Betingelser på **hvad der ændrede sig** matcher kun
  levende opdateringer.
- Webhooks er kun HTTPS, signeres med en hemmelighed pr. instans, følger aldrig
  omdirigeringer og får timeout efter 10 sekunder; svaret registreres på
  kørslen.
- En regel kan kun opdatere de risici, den selv har rejst, og den kan aldrig
  underskrive en beslutning, skifte status på en risiko eller fuldføre en opgave
  — det forbliver menneskelige handlinger.
