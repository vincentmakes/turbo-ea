# TurboLens KI-Intelligenz

Das **TurboLens**-Modul bietet KI-gestützte Analysen Ihrer Enterprise-Architecture-Landschaft. Es verwendet Ihren konfigurierten KI-Anbieter, um Herstelleranalysen, Duplikaterkennung, Modernisierungsbewertungen und Architekturempfehlungen durchzuführen.

!!! note
    TurboLens erfordert einen kommerziellen KI-Anbieter (Anthropic Claude, OpenAI, DeepSeek oder Google Gemini), der in den [KI-Einstellungen](../admin/ai.md) konfiguriert wurde. Das Modul ist automatisch verfügbar, sobald KI konfiguriert ist.

!!! info "Danksagung"
    TurboLens basiert auf dem Open-Source-Projekt [ArchLens](https://github.com/vinod-ea/archlens) von [Vinod](https://github.com/vinod-ea), veröffentlicht unter der MIT-Lizenz. Die Analyselogik wurde von Node.js nach Python portiert und nativ in Turbo EA integriert.

## Dashboard

Das TurboLens-Dashboard bietet einen schnellen Überblick über Ihre Landschaftsanalyse.

| Kennzahl | Beschreibung |
|----------|--------------|
| **Karten gesamt** | Anzahl der aktiven Karten in Ihrem Portfolio |
| **Ø Qualität** | Durchschnittliche Datenqualitätsbewertung aller Karten |
| **Hersteller** | Anzahl der analysierten Technologiehersteller |
| **Duplikat-Cluster** | Anzahl der identifizierten Duplikatgruppen |
| **Modernisierungen** | Anzahl der gefundenen Modernisierungsmöglichkeiten |
| **Jährliche Kosten** | Gesamte jährliche Kosten aller Karten |

Das Dashboard zeigt außerdem:

- **Karten nach Typ** — Aufschlüsselung der Kartenanzahl pro Kartentyp
- **Datenqualitätsverteilung** — Karten gruppiert in Bronze (<50 %), Silber (50–80 %) und Gold (>80 %) Qualitätsstufen
- **Häufigste Qualitätsprobleme** — Karten mit den niedrigsten Datenqualitätsbewertungen, mit direkten Links zu den jeweiligen Karten

## Herstelleranalyse

Die Herstelleranalyse verwendet KI, um Ihre Technologiehersteller in mehr als 45 Branchenkategorien einzuteilen (z. B. CRM, ERP, Cloud-Infrastruktur, Sicherheit).

**Verwendung:**

1. Navigieren Sie zu **TurboLens > Hersteller**
2. Klicken Sie auf **Analyse starten**
3. Die KI verarbeitet Ihr Herstellerportfolio in Stapeln und kategorisiert jeden Hersteller mit Begründung
4. Die Ergebnisse zeigen eine Kategorienübersicht und eine detaillierte Herstellertabelle

Jeder Herstellereintrag enthält die Kategorie, Unterkategorie, Anzahl der verknüpften Anwendungen, jährliche Gesamtkosten sowie die Begründung der KI für die Kategorisierung. Wechseln Sie mit dem Ansichts-Umschalter zwischen Raster- und Tabellenansicht.

## Herstellerauflösung

Die Herstellerauflösung erstellt eine kanonische Hersteller-Hierarchie, indem Aliase aufgelöst und Eltern-Kind-Beziehungen identifiziert werden.

**Verwendung:**

1. Navigieren Sie zu **TurboLens > Auflösung**
2. Klicken Sie auf **Hersteller auflösen**
3. Die KI identifiziert Hersteller-Aliase (z. B. «MSFT» = «Microsoft»), Muttergesellschaften und Produktgruppierungen
4. Die Ergebnisse zeigen die aufgelöste Hierarchie mit Konfidenzwerten

Die Hierarchie gliedert Hersteller in vier Ebenen: Hersteller, Produkt, Plattform und Modul. Jeder Eintrag zeigt die Anzahl der verknüpften Anwendungen und IT-Komponenten, Gesamtkosten sowie einen Konfidenzprozentsatz.

## Duplikaterkennung

Die Duplikaterkennung identifiziert funktionale Überschneidungen in Ihrem Portfolio — Karten, die denselben oder einen ähnlichen Geschäftszweck erfüllen.

**Verwendung:**

1. Navigieren Sie zu **TurboLens > Duplikate**
2. Klicken Sie auf **Duplikate erkennen**
3. Die KI analysiert Anwendungs-, IT-Komponenten- und Schnittstellen-Karten stapelweise
4. Die Ergebnisse zeigen Cluster potenzieller Duplikate mit Belegen und Empfehlungen

Für jeden Cluster können Sie:

- **Bestätigen** — Das Duplikat als bestätigt für die Nachverfolgung markieren
- **Untersuchen** — Zur weiteren Untersuchung kennzeichnen
- **Verwerfen** — Verwerfen, wenn es sich nicht um ein echtes Duplikat handelt

## Modernisierungsbewertung

Die Modernisierungsbewertung evaluiert Karten hinsichtlich Upgrade-Möglichkeiten auf Basis aktueller Technologietrends.

**Verwendung:**

1. Navigieren Sie zu **TurboLens > Duplikate** (Reiter «Modernisierung»)
2. Wählen Sie einen Zielkartentyp (Anwendung, IT-Komponente oder Schnittstelle)
3. Klicken Sie auf **Modernisierung bewerten**
4. Die Ergebnisse zeigen jede Karte mit Modernisierungstyp, Empfehlung, Aufwandsniveau (niedrig/mittel/hoch) und Priorität (niedrig/mittel/hoch/kritisch)

Die Ergebnisse werden nach Priorität gruppiert, damit Sie sich auf die wirkungsvollsten Modernisierungsmöglichkeiten konzentrieren können.

## Architektur-KI

Die Architektur-KI ist ein geführter 5-Schritte-Assistent, der Architekturempfehlungen auf Basis Ihrer bestehenden Landschaft generiert. Er verknüpft Ihre Geschäftsziele und Business Capabilities mit konkreten Lösungsvorschlägen, Gap-Analysen, Abhängigkeitsmapping und einem Zielarchitektur-Diagramm.

<div style="text-align: center;">
<iframe width="560" height="315" src="https://www.youtube.com/embed/FDneDl0ULsA" title="Architektur-KI Übersicht" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
</div>

Ein Fortschrittsanzeiger oben verfolgt Ihren Fortschritt durch die fünf Phasen: Anforderungen, Business Fit, Technical Fit, Lösung und Zielarchitektur. Sie können auf jeden bereits erreichten Schritt klicken, um frühere Phasen zu überprüfen — alle nachgelagerten Daten bleiben erhalten und werden erst zurückgesetzt, wenn Sie eine Phase erneut absenden. Ihr Fortschritt wird automatisch in der Browser-Sitzung gespeichert, sodass Sie die Seite verlassen und zurückkehren können, ohne Ihre Arbeit zu verlieren. Sie können Bewertungen auch in der Datenbank speichern und später fortsetzen (siehe [Speichern & Fortsetzen](#speichern--fortsetzen) weiter unten). Klicken Sie auf **Neue Bewertung**, um jederzeit eine neue Analyse zu starten.

### Schritt 1: Anforderungen

Geben Sie Ihre Geschäftsanforderung in natürlicher Sprache ein (z. B. «Wir benötigen ein Self-Service-Portal für Kunden»). Dann:

- **Geschäftsziele auswählen** — Wählen Sie eine oder mehrere vorhandene Objective-Karten aus dem Autocomplete-Dropdown. Dies verankert die Analyse der KI in Ihren strategischen Zielen. Mindestens ein Ziel ist erforderlich.
- **Business Capabilities auswählen** (optional) — Wählen Sie vorhandene Business Capability-Karten oder geben Sie neue Capability-Namen ein. Neue Capabilities erscheinen als blaue Chips mit der Bezeichnung «NEU: Name». Dies hilft der KI, sich auf bestimmte Capability-Bereiche zu konzentrieren.

Klicken Sie auf **Fragen generieren**, um fortzufahren.

### Schritt 2: Business Fit (Phase 1)

Die KI generiert geschäftliche Klärungsfragen, die auf Ihre Anforderung und ausgewählten Ziele zugeschnitten sind. Fragen kommen in verschiedenen Typen:

- **Text** — Felder für freie Texteingaben
- **Einzelauswahl** — Klicken Sie auf einen Options-Chip zur Auswahl
- **Mehrfachauswahl** — Klicken Sie auf mehrere Options-Chips; Sie können auch eine benutzerdefinierte Antwort eingeben und Enter drücken

Jede Frage kann einen Kontext enthalten, der erklärt, warum die KI fragt (Hinweis «Auswirkung»). Beantworten Sie alle Fragen und klicken Sie auf **Absenden**, um zu Phase 2 fortzufahren.

### Schritt 3: Technical Fit (Phase 2)

Die KI generiert technische Vertiefungsfragen auf Basis Ihrer Antworten aus Phase 1. Diese können NFR-Kategorien (nicht-funktionale Anforderungen) wie Performance, Sicherheit oder Skalierbarkeit umfassen. Beantworten Sie alle Fragen und klicken Sie auf **Capabilities analysieren**, um Lösungsoptionen zu generieren.

### Schritt 4: Lösung (Phase 3)

Dieser Schritt hat drei Teilphasen:

#### 3a: Lösungsoptionen

Die KI generiert mehrere Lösungsoptionen, die jeweils als Karte präsentiert werden mit:

| Element | Beschreibung |
|---------|--------------|
| **Ansatz** | Kaufen, Bauen, Erweitern oder Wiederverwenden — farblich kodierter Chip |
| **Zusammenfassung** | Kurze Beschreibung des Ansatzes |
| **Vor- & Nachteile** | Wesentliche Vorteile und Nachteile |
| **Schätzungen** | Geschätzte Kosten, Dauer und Komplexität |
| **Auswirkungsvorschau** | Neue Komponenten, geänderte Komponenten, abgelöste Komponenten und neue Integrationen, die diese Option mit sich bringen würde |

Klicken Sie auf **Auswählen** bei der Option, die Sie verfolgen möchten. Wenn Sie zu diesem Schritt zurückkehren, nachdem Sie eine Option ausgewählt haben, wird die zuvor gewählte Option visuell mit einem Rahmen und einem «Ausgewählt»-Badge hervorgehoben, sodass Sie Ihre aktuelle Auswahl leicht erkennen können.

#### 3b: Gap-Analyse

Nach der Auswahl einer Option identifiziert die KI Capability-Lücken in Ihrer aktuellen Landschaft. Jede Lücke zeigt:

- **Capability-Name** mit Dringlichkeitsstufe (kritisch/hoch/mittel)
- **Auswirkungsbeschreibung** mit Erläuterung, warum diese Lücke relevant ist
- **Marktempfehlungen** — Priorisierte Produktempfehlungen (Gold Nr. 1, Silber Nr. 2, Bronze Nr. 3) mit Hersteller, Begründung, Vor-/Nachteilen, geschätzten Kosten und Integrationsaufwand

Wählen Sie die Produkte aus, die Sie einbeziehen möchten, indem Sie auf die Empfehlungskarten klicken (Kontrollkästchen erscheinen). Klicken Sie auf **Abhängigkeiten analysieren**, um fortzufahren.

#### 3c: Abhängigkeitsanalyse

Nach der Auswahl von Produkten identifiziert die KI zusätzliche Infrastruktur-, Plattform- oder Middleware-Abhängigkeiten, die Ihre Auswahl erfordert. Jede Abhängigkeit zeigt:

- **Bedarf** mit Dringlichkeitsstufe
- **Begründung** mit Erläuterung, warum diese Abhängigkeit erforderlich ist
- **Optionen** — Alternative Produkte zur Erfüllung der Abhängigkeit, mit denselben Details wie Gap-Empfehlungen

Wählen Sie Abhängigkeiten aus und klicken Sie auf **Capability-Map generieren**, um die finale Zielarchitektur zu erstellen.

### Schritt 5: Zielarchitektur

Der letzte Schritt generiert ein umfassendes Capability-Mapping:

| Abschnitt | Beschreibung |
|-----------|--------------|
| **Zusammenfassung** | Übergeordnete Darstellung der vorgeschlagenen Architektur |
| **Capabilities** | Liste der zugeordneten Business Capabilities — bestehende (grün) und neu vorgeschlagene (blau) |
| **Vorgeschlagene Karten** | Neue Karten, die in Ihrer Landschaft erstellt werden sollen, dargestellt mit Kartentyp-Icons und Subtypen |
| **Vorgeschlagene Beziehungen** | Verbindungen zwischen vorgeschlagenen Karten und bestehenden Landschaftselementen |
| **Abhängigkeitsdiagramm** | Interaktives C4-Diagramm mit bestehenden Knoten neben vorgeschlagenen Knoten (gestrichelte Rahmen mit grünem «NEU»-Badge). Schwenken, zoomen und die Architektur visuell erkunden |

In diesem Schritt können Sie auf **Andere Auswahl** klicken, um zurückzugehen und eine andere Lösungsoption zu wählen, oder auf **Neu starten**, um eine völlig neue Bewertung zu beginnen.

!!! warning "KI-gestützte Bewertung"
    Diese Bewertung nutzt KI zur Generierung von Empfehlungen, Lösungsoptionen und einer Zielarchitektur. Sie sollte von einem qualifizierten IT-Experten (Enterprise Architect, Solution Architect, IT-Leiter) in Zusammenarbeit mit den Fachabteilungen durchgeführt werden. Die generierten Ergebnisse erfordern fachliche Beurteilung und können Ungenauigkeiten enthalten. Verwenden Sie die Ergebnisse als Ausgangspunkt für weitere Diskussionen und Verfeinerungen.

### Speichern & Fortsetzen

Nach der Überprüfung der Zielarchitektur können Sie Ihre Arbeit speichern oder übernehmen:

**Bewertung speichern** — Speichert einen vollständigen Snapshot der Bewertung (alle Antworten, ausgewählte Optionen, Gap-Analyse, Abhängigkeiten und Zielarchitektur) in der Datenbank. Gespeicherte Bewertungen erscheinen im Reiter **Bewertungen**.

**Gespeicherte Bewertung fortsetzen** — Nicht übernommene Bewertungen können im interaktiven Assistenten mit vollständig wiederhergestelltem Zustand erneut geöffnet werden:

- Klicken Sie im Reiter **Bewertungen** auf die Schaltfläche **Fortsetzen** in der Zeile einer gespeicherten Bewertung
- Klicken Sie in der schreibgeschützten **Bewertungsansicht** auf **Fortsetzen** in der Kopfzeile
- Der Assistent wird auf die exakte Phase und den Zustand wiederhergestellt, an dem Sie aufgehört haben, einschließlich aller KI-generierten Fragen, Ihrer Antworten, ausgewählten Optionen und Produktauswahlen
- Sie können dort fortfahren, wo Sie aufgehört haben, einen anderen Ansatz wählen oder übernehmen, um eine Initiative zu erstellen
- Erneutes Speichern aktualisiert die bestehende Bewertung (anstatt eine neue zu erstellen)

!!! tip "Vollständiger Snapshot"
    Eine gespeicherte Bewertung ist ein vollständiger Snapshot Ihrer Assistenten-Sitzung. Solange sie nicht in eine Initiative übernommen wurde, können Sie sie fortsetzen, einen anderen Lösungsansatz wählen und beliebig oft erneut speichern.

**Übernehmen & Initiative erstellen** — Wandelt den Architekturvorschlag in echte Karten in Ihrer Landschaft um:

- **Initiativname** wird standardmäßig mit dem Titel der gewählten Lösungsoption vorbelegt (vor der Erstellung bearbeitbar)
- **Start-/Enddatum** für den Zeitrahmen der Initiative
- **Vorgeschlagene neue Karten** mit Schaltern zum Ein-/Ausschließen einzelner Karten und Bearbeitungssymbolen zum Umbenennen vor der Erstellung. Diese Liste enthält auch neue Business Capabilities, die während der Bewertung identifiziert wurden.
- **Vorgeschlagene Beziehungen** mit Schaltern zum Ein-/Ausschließen
- Eine Fortschrittsanzeige zeigt den Erstellungsstatus (Initiative → Karten → Beziehungen → ADR)
- Bei Erfolg öffnet ein Link die neue Initiativkarte

### Architektur-Leitplanken

Das System erzwingt automatisch die architektonische Integrität:

- Jede neue Anwendung wird mit mindestens einer Business Capability verknüpft
- Jede neue Business Capability wird mit den ausgewählten Geschäftszielen verknüpft
- Karten ohne Beziehungen (verwaiste Karten) werden automatisch aus dem Vorschlag entfernt

### Architecture Decision Record

Ein ADR-Entwurf wird automatisch zusammen mit der Initiative erstellt mit:

- **Kontext** aus der Zusammenfassung des Capability-Mappings
- **Entscheidung** mit dem gewählten Ansatz und den Produkten
- **Betrachtete Alternativen** aus den nicht gewählten Lösungsoptionen

### Ansatz ändern

Klicken Sie auf **Andere Auswahl**, um zu den Lösungsoptionen zurückzukehren und einen anderen Ansatz zu wählen. Alle Ihre Antworten aus Phase 1 und Phase 2 bleiben erhalten — nur die nachgelagerten Daten (Gap-Analyse, Abhängigkeiten, Zielarchitektur) werden zurückgesetzt. Nach Auswahl einer neuen Option durchläuft der Assistent erneut die Gap-Analyse und Abhängigkeitsanalyse. Sie können die aktualisierte Bewertung speichern oder übernehmen, wenn Sie bereit sind.

## Analyseverlauf

Alle Analyseläufe werden unter **TurboLens > Verlauf** nachverfolgt und zeigen:

- Analysetyp (Herstelleranalyse, Herstellerauflösung, Duplikaterkennung, Modernisierung, Architekt)
- Status (läuft, abgeschlossen, fehlgeschlagen)
- Start- und Abschlusszeitstempel
- Fehlermeldungen (falls vorhanden)

## Berechtigungen

| Berechtigung | Beschreibung |
|--------------|--------------|
| `turbolens.view` | Analyseergebnisse anzeigen (vergeben an admin, bpm_admin, member) |
| `turbolens.manage` | Analysen auslösen (vergeben an admin) |
