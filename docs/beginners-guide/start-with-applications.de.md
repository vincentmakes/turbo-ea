# Beginnen Sie mit Ihrem Anwendungsinventar

Turbo EA wird mit 13 Kartentypen ausgeliefert. Sie werden versucht sein, alle zu befüllen. Tun Sie es nicht.

**Beginnen Sie mit Anwendungen**. Anwendungen sind der Kartentyp mit der höchsten Hebelwirkung in jedem ersten Rollout:

- Sie sind am einfachsten zu beschaffen — IT-Abteilungen haben fast immer irgendwo eine Liste (CMDB, Lizenz-Tracker, Finanzsystem, sogar eine Tabellenkalkulation).
- Sie verankern jede andere Ebene — sobald Sie Anwendungen haben, wird die Zuordnung zu Capabilities, Prozessen und IT-Komponenten zu einer inkrementellen Anreicherung statt zu einer Greenfield-Übung.
- Sie treiben den ersten nützlichen Bericht (Portfolio-Rationalisierung) mit den wenigsten Abhängigkeiten an.

Andere Kartentypen kommen später. Eine häufige zweite Welle sind Business Capabilities (Seite 4) und dann Schnittstellen oder Datenobjekte.

## Wie „minimal lebensfähig" aussieht

Für jede Anwendungskarte in Ihrem anfänglichen Geltungsbereich befüllen Sie diese Felder und **nur** diese Felder:

| Feld | Warum es wichtig ist | Woher es kommt |
|-------|---------------|---------------------|
| **Name** | Identität. Verwenden Sie den Namen, den die Leute tatsächlich verwenden, nicht das Lizenzlabel. | Ihre vorhandene Quelle |
| **Beschreibung** | Ein Satz: Was tut diese App für das Geschäft? | Owner-Interview oder KI-Vorschlag (siehe [Inventar](../guide/inventory.md#ai-description-suggestions)) |
| **Lebenszyklusphase** | Plan / Phase In / Active / Phase Out / End of Life | CMDB oder Owner-Interview |
| **Business Owner** (Stakeholder) | Die Person, die für die App verantwortlich ist | Organigramm |
| **Cost — Total Annual** | Wird vom Portfolio-Bericht und der TIME-Formel verwendet | Finanzwesen oder grobe Schätzung |

Fünf Felder. Das war's. Der Datenqualitätsring zeigt ~50 % an, und das ist in Ordnung — Sie können im zweiten Durchgang verfeinern.

!!! warning "Nicht tun"
    Versuchen Sie nicht, das **End-of-Life-Datum**, den **Vendor**, den **Technologie-Stack** und 12 benutzerdefinierte Felder im ersten Durchgang auszufüllen. Sie werden um Karte 30 herum ausbrennen.

## Drei Wege, das Inventar zu befüllen

Wählen Sie den Pfad, der zu Ihrer Datenquelle passt. Sie können sie mischen — importieren Sie die Masse, korrigieren Sie dann den Long Tail manuell.

### Pfad A — Excel-/CSV-Import (für die meisten Starts empfohlen)

Wenn Ihre Anwendungen in einer Tabellenkalkulation leben (oder Sie sie aus einer CMDB exportieren können), ist dies der schnellste Weg. **Erstellen Sie die Tabelle nicht von Hand** — lassen Sie Turbo EA Ihnen die Vorlage liefern.

1. **Erstellen Sie zunächst manuell eine Dummy-Anwendungskarte**. Gehen Sie zu **Inventar → + Erstellen**, Type = `Application`, geben Sie einen Namen wie *„_TEMPLATE — bitte löschen"* ein. Füllen Sie die fünf Mindestfelder aus (Beschreibung, Lebenszyklus, Verantwortlicher, Kosten), damit der Export reale Beispielwerte enthält.
2. **Filtern Sie das Inventar nach Type = `Application`** und klicken Sie auf **Exportieren** in der Symbolleiste. Sie erhalten eine `.xlsx`-Datei mit einer Zeile echter Daten und einer Spalte pro Feld — das ist Ihre Vorlage. Die Spaltenüberschriften entsprechen den Feldschlüsseln, die der Importer erwartet.
3. **Bearbeiten Sie die Tabelle offline**: Behalten Sie die Spaltenstruktur bei, ersetzen Sie die einzelne Zeile durch alle Ihre echten Anwendungen und löschen Sie am Ende die Dummy-Zeile (oder lassen Sie sie stehen — Sie entfernen die Karte nach dem Import aus Turbo EA).
4. **Importieren Sie die bearbeitete Datei**: **Inventar → Importieren**, ziehen Sie die `.xlsx` hinein. Der Validierungsbericht zeigt Ihnen genau, welche Zeilen neue Karten erstellen, welche bestehende Karten aktualisieren (anhand von Name oder ID) und welche fehlschlagen werden.
5. Führen Sie den Import aus und archivieren Sie anschliessend die `_TEMPLATE`-Karte.

Vollständige Referenz: [Inventar → Excel-Import](../guide/inventory.md#excel-import).

**Tipp für den ersten Import:** Fügen Sie nur die fünf Mindestfelder sowie eine Spalte für die E-Mail-Adresse des Business Owners hinzu (der Importer versucht, sie bestehenden Benutzern zuzuordnen). Lassen Sie alles andere aus. Sie können später einen zweiten Import mit weiteren Spalten durchführen, indem Sie die Export-Bearbeiten-Import-Schleife wiederholen.

### Pfad B — ServiceNow-Synchronisierung

Wenn Sie eine ServiceNow-CMDB und Admin-Zugriff auf deren API haben, zieht die Integration Anwendungsdatensätze direkt.

1. Gehen Sie zu **Admin → ServiceNow-Integration**.
2. Erstellen Sie eine Verbindung (URL, Anmeldedaten — Anmeldedaten werden verschlüsselt gespeichert).
3. Definieren Sie eine Zuordnung: ServiceNow `cmdb_ci_business_app` → Turbo EA `Application`, mit Regeln auf Feldebene.
4. Führen Sie eine **Pull**-Synchronisierung durch. Standardmäßig landen Datensätze in einem **Staging**-Bereich zur Admin-Überprüfung, bevor sie angewendet werden.

Siehe [Admin → ServiceNow-Integration](../admin/servicenow.md) für die vollständige Konfiguration. Behandeln Sie die erste Synchronisierung als explorativ — überprüfen Sie, was hereingekommen ist, verfeinern Sie die Zuordnung und führen Sie sie dann produktiv aus.

### Pfad C — Manuelle Eingabe

Für kleine Bestände (unter ~30 Apps) oder wenn keine nutzbare Quelle existiert:

1. **Inventar** → **+ Erstellen** (oben rechts).
2. Type = **Application**, geben Sie Name und (optional) Beschreibung ein.
3. Klicken Sie auf **Mit KI vorschlagen**, wenn Sie eine Starterbeschreibung aus einer Websuche möchten.
4. Speichern und weitergehen. Sie werden den Rest auf der Kartendetailseite ausfüllen.

Die manuelle Eingabe ist langsam, erzeugt aber die qualitativ hochwertigsten Daten, weil jede Karte beim Anlegen vom Owner berührt wird.

## Nutzen Sie den Genehmigungs-Workflow als Qualitätstor

Jede Karte trägt einen **Genehmigungsstatus**: Draft → Approved → (Broken, wenn nach der Genehmigung substanziell bearbeitet).

Ein praktischer Workflow:

1. Neue Karten landen als **Draft**. Der Architect (Sie) macht einen schnellen Durchgang — Name korrekt, Beschreibung sinnvoll, Lebenszyklus richtig.
2. Sobald die Mindestfelder ausgefüllt sind, **genehmigen** Sie die Karte. Dies signalisiert nachgelagerten Konsumenten, dass die Karte vertrauenswürdig ist.
3. Wenn später jemand ein substanzielles Feld bearbeitet, kippt Turbo EA den Status automatisch auf **Broken**, bis er erneut genehmigt wird.

Filtern Sie das Inventar nach `Approval Status = Approved`, um eine saubere Ansicht für den Portfolio-Bericht am Ende dieses Leitfadens zu erhalten.

!!! tip "Bewährte Praxis"
    Genehmigen Sie am Ende jedes Tages in Stapeln. Es zwingt Sie, das Importierte erneut zu lesen und die schlimmsten Datenqualitätsprobleme frühzeitig zu erkennen.

## Wann das Befüllen aufhören und weitergehen

Sie sind mit dieser Seite fertig, wenn:

- Jede Anwendung in Ihrem Geltungsbereich eine Karte hat.
- Jede Karte die fünf Mindestfelder ausgefüllt hat.
- Die durchschnittliche Datenqualität über die Menge **≥ 40 %** beträgt.
- Mindestens 50 % der Karten genehmigt sind.

Warten Sie nicht auf Perfektion. Gehen Sie zur nächsten Seite — [Referenzkataloge nutzen](leverage-reference-catalogues.md) — und kommen Sie nach der Capability-Zuordnung zurück, um anzureichern.
