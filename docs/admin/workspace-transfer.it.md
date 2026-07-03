# Trasferimento del workspace

Il Trasferimento del workspace (**Amministrazione → Impostazioni → Migrazione → Trasferimento del workspace**) sposta un intero workspace di Turbo EA da un'istanza a un'altra come un unico bundle autocontenuto. Il caso d'uso principale: costruite un workspace su un'istanza **locale** e dovete promuovere tutto in **Produzione**.

![Trasferimento del workspace](../assets/img/it/58_workspace_transfer.png)

## Cosa è incluso

L'esportazione cattura il workspace completo come bundle `.zip` contenente una cartella di lavoro Excel (tutti i dati strutturati, un foglio per dominio) e, dove rilevante, una cartella `assets/` per i file non strutturati:

- **Metamodello** — tipi di carta e tipi di relazione, inclusi tutti i campi personalizzati, sottotipi, sezioni e traduzioni.
- **Configurazione** — ruoli, ruoli stakeholder per tipo, gruppi di tag e tag, campi calcolati, principi EA e regolamenti di compliance.
- **Impostazioni** — valuta, formato data, feature flag, branding di login, locale abilitate e il resto delle impostazioni generali dell'applicazione.
- **Utenti** — email, nome visualizzato, ruolo e flag di attività (usati per ricollegare proprietà e assegnazioni sul target). Nessuna password né identità SSO.
- **Inventario** — ogni carta (con la sua gerarchia, ciclo di vita e attributi), tag delle carte e relazioni.
- **Contesto delle carte** — stakeholder, collegamenti a documenti, commenti, todo e allegati di file.
- **Dati dei moduli** — BPM (diagrammi di processo, elementi, versioni di flusso, valutazioni), PPM (report di stato, costi, budget, rischi, attività, WBS, dipendenze), il registro dei rischi GRC (rischi, attività di mitigazione e relative occorrenze, collegamenti alle carte), le rilevazioni di conformità GRC (con le esecuzioni di analisi a cui fanno riferimento), decisioni architetturali e Statement of Architecture Work, diagrammi a mano libera, report salvati, segnalibri (viste salvate dell'inventario, incluse le loro condivisioni), portali web e sondaggi.
- **Asset** — gli allegati binari, l'XML dei diagrammi e BPMN e il logo/favicon viaggiano come file separati all'interno della cartella `assets/` del bundle.

## Cosa non è mai incluso

Per ragioni di sicurezza, **i segreti non vengono mai esportati**:

- Password SMTP
- Client secret SSO
- Chiave API del provider AI
- Credenziali ServiceNow

Dovete reinserirli sull'istanza target dopo l'importazione. Questo è inevitabile per progettazione: i valori cifrati sono legati alla `SECRET_KEY` dell'istanza di origine e non possono essere decifrati altrove.

Alcune altre cose restano indietro per progettazione:

- **I risultati delle analisi TurboLens** (analisi dei vendor, cluster di duplicati, valutazioni di modernizzazione, valutazioni di architettura salvate) e lo storico dei KPI della dashboard sono locali all'istanza — rieseguite le analisi sul target. Le rilevazioni di conformità sono l'eccezione e vengono trasferite.
- **Lo stato locale del browser** non viene mai trasferito: l'ordinamento ad hoc delle colonne della griglia dell'inventario vive nel local storage del vostro browser, non nel database. Il layout delle colonne salvato **all'interno di una vista salvata** viene invece trasferito con la vista.

## Esportazione

1. Aprite **Amministrazione → Impostazioni → Migrazione → Trasferimento del workspace**.
2. (Opzionale) spuntate **Includi carte archiviate** per aggiungere l'inventario archiviato al bundle.
3. Cliccate **Esporta bundle**. Il browser scarica `workspace_export_<timestamp>.zip`.

## Importazione

1. Sull'istanza **target**, aprite **Amministrazione → Impostazioni → Migrazione → Trasferimento del workspace**.
2. Sotto **Importa workspace**, cliccate **Scegli bundle…** e selezionate il `.zip` che avete esportato.
3. Turbo EA analizza il bundle e mostra un'**anteprima dry-run** — una tabella per sezione di quante entità verrebbero create, aggiornate, saltate o sono in conflitto. Nulla viene ancora scritto.
4. Revisionate l'anteprima, poi cliccate **Applica importazione**.

L'importazione è **idempotente**: il metamodello e la configurazione sono abbinati per chiave, le carte per id esterno o per tipo + percorso gerarchico, e gli utenti per email. Reimportare lo stesso bundle è sicuro — le entità già presenti vengono saltate invece che duplicate. I tipi di metamodello built-in esistenti mantengono la loro identità; solo il loro schema modificabile viene unito.

### Come leggere l'anteprima

- **«Saltato» significa «già presente — nessuna azione necessaria».** Su un'installazione nuova vedrete tipicamente elementi saltati per i contenuti forniti con Turbo EA (ruoli stakeholder, tipi di risorsa, impostazioni predefinite), perché la copia nel bundle è identica a ciò che il target ha già. Espandete una riga di sezione (la freccia a sinistra) per vedere il dettaglio per motivo ed eventuali messaggi di conflitto o di errore.
- **Avviso di versione.** L'anteprima mostra da quale versione di Turbo EA è stato esportato il bundle e avverte quando differisce dall'istanza che importa. L'avviso è solo informativo — l'importazione viene comunque eseguita — ma esportare e importare sulla stessa versione è la via più sicura.

## Dopo l'importazione

- Reinserite le credenziali SMTP, SSO e AI nelle rispettive schede delle impostazioni.
- Gli utenti sintetici referenziati dal bundle vengono creati **disattivati**; attivateli in **Amministrazione → Utenti** secondo necessità.
- **I dati di proprietà degli utenti seguono l'utente, abbinato per email.** Todo, viste salvate, preferiti e altri dati personali appartengono all'account la cui email corrisponde a quella nel bundle. Se accedete al target con un'email diversa da quella usata sull'origine, i vostri elementi personali sembreranno mancare — sono collegati all'account corrispondente (eventualmente disattivato). Accedete con la stessa email, oppure attivate l'account corrispondente in **Amministrazione → Utenti**.
- Le viste salvate private sono visibili solo al loro proprietario; le viste condivise e pubbliche seguono le rispettive impostazioni di visibilità.

## Ripartire da zero

Non esiste una funzione integrata di «annulla importazione». Per reimpostare un'istanza target e reimportare da zero, riavviatela una volta con `RESET_DB=true` (elimina e ricrea tutte le tabelle, poi riesegue il seeding), quindi reimpostate `RESET_DB=false` **prima** del riavvio successivo per non cancellare i dati appena importati.

## Permessi

Il Trasferimento del workspace è protetto da due permessi dedicati, entrambi concessi agli amministratori:

- `admin.export_workspace` — esportare il bundle.
- `admin.import_workspace` — visualizzare l'anteprima e applicare un'importazione.
