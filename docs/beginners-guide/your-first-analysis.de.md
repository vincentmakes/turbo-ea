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

## Schritt 2 — Wählen Sie, wie Sie das TIME Model befüllen

Das integrierte Feld **TIME Model** auf Application (`timeModel`, erforderlich, vier Optionen: `tolerate` / `invest` / `migrate` / `eliminate`) ist die Entscheidungsspalte, die den Rest der Analyse antreibt. Sie haben zwei Möglichkeiten, es zu befüllen.

### Option A — Manuelle TIME-Eingabe (für den ersten Durchgang empfohlen)

Mit dem Application Owner in einem einstündigen Workshop können Sie typischerweise 30–50 Anwendungen klassifizieren:

- **Tolerate** — funktioniert, geringe Kosten, kein strategischer Differenzierer. In Ruhe lassen.
- **Invest** — strategisch, Wachstumsbereich, finanzieren Sie Verbesserungen.
- **Migrate** — ersetzen oder auf eine neue Plattform innerhalb des Planungshorizonts verschieben.
- **Eliminate** — Duplikat, End-of-Life, außer Betrieb nehmen.

Verwenden Sie den Modus **Grid Edit** des Inventars mit sichtbarer Spalte **TIME Model**, um Entscheidungen schnell zu erfassen.

### Option B — Berechnete TIME via Formel

Anstatt jeden Application Owner zu bitten, TIME manuell zu setzen, können Sie `timeModel` automatisch aus den beiden integrierten Eignungsdimensionen (`functionalSuitability` × `technicalSuitability`) über die Funktion **Berechnungen** ableiten. Dies ist die kanonische Gartner-Vier-Quadranten-Platzierung.

Das durchgearbeitete Beispiel — die Formel, die Quadrantentabelle und das empfohlene hybride Muster — finden Sie unter [Metamodell anpassen → Option: Ein Feld automatisch mit einer Berechnung ableiten](customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation). Verwenden Sie es als Ausgangsempfehlung, die die Owner dann validieren, nicht als Urteil.

## Schritt 3 — Führen Sie den Portfolio-Bericht aus

1. Gehen Sie zu **Reports → Portfolio**.
2. Konfigurieren Sie die Achsen:
    - **Card type**: `Application`
    - **X-Achse**: `technicalSuitability` (das integrierte Feld für technische Eignung).
    - **Y-Achse**: `functionalSuitability` oder `businessValue` (integrierte Felder für Business-Eignung).
    - **Größe**: `costTotalAnnual` — je höher die Ausgaben, desto größer die Blase.
    - **Farbe**: `timeModel` — das ist es, was den Bericht entscheidungsreif macht.
3. Speichern Sie die Konfiguration als benannte Ansicht („Anwendungsportfolio — Vertriebsdomäne"), damit Sie zu ihr zurückkehren können.

Worauf achten:

- **Große rote Blasen** (hochkostige Eliminate-Kandidaten) — Ihre schnellsten Einsparungen.
- **Große bernsteinfarbene Blasen** (hochkostige Migrate-Kandidaten) — Ihre folgenreichsten Transformationsentscheidungen.
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
