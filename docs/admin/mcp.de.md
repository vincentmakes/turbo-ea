# MCP-Integration (KI-Werkzeug-Zugang)

Turbo EA enthält einen integrierten **MCP-Server** (Model Context Protocol), der KI-Werkzeugen — wie Claude Desktop, GitHub Copilot, Cursor und VS Code — ermöglicht, EA-Daten direkt abzufragen und zu aktualisieren. KI-Werkzeuge können außerdem Artefakte (Tabellen, BPMN-Diagramme, DrawIO-Diagramme, freie Dokumente) hochladen und in Karten, Beziehungen und Diagramme umwandeln, die in das bestehende Metamodell passen. Benutzer authentifizieren sich über ihren bestehenden SSO-Anbieter, und jede Aktion respektiert ihre individuellen Berechtigungen.

Diese Funktion ist **optional** und **startet nicht automatisch**. Sie erfordert, dass SSO konfiguriert ist, das MCP-Profil in Docker Compose aktiviert wird und ein Administrator es in der Einstellungsoberfläche einschaltet.

---

## Funktionsweise

```
KI-Werkzeug (Claude, Copilot usw.)
    │
    │  MCP-Protokoll (streamable HTTP)
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
| `MCP_PUBLIC_URL` | `http://localhost:8920/mcp` (docker compose) | Die öffentliche URL des MCP-Servers (wird in OAuth-Weiterleitungs-URIs verwendet). Wird der Container eigenständig betrieben, lautet der Code-Standard `http://localhost:8001` |
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
2. Geben Sie die MCP-Server-URL ein: `https://ihre-domain.beispiel.de/mcp/mcp`
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

Das doppelte `/mcp/mcp` ist beabsichtigt — für Claude wie für VS Code gleichermaßen: Das erste `/mcp/` ist der Nginx-Proxy-Pfad, das zweite der MCP-Protokoll-Endpunkt. Ein bloßes `/mcp` stellt keine Verbindung her.

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

Der MCP-Server stellt **47 Werkzeuge** in zwei Gruppen bereit: **30 Lese-Werkzeuge** zur Abfrage von EA-Daten und **17 Schreib-Werkzeuge** (13 additiv, 4 destruktiv), die Karten, Beziehungen, Diagramme, Risiken, ADRs und mehr erstellen und pflegen — einschließlich der Umwandlung von Artefakten, die ein KI-Werkzeug in seinem eigenen Kontext hat (Tabellen, BPMN-XML, DrawIO-XML, Dokumente, Bilder), in strukturierte EA-Daten. Jedes Werkzeug trägt MCP-`ToolAnnotations` (Hinweise auf schreibgeschützt / destruktiv / idempotent), sodass Konnektoren die Destruktivität in ihrer Oberfläche anzeigen können.

### Sicherheit beim Schreiben durch Trockenlauf

Jedes Schreib-Werkzeug verwendet standardmäßig **`dry_run=true`**. In diesem Modus führt das Backend jeden Validator und Resolver aus, erstellt den vollständigen Plan und **macht die Transaktion dann rückgängig**, sodass nichts dauerhaft gespeichert wird. Das KI-Werkzeug zeigt dem Benutzer die Vorschau; erst nach ausdrücklicher Bestätigung sollte es das Werkzeug erneut mit `dry_run=false` aufrufen, um den Vorgang zu übernehmen. Dies verhindert, dass ein übereifriger Agent leise Hunderte von Karten auf Grundlage einer falsch interpretierten Tabelle anlegt.

### Lese-Werkzeuge

Der Server stellt 30 Lese-Werkzeuge in acht Gruppen bereit.

**Karten & Metamodell**

| Werkzeug | Beschreibung |
|----------|-------------|
| `search_cards` | Karten nach Typ, Status oder Freitext suchen und filtern |
| `get_card` | Vollständige Details einer Karte per UUID abrufen |
| `get_card_relations` | Alle Beziehungen einer Karte abrufen |
| `get_card_hierarchy` | Vorfahren und Kinder einer Karte abrufen |
| `list_card_types` | Alle Kartentypen im Metamodell auflisten |
| `get_relation_types` | Beziehungstypen auflisten, optional nach Kartentyp gefiltert |
| `resolve_card_refs` | Vorvalidiert namensbasierte Karten-Referenzen (Name → UUID) vor einem Bulk-Import — löst nur auf, schreibt niemals |
| `analyze_impact` | Abhängigkeits-Wirkungsradius-Analyse für eine geplante Änderung an einer Karte |

**Dashboards**

| Werkzeug | Beschreibung |
|----------|-------------|
| `get_dashboard` | KPI-Dashboard (Anzahl, Datenqualität, Genehmigungen, Aktivität) |
| `get_landscape` | Karten eines Typs gruppiert nach einem verwandten Typ |

**GRC — Risikoregister**

| Werkzeug | Beschreibung |
|----------|-------------|
| `list_risks` | Paginierte, filterbare Liste der EA-Risiken (TOGAF Phase G) |
| `get_risk` | Detail eines einzelnen Risikos mit verknüpften Karten und Audit |
| `get_risk_metrics` | KPIs + 4×4-Matrizen für initial und residual |
| `get_card_risks` | Alle Risiken, die aktuell mit einer Karte verknüpft sind |

**GRC — Compliance**

| Werkzeug | Beschreibung |
|----------|-------------|
| `list_compliance_findings` | Compliance-Befunde gebündelt nach Regulierung |
| `get_compliance_overview` | Compliance-Scores + Statusmatrix pro Regulierung + Metadaten des letzten Scans |

**Governance & Bereitstellung**

| Werkzeug | Beschreibung |
|----------|-------------|
| `list_principles` | Veröffentlichte EA-Prinzipien (Aussage, Begründung, Auswirkungen) |
| `list_adrs` | Architekturentscheidungen (ADRs), gefiltert nach Initiative / Status |
| `get_adr` | Einzelnes ADR mit Abschnitten, verknüpften Karten und Unterschriftspfad |
| `list_soaws` | Statements of Architecture Work einer Initiative |

**Berichte**

| Werkzeug | Beschreibung |
|----------|-------------|
| `get_portfolio_report` | Bubble-Chart-Daten für einen Kartentyp (Default: funktionaler × technischer Fit) |
| `get_cost_treemap` | Treemap der Kosten, optional gruppiert nach verwandtem Typ |
| `get_capability_heatmap` | Hierarchische Business-Capability-Heatmap |
| `get_data_quality_report` | Vollständigkeits-Aufschlüsselung pro Kartentyp |

**Karten-Kontext**

| Werkzeug | Beschreibung |
|----------|-------------|
| `get_card_stakeholders` | Der Karte zugewiesene Nutzer + Rollen |
| `get_card_comments` | Kommentar-Threads einer Karte |
| `get_card_documents` | Dokument-Links an einer Karte (URLs, keine Dateien) |

**Diagramme**

| Werkzeug | Beschreibung |
|----------|-------------|
| `list_diagrams` | Frei gestaltete (DrawIO-)Diagramme auflisten, optional gefiltert auf eine Karte |
| `get_diagram` | Ein einzelnes Diagramm per ID abrufen, einschließlich seines DrawIO-XML |

**Audit & Änderungshistorie**

| Werkzeug | Beschreibung |
|----------|-------------|
| `get_change_history` | Das Mutations-Batch-Register abfragen (nach Batch-ID, Akteur, Werkzeug oder Herkunft), um exakt zu rekonstruieren, was ein früherer MCP-Commit geändert hat |

Alle Werkzeuge respektieren das RBAC des authentifizierten Nutzers — eine Viewerin erhält für unzugängliche Bereiche eine leere Liste (oder 403); auf MCP-Ebene ist keine Pro-Tool-Konfiguration nötig.

### Schreib-Werkzeuge

Der Server stellt 17 Schreib-Werkzeuge bereit, jedes annotiert als **additiv** (erstellt oder erweitert Daten) oder **destruktiv** (verändert oder entfernt bestehende Daten), damit Konnektoren entsprechend warnen können.

**Additiv (13)**

| Werkzeug | Beschreibung |
|----------|--------------|
| `create_cards_bulk` | Erstellt mehrere Karten in einem Aufruf (z. B. Tabellenzeilen). Unterstützt Eltern-Referenzen per Name innerhalb desselben Batches mit serverseitiger topologischer Sortierung. |
| `transition_card_lifecycle` | Bewegt eine Karte durch Genehmigungs- oder Lebenszyklus-Phasen. |
| `create_risks` | Erstellt Einträge im EA-Risikoregister. |
| `update_risks` | Aktualisiert Risikoregister-Einträge (Felder, verknüpfte Karten). |
| `add_card_comment` | Hinterlässt einen Kommentar an einer Karte — eine nicht-destruktive, überprüfbare Notiz statt einer Feldänderung. |
| `create_soaw` | Erstellt ein Statement of Architecture Work für eine Initiative. |
| `assign_stakeholders` | Weist Stakeholder-Rollen an Karten zu oder entfernt sie. |
| `update_cards_bulk` | Feldweise Patches an vielen Karten in einem Aufruf. |
| `create_adr` | Erstellt ein Architecture Decision Record. |
| `update_adr` | Aktualisiert ein ADR (Titel, Abschnitte, Status, verknüpfte Karten). |
| `sign_adr` | Unterschreibt ein ADR (erfordert die Berechtigung `adr.sign`; andernfalls wird ein UI-Deep-Link zum Unterschreiben im Browser zurückgegeben). |
| `create_diagram` | Erstellt ein frei gestaltetes DrawIO-Diagramm mit optionalen Verknüpfungen zu bestehenden Karten. |
| `import_bpmn` | Speichert ein BPMN-2.0-XML-Diagramm an einer **bestehenden** Geschäftsprozess-Karte. Existiert keine Karte mit dem angegebenen Namen, liefert das Werkzeug einen `card_not_found`-Fehler, der den Agenten an `create_cards_bulk` verweist — so muss die Karte zuerst explizit mit Beschreibung, Subtyp und Attributen angelegt werden, statt auf eine Abkürzung auszuweichen, die eine spärliche Karte erzeugt. |

**Destruktiv (4)**

| Werkzeug | Beschreibung |
|----------|--------------|
| `upsert_relations_bulk` | Erstellt oder löscht Beziehungen zwischen Karten. Quelle / Ziel / Typ werden gegen das Metamodell validiert. Löschungen werden abgelehnt, sofern der Operator nicht ausdrücklich zustimmt (siehe Schutzmechanismen). |
| `archive_cards` | Soft-Delete von Karten. Wiederherstellbar — archivierte Karten können 30 Tage lang wiederhergestellt werden, bevor sie automatisch endgültig gelöscht werden. |
| `update_diagram` | Ersetzt das DrawIO-XML, den Namen oder die Kartenverknüpfungen eines Diagramms. |
| `rollback_batch` | Macht die Schreibvorgänge eines früheren Mutations-Batches rückgängig. |

### Artefakt-Upload

Eine Teilmenge der Schreib-Werkzeuge (`create_cards_bulk`, `upsert_relations_bulk`, `create_diagram`, `import_bpmn`) erlaubt einem KI-Agenten, Artefakte in strukturierte EA-Daten umzuwandeln. Der Agent liest die Quelldatei in seinem eigenen Kontext (multimodale Bildverarbeitung, Dateianhänge), extrahiert strukturierte Zeilen und ruft diese Werkzeuge auf. Der MCP-Server selbst analysiert niemals Dateien — er erwartet bereits strukturierte Eingaben.

Typischer Ablauf, wenn ein Benutzer dem KI-Agenten eine Tabelle freigibt:

1. Der Agent ruft `list_card_types` und `get_relation_types` auf, um das Metamodell zu verstehen.
2. Der Agent parst die Tabelle (in seinem eigenen Kontext, nicht in MCP) und baut Zeilen-Dicts.
3. Der Agent ruft `create_cards_bulk(cards=…, dry_run=True)` auf und zeigt dem Benutzer die Vorschau.
4. Der Benutzer bestätigt; der Agent ruft erneut mit `dry_run=False` auf, um zu übernehmen.
5. Falls Beziehungsspalten vorhanden sind, ruft der Agent anschließend `upsert_relations_bulk` mit demselben Trockenlauf-/Bestätigungszyklus auf.

### Schutzmechanismen für Schreib-Werkzeuge

Verteidigung in der Tiefe zusätzlich zum Trockenlauf, damit ein Fehlverhalten des LLM keinen Massenschaden verursachen kann:

- **Größenbegrenzung pro Aufruf.** Die MCP-Schreib-Werkzeuge erzwingen eine wesentlich kleinere Obergrenze als die zugrunde liegenden Excel-Import-Endpunkte: 200 Zeilen für `create_cards_bulk`, 500 Operationen für `upsert_relations_bulk`. Groß genug für jeden realistischen Einzel-Artefakt-Upload, klein genug, dass eine Trockenlauf-Vorschau überprüfbar bleibt.
- **Standardmäßig keine Löschung von Beziehungen.** `upsert_relations_bulk` lehnt `action: "delete"`-Operationen ab — um Beziehungen zu entfernen, ist die Weboberfläche zu verwenden, wo die Aktion unter der Identität des Benutzers erfasst wird. Operatoren können dies aktivieren, indem sie `MCP_ALLOW_RELATION_DELETE=true` setzen.
- **Notausschalter.** `MCP_WRITES_ENABLED=false` schaltet alle 17 Schreib-Werkzeuge aus, ohne dass Code neu bereitgestellt werden muss. Die 30 Lese-Werkzeuge funktionieren weiter.
- **Audit-Herkunfts-Marker.** Jede Backend-Anfrage vom MCP-Server trägt einen `X-Turbo-EA-Origin: mcp`-Header. Ereignisse, die aus diesen Anfragen emittiert werden, werden im Audit-Log-Payload mit `origin: "mcp"` markiert, sodass Administratoren MCP-gesteuerte Schreibvorgänge getrennt von Web-UI-Aktionen aus der Zeitleiste filtern können.
- **Mutations-Batches.** Jeder MCP-Schreibaufruf öffnet vor allen Schreibvorgängen einen Mutations-Batch; jedes während des Aufrufs emittierte Ereignis wird mit der Batch-ID gestempelt. Administratoren (oder das Werkzeug `get_change_history`) können aus einer einzigen ID den vollständigen Ereignis-Diff eines Commits rekonstruieren, und `rollback_batch` kann ihn rückgängig machen. Commits oberhalb von `MCP_BATCH_CONFIRMATION_THRESHOLD` Zeilen müssen ein einmaliges `confirm_token` zurückgeben, das der vorherige Trockenlauf ausgestellt hat (15 Minuten Gültigkeit) — ein großer Commit folgt also immer auf eine geprüfte Vorschau.
- **Kein endgültiges Löschen.** Die Werkzeugsammlung lässt bewusst das dauerhafte Löschen von Karten weg. `archive_cards` und `update_cards_bulk` *sind* verfügbar, aber die Archivierung ist ein wiederherstellbares Soft-Delete (30-Tage-Wiederherstellungsfenster) und beide sind mit Destruktivitäts-Annotationen versehen und durch den Trockenlauf abgesichert. Das Hinzufügen eines Werkzeugs, das eine irreversible Mutation durchführt (endgültiges Löschen, erzwungenes Bereinigen), würde eine explizite Designprüfung erfordern.

Die sechs Umgebungsvariablen für Schutzmechanismen auf dem MCP-Container:

| Variable | Standard | Wirkung |
|----------|----------|---------|
| `MCP_WRITES_ENABLED` | `true` | Hauptschalter für Schreib-Werkzeuge. `false` → schreibgeschützter MCP. |
| `MCP_MAX_CARDS_PER_CALL` | `200` | Harte Obergrenze für `create_cards_bulk`- / `update_cards_bulk`-Zeilen pro Anfrage. |
| `MCP_MAX_RELATIONS_PER_CALL` | `500` | Harte Obergrenze für `upsert_relations_bulk`-Operationen pro Anfrage. |
| `MCP_ALLOW_RELATION_DELETE` | `false` | Bei `true` akzeptiert `upsert_relations_bulk` `action: "delete"`-Operationen. |
| `MCP_BATCH_CONFIRMATION_THRESHOLD` | `20` | Commits, die mehr Zeilen als diesen Wert berühren, erfordern das `confirm_token` aus einem vorherigen Trockenlauf. |
| `MCP_REQUIRE_DRYRUN_FIRST` | `true` | Aktiviert das obige Confirm-Token-Gate. Nur für vertrauenswürdige Automatisierungs-Pipelines, die den Vorschau-Zyklus bewusst überspringen, auf `false` setzen. |

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
| **Administrator** | MCP-Einstellungen konfigurieren (Berechtigung `admin.mcp`). Vollständiger Lese- + Schreibzugriff über MCP. |
| **Alle authentifizierten Benutzer** | Lesezugriff gemäß ihrem bestehenden RBAC. Schreib-Werkzeuge erfordern die entsprechenden Backend-Berechtigungen — `inventory.create` / `inventory.edit` / `inventory.archive` (Karten), `relations.manage` (Beziehungen), `diagrams.manage` (Diagramme), `bpm.edit` (BPMN), `risks.manage` (Risikoregister), `comments.create` (Kommentare), `stakeholders.manage` (Stakeholder), `soaw.create` (SoAW), `adr.create` / `adr.sign` (ADRs). |

Die Berechtigung `admin.mcp` steuert, wer MCP-Einstellungen verwalten kann. Sie ist standardmäßig nur für die Admin-Rolle verfügbar. Benutzerdefinierten Rollen kann diese Berechtigung über die Rollenverwaltungsseite gewährt werden.

Der Datenzugriff über MCP — lesend oder schreibend — folgt demselben RBAC-Modell wie die Weboberfläche. Wenn ein Benutzer in der Inventaroberfläche keine Karten erstellen kann, kann er sie auch nicht über MCP erstellen; es gibt keine separaten MCP-spezifischen Datenberechtigungen.

---

## Sicherheit

- **SSO-delegierte Authentifizierung**: Benutzer authentifizieren sich über ihren SSO-Anbieter des Unternehmens. Der MCP-Server sieht oder speichert niemals Passwörter.
- **OAuth 2.1 mit PKCE**: Der Authentifizierungsablauf verwendet Proof Key for Code Exchange (S256), um das Abfangen von Autorisierungscodes zu verhindern.
- **RBAC pro Benutzer**: Jede MCP-Aktion — lesend oder schreibend — läuft mit den Berechtigungen des authentifizierten Benutzers. Keine gemeinsamen Dienstkonten.
- **Trockenlauf standardmäßig beim Schreiben**: Schreib-Werkzeuge nutzen standardmäßig eine Validieren-und-Rückgängig-Vorschau. Das KI-Werkzeug muss explizit erneut mit `dry_run=false` aufrufen, bevor irgendetwas dauerhaft gespeichert wird, und jede Änderung wird unter der Identität des Benutzers protokolliert.
- **Keine Dateiverarbeitung in MCP**: Der MCP-Server selbst nimmt keine PDFs, Excel-Dateien, Bilder oder anderen binären Artefakte entgegen. Das aufrufende KI-Werkzeug analysiert sie in seinem eigenen Kontext und sendet strukturierte Zeilen. Das hält die Angriffsfläche schmal und vermeidet, dass der Server fehlerhaften Binäreingaben ausgesetzt wird.
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
