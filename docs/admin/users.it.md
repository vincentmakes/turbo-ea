# Utenti e ruoli

![Gestione utenti e ruoli](../assets/img/en/21_admin_users.png)

La pagina **Utenti e ruoli** ha due schede: **Utenti** (gestione account) e **Ruoli** (gestione permessi).

#### Tabella utenti

L'elenco utenti mostra tutti gli account registrati con le seguenti colonne:

| Colonna | Descrizione |
|---------|-------------|
| **Nome** | Nome visualizzato dell'utente |
| **Email** | Indirizzo email (utilizzato per il login) |
| **Ruolo** | Ruolo assegnato (selezionabile in linea tramite menu a tendina) |
| **Autenticazione** | Metodo di autenticazione: "Locale", "SSO", "SSO + Password" o "In attesa di configurazione" |
| **Stato** | Attivo o Disabilitato |
| **Azioni** | Modifica, attiva/disattiva o elimina l'utente |

#### Invito di un nuovo utente

1. Cliccate sul pulsante **Invita utente** (in alto a destra)
2. Compilate il modulo:
   - **Nome visualizzato** (obbligatorio): Il nome completo dell'utente
   - **Email** (obbligatorio): L'indirizzo email che utilizzeranno per il login
   - **Password** (opzionale): Se lasciata vuota e SSO è disabilitato, l'utente riceve un'email con un link per impostare la password. Se SSO è abilitato, l'utente può accedere tramite il proprio provider SSO senza password
   - **Ruolo**: Selezionate il ruolo da assegnare (Admin, Member, Viewer o qualsiasi ruolo personalizzato)
   - **Invia email di invito**: Spuntate per inviare una notifica email all'utente con le istruzioni per il login
3. Cliccate su **Invita utente** per creare l'account

**Cosa succede dietro le quinte:**
- Viene creato un account utente nel sistema
- Viene creato anche un record di invito SSO, così se l'utente accede tramite SSO, riceve automaticamente il ruolo pre-assegnato
- Se non viene impostata una password e SSO è disabilitato, viene generato un token per l'impostazione della password. L'utente può impostare la propria password seguendo il link nell'email di invito

#### Modifica di un utente

Cliccate sull'**icona di modifica** su qualsiasi riga utente per aprire la finestra Modifica utente. Potete modificare:

- **Nome visualizzato** e **Email**
- **Metodo di autenticazione** (visibile solo quando SSO è abilitato): Alternate tra "Locale" e "SSO". Questo consente agli amministratori di convertire un account locale esistente in SSO, o viceversa. Quando si passa a SSO, l'account verrà automaticamente collegato quando l'utente accede la prossima volta tramite il proprio provider SSO
- **Password** (solo per utenti locali): Impostate una nuova password. Lasciate vuoto per mantenere la password corrente
- **Ruolo**: Cambiate il ruolo a livello di applicazione dell'utente

#### Collegamento di un account locale esistente a SSO

Se un utente ha già un account locale e la vostra organizzazione abilita SSO, l'utente vedra l'errore "Un account locale con questa email esiste già" quando tenta di accedere tramite SSO. Per risolvere:

1. Andate su **Admin > Utenti**
2. Cliccate sull'**icona di modifica** accanto all'utente
3. Cambiate il **Metodo di autenticazione** da "Locale" a "SSO"
4. Cliccate su **Salva modifiche**
5. L'utente può ora accedere tramite SSO. Il suo account verrà automaticamente collegato al primo login SSO

#### Inviti in attesa

Sotto la tabella utenti, una sezione **Inviti in attesa** mostra tutti gli inviti che non sono ancora stati accettati. Ogni invito mostra l'email, il ruolo pre-assegnato e la data dell'invito. Potete revocare un invito cliccando sull'icona di eliminazione.

#### Ruoli

La scheda **Ruoli** consente di gestire i ruoli a livello di applicazione. Ogni ruolo definisce un insieme di permessi che controllano cosa possono fare gli utenti con quel ruolo. Ruoli predefiniti:

| Ruolo | Descrizione |
|-------|-------------|
| **Admin** | Accesso completo a tutte le funzionalità e all'amministrazione |
| **BPM Admin** | Permessi BPM completi più accesso all'inventario, nessuna impostazione admin |
| **Member** | Crea, modifica e gestisce card, relazioni e commenti. Nessun accesso admin |
| **Viewer** | Accesso di sola lettura in tutte le aree |

I ruoli personalizzati possono essere creati con controllo granulare dei permessi su inventario, relazioni, stakeholder, commenti, documenti, diagrammi, BPM, report e altro.

#### Disattivazione di un utente

Cliccate sull'**icona toggle** nella colonna Azioni per attivare o disattivare un utente. Gli utenti disattivati:

- Non possono effettuare il login
- Mantengono i propri dati (card, commenti, cronologia) per scopi di audit
- Possono essere riattivati in qualsiasi momento
