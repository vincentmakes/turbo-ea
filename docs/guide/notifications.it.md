# Notifiche

Turbo EA vi tiene informati sulle modifiche a card, attività e documenti che vi interessano. Le notifiche vengono consegnate **in-app** (tramite la campanella delle notifiche) e opzionalmente **via email** se SMTP è configurato.

## Campanella delle notifiche

L'**icona della campanella** nella barra di navigazione superiore mostra un badge con il conteggio delle notifiche non lette. Cliccatela per aprire un menu a tendina con le 20 notifiche più recenti.

Ogni notifica mostra:

- **Icona** che indica il tipo di notifica
- **Riepilogo** di cosa è successo (es. "Un todo ti è stato assegnato su SAP S/4HANA")
- **Tempo** trascorso dalla creazione della notifica (es. "5 minuti fa")

Cliccate su qualsiasi notifica per navigare direttamente alla card o al documento pertinente. Le notifiche vengono automaticamente contrassegnate come lette quando le visualizzate.

## Tipi di notifica

| Tipo | Evento scatenante |
|------|-------------------|
| **Todo assegnato** | Un todo vi viene assegnato |
| **Card aggiornata** | Una card di cui siete stakeholder viene aggiornata |
| **Commento aggiunto** | Un nuovo commento viene pubblicato su una card di cui siete stakeholder |
| **Stato di approvazione modificato** | Lo stato di approvazione di una card cambia (approvato, rifiutato, interrotto) |
| **Firma SoAW richiesta** | Vi viene chiesto di firmare uno Statement of Architecture Work |
| **SoAW firmato** | Un SoAW che state seguendo riceve una firma |
| **Richiesta sondaggio** | Un sondaggio che richiede la vostra risposta viene inviato |

## Consegna in tempo reale

Le notifiche vengono consegnate in tempo reale utilizzando Server-Sent Events (SSE). Non è necessario aggiornare la pagina — le nuove notifiche appaiono automaticamente e il conteggio del badge si aggiorna istantaneamente.

## Preferenze di notifica

Cliccate sull'**icona dell'ingranaggio** nel menu a tendina delle notifiche (o andate al menu del profilo) per configurare le vostre preferenze di notifica.

Per ogni tipo di notifica, potete attivare/disattivare indipendentemente:

- **In-app** — Se appare nella campanella delle notifiche
- **Email** — Se viene anche inviata un'email (richiede che SMTP sia configurato da un amministratore)

Alcuni tipi di notifica (es. richieste di sondaggio) possono avere la consegna via email imposta dal sistema e non possono essere disabilitati.
