# Digital Autonomy Assessment

**Digital Autonomy Assessment** porta in Turbo EA il **Digital Autonomy
Assessment Framework (DAAF)** dell'Università di Utrecht, a livello di
applicazione. Aggiunge una sezione **Autonomia digitale** a ogni scheda
Applicazione — 22 indicatori ponderati suddivisi tra esposizione al rischio,
capacità di mitigazione e importanza strategica, ciascuno valutato da 1 a 5
secondo la rubrica originale del DAAF e con guida contestuale —, calcola
automaticamente un punteggio di autonomia da 1 a 10 e colloca l'intero portfolio
su un **quadrante di autonomia**.

Risponde a una domanda che la maggior parte delle mappature lascia aperta: *se
questo fornitore domani non fosse più disponibile, non fosse più sostenibile o non
fosse più utilizzabile sul piano giuridico, quanto saremmo esposti e che cosa
potremmo davvero fare?*

## In sintesi

| | |
|---|---|
| **Licenza** | **Gratuita** — funziona senza alcun diritto di licenza |
| **Versione minima di Turbo EA** | 2.17.0 |
| **Permesso** | `ext.digital-autonomy.view` |
| **Autorizzazioni di accesso ai dati** | nessuna |
| **Riavvio del backend necessario** | no |
| **Dove compare** | Sezioni **Autonomia digitale** e **Punteggio di autonomia digitale** sulle schede Applicazione · **Report → Autonomia digitale** · **Nuovo da modello** nella pagina dei sondaggi |

## Primi passi

1. Installate l'estensione da **Admin → Estensioni**. Non c'è alcuna licenza da
   applicare né alcun riavvio: i campi compaiono subito.
2. Assegnate `ext.digital-autonomy.view` in **Admin → Utenti e ruoli** ai ruoli che
   devono vedere il report. Gli amministratori lo hanno già.
3. Decidete se volete la valutazione **rapida** o quella **completa** — si veda
   [Valutazione rapida o completa](#valutazione-rapida-o-completa). La versione
   completa a 22 indicatori è attiva di serie.
4. Valutate le vostre applicazioni, scheda per scheda oppure
   [tramite sondaggio](#raccogliere-le-valutazioni-tramite-sondaggio).

## Gli indicatori

La sezione **Autonomia digitale** compare su ogni scheda Applicazione, raggruppata
in otto dimensioni (A–H). Ogni indicatore si valuta da **1 a 5** con una propria
rubrica.

![La sezione «Autonomia digitale» su una scheda Applicazione](../assets/img/en/65_ext_digital_autonomy_indicators.png)

Fate clic su un numero per assegnare il punteggio; un nuovo clic sul numero
selezionato lo cancella. Passando il mouse su un numero compare il testo della
rubrica per quel livello, e ogni indicatore offre una **guida** espandibile con la
nota esplicativa del DAAF e le definizioni dei termini impiegati (*decisione di
adeguatezza*, *CLOUD Act*, *FISA 702* e altri).

Gli indicatori contrassegnati **Rapida** compongono la valutazione rapida.

| Dimensione | Indicatore | Peso | Rapida |
|---|---|---|---|
| **A · Rischio geopolitico e di conformità giuridica** | A1 · Giurisdizione del fornitore | 3 | ✔ |
| | A2 · Sanzioni e rischio geopolitico | 2 | |
| | A3 · Hosting e ubicazione dei dati | 2 | ✔ |
| **B · Dipendenze da fornitori e catena di fornitura** | B1 · Concentrazione dei fornitori | 3 | ✔ |
| **C · Resilienza tecnica** | C1 · Alternativa disponibile | 3 | ✔ |
| | C2 · Migrabilità | 3 | |
| | C3 · Portabilità dei dati | 3 | |
| | C4 · Gestione della cifratura | 2 | |
| | C5 · Trasparenza e apertura del software | 3 | |
| **D · Resilienza organizzativa** | D1 · Competenze interne e continuità delle conoscenze | 3 | ✔ |
| | D2 · Piano di uscita predisposto | 3 | |
| | D3 · Strategia di backup | 2 | |
| **E · Resilienza contrattuale** | E1 · Clausole di uscita e accordo di transizione | 3 | ✔ |
| | E2 · Flessibilità contrattuale | 2 | |
| **F · Importanza organizzativa** | F1 · Impatto di un'interruzione | 3 | ✔ |
| | F2 · Dipendenze di integrazione | 2 | |
| **G · Sensibilità dei dati, gestione degli accessi e policy** | G1 · Dati personali | 3 | ✔ |
| | G2 · Dati di ricerca e sicurezza della conoscenza | 3 | |
| | G3 · Proprietà intellettuale | 2 | |
| **H · Impatto accademico** | H1 · Libertà accademica | 3 | ✔ |
| | H2 · Collaborazione di ricerca | 2 | |
| | H3 · Archiviazione a lungo termine | 2 | |

!!! note "Qual è la direzione giusta?"
    Le rubriche non sono tutte orientate allo stesso modo, e il controllo le
    colora di conseguenza. Per gli indicatori di **rischio** (A, B, F, G, H)
    **1 è il valore migliore** — il livello 1 di A1 è per esempio «Giurisdizione
    UE/SEE. Nessuna pretesa extraterritoriale. Piena tutela UE.» e il livello 5
    «Nessuna decisione di adeguatezza, nessuna garanzia. Accesso diretto da parte
    di governi esteri.» Per gli indicatori di **capacità** (C, D, E) **5 è il
    valore migliore**. Non occorre ricordarlo: i pulsanti sono graduati per colore
    e riportano le diciture **Basso** e **Alto**.

## Il punteggio

La sezione di sola lettura **Punteggio di autonomia digitale** si trova sotto gli
indicatori e viene ricalcolata automaticamente a ogni salvataggio.

![Il punteggio di autonomia digitale calcolato su una scheda Applicazione](../assets/img/en/64_ext_digital_autonomy_score.png)

| Campo | Significato |
|---|---|
| **Esposizione al rischio** | Media ponderata delle dimensioni A (geopolitica) e B (concentrazione dei fornitori) |
| **Capacità di mitigazione** | Media ponderata della resilienza tecnica (C), organizzativa (D) e contrattuale (E) |
| **Importanza strategica** | Media ponderata di F (importanza organizzativa), G (sensibilità dei dati) e H (impatto accademico) |
| **Punteggio di autonomia** | Un unico valore da 1 a 10, mostrato come indicatore |

**Più alto è, meglio è** — 10 è ottimale, 1 è urgente.

!!! warning "Una valutazione parziale non produce alcun punteggio"
    Tutte le formule sono protette: se manca anche un solo indicatore necessario,
    il punteggio resta vuoto invece di mostrare un valore fuorviante.
    Un'applicazione compare nel report a quadranti solo quando la sua valutazione
    è completa.

Poiché i punteggi sono salvati sulla scheda come qualsiasi altro campo, sono
disponibili ovunque: nell'inventario, nei filtri, nelle esportazioni e nei vostri
report.

## Valutazione rapida o completa

L'estensione fornisce **due varianti degli stessi quattro calcoli**: una legge
tutti i 22 indicatori, l'altra soltanto i nove della valutazione rapida. La coppia
**attiva** determina sia ciò che viene calcolato *sia* quanti indicatori mostra la
scheda.

Si passa dall'una all'altra in **Admin → Metamodello → Calcoli**:

- **Valutazione completa (predefinita)** — le quattro righe
  *Digital Autonomy — … (full)* sono attive e quelle *(quick)* inattive. Le schede
  mostrano tutti i 22 indicatori.
- **Valutazione rapida** — attivate le quattro righe *Digital Autonomy — …
  (quick)* e disattivate le quattro *(full)*. Le schede mostrano solo i nove
  indicatori rapidi e il punteggio si calcola su quelli.

!!! tip "Non esiste un interruttore di visualizzazione separato"
    Questa unica scelta nei calcoli costituisce l'intero commutatore. La scheda
    nasconde automaticamente i 13 indicatori esclusivi della valutazione completa
    non appena è attivo l'insieme rapido, e il report segue la stessa
    impostazione. Non attivate mai entrambe le varianti insieme: scrivono negli
    stessi campi.

## Raccogliere le valutazioni tramite sondaggio

Anziché compilare voi stessi 22 indicatori per ogni applicazione, chiedete a chi
sa. In **Admin → Sondaggi** usate **Nuovo da modello**:

- **New DAAF survey — Quick (9)** crea la bozza *DAAF Quick Scan*.
- **New DAAF survey — Full (22)** crea la bozza *DAAF Full Assessment*.

Entrambi puntano alle schede Applicazione e si aprono come **bozza** nel
generatore di sondaggi, quindi non viene inviato nulla prima della vostra
revisione. Scegliete il ruolo di stakeholder destinatario (ed eventuali filtri —
una fase del ciclo di vita, un sottotipo) e inviate. Chi risponde ritrova lo stesso
controllo di valutazione 1–5 e la stessa guida contestuale della scheda;
applicando le risposte i punteggi vengono riscritti sulle schede.

Potete generare un nuovo sondaggio da un modello tutte le volte che volete: una
rivalutazione annuale è solo un clic.

## Il report a quadranti

**Report → Autonomia digitale** rappresenta ogni applicazione valutata per intero.

![Il report «Quadrante di autonomia»](../assets/img/en/63_ext_digital_autonomy_quadrant.png)

L'asse orizzontale è **rischio × importanza strategica**, quello verticale la
**capacità di mitigazione** (alta in alto): ne derivano quattro quadranti.

| Quadrante | Significato | Che fare |
|---|---|---|
| **Ottimale** | Bassa esposizione, mitigazione solida | Mantenere e monitorare periodicamente. |
| **Gestibile** | Alta esposizione, ma con un ripiego solido | Rischi accettati con un ripiego solido. |
| **Attenzione** | Bassa esposizione, mitigazione debole | Costruire la mitigazione o accettare il rischio deliberatamente. |
| **Critico** | Alta esposizione, mitigazione debole | Azione urgente: migrare o mitigare. |

Ogni punto è numerato e corrisponde a una riga dell'elenco accanto al grafico,
**ordinato per punteggio crescente: prima i più urgenti**. Un clic su un punto o su
una riga apre l'applicazione in un pannello laterale senza uscire dal report.

**Filtri e assi**

- I selettori **Esposizione al rischio**, **Capacità di mitigazione** e
  **Importanza strategica** permettono di collocare altri campi numerici su
  ciascun asse — utile se mantenete equivalenti vostri. La scelta viene ricordata
  nel browser.
- **Ciclo di vita** e **Sottotipo** restringono l'insieme.

Il report si salva, si condivide, si stampa e si esporta come di consueto. Una
vista salvata compare in **Report → Salvati**.

## Permessi

| Permesso | Consente |
|---|---|
| `ext.digital-autonomy.view` | Vedere il report **Report → Autonomia digitale** |

La valutazione degli indicatori usa i vostri normali diritti di **modifica** delle
schede Applicazione: chi può modificare un'applicazione può valutarla. Il
passaggio tra valutazione rapida e completa e la creazione di sondaggi dai modelli
richiedono i consueti diritti di amministrazione su **Calcoli** e **Sondaggi**.

## Se l'estensione viene disattivata o rimossa

Disattivandola o disinstallandola le due sezioni vengono tolte dal tipo di scheda,
ma **i valori salvati sulle vostre schede non vengono mai toccati**. Riattivate
l'estensione e ogni punteggio ricompare identico. I campi sono uniti in modo
additivo, quindi si conservano anche i campi che i vostri amministratori hanno
aggiunto autonomamente in quelle sezioni.

## Lingue

Etichette degli indicatori, domande, rubriche e guida sono disponibili in
**inglese, tedesco, francese, spagnolo, italiano e danese**. In portoghese,
cinese, russo e arabo i contenuti del framework ricadono sull'inglese: il
framework di origine non offre quelle lingue.

## Attribuzione e licenza

Questa estensione riproduce il **Digital Autonomy Assessment Framework (DAAF)**,
creato all'**Università di Utrecht** da **Tim van Neerbos** (Lead Enterprise
Architect) nell'ambito del progetto Digital Autonomy.

- Fonte: <https://github.com/utrechtuniversity/digital-autonomy-assessment-tool>
- Strumento originale: <https://utrechtuniversity.github.io/digital-autonomy-assessment-tool/>
- Licenza: **Creative Commons Attribuzione – Non commerciale – Condividi allo
  stesso modo 4.0 Internazionale (CC BY-NC-SA 4.0)** —
  <https://creativecommons.org/licenses/by-nc-sa/4.0/>
- © 2026 Universiteit Utrecht — Tim van Neerbos

**Sono state apportate modifiche.** Indicatori, pesi, rubriche, note di guida e il
punteggio da 1 a 10 del framework sono stati adattati per funzionare in modo
nativo dentro Turbo EA a livello di scheda Applicazione: un tipo di campo di
valutazione 1–5 dedicato, i calcoli dei livelli e del punteggio, i modelli di
sondaggio e il report a quadranti.

Le traduzioni multilingue delle rubriche e della guida provengono dal progetto
DAAF (realizzate con il contributo di **Thomas Steenbergen, SIVON**; tedesco,
francese, spagnolo, italiano e danese sono, secondo la fonte, traduzioni fatte al
meglio e non ancora riviste da madrelingua).

In base alla clausola **Non commerciale** del framework, questa estensione è
distribuita **gratuitamente**, e in base a **Condividi allo stesso modo** i
contenuti DAAF adattati che essa incorpora restano concessi in licenza
CC BY-NC-SA 4.0.
