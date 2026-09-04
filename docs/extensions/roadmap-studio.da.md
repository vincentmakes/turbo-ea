# Roadmap Studio

Enhver EA-funktion får de samme to spørgsmål af sin CIO: *hvordan ser landskabet
ud om tre år*, og *hvad sker der, hvis vi vælger anderledes?* Præsentationer
besvarer det første dårligt og det andet slet ikke — de er forældede ugen efter
styregruppemødet, og to af dem kan ikke sammenlignes.

**Roadmap Studio** besvarer begge ud fra det inventar, du allerede
vedligeholder. Et **scenarie** er en plan lagt hen over dit levende landskab —
udfas dette, erstat hint på denne dato, tilføj disse tre ting, der endnu ikke
findes — gemt som et sæt ændringer frem for som en kopi af din graf. Intet af
det, du udforsker, rører dit inventar, før en plan er godkendt og anvendt, og
fordi planen læses op imod det, inventaret siger i dag, driver den aldrig
ubemærket væk fra virkeligheden.

## Kort fortalt

| | |
|---|---|
| **Licens** | Kommerciel — en signeret rettighed er påkrævet |
| **Mindste Turbo EA-version** | 2.119.0 |
| **Tilladelser** | `ext.roadmap-studio.view`, `.manage`, `.apply`, `.admin` |
| **Dataadgange** | Kort (læs + skriv), korthændelser, opgaver (læs + skriv), brugerkataloget, beslutningsdokumenter |
| **Kræver genstart af backend** | Ja — udvidelsen indeholder backend-kode |
| **Hvor den optræder** | **Roadmap** i hovednavigationen · en chip på kortdetaljen · et panel og en eksportsektion på beslutninger |

## Transformationer og scenarier

En **transformation** er det program, et sæt konkurrerende planer hører til —
f.eks. «ERP-modernisering» — og den navngiver de
[mål](../guide/reports.md), programmet står til ansvar for. Under den ligger
**scenarierne**: alternative svar på det samme spørgsmål. Ét af dem kan markeres
som **anbefalet**, så rummet ved, hvad arkitekten foreslår, før tallene læses.

Et scenarie uden for enhver transformation er helt i orden; det har blot ingen
alternativer at blive valgt frem for.

## Planlægningsinventaret og roadmappet

![Roadmappet: baner, plateauer og omkostningsbåndet](../assets/img/en/73_ext_roadmap_studio_roadmap.png)

**Roadmappet** tegner planen som daterede bjælker i baner, med et
omkostningsbånd nedenunder, der viser driftsomkostningen år for år — inklusive
pukkelen under paralleldrift, hvilket netop er det tal, en migrationsbusiness
case har for vane at skjule.

![Planlægningsinventaret](../assets/img/en/74_ext_roadmap_studio_inventory.png)

**Planlægningsinventaret** er den samme plan som et gitter: dine levende kort
plus de planlagte, med hver ændring imod dem. Planlagte kort lever inde i
scenariet og aldrig i dit hovedinventar.

En ændring, hvis målkort siden er arkiveret, flyttet eller omdateret et andet
sted, bliver **markeret som forældet** med begrundelsen — så en plan, der blev
skrevet for tre måneder siden, fortæller dig, hvad der har flyttet sig under den.

## Plateauer og arkitektursnittet

![Arkitekturen ved et plateau](../assets/img/en/75_ext_roadmap_studio_architecture.png)

Fordi hver ændring bærer en dato, er arkitekturen på et vilkårligt tidspunkt blot
scenariet evalueret på den dato. Navngiv de tidspunkter, der betyder noget, som
**plateauer** — «T1 · Kernekonsolidering, 3. kvt. 2027» — og gå dem igennem:
roadmappet, afhængighedsvisningen og tallene bevæger sig sammen.

## Sammenligning af scenarier

![Scenarier over for at gøre ingenting](../assets/img/en/76_ext_roadmap_studio_compare.png)

**Sammenlign** stiller hvert scenarie ved siden af nulscenariet på
driftsomkostning ved horisonten, transformationsudgift, antal kort og
end-of-life-eksponering, med hver plans **fordele og ulemper** skrevet ved siden
af tallene. En valgfri diskonteringsrente gælder for fremtidige år.

## Hvor planen møder kortet

![Et korts plads i planerne](../assets/img/en/77_ext_roadmap_studio_card_panel.png)

Åbn et hvilket som helst kort i dit inventar, og en chip fortæller dig, hvilke
planer der nævner det og hvordan — som noget, der udfases, som efterfølgeren i en
erstatning, eller som et kort, en plan placerer under en ny forælder.

## Gennemgang, beslutning og anvendelse

Dette er governance-forløbet, og det adskiller tre reelt forskellige ting:
**rådgivning**, **beslutningen** og **skrivningen**.

### 1 · Bed om en gennemgang

**Anmod om gennemgang** navngiver de personer, hvis mening du vil have, og
opretter en rigtig opgave til hver af dem, så den når deres opgaveside og deres
notifikationsklokke. Vælgeren dækker hele brugerkataloget — en anmelder er den,
der kan hjælpe med *denne* plan: sikkerhedsarkitekten for én, finanspartneren for
en anden.

Hver anmelder svarer i appen med **Anbefal**, **Ønsk ændringer** eller
**Kommentér** samt en note. Svarene er rådgivning. De beslutter ingenting, og
derfor bruger de ikke længere ordene «godkend» og «afvis».

### 2 · Diskutér den

Alle, der kan læse planen, kan skrive i dens **diskussion**. Tråden bærer hele
historien i den rækkefølge, den skete: kommentarer, hvert gennemgangssvar (ikke
kun det seneste) og siden indsendelserne og stemmerne. Udvalget læser den samme
samtale, som anmelderne havde, i stedet for at få en dom uden argumenterne bag.

### 3 · Send den til vurderingsudvalget

Et **vurderingsudvalg** er en navngiven gruppe personer, knyttet til en
transformation (se nedenfor). Når en plan har et, sender **Send til beslutning**
den derhen:

- status bliver **Afventer beslutning**, og planens indhold **låses**, så alle
  stemmer om det samme dokument;
- hvert medlem får en opgave *Beslut om …* med den sædvanlige
  tildelingsnotifikation;
- her vælger du, om godkendelsen skal arkivere et **beslutningsdokument** og
  oprette **initiativerne** — valgt ved indsendelsen, så de, der stemmer, kan se,
  hvad deres ja vil skabe.

**Godkendelsesreglen** (Admin → Indstillinger, se nedenfor) kan holde en plan
tilbage fra dens udvalg, indtil anmelderne har svaret.

### 4 · Udvalget stemmer

Hvert medlem stemmer **Godkend**, **Afvis** eller **Undlad**, med en valgfri
note, og kan skifte stemme, så længe runden er åben. Dialogen viser optællingen,
hvor mange godkendelser der stadig mangler, og hvad hvert medlem sagde.

Runden afgøres, så snart udvalgets **beslutningsregel** er afklaret:

| Regel | Godkender når | Afviser når |
|---|---|---|
| **Flertal** (standard) | Mere end halvdelen godkender | Så mange har afvist, at et flertal er umuligt |
| **Enstemmigt** | Alle medlemmer godkender | Et medlem afviser **eller** undlader |
| **Et hvilket som helst medlem** | Ét medlem godkender | Alle har stemt, ingen godkendte |

En afvisning falder, så snart en godkendelse er blevet aritmetisk umulig — ikke
først når alle har stemt om et allerede afgjort spørgsmål.

Det er **medlemskabet af udvalget**, der giver stemmeret —
`ext.roadmap-studio.apply` kræves ikke. Planens **forfatter må stemme** om sin
egen plan; dialogen siger det tydeligt, og dokumentet navngiver, hvem der stemte.

**Træk tilbage** tager en plan ud af udvalgets hænder, før det har besluttet.
Forfatteren, den der sendte den, og ethvert medlem kan gøre det — et udvalg, der
ønsker en omarbejdning, skal ikke behøve at afvise planen for at bede om den.
Medlemmernes opgaver fjernes, ikke markeres som udførte, og planen vender tilbage
til gennemgang.

### 5 · Hvad godkendelsen gør

Den afgørende stemme gør alt på én gang: konkurrerende scenarier i samme
transformation bliver **afvist**, planen bliver **låst**, åbne anmodninger
afsluttes, **initiativerne** oprettes (et program for transformationen, ét projekt
pr. plateau), og et **beslutningsdokument** arkiveres som kladde i
[EA-levering → Beslutninger](../guide/delivery.md) med udvalget, dets regel,
optællingen, hver stemme med sin note, målene, plateauerne, tallene over for at
gøre ingenting og hvert afvist alternativ. Derefter bliver der bedt om
underskrifter fra de medlemmer, der stemte for.

En godkendt plan er skrivebeskyttet, indtil en indehaver af
`ext.roadmap-studio.apply` **genåbner** den, hvilket rydder godkendelsen.

### 6 · Anvend den

**Anvend** skriver planen i dit levende inventar under
`ext.roadmap-studio.apply`. Det er en separat handling, ofte måneder efter
beslutningen. Hver skrivning går gennem det reviderede batch-maskineri, så den
optræder i **Admin → Revisionslog** og kan rulles tilbage. En `.manage`-bruger
kan åbne den samme plan skrivebeskyttet for at se, at den ville lande rent.

### Scenarier uden vurderingsudvalg

Et scenarie uden for en transformation, eller hvis transformation ikke har et
udvalg, beholder den enklere vej: en indehaver af `ext.roadmap-studio.apply`
godkender det direkte. Et lille team uden et governance-organ at indkalde skal
ikke opfinde et.

## Vurderingsudvalg

Udvalg styres ét sted: **Indstillinger → Governance → Administrér
vurderingsudvalg** inde på Roadmap-siden (kræver `ext.roadmap-studio.admin`). Et
udvalg har et navn, en beskrivelse, op til 25 medlemmer og en
**beslutningsregel**. Tilknyt det til en eller flere transformationer fra begge
sider.

At slette et udvalg frakobler de transformationer, det vurderede; det sletter dem
aldrig, og det rører aldrig ved dokumentationen for, hvad det besluttede
tidligere.

## Indstillinger og historik

![Indstillinger og aktivitetshistorik](../assets/img/en/79_ext_roadmap_studio_settings.png)

Roadmap-sidens fane **Indstillinger** (kræver `ext.roadmap-studio.admin`)
indeholder:

| Indstilling | Hvad den gør |
|---|---|
| **Omkostningsmodel** | Hvilket attribut der bærer et korts årlige driftsomkostning, hvilke korttyper nøgletallet tæller, hvor langt frem end-of-life-eksponeringen ser, og en valgfri diskonteringsrente |
| **Godkendelsesregel** | Om anmeldersvar holder en plan tilbage fra dens udvalg: aldrig, mens der ønskes ændringer, eller indtil alle anmeldere har svaret |
| **Vurderingsudvalg** | Åbner udvalgsdialogen |

Kortet **Historik** er en fuld aktivitetslog — hver plan, hvert kort, hver
ændring, hvert plateau, hver anmodning om gennemgang, hvert svar, hver
indsendelse, stemme, kommentar og beslutning, med hvem der gjorde det og hvad der
ændrede sig.

## Præsentationstilstand og oplægget

![Præsentationstilstand](../assets/img/en/78_ext_roadmap_studio_present.png)

**Præsentationstilstand** fører et rum gennem planen plateau for plateau, og
PowerPoint-eksporten følger nøjagtig den rækkefølge, du lige gik igennem.

## Demodata

Ét klik i Indstillinger indlæser et komplet eksempellandskab med to konkurrerende
scenarier, så du kan prøve det hele, før du indtaster dine egne data. Endnu et
klik fjerner ethvert spor.

## Tilladelser

| Tilladelse | Giver |
|---|---|
| `ext.roadmap-studio.view` | Se scenarier, sammenligninger, plateauer, diskussionen og beslutningen |
| `ext.roadmap-studio.manage` | Oprette og redigere planer, anmode om gennemgang, sende til beslutning, trække tilbage |
| `ext.roadmap-studio.apply` | Anvende en godkendt plan på det levende inventar, genåbne den og godkende en plan uden vurderingsudvalg |
| `ext.roadmap-studio.admin` | Indstillinger, vurderingsudvalg og demodata |

At stemme er ikke en tilladelse: det følger af **medlemskabet af det udvalg**,
der beslutter om planen, plus `ext.roadmap-studio.view` for at åbne den. Alle med
`.view` kan skrive i diskussionen.

## Hvis licensen udløber, eller udvidelsen deaktiveres

Roadmap-siden og dens API forsvinder, men **intet slettes** — scenarier, planer,
stemmer og diskussionen bliver i udvidelsens egne tabeller. Kort, udvidelsen har
oprettet i dit inventar, er ganske almindelige kort og påvirkes ikke. En fornyet
licens bringer det hele tilbage.

## Bemærkninger og begrænsninger

- **Én plan ad gangen** går til et udvalg inden for samme transformation.
- **Ingen formand og ingen vægtede stemmer.** Hver stemme tæller én gang, og der
  er ingen udslagsgivende stemme.
- **Ingen påmindelser.** En runde forbliver åben, indtil reglen afgør den, eller
  nogen trækker den tilbage.
- **Planens forfatter må stemme** om sin egen plan. Det er bevidst: et lille
  udvalg, hvor arkitekten ikke måtte stemme, kunne intet beslutte, og hver stemme
  navngives i dokumentet.
- Udvidelsen indeholder backend-kode, så installation eller opdatering kræver en
  enkeltstående genstart af backend. Turbo EA viser et banner, når det gælder.
