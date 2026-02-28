# KI-Beschreibungsvorschläge

![KI-Vorschlagseinstellungen](../assets/img/en/26_admin_settings_ai.png)

Turbo EA kann Kartenbeschreibungen automatisch generieren, indem eine Kombination aus **Websuche** und einem **Large Language Model (LLM)** verwendet wird. Wenn ein Benutzer auf die KI-Vorschlags-Schaltfläche einer Karte klickt, durchsucht das System das Web nach relevanten Informationen über die Komponente und verwendet dann ein LLM, um eine prägnante, typbezogene Beschreibung zu erstellen — komplett mit einem Konfidenzwert und klickbaren Quellenlinks.

Diese Funktion ist **optional** und **vollständig vom Administrator steuerbar**. Sie kann vollständig auf Ihrer eigenen Infrastruktur mit einer lokalen Ollama-Instanz laufen oder mit kommerziellen LLM-Anbietern verbunden werden.

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

!!! note
    KI-Vorschläge generieren nur das **Beschreibungs**-Feld. Sie füllen keine anderen Attribute wie Lebenszyklus, Kosten oder benutzerdefinierte Felder aus.

---

## Berechtigungen

| Rolle | Zugriff |
|-------|---------|
| **Admin** | Vollständiger Zugriff: KI-Einstellungen konfigurieren und Vorschläge nutzen |
| **BPM-Admin** | Vorschläge nutzen |
| **Mitglied** | Vorschläge nutzen |
| **Betrachter** | Kein Zugriff auf KI-Vorschläge |

Der Berechtigungsschlüssel ist `ai.suggest`. Benutzerdefinierten Rollen kann diese Berechtigung über die Rollenverwaltungsseite gewährt werden.

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
