# Kartendetails

Ein Klick auf eine beliebige Karte im Inventar öffnet die **Detailansicht**, in der Sie alle Informationen über die Komponente anzeigen und bearbeiten können.

![Kartendetailansicht](../assets/img/en/04_card_detail.png)

## Kartenkopf

Der obere Bereich der Karte zeigt:

- **Typsymbol und -bezeichnung** — Farbcodierter Kartentyp-Indikator
- **Kartenname** — Inline bearbeitbar
- **Subtyp** — Sekundäre Klassifizierung (falls zutreffend)
- **Genehmigungsstatus-Badge** — Entwurf, Genehmigt, Ungültig oder Abgelehnt
- **KI-Vorschlags-Schaltfläche** — Klicken, um eine Beschreibung mit KI zu generieren (sichtbar, wenn KI für diesen Kartentyp aktiviert ist und der Benutzer Bearbeitungsrechte hat)
- **Datenqualitätsring** — Visueller Indikator der Informationsvollständigkeit (0–100%)
- **Aktionsmenü** — Archivieren, Löschen und Genehmigungsaktionen

### Genehmigungsworkflow

Karten können einen Genehmigungszyklus durchlaufen:

| Status | Bedeutung |
|--------|-----------|
| **Entwurf** | Standardstatus, noch nicht überprüft |
| **Genehmigt** | Überprüft und von einer verantwortlichen Person akzeptiert |
| **Ungültig** | War genehmigt, wurde aber seitdem bearbeitet — erneute Überprüfung nötig |
| **Abgelehnt** | Überprüft und abgelehnt, Korrekturen erforderlich |

Wenn eine genehmigte Karte bearbeitet wird, ändert sich ihr Status automatisch auf **Ungültig**, um anzuzeigen, dass eine erneute Überprüfung erforderlich ist.

## Detail-Tab (Hauptansicht)

Der Detail-Tab ist in **Abschnitte** gegliedert, die pro Kartentyp von einem Administrator neu angeordnet und konfiguriert werden können (siehe [Karten-Layout-Editor](../admin/metamodel.md#card-layout-editor)).

### Beschreibungsabschnitt

- **Beschreibung** — Rich-Text-Beschreibung der Komponente. Unterstützt die KI-Vorschlagsfunktion zur automatischen Generierung
- **Zusätzliche Beschreibungsfelder** — Einige Kartentypen enthalten zusätzliche Felder im Beschreibungsabschnitt (z.B. Alias, externe ID)

### Lebenszyklusabschnitt

Das Lebenszyklusmodell verfolgt eine Komponente durch fünf Phasen:

| Phase | Beschreibung |
|-------|-------------|
| **Planung** | In Erwägung, noch nicht begonnen |
| **Einführung** | Wird implementiert oder bereitgestellt |
| **Aktiv** | Derzeit in Betrieb |
| **Auslauf** | Wird außer Betrieb genommen |
| **Lebensende** | Nicht mehr in Gebrauch oder unterstützt |

Jede Phase verfügt über eine **Datumsauswahl**, damit Sie festhalten können, wann die Komponente in diese Phase eingetreten ist oder eintreten wird. Ein visueller Zeitleistenbalken zeigt die Position der Komponente in ihrem Lebenszyklus.

### Benutzerdefinierte Attributabschnitte

Abhängig vom Kartentyp werden Sie zusätzliche Abschnitte mit **benutzerdefinierten Feldern** sehen, die im Metamodell konfiguriert sind. Feldtypen umfassen:

- **Text** — Freitexteingabe
- **Zahl** — Numerischer Wert
- **Kosten** — Numerischer Wert, angezeigt mit der konfigurierten Währung der Plattform
- **Boolean** — Ein/Aus-Umschalter
- **Datum** — Datumsauswahl
- **URL** — Klickbarer Link (validiert für http/https/mailto)
- **Einfachauswahl** — Dropdown mit vordefinierten Optionen
- **Mehrfachauswahl** — Mehrfachauswahl mit Chip-Anzeige

Als **berechnet** markierte Felder zeigen ein Badge und können nicht manuell bearbeitet werden — ihre Werte werden durch [vom Administrator definierte Formeln](../admin/calculations.md) berechnet.

### Hierarchieabschnitt

Für Kartentypen, die Hierarchie unterstützen (z.B. Organisation, Geschäftsfähigkeit, Anwendung):

- **Übergeordnete Karte** — Die übergeordnete Karte in der Hierarchie (klicken zum Navigieren)
- **Untergeordnete Karten** — Liste der untergeordneten Karten (klicken zum Navigieren)
- **Hierarchie-Brotkrumen** — Zeigt den vollständigen Pfad von der Wurzel zur aktuellen Karte

### Beziehungsabschnitt

Zeigt alle Verbindungen zu anderen Karten, gruppiert nach Beziehungstyp. Für jede Beziehung:

- **Name der verwandten Karte** — Klicken zum Navigieren zur verwandten Karte
- **Beziehungstyp** — Die Art der Verbindung (z.B. «nutzt», «läuft auf», «hängt ab von»)
- **Beziehung hinzufügen** — Klicken Sie auf **+**, um eine neue Beziehung durch Suche nach Karten zu erstellen
- **Beziehung entfernen** — Klicken Sie auf das Löschsymbol, um eine Beziehung zu entfernen

### Tags-Abschnitt

Wenden Sie Tags aus den konfigurierten [Tag-Gruppen](../admin/tags.md) an. Je nach Gruppenmodus können Sie ein Tag (Einfachauswahl) oder mehrere Tags (Mehrfachauswahl) auswählen.

### Dokumentenabschnitt

Verknüpfungen zu externen Ressourcen anhängen:

- **Dokument hinzufügen** — Eine URL und eine optionale Bezeichnung eingeben
- **Zum Öffnen klicken** — Links öffnen sich in einem neuen Tab
- **Entfernen** — Eine Dokumentenverknüpfung löschen

### EOL-Abschnitt

Wenn die Karte mit einem [endoflife.date](https://endoflife.date/)-Produkt verknüpft ist (über die [EOL-Administration](../admin/eol.md)):

- **Produktname und Version**
- **Supportstatus** — Farbcodiert: Unterstützt, EOL nähert sich, Lebensende
- **Wichtige Daten** — Veröffentlichungsdatum, Ende des aktiven Supports, Ende des Sicherheitssupports, EOL-Datum

## Kommentare-Tab

![Kartenkommentarbereich](../assets/img/en/05_card_comments.png)

- **Kommentare hinzufügen** — Notizen, Fragen oder Entscheidungen über die Komponente hinterlassen
- **Verschachtelte Antworten** — Auf bestimmte Kommentare antworten, um Gesprächsfäden zu erstellen
- **Zeitstempel** — Sehen, wann jeder Kommentar gepostet wurde und von wem

## Aufgaben-Tab

![Aufgaben einer Karte zugeordnet](../assets/img/en/06_card_todos.png)

- **Aufgaben erstellen** — Aufgaben erstellen, die mit dieser bestimmten Karte verknüpft sind
- **Zuweisen** — Einen verantwortlichen Benutzer für jede Aufgabe festlegen
- **Fälligkeitsdatum** — Fristen setzen
- **Status** — Zwischen Offen und Erledigt umschalten

## Stakeholder-Tab

![Kartenstakeholder](../assets/img/en/07_card_stakeholders.png)

Stakeholder sind Personen mit einer bestimmten **Rolle** auf dieser Karte. Die verfügbaren Rollen hängen vom Kartentyp ab (konfiguriert im [Metamodell](../admin/metamodel.md)). Häufige Rollen umfassen:

- **Anwendungseigner** — Verantwortlich für geschäftliche Entscheidungen
- **Technischer Eigner** — Verantwortlich für technische Entscheidungen
- **Benutzerdefinierte Rollen** — Zusätzliche Rollen, wie von Ihrem Administrator definiert

Stakeholder-Zuweisungen beeinflussen **Berechtigungen**: Die effektiven Berechtigungen eines Benutzers auf einer Karte sind die Kombination aus seiner anwendungsweiten Rolle und allen Stakeholder-Rollen, die er auf dieser Karte innehat.

## Verlauf-Tab

![Kartenänderungsverlauf](../assets/img/en/08_card_history.png)

Zeigt die **vollständige Historie** der an der Karte vorgenommenen Änderungen: **Wer** hat die Änderung vorgenommen, **wann** wurde sie durchgeführt und **was** wurde geändert (vorheriger Wert vs. neuer Wert). Dies ermöglicht die vollständige Nachverfolgbarkeit aller Änderungen über die Zeit.

## Prozessfluss-Tab (nur für Geschäftsprozess-Karten)

Für **Geschäftsprozess**-Karten erscheint ein zusätzlicher **Prozessfluss**-Tab mit einem eingebetteten BPMN-Diagramm-Betrachter/-Editor. Siehe [BPM](bpm.md) für Details zum Prozessflussmanagement.

## Archivierung

Karten können über das Aktionsmenü **archiviert** (weich gelöscht) werden. Archivierte Karten:

- Werden in der Standard-Inventaransicht ausgeblendet (nur sichtbar mit dem Filter «Archivierte anzeigen»)
- Werden automatisch **nach 30 Tagen endgültig gelöscht**
- Können vor Ablauf des 30-Tage-Fensters wiederhergestellt werden
