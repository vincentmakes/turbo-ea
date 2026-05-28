# Adgang til platformen

## Log på

![Loginskærm](../assets/img/en/24_login.png)

Når du tilgår platformen, vises loginskærmen, hvor du skal indtaste din e-mailadresse og adgangskode.

**Trin for at logge på:**

1. Åbn din webbrowser og indtast platformens URL
2. I feltet **E-mail** skriver du din registrerede e-mailadresse
3. I feltet **Adgangskode** skriver du din adgangskode
4. Klik på knappen **Log på**

**Vigtig bemærkning:** Den første bruger, der registrerer sig på platformen, modtager automatisk **Administrator**-rollen, som giver mulighed for at konfigurere hele systemet.

## Log på med SSO (Single Sign-On)

Hvis din organisation har konfigureret SSO, vises en **Log på med [udbyder]**-knap på loginsiden under adgangskodeformularen. Knappens etiket viser den konfigurerede udbyders navn (f.eks. "Log på med Microsoft", "Log på med Okta", "Log på med SSO").

**Trin for at logge på med SSO:**

1. Åbn din webbrowser og indtast platformens URL
2. Klik på knappen **Log på med [udbyder]**
3. Du bliver omdirigeret til din identitetsudbyders loginside (f.eks. Microsoft Entra ID, Google Workspace, Okta eller din organisations OIDC-udbyder)
4. Godkend med dine virksomhedslegitimationsoplysninger
5. Efter vellykket godkendelse omdirigeres du tilbage til Turbo EA og logges automatisk på

**Bemærkninger:**

- Hvis din konto endnu ikke findes i Turbo EA, oprettes den automatisk ved første SSO-login (hvis selvregistrering er aktiveret) eller matches med en på forhånd oprettet invitation
- Hvis en administrator allerede har inviteret dig via e-mail, knyttes dit SSO-login til den konto, og du arver den på forhånd tildelte rolle
- SSO-brugere kan stadig have en lokal adgangskode angivet som fallback, hvis administratoren har konfigureret det

## Registrering af nye brugere

Hvis det er første gang, du tilgår platformen, kan du registrere dig ved at klikke på "Tilmeld dig". Administratorer kan også invitere brugere fra administrationspanelet (se [Brugere og roller](../admin/users.md)).

## Skift sprog

Platformen understøtter ni sprog. For at skifte sprog:

1. Klik på dit profilikon (øverste højre hjørne)
2. Vælg **Sprog**
3. Vælg det ønskede sprog:
   - English
   - Español
   - Français
   - Deutsch
   - Italiano
   - Português
   - 中文 (kinesisk)
   - Русский (russisk)
   - Dansk
