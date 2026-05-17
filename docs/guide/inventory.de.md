# Inventar

Das **Inventar** ist das Herzstück von Turbo EA. Hier werden alle **Karten** (Komponenten) der Unternehmensarchitektur aufgelistet: Anwendungen, Prozesse, Geschäftsfähigkeiten, Organisationen, Anbieter, Schnittstellen und mehr.

![Inventaransicht mit Filterpanel](../assets/img/de/23_inventar_filter.png)

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

### Registerkarte Spalten

Die Registerkarte **Spalten** im Seitenbereich ermöglicht es Ihnen, zusätzliche Spalten im Raster ein- und auszublenden. Die verfügbaren Spalten ändern sich dynamisch basierend auf den ausgewählten Kartentypen:

- **Ein Typ ausgewählt** — Alle für diesen Typ definierten Attributfelder sind verfügbar, plus Beziehungsspalten und Metadatenspalten
- **Mehrere Typen ausgewählt** — Nur Felder, die **allen ausgewählten Typen gemeinsam** sind, stehen zur Verfügung
- **Kein Typ ausgewählt** — Ein Hinweis fordert Sie auf, zuerst einen Kartentyp auszuwählen

Spalten sind in vier Kategorien gruppiert:

| Kategorie | Beschreibung |
|-----------|-------------|
| **Standardspalten** | Immer aktive Spalten: Typ, Name, Pfad, Beschreibung, Untertyp, Lebenszyklus, Genehmigungsstatus, Datenqualität. Heben Sie eine davon ab, um sie aus dem Raster auszublenden — nützlich, um eine gespeicherte Ansicht auf genau die Spalten zu reduzieren, die Sie wirklich verwenden. |
| **Metadaten** | Erstellt, Geändert, Erstellt von, Geändert von |
| **Attribute** | Im Metamodell definierte benutzerdefinierte Felder (Text, Zahl, Kosten, Datum, Auswahl usw.) |
| **Beziehungen** | Verknüpfte Kartentypen (z. B. Anwendungen, die mit einer Geschäftsfähigkeit verknüpft sind) |

Die Spalte **Pfad** zeigt den Hierarchie-Pfad der Karte (z. B. `Nordamerika / Vertrieb / Innendienst`) ohne den Namen der Karte selbst, sodass Sie Name und Pfad gleichzeitig anzeigen können.

Jede Kategorie hat ein Kontrollkästchen **Alle auswählen**, um alle Spalten in dieser Gruppe schnell umzuschalten. Ein Suchfeld oben ermöglicht es, bestimmte Spalten nach Namen zu finden. Das Badge in jeder Abschnittsüberschrift zeigt an, wie viele Spalten aus dieser Gruppe derzeit sichtbar sind.

Wenn ein Kartentyp zum ersten Mal ausgewählt wird, werden **alle Attribut- und Beziehungsspalten standardmäßig aktiviert**. Sie können dann nicht benötigte Spalten abwählen. Eine Schaltfläche **Zurücksetzen** am unteren Rand der Registerkarte «Spalten» stellt die Standard-Spaltenauswahl wieder her.

Ein **Änderungsindikator-Punkt** erscheint auf der Überschrift der Registerkarte «Spalten», wenn die Spaltenauswahl von den Standardeinstellungen abweicht. Der gleiche Indikator erscheint auf der Registerkarte **Filter**, wenn Filter aktiv sind, sodass Sie auf einen Blick erkennen können, welche Einstellungen geändert wurden.

Ihre Spaltenauswahl, aktiven Filter und Sortierreihenfolge werden **automatisch im Browser gespeichert**. Wenn Sie zur Inventarseite zurückkehren, wird Ihre vorherige Konfiguration wiederhergestellt. Gespeicherte Ansichten (Lesezeichen) bewahren ebenfalls die vollständige Spaltenauswahl, sodass beim Wechseln zwischen Ansichten genau die von Ihnen konfigurierten Spalten wiederhergestellt werden.

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

![Karte-erstellen-Dialog](../assets/img/de/22_karte_erstellen.png)

## Wie man eine neue Karte erstellt

1. Klicken Sie auf die Schaltfläche **+ Erstellen** (blau, rechte obere Ecke)
2. Im angezeigten Dialog:
   - Wählen Sie den **Typ** der Karte (Anwendung, Prozess, Ziel usw.)
   - Geben Sie den **Namen** der Komponente ein
   - Optional: Fügen Sie eine **Beschreibung** hinzu
3. Optional: Klicken Sie auf **Mit KI vorschlagen**, um automatisch eine Beschreibung zu generieren (siehe [KI-Beschreibungsvorschläge](#ki-beschreibungsvorschläge) unten)
4. Klicken Sie auf **ERSTELLEN**

## KI-Beschreibungsvorschläge { #ai-description-suggestions }

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

## Excel-Import / -Export { #excel-import }

Inventar-Exporte und -Importe nutzen eine **mehrblättrige Excel-Arbeitsmappe**, die Ihre Landschaft samt Beziehungen vollständig zurück- und wieder einlesen kann — ohne dass Sie jemals eine UUID kopieren müssen.

### Aufbau der Arbeitsmappe

- **Ein Blatt pro Kartentyp** (Application, Business Capability, IT Component, …) mit Kernspalten, `attr_<feld>`-Spalten, Lebenszyklusspalten und `rel:<beziehungstyp>`-Beziehungsspalten.
- **Ein `Relations`-Blatt** für Beziehungstypen, die Attribute tragen (z. B. Kosten, Beschreibung). Einfache Beziehungen werden inline auf dem Kartenblatt abgebildet.
- **Ein `_Meta`-Blatt** mit der Formatversion der Arbeitsmappe.

### Karten ohne GUIDs identifizieren

Karten werden über den **Namen** identifiziert, sofern dieser innerhalb des Typs eindeutig ist, ansonsten über den vollen **`parent_path`**. Eine Beziehungszelle kann z. B. `NexaCore ERP` direkt enthalten, wenn nur eine Application diesen Namen trägt; bei mehrdeutigem Namen verwenden Sie `Sales / Customer Mgmt / CRM`.

#### Eindeutigkeit unter Geschwistern

Da Karten über Name + Pfad identifiziert werden, **dürfen zwei Karten desselben Typs nicht gleichzeitig denselben Elternknoten und denselben Namen haben**. Neue Karten, die eine solche Kollision erzeugen würden, werden bei der Erstellung abgelehnt (im Dialog "Karte erstellen", beim Inline-Umbenennen und beim Tabellenkalkulations-Import). Bereits in der Datenbank vorhandene Duplikate aus früheren Seeds oder Importen bleiben unberührt — Sie können alle ihre Felder bearbeiten, aber das erneute Erzeugen oder Zurückbenennen in den Kollisionszustand wird blockiert. Die Prüfung ist groß-/kleinschreibungs- und whitespace-unempfindlich, passend zum Resolver des Importers.

### Inline-Beziehungszellen

Auf jedem Kartenblatt drücken `rel:<beziehungstyp>`-Spalten ausgehende Beziehungen als **semikolongetrennte** Zielreferenzen aus (z. B. `NexaCore ERP; BillingApp`). Semikolons statt Kommas, weil Kartennamen häufig Kommas enthalten (etwa `Acme, Inc.`). `/` und `\` innerhalb eines Namens werden als `\/` bzw. `\\` maskiert — der Exporter erledigt das automatisch (z. B. `SAP S/4HANA` → `SAP S\/4HANA`). Zellen sind **deklarativ**: Der Inhalt ersetzt die vollständige Menge ausgehender Beziehungen dieses Typs vom Quellobjekt. Wird ein Ziel aus der Liste entfernt, wird die Beziehung gelöscht; eine leere Zelle löscht alle. Aus Kompatibilitätsgründen werden auch kommagetrennte Zellen (älteres Format) akzeptiert.

### `Relations`-Blatt

Für Beziehungen mit Attributen (z. B. jährliche Kosten) verwenden Sie das dedizierte `Relations`-Blatt mit den Spalten `relation_type`, `source_ref`, `target_ref`, `action` (Standard `upsert`, alternativ `delete`), `attr_<feld>` und `description`.

### Importieren

Klicken Sie in der Werkzeugleiste auf **Import**, ziehen Sie die Arbeitsmappe in den Dialog und prüfen Sie die Vorschau, bevor Sie anwenden. Sie sehen sowohl die zu erzeugenden/aktualisierenden Karten als auch die hinzuzufügenden/zu entfernenden Beziehungen. Fehler (z. B. mehrdeutige Beziehungsziele mit Kandidatenpfaden) blockieren das Anwenden.

### Exportieren

Klicken Sie in der Werkzeugleiste auf **Export**. Der aktuelle Grid-Filter bestimmt den Inhalt: Bei Einzeltyp-Filter ein Blatt für diesen Typ, sonst ein Blatt pro vorhandenem Typ, jeweils zusätzlich mit `Relations` und `_Meta`. Die Datei ist vollständig editierbar und kann ohne Verlust von typspezifischen Attributen wieder importiert werden.
