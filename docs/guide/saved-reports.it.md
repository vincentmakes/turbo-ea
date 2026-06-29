# Report salvati

Turbo EA consente di **salvare le configurazioni dei report** per poter tornare rapidamente a viste specifiche senza dover riconfigurare filtri e assi ogni volta.

## Salvare un report

Da qualsiasi pagina di report (Portfolio, Mappa delle Capability, Ciclo di vita, Dipendenze, Costi, Matrice, Qualità dei Dati o EOL):

1. Configurate il report con i filtri, i raggruppamenti e le selezioni degli assi desiderati
2. Cliccate sul pulsante **Salva** nella barra degli strumenti del report
3. Inserite un **nome** per il report salvato
4. Scegliete la **visibilità**:

| Visibilità | Chi può vederlo |
|------------|-----------------|
| **Privato** | Solo voi |
| **Condiviso** | Voi e gli utenti specifici che selezionate |
| **Pubblico** | Tutti gli utenti della piattaforma |

Per i report condivisi, potete concedere **permessi di modifica** a utenti specifici, consentendo loro di aggiornare la configurazione salvata.

5. Cliccate su **Salva** — una miniatura viene catturata automaticamente dalla visualizzazione corrente

## Galleria dei report salvati

Navigate su **Report > Report salvati** per sfogliare tutti i report salvati a cui avete accesso. La galleria mostra anteprime in miniatura organizzate in schede:

- **I miei report** — Report da voi creati
- **Condivisi con me** — Report che altri hanno condiviso con voi
- **Pubblici** — Report visibili a tutti

### Azioni

- **Apri** — Cliccate su un report per caricarlo con la configurazione salvata
- **Modifica** — Aggiornate il nome, la visibilità o le impostazioni di condivisione
- **Duplica** — Create una copia con un nuovo nome
- **Elimina** — Rimuovete il report salvato (solo il creatore o gli utenti con permessi di modifica possono eliminare)

## Report personalizzati con il tuo assistente IA

Oltre ai tipi di report integrati, Turbo EA può creare **report completamente personalizzati** a partire da una descrizione in linguaggio naturale, tramite un assistente IA collegato attraverso il **server MCP**.

### Come funziona

1. Collega il server MCP di Turbo EA al tuo assistente IA (ad esempio Claude Code) — vedi la guida **Integrazione MCP**.
2. Descrivi il report desiderato in linguaggio naturale, ad esempio *«Conta le applicazioni per criticità di business come grafico a torta»* o *«Costo annuale totale dei componenti IT raggruppati per fornitore»*.
3. L'assistente chiama `get_report_builder_schema` per leggere il tuo metamodello in tempo reale (tipi di carta, campi, relazioni, tag), assembla una **specifica** di report sicura e la mostra in anteprima sui tuoi dati reali con `preview_custom_report`, così vedi risultati reali prima di salvare qualsiasi cosa.
4. Quando sei soddisfatto, l'assistente **pubblica** il report con `create_saved_report`. Compare nella galleria **Report salvati** e si apre come report nativo e interattivo.

### Cosa possono fare i report personalizzati

- **Consapevoli del metamodello**: i tuoi tipi di carta, sottotipi, campi, relazioni e tag vengono riflessi automaticamente, senza programmazione.
- **Raggruppare e aggregare**: raggruppare per attributo, sottotipo, fase del ciclo di vita, gruppo di tag o carta correlata, e misurare con conteggio, somma, media, minimo o massimo.
- **Filtrare e attraversare**: filtrare le carte di origine e, facoltativamente, seguire un salto di relazione verso carte correlate.
- **Molte visualizzazioni**: mostrare come tabella, grafico a barre/colonne/torta/ciambella/dispersione/treemap/linee, o come riquadri KPI.
- **Sicuro e governato**: i report sono di sola lettura, funzionano interamente su regole dichiarative (niente codice, niente SQL), e i campi di costo restano dietro l'autorizzazione **Visualizza costi**, esattamente come ogni altro report.

I report personalizzati vengono salvati come qualsiasi altro report, quindi si applicano le stesse opzioni di visibilità e condivisione (privato / condiviso / pubblico).
