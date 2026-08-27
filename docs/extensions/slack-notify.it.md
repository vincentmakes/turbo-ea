# Slack Notifications

Il vostro team vive già su Slack. **Slack Notifications** invia a ciascuno le
proprie notifiche di Turbo EA come **messaggio diretto Slack** — un todo
assegnato, una decisione in attesa della sua firma, un rischio arrivato sulla sua
scrivania — con un pulsante che riporta direttamente alla scheda.

Ognuno resta padrone delle proprie scelte: nelle proprie preferenze di notifica
compare una colonna **Slack**, accanto a In-app ed E-mail, in cui si spunta
esattamente quali tipi di notifica devono arrivare lì. **Nulla è attivo per
impostazione predefinita.**

## In sintesi

| | |
|---|---|
| **Licenza** | Commerciale — è richiesto un diritto firmato |
| **Versione minima di Turbo EA** | 2.89.1 |
| **Permesso** | `ext.slack-notify.admin` |
| **Autorizzazioni di accesso ai dati** | `core.notifications.channel`, `core.users.read` |
| **Riavvio del backend necessario** | sì — include codice di backend |
| **Dove compare** | **Admin → Impostazioni → Integrazioni → Slack** · una colonna **Slack** nelle [preferenze di notifica](../guide/notifications.md) di tutti |

Serve solo **HTTPS in uscita verso `slack.com`**: nessun URL in entrata, nessun
callback OAuth e nessuna revisione dello Slack Marketplace. Per questo funziona su
istanze self-hosted o dietro firewall.

## Configurazione

Aprite **Admin → Impostazioni → Integrazioni** e scegliete la scheda **Slack**. Il
pannello vi guida in tre passi numerati.

### 1. Creare l'app Slack

Il pannello mostra un **manifest dell'app** già pronto. In Slack scegliete
**Create New App → From a manifest**, selezionate il vostro workspace, incollate
il manifest (c'è un pulsante **Copia manifest**), quindi **Install to Workspace** e
copiate il **Bot User OAuth Token**: inizia con `xoxb-`.

Il manifest richiede quattro ambiti bot e nulla di più:

| Ambito | A che serve |
|---|---|
| `chat:write` | Inviare il messaggio diretto |
| `im:write` | Aprire la conversazione diretta con una persona |
| `users:read` | Leggere la rubrica dei membri |
| `users:read.email` | Associare un account Turbo EA a un membro Slack tramite e-mail |

!!! warning "Lasciate disattivata la rotazione dei token"
    Il manifest disattiva volutamente la **rotazione dei token** di Slack. Se
    attivata, il token del bot scade ogni 12 ore, cosa che questa versione non sa
    rinnovare: il recapito si fermerebbe due volte al giorno.

### 2. Collegare il workspace

| Campo | Note |
|---|---|
| **Token OAuth del bot** | Il token `xoxb-…`. Salvato cifrato; in seguito lasciatelo vuoto per conservarlo |
| **Nome mostrato nei messaggi Slack** | *Turbo EA* per impostazione predefinita. Usato nel pulsante e nel piè del messaggio |
| **Recapita le notifiche su Slack** | Attivo di serie: è un interruttore di pausa, non un passo di installazione |

Premete **Salva**, poi **Prova connessione**; un'etichetta conferma
*Connected to …*.

### 3. Associare le persone

Gli account vengono associati **tramite indirizzo e-mail** la prima volta che
qualcuno deve ricevere un messaggio, e il risultato viene messo in cache. La
scheda **Persone** elenca tutti, prima i casi problematici, con etichette che
indicano chi è **collegato**, **non presente in Slack** o **non ancora
verificato**.

Per chi ha un indirizzo Slack diverso dalla propria e-mail Turbo EA, digitate il
suo **ID membro Slack** (come `U01ABCDEF`) e premete **Salva**: un'associazione
manuale prevale sempre sulla corrispondenza via e-mail. **Invia messaggio di
prova** dimostra che un'associazione funziona da capo a fondo. Svuotando il campo
la persona torna alla ricerca via e-mail.

Le persone che Slack non riconosce vengono ritentate automaticamente una volta al
giorno: chi entra nel workspace Slack dopo aver ottenuto l'account Turbo EA viene
quindi coperto senza interventi.

!!! note "Vengono salvati solo gli ID membro"
    L'estensione salva ID membro Slack e nulla di più: gli indirizzi e-mail
    restano in Turbo EA.

## Che cosa controlla ciascuno

Non appena l'estensione è attiva, tutti dispongono di una colonna **Slack** nelle
proprie **preferenze di notifica**, accanto a In-app ed E-mail.

![La colonna «Slack» nelle preferenze di notifica](../assets/img/en/71_ext_slack_notification_preferences.png)

- **Ogni tipo è disattivato per impostazione predefinita.** Nessuno riceve un
  messaggio Slack finché non attiva quel tipo per sé.
- Un piè di tabella indica a ciascuno se il proprio account è collegato a Slack o
  se deve chiedere l'associazione a un amministratore.
- L'annuncio di aggiornamento, riservato all'app, non viene mai recapitato su
  Slack.

Turbo EA decide quali tipi di notifica esistono e chi li ha attivati; l'estensione
si limita a trasportare il messaggio.

## Com'è fatto un messaggio

Un messaggio diretto Slack contiene il **titolo** della notifica in grassetto, il
testo, un pulsante **Open in Turbo EA** (con il nome che avete configurato) che
porta alla scheda o alla pagina interessata, e un piccolo piè di messaggio con il
nome dell'app e il tipo di notifica.

Il recapito è rigorosamente unidirezionale — da Turbo EA verso Slack — e sempre
sotto forma di messaggio diretto personale. Non viene mai pubblicato nulla in un
canale.

## Monitorare il recapito

La scheda **Registro di recapito** mostra quanti messaggi sono **in attesa**,
**inviati** e **non riusciti**, oltre alle 50 righe di registro più recenti.

I messaggi vengono accodati e inviati in pochi secondi. Se Slack applica un limite
di frequenza o restituisce un errore, l'estensione riprova con attese crescenti e
desiste dopo sei tentativi; gli errori permanenti — token revocato, persona
eliminata, ambito mancante — si fermano subito invece di riprovare inutilmente. Le
righe recapitate vengono eliminate dopo 14 giorni.

Una coda ferma ha esattamente due cause, e il pannello indica quella pertinente:

- **Non è memorizzato alcun token del bot**: incollate il token e salvate.
- **Il recapito è disattivato**: riattivate *Recapita le notifiche su Slack*.

**Riprova quelle non riuscite** rimette in coda tutto ciò che era stato
abbandonato e ricontrolla le persone che Slack non conosceva. È la via di ripresa
dopo un'interruzione o un cambio di token.

## Permessi

| Permesso | Consente |
|---|---|
| `ext.slack-notify.admin` | Configurare la connessione al workspace, associare le persone, inviare messaggi di prova, consultare il registro e riprovare gli invii non riusciti |

La scheda è nascosta a tutti gli altri. **Gli utenti finali non hanno bisogno di
alcun permesso aggiuntivo**: spuntano soltanto caselle nelle proprie preferenze di
notifica.

## Se la licenza scade o l'estensione viene disattivata

Il recapito va in pausa e la colonna **Slack** scompare dalla finestra, ma **ogni
impostazione e ogni adesione vengono conservate**. Una licenza rinnovata riprende
il recapito. Lo stesso vale per l'interruttore *Recapita le notifiche su Slack*,
che mette in pausa il recapito senza disinstallare nulla: i messaggi in attesa
semplicemente aspettano.

Il token del bot è salvato cifrato ed è escluso dal trasferimento dello spazio di
lavoro.

## Limiti

- **Solo messaggi diretti**: nessuna pubblicazione nei canali.
- **Nessun pulsante interattivo.** Azioni come *Segna come fatto* o *Approva*
  direttamente da Slack non sono disponibili in questa versione; il messaggio
  rimanda a Turbo EA.
- **Nessun riepilogo**: ogni notifica è un messaggio a sé, non un riassunto
  raggruppato.
- **Non attivate la rotazione dei token di Slack** (si veda l'avviso sopra).
