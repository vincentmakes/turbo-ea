# Risikoregister

Das **Risikoregister** erfasst Architektur-Risiken über ihren gesamten Lebenszyklus — von der Identifikation über Minderung, Rest-Bewertung und Überwachung bis zum Abschluss (oder zur formalen Akzeptanz). Es lebt als Reiter **Risk** im [GRC-Modul](grc.md) unter `/grc?tab=risk`.

## TOGAF-Ausrichtung

Das Register setzt den Architektur-Risikomanagement-Prozess aus **TOGAF ADM Phase G — Implementation Governance** (TOGAF 10 §27) um:

| TOGAF-Schritt | Was Sie erfassen |
|---------------|------------------|
| Risiko-Klassifizierung | `Kategorie` (security, compliance, operational, technology, financial, reputational, strategic) |
| Risiko-Identifikation | `Titel`, `Beschreibung`, `Quelle` (manuell oder aus einem TurboLens-Befund übernommen) |
| Initial-Bewertung | `Initial-Wahrscheinlichkeit × Initial-Auswirkung → Initial-Level` (automatisch abgeleitet) |
| Minderung | Eine oder mehrere **Minderungsmaßnahmen** — verantwortete Arbeitsaufgaben, einmalig oder wiederkehrend (siehe [Minderungsmaßnahmen](#mitigation-tasks) unten). Das Risiko trägt außerdem einen `Eigentümer` und ein `Ziel-Erledigungsdatum`. |
| Rest-Bewertung | `Rest-Wahrscheinlichkeit × Rest-Auswirkung → Rest-Level` (editierbar, sobald Minderung geplant ist). Bleibt eine **manuelle** Bewertung — Aufgabenabschluss passt sie nicht automatisch an. Die Detailseite zeigt neben dem Rest-Block eine Zusammenfassung «X/Y offen · Z überfällig» als Kontext für die menschliche Beurteilung (an ISO 31000 ausgerichtet). |
| Überwachung / Akzeptanz | `Status`-Workflow: identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed (mit einem Seitenzweig `accepted`, der eine explizite Begründung verlangt) |

## Ein Risiko anlegen

Drei Pfade münden in denselben Dialog **Risiko anlegen** — jede Variante füllt unterschiedliche Felder vor, sodass Sie bearbeiten und absenden können:

Alle drei Varianten enthalten die Felder **Eigentümer**, **Kategorie** und **Ziel-Erledigungsdatum**, sodass Verantwortlichkeit bereits beim Anlegen zugewiesen werden kann — ohne das Risiko erneut zu öffnen.

Die Überführung ist **idempotent** — sobald ein Befund überführt wurde, ändert sich seine Schaltfläche zu **Risiko R-000123 öffnen** und navigiert direkt zur Risikodetailseite.

## Eigentümerschaft → Todo + Benachrichtigung

Einem Risiko einen **Eigentümer** zuzuweisen (sei es beim Anlegen oder später) bewirkt automatisch:

- Ein **System-Todo** auf der Todos-Seite des Eigentümers wird erstellt. Die Beschreibung lautet `[Risk R-000123] <Titel>`, das Fälligkeitsdatum spiegelt das Ziel-Erledigungsdatum des Risikos, und der Link springt zurück zur Risikodetailseite. Das Todo wird automatisch als **erledigt** markiert, sobald das Risiko `mitigated` / `monitoring` / `accepted` / `closed` erreicht.
- Eine **Glocken-Benachrichtigung** (`risk_assigned`) wird ausgelöst — sichtbar im Glocken-Dropdown und auf der Benachrichtigungsseite, mit optionalem E-Mail-Versand, sofern der Benutzer dies aktiviert hat. Auch Selbstzuweisung löst die Glocke aus, damit die Spur im Team- und im persönlichen Workflow konsistent ist.

Eigentümer entfernen oder neu zuweisen hält das Todo synchron — das alte wird entfernt/neu zugewiesen.

Dieselbe Logik greift unabhängig für **jede Minderungsmaßnahme** des Risikos, damit ein Mitwirkender nur die Arbeit sieht, die ihm zugewiesen ist — siehe [Minderungsmaßnahmen](#mitigation-tasks) unten.

## Risiken mit Karten verknüpfen

Risiken stehen in einer **M:N-Beziehung** mit Karten. Ein Risiko kann mehrere Anwendungen oder IT-Komponenten betreffen, und eine Karte kann mehrere Risiken verknüpft haben:

- Von der Risikodetailseite aus: Panel **Betroffene Karten** → Karte auswählen und hinzufügen. Klicken Sie auf ein `×`, um die Verknüpfung zu lösen. Die Auswahl zeigt sofort eine durchsuchbare Liste (kein Tippen nötig), lädt beim Scrollen weitere Karten nach und blendet bereits verknüpfte Karten aus.
- Von jeder Kartendetailseite aus: ein neuer **Risiken**-Tab listet jedes mit dieser Karte verknüpfte Risiko, mit einem Ein-Klick-Weg zurück ins Register.

Verknüpfte Karten werden **nach Kartentyp gruppiert**, innerhalb jeder Gruppe alphabetisch sortiert und mit der Farbe des jeweiligen Kartentyps eingefärbt. So bleibt auch ein Risiko mit einem Dutzend Karten über mehrere Typen hinweg auf einen Blick lesbar. Dieselbe Sortierung und Farbgebung gilt für die Spalte **Karten** im Register-Grid, wo jede Karte als Chip in ihrer Typfarbe erscheint — der Tooltip der Zelle listet die vollständige Liste unter Typüberschriften auf.

## Minderungsmaßnahmen {: #mitigation-tasks }

Minderung wird als **verantwortete Arbeitsaufgaben** erfasst, nicht als Freitext. Auf der Risikodetailseite ersetzt das Panel **Minderungsmaßnahmen** das frühere einzelne «Minderungsplan»-Feld — jede Zeile ist eine reale Aufgabe mit eigenem Eigentümer, Fälligkeitsdatum, Verlauf und (optional) einer Wiederholungsregel.

### Einmalig vs. wiederkehrend

Eine Minderungsmaßnahme ist standardmäßig **einmalig** — passend für «MFA ausrollen», «Aktualisierte SCC unterzeichnen» oder jede projektartige Arbeit. Aktiviert man **Wiederholt sich** im Aufgabendialog, entsteht eine **wiederkehrende Kontrollprüfung**: z. B. «Dokumentation grenzüberschreitender Übermittlungen alle 12 Monate neu attestieren», «OT-Notfallübung alle 3 Monate durchführen», «Jenkins-Anmeldedaten wöchentlich prüfen».

Wiederkehrende Aufgaben sammeln einen **Zyklus** (`occurrence`) pro Periode. Der nächste Zyklus wird automatisch beim Abschluss des aktuellen angelegt — kalenderkorrekt, sodass eine monatliche Aufgabe mit Fälligkeit 31. Januar zum 28. Februar rollt, nicht zum 3. März.

### Das Vorlaufzeit-Fenster

Der Sinn einer wiederkehrenden Kontrollprüfung ist, dass der Zuständige **kurz vor dem Fälligkeitsdatum** erinnert wird — nicht in dem Moment, in dem der vorherige Zyklus geschlossen wurde. Jede wiederkehrende Aufgabe trägt daher eine **Vorlaufzeit** (Tage) — wie viele Tage vor `due_date` der Zyklus aktiv wird und auf der `/todos`-Liste der zuständigen Person landet.

Jeder Zyklus durchläuft drei sichtbare Zustände:

| Status | Bedeutung | Auf /todos sichtbar? |
|--------|-----------|----------------------|
| **Geplant** | Der nächste Zyklus existiert für den Audit-Verlauf («Nächste Prüfung: fällig am 15.11.2026»), ist aber inaktiv. Heute liegt noch außerhalb des Vorlauffensters. | Nein |
| **Offen** | Das Vorlauffenster hat sich geöffnet. Ein System-Todo `[Risk R-000123] <Aufgabentitel>` liegt auf der Liste der zuständigen Person; eine `task_assigned`-Benachrichtigung wurde ausgelöst. | Ja (Tab «Offen») |
| **Erledigt** / **Übersprungen** | Der Zyklus wurde geschlossen. Das Todo wird auf `done` umgeschaltet und bleibt im Tab **Erledigt** der zuständigen Person als Historieneintrag erhalten. | Ja (Tab «Erledigt») |

Der Aufgabendialog schlägt pro Wiederholungseinheit eine sinnvolle Vorlaufzeit vor (1 Tag täglich, 2 Tage wöchentlich, 7 Tage monatlich, 14 Tage jährlich — gedeckelt auf die Hälfte des Zyklus, damit das Fenster nie den vorherigen Zyklus überlappt). Der Vorschlag aktualisiert sich automatisch, solange Sie das Feld nicht selbst bearbeiten.

Einmal täglich um **03:00 UTC** scannt ein Hintergrundprozess alle geplanten Zyklen und befördert jene, deren Vorlauffenster sich geöffnet hat. Müssen Sie eine Prüfung früher starten? Klicken Sie auf **Jetzt aktivieren** (Blitz-Symbol in der Aufgabenzeile), um einen geplanten Zyklus sofort auf offen umzuschalten — gleiche Todo- und Benachrichtigungslogik, nur ohne Wartezeit.

### Audit-Verlauf pro Zyklus

Klicken Sie auf den Aufklappen-Pfeil in der Aufgabenzeile, um den vollständigen Zyklus-Verlauf zu sehen. Jeder Zyklus erfasst:

- Das **Ziel-Fälligkeitsdatum** zum Zeitpunkt der Planung.
- Wer beim Öffnen des Zyklus **zugewiesen** war (`assigned_owner_id`), damit historische Prüfungen ihren ursprünglichen Eigentümer behalten, auch wenn die Rolle später wechselt.
- Für abgeschlossene Zyklen: wer den Zyklus **abgeschlossen** hat (`completed_by`), den Zeitstempel, den **Eigentümer-zur-Abschlusszeit**-Schnappschuss (kann sich vom zugewiesenen Eigentümer unterscheiden, falls mitten im Zyklus rotiert wurde) und freitextliche Abschlussnotizen.
- Für aktivierte Zyklen: den **Aktivierungszeitstempel** (damit Audit verifizieren kann, dass die tägliche Beförderung am richtigen Tag lief).

Das übersteht Jahre an Eigentümerrotation sauber — die Audit-Antwort auf «Wer hat die Prüfung im Januar 2024 unterzeichnet?» liegt nur einen Klick neben der Aufgabe und geht nicht durch Rollenänderungen verloren.

### Berechtigungen & Zuständigkeit

- **Aufgaben anlegen / bearbeiten / löschen** — benötigt `risks.manage` (standardmäßig admin / bpm_admin / member).
- **Offenen Zyklus abschließen** — `risks.manage` **oder** die aktuell zugewiesene Person. So kann eine Viewer-Person, die einer Kontrollprüfung zugewiesen ist, den eigenen Zyklus ohne Eskalation schließen.
- **Zyklus überspringen / Jetzt aktivieren** — benötigt immer `risks.manage`. Überspringen rollt die Wiederholung weiter, ohne den Abschluss zu behaupten; Aktivieren zieht einen geplanten Zyklus vor und ist eine Planungsaktion.

### Übernahme aus einem TurboLens Compliance-Befund

Wenn Sie auf einem nicht konformen Befund auf **Risiko anlegen** klicken (siehe [TurboLens](turbolens.md#promote-a-finding-to-the-risk-register)), erhält das neue Risiko zusätzlich eine **einmalige Minderungsmaßnahme**, vorbefüllt aus dem Sanierungstext des Befunds — die Lücken-Analyse wird so direkt zu verantworteter, umsetzbarer Arbeit.

### Export {: #export }

Die Schaltfläche **Exportieren** auf der Risikoregister-Seite schreibt eine zweiteilige `.xlsx`: Blatt 1 enthält das gefilterte Risiko-Grid, Blatt 2 eine Zeile pro Zyklus über alle Aufgaben aller Risiken im gleichen Filter-Set, inklusive Vorlaufzeit und Aktivierungszeitstempel. Nutzen Sie sie für Audit-Pakete oder zur Weitergabe an Stakeholder ohne Turbo-EA-Login. Jede Aufgabenzeile im Detail-Panel verfügt zudem über eine eigene Schaltfläche **Verlauf exportieren** für eine aufgabenbezogene Arbeitsmappe.

### Import {: #import }

Die Schaltfläche **Import** neben „Export“ lädt Risiken in großer Menge aus einer `.xlsx`-Datei. Klicken Sie auf **Vorlage herunterladen**, um eine Startdatei mit den richtigen Spaltenüberschriften zu erhalten, tragen Sie pro Zeile ein Risiko ein und laden Sie die Datei hoch. Eine Zeile, deren `reference` zu einem vorhandenen Risiko passt, wird **übersprungen** (der Import aktualisiert niemals bestehende Risiken), sodass der erneute Import eines zuvor exportierten Registers idempotent ist; jede andere Zeile erstellt ein **völlig neues** Risiko mit einer frisch generierten Referenz `R-NNNNNN`. Die Vorschau zeigt vor der Bestätigung an, wie viele Zeilen übersprungen werden.

Erkannte Spalten: `title` (erforderlich), `description`, `category`, `initial_probability`, `initial_impact`, `residual_probability`, `residual_impact`, `status`, `owner_email`, `target_resolution_date` (`YYYY-MM-DD`) und `cards` (durch Semikolon getrennte Kartennamen). Eigentümer werden per E-Mail und Karten anhand des exakten Namens **nach bestem Bemühen** zugeordnet — alles, was nicht zugeordnet werden kann, wird mit einer nicht blockierenden Warnung übersprungen, und das Risiko wird trotzdem importiert. Bevor etwas geschrieben wird, erhalten Sie eine Vorschau, die zeigt, wie viele Zeilen erstellt werden, welche Fehler enthalten und welche Warnungen es gibt; nichts wird gespeichert, bevor Sie bestätigen. Erfordert die Berechtigung `risks.manage`.

## Risikomatrix

Sowohl die Sicherheits-Übersicht von TurboLens als auch die Risikoregister-Seite rendern eine 4×4-Heatmap Wahrscheinlichkeit × Auswirkung. Zellen sind **klickbar** — ein Klick filtert die Liste darunter auf diesen Bucket, ein weiterer Klick (oder das × des Chips) löscht den Filter. Im Risikoregister können Sie die Matrix zwischen **Initial**- und **Rest**-Ansicht umschalten, damit sich der Fortschritt der Minderung visuell zeigt.

## Register-Grid

Das Register ist ein AG-Grid, das den Standards der [Inventar](inventory.md)-Seite folgt: sortierbare, filterbare und in der Breite anpassbare Spalten mit persistierten Nutzereinstellungen (sichtbare Spalten, Sortierung, Sidebar-Zustand). Über die Symbolleiste öffnest du mit **+ Neues Risiko** den manuellen Anlage-Dialog. Die Symbolleisten-Schaltfläche **Exportieren** schreibt eine zweiteilige `.xlsx` mit dem gefilterten Risiko-Grid auf Blatt 1 und einer Zeile pro Aufgabenzyklus auf Blatt 2 — siehe [Minderungsmaßnahmen → Export](#export) für die Spaltenstruktur.

### Nach betroffenen Karten filtern

Die linke Filterleiste enthält einen Abschnitt **Betroffene Karten**, der die Landschaftsfragen beantwortet, die der Spaltenfilter nicht abdeckt:

- **Karten** — wählen Sie eine oder mehrere konkrete Karten, um jedes Risiko zu sehen, das *irgendeine* davon betrifft («alle Risiken zu den Anwendungen A, B und C anzeigen»). Die Liste bietet jede Karte an, die mit mindestens einem Risiko verknüpft ist, durchsuchbar nach Name.
- **Kartentyp** — kreuzen Sie einen oder mehrere Kartentypen an, um jedes Risiko zu sehen, das *irgendeine* Karte dieser Typen berührt («alle Risiken anzeigen, die eine Anwendung betreffen»), ohne einzelne Karten zu benennen.

Jede Liste erfüllt **eine beliebige** ihrer eigenen Auswahlen; beide Listen werden mit **und** kombiniert. `Application` anzukreuzen und die Karte *Payments Gateway* auszuwählen liefert daher Risiken, die Payments Gateway betreffen **und** mindestens eine Anwendung berühren.

Wie jeder andere Filter der Leiste grenzen sie die gesamte Seite ein — die KPI-Kacheln, die 4×4-Matrix, das Grid und beide Blätter des `.xlsx`-Exports folgen der aktiven Auswahl.

## Risiko ↔ Befund-Propagation

Wenn ein Risiko aus einem TurboLens-Befund [überführt](turbolens.md#promote-a-finding-to-the-risk-register) wurde, fließen Statusänderungen **in beide Richtungen**:

- Der Befund trägt ab dem Moment der Überführung einen Rückverweis **Risiko R-000123 öffnen** (die Aktion ist idempotent — ein erneuter Klick navigiert zum bestehenden Risiko statt ein Duplikat anzulegen).
- Erreicht das Risiko `mitigated` / `monitoring` / `closed` / `accepted` (oder wird gelöscht), transitioniert die Back-Propagation-Engine automatisch jeden verknüpften Compliance-Befund passend (`mitigated` / `verified` / `accepted` / `in_review`). Die im Risiko erfasste Akzeptanzbegründung wird in die Prüfnotiz des Befunds gespiegelt, damit der Audit-Pfad konsistent bleibt.

So bleiben das Risikoregister (Governance-Sicht) und das Compliance-Grid (operative Sicht) ohne manuelle Pflege aufeinander abgestimmt.

## Statusworkflow

Die Detailseite zeigt immer eine einzige primäre Schaltfläche **Nächster Schritt** sowie eine kleine Zeile mit Seitenaktionen, damit der sequenzielle Pfad klar ist, Governance-Ausstiege aber einen Klick entfernt bleiben:

| Aktueller Status | Nächster Schritt (primär) | Seitenaktionen |
|---|---|---|
| identified | Analyse starten | Risiko akzeptieren |
| analysed | Minderung planen | Risiko akzeptieren |
| mitigation_planned | Minderung starten | Risiko akzeptieren |
| in_progress | Als gemindert markieren | Risiko akzeptieren |
| mitigated | Überwachung starten | Minderung fortsetzen · Ohne Überwachung schliessen |
| monitoring | Schliessen | Minderung fortsetzen · Risiko akzeptieren |
| accepted | — | Wiedereröffnen · Schliessen |
| closed | — | Wiedereröffnen |

Vollständiger Übergangsgraph (serverseitig erzwungen):

```
identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed
       │           │             │                │            ▲           ▲
       └───────────┴─────────────┴────────────────┴──── accepted (Begründung erforderlich)
                                                              │
                              reopen → in_progress ◄──────────┘
```

- **Akzeptieren** eines Risikos erfordert eine Akzeptanz-Begründung. Benutzer, Zeitstempel und Begründung werden auf dem Datensatz erfasst.
- **Wiedereröffnen** eines `accepted`- / `closed`-Risikos führt zurück zu `in_progress`. Bei `mitigated` ist zudem ein manuelles «Minderung fortsetzen» verfügbar, ohne dass ein vollständiges Wiedereröffnen nötig ist.

## Berechtigungen

| Berechtigung | Wer erhält sie standardmässig |
|--------------|-------------------------------|
| `risks.view` | admin, bpm_admin, member, viewer |
| `risks.manage` | admin, bpm_admin, member |

Viewer sehen das Register und Risiken auf Karten, können aber nicht anlegen, bearbeiten oder löschen.
