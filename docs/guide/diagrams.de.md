# Diagramme

Das **Diagramme**-Modul ermöglicht die Erstellung **visueller Architekturdiagramme** mit einem eingebetteten [DrawIO](https://www.drawio.com/)-Editor — vollständig integriert mit Ihrem Karteninventar. Sie können Karten auf die Zeichenfläche ziehen, sie mit Beziehungen verbinden und das Diagramm mit Ihren EA-Daten synchron halten.

![Diagramm-Galerie](../assets/img/en/16_diagrams.png)

## Diagramm-Galerie

Die Galerie zeigt alle Diagramme als **Miniaturkarten** oder in einer **Listenansicht** (umschaltbar über das Ansichtssymbol in der Werkzeugleiste). Jedes Diagramm zeigt seinen Namen, Typ und eine visuelle Vorschau seines Inhalts.

**Aktionen aus der Galerie:**

- **Erstellen** — Klicken Sie auf **+ Neues Diagramm**, um ein Diagramm mit Name und optionaler Beschreibung zu erstellen
- **Öffnen** — Klicken Sie auf ein beliebiges Diagramm, um den Editor zu starten
- **Details bearbeiten** — Umbenennen oder Beschreibung aktualisieren
- **Löschen** — Ein Diagramm entfernen (mit Bestätigung)

## Der Diagramm-Editor

Das Öffnen eines Diagramms startet einen Vollbild-**DrawIO-Editor** in einem Same-Origin-Iframe. Die Standard-DrawIO-Werkzeugleiste steht für Formen, Verbinder, Text, Formatierung und Layout zur Verfügung.

### Karten einfügen

Verwenden Sie die **Karten-Seitenleiste** (umschaltbar über das Seitenleistensymbol), um Ihr Inventar zu durchsuchen. Sie können:

- Nach Karten nach Namen **suchen**
- Nach Kartentyp **filtern**
- Eine **Karte auf die Zeichenfläche ziehen** — sie erscheint als stilisierte Form mit dem Kartennamen und Typsymbol
- Den **Kartenauswahl-Dialog** für erweiterte Suche und Mehrfachauswahl verwenden

### Karten aus dem Diagramm erstellen

Wenn Sie eine Form zeichnen, die keiner bestehenden Karte entspricht, können Sie direkt eine erstellen:

1. Wählen Sie die nicht verknüpfte Form
2. Klicken Sie auf **Karte erstellen** im Synchronisierungspanel
3. Füllen Sie Typ, Name und optionale Felder aus
4. Die Form wird automatisch mit der neuen Karte verknüpft

### Beziehungen aus Kanten erstellen

Wenn Sie einen Verbinder zwischen zwei Kartenformen zeichnen:

1. Wählen Sie die Kante
2. Der **Beziehungsauswahl**-Dialog erscheint
3. Wählen Sie den Beziehungstyp (nur gültige Typen für die verbundenen Kartentypen werden angezeigt)
4. Die Beziehung wird im Inventar erstellt und die Kante als synchronisiert markiert

### Kartensynchronisierung

Das **Synchronisierungspanel** hält Ihr Diagramm und Inventar synchron:

- **Synchronisierte Karten** — Mit Inventarkarten verknüpfte Formen zeigen einen grünen Synchronisierungsindikator
- **Nicht synchronisierte Formen** — Noch nicht mit Karten verknüpfte Formen werden zur Bearbeitung markiert
- **Gruppen erweitern/reduzieren** — Hierarchische Kartengruppen direkt auf der Zeichenfläche navigieren

### Diagramme mit Karten verknüpfen

Diagramme können über die **Ressourcen**-Registerkarte der Karte mit **jeder beliebigen Karte** verknüpft werden (siehe [Kartendetails](card-details.de.md#registerkarte-ressourcen)). So können Sie Architekturdiagramme den Komponenten zuordnen, die sie beschreiben — zum Beispiel ein Netzwerktopologie-Diagramm mit einer Anwendung oder eine Fähigkeitskarte mit einer Geschäftsfähigkeit.

Wenn ein Diagramm mit einer **Initiative**-Karte verknüpft ist, erscheint es auch im [EA-Delivery](delivery.de.md)-Modul neben SoAW-Dokumenten und bietet eine vollständige Ansicht aller Architekturartefakte für diese Initiative.
