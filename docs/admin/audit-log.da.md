# Revisionslog

**Revisionsloggen** under **Admin → Indstillinger → Revisionslog** (`/admin/settings?tab=audit-log`) besvarer de to spørgsmål, en sikkerhedsgennemgang stiller til en instans, der rummer et kort over hele IT-landskabet: *hvad er der ændret i det*, og *hvem har logget på, og hvordan*. Den er delt i to underfaner:

| Underfane | URL | Hvad den registrerer |
|-----------|-----|----------------------|
| **Ændringer** | `/admin/settings?tab=audit-log` | Hver skrivning til landskabet — kort, relationer, risici, tags, interessentroller, beslutningsudkast — samlet i mutationsbatches, med en diff pr. hændelse og en **Rul tilbage** |
| **Sikkerhed og administration** | `/admin/settings?tab=audit-log&view=security` | Logins og logouts, mislykkede forsøg, spærringer, SSO- og proxysessioner, adgangskodehændelser og rolleovertagelse |

De to er bevidst holdt adskilt. **Ændringer** er et arbejdsværktøj — det findes, så du kan se og fortryde en forkert skrivning — og gemmer kun en kort historik. **Sikkerhed og administration** er et bevisspor: dens poster kan hverken redigeres eller slettes, og den gemmes som standard i et år.

## Hvem kan se den

Begge underfaner kræver tilladelsen **`admin.events`** («Se revisionsspor og hændelsesstrøm»), som kun rollen **Admin** har som standard. Vil du give en sikkerheds- eller compliance-ansvarlig læseadgang uden at gøre vedkommende til administrator, så opret en rolle med `admin.events` under [Brugere og roller](users.md#roller) og tildel den.

## Ændringer

Underfanen **Ændringer** er registret over mutationsbatches. Hver ændrende skrivning lander her som et batch sammen med, hvem der foretog den, og hvor den kom fra:

| Oprindelse | Betydning |
|------------|-----------|
| **Web** | Turbo EA's webgrænseflade |
| **API** | Et direkte kald til REST-API'et (et script, en integration) |
| **AI-værktøj** | En AI-assistent forbundet via [MCP-serveren](mcp.md) |
| **Udvidelse** | En installeret [udvidelse](extensions.md), registreret som et `ext:<key>`-batch |

Klik på et batch for at åbne dets panel: diffen pr. hændelse viser hvert felts gamle og nye værdi, og **Rul tilbage** omgør de skrivninger på kort, relationer, risici, interessentroller, tags og beslutningsudkast, som batchet foretog.

Batches gemmes i **`MUTATION_BATCH_RETENTION_DAYS`** dage (en miljøvariabel, standard **15**) og slettes derefter automatisk. Selve hændelserne bliver på hvert korts fane **Historik**, også når batchet er væk.

## Sikkerhed og administration

![Sikkerheds- og administrationslog](../assets/img/da/62_admin_audit_log_security.png)

Underfanen **Sikkerhed og administration** viser én post pr. sikkerhedsrelevant handling, nyeste først:

- logins og logouts med adgangskode, SSO eller gennem en betroet reverse proxy;
- mislykkede loginforsøg, hver med en **årsagskode**, der fortæller, hvorfor forsøget mislykkedes;
- spærring af konti efter gentagne fejl;
- registreringer samt adgangskoder, der angives, nulstilles eller ændres;
- rolleovertagelse — en administrator, der starter og stopper **Vis som rolle…**;
- eksport af selve denne log.

!!! note "Kommer i næste version"
    **Administrative handlinger** — ændringer af brugere, roller, indstillinger, metamodellen, udvidelser, importer og integrationer — og **dataeksport** (CSV-/JSON-eksport af inventaret, eksport af arbejdsområde og migrering) registreres i den samme log fra næste version.

### Kolonner

| Kolonne | Beskrivelse |
|---------|-------------|
| **Hvornår** | Dato og klokkeslæt for handlingen |
| **Kategori** | `auth` (godkendelse), `admin` (administrative handlinger) eller `access` (eksport og anden dataadgang) |
| **Handling** | Hvad der skete, for eksempel `auth.login.failed` — se [handlingskataloget](#action-catalogue) |
| **Resultat** | **Lykkedes** eller **Mislykkedes** |
| **Aktør** | Den indloggede bruger, der udførte handlingen. Tom, når ingen var logget på — for eksempel ved et mislykket login |
| **Subjekt** | Den konto, handlingen drejede sig om — den e-mailadresse, der blev indtastet ved et mislykket login, eller den bruger, hvis adgangskode blev nulstillet |
| **Mål** | Det objekt, der blev handlet på, hvis der er et — for eksempel den rolle, der blev valgt ved start af en rolleovertagelse |
| **IP** | Klientens IP-adresse (se [Klientens IP-adresse](#client-ip-address)) |
| **Oprindelse** | Hvor anmodningen kom fra: web, API, AI-værktøj, udvidelse, ops eller system |
| **Overtaget rolle** | Når en administrator så appen som en anden rolle, den rolle. Aktøren er stadig den egentlige administrator |

Kolonner kan vises, skjules, omarrangeres og fastfryses som i enhver anden datatabel; **Hvornår** og **Handling** vises altid.

### Filtre

Filterpanelet til venstre indsnævrer listen efter **kategori**, **resultat**, **handling**, **aktør**, **IP-adresse** og et **datointerval**. Hver sektionsoverskrift viser, hvor mange værdier der er valgt, og det sammenklappede panel viser antallet af aktive filtre. Fanen **Kolonner** i samme panel viser, skjuler og fastfryser kolonner. Dine filtre og dit kolonnelayout huskes i denne browser.

En søgning på en e-mailadresse rammer aktør, subjekt og mål, så én adresse finder både, hvad den person har gjort, og hvad der er forsøgt mod vedkommendes konto.

### Postdetaljer

Klik på en række for at åbne postens panel. Det viser alle postens felter, herunder browserens user agent og de **detaljer**, der blev registreret med den — årsagskoden for et mislykket login, tidspunktet hvor en spærring ophører, identitetsudbyderen ved et SSO-login. Når en post registrerer en ændring, vises detaljerne som en tabel med gamle og nye værdier. Hemmeligheder gemmes aldrig: en adgangskode, et token eller en klienthemmelighed erstattes af `***`, før posten skrives.

Panelet har ingen handlinger. Poster kan hverken redigeres eller slettes.

### Eksportér CSV

**Eksportér CSV** på værktøjslinjen downloader de poster, der matcher de aktuelle filtre, som en CSV-fil, op til 50.000 rækker. Selve eksporten registreres også, som `access.audit_log.exported`, så en eksport af sikkerhedsloggen altid efterlader et spor i den.

## Handlingskatalog { #action-catalogue }

| Handling | Registreres, når |
|----------|------------------|
| `auth.login.succeeded` | en bruger logger på med e-mail og adgangskode |
| `auth.login.failed` | et login med adgangskode afvises. **Årsagskoden** fortæller hvorfor (se nedenfor) |
| `auth.login.locked` | det femte mislykkede forsøg i træk spærrer kontoen i 15 minutter. Detaljerne angiver, hvornår spærringen ophører |
| `auth.logout` | en indlogget bruger logger af. En logout uden en gyldig session registrerer intet |
| `auth.sso.succeeded` | en bruger logger på via en SSO-udbyder. Detaljerne angiver udbyderen, identitetsudbyderens subjekt, og om kontoen blev oprettet ved dette login |
| `auth.sso.failed` | et SSO-login afvises — et domæne, der ikke er tilladt, en manglende e-mailadresse, en lokal konto med samme e-mail, en inaktiv konto. Detaljerne angiver udbyderen og årsagen |
| `auth.proxy_session.succeeded` | en bruger logger på via en betroet [reverse proxy](sso.md#godkendelse-via-reverse-proxy) |
| `auth.proxy_session.failed` | et login via reverse proxyen afvises |
| `auth.register` | en bruger opretter en konto via selvregistrering |
| `auth.password.set` | en inviteret bruger angiver sin første adgangskode |
| `auth.password.reset_requested` | nogen beder om en e-mail til nulstilling af adgangskoden. Registreres altid som lykkedes og kun med den indtastede e-mailadresse, så loggen aldrig afslører, om kontoen findes |
| `auth.password.reset` | en adgangskode ændres via et nulstillingslink |
| `auth.password.changed` | en indlogget bruger ændrer sin egen adgangskode |
| `auth.impersonation.started` | en administrator starter **Vis som rolle…**. Målet er den valgte rolle |
| `auth.impersonation.stopped` | administratoren vender tilbage til sin egen rolle |
| `access.audit_log.exported` | nogen eksporterer sikkerhedsloggen til CSV |

**Årsagskoder** for `auth.login.failed`:

| Årsag | Betydning |
|-------|-----------|
| `unknown_user` | Ingen konto har den e-mailadresse |
| `sso_account` | Kontoen logger på via SSO og har ingen adgangskode |
| `no_password` | Kontoen har endnu ingen adgangskode — en invitation, der aldrig blev accepteret |
| `locked` | Kontoen er spærret efter gentagne fejl |
| `bad_password` | Adgangskoden er forkert |
| `inactive` | Kontoen er deaktiveret |

**Årsagskoder** for `auth.sso.failed`, `auth.proxy_session.failed`, `auth.password.set` og `auth.password.reset`:

| Årsag | Betydning |
|-------|-----------|
| `expired` | Kontoens tidsbegrænsede adgang er udløbet |
| `hd_mismatch` | Google-kontoen tilhører et domæne, der ikke er tilladt |
| `no_email` | Identitetsudbyderen returnerede ingen e-mailadresse |
| `no_subject` | Identitetsudbyderen returnerede intet subjekt-id |
| `local_account` | En lokal adgangskodekonto bruger allerede den e-mail |
| `no_account` | Der findes ingen konto, og konti oprettes ikke automatisk |
| `exchange_failed` | Identitetsudbyderen fuldførte ikke login |
| `unauthenticated` | Den omvendte proxy godkendte ikke anmodningen |
| `identity_rejected` | Den videresendte identitet blev afvist (domæne eller ubekræftet e-mail) |
| `invalid_token` | Invitations- eller nulstillingslinket var ugyldigt eller er udløbet |

En stribe `unknown_user`-fejl fra én IP-adresse er sådan, password spraying ser ud; en række `bad_password` mod én konto efterfulgt af `auth.login.locked` er et forsøg på at gætte den kontos adgangskode.

## Hvad der ikke registreres

- **Fornyelse af token.** Webappen fornyer sin session med faste mellemrum, så hver åben fane ville tilføje poster, og ingen af dem ville betyde noget.
- **Anmodninger, der afvises på grund af et udløbet eller ugyldigt sessionstoken.** De opstår, hver gang en session slutter naturligt.
- **Læsninger af OData-feeds.** Excel og Power BI henter en gemt visnings OData-feed efter en tidsplan, så hver opdatering ville tilføje en post.
- **Almindelig læseadgang** — at åbne et kort, køre en rapport, søge i inventaret.

## Opbevaring { #retention }

Poster gemmes som standard i **365 dage**. Skift det under **Admin → Indstillinger → Generelt → Datahåndtering → Opbevaring af sikkerhedslog**: et vilkårligt antal dage op til 3650, eller **0** for at gemme posterne for altid. Et job sletter hver nat de poster, der er ældre end perioden, og genindlæser indstillingen ved hver kørsel, så en ændring træder i kraft uden genstart.

Dette opbevaringsjob er det eneste, der nogensinde sletter en post. Der findes ingen redigerings- eller slettehandling i brugerfladen eller API'et, for nogen rolle.

Loggen er bevidst **ikke** en del af [Overførsel af arbejdsområde](workspace-transfer.md): den er denne instans' sikkerhedshistorik, ikke indhold i arbejdsområdet, og den kopieres ikke, når en instans klones.

## JSON-revisionsstrømmen

Backend skriver desuden hver post som **én JSON-linje** på loggeren **`turbo_ea.audit`**, i samme øjeblik som den gemmes. Backend logger til standard output, så strømmen når frem til det, der allerede indsamler dine containerlogs — `docker compose logs backend`, logindsamlingen i Kubernetes eller en vilkårlig SIEM-afsender — uden konfiguration i Turbo EA:

```bash
docker compose logs -f backend | grep turbo_ea.audit
```

Hver linje har de samme felter som posten:

| Felt | Indhold |
|------|---------|
| `audit_id`, `created_at` | Postens id og tidspunktet, hvor den blev skrevet |
| `category`, `action`, `outcome` | Hvad der skete, og om det lykkedes |
| `actor_user_id`, `actor_email` | Hvem der gjorde det |
| `subject_email` | Den berørte konto |
| `target_type`, `target_id`, `target_label` | Hvad handlingen gjaldt |
| `ip`, `user_agent` | Klienten |
| `origin` | web, api, mcp, ext, ops eller system |
| `impersonator_user_id`, `impersonated_role` | Udfyldt, mens en administrator ser appen som en anden rolle |
| `details` | Årsagskoder og gamle/nye værdier, med hemmeligheder allerede maskeret |

Sender du strømmen til et centralt loglager, ligger der en kopi uden for instansen, uden for rækkevidde af alle, der kan administrere den — og det er netop, hvad en gennemgang af insidertrusler har brug for. Se [Logning og revisionsstrømmen](operations.md#logging-and-the-audit-stream) for, hvordan du indsamler den.

## Klientens IP-adresse { #client-ip-address }

Kolonnen **IP** registrerer klientens adresse, ikke adressen på proxyen foran backend. Den medfølgende edge-nginx sætter headeren `X-Real-IP` til den adresse, forbindelsen kom fra, og backend læser den header, fordi det udgivne backend-image sætter **`TRUST_PROXY_HEADERS=true`**. En værdi, der ikke er en gyldig IP-adresse, kasseres i stedet for at blive registreret.

- **Lad `TRUST_PROXY_HEADERS` være slået til**, så længe hver anmodning når backend gennem den medfølgende nginx — standardstakken, [Helm-chartet](kubernetes.md) og [skabelonerne til administrerede containere](managed-containers.md) fungerer alle sådan.
- **Slå den fra** (`TRUST_PROXY_HEADERS=false`), hvis du eksponerer backend-containeren direkte uden den medfølgende nginx foran: en klient kunne så sende sin egen `X-Real-IP` og selv vælge den adresse, der registreres.
- **Bag en anden load balancer** ser den medfølgende nginx den load balancers adresse, så hver post registrerer den. En indstilling, der lader nginx stole på den klientadresse, din load balancer videresender (`NGINX_TRUSTED_PROXIES`), er planlagt til en senere version.
