# Jira Todo Sync

Slut med to opgavelister. **Jira Todo Sync** spejler Turbo EA-todos ind i et
Jira Cloud-projekt efter jeres valg og holder begge sider afstemt: en todo oprettet
i Turbo EA bliver til en Jira-sag på få sekunder, at fuldføre den flytter sagen til
«færdig», og Jira-sager, der matcher et filter efter jeres valg, dukker op som
todos. Titler, frister og ansvarlige synkroniseres begge veje.

## Kort fortalt

| | |
|---|---|
| **Licens** | Kommerciel — kræver en signeret licensrettighed |
| **Mindste Turbo EA-version** | 2.68.0 |
| **Rettighed** | `ext.jira-todos.admin` |
| **Tilladelser til dataadgang** | `core.todos.read`, `core.todos.write`, `core.events.todo`, `core.users.read` |
| **Genstart af backend nødvendig** | ja — indeholder backend-kode |
| **Hvor den vises** | **Admin → Indstillinger → Integrationer → Jira Todo Sync** · sagsnøgle-mærkater på Todo-siden og på kortenes Todo-faneblad |

Kun **Jira Cloud** understøttes. Forbindelsen er udelukkende udgående — Turbo EA
kalder Jiras REST-API med en konto-e-mail og et API-token. Der er intet
OAuth-callback at eksponere, ingen Jira-app at installere og ingen indgående
netværksadgang, så det virker på selv-hostede instanser og bag en firewall.

## Opsætning

### 1. Opret et Atlassian-API-token

1. Gå til <https://id.atlassian.com/manage-profile/security/api-tokens>, og log ind
   med den Atlassian-konto, synkroniseringen skal handle som. Brug en **dedikeret
   servicekonto**, hvis I har en — sager oprettes og flyttes som denne konto.
   (Dette direkte link er den pålidelige vej; token-siden kan ikke længere nås ad
   en indlysende menusti.)
2. Klik på **Create API token** — den almindelige, **ikke** *Create API token with
   scopes*. **Tokens med scopes understøttes ikke.**
3. Giv det et navn (for eksempel `turbo-ea-sync`), og vælg en udløbsdato. Atlassian
   kræver en og sætter loftet ved **ét år**.
4. **Kopiér tokenet med det samme** — det vises kun én gang.

!!! warning "Tokens udløber"
    Når tokenet udløber, standser synkroniseringen med godkendelsesfejl, indtil et
    nyt indsættes. Notér udløbsdatoen allerede ved oprettelsen.

### 2. Forbind Turbo EA

Åbn **Admin → Indstillinger → Integrationer**, og vælg underfanen **Jira Todo
Sync**.

Under **Jira Cloud-forbindelse** udfyldes:

| Felt | Bemærkninger |
|---|---|
| **Site-URL** | For eksempel `https://jeres-site.atlassian.net` |
| **Kontoens e-mail** | Den Atlassian-konto, tokenet tilhører |
| **API-token** | Gemmes krypteret. Lad det senere stå tomt for at beholde det gemte token |

Tryk på **Test forbindelse**. Ved succes meldes *Connected as …*.

### 3. Fastlæg omfanget

Under **Synkroniseringsomfang**:

- **Jira-projekt** — vælg fra listen, der hentes fra Jira, så snart
  forbindelsesoplysningerne er udfyldt. Sendte todos oprettes her som sager af
  typen **Task**.
- **Hentningsfilter (JQL)** — sager, der matcher denne JQL, spejles som todos. Lad
  feltet stå tomt for standardværdien
  `project = "<KEY>" AND statusCategory != Done`.
- **Polling-interval (sekunder)** — hvor ofte Jira forespørges. Standard 300,
  minimum 60.

Under **Retninger** er der tre kontakter:

| Kontakt | Standard | Virkning |
|---|---|---|
| **Send todos til Jira** | slået til | Todos oprettet i Turbo EA bliver til Jira-sager; at fuldføre en todo flytter dens sag |
| **Hent sager fra Jira** | slået til | Matchende Jira-sager dukker op som todos; at løse en sag fuldfører dens todo |
| **Spejl underskrifts-todos (envejs)** | **slået fra** | Underskrifter på risici, beslutninger og projekter bliver til Jira-sager med link tilbage — men de skal stadig fuldføres i Turbo EA |

Tryk på **Gem konfiguration**. **Synkronisér nu** kører en runde med det samme.

Tilknytning af ansvarlige kræver ingen opsætning — Turbo EA kobler automatisk
personer til Jira-konti via e-mailadressen.

## Sådan opfører synkroniseringen sig

| Hændelse | Virkning |
|---|---|
| Todo oprettet i Turbo EA | En Jira-sag oprettes på få sekunder (titel, beskrivelse med link tilbage, frist, ansvarlig) |
| Todo fuldført eller redigeret | Sagen flyttes til «færdig», eller dens felter opdateres |
| Sag matcher JQL'en | Den spejles som todo |
| Sag løst i Jira | Todoen fuldføres ved næste polling (gentagne todos rykker videre til næste cyklus) |
| Sag genåbnet i Jira | Todoen genåbnes |
| **Ændringer på begge sider** | **Den nyeste ændring vinder; ved uafgjort vinder Jira** |
| Todo slettet i Turbo EA | Sagen slettes **aldrig** — en kommentar noterer fjernelsen |
| Sag slettet i Jira | En hentet todo fjernes; en todo oprettet i Turbo EA bevares og markeres i loggen |

**Afsendelse sker næsten øjeblikkeligt, hentning sker periodisk.** Ændringer
foretaget i Turbo EA når Jira på få sekunder. Ændringer foretaget i Jira samles op
ved næste polling — som standard inden for fem minutter. Hver runde afstemmer
desuden begge sider, så et Jira-nedbrud eller en tabt hændelse retter sig selv i
stedet for at koste ændringer.

Fire felter holdes afstemt: **titel**, **frist**, **færdig-status** og
**ansvarlig**. Titlen svarer til **første linje** i todo-teksten, så at omdøbe en
sag i Jira erstatter netop den linje og lader efterfølgende detaljelinjer være
urørte.

### Sagsnøgle-mærkatet

En synkroniseret todo bærer sin Jira-sagsnøgle (for eksempel `PROJ-123`) som et
lille link — både på [Todo-siden](../guide/tasks.md) og på et korts Todo-faneblad.
Et klik åbner sagen i Jira. Mærkatet er til orientering — en todo fuldføres altid i
Turbo EA eller gennem synkroniseringen.

### Underskrifts-todos

Anmodninger om underskrift — en risiko, en beslutning eller et projekt, der venter
på nogens godkendelse — er systemtodos og sendes **aldrig** som almindelige todos.
Er **Spejl underskrifts-todos** slået til, får de en **envejs** Jira-sag, der linker
direkte til den side, hvor underskriften faktisk finder sted.

En underskrift kan aldrig gives fra Jira. Lukker nogen spejlsagen, mens
forpligtelsen stadig er åben, genåbner synkroniseringen den med en kommentar, der
peger tilbage til Turbo EA. Når underskriften er givet i Turbo EA, flyttes spejlet
til «færdig» ved næste polling.

Slås kontakten fra, oprettes der ikke *nye* spejle; de eksisterende vedligeholdes
fortsat.

## Overvågning

Linjen **Status** viser, hvornår der sidst blev synkroniseret, en eventuel fejl og
et resumé af det udførte. **Seneste aktivitet** nedenunder viser de 50 nyeste
handlinger med tidspunkt, retning (**Turbo EA → Jira**, **Jira → Turbo EA** eller
**Sync**), sag og detaljebesked. Advarsler og fejl er farvemarkeret — det er her, en
uafklaret ansvarlig eller en afvist statusovergang viser sig.

## Rettigheder

| Rettighed | Tillader |
|---|---|
| `ext.jira-todos.admin` | At konfigurere og drive synkroniseringen — forbindelse, projekt, filtre, manuel kørsel og aktivitetslog |

Underfanen er helt skjult for alle uden den. **Slutbrugere behøver ingen ekstra
rettighed**: synkroniserede todos dukker blot op på deres sædvanlige todo-liste med
sagsnøgle-mærkatet.

## Hvis licensen udløber, eller udvidelsen deaktiveres

Synkroniseringsjobbet og dets hændelseshåndtering sættes øjeblikkeligt på pause, og
tilladelserne til dataadgang inddrages. **Intet slettes** — todos beholder deres
mærkater, og indstillingerne bevares. En fornyet licens genoptager
synkroniseringen, hvor den slap.

API-tokenet gemmes krypteret på jeres instans og er undtaget fra
arbejdsområdeoverførsel, så det forlader aldrig den instans, hvor det blev indtastet.

## Fejlfinding og begrænsninger

- **Kun Jira Cloud.** Jira Data Center understøttes ikke.
- **Ét projekt pr. instans**, og sager oprettes altid som typen **Task**.
- **Polling, ikke webhooks.** Ændringer på Jira-siden ankommer ved næste polling.
  Jira Cloud-webhooks ville kræve en OAuth-app og en instans, der kan nås fra
  internettet, og der ville stadig være brug for en afstemmende polling — derfor er
  synkroniseringen bevidst periodisk.
- **Tilknytning af ansvarlige og e-mail-privatliv.** Turbo EA matcher personer på
  e-mailadresse og falder derefter tilbage på et præcist match af det viste navn
  blandt projektets tildelbare brugere. En person, hvis e-mail er skjult i Jira
  *og* hvis viste navn er forskelligt i de to systemer, kan ikke tilknyttes; sådanne
  ansvarlige efterlades uændret, og loggen noterer den adresse, der ikke kunne
  matches. En ikke-tilknyttet Turbo EA-ansvarlig fjerner aldrig i stilhed
  tildelingen på Jira-sagen.
- **At rydde en frist i Jira spejles ikke tilbage.** Ryd den i Turbo EA i stedet.
- **Spejle af underskrifts-todos er envejs og kan være op til ét polling-interval
  bagud**, fordi kernens underskriftsforløb ikke udsender ændringshændelser.
- **Synkronisér nu** svarer *A sync is already running*, hvis en runde allerede er
  i gang.
- Efter en udskiftning af jeres instans' `SECRET_KEY` kan det gemte token ikke
  længere dekrypteres, og panelet vender tilbage til *Not configured yet* — indtast
  tokenet igen.
