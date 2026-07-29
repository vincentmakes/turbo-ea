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

Formeln verwenden eine sichere, sandboxed Ausdruckssprache. Sie können die Felder der aktuellen Karte, verwandte und untergeordnete Karten, die übergeordnete Karte sowie Lebenszyklusdaten referenzieren.

!!! warning "Verwenden Sie den Feldschlüssel, nicht die Feldbezeichnung"
    Felder werden über ihren **Schlüssel** referenziert, üblicherweise in camelCase
    (`costTotalAnnual`), nicht über die auf der Karte angezeigte Bezeichnung
    (`Jährliche Gesamtkosten`). Ein nicht existierender Name wird zu `None` aufgelöst, und
    jede Rechenoperation auf `None` scheitert mit einem generischen **Auswertungsfehler**.

    Den Schlüssel finden Sie unter **Admin > Metamodell >** *(Kartentyp)*, indem Sie das Feld
    öffnen und seinen **Schlüssel** ablesen. Einfacher: Im Formeleditor listen die Chips
    unterhalb des Formelfelds `data.<schlüssel>` für jedes Feld des ausgewählten Typs auf, und
    die Eingabe von `data.` öffnet die Autovervollständigung.

### Kontextvariablen

| Variable | Beschreibung | Beispiel |
|----------|-------------|---------|
| `data.<feldSchlüssel>` | Beliebiges benutzerdefiniertes Feld der aktuellen Karte, über seinen Schlüssel | `data.costTotalAnnual` |
| `data.name`, `data.description`, `data.status`, `data.subtype`, `data.approval_status`, `data.reference` | Eingebaute Karteneigenschaften | `data.subtype` |
| `data.lifecycle.<phase>` | Lebenszyklusdaten, wobei die Phase `plan`, `phaseIn`, `active`, `phaseOut` oder `endOfLife` ist | `data.lifecycle.endOfLife` |
| `relations.<beziehungstypSchlüssel>` | Array der über diesen Beziehungstyp verknüpften Karten, in beide Richtungen | `relations.relAppToITC` |
| `relation_count.<beziehungstypSchlüssel>` | Anzahl der über diesen Beziehungstyp verknüpften Karten | `relation_count.relAppToITC` |
| `children` | Array der direkten untergeordneten Karten (hierarchische Typen) | `SUM(PLUCK(children, "attributes.costTotalAnnual"))` |
| `children_count` | Anzahl der direkten untergeordneten Karten | `children_count` |
| `parent` | Die übergeordnete Karte (Objekt mit `id`, `name`, `type`, `subtype`, `attributes`) oder `None` bei einer Wurzelkarte | `IF(parent, parent.attributes.businessCriticality, data.businessCriticality)` |
| `hierarchy_level` | Tiefe der aktuellen Karte in ihrer Eltern-Kind-Hierarchie (`1` = Wurzel, nicht begrenzt). `1` für nicht-hierarchische Kartentypen | `hierarchy_level * 10` |

Der Beziehungstyp-Schlüssel ist der Schlüssel aus **Admin > Metamodell > Beziehungen**, zum
Beispiel `relAppToITC` oder `relInitiativeToApp`. Die Richtung spielt keine Rolle: Eine Karte
findet einen Beziehungstyp unter demselben Schlüssel, unabhängig davon, ob sie am Quell- oder
am Zielende steht. Archivierte Karten sind in `relations`, `relation_count` und `children`
nicht enthalten.

### Felder einer verknüpften Karte auslesen

Jedes Element in `relations.<beziehungstypSchlüssel>` und in `children` ist ein
Hüllobjekt, nicht direkt das Feld der verknüpften Karte:

```json
{
  "id": "8f1c…",
  "name": "NexaCore ERP",
  "type": "Application",
  "attributes":     { "costTotalAnnual": 45000, "businessCriticality": "missionCritical" },
  "rel_attributes": { "costTotalAnnual": 12000 }
}
```

* `attributes` enthält die eigenen Feldwerte der verknüpften Karte.
* `rel_attributes` enthält Werte, die **an der Verknüpfung selbst** gespeichert sind, sofern
  der Beziehungstyp ein Attributschema definiert. `relAppToITC` führt zum Beispiel ein eigenes
  `costTotalAnnual`, sodass Sie erfassen können, was eine Anwendung für eine einzelne
  IT-Komponente ausgibt.

Das ist entscheidend für `PLUCK` und `FILTER`: Beide erwarten einen Schlüsselpfad und
brauchen daher das Präfix `attributes.`, um ein Feld zu erreichen:

```
# Jährliche Kosten der IT-Komponenten summieren, die diese Anwendung nutzt
SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))

# Stattdessen die an jeder Anwendung-Komponente-Verknüpfung erfassten Kosten summieren
SUM(PLUCK(relations.relAppToITC, "rel_attributes.costTotalAnnual"))
```

Ein blosser Schlüssel wie `"costTotalAnnual"` wird auf dem Hüllobjekt gesucht, dort nicht
gefunden und ergibt eine Liste aus `None`, die `SUM` als `0` meldet. Eine Beziehungsformel,
die hartnäckig `0` liefert, ist fast immer ein fehlendes `attributes.`-Präfix.

### Umgang mit leeren Werten

Ein Feld ohne Wert wird zu `None` aufgelöst, und `None` in einem arithmetischen Ausdruck löst
einen Fehler aus. Umschliessen Sie jedes möglicherweise leere Feld mit `COALESCE`:

```
COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0) + COALESCE(data.infraCost, 0)
```

`SUM`, `AVG`, `MIN` und `MAX` überspringen nicht-numerische Einträge bereits von sich aus und
brauchen keine Absicherung.

### PPM-Daten auf Initiative-Karten

Die Wurzel `ppm` macht die Budget- und Kostenzeilen des PPM-Moduls für Formeln zugänglich, getrennt nach Capex und Opex und aufgeschlüsselt nach Geschäftsjahr — Detail, das die auf der Karte zusammengefassten Attribute `data.costBudget` / `data.costActual` nicht liefern können.

| Variable | Beschreibung |
|----------|-------------|
| `ppm.capexBudget`, `ppm.opexBudget`, `ppm.totalBudget` | Geplantes Budget, aus den PPM-Budgetzeilen |
| `ppm.capexPlanned`, `ppm.opexPlanned`, `ppm.totalPlanned` | Geplante Beträge auf den PPM-Kostenzeilen |
| `ppm.capexActual`, `ppm.opexActual`, `ppm.totalActual` | Ist-Werte auf den PPM-Kostenzeilen |
| `ppm.byYear` | Dieselben neun Kennzahlen je Geschäftsjahr, als Liste `{year, capexBudget, …}` |
| `ppm.currentFiscalYear` | Das Geschäftsjahr, in das der heutige Tag fällt |
| `ppm.unscheduledPlanned`, `ppm.unscheduledActual` | Kostenzeilen ohne Datum: zählen zu den Summen, gehören aber zu keinem Jahr |

`byYear` ist eine Liste statt eines nach Jahr indizierten Objekts, damit die gewohnten Funktionen `FILTER` und `PLUCK` darauf arbeiten:

```
# Gesamtes Capex-Budget über alle Jahre
ppm.capexBudget

# Nur das Capex-Budget des laufenden Geschäftsjahres
SUM(PLUCK(FILTER(ppm.byYear, "year", ppm.currentFiscalYear), "capexBudget"))

# Capex-Budget jeder mit dieser Karte verknüpften Initiative
SUM(PLUCK(relations.relInitiativeToApp, "ppm.capexBudget"))
```

* **Ein Geschäftsjahr trägt den Namen des Kalenderjahres, in dem es endet.** Bei einem Beginn im Oktober fällt der 15.10.2025 in GJ2026 und der 30.09.2025 in GJ2025. Beim voreingestellten Januar-Beginn entspricht das Geschäftsjahr schlicht dem Kalenderjahr.
* **Budget- und Kostenzeilen beziehen ihr Jahr aus unterschiedlichen Quellen.** Eine Budgetzeile trägt das Geschäftsjahr, das Sie eingetragen haben; das einer Kostenzeile wird aus ihrem Datum abgeleitet. Benennt Ihre Organisation Geschäftsjahre nach dem *Startjahr*, weichen beide voneinander ab.
* `total*` ist die Summe aller Zeilen, nicht `capex + opex`. Eine Zeile mit einer anderen Kategorie (etwa aus einem Import) zählt trotzdem zur Summe.
* Eine Karte, die keine Initiative ist, liest alle `ppm`-Kennzahlen als `0` mit leerem `byYear` — eine Formel auf dem falschen Kartentyp liefert also Null statt zu scheitern.

Das Bearbeiten einer PPM-Budget- oder Kostenzeile führt die Berechnungen der Initiative erneut aus, sodass alles daraus Abgeleitete sofort aktuell ist. Karten, die die PPM-Daten einer *anderen* Karte über eine Beziehung lesen, werden nicht aktualisiert.

### Eingebaute Funktionen

| Funktion | Beschreibung | Beispiel |
|----------|-------------|---------|
| `IF(bedingung, wahr_wert, falsch_wert)` | Bedingte Logik. Nur der gewählte Zweig wird ausgewertet | `IF(data.businessCriticality == "missionCritical", 100, 25)` |
| `SUM(array)` | Summe numerischer Werte | `SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `AVG(array)` | Durchschnitt numerischer Werte | `AVG(PLUCK(children, "attributes.numberOfUsers"))` |
| `MIN(array)` | Minimalwert | `MIN(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `MAX(array)` | Maximalwert | `MAX(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `COUNT(array)` | Anzahl der Elemente | `COUNT(relations.relAppToInterface)` |
| `ROUND(wert, dezimalstellen)` | Eine Zahl runden | `ROUND(data.costTotalAnnual / 12, 2)` |
| `ABS(wert)` | Absolutwert | `ABS(data.budgetVariance)` |
| `LN(wert)` | Natürlicher Logarithmus. Gibt `None` für null, negative und nicht-numerische Eingaben zurück | `LN(data.numberOfUsers)` |
| `COALESCE(a, b, ...)` | Erster nicht-null Wert | `COALESCE(data.customScore, 0)` |
| `LOWER(text)` | Text in Kleinbuchstaben | `LOWER(data.productName)` |
| `UPPER(text)` | Text in Großbuchstaben | `UPPER(data.subtype)` |
| `CONCAT(a, b, ...)` | Zeichenketten verbinden | `CONCAT(data.name, " (", data.subtype, ")")` |
| `CONTAINS(text, suche)` | Prüfen ob Text eine Teilzeichenkette enthält | `CONTAINS(data.description, "legacy")` |
| `PLUCK(array, schlüsselpfad)` | Einen Schlüsselpfad aus jedem Element extrahieren | `PLUCK(relations.relAppToITC, "attributes.costTotalAnnual")` |
| `FILTER(array, schlüsselpfad, wert)` | Elemente behalten, deren Schlüsselpfad einem Wert entspricht | `FILTER(relations.relOrgToApp, "attributes.hostingType", "onPremise")` |
| `MAP_SCORE(wert, zuordnung)` | Kategoriale Werte auf Punktzahlen abbilden | `MAP_SCORE(data.businessCriticality, {"missionCritical": 3, "businessCritical": 2})` |

Die sicheren Python-Builtins `len`, `str`, `int`, `float`, `bool`, `abs`, `round`, `min`,
`max` und `sum` stehen ebenfalls zur Verfügung, ebenso die üblichen Operatoren und Vergleiche.

### Formelbeispiele { #example-formulas }

**Summe mehrerer Kostenfelder derselben Karte:**
```
COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0) + COALESCE(data.infraCost, 0)
```

**Gesamte jährliche Kosten der IT-Komponenten, die eine Anwendung nutzt:**
```
SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))
```

**Risikobewertung basierend auf Kritikalität:**
```
IF(data.businessCriticality == "missionCritical", 100, IF(data.businessCriticality == "businessCritical", 75, 25))
```

**Anzahl der verknüpften Schnittstellen:**
```
relation_count.relAppToInterface
```

**Anzahl der On-Premise-Anwendungen in einer Organisation:**
```
COUNT(FILTER(relations.relOrgToApp, "attributes.hostingType", "onPremise"))
```

**Kosten aus untergeordneten Karten aufsummieren:**
```
SUM(PLUCK(children, "attributes.costTotalAnnual"))
```

**TIME-Model-Platzierung (Tolerate / Invest / Migrate / Eliminate)**, dasselbe Beispiel, das Sie im Panel **Formelreferenz** unter **Admin → Metamodell → Berechnungen** beim Anlegen einer neuen Berechnung sehen. Zieltyp = `Application`, Zielfeld = `timeModel`. Setzt voraus, dass Sie zwei `single_select`-Felder namens `businessFit` und `technicalFit` mit den Optionen `excellent`, `adequate`, `insufficient`, `unreasonable` hinzugefügt haben:
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

Wie das Beispiel zeigt, kann eine Formel über mehrere Zeilen gehen. Eine Zeile der Form
`name = ausdruck` speichert einen Zwischenwert, den spätere Zeilen wiederverwenden können,
und der Wert der letzten Zeile wird in das Zielfeld geschrieben.

Dies ist auch das durchgearbeitete Beispiel, das im [EA-Einsteigerleitfaden](../beginners-guide/customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation) referenziert wird.

**Kommentare** werden mit `#` unterstützt:
```
# Gewichtete Risikobewertung berechnen
IF(data.businessCriticality == "missionCritical", data.riskScore * 2, data.riskScore)
```

## Validieren und Testen

Der Formeleditor bietet zwei verschiedene Prüfungen, die sich unterschiedlich verhalten:

* **Validieren** führt die Formel gegen eine synthetische Karte aus. Jedes numerische Feld
  erhält den Dummy-Wert `1`, und die Karte hat **keine Beziehungen, keine untergeordneten
  Karten und keine eigenen Elterndaten**. Das bestätigt, dass die Syntax stimmt und die
  verwendeten Namen existieren, aber eine Formel, die über `relations` oder `children`
  aggregiert, zeigt hier immer `0` oder ein leeres Ergebnis. Das ist erwartetes Verhalten und
  kein Hinweis auf eine fehlerhafte Formel.
* **Testen**, verfügbar für eine gespeicherte Berechnung, läuft gegen eine echte Karte Ihrer
  Wahl. Das ist die richtige Wahl für alles, was Beziehungen, untergeordnete Karten oder die
  übergeordnete Karte betrifft. Es wird nichts auf die Karte geschrieben, das Ergebnis wird
  Ihnen nur angezeigt.

## Die Ergebnisse einer manuellen Ausführung lesen

Eine Berechnung aus der Liste auszuführen wertet sie für jede Karte des Zieltyps aus und
berichtet, was passiert ist — nicht nur, wie viele Karten berührt wurden. **Details anzeigen**
im Ergebnisbanner öffnet die Aufschlüsselung:

* **Ein Block pro Berechnung**, mit der Anzahl fehlerfrei berechneter und fehlgeschlagener
  Karten. Alle aktiven Berechnungen des Typs laufen gemeinsam, daher zeigt dies, welche davon
  das Problem verursacht.
* **Eine Zeile pro eindeutigem Fehler**, mit der Anzahl der betroffenen Karten. Eine fehlerhafte
  Formel ist überall auf dieselbe Weise fehlerhaft, einundzwanzig Fehlschläge sind also meist
  eine einzige Korrektur, nicht einundzwanzig.
* **Die Karten selbst**, unter jedem Fehler aufgeführt und verlinkt, sodass Sie eine öffnen und
  die verursachenden Daten ansehen können. Pro Fehler werden höchstens zehn aufgeführt; sind es
  mehr, wird der Rest als Anzahl angezeigt.

**Bericht kopieren** legt die gesamte Aufschlüsselung als Text in die Zwischenablage.

Der Status-Chip in der Berechnungsliste spiegelt dieselbe Ausführung wider: rot, sobald eine
Karte fehlgeschlagen ist, grün nur, wenn alle berechnet wurden.

## Wann Berechnungen ausgeführt werden

Die Berechnungen einer Karte werden neu ausgewertet, wenn:

* die Karte erstellt oder gespeichert wird;
* eine Beziehung, die die Karte berührt, erstellt, geändert oder gelöscht wird (beide Enden
  der Beziehung werden neu berechnet);
* die Karte einem neuen Elternteil zugeordnet wird, wodurch ihr gesamter Teilbaum neu
  berechnet wird;
* Sie die Berechnung manuell aus der Liste ausführen, wodurch sie für jede Karte des Zieltyps
  ausgewertet und die Ergebnisse gespeichert werden.

Sie werden **nicht** neu ausgewertet, wenn eine andere Karte bearbeitet wird, aus der diese
Formel liest. Wenn Sie Kosten an einer IT-Komponente ändern, bewegt sich eine Anwendung, die
diese aggregiert, erst dann, wenn die Anwendung gespeichert wird, sich eine ihrer Beziehungen
ändert oder Sie die Berechnung für den Typ ausführen. Führen Sie Berechnungen über Daten, die
andere pflegen, regelmässig oder nach einem Massenimport aus.

!!! note "Hinweis"
    Dasselbe gilt für von `parent` und `hierarchy_level` abgeleitete Werte: Sie werden bei
    einer Neuzuordnung und bei einer manuellen Ausführung aktualisiert, nicht bei jeder
    Bearbeitung der übergeordneten Karte. Sichern Sie eine `parent`-Referenz immer mit
    `IF(parent, …)` ab, damit Wurzelkarten, bei denen `parent` `None` ist, keinen Fehler
    verursachen.

## Ausführungsreihenfolge

Wenn mehrere Berechnungen auf denselben Kartentyp abzielen, werden sie in der durch ihren **Ausführungsreihenfolge**-Wert festgelegten Reihenfolge ausgeführt. Dies ist wichtig, wenn eine Berechnung vom Ergebnis einer anderen abhängt: Setzen Sie die Abhängigkeit auf eine niedrigere Nummer, damit sie zuerst ausgeführt wird.

Turbo EA weist einen Satz von Berechnungen zurück, der einen Zyklus bilden würde, zum Beispiel ein Feld A, das aus Feld B berechnet wird, während B aus A berechnet wird.
