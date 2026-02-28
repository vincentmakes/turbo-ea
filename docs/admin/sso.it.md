# Autenticazione e SSO

![Impostazioni di autenticazione e SSO](../assets/img/en/25_admin_settings_auth.png)

La scheda **Autenticazione** nelle Impostazioni consente agli amministratori di configurare come gli utenti accedono alla piattaforma.

#### Auto-registrazione

- **Consenti auto-registrazione**: Quando abilitata, i nuovi utenti possono creare account cliccando su "Registrati" nella pagina di login. Quando disabilitata, solo gli amministratori possono creare account tramite il flusso Invita utente.

#### Configurazione SSO (Single Sign-On)

SSO consente agli utenti di accedere utilizzando il proprio identity provider aziendale invece di una password locale. Turbo EA supporta quattro provider SSO:

| Provider | Descrizione |
|----------|-------------|
| **Microsoft Entra ID** | Per organizzazioni che utilizzano Microsoft 365 / Azure AD |
| **Google Workspace** | Per organizzazioni che utilizzano Google Workspace |
| **Okta** | Per organizzazioni che utilizzano Okta come piattaforma di identità |
| **OIDC generico** | Per qualsiasi provider compatibile con OpenID Connect (es. Authentik, Keycloak, Auth0) |

**Passaggi per configurare SSO:**

1. Andate su **Admin > Impostazioni > Autenticazione**
2. Attivate **Abilita SSO**
3. Selezionate il vostro **Provider SSO** dal menu a tendina
4. Inserite le credenziali richieste dal vostro identity provider:
   - **Client ID**: L'ID applicazione/client dal vostro identity provider
   - **Client Secret**: Il segreto dell'applicazione (memorizzato crittografato nel database)
   - Campi specifici per provider:
     - **Microsoft**: Tenant ID (es. `your-tenant-id` o `common` per multi-tenant)
     - **Google**: Hosted Domain (opzionale, limita il login a un dominio Google Workspace specifico)
     - **Okta**: Dominio Okta (es. `your-org.okta.com`)
     - **OIDC generico**: URL Issuer (es. `https://auth.example.com/application/o/my-app/`). Per OIDC generico, il sistema tenta l'auto-discovery tramite l'endpoint `.well-known/openid-configuration`
5. Cliccate su **Salva**

**Endpoint OIDC manuali (Avanzato):**

Se il backend non riesce a raggiungere il documento di discovery del vostro identity provider (es. a causa della rete Docker o certificati auto-firmati), potete specificare manualmente gli endpoint OIDC:

- **Authorization Endpoint**: L'URL dove gli utenti vengono reindirizzati per autenticarsi
- **Token Endpoint**: L'URL utilizzato per scambiare il codice di autorizzazione con i token
- **JWKS URI**: L'URL per il JSON Web Key Set utilizzato per verificare le firme dei token

Questi campi sono opzionali. Se lasciati vuoti, il sistema utilizza l'auto-discovery. Quando compilati, sovrascrivono i valori scoperti automaticamente.

**Test SSO:**

Dopo il salvataggio, aprite una nuova scheda del browser (o finestra in incognito) e verificate che il pulsante di login SSO appaia nella pagina di login e che l'autenticazione funzioni dall'inizio alla fine.

**Note importanti:**
- Il **Client Secret** è memorizzato crittografato nel database e non viene mai esposto nelle risposte API
- Quando SSO è abilitato, il login con password locale rimane disponibile come fallback
- Potete configurare l'URI di redirect nel vostro identity provider come: `https://your-turbo-ea-domain/auth/callback`
