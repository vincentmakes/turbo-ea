# Iniziare con l'inventario applicativo

Turbo EA è fornito con 13 tipi di card pronti all'uso. Si sarà tentati di popolarli tutti. Non farlo.

**Iniziare dalle Applicazioni.** Le Applicazioni sono il tipo di card a maggior leva in qualsiasi primo rollout:

- Sono le più facili da reperire — i dipartimenti IT hanno quasi sempre un elenco da qualche parte (CMDB, tracker delle licenze, sistema finanziario, persino un foglio di calcolo).
- Ancorano ogni altro livello — una volta che si hanno le Applicazioni, la mappatura su Capability, Processi e IT Component diventa un arricchimento incrementale anziché un esercizio da zero.
- Guidano il primo report utile (Razionalizzazione del portfolio) con il minor numero di dipendenze.

Gli altri tipi di card arrivano dopo. Una comune seconda ondata sono le Business Capability (pagina 4) e poi le Interfacce o gli Oggetti Dati.

## Cosa significa "minimo praticabile"

Per ogni card Applicazione nell'ambito iniziale, popolare questi campi e **solo** questi campi:

| Campo | Perché conta | Da dove proviene |
|-------|-------------|------------------|
| **Nome** | Identità. Usare il nome effettivamente in uso, non l'etichetta della licenza. | La fonte esistente |
| **Descrizione** | Una frase: cosa fa questa app per il business? | Intervista con l'owner, o suggerimento AI (vedere [Inventario](../guide/inventory.md#ai-description-suggestions)) |
| **Fase del ciclo di vita** | Plan / Phase In / Active / Phase Out / End of Life | CMDB, o intervista con l'owner |
| **Business Owner** (stakeholder) | La persona responsabile dell'app | Organigramma |
| **Costo — Totale Annuo** | Usato dal Portfolio Report e dalla formula TIME | Finanza, o stima approssimativa |

Cinque campi. Tutto qui. L'anello della Data Quality segnerà ~50% e va benissimo — si può raffinare al secondo passaggio.

!!! warning "Da evitare"
    Non cercare di compilare la **data di End of Life**, il **Fornitore**, lo **stack tecnologico** e 12 campi personalizzati al primo passaggio. Ci si esaurirà attorno alla card 30.

## Tre modi per popolare l'inventario

Scegliere il percorso che corrisponde alla fonte dati. Si possono anche combinare — importare in massa, poi correggere manualmente la coda lunga.

### Percorso A — Import Excel / CSV (consigliato per la maggior parte degli avvii)

Se le applicazioni vivono in un foglio di calcolo (o sono esportabili da una CMDB), questo è il percorso più rapido. **Non partire costruendo il foglio a mano** — lasciare che sia Turbo EA a fornire il template.

1. **Creare prima una card Application fittizia manualmente**. Andare in **Inventario → + Crea**, Type = `Application`, dare un nome tipo *«_TEMPLATE — da eliminare»*. Compilare i cinque campi minimi (descrizione, ciclo di vita, owner, costo) in modo che l'export contenga valori reali da usare come esempio.
2. **Filtrare l'inventario per Type = `Application`** e cliccare **Esporta** nella barra in alto. Si ottiene un file `.xlsx` con una riga di dati reali e una colonna per campo — questo è il template. Le intestazioni di colonna corrispondono alle chiavi di campo che l'importer si aspetta.
3. **Modificare il foglio offline**: mantenere la struttura delle colonne, sostituire la singola riga con tutte le applicazioni reali ed eliminare la riga fittizia alla fine (oppure lasciarla — si rimuoverà la card da Turbo EA dopo l'import).
4. **Importare il file modificato**: **Inventario → Importa**, trascinare il `.xlsx`. Il report di validazione mostra esattamente quali righe creeranno nuove card, quali aggiorneranno card esistenti (corrispondenza per nome o ID) e quali falliranno.
5. Eseguire l'import, poi archiviare la card `_TEMPLATE`.

Riferimento completo: [Inventario → Import Excel](../guide/inventory.md#excel-import).

**Suggerimento per il primo import:** includere solo i cinque campi minimi, più una colonna per l'email del Business Owner (l'importatore proverà ad abbinarla agli utenti esistenti). Saltare tutto il resto. Si può fare un secondo import più avanti con più colonne ripetendo il ciclo export-modifica-import.

### Percorso B — Sincronizzazione ServiceNow

Se è disponibile una CMDB ServiceNow e l'accesso admin alle sue API, l'integrazione recupera i record Applicazione direttamente.

1. Andare in **Admin → Integrazione ServiceNow**.
2. Creare una connessione (URL, credenziali — le credenziali sono memorizzate cifrate).
3. Definire una mappatura: ServiceNow `cmdb_ci_business_app` → Turbo EA `Application`, con regole a livello di campo.
4. Eseguire una sincronizzazione **pull**. Per default i record finiscono in un'area di **staging** per la revisione admin prima di essere applicati.

Vedere [Admin → Integrazione ServiceNow](../admin/servicenow.md) per la configurazione completa. Trattare la prima sincronizzazione come esplorativa — esaminare cosa è arrivato, raffinare la mappatura, poi eseguirla per davvero.

### Percorso C — Inserimento manuale

Per parchi applicativi piccoli (sotto le ~30 app) o quando non esiste una fonte utilizzabile:

1. **Inventario** → **+ Crea** (in alto a destra).
2. Type = **Application**, compilare Nome e (opzionalmente) Descrizione.
3. Cliccare **Suggerisci con AI** per ottenere una descrizione iniziale tratta da una ricerca web.
4. Salvare e proseguire. Il resto si compilerà dalla pagina di dettaglio della card.

L'inserimento manuale è lento ma produce dati di altissima qualità perché ogni card è toccata dall'owner all'inserimento.

## Usare il workflow di approvazione come quality gate

Ogni card porta uno **Stato di approvazione**: Bozza → Approvata → (Broken se modificata sostanzialmente dopo l'approvazione).

Un workflow pratico:

1. Le nuove card arrivano come **Bozza**. L'Architect (sei tu) fa una rapida revisione — nome corretto, descrizione sensata, ciclo di vita giusto.
2. Una volta compilati i campi minimi, **approvare** la card. Questo segnala ai consumatori a valle che la card è affidabile.
3. Se qualcuno modifica successivamente un campo sostanziale, Turbo EA passa automaticamente lo stato a **Broken** finché non viene riapprovata.

Filtrare l'inventario per `Stato di approvazione = Approvata` per ottenere una vista pulita per il portfolio report alla fine di questa guida.

!!! tip "Buona pratica"
    Approvare a lotti alla fine di ogni giornata. Costringe a rileggere ciò che è stato importato e a individuare in anticipo i peggiori problemi di qualità dei dati.

## Quando smettere di popolare e passare oltre

Questa pagina è completata quando:

- Ogni applicazione in ambito ha una card.
- Ogni card ha i cinque campi minimi compilati.
- La qualità dei dati media sull'insieme è **≥ 40%**.
- Almeno il 50% delle card è approvato.

Non aspettare la perfezione. Passare alla pagina successiva — [Sfruttare i cataloghi di riferimento](leverage-reference-catalogues.md) — e tornare ad arricchire dopo aver mappato le capability.
