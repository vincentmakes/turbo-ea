# Benutzer & Rollen

![Benutzer- und Rollenverwaltung](../assets/img/en/21_admin_users.png)

Die Seite **Benutzer & Rollen** hat zwei Tabs: **Benutzer** (Konten verwalten) und **Rollen** (Berechtigungen verwalten).

#### Benutzertabelle

Die Benutzerliste zeigt alle registrierten Konten mit folgenden Spalten:

| Spalte | Beschreibung |
|--------|-------------|
| **Name** | Anzeigename des Benutzers |
| **E-Mail** | E-Mail-Adresse (wird für die Anmeldung verwendet) |
| **Rolle** | Zugewiesene Rolle (inline per Dropdown auswählbar) |
| **Authentifizierung** | Authentifizierungsmethode: «Lokal», «SSO», «SSO + Passwort» oder «Einrichtung ausstehend» |
| **Status** | Aktiv oder Deaktiviert |
| **Aktionen** | Bearbeiten, Aktivieren/Deaktivieren oder Benutzer löschen |

#### Einen neuen Benutzer einladen

1. Klicken Sie auf die Schaltfläche **Benutzer einladen** (oben rechts)
2. Füllen Sie das Formular aus:
   - **Anzeigename** (erforderlich): Der vollständige Name des Benutzers
   - **E-Mail** (erforderlich): Die E-Mail-Adresse, mit der sich der Benutzer anmelden wird
   - **Passwort** (optional): Wenn leer gelassen und SSO deaktiviert ist, erhält der Benutzer eine E-Mail mit einem Link zur Passworteinrichtung. Wenn SSO aktiviert ist, kann sich der Benutzer über seinen SSO-Anbieter ohne Passwort anmelden
   - **Rolle**: Wählen Sie die zuzuweisende Rolle (Admin, Mitglied, Betrachter oder eine benutzerdefinierte Rolle)
   - **Einladungs-E-Mail senden**: Aktivieren Sie dies, um dem Benutzer eine E-Mail-Benachrichtigung mit Anmeldeinstruktionen zu senden
3. Klicken Sie auf **Benutzer einladen**, um das Konto zu erstellen

**Was im Hintergrund passiert:**
- Ein Benutzerkonto wird im System erstellt
- Ein SSO-Einladungsdatensatz wird ebenfalls erstellt, sodass der Benutzer bei SSO-Anmeldung automatisch die zugewiesene Rolle erhält
- Wenn kein Passwort gesetzt und SSO deaktiviert ist, wird ein Passwort-Einrichtungstoken generiert. Der Benutzer kann sein Passwort über den Link in der Einladungs-E-Mail einrichten

#### Einen Benutzer bearbeiten

Klicken Sie auf das **Bearbeitungssymbol** in einer beliebigen Benutzerzeile, um den Dialog «Benutzer bearbeiten» zu öffnen. Sie können ändern:

- **Anzeigename** und **E-Mail**
- **Authentifizierungsmethode** (nur sichtbar wenn SSO aktiviert ist): Wechsel zwischen «Lokal» und «SSO». Dies ermöglicht Administratoren, ein bestehendes lokales Konto auf SSO umzustellen oder umgekehrt. Beim Wechsel zu SSO wird das Konto automatisch verknüpft, wenn sich der Benutzer das nächste Mal über seinen SSO-Anbieter anmeldet
- **Passwort** (nur für lokale Benutzer): Ein neues Passwort setzen. Leer lassen, um das aktuelle Passwort beizubehalten
- **Rolle**: Die anwendungsweite Rolle des Benutzers ändern

#### Ein bestehendes lokales Konto mit SSO verknüpfen

Wenn ein Benutzer bereits ein lokales Konto hat und Ihre Organisation SSO aktiviert, sieht der Benutzer die Fehlermeldung «Ein lokales Konto mit dieser E-Mail existiert bereits», wenn er versucht, sich per SSO anzumelden. Um dies zu beheben:

1. Gehen Sie zu **Admin > Benutzer**
2. Klicken Sie auf das **Bearbeitungssymbol** neben dem Benutzer
3. Ändern Sie die **Authentifizierungsmethode** von «Lokal» auf «SSO»
4. Klicken Sie auf **Änderungen speichern**
5. Der Benutzer kann sich nun per SSO anmelden. Sein Konto wird bei der ersten SSO-Anmeldung automatisch verknüpft

#### Ausstehende Einladungen

Unterhalb der Benutzertabelle zeigt ein Abschnitt **Ausstehende Einladungen** alle Einladungen, die noch nicht angenommen wurden. Jede Einladung zeigt die E-Mail, die zugewiesene Rolle und das Einladungsdatum. Sie können eine Einladung durch Klicken auf das Löschsymbol widerrufen.

#### Rollen

Der **Rollen**-Tab ermöglicht die Verwaltung anwendungsweiter Rollen. Jede Rolle definiert eine Reihe von Berechtigungen, die steuern, was Benutzer mit dieser Rolle tun können. Standardrollen:

| Rolle | Beschreibung |
|-------|-------------|
| **Admin** | Vollständiger Zugriff auf alle Funktionen und Administration |
| **BPM-Admin** | Vollständige BPM-Berechtigungen plus Inventarzugriff, keine Administrationseinstellungen |
| **Mitglied** | Karten, Beziehungen und Kommentare erstellen, bearbeiten und verwalten. Kein Administratorzugriff |
| **Betrachter** | Schreibgeschützter Zugriff über alle Bereiche |

Benutzerdefinierte Rollen können mit granularer Berechtigungssteuerung über Inventar, Beziehungen, Stakeholder, Kommentare, Dokumente, Diagramme, BPM, Berichte und mehr erstellt werden.

#### Einen Benutzer deaktivieren

Klicken Sie auf das **Umschaltsymbol** in der Aktionen-Spalte, um einen Benutzer zu aktivieren oder zu deaktivieren. Deaktivierte Benutzer:

- Können sich nicht anmelden
- Behalten ihre Daten (Karten, Kommentare, Verlauf) zu Prüfungszwecken
- Können jederzeit reaktiviert werden
