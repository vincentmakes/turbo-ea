# Dashboard

La Dashboard è la prima schermata visualizzata dopo il login. Fornisce una **panoramica rapida** dell'intero stato dell'enterprise architecture.

![Dashboard - Vista superiore](../assets/img/it/01_dashboard.png)

## Barra di navigazione superiore

Nella parte superiore dello schermo si trova la **barra di navigazione principale** con i seguenti elementi:

- **Turbo EA** (logo): Cliccate per tornare alla Dashboard da qualsiasi sezione
- **Dashboard**: Panoramica dello stato dell'architettura
- **Inventario**: Elenco completo di tutte le card
- **Report**: Report visivi e analitici
- **BPM**: Business Process Management (se abilitato)
- **Diagrammi**: Editor visivo di diagrammi architetturali
- **EA Delivery**: Gestione delle iniziative architetturali
- **Todo**: Attività in sospeso e sondaggi assegnati
- **Cerca card**: Barra di ricerca rapida con autocompletamento
- **+ Crea**: Pulsante per creare rapidamente nuove card
- **Campanella delle notifiche**: Avvisi di sistema e [notifiche](notifications.md)
- **Icona profilo**: Selezione della lingua, cambio tema, preferenze di notifica e accesso all'amministrazione
- **Sostieni**: Un pulsante viola-rosa accanto al numero di versione nel menu del profilo apre una finestra che spiega perché le sponsorizzazioni sono importanti, con un collegamento al blog e opzioni una tantum o mensili tramite GitHub Sponsors

## Schede riepilogative

La sezione principale della Dashboard mostra **schede riepilogative** che indicano:

- **Numero totale di card**: Conteggio di tutti i componenti registrati nella piattaforma
- **Distribuzione per tipo**: Quanti elementi di ciascun tipo esistono (Application, Organization, Objective, Capability, ecc.)
- **Panoramica degli stati**: Visualizzazioni rapide dello stato generale

Cliccando su una scheda di tipo si naviga all'[Inventario](inventory.md) pre-filtrato per quel tipo.

![Dashboard - Vista inferiore con grafici](../assets/img/it/02_dashboard_inferiore.png)

## Grafici e statistiche

Nella sezione inferiore della Dashboard troverete:

- **Grafico di distribuzione per tipo**: Mostra la proporzione di ciascun tipo di card nel vostro panorama
- **Stato di approvazione**: Indica quante card sono approvate, in attesa, interrotte o rifiutate
- **Qualità dei dati**: Percentuale complessiva di completezza delle informazioni su tutte le card
- **Attività recente**: Un feed delle ultime modifiche — chi ha modificato cosa e quando

## Scheda «Spazio di lavoro»

La scheda **Spazio di lavoro** raccoglie tutto ciò che vi è assegnato: preferiti, attività, sondaggi in attesa, attività recente sulle vostre card e la sezione **Carte con il mio ruolo**.

Quest'ultima raggruppa le card per il ruolo di stakeholder che ricoprite (Application Owner, Business Owner, ecc.) ed elenca le card sotto ciascun ruolo. Se il vostro ruolo concede l'autorizzazione `stakeholders.view` (admin, member e viewer per impostazione predefinita), accanto al titolo della sezione appare una piccola icona **person_search**: selezionate un utente dall'autocompletamento e la sezione si ricarica con i suoi ruoli e le sue card. Il titolo diventa «Ruoli ricoperti da {name}». Fate clic sulla piccola icona di chiusura per tornare ai vostri ruoli. Utile per rispondere a «cosa possiede questa persona?» con un clic.

## Scheda «Amministrazione» — Directory degli stakeholder

Gli amministratori (qualsiasi ruolo con `admin.users`) vedono un widget **Directory degli stakeholder** in fondo alla scheda Amministrazione. Elenca ogni tipo di scheda con almeno uno stakeholder, insieme al numero di titolari distinti. Espandete un tipo di scheda per vederne i ruoli e, all'interno di ogni ruolo, gli utenti con il numero di card che coprono. Fate clic su una chip utente per espandere la sua lista di card direttamente sotto — ogni nome di card è un link alla pagina di dettaglio. L'intero albero (tipo di scheda → ruolo → utente → card) viene restituito in un singolo round-trip, quindi la navigazione è immediata.

Un **filtro per nome** in cima al widget restringe l'albero agli utenti che corrispondono al nome o all'email digitati; i tipi di scheda corrispondenti si espandono automaticamente affinché le corrispondenze siano visibili senza un clic in più. Pratico per rispondere a «dove appare Alice nell'organizzazione?» in un secondo.

Oltre alla directory, un piccolo **popover al passaggio del mouse** si apre quando il cursore si sofferma su un nome di stakeholder altrove nell'applicazione — nella scheda Stakeholder di una card, su un proprietario di rischio nel Registro dei rischi o nella pagina di Dettaglio del rischio — mostrando il portafoglio completo di quella persona raggruppato per ruolo. Fate clic su una card nel popover per saltare ad essa. Il popover effettua il recupero solo una volta per utente per sessione.
