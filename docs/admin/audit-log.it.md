# Registro di audit

Il **Registro di audit**, in **Admin → Impostazioni → Registro di audit** (`/admin/settings?tab=audit-log`), risponde alle due domande che una revisione di sicurezza pone a un'istanza che contiene la mappa dell'intero panorama IT: *che cosa vi è cambiato* e *chi ha effettuato l'accesso, e come*. È suddiviso in due sotto-schede:

| Sotto-scheda | URL | Che cosa registra |
|--------------|-----|-------------------|
| **Modifiche** | `/admin/settings?tab=audit-log` | Ogni scrittura nel panorama — schede, relazioni, rischi, tag, ruoli di stakeholder, bozze di decisione —, raggruppata in batch di modifiche, con le differenze per evento e un **Rollback** |
| **Sicurezza e amministrazione** | `/admin/settings?tab=audit-log&view=security` | Accessi e disconnessioni, tentativi falliti, blocchi, sessioni SSO e proxy, eventi relativi alle password e assunzione di ruolo |

Le due sono separate di proposito. **Modifiche** è uno strumento di lavoro — serve a vedere e annullare una scrittura errata — e conserva una cronologia breve. **Sicurezza e amministrazione** è una traccia probatoria: le sue voci non si possono modificare né eliminare, e per impostazione predefinita viene conservata per un anno.

## Chi può vederlo

Entrambe le sotto-schede richiedono il permesso **`admin.events`** («Visualizzare la traccia di audit e il flusso di eventi»), che per impostazione predefinita possiede solo il ruolo **Admin**. Per dare accesso in lettura a un responsabile della sicurezza o della conformità senza renderlo amministratore, create un ruolo con `admin.events` in [Utenti e ruoli](users.md#ruoli) e assegnateglielo.

## Modifiche

La sotto-scheda **Modifiche** è il registro dei batch di modifiche. Ogni scrittura che modifica i dati vi arriva come batch, insieme a chi l'ha eseguita e da dove proviene:

| Origine | Significato |
|---------|-------------|
| **Web** | L'interfaccia web di Turbo EA |
| **API** | Una chiamata diretta all'API REST (uno script, un'integrazione) |
| **Strumento IA** | Un assistente IA collegato tramite il [server MCP](mcp.md) |
| **Estensione** | Un'[estensione](extensions.md) installata, registrata come batch `ext:<key>` |

Fate clic su un batch per aprirne il pannello: le differenze per evento mostrano il valore precedente e quello nuovo di ogni campo, e **Rollback** annulla le scritture su schede, relazioni, rischi, ruoli di stakeholder, tag e bozze di decisione che ha effettuato.

I batch vengono conservati per **`MUTATION_BATCH_RETENTION_DAYS`** giorni (una variabile d'ambiente, predefinita **15**) e poi eliminati automaticamente. Gli eventi stessi restano nella scheda **Cronologia** di ogni scheda anche dopo che il batch è stato eliminato.

## Sicurezza e amministrazione

![Registro di sicurezza e amministrazione](../assets/img/it/62_admin_registro_audit_sicurezza.png)

La sotto-scheda **Sicurezza e amministrazione** elenca una voce per ogni azione rilevante per la sicurezza, le più recenti per prime:

- accessi e disconnessioni, con password, SSO o tramite un reverse proxy attendibile;
- tentativi di accesso falliti, ciascuno con un **codice di motivo** che indica perché è fallito;
- blocchi dell'account dopo errori ripetuti;
- registrazioni, e password impostate, reimpostate o cambiate;
- assunzione di ruolo — un amministratore che avvia e interrompe **Visualizza come ruolo…**;
- le esportazioni di questo stesso registro.

!!! note "Nella prossima versione"
    Le **azioni amministrative** — modifiche a utenti, ruoli, impostazioni, metamodello, estensioni, importazioni e integrazioni — e le **esportazioni di dati** (esportazioni CSV/JSON dell'inventario, esportazioni del workspace e di migrazione) saranno registrate in questo stesso registro nella prossima versione.

### Colonne

| Colonna | Descrizione |
|---------|-------------|
| **Quando** | Data e ora dell'azione |
| **Categoria** | `auth` (autenticazione), `admin` (azioni amministrative) o `access` (esportazioni e altri accessi ai dati) |
| **Azione** | Che cosa è successo, ad esempio `auth.login.failed` — vedere il [catalogo delle azioni](#action-catalogue) |
| **Esito** | **Riuscito** o **Non riuscito** |
| **Attore** | L'utente connesso che ha eseguito l'azione. Vuoto quando nessuno era connesso — ad esempio in un accesso fallito |
| **Soggetto** | L'account a cui si riferiva l'azione — l'indirizzo email digitato in un accesso fallito, o l'utente la cui password è stata reimpostata |
| **Destinazione** | L'oggetto su cui si è agito, se presente — ad esempio il ruolo scelto all'avvio di un'assunzione di ruolo |
| **IP** | L'indirizzo IP del client (vedere [Indirizzo IP del client](#client-ip-address)) |
| **Origine** | Da dove proveniva la richiesta: web, API, strumento IA, estensione, ops o sistema |
| **Ruolo assunto** | Quando un amministratore stava visualizzando l'app come un altro ruolo, quel ruolo. L'attore resta l'amministratore reale |

Le colonne si possono mostrare, nascondere, riordinare e bloccare come in qualsiasi altra tabella di dati; **Quando** e **Azione** sono sempre visibili.

### Filtri

La barra dei filtri a sinistra restringe l'elenco per **categoria**, **esito**, **azione**, **attore**, **indirizzo IP** e **intervallo di date**. Ogni intestazione di sezione indica quanti valori sono selezionati, e la barra compressa mostra il numero di filtri attivi. La scheda **Colonne** della stessa barra mostra, nasconde e blocca le colonne. I filtri e la disposizione delle colonne vengono ricordati in questo browser.

Una ricerca per indirizzo email trova corrispondenze nell'attore, nel soggetto e nella destinazione, così un solo indirizzo trova sia ciò che quella persona ha fatto sia ciò che è stato tentato contro il suo account.

### Dettagli di una voce

Fate clic su una riga per aprire il pannello della voce. Mostra ogni campo, compreso lo user agent del browser e i **dettagli** registrati con la voce — il codice di motivo di un accesso fallito, l'ora in cui termina un blocco, il provider di identità di un accesso SSO. Quando una voce registra una modifica, i dettagli appaiono come tabella dei valori precedenti e nuovi. I segreti non vengono mai memorizzati: una password, un token o un client secret viene sostituito con `***` prima che la voce venga scritta.

Il pannello non offre azioni. Le voci non si possono modificare né eliminare.

### Esporta CSV

**Esporta CSV**, nella barra degli strumenti, scarica le voci che corrispondono ai filtri attuali come file CSV, fino a 50 000 righe. L'esportazione stessa viene registrata, come `access.audit_log.exported`, così un'esportazione del registro di sicurezza lascia sempre una traccia al suo interno.

## Catalogo delle azioni { #action-catalogue }

| Azione | Registrata quando |
|--------|-------------------|
| `auth.login.succeeded` | un utente accede con email e password |
| `auth.login.failed` | un accesso con password viene rifiutato. Il **codice di motivo** indica perché (vedere sotto) |
| `auth.login.locked` | il quinto tentativo fallito consecutivo blocca l'account per 15 minuti. I dettagli riportano l'ora in cui termina il blocco |
| `auth.logout` | un utente connesso si disconnette. Una disconnessione senza una sessione valida non registra nulla |
| `auth.sso.succeeded` | un utente accede tramite un provider SSO. I dettagli riportano il provider, il subject del provider di identità e se l'account è stato creato da questo accesso |
| `auth.sso.failed` | un accesso SSO viene rifiutato — un dominio non consentito, un indirizzo email mancante, un account locale con la stessa email, un account inattivo. I dettagli riportano il provider e il motivo |
| `auth.proxy_session.succeeded` | un utente accede tramite un [reverse proxy](sso.md#autenticazione-tramite-reverse-proxy) attendibile |
| `auth.proxy_session.failed` | un accesso tramite il reverse proxy viene rifiutato |
| `auth.register` | un utente crea un account tramite l'auto-registrazione |
| `auth.password.set` | un utente invitato imposta la sua prima password |
| `auth.password.reset_requested` | qualcuno richiede un'email di reimpostazione della password. Registrata sempre come riuscita e solo con l'indirizzo digitato, così il registro non rivela mai se quell'account esiste |
| `auth.password.reset` | una password viene cambiata tramite un link di reimpostazione |
| `auth.password.changed` | un utente connesso cambia la propria password |
| `auth.impersonation.started` | un amministratore avvia **Visualizza come ruolo…**. La destinazione è il ruolo scelto |
| `auth.impersonation.stopped` | l'amministratore torna al proprio ruolo |
| `access.audit_log.exported` | qualcuno esporta il registro di sicurezza in CSV |

**Codici di motivo** di `auth.login.failed`:

| Motivo | Significato |
|--------|-------------|
| `unknown_user` | Nessun account ha quell'indirizzo email |
| `sso_account` | L'account accede tramite SSO e non ha password |
| `no_password` | L'account non ha ancora una password — un invito mai accettato |
| `locked` | L'account è bloccato dopo errori ripetuti |
| `bad_password` | La password è errata |
| `inactive` | L'account è disattivato |

**Codici di motivo** di `auth.sso.failed`, `auth.proxy_session.failed`, `auth.password.set` e `auth.password.reset`:

| Motivo | Significato |
|--------|-------------|
| `expired` | L'accesso a tempo limitato dell'account è terminato |
| `hd_mismatch` | L'account Google appartiene a un dominio non consentito |
| `no_email` | Il provider di identità non ha restituito alcun indirizzo e-mail |
| `no_subject` | Il provider di identità non ha restituito alcun identificativo del soggetto |
| `local_account` | Un account locale con password usa già quell'e-mail |
| `no_account` | Non esiste alcun account e gli account non vengono creati automaticamente |
| `exchange_failed` | Il provider di identità non ha completato l'accesso |
| `unauthenticated` | Il proxy inverso non ha autenticato la richiesta |
| `identity_rejected` | L'identità inoltrata è stata rifiutata (dominio o e-mail non verificata) |
| `invalid_token` | Il collegamento di invito o di reimpostazione non era valido o è scaduto |

Una raffica di errori `unknown_user` da un unico indirizzo IP è l'aspetto di un attacco di *password spraying*; una serie di `bad_password` contro un account seguita da `auth.login.locked` è un tentativo di indovinare la password di quell'account.

## Che cosa non viene registrato

- **Il rinnovo del token.** L'app web rinnova la sessione a intervalli regolari, quindi ogni scheda aperta aggiungerebbe voci e nessuna avrebbe significato.
- **Le richieste rifiutate per un token di sessione scaduto o non valido.** Si verificano ogni volta che una sessione termina normalmente.
- **Le letture dei feed OData.** Excel e Power BI interrogano il feed OData di una vista salvata secondo una pianificazione, quindi ogni aggiornamento aggiungerebbe una voce.
- **Il semplice accesso in lettura** — aprire una scheda, eseguire un report, cercare nell'inventario.

## Conservazione { #retention }

Le voci vengono conservate per **365 giorni** per impostazione predefinita. Modificate il valore in **Admin → Impostazioni → Generale → Gestione dei dati → Conservazione del registro di sicurezza**: qualsiasi numero di giorni fino a 3650, oppure **0** per conservare le voci per sempre. Un processo elimina ogni notte le voci più vecchie del periodo e rilegge l'impostazione a ogni esecuzione, quindi una modifica ha effetto senza riavvio.

Quel processo di conservazione è l'unica cosa che elimini mai una voce. Non esiste alcuna azione di modifica o eliminazione nell'interfaccia o nell'API, per nessun ruolo.

Il registro **non** fa parte, di proposito, del [Trasferimento del workspace](workspace-transfer.md): è la cronologia di sicurezza di questa istanza, non contenuto del workspace, e clonare un'istanza non lo copia.

## Il flusso di audit JSON

Il backend scrive inoltre ogni voce come **una riga JSON** sul logger **`turbo_ea.audit`**, nello stesso momento in cui la memorizza. Il backend registra sullo standard output, quindi il flusso raggiunge qualunque sistema raccolga già i log dei container — `docker compose logs backend`, la raccolta dei log di Kubernetes o qualsiasi agente di invio verso un SIEM —, senza alcuna configurazione in Turbo EA:

```bash
docker compose logs -f backend | grep turbo_ea.audit
```

Ogni riga riporta gli stessi campi della voce:

| Campo | Contenuto |
|-------|-----------|
| `audit_id`, `created_at` | L'identificativo della voce e il momento in cui è stata scritta |
| `category`, `action`, `outcome` | Che cosa è successo e se è riuscito |
| `actor_user_id`, `actor_email` | Chi l'ha fatto |
| `subject_email` | L'account interessato |
| `target_type`, `target_id`, `target_label` | Su che cosa ha agito |
| `ip`, `user_agent` | Il client |
| `origin` | web, api, mcp, ext, ops o system |
| `impersonator_user_id`, `impersonated_role` | Valorizzati mentre un amministratore visualizza l'app come un altro ruolo |
| `details` | Codici di motivo e valori precedenti/nuovi, con i segreti già mascherati |

Inviare il flusso a un archivio centrale dei log ne conserva una copia fuori dall'istanza, lontano dalla portata di chiunque possa amministrarla — ciò di cui ha bisogno una revisione delle minacce interne. Vedere [Log e flusso di audit](operations.md#logging-and-the-audit-stream) per raccoglierlo.

## Indirizzo IP del client { #client-ip-address }

La colonna **IP** registra l'indirizzo del client, non quello del proxy davanti al backend. L'nginx di frontiera incluso imposta l'intestazione `X-Real-IP` sull'indirizzo da cui ha ricevuto la connessione, e il backend legge quell'intestazione perché l'immagine backend pubblicata imposta **`TRUST_PROXY_HEADERS=true`**. Un valore che non è un indirizzo IP valido viene scartato anziché registrato.

- **Lasciate `TRUST_PROXY_HEADERS` attivo** finché ogni richiesta raggiunge il backend attraverso l'nginx incluso — lo stack predefinito, il [chart Helm](kubernetes.md) e i [modelli per container gestiti](managed-containers.md) funzionano tutti così.
- **Disattivatelo** (`TRUST_PROXY_HEADERS=false`) se esponete direttamente il container del backend, senza l'nginx incluso davanti: un client potrebbe allora inviare il proprio `X-Real-IP` e scegliere l'indirizzo registrato.
- **Dietro un altro bilanciatore di carico**, l'nginx incluso vede l'indirizzo di quel bilanciatore, e ogni voce registra quello. Un'impostazione che permetta a nginx di fidarsi dell'indirizzo del client inoltrato dal vostro bilanciatore di carico (`NGINX_TRUSTED_PROXIES`) è prevista in una versione successiva.
