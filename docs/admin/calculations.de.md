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

### Formelbeispiele

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
