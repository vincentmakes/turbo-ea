# Metamodell anpassen — behutsam

Das Metamodell von Turbo EA ist vollständig **admin-konfigurierbar** — jeder Kartentyp, jedes Feld, jeder Subtyp, jede Beziehung und jede Stakeholder-Rolle ist Daten, kein Code. Sie werden versucht sein, es neu zu gestalten. **Tun Sie es nicht.**

Die Teams, die erfolgreich sind, passen das Metamodell **nur dann an, wenn die Standardfelder ihre Frage nicht beantworten können**. Die Teams, die scheitern, verbringen ihren ersten Monat damit, `Application` in `Solution` umzubenennen, 30 benutzerdefinierte Felder hinzuzufügen — und kommen nie zu einem funktionierenden Bericht.

## Der Zwei-Fragen-Test vor dem Hinzufügen eines Feldes

Bevor Sie ein einziges benutzerdefiniertes Feld hinzufügen, fragen Sie sich:

1. **Werde ich nach diesem Feld filtern, gruppieren oder berichten?** Wenn nein, gehört es in die Beschreibung oder ein Tag — nicht in ein Feld.
2. **Wird auf jeder Karte dieses Typs dieselbe Antwort benötigt?** Wenn nein, ist es eine Beziehung oder ein Anhang, kein Feld.

Wenn Sie nicht beide Fragen mit „ja" beantworten können, fügen Sie das Feld nicht hinzu.

## Durchgearbeitetes Beispiel: Eine TIME-Disposition hinzufügen

Für eine Anwendungsportfolio-Rationalisierung benötigen Sie eine einzige Entscheidung pro Anwendung: **T**olerieren / **I**nvestieren / **M**igrieren / **E**liminieren (das **TIME**-Framework, populär gemacht von Gartner). Das integrierte Metamodell liefert kein `timeDisposition`-Feld aus, daher ist dies einer der seltenen Fälle, in denen das Hinzufügen eines benutzerdefinierten Feldes die richtige Wahl ist.

Wir werden es als `single_select`-Feld auf dem Typ `Application` hinzufügen, mit vier farbcodierten Optionen, Gewicht 1, sodass es zur Datenqualität beiträgt.

### Schritt 1 — Öffnen Sie den Typ-Editor

1. Gehen Sie zu **Admin → Metamodell**.
2. Klicken Sie auf die Typ-Karte **Application**.
3. Die Typ-Schublade öffnet sich rechts. Wechseln Sie zum Tab **Fields**.

### Schritt 2 — Fügen Sie das Feld hinzu

1. Wählen Sie den Abschnitt, in dem das Feld landen soll (oder erstellen Sie einen neuen Abschnitt namens „Portfolio Decision").
2. Klicken Sie auf **+ Feld hinzufügen** in diesem Abschnitt.
3. Füllen Sie aus:
    - **Key**: `timeDisposition`  *(Lower-CamelCase, keine Leerzeichen, wird der Attribut-Schlüssel im JSON)*
    - **Label**: *Portfolio Disposition (TIME)*
    - **Type**: `single_select`
    - **Weight**: `1`  *(trägt zum Datenqualitäts-Score bei)*
    - **Required**: lassen Sie **aus** — Required würde die Genehmigung jeder bestehenden Karte blockieren.
4. Fügen Sie die vier Optionen hinzu:

    | Key | Label | Farbe |
    |-----|-------|--------|
    | `tolerate` | Tolerieren | grau / neutral |
    | `invest` | Investieren | grün |
    | `migrate` | Migrieren | bernstein |
    | `eliminate` | Eliminieren | rot |

5. **Fügen Sie Übersetzungen** für das Label und jede Option in jeder von Ihnen unterstützten Sprache hinzu — Seite 4 von [Admin → Metamodell](../admin/metamodel.md) behandelt den Übersetzungseditor. Wird dies übersprungen, sehen nicht-englische Benutzer „timeDisposition" wörtlich.
6. Speichern.

### Schritt 3 — Prüfen, dass es funktioniert

1. Öffnen Sie eine beliebige Application-Karte. Das neue Feld erscheint in seinem Abschnitt, leer.
2. Wählen Sie einen Wert, speichern Sie. Der Datenqualitätsring sollte um einige Prozent steigen.
3. Zurück im **Inventar** ist das Feld nun im Tab **Columns** und als Filter verfügbar — Sie können Anwendungen bereits nach TIME filtern.

Das war's. Ein Feld, zehn Minuten, sofort nützlich.

## Alternative: Verwenden Sie stattdessen eine Tag-Gruppe

Wenn der Wert informativ statt abfragbar ist, ist eine **Tag-Gruppe** (Admin → Tags) leichter als ein benutzerdefiniertes Feld — keine Metamodelländerung, keine Migration, einfacher weiterzuentwickeln. Verwenden Sie eine Tag-Gruppe, wenn:

- Der Wert beschreibend ist („Customer-facing", „Internal-only", „Acquired in 2024").
- Sie häufig neue Optionen hinzufügen können.
- Sie sie nicht in einem Filter-Dropdown benötigen, aber ein „Search-as-you-type"-Tag-Chip in Ordnung ist.

Verwenden Sie ein benutzerdefiniertes Feld, wenn:

- Sie den Wert auf den Portfolio-Bericht-Achsen benötigen (X, Y, Farbe).
- Sie ihn in die Datenqualität gewichten möchten.
- Es ein kontrolliertes Vokabular ist, das sich nicht oft ändert.

Die TIME-Disposition gehört in das Lager der benutzerdefinierten Felder, weil wir sie auf der nächsten Seite als Farbachse des Portfolio-Berichts verwenden werden.

## Zu vermeidende Anti-Patterns

Dies sind die häufigsten Metamodell-Fehler in ersten Rollouts:

!!! warning "Benennen Sie integrierte Kartentypen nicht um"
    `Application` in `Solution` umzubenennen sieht ordentlich aus, bricht aber die konzeptionelle Zuordnung, die Capability Heatmap, Portfolio-Bericht und die Kataloge alle voraussetzen. Wenn Ihre Organisation sie „Solutions" nennt, setzen Sie die **Label**-Übersetzung — der zugrunde liegende `key` bleibt `Application`.

!!! warning "Fügen Sie nicht am ersten Tag 30 benutzerdefinierte Felder hinzu"
    Jedes benutzerdefinierte Feld fügt der Datenerfassung Reibung hinzu und verwässert den Datenqualitäts-Score. Fügen Sie ein Feld hinzu, verwenden Sie es einen Monat lang, fügen Sie dann das nächste hinzu.

!!! warning "Machen Sie neue Felder nicht am ersten Tag `required`"
    `Required` blockiert die Genehmigung für jede bestehende Karte, die keinen Wert hat. Machen Sie ein Feld erst dann required, **nachdem** Sie es für 80 %+ der Population ausgefüllt haben.

!!! warning "Erstellen Sie keine benutzerdefinierten Kartentypen anstelle von benutzerdefinierten Feldern"
    „Mobile App" sollte ein Subtyp von `Application` sein, kein neuer Kartentyp. Neue Typen erhalten Capability-Mapping, Portfolio-Berichte oder Katalog-Importe nicht automatisch.

## Andere leichtgewichtige Erweiterungen, die Sie möglicherweise wünschen

Dies sind häufige Erweiterungen im zweiten Durchgang, aber **fügen Sie sie nicht hinzu, bis Sie sie tatsächlich brauchen**:

| Bedarf | Wo hinzufügen | Typ |
|------|-------------|------|
| Business-Value-Bewertung | Application | `single_select` (High/Medium/Low) — treibt die Y-Achse des Portfolio-Berichts an |
| Bewertung der technischen Eignung | Application | `single_select` — treibt die X-Achse an |
| Cloud-Bereitschaft | Application | `single_select` (Ready / Needs refactor / Stays on-prem) |
| Verlustrisikokategorie | Application, IT Component | `single_select` (Single point of failure usw.) |
| Kostenaufteilung | Application | `cost`-Felder für `costRunTotalAnnual`, `costChangeTotalAnnual` |

Jede besteht den Zwei-Fragen-Test für Portfolio-Analytik. Jede ist auch ein guter Kandidat für eine berechnete Formel anstelle manueller Eingabe — was auf der nächsten Seite behandelt wird.

Weiter: [Ihre erste Analyse: Anwendungsharmonisierung](your-first-analysis.md).
