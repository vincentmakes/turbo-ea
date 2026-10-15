# Registro di audit

Il **Registro di audit**, in **Admin → Impostazioni → Registro di audit** (`/admin/settings?tab=audit-log`), risponde alle due domande che una revisione di sicurezza pone a un'istanza che contiene la mappa dell'intero panorama IT: *che cosa vi è cambiato* e *chi ha effettuato l'accesso, e come*. È suddiviso in due sotto-schede:

| Sotto-scheda | URL | Che cosa registra |
|--------------|-----|-------------------|
| **Modifiche** | `/admin/settings?tab=audit-log` | Ogni scrittura nel panorama — schede, relazioni, rischi, tag, ruoli di stakeholder, bozze di decisione —, raggruppata in batch di modifiche, con le differenze per evento e un **Rollback** |
| **Sicurezza e amministrazione** | `/admin/settings?tab=audit-log&view=security` | Accessi e disconnessioni, tentativi falliti, blocchi, sessioni SSO e proxy, eventi relativi alle password, impersonificazione di ruolo e ogni azione amministrativa |

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
- le azioni amministrative — modifiche a utenti, ruoli, impostazioni, metamodello, tag, calcoli, estensioni, importazioni, integrazioni, portali pubblici e diagrammi pubblicati, sondaggi e accesso dell'operatore (vedi [Azioni amministrative](#administrative-actions));
- le esportazioni di dati — le esportazioni CSV e JSON delle card, le esportazioni del workspace e quelle per un'altra piattaforma EA (vedi [Esportazioni di dati](#data-exports)) — e le esportazioni di questo stesso registro.

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

### Leggere una voce

Fate clic su una riga per aprire il pannello della voce. Mostra ogni campo della voce — quando, chi, da quale indirizzo IP e con quale browser — e, sotto **Dettagli**, ciò che la voce ha registrato, scritto in linguaggio semplice anziché come chiavi interne:

- **Modifiche** — una frase per modifica. La modifica di un tipo di scheda si legge, ad esempio, *Campo «Criticità aziendale» (Selezione singola) aggiunto alla sezione «Governance»* oppure *Opzione «Alta» del campo «Criticità aziendale» rinominata in «Critica»*. Campi, sezioni, opzioni, ruoli e portali sono indicati con la loro etichetta, i permessi con la loro descrizione e le lingue con il loro nome.
- **Prima / Dopo** — una tabella dei valori modificati, una riga per campo, ogni campo indicato con la sua etichetta. I valori sono formattati: Sì o No, date nel formato data dell'area di lavoro, colori come campione, dimensioni dei file in KB o MB. I segreti non vengono mai memorizzati: una password, un token o un segreto client viene sostituito prima della scrittura della voce e viene mostrato come **Valore segreto**.
- **Contesto** — informazioni che inquadrano una modifica senza farne parte: l'indirizzo attuale di un portale e se è pubblicato, se le credenziali di una connessione sono state sostituite, quante righe ha interessato un'importazione.

Un accesso non riuscito mostra il suo **Motivo** sopra i dettagli — una password errata, un account sconosciuto, un account temporaneamente bloccato.

Le voci scritte prima della versione 2.161.0 mostrano i dettagli così come sono stati registrati: i valori precedenti e nuovi compaiono ancora nella tabella, e ciò che il pannello non sa leggere viene mostrato come JSON grezzo.

Il pannello non offre azioni. Le voci non possono essere modificate né eliminate.

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
| `auth.password.reset_requested` | Qualcuno richiede un'e-mail di reimpostazione della password. Registrato sempre come successo con l'indirizzo digitato, così la risposta non rivela nulla; i dettagli indicano se un account corrispondeva e se è stata inviata un'e-mail |
| `auth.password.reset` | una password viene cambiata tramite un link di reimpostazione |
| `auth.password.changed` | un utente connesso cambia la propria password |
| `auth.impersonation.started` | un amministratore avvia **Visualizza come ruolo…**. La destinazione è il ruolo scelto |
| `auth.impersonation.stopped` | l'amministratore torna al proprio ruolo |

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

### Azioni amministrative { #administrative-actions }

Ogni modifica che un amministratore apporta alla configurazione dell'istanza viene registrata nella categoria `admin`. L'**attore** è l'amministratore, il **destinatario** è l'oggetto modificato — un utente, un ruolo, un'impostazione, un tipo di scheda — con il nome che aveva in quel momento, e i **dettagli** indicano cosa è cambiato come valori vecchi e nuovi, limitati ai campi effettivamente modificati. Per ogni voce valgono due regole:

- **I segreti sono mascherati.** Una password SMTP, un client secret SSO, una chiave del fornitore di IA, una credenziale ServiceNow o qualsiasi altro valore segreto viene scritto come `***`: la voce mostra che è cambiato, mai cosa era o cosa è diventato.
- **Non vengono mai memorizzati il testo di una licenza né una credenziale.** Una licenza di estensione viene identificata, non copiata, e una password che un amministratore imposta per un utente viene registrata come modificata, mai con il suo valore.

Un salvataggio che non cambia nulla non viene registrato, né lo è un utente che modifica il proprio nome o la propria lingua nel profilo. La configurazione voluminosa — i campi, le traduzioni o il layout di un tipo di scheda, i filtri di un portale — viene riassunta dalla sua dimensione anziché copiata; quando la dimensione non è cambiata, si aggiunge una breve impronta del contenuto, così la voce mostra comunque che qualcosa è cambiato. Le sostituzioni dei permessi per ruolo di un tipo di scheda fanno eccezione: ogni cella modificata è elencata con il valore vecchio e quello nuovo, dove un valore vuoto indica che vale il permesso del ruolo stesso.

| Area | Azioni | Cosa viene registrato |
|------|---------|------------------|
| **Utenti e ruoli** | `admin.user.created`, `.updated`, `.deleted`, `.bulk_updated`, `.bulk_deleted`, `.unlocked`; `admin.user.invitation.resent`, `.deleted`; `admin.role.created`, `.updated`, `.archived`, `.restored`; `admin.stakeholder_role.created`, `.updated`, `.deleted`, `.archived`, `.restored` | Account creati, modificati, attivati o disattivati, eliminati (singolarmente o in blocco) e sbloccati, con i campi modificati — ruolo, e-mail, nome, stato attivo; inviti inviati di nuovo o revocati; ruoli applicativi e ruoli stakeholder per tipo, con i permessi concessi o revocati |
| **Impostazioni** | `admin.settings.updated` | Una voce per ogni impostazione salvata — e-mail, autenticazione e SSO, registrazione, IA, MCP, lingue, attivazione dei moduli, branding, logo e favicon, periodi di conservazione. Il destinatario è l'impostazione; i dettagli sono il suo valore vecchio e nuovo, con i segreti mascherati |
| **Metamodello** | `admin.metamodel.type.*` (including `.references_generated`), `admin.metamodel.relation_type.*`, `admin.metamodel.resource_type.*`, `admin.principle.*` (including `.imported`), `admin.regulation.*` | Tipi di scheda, tipi di relazione e tipi di risorsa creati, modificati, eliminati o ripristinati, con le proprietà modificate; riferimenti delle schede generati per un tipo; principi EA, compresi quelli importati dal catalogo; normative di conformità |
| **Tag e calcoli** | `admin.tag_group.*`, `admin.tag.*`, `admin.calculation.*` | Gruppi di tag e tag; campi calcolati creati, modificati, eliminati, attivati o disattivati, con la formula vecchia e quella nuova, e l'esecuzione di un calcolo su tutte le schede (`.recalculated`) |
| **Estensioni** | `admin.extension.install.uploaded`, `.applied`, `.discarded`; `admin.extension.store.claimed`, `.refreshed`, `.installed`; `admin.extension.enabled`, `.disabled`, `.uninstalled`; `admin.extension.license.updated`, `.removed` | Pacchetti caricati, installati o scartati; licenze e download dallo store delle estensioni; estensioni abilitate, disabilitate e disinstallate; la licenza sostituita o rimossa — con l'estensione e la sua versione, mai il testo della licenza |
| **Trasferimento workspace e migrazione** | `admin.workspace.import.uploaded`, `.applied`, `.completed`, `.discarded`; `admin.migration.uploaded`, `.field_mappings.updated`, `.applied`, `.deleted` | Un [pacchetto workspace](workspace-transfer.md) caricato, la sua importazione avviata, completata o scartata; una [migrazione di piattaforma](migration.md) caricata, le sue mappature dei campi modificate, applicata o eliminata |
| **Integrazioni** | `admin.servicenow.connection.*`, `admin.servicenow.mapping.*`, `admin.servicenow.sync.pulled`, `.pushed`, `.applied` | Connessioni ServiceNow, con le credenziali mascherate, e mappature; ogni pull, push e applicazione dei record in staging |
| **Esposizione pubblica** | `admin.web_portal.created`, `.updated`, `.deleted`; `admin.diagram.published`, `.unpublished` | [Portali web](web-portals.md) e diagrammi pubblicati — tutto ciò che rende i dati raggiungibili senza un account |
| **Sondaggi** | `admin.survey.sent`, `admin.survey.closed` | Un sondaggio inviato ai destinatari, o chiuso |
| **Accesso dell'operatore** | `admin.ops.rescue_access.granted`, `.revoked` | Accesso di emergenza concesso o revocato tramite l'[API operativa](ops-api.md), registrato accanto agli eventi `ops.*` esistenti |

### Esportazioni di dati { #data-exports }

Ogni volta che i dati lasciano l'istanza in blocco, una voce `access` registra chi li ha presi, quanti e in quale forma. La voce viene scritta prima dell'invio del file, quindi anche un'esportazione il cui download non è mai terminato resta registrata.

| Azione | Registrata quando | Dettagli |
|--------|-------------------|----------|
| `access.export.cards` | Le card vengono esportate tramite l'esportazione CSV o JSON dell'API (`/cards/export/csv`, `/cards/export/json`), come fanno script, integrazioni e assistenti IA | `format` (`csv` o `json`), `type` (il tipo o i tipi di card) e `rows` (il numero di card). La destinazione è il tipo di card quando l'esportazione ne copriva esattamente uno |
| `access.export.workspace` | Viene scaricato un [pacchetto del workspace](workspace-transfer.md) completo — da **Trasferimento workspace**, oppure da un piano di controllo tramite l'[API operativa](ops-api.md), che non registra alcun attore e registra `requested_by: ops` | `include_archived` e `size_bytes` |
| `access.export.migration` | Il workspace viene esportato per un'altra piattaforma EA in **Admin → Impostazioni → Migrazione** (vedi [Migrazione della piattaforma](migration.md)) | La piattaforma di destinazione, `include_archived` e `size_bytes` |
| `access.audit_log.exported` | Qualcuno esporta il registro di sicurezza in CSV | `rows` |

## Che cosa non viene registrato

- **Il rinnovo del token.** L'app web rinnova la sessione a intervalli regolari, quindi ogni scheda aperta aggiungerebbe voci e nessuna avrebbe significato.
- **Le richieste rifiutate per un token di sessione scaduto o non valido.** Si verificano ogni volta che una sessione termina normalmente.
- **Le letture dei feed OData.** Excel e Power BI interrogano il feed OData di una vista salvata secondo una pianificazione, quindi ogni aggiornamento aggiungerebbe una voce.
- **Fogli di calcolo e presentazioni generati nel browser.** I download Excel e PowerPoint dell'inventario e dei report sono costruiti con dati che la pagina ha già caricato, quindi sono letture, non esportazioni dal server.
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

La riga viene scritta nel momento in cui la voce è registrata. Se la transazione della richiesta fallisce in seguito, la riga esiste senza record: la tabella è il registro, il flusso è il feed in tempo reale.

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
| `details` | Fino a quattro chiavi, con i segreti già mascherati: `reason` (un codice di errore), `changes` (`{field: {old, new}}`), `items` (modifiche semantiche, `{kind, …}` — ad es. `field.added`) e `context` (informazioni semplici) |

Inviare il flusso a un archivio centrale dei log ne conserva una copia fuori dall'istanza, lontano dalla portata di chiunque possa amministrarla — ciò di cui ha bisogno una revisione delle minacce interne. Vedere [Log e flusso di audit](operations.md#logging-and-the-audit-stream) per raccoglierlo.

## Indirizzo IP del client { #client-ip-address }

La colonna **IP** registra l'indirizzo del client, non quello del proxy davanti al backend. L'nginx di frontiera incluso imposta l'intestazione `X-Real-IP` sull'indirizzo da cui ha ricevuto la connessione, e il backend legge quell'intestazione perché l'immagine backend pubblicata imposta **`TRUST_PROXY_HEADERS=true`**. Un valore che non è un indirizzo IP valido viene scartato anziché registrato.

- **Lasciate `TRUST_PROXY_HEADERS` attivo** finché ogni richiesta raggiunge il backend attraverso l'nginx incluso — lo stack predefinito, il [chart Helm](kubernetes.md) e i [modelli per container gestiti](managed-containers.md) funzionano tutti così.
- **Disattivatelo** (`TRUST_PROXY_HEADERS=false`) se esponete direttamente il container del backend, senza l'nginx incluso davanti: un client potrebbe allora inviare il proprio `X-Real-IP` e scegliere l'indirizzo registrato.
- **Dietro un bilanciatore di carico, un ingress controller o una CDN**, il nginx incluso riceve ogni connessione da quell'intermediario e, da solo, registra quindi l'indirizzo del bilanciatore per ogni utente. Impostate **`NGINX_TRUSTED_PROXIES`** sul container nginx, come descritto sotto.

### Dietro un bilanciatore di carico { #behind-a-load-balancer }

`NGINX_TRUSTED_PROXIES` elenca gli indirizzi degli intermediari davanti al nginx incluso, come indirizzi IP o intervalli CIDR separati da virgole o spazi. nginx legge allora l'indirizzo del client dall'intestazione `X-Forwarded-For` che quegli intermediari aggiungono — ma solo su una connessione proveniente da uno degli indirizzi elencati — e salta ogni indirizzo elencato in quell'intestazione, così una catena di proxy si risolve nel primo indirizzo che non è uno dei vostri. Quell'indirizzo sostituisce quello della connessione, e l'intestazione `X-Real-IP` letta dal backend lo trasporta invariato. Vuoto, il valore predefinito, non si fida di nessuno.

Per trovare il valore, leggete il log di accesso del nginx perimetrale (`docker compose logs nginx`, `kubectl logs deployment/turbo-ea-nginx` o il visualizzatore di log della piattaforma): l'indirizzo all'inizio di ogni riga è l'intermediario di cui fidarsi, e l'ultimo campo tra virgolette è l'intestazione `X-Forwarded-For` che ha inviato.

| Distribuzione | Dove impostarlo | Valore tipico |
|---------------|-----------------|---------------|
| Docker Compose, i browser raggiungono nginx direttamente | — | Lasciare vuoto |
| Docker Compose dietro un vostro reverse proxy | `NGINX_TRUSTED_PROXIES` in `.env` | L'indirizzo del reverse proxy, come lo vede nginx |
| [Kubernetes](kubernetes.md) dietro un ingress controller | Valore del chart `nginx.trustedProxies` | Il CIDR dei pod del cluster, ad esempio `10.244.0.0/16` |
| [AWS ECS Fargate](managed-containers.md#aws-ecs-fargate) | `NginxTrustedProxies` / Terraform `nginx_trusted_proxies` | Gli intervalli CIDR delle subnet del bilanciatore di carico |
| [Azure Container Apps](managed-containers.md#azure-container-apps) | `nginxTrustedProxies` / Terraform `nginx_trusted_proxies` | La subnet di infrastruttura dell'ambiente |
| [Google Cloud Run](managed-containers.md#google-cloud-run) | `NGINX_TRUSTED_PROXIES` nel manifesto / Terraform `nginx_trusted_proxies` | Gli indirizzi che mostra il log di accesso |

Mantenete l'elenco stretto quanto gli intermediari stessi. A ogni indirizzo elencato si crede quando indica il client, quindi un intervallo da cui si connettono i vostri utenti — tutto `10.0.0.0/8` in una distribuzione interna, per esempio — permetterebbe a ciascuno di loro di scrivere un indirizzo diverso nel registro. Senza impostazione, la colonna mostra il bilanciatore di carico: poco utile, ma mai falsificato.

Il limite di frequenza degli accessi conta i tentativi per indirizzo del client dalla stessa intestazione, quindi dietro un bilanciatore di carico questa impostazione evita anche che i tentativi falliti di una persona rallentino tutti gli altri. Vale per gli accessi che raggiungono il backend attraverso il nginx perimetrale; il server MCP accede direttamente al backend, quindi le sue chiamate di accesso condividono ancora l'indirizzo del container MCP. La chiave per client si fida di quell'intestazione come fa il registro di audit: presuppone che gli accessi raggiungano il backend solo attraverso l'nginx di bordo, cosa che il file compose fornito e il chart Helm garantiscono non esponendo il backend. Un chiamante in grado di raggiungere il backend direttamente potrebbe scegliersi la propria quota impostando da sé l'intestazione; lasciate il backend non esposto oppure disattivate `TRUST_PROXY_HEADERS`.
