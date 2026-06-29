# Gespeicherte Berichte

Turbo EA ermöglicht es Ihnen, **Berichtskonfigurationen zu speichern**, damit Sie schnell zu bestimmten Ansichten zurückkehren können, ohne jedes Mal Filter und Achsen neu konfigurieren zu müssen.

## Einen Bericht speichern

Von jeder Berichtsseite aus (Portfolio, Fähigkeitskarte, Lebenszyklus, Abhängigkeiten, Kosten, Matrix, Datenqualität oder EOL):

1. Konfigurieren Sie den Bericht mit Ihren gewünschten Filtern, Gruppierungen und Achsenauswahlen
2. Klicken Sie auf die Schaltfläche **Speichern** in der Berichtswerkzeugleiste
3. Geben Sie einen **Namen** für den gespeicherten Bericht ein
4. Wählen Sie die **Sichtbarkeit**:

| Sichtbarkeit | Wer kann ihn sehen |
|-------------|-------------------|
| **Privat** | Nur Sie |
| **Geteilt** | Sie und bestimmte Benutzer, die Sie auswählen |
| **Öffentlich** | Alle Benutzer der Plattform |

Für geteilte Berichte können Sie bestimmten Benutzern **Bearbeitungsrechte** gewähren, die es ihnen ermöglichen, die gespeicherte Konfiguration zu aktualisieren.

5. Klicken Sie auf **Speichern** — eine Miniaturansicht wird automatisch von der aktuellen Visualisierung erfasst

## Galerie gespeicherter Berichte

Navigieren Sie zu **Berichte > Gespeicherte Berichte**, um alle gespeicherten Berichte zu durchsuchen, auf die Sie Zugriff haben. Die Galerie zeigt Miniaturvorschauen, die in Tabs organisiert sind:

- **Meine Berichte** — Von Ihnen erstellte Berichte
- **Mit mir geteilt** — Berichte, die andere mit Ihnen geteilt haben
- **Öffentlich** — Berichte, die für alle sichtbar sind

### Aktionen

- **Öffnen** — Klicken Sie auf einen Bericht, um ihn mit der gespeicherten Konfiguration zu laden
- **Bearbeiten** — Name, Sichtbarkeit oder Freigabeeinstellungen aktualisieren
- **Duplizieren** — Eine Kopie mit neuem Namen erstellen
- **Löschen** — Den gespeicherten Bericht entfernen (nur der Ersteller oder Benutzer mit Bearbeitungsrechten können löschen)

## Benutzerdefinierte Berichte mit Ihrem KI-Assistenten

Über die integrierten Berichtstypen hinaus kann Turbo EA **vollständig benutzerdefinierte Berichte** aus einer Beschreibung in natürlicher Sprache erstellen — mithilfe eines KI-Assistenten, der über den **MCP-Server** verbunden ist.

### So funktioniert es

1. Verbinden Sie den Turbo-EA-MCP-Server mit Ihrem KI-Assistenten (zum Beispiel Claude Code) — siehe den Leitfaden **MCP-Integration**.
2. Beschreiben Sie den gewünschten Bericht in natürlicher Sprache, z. B. *„Anwendungen nach Geschäftskritikalität als Kreisdiagramm zählen"* oder *„Jährliche Gesamtkosten von IT-Komponenten gruppiert nach Anbieter"*.
3. Der Assistent ruft `get_report_builder_schema` auf, um Ihr aktuelles Metamodell (Kartentypen, Felder, Beziehungen, Tags) zu lesen, erstellt eine sichere Bericht **spezifikation** und zeigt sie mit `preview_custom_report` als Vorschau anhand Ihrer echten Arbeitsbereichsdaten an — so sehen Sie tatsächliche Ergebnisse, bevor etwas gespeichert wird.
4. Wenn Sie zufrieden sind, **veröffentlicht** der Assistent den Bericht mit `create_saved_report`. Er erscheint in der Galerie **Gespeicherte Berichte** und öffnet sich als nativer, interaktiver Bericht.

### Was benutzerdefinierte Berichte leisten

- **Metamodell-bewusst**: Ihre Kartentypen, Subtypen, Felder, Beziehungen und Tags werden automatisch berücksichtigt — ohne Programmierung.
- **Gruppieren und aggregieren**: Gruppieren nach Attribut, Subtyp, Lebenszyklusphase, Tag-Gruppe oder verknüpfter Karte und Messen mit Anzahl, Summe, Durchschnitt, Minimum oder Maximum.
- **Filtern und Navigieren**: Filtern der Quellkarten und optional einem Beziehungsschritt zu verknüpften Karten folgen.
- **Viele Visualisierungen**: als Tabelle, Balken-/Säulen-/Kreis-/Ring-/Streu-/Treemap-/Liniendiagramm oder als KPI-Kacheln darstellen.
- **Sicher und kontrolliert**: Berichte sind schreibgeschützt, laufen vollständig auf deklarativen Regeln (kein Code, kein SQL), und Kostenfelder bleiben hinter der Berechtigung **Kosten anzeigen** — genau wie bei jedem anderen Bericht.

Benutzerdefinierte Berichte werden genauso wie jeder andere Bericht gespeichert, sodass dieselben Sichtbarkeits- und Freigabeoptionen (privat / geteilt / öffentlich) gelten.
