# Drift og opgraderinger

Denne side er operatørens guide til at køre Turbo EA i produktion: hvordan opgraderinger og databasemigrationer fungerer, hvordan man tager backup og ruller tilbage, hvilke miljøer man bør køre, og de faldgruber der rammer teams i stor skala.

## Produktionsimages og versionslåsning

De publicerede images på `ghcr.io/vincentmakes/turbo-ea/*` er den anbefalede måde at køre produktion på — den medfølgende `docker-compose.yml` henter dem som standard, og bygning fra kildekode er en udviklingsarbejdsgang. Ud over bekvemmeligheden har de publicerede images forsyningskædegarantier, som et lokalt build ikke har: hver publicering er multi-arch (amd64 + arm64), signeret med cosign (nøglefri OIDC, verificerbar mod GitHub Actions-workflowets identitet) og attesteret med SLSA-proveniens og en SBOM. Images blokeres ved publicering ved kritiske CVE'er, genscannes dagligt når de er live, og genbygges ugentligt mod friske Alpine-repositorier, så patches til basisimages flyder ind automatisk. Hvis jeres organisation håndhæver verifikation af image-signaturer ved optagelse, passer cosign-signaturerne direkte ind — se [Forsyningskæde](supply-chain.md) for verifikationskommandoer.

Den vigtigste vane: **lås din version fast**. Tagget `:latest` flyttes ved udgivelser og ved den ugentlige genbygning — ikke ved hvert commit — så det kan ændre sig efter en tidsplan, du ikke kontrollerer. Sæt et eksplicit tag i din `.env`:

```bash
TURBO_EA_TAG=2.23.1
```

Se [Fastlåsning af en version](../getting-started/setup.md) for det grundlæggende og [Udgivelser](../reference/releases.md) for det fulde tag-træ og politikken for prærelease-kanaler.

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

## Backup

Tag en backup **før hver opgradering**, og automatiser under alle omstændigheder en natlig:

```bash
docker compose exec db pg_dump -U turboea turboea > backup-$(date +%F).sql
```

Justér bruger- og databasenavnet, hvis du har ændret `POSTGRES_USER` / `POSTGRES_DB`. Et snapshot af volumen `postgres_data` er et ligeværdigt alternativ.

Tag også backup af volumen **`backend_data`** — den rummer filvedhæftninger, installerede udvidelser og workspace-transfer-bundter, som ikke ligger i PostgreSQL.

To punkter mere om beredskabet:

- **Test dine gendannelser jævnligt.** En backup, der aldrig er blevet gendannet, er et håb, ikke en plan.
- **Arkiverede kort er soft-deleted** med et 30-dages vindue før endelig sletning — det er dit sikkerhedsnet mod datafejl, adskilt fra infrastrukturgendannelse.

## Rollback og gendannelse

Skemamigrationer er reelt **kun fremadrettede i produktion**: Alembic understøtter teknisk set nedgraderinger, men databærende migrationer kan ikke altid vendes tabsfrit, og appen kører aldrig nedgraderinger automatisk. Den pålidelige rollback-strategi er:

1. Stop stakken.
2. Gendan databasebackuppen taget før opgraderingen.
3. Sæt `TURBO_EA_TAG` tilbage til den forrige version.
4. `docker compose up -d` — den gendannede database matcher den gamle kodes skema, så alt er konsistent.

!!! warning "Rul aldrig kun imaget tilbage"
    At rulle imaget tilbage og beholde den migrerede database er den ene kombination, det automatiske migrationssystem ikke kan beskytte dig imod. Databasebackup og image-tag flytter sig sammen.

## Miljøer og udgivelsesstyring

For de fleste organisationer er **to miljøer** (staging + produktion) nok, fordi opgraderinger er leverandørudgivne images, ikke egne builds — I validerer, I udvikler ikke. En fuld Dev/SIT/UAT/Prod-kæde giver primært værdi, hvis I bygger egne udvidelser eller tunge integrationer.

| Miljø | Formål | Bemærkninger |
|---|---|---|
| Dev / sandkasse (valgfrit) | Afprøv metamodel-ændringer, demoer | `SEED_DEMO=true` for demodatasættet; `RESET_DB=true` giver en ren start. |
| Staging | Validér nye versioner først | Produktionslignende data; modtager nye tags først. |
| Produktion | Fastlåst tag, backup, opgraderinger i servicevindue | Aldrig `latest`, aldrig `RESET_DB`. |

To gode måder at få realistiske data ind i staging:

- **[Workspace-overførsel](workspace-transfer.md)**: eksportér produktionsarbejdsområdet som et `.zip`-bundt og importér det i staging. Hemmeligheder (SMTP-, SSO-, AI-, ServiceNow-legitimationsoplysninger) fjernes by design og forlader aldrig instansen.
- **Databasegendannelse**: gendan et produktions-`pg_dump` i staging-databasen. Krypterede hemmeligheder i databasen er afledt af `SECRET_KEY`, så staging skal enten bruge samme `SECRET_KEY`, eller også skal integrationslegitimationsoplysningerne indtastes igen dér.

Hvad angår styring:

- Behandl `.env`-filen og det fastlåste `TURBO_EA_TAG` som konfiguration-som-kode — opbevar dem i jeres interne Git, og gør opgraderinger til en gennemgået ændring (en pull request, der hæver tagget).
- Fordi staging og produktion henter det samme fastlåste GHCR-tag, validerer I det byte-identiske artefakt, I vil forfremme.
- Opgradér staging → lad det stå nogle dage → forfrem det samme tag til produktion.

## Almindelige faldgruber

1. **At køre `latest` uden fastlåsning** — et rutinemæssigt `docker compose pull` bliver til en uplanlagt opgradering med uplanlagte migrationer, efter udgivelsestidsplanen frem for jeres egen.
2. **At opgradere uden backup** — migrationer er kun fremadrettede; backuppen *er* jeres rollback.
3. **At miste eller ændre `SECRET_KEY`** — den signerer JWT'er *og* afleder krypteringsnøglen til gemte hemmeligheder (SMTP-, SSO-, ServiceNow-legitimationsoplysninger). Ændres den, kan gemte hemmeligheder ikke længere dekrypteres. Behandl den som en databaselegitimation: i en boks, stabil, med backup.
4. **`RESET_DB=true` glemt i en env-fil** — den gør præcis, hvad den siger, ved hver opstart.
5. **At redigere databasen direkte** — skematilstanden ejes af Alembic, og manuel DDL vil kollidere med fremtidige migrationer. Det samme gælder data: brug API'et eller brugergrænsefladen, så rettigheder, revisionshændelser og genberegning af datakvalitet forbliver korrekte.
6. **Ikke at persistere volumener** — `postgres_data` og `backend_data` skal overleve genoprettelse af containere; tjek, at jeres snapshot- og backupværktøjer dækker begge.
7. **At rulle imaget tilbage uden at gendanne databasen** — se [Rollback og gendannelse](#rollback-og-gendannelse).
