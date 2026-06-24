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
- **Dati dei moduli** — BPM (diagrammi di processo, elementi, versioni di flusso, valutazioni), PPM (report di stato, costi, budget, rischi, attività, WBS, dipendenze), il registro dei rischi GRC (rischi, attività di mitigazione e relative occorrenze, collegamenti alle carte), decisioni architetturali e Statement of Architecture Work, diagrammi a mano libera, report salvati, segnalibri, portali web e sondaggi.
- **Asset** — gli allegati binari, l'XML dei diagrammi e BPMN e il logo/favicon viaggiano come file separati all'interno della cartella `assets/` del bundle.

## Cosa non è mai incluso

Per ragioni di sicurezza, **i segreti non vengono mai esportati**:

- Password SMTP
- Client secret SSO
- Chiave API del provider AI
- Credenziali ServiceNow

Dovete reinserirli sull'istanza target dopo l'importazione. Questo è inevitabile per progettazione: i valori cifrati sono legati alla `SECRET_KEY` dell'istanza di origine e non possono essere decifrati altrove.

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

## Dopo l'importazione

- Reinserite le credenziali SMTP, SSO e AI nelle rispettive schede delle impostazioni.
- Gli utenti sintetici referenziati dal bundle vengono creati **disattivati**; attivateli in **Amministrazione → Utenti** secondo necessità.

## Permessi

Il Trasferimento del workspace è protetto da due permessi dedicati, entrambi concessi agli amministratori:

- `admin.export_workspace` — esportare il bundle.
- `admin.import_workspace` — visualizzare l'anteprima e applicare un'importazione.
