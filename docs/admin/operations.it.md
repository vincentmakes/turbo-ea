# Operazioni e aggiornamenti

Questa pagina è la guida operativa per eseguire Turbo EA in produzione: come funzionano gli aggiornamenti e le migrazioni del database, come eseguire backup e rollback, quali ambienti predisporre e le insidie che colpiscono i team su larga scala.

## Immagini di produzione e blocco della versione

Le immagini pubblicate su `ghcr.io/vincentmakes/turbo-ea/*` sono il modo consigliato per eseguire la produzione: il `docker-compose.yml` standard le scarica per impostazione predefinita, e la compilazione dai sorgenti è un flusso di lavoro di sviluppo. Oltre alla comodità, le immagini pubblicate offrono garanzie sulla catena di fornitura che una build locale non ha: ogni pubblicazione è multi-architettura (amd64 + arm64), firmata con cosign (OIDC senza chiave, verificabile rispetto all'identità del workflow di GitHub Actions) e attestata con provenienza SLSA e un SBOM. Le immagini vengono bloccate alla pubblicazione in presenza di CVE critici, riesaminate quotidianamente una volta pubblicate e ricostruite ogni settimana su repository Alpine aggiornati, così le patch delle immagini di base arrivano automaticamente. Se la vostra organizzazione impone la verifica delle firme delle immagini all'ammissione, le firme cosign si integrano direttamente — vedere [Catena di fornitura](supply-chain.md) per i comandi di verifica.

L'abitudine più importante: **bloccate la versione**. Il tag `:latest` viene riassegnato a ogni rilascio e alla ricostruzione settimanale — non a ogni commit — quindi può spostarsi secondo un calendario che non controllate. Impostate un tag esplicito nel vostro `.env`:

```bash
TURBO_EA_TAG=2.23.1
```

Vedere [Bloccare una versione](../getting-started/setup.md) per le basi e [Rilasci](../reference/releases.md) per l'albero completo dei tag e la politica dei canali di prerelease.

## PostgreSQL gestito

Negli ambienti aziendali con accesso a un servizio PostgreSQL gestito — Azure Database for PostgreSQL, Amazon RDS / Aurora, Google Cloud SQL o simili — eseguire Turbo EA su quel servizio è la configurazione consigliata. Il container `db` incluso è un valore predefinito senza dipendenze, non un requisito: puntate il backend alla vostra istanza con le variabili `POSTGRES_*` e omettete il servizio incluso (vedere [Usare un PostgreSQL esistente](../getting-started/setup.md)).

Cosa vi toglie di mano il servizio gestito:

- **Backup e ripristino a un punto nel tempo (PITR)** — automatizzati, con retention gestita e ripristinabili a qualsiasi momento; esattamente ciò di cui ha bisogno la strategia di rollback qui sotto.
- **Alta disponibilità e failover** — ridondanza zonale o regionale senza gestire la propria replica.
- **Patching del motore, cifratura a riposo, isolamento di rete** — gestiti secondo la baseline di conformità della vostra organizzazione (endpoint privati, integrazione IAM).

Tre cose che **non** cambiano: il backend esegue comunque da sé le migrazioni Alembic all'avvio (il modello di aggiornamento di questa pagina resta identico), il volume `backend_data` ha comunque bisogno di un proprio backup (allegati ed estensioni non risiedono in PostgreSQL), e la custodia del `SECRET_KEY` resta vostra. L'immagine inclusa porta PostgreSQL 18 — va bene qualsiasi versione maggiore recente offerta dal vostro provider.

### Verificare il limite di connessioni

L'unica impostazione da confermare prima di passare è il limite di connessioni. Il backend viene eseguito come processo singolo e apre **fino a `DB_POOL_SIZE + DB_MAX_OVERFLOW` connessioni — 30 per impostazione predefinita**. Il container `db` incluso ne consente 100, quindi il problema non si presenta mai nell'installazione predefinita; i piani gestiti di fascia base limitano spesso il database più in basso, e PostgreSQL risponde allora `too many connections for database "turboea"`.

```sql
SELECT datname, datconnlimit FROM pg_database WHERE datname = 'turboea';
SELECT rolname, rolconnlimit FROM pg_roles    WHERE rolname = 'turboea';
SHOW max_connections;
```

`-1` significa «nessun limite specifico». Se il tetto effettivo è inferiore a 30, alzatelo oppure riducete il pool in `.env`, lasciando qualche connessione libera per i backup e per le sessioni amministrative:

```dotenv
DB_POOL_SIZE=8
DB_MAX_OVERFLOW=2
DB_POOL_TIMEOUT=30
```

Per vedere che cosa è effettivamente connesso in un dato momento:

```sql
SELECT state, count(*) FROM pg_stat_activity WHERE datname = 'turboea' GROUP BY state;
```

## Come funzionano gli aggiornamenti: le migrazioni Alembic

La compatibilità dello schema del database è gestita automaticamente tramite [Alembic](https://alembic.sqlalchemy.org/). All'avvio il backend esegue `alembic upgrade head`, quindi ogni migrazione in sospeso tra lo schema attuale e la nuova versione viene applicata — in ordine — prima che l'applicazione serva traffico.

Le migrazioni sono numerate sequenzialmente e cumulative, il che rende sicuri i salti di versione: se aggiornate, ad esempio, dalla 2.10 alla 2.23, tutte le migrazioni intermedie vengono eseguite in sequenza. Non è necessario passare per ogni versione minore.

Alcuni comportamenti da conoscere:

| Situazione | Cosa succede all'avvio |
|---|---|
| Database nuovo | Le tabelle vengono create direttamente e il database viene marcato a head — nessuna riesecuzione delle migrazioni. |
| Database esistente | Le migrazioni in sospeso vengono eseguite automaticamente prima che l'API sia disponibile. |
| `RESET_DB=true` | Tutte le tabelle vengono eliminate, ricreate e ripopolate. Da non impostare mai in produzione. |

All'interno di una stessa linea di versione maggiore le migrazioni restano additive e retrocompatibili all'aggiornamento — vedere la [Politica di compatibilità](../reference/compatibility.md) per il contratto completo.

!!! warning "Mai eseguire un backend più vecchio su uno schema più recente"
    Alembic migra solo in avanti all'avvio. Codice vecchio su uno schema più recente è comportamento indefinito — questo è il vincolo chiave del rollback (vedere sotto).

## La procedura di aggiornamento

1. **Leggete il changelog.** Esaminate le voci di `CHANGELOG.md` tra la versione attuale e quella di destinazione. Le modifiche incompatibili incrementano la versione maggiore.
2. **Eseguite il backup** del database e del volume dati (vedere sotto).
3. **Aggiornate il tag e scaricate:**

    ```bash
    TURBO_EA_TAG=2.24.0 docker compose pull
    docker compose up -d
    ```

4. **Osservate i log di avvio** e confermate che le migrazioni si completino correttamente prima che l'API serva traffico:

    ```bash
    docker compose logs -f backend
    ```

!!! note "Finestre di manutenzione"
    Le migrazioni sono di solito rapide, ma con inventari grandi alcune migrazioni di dati possono richiedere qualche minuto, durante il quale il backend non risponde. Pianificate gli aggiornamenti in una finestra di manutenzione.

### Sapere quando è disponibile un aggiornamento

Invece di sorvegliare il repository, lasciate che sia l'istanza a dirvelo: Turbo EA controlla ogni giorno se esiste una versione più recente e avvisa gli amministratori nella campanella delle notifiche, con il numero di versione e le note di rilascio. Non scarica né installa mai nulla: il passo 1 qui sopra continua a iniziare con la lettura del changelog. Il controllo è attivo per impostazione predefinita e può essere disattivato in [Amministrazione → Impostazioni → Generale](settings.md#update-notifications), il che elimina anche la richiesta in uscita sulle installazioni isolate. A aggiornamento completato, ogni utente viene avvisato nella campanella delle notifiche che l'applicazione è stata aggiornata e può leggere il changelog delle versioni attraversate. Ogni notifica continua a mostrare la release che ha annunciato — le note provengono dal changelog incluso nell'immagine — così una notifica vecchia non viene mai accompagnata dalle note dell'ultima release.

## Backup

Eseguite un backup **prima di ogni aggiornamento**, e automatizzatene comunque uno notturno:

```bash
docker compose exec db pg_dump -U turboea turboea > backup-$(date +%F).sql
```

Adattate utente e nome del database se avete modificato `POSTGRES_USER` / `POSTGRES_DB`. Uno snapshot del volume `postgres_data` è un'alternativa equivalente. Su un [servizio PostgreSQL gestito](#postgresql-gestito), preferite i backup automatizzati e il ripristino a un punto nel tempo del provider ai dump artigianali — un `pg_dump` occasionale resta comunque utile come copia portabile e indipendente dal provider.

Eseguite il backup anche del volume **`backend_data`** — contiene gli allegati, le estensioni installate e i bundle di trasferimento dello spazio di lavoro che non risiedono in PostgreSQL.

Due punti ulteriori sulla postura di ripristino:

- **Testate periodicamente i ripristini.** Un backup mai ripristinato è una speranza, non un piano.
- **Le card archiviate sono eliminate in modo reversibile** con una finestra di 30 giorni prima della cancellazione definitiva — è la vostra rete di sicurezza per gli errori sui dati, distinta dal ripristino dell'infrastruttura.

## Rollback e ripristino

Le migrazioni di schema sono di fatto **solo in avanti in produzione**: sebbene Alembic supporti tecnicamente i downgrade, le migrazioni che trasportano dati non sempre possono essere invertite senza perdite, e l'applicazione non esegue mai downgrade automaticamente. La strategia di rollback affidabile è:

1. Fermate lo stack.
2. Ripristinate il backup del database eseguito prima dell'aggiornamento (su PostgreSQL gestito: ripristino a un punto nel tempo immediatamente precedente all'aggiornamento).
3. Riportate `TURBO_EA_TAG` alla versione precedente.
4. `docker compose up -d` — il database ripristinato corrisponde allo schema del vecchio codice, quindi tutto è coerente.

!!! warning "Mai fare rollback della sola immagine"
    Riportare indietro l'immagine mantenendo il database migrato è l'unica combinazione da cui il sistema di migrazione automatica non può proteggervi. Backup del database e tag dell'immagine si muovono insieme.

## Ripristinare l'accesso di amministratore { #recovering-administrator-access }

Turbo EA rifiuta le due modifiche che più spesso escludono un amministratore: non puoi cambiare il tuo ruolo in uno diverso da Amministratore, né disattivare il tuo account (vedi [Utenti e ruoli](users.md)). Resta il caso ordinario: una password dimenticata, o un'istanza il cui unico amministratore ha lasciato l'azienda. Segui questo elenco nell'ordine; solo l'ultimo passo tocca il database.

1. **Chiedi a un altro amministratore.** **Admin → Utenti → icona di modifica → Password** imposta una nuova password su qualsiasi account locale. È la via normale e non richiede accesso al server.
2. **Usa la reimpostazione self-service.** Il link **Password dimenticata** nella pagina di accesso invia per e-mail un link di reimpostazione. Funziona solo per gli account locali e soltanto se [SMTP è configurato](settings.md): un'istanza senza server di posta non ha alcuna reimpostazione self-service. Gli account SSO non hanno una password da reimpostare; correggili presso il provider di identità.
3. **Reimpostala nel database.** Solo quando nessuno riesce più ad accedere come amministratore.

### Reimpostare una password direttamente nel database

Genera l'hash con la funzione di hashing dell'applicazione stessa, così il valore memorizzato è esattamente quello che il controllo di accesso si aspetta. Non improvvisarlo con `htpasswd` o `openssl`:

```bash
docker compose exec -it backend python -c \
  "from app.core.security import hash_password; print(hash_password(input('New password: ')))"
```

Digitare la password al prompt la tiene fuori dalla cronologia della shell. Copia la riga `$2b$…` stampata, poi:

```bash
docker compose exec -T db psql -v ON_ERROR_STOP=1 -U turboea -d turboea -c \
  "UPDATE users
      SET password_hash = '<hash incollato qui>',
          auth_provider = 'local',
          is_active = true,
          password_setup_token = NULL
    WHERE lower(email) = lower('admin@example.com');"
```

Ogni clausola ha la sua ragione, perché l'accesso le verifica tutte:

| Clausola | Perché è lì |
|---|---|
| `password_hash` | La nuova credenziale. Tienila fra apici singoli: gli hash bcrypt contengono `$`, che altrimenti la shell espanderebbe. |
| `auth_provider = 'local'` | Una password non autentica mai un account contrassegnato come SSO. |
| `is_active = true` | Un account inattivo viene rifiutato *dopo* il controllo della password, il che assomiglia esattamente a una password sbagliata. |
| `password_setup_token = NULL` | Annulla un eventuale link di invito ancora in circolazione, così non potrà sovrascrivere in seguito la password appena impostata. |

Se l'account è stato anche declassato, ripristina il ruolo nella stessa istruzione aggiungendo `role = 'admin'`.

Attenditi `UPDATE 1`. `UPDATE 0` significa che nessuna riga corrispondeva: gli indirizzi e-mail sono memorizzati così come sono stati digitati, ed è il `lower()` su entrambi i lati a rendere il confronto indipendente da maiuscole e minuscole. Per individuare prima la riga giusta:

```bash
docker compose exec -T db psql -U turboea -d turboea -c \
  "SELECT email, role, is_active, auth_provider FROM users ORDER BY email;"
```

Altre due cose da sapere:

- **Adatta la connessione.** Usa i tuoi `POSTGRES_USER` / `POSTGRES_DB` se li hai modificati. Su un servizio PostgreSQL gestito non esiste il container `db`: collegati direttamente con `psql`.
- **Le altre sessioni restano attive.** Le sessioni sono JWT senza revoca lato server, quindi i token emessi prima della reimpostazione restano validi fino alla scadenza (`ACCESS_TOKEN_EXPIRE_MINUTES`, 24 ore per impostazione predefinita). Cambiare una password non disconnette nessuno.

!!! note "L'eccezione ammessa a «non modificare il database»"
    Modificare direttamente il database è per il resto un'insidia, e a ragione. Questa procedura è sicura perché aggiorna poche colonne di una singola riga `users`: non cambia alcuno schema, quindi non può entrare in conflitto con una migrazione futura, ed è l'unico stato che l'interfaccia e l'API non possono riparare per definizione — serve accesso per ripristinare l'accesso.

## Ambienti e governance dei rilasci

Per la maggior parte delle organizzazioni bastano **due ambienti** (Staging + Produzione), perché gli aggiornamenti sono immagini rilasciate dal fornitore, non build personalizzate — si valida, non si sviluppa. Una catena completa Dev/SIT/UAT/Prod aggiunge valore soprattutto se costruite estensioni personalizzate o integrazioni pesanti.

| Ambiente | Scopo | Note |
|---|---|---|
| Dev / sandbox (opzionale) | Provare modifiche al metamodello, demo | `SEED_DEMO=true` per il set di dati dimostrativo; `RESET_DB=true` riparte da zero. |
| Staging | Validare per prime le nuove versioni | Dati simili alla produzione; riceve per primo i nuovi tag. |
| Produzione | Tag bloccato, backup, aggiornamenti in finestra di manutenzione | Mai `latest`, mai `RESET_DB`. |

Due buoni modi per portare dati realistici in staging:

- **[Trasferimento dello spazio di lavoro](workspace-transfer.md)**: esportate lo spazio di lavoro di produzione come bundle `.zip` e importatelo in staging. I segreti (credenziali SMTP, SSO, IA, ServiceNow) vengono rimossi per progettazione e non lasciano mai l'istanza.
- **Ripristino del database**: ripristinate un `pg_dump` di produzione nel database di staging (su un servizio gestito funziona bene anche un clone o un ripristino a un punto nel tempo dell'istanza di produzione). I segreti cifrati nel database derivano da `SECRET_KEY`, quindi lo staging ha bisogno dello stesso `SECRET_KEY`, altrimenti dovrete reinserire lì le credenziali di integrazione.

Sul fronte della governance:

- Trattate il file `.env` e il `TURBO_EA_TAG` bloccato come configurazione-as-code — teneteli nel vostro Git interno e rendete gli aggiornamenti una modifica revisionata (una pull request che alza il tag).
- Poiché staging e produzione scaricano lo stesso tag GHCR bloccato, validate l'artefatto identico byte per byte che promuoverete.
- Aggiornate lo staging → lasciate decantare qualche giorno → promuovete lo stesso tag in produzione.

## Insidie comuni

1. **Eseguire `latest` senza blocco** — un `docker compose pull` di routine diventa un aggiornamento non pianificato con migrazioni non pianificate, secondo il calendario dei rilasci e non il vostro.
2. **Aggiornare senza backup** — le migrazioni sono solo in avanti; il backup *è* il vostro rollback.
3. **Perdere o cambiare `SECRET_KEY`** — firma i JWT *e* deriva la chiave di cifratura dei segreti memorizzati (credenziali SMTP, SSO, ServiceNow). Cambiarlo rende i segreti memorizzati indecifrabili. Trattatelo come una credenziale di database: in cassaforte, stabile, sottoposto a backup.
4. **`RESET_DB=true` dimenticato in un file di ambiente** — fa esattamente ciò che dice, a ogni avvio.
5. **Modificare il database direttamente** — lo stato dello schema appartiene ad Alembic, e il DDL manuale entrerà in conflitto con le migrazioni future. Lo stesso vale per i dati: usate l'API o l'interfaccia così che permessi, eventi di audit e ricalcolo della qualità dei dati restino corretti. L'unica eccezione ammessa è il [ripristino dell'accesso di amministratore](#recovering-administrator-access), per il caso in cui nessuno riesca più ad accedere per usare l'API o l'interfaccia.
6. **Non rendere persistenti i volumi** — `postgres_data` e `backend_data` devono sopravvivere alla ricreazione dei container; verificate che i vostri strumenti di snapshot e backup li coprano entrambi.
7. **Fare rollback dell'immagine senza ripristinare il database** — vedere [Rollback e ripristino](#rollback-e-ripristino).
8. **Puntare a un PostgreSQL gestito senza verificarne il limite di connessioni** — il backend ha bisogno di un massimo di 30 connessioni per impostazione predefinita. Un tetto più basso si manifesta come `too many connections for database "turboea"` durante l'uso normale; vedere la sezione «Verificare il limite di connessioni» qui sopra.
