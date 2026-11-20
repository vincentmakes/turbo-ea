# API operativa (distribuzioni gestite)

L’API operativa (`/api/v1/ops`) è un’interfaccia di gestione **facoltativa** usata da un piano di controllo Turbo EA Cloud per amministrare le istanze ospitate. In un’installazione self-hosted è **disabilitata per impostazione predefinita**: ogni route risponde `404`, a meno che l’istanza non sia stata avviata con una variabile d’ambiente `OPS_PUBLIC_KEY`. Turbo EA non contiene alcuna logica di fatturazione o licenza.

## Autenticazione

Ogni richiesta operativa deve essere firmata con la chiave Ed25519 **privata** custodita dal piano di controllo; l’istanza verifica la firma con la chiave **pubblica** di `OPS_PUBLIC_KEY` (base64, 32 byte grezzi). La firma copre il metodo HTTP, il percorso con la stringa di query, un hash SHA-256 del corpo, un timestamp e un nonce monouso:

```
canonical = METHOD \n PATH_WITH_QUERY \n sha256(body) \n timestamp \n nonce
```

Header: `X-Ops-Timestamp` (secondi Unix, ±5 minuti), `X-Ops-Nonce` (usato una sola volta, protezione dai replay), `X-Ops-Signature` (firma Ed25519 in base64).

## Endpoint

| Metodo | Percorso | Funzione |
|--------|------|---------|
| GET | `/api/v1/ops/info` | Versione, conteggi di utenti e card, stato del database |
| POST | `/api/v1/ops/rescue-access` | Crea un account amministratore operatore **a tempo limitato** |
| DELETE | `/api/v1/ops/rescue-access` | Revoca immediatamente un account di soccorso |
| GET | `/api/v1/ops/export` | Trasmette il pacchetto di esportazione dello spazio di lavoro senza segreti |

## Accesso di soccorso — garanzie di trasparenza

L’accesso operatore a tempo limitato («accesso di soccorso») è progettato per non poter mai avvenire di nascosto:

- **Ogni concessione e revoca notifica tutti gli amministratori dell’istanza** nell’app *e* via e-mail, includendo il nome dell’operatore, il motivo dichiarato e l’ora di scadenza.
- **Ogni azione viene registrata nel registro eventi dell’istanza stessa.**
- **La scadenza viene applicata dall’istanza stessa**: gli account di soccorso hanno un timestamp `access_expires_at`; gli account scaduti vengono rifiutati in fase di autenticazione e disattivati da un’attività in background oraria. Un’interruzione del piano di controllo non può mai prolungare l’accesso.
- Gli account di soccorso usano un indirizzo riservato dedicato (`rescue-…@rescue.turboea.invalid`), così sono facili da riconoscere nell’elenco utenti e possono essere disattivati manualmente in qualsiasi momento.

## Esportazione dello spazio di lavoro

`GET /api/v1/ops/export` restituisce lo stesso pacchetto di **Admin → Impostazioni → Migrazione → Trasferimento dello spazio di lavoro → Esporta**: l’intero spazio di lavoro con tutti i segreti rimossi. Il piano di controllo lo usa per le esportazioni di dati richieste dai clienti (portabilità dei dati GDPR) e per i backup di sicurezza prima di aggiornamenti o eliminazioni.
