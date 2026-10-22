# Metamodell anpassen — behutsam

Das Metamodell von Turbo EA ist vollständig **admin-konfigurierbar** — jeder Kartentyp, jedes Feld, jeder Subtyp, jede Beziehung und jede Stakeholder-Rolle ist Daten, kein Code. Sie werden versucht sein, es neu zu gestalten. **Tun Sie es nicht.**

Die Teams, die erfolgreich sind, passen das Metamodell **nur dann an, wenn die Standardfelder ihre Frage nicht beantworten können**. Die Teams, die scheitern, verbringen ihren ersten Monat damit, `Application` in `Solution` umzubenennen, 30 benutzerdefinierte Felder hinzuzufügen — und kommen nie zu einem funktionierenden Bericht.

## Was bereits im Metamodell enthalten ist

Bevor Sie etwas hinzufügen, wissen Sie, was Sie bereits haben. Der integrierte Kartentyp **Application** liefert unter anderem folgende Felder von Haus aus mit:

| Integriertes Feld | Typ | Wofür es ist |
|----------------|------|--------------|
| `businessCriticality` | `single_select` (erforderlich) | Geschäftskritisch / Unternehmenskritisch / Geschäftsbetrieb / Administrativ |
| `functionalSuitability` | `single_select` | Perfekt / Angemessen / Unzureichend / Ungeeignet |
| `technicalSuitability` | `single_select` | Vollständig geeignet / Ausreichend / Ungeeignet / Unpassend |
| `timeModel` | `single_select` (erforderlich) | **Tolerieren / Investieren / Migrieren / Eliminieren** — die kanonische Gartner-TIME-Disposition |
| `costTotalAnnual` | `cost` | Jährliche Gesamtkosten |
| `lifecycle.*` | Daten | Plan / Phase In / Active / Phase Out / End of Life |

Alles, was eine Application-Portfolio-Rationalisierung benötigt, ist bereits vorhanden, einschließlich des **TIME-Modells**. Sie müssen kein TIME-Feld hinzufügen — Sie leiten es mit einer Berechnung ab (siehe unten) oder füllen es von Hand aus, siehe [Ihre erste Analyse](your-first-analysis.md). Dasselbe gilt für `functionalSuitability` und `technicalSuitability`, die beiden Eignungsdimensionen, die klassischerweise eine TIME-Platzierung steuern, sowie für `businessCriticality`, das den Bericht Anwendungsportfolio gruppiert.

## Der Zwei-Fragen-Test vor dem Hinzufügen eines Feldes

Wenn Sie tatsächlich ein Feld benötigen, das wirklich nicht im Metamodell vorhanden ist, fragen Sie sich:

1. **Werde ich nach diesem Feld filtern, gruppieren oder berichten?** Wenn nein, gehört es in die Beschreibung oder ein Tag — nicht in ein Feld.
2. **Wird auf jeder Karte dieses Typs dieselbe Antwort benötigt?** Wenn nein, ist es eine Beziehung oder ein Anhang, kein Feld.

Wenn Sie nicht beide Fragen mit „ja" beantworten können, fügen Sie das Feld nicht hinzu.

## Wenn Sie wirklich ein benutzerdefiniertes Feld benötigen

Für den seltenen Fall, dass tatsächlich ein neues Feld benötigt wird (z. B. ein `cloudReadiness`-Flag, eine regulatorische Klassifizierung, ein Kundensegment-Marker), lautet der Arbeitsablauf:

1. Gehen Sie zu **Admin → Metamodell** und klicken Sie auf den Typ. Das Kartenlayout befindet sich auf dem Tab **Allgemein**.
2. Wählen Sie den Abschnitt (oder erstellen Sie einen mit **Abschnitt hinzufügen**) und klicken Sie auf **+ Feld**.
3. Füllen Sie aus:
    - **Schlüssel** in Lower-CamelCase (z. B. `cloudReadiness`) — wird zum Attribut-Schlüssel im JSON und in Formeln.
    - **Bezeichnung** (und eine Übersetzung für jede von Ihnen unterstützte Sprache — sonst sehen nicht-englische Benutzer den rohen Schlüssel).
    - **Typ** — `text`, `multiline_text`, `number`, `cost`, `percentage`, `boolean`, `date`, `url`, `single_select`, `multiple_select`.
    - **Pflichtfeld** — lassen Sie es beim ersten Rollout **aus**; solange ein Pflichtfeld leer ist, ist der Datenqualitäts-Score der Karte auf 0 fixiert.
4. Bei Select-Typen fügen Sie die Optionen hinzu (Key + Label + Farbe) und übersetzen Sie jede Option.
5. Speichern.
6. Optional: Legen Sie im Tab **Datenqualität** des Typs fest, wie stark das Feld in die Datenqualität einfließt.

Das Feld ist sofort im **Inventar** (Columns, Filter), in der Kartendetailansicht und in **Berechnungen**-Formeln als `<fieldKey>` verfügbar. Vollständige Referenz: [Admin → Metamodell](../admin/metamodel.md).

## Option: Ein Feld automatisch mit einer Berechnung ableiten { #option-derive-a-field-automatically-with-a-calculation }

Neben der Standardoption, dass Benutzer ein Feld manuell ausfüllen, kann Turbo EA einen Feldwert **automatisch** aus anderen Feldern derselben Karte — einschließlich der integrierten Felder — über die Funktion **Berechnungen** berechnen. Das berechnete Feld wird schreibgeschützt und trägt ein „calculated"-Badge, sodass Benutzer nicht von der Regel abweichen können.

Das kanonische Beispiel ist die Berechnung des **TIME-Modells**, die das integrierte Feld `timeModel` auf Application aus den beiden integrierten Eignungsbewertungen ableitet. Legen Sie sie unter **Admin → Metamodell → Berechnungen** mit **Neue Berechnung** an: Ziel-Kartentyp = `Application`, Zielfeld = **TIME-Modell**, und diese Formel:

```
# TIME Model from the built-in Functional and Technical Suitability (Gartner quadrants)
ff = MAP_SCORE(data.functionalSuitability, {"perfect": 4, "appropriate": 3, "insufficient": 2, "unreasonable": 1})
tf = MAP_SCORE(data.technicalSuitability, {"fullyAppropriate": 4, "adequate": 3, "unreasonable": 2, "inappropriate": 1})
IF(ff is None or tf is None, None, IF(ff >= 2.5, IF(tf >= 2.5, "invest", "migrate"), IF(tf >= 2.5, "tolerate", "eliminate")))
```

Jede Bewertung wird in einen Wert von 4 (am besten) bis 1 (am schlechtesten) umgerechnet, und die beiden Werte platzieren die Anwendung in einem der vier Quadranten: hohe funktionale + hohe technische Eignung = **Investieren**, hohe funktionale + niedrige technische Eignung = **Migrieren**, niedrige funktionale + hohe technische Eignung = **Tolerieren**, beide niedrig = **Eliminieren**. Eine Anwendung, der eine der beiden Bewertungen fehlt, erhält keinen TIME-Wert, sodass die Lücken sichtbar bleiben.

Es ist dasselbe TIME-Beispiel, das Sie im Panel **Formelreferenz** des Berechnungseditors finden; Sie können es also auch von dort kopieren. Es liest nur Felder, die Application bereits hat — **Sie müssen also kein Feld hinzufügen**, und Sie sollten es auch nicht (siehe *Duplizieren Sie keine integrierten Felder* unten). Weitere Formelsyntax: [Admin → Berechnungen](../admin/calculations.md).

Schalten Sie die Berechnung nach dem Speichern auf **Aktiv** und klicken Sie in ihrer Zeile auf **Alle neu berechnen**, damit jede bestehende Anwendung ihren Wert erhält. Die Schritt-für-Schritt-Anleitung finden Sie unter [Ihre erste Analyse → Schritt 3](your-first-analysis.md).

!!! warning "Nicht tun"
    Ein berechnetes TIME ist eine **Ausgangshypothese**, kein Urteil. Überprüfen Sie jedes Ergebnis mit dem Application Owner, bevor Sie ihm vertrauen.

Das hybride Muster, das sich in der Praxis bewährt: Lassen Sie die Berechnung aktiv, während Sie das Inventar aufbauen und Eignungsbewertungen sammeln; überprüfen Sie die Ergebnisse im Validierungs-Workshop; und wenn Entscheidungen von der Formel abweichen müssen, schalten Sie die Berechnung aus (Schalter **Aktiv**), damit das Feld wieder bearbeitbar wird und die manuellen Entscheidungen bestehen bleiben.

## Alternative: Verwenden Sie stattdessen eine Tag-Gruppe

Wenn der Wert informativ statt abfragbar ist, ist eine **Tag-Gruppe** (Admin → Metamodell → Tags) leichter als ein benutzerdefiniertes Feld — keine Metamodelländerung, keine Migration, einfacher weiterzuentwickeln. Verwenden Sie eine Tag-Gruppe, wenn:

- Der Wert beschreibend ist („Customer-facing", „Internal-only", „Acquired in 2024").
- Sie häufig neue Optionen hinzufügen können.
- Sie sie nicht in einem Filter-Dropdown benötigen, aber ein „Search-as-you-type"-Tag-Chip in Ordnung ist.

Verwenden Sie ein benutzerdefiniertes Feld, wenn:

- Sie einen Bericht danach gruppieren oder einfärben möchten (zum Beispiel das Anwendungsportfolio).
- Sie ihn in die Datenqualität gewichten möchten.
- Es ein kontrolliertes Vokabular ist, das sich nicht oft ändert.

## Zu vermeidende Anti-Patterns

Dies sind die häufigsten Metamodell-Fehler in ersten Rollouts:

!!! warning "Benennen Sie integrierte Kartentypen nicht um"
    `Application` in `Solution` umzubenennen sieht ordentlich aus, bricht aber die konzeptionelle Zuordnung, die die Geschäftsfähigkeiten-Karte, der Bericht Anwendungsportfolio und die Kataloge alle voraussetzen. Wenn Ihre Organisation sie „Solutions" nennt, setzen Sie die **Label**-Übersetzung — der zugrunde liegende `key` bleibt `Application`.

!!! warning "Fügen Sie nicht am ersten Tag 30 benutzerdefinierte Felder hinzu"
    Jedes benutzerdefinierte Feld fügt der Datenerfassung Reibung hinzu und verwässert den Datenqualitäts-Score. Fügen Sie ein Feld hinzu, verwenden Sie es einen Monat lang, fügen Sie dann das nächste hinzu.

!!! warning "Duplizieren Sie keine integrierten Felder"
    Bevor Sie `timeDisposition`, `funcFit`, `techFit` oder `appCriticality` hinzufügen, prüfen Sie die bestehende Feldliste — wahrscheinlich existiert bereits ein gleichwertiges integriertes Feld (`timeModel`, `functionalSuitability`, `technicalSuitability`, `businessCriticality`). Duplikate teilen Ihre Daten auf und brechen Berichte.

!!! warning "Machen Sie neue Felder nicht am ersten Tag `required`"
    Solange ein Pflichtfeld leer ist, ist der Datenqualitäts-Score der Karte auf 0 fixiert, und ein Warnbanner listet auf, was fehlt — auf jeder bestehenden Karte gleichzeitig. Machen Sie ein Feld erst dann zum Pflichtfeld, **nachdem** Sie es für 80 %+ der Population ausgefüllt haben.

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
