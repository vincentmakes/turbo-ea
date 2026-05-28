# API-reference

Turbo EA eksponerer et komplet **REST API**, der driver alt, hvad du kan gøre i web-UI'et. Du kan bruge det til at automatisere lageropdateringer, integrere med CI/CD-pipelines, bygge brugerdefinerede dashboards eller trække EA-data ind i andre værktøjer (BI, GRC, ITSM, regneark).

Den komplette OpenAPI 3-specifikation gengives live længere nede på denne side — hvert endpoint, parameter og responsformat, regenereret fra backend-kildekoden ved hver udgivelse.

---

## Basis-URL

Alle API-endpoints lever under `/api/v1`-præfikset:

```
https://your-domain.example.com/api/v1
```

Lokalt (standard Docker-opsætning):

```
http://localhost:8920/api/v1
```

Den eneste undtagelse er health-endpointet, som er monteret på `/api/health` (intet versionspræfiks).

---

## Live OpenAPI-reference

Den interaktive Swagger UI nedenfor genereres direkte fra FastAPI-kildekoden ved hver udgivelse og leveres med brugermanualen — ingen backend-instans påkrævet for at browse den. Brug filterboksen til at indsnævre endpoints efter tag, udvid enhver operation for at se parametre, request/response-skemaer og eksempel-payloads. Den rå specifikation kan downloades som JSON på [`/api/openapi.json`](/api/openapi.json) til kodegeneratorer såsom `openapi-generator-cli`.

<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
<div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
window.addEventListener('DOMContentLoaded', function () {
  window.SwaggerUIBundle({
    url: '/api/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    filter: true,
    docExpansion: 'list',
    defaultModelsExpandDepth: 1,
    supportedSubmitMethods: []
  });
});
</script>

!!! info "Test endpoints mod din egen instans"
    Try-it-out er bevidst deaktiveret her — docs-siden proxyer ikke dit API. For at sende rigtige anmodninger skal du køre Turbo EA i udviklingstilstand (`ENVIRONMENT=development`) og åbne `/api/docs` på din egen instans: klik på **Authorize**, indsæt en JWT (uden `Bearer `-præfikset), og brug **Try it out**. I produktionsimplementeringer er disse endpoints deaktiveret af sikkerhedsårsager; denne side forbliver den skrivebeskyttede browser.

---

## Autentificering

Alle endpoints undtagen `/auth/*`, health-tjekket og offentlige webportaler kræver en JSON Web Token sendt i `Authorization`-headeren:

```
Authorization: Bearer <access_token>
```

### Opnåelse af et token

`POST /api/v1/auth/login` med din e-mail og adgangskode:

```bash
curl -X POST https://your-domain.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "you@example.com", "password": "your-password"}'
```

Responsen indeholder et `access_token`:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

Tokens er gyldige i 24 timer som standard (`ACCESS_TOKEN_EXPIRE_MINUTES`). Brug `POST /api/v1/auth/refresh` for at forlænge en session uden at genindtaste legitimationsoplysninger.

!!! tip "SSO-brugere"
    Hvis din organisation bruger Single Sign-On, kan du ikke logge ind med e-mail/adgangskode. Bed enten en administrator om at oprette en servicekonto med en lokal adgangskode til automatisering, eller fange JWT'en fra browserens session-storage efter et normalt SSO-login (kun til udviklingsbrug).

### Brug af tokenet

```bash
curl https://your-domain.example.com/api/v1/cards \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

---

## Tilladelser

API'et håndhæver de **samme RBAC-regler som web-UI'et**. Hvert muterende endpoint tjekker både den kaldendes applikationsrolle og enhver interessentrolle, de har på det berørte kort. Der er ingen separate "API-tilladelser" eller servicekonto-omgåelser — automatiseringsscripts kører med tilladelserne for den bruger, hvis token de bruger.

Hvis en anmodning fejler med `403 Forbidden`, er tokenet gyldigt, men brugeren mangler den krævede tilladelse. Se siden [Brugere og roller](users.md) for tilladelsesregistret.

---

## Almindelige endpoint-grupper

Live-referencen ovenfor er den fulde kilde til sandhed; tabellen nedenfor er et hurtigt kort over de mest brugte grupper:

| Præfiks | Formål |
|--------|---------|
| `/auth` | Login, registrering, SSO-callback, token-fornyelse, aktuel brugerinformation |
| `/cards` | CRUD på kort (kerne-entiteten), hierarki, historik, godkendelse, CSV-eksport |
| `/relations` | CRUD på relationer mellem kort |
| `/metamodel` | Korttyper, felter, sektioner, undertyper, relationstyper |
| `/reports` | Dashboard-KPI'er, portefølje, matrix, livscyklus, afhængigheder, omkostninger, datakvalitet |
| `/bpm` | Business Process Management — diagrammer, elementer, flowversioner, vurderinger |
| `/ppm` | Project Portfolio Management — initiativer, statusrapporter, WBS, opgaver, omkostninger, risici |
| `/turbolens` | AI-drevet analyse (leverandører, dubletter, sikkerhed, arkitektur-AI) |
| `/risks` | EA Risikoregister (TOGAF Phase G) |
| `/diagrams` | DrawIO-diagrammer |
| `/soaw` | Statement of Architecture Work-dokumenter |
| `/adr` | Architecture Decision Records |
| `/users`, `/roles` | Bruger- og rolleadministration (kun admin) |
| `/settings` | Applikationsindstillinger (logo, valuta, SMTP, AI, modulkontakter) |
| `/servicenow` | Tovejs ServiceNow CMDB-synkronisering |
| `/events`, `/notifications` | Revisionsspor og brugernotifikationer (inkl. SSE-stream) |

---

## Paginering, filtrering og sortering

List-endpoints accepterer et konsistent sæt af query-parametre:

| Parameter | Beskrivelse |
|-----------|-------------|
| `page` | Sidenummer (1-baseret) |
| `page_size` | Elementer pr. side (standard 50, maks 200) |
| `sort_by` | Felt at sortere efter (f.eks. `name`, `updated_at`) |
| `sort_dir` | `asc` eller `desc` |
| `search` | Fri tekst-filter (hvor understøttet) |

Ressourcespecifikke filtre er dokumenteret pr. endpoint i live-referencen ovenfor (f.eks. accepterer `/cards` `type`, `status`, `parent_id`, `approval_status`).

---

## Realtids-hændelser (Server-Sent Events)

`GET /api/v1/events/stream` er en langvarig SSE-forbindelse, der pusher hændelser, efterhånden som de sker (kort oprettet, opdateret, godkendt osv.). Web-UI'et bruger den til at opdatere badges og lister uden polling. Enhver HTTP-klient, der understøtter SSE, kan abonnere — nyttigt til at bygge realtids-dashboards eller eksterne notifikationsbroer.

---

## Kodegenerering

Fordi API'et er fuldt beskrevet af OpenAPI 3, kan du generere type-sikre klienter på ethvert større sprog:

```bash
# Download the schema (no running instance needed)
curl https://docs.turbo-ea.org/api/openapi.json -o turbo-ea-openapi.json

# Generate a Python client
openapi-generator-cli generate \
  -i turbo-ea-openapi.json \
  -g python \
  -o ./turbo-ea-client-py

# …or TypeScript, Go, Java, C#, etc.
```

Til Python-automatisering er den nemmeste vej normalt `httpx` eller `requests` med håndskrevne kald — API'et er lille nok til, at en generator sjældent er afhængigheden værd.

---

## Rate Limiting

Auth-følsomme endpoints (login, registrering, adgangskodenulstilling) er rate-limitet via `slowapi` for at beskytte mod brute-force-angreb. Andre endpoints er ikke rate-limitet som standard; hvis du har brug for at throttle et tungt automatiseringsscript, gør det på klientsiden eller bag din reverse proxy.

---

## Versionering og stabilitet

- API'et er versioneret via `/api/v1`-præfikset. En brydende ændring ville introducere `/api/v2` ved siden af det.
- Inden for `v1` kan additive ændringer (nye endpoints, nye valgfri felter) sendes i mindre og patch-udgivelser. Fjernelser eller kontraktændringer er forbeholdt en større version-bump.
- Den aktuelle version rapporteres af `GET /api/health`, så du kan registrere opgraderinger fra automatisering.

---

## Fejlfinding

| Problem | Løsning |
|-------|----------|
| `/api/docs` returnerer 404 på din egen instans | Swagger UI er deaktiveret i produktion. Indstil `ENVIRONMENT=development` og genstart backenden, eller brug live-referencen ovenfor. |
| Live-reference ovenfor er tom | Tjek browser-konsollen — embeddet indlæser `/api/openapi.json`; virksomheds-proxyer eller strenge ad-blockere blokerer lejlighedsvis CDN-hostede scripts. |
| `401 Unauthorized` | Token mangler, er fejlformet eller udløbet. Re-autentificér via `/auth/login` eller `/auth/refresh`. |
| `403 Forbidden` | Token er gyldigt, men brugeren mangler den krævede tilladelse. Tjek brugerens rolle i [Brugere og roller](users.md). |
| `422 Unprocessable Entity` | Pydantic-validering fejlede. Responskroppen lister, hvilke felter der er ugyldige og hvorfor. |
| CORS-fejl fra en browser-app | Tilføj din frontend-oprindelse til `ALLOWED_ORIGINS` i `.env` og genstart backenden. |
