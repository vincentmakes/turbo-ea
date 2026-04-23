# Tags

Die **Tags**-Funktion (**Admin > Metamodell > Tab Tags**) ermöglicht es Ihnen, Klassifizierungslabels zu erstellen, die Benutzer auf Karten anwenden können. Tags sind in **Tag-Gruppen** organisiert, jede mit eigenem Auswahlmodus, Typbeschränkungen und einem optionalen Pflicht-Kennzeichen, das in den Freigabe-Workflow und den Datenqualitäts-Score einfliesst.

## Tag-Gruppen

Eine Tag-Gruppe ist eine Kategorie von Tags. Zum Beispiel könnten Sie Gruppen wie «Geschäftsdomäne», «Compliance-Framework» oder «Team-Zuständigkeit» erstellen.

### Eine Tag-Gruppe erstellen

Klicken Sie auf **+ Neue Tag-Gruppe** und konfigurieren Sie:

| Feld | Beschreibung |
|------|--------------|
| **Name** | Anzeigename auf Kartendetail, Inventarfiltern und in Berichten. |
| **Beschreibung** | Optionaler Freitext, nur für Administratoren sichtbar. |
| **Modus** | **Einfachauswahl** — ein Tag pro Karte. **Mehrfachauswahl** — mehrere Tags pro Karte. |
| **Pflicht** | Wenn aktiviert, wirkt die Gruppe auf den Freigabe-Gate und den Datenqualitäts-Score jedes Kartentyps, für den sie gilt. Siehe [Pflicht-Tag-Gruppen](#pflicht-tag-gruppen) weiter unten. |
| **Auf Typen beschränken** | Optionale Zulassungsliste von Kartentypen. Leer bedeutet, die Gruppe ist für alle Typen verfügbar; andernfalls sehen nur die aufgeführten Typen die Gruppe in Kartendetails, Filtern und Portalen. |

### Tags verwalten

Innerhalb jeder Gruppe können Sie einzelne Tags hinzufügen:

1. Klicken Sie auf **+ Tag hinzufügen** innerhalb einer Tag-Gruppe.
2. Geben Sie den **Namen** des Tags ein.
3. Setzen Sie optional eine **Farbe** zur visuellen Unterscheidung — die Farbe bestimmt den Chip-Hintergrund auf Kartendetails, im Inventar, in Berichten und Web-Portalen.

Tags erscheinen auf Kartendetailseiten im Abschnitt **Tags**, wo Benutzer mit der passenden Berechtigung sie anwenden oder entfernen können.

## Typbeschränkungen

Das Setzen von **Auf Typen beschränken** auf einer Tag-Gruppe wirkt überall gleichzeitig:

- **Kartendetail** — die Gruppe und ihre Tags erscheinen nur bei passenden Kartentypen.
- **Inventarfilter-Seitenleiste** — der Chip der Gruppe erscheint im `TagPicker` nur, wenn das Inventar auf einen passenden Typ gefiltert ist.
- **Web-Portale** — die Gruppe wird Portal-Lesern nur angezeigt, wenn das Portal einen passenden Typ darstellt.
- **Berichte** — Gruppierungs-/Filter-Dropdowns enthalten die Gruppe nur bei passenden Typen.

Die Admin-Oberfläche zeigt die zugewiesenen Typen als kleine Chips an jeder Tag-Gruppe, damit der Geltungsbereich auf einen Blick erkennbar ist.

## Pflicht-Tag-Gruppen

Eine Tag-Gruppe als **Pflicht** zu kennzeichnen, macht sie zu einer Governance-Anforderung: jede Karte, auf die die Gruppe zutrifft, muss mindestens einen Tag aus der Gruppe tragen.

### Freigabe-Gate

Eine Karte kann nicht auf **Freigegeben** gesetzt werden, solange eine anwendbare Pflicht-Tag-Gruppe unerfüllt ist. Ein Freigabeversuch gibt den Fehler `approval_blocked_mandatory_missing` zurück, und die Kartendetailseite listet auf, welche Gruppen fehlen. Zwei Feinabstimmungen halten den Gate sicher:

- Eine Gruppe gilt nur für eine Karte, wenn ihre Liste **Auf Typen beschränken** leer ist oder den Typ der Karte enthält.
- Eine Pflicht-Gruppe, die **noch keine Tags konfiguriert hat**, wird stillschweigend übersprungen — dies verhindert einen unerreichbaren Freigabe-Gate durch eine unvollständige Admin-Einrichtung.

Sobald Sie die erforderlichen Tags hinzufügen, kann die Karte normal freigegeben werden.

### Beitrag zur Datenqualität

Anwendbare Pflicht-Tag-Gruppen fliessen ebenfalls in den Datenqualitäts-Score der Karte ein. Jede erfüllte Gruppe erhöht den Score zusammen mit den anderen Pflichtelementen (Pflichtfelder, Pflicht-Relationsseiten), die in die Vollständigkeitsberechnung einfliessen.

### Visuelle Hinweise

Pflicht-Gruppen werden mit einem **Pflicht**-Chip in der Admin-Liste und im Abschnitt Tags der Kartendetails gekennzeichnet. Fehlende Pflicht-Tags erscheinen im Freigabe-Status-Banner und im Tooltip des Datenqualitäts-Rings, sodass Benutzer genau wissen, was hinzuzufügen ist.

## Berechtigungen

| Berechtigung | Was sie erlaubt |
|--------------|-----------------|
| `tags.manage` | Tag-Gruppen und Tags in der Admin-Oberfläche erstellen, bearbeiten und löschen sowie Tags auf jeder Karte anwenden/entfernen, unabhängig von anderen Berechtigungen. |
| `inventory.edit` + `card.edit` | Tags anwenden oder entfernen auf Karten, für die der Benutzer Bearbeitungsrechte hat (über die App-Rolle oder eine Stakeholder-Rolle auf dieser Karte). |

`tags.manage` wird standardmässig der Admin-Rolle zugewiesen. `inventory.edit` gehört zu admin, bpm_admin und member; `card.edit` wird über die Stakeholder-Rollenzuweisungen der jeweiligen Karte erteilt.

Viewer können Tags **sehen**, aber nicht ändern.

## Wo Tags erscheinen

- **Kartendetail** — der Abschnitt Tags listet anwendbare Gruppen und die aktuell zugeordneten Tags. Pflicht-Gruppen zeigen einen Chip; beschränkte Gruppen erscheinen nur, wenn der Kartentyp passt.
- **Inventarfilter-Seitenleiste** — ein gruppierter `TagPicker` erlaubt das Filtern des Inventar-Grids nach einem oder mehreren Tags. Gruppen und Tags sind auf den aktuellen Typ-Geltungsbereich beschränkt.
- **Berichte** — tag-basierte Schnitte sind im Portfolio-, Matrix- und in anderen Berichten verfügbar, die Gruppierungs-/Filterdimensionen unterstützen.
- **Web-Portale** — Portal-Redakteure können tag-basierte Filter für anonyme Leser freigeben, sodass externe Konsumenten öffentliche Landschaften auf die gleiche Weise aufschneiden können.
- **Dialoge zum Erstellen / Bearbeiten** — derselbe `TagPicker` erscheint beim Anlegen einer neuen Karte, sodass erforderliche Tags vorab gesetzt werden können — besonders nützlich für Pflicht-Gruppen.
