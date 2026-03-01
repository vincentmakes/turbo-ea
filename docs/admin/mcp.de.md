# MCP-Integration (KI-Werkzeug-Zugang)

Turbo EA enthält einen integrierten **MCP-Server** (Model Context Protocol), der KI-Werkzeugen — wie Claude Desktop, GitHub Copilot, Cursor und VS Code — ermöglicht, EA-Daten direkt abzufragen. Benutzer authentifizieren sich über ihren bestehenden SSO-Anbieter, und jede Abfrage respektiert ihre individuellen Berechtigungen.

Diese Funktion ist **optional** und **startet nicht automatisch**. Sie erfordert, dass SSO konfiguriert ist, das MCP-Profil in Docker Compose aktiviert wird und ein Administrator es in der Einstellungsoberfläche einschaltet.

---

## Funktionsweise

```
KI-Werkzeug (Claude, Copilot usw.)
    │
    │  MCP-Protokoll (HTTP + SSE)
    ▼
Turbo EA MCP-Server (:8001, intern)
    │
    │  OAuth 2.1 mit PKCE
    │  delegiert an SSO-Anbieter
    ▼
Turbo EA Backend (:8000)
    │
    │  RBAC pro Benutzer
    ▼
PostgreSQL
```

1. Ein Benutzer fügt die MCP-Server-URL zu seinem KI-Werkzeug hinzu.
2. Bei der ersten Verbindung öffnet das KI-Werkzeug ein Browserfenster für die SSO-Authentifizierung.
3. Nach der Anmeldung stellt der MCP-Server ein eigenes Zugriffstoken aus (gestützt durch das Turbo-EA-JWT des Benutzers).
4. Das KI-Werkzeug verwendet dieses Token für alle nachfolgenden Anfragen. Tokens werden automatisch erneuert.
5. Jede Abfrage durchläuft das normale Turbo-EA-Berechtigungssystem — Benutzer sehen nur Daten, auf die sie Zugriff haben.

---

## Voraussetzungen

Vor der Aktivierung von MCP müssen folgende Voraussetzungen erfüllt sein:

- **SSO konfiguriert und funktionsfähig** — MCP delegiert die Authentifizierung an Ihren SSO-Anbieter (Microsoft Entra ID, Google Workspace, Okta oder generisches OIDC). Siehe die Anleitung [Authentifizierung und SSO](sso.md).
- **HTTPS mit einer öffentlichen Domain** — Der OAuth-Ablauf erfordert eine stabile Weiterleitungs-URI. Betreiben Sie Turbo EA hinter einem TLS-terminierenden Reverse-Proxy (Caddy, Traefik, Cloudflare Tunnel usw.).

---

## Einrichtung

### Schritt 1: MCP-Dienst starten

Der MCP-Server ist ein optionales Docker-Compose-Profil. Fügen Sie `--profile mcp` zu Ihrem Startbefehl hinzu:

```bash
docker compose --profile mcp up --build -d
```

Dies startet einen leichtgewichtigen Python-Container (Port 8001, nur intern) neben Backend und Frontend. Nginx leitet `/mcp/`-Anfragen automatisch weiter.

### Schritt 2: Umgebungsvariablen konfigurieren

Fügen Sie diese zu Ihrer `.env`-Datei hinzu:

```dotenv
TURBO_EA_PUBLIC_URL=https://ihre-domain.beispiel.de
MCP_PUBLIC_URL=https://ihre-domain.beispiel.de/mcp
```

| Variable | Standard | Beschreibung |
|----------|---------|-------------|
| `TURBO_EA_PUBLIC_URL` | `http://localhost:8920` | Die öffentliche URL Ihrer Turbo-EA-Instanz |
| `MCP_PUBLIC_URL` | `http://localhost:8920/mcp` | Die öffentliche URL des MCP-Servers (wird in OAuth-Weiterleitungs-URIs verwendet) |
| `MCP_PORT` | `8001` | Interner Port des MCP-Containers (muss selten geändert werden) |

### Schritt 3: OAuth-Weiterleitungs-URI zur SSO-App hinzufügen

Fügen Sie in der App-Registrierung Ihres SSO-Anbieters (dieselbe, die Sie für die Turbo-EA-Anmeldung eingerichtet haben) diese Weiterleitungs-URI hinzu:

```
https://ihre-domain.beispiel.de/mcp/oauth/callback
```

Dies ist erforderlich für den OAuth-Ablauf, der Benutzer authentifiziert, wenn sie sich von ihrem KI-Werkzeug aus verbinden.

### Schritt 4: MCP in den Admin-Einstellungen aktivieren

1. Gehen Sie zu **Einstellungen** im Administrationsbereich und wählen Sie den Reiter **AI**.
2. Scrollen Sie zum Abschnitt **MCP-Integration (AI-Werkzeugzugriff)**.
3. Schalten Sie den Schalter auf **aktiviert**.
4. Die Oberfläche zeigt die MCP-Server-URL und Einrichtungsanweisungen zum Teilen mit Ihrem Team.

!!! warning
    Der Schalter ist deaktiviert, wenn SSO nicht konfiguriert ist. Richten Sie zuerst SSO ein.

---

## KI-Werkzeuge verbinden

Sobald MCP aktiviert ist, teilen Sie die **MCP-Server-URL** mit Ihrem Team. Jeder Benutzer fügt sie zu seinem KI-Werkzeug hinzu:

### Claude Desktop

1. Öffnen Sie **Einstellungen > Konnektoren > Benutzerdefinierten Konnektor hinzufügen**.
2. Geben Sie die MCP-Server-URL ein: `https://ihre-domain.beispiel.de/mcp`
3. Klicken Sie auf **Verbinden** — ein Browserfenster öffnet sich für die SSO-Anmeldung.
4. Nach der Authentifizierung kann Claude Ihre EA-Daten abfragen.

### VS Code (GitHub Copilot / Cursor)

Fügen Sie zu Ihrer Arbeitsbereich-Datei `.vscode/mcp.json` hinzu:

```json
{
  "servers": {
    "turbo-ea": {
      "type": "http",
      "url": "https://ihre-domain.beispiel.de/mcp/mcp"
    }
  }
}
```

Das doppelte `/mcp/mcp` ist beabsichtigt — das erste `/mcp/` ist der Nginx-Proxy-Pfad, das zweite der MCP-Protokoll-Endpunkt.

---

## Lokales Testen (Stdio-Modus)

Für lokale Entwicklung oder Tests ohne SSO/HTTPS können Sie den MCP-Server im **Stdio-Modus** ausführen — Claude Desktop startet ihn direkt als lokalen Prozess.

**1. MCP-Server-Paket installieren:**

```bash
pip install ./mcp-server
```

**2. Zur Claude-Desktop-Konfiguration hinzufügen** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "turbo-ea": {
      "command": "python",
      "args": ["-m", "turbo_ea_mcp", "--stdio"],
      "env": {
        "TURBO_EA_URL": "http://localhost:8000",
        "TURBO_EA_EMAIL": "ihre@email.de",
        "TURBO_EA_PASSWORD": "ihr-passwort"
      }
    }
  }
}
```

In diesem Modus authentifiziert sich der Server mit E-Mail/Passwort und erneuert das Token automatisch im Hintergrund.

---

## Verfügbare Funktionen

Der MCP-Server bietet **schreibgeschützten** Zugriff auf EA-Daten. Er kann nichts erstellen, ändern oder löschen.

### Werkzeuge

| Werkzeug | Beschreibung |
|----------|-------------|
| `search_cards` | Karten nach Typ, Status oder Freitext suchen und filtern |
| `get_card` | Vollständige Details einer Karte per UUID abrufen |
| `get_card_relations` | Alle Beziehungen einer Karte abrufen |
| `get_card_hierarchy` | Vorfahren und Kinder einer Karte abrufen |
| `list_card_types` | Alle Kartentypen im Metamodell auflisten |
| `get_relation_types` | Beziehungstypen auflisten, optional nach Kartentyp gefiltert |
| `get_dashboard` | KPI-Dashboard-Daten abrufen (Anzahl, Datenqualität, Genehmigungen) |
| `get_landscape` | Karten gruppiert nach einem verwandten Typ abrufen |

### Ressourcen

| URI | Beschreibung |
|-----|-------------|
| `turbo-ea://types` | Alle Kartentypen im Metamodell |
| `turbo-ea://relation-types` | Alle Beziehungstypen |
| `turbo-ea://dashboard` | Dashboard-KPIs und zusammenfassende Statistiken |

### Geführte Prompts

| Prompt | Beschreibung |
|--------|-------------|
| `analyze_landscape` | Mehrstufige Analyse: Dashboard-Übersicht, Typen, Beziehungen |
| `find_card` | Karte nach Namen suchen, Details und Beziehungen abrufen |
| `explore_dependencies` | Abbilden, wovon eine Karte abhängt und was von ihr abhängt |

---

## Berechtigungen

| Rolle | Zugriff |
|-------|---------|
| **Administrator** | MCP-Einstellungen konfigurieren (Berechtigung `admin.mcp`) |
| **Alle authentifizierten Benutzer** | EA-Daten über den MCP-Server abfragen (respektiert bestehende Berechtigungen auf Karten- und App-Ebene) |

Die Berechtigung `admin.mcp` steuert, wer MCP-Einstellungen verwalten kann. Sie ist standardmäßig nur für die Admin-Rolle verfügbar. Benutzerdefinierten Rollen kann diese Berechtigung über die Rollenverwaltungsseite gewährt werden.

Der Datenzugriff über MCP folgt demselben RBAC-Modell wie die Weboberfläche — es gibt keine separaten MCP-spezifischen Datenberechtigungen.

---

## Sicherheit

- **SSO-delegierte Authentifizierung**: Benutzer authentifizieren sich über ihren SSO-Anbieter des Unternehmens. Der MCP-Server sieht oder speichert niemals Passwörter.
- **OAuth 2.1 mit PKCE**: Der Authentifizierungsablauf verwendet Proof Key for Code Exchange (S256), um das Abfangen von Autorisierungscodes zu verhindern.
- **RBAC pro Benutzer**: Jede MCP-Abfrage wird mit den Berechtigungen des authentifizierten Benutzers ausgeführt. Keine gemeinsamen Dienstkonten.
- **Schreibgeschützter Zugriff**: Der MCP-Server kann nur Daten lesen. Er kann keine Karten, Beziehungen oder andere Ressourcen erstellen, aktualisieren oder löschen.
- **Token-Rotation**: Zugriffstoken laufen nach 1 Stunde ab. Erneuerungstoken gelten 30 Tage. Autorisierungscodes sind einmalig verwendbar und laufen nach 10 Minuten ab.
- **Nur interner Port**: Der MCP-Container gibt Port 8001 nur im internen Docker-Netzwerk frei. Jeglicher externer Zugriff läuft über den Nginx-Reverse-Proxy.

---

## Fehlerbehebung

| Problem | Lösung |
|---------|--------|
| MCP-Schalter ist in den Einstellungen deaktiviert | SSO muss zuerst konfiguriert werden. Gehen Sie zu Einstellungen > Reiter Authentifizierung und richten Sie einen SSO-Anbieter ein. |
| «host not found» in den Nginx-Logs | Der MCP-Dienst läuft nicht. Starten Sie ihn mit `docker compose --profile mcp up -d`. Die Nginx-Konfiguration behandelt dies problemlos (502-Antwort, kein Absturz). |
| OAuth-Callback schlägt fehl | Überprüfen Sie, dass Sie `https://ihre-domain.beispiel.de/mcp/oauth/callback` als Weiterleitungs-URI in Ihrer SSO-App-Registrierung hinzugefügt haben. |
| KI-Werkzeug kann sich nicht verbinden | Überprüfen Sie, dass `MCP_PUBLIC_URL` mit der URL übereinstimmt, die vom Rechner des Benutzers aus erreichbar ist. Stellen Sie sicher, dass HTTPS funktioniert. |
| Benutzer erhält leere Ergebnisse | MCP respektiert RBAC-Berechtigungen. Wenn ein Benutzer eingeschränkten Zugriff hat, sieht er nur die Karten, die seine Rolle erlaubt. |
| Verbindung bricht nach 1 Stunde ab | Das KI-Werkzeug sollte die Token-Erneuerung automatisch durchführen. Falls nicht, verbinden Sie sich erneut. |
