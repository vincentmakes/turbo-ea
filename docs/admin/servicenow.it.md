# Integrazione ServiceNow

L'integrazione ServiceNow (**Admin > Impostazioni > ServiceNow**) abilita la sincronizzazione bidirezionale tra Turbo EA e il vostro ServiceNow CMDB. Questa guida copre tutto, dalla configurazione iniziale alle ricette avanzate e alle best practice operative.

## Perché integrare ServiceNow con Turbo EA?

ServiceNow CMDB e gli strumenti di Enterprise Architecture servono scopi diversi ma complementari:

| | ServiceNow CMDB | Turbo EA |
|--|-----------------|----------|
| **Focus** | Operazioni IT — cosa è in esecuzione, chi ne è responsabile, quali incidenti si sono verificati | Pianificazione strategica — come dovrebbe apparire il panorama tra 3 anni? |
| **Gestito da** | Operazioni IT, Asset Management | Team EA, Business Architect |
| **Punto di forza** | Discovery automatizzata, workflow ITSM, accuratezza operativa | Contesto aziendale, mappatura delle capability, pianificazione del ciclo di vita, valutazioni |
| **Dati tipici** | Hostname, IP, stato di installazione, gruppi di assegnazione, contratti | Criticità aziendale, idoneità funzionale, debito tecnico, roadmap strategica |

**Turbo EA è il sistema di riferimento** per il vostro panorama architetturale — nomi, descrizioni, piani del ciclo di vita, valutazioni e contesto aziendale risiedono tutti qui. ServiceNow integra Turbo EA con metadati operativi e tecnici (hostname, IP, dati SLA, stato di installazione) che provengono dalla discovery automatizzata e dai workflow ITSM. L'integrazione mantiene questi due sistemi connessi rispettando il fatto che Turbo EA è il sistema principale.

### Cosa potete fare

- **Pull sync** — Alimentate Turbo EA con CI da ServiceNow, poi assumetene la proprietà. I pull successivi aggiornano solo i campi operativi (IP, stato, SLA) che SNOW scopre automaticamente
- **Push sync** — Esportate i dati curati dall'EA verso ServiceNow (nomi, descrizioni, valutazioni, piani del ciclo di vita) così i team ITSM vedono il contesto EA
- **Sincronizzazione bidirezionale** — Turbo EA guida la maggior parte dei campi; SNOW guida un piccolo insieme di campi operativi/tecnici. Entrambi i sistemi restano sincronizzati
- **Mappatura delle identità** — Tracciamento persistente dei riferimenti incrociati (sys_id <-> card UUID) che assicura che i record rimangano collegati tra le sincronizzazioni

---

## Architettura dell'integrazione

```
+------------------+         HTTPS / Table API          +------------------+
|   Turbo EA       | <--------------------------------> |  ServiceNow      |
|                  |                                     |                  |
|  Cards           |  Pull: SNOW CIs -> Turbo Cards      |  CMDB CIs        |
|  (Application,   |  Push: Turbo Cards -> SNOW CIs      |  (cmdb_ci_appl,  |
|   ITComponent,   |                                     |   cmdb_ci_server, |
|   Provider, ...) |  Identity Map tracks sys_id <-> UUID |   core_company)  |
+------------------+                                     +------------------+
```

L'integrazione utilizza la Table API di ServiceNow su HTTPS. Le credenziali sono crittografate a riposo utilizzando Fernet (AES-128-CBC) derivato dal vostro `SECRET_KEY`. Tutte le operazioni di sincronizzazione vengono registrate come eventi con `source: "servicenow_sync"` per un registro di audit completo.

---

## Pianificazione dell'integrazione

Prima di configurare qualsiasi cosa, rispondete a queste domande:

### 1. Quali tipi di card necessitano dati da ServiceNow?

Iniziate in piccolo. I punti di integrazione più comuni sono:

| Priorità | Tipo Turbo EA | Sorgente ServiceNow | Perché |
|----------|---------------|----------------------|--------|
| **Alta** | Application | `cmdb_ci_business_app` | Le applicazioni sono il nucleo dell'EA — il CMDB ha nomi, proprietari e stati autorevoli |
| **Alta** | ITComponent (Software) | `cmdb_ci_spkg` | I prodotti software alimentano il tracciamento EOL e il tech radar |
| **Media** | ITComponent (Hardware) | `cmdb_ci_server` | Panorama dei server per la mappatura dell'infrastruttura |
| **Media** | Provider | `core_company` | Registro dei fornitori per la gestione dei costi e delle relazioni |
| **Bassa** | Interface | `cmdb_ci_endpoint` | Endpoint di integrazione (spesso gestiti manualmente nell'EA) |
| **Bassa** | DataObject | `cmdb_ci_database` | Istanze di database |

### 2. Quale sistema è la fonte di verità per ogni campo?

Questa è la decisione più importante. L'impostazione predefinita dovrebbe essere **Turbo EA guida** — lo strumento EA è il sistema di riferimento per il vostro panorama architetturale. ServiceNow dovrebbe guidare solo per un insieme ristretto di campi operativi e tecnici che provengono dalla discovery automatizzata o dai workflow ITSM. Tutto il resto — nomi, descrizioni, valutazioni, pianificazione del ciclo di vita, costi — è gestito e curato dal team EA in Turbo EA.

**Modello consigliato — "Turbo EA guida, SNOW integra":**

| Tipo di campo | Fonte di verità | Perché |
|---------------|-----------------|--------|
| **Nomi e descrizioni** | **Turbo guida** | Il team EA cura nomi autorevoli e scrive descrizioni strategiche; i nomi CMDB possono essere disordinati o auto-generati |
| **Criticità aziendale** | **Turbo guida** | Valutazione strategica del team EA — non sono dati operativi |
| **Idoneità funzionale/tecnica** | **Turbo guida** | I punteggi del modello TIME sono una competenza EA |
| **Ciclo di vita (tutte le fasi)** | **Turbo guida** | Plan, phaseIn, active, phaseOut, endOfLife — tutti dati di pianificazione EA |
| **Dati sui costi** | **Turbo guida** | L'EA traccia il costo totale di proprietà; il CMDB può avere voci di contratto ma l'EA possiede la vista consolidata |
| **Tipo di hosting, categoria** | **Turbo guida** | L'EA classifica le applicazioni per modello di hosting per l'analisi strategica |
| **Metadati tecnici** | SNOW guida | IP, versioni OS, hostname, numeri di serie — dati di discovery automatizzata che l'EA non mantiene |
| **SLA / stato operativo** | SNOW guida | Stato di installazione, obiettivi SLA, metriche di disponibilità — dati operativi ITSM |
| **Gruppo di assegnazione / supporto** | SNOW guida | Proprietà operativa tracciata nei workflow ServiceNow |
| **Date di discovery** | SNOW guida | Prima/ultima scoperta, ultimo scan — metadati di automazione CMDB |

### 3. Con quale frequenza dovreste sincronizzare?

| Scenario | Frequenza | Note |
|----------|-----------|------|
| Importazione iniziale | Una volta | Modalità additiva, revisionate attentamente |
| Gestione attiva del panorama | Giornaliera | Automatizzata tramite cron durante le ore non di punta |
| Reporting di conformità | Settimanale | Prima di generare i report |
| Ad hoc | Secondo necessità | Prima di revisioni EA importanti o presentazioni |

---

## Passo 1: Prerequisiti ServiceNow

### Creare un account di servizio

In ServiceNow, create un account di servizio dedicato (non usate mai account personali):

| Ruolo | Scopo | Obbligatorio? |
|-------|-------|---------------|
| `itil` | Accesso in lettura alle tabelle CMDB | Sì |
| `cmdb_read` | Lettura dei Configuration Item | Sì |
| `rest_api_explorer` | Utile per testare le query | Consigliato |
| `import_admin` | Accesso in scrittura alle tabelle target | Solo per push sync |

**Best practice**: Create un ruolo personalizzato con accesso di sola lettura solo alle tabelle specifiche che pianificate di sincronizzare. Il ruolo `itil` è ampio — un ruolo personalizzato con ambito limitato riduce il raggio d'azione.

### Requisiti di rete

- Il backend Turbo EA deve raggiungere la vostra istanza SNOW su HTTPS (porta 443)
- Configurate le regole del firewall e le allowlist IP
- Formato URL dell'istanza: `https://company.service-now.com` o `https://company.servicenowservices.com`

### Scelta del metodo di autenticazione

| Metodo | Pro | Contro | Raccomandazione |
|--------|-----|--------|-----------------|
| **Basic Auth** | Configurazione semplice | Credenziali inviate ad ogni richiesta | Solo per sviluppo/test |
| **OAuth 2.0** | Basato su token, con ambito, audit-friendly | Più passaggi di configurazione | **Consigliato per la produzione** |

Per OAuth 2.0:
1. In ServiceNow: **System OAuth > Application Registry**
2. Create un nuovo endpoint OAuth API per client esterni
3. Annotate il Client ID e il Client Secret
4. Ruotate i segreti ogni 90 giorni

---

## Passo 2: Creare una connessione

Navigate su **Admin > ServiceNow > scheda Connessioni**.

### Creare e testare

1. Cliccate su **Aggiungi connessione**
2. Compilate:

| Campo | Valore di esempio | Note |
|-------|-------------------|------|
| Nome | `Production CMDB` | Etichetta descrittiva per il vostro team |
| URL istanza | `https://company.service-now.com` | Deve utilizzare HTTPS |
| Tipo di autenticazione | Basic Auth o OAuth 2.0 | OAuth consigliato per la produzione |
| Credenziali | (per tipo di autenticazione) | Crittografate a riposo tramite Fernet |

3. Cliccate su **Crea**, poi cliccate sull'**icona test** (simbolo wifi) per verificare la connettività

- **Chip verde "Connesso"** — Pronto per l'uso
- **Chip rosso "Fallito"** — Verificate credenziali, rete e URL

### Connessioni multiple

Potete creare connessioni multiple per:
- Istanze di **produzione** vs **sviluppo**
- Istanze SNOW **regionali** (es. EMEA, APAC)
- **Team diversi** con account di servizio separati

Ogni mappatura fa riferimento a una connessione specifica.

---

## Passo 3: Progettare le mappature

Passate alla scheda **Mappature**. Una mappatura connette un tipo di card Turbo EA a una tabella ServiceNow.

### Creare una mappatura

Cliccate su **Aggiungi mappatura** e configurate:

| Campo | Descrizione | Esempio |
|-------|-------------|---------|
| **Connessione** | Quale istanza ServiceNow utilizzare | Production CMDB |
| **Tipo di card** | Il tipo di card Turbo EA da sincronizzare | Application |
| **Tabella SNOW** | Il nome API della tabella ServiceNow | `cmdb_ci_business_app` |
| **Direzione sincronizzazione** | Quali operazioni sono disponibili (vedi sotto) | ServiceNow -> Turbo EA |
| **Modalità sincronizzazione** | Come gestire le eliminazioni | Conservative |
| **Rapporto massimo di eliminazione** | Soglia di sicurezza per eliminazioni in blocco | 50% |
| **Query filtro** | Query codificata ServiceNow per limitare l'ambito | `active=true^install_status=1` |
| **Salta staging** | Applica le modifiche direttamente senza revisione | Disattivato (consigliato per la sincronizzazione iniziale) |

### Mappature comuni delle tabelle SNOW

| Tipo Turbo EA | Tabella ServiceNow | Descrizione |
|---------------|-------------------|-------------|
| Application | `cmdb_ci_business_app` | Applicazioni aziendali (più comune) |
| Application | `cmdb_ci_appl` | CI di applicazioni generiche |
| ITComponent (Software) | `cmdb_ci_spkg` | Pacchetti software |
| ITComponent (Hardware) | `cmdb_ci_server` | Server fisici/virtuali |
| ITComponent (SaaS) | `cmdb_ci_cloud_service_account` | Account di servizi cloud |
| Provider | `core_company` | Fornitori / aziende |
| Interface | `cmdb_ci_endpoint` | Endpoint di integrazione |
| DataObject | `cmdb_ci_database` | Istanze di database |
| System | `cmdb_ci_computer` | CI computer |
| Organization | `cmn_department` | Dipartimenti |

### Esempi di query filtro

Filtrate sempre per evitare di importare record obsoleti o ritirati:

```
# Solo CI attivi (filtro minimo consigliato)
active=true

# CI attivi con stato di installazione "Installed"
active=true^install_status=1

# Applicazioni in uso produttivo
active=true^used_for=Production

# CI aggiornati negli ultimi 30 giorni
active=true^sys_updated_on>=javascript:gs.daysAgoStart(30)

# Gruppo di assegnazione specifico
active=true^assignment_group.name=IT Operations

# Escludi CI ritirati
active=true^install_statusNOT IN7,8
```

**Best practice**: Includete sempre `active=true` come minimo. Le tabelle CMDB contengono spesso migliaia di record ritirati o dismessi che non dovrebbero essere importati nel vostro panorama EA.

---

## Passo 4: Configurare le mappature dei campi

Ogni mappatura contiene **mappature dei campi** che definiscono come i singoli campi si traducono tra i due sistemi. L'input del campo Turbo EA fornisce suggerimenti di autocompletamento basati sul tipo di card selezionato — inclusi campi principali, date del ciclo di vita e tutti gli attributi personalizzati dallo schema del tipo.

### Aggiunta dei campi

Per ogni mappatura di campo, configurate:

| Impostazione | Descrizione |
|--------------|-------------|
| **Campo Turbo EA** | Percorso del campo in Turbo EA (l'autocompletamento suggerisce opzioni basate sul tipo di card) |
| **Campo SNOW** | Nome API della colonna ServiceNow (es. `name`, `short_description`) |
| **Direzione** | Fonte di verità per campo: SNOW guida o Turbo guida |
| **Trasformazione** | Come convertire i valori: Diretta, Mappa valori, Data, Booleano |
| **Identità** (casella ID) | Utilizzato per la corrispondenza dei record durante la sincronizzazione iniziale |

### Percorsi dei campi Turbo EA

L'autocompletamento raggruppa i campi per sezione. Ecco il riferimento completo dei percorsi:

| Percorso | Target | Valore di esempio |
|----------|--------|-------------------|
| `name` | Nome visualizzato della card | `"SAP S/4HANA"` |
| `description` | Descrizione della card | `"Sistema ERP principale per la finanza"` |
| `lifecycle.plan` | Ciclo di vita: data Plan | `"2024-01-15"` |
| `lifecycle.phaseIn` | Ciclo di vita: data Phase In | `"2024-03-01"` |
| `lifecycle.active` | Ciclo di vita: data Active | `"2024-06-01"` |
| `lifecycle.phaseOut` | Ciclo di vita: data Phase Out | `"2028-12-31"` |
| `lifecycle.endOfLife` | Ciclo di vita: data End of Life | `"2029-06-30"` |
| `attributes.<key>` | Qualsiasi attributo personalizzato dallo schema dei campi del tipo di card | Varia per tipo di campo |

Ad esempio, se il vostro tipo Application ha un campo con chiave `businessCriticality`, selezionate `attributes.businessCriticality` dal menu a tendina.

### Campi identità — Come funziona la corrispondenza

Contrassegnate uno o più campi come **Identità** (icona chiave). Questi vengono utilizzati durante la prima sincronizzazione per abbinare i record ServiceNow alle card Turbo EA esistenti:

1. **Ricerca nella mappa delle identità** — Se esiste già un collegamento sys_id <-> card UUID, viene utilizzato
2. **Corrispondenza esatta del nome** — Corrispondenza sul valore del campo identità (es. corrispondenza per nome applicazione)
3. **Corrispondenza fuzzy** — Se non c'è corrispondenza esatta, utilizza SequenceMatcher con soglia di similarità dell'85%

**Best practice**: Contrassegnate sempre il campo `name` come campo identità. Se i nomi differiscono tra i sistemi (es. SNOW include i numeri di versione come "SAP S/4HANA v2.1" ma Turbo EA ha "SAP S/4HANA"), puliteli prima della prima sincronizzazione per una migliore qualità di corrispondenza.

Dopo che la prima sincronizzazione stabilisce i collegamenti nella mappa delle identità, le sincronizzazioni successive utilizzano la mappa delle identità persistente e non si basano sulla corrispondenza dei nomi.

---

## Passo 5: Eseguire la prima sincronizzazione

Passate alla scheda **Dashboard di sincronizzazione**.

### Avviare una sincronizzazione

Per ogni mappatura attiva, vedete pulsanti Pull e/o Push a seconda della direzione di sincronizzazione configurata:

- **Pull** (icona download cloud) — Recupera dati da SNOW verso Turbo EA
- **Push** (icona upload cloud) — Invia dati Turbo EA verso ServiceNow

### Cosa succede durante un Pull Sync

```
1. FETCH     Recupera tutti i record corrispondenti da SNOW (batch di 500)
2. MATCH     Abbina ogni record a una card esistente:
             a) Mappa delle identità (ricerca persistente sys_id <-> card UUID)
             b) Corrispondenza esatta del nome sui campi identità
             c) Corrispondenza fuzzy del nome (soglia di similarità 85%)
3. TRANSFORM Applica le mappature dei campi per convertire SNOW -> formato Turbo EA
4. DIFF      Confronta i dati trasformati con i campi della card esistente
5. STAGE     Assegna un'azione a ogni record:
             - create: Nuovo, nessuna card corrispondente trovata
             - update: Corrispondenza trovata, campi differenti
             - skip:   Corrispondenza trovata, nessuna differenza
             - delete: Nella mappa delle identità ma assente da SNOW
6. APPLY     Esegue le azioni staged (crea/aggiorna/archivia card)
```

Quando **Salta staging** è abilitato, i passi 5 e 6 si fondono — le azioni vengono applicate direttamente senza scrivere record staged.

### Revisione dei risultati della sincronizzazione

La tabella **Cronologia sincronizzazioni** mostra dopo ogni esecuzione:

| Colonna | Descrizione |
|---------|-------------|
| Avviato | Quando la sincronizzazione è iniziata |
| Direzione | Pull o Push |
| Stato | `completed`, `failed` o `running` |
| Recuperati | Record totali recuperati da ServiceNow |
| Creati | Nuove card create in Turbo EA |
| Aggiornati | Card esistenti aggiornate |
| Eliminati | Card archiviate (eliminate temporaneamente) |
| Errori | Record che non sono stati processati |
| Durata | Tempo effettivo |

Cliccate sull'**icona elenco** su qualsiasi esecuzione per ispezionare i singoli record staged, incluso il diff a livello di campo per ogni aggiornamento.

### Procedura consigliata per la prima sincronizzazione

```
1. Impostate la mappatura in modalità ADDITIVE con staging ATTIVATO
2. Eseguite il pull sync
3. Revisionate i record staged — verificate che le creazioni siano corrette
4. Andate nell'Inventario, verificate le card importate
5. Aggiustate le mappature dei campi o la query filtro se necessario
6. Rieseguite fino a quando siete soddisfatti
7. Passate alla modalità CONSERVATIVE per l'uso continuativo
8. Dopo diverse esecuzioni riuscite, abilitate Salta staging
```

---

## Comprendere la direzione di sincronizzazione vs la direzione del campo

Questo è il concetto più comunemente frainteso. Ci sono **due livelli di direzione** che lavorano insieme:

### Livello tabella: Direzione di sincronizzazione

Impostata sulla mappatura stessa. Controlla **quali operazioni di sincronizzazione sono disponibili** nel Dashboard di sincronizzazione:

| Direzione sincronizzazione | Pulsante Pull? | Pulsante Push? | Usare quando... |
|----------------------------|----------------|----------------|-----------------|
| **ServiceNow -> Turbo EA** | Sì | No | Il CMDB è la fonte master, importate solo |
| **Turbo EA -> ServiceNow** | No | Sì | Lo strumento EA arricchisce il CMDB con valutazioni |
| **Bidirezionale** | Sì | Sì | Entrambi i sistemi contribuiscono con campi diversi |

### Livello campo: Direzione

Impostata **per mappatura di campo**. Controlla **quale valore del sistema prevale** durante un'esecuzione di sincronizzazione:

| Direzione del campo | Durante il Pull (SNOW -> Turbo) | Durante il Push (Turbo -> SNOW) |
|---------------------|--------------------------------|--------------------------------|
| **SNOW guida** | Il valore viene importato da ServiceNow | Il valore viene **saltato** (non inviato) |
| **Turbo guida** | Il valore viene **saltato** (non sovrascritto) | Il valore viene esportato verso ServiceNow |

### Come funzionano insieme — Esempio

Mappatura: Application <-> `cmdb_ci_business_app`, **Bidirezionale**

| Campo | Direzione | Il Pull fa... | Il Push fa... |
|-------|-----------|---------------|---------------|
| `name` | **Turbo guida** | Salta (l'EA cura i nomi) | Invia il nome EA -> SNOW |
| `description` | **Turbo guida** | Salta (l'EA scrive le descrizioni) | Invia la descrizione -> SNOW |
| `lifecycle.active` | **Turbo guida** | Salta (l'EA gestisce il ciclo di vita) | Invia la data go-live -> SNOW |
| `attributes.businessCriticality` | **Turbo guida** | Salta (valutazione EA) | Invia la valutazione -> campo personalizzato SNOW |
| `attributes.ipAddress` | SNOW guida | Importa IP dalla discovery | Salta (dati operativi) |
| `attributes.installStatus` | SNOW guida | Importa stato operativo | Salta (dati ITSM) |

**Concetto chiave**: La direzione a livello di tabella determina *quali pulsanti appaiono*. La direzione a livello di campo determina *quali campi vengono effettivamente trasferiti* durante ogni operazione. Una mappatura bidirezionale dove Turbo EA guida la maggior parte dei campi e SNOW guida solo i campi operativi/tecnici è la configurazione più potente.

### Best practice: Direzione del campo per tipo di dato

L'impostazione predefinita dovrebbe essere **Turbo guida** per la stragrande maggioranza dei campi. Impostate SNOW guida solo per i metadati operativi e tecnici che provengono dalla discovery automatizzata o dai workflow ITSM.

| Categoria di dati | Direzione consigliata | Motivazione |
|-------------------|----------------------|-------------|
| **Nomi, etichette visualizzate** | **Turbo guida** | Il team EA cura nomi autorevoli e puliti — i nomi CMDB sono spesso auto-generati o incoerenti |
| **Descrizione** | **Turbo guida** | Le descrizioni EA catturano contesto strategico, valore aziendale e significato architetturale |
| **Criticità aziendale (modello TIME)** | **Turbo guida** | Valutazione core dell'EA — non dati operativi |
| **Idoneità funzionale/tecnica** | **Turbo guida** | Punteggi e classificazione della roadmap specifici dell'EA |
| **Ciclo di vita (tutte le fasi)** | **Turbo guida** | Plan, phaseIn, active, phaseOut, endOfLife sono tutte decisioni di pianificazione EA |
| **Dati sui costi** | **Turbo guida** | L'EA traccia il costo totale di proprietà e l'allocazione del budget |
| **Tipo di hosting, classificazione** | **Turbo guida** | Categorizzazione strategica mantenuta dagli architetti |
| **Informazioni fornitore/provider** | **Turbo guida** | L'EA gestisce strategia, contratti e rischio dei fornitori — SNOW può avere un nome fornitore ma l'EA possiede la relazione |
| Metadati tecnici (OS, IP, hostname) | SNOW guida | Dati di discovery automatizzata — l'EA non li mantiene |
| Obiettivi SLA, metriche di disponibilità | SNOW guida | Dati operativi dai workflow ITSM |
| Stato di installazione, stato operativo | SNOW guida | Il CMDB traccia se un CI è installato, ritirato, ecc. |
| Gruppo di assegnazione, team di supporto | SNOW guida | Proprietà operativa gestita in ServiceNow |
| Metadati di discovery (primo/ultimo rilevamento) | SNOW guida | Timestamp di automazione CMDB |

---

## Salta staging — Quando usarlo

Per impostazione predefinita, i pull sync seguono un workflow **stage-poi-applica**:

```
Fetch -> Match -> Transform -> Diff -> STAGE -> Revisione -> APPLY
```

I record vengono scritti in una tabella di staging, consentendovi di revisionare cosa cambierà prima di applicare. Questo è visibile nel Dashboard di sincronizzazione sotto "Visualizza record staged".

### Modalità Salta staging

Quando abilitate **Salta staging** su una mappatura, i record vengono applicati direttamente:

```
Fetch -> Match -> Transform -> Diff -> APPLICA DIRETTAMENTE
```

Non vengono creati record staged — le modifiche avvengono immediatamente.

| | Staging (predefinito) | Salta staging |
|--|----------------------|---------------|
| **Passo di revisione** | Sì — ispezionate i diff prima di applicare | No — le modifiche vengono applicate immediatamente |
| **Tabella record staged** | Popolata con voci create/aggiorna/elimina | Non popolata |
| **Registro di audit** | Record staged + cronologia eventi | Solo cronologia eventi |
| **Prestazioni** | Leggermente più lento (scrive righe di staging) | Leggermente più veloce |
| **Annullamento** | Potete interrompere prima di applicare | Dovete ripristinare manualmente |

### Quando usare ciascuno

| Scenario | Raccomandazione |
|----------|-----------------|
| Prima importazione | **Usate staging** — Revisionate cosa viene creato prima di applicare |
| Mappatura nuova o modificata | **Usate staging** — Verificate che le trasformazioni dei campi producano output corretto |
| Mappatura stabile e ben testata | **Saltate staging** — Non serve revisionare ogni esecuzione |
| Sincronizzazioni giornaliere automatizzate (cron) | **Saltate staging** — Le esecuzioni automatiche non possono attendere la revisione |
| CMDB grande (10.000+ CI) | **Saltate staging** — Evita di creare migliaia di righe di staging |
| Ambiente sensibile alla conformità | **Usate staging** — Mantenete un registro di audit completo nella tabella di staging |

**Best practice**: Iniziate con lo staging abilitato per le prime sincronizzazioni. Una volta sicuri che la mappatura produce risultati corretti, abilitate salta staging per le esecuzioni automatizzate.

---

## Modalità di sincronizzazione e sicurezza delle eliminazioni

### Modalità di sincronizzazione

| Modalità | Crea | Aggiorna | Elimina | Ideale per |
|----------|------|----------|---------|------------|
| **Additive** | Sì | Sì | **Mai** | Importazioni iniziali, ambienti a basso rischio |
| **Conservative** | Sì | Sì | Solo card **create dalla sincronizzazione** | Predefinita per sincronizzazioni continuative |
| **Strict** | Sì | Sì | Tutte le card collegate | Specchio completo del CMDB |

**Additive** non rimuove mai card da Turbo EA, rendendola l'opzione più sicura per le importazioni iniziali e gli ambienti dove Turbo EA contiene card non presenti in ServiceNow (card create manualmente, card da altre fonti).

**Conservative** (predefinita) traccia se ogni card è stata originariamente creata dal motore di sincronizzazione. Solo quelle card possono essere auto-archiviate se scompaiono da ServiceNow. Le card create manualmente in Turbo EA o importate da altre fonti non vengono mai toccate.

**Strict** archivia qualsiasi card collegata il cui CI ServiceNow corrispondente non appare più nei risultati della query, indipendentemente da chi l'ha creata. Usate questo solo quando ServiceNow è la fonte di verità assoluta e volete che Turbo EA lo specchi esattamente.

### Rapporto massimo di eliminazione — Rete di sicurezza

Come rete di sicurezza, il motore **salta tutte le eliminazioni** se il conteggio supera il rapporto configurato:

```
eliminazioni / totale_collegati > rapporto_massimo_eliminazione  ->  SALTA TUTTE LE ELIMINAZIONI
```

Esempio con 10 record collegati e soglia del 50%:

| Scenario | Eliminazioni | Rapporto | Risultato |
|----------|-------------|----------|-----------|
| 3 CI rimossi normalmente | 3 / 10 = 30% | Sotto la soglia | Le eliminazioni procedono |
| 6 CI rimossi in una volta | 6 / 10 = 60% | **Sopra la soglia** | Tutte le eliminazioni saltate |
| SNOW restituisce vuoto (disservizio) | 10 / 10 = 100% | **Sopra la soglia** | Tutte le eliminazioni saltate |

Questo previene la perdita catastrofica di dati da modifiche alla query filtro, disservizi temporanei di ServiceNow o nomi di tabelle mal configurati.

**Best practice**: Mantenete il rapporto di eliminazione al **50% o inferiore** per tabelle con meno di 100 record. Per tabelle grandi (1.000+), potete impostarlo in sicurezza al 25%.

### Progressione consigliata

```
Settimana 1:    Modalita ADDITIVE, staging ATTIVATO, eseguite manualmente, revisionate ogni record
Settimana 2-4:  Modalita CONSERVATIVE, staging ATTIVATO, eseguite giornalmente, controllate a campione
Mese 2+:        Modalita CONSERVATIVE, staging DISATTIVATO (salta), cron giornaliero automatizzato
```

---

## Ricette consigliate per tipo

### Ricetta 1: Applicazioni dal CMDB (Più comune)

**Obiettivo**: Importate il panorama applicativo da ServiceNow, poi assumete la proprietà di nomi, descrizioni, valutazioni e ciclo di vita in Turbo EA. SNOW guida solo i campi operativi.

**Mappatura:**

| Impostazione | Valore |
|--------------|--------|
| Tipo di card | Application |
| Tabella SNOW | `cmdb_ci_business_app` |
| Direzione | Bidirezionale |
| Modalità | Conservative |
| Filtro | `active=true^install_status=1` |

**Mappature dei campi:**

| Campo Turbo EA | Campo SNOW | Direzione | Trasformazione | ID? |
|----------------|------------|-----------|----------------|-----|
| `name` | `name` | **Turbo guida** | Diretta | Sì |
| `description` | `short_description` | **Turbo guida** | Diretta | |
| `lifecycle.active` | `go_live_date` | **Turbo guida** | Data | |
| `lifecycle.endOfLife` | `retirement_date` | **Turbo guida** | Data | |
| `attributes.businessCriticality` | `busines_criticality` | **Turbo guida** | Mappa valori | |
| `attributes.hostingType` | `hosting_type` | **Turbo guida** | Diretta | |
| `attributes.installStatus` | `install_status` | SNOW guida | Diretta | |
| `attributes.ipAddress` | `ip_address` | SNOW guida | Diretta | |

Configurazione mappa valori per `businessCriticality`:

```json
{
  "mapping": {
    "1 - most critical": "missionCritical",
    "2 - somewhat critical": "businessCritical",
    "3 - less critical": "businessOperational",
    "4 - not critical": "administrativeService"
  }
}
```

**Suggerimento per la prima sincronizzazione**: Al primo pull, i valori SNOW popolano tutti i campi (poiché le card non esistono ancora). Dopo, i campi guidati da Turbo sono di proprietà del team EA — i pull successivi aggiornano solo i campi operativi guidati da SNOW (stato di installazione, IP), mentre il team EA gestisce tutto il resto direttamente in Turbo EA.

**Dopo l'importazione**: Perfezionate i nomi delle applicazioni, scrivete descrizioni strategiche, mappate le Business Capability, aggiungete valutazioni di idoneità funzionale/tecnica e impostate le fasi del ciclo di vita — tutto questo è ora di proprietà di Turbo EA e verrà inviato a ServiceNow nei push sync.

---

### Ricetta 2: IT Component (Server)

**Obiettivo**: Importate l'infrastruttura server per la mappatura dell'infrastruttura e l'analisi delle dipendenze. I server sono più operativi delle applicazioni, quindi più campi provengono da SNOW — ma Turbo EA guida ancora nomi e descrizioni.

**Mappatura:**

| Impostazione | Valore |
|--------------|--------|
| Tipo di card | ITComponent |
| Tabella SNOW | `cmdb_ci_server` |
| Direzione | Bidirezionale |
| Modalità | Conservative |
| Filtro | `active=true^hardware_statusNOT IN6,7` |

**Mappature dei campi:**

| Campo Turbo EA | Campo SNOW | Direzione | Trasformazione | ID? |
|----------------|------------|-----------|----------------|-----|
| `name` | `name` | **Turbo guida** | Diretta | Sì |
| `description` | `short_description` | **Turbo guida** | Diretta | |
| `attributes.manufacturer` | `manufacturer.name` | **Turbo guida** | Diretta | |
| `attributes.operatingSystem` | `os` | SNOW guida | Diretta | |
| `attributes.ipAddress` | `ip_address` | SNOW guida | Diretta | |
| `attributes.serialNumber` | `serial_number` | SNOW guida | Diretta | |
| `attributes.hostname` | `host_name` | SNOW guida | Diretta | |

**Nota**: Per i server, i campi operativi/di discovery come OS, IP, numero di serie e hostname provengono naturalmente dalla discovery automatizzata di SNOW. Ma il team EA possiede comunque il nome visualizzato (che può differire dall'hostname) e la descrizione per il contesto strategico.

**Dopo l'importazione**: Collegate gli IT Component alle Application usando le relazioni, alimentando il grafo delle dipendenze e i report sull'infrastruttura.

---

### Ricetta 3: Prodotti software con tracciamento EOL

**Obiettivo**: Importate i prodotti software e combinateli con l'integrazione endoflife.date di Turbo EA. Turbo EA guida su nomi, descrizioni e fornitore — la versione è un campo fattuale su cui SNOW può guidare.

**Mappatura:**

| Impostazione | Valore |
|--------------|--------|
| Tipo di card | ITComponent |
| Tabella SNOW | `cmdb_ci_spkg` |
| Direzione | Bidirezionale |
| Modalità | Conservative |
| Filtro | `active=true` |

**Mappature dei campi:**

| Campo Turbo EA | Campo SNOW | Direzione | Trasformazione | ID? |
|----------------|------------|-----------|----------------|-----|
| `name` | `name` | **Turbo guida** | Diretta | Sì |
| `description` | `short_description` | **Turbo guida** | Diretta | |
| `attributes.version` | `version` | SNOW guida | Diretta | |
| `attributes.vendor` | `manufacturer.name` | **Turbo guida** | Diretta | |

**Dopo l'importazione**: Andate su **Admin > EOL** e utilizzate la Ricerca massiva per abbinare automaticamente gli IT Component importati ai prodotti endoflife.date. Questo vi offre un tracciamento automatizzato del rischio EOL che combina l'inventario CMDB con i dati pubblici sul ciclo di vita.

---

### Ricetta 4: Fornitori / Provider (Bidirezionale)

**Obiettivo**: Mantenete sincronizzato il registro dei fornitori. Turbo EA possiede nomi, descrizioni e contesto strategico dei fornitori. SNOW integra con dati di contatto operativi.

**Mappatura:**

| Impostazione | Valore |
|--------------|--------|
| Tipo di card | Provider |
| Tabella SNOW | `core_company` |
| Direzione | Bidirezionale |
| Modalità | Additive |
| Filtro | `vendor=true` |

**Mappature dei campi:**

| Campo Turbo EA | Campo SNOW | Direzione | Trasformazione | ID? |
|----------------|------------|-----------|----------------|-----|
| `name` | `name` | **Turbo guida** | Diretta | Sì |
| `description` | `notes` | **Turbo guida** | Diretta | |
| `attributes.website` | `website` | **Turbo guida** | Diretta | |
| `attributes.contactEmail` | `email` | SNOW guida | Diretta | |

**Perché Turbo guida per la maggior parte dei campi**: Il team EA cura la strategia dei fornitori, gestisce le relazioni e traccia il rischio — questo include il nome visualizzato, la descrizione e la presenza web del fornitore. SNOW guida solo sui dati di contatto operativi che possono essere aggiornati dai team di approvvigionamento o gestione degli asset.

---

### Ricetta 5: Push delle valutazioni EA verso ServiceNow

**Obiettivo**: Esportate le valutazioni specifiche dell'EA verso campi personalizzati ServiceNow così i team ITSM possono vedere il contesto EA.

**Mappatura:**

| Impostazione | Valore |
|--------------|--------|
| Tipo di card | Application |
| Tabella SNOW | `cmdb_ci_business_app` |
| Direzione | Turbo EA -> ServiceNow |
| Modalità | Additive |

**Mappature dei campi:**

| Campo Turbo EA | Campo SNOW | Direzione | Trasformazione | ID? |
|----------------|------------|-----------|----------------|-----|
| `name` | `name` | SNOW guida | Diretta | Sì |
| `attributes.businessCriticality` | `u_ea_business_criticality` | Turbo guida | Mappa valori | |
| `attributes.functionalSuitability` | `u_ea_functional_fit` | Turbo guida | Mappa valori | |
| `attributes.technicalSuitability` | `u_ea_technical_fit` | Turbo guida | Mappa valori | |

> **Importante**: Il push sync verso campi personalizzati (con prefisso `u_`) richiede che quelle colonne esistano già in ServiceNow. Collaborate con il vostro amministratore ServiceNow per crearle prima di configurare la mappatura push. L'account di servizio necessita del ruolo `import_admin` per l'accesso in scrittura.

**Perché è importante**: I team ITSM vedono le valutazioni EA direttamente nei workflow di incidenti/cambiamenti ServiceNow. Quando un'applicazione "Mission Critical" ha un incidente, le regole di escalation della priorità possono utilizzare il punteggio di criticità fornito dall'EA.

---

## Riferimento dei tipi di trasformazione

### Diretta (predefinita)

Passa il valore invariato. Utilizzare per campi di testo che hanno lo stesso formato in entrambi i sistemi.

### Mappa valori

Traduce i valori enumerati tra i sistemi. Configurare con una mappatura JSON:

```json
{
  "mapping": {
    "1": "missionCritical",
    "2": "businessCritical",
    "3": "businessOperational",
    "4": "administrativeService"
  }
}
```

La mappatura si inverte automaticamente quando si esegue il push da Turbo EA a ServiceNow. Ad esempio, durante il push, `"missionCritical"` diventa `"1"`.

### Formato data

Tronca i valori datetime di ServiceNow (`2024-06-15 14:30:00`) a solo data (`2024-06-15`). Utilizzare per le date delle fasi del ciclo di vita dove l'orario è irrilevante.

### Booleano

Converte tra stringhe booleane di ServiceNow (`"true"`, `"1"`, `"yes"`) e booleani nativi. Utile per campi come "is_virtual", "active", ecc.

---

## Best practice di sicurezza

### Gestione delle credenziali

| Pratica | Dettagli |
|---------|----------|
| **Crittografia a riposo** | Tutte le credenziali crittografate tramite Fernet (AES-128-CBC) derivato da `SECRET_KEY`. Se ruotate `SECRET_KEY`, reinserite tutte le credenziali ServiceNow. |
| **Privilegio minimo** | Create un account di servizio SNOW dedicato con accesso di sola lettura a tabelle specifiche. Concedete l'accesso in scrittura solo se utilizzate il push sync. |
| **OAuth 2.0 preferito** | Basic Auth invia le credenziali ad ogni chiamata API. OAuth utilizza token a breve durata con restrizioni di ambito. |
| **Rotazione delle credenziali** | Ruotate password o client secret ogni 90 giorni. |

### Sicurezza di rete

| Pratica | Dettagli |
|---------|----------|
| **HTTPS obbligatorio** | Gli URL HTTP vengono rifiutati al momento della validazione. Tutte le connessioni devono utilizzare HTTPS. |
| **Validazione nome tabella** | I nomi delle tabelle vengono validati contro `^[a-zA-Z0-9_]+$` per prevenire iniezioni. |
| **Validazione sys_id** | I valori sys_id vengono validati come stringhe esadecimali di 32 caratteri. |
| **Allowlist IP** | Configurate il controllo di accesso IP di ServiceNow per consentire solo l'IP del vostro server Turbo EA. |

### Controllo degli accessi

| Pratica | Dettagli |
|---------|----------|
| **Gated RBAC** | Tutti gli endpoint ServiceNow richiedono il permesso `servicenow.manage`. |
| **Registro di audit** | Tutte le modifiche create dalla sincronizzazione pubblicano eventi con `source: "servicenow_sync"`, visibili nella cronologia della card. |
| **Nessuna esposizione credenziali** | Password e segreti non vengono mai restituiti nelle risposte API. |

### Checklist per la produzione

- [ ] Account di servizio ServiceNow dedicato (non un account personale)
- [ ] OAuth 2.0 con concessione client credentials
- [ ] Programma di rotazione delle credenziali (ogni 90 giorni)
- [ ] Account di servizio limitato solo alle tabelle mappate
- [ ] Allowlist IP ServiceNow configurata per l'IP del server Turbo EA
- [ ] Rapporto massimo di eliminazione impostato al 50% o inferiore
- [ ] Esecuzioni di sincronizzazione monitorate per conteggi insoliti di errori o eliminazioni
- [ ] Query filtro includono `active=true` come minimo

---

## Runbook operativo

### Sequenza di configurazione iniziale

```
1. Create l'account di servizio ServiceNow con i ruoli minimi richiesti
2. Verificate la connettività di rete (Turbo EA puòraggiungere SNOW su HTTPS?)
3. Create la connessione in Turbo EA e testatela
4. Verificate che i tipi del metamodello abbiano tutti i campi che volete sincronizzare
5. Create la prima mappatura con modalità ADDITIVE, staging ATTIVATO
6. Utilizzate il pulsante Anteprima (tramite API) per verificare che la mappatura produca output corretto
7. Eseguite il primo pull sync — revisionate i record staged nel Dashboard di sincronizzazione
8. Applicate i record staged
9. Verificate le card importate nell'Inventario
10. Aggiustate le mappature dei campi se necessario, rieseguite
11. Passate alla modalità CONSERVATIVE per l'uso continuativo
12. Dopo diverse esecuzioni riuscite, abilitate Salta staging per l'automazione
```

### Operazioni continuative

| Attività | Frequenza | Come |
|----------|-----------|------|
| Eseguire pull sync | Giornalmente o settimanalmente | Dashboard di sincronizzazione > pulsante Pull (o cron) |
| Revisionare le statistiche di sincronizzazione | Dopo ogni esecuzione | Controllate conteggi errori/eliminazioni |
| Testare le connessioni | Mensilmente | Cliccate il pulsante test su ogni connessione |
| Ruotare le credenziali | Trimestralmente | Aggiornate sia in SNOW che in Turbo EA |
| Revisionare la mappa delle identità | Trimestralmente | Controllate le voci orfane tramite statistiche di sincronizzazione |
| Audit della cronologia delle card | Secondo necessità | Filtrate gli eventi per sorgente `servicenow_sync` |

### Configurazione delle sincronizzazioni automatizzate

Le sincronizzazioni possono essere attivate tramite API per l'automazione:

```bash
# Pull sync giornaliero alle 2:00
0 2 * * * curl -s -X POST \
  -H "Authorization: Bearer $TURBOEA_TOKEN" \
  "https://turboea.company.com/api/v1/servicenow/sync/pull/$MAPPING_ID" \
  >> /var/log/turboea-sync.log 2>&1
```

**Best practice**: Eseguite le sincronizzazioni durante le ore non di punta. Per tabelle CMDB grandi (10.000+ CI), prevedete 2-5 minuti a seconda della latenza di rete e del numero di record.

### Pianificazione della capacità

| Dimensione CMDB | Durata prevista | Raccomandazione |
|-----------------|-----------------|-----------------|
| < 500 CI | < 30 secondi | Sincronizzate giornalmente, staging opzionale |
| 500-5.000 CI | 30s - 2 minuti | Sincronizzate giornalmente, saltate staging |
| 5.000-20.000 CI | 2-5 minuti | Sincronizzate di notte, saltate staging |
| 20.000+ CI | 5-15 minuti | Sincronizzate settimanalmente, utilizzate query filtro per suddividere |

---

## Risoluzione dei problemi

### Problemi di connessione

| Sintomo | Causa | Soluzione |
|---------|-------|----------|
| `Connection failed: [SSL]` | Certificato auto-firmato o scaduto | Assicuratevi che SNOW utilizzi un certificato CA pubblico valido |
| `HTTP 401: Unauthorized` | Credenziali errate | Reinserite username/password; verificate che l'account non sia bloccato |
| `HTTP 403: Forbidden` | Ruoli insufficienti | Concedete `itil` e `cmdb_read` all'account di servizio |
| `Connection failed: timed out` | Blocco del firewall | Verificate le regole; aggiungete l'IP di Turbo EA all'allowlist in SNOW |
| Test OK ma sincronizzazione fallisce | Permessi a livello di tabella | Concedete l'accesso in lettura alla specifica tabella CMDB |

### Problemi di sincronizzazione

| Sintomo | Causa | Soluzione |
|---------|-------|----------|
| 0 record recuperati | Tabella o filtro errato | Verificate il nome della tabella; semplificate la query filtro |
| Tutti i record sono "create" | Mancata corrispondenza identità | Contrassegnate `name` come identità; verificate che i nomi corrispondano tra i sistemi |
| Alto conteggio errori | Fallimenti di trasformazione | Controllate i record staged per i messaggi di errore |
| Eliminazioni saltate | Rapporto superato | Aumentate la soglia o investigate perché i CI sono scomparsi |
| Modifiche non visibili | Cache del browser | Aggiornamento forzato; controllate la cronologia della card per gli eventi |
| Card duplicate | Mappature multiple per lo stesso tipo | Utilizzate una mappatura per tipo di card per connessione |
| Modifiche push rifiutate | Permessi SNOW mancanti | Concedete il ruolo `import_admin` all'account di servizio |

### Strumenti diagnostici

```bash
# Anteprima di come i record verranno mappati (5 campioni, nessun effetto collaterale)
POST /api/v1/servicenow/mappings/{mapping_id}/preview

# Sfoglia le tabelle sull'istanza SNOW
GET /api/v1/servicenow/connections/{conn_id}/tables?search=cmdb

# Ispeziona le colonne di una tabella
GET /api/v1/servicenow/connections/{conn_id}/tables/cmdb_ci_business_app/fields

# Filtra i record staged per azione o stato
GET /api/v1/servicenow/sync/runs/{run_id}/staged?action=create
GET /api/v1/servicenow/sync/runs/{run_id}/staged?action=update
GET /api/v1/servicenow/sync/runs/{run_id}/staged?status=error
```

---

## Riferimento API (Rapido)

Tutti gli endpoint richiedono `Authorization: Bearer <token>` e il permesso `servicenow.manage`. Percorso base: `/api/v1`.

### Connessioni

| Metodo | Percorso | Descrizione |
|--------|----------|-------------|
| GET | `/servicenow/connections` | Elenca le connessioni |
| POST | `/servicenow/connections` | Crea connessione |
| GET | `/servicenow/connections/{id}` | Ottieni connessione |
| PATCH | `/servicenow/connections/{id}` | Aggiorna connessione |
| DELETE | `/servicenow/connections/{id}` | Elimina connessione + tutte le mappature |
| POST | `/servicenow/connections/{id}/test` | Testa la connettività |
| GET | `/servicenow/connections/{id}/tables` | Sfoglia le tabelle SNOW |
| GET | `/servicenow/connections/{id}/tables/{table}/fields` | Elenca le colonne della tabella |

### Mappature

| Metodo | Percorso | Descrizione |
|--------|----------|-------------|
| GET | `/servicenow/mappings` | Elenca le mappature con mappature dei campi |
| POST | `/servicenow/mappings` | Crea mappatura con mappature dei campi |
| GET | `/servicenow/mappings/{id}` | Ottieni mappatura con mappature dei campi |
| PATCH | `/servicenow/mappings/{id}` | Aggiorna mappatura (sostituisce i campi se forniti) |
| DELETE | `/servicenow/mappings/{id}` | Elimina mappatura |
| POST | `/servicenow/mappings/{id}/preview` | Anteprima dry-run (5 record campione) |

### Operazioni di sincronizzazione

| Metodo | Percorso | Descrizione |
|--------|----------|-------------|
| POST | `/servicenow/sync/pull/{mapping_id}` | Pull sync (`?auto_apply=true` predefinito) |
| POST | `/servicenow/sync/push/{mapping_id}` | Push sync |
| GET | `/servicenow/sync/runs` | Elenca cronologia sincronizzazioni (`?limit=20`) |
| GET | `/servicenow/sync/runs/{id}` | Ottieni dettagli esecuzione + statistiche |
| GET | `/servicenow/sync/runs/{id}/staged` | Elenca record staged per un'esecuzione |
| POST | `/servicenow/sync/runs/{id}/apply` | Applica record staged in attesa |
