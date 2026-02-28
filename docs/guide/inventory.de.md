# Inventar

Das **Inventar** ist das Herzstück von Turbo EA. Hier werden alle **Karten** (Komponenten) der Unternehmensarchitektur aufgelistet: Anwendungen, Prozesse, Geschäftsfähigkeiten, Organisationen, Anbieter, Schnittstellen und mehr.

![Inventaransicht mit Filterpanel](../assets/img/en/23_inventory_filters.png)

## Aufbau des Inventarbildschirms

### Linkes Filterpanel

Das linke Seitenpanel ermöglicht es Ihnen, Karten nach verschiedenen Kriterien zu **filtern**:

- **Suche** — Freitextsuche über Kartennamen
- **Typen** — Filtern nach einem oder mehreren Kartentypen: Ziel, Plattform, Initiative, Organisation, Geschäftsfähigkeit, Geschäftskontext, Geschäftsprozess, Anwendung, Schnittstelle, Datenobjekt, IT-Komponente, Technologiekategorie, Anbieter, System
- **Subtypen** — Wenn ein Typ ausgewählt ist, können Sie weiter nach Subtyp filtern (z.B. Anwendung -> Geschäftsanwendung, Microservice, AI Agent, Deployment)
- **Genehmigungsstatus** — Entwurf, Genehmigt, Ungültig oder Abgelehnt
- **Lebenszyklus** — Filtern nach Lebenszyklusphase: Planung, Einführung, Aktiv, Auslauf, Lebensende
- **Datenqualität** — Schwellenwertbasiertes Filtern: Gut (80%+), Mittel (50–79%), Schlecht (unter 50%)
- **Tags** — Filtern nach Tags aus beliebigen Tag-Gruppen
- **Beziehungen** — Filtern nach verwandten Karten über Beziehungstypen
- **Benutzerdefinierte Attribute** — Filtern nach Werten in benutzerdefinierten Feldern (Textsuche, Auswahloptionen)
- **Nur archivierte anzeigen** — Umschalter zur Anzeige archivierter (weich gelöschter) Karten
- **Alle zurücksetzen** — Alle aktiven Filter auf einmal zurücksetzen

Ein **Badge mit der Anzahl aktiver Filter** zeigt an, wie viele Filter derzeit angewendet werden.

### Haupttabelle

Das Inventar verwendet eine **AG Grid**-Datentabelle mit leistungsstarken Funktionen:

| Spalte | Beschreibung |
|--------|-------------|
| **Typ** | Kartentyp mit farbcodiertem Symbol |
| **Name** | Komponentenname (klicken zum Öffnen der Kartendetails) |
| **Beschreibung** | Kurzbeschreibung |
| **Lebenszyklus** | Aktueller Lebenszyklusstatus |
| **Genehmigungsstatus** | Badge des Prüfstatus |
| **Datenqualität** | Vollständigkeitsprozentsatz mit visuellem Ring |
| **Beziehungen** | Beziehungsanzahl mit klickbarem Popover, das verwandte Karten anzeigt |

**Tabellenfunktionen:**

- **Sortierung** — Klicken Sie auf eine Spaltenüberschrift zum auf-/absteigenden Sortieren
- **Inline-Bearbeitung** — Im Rasterbearbeitungsmodus können Feldwerte direkt in der Tabelle bearbeitet werden
- **Mehrfachauswahl** — Mehrere Zeilen für Massenoperationen auswählen
- **Hierarchieanzeige** — Eltern-/Kind-Beziehungen werden als Brotkrumenpfade dargestellt
- **Spaltenkonfiguration** — Spalten ein-/ausblenden und neu anordnen

### Werkzeugleiste

- **Rasterbearbeitung** — Inline-Bearbeitungsmodus zum Bearbeiten mehrerer Karten in der Tabelle umschalten
- **Export** — Daten als Excel-Datei (.xlsx) herunterladen
- **Import** — Daten aus Excel-Dateien massenweise hochladen
- **+ Erstellen** — Eine neue Karte erstellen

![Karte-erstellen-Dialog](../assets/img/en/22_create_card.png)

## Wie man eine neue Karte erstellt

1. Klicken Sie auf die Schaltfläche **+ Erstellen** (blau, rechte obere Ecke)
2. Im angezeigten Dialog:
   - Wählen Sie den **Typ** der Karte (Anwendung, Prozess, Ziel usw.)
   - Geben Sie den **Namen** der Komponente ein
   - Optional: Fügen Sie eine **Beschreibung** hinzu
3. Optional: Klicken Sie auf **Mit KI vorschlagen**, um automatisch eine Beschreibung zu generieren (siehe [KI-Beschreibungsvorschläge](#ki-beschreibungsvorschläge) unten)
4. Klicken Sie auf **ERSTELLEN**

## KI-Beschreibungsvorschläge

Turbo EA kann **KI verwenden, um eine Beschreibung** für jede Karte zu generieren. Dies funktioniert sowohl im Karte-erstellen-Dialog als auch auf bestehenden Kartendetailseiten.

**So funktioniert es:**

1. Geben Sie einen Kartennamen ein und wählen Sie einen Typ
2. Klicken Sie auf das **Funkensymbol** in der Kartenüberschrift oder auf die Schaltfläche **Mit KI vorschlagen** im Karte-erstellen-Dialog
3. Das System führt eine **Websuche** nach dem Elementnamen durch (mit typbezogenem Kontext — z.B. «SAP S/4HANA Softwareanwendung»), sendet die Ergebnisse dann an ein **LLM**, um eine prägnante, sachliche Beschreibung zu generieren
4. Ein Vorschlagspanel erscheint mit:
   - **Bearbeitbarer Beschreibung** — Text vor dem Anwenden überprüfen und ändern
   - **Konfidenzwert** — zeigt an, wie sicher die KI ist (Hoch / Mittel / Niedrig)
   - **Klickbare Quellenlinks** — die Webseiten, aus denen die Beschreibung abgeleitet wurde
   - **Modellname** — welches LLM den Vorschlag generiert hat
5. Klicken Sie auf **Beschreibung übernehmen** zum Speichern oder **Verwerfen** zum Ablehnen

**Wesentliche Eigenschaften:**

- **Typbezogen**: Die KI versteht den Kartentyp-Kontext. Eine «Anwendung»-Suche fügt «Softwareanwendung» hinzu, eine «Anbieter»-Suche fügt «Technologieanbieter» hinzu usw.
- **Datenschutz zuerst**: Bei Verwendung von Ollama läuft das LLM lokal — Ihre Daten verlassen nie Ihre Infrastruktur. Kommerzielle Anbieter (OpenAI, Google Gemini, Anthropic Claude usw.) werden ebenfalls unterstützt
- **Vom Administrator gesteuert**: KI-Vorschläge müssen von einem Administrator in [Einstellungen > KI-Vorschläge](../admin/ai.md) aktiviert werden. Administratoren wählen, welche Kartentypen die Vorschlagsschaltfläche anzeigen, konfigurieren den LLM-Anbieter und wählen den Websuchanbieter
- **Berechtigungsbasiert**: Nur Benutzer mit der Berechtigung `ai.suggest` können diese Funktion nutzen (standardmäßig für Admin-, BPM-Admin- und Mitglieder-Rollen aktiviert)

## Gespeicherte Ansichten (Lesezeichen)

Sie können Ihre aktuelle Filter-, Spalten- und Sortierkonfiguration als **benannte Ansicht** zur schnellen Wiederverwendung speichern.

### Eine gespeicherte Ansicht erstellen

1. Konfigurieren Sie das Inventar mit Ihren gewünschten Filtern, Spalten und Sortierungen
2. Klicken Sie auf das **Lesezeichen**-Symbol im Filterpanel
3. Geben Sie einen **Namen** für die Ansicht ein
4. Wählen Sie die **Sichtbarkeit**:
   - **Privat** — Nur Sie können sie sehen
   - **Geteilt** — Sichtbar für bestimmte Benutzer (mit optionalen Bearbeitungsrechten)
   - **Öffentlich** — Sichtbar für alle Benutzer

### Gespeicherte Ansichten verwenden

Gespeicherte Ansichten erscheinen in der Seitenleiste des Filterpanels. Klicken Sie auf eine beliebige Ansicht, um deren Konfiguration sofort anzuwenden. Ansichten sind unterteilt in:

- **Meine Ansichten** — Von Ihnen erstellte Ansichten
- **Mit mir geteilt** — Ansichten, die andere mit Ihnen geteilt haben
- **Öffentliche Ansichten** — Ansichten, die für alle verfügbar sind

## Excel-Import

Klicken Sie auf **Import** in der Werkzeugleiste, um Karten aus einer Excel-Datei massenhaft zu erstellen oder zu aktualisieren.

1. **Datei auswählen** — Eine `.xlsx`-Datei per Drag & Drop ablegen oder zum Durchsuchen klicken
2. **Kartentyp wählen** — Optional den Import auf einen bestimmten Typ beschränken
3. **Validierung** — Das System analysiert die Datei und zeigt einen Validierungsbericht:
   - Zeilen, die neue Karten erstellen werden
   - Zeilen, die bestehende Karten aktualisieren werden (nach Name oder ID zugeordnet)
   - Warnungen und Fehler
4. **Import** — Klicken Sie zum Fortfahren. Ein Fortschrittsbalken zeigt den Echtzeitstatus
5. **Ergebnisse** — Eine Zusammenfassung zeigt, wie viele Karten erstellt, aktualisiert oder fehlgeschlagen sind

## Excel-Export

Klicken Sie auf **Export**, um die aktuelle Inventaransicht als Excel-Datei herunterzuladen:

- **Multi-Typ-Export** — Exportiert alle sichtbaren Karten mit Kernspalten (Name, Typ, Beschreibung, Subtyp, Lebenszyklus, Genehmigungsstatus)
- **Einzeltyp-Export** — Bei Filterung auf einen Typ enthält der Export erweiterte benutzerdefinierte Attributspalten (eine Spalte pro Feld)
- **Lebenszyklus-Erweiterung** — Separate Spalten für jedes Lebenszyklusphase-Datum (Planung, Einführung, Aktiv, Auslauf, Lebensende)
- **Datumsstempel im Dateinamen** — Die Datei wird mit dem Exportdatum benannt für einfache Organisation
