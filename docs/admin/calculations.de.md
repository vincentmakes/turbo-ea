# Berechnungen

Die **Berechnungen**-Funktion (**Admin > Metamodell > Berechnungen**-Tab) ermöglicht es Ihnen, **Formeln zu definieren, die Feldwerte automatisch berechnen**, wenn Karten gespeichert werden. Dies ist leistungsstark zur Ableitung von Metriken, Bewertungen und Aggregationen aus Ihren Architekturdaten.

## Funktionsweise

1. Ein Administrator definiert eine Formel, die auf einen bestimmten Kartentyp und ein Feld abzielt
2. Wenn eine Karte dieses Typs erstellt oder aktualisiert wird, wird die Formel automatisch ausgeführt
3. Das Ergebnis wird in das Zielfeld geschrieben
4. Das Zielfeld wird auf der Kartendetailseite als **schreibgeschützt** markiert (Benutzer sehen ein «Berechnet»-Badge)

## Eine Berechnung erstellen

Klicken Sie auf **+ Neue Berechnung** und konfigurieren Sie:

| Feld | Beschreibung |
|------|-------------|
| **Name** | Beschreibender Name für die Berechnung |
| **Zieltyp** | Der Kartentyp, auf den diese Berechnung angewendet wird |
| **Zielfeld** | Das Feld, in dem das Ergebnis gespeichert wird |
| **Formel** | Der auszuwertende Ausdruck (siehe Syntax unten) |
| **Ausführungsreihenfolge** | Reihenfolge der Ausführung, wenn mehrere Berechnungen für denselben Typ existieren (niedrigere Zahl wird zuerst ausgeführt) |
| **Aktiv** | Die Berechnung aktivieren oder deaktivieren |

## Formelsyntax

Formeln verwenden eine sichere, sandboxed Ausdruckssprache. Sie können Kartenattribute, Daten verwandter Karten und Lebenszyklusdaten referenzieren.

### Kontextvariablen

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `feldSchlüssel` | Beliebiges Attribut der aktuellen Karte | `businessCriticality` |
| `related_{typ_schlüssel}` | Array verwandter Karten eines bestimmten Typs | `related_applications` |
| `lifecycle_plan`, `lifecycle_active` usw. | Lebenszyklus-Datumswerte | `lifecycle_endOfLife` |
| `parent` | Die übergeordnete Karte (Objekt mit `id`, `name`, `type`, `subtype`, `attributes`) oder `None` bei einer Wurzelkarte | `IF(parent, parent.attributes.businessCriticality, data.businessCriticality)` |
| `hierarchy_level` | Tiefe der aktuellen Karte in ihrer Eltern-Kind-Hierarchie (`1` = Wurzel, nicht begrenzt). `1` für nicht-hierarchische Kartentypen | `hierarchy_level * 10` |

!!! note "Hinweis"
    Von `parent` und `hierarchy_level` abgeleitete Werte werden aktualisiert, wenn eine Karte neu zugeordnet wird (der gesamte Teilbaum wird neu berechnet) und wenn Sie **Alle neu berechnen** für den Typ ausführen — nicht bei jeder Bearbeitung der übergeordneten Karte. Sichern Sie eine `parent`-Referenz immer mit `IF(parent, …)` ab, damit Wurzelkarten (bei denen `parent` `None` ist) keinen Fehler verursachen.

### Eingebaute Funktionen

| Funktion | Beschreibung | Beispiel |
|----------|-------------|---------|
| `IF(bedingung, wahr_wert, falsch_wert)` | Bedingte Logik | `IF(riskLevel == "critical", 100, 25)` |
| `SUM(array)` | Summe numerischer Werte | `SUM(PLUCK(related_applications, "costTotalAnnual"))` |
| `AVG(array)` | Durchschnitt numerischer Werte | `AVG(PLUCK(related_applications, "dataQuality"))` |
| `MIN(array)` | Minimalwert | `MIN(PLUCK(related_itcomponents, "riskScore"))` |
| `MAX(array)` | Maximalwert | `MAX(PLUCK(related_itcomponents, "costAnnual"))` |
| `COUNT(array)` | Anzahl der Elemente | `COUNT(related_interfaces)` |
| `ROUND(wert, dezimalstellen)` | Eine Zahl runden | `ROUND(avgCost, 2)` |
| `ABS(wert)` | Absolutwert | `ABS(delta)` |
| `COALESCE(a, b, ...)` | Erster nicht-null Wert | `COALESCE(customScore, 0)` |
| `LOWER(text)` | Text in Kleinbuchstaben | `LOWER(status)` |
| `UPPER(text)` | Text in Großbuchstaben | `UPPER(category)` |
| `CONCAT(a, b, ...)` | Zeichenketten verbinden | `CONCAT(firstName, " ", lastName)` |
| `CONTAINS(text, suche)` | Prüfen ob Text eine Teilzeichenkette enthält | `CONTAINS(description, "legacy")` |
| `PLUCK(array, schlüssel)` | Ein Feld aus jedem Element extrahieren | `PLUCK(related_applications, "name")` |
| `FILTER(array, schlüssel, wert)` | Elemente nach Feldwert filtern | `FILTER(related_interfaces, "status", "ACTIVE")` |
| `MAP_SCORE(wert, zuordnung)` | Kategoriale Werte auf Punktzahlen abbilden | `MAP_SCORE(criticality, {"high": 3, "medium": 2, "low": 1})` |

### Formelbeispiele { #example-formulas }

**Gesamte jährliche Kosten aus verwandten Anwendungen:**
```
SUM(PLUCK(related_applications, "costTotalAnnual"))
```

**Risikobewertung basierend auf Kritikalität:**
```
IF(riskLevel == "critical", 100, IF(riskLevel == "high", 75, IF(riskLevel == "medium", 50, 25)))
```

**Anzahl aktiver Schnittstellen:**
```
COUNT(FILTER(related_interfaces, "status", "ACTIVE"))
```

**TIME-Model-Platzierung (Tolerate / Invest / Migrate / Eliminate)** — dasselbe Beispiel, das Sie im Panel **Formelreferenz** unter **Admin → Metamodell → Berechnungen** beim Anlegen einer neuen Berechnung sehen. Zieltyp = `Application`, Zielfeld = `timeModel`. Setzt voraus, dass Sie zwei `single_select`-Felder namens `businessFit` und `technicalFit` mit den Optionen `excellent`, `adequate`, `insufficient`, `unreasonable` hinzugefügt haben:
```
# ── TIME Model (Tolerate / Invest / Migrate / Eliminate) ──
# Assumes single_select fields: businessFit and technicalFit
# with options: excellent, adequate, insufficient, unreasonable.
#
# Scoring: Map each dimension to 1-4 numeric scale.
# Business Fit  = Y-axis (how well does it serve the business?)
# Technical Fit = X-axis (how healthy is the technology?)
#
# Quadrant logic (threshold at score 2.5):
#   Invest    = high business + high technical
#   Migrate   = high business + low technical
#   Tolerate  = low business  + high technical
#   Eliminate = low business  + low technical
#
bf = MAP_SCORE(data.businessFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
tf = MAP_SCORE(data.technicalFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
IF(bf is None or tf is None, None, IF(bf >= 2.5, IF(tf >= 2.5, "invest", "migrate"), IF(tf >= 2.5, "tolerate", "eliminate")))
```

Dies ist auch das durchgearbeitete Beispiel, das im [EA-Einsteigerleitfaden](../beginners-guide/customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation) referenziert wird.

**Kommentare** werden mit `#` unterstützt:
```
# Gewichtete Risikobewertung berechnen
IF(businessCriticality == "missionCritical", riskScore * 2, riskScore)
```

## Berechnungen ausführen

Berechnungen werden automatisch ausgeführt, wenn eine Karte gespeichert wird. Sie können eine Berechnung auch manuell auslösen, um sie über alle Karten des Zieltyps hinweg auszuführen:

1. Finden Sie die Berechnung in der Liste
2. Klicken Sie auf die **Ausführen**-Schaltfläche
3. Die Formel wird für jede passende Karte ausgewertet und die Ergebnisse werden gespeichert

## Ausführungsreihenfolge

Wenn mehrere Berechnungen auf denselben Kartentyp abzielen, werden sie in der durch ihren **Ausführungsreihenfolge**-Wert festgelegten Reihenfolge ausgeführt. Dies ist wichtig, wenn eine Berechnung vom Ergebnis einer anderen abhängt — setzen Sie die Abhängigkeit auf eine niedrigere Nummer, damit sie zuerst ausgeführt wird.
