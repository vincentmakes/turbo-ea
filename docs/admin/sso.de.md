# Authentifizierung & SSO

![Authentifizierung & SSO-Einstellungen](../assets/img/en/25_admin_settings_auth.png)

Der Tab **Authentifizierung** in den Einstellungen ermöglicht Administratoren die Konfiguration der Benutzeranmeldung an der Plattform.

#### Selbstregistrierung

- **Selbstregistrierung erlauben**: Wenn aktiviert, können neue Benutzer Konten erstellen, indem sie auf der Anmeldeseite auf «Registrieren» klicken. Wenn deaktiviert, können nur Administratoren Konten über den Einladungsablauf erstellen.

#### SSO (Single Sign-On) Konfiguration

SSO ermöglicht es Benutzern, sich mit ihrem Unternehmens-Identitätsanbieter statt mit einem lokalen Passwort anzumelden. Turbo EA unterstützt vier SSO-Anbieter:

| Anbieter | Beschreibung |
|----------|-------------|
| **Microsoft Entra ID** | Für Organisationen, die Microsoft 365 / Azure AD nutzen |
| **Google Workspace** | Für Organisationen, die Google Workspace nutzen |
| **Okta** | Für Organisationen, die Okta als Identitätsplattform nutzen |
| **Generisches OIDC** | Für jeden OpenID-Connect-kompatiblen Anbieter (z.B. Authentik, Keycloak, Auth0) |

**Schritte zur SSO-Konfiguration:**

1. Gehen Sie zu **Admin > Einstellungen > Authentifizierung**
2. Schalten Sie **SSO aktivieren** ein
3. Wählen Sie Ihren **SSO-Anbieter** aus dem Dropdown
4. Geben Sie die erforderlichen Anmeldedaten Ihres Identitätsanbieters ein:
   - **Client-ID**: Die Anwendungs-/Client-ID von Ihrem Identitätsanbieter
   - **Client-Secret**: Das Anwendungsgeheimnis (verschlüsselt in der Datenbank gespeichert)
   - Anbieterspezifische Felder:
     - **Microsoft**: Mandanten-ID (z.B. `ihre-mandanten-id` oder `common` für Multi-Mandanten)
     - **Google**: Gehostete Domain (optional, beschränkt die Anmeldung auf eine bestimmte Google-Workspace-Domain)
     - **Okta**: Okta-Domain (z.B. `ihre-org.okta.com`)
     - **Generisches OIDC**: Aussteller-URL (z.B. `https://auth.example.com/application/o/my-app/`). Für generisches OIDC versucht das System eine automatische Erkennung über den `.well-known/openid-configuration`-Endpunkt
5. Klicken Sie auf **Speichern**

**Manuelle OIDC-Endpunkte (Fortgeschritten):**

Wenn das Backend das Discovery-Dokument Ihres Identitätsanbieters nicht erreichen kann (z.B. aufgrund von Docker-Netzwerkkonfiguration oder selbstsignierten Zertifikaten), können Sie die OIDC-Endpunkte manuell angeben:

- **Autorisierungsendpunkt**: Die URL, zu der Benutzer zur Authentifizierung weitergeleitet werden
- **Token-Endpunkt**: Die URL, die zum Austausch des Autorisierungscodes gegen Tokens verwendet wird
- **JWKS-URI**: Die URL für den JSON Web Key Set zur Überprüfung von Token-Signaturen

Diese Felder sind optional. Wenn sie leer gelassen werden, verwendet das System die automatische Erkennung. Wenn sie ausgefüllt sind, überschreiben sie die automatisch erkannten Werte.

**SSO testen:**

Öffnen Sie nach dem Speichern einen neuen Browser-Tab (oder ein Inkognito-Fenster) und überprüfen Sie, dass die SSO-Anmeldeschaltfläche auf der Anmeldeseite erscheint und die Authentifizierung durchgängig funktioniert.

**Wichtige Hinweise:**
- Das **Client-Secret** wird verschlüsselt in der Datenbank gespeichert und nie in API-Antworten offengelegt
- Wenn SSO aktiviert ist, bleibt die lokale Passwortanmeldung als Fallback verfügbar
- Sie können die Redirect-URI in Ihrem Identitätsanbieter konfigurieren als: `https://ihre-turbo-ea-domain/auth/callback`
