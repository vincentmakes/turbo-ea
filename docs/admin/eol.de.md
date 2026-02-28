# End-of-Life (EOL) Verwaltung

Die **EOL**-Administrationsseite (**Admin > Einstellungen > EOL**) hilft Ihnen, Technologieprodukt-Lebenszyklen zu verfolgen, indem Sie Ihre Karten mit der öffentlichen [endoflife.date](https://endoflife.date/)-Datenbank verknüpfen.

## Warum EOL verfolgen?

Zu wissen, wann Technologieprodukte das Lebensende oder den Support-Ablauf erreichen, ist entscheidend für:

- **Risikomanagement** — Nicht unterstützte Software ist ein Sicherheitsrisiko
- **Budgetplanung** — Migrationen und Upgrades vor dem Support-Ende planen
- **Compliance** — Viele Vorschriften erfordern unterstützte Software

## Massensuche

Die Massensuchfunktion durchsucht Ihre **Anwendungs**- und **IT-Komponenten**-Karten und findet automatisch passende Produkte in der endoflife.date-Datenbank.

### Eine Massensuche ausführen

1. Navigieren Sie zu **Admin > Einstellungen > EOL**
2. Wählen Sie den zu durchsuchenden Kartentyp (Anwendung oder IT-Komponente)
3. Klicken Sie auf **Suchen**
4. Das System führt einen **Fuzzy-Abgleich** mit dem endoflife.date-Produktkatalog durch

### Ergebnisse überprüfen

Für jede Karte liefert die Suche:

- **Übereinstimmungswert** (0–100%) — Wie genau der Kartenname mit einem bekannten Produkt übereinstimmt
- **Produktname** — Das übereinstimmende endoflife.date-Produkt
- **Verfügbare Versionen/Zyklen** — Die Produktversionen mit ihren Support-Daten

### Ergebnisse filtern

Verwenden Sie die Filtersteuerungen, um sich zu fokussieren auf:

- **Alle Einträge** — Jede gescannte Karte
- **Nur unverknüpfte** — Karten, die noch nicht mit einem EOL-Produkt verknüpft sind
- **Bereits verknüpfte** — Karten, die bereits eine EOL-Verknüpfung haben

Eine Statistikzusammenfassung zeigt: gescannte Karten insgesamt, bereits verknüpft, unverknüpft und gefundene Übereinstimmungen.

### Karten mit Produkten verknüpfen

1. Überprüfen Sie den vorgeschlagenen Abgleich für jede Karte
2. Wählen Sie die richtige **Produktversion/den richtigen Zyklus** aus dem Dropdown
3. Klicken Sie auf **Verknüpfen**, um die Zuordnung zu speichern

Einmal verknüpft, zeigt die Kartendetailseite einen **EOL-Abschnitt** mit:

- **Produktname und Version**
- **Supportstatus** — Farbcodiert: Unterstützt (grün), EOL nähert sich (orange), Lebensende (rot)
- **Wichtige Daten** — Veröffentlichungsdatum, Ende des aktiven Supports, Ende des Sicherheitssupports, EOL-Datum

## EOL-Bericht

Verknüpfte EOL-Daten fließen in den [EOL-Bericht](../guide/reports.md) ein, der eine Dashboard-Ansicht des Supportstatus Ihrer Technologielandschaft über alle verknüpften Karten hinweg bietet.
