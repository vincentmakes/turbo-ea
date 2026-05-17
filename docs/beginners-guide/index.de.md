# Ihre ersten 30 Tage mit Turbo EA

Sie haben Turbo EA also installiert. Der Login-Bildschirm funktioniert, die Demodaten werden geladen, jeder Menüpunkt zeigt Ihnen etwas — und nun starren Sie auf ein leeres Inventar und fragen sich, wo Sie eigentlich anfangen sollen. Dieser Leitfaden ist für Sie.

Es handelt sich um eine sequenzierte, fundierte Anleitung für die **erste konkrete EA-Initiative**, die die meisten Organisationen mit Turbo EA durchführen: ein Anwendungsinventar in den Griff zu bekommen und es zu nutzen, um echte Portfolio-Fragen zu beantworten. Die fortgeschritteneren Module (Risk Register, Compliance, PPM, TurboLens AI) werden bewusst ausgeklammert — diese werden erst nützlich, wenn Ihr Inventar lebendig ist, vorher nicht.

## Für wen dieser Leitfaden gedacht ist

- **Enterprise Architects**, die eine neue EA-Praxis starten oder von Tabellenkalkulationen, Confluence oder einem anderen Werkzeug migrieren.
- **Solution Architects und Anwendungsverantwortliche**, die ohne viel Kontext gebeten werden, „das EA-Tool zu befüllen".
- **Admins**, die die Plattform für einen breiteren Rollout vorbereiten.

Sie benötigen die Rolle **admin** (oder mindestens `admin.metamodel` und `inventory.edit`), um jedem Schritt zu folgen. Read-Only-Rollen können trotzdem profitieren — sie können nur die Metamodelländerungen auf Seite 5 nicht vornehmen.

## Der Bogen Crawl → Walk → Run

Versuchen Sie nicht, das gesamte Unternehmen in der ersten Woche zu modellieren. Die Teams, die mit EA-Werkzeugen erfolgreich sind, folgen einem phasenweisen Pfad:

1. **Crawl** — Ein enger Geltungsbereich (eine Geschäftsdomäne, ein Land, eine Plattform). Ein Kartentyp (Anwendungen). Fünf Felder pro Karte. Erreichen Sie eine „gut genug"-Datenqualität bei 50–200 Karten.
2. **Walk** — Fügen Sie Business Capabilities aus dem mitgelieferten Katalog hinzu. Ordnen Sie Anwendungen den Capabilities zu. Führen Sie Ihre erste Portfolio-Analyse durch. Präsentieren Sie sie einem Stakeholder.
3. **Run** — Erweitern Sie auf Prozesse, Schnittstellen, Datenobjekte. Fügen Sie weitere benutzerdefinierte Felder hinzu. Öffnen Sie die fortgeschritteneren Module.

Dieser Leitfaden deckt **Crawl** und den Beginn von **Walk** ab. Am Ende werden Sie ein funktionierendes Anwendungsportfolio mit einer TIME-Disposition (**T**olerieren / **I**nvestieren / **M**igrieren / **E**liminieren) und einen Portfolio-Bericht haben, den Sie einem CIO vorlegen können.

## Was in diesem Leitfaden enthalten ist

| # | Seite | Was Sie tun werden |
|---|------|---------------|
| 1 | [Planen Sie Ihren Rollout](plan-your-rollout.md) | Initiative abgrenzen, Stakeholder auswählen, realistisches Datenqualitätsziel setzen |
| 2 | [Beginnen Sie mit Ihrem Anwendungsinventar](start-with-applications.md) | Anwendungen via Import, ServiceNow oder manueller Eingabe befüllen |
| 3 | [Referenzkataloge nutzen](leverage-reference-catalogues.md) | Sparen Sie Monate manueller Modellierung durch den Import von Capabilities und Prozessen |
| 4 | [Metamodell anpassen — behutsam](customise-the-metamodel.md) | Ein benutzerdefiniertes Feld (TIME) auf die richtige Art hinzufügen |
| 5 | [Ihre erste Analyse: Anwendungsharmonisierung](your-first-analysis.md) | Anwendungen Capabilities zuordnen, Portfolio-Bericht und Capability Heatmap ausführen |

!!! tip "Bewährte Praxis"
    Lesen Sie alle fünf Seiten der Reihe nach, bevor Sie Turbo EA öffnen. Der Plan in Ihrem Kopf ist wertvoller als die ersten 50 Karten im Inventar.

## Voraussetzungen

- Eine laufende Turbo-EA-Instanz (siehe [Installation & Setup](../getting-started/setup.md)).
- Ein Admin-Konto (der erste Benutzer, der sich registriert, wird automatisch zum Admin).
- **Optional, aber für Erstanwender empfohlen:** Starten Sie den Stack einmal mit `SEED_DEMO=true`, um zu sehen, wie ein gefülltes Inventar aussieht (das fiktive Unternehmen NexaTech Industries). Sie können dann mit `RESET_DB=true` zurücksetzen und mit Ihren echten Daten neu beginnen.
- Eine grobe Vorstellung von der **Geschäftsdomäne**, die Sie zuerst modellieren möchten. „Die gesamte IT" ist keine Domäne.

## Was Sie vorerst überspringen

Dies sind leistungsstarke Module, aber sie setzen voraus, dass Sie bereits ein gefülltes Inventar haben. Öffnen Sie sie noch nicht:

- **Risk Register** und **Compliance-Scanning** — nützlich, sobald Sie Anwendungen und Capabilities haben, an die Sie Risiken anhängen können.
- **PPM** (Project Portfolio Management) — nützlich, sobald Sie eine Projektpipeline haben, die das Tracking wert ist.
- **TurboLens AI** (Vendor-Analyse, Duplikaterkennung, Architect-Assistent) — nützlich, sobald Sie genug Karten haben, damit die KI Muster finden kann.

Auf der [letzten Seite](your-first-analysis.md) dieses Leitfadens finden Sie für jedes davon einen kurzen Hinweis „Wie geht es weiter".

Bereit? Weiter zu [Planen Sie Ihren Rollout](plan-your-rollout.md).
