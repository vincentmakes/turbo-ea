# Drift og opgraderinger

Denne side er operatørens guide til at køre Turbo EA i produktion: hvordan opgraderinger og databasemigrationer fungerer, hvordan man tager backup og ruller tilbage, hvilke miljøer man bør køre, og de faldgruber der rammer teams i stor skala.

## Produktionsimages og versionslåsning

De publicerede images på `ghcr.io/vincentmakes/turbo-ea/*` er den anbefalede måde at køre produktion på — den medfølgende `docker-compose.yml` henter dem som standard, og bygning fra kildekode er en udviklingsarbejdsgang. Ud over bekvemmeligheden har de publicerede images forsyningskædegarantier, som et lokalt build ikke har: hver publicering er multi-arch (amd64 + arm64), signeret med cosign (nøglefri OIDC, verificerbar mod GitHub Actions-workflowets identitet) og attesteret med SLSA-proveniens og en SBOM. Images blokeres ved publicering ved kritiske CVE'er, genscannes dagligt når de er live, og genbygges ugentligt mod friske Alpine-repositorier, så patches til basisimages flyder ind automatisk. Hvis jeres organisation håndhæver verifikation af image-signaturer ved optagelse, passer cosign-signaturerne direkte ind — se [Forsyningskæde](supply-chain.md) for verifikationskommandoer.

Den vigtigste vane: **lås din version fast**. Tagget `:latest` flyttes ved udgivelser og ved den ugentlige genbygning — ikke ved hvert commit — så det kan ændre sig efter en tidsplan, du ikke kontrollerer. Sæt et eksplicit tag i din `.env`:

```bash
TURBO_EA_TAG=2.23.1
```

Se [Fastlåsning af en version](../getting-started/setup.md) for det grundlæggende og [Udgivelser](../reference/releases.md) for det fulde tag-træ og politikken for prærelease-kanaler.

## Administreret PostgreSQL

I virksomhedsmiljøer med adgang til en administreret PostgreSQL-tjeneste — Azure Database for PostgreSQL, Amazon RDS / Aurora, Google Cloud SQL eller lignende — er det den anbefalede opsætning at køre Turbo EA mod den. Den medfølgende `db`-container er en afhængighedsfri standard, ikke et krav: peg backenden på jeres instans med `POSTGRES_*`-variablerne, og spring den medfølgende tjeneste over (se [Brug en eksisterende PostgreSQL](../getting-started/setup.md)).

Hvad den administrerede tjeneste tager fra jer:

- **Backup og punkt-i-tid-gendannelse (PITR)** — automatiseret, med styret opbevaring og gendannelse til ethvert tidspunkt; præcis hvad rollback-strategien nedenfor har brug for.
- **Høj tilgængelighed og failover** — zonal eller regional redundans uden selv at drive replikering.
- **Motor-patching, kryptering i hvile, netværksisolation** — håndteret efter jeres organisations compliance-baseline (private endpoints, IAM-integration).

Tre ting, der **ikke** ændrer sig: backenden kører stadig selv sine Alembic-migrationer ved opstart (opgraderingsmodellen på denne side er identisk), volumen `backend_data` har stadig brug for sin egen backup (filvedhæftninger og udvidelser ligger ikke i PostgreSQL), og ansvaret for `SECRET_KEY` er stadig jeres. Det medfølgende image leverer PostgreSQL 18 — enhver nyere major-version fra jeres udbyder fungerer.

### Kontrollér forbindelsesgrænsen

Den ene indstilling, det er værd at bekræfte inden skiftet, er forbindelsesgrænsen. Backenden kører som én enkelt proces og åbner **op til `DB_POOL_SIZE + DB_MAX_OVERFLOW` forbindelser — 30 som standard**. Den medfølgende `db`-container tillader 100, så dette viser sig aldrig i standardopsætningen; hostede abonnementer i indgangsklassen begrænser ofte databasen lavere, og PostgreSQL svarer så `too many connections for database "turboea"`.

```sql
SELECT datname, datconnlimit FROM pg_database WHERE datname = 'turboea';
SELECT rolname, rolconnlimit FROM pg_roles    WHERE rolname = 'turboea';
SHOW max_connections;
```

`-1` betyder «ingen specifik grænse». Er den reelle grænse under 30, skal I enten hæve den eller skrue poolen ned i `.env` — og efterlade et par forbindelser til backup og administrative sessioner:

```dotenv
DB_POOL_SIZE=8
DB_MAX_OVERFLOW=2
DB_POOL_TIMEOUT=30
```

Sådan ser I, hvad der reelt er forbundet lige nu:

```sql
SELECT state, count(*) FROM pg_stat_activity WHERE datname = 'turboea' GROUP BY state;
```

## Sådan fungerer opgraderinger: Alembic-migrationer

Databaseskemaets kompatibilitet håndteres automatisk via [Alembic](https://alembic.sqlalchemy.org/). Ved opstart kører backenden `alembic upgrade head`, så alle ventende migrationer mellem dit nuværende skema og den nye version anvendes — i rækkefølge — før appen betjener trafik.

Migrationerne er fortløbende nummererede og kumulative, hvilket gør versionsspring sikre: opgraderer du for eksempel fra 2.10 til 2.23, kører alle mellemliggende migrationer i rækkefølge. Du behøver ikke gå gennem hver minor-udgivelse.

Et par adfærdsmønstre, der er værd at kende:

| Situation | Hvad der sker ved opstart |
|---|---|
| Frisk database | Tabellerne oprettes direkte, og databasen stemples til head — ingen genafspilning af migrationer. |
| Eksisterende database | Ventende migrationer kører automatisk, før API'et bliver tilgængeligt. |
| `RESET_DB=true` | Alle tabeller droppes, genoprettes og genudfyldes. Sæt det aldrig i produktion. |

Inden for en major-versionslinje forbliver migrationerne additive og bagudkompatible ved opgradering — se [Kompatibilitetspolitikken](../reference/compatibility.md) for den fulde kontrakt.

!!! warning "Kør aldrig en ældre backend mod et nyere skema"
    Alembic migrerer kun fremad ved opstart. Gammel kode mod et nyere skema er udefineret adfærd — det er den centrale rollback-begrænsning (se nedenfor).

## Opgraderingsproceduren

1. **Læs changeloggen.** Gennemgå `CHANGELOG.md`-posterne mellem din nuværende version og målversionen. Brydende ændringer hæver major-versionen.
2. **Tag backup** af databasen og datavolumen (se nedenfor).
3. **Hæv tagget og hent:**

    ```bash
    TURBO_EA_TAG=2.24.0 docker compose pull
    docker compose up -d
    ```

4. **Hold øje med opstartsloggene** og bekræft, at migrationerne gennemføres rent, før API'et begynder at betjene trafik:

    ```bash
    docker compose logs -f backend
    ```

!!! note "Servicevinduer"
    Migrationer er normalt hurtige, men på store inventarer kan visse datamigrationer tage nogle minutter, hvor backenden ikke svarer. Planlæg opgraderinger i et servicevindue.

### At vide, hvornår en opgradering er klar

I stedet for at holde øje med repositoriet kan instansen sige det selv: Turbo EA tjekker dagligt for en nyere udgivelse og giver administratorer besked i notifikationsklokken med versionsnummer og udgivelsesnoterne. Den henter og installerer aldrig noget — trin 1 ovenfor begynder fortsat med at læse changeloggen. Tjekket er slået til som standard og kan slås fra under [Administration → Indstillinger → Generelt](settings.md#update-notifications), hvilket også fjerner den udgående forespørgsel på air-gapped installationer. Når opgraderingen er gennemført, får alle brugere besked i notifikationsklokken om, at appen er opdateret, og kan læse changeloggen for de versioner, den krydsede. Hver notifikation bliver ved med at vise den udgivelse, den annoncerede — noterne kommer fra den changelog, der følger med imaget — så en gammel besked aldrig besvares med den nyeste udgivelses noter.

## Backup

Tag en backup **før hver opgradering**, og automatiser under alle omstændigheder en natlig:

```bash
docker compose exec db pg_dump -U turboea turboea > backup-$(date +%F).sql
```

Justér bruger- og databasenavnet, hvis du har ændret `POSTGRES_USER` / `POSTGRES_DB`. Et snapshot af volumen `postgres_data` er et ligeværdigt alternativ. På en [administreret PostgreSQL-tjeneste](#administreret-postgresql) bør I foretrække udbyderens automatiske backup og punkt-i-tid-gendannelse frem for håndlavede dumps — et lejlighedsvist `pg_dump` er stadig værd at have som en portabel kopi uafhængig af udbyderen.

Tag også backup af volumen **`backend_data`** — den rummer filvedhæftninger, installerede udvidelser og workspace-transfer-bundter, som ikke ligger i PostgreSQL.

To punkter mere om beredskabet:

- **Test dine gendannelser jævnligt.** En backup, der aldrig er blevet gendannet, er et håb, ikke en plan.
- **Arkiverede kort er soft-deleted** med et 30-dages vindue før endelig sletning — det er dit sikkerhedsnet mod datafejl, adskilt fra infrastrukturgendannelse.

## Rollback og gendannelse

Skemamigrationer er reelt **kun fremadrettede i produktion**: Alembic understøtter teknisk set nedgraderinger, men databærende migrationer kan ikke altid vendes tabsfrit, og appen kører aldrig nedgraderinger automatisk. Den pålidelige rollback-strategi er:

1. Stop stakken.
2. Gendan databasebackuppen taget før opgraderingen (på administreret PostgreSQL: punkt-i-tid-gendannelse til lige før opgraderingen).
3. Sæt `TURBO_EA_TAG` tilbage til den forrige version.
4. `docker compose up -d` — den gendannede database matcher den gamle kodes skema, så alt er konsistent.

!!! warning "Rul aldrig kun imaget tilbage"
    At rulle imaget tilbage og beholde den migrerede database er den ene kombination, det automatiske migrationssystem ikke kan beskytte dig imod. Databasebackup og image-tag flytter sig sammen.

## Gendan administratoradgang { #recovering-administrator-access }

Turbo EA afviser de to ændringer, der oftest låser en administrator ude: du kan ikke ændre din egen rolle væk fra Administrator, og du kan ikke deaktivere din egen konto (se [Brugere og roller](users.md)). Tilbage står det almindelige tilfælde — en glemt adgangskode, eller en instans, hvis eneste administrator har forladt virksomheden. Gå listen igennem oppefra; kun det sidste trin rører databasen.

1. **Spørg en anden administrator.** **Admin → Brugere → redigeringsikon → Adgangskode** sætter en ny adgangskode på enhver lokal konto. Det er den normale vej, og den kræver ingen serveradgang.
2. **Brug selvbetjent nulstilling.** Linket **Glemt adgangskode** på login-siden sender et nulstillingslink på e-mail. Det virker kun for lokale konti og kun, når [SMTP er konfigureret](settings.md) — en instans uden mailserver har ingen selvbetjent nulstilling. SSO-konti har ingen adgangskode at nulstille; ret dem hos identitetsudbyderen.
3. **Nulstil den i databasen.** Kun når ingen længere kan logge ind som administrator.

### Nulstil en adgangskode direkte i databasen

Generér hashen med programmets egen hash-funktion, så den gemte værdi er præcis den, login-kontrollen forventer. Lav den ikke selv med `htpasswd` eller `openssl`:

```bash
docker compose exec -it backend python -c \
  "from app.core.security import hash_password; print(hash_password(input('New password: ')))"
```

At taste adgangskoden ved prompten holder den ude af din shell-historik. Kopiér den udskrevne `$2b$…`-linje, og derefter:

```bash
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U turboea -d turboea -c \
  "UPDATE users
      SET password_hash = '<indsæt hashen her>',
          auth_provider = 'local',
          is_active = true,
          password_setup_token = NULL
    WHERE lower(email) = lower('admin@example.com');"
```

Hver klausul har sin grund, for login kontrollerer dem alle:

| Klausul | Hvorfor den er der |
|---|---|
| `password_hash` | Den nye adgangsoplysning. Behold den i enkelte anførselstegn — bcrypt-hashes indeholder `$`, som shellen ellers ville udvide. |
| `auth_provider = 'local'` | En adgangskode godkender aldrig en konto, der er markeret som SSO. |
| `is_active = true` | En inaktiv konto afvises *efter* adgangskodekontrollen, hvilket ligner en forkert adgangskode til forveksling. |
| `password_setup_token = NULL` | Ugyldiggør et eventuelt udestående invitationslink, så det ikke senere kan overskrive den adgangskode, du netop har sat. |

Blev kontoen også nedgraderet, kan du gendanne rollen i samme sætning ved at tilføje `role = 'admin'`.

Forvent `UPDATE 1`. `UPDATE 0` betyder, at ingen række matchede — e-mailadresser gemmes, som de blev indtastet, og det er `lower()` på begge sider, der gør sammenligningen ufølsom over for store og små bogstaver. Sådan finder du den rigtige række først:

```bash
docker compose exec -T db psql -U turboea -d turboea -c \
  "SELECT email, role, is_active, auth_provider FROM users ORDER BY email;"
```

To ting mere, der er værd at vide:

- **Tilpas forbindelsen.** Brug dine egne `POSTGRES_USER` / `POSTGRES_DB`, hvis du har ændret dem. På en hostet PostgreSQL-tjeneste findes der ingen `db`-container — forbind i stedet direkte med `psql`.
- **Andre sessioner forbliver logget ind.** Sessioner er JWT'er uden tilbagekaldelse på serversiden, så tokens udstedt før nulstillingen er gyldige, indtil de udløber (`ACCESS_TOKEN_EXPIRE_MINUTES`, 24 timer som standard). At skifte adgangskode logger ingen ud.

!!! note "Den tilladte undtagelse fra «redigér ikke databasen»"
    At redigere databasen direkte er ellers en faldgrube, og med god grund. Denne fremgangsmåde er sikker, fordi den opdaterer nogle få kolonner i én enkelt `users`-række: den ændrer intet skema og kan derfor ikke kollidere med en fremtidig migrering, og det er den ene tilstand, som brugerfladen og API'et per definition ikke kan reparere — du skal have adgang for at gendanne adgang.

## Miljøer og udgivelsesstyring

For de fleste organisationer er **to miljøer** (staging + produktion) nok, fordi opgraderinger er leverandørudgivne images, ikke egne builds — I validerer, I udvikler ikke. En fuld Dev/SIT/UAT/Prod-kæde giver primært værdi, hvis I bygger egne udvidelser eller tunge integrationer.

| Miljø | Formål | Bemærkninger |
|---|---|---|
| Dev / sandkasse (valgfrit) | Afprøv metamodel-ændringer, demoer | `SEED_DEMO=true` for demodatasættet; `RESET_DB=true` giver en ren start. |
| Staging | Validér nye versioner først | Produktionslignende data; modtager nye tags først. |
| Produktion | Fastlåst tag, backup, opgraderinger i servicevindue | Aldrig `latest`, aldrig `RESET_DB`. |

To gode måder at få realistiske data ind i staging:

- **[Workspace-overførsel](workspace-transfer.md)**: eksportér produktionsarbejdsområdet som et `.zip`-bundt og importér det i staging. Hemmeligheder (SMTP-, SSO-, AI-, ServiceNow-legitimationsoplysninger) fjernes by design og forlader aldrig instansen.
- **Databasegendannelse**: gendan et produktions-`pg_dump` i staging-databasen (på en administreret tjeneste fungerer en klon eller punkt-i-tid-gendannelse af produktionsinstansen også fint). Krypterede hemmeligheder i databasen er afledt af `SECRET_KEY`, så staging skal enten bruge samme `SECRET_KEY`, eller også skal integrationslegitimationsoplysningerne indtastes igen dér.

Hvad angår styring:

- Behandl `.env`-filen og det fastlåste `TURBO_EA_TAG` som konfiguration-som-kode — opbevar dem i jeres interne Git, og gør opgraderinger til en gennemgået ændring (en pull request, der hæver tagget).
- Fordi staging og produktion henter det samme fastlåste GHCR-tag, validerer I det byte-identiske artefakt, I vil forfremme.
- Opgradér staging → lad det stå nogle dage → forfrem det samme tag til produktion.

## Almindelige faldgruber

1. **At køre `latest` uden fastlåsning** — et rutinemæssigt `docker compose pull` bliver til en uplanlagt opgradering med uplanlagte migrationer, efter udgivelsestidsplanen frem for jeres egen.
2. **At opgradere uden backup** — migrationer er kun fremadrettede; backuppen *er* jeres rollback.
3. **At miste eller ændre `SECRET_KEY`** — den signerer JWT'er *og* afleder krypteringsnøglen til gemte hemmeligheder (SMTP-, SSO-, ServiceNow-legitimationsoplysninger). Ændres den, kan gemte hemmeligheder ikke længere dekrypteres. Behandl den som en databaselegitimation: i en boks, stabil, med backup.
4. **`RESET_DB=true` glemt i en env-fil** — den gør præcis, hvad den siger, ved hver opstart.
5. **At redigere databasen direkte** — skematilstanden ejes af Alembic, og manuel DDL vil kollidere med fremtidige migrationer. Det samme gælder data: brug API'et eller brugergrænsefladen, så rettigheder, revisionshændelser og genberegning af datakvalitet forbliver korrekte. Den eneste tilladte undtagelse er [gendannelse af administratoradgang](#recovering-administrator-access) i det tilfælde, hvor ingen længere kan logge ind for overhovedet at bruge API'et eller brugerfladen.
6. **Ikke at persistere volumener** — `postgres_data` og `backend_data` skal overleve genoprettelse af containere; tjek, at jeres snapshot- og backupværktøjer dækker begge.
7. **At rulle imaget tilbage uden at gendanne databasen** — se [Rollback og gendannelse](#rollback-og-gendannelse).
8. **At pege på en hosted PostgreSQL uden at kontrollere dens forbindelsesgrænse** — backenden har som standard brug for op til 30 forbindelser. En lavere grænse viser sig som `too many connections for database "turboea"` under normal brug; se afsnittet «Kontrollér forbindelsesgrænsen» ovenfor.
