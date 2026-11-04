# End-of-Life (EOL) Verwaltung

Die **EOL**-Administrationsseite (**Admin > Einstellungen > EOL**) hilft Ihnen, Technologieprodukt-Lebenszyklen zu verfolgen, indem Sie Ihre Karten mit der öffentlichen [endoflife.date](https://endoflife.date/)-Datenbank verknüpfen.

![EOL-Administration](../assets/img/de/29_admin_einstellungen_eol.png)

## Warum EOL verfolgen?

Zu wissen, wann Technologieprodukte das Lebensende oder den Support-Ablauf erreichen, ist entscheidend für:

- **Risikomanagement** — Nicht unterstützte Software ist ein Sicherheitsrisiko
- **Budgetplanung** — Migrationen und Upgrades vor dem Support-Ende planen
- **Compliance** — Viele Vorschriften erfordern unterstützte Software

## Massensuche

Die Massensuchfunktion durchsucht die Karten eines Typs, der das Lebensende verfolgt (standardmäßig **Anwendung** und **IT-Komponente**, siehe [Lebensende bei anderen Kartentypen](#lebensende-bei-anderen-kartentypen)), und findet automatisch passende Produkte in der endoflife.date-Datenbank.

### Eine Massensuche ausführen

1. Navigieren Sie zu **Admin > Einstellungen > EOL**
2. Wählen Sie den zu durchsuchenden Kartentyp (jeder Typ, der das Lebensende verfolgt)
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

## Lebensende bei anderen Kartentypen

Das Lebensende wird standardmäßig bei **Anwendungen** und **IT-Komponenten** verfolgt. Jeder andere Kartentyp, ob vordefiniert oder benutzerdefiniert, kann es ebenfalls verfolgen: Öffnen Sie **Admin > Metamodell**, wählen Sie den Typ und deaktivieren Sie in seinem **Kartenlayout** beim Abschnitt **Lebensende** die Option **Im Kartendetail ausgeblendet**. Derselbe Schalter blendet das Lebensende bei Anwendungen oder IT-Komponenten aus, wenn Sie es dort nicht verfolgen.

Dieser eine Schalter entscheidet über alles, was das Lebensende des Typs betrifft:

- den Abschnitt **Lebensende** auf seinen Karten (und die Verknüpfungsoption beim Erstellen einer Karte),
- den Platz des Typs im [EOL-Bericht](../guide/reports.md), im Diagramm **End-of-Life-Abdeckung** des Datenqualitätsberichts sowie in den Lebensende-Filtern und -Gruppierungen der Dashboards,
- die Spalte und den Filter **Lebensende** im [Inventar](../guide/inventory.md),
- die Typauswahl der **Massensuche** auf dieser Seite.

Das Ausblenden des Abschnitts löscht nie etwas: Die Karten behalten ihre Verknüpfungen und Lebenszyklusdaten und erscheinen wieder in allen Berichten, sobald der Abschnitt erneut angezeigt wird.

## Eigene EOL-Produkte

endoflife.date erfasst verbreitete Software, aber nicht alles, was Sie betreiben: Eine hauseigene Plattform, ein Nischenwerkzeug eines Herstellers oder eine lizenzierte Appliance hat dort oft keinen Eintrag. Für diese definieren Sie ein **eigenes EOL-Produkt** – Ihr eigenes Produkt mit eigenen Release-Zyklen – und verknüpfen Karten damit genau wie mit einem Produkt von endoflife.date. Eigene Produkte speisen denselben Kartenstatus, die Inventarspalte **End of Life**, den [EOL-Bericht](../guide/reports.md) und die Datenqualitätskennzahlen.

Eigene Produkte werden auf dem Tab **Eigene Produkte** unter **Admin > Einstellungen > EOL** aufgelistet. Zum Erstellen und Bearbeiten ist die Berechtigung **EOL verwalten** (`eol.manage`) erforderlich; jeder, der EOL-Daten sehen darf, kann sie einsehen.

![Eigene EOL-Produkte](../assets/img/de/29b_admin_einstellungen_eol_eigene.png)

### Ein eigenes Produkt erstellen

Es gibt zwei Wege:

- **Von einer Karte aus** – suchen Sie im Abschnitt **End of Life** der Karte nach dem Produkt. Hat endoflife.date keinen Treffer, bietet der Abschnitt **Eigenes Produkt erstellen** an, vorausgefüllt mit Ihrer Eingabe (oder dem Namen der Karte). Geben Sie den Produktnamen und die ersten Zyklen ein und speichern Sie: Die Karte wird dann in einem Schritt mit dem neuen Produkt und Zyklus verknüpft.
- **Vom Tab Eigene Produkte aus** – klicken Sie auf **Produkt hinzufügen**.

Jedes Produkt hat:

- **Produktname** – so wird es überall angezeigt.
- **Schlüssel** – ein kurzer Bezeichner in Kleinbuchstaben (Buchstaben, Ziffern, Punkte, Bindestriche, Unterstriche), der aus dem Namen vorgeschlagen wird. Kartenverknüpfungen speichern ihn, daher kann er nach dem Erstellen **nicht geändert** werden.
- **Link zum Hersteller oder zur Release-Richtlinie** und **Beschreibung** – optional.
- **Release-Zyklen** – jeweils mit einem Namen (zum Beispiel `2.4`), einem **Veröffentlichungsdatum**, einem Ende des **aktiven Supports**, einem **End of Life** und optional der **Neuesten Version** samt Veröffentlichungsdatum.

Aktiver Support und End of Life nehmen jeweils ein **Datum** oder eine von zwei Angaben, wenn kein Datum bekannt ist: *Noch unterstützt* / *Aktiver Support beendet* sowie *Kein End of Life angekündigt* / *Bereits End of Life*. Der Status (Unterstützt, EOL nähert sich, End of Life) wird daraus nach derselben Regel wie bei Produkten von endoflife.date berechnet.

### Zyklen im Raster verwalten

Der Tab Eigene Produkte zeigt pro Release-Zyklus eine Zeile, nach Produkt gruppiert. Er funktioniert wie die anderen Raster: Spalten fixieren und neu anordnen, ein- oder ausblenden und im linken Bereich nach Produkt, Status oder Nutzung filtern. Die Spalte **Verknüpfte Karten** zeigt, wie viele der für Sie sichtbaren Karten den jeweiligen Zyklus verwenden.

Klicken Sie auf **Im Raster bearbeiten**, um Zellen direkt zu ändern. Daten und Support-Angaben öffnen einen kleinen Editor, und Sie können den Wert einer Zelle (wie in Excel) in einer Spalte nach unten ziehen, um ihn auf mehrere Zyklen zu kopieren. Das Zeilenmenü (**⋮**) fügt dem Produkt einen Zyklus hinzu, bearbeitet Name, Link und Beschreibung des Produkts oder löscht einen Zyklus oder das Produkt.

Ein Produkt kann nicht gelöscht werden, solange noch Karten damit verknüpft sind. Wird ein Zyklus gelöscht, den Karten verwenden, bleibt deren End-of-Life-Status **unbekannt**, bis jemand einen anderen Zyklus auswählt. Wird ein Zyklus umbenannt, ziehen die damit verknüpften Karten mit um.

Einen fehlenden Zyklus können Sie auch an einer Karte hinzufügen: Sobald im Abschnitt End of Life der Karte ein eigenes Produkt ausgewählt ist, endet die Zyklenliste mit **Zyklus hinzufügen …**.

### Ein eigenes Produkt zu endoflife.date beitragen

Ist ein eigenes Produkt ein öffentliches Herstellerprodukt, sollten Sie erwägen, es bei endoflife.date vorzuschlagen, damit alle profitieren. Wählen Sie im Zeilenmenü **Bei endoflife.date vorschlagen**:

1. Lesen Sie die Warnung: Das Vorschlagen veröffentlicht den Produktnamen und seine Daten. Schlagen Sie niemals hauseigene oder vertrauliche Produkte vor.
2. Wählen Sie die **Kategorie** bei endoflife.date. Der Dialog zeigt die Produktdatei im Format von endoflife.date (`products/<key>.md`) als Vorschau.
3. Klicken Sie auf **Auf GitHub öffnen**. GitHub öffnet eine neue Datei im endoflife.date-Repository mit ausgefülltem Inhalt (es bietet an, das Repository zu forken, falls Sie dort nicht schreiben dürfen). Vervollständigen Sie die Beschreibung und die Zusammenfassung der Release-Richtlinie und öffnen Sie dann den Pull Request von Ihrem eigenen GitHub-Konto aus. Bei langen Dateien verwenden Sie stattdessen **Datei kopieren** und fügen sie in eine neue Datei ein.

Turbo EA sendet selbst nie etwas an GitHub und speichert keine GitHub-Zugangsdaten. endoflife.date prüft jeden Vorschlag anhand seines [Beitragsleitfadens](https://github.com/endoflife-date/endoflife.date/blob/master/CONTRIBUTING.md).

### Auf endoflife.date umstellen

Beginnt endoflife.date, ein Produkt zu erfassen, das Sie als eigenes geführt haben, zeigt das Raster daneben den Hinweis **Auf endoflife.date** an. Klicken Sie auf den Hinweis oder wählen Sie im Zeilenmenü **Auf Produkt von endoflife.date umstellen …**:

1. Wählen Sie das Produkt von endoflife.date.
2. Wählen Sie für jeden Ihrer Zyklen den Zyklus von endoflife.date, auf den seine Karten wechseln sollen (Zyklen mit demselben Namen werden automatisch zugeordnet), oder belassen Sie ihn beim eigenen Produkt.
3. Löschen Sie optional das eigene Produkt, sobald keine Karte mehr damit verknüpft ist.

Es werden nur die für Sie sichtbaren Karten umgestellt. Die Lebenszyklusdaten der Karten werden nie geändert.

## EOL-Bericht

Verknüpfte EOL-Daten fließen in den [EOL-Bericht](../guide/reports.md) ein, der eine Dashboard-Ansicht des Supportstatus Ihrer Technologielandschaft über alle verknüpften Karten hinweg bietet.

## Finden, was noch nicht verknüpft ist

Zwei Stellen außerhalb dieser Seite listen die Karten ganz ohne End-of-Life-Informationen — weder eine Verknüpfung hier noch ein eigenes Lebensende-Datum:

- Der Filter und die Spalte **Lebensende** im [Inventar](../guide/inventory.md) — Kartentyp wählen, dann die Option **(leer)**.
- Die Kennzahl **Keine EOL-Daten** im [EOL-Bericht](../guide/reports.md) und das Diagramm **End-of-Life-Abdeckung** am Ende des Datenqualitätsberichts.
