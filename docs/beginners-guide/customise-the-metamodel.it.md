# Personalizzare il metamodello — con leggerezza

Il metamodello di Turbo EA è completamente **configurabile da amministratore** — ogni tipo di card, campo, sottotipo, relazione e ruolo stakeholder è dato, non codice. Si sarà tentati di ridisegnarlo. **Non farlo.**

I team che hanno successo personalizzano il metamodello **solo quando i campi di default non possono rispondere alla loro domanda**. I team che falliscono passano il primo mese a rinominare `Application` in `Solution`, aggiungendo 30 campi personalizzati, senza mai arrivare a un report funzionante.

## Il test delle due domande prima di aggiungere un campo

Prima di aggiungere un singolo campo personalizzato, chiedersi:

1. **Filtrerò, raggrupperò o farò report su questo campo?** Se no, appartiene alla descrizione o a un tag — non a un campo.
2. **La stessa risposta serve su ogni card di questo tipo?** Se no, è una relazione o un allegato, non un campo.

Se non si può rispondere "sì" a entrambe, non aggiungere il campo.

## Esempio pratico: aggiungere una disposizione TIME

Per una Razionalizzazione del portfolio applicativo serve una singola decisione per applicazione: **T**olerate / **I**nvest / **M**igrate / **E**liminate (il framework **TIME**, reso popolare da Gartner). Il metamodello integrato non include un campo `timeDisposition`, quindi questo è uno dei rari casi in cui aggiungere un campo personalizzato è la scelta giusta.

Lo aggiungeremo come campo `single_select` sul tipo `Application`, con quattro opzioni codificate a colore, peso 1 in modo che contribuisca alla qualità dei dati.

### Passo 1 — Aprire l'editor del tipo

1. Andare in **Admin → Metamodello**.
2. Cliccare sulla card del tipo **Application**.
3. Il drawer del tipo si apre sulla destra. Passare alla tab **Campi**.

### Passo 2 — Aggiungere il campo

1. Scegliere la sezione in cui far comparire il campo (o creare una nuova sezione chiamata "Decisione di Portfolio").
2. Cliccare **+ Aggiungi campo** in quella sezione.
3. Compilare:
    - **Key**: `timeDisposition`  *(lower camel-case, senza spazi, diventa la chiave attributo in JSON)*
    - **Label**: *Disposizione di Portfolio (TIME)*
    - **Type**: `single_select`
    - **Weight**: `1`  *(contribuisce al punteggio di Data Quality)*
    - **Required**: lasciare **off** — required bloccherebbe l'approvazione di ogni card esistente.
4. Aggiungere le quattro opzioni:

    | Key | Label | Colore |
    |-----|-------|--------|
    | `tolerate` | Tollerare | grigio / neutro |
    | `invest` | Investire | verde |
    | `migrate` | Migrare | ambra |
    | `eliminate` | Eliminare | rosso |

5. **Aggiungere le traduzioni** per la label e per ogni opzione in ogni locale supportato — la pagina 4 di [Admin → Metamodello](../admin/metamodel.md) descrive l'editor di traduzioni. Saltare questo passaggio significa che gli utenti non anglofoni vedranno "timeDisposition" tale e quale.
6. Salvare.

### Passo 3 — Verificare che funzioni

1. Aprire una qualsiasi card Applicazione. Il nuovo campo appare nella sua sezione, vuoto.
2. Scegliere un valore, salvare. L'anello della Data Quality dovrebbe aumentare di qualche punto percentuale.
3. Tornati in **Inventario**, il campo è ora disponibile nella tab **Colonne** e come filtro — è già possibile filtrare le applicazioni per TIME.

Tutto qui. Un campo, dieci minuti, immediatamente utile.

## Alternativa: usare un Tag Group

Se il valore è informativo piuttosto che interrogabile, un **Tag Group** (Admin → Tag) è più leggero di un campo personalizzato — nessuna modifica al metamodello, nessuna migrazione, più facile da far evolvere. Usare un Tag Group quando:

- Il valore è descrittivo ("Customer-facing", "Solo interna", "Acquisita nel 2024").
- Si possono aggiungere nuove opzioni di frequente.
- Non serve in un menu a tendina di filtro ma va bene un tag chip con ricerca digitando.

Usare un campo personalizzato quando:

- Serve il valore sugli assi del Portfolio Report (X, Y, colore).
- Lo si vuole pesare nella Data Quality.
- È un vocabolario controllato che non cambierà spesso.

La disposizione TIME è nel campo dei campi personalizzati perché la useremo come asse colore del Portfolio Report nella prossima pagina.

## Anti-pattern da evitare

Questi sono gli errori più comuni sul metamodello nei primi rollout:

!!! warning "Non rinominare i tipi di card integrati"
    Rinominare `Application` in `Solution` sembra ordinato ma rompe la mappatura concettuale che Capability Heatmap, Portfolio Report e i cataloghi danno per scontata. Se la propria organizzazione li chiama "Solutions", impostare la traduzione della **label** — la `key` sottostante rimane `Application`.

!!! warning "Non aggiungere 30 campi personalizzati il primo giorno"
    Ogni campo personalizzato aggiunge attrito alla raccolta dati e diluisce il punteggio di Data Quality. Aggiungere un campo, usarlo per un mese, poi aggiungere il successivo.

!!! warning "Non rendere `required` i nuovi campi il primo giorno"
    `Required` blocca l'approvazione per ogni card esistente che non ha un valore. Rendere un campo required solo **dopo** averlo compilato per oltre l'80% della popolazione.

!!! warning "Non creare tipi di card personalizzati al posto di campi personalizzati"
    "Mobile App" dovrebbe essere un sottotipo di `Application`, non un nuovo tipo di card. I nuovi tipi non ottengono gratis mappatura delle capability, portfolio report o import dai cataloghi.

## Altre estensioni leggere che potrebbero servire

Queste sono comuni estensioni di secondo passaggio, ma **non aggiungerle finché non servono davvero**:

| Esigenza | Dove aggiungerla | Tipo |
|----------|------------------|------|
| Rating di valore di business | Application | `single_select` (High/Medium/Low) — guida l'asse Y del Portfolio Report |
| Rating di idoneità tecnica | Application | `single_select` — guida l'asse X |
| Cloud readiness | Application | `single_select` (Ready / Needs refactor / Stays on-prem) |
| Categoria di rischio di perdita | Application, IT Component | `single_select` (Single point of failure, ecc.) |
| Suddivisione dei costi | Application | campi `cost` per `costRunTotalAnnual`, `costChangeTotalAnnual` |

Ciascuno supera il test delle due domande per l'analytics di portfolio. Ciascuno è anche un buon candidato per una formula calcolata anziché un inserimento manuale — che è ciò che copre la pagina successiva.

Successivo: [La prima analisi: Armonizzazione applicativa](your-first-analysis.md).
