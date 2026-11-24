# Einführung in Turbo EA

### Was ist Turbo EA?

**Turbo EA** ist eine moderne, selbst gehostete Plattform für **Enterprise Architecture Management**. Sie ermöglicht es Organisationen, alle Komponenten ihrer Geschäfts- und Technologiearchitektur an einem Ort zu dokumentieren, zu visualisieren und zu verwalten.

### Für wen ist dieses Handbuch?

Dieses Handbuch richtet sich an **alle Nutzer von Turbo EA** — Enterprise-Architekten, IT-Manager, Business-Analysten, Entwickler und Administratoren. Ob Sie die Plattform evaluieren, die IT-Landschaft Ihrer Organisation im Tagesgeschäft verwalten oder das System als Administrator konfigurieren — hier finden Sie die benötigten Informationen. Zum Einstieg sind keine fortgeschrittenen technischen Kenntnisse erforderlich.

### Wesentliche Vorteile

- **Umfassende Transparenz**: Alle Anwendungen, Prozesse, Fähigkeiten und Technologien der gesamten Organisation in einer einzigen Plattform anzeigen.
- **Fundierte Entscheidungsfindung**: Visuelle Berichte (Portfolio, Fähigkeitskarten, Abhängigkeiten, Lebenszyklus, Kosten und mehr), die die Bewertung des aktuellen Stands der Technologieinfrastruktur erleichtern.
- **Lebenszyklusmanagement**: Den Status jeder Technologiekomponente über fünf Phasen hinweg verfolgen — von der Planung bis zur Stilllegung.
- **Zusammenarbeit**: Mehrere Benutzer können gleichzeitig arbeiten, mit konfigurierbaren Rollen, Stakeholder-Zuweisungen, Kommentaren, Aufgaben und Benachrichtigungen.
- **KI-gestützte Beschreibungen**: Kartenbeschreibungen mit einem einzigen Klick generieren. Turbo EA kombiniert Websuche mit einem lokalen oder kommerziellen LLM, um typbezogene Zusammenfassungen zu erstellen — komplett mit Konfidenzwerten und Quellenlinks. Läuft vollständig auf Ihrer Infrastruktur für maximalen Datenschutz, oder verbinden Sie sich mit kommerziellen Anbietern (OpenAI, Google Gemini, Anthropic Claude und mehr). Vollständig vom Administrator steuerbar: Wählen Sie, welche Kartentypen KI-Vorschläge erhalten, bestimmen Sie den Suchanbieter und wählen Sie das Modell.
- **Visuelle Diagramme**: Architekturdiagramme mit dem eingebetteten DrawIO-Editor erstellen, vollständig synchronisiert mit Ihrem Karteninventar.
- **Geschäftsprozessmodellierung**: BPMN 2.0 Prozessfluss-Editor mit Elementverknüpfung, Genehmigungsworkflows und Reifegradbeurteilungen.
- **ServiceNow-Integration**: Bidirektionale Synchronisation mit ServiceNow CMDB, um Ihre EA-Landschaft mit IT-Betriebsdaten verbunden zu halten.
- **Mehrsprachig**: Verfügbar in Englisch, Spanisch, Französisch, Deutsch, Italienisch, Portugiesisch und Chinesisch.

### Grundlegende Konzepte

| Begriff | Bedeutung |
|---------|-----------|
| **Karte** | Das Grundelement der Plattform. Repräsentiert jede Architekturkomponente: eine Anwendung, einen Prozess, eine Geschäftsfähigkeit usw. |
| **Kartentyp** | Die Kategorie, zu der eine Karte gehört (Anwendung, Geschäftsprozess, Organisation usw.) |
| **Beziehung** | Eine Verbindung zwischen zwei Karten, die beschreibt, wie sie zusammenhängen (z.B. «nutzt», «hängt ab von», «ist Teil von») |
| **Metamodell** | Die Struktur, die definiert, welche Kartentypen existieren, welche Felder sie haben und wie sie zueinander in Beziehung stehen. Vollständig vom Administrator konfigurierbar |
| **Lebenszyklus** | Die zeitlichen Phasen einer Komponente: Planung, Einführung, Aktiv, Auslauf, Lebensende |
| **Inventar** | Durchsuch- und filterbare Liste aller Karten über alle Typen hinweg. Bulk-Bearbeitung, Excel/CSV-Import-Export und gespeicherte Ansichten mit Freigabe |
| **Berichte** | Vorgefertigte Visualisierungen: Portfolio, Fähigkeitskarte, Lebenszyklus, Abhängigkeiten, Kosten, Matrix, Datenqualität und End-of-Life |
| **BPM** | Business Process Management — Geschäftsprozesse mit einem BPMN-2.0-Editor modellieren, Diagrammelemente mit Karten verknüpfen und Reife, Risiko und Automatisierung bewerten |
| **PML** | Projektstammliste — Initiative-Karten als vollständige Projekte verwalten mit Statusberichten, Work Breakdown Structures, Kanban- und Gantt-Boards, Budgets, Kosten und einem Risikoregister je Initiative |
| **TurboLens** | KI-gestützte EA-Intelligenz — Anbieteranalyse, Duplikaterkennung, Modernisierungsbewertung, der 5-stufige Architecture-AI-Assistent und Compliance-Scans (EU AI Act / DSGVO / NIS2 / DORA / SOC 2 / ISO 27001) |
| **EA Delivery** | Die TOGAF-konforme Lieferungsoberfläche — Statements of Architecture Work, Architecture Decision Records und das landschaftsweite Risikoregister |
| **SoAW** | Statement of Architecture Work — ein formales TOGAF-Dokument, das eine Architekturinitiative abgrenzt |
| **ADR** | Architecture Decision Record — erfasst Kontext, Alternativen und Konsequenzen einer Entscheidung, mit Status-Workflow und Karten-Verknüpfung |
| **Risikoregister** | Landschaftsweites TOGAF-Phase-G-Risikoregister, getrennt von initiativenbezogenen PML-Risiken. Eigentümerzuweisung erstellt automatisch eine Aufgabe |
| **Web-Portal** | Öffentliche, slug-basierte, schreibgeschützte Ansicht eines Teils der EA-Landschaft — ohne Login teilbar |
| **MCP-Server** | Read-only-KI-Tool-Zugriff über das Model Context Protocol — EA-Daten aus Claude Desktop, Cursor, GitHub Copilot und anderen MCP-Clients abfragen |
| **RBAC** | Role-Based Access Control — App-weite Rollen plus kartenspezifische Stakeholder-Rollen mit über 50 granularen Berechtigungen |
