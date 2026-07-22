# Übergangsplanung

Die Übergangsplanung ist ein manuelles Planungswerkzeug in **EA Delivery**, mit dem Sie Änderungen an Ihrer Landschaft modellieren — eine Anwendung für eine bestimmte Organisation durch eine andere ersetzen, ein Altsystem stilllegen oder eine neue Plattform einführen — und sie als **ein einziges Vorher-Nachher-Diagramm** kommunizieren. Sie bietet ein ähnliches Ergebnis wie der TurboLens Architect, jedoch ganz ohne KI: Sie behalten die volle Kontrolle über jede vorgeschlagene Änderung.

Das Ergebnis ist eine Layered Dependency View, die den aktuellen und den geplanten Zustand in einem Bild zeigt, mit Änderungsindikatoren:

- **Rotes Kreuz** — eine zur Entfernung markierte Karte oder Beziehung
- **Grünes Plus** — eine neu hinzugefügte Karte oder Beziehung
- **Blaue Tauschpfeile** — ein Ersatz: die Nachfolgerkarte und die von ihr geerbten Verbindungen

!!! info "Verfügbarkeit"
    Das Erstellen, Bearbeiten und Übernehmen von Übergangsplänen wird durch eine installierte, lizenzierte Erweiterung freigeschaltet (siehe **Admin → Erweiterungen**). Das Ansehen vorhandener Pläne ist immer möglich — wird die Erweiterung entfernt oder läuft die Lizenz ab, bleiben die Pläne lesbar und nichts wird gelöscht.

## Einen Plan erstellen

Öffnen Sie **EA Delivery** und wählen Sie **Hinzufügen → Neuer Übergangsplan** an einer Initiative (oder erstellen Sie einen unverknüpften Plan und verknüpfen Sie ihn später). Ein Plan entsteht in vier Schritten:

1. **Geschäftsziele** *(optional)* — benennen Sie die Objective-Karten, die diese Änderung unterstützt. Sie erscheinen in der Strategie-Ebene des Diagramms, sodass jeder Stakeholder das *Warum* neben dem *Was* sieht, und sie füllen die Initiative-Verknüpfungen beim Übernehmen vor.
2. **Scope & Baseline** — wählen Sie eine oder mehrere Scope-Karten (eine Organisation, eine Business Capability, einzelne Anwendungen, …) und eine Abhängigkeitstiefe (1–3). **Baseline erfassen** erstellt einen Schnappschuss der umgebenden Landschaft als Vorher-Bild. Der Schnappschuss hält das Diagramm stabil, auch wenn sich das Inventar ändert; mit **Baseline aktualisieren** erfassen Sie sie später neu — geplante Änderungen, deren Ziel verschwunden ist, werden markiert.
3. **Geplante Änderungen** — wenden Sie Änderungsoperationen aus der Toolbox an:
    - **Karte hinzufügen** — holen Sie eine vorhandene Karte ins Bild oder schlagen Sie eine ganz neue vor (Name + Typ).
    - **Karte entfernen** — markieren Sie eine Karte zur Stilllegung. Ihre Verbindungen werden rot.
    - **Karte ersetzen** — wählen Sie die zu ersetzende Karte und ihren Nachfolger (vorhanden oder neu vorgeschlagen). Der Nachfolger erbt die Beziehungen des Vorgängers, dargestellt als blaue Tauschkanten; einzelne geerbte Beziehungen trennen Sie mit **Beziehung entfernen**.
    - **Beziehung hinzufügen / entfernen** — ziehen Sie neue Verbindungen oder trennen Sie bestehende. Beziehungstypen werden gegen das Metamodell validiert.
4. **Live-Vorschau** — das zusammengeführte Vorher-Nachher-Diagramm aktualisiert sich während der Planung. Speichern Sie den Plan jederzeit; er erscheint im Bereich **Deliverables** der Initiative.

## Auswirkungen verstehen

Übergangsplanung ist mehr als ein Diagramm-Editor — während Sie planen, macht ein **Konsequenzen**-Panel die architektonische Auswirkung sichtbar. Dieselben Kennzahlen erscheinen in der teilbaren Vorschau und fließen in den übernommenen ADR ein:

- **Gap-Analyse** — eine TOGAF-artige Zusammenfassung Hinzugefügt / Entfernt / Geändert / Beibehalten.
- **Auswirkung / Blast-Radius** — beim Entfernen oder Ersetzen einer Karte wird angezeigt, was von ihr abhängt (»*N Anwendungen, M Schnittstellen hängen davon ab*«), abgeleitet aus der Impact-Analyse der Karte.
- **Lücken in der Capability-Abdeckung** — verliert eine Business Capability im Zielzustand *alle* unterstützenden Anwendungen, wird sie markiert.
- **Kosten- und Risiko-Differenzen** — die geschätzten Jahreskosten vorher → nachher (mit Differenz) sowie die Anzahl offener Risiken auf den betroffenen Karten. Vorgeschlagene Karten steuern ihre geschätzten Kosten bei, die beim Übernehmen auf die erstellte Karte geschrieben werden.

## Einen Plan übernehmen

Ein Planentwurf kann **übernommen** werden (erfordert die Berechtigung *Übergangspläne übernehmen*). Das Übernehmen:

- erstellt eine **Initiative**-Karte (mit dem gewählten Namen und Start-/Enddatum), verknüpft mit den unterstützten Zielen,
- erstellt die ausgewählten **vorgeschlagenen Karten** und **Beziehungen** und verknüpft jede neue Karte mit der Initiative,
- setzt ein **End-of-Life**-Datum (das Enddatum der Initiative) auf entfernte und ersetzte Karten, sodass Lifecycle-Berichte und Roadmaps den Plan widerspiegeln,
- erstellt optional einen **Entwurf eines Architecture Decision Record**, der jede Änderung dokumentiert — einschließlich getrennter Beziehungen, die nur dokumentiert und niemals gelöscht werden.

!!! note
    Das Übernehmen archiviert oder löscht niemals etwas. Entfernte Karten erhalten ein End-of-Life-Datum; die tatsächliche Stilllegung bleibt ein bewusster, menschlicher Schritt über die normalen Inventar-Workflows.

Nach der Übernahme wird der Plan schreibgeschützt und verweist auf die erstellte Initiative.

## Berechtigungen

| Berechtigung | Gewährt |
|--------------|---------|
| `transition_plans.view` | Übergangspläne ansehen |
| `transition_plans.manage` | Pläne erstellen, bearbeiten und löschen |
| `transition_plans.commit` | Einen Plan übernehmen (Initiative, Karten, Beziehungen, ADR-Entwurf erstellen, End-of-Life-Daten setzen) |

Mitglieder können Pläne standardmäßig ansehen, verwalten und übernehmen; Betrachter können sie nur ansehen.
