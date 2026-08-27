# Udvidelser

**Udvidelser** tilføjer funktionalitet til Turbo EA uden at ændre kernen — ekstra
metamodelindhold, integrationer med de værktøjer jeres teams allerede bruger,
regulatorisk indberetning og helt nye sider. De bygges og signeres af Turbo EA og
installeres fra **Admin → Udvidelser**.

Dette afsnit beskriver, *hvad* hver offentliggjort udvidelse gør, og hvordan den
bruges. Hvordan selve butikken fungerer — tillid og signaturer, licenser,
instans-id'er, installation, opdateringer og prøveperioder — er beskrevet under
[Administration → Udvidelsesbutik](../admin/extensions.md).

## Tilgængelige udvidelser

| Udvidelse | Hvad den gør | Licens |
|-----------|--------------|--------|
| [Digital Autonomy Assessment](digital-autonomy.md) | Vurderer hver applikation efter Utrecht Universitets Digital Autonomy Assessment Framework — 22 vægtede indikatorer, en automatisk autonomi-score fra 1 til 10 og en risiko/afbødnings-kvadrant | **Gratis** |
| [EA Value Tracker](value-savings.md) | Gør arkitekturbeslutninger til et revisionsegnet økonomisk regnskab: kategoriserede besparelser, godkendelse af realiseringen efter fire-øjne-princippet og et værdi-dashboard | Kommerciel |
| [Jira Todo Sync](jira-todos.md) | Holder Turbo EA-todos og et Jira Cloud-projekt afstemt i begge retninger — status, titel, frist og ansvarlig | Kommerciel |
| [Slack Notifications](slack-notify.md) | Leverer den enkeltes Turbo EA-notifikationer som direkte besked i Slack, med frivillig tilmelding pr. person og pr. type | Kommerciel |
| [DORA Register of Information](dora-roi.md) | Fører informationsregistret efter DORA art. 28 på jeres eksisterende kort og eksporterer den officielle xBRL-CSV-indberetningspakke | Kommerciel |

## Det alle udvidelser har til fælles

- **Signeret af leverandøren.** Hver pakke bærer en Ed25519-signatur, som Turbo EA
  kontrollerer ved upload *og* ved hver opstart af backend'en. Det, der lader sig
  installere, er præcis det, leverandøren har bygget.
- **Licensafhængige ved kørsel** (bortset fra de gratis). Udløber en licens,
  bliver udvidelsen blidt deaktiveret — dens sider forsvinder og dens job sættes
  på pause — men **jeres data slettes aldrig**. En fornyet licens genskaber alt.
- **Færrest mulige rettigheder.** Alt, hvad en udvidelse læser eller skriver ud
  over sine egne data, er erklæret som en **tilladelse** inde i den signerede
  pakke og kan derfor ses før installation. Se
  [Tilladelser til dataadgang](../admin/extensions.md).
- **Egne rettigheder.** Hver udvidelse definerer rettighedsnøgler i formen
  `ext.<navn>.…`, som dukker op under **Admin → Brugere og roller**, når den er
  indlæst: I bestemmer, hvem der må bruge den.
- **Sporbare.** Enhver ændring, som en udvidelse foretager i jeres inventar,
  registreres i **Admin → Auditlog** med oprindelsen **Udvidelse** og kan rulles
  tilbage.

## Før I installerer

Kontrollér den **mindste Turbo EA-version**, der er angivet på hver udvidelses
side — på en ældre kerne kan den ikke installeres. Udvidelser med backend-kode
kræver én genstart af backend'en efter installation; Turbo EA viser en besked, når
det er tilfældet.
