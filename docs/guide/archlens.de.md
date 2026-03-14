# ArchLens KI-Intelligenz

Das **ArchLens**-Modul bietet KI-gestützte Analysen Ihrer Enterprise-Architecture-Landschaft. Es nutzt Ihren konfigurierten KI-Anbieter, um Herstelleranalysen, Duplikaterkennung, Modernisierungsbewertungen und Architekturempfehlungen durchzuführen.

!!! note
    ArchLens erfordert einen kommerziellen KI-Anbieter (Anthropic Claude, OpenAI, DeepSeek oder Google Gemini), der in den [KI-Einstellungen](../admin/ai.md) konfiguriert ist. Das Modul ist automatisch verfügbar, wenn KI konfiguriert ist.

!!! info "Credits"
    ArchLens basiert auf dem Open-Source-Projekt [ArchLens](https://github.com/vinod-ea/archlens) von [Vinod](https://github.com/vinod-ea), veröffentlicht unter der MIT-Lizenz. Die Analyselogik wurde von Node.js nach Python portiert und nativ in Turbo EA integriert.

## Dashboard

Das ArchLens-Dashboard bietet einen Überblick über Ihre Landschaftsanalyse:

| Indikator | Beschreibung |
|-----------|-------------|
| **Gesamte Karten** | Anzahl der aktiven Karten in Ihrem Portfolio |
| **Durchschn. Qualität** | Durchschnittliche Datenqualität über alle Karten |
| **Hersteller** | Anzahl der analysierten Technologiehersteller |
| **Duplikat-Cluster** | Anzahl der identifizierten Duplikatgruppen |
| **Modernisierungen** | Anzahl der gefundenen Modernisierungsmöglichkeiten |

Das Dashboard zeigt außerdem Karten gruppiert nach Typ und hebt die wichtigsten Qualitätsprobleme hervor.

## Herstelleranalyse

Die Herstelleranalyse verwendet KI, um Ihre Technologiehersteller in über 45 Branchenkategorien einzuordnen (z. B. CRM, ERP, Cloud-Infrastruktur, Sicherheit).

**So verwenden Sie es:**

1. Navigieren Sie zu **ArchLens > Hersteller**
2. Klicken Sie auf **Analyse starten**
3. Die KI verarbeitet Ihr Herstellerportfolio in Stapeln und kategorisiert jeden Hersteller mit Begründung
4. Die Ergebnisse zeigen eine Kategorieübersicht und eine detaillierte Herstellertabelle

Jeder Herstellereintrag enthält die Kategorie, Unterkategorie, Anzahl der zugehörigen Anwendungen, jährliche Gesamtkosten und die Begründung der KI für die Kategorisierung.

## Herstellerauflösung

Die Herstellerauflösung erstellt eine kanonische Herstellerhierarchie durch Auflösung von Aliasnamen und Identifizierung von Eltern-Kind-Beziehungen.

**So verwenden Sie es:**

1. Navigieren Sie zu **ArchLens > Auflösung**
2. Klicken Sie auf **Hersteller auflösen**
3. Die KI identifiziert Herstelleraliase (z. B. «MSFT» = «Microsoft»), Muttergesellschaften und Produktgruppierungen
4. Die Ergebnisse zeigen die aufgelöste Hierarchie mit Konfidenzwerten

## Duplikaterkennung

Die Duplikaterkennung identifiziert funktionale Überschneidungen in Ihrem Portfolio — Karten, die denselben oder einen ähnlichen Geschäftszweck erfüllen.

**So verwenden Sie es:**

1. Navigieren Sie zu **ArchLens > Duplikate**
2. Klicken Sie auf **Duplikate erkennen**
3. Die KI analysiert Application-, IT Component- und Interface-Karten in Stapeln
4. Die Ergebnisse zeigen Cluster potenzieller Duplikate mit Nachweisen und Empfehlungen

Für jeden Cluster können Sie:

- **Bestätigen** — Das Duplikat als bestätigt für die Nachverfolgung markieren
- **Untersuchen** — Zur weiteren Untersuchung kennzeichnen
- **Verwerfen** — Verwerfen, wenn es kein echtes Duplikat ist

## Modernisierungsbewertung

Die Modernisierungsbewertung bewertet Karten hinsichtlich Upgrade-Möglichkeiten basierend auf aktuellen Technologietrends.

**So verwenden Sie es:**

1. Navigieren Sie zu **ArchLens > Duplikate** (Abschnitt Modernisierung)
2. Wählen Sie einen Ziel-Kartentyp (Application, IT Component oder Interface)
3. Klicken Sie auf **Modernisierung bewerten**
4. Die Ergebnisse zeigen jede Karte mit Modernisierungstyp, Empfehlung, Aufwandsstufe und Priorität

## Architecture AI

Die Architecture AI ist ein 3-Phasen-Konversationsassistent, der Architekturempfehlungen basierend auf Ihrer bestehenden Landschaft generiert.

**So verwenden Sie es:**

1. Navigieren Sie zu **ArchLens > Architekt**
2. **Phase 1** — Beschreiben Sie Ihre Geschäftsanforderung (z. B. «Wir benötigen ein Kunden-Self-Service-Portal»). Die KI generiert geschäftliche Klärungsfragen.
3. **Phase 2** — Beantworten Sie die Fragen aus Phase 1. Die KI generiert technische Vertiefungsfragen.
4. **Phase 3** — Beantworten Sie die Fragen aus Phase 2. Die KI generiert eine vollständige Architekturempfehlung, die Folgendes umfasst:

| Abschnitt | Beschreibung |
|-----------|-------------|
| **Architekturdiagramm** | Interaktives Mermaid-Diagramm mit Zoom, SVG-Download und Code-Kopie |
| **Komponentenschichten** | Organisiert nach Architekturschicht mit Klassifizierung bestehend/neu/empfohlen |
| **Lücken und Empfehlungen** | Fähigkeitslücken mit Marktproduktempfehlungen, sortiert nach Eignung |
| **Integrationen** | Integrationskarte mit Datenflüssen, Protokollen und Richtungen |
| **Risiken und nächste Schritte** | Risikobewertung mit Maßnahmen und priorisierten Umsetzungsschritten |

## Analyseverlauf

Alle Analyseläufe werden unter **ArchLens > Verlauf** verfolgt und zeigen:

- Analysetyp (Herstelleranalyse, Herstellerauflösung, Duplikaterkennung, Modernisierung, Architekt)
- Status (laufend, abgeschlossen, fehlgeschlagen)
- Start- und Abschlusszeitstempel
- Fehlermeldungen (falls vorhanden)

## Berechtigungen

| Berechtigung | Beschreibung |
|------------|-------------|
| `archlens.view` | Analyseergebnisse anzeigen (gewährt für admin, bpm_admin, member) |
| `archlens.manage` | Analysen auslösen (gewährt für admin) |
