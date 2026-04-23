# Risikoregister

Das **Risikoregister** erfasst Architektur-Risiken über ihren gesamten Lebenszyklus — von der Identifikation über Minderung, Rest-Bewertung und Überwachung bis zum Abschluss (oder zur formalen Akzeptanz). Es lebt als Tab innerhalb von **EA Delivery → Risiken**, neben Initiativen, EA-Prinzipien und Architekturentscheidungen.

## TOGAF-Ausrichtung

Das Register setzt den Architektur-Risikomanagement-Prozess aus **TOGAF ADM Phase G — Implementation Governance** (TOGAF 10 §27) um:

| TOGAF-Schritt | Was Sie erfassen |
|---------------|------------------|
| Risiko-Klassifizierung | `Kategorie` (security, compliance, operational, technology, financial, reputational, strategic) |
| Risiko-Identifikation | `Titel`, `Beschreibung`, `Quelle` (manuell oder aus einem TurboLens-Befund übernommen) |
| Initial-Bewertung | `Initial-Wahrscheinlichkeit × Initial-Auswirkung → Initial-Level` (automatisch abgeleitet) |
| Minderung | `Minderungsplan`, `Eigentümer`, `Ziel-Erledigungsdatum` |
| Rest-Bewertung | `Rest-Wahrscheinlichkeit × Rest-Auswirkung → Rest-Level` (editierbar, sobald Minderung geplant ist) |
| Überwachung / Akzeptanz | `Status`-Workflow: identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed (mit einem Seitenzweig `accepted`, der eine explizite Begründung verlangt) |

## Ein Risiko anlegen

Drei Pfade münden in denselben Dialog **Risiko anlegen** — jede Variante füllt unterschiedliche Felder vor, sodass Sie bearbeiten und absenden können:

1. **Manuell** — Tab Risiken → **+ Neues Risiko**. Leeres Formular.
2. **Aus einem CVE-Befund** — TurboLens → Sicherheit & Compliance → CVE-Schublade → **Risiko anlegen**. Füllt Titel (CVE-ID auf Karte), Beschreibung (NVD-Text + Geschäftsauswirkung + CVSS), Kategorie `security`, Wahrscheinlichkeit/Auswirkung aus dem CVE, Minderung aus der Behebungsempfehlung des Befunds vor und verknüpft die betroffene Karte.
3. **Aus einem Compliance-Befund** — TurboLens → Sicherheit & Compliance → Compliance-Tab → **Risiko anlegen** auf einem nicht konformen Befund. Füllt Kategorie `compliance`, Wahrscheinlichkeit/Auswirkung aus Schweregrad + Status der Regulierung, Beschreibung aus Anforderung + Lücke vor.

Alle drei Varianten enthalten die Felder **Eigentümer**, **Kategorie** und **Ziel-Erledigungsdatum**, sodass Verantwortlichkeit bereits beim Anlegen zugewiesen werden kann — ohne das Risiko erneut zu öffnen.

Die Überführung ist **idempotent** — sobald ein Befund überführt wurde, ändert sich seine Schaltfläche zu **Risiko R-000123 öffnen** und navigiert direkt zur Risikodetailseite.

## Eigentümerschaft → Todo + Benachrichtigung

Einem Risiko einen **Eigentümer** zuzuweisen (sei es beim Anlegen oder später) bewirkt automatisch:

- Ein **System-Todo** auf der Todos-Seite des Eigentümers wird erstellt. Die Beschreibung lautet `[Risk R-000123] <Titel>`, das Fälligkeitsdatum spiegelt das Ziel-Erledigungsdatum des Risikos, und der Link springt zurück zur Risikodetailseite. Das Todo wird automatisch als **erledigt** markiert, sobald das Risiko `mitigated` / `monitoring` / `accepted` / `closed` erreicht.
- Eine **Glocken-Benachrichtigung** (`risk_assigned`) wird ausgelöst — sichtbar im Glocken-Dropdown und auf der Benachrichtigungsseite, mit optionalem E-Mail-Versand, sofern der Benutzer dies aktiviert hat. Auch Selbstzuweisung löst die Glocke aus, damit die Spur im Team- und im persönlichen Workflow konsistent ist.

Eigentümer entfernen oder neu zuweisen hält das Todo synchron — das alte wird entfernt/neu zugewiesen.

## Risiken mit Karten verknüpfen

Risiken stehen in einer **M:N-Beziehung** mit Karten. Ein Risiko kann mehrere Anwendungen oder IT-Komponenten betreffen, und eine Karte kann mehrere Risiken verknüpft haben:

- Von der Risikodetailseite aus: Panel **Betroffene Karten** → suchen und hinzufügen. Klicken Sie auf ein `×`, um die Verknüpfung zu lösen.
- Von jeder Kartendetailseite aus: ein neuer **Risiken**-Tab listet jedes mit dieser Karte verknüpfte Risiko, mit einem Ein-Klick-Weg zurück ins Register.

## Risikomatrix

Sowohl die Sicherheits-Übersicht von TurboLens als auch die Risikoregister-Seite rendern eine 4×4-Heatmap Wahrscheinlichkeit × Auswirkung. Zellen sind **klickbar** — ein Klick filtert die Liste darunter auf diesen Bucket, ein weiterer Klick (oder das × des Chips) löscht den Filter. Im Risikoregister können Sie die Matrix zwischen **Initial**- und **Rest**-Ansicht umschalten, damit sich der Fortschritt der Minderung visuell zeigt.

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
