# Digital Autonomy Assessment

**Digital Autonomy Assessment** bringer Utrecht Universitets **Digital Autonomy
Assessment Framework (DAAF)** ind i Turbo EA på applikationsniveau. Udvidelsen
tilføjer et afsnit **Digital autonomi** til hvert applikationskort — 22 vægtede
indikatorer fordelt på risikoeksponering, afbødningskapacitet og strategisk
betydning, hver bedømt fra 1 til 5 efter DAAF's oprindelige rubrik og med
indbygget vejledning — beregner automatisk en autonomi-score fra 1 til 10 og
placerer hele porteføljen i en **autonomi-kvadrant**.

Den besvarer et spørgsmål, de fleste landskabsoverblik lader stå åbent: *hvis
denne leverandør i morgen ikke længere var tilgængelig, ikke længere til at betale
eller ikke længere lovlig at bruge, hvor udsatte ville vi så være — og hvad kunne
vi rent faktisk gøre?*

## Kort fortalt

| | |
|---|---|
| **Licens** | **Gratis** — kører uden nogen licensrettighed |
| **Mindste Turbo EA-version** | 2.17.0 |
| **Rettighed** | `ext.digital-autonomy.view` |
| **Tilladelser til dataadgang** | ingen |
| **Genstart af backend nødvendig** | nej |
| **Hvor den vises** | Afsnittene **Digital autonomi** og **Digital autonomi-score** på applikationskort · **Rapporter → Digital autonomi** · **Ny fra skabelon** på undersøgelsessiden |

## Kom i gang

1. Installér udvidelsen fra **Admin → Udvidelser**. Der er ingen licens at anvende
   og ingen genstart — felterne dukker op med det samme.
2. Tildel `ext.digital-autonomy.view` under **Admin → Brugere og roller** til de
   roller, der skal kunne se rapporten. Administratorer har den allerede.
3. Beslut, om I vil bruge den **hurtige** eller den **fulde** vurdering — se
   [Hurtig eller fuld vurdering](#hurtig-eller-fuld-vurdering). Den fulde version
   med 22 indikatorer er slået til fra start.
4. Bedøm jeres applikationer — kort for kort eller
   [via en undersøgelse](#indsaml-bedommelser-via-undersogelse).

## Indikatorerne

Afsnittet **Digital autonomi** vises på hvert applikationskort, grupperet i otte
dimensioner (A–H). Hver indikator bedømmes fra **1 til 5** efter sin egen rubrik.

![Afsnittet «Digital autonomi» på et applikationskort](../assets/img/en/65_ext_digital_autonomy_indicators.png)

Klik på et tal for at bedømme; klik igen på det valgte tal for at fjerne
bedømmelsen. Når musen holdes over et tal, vises rubrikteksten for netop det
niveau, og hver indikator har en foldbar **hjælp** med DAAF-noten og definitioner
af de begreber, den bruger (*tilstrækkelighedsafgørelse*, *CLOUD Act*, *FISA 702*
med flere).

Indikatorer markeret **Hurtig** udgør den hurtige vurdering.

| Dimension | Indikator | Vægt | Hurtig |
|---|---|---|---|
| **A · Geopolitisk og juridisk compliance-risiko** | A1 · Leverandørens jurisdiktion | 3 | ✔ |
| | A2 · Sanktioner og geopolitisk risiko | 2 | |
| | A3 · Hosting og dataplacering | 2 | ✔ |
| **B · Leverandør- og forsyningskædeafhængigheder** | B1 · Leverandørkoncentration | 3 | ✔ |
| **C · Teknisk robusthed** | C1 · Alternativ tilgængelig | 3 | ✔ |
| | C2 · Migrerbarhed | 3 | |
| | C3 · Dataportabilitet | 3 | |
| | C4 · Håndtering af kryptering | 2 | |
| | C5 · Softwaregennemsigtighed og åbenhed | 3 | |
| **D · Organisatorisk robusthed** | D1 · Intern ekspertise og videnskontinuitet | 3 | ✔ |
| | D2 · Exitplan på plads | 3 | |
| | D3 · Backupstrategi | 2 | |
| **E · Kontraktuel robusthed** | E1 · Exitklausuler og overgangsaftale | 3 | ✔ |
| | E2 · Kontraktuel fleksibilitet | 2 | |
| **F · Organisatorisk betydning** | F1 · Konsekvens ved nedbrud | 3 | ✔ |
| | F2 · Integrationsafhængigheder | 2 | |
| **G · Datafølsomhed, adgangsstyring og politik** | G1 · Persondata | 3 | ✔ |
| | G2 · Forskningsdata og videnssikkerhed | 3 | |
| | G3 · Immaterielle rettigheder | 2 | |
| **H · Akademisk betydning** | H1 · Akademisk frihed | 3 | ✔ |
| | H2 · Forskningssamarbejde | 2 | |
| | H3 · Langtidsarkivering | 2 | |

!!! note "Hvilken retning er den gode?"
    Rubrikkerne vender ikke alle samme vej, og kontrollen farvelægger dem
    derefter. For **risiko**indikatorer (A, B, F, G, H) er **1 bedst** — niveau 1
    på A1 lyder for eksempel «EU/EØS-jurisdiktion. Ingen ekstraterritoriale krav.
    Fuld EU-beskyttelse.» og niveau 5 «Ingen tilstrækkelighedsafgørelse, ingen
    garantier. Direkte adgang for udenlandske myndigheder.» For
    **kapabilitets**indikatorer (C, D, E) er **5 bedst**. I behøver ikke huske
    det: knapperne er farvegraduerede og mærket **Lav** og **Høj**.

## Scoren

Det skrivebeskyttede afsnit **Digital autonomi-score** ligger under indikatorerne
og genberegnes automatisk, hver gang I gemmer.

![Den beregnede autonomi-score på et applikationskort](../assets/img/en/64_ext_digital_autonomy_score.png)

| Felt | Betydning |
|---|---|
| **Risikoeksponering** | Vægtet gennemsnit af dimension A (geopolitik) og B (leverandørkoncentration) |
| **Afbødningskapacitet** | Vægtet gennemsnit af teknisk (C), organisatorisk (D) og kontraktuel (E) robusthed |
| **Strategisk betydning** | Vægtet gennemsnit af F (organisatorisk betydning), G (datafølsomhed) og H (akademisk betydning) |
| **Autonomi-score** | Ét samlet tal fra 1 til 10, vist som måler |

**Højere er bedre** — 10 er optimalt, 1 er akut.

!!! warning "En delvis vurdering giver slet ingen score"
    Alle formler er sikret: mangler bare én nødvendig indikator, forbliver scoren
    tom i stedet for at vise et misvisende tal. En applikation optræder først i
    kvadrantrapporten, når dens vurdering er fuldstændig.

Fordi scorerne gemmes på kortet som ethvert andet felt, er de tilgængelige overalt:
i inventaret, i filtre, i eksporter og i jeres egne rapporter.

## Hurtig eller fuld vurdering

Udvidelsen leverer **to varianter af de samme fire beregninger** — den ene læser
alle 22 indikatorer, den anden kun de ni fra den hurtige vurdering. Hvilket par der
er **aktivt**, afgør både hvad der beregnes, *og* hvor mange indikatorer kortet
viser.

Skift under **Admin → Metamodel → Beregninger**:

- **Fuld vurdering (standard)** — de fire rækker *Digital Autonomy — … (full)* er
  aktive, og *(quick)*-rækkerne er inaktive. Kortene viser alle 22 indikatorer.
- **Hurtig vurdering** — aktivér de fire rækker *Digital Autonomy — … (quick)* og
  deaktivér de fire *(full)*-rækker. Kortene viser kun de ni hurtige indikatorer,
  og scoren beregnes ud fra dem.

!!! tip "Der findes ingen særskilt visningsknap"
    Dette ene valg i beregningerne udgør hele omskifteren. Kortet skjuler
    automatisk de 13 indikatorer, der kun hører til den fulde vurdering, så snart
    det hurtige sæt er aktivt, og rapporten følger samme indstilling. Aktivér
    aldrig begge varianter samtidig — de skriver i de samme felter.

## Indsaml bedømmelser via undersøgelse

I stedet for selv at udfylde 22 indikatorer for hver applikation kan I spørge dem,
der ved besked. Brug **Ny fra skabelon** på **Admin → Undersøgelser**:

- **New DAAF survey — Quick (9)** opretter udkastet *DAAF Quick Scan*.
- **New DAAF survey — Full (22)** opretter udkastet *DAAF Full Assessment*.

Begge er rettet mod applikationskort og åbnes som **udkast** i
undersøgelsesbyggeren, så intet sendes, før I har gennemgået det. Vælg den
interessentrolle, der skal modtage den (og eventuelle filtre — et livscyklustrin,
en undertype), og send. Respondenterne møder den samme 1–5-bedømmelseskontrol og
den samme indbyggede hjælp som på kortet; når svarene anvendes, skrives scorerne
tilbage på kortene.

I kan oprette en ny undersøgelse fra en skabelon, så ofte I vil — en årlig
genvurdering er blot ét klik.

## Autonomi-kvadrantrapporten

**Rapporter → Digital autonomi** viser hver fuldt vurderet applikation.

![Rapporten «Autonomi-kvadrant»](../assets/img/en/63_ext_digital_autonomy_quadrant.png)

Den vandrette akse er **risiko × strategisk betydning**, den lodrette er
**afbødningskapacitet** (høj øverst), hvilket giver fire kvadranter:

| Kvadrant | Hvad det betyder | Hvad I gør |
|---|---|---|
| **Optimal** | Lav eksponering, stærk afbødning | Fasthold og overvåg med jævne mellemrum. |
| **Håndterbar** | Høj eksponering, men et solidt alternativ | Risici accepteret med et solidt alternativ. |
| **Opmærksomhed** | Lav eksponering, svag afbødning | Opbyg afbødning, eller accepter risikoen bevidst. |
| **Kritisk** | Høj eksponering, svag afbødning | Akut handling: migrér eller afbød. |

Hver prik er nummereret og svarer til en række i listen ved siden af diagrammet,
der er **sorteret efter stigende score — de mest akutte først**. Et klik på en prik
eller en række åbner applikationen i et sidepanel, uden at I forlader rapporten.

**Filtre og akser**

- Vælgerne **Risikoeksponering**, **Afbødningskapacitet** og **Strategisk
  betydning** gør det muligt at lægge andre numeriske felter på hver akse —
  nyttigt, hvis I fører jeres egne tilsvarende mål. Jeres valg huskes i browseren.
- **Livscyklus** og **Undertype** indsnævrer udvalget.

Rapporten kan gemmes, deles, udskrives og eksporteres som sædvanligt. En gemt
visning optræder under **Rapporter → Gemte**.

## Rettigheder

| Rettighed | Tillader |
|---|---|
| `ext.digital-autonomy.view` | At se rapporten **Rapporter → Digital autonomi** |

Bedømmelse af indikatorerne bruger jeres almindelige **redigeringsrettigheder** på
applikationskort: den, der må redigere en applikation, må også bedømme den. Skift
mellem hurtig og fuld vurdering samt oprettelse af undersøgelser ud fra
skabelonerne kræver de sædvanlige administratorrettigheder til **Beregninger** og
**Undersøgelser**.

## Hvis udvidelsen deaktiveres eller fjernes

Deaktivering eller afinstallation fjerner de to afsnit fra korttypen, men
**rører aldrig ved de værdier, der er gemt på jeres kort**. Aktivér udvidelsen
igen, og hver eneste score dukker op præcis som før. Felterne flettes additivt, så
også de felter, jeres administratorer selv har tilføjet i afsnittene, bevares.

## Sprog

Indikatoretiketter, spørgsmål, rubrikker og hjælpetekst findes på **engelsk,
tysk, fransk, spansk, italiensk og dansk**. På portugisisk, kinesisk, russisk og
arabisk falder rammeværkets indhold tilbage til engelsk — kilderammeværket
tilbyder ikke disse sprog.

## Kreditering og licens

Denne udvidelse gengiver **Digital Autonomy Assessment Framework (DAAF)**, skabt
på **Utrecht Universitet** af **Tim van Neerbos** (Lead Enterprise Architect) som
en del af projektet Digital Autonomy.

- Kilde: <https://github.com/utrechtuniversity/digital-autonomy-assessment-tool>
- Oprindeligt værktøj: <https://utrechtuniversity.github.io/digital-autonomy-assessment-tool/>
- Licens: **Creative Commons Kreditering – IkkeKommerciel – DelPåSammeVilkår 4.0
  International (CC BY-NC-SA 4.0)** —
  <https://creativecommons.org/licenses/by-nc-sa/4.0/>
- © 2026 Universiteit Utrecht — Tim van Neerbos

**Der er foretaget ændringer.** Rammeværkets indikatorer, vægte, rubrikker,
hjælpenoter og 1–10-score er tilpasset, så de kører indbygget i Turbo EA på
applikationskortniveau — med en dedikeret 1–5-bedømmelsesfelttype, beregningerne af
niveauer og samlet score, undersøgelsesskabelonerne og autonomi-kvadrantrapporten.

De flersprogede oversættelser af rubrikker og hjælpetekst stammer fra
DAAF-projektet (udarbejdet med hjælp fra **Thomas Steenbergen, SIVON**; tysk,
fransk, spansk, italiensk og dansk er ifølge kilden bedst mulige oversættelser og
endnu ikke gennemlæst af modersmålstalende).

I henhold til rammeværkets **IkkeKommerciel**-vilkår distribueres denne udvidelse
**gratis**, og i henhold til **DelPåSammeVilkår** forbliver det tilpassede
DAAF-indhold, den indeholder, licenseret under CC BY-NC-SA 4.0.
