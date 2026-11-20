# Politica di compatibilità

A partire dalla versione `1.0.0`, Turbo EA si impegna a garantire la compatibilità con le versioni precedenti documentata all’interno di ogni linea di versione principale. Questa pagina costituisce il contratto: descrive cosa rimane stabile, cosa può cambiare e come funzionano le deprecazioni, affinché gli operatori possano pianificare gli aggiornamenti senza sorprese.

La politica si applica a `1.x`. Una futura linea `2.x` potrà modificarla; in tal caso, con le note di rilascio della `2.0.0` verrà pubblicata una guida alla migrazione.

---

## Cosa è coperto

### Schema del database (migrazioni Alembic)

All’interno di `1.x`:

- Le migrazioni sono **additive** oppure **compatibili con le versioni precedenti durante l’aggiornamento**.
- È possibile aggiungere nuove colonne in qualsiasi momento.
- Le colonne esistenti non vengono eliminate senza un ciclo di deprecazione.
- Le colonne esistenti non vengono rinominate senza un ciclo di deprecazione (la ridenominazione segue: add-new-column → backfill → deprecate-old-column → drop-in-next-major).
- Le modifiche ai tipi si limitano all’ampliamento (ad es. `varchar(80)` → `varchar(255)`); le riduzioni passano per la deprecazione.
- I vincoli delle chiavi esterne non diventano più restrittivi senza un ciclo di deprecazione (ad es. `ON DELETE SET NULL` non diventa `ON DELETE CASCADE`).

Gli operatori possono aggiornare con fiducia; la migrazione automatica all’avvio del backend è sicura sui dati di produzione.

### Metamodello integrato

All’interno di `1.x`, il metamodello distribuito in `backend/app/services/seed.py` è stabile:

- Le chiavi dei tipi di card integrati (`Application`, `Initiative`, `BusinessCapability` ecc.) non vengono rinominate né rimosse.
- Le chiavi dei campi integrati di questi tipi non vengono rimosse senza un ciclo di deprecazione.
- Le chiavi dei tipi di relazione integrati non vengono rinominate né rimosse senza un ciclo di deprecazione.
- I sottotipi predefiniti distribuiti con i tipi integrati sono stabili.

Le personalizzazioni proprie degli operatori (tipi di card personalizzati, campi aggiunti tramite l’interfaccia di amministrazione, tipi di relazione personalizzati) sono di loro competenza e non sono coperte da questa politica.

### API REST (`/api/v1/`)

All’interno di `1.x`:

- Gli endpoint in `/api/v1/` non vengono rimossi senza un ciclo di deprecazione.
- I nomi dei campi esistenti nelle richieste e nelle risposte non vengono rinominati senza un ciclo di deprecazione.
- I tipi dei campi non cambiano in modo incompatibile (ad es. da stringa ad array).
- I nuovi campi facoltativi delle richieste e i nuovi campi delle risposte non sono incompatibili e possono essere introdotti in qualsiasi versione minore.
- I nuovi endpoint non sono incompatibili e possono essere introdotti in qualsiasi versione minore.
- La semantica di autenticazione (JWT `Bearer`, struttura del payload di `/auth/login`) è stabile.
- La semantica dei codici di stato HTTP è stabile per i percorsi documentati di successo ed errore.

Il comportamento oltre la superficie documentata (intestazioni non documentate, testo interno dei messaggi di errore, ordinamento quando non è specificato `sort_by`) non è coperto.

### Chiavi dei permessi

Le chiavi dei permessi definite in `backend/app/core/permissions.py` sono stabili all’interno di `1.x`. È possibile aggiungere nuove chiavi; quelle esistenti non vengono rinominate né rimosse senza un ciclo di deprecazione.

L’insieme dei permessi concessi **per impostazione predefinita** ai ruoli inizializzati (`admin`, `bpm_admin`, `member`, `viewer`) può cambiare tra versioni minori, con una nota nel CHANGELOG. Gli operatori che hanno personalizzato i permessi dei ruoli nella propria installazione non ne sono interessati.

### Configurazione (variabili d’ambiente)

Le variabili d’ambiente esistenti documentate in `CLAUDE.md` e `README.md` sono stabili all’interno di `1.x`. Si possono aggiungere nuove variabili con valori predefiniti ragionevoli. I valori predefiniti possono cambiare con una nota nel CHANGELOG quando la modifica è rilevante per gli operatori (ad es. una nuova porta predefinita).

### Segreti cifrati a riposo

Il marcatore di prefisso `enc:` e la chiave derivata da Fernet in `backend/app/core/encryption.py` sono stabili all’interno di `1.x`. Gli operatori non devono cifrare nuovamente i segreti tra aggiornamenti minori.

---

## Ciclo di deprecazione

Quando è necessario rimuovere un elemento coperto da questa politica:

1. **Contrassegnarlo come deprecato nella versione minore N.** La voce del CHANGELOG include una sezione `Deprecated` che segnala la modifica. Per gli endpoint API, la route deprecata invia l’intestazione di risposta `Deprecation: true` (RFC 8594) e un’intestazione `Sunset` che indica la prima data prevista per la rimozione.
2. **Continuare a supportarlo nella versione minore N+1.** La rimozione non può avvenire nella stessa versione minore della deprecazione. La forma deprecata continua a funzionare.
3. **Rimozione non prima della versione minore `N+2` o della `2.0`** (a seconda di quale arrivi prima). La rimozione viene accompagnata da una sezione `Removed` nel CHANGELOG e da una nota di migrazione.

Per le modifiche alla forma dei dati (migrazioni Alembic) si applica la stessa cadenza `N` → `N+1`, espressa come add-new → backfill → drop-old.

---

## Cosa non è coperto

Questi elementi sono esplicitamente fuori ambito e possono cambiare in qualsiasi momento:

- La **struttura interna dei moduli Python** sotto `backend/app/`. Le importazioni di `app.models`, `app.services` ecc. non fanno parte dell’API pubblica. Plugin o script che dipendono da importazioni interne dovrebbero fissare una versione specifica di Turbo EA.
- La **struttura dei blocchi JSONB** archiviati nelle tabelle integrate (`fields_schema`, `section_config`, `attributes`, `lifecycle`), oltre a quanto viene letto dall’API REST documentata. La struttura JSON su disco può evolvere per supportare nuove funzionalità.
- Gli **elementi interni del frontend**: percorsi dei file dei componenti, firme delle prop dei componenti in `frontend/src/`, contenuto di `frontend/src/types/index.ts` e stile dei componenti MUI. Gli operatori che utilizzano il frontend incluso sono isolati da queste modifiche; chi incorpora componenti dall’albero sorgente se ne assume la responsabilità.
- Le **personalizzazioni del metamodello introdotte dall’operatore**. Se si aggiunge un tipo di card o un campo personalizzato tramite l’interfaccia di amministrazione, la gestione della migrazione quando lo si modifica è responsabilità dell’operatore.
- I **dati dimostrativi e di inizializzazione** (`SEED_DEMO=true`). Il set di dati dimostrativi può evolvere liberamente tra le versioni.
- I **servizi di terze parti inclusi**: versione di DrawIO, immagine Ollama inclusa, versione di swagger-ui-dist integrato. Possono essere aggiornati in qualsiasi momento.
- Il **comportamento con configurazioni non predefinite** esplicitamente indicate come sperimentali nelle voci del CHANGELOG.

---

## Cosa cambia davvero con «1.0.0»

Rispetto alla serie `0.x`, la `1.0.0` non è di per sé una versione con nuove funzionalità: è il momento in cui iniziano ad applicarsi gli impegni sopra descritti. Il codice distribuito nella `1.0.0` è lo stesso della `0.71.0`, con in più il rafforzamento della catena di fornitura e le modifiche al flusso di contribuzione documentate nella [voce del CHANGELOG della `1.0.0`](https://github.com/vincentmakes/turbo-ea/blob/main/CHANGELOG.md#100---2026-05-05).

Le versioni precedenti alla `1.0` non erano coperte da questa politica. Le migrazioni tra versioni `0.x` potevano includere, e di fatto includevano, eliminazioni e rinominazioni dello schema e modifiche incompatibili del metamodello. Dalla `1.0.0` in poi, tali modifiche seguono il ciclo di deprecazione.
