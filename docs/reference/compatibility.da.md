# Kompatibilitetspolitik

Fra version `1.0.0` og fremefter forpligter Turbo EA sig til dokumenteret bagudkompatibilitet inden for en major-versionslinje. Denne side er kontrakten: den beskriver, hvad der forbliver stabilt, hvad der kan ændre sig, og hvordan deprecations fungerer, så operatører kan planlægge opgraderinger uden overraskelser.

Politikken gælder for `1.x`. En fremtidig `2.x`-linje kan revidere den; hvis det er tilfældet, leveres en migrationsguide med `2.0.0`-udgivelsesnoterne.

---

## Hvad er dækket

### Databaseskema (Alembic-migreringer)

Inden for `1.x`:

- Migreringer er **additive** eller **bagudkompatible-ved-opgradering**.
- Nye kolonner kan tilføjes når som helst.
- Eksisterende kolonner vil ikke blive droppet uden at gennemgå en deprecation-cyklus.
- Eksisterende kolonner vil ikke blive omdøbt uden en deprecation-cyklus (en omdøbning implementeres som tilføj-ny-kolonne → backfill → deprecate-gammel-kolonne → drop-i-næste-major).
- Typeændringer er begrænset til udvidelse (f.eks. `varchar(80)` → `varchar(255)`); indsnævrende ændringer gennemgår deprecation.
- Foreign-key-constraints vil ikke blive strengere (f.eks. `ON DELETE SET NULL` der bliver `ON DELETE CASCADE`) uden en deprecation-cyklus.

Operatører kan rulle fremad med tillid; auto-migreringen ved backend-opstart er sikker at køre på produktionsdata.

### Indbygget metamodel

Inden for `1.x` er metamodellen, der leveres i `backend/app/services/seed.py`, stabil:

- Indbyggede korttype-nøgler (`Application`, `Initiative`, `BusinessCapability` osv.) vil ikke blive omdøbt eller fjernet.
- Indbyggede feltnøgler på disse typer vil ikke blive fjernet uden en deprecation-cyklus.
- Indbyggede relationstype-nøgler vil ikke blive omdøbt eller fjernet uden en deprecation-cyklus.
- Standardundertyper, der leveres med indbyggede typer, er stabile.

Operatørernes egne tilpasninger (brugerdefinerede korttyper, brugerdefinerede felter tilføjet via admin-UI, brugerdefinerede relationstyper) ejes af operatøren og er ikke dækket af denne politik.

### REST API (`/api/v1/`)

Inden for `1.x`:

- Endpoints under `/api/v1/` vil ikke blive fjernet uden en deprecation-cyklus.
- Eksisterende request- og response-feltnavne vil ikke blive omdøbt uden en deprecation-cyklus.
- Felttyper vil ikke ændre sig inkompatibelt (f.eks. string → array).
- Nye valgfrie request-felter og nye response-felter er ikke-brydende og kan lande i enhver minor.
- Nye endpoints er ikke-brydende og kan lande i enhver minor.
- Godkendelsessemantik (`Bearer` JWT, `/auth/login`-payload-formen) er stabil.
- HTTP-statuskodesemantik er stabil for dokumenterede success- og fejlstier.

Adfærd ud over den dokumenterede overflade (udokumenterede headers, intern fejlmeddelelsestekst, rækkefølge når intet `sort_by` er angivet) er ikke dækket.

### Tilladelsesnøgler

Tilladelsesnøgler defineret i `backend/app/core/permissions.py` er stabile inden for `1.x`. Nye nøgler kan tilføjes; eksisterende nøgler vil ikke blive omdøbt eller fjernet uden en deprecation-cyklus.

Sættet af tilladelser, der gives **som standard** til de seedede roller (`admin`, `bpm_admin`, `member`, `viewer`), kan ændres mellem minor-udgivelser, med en CHANGELOG-bemærkning. Operatører, der har tilpasset rolletilladelser i deres udrulning, påvirkes ikke.

### Konfiguration (miljøvariabler)

Eksisterende miljøvariabler dokumenteret i `CLAUDE.md` og `README.md` er stabile inden for `1.x`. Nye variabler kan tilføjes med fornuftige standardværdier. Standardværdier kan ændres med en CHANGELOG-bemærkning, når ændringen er operatør-relevant (f.eks. en ny standardport).

### Krypterede-i-hvile-hemmeligheder

`enc:`-præfiksmarkøren og Fernet-afledt nøgle i `backend/app/core/encryption.py` er stabile inden for `1.x`. Operatører behøver ikke at re-kryptere hemmeligheder på tværs af minor-opgraderinger.

---

## Deprecation-cyklus

Når noget dækket af denne politik skal fjernes:

1. **Markér som deprecated i minor `N`.** CHANGELOG-posten inkluderer en `Deprecated`-sektion, der fremhæver ændringen. For API-endpoints udsender den deprecated-rute en `Deprecation: true`-response-header (RFC 8594) og en `Sunset`-header, der angiver det tidligst mulige fjernelsesmål.
2. **Fortsæt med at understøtte i minor `N+1`.** Fjernelse kan ikke lande i samme minor som deprecation. Den deprecated-form bliver ved med at virke.
3. **Tidligst fjernelse i minor `N+2` eller i `2.0`** (afhængigt af hvad der kommer først). Fjernelsen lander med en `Removed`-sektion i CHANGELOG og en migrationsnote.

For dataformsændringer (Alembic-migreringer) gælder samme N → N+1-kadence, udtrykt som tilføj-ny → backfill → drop-gammel.

---

## Hvad der ikke er dækket

Disse er eksplicit uden for omfanget og kan ændres når som helst:

- Det **interne Python-modullayout** under `backend/app/`. Imports af `app.models`, `app.services` osv. er ikke en del af den offentlige API. Plugins eller scripts, der afhænger af interne imports, bør fastlåse en specifik Turbo EA-version.
- **Strukturen af JSONB-blobs** gemt i indbyggede tabeller (`fields_schema`, `section_config`, `attributes`, `lifecycle`) ud over hvad der læses af den dokumenterede REST API. JSON-formen på disken kan udvikle sig for at understøtte nye funktioner.
- **Frontend-internaler**: komponentfilstier, prop-signaturer af komponenter i `frontend/src/`, indholdet af `frontend/src/types/index.ts` og styling af MUI-komponenter. Operatører, der bruger den medfølgende frontend, er isoleret; enhver, der indlejrer komponenter fra kildetræet, er på egen hånd.
- **Operatør-introducerede metamodel-tilpasninger.** Hvis du tilføjer en brugerdefineret korttype eller felt via admin-UI'et, ejer du migrationshistorien, når du ændrer den.
- **Demo- og seed-data** (`SEED_DEMO=true`). Demodatasættet må udvikle sig frit mellem udgivelser.
- **Medfølgende tredjepartstjenester**: DrawIO-version, Ollama-medfølgende billede, den indlejrede swagger-ui-dist-version. Disse kan opgraderes når som helst.
- **Adfærd med ikke-standard konfigurationer**, der eksplicit er flaget som eksperimentelle i CHANGELOG-poster.

---

## Hvad "1.0.0" faktisk ændrer

Sammenlignet med `0.x`-serien er `1.0.0` i sig selv ikke en feature-release — det er det punkt, hvorpå forpligtelserne ovenfor begynder at gælde. Kode, der leveres i `1.0.0`, er den samme kode, der blev leveret i `0.71.0`, plus supply-chain-hærdningen og bidragyder-flow-ændringerne dokumenteret i [`1.0.0` CHANGELOG-posten](https://github.com/vincentmakes/turbo-ea/blob/main/CHANGELOG.md#100---2026-05-05).

Pre-`1.0`-udgivelser var ikke dækket af denne politik. Migreringer mellem `0.x`-versioner kunne og gjorde inkludere skema-drops, omdøbninger og brydende metamodel-ændringer. Fra `1.0.0` og fremefter går disse gennem deprecation-cyklussen.
