# Lingue personalizzate

Turbo EA è fornito con dieci lingue integrate. Quando la tua organizzazione ne ha bisogno di un'altra — olandese, polacco, ebraico, hindi, thailandese, una variante regionale come il portoghese brasiliano —, un amministratore può aggiungerla come **lingua personalizzata** e compilarne le traduzioni senza attendere una nuova versione.

Una lingua personalizzata risiede nel tuo database, non nel codice dell'applicazione. La aggiungi, la traduci, la rivedi e la offri ai tuoi utenti quando è pronta. Le lingue integrate non ne sono influenzate.

Una lingua personalizzata copre l'intera interfaccia utente **e** i nomi che il tuo metamodello dà alle cose: tipi di card, sottotipi, sezioni, campi e le loro opzioni, relazioni, ruoli degli stakeholder, categorie, dashboard, normative, tipi di risorsa e la guida alle fasi del ciclo di vita.

Per tutto ciò che si trova in questa pagina serve il permesso **admin.settings**.

## Aggiungere una lingua personalizzata

Vai in **Admin > Impostazioni > Generali**. La sezione **Lingue personalizzate** si trova subito sotto [Lingue abilitate](settings.md#lingue-abilitate).

Fai clic su **Aggiungi lingua** e compila:

| Campo | Descrizione |
|-------|-------------|
| **Codice lingua** | Un codice lingua breve: due o tre lettere minuscole, seguite facoltativamente da una scrittura (`zh-Hant`) e da una regione di due lettere maiuscole (`pt-BR`) — `nl`, `he`, `hi`, `th`, `pt-BR`. Non può essere il codice di una lingua integrata. |
| **Nome nativo** | Il nome che gli utenti vedono nel menu lingua, scritto nella lingua stessa — *Nederlands*, *עברית*, *हिन्दी*, *ไทย*. |
| **Nome in inglese** | Il nome della lingua in inglese — *Dutch*, *Hebrew*. È la lingua in cui si indica al provider IA di tradurre. Solo lettere, spazi, parentesi e trattini. |
| **Scrittura da destra a sinistra** | Attivala per una lingua scritta da destra a sinistra, come ebraico, persiano o urdu. È disattivata per impostazione predefinita; la finestra di dialogo lo segnala quando il codice è di una lingua di solito scritta da destra a sinistra, ma non la attiva mai al posto tuo. |

Qualsiasi scrittura funziona: latina, cirillica, ebraica, araba, devanagari, thai e altre, compresi i caratteri di legatura e i segni di cui queste scritture hanno bisogno. Con **Scrittura da destra a sinistra** attivata, l'intera applicazione viene disposta da destra a sinistra per gli utenti che scelgono la lingua, come avviene per l'arabo.

Una lingua regionale è una lingua a sé: `pt-BR` non prende nulla dal portoghese integrato, e `zh-Hant` non prende nulla dal cinese integrato. Finché una stringa non è tradotta, viene mostrata in inglese.

Una nuova lingua parte disattivata: gli utenti non la vedono finché non la offri. Ogni lingua nell'elenco mostra una barra di avanzamento con quante stringhe sono tradotte, e due contatori:

- **Mancanti** — stringhe che non hanno ancora una traduzione.
- **Modificate in inglese** — stringhe che erano tradotte, ma il cui testo inglese è cambiato da allora. Finché non vengono tradotte di nuovo, gli utenti vedono la vecchia traduzione, che di solito è meglio del ripiego sull'inglese.

Offri una lingua ai tuoi utenti con il suo interruttore. Gli utenti potranno sceglierla dal menu lingua, come qualsiasi lingua integrata. Le stringhe ancora mancanti compaiono in inglese.

## Installare una lingua dalla libreria della community

Altri utenti di Turbo EA condividono le loro traduzioni nella [libreria di lingue della community](https://github.com/vincentmakes/turbo-ea-translations). Sotto le tue lingue, il blocco **Lingue della community** elenca le lingue che contiene, ciascuna con il suo nome nativo e il suo codice, la quota di interfaccia che traduce e la versione di Turbo EA con cui è stato creato il suo pacchetto.

!!! warning "Fornita dalla community, non revisionata"
    I pacchetti sono scritti da membri della community. **Il progetto Turbo EA non li rivede.** Controlli automatici garantiscono che un pacchetto non possa aggiungere markup, link o segnaposto non validi che il testo inglese non ha, ma nessuno verifica se le traduzioni siano accurate o complete. Rivedi una lingua prima di offrirla ai tuoi utenti.

**Installa** scarica il pacchetto della lingua e lo importa. Ecco cosa succede:

- Il pacchetto viene scaricato dalla libreria della community — esattamente il file che la libreria elenca, verificato con il suo checksum.
- Ogni stringa passa gli stessi controlli di un [file importato](#the-language-pack-file); una stringa rifiutata compare nel rapporto e non viene mai salvata.
- Una nuova lingua viene aggiunta **disattivata**. Guardala in **Rivedi le stringhe**, poi attivala per i tuoi utenti.
- Il rapporto mostra cosa è stato applicato, cosa è stato rifiutato e perché, e cosa non esiste nella tua versione di Turbo EA.

La lingua risulta quindi **installata** e la sua riga nel tuo elenco riporta l'indicazione **Fornita dalla community, non revisionata**. Un'installazione non riuscita — un pacchetto che non può essere scaricato, non corrisponde al checksum della libreria o non è un pacchetto valido — non installa nulla ed è registrata nel [registro Sicurezza e amministrazione](audit-log.md). In **Rivedi le stringhe**, ogni traduzione mostra la sua origine — *Libreria della community*, *Corretta a mano*, *Traduzione IA*, *File importato* o *MCP*.

Quando la libreria ha un pacchetto più recente di una lingua che hai installato da essa, la lingua mostra **Aggiornamento disponibile**. **Aggiorna** unisce il nuovo pacchetto alla tua lingua. Le stringhe che hai corretto a mano vengono mantenute, a meno che tu non selezioni **Sostituisci anche le stringhe corrette a mano**. Nome, direzione e interruttore della tua lingua restano invariati.

Se hai aggiunto tu stesso una lingua e la libreria ha lo stesso codice, la sua riga mostra **Aggiunta su questo server** e offre **Aggiungi le stringhe della community**: il pacchetto viene unito alla tua lingua allo stesso modo — le stringhe corrette a mano vengono mantenute a meno che tu non scelga diversamente — e la lingua viene poi contrassegnata come fornita dalla community.

Turbo EA contatta la libreria solo quando lo chiedi: la prima volta che la sezione viene mostrata, l'elenco viene scaricato e conservato; poi viene mostrato l'elenco conservato (con la data del download) finché non fai clic su **Aggiorna**. Nulla viene controllato in background, quindi un pacchetto più recente compare come **Aggiornamento disponibile** solo dopo un aggiornamento. Se la libreria non è raggiungibile, il blocco lo segnala e continua a mostrare l'elenco dell'ultimo download riuscito.

### Disattivare la libreria

L'indirizzo della libreria è impostato dalla variabile d'ambiente `LANGUAGE_CATALOGUE_URL` (valore Helm `customLanguages.catalogueUrl`). Impostala su un valore vuoto per disattivare la funzione, ad esempio in un'installazione senza accesso a internet; il blocco indica allora che la libreria della community è disattivata. Puoi anche puntarla a una copia della libreria sul tuo server: i pacchetti vengono scaricati dai file `packs/<code>/pack.json` accanto al suo `index.json`.

### Contribuire con una lingua

Hai tradotto una lingua che non è ancora nella libreria, o ne hai migliorata una? Esportala con **Esporta pacchetto lingua > Condividi (pacchetto della community)** e proponila alla libreria — vedi la sua [guida al contributo](https://github.com/vincentmakes/turbo-ea-translations/blob/main/CONTRIBUTING.md).

## Tre modi per tradurre

Usa quello che preferisci; si possono combinare e il risultato è lo stesso.

### 1. Esportare un file e reimportarlo

**Esporta pacchetto lingua** scarica un file di pacchetto lingua (JSON). Scegli cosa contiene:

- **Stringhe nuove e modificate (da tradurre)** — il testo inglese di ogni stringa mancante o modificata. Usalo per la prima traduzione e dopo ogni aggiornamento.
- **Tutte le stringhe in inglese (da tradurre)** — il testo inglese di ogni stringa, per tradurre di nuovo tutto.
- **Traduzioni attuali (comprese le etichette proprie di questa installazione)** — le traduzioni che hai già, compresi i nomi del tuo metamodello. Usalo come backup o per spostare la lingua in un'altra tua installazione.
- **Condividi (pacchetto della community)** — le traduzioni che hai già, ma solo ciò che è uguale in ogni installazione di Turbo EA: il testo dell'interfaccia e i nomi del metamodello integrato così come li fornisce Turbo EA. Tutto ciò che è specifico della tua installazione viene escluso — tipi di card, campi e opzioni che hai creato, nomi integrati che hai rinominato, le tue dashboard e categorie. È il file da condividere con altri utenti di Turbo EA.

Traduci il file dove preferisci — un'agenzia di traduzione, uno strumento di traduzione o una chat IA — poi scegli **Importa pacchetto lingua**. L'importazione controlla il file, salva le stringhe una sezione alla volta e mostra un rapporto: quante stringhe sono state applicate, lasciate invariate o cancellate, quali sono state rifiutate e perché, e quali chiavi non sono presenti in questa versione.

### 2. Tradurre con il tuo provider IA

Se un provider IA è configurato in [Funzionalità IA](ai.md), **Traduci con IA** traduce la lingua in background. Scegli:

- **Stringhe nuove e modificate** — solo quelle mancanti e modificate. È la scelta abituale.
- **Tutto** — ogni stringa di nuovo. Le stringhe che hai corretto a mano vengono mantenute, a meno che tu non selezioni anche **Sostituisci anche le stringhe corrette a mano**.

La finestra mostra quante stringhe verranno inviate, poi l'avanzamento durante l'esecuzione; puoi chiuderla e tornare, oppure **Interrompi la traduzione**. I nomi dei tuoi tipi di card, campi e relazioni vengono tradotti per primi, poi il resto dell'interfaccia viene tradotto usando quei nomi come riferimento, così la stessa cosa si chiama allo stesso modo ovunque. Una stringa che l'IA restituisce in una forma inutilizzabile non viene salvata; resta mancante e viene ritentata alla prossima esecuzione.

Questa opzione non dipende dall'attivazione dei suggerimenti di descrizione IA per le card — solo dalla configurazione di un provider.

### 3. Tramite un assistente IA (MCP)

Un assistente IA collegato tramite l'[integrazione MCP](mcp.md) può tradurre la lingua al posto tuo, usando tre strumenti:

- `list_custom_languages` — quali lingue personalizzate esistono e a che punto è la traduzione di ciascuna.
- `get_untranslated_strings` — le stringhe inglesi ancora da tradurre, pagina per pagina, con le istruzioni di traduzione.
- `submit_translations` — rimanda indietro le traduzioni. Mostra prima un'anteprima e salva dopo la conferma, come ogni strumento di scrittura MCP.

Chiedi all'assistente, per esempio: *«Traduci le stringhe mancanti della nostra lingua personalizzata olandese, partendo dai nomi del metamodello.»* L'assistente lavora con i tuoi permessi e ogni modifica che fa viene registrata nel registro di audit.

## Il file del pacchetto lingua

Un pacchetto lingua è un file JSON come questo:

```json
{
  "format": "turbo-ea-language-pack",
  "format_version": 1,
  "app_version": "2.214.0",
  "locale": {"code": "nl", "name": "Nederlands", "english_name": "Dutch", "rtl": false},
  "mode": "missing",
  "instructions": "Translate every value under \"strings\" from English into Dutch. …",
  "strings": {
    "metamodel": {
      "type.Application.label": "Application",
      "type.Application.field.businessCriticality": "Business Criticality"
    },
    "common": {
      "actions.save": "Save",
      "actions.cancel": "Cancel"
    }
  },
  "source_hashes": {
    "metamodel": {
      "type.Application.label": "5c1e0a9d7b32",
      "type.Application.field.businessCriticality": "a90d3f17c4e8"
    },
    "common": {
      "actions.save": "1f3a9c0b2d4e",
      "actions.cancel": "7b2e4d6a8c01"
    }
  }
}
```

- **strings** contiene il testo da tradurre, raggruppato per sezione (`metamodel`, `common`, `admin`, `cards`, …). Traduci solo i **valori**; non cambiare mai le chiavi.
- La sezione **metamodel** contiene i nomi di tipi di card, campi, opzioni, relazioni e le altre etichette memorizzate nel tuo database. Sono etichette brevi a cui si riferisce il resto dell'interfaccia: traducile per prime e usa le stesse parole ovunque altrove.
- Mantieni esattamente com'è tutto ciò che è tra doppie parentesi graffe, come `{{count}}` o `{{name}}`: l'applicazione vi inserisce un valore. Mantieni anche i tag come `<1>` e `</1>` e i riferimenti come `$t(common:actions.save)`.
- **source_hashes** registra da quale testo inglese è stata ricavata ogni stringa. Lascialo nel file: all'importazione indica a Turbo EA se l'inglese è cambiato dall'esportazione del file. Per la sezione **metamodel** è obbligatorio — una voce senza il suo hash viene rifiutata — perché è ciò che impedisce a una traduzione di finire su un nome nel frattempo rinominato.
- **instructions** ripete queste regole in parole semplici, così puoi consegnare il file così com'è a un traduttore o a una chat IA.

All'importazione, ogni stringa viene controllata singolarmente. Una chiave che questa versione di Turbo EA non ha — proveniente da un pacchetto creato per un'altra versione — viene contata come non presente in questa versione e nominata nel rapporto. Una stringa viene rifiutata quando è vuota o molto più lunga dell'inglese, quando perde o aggiunge un segnaposto o un riferimento `$t(...)`, o quando introduce un tag o un link che il testo inglese non ha. Nella sezione **metamodel** una traduzione viene inoltre rifiutata se non ha l'hash, e saltata se il nome da cui è stata ricavata è cambiato dall'esportazione del file — una traduzione di «Application» non finisce mai su un tipo di card che qualcuno ha rinominato. Una traduzione identica a quella già memorizzata viene segnalata come invariata. Una stringa rifiutata non impedisce mai di salvare le altre.

Un file esportato per un altro codice lingua può comunque essere importato; prima ti viene chiesta conferma.

## Rivedere e correggere le stringhe

**Rivedi le stringhe** elenca le stringhe di una lingua con il testo inglese accanto a ogni traduzione. Filtra per sezione, per stato (mancanti, modificate in inglese, tradotte) o per testo, e modifica o cancella qualsiasi traduzione direttamente. Le tue correzioni hanno effetto non appena le salvi.

## Dopo un aggiornamento

Ogni versione di Turbo EA aggiunge e modifica un po' di testo inglese, e tu puoi rinominare elementi del tuo metamodello. Dopo, la lingua personalizzata mostra le nuove stringhe come **mancanti** e quelle cambiate come **modificate in inglese** — tutto il resto mantiene la propria traduzione. Colma la differenza in uno dei tre modi sopra: esporta le stringhe nuove e modificate, avvia **Traduci con IA** con **Stringhe nuove e modificate**, oppure chiedilo al tuo assistente.

Le correzioni fatte a mano vengono mantenute. Un'esecuzione IA su **Tutto** le lascia stare, a meno che tu non selezioni **Sostituisci anche le stringhe corrette a mano**.

## Limiti

- **Il sito della documentazione non è coperto.** Questo manuale resta nelle lingue integrate.
- **I sondaggi mantengono le etichette con cui sono stati creati.** Un sondaggio creato prima che le opzioni di un campo fossero tradotte mantiene le etichette delle opzioni con cui è stato creato.
- **Forme plurali.** L'inglese ha due forme plurali (*one card*, *2 cards*). Una lingua che ne ha di più — come polacco, russo o arabo — può aggiungere le sue forme extra (`_few`, `_many`, …) accanto a quelle inglesi in un file importato. Una forma che il pacchetto non contiene ricade sulla forma generale della lingua (la traduzione `_other`), mai sull'inglese. Anche la traduzione IA e la schermata di revisione lavorano sulle forme extra già memorizzate, ma non ne creano di nuove: aggiungile tramite un file.
- L'eliminazione di una lingua personalizzata rimuove tutte le sue traduzioni, compresi i nomi di tipi di card, campi e delle altre etichette del metamodello. Gli utenti che l'avevano scelta tornano all'inglese.
