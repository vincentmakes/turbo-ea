# Platformsmigrering

Platforms-migreringsimportøren (**Admin → Indstillinger → Migrering**) ingesterer et komplet enterprise-architecture-arbejdsområde fra en understøttet kildeplatform og lander det som Turbo EA-kort, relationer, tags, interessenter, dokumenter, kommentarer og en fuldt udfyldt metamodel i én staged, gennemgåelig operation.

## Understøttede kilder

| Kilde | Format |
|---|---|
| **SAP LeanIX** | Full Snapshot xlsx-projektmappe (Administration → Export → Full Snapshot) |

Yderligere kildeplatforme (Ardoq, Mega HOPEX, BiZZdesign, Avolution Abacus, …) plugger ind i den samme staging + apply-pipeline via per-kilde-adaptere. Når en ny adapter sendes, vises den automatisk i vælgeren **Kildeplatform** i upload-dialogen uden admin-konfiguration påkrævet.

## Hvem er dette til?

Kunder, der flytter fra en af de understøttede kildeplatforme til Turbo EA. Hver kilde har sin egen adapter, der oversætter kildens native form (fact sheets / komponenter / objekter / elementer …) til Turbo EA-kort.

### LeanIX

LeanIX-adapteren accepterer **Full Snapshot** xlsx-projektmappen — multi-ark-eksporten med ét ark pr. fact-sheet-type, ét ark pr. relationstype, plus `TagGroups`, `Tags`, `Documents`, `Comments`, `Types` og et `ReadMe`-referenceark. Filer, der ikke består adapterens payload-tjek, afvises ved upload-trinnet med en klar fejl.

## Sådan hentes eksporten

I LeanIX skal du åbne **Administration → Export → Full Snapshot**. Dette producerer en enkelt XLSX-projektmappe, der indeholder hvert **aktivt** fact sheet, plus dets relationer, tag-grupper, tags, dokumenter (kaldet *resources* i LeanIX) og kommentarer.

**Arkiverede fact sheets er ikke inkluderet** i Full Snapshot — gendan dem i LeanIX først, hvis du har brug for, at de lander i Turbo EA.

## Arbejdsprocessen

1. **Upload** snapshottet på **Indstillinger → Migrering → Ny migrering**. Vælg kildeplatformen (LeanIX er den eneste mulighed i dag), giv migreringen en etiket, og vedhæft snapshot-filen. Filen forbliver på serverens disk; databasen indeholder kun metadata. Parsing kører i baggrunden, og statussen flytter automatisk gennem `uploaded → parsed`.

2. **Gennemgå** hver entitets-art i per-faneblad-visningen. Hver staged række bærer en handling:
    - `create` — vil blive tilføjet til Turbo EA
    - `update` — eksisterer allerede; diff-felter vil blive fusioneret
    - `skip` — eksisterer allerede uden ændringer
    - `conflict` — endpoint mangler, type ikke mappet, indbygget kollision, fejlformet e-mail osv. — se kolonnen *Note* for den fulde grundtekst

    Hvert faneblad viser en række **filter-pills** over tabellen — én pill pr. korttype, hvor det er relevant, ellers pr. handling — så du kan indsnævre en stor liste (hundredvis af kort, snesevis af fact-sheet-typer) til ét udsnit ad gangen. Kort-fanebladet viser det opløste **kortnavn** sammen med kildens UUID. Note-kolonnen gengiver den fulde konfliktgrund, og opdateringsrækker viser de ændrede feltnavne med en tooltip, der staver `gammel → ny`-overgangen ud.

    Fanebladene **Nye typer**, **Brugerdefinerede felter** og **Nye relationer** viser tenant-tilpasset metamodel fra dit kildearbejdsområde. Som standard accepteres disse, som de er, og opretter matchende ikke-indbyggede korttyper/felter/relationstyper i Turbo EA.

3. **Map importerede felter** (valgfrit, i fanebladet **Brugerdefinerede felter**). For hver brugerdefineret kildeplatform-kolonne skal du vælge et af tre resultater fra dropdown ved siden af rækken:
    - **Importér som nyt brugerdefineret felt** (standard) — kolonnen lander som en ny egenskab på målkort-typen under en syntetisk *Importeret fra {kilde}*-sektion.
    - **Map til et eksisterende Turbo EA-felt** — rut værdien til et indbygget felt på målkort-typen (f.eks. send LeanIX `businessCriticality` til TEA's egen `businessCriticality`-slot). Metamodel-feltrækken springes derefter over ved apply-tidspunktet, så ingen forældreløs kolonne oprettes.
    - **Map til en livscyklusfase** — for datokolonner, rut værdien til standard `plan` / `phaseIn` / `active` / `phaseOut` / `endOfLife`-slottet i `card.lifecycle`. Dato/datetime-værdier auto-tvinges til `YYYY-MM-DD` (`T00:00:00`-suffikset, som nogle platforme skriver for datetime-celler, fjernes); uparserbare værdier droppes, så de ikke kan korrumpere livscykluskortet.
    - **Importér ikke dette felt** — kolonnen springes helt over, både som en egenskab og som et metamodel-felt.

    Mappingen er per-migrering og kan redigeres når som helst, statussen er `parsed` eller `previewed`. Kildeplatform-kernekolonner, som adapteren ruter direkte ind i Turbo EA-standardslots (f.eks. LeanIX `name`, `displayName`, `description`, `status`, `category → subtype`, `lifecycle:*`, `qualitySeal`, `completion`), er listet øverst på fanebladet i et skrivebeskyttet info-banner — disse har ingen mapping-beslutning at træffe.

4. **Anvend**, når du er tilfreds. Apply-pipelinen kører 12 afhængighedsordrede passes (metamodel-typer → metamodel-felter → metamodel-relationstyper → brugere → kort → tag-grupper → tags → kort-tag-links → relationer → abonnementer → dokumenter → kommentarer) inden i individuelle savepoints — én fejlende række forgifter ikke resten af importen. Status flytter gennem `applying → applied` (eller `failed`, hvis fejl krydser sikkerhedstærsklen).

    Hvis det parsede snapshot indeholder **konflikt**-rækker, vises et advarselsbanner over staging-fanebladene (med klikbare chips, der springer til det berørte faneblad), og et klik på **Anvend** åbner en bekræftelsesdialog, der staver ud, hvilke arter der bærer konflikter. Du skal eksplicit anerkende, at de konfliktende rækker vil blive sprunget over, før anvendelsen kører. *Anvendelsesresultatet* efter anvendelse viser en dedikeret *konflikter*-chip ved siden af *oprettet / opdateret / sprunget over / fejl* — konflikter er ikke tavse spring, de er et førsteklasses resultat, som admin'en ser i migrerings-historikken.

## Hvad bliver importeret

| LeanIX | Turbo EA |
|---|---|
| Application, ITComponent, Business Capability, Business Context, Process, DataObject, Interface, Provider, TechCategory, Platform, Objective, Project / Initiative | Direkte 1:1-korttype-mapping |
| User Group | Organization med undertype `team`, tagget `leanix_origin=UserGroup` |
| Livscyklusfaser (plan / phaseIn / active / phaseOut / endOfLife) | Båret verbatim over på `cards.lifecycle` |
| Hierarki (`childParentRelation`) | Foldet ind i `Card.parent_id` |
| Successor-/predecessor-kanter (`*SuccessorRelation`) | Gemt som relationer; retningen vendes om ved import, så Turbo EA's "kilde efterfølger mål"-konvention matcher LeanIX's "X har efterfølger Y"-semantik. De nye tenant-korttyper har `has_successors=true`, så lineage-visningen gengives. |
| Relationer (50+ default LeanIX-kanttyper, både xlsx-stil `applicationITComponentRelation` og GraphQL-stil `relApplicationToITComponent`-navne) | Native Turbo EA-relationer med kant-egenskaber |
| Tenant-definerede relationstyper (Server↔Application, lxSystem*, lxDora*, microservice*, ESG* osv.) | Nye ikke-indbyggede `relation_types`-rækker, oprettet automatisk i samme import-pass, så hver kant faktisk lander |
| Tags (single/multi-grupper) | Tag-grupper + tags + per-kort-joins |
| Abonnementer (én pr. RESPONSIBLE/OBSERVER-rolle) | Interessent-rækker; brugere auto-oprettet som deaktiverede (`is_active=false`) |
| Dokumenter (URL) | Dokumentvedhæftninger |
| Kommentarer (topniveau + svar, fladtrykt) | Kommentarrækker |
| Tenant-brugerdefinerede fact-sheet-typer (f.eks. `ESGCapability`, `Server`, `System`, `TechPlatform`, `TechnicalStack`) | Nye ikke-indbyggede korttyper med `has_hierarchy=true`, `has_successors=true` og en `Imported from LeanIX`-feltsektion forhåndsudfyldt |
| Tenant-brugerdefinerede felter | Tilføjet til målet typens `fields_schema` under en syntetisk `Imported from LeanIX`-sektion. Felttype og **komplet** enum-indstillingsliste er løftet fra projektmappens `ReadMe`-referenceark — så `currentMaturity` lander som en single-select med alle 5 værdier (`adHoc, repeatable, defined, managed, optimized`), selv når dataene kun bruger én |
| Tenant-brugerdefinerede relationstyper | Nye ikke-indbyggede relationstyper, endpoint-typer oversat gennem LX↔TEA-typekortet (`UserGroup → Organization` osv.) |

### Hvorfor ReadMe-arket betyder noget

Det første ark i xlsx'en (`ReadMe`) er LeanIX's autoritative felt-reference: hver kolonne dokumenteret med sin type (`String`, `Integer`, `Percent`, `Datetime`, `Boolean`, `String list`) og, hvor det er relevant, dens fulde enum-begrænsning (`Possible values: one of A, B, C.`). Importøren læser dette ark først og bruger det som den primære kilde til sandhed for felt-metadata — og falder kun tilbage til in-data `Types`-arket, når ReadMe ikke dækker en kolonne. Dette er forskellen mellem et importeret felt, der er et fritekst-input, og et, der er en ordentlig dropdown med de rigtige indstillinger.

## Hvad bliver **ikke** importeret

Snapshottet bærer ikke disse — importøren viser, hvad der mangler i per-række `Note`-kolonnen:

- **Dokument-binærfiler** — kun URL'er er i snapshottet; importøren opretter link-stil Document-rækker. Genupload binærfiler manuelt.
- **Kommentartrådning** — svar fladtrykkes til topniveau-kommentarer for at bevare prosaen; trådforældre ville kræve LeanIX UI-metadata, der ikke er i snapshottet.
- **Brugeradgangskoder og SSO-bindinger** — auto-oprettede brugere lander deaktiverede. Invitér dem eller bind dem til SSO bagefter.
- **Revisionshistorik** før importen — Turbo EA's historik starter ved apply-tidsstemplet.
- **Diagrammer / poster views / dashboards / gemte søgninger / notifikationspræferencer / API-tokens / webhooks** — ingen ækvivalent i Turbo EA eller ingen analog i snapshottet.

## Genkørsel af en import

Idempotens er indbygget. Tabellen `migration_identity_map` registrerer kildesiden → Turbo EA-UUID for hver entitet, der er blevet importeret (nøglet af `(source_id, entity_kind, source_type)`, så samme eksterne id legitimt kan eksistere i imports fra to forskellige kilder). En genupload af samme snapshot (eller et opdateret snapshot fra samme arbejdsområde) detekterer eksisterende entiteter og skriver `update`- / `skip`-staged rækker i stedet for duplikerede `create`s. Kortets `external_id` bærer kildesidens id (LeanIX `factSheetId`, Ardoq-komponent-id, …), så linket overlever, selv hvis identitetskortet tørres.

Hvis du har brug for at gentage en import (f.eks. har du bulk-slettet de importerede kort i UI'et og vil lande dem friske), så brug papirkurvsikonet på migreringsrækken til at slette den og derefter genuploade. `applied`-migreringer kan slettes; at gøre det frigiver `(file_hash, source_type)`-idempotenslåsen, så samme snapshot kan uploades igen. Dinglende `migration_identity_map`-rækker, der peger på kort, der ikke længere eksisterer, beskæres automatisk ved næste staging-pass, så manuel oprydning af identitetskortet er aldrig påkrævet.

## Tilladelse

Denne side er bevogtet af `admin.migrate`-tilladelsen. Kun **admin**-rollen har den som standard; tildel den eksplicit til andre roller i **Indstillinger → Roller**, hvis du vil have en ikke-admin til at drive migreringen.

## Begrænsninger at planlægge for

- **Én igangværende migrering pr. `(file_hash, source_type)`-par.** Genupload af nøjagtigt samme bytes for samme kilde, mens en migrering stadig er aktiv, returnerer den eksisterende migreringspost (SHA-256-hashen + kildenøglen er den naturlige idempotensnøgle). Slet migreringsposten først, hvis du virkelig vil have en frisk ingest af samme fil. Upload af samme hash under en anden kildenøgle (hvis du nogensinde gør det) lander som en separat migrering.
- **Store arbejdsområder** (10k+ fact sheets): parseren er streaming, men apply-pipelinen skriver rækker i én transaktion pr. pass. Planlæg ~15 minutter for meget store imports.
- **Brugerdefinerede felter, værdier og tags tolereres, ikke forhåndsmappes.** Enhver LeanIX-kolonne, der ikke er i Turbo EA's indbyggede metamodel, lander på det importerede korts `attributes`-kort verbatim og vises i fanebladet **Brugerdefinerede felter**, så en admin kan forfremme den (rute den til et eksisterende TEA-felt, en livscyklusfase eller springe over — se *Map importerede felter* i arbejdsprocessen ovenfor). Det samme gælder for tenant-definerede tag-grupper og for relationstyper, kildeplatforme har tilføjet (f.eks. `lxSystemSystem*`, `*Lx*Dora*`, `microservice*`, `eSGCapability*`) — de vises i fanebladene **Nye typer** / **Nye relationer** uændrede, klar til en admin-beslutning.
- **Abonnements-e-mails kan bruge enten afgrænser.** LeanIX "Full Snapshot"-eksporten afgrænser e-mails inde i `subscriptions:<RoleType>[:<RoleName>]`-celler med `;`; GraphQL CSV-eksporten bruger `,`. Parseren accepterer begge dele. Rækker, hvis e-mail er fejlformet (mangler `@`, eller en ikke-opdelt afgrænser smuttede igennem), stages som `conflict` med en klar grund i stedet for at blive oprettet som bogus brugere — ret kildeeksporten og genupload.

## Oprydning

Sletning af en migreringspost (Indstillinger → Migrering → papirkurvsikon) fjerner både databaserækkerne for den migrering (staged poster cascade) og snapshot-filen på disken. `uploaded`-, `parsed`-, `previewed`-, `failed`-, `aborted`- og `applied`-migreringer kan alle slettes; en `applying`-migrering skal afslutte (eller fejle), før den kan fjernes.
