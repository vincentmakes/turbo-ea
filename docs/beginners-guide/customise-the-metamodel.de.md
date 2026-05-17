# Metamodell anpassen — behutsam

Das Metamodell von Turbo EA ist vollständig **admin-konfigurierbar** — jeder Kartentyp, jedes Feld, jeder Subtyp, jede Beziehung und jede Stakeholder-Rolle ist Daten, kein Code. Sie werden versucht sein, es neu zu gestalten. **Tun Sie es nicht.**

Die Teams, die erfolgreich sind, passen das Metamodell **nur dann an, wenn die Standardfelder ihre Frage nicht beantworten können**. Die Teams, die scheitern, verbringen ihren ersten Monat damit, `Application` in `Solution` umzubenennen, 30 benutzerdefinierte Felder hinzuzufügen — und kommen nie zu einem funktionierenden Bericht.

## Was bereits im Metamodell enthalten ist

Bevor Sie etwas hinzufügen, wissen Sie, was Sie bereits haben. Der integrierte Kartentyp **Application** liefert unter anderem folgende Felder von Haus aus mit:

| Integriertes Feld | Typ | Wofür es ist |
|----------------|------|--------------|
| `businessCriticality` | `single_select` | Mission-critical / Important / Useful / Marginal |
| `functionalSuitability` | `single_select` | Perfect / Appropriate / Insufficient / Unreasonable |
| `technicalSuitability` | `single_select` | Fully Appropriate / Adequate / Unreasonable / Inappropriate |
| `timeModel` | `single_select` (erforderlich) | **Tolerate / Invest / Migrate / Eliminate** — die kanonische Gartner-TIME-Disposition |
| `riskLevel` | `single_select` | Low / Medium / High / Critical |
| `businessValue` | `single_select` | Treibt die Y-Achse des Portfolio-Berichts an |
| `costTotalAnnual` | `cost` | Gesamte jährliche Kosten |
| `lifecycle.*` | Daten | Plan / Phase In / Active / Phase Out / End of Life |

Alles, was eine Application-Portfolio-Rationalisierung benötigt, ist bereits vorhanden, einschließlich des **TIME Model**. Sie müssen kein TIME-Feld hinzufügen — Sie füllen es aus (manuell oder über eine Berechnung, siehe [Ihre erste Analyse](your-first-analysis.md)). Dasselbe gilt für `functionalSuitability` und `technicalSuitability`, die beiden Eignungsdimensionen, die klassischerweise eine TIME-Platzierung steuern.

## Der Zwei-Fragen-Test vor dem Hinzufügen eines Feldes

Wenn Sie tatsächlich ein Feld benötigen, das wirklich nicht im Metamodell vorhanden ist, fragen Sie sich:

1. **Werde ich nach diesem Feld filtern, gruppieren oder berichten?** Wenn nein, gehört es in die Beschreibung oder ein Tag — nicht in ein Feld.
2. **Wird auf jeder Karte dieses Typs dieselbe Antwort benötigt?** Wenn nein, ist es eine Beziehung oder ein Anhang, kein Feld.

Wenn Sie nicht beide Fragen mit „ja" beantworten können, fügen Sie das Feld nicht hinzu.

## Wenn Sie wirklich ein benutzerdefiniertes Feld benötigen

Für den seltenen Fall, dass tatsächlich ein neues Feld benötigt wird (z. B. ein `cloudReadiness`-Flag, eine regulatorische Klassifizierung, ein Kundensegment-Marker), lautet der Arbeitsablauf:

1. Gehen Sie zu **Admin → Metamodell**, klicken Sie auf den Typ und wechseln Sie zum Tab **Fields**.
2. Wählen Sie den Abschnitt (oder erstellen Sie einen neuen) und klicken Sie auf **+ Feld hinzufügen**.
3. Füllen Sie aus:
    - **Key** in Lower-CamelCase (z. B. `cloudReadiness`) — wird zum Attribut-Schlüssel im JSON und in Formeln.
    - **Label** (und eine Übersetzung für jede von Ihnen unterstützte Sprache — sonst sehen nicht-englische Benutzer den rohen Schlüssel).
    - **Type** — `text`, `number`, `cost`, `boolean`, `date`, `url`, `single_select`, `multiple_select`.
    - **Weight** — `0`, um es aus der Datenqualität auszuschließen, `1`+, um es einzubeziehen und zu gewichten.
    - **Required** — lassen Sie es beim ersten Rollout **aus**; Required blockiert die Genehmigung jeder bestehenden Karte.
4. Bei Select-Typen fügen Sie die Optionen hinzu (Key + Label + Farbe) und übersetzen Sie jede Option.
5. Speichern.

Das Feld ist sofort im **Inventar** (Columns, Filter), in der Kartendetailansicht und in **Berechnungen**-Formeln als `<fieldKey>` verfügbar. Vollständige Referenz: [Admin → Metamodell](../admin/metamodel.md).

## Option: Ein Feld automatisch mit einer Berechnung ableiten { #option-derive-a-field-automatically-with-a-calculation }

Neben der Standardoption, dass Benutzer ein Feld manuell ausfüllen, kann Turbo EA einen Feldwert **automatisch** aus anderen Feldern derselben Karte — einschließlich der integrierten Felder — über die Funktion **Berechnungen** berechnen. Das berechnete Feld wird schreibgeschützt und trägt ein „calculated"-Badge, sodass Benutzer nicht von der Regel abweichen können.

Das kanonische Beispiel ist die **TIME-Model**-Berechnung, die das integrierte Feld `timeModel` auf Application aus einer Business-Fit- und einer Technical-Fit-Dimension ableitet. Sie wird als einer der Einträge im Panel **Formelreferenz** unter **Admin → Metamodell → Berechnungen** ausgeliefert, wenn Sie eine neue Berechnung anlegen, sodass Sie sie direkt aus dem Panel auswählen können. Zieltyp = `Application`, Zielfeld = `timeModel`; die vom Panel bereitgestellte Formel ist in [Admin → Berechnungen → Beispielformeln](../admin/calculations.md#example-formulas) wiedergegeben.

Die Formel setzt zwei `single_select`-Felder namens `businessFit` und `technicalFit` mit den Optionen `excellent` / `adequate` / `insufficient` / `unreasonable` voraus. Sie sind nicht im integrierten Metamodell enthalten — fügen Sie sie auf Application gemäss den oben beschriebenen Schritten für benutzerdefinierte Felder hinzu, wenn Sie diese Berechnung verwenden möchten.

!!! warning "Nicht tun"
    Ein berechnetes TIME ist eine **Ausgangshypothese**, kein Urteil. Überprüfen Sie entweder jedes Ergebnis mit dem Application Owner, bevor Sie ihm vertrauen, oder schalten Sie die Berechnung aus und verlassen Sie sich auf die manuelle Eingabe, sobald der Validierungs-Workshop abgeschlossen ist.

Das hybride Muster, das sich in der Praxis bewährt: Lassen Sie die Berechnung eingeschaltet, während Sie das Inventar aufbauen und überwiegend Eignungsdaten haben; schalten Sie sie für den Validierungs-Workshop aus; lassen Sie sie dann ausgeschaltet, damit manuelle Entscheidungen bestehen bleiben.

## Alternative: Verwenden Sie stattdessen eine Tag-Gruppe

Wenn der Wert informativ statt abfragbar ist, ist eine **Tag-Gruppe** (Admin → Tags) leichter als ein benutzerdefiniertes Feld — keine Metamodelländerung, keine Migration, einfacher weiterzuentwickeln. Verwenden Sie eine Tag-Gruppe, wenn:

- Der Wert beschreibend ist („Customer-facing", „Internal-only", „Acquired in 2024").
- Sie häufig neue Optionen hinzufügen können.
- Sie sie nicht in einem Filter-Dropdown benötigen, aber ein „Search-as-you-type"-Tag-Chip in Ordnung ist.

Verwenden Sie ein benutzerdefiniertes Feld, wenn:

- Sie den Wert auf den Portfolio-Bericht-Achsen benötigen (X, Y, Farbe).
- Sie ihn in die Datenqualität gewichten möchten.
- Es ein kontrolliertes Vokabular ist, das sich nicht oft ändert.

## Zu vermeidende Anti-Patterns

Dies sind die häufigsten Metamodell-Fehler in ersten Rollouts:

!!! warning "Benennen Sie integrierte Kartentypen nicht um"
    `Application` in `Solution` umzubenennen sieht ordentlich aus, bricht aber die konzeptionelle Zuordnung, die Capability Heatmap, Portfolio-Bericht und die Kataloge alle voraussetzen. Wenn Ihre Organisation sie „Solutions" nennt, setzen Sie die **Label**-Übersetzung — der zugrunde liegende `key` bleibt `Application`.

!!! warning "Fügen Sie nicht am ersten Tag 30 benutzerdefinierte Felder hinzu"
    Jedes benutzerdefinierte Feld fügt der Datenerfassung Reibung hinzu und verwässert den Datenqualitäts-Score. Fügen Sie ein Feld hinzu, verwenden Sie es einen Monat lang, fügen Sie dann das nächste hinzu.

!!! warning "Duplizieren Sie keine integrierten Felder"
    Bevor Sie `timeDisposition`, `funcFit`, `techFit` oder `appBusinessValue` hinzufügen, prüfen Sie die bestehende Feldliste — wahrscheinlich existiert bereits ein gleichwertiges integriertes Feld (`timeModel`, `functionalSuitability`, `technicalSuitability`, `businessValue`). Duplikate teilen Ihre Daten auf und brechen Berichte.

!!! warning "Machen Sie neue Felder nicht am ersten Tag `required`"
    `Required` blockiert die Genehmigung für jede bestehende Karte, die keinen Wert hat. Machen Sie ein Feld erst dann required, **nachdem** Sie es für 80 %+ der Population ausgefüllt haben.

!!! warning "Erstellen Sie keine benutzerdefinierten Kartentypen anstelle von benutzerdefinierten Feldern"
    „Mobile App" sollte ein Subtyp von `Application` sein, kein neuer Kartentyp. Neue Typen erhalten Capability-Mapping, Portfolio-Berichte oder Katalog-Importe nicht automatisch.

## Andere leichtgewichtige Erweiterungen, die Sie möglicherweise wünschen

Dies sind häufige Erweiterungen im zweiten Durchgang, aber **fügen Sie sie nicht hinzu, bis Sie sie tatsächlich brauchen**:

| Bedarf | Wo hinzufügen | Typ |
|------|-------------|------|
| Cloud-Bereitschaft | Application | `single_select` (Ready / Needs refactor / Stays on-prem) |
| Customer-facing-Flag | Application | `boolean` |
| Regulatorische Klassifizierung | Application, DataObject | `multiple_select` (GDPR, PCI-DSS, …) |
| Verlustrisikokategorie | Application, IT Component | `single_select` (Single point of failure usw.) |
| Kostenaufteilung | Application | zusätzliche `cost`-Felder für `costRunTotalAnnual`, `costChangeTotalAnnual` |

Jede besteht den Zwei-Fragen-Test für Portfolio-Analytik. Mehrere davon sind auch gute Kandidaten für eine **berechnete** Formel anstelle manueller Eingabe — was die nächste Seite mit `timeModel` selbst als durchgearbeitetem Beispiel behandelt.

Weiter: [Ihre erste Analyse: Anwendungsharmonisierung](your-first-analysis.md).
