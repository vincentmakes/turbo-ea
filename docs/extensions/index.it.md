# Estensioni

Le **estensioni** aggiungono funzionalità a Turbo EA senza modificare il nucleo:
contenuti aggiuntivi del metamodello, integrazioni con gli strumenti che i vostri
team già usano, reportistica regolamentare e pagine completamente nuove. Sono
realizzate e firmate da Turbo EA e si installano da **Admin → Estensioni**.

Questa sezione descrive *che cosa fa* ogni estensione pubblicata e come usarla.
Per il funzionamento dello store in sé — attendibilità e firme, licenze,
identificativi di istanza, installazione, aggiornamenti e periodi di prova — si
veda [Amministrazione → Store delle estensioni](../admin/extensions.md).

## Estensioni disponibili

### Strategia, pianificazione e trasformazione

| Estensione | Che cosa fa | Licenza |
|------------|-------------|---------|
| [Digital Autonomy Assessment](digital-autonomy.md) | Valuta ogni applicazione secondo il Digital Autonomy Assessment Framework dell'Università di Utrecht — 22 indicatori ponderati, un punteggio di autonomia automatico da 1 a 10 e un quadrante rischio/mitigazione | **Gratuita** |
| [EA Value Tracker](value-savings.md) | Trasforma le decisioni di architettura in un registro finanziario verificabile: risparmi dichiarati per categoria, approvazione della realizzazione a quattro occhi e un cruscotto del valore | Commerciale |

### Integrazioni

| Estensione | Che cosa fa | Licenza |
|------------|-------------|---------|
| [Jira Todo Sync](jira-todos.md) | Mantiene allineati in entrambe le direzioni i todo di Turbo EA e un progetto Jira Cloud — stato, titolo, scadenza e assegnatario | Commerciale |
| [Slack Notifications](slack-notify.md) | Recapita a ciascuno le proprie notifiche di Turbo EA come messaggio diretto Slack, con adesione volontaria per persona e per tipo | Commerciale |

### Normative

| Estensione | Che cosa fa | Licenza |
|------------|-------------|---------|
| [DORA Register of Information](dora-roi.md) | Tiene il registro delle informazioni previsto dall'art. 28 DORA sulle vostre schede esistenti ed esporta il pacchetto ufficiale di trasmissione xBRL-CSV | Commerciale |

## Che cosa hanno in comune tutte le estensioni

- **Firmate dal fornitore.** Ogni pacchetto porta una firma Ed25519 che Turbo EA
  verifica al caricamento *e* a ogni avvio del backend. Ciò che si installa è
  esattamente ciò che il fornitore ha prodotto.
- **Soggette a licenza in esecuzione** (tranne quelle gratuite). Se una licenza
  scade, l'estensione viene disattivata in modo morbido — le sue pagine
  scompaiono e i suoi processi si fermano — ma **i vostri dati non vengono mai
  cancellati**. Una licenza rinnovata ripristina tutto.
- **Privilegio minimo.** Tutto ciò che un'estensione legge o scrive oltre ai
  propri dati è dichiarato come **autorizzazione** all'interno del pacchetto
  firmato, quindi visibile prima dell'installazione. Si veda
  [Autorizzazioni di accesso ai dati](../admin/extensions.md).
- **Permessi propri.** Ogni estensione definisce chiavi di permesso nella forma
  `ext.<nome>.…` che compaiono in **Admin → Utenti e ruoli** una volta caricata:
  decidete voi chi può usarla.
- **Verificabili.** Ogni modifica che un'estensione apporta al vostro inventario è
  registrata nel **Admin → Log di audit** con origine **Estensione** e può essere
  annullata.

## Prima di installare

Verificate la **versione minima di Turbo EA** indicata nella pagina di ciascuna
estensione: su un nucleo più vecchio non si installerà. Le estensioni con codice
di backend richiedono un riavvio una tantum del backend dopo l'installazione;
Turbo EA mostra allora un avviso.
