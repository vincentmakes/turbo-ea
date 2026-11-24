# Riferimento API

Turbo EA espone una **API REST** completa che alimenta tutto ciò che si può fare nell'interfaccia web. Puoi usarla per automatizzare gli aggiornamenti dell'inventario, integrare pipeline CI/CD, costruire dashboard personalizzate o portare i dati EA in altri strumenti (BI, GRC, ITSM, fogli di calcolo).

La specifica OpenAPI 3 completa è renderizzata in tempo reale più in basso in questa pagina: ogni endpoint, parametro e forma di risposta, rigenerata dal codice del backend a ogni release.

---

## URL di base

Tutti gli endpoint dell'API si trovano sotto il prefisso `/api/v1`:

```
https://tuo-dominio.example.com/api/v1
```

In locale (configurazione Docker predefinita):

```
http://localhost:8920/api/v1
```

L'unica eccezione è l'endpoint di salute, montato su `/api/health` (senza prefisso di versione).

---

## Riferimento OpenAPI in tempo reale

La Swagger UI interattiva qui sotto è generata direttamente dal codice sorgente di FastAPI a ogni release ed è inclusa nel manuale utente: non serve un'istanza backend in esecuzione per consultarla. Usa il filtro per restringere gli endpoint per tag ed espandi qualsiasi operazione per vedere parametri, schemi di richiesta/risposta ed esempi. Lo schema grezzo è scaricabile come JSON da [`/api/openapi.json`](/api/openapi.json) per generatori di codice come `openapi-generator-cli`.

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

!!! info "Provare gli endpoint sulla propria istanza"
    «Try it out» è disabilitato qui di proposito: il sito di documentazione non fa da proxy alla tua API. Per inviare richieste reali, esegui Turbo EA in modalità sviluppo (`ENVIRONMENT=development`) e apri `/api/docs` sulla tua istanza: clicca **Authorize**, incolla un JWT (senza il prefisso `Bearer `) e usa **Try it out**. Nei deployment di produzione quegli endpoint sono disabilitati per sicurezza; questa pagina rimane il browser di sola lettura.

---

## Autenticazione

Tutti gli endpoint tranne `/auth/*`, il controllo di salute e i portali web pubblici richiedono un JSON Web Token inviato nell'intestazione `Authorization`:

```
Authorization: Bearer <access_token>
```

### Ottenere un token

`POST /api/v1/auth/login` con la tua e-mail e password:

```bash
curl -X POST https://tuo-dominio.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "tu@example.com", "password": "tua-password"}'
```

La risposta contiene un `access_token`:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

I token sono validi 24 ore per impostazione predefinita (`ACCESS_TOKEN_EXPIRE_MINUTES`). Usa `POST /api/v1/auth/refresh` per estendere una sessione senza reinserire le credenziali.

!!! tip "Utenti SSO"
    Se la tua organizzazione usa il Single Sign-On, non potrai accedere con e-mail/password. Chiedi a un amministratore di creare un account di servizio con password locale per l'automazione, oppure cattura il JWT dal session storage del browser dopo un login SSO normale (solo per sviluppo).

### Usare il token

```bash
curl https://tuo-dominio.example.com/api/v1/cards \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

---

## Permessi

L'API applica **le stesse regole RBAC dell'interfaccia web**. Ogni endpoint che modifica dati controlla sia il ruolo a livello applicativo del chiamante sia tutti i ruoli di stakeholder che detiene sulla card interessata. Non esistono «permessi API» separati né scorciatoie per account di servizio: gli script di automazione girano con i permessi dell'utente il cui token usano.

Se una richiesta fallisce con `403 Forbidden`, il token è valido ma all'utente manca il permesso richiesto. Vedi la pagina [Utenti e ruoli](users.md) per il registro dei permessi.

---

## Gruppi di endpoint comuni

Il riferimento in tempo reale qui sopra è la fonte completa di verità; la tabella seguente è una mappa rapida dei gruppi più usati:

| Prefisso | Scopo |
|----------|-------|
| `/auth` | Login, registrazione, callback SSO, refresh del token, informazioni utente corrente |
| `/cards` | CRUD sulle card (entità centrale), gerarchia, cronologia, approvazione, esportazione CSV |
| `/relations` | CRUD sulle relazioni tra card |
| `/metamodel` | Tipi di card, campi, sezioni, sottotipi, tipi di relazione |
| `/reports` | KPI della dashboard, portafoglio, matrice, ciclo di vita, dipendenze, costo, qualità dei dati |
| `/bpm` | Gestione dei processi aziendali: diagrammi, elementi, versioni di flusso, valutazioni |
| `/ppm` | Elenco principale dei progetti — iniziative, report di stato, WBS, attività, costi e rischi |
| `/turbolens` | Analisi guidata da IA (fornitori, duplicati, sicurezza, IA di architettura) |
| `/risks` | Registro dei rischi EA (Fase G di TOGAF) |
| `/diagrams` | Diagrammi DrawIO |
| `/soaw` | Documenti Statement of Architecture Work |
| `/adr` | Architecture Decision Records |
| `/users`, `/roles` | Amministrazione di utenti e ruoli (solo admin) |
| `/settings` | Impostazioni applicative (logo, valuta, SMTP, IA, interruttori di modulo) |
| `/servicenow` | Sincronizzazione bidirezionale con la CMDB di ServiceNow |
| `/events`, `/notifications` | Audit trail e notifiche utente (incluso flusso SSE) |

---

## Paginazione, filtri e ordinamento

Gli endpoint di elenco accettano un insieme coerente di parametri di query:

| Parametro | Descrizione |
|-----------|-------------|
| `page` | Numero di pagina (parte da 1) |
| `page_size` | Elementi per pagina (predefinito 50, massimo 200) |
| `sort_by` | Campo per l'ordinamento (es. `name`, `updated_at`) |
| `sort_dir` | `asc` o `desc` |
| `search` | Filtro testuale (dove supportato) |

I filtri specifici per risorsa sono documentati per endpoint nel riferimento in tempo reale qui sopra (es. `/cards` accetta `type`, `status`, `parent_id`, `approval_status`).

---

## Eventi in tempo reale (Server-Sent Events)

`GET /api/v1/events/stream` è una connessione SSE persistente che invia eventi mentre accadono (card creata, aggiornata, approvata, ecc.). L'interfaccia web la usa per aggiornare badge e liste senza polling. Qualsiasi client HTTP che supporti SSE può sottoscriversi: utile per costruire dashboard in tempo reale o ponti di notifica esterni.

---

## Generazione del codice

Poiché l'API è descritta interamente da OpenAPI 3, puoi generare client tipizzati in tutti i linguaggi principali:

```bash
# Scaricare lo schema (non serve un'istanza in esecuzione)
curl https://docs.turbo-ea.org/api/openapi.json -o turbo-ea-openapi.json

# Generare un client Python
openapi-generator-cli generate \
  -i turbo-ea-openapi.json \
  -g python \
  -o ./turbo-ea-client-py

# … o TypeScript, Go, Java, C# ecc.
```

Per l'automazione in Python, la via più semplice è di solito `httpx` o `requests` con chiamate scritte a mano: l'API è abbastanza piccola da non rendere quasi mai vantaggioso un generatore.

---

## Rate limiting

Gli endpoint sensibili all'autenticazione (login, registrazione, reset password) sono limitati tramite `slowapi` per proteggersi da attacchi brute-force. Gli altri endpoint non sono limitati per impostazione predefinita; se devi limitare uno script di automazione pesante, fallo lato client o dietro il tuo reverse proxy.

---

## Versionamento e stabilità

- L'API è versionata tramite il prefisso `/api/v1`. Un cambiamento incompatibile introdurrebbe un `/api/v2` in parallelo.
- Entro `v1`, le modifiche additive (nuovi endpoint, nuovi campi opzionali) possono uscire nelle release minori e patch. Rimozioni o cambi di contratto sono riservati a un salto di versione maggiore.
- La versione corrente è riportata da `GET /api/health` così l'automazione può rilevare gli aggiornamenti.

---

## Risoluzione dei problemi

| Problema | Soluzione |
|----------|-----------|
| `/api/docs` restituisce 404 sulla tua istanza | Swagger UI è disabilitata in produzione. Imposta `ENVIRONMENT=development` e riavvia il backend, o usa il riferimento in tempo reale qui sopra. |
| Il riferimento qui sopra appare vuoto | Controlla la console del browser: l'embed carica `/api/openapi.json`; proxy aziendali o ad-blocker rigorosi bloccano talvolta gli script serviti via CDN. |
| `401 Unauthorized` | Token mancante, malformato o scaduto. Riautenticati tramite `/auth/login` o `/auth/refresh`. |
| `403 Forbidden` | Il token è valido ma all'utente manca il permesso richiesto. Controlla il ruolo in [Utenti e ruoli](users.md). |
| `422 Unprocessable Entity` | Validazione Pydantic fallita. Il corpo della risposta elenca i campi non validi e il motivo. |
| Errori CORS da un'app browser | Aggiungi l'origine del frontend a `ALLOWED_ORIGINS` in `.env` e riavvia il backend. |
