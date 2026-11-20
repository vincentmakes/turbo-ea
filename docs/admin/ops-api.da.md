# Ops API (administrerede installationer)

Ops API'en (`/api/v1/ops`) er en **valgfri** administrationsflade, som et Turbo EA Cloud-kontrolplan bruger til at drive hostede instanser. På en selvhostet installation er den **deaktiveret som standard** — alle ruter svarer `404`, medmindre instansen er startet med miljøvariablen `OPS_PUBLIC_KEY`. Turbo EA indeholder ingen fakturerings- eller licenslogik.

## Godkendelse

Hver Ops-anmodning skal signeres med den Ed25519-**private** nøgle, som kontrolplanet opbevarer; instansen verificerer signaturen med den **offentlige** nøgle fra `OPS_PUBLIC_KEY` (base64, rå 32 bytes). Signaturen dækker HTTP-metoden, stien med forespørgselsstrengen, et SHA-256-hash af indholdet, et tidsstempel og en engangsnonce:

```
canonical = METHOD \n PATH_WITH_QUERY \n sha256(body) \n timestamp \n nonce
```

Headere: `X-Ops-Timestamp` (Unix-sekunder, ±5 minutter), `X-Ops-Nonce` (bruges én gang, beskyttelse mod replay), `X-Ops-Signature` (base64 Ed25519-signatur).

## Endpoints

| Metode | Sti | Formål |
|--------|------|---------|
| GET | `/api/v1/ops/info` | Version, antal brugere/kort, databasens tilstand |
| POST | `/api/v1/ops/rescue-access` | Opretter en **tidsbegrænset** operatør-administratorkonto |
| DELETE | `/api/v1/ops/rescue-access` | Tilbagekalder straks en nødkonto |
| GET | `/api/v1/ops/export` | Streamer eksportpakken for arbejdsområdet uden hemmeligheder |

## Nødadgang — garantier for gennemsigtighed

Tidsbegrænset operatøradgang (”nødadgang”) er designet, så den aldrig kan ske ubemærket:

- **Hver tildeling og tilbagekaldelse giver alle instansadministratorer besked** i appen *og* via e-mail, inklusive operatørens navn, den angivne årsag og udløbstidspunktet.
- **Hver handling registreres i instansens egen hændelseslog.**
- **Instansen håndhæver selv udløbet**: nødkonti har et `access_expires_at`-tidsstempel; udløbne konti afvises ved godkendelse og deaktiveres af en baggrundsopgave hver time. Et nedbrud i kontrolplanet kan aldrig forlænge adgangen.
- Nødkonti bruger en reserveret adresse (`rescue-…@rescue.turboea.invalid`), så de er lette at genkende på brugerlisten og kan deaktiveres manuelt når som helst.

## Eksport af arbejdsområde

`GET /api/v1/ops/export` returnerer den samme pakke som **Admin → Indstillinger → Migration → Overførsel af arbejdsområde → Eksportér**: hele arbejdsområdet uden hemmeligheder. Kontrolplanet bruger den til dataeksport efter kundens anmodning (GDPR-dataportabilitet) og til sikkerhedskopier før opgraderinger eller sletninger.
