# Glossar

| Begriff | Definition |
|---------|------------|
| **ADR (Architecture Decision Record)** | Ein formales Dokument, das eine wichtige Architekturentscheidung erfasst, einschließlich Kontext, Entscheidungsgrundlage, Konsequenzen und betrachteter Alternativen. ADRs unterstützen einen Unterschrifts-Workflow und eine Revisionskette |
| **Genehmigungsstatus** | Der Überprüfungsstatus einer Karte: Entwurf, Genehmigt, Ungültig oder Abgelehnt. Genehmigte Karten wechseln zu Ungültig, wenn sie bearbeitet werden |
| **Lesezeichen / Gespeicherte Ansicht** | Eine gespeicherte Filter-, Spalten- und Sortierkonfiguration im Inventar, die mit einem Klick geladen werden kann |
| **BPM** | Business Process Management — die Disziplin der Modellierung, Analyse und Verbesserung von Geschäftsprozessen |
| **BPMN** | Business Process Model and Notation — die Standardnotation zur Modellierung von Geschäftsprozessen (Version 2.0) |
| **BPM-Zeilenreihenfolge** | Die Anzeigereihenfolge der Prozesstypzeilen (Kern, Unterstützung, Management) im BPM-Prozessnavigator, konfigurierbar durch Ziehen von Zeilen |
| **Geschäftsjahr** | Der 12-monatige Zeitraum für Budgetierung und Finanzberichterstattung. Konfigurierbar über Admin > Einstellungen — der Startmonat (Januar bis Dezember) bestimmt, wie PPM-Budgetzeilen gruppiert werden |
| **Geschäftsfähigkeit** | Was eine Organisation tun kann, unabhängig davon, wie sie es tut |
| **Berechnung** | Eine vom Administrator definierte Formel, die automatisch einen Feldwert berechnet, wenn eine Karte gespeichert wird |
| **Karte** | Die grundlegende Informationseinheit in Turbo EA, die jede Architekturkomponente repräsentiert |
| **Kartentyp** | Die Kategorie, zu der eine Karte gehört (z.B. Anwendung, Geschäftsprozess, Organisation) |
| **Konfidenzwert** | Eine Bewertung von 0–100%, die angibt, wie zuverlässig eine KI-generierte Beschreibung ist |
| **Kostenposition** | Ein Budget- oder Ist-Kosteneintrag (CapEx/OpEx) in einer PPM-Initiative zur Verfolgung finanzieller Ausgaben |
| **Datenqualität** | Ein Vollständigkeitswert von 0–100%, basierend auf ausgefüllten Feldern und deren konfigurierten Gewichtungen |
| **Dateianhang** | Eine binäre Datei (PDF, DOCX, XLSX, Bilder, bis 10 MB), die direkt über den Ressourcen-Tab auf eine Karte hochgeladen wird |
| **Diagramm** | Ein visuelles Architekturdiagramm, erstellt mit dem eingebetteten DrawIO-Editor |
| **DrawIO** | Das eingebettete Open-Source-Diagrammwerkzeug für visuelle Architekturdiagramme |
| **Enterprise Architecture (EA)** | Die Disziplin, die die Geschäfts- und Technologiestruktur einer Organisation organisiert und dokumentiert |
| **EOL (End of Life)** | Das Datum, an dem ein Technologieprodukt den Herstellersupport verliert. Wird über die Integration mit endoflife.date verfolgt |
| **Gantt-Diagramm** | Eine visuelle Zeitleiste mit horizontalen Balken, die Projektplan, Dauer und Fortschritt zeigt |
| **Initiative** | Ein Projekt oder Programm, das Änderungen an der Architektur beinhaltet |
| **Lebenszyklus** | Die fünf Phasen, die eine Komponente durchläuft: Planung, Einführung, Aktiv, Auslauf, Lebensende |
| **LLM** | Large Language Model — ein KI-Modell, das Text generiert (z.B. Ollama, OpenAI, Anthropic Claude, Google Gemini) |
| **MCP** | Model Context Protocol — ein offener Standard, der KI-Werkzeugen (Claude, Copilot, Cursor) die Verbindung zu externen Datenquellen ermöglicht. Der integrierte MCP-Server von Turbo EA bietet schreibgeschützten Zugriff auf EA-Daten mit RBAC pro Benutzer |
| **Metamodell** | Das datengesteuerte Modell, das die Struktur der Plattform definiert: Kartentypen, Felder, Beziehungen und Rollen |
| **Meilenstein** | Ein bedeutendes Ereignis oder Abschlusspunkt im Projektzeitplan, dargestellt als Rautenindikator im Gantt-Diagramm |
| **Benachrichtigung** | Ein In-App- oder E-Mail-Hinweis, ausgelöst durch Systemereignisse (Aufgabe zugewiesen, Karte aktualisiert, Kommentar hinzugefügt usw.) |
| **OData-Feed** | Ein JSON-Datenfeed, der über gespeicherte Inventaransichten (Lesezeichen) für externe Tools wie Power BI oder Excel verfügbar ist |
| **Ollama** | Ein Open-Source-Werkzeug zum lokalen Ausführen von LLMs auf eigener Hardware |
| **Portfolio** | Eine Sammlung von Anwendungen oder Technologien, die als Gruppe verwaltet werden |
| **PPM** | Projektportfoliomanagement — die Disziplin der Verwaltung eines Portfolios von Projekten und Initiativen mit Budgets, Risiken, Aufgaben und Statusberichten |
| **Referenznummer** | Eine automatisch generierte fortlaufende Kennung für ADRs (z.B. ADR-001, ADR-002), die ein eindeutiges, lesbares Label bietet |
| **Beziehung** | Eine Verbindung zwischen zwei Karten, die beschreibt, wie sie zusammenhängen (z.B. «nutzt», «hängt ab von», «läuft auf») |
| **Ressourcen-Tab** | Ein Tab auf der Kartendetailseite, der Architekturentscheidungen, Dateianhänge und Dokumentenlinks an einem Ort zusammenfasst |
| **Revision (ADR)** | Eine neue Version eines unterzeichneten ADR, die Inhalt und Kartenverknüpfungen der vorherigen Version übernimmt, mit einer erhöhten Revisionsnummer |
| **RAG-Status** | Rot-Gelb-Grün-Gesundheitsindikator in PPM-Statusberichten für Zeitplan, Kosten und Umfang |
| **Risikobewertung** | Ein automatisch berechneter Wert (Wahrscheinlichkeit x Auswirkung), der die Schwere eines Projektrisikos quantifiziert |
| **Gespeicherter Bericht** | Eine gespeicherte Berichtskonfiguration mit Filtern, Achsen und Visualisierungseinstellungen, die erneut geladen werden kann |
| **Abschnitt** | Ein gruppierbarer Bereich der Kartendetailseite, der verwandte Felder enthält, konfigurierbar pro Kartentyp |
| **Unterzeichner** | Ein Benutzer, der zur Überprüfung und Unterzeichnung eines ADR- oder SoAW-Dokuments bestimmt wurde. Der Unterschrifts-Workflow verfolgt ausstehende und abgeschlossene Unterschriften |
| **SoAW** | Statement of Architecture Work — ein formales TOGAF-Dokument, das Umfang und Ergebnisse für eine Initiative definiert |
| **SSO** | Single Sign-On — Anmeldung mit Unternehmensanmeldedaten über einen Identitätsanbieter (Microsoft, Google, Okta, OIDC) |
| **Subtyp** | Eine sekundäre Klassifikation innerhalb eines Kartentyps (z.B. Anwendung hat Subtypen: Geschäftsanwendung, Microservice, KI-Agent, Deployment). Jeder Subtyp fungiert als Untervorlage, die die Feldsichtbarkeit steuern kann |
| **Subtyp-Vorlage** | Die Konfiguration, welche Felder für einen bestimmten Subtyp sichtbar oder ausgeblendet sind. Administratoren konfigurieren dies in der Metamodell-Verwaltung durch Klicken auf einen Subtyp-Chip |
| **Stakeholder** | Eine Person mit einer bestimmten Rolle auf einer Karte (z.B. Anwendungseigner, Technischer Eigner) |
| **Umfrage** | Ein Datenpflege-Fragebogen, der auf bestimmte Kartentypen abzielt, um Informationen von Stakeholdern zu sammeln |
| **Tag / Tag-Gruppe** | Ein Klassifizierungslabel, organisiert in Gruppen mit Einfach- oder Mehrfachauswahlmodus, optionalen Typbeschränkungen und einem optionalen Pflicht-Flag, das die Freigabe blockiert und in den Datenqualitäts-Score einfliesst |
| **Pflicht-Tag-Gruppe** | Eine als erforderlich markierte Tag-Gruppe. Anwendbare Karten können erst freigegeben werden, wenn mindestens ein Tag der Gruppe zugewiesen ist; ihre Erfüllung trägt zum Datenqualitäts-Score der Karte bei |
| **Semantische EU-AI-Act-Erkennung** | Ein TurboLens-Compliance-Durchlauf, der das LLM bittet, Karten zu markieren, die KI- / ML-Fähigkeiten einbetten (LLMs, Empfehlungs-Engines, Computer Vision, Scoring, Chatbots, …), auch wenn sie nicht explizit als `AI Agent` / `AI Model` klassifiziert sind. Solche Befunde werden als **KI-erkannt** markiert |
| **Initial- vs. Rest-Risiko** | Zwei Bewertungen, die für jedes Risiko im Risikoregister erfasst werden. `Initial` ist Wahrscheinlichkeit × Auswirkung ohne Minderung; `Rest` ist Wahrscheinlichkeit × Auswirkung nach Minderung, editierbar sobald ein Minderungsplan existiert. Beide leiten über die 4×4-Matrix ein Level ab |
| **Risiko-Referenz** | Eine monoton steigende, menschlich lesbare Kennung (`R-000123`), die beim Anlegen eines Risikos vergeben wird. Sie bleibt auf Schaltflächen überführter Befunde sichtbar (**Risiko R-000123 öffnen**) und in der Beschreibung des verknüpften Todos des Eigentümers |
| **TOGAF** | The Open Group Architecture Framework — eine weit verbreitete EA-Methodik. Die SoAW-Funktion von Turbo EA orientiert sich an TOGAF |
| **Statusbericht** | Ein monatlicher PPM-Bericht, der die Projektgesundheit über RAG-Indikatoren für Zeitplan, Kosten und Umfang verfolgt |
| **Web-Portal** | Eine öffentliche, schreibgeschützte Ansicht ausgewählter Karten, zugänglich ohne Authentifizierung über eine eindeutige URL |
| **Projektstrukturplan (PSP / WBS)** | Eine hierarchische Zerlegung des Projektumfangs in Arbeitspakete mit Start-/Enddaten und Fortschrittsverfolgung |
| **Arbeitspaket** | Eine logische Gruppierung von Aufgaben innerhalb eines Gantt-Zeitplans mit eigenen Start-/Enddaten und Fertigstellungsgrad |
| **KI-Vorschlag** | Eine automatisch generierte Kartenbeschreibung, erstellt durch Kombination von Websuchergebnissen mit einem Large Language Model (LLM) |
| **KI-Verdikt** | Die Bestätigung oder Ablehnung der vom LLM erkannten KI-Eigenschaft einer Karte durch den Nutzer (`hasAiFeatures = true / false`). Bleibt über Re-Scans hinweg bestehen, damit LLM-Drift den Geltungsbereich des EU AI Act nicht stillschweigend verändern kann |
| **GRC** | Governance, Risk und Compliance — der gebündelte Arbeitsbereich unter `/grc` mit drei Tabs (Governance, Risk, Compliance), die EA-Prinzipien, ADRs, das Risikoregister und den Security & Compliance-Scanner zusammenführen |
| **Phase G** | TOGAF-ADM-Phase „Implementation Governance". Quelle des Vokabulars und Lebenszyklus des Risikoregisters |
| **Risikoregister** | Landschaftsweites Register architektonischer Risiken, ausgerichtet an TOGAF Phase G. Liegt unter `/grc?tab=risk`. Unterscheidet sich von den initiativ-bezogenen Risiken in PPM |
| **Risiko-Eigentümer** | Die für ein Risiko verantwortliche Person. Die Zuweisung erstellt automatisch ein System-Todo auf der Todo-Seite des Eigentümers und löst eine Benachrichtigung `risk_assigned` aus |
| **Mitigationsaufgabe** | Ein eigentümerbasiertes Arbeitselement, das einem Risiko angehängt ist und konkrete Mitigations-Aktivität erfasst. Kann einmalig oder wiederkehrend sein (täglich / wöchentlich / monatlich / jährlich). Wiederkehrende Aufgaben rollen kalenderrichtig vorwärts beim Abschluss |
| **Mitigationsaufgaben-Zyklus** | Eine geplante Instanz einer Mitigationsaufgabe. Durchläuft `scheduled` → `open` → `done` / `skipped`. Hält einen Snapshot des Zuständigen beim Öffnen und des Eigentümers beim Abschluss fest, sodass Audit-Antworten Eigentümerrotation überleben |
| **Lead-Zeit (Mitigationsaufgabe)** | Tage vor `due_date`, an denen ein geplanter Zyklus auf `open` befördert wird und auf der Todo-Liste des Zuständigen landet. Intelligente Pro-Einheit-Defaults (1 / 2 / 7 / 14 für täglich / wöchentlich / monatlich / jährlich), maximal halbe Zykluslänge |
| **Compliance-Befund** | Eine Zeile im Compliance-Register gegen eine Regulierung × Artikel. Manuell von einer Reviewerin erstellt oder von einem TurboLens-KI-Scan produziert; beide Arten teilen denselben Lebenszyklus und können zu einem Risiko überführt werden |
| **Macro-Capability** | Level-0-Gruppierung über L1 im Capability-Katalog. Landet als `BusinessCapability`-Karte mit `attributes.capabilityLevel = "Macro"` und einer `catalogueId` mit Präfix `MC-`. Lockert das Hierarchie-Tiefenlimit auf 6 |
| **Layered Dependency View (LDV)** | Turbo EAs Hausnotation für Abhängigkeitsdiagramme: Karten gruppiert in den vier EA-Layern als Swim-Lanes, farblich nach Kartentyp, vorgeschlagene Karten als Knoten mit gestricheltem Rand und grünem „NEW"-Badge gerendert. Wird vom Abhängigkeitsbericht, dem Kartendetail-Abhängigkeitsabschnitt und der Ziel-Architektur des TurboLens Architect verwendet |
| **TIME (Tolerate / Invest / Migrate / Eliminate)** | Ein vierstufiges Portfolio-Klassifizierungsmodell für Anwendungen, populär gemacht durch Gartner. Jede Anwendung erhält eine Disposition — Tolerate (so belassen), Invest (Verbesserungen finanzieren), Migrate (ersetzen oder verlagern) oder Eliminate (ausser Betrieb nehmen). In Turbo EA wird es üblicherweise als `single_select`-Feld auf dem Anwendungstyp angelegt und als Farbachse des Portfolio-Berichts verwendet |
| **Application Portfolio Rationalisation** | Die häufigste erste EA-Initiative auf Turbo EA: Inventarisierung der Anwendungen im Geltungsbereich, Bewertung nach Geschäftswert und technischer Eignung sowie Zuweisung einer TIME-Disposition zur Steuerung von Konsolidierungs-, Ersetzungs- oder Stilllegungsentscheidungen |
| **Crawl-Walk-Run** | Das phasierte Einführungsmuster, das im EA-Einsteigerhandbuch empfohlen wird. Crawl = enger Geltungsbereich, nur Anwendungen, fünf Felder pro Karte. Walk = Capability-Mapping ergänzen und erste Portfolio-Analyse. Run = Ausweitung auf Prozesse, Schnittstellen, Daten und die fortgeschrittenen Module |
