# Glossar

| Begriff | Definition |
|---------|------------|
| **ADR (Architecture Decision Record)** | Ein formales Dokument, das eine wichtige Architekturentscheidung erfasst, einschließlich Kontext, Entscheidungsgrundlage, Konsequenzen und betrachteter Alternativen. ADRs unterstützen einen Unterschrifts-Workflow und eine Revisionskette |
| **Genehmigungsstatus** | Der Überprüfungsstatus einer Karte: Entwurf, Genehmigt, Ungültig oder Abgelehnt. Genehmigte Karten wechseln zu Ungültig, wenn sie bearbeitet werden |
| **Lesezeichen / Gespeicherte Ansicht** | Eine gespeicherte Filter-, Spalten- und Sortierkonfiguration im Inventar, die mit einem Klick geladen werden kann |
| **BPM** | Business Process Management — die Disziplin der Modellierung, Analyse und Verbesserung von Geschäftsprozessen |
| **BPMN** | Business Process Model and Notation — die Standardnotation zur Modellierung von Geschäftsprozessen (Version 2.0) |
| **Geschäftsfähigkeit** | Was eine Organisation tun kann, unabhängig davon, wie sie es tut |
| **Berechnung** | Eine vom Administrator definierte Formel, die automatisch einen Feldwert berechnet, wenn eine Karte gespeichert wird |
| **Karte** | Die grundlegende Informationseinheit in Turbo EA, die jede Architekturkomponente repräsentiert |
| **Kartentyp** | Die Kategorie, zu der eine Karte gehört (z.B. Anwendung, Geschäftsprozess, Organisation) |
| **Konfidenzwert** | Eine Bewertung von 0–100%, die angibt, wie zuverlässig eine KI-generierte Beschreibung ist |
| **Datenqualität** | Ein Vollständigkeitswert von 0–100%, basierend auf ausgefüllten Feldern und deren konfigurierten Gewichtungen |
| **Dateianhang** | Eine binäre Datei (PDF, DOCX, XLSX, Bilder, bis 10 MB), die direkt über den Ressourcen-Tab auf eine Karte hochgeladen wird |
| **Diagramm** | Ein visuelles Architekturdiagramm, erstellt mit dem eingebetteten DrawIO-Editor |
| **DrawIO** | Das eingebettete Open-Source-Diagrammwerkzeug für visuelle Architekturdiagramme |
| **Enterprise Architecture (EA)** | Die Disziplin, die die Geschäfts- und Technologiestruktur einer Organisation organisiert und dokumentiert |
| **EOL (End of Life)** | Das Datum, an dem ein Technologieprodukt den Herstellersupport verliert. Wird über die Integration mit endoflife.date verfolgt |
| **Initiative** | Ein Projekt oder Programm, das Änderungen an der Architektur beinhaltet |
| **Lebenszyklus** | Die fünf Phasen, die eine Komponente durchläuft: Planung, Einführung, Aktiv, Auslauf, Lebensende |
| **LLM** | Large Language Model — ein KI-Modell, das Text generiert (z.B. Ollama, OpenAI, Anthropic Claude, Google Gemini) |
| **MCP** | Model Context Protocol — ein offener Standard, der KI-Werkzeugen (Claude, Copilot, Cursor) die Verbindung zu externen Datenquellen ermöglicht. Der integrierte MCP-Server von Turbo EA bietet schreibgeschützten Zugriff auf EA-Daten mit RBAC pro Benutzer |
| **Metamodell** | Das datengesteuerte Modell, das die Struktur der Plattform definiert: Kartentypen, Felder, Beziehungen und Rollen |
| **Benachrichtigung** | Ein In-App- oder E-Mail-Hinweis, ausgelöst durch Systemereignisse (Aufgabe zugewiesen, Karte aktualisiert, Kommentar hinzugefügt usw.) |
| **Ollama** | Ein Open-Source-Werkzeug zum lokalen Ausführen von LLMs auf eigener Hardware |
| **Portfolio** | Eine Sammlung von Anwendungen oder Technologien, die als Gruppe verwaltet werden |
| **Referenznummer** | Eine automatisch generierte fortlaufende Kennung für ADRs (z.B. ADR-001, ADR-002), die ein eindeutiges, lesbares Label bietet |
| **Beziehung** | Eine Verbindung zwischen zwei Karten, die beschreibt, wie sie zusammenhängen (z.B. «nutzt», «hängt ab von», «läuft auf») |
| **Ressourcen-Tab** | Ein Tab auf der Kartendetailseite, der Architekturentscheidungen, Dateianhänge und Dokumentenlinks an einem Ort zusammenfasst |
| **Revision (ADR)** | Eine neue Version eines unterzeichneten ADR, die Inhalt und Kartenverknüpfungen der vorherigen Version übernimmt, mit einer erhöhten Revisionsnummer |
| **Gespeicherter Bericht** | Eine gespeicherte Berichtskonfiguration mit Filtern, Achsen und Visualisierungseinstellungen, die erneut geladen werden kann |
| **Abschnitt** | Ein gruppierbarer Bereich der Kartendetailseite, der verwandte Felder enthält, konfigurierbar pro Kartentyp |
| **Unterzeichner** | Ein Benutzer, der zur Überprüfung und Unterzeichnung eines ADR- oder SoAW-Dokuments bestimmt wurde. Der Unterschrifts-Workflow verfolgt ausstehende und abgeschlossene Unterschriften |
| **SoAW** | Statement of Architecture Work — ein formales TOGAF-Dokument, das Umfang und Ergebnisse für eine Initiative definiert |
| **SSO** | Single Sign-On — Anmeldung mit Unternehmensanmeldedaten über einen Identitätsanbieter (Microsoft, Google, Okta, OIDC) |
| **Stakeholder** | Eine Person mit einer bestimmten Rolle auf einer Karte (z.B. Anwendungseigner, Technischer Eigner) |
| **Umfrage** | Ein Datenpflege-Fragebogen, der auf bestimmte Kartentypen abzielt, um Informationen von Stakeholdern zu sammeln |
| **Tag / Tag-Gruppe** | Ein Klassifizierungslabel, organisiert in Gruppen mit Einfach- oder Mehrfachauswahlmodus |
| **TOGAF** | The Open Group Architecture Framework — eine weit verbreitete EA-Methodik. Die SoAW-Funktion von Turbo EA orientiert sich an TOGAF |
| **Web-Portal** | Eine öffentliche, schreibgeschützte Ansicht ausgewählter Karten, zugänglich ohne Authentifizierung über eine eindeutige URL |
| **KI-Vorschlag** | Eine automatisch generierte Kartenbeschreibung, erstellt durch Kombination von Websuchergebnissen mit einem Large Language Model (LLM) |
