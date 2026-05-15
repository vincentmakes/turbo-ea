# Ihre erste Analyse: Anwendungsharmonisierung

Dies ist die Belohnung. Sie haben ein Anwendungsinventar, eine Capability Map und ein TIME-Dispositionsfeld. Jetzt verbinden Sie sie und erstellen die beiden Berichte, die das gesamte EA-Programm gegenüber einem CIO rechtfertigen:

- Einen **Portfolio-Bericht**, der jede Anwendung nach Kosten dimensioniert und nach TIME-Disposition eingefärbt zeigt.
- Eine **Capability Heatmap**, die zeigt, wo Sie Redundanz haben (mehrere Apps pro Capability) und Fragilität (einzelne App pro Capability).

## Schritt 1 — Ordnen Sie Anwendungen Capabilities zu

Die wertvollste Einzelbeziehung im gesamten Metamodell ist **Application → Business Capability** (`supports` / `supported by`). Sie werden sie für jede Anwendung im Geltungsbereich setzen.

### Massen-Pfad: Inventar-Bearbeitungsmodus

1. Gehen Sie zu **Inventar**, filtern Sie nach Type = `Application`.
2. Stellen Sie sicher, dass die Beziehungsspalte **Business Capability** sichtbar ist (Tab Columns → Relations).
3. Schalten Sie den Modus **Grid Edit** in der Symbolleiste um.
4. Klicken Sie in jeder Zeile auf die Capability-Zelle und wählen Sie eine oder mehrere Capabilities aus.
5. Speichern.

Für 50–200 Apps dauert dies einen Nachmittag und eine Tasse Kaffee.

### Karte-für-Karte-Pfad

Für urteilsintensive Zuordnungen (oder wenn ein Workshop mit dem Application Owner involviert ist) öffnen Sie jede Application-Karte und verwenden den Abschnitt **Beziehungen**. Sie erhalten den vollständigen Picker mit Suche, Hierarchie-Vorschau und der Möglichkeit, Beziehungsattribute zu setzen.

### Wie viele Capabilities pro Anwendung?

| Anzahl Zuordnungen | Was es bedeutet |
|--------------|---------------|
| **0** | Nicht zugeordnet — Ihr Inventar ist unvollständig. Filtern Sie diese und korrigieren Sie. |
| **1** | Der saubere, ideale Fall — diese App unterstützt genau eine Capability. |
| **2–3** | In Ordnung — viele Apps umspannen ein paar verwandte Capabilities. |
| **4+** | Verdächtig — möglicherweise vermengen Sie „verwendet Daten von" mit „unterstützt". Überprüfen Sie erneut. |

!!! tip "Bewährte Praxis"
    Die Zuordnung im ersten Durchgang ist schnell und grob. Der zweite Durchgang — durchgeführt mit dem Application Owner bei der Überprüfung — ist das, was die Daten vertrauenswürdig macht. Planen Sie beides ein.

## Schritt 2 — Wählen Sie, wie Sie das TIME-Feld befüllen

Sie haben zwei Optionen. Wählen Sie eine (oder verwenden Sie beide, mit Berechnung als Standard und manuellem Override für Ausnahmen):

### Option A — Manuelle TIME-Eingabe (für den ersten Durchgang empfohlen)

Sie haben auf der vorherigen Seite ein Single-Select-Feld `timeDisposition` hinzugefügt. Verwenden Sie es. Mit dem Application Owner in einem einstündigen Workshop können Sie typischerweise 30–50 Anwendungen klassifizieren:

- **Tolerieren** — funktioniert, geringe Kosten, kein strategischer Differenzierer. In Ruhe lassen.
- **Investieren** — strategisch, Wachstumsbereich, finanzieren Sie Verbesserungen.
- **Migrieren** — ersetzen oder auf eine neue Plattform innerhalb des Planungshorizonts verschieben.
- **Eliminieren** — Duplikat, End-of-Life, außer Betrieb nehmen.

Verwenden Sie den Modus **Grid Edit** des Inventars mit sichtbarer `timeDisposition`-Spalte, um dies schnell zu erledigen.

### Option B — Berechnete TIME via Formel

Wenn Sie eine Ausgangsempfehlung wünschen, die die Owner dann validieren, kann die Funktion [Berechnungen](../admin/calculations.md) einen Standard-TIME-Wert aus Kosten- und Lebenszyklusdaten ableiten.

Beispielformel auf dem Feld `timeDisposition` des Typs `Application`:

```
IF(lifecycle_endOfLife <= TODAY() + 365, "eliminate",
   IF(costTotalAnnual > 500000, "invest",
      IF(costTotalAnnual < 50000, "tolerate", "migrate")))
```

Was sie tut:

- Anwendungen, die innerhalb eines Jahres End-of-Life erreichen → **Eliminieren**.
- Hochkostige strategische Apps → **Investieren**.
- Niedrigkostige Utility-Apps → **Tolerieren**.
- Alles andere → **Migrieren** (der Standard, der menschliche Überprüfung erfordert).

Die Formel läuft automatisch jedes Mal, wenn eine Karte gespeichert wird, und Turbo EA markiert das Feld als schreibgeschützt mit einem „calculated"-Badge, damit Benutzer nicht versehentlich von der Regel abweichen können.

!!! warning "Nicht tun"
    Ein berechnetes TIME ist eine **Ausgangshypothese**, kein Urteil. Überprüfen Sie entweder jedes Ergebnis mit dem Owner, bevor Sie ihm vertrauen, oder schalten Sie die Berechnung aus und verlassen Sie sich auf die manuelle Eingabe, sobald der Workshop abgeschlossen ist.

Das hybride Muster: Lassen Sie die Berechnung eingeschaltet, während Sie das Inventar aufbauen, schalten Sie sie für den Workshop aus, stellen Sie das Feld für die endgültigen Entscheidungen auf manuelle Bearbeitung zurück.

## Schritt 3 — Führen Sie den Portfolio-Bericht aus

1. Gehen Sie zu **Reports → Portfolio**.
2. Konfigurieren Sie die Achsen:
    - **Card type**: `Application`
    - **X-Achse**: ein Maß für die technische Eignung, falls Sie eines haben (sonst Kostenaufteilung, Alter oder Lebenszyklus).
    - **Y-Achse**: ein Maß für den Geschäftswert (sonst `costTotalAnnual` als Ersatz).
    - **Größe**: `costTotalAnnual` — je höher die Ausgaben, desto größer die Blase.
    - **Farbe**: `timeDisposition` — das ist es, was den Bericht entscheidungsreif macht.
3. Speichern Sie die Konfiguration als benannte Ansicht („Anwendungsportfolio — Vertriebsdomäne"), damit Sie zu ihr zurückkehren können.

Worauf achten:

- **Große rote Blasen** (hochkostige Eliminieren-Kandidaten) — Ihre schnellsten Einsparungen.
- **Große bernsteinfarbene Blasen** (hochkostige Migrieren-Kandidaten) — Ihre folgenreichsten Transformationsentscheidungen.
- **Cluster oben rechts in der Matrix**, die nicht grün sind — strategische Apps, die nicht die Investition erhalten.

Referenz: [Berichte](../guide/reports.md).

## Schritt 4 — Führen Sie die Capability Heatmap aus

1. Gehen Sie zu **Reports → Capability Map**.
2. Die Heatmap zeigt Ihre Business-Capability-Hierarchie mit einer Zellfarbintensität, die proportional zur **Anzahl der Anwendungen, die diese Capability unterstützen**, ist.

Worauf achten:

- **Heiße Zellen** (viele Apps pro Capability) — Kandidaten-Redundanz. Der häufigste Business Case für eine Anwendungsportfolio-Rationalisierung liegt hier.
- **Kalte Zellen** mit Anwendungen, die Sie erwarten würden — Lücken in Ihrer Zuordnung oder tatsächlich unterversorgte Capabilities.
- **Weiße Zellen** in der Mitte eines aktiven Zweigs — nicht zugeordnete Anwendungen oder nicht modellierte Capabilities.

Referenz: [Berichte → Capability Map](../guide/reports.md).

## Schritt 5 — Präsentieren und iterieren

Sie haben nun eine vertretbare Portfolio-Sicht. Legen Sie die beiden Berichte dem Vertriebs-CIO (oder wem auch immer Ihr Geltungsbereich gehört) vor und:

- Bestätigen Sie die TIME-Aufrufe für die Top 10 der kostenintensivsten Anwendungen.
- Identifizieren Sie die Top 3 heißen Zellen in der Heatmap als Kandidaten-Rationalisierungsprojekte.
- Erfassen Sie Folgemaßnahmen als Kommentare oder Todos an den Anwendungen selbst — Turbo EA verfolgt sie pro Karte.

Das war's. Sie haben eine funktionierende EA-Praxis auf Turbo EA.

## Wie geht es weiter

Sobald Ihr Anwendungsportfolio lebendig und vertrauenswürdig ist, werden diese zu wertvollen nächsten Schritten. Keiner davon ist nützlich, bevor Sie ein befülltes Inventar haben — deshalb hat dieser Leitfaden sie absichtlich aufgeschoben.

| Modul | Wann öffnen | Wo zu finden |
|--------|----------------|------------------|
| **Risk Register** | Wenn Sie bereit sind, Architekturrisiken gegenüber Anwendungen und Capabilities zu verfolgen (TOGAF Phase G). | [Risk Register](../guide/risks.md) |
| **GRC / Compliance** | Wenn Sie Anwendungen und Capabilities gegenüber Regulierungen (DSGVO, NIS2, EU AI Act, DORA, SOC 2, ISO 27001) abbilden müssen. | [GRC](../guide/grc.md) |
| **PPM** | Wenn die Rationalisierungsentscheidungen zu Projekten mit Budgets, Zeitplänen und Statusberichten werden. | [PPM](../guide/ppm.md) |
| **TurboLens AI** | Wenn Sie genug Karten haben, damit die KI Vendor-Duplikate, Modernisierungskandidaten und Architekturempfehlungen finden kann. | [TurboLens](../guide/turbolens.md) |
| **BPM** | Wenn Sie bereit sind, die Prozesse zu modellieren, die auf Ihren Anwendungen sitzen. | [BPM](../guide/bpm.md) |
| **Diagramme** | Wenn Sie freiformatige Architekturdiagramme benötigen, die mit dem Inventar synchron bleiben. | [Diagramme](../guide/diagrams.md) |
| **EA Delivery** | Wenn Sie beginnen, Statements of Architecture Work und Architecture Decision Records im TOGAF-Stil zu produzieren. | [EA Delivery](../guide/delivery.md) |

Willkommen bei Turbo EA.
