# KI-Funktionen

![KI-Vorschlagseinstellungen](../assets/img/en/26_admin_settings_ai.png)

Turbo EA enthält KI-gestützte Funktionen, die ein **Large Language Model (LLM)** nutzen, um Benutzer zu unterstützen. Alle KI-Funktionen teilen sich eine einzige **KI-Anbieterkonfiguration** — einmal einrichten, überall nutzen.

Derzeit verfügbare KI-Funktionen:

- **Beschreibungsvorschläge** — Automatische Generierung von Kartenbeschreibungen mittels Websuche + LLM
- **Portfolio-Erkenntnisse** — Bedarfsgesteuerte strategische Analyse des Anwendungsportfolios

Diese Funktionen sind **optional** und **vollständig vom Administrator steuerbar**. Sie können vollständig auf Ihrer eigenen Infrastruktur mit einer lokalen Ollama-Instanz laufen oder mit kommerziellen LLM-Anbietern verbunden werden.

---

## Funktionsweise

Die KI-Vorschlags-Pipeline hat zwei Schritte:

1. **Websuche** — Turbo EA befragt einen Suchanbieter (DuckDuckGo, Google Custom Search oder SearXNG) unter Verwendung des Kartennamens und -typs als Kontext. Zum Beispiel generiert eine Anwendungskarte namens «SAP S/4HANA» eine Suche nach «SAP S/4HANA Softwareanwendung».

2. **LLM-Extraktion** — Die Suchergebnisse werden zusammen mit einem typbezogenen System-Prompt an das konfigurierte LLM gesendet. Das Modell erstellt eine Beschreibung, einen Konfidenzwert (0–100%) und listet die verwendeten Quellen auf.

Das Ergebnis wird dem Benutzer präsentiert mit:

- Einer **bearbeitbaren Beschreibung**, die vor dem Anwenden überprüft und geändert werden kann
- Einem **Konfidenz-Badge**, das anzeigt, wie zuverlässig der Vorschlag ist
- **Quellenlinks**, damit der Benutzer die Informationen überprüfen kann

---

## Unterstützte LLM-Anbieter

| Anbieter | Typ | Konfiguration |
|----------|-----|---------------|
| **Ollama** | Selbst gehostet | Anbieter-URL (z.B. `http://ollama:11434`) + Modellname |
| **OpenAI** | Kommerziell | API-Schlüssel + Modellname (z.B. `gpt-4o`) |
| **Google Gemini** | Kommerziell | API-Schlüssel + Modellname |
| **Azure OpenAI** | Kommerziell | API-Schlüssel + Deployment-URL |
| **OpenRouter** | Kommerziell | API-Schlüssel + Modellname |
| **Anthropic Claude** | Kommerziell | API-Schlüssel + Modellname |

Kommerzielle Anbieter erfordern einen API-Schlüssel, der mit Fernet symmetrischer Verschlüsselung in der Datenbank verschlüsselt gespeichert wird.

---

## Suchanbieter

| Anbieter | Einrichtung | Hinweise |
|----------|-------------|---------|
| **DuckDuckGo** | Keine Konfiguration nötig | Standard. Abhängigkeitsfreies HTML-Scraping. Kein API-Schlüssel erforderlich. |
| **Google Custom Search** | Erfordert API-Schlüssel und Custom Search Engine ID | Als `API_KEY:CX` im Suchfeld-URL eingeben. Qualitativ hochwertigere Ergebnisse. |
| **SearXNG** | Erfordert eine selbst gehostete SearXNG-Instanz-URL | Datenschutzorientierte Meta-Suchmaschine. JSON-API. |

---

## Einrichtung

### Option A: Mitgeliefertes Ollama (Docker Compose)

Der einfachste Weg zum Einstieg. Turbo EA enthält einen optionalen Ollama-Container in seiner Docker-Compose-Konfiguration.

**1. Mit dem AI-Profil starten:**

```bash
docker compose --profile ai up --build -d
```

**2. Auto-Konfiguration aktivieren** durch Hinzufügen dieser Variablen zu Ihrer `.env`:

```dotenv
AI_AUTO_CONFIGURE=true
AI_MODEL=gemma3:4b          # oder mistral, llama3:8b usw.
```

Beim Start wird das Backend:

- Den Ollama-Container erkennen
- Die Verbindungseinstellungen in der Datenbank speichern
- Das konfigurierte Modell herunterladen, wenn es noch nicht vorhanden ist (läuft im Hintergrund, kann einige Minuten dauern)

**3. Überprüfen** Sie in der Admin-Oberfläche: Gehen Sie zu **Einstellungen > KI-Vorschläge** und bestätigen Sie, dass der Status als verbunden angezeigt wird.

### Option B: Externe Ollama-Instanz

Wenn Sie Ollama bereits auf einem separaten Server betreiben:

1. Gehen Sie zu **Einstellungen > KI-Vorschläge** in der Admin-Oberfläche.
2. Wählen Sie **Ollama** als Anbietertyp.
3. Geben Sie die **Anbieter-URL** ein (z.B. `http://ihr-server:11434`).
4. Klicken Sie auf **Verbindung testen** — das System zeigt verfügbare Modelle an.
5. Wählen Sie ein **Modell** aus dem Dropdown.
6. Klicken Sie auf **Speichern**.

### Option C: Kommerzieller LLM-Anbieter

1. Gehen Sie zu **Einstellungen > KI-Vorschläge** in der Admin-Oberfläche.
2. Wählen Sie Ihren Anbieter (OpenAI, Google Gemini, Azure OpenAI, OpenRouter oder Anthropic Claude).
3. Geben Sie Ihren **API-Schlüssel** ein — er wird vor der Speicherung verschlüsselt.
4. Geben Sie den **Modellnamen** ein (z.B. `gpt-4o`, `gemini-pro`, `claude-sonnet-4-20250514`).
5. Klicken Sie auf **Verbindung testen** zur Überprüfung.
6. Klicken Sie auf **Speichern**.

---

## Konfigurationsoptionen

Nach der Verbindung können Sie die Funktion in **Einstellungen > KI-Vorschläge** feinabstimmen:

### Pro Kartentyp aktivieren/deaktivieren

Nicht jeder Kartentyp profitiert gleichermaßen von KI-Vorschlägen. Sie können KI für jeden Typ einzeln aktivieren oder deaktivieren. Zum Beispiel könnten Sie sie für Anwendungs- und IT-Komponenten-Karten aktivieren, aber für Organisations-Karten deaktivieren, bei denen Beschreibungen unternehmensspezifisch sind.

### Suchanbieter

Wählen Sie, welcher Websuchanbieter zum Sammeln von Kontext vor dem Senden an das LLM verwendet wird. DuckDuckGo funktioniert ohne Konfiguration sofort. Google Custom Search und SearXNG erfordern zusätzliche Einrichtung (siehe die Suchanbieter-Tabelle oben).

### Modellauswahl

Für Ollama zeigt die Admin-Oberfläche alle aktuell auf der Ollama-Instanz heruntergeladenen Modelle an. Für kommerzielle Anbieter geben Sie den Modellbezeichner direkt ein.

---

## KI-Vorschläge verwenden

![KI-Vorschlags-Panel auf der Kartendetailseite](../assets/img/en/27_ai_suggest_panel.png)

Sobald von einem Administrator konfiguriert, sehen Benutzer mit der Berechtigung `ai.suggest` (standardmäßig für Admin-, BPM-Admin- und Mitglieder-Rollen gewährt) eine Funkenschaltfläche auf Kartendetailseiten und im Karte-erstellen-Dialog.

### Auf einer bestehenden Karte

1. Öffnen Sie die Detailansicht einer beliebigen Karte.
2. Klicken Sie auf die **Funkenschaltfläche** (sichtbar neben dem Beschreibungsabschnitt, wenn KI für diesen Kartentyp aktiviert ist).
3. Warten Sie einige Sekunden auf die Websuche und LLM-Verarbeitung.
4. Überprüfen Sie den Vorschlag: Lesen Sie die generierte Beschreibung, prüfen Sie den Konfidenzwert und verifizieren Sie die Quellenlinks.
5. **Bearbeiten** Sie den Text bei Bedarf — der Vorschlag ist vor dem Anwenden vollständig bearbeitbar.
6. Klicken Sie auf **Übernehmen**, um die Beschreibung zu setzen, oder **Verwerfen**, um sie zu ignorieren.

### Beim Erstellen einer neuen Karte

1. Öffnen Sie den Dialog **Karte erstellen**.
2. Nach Eingabe des Kartennamens wird die KI-Vorschlags-Schaltfläche verfügbar.
3. Klicken Sie darauf, um die Beschreibung vor dem Speichern vorauszufüllen.

### Anwendungsspezifische Vorschläge

Für **Anwendungs**-Karten kann die KI auch zusätzliche Felder vorschlagen, wenn sie Belege in den Websuchergebnissen findet:

- **Kommerzielle Anwendung** — wird aktiviert, wenn Preis-, Lizenzinformations- oder Vertriebskontaktseiten gefunden werden
- **Hosting-Typ** — wird als On-Premise, Cloud (SaaS), Cloud (PaaS), Cloud (IaaS) oder Hybrid basierend auf dem Bereitstellungsmodell des Produkts vorgeschlagen

Diese Felder werden nur vorgeschlagen, wenn die KI eindeutige Belege findet — es wird nicht spekuliert. Der Benutzer kann die Werte vor dem Anwenden überprüfen und anpassen.

!!! note
    Abgesehen von anwendungsspezifischen Feldern generieren KI-Vorschläge hauptsächlich das **Beschreibungs**-Feld. Benutzerdefinierte Felder für andere Kartentypen werden noch nicht abgedeckt.

---

## Portfolio-Erkenntnisse

Wenn aktiviert, zeigt der Anwendungsportfolio-Bericht eine Schaltfläche **KI-Erkenntnisse**. Ein Klick sendet eine Zusammenfassung der aktuellen Portfolioansicht — Gruppierung, Attributverteilungen und Lebenszyklusdaten — an das konfigurierte LLM, das 3–5 umsetzbare Erkenntnisse zurückgibt.

Die Erkenntnisse konzentrieren sich auf:

- **Konzentrationsrisiken** — zu viele Anwendungen in einer Gruppe oder einem Zustand
- **Modernisierungsmöglichkeiten** — basierend auf Lebenszyklus- und Hosting-Daten
- **Portfolio-Ausgewogenheit** — Diversität über Subtypen, Gruppen und Attribute
- **Lebenszyklus-Bedenken** — Anwendungen, die das Ende der Lebensdauer erreichen
- **Kosten- oder Komplexitätstreiber** — basierend auf Attributverteilungen

### Portfolio-Erkenntnisse aktivieren

1. Gehen Sie zu **Einstellungen > KI > Portfolio-Erkenntnisse**.
2. Schalten Sie **Portfolio-Erkenntnisse** ein.
3. Klicken Sie auf **Speichern**.

---

## Berechtigungen

| Rolle | Zugriff |
|-------|---------|
| **Admin** | Vollständiger Zugriff: KI-Einstellungen konfigurieren, Vorschläge und Portfolio-Erkenntnisse nutzen |
| **BPM-Admin** | Vorschläge und Portfolio-Erkenntnisse nutzen |
| **Mitglied** | Vorschläge und Portfolio-Erkenntnisse nutzen |
| **Betrachter** | Kein Zugriff auf KI-Funktionen |

Die Berechtigungsschlüssel sind `ai.suggest` und `ai.portfolio_insights`. Benutzerdefinierten Rollen können diese Berechtigungen über die Rollenverwaltungsseite gewährt werden.

---

## Datenschutz und Sicherheit

- **Selbst gehostete Option**: Bei Verwendung von Ollama findet die gesamte KI-Verarbeitung auf Ihrer eigenen Infrastruktur statt. Keine Daten verlassen Ihr Netzwerk.
- **Verschlüsselte API-Schlüssel**: API-Schlüssel kommerzieller Anbieter werden mit Fernet symmetrischer Verschlüsselung verschlüsselt, bevor sie in der Datenbank gespeichert werden.
- **Nur Suchkontext**: Das LLM erhält Websuchergebnisse und den Namen/Typ der Karte — nicht Ihre internen Kartendaten, Beziehungen oder andere sensible Metadaten.
- **Benutzerkontrolle**: Jeder Vorschlag muss von einem Benutzer überprüft und explizit angewendet werden. KI ändert Karten nie automatisch.

---

## Fehlerbehebung

| Problem | Lösung |
|---------|--------|
| KI-Vorschlags-Schaltfläche nicht sichtbar | Prüfen Sie, ob KI für den Kartentyp in Einstellungen > KI-Vorschläge aktiviert ist und ob der Benutzer die Berechtigung `ai.suggest` hat. |
| Status «KI nicht konfiguriert» | Gehen Sie zu Einstellungen > KI-Vorschläge und schließen Sie die Anbietereinrichtung ab. Klicken Sie auf Verbindung testen zur Überprüfung. |
| Modell erscheint nicht im Dropdown | Für Ollama: Stellen Sie sicher, dass das Modell heruntergeladen ist (`ollama pull modell-name`). Für kommerzielle Anbieter: Geben Sie den Modellnamen manuell ein. |
| Langsame Vorschläge | Die LLM-Inferenzgeschwindigkeit hängt von der Hardware ab (bei Ollama) oder der Netzwerklatenz (bei kommerziellen Anbietern). Kleinere Modelle wie `gemma3:4b` sind schneller als größere. |
| Niedrige Konfidenzwerte | Das LLM findet möglicherweise nicht genügend relevante Informationen über die Websuche. Versuchen Sie einen spezifischeren Kartennamen oder erwägen Sie die Verwendung von Google Custom Search für bessere Ergebnisse. |
| Verbindungstest schlägt fehl | Überprüfen Sie, ob die Anbieter-URL vom Backend-Container aus erreichbar ist. Bei Docker-Setups stellen Sie sicher, dass beide Container im selben Netzwerk sind. |

---

## Umgebungsvariablen

Diese Umgebungsvariablen bieten eine initiale KI-Konfiguration. Sobald sie über die Admin-Oberfläche gespeichert werden, haben die Datenbankeinstellungen Vorrang.

| Variable | Standard | Beschreibung |
|----------|---------|-------------|
| `AI_PROVIDER_URL` | *(leer)* | Ollama-kompatible LLM-Anbieter-URL |
| `AI_MODEL` | *(leer)* | LLM-Modellname (z.B. `gemma3:4b`, `mistral`) |
| `AI_SEARCH_PROVIDER` | `duckduckgo` | Websuchanbieter: `duckduckgo`, `google` oder `searxng` |
| `AI_SEARCH_URL` | *(leer)* | Suchanbieter-URL oder API-Anmeldedaten |
| `AI_AUTO_CONFIGURE` | `false` | KI beim Start automatisch aktivieren, wenn der Anbieter erreichbar ist |
