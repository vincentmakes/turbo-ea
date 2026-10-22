# Ihre erste Analyse: Anwendungsharmonisierung

Dies ist die Belohnung. Sie haben ein Anwendungsinventar, eine Capability Map und das integrierte Feld TIME-Modell. Jetzt verbinden Sie sie und erstellen die beiden Berichte, die das gesamte EA-Programm gegenüber einem CIO rechtfertigen:

- Den Bericht **Anwendungsportfolio**, in dem jede Anwendung nach **Geschäftskritikalität** gruppiert und nach ihrer **TIME**-Disposition eingefärbt ist (**T**olerieren / **I**nvestieren / **M**igrieren / **E**liminieren).
- Die **Geschäftsfähigkeiten-Karte**, eine Heatmap, die zeigt, wo Sie Redundanz haben (mehrere Apps pro Capability) und Fragilität (einzelne App pro Capability).

## Schritt 1 — Ordnen Sie Anwendungen Capabilities zu

Die wertvollste Einzelbeziehung im gesamten Metamodell ist **Application → Business Capability** (`unterstützt` / `wird unterstützt von`). Sie werden sie für jede Anwendung im Geltungsbereich setzen.

### Massen-Pfad: Inventar-Bearbeitungsmodus

1. Gehen Sie zu **Inventar**, filtern Sie nach Type = `Application`.
2. Stellen Sie sicher, dass die Beziehungsspalte **Business Capability** sichtbar ist (Tab Columns → Relations).
3. Schalten Sie den Modus **Grid Edit** in der Symbolleiste um.
4. Klicken Sie in jeder Zeile auf die Capability-Zelle und wählen Sie eine oder mehrere Capabilities aus. Jede Änderung wird sofort gespeichert.

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

## Schritt 2 — Kritikalität und Eignung bewerten

Drei integrierte Felder im Abschnitt **Bewertung** jeder Anwendungskarte speisen die Analyse. Füllen Sie sie mit dem Application Owner aus — in einem einstündigen Workshop können Sie typischerweise 30–50 Anwendungen bewerten, mit der **Tabellenbearbeitung** und den drei Spalten sichtbar.

| Feld | Optionen | Welche Frage es beantwortet |
|-------|---------|-----------------|
| **Geschäftskritikalität** | Geschäftskritisch / Unternehmenskritisch / Geschäftsbetrieb / Administrativ | Wie stark hängt das Geschäft von dieser App ab? |
| **Funktionale Eignung** | Perfekt / Angemessen / Unzureichend / Ungeeignet | Wie gut leistet sie, was das Geschäft braucht? |
| **Technische Eignung** | Vollständig geeignet / Ausreichend / Ungeeignet / Unpassend | Wie gesund ist die zugrunde liegende Technologie? |

Die Geschäftskritikalität gruppiert den Bericht in Schritt 4. Die beiden Eignungsbewertungen sind das, was die TIME-Berechnung in Schritt 3 liest.

Wenn Sie diese Felder auf einer genehmigten Karte bearbeiten, wechselt ihr Genehmigungsstatus auf **Ungültig**. Genehmigen Sie die Karten nach dem Workshop gesammelt erneut.

## Schritt 3 — TIME mit einem berechneten Feld ableiten

Das integrierte Feld **TIME-Modell** auf Application (`timeModel`, vier Optionen: `tolerate` / `invest` / `migrate` / `eliminate`) ist die Entscheidungsspalte, die den Rest der Analyse antreibt. Anstatt jeden Application Owner zu bitten, eine Option zu wählen, leiten Sie es mit einer **Berechnung** aus den beiden Eignungsbewertungen ab — die klassische Gartner-Platzierung:

| | Technische Eignung hoch | Technische Eignung niedrig |
|---|---|---|
| **Funktionale Eignung hoch** | **Investieren** | **Migrieren** |
| **Funktionale Eignung niedrig** | **Tolerieren** | **Eliminieren** |

1. Gehen Sie zu **Admin → Metamodell → Berechnungen** und klicken Sie auf **Neue Berechnung**.
2. Setzen Sie **Ziel-Kartentyp** = `Application` und **Zielfeld** = **TIME-Modell**.
3. Fügen Sie die Formel aus [Metamodell anpassen → Option: Ein Feld automatisch mit einer Berechnung ableiten](customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation) ein. Sie verwendet die integrierten Eignungsfelder, sodass kein benutzerdefiniertes Feld nötig ist.
4. Klicken Sie auf **Validieren**, speichern Sie und prüfen Sie das Ergebnis dann mit **Mit Karte testen** an ein paar Anwendungen, die Sie gut kennen.
5. Schalten Sie die Berechnung in der Liste auf **Aktiv** und klicken Sie dann in ihrer Zeile auf **Alle neu berechnen**, um das TIME-Modell für jede Anwendung zu befüllen.

Von da an wird das TIME-Modell bei jedem Speichern einer Anwendung neu berechnet, trägt ein Badge **berechnet** und kann nicht mehr von Hand bearbeitet werden. Eine Anwendung, der eine der beiden Eignungsbewertungen fehlt, erhält keinen TIME-Wert — das ist gewollt: So sehen Sie, welche Bewertungen noch fehlen.

!!! warning "Nicht tun"
    Ein berechnetes TIME ist eine **Ausgangshypothese**, kein Urteil. Überprüfen Sie die Ergebnisse mit den Application Ownern, bevor Sie sie präsentieren. Wo eine Entscheidung von der Formel abweichen muss, schalten Sie die Berechnung aus (Schalter **Aktiv**) und bearbeiten Sie das TIME-Modell von Hand in der **Tabellenbearbeitung**.

Referenz: [Admin → Berechnungen](../admin/calculations.md).

## Schritt 4 — Führen Sie den Bericht Anwendungsportfolio aus

1. Gehen Sie zu **Berichte → Anwendungsportfolio**.
2. Setzen Sie **Gruppieren nach** = **Geschäftskritikalität**.
3. Setzen Sie **Anwendungen einfärben nach** = **TIME-Modell**.
4. Klicken Sie auf das Lesezeichen-Symbol (**Bericht speichern**) und benennen Sie die Ansicht („Anwendungsportfolio — Vertriebsdomäne"). Sie finden sie unter **Berichte → Gespeicherte Berichte** wieder.

Jede Stufe der Geschäftskritikalität wird zu einem Kasten, mit einem Chip pro Anwendung, der nach ihrer TIME-Disposition eingefärbt ist, und einem Balken, der die Verteilung zeigt. Um sich auf eine Domäne zu konzentrieren, verwenden Sie den Filter **Verknüpft über** mit den Capabilities in Ihrem Geltungsbereich.

Worauf achten:

- **Apps mit „Geschäftskritisch" oder „Unternehmenskritisch", die auf Migrieren stehen** — Ihre folgenreichsten Modernisierungsentscheidungen. Diese kommen zuerst.
- **Apps mit „Administrativ" oder „Geschäftsbetrieb", die auf Eliminieren oder Migrieren stehen** — Ihre schnellsten Vereinfachungserfolge: Nehmen Sie sie außer Betrieb oder konsolidieren Sie sie auf eine andere Plattform.
- **Geschäftskritische Apps, die auf Investieren stehen** — bestätigen Sie, dass sie die Investition tatsächlich erhalten.
- **Apps ohne Farbe** (TIME *Nicht gesetzt*) — eine der beiden Eignungsbewertungen fehlt. Gehen Sie zurück zu Schritt 2.

Referenz: [Berichte → Portfoliobericht](../guide/reports.md#portfoliobericht).

## Schritt 5 — Führen Sie die Geschäftsfähigkeiten-Karte aus

1. Gehen Sie zu **Berichte → Geschäftsfähigkeiten**.
2. Belassen Sie die **Heatmap-Metrik** auf **Anzahl Anwendungen**: Die Farbintensität der Zellen ist proportional zur Anzahl der Anwendungen, die diese Capability unterstützen.
3. Optional: Aktivieren Sie **Anwendungen anzeigen** und setzen Sie **Apps einfärben nach** = **TIME-Modell**, um die TIME-Disposition der Apps innerhalb jeder Capability zu sehen.

Worauf achten:

- **Heiße Zellen** (viele Apps pro Capability) — Kandidaten-Redundanz. Der häufigste Business Case für eine Anwendungsportfolio-Rationalisierung liegt hier.
- **Kalte Zellen** mit Anwendungen, die Sie erwarten würden — Lücken in Ihrer Zuordnung oder tatsächlich unterversorgte Capabilities.
- **Weiße Zellen** in der Mitte eines aktiven Zweigs — nicht zugeordnete Anwendungen oder nicht modellierte Capabilities.

Referenz: [Berichte → Fähigkeitskarte](../guide/reports.md#fahigkeitskarte).

## Schritt 6 — Präsentieren und iterieren

Sie haben nun eine vertretbare Portfolio-Sicht. Legen Sie die beiden Berichte dem Vertriebs-CIO (oder wem auch immer Ihr Geltungsbereich gehört) vor und:

- Bestätigen Sie die TIME-Entscheidungen für die Anwendungen mit „Geschäftskritisch" und „Unternehmenskritisch".
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
