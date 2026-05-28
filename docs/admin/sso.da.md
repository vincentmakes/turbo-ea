# Godkendelse og SSO

![Indstillinger for godkendelse og SSO](../assets/img/en/25_admin_settings_auth.png)

Fanen **Godkendelse** i Indstillinger giver administratorer mulighed for at konfigurere, hvordan brugere logger på platformen.

#### Selvregistrering

- **Tillad selvregistrering**: Når aktiveret, kan nye brugere oprette konti ved at klikke på "Tilmeld dig" på loginsiden. Når deaktiveret, kan kun administratorer oprette konti via Inviter bruger-flowet.

#### SSO (Single Sign-On)-konfiguration

SSO giver brugere mulighed for at logge på ved hjælp af deres virksomheds identitetsudbyder i stedet for en lokal adgangskode. Turbo EA understøtter fire SSO-udbydere:

| Udbyder | Beskrivelse |
|---------|-------------|
| **Microsoft Entra ID** | For organisationer, der bruger Microsoft 365 / Azure AD |
| **Google Workspace** | For organisationer, der bruger Google Workspace |
| **Okta** | For organisationer, der bruger Okta som deres identitetsplatform |
| **Generic OIDC** | For enhver OpenID Connect-kompatibel udbyder (f.eks. Authentik, Keycloak, Auth0) |

**Trin for at konfigurere SSO:**

1. Gå til **Admin > Indstillinger > Godkendelse**
2. Slå **Aktivér SSO** til
3. Vælg din **SSO-udbyder** fra dropdownen
4. Indtast de påkrævede legitimationsoplysninger fra din identitetsudbyder:
   - **Klient-ID**: Applikations-/klient-ID'et fra din identitetsudbyder
   - **Klienthemmelighed**: Applikationshemmeligheden (gemt krypteret i databasen)
   - Udbyder-specifikke felter:
     - **Microsoft**: Tenant-ID (f.eks. `your-tenant-id` eller `common` for multi-tenant)
     - **Google**: Hosted Domain (valgfri, begrænser login til et specifikt Google Workspace-domæne)
     - **Okta**: Okta-domæne (f.eks. `your-org.okta.com`)
     - **Generic OIDC**: Issuer-URL (f.eks. `https://auth.example.com/application/o/my-app/`). For Generic OIDC forsøger systemet auto-discovery via `.well-known/openid-configuration`-endpointet
5. Klik på **Gem**

**Manuelle OIDC-endpoints (avanceret):**

Hvis backenden ikke kan nå din identitetsudbyders discovery-dokument (f.eks. på grund af Docker-netværk eller selvsignerede certifikater), kan du manuelt specificere OIDC-endpointsne:

- **Authorization Endpoint**: URL'en, hvor brugere omdirigeres til at godkende
- **Token Endpoint**: URL'en, der bruges til at udveksle autorisationskoden for tokens
- **JWKS URI**: URL'en for JSON Web Key Set, der bruges til at verificere tokensignaturer

Disse felter er valgfrie. Hvis de efterlades tomme, bruger systemet auto-discovery. Når de er udfyldt, tilsidesætter de de auto-discovered værdier.

**Test af SSO:**

Efter at have gemt, åbn en ny browser-fane (eller inkognito-vindue), og verificér, at SSO-loginknappen vises på loginsiden, og at godkendelse fungerer end-to-end.

**Vigtige bemærkninger:**
- **Klienthemmeligheden** gemmes krypteret i databasen og eksponeres aldrig i API-responser
- Når SSO er aktiveret, forbliver lokalt adgangskodelogin tilgængeligt som fallback
- Du kan konfigurere redirect-URI'en i din identitetsudbyder som: `https://your-turbo-ea-domain/auth/callback`
