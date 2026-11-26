# Brugerdefinerede sprog

Turbo EA leveres med ti indbyggede sprog. Når din organisation har brug for et andet — hollandsk, polsk, hebraisk, hindi, thai, en regional variant som brasiliansk portugisisk — kan en administrator tilføje det som et **brugerdefineret sprog** og udfylde dets oversættelser uden at vente på en ny udgivelse.

Et brugerdefineret sprog ligger i din database, ikke i applikationens kode. Du tilføjer det, oversætter det, gennemgår det og tilbyder det til dine brugere, når det er klar. De indbyggede sprog påvirkes ikke.

Et brugerdefineret sprog dækker hele brugergrænsefladen **og** de navne, som dit metamodel giver tingene: korttyper, undertyper, sektioner, felter og deres valgmuligheder, relationer, interessentroller, kategorier, dashboards, regulativer, ressourcetyper og hjælpen til livscyklusfaserne.

Du skal have tilladelsen **admin.settings** til alt på denne side.

## Tilføj et brugerdefineret sprog

Gå til **Admin > Indstillinger > Generelt**. Sektionen **Brugerdefinerede sprog** ligger lige under [Aktiverede sprog](settings.md#aktiverede-sprog).

Klik på **Tilføj sprog** og udfyld:

| Felt | Beskrivelse |
|------|-------------|
| **Sprogkode** | En kort sprogkode: to eller tre små bogstaver, evt. efterfulgt af et skriftsystem (`zh-Hant`) og en region på to store bogstaver (`pt-BR`) — `nl`, `he`, `hi`, `th`, `pt-BR`. Den kan ikke være koden for et indbygget sprog. |
| **Oprindeligt navn** | Det navn, brugerne ser i deres sprogmenu, skrevet på selve sproget — *Nederlands*, *עברית*, *हिन्दी*, *ไทย*. |
| **Engelsk navn** | Sprogets navn på engelsk — *Dutch*, *Hebrew*. Det er det sprog, AI-udbyderen får besked på at oversætte til. Kun bogstaver, mellemrum, parenteser og bindestreger. |
| **Skriftsystem fra højre mod venstre** | Slå det til for et sprog, der skrives fra højre mod venstre, fx hebraisk, persisk eller urdu. Det er slået fra som standard; dialogen gør opmærksom på det, når koden er et sprog, der normalt skrives fra højre mod venstre, men slår det aldrig til for dig. |

Alle skriftsystemer virker: latinsk, kyrillisk, hebraisk, arabisk, devanagari, thai og andre, inklusive de forbindelsestegn og mærker, som disse skriftsystemer har brug for. Når **Skriftsystem fra højre mod venstre** er slået til, vises hele applikationen fra højre mod venstre for brugere, der vælger sproget, som den gør for arabisk.

Et regionalt sprog er et sprog for sig: `pt-BR` låner ikke fra det indbyggede portugisisk, og `zh-Hant` låner ikke fra det indbyggede kinesisk. Indtil en tekststreng er oversat, vises den på engelsk.

Et nyt sprog starter slået fra: brugerne ser det ikke, før du tilbyder det. Hvert sprog på listen viser en statuslinje med, hvor mange tekststrenge der er oversat, og to tællere:

- **Mangler** — tekststrenge, der endnu ikke har en oversættelse.
- **Ændret på engelsk** — tekststrenge, der var oversat, men hvis engelske tekst siden er ændret. Indtil de oversættes igen, ser brugerne den gamle oversættelse, hvilket normalt er bedre end at falde tilbage til engelsk.

Tilbyd et sprog til dine brugere med dets kontakt. Brugerne kan derefter vælge det i sprogmenuen som ethvert indbygget sprog. Tekststrenge, der stadig mangler, vises på engelsk.

## Installér et sprog fra fællesskabsbiblioteket

Andre Turbo EA-brugere deler deres oversættelser i [fællesskabets sprogbibliotek](https://github.com/vincentmakes/turbo-ea-translations). Under dine egne sprog viser blokken **Fællesskabssprog** de sprog, det indeholder, hver med sit oprindelige navn og sin kode, hvor stor en del af brugerfladen det oversætter, og den Turbo EA-version, dets pakke blev lavet med.

!!! warning "Leveret af fællesskabet, ikke gennemgået"
    Pakkerne er skrevet af medlemmer af fællesskabet. **Turbo EA-projektet gennemgår dem ikke.** Automatiske kontroller sikrer, at en pakke ikke kan tilføje markup, links eller ødelagte pladsholdere, som den engelske tekst ikke har, men ingen kontrollerer, om oversættelserne er nøjagtige eller fuldstændige. Gennemgå et sprog, før du tilbyder det til dine brugere.

**Installér** downloader sprogets pakke og importerer den. Det sker der:

- Pakken downloades fra fællesskabsbiblioteket — præcis den fil, biblioteket viser, kontrolleret mod dens kontrolsum.
- Hver tekststreng gennemgår de samme kontroller som en [importeret fil](#the-language-pack-file); en afvist tekststreng står i rapporten og gemmes aldrig.
- Et nyt sprog tilføjes **slået fra**. Se det i **Gennemgå tekststrenge**, og slå det derefter til for dine brugere.
- Rapporten viser, hvad der blev anvendt, hvad der blev afvist og hvorfor, og hvad der ikke findes i din version af Turbo EA.

Sproget vises derefter som **installeret**, og dets række på din egen liste har mærket **Leveret af fællesskabet, ikke gennemgået**. En mislykket installation — en pakke, der ikke kan downloades, ikke stemmer med bibliotekets kontrolsum eller ikke er en gyldig pakke — installerer ingenting og registreres i [Sikkerhed og administration-loggen](audit-log.md). I **Gennemgå tekststrenge** viser hver oversættelse, hvor den kom fra — *Fællesskabsbibliotek*, *Rettet manuelt*, *AI-oversættelse*, *Importeret fil* eller *MCP*.

Når biblioteket har en nyere pakke til et sprog, du har installeret fra det, viser sproget **Opdatering tilgængelig**. **Opdatér** fletter den nye pakke ind i dit sprog. Tekststrenge, du har rettet manuelt, beholdes, medmindre du markerer **Erstat også de tekststrenge, der er rettet manuelt**. Dit sprogs navn, retning og kontakt forbliver uændrede.

Hvis du selv har tilføjet et sprog, og biblioteket har den samme kode, viser dets række **Tilføjet på denne server** og tilbyder **Tilføj fællesskabets tekststrenge**: Pakken flettes ind i dit sprog på samme måde — tekststrenge rettet manuelt beholdes, medmindre du vælger andet — og sproget markeres derefter som leveret af fællesskabet.

Turbo EA kontakter kun biblioteket, når du beder om det: Første gang afsnittet vises, downloades listen og gemmes; derefter vises den gemte liste (med datoen for downloadet), indtil du klikker på **Opdatér**. Intet kontrolleres i baggrunden, så en nyere pakke vises først som **Opdatering tilgængelig** efter en opdatering. Hvis biblioteket ikke kan nås, siger blokken det og bliver ved med at vise listen fra den seneste vellykkede download.

### Slå biblioteket fra

Bibliotekets adresse angives med miljøvariablen `LANGUAGE_CATALOGUE_URL` (Helm-værdi `customLanguages.catalogueUrl`). Sæt den til en tom værdi for at slå funktionen fra, for eksempel på en installation uden internetadgang; blokken siger så, at fællesskabsbiblioteket er slået fra. Du kan også pege den på en kopi af biblioteket på din egen server: Pakkerne downloades fra filerne `packs/<code>/pack.json` ved siden af dets `index.json`.

### Bidrag med et sprog

Har du oversat et sprog, der endnu ikke er i biblioteket, eller forbedret et? Eksportér det med **Eksportér sprogpakke > Del (fællesskabspakke)**, og foreslå det til biblioteket — se dets [bidragsvejledning](https://github.com/vincentmakes/turbo-ea-translations/blob/main/CONTRIBUTING.md).

## Tre måder at oversætte på

Brug den, der passer dig; de kan kombineres, og resultatet er det samme.

### 1. Eksportér en fil og importér den igen

**Eksportér sprogpakke** henter en sprogpakkefil (JSON). Vælg, hvad den skal indeholde:

- **Nye og ændrede tekststrenge (skal oversættes)** — den engelske tekst for hver manglende eller ændret tekststreng. Brug den til den første oversættelse og efter hver opgradering.
- **Alle tekststrenge på engelsk (skal oversættes)** — den engelske tekst for hver tekststreng, så alt oversættes igen.
- **Nuværende oversættelser (inklusive denne installations egne etiketter)** — de oversættelser, du allerede har, inklusive navnene i dit eget metamodel. Brug den som sikkerhedskopi eller til at flytte sproget til en anden af dine egne installationer.
- **Del (fællesskabspakke)** — de oversættelser, du allerede har, men kun det, der er ens i alle Turbo EA-installationer: grænsefladeteksten og navnene i det indbyggede metamodel, som Turbo EA leverer dem. Alt, der er specifikt for din installation, udelades — korttyper, felter og valgmuligheder, du har oprettet, indbyggede navne, du har omdøbt, dine dashboards og kategorier. Det er denne fil, du skal dele med andre Turbo EA-brugere.

Oversæt filen hvor som helst — et oversættelsesbureau, et oversættelsesværktøj eller en AI-chat — og vælg derefter **Importér sprogpakke**. Importen kontrollerer filen, gemmer tekststrengene én sektion ad gangen og viser en rapport: hvor mange tekststrenge der blev anvendt, efterladt uændrede eller ryddet, hvilke der blev afvist og hvorfor, og hvilke nøgler der ikke findes i denne version.

### 2. Oversæt med din AI-udbyder

Hvis en AI-udbyder er konfigureret under [AI-funktioner](ai.md), oversætter **Oversæt med AI** sproget i baggrunden. Vælg:

- **Nye og ændrede tekststrenge** — kun de manglende og ændrede. Det er det sædvanlige valg.
- **Alt** — hver tekststreng igen. Tekststrenge, du har rettet i hånden, bevares, medmindre du også markerer **Erstat også tekststrenge rettet i hånden**.

Dialogen viser, hvor mange tekststrenge der sendes, og derefter forløbet, mens den kører; du kan lukke den og komme tilbage eller **Stop oversættelsen**. Navnene på dine korttyper, felter og relationer oversættes først, og resten af grænsefladen oversættes derefter med de navne som reference, så det samme kaldes det samme overalt. En tekststreng, som AI'en returnerer i en ubrugelig form, gemmes ikke; den forbliver manglende og forsøges igen ved næste kørsel.

Denne mulighed afhænger ikke af, om AI-beskrivelsesforslagene til kort er slået til — kun af, at en udbyder er konfigureret.

### 3. Via en AI-assistent (MCP)

En AI-assistent, der er forbundet via [MCP-integrationen](mcp.md), kan oversætte sproget for dig ved hjælp af disse værktøjer:

- `list_custom_languages` — hvilke brugerdefinerede sprog der findes, og hvor langt hvert enkelt er oversat.
- `get_untranslated_strings` — de engelske tekststrenge, der stadig mangler at blive oversat, side for side (op til 500 ad gangen), med oversættelsesvejledningen. En tekst, der optræder mange steder, som »High« eller »Description«, vises kun én gang.
- `submit_translations` — sender en side med oversættelser tilbage og gemmer dem med det samme, uden forhåndsvisning: hver tekststreng kontrolleres for sig, og kun gyldige gemmes. En oversættelse udfylder også hver anden uoversat tekststreng med den samme engelske tekst; en tekststreng, der allerede har en oversættelse, ændres aldrig, og en forkert udfyldning rettes i gennemgangstabellen.
- `start_ai_translation` og `stop_ai_translation` — starter eller stopper serverens eget job **Oversæt med AI**, så et helt sprog er én forespørgsel. Jobbet kører på den AI-udbyder, der er konfigureret under [AI-funktioner](ai.md), ikke på assistenten; assistenten viser først i en forhåndsvisning, hvor mange tekststrenge der ville blive sendt, og sender ved et stort job forhåndsvisningens bekræftelse tilbage, når det startes.

Bed fx assistenten: *»Oversæt de manglende tekststrenge i vores brugerdefinerede hollandske sprog, og begynd med metamodellens navne.«* Assistenten arbejder med dine egne tilladelser, og hver ændring, den foretager, registreres i auditloggen.

## Sprogpakkefilen

En sprogpakke er en JSON-fil som denne:

```json
{
  "format": "turbo-ea-language-pack",
  "format_version": 1,
  "app_version": "2.214.0",
  "locale": {"code": "nl", "name": "Nederlands", "english_name": "Dutch", "rtl": false},
  "mode": "missing",
  "instructions": "Translate every value under \"strings\" from English into Dutch. …",
  "strings": {
    "metamodel": {
      "type.Application.label": "Application",
      "type.Application.field.businessCriticality": "Business Criticality"
    },
    "common": {
      "actions.save": "Save",
      "actions.cancel": "Cancel"
    }
  },
  "source_hashes": {
    "metamodel": {
      "type.Application.label": "5c1e0a9d7b32",
      "type.Application.field.businessCriticality": "a90d3f17c4e8"
    },
    "common": {
      "actions.save": "1f3a9c0b2d4e",
      "actions.cancel": "7b2e4d6a8c01"
    }
  }
}
```

- **strings** indeholder den tekst, der skal oversættes, grupperet efter sektion (`metamodel`, `common`, `admin`, `cards`, …). Oversæt kun **værdierne**; ændr aldrig nøglerne.
- Sektionen **metamodel** indeholder navnene på korttyper, felter, valgmuligheder, relationer og de øvrige etiketter, der er gemt i din database. Det er korte etiketter, som resten af grænsefladen henviser til: oversæt dem først, og brug de samme ord for dem overalt andre steder.
- Behold alt i dobbelte tuborgklammer, fx `{{count}}` eller `{{name}}`, præcis som det er: applikationen indsætter en værdi dér. Behold også tags som `<1>` og `</1>` og henvisninger som `$t(common:actions.save)`.
- **source_hashes** registrerer, hvilken engelsk tekst hver tekststreng er lavet ud fra. Lad den blive i filen: ved import fortæller den Turbo EA, om det engelske er ændret, siden filen blev eksporteret. For sektionen **metamodel** er den påkrævet — en post uden sin hash afvises — fordi det er det, der holder en oversættelse væk fra et navn, der er omdøbt i mellemtiden.
- **instructions** gentager disse regler i almindelige ord, så du kan give filen videre til en oversætter eller en AI-chat, som den er.

Ved import kontrolleres hver tekststreng for sig. En nøgle, som denne version af Turbo EA ikke har — fra en pakke lavet til en anden version — tælles som ikke i denne version og nævnes i rapporten. En tekststreng afvises, når den er tom eller meget længere end den engelske, når den mister eller tilføjer en pladsholder eller en `$t(...)`-henvisning, eller når den indfører et tag eller et link, som den engelske tekst ikke har. I sektionen **metamodel** afvises en oversættelse desuden, hvis den ikke har nogen hash, og springes over, hvis det navn, den er lavet ud fra, er ændret, siden filen blev eksporteret — en oversættelse af »Application« lander aldrig på en korttype, som nogen har omdøbt. En oversættelse, der er identisk med den allerede gemte, rapporteres som uændret. En afvist tekststreng forhindrer aldrig, at de andre gemmes.

En fil, der er eksporteret til en anden sprogkode, kan stadig importeres; du bliver først bedt om at bekræfte.

## Gennemgå og ret tekststrenge

**Gennemgå tekststrenge** viser et sprogs tekststrenge med den engelske tekst ved siden af hver oversættelse. Filtrér efter sektion, efter status (manglende, ændret på engelsk, oversat) eller efter tekst, og redigér eller ryd enhver oversættelse direkte. Dine rettelser træder i kraft, så snart du gemmer dem.

## Efter en opgradering

Hver Turbo EA-udgivelse tilføjer og ændrer noget engelsk tekst, og du kan omdøbe ting i dit metamodel. Bagefter viser det brugerdefinerede sprog de nye tekststrenge som **manglende** og de ændrede som **ændret på engelsk** — alt andet beholder sin oversættelse. Udfyld hullet på en af de tre måder ovenfor: eksportér de nye og ændrede tekststrenge, kør **Oversæt med AI** med **Nye og ændrede tekststrenge**, eller spørg din assistent.

Rettelser, du har lavet i hånden, bevares. En AI-kørsel over **Alt** lader dem være, medmindre du markerer **Erstat også tekststrenge rettet i hånden**.

## Begrænsninger

- **Dokumentationssiden er ikke dækket.** Denne manual forbliver på de indbyggede sprog.
- **Undersøgelser beholder de etiketter, de blev bygget med.** En undersøgelse, der blev oprettet, før et felts valgmuligheder blev oversat, beholder de valgmuligheds-etiketter, den blev bygget med.
- **Flertalsformer.** Engelsk har to flertalsformer (*one card*, *2 cards*). Et sprog med flere — fx polsk, russisk eller arabisk — kan tilføje sine ekstra former (`_few`, `_many`, …) ved siden af de engelske i en importeret fil. En form, som pakken ikke indeholder, falder tilbage til sprogets egen almindelige form (`_other`-oversættelsen), aldrig til engelsk. AI-oversættelsen og gennemgangsvisningen arbejder også med de ekstra former, der allerede er gemt, men opretter ikke nye: tilføj dem via en fil.
- Sletning af et brugerdefineret sprog fjerner alle dets oversættelser, inklusive navnene på korttyper, felter og de øvrige metamodel-etiketter. Brugere, der havde valgt det, skifter tilbage til engelsk.
