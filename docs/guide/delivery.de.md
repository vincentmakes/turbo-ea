# EA Delivery

Das **EA Delivery**-Modul verwaltet **Architekturinitiativen und deren Artefakte** — Diagramme und Statements of Architecture Work (SoAW). Es bietet eine einheitliche Ansicht aller laufenden Architekturprojekte und ihrer Ergebnisse.

![EA Delivery-Verwaltung](../assets/img/en/17_ea_delivery.png)

## Initiativenübersicht

Die Seite ist rund um **Initiative**-Karten organisiert. Jede Initiative zeigt:

| Feld | Beschreibung |
|------|-------------|
| **Name** | Name der Initiative |
| **Subtyp** | Idee, Programm, Projekt oder Epic |
| **Status** | Im Plan, Gefährdet, Aus dem Plan, Pausiert oder Abgeschlossen |
| **Artefakte** | Anzahl der verknüpften Diagramme und SoAW-Dokumente |

Sie können zwischen einer **Kartengalerie**-Ansicht und einer **Listen**-Ansicht wechseln und Initiativen nach Status filtern (Aktiv oder Archiviert).

Ein Klick auf eine Initiative klappt sie auf und zeigt alle verknüpften **Diagramme** und **SoAW-Dokumente**.

## Statement of Architecture Work (SoAW)

Ein **Statement of Architecture Work (SoAW)** ist ein formales Dokument, das durch den [TOGAF-Standard](https://pubs.opengroup.org/togaf-standard/) (The Open Group Architecture Framework) definiert wird. Es legt den Umfang, Ansatz, die Ergebnisse und die Governance für ein Architekturvorhaben fest. In TOGAF wird das SoAW während der **Vorbereitungsphase** und **Phase A (Architekturvision)** erstellt und dient als Vereinbarung zwischen dem Architekturteam und seinen Stakeholdern.

Turbo EA bietet einen integrierten SoAW-Editor mit TOGAF-konformen Abschnittsvorlagen, Rich-Text-Bearbeitung und Exportfunktionen — so können Sie SoAW-Dokumente direkt neben Ihren Architekturdaten erstellen und verwalten.

### Ein SoAW erstellen

1. Klicken Sie auf **+ Neues SoAW** innerhalb einer Initiative
2. Geben Sie den Dokumenttitel ein
3. Der Editor öffnet sich mit **vorgefertigten Abschnittsvorlagen** basierend auf dem TOGAF-Standard

### Der SoAW-Editor

Der Editor bietet:

- **Rich-Text-Bearbeitung** — Vollständige Formatierungswerkzeugleiste (Überschriften, Fett, Kursiv, Listen, Links) unterstützt durch den TipTap-Editor
- **Abschnittsvorlagen** — Vordefinierte Abschnitte gemäß TOGAF-Standards (z.B. Problembeschreibung, Ziele, Ansatz, Stakeholder, Einschränkungen, Arbeitsplan)
- **Inline bearbeitbare Tabellen** — Tabellen in jedem Abschnitt hinzufügen und bearbeiten
- **Status-Workflow** — Dokumente durchlaufen definierte Phasen:

| Status | Bedeutung |
|--------|-----------|
| **Entwurf** | Wird geschrieben, noch nicht bereit zur Überprüfung |
| **In Überprüfung** | Zur Stakeholder-Überprüfung eingereicht |
| **Genehmigt** | Überprüft und akzeptiert |
| **Unterschrieben** | Formal abgezeichnet |

### Abzeichnungsworkflow

Sobald ein SoAW genehmigt ist, können Sie Abzeichnungen von Stakeholdern anfordern. Das System verfolgt, wer unterschrieben hat, und sendet Benachrichtigungen an ausstehende Unterzeichner.

### Vorschau und Export

- **Vorschaumodus** — Schreibgeschützte Ansicht des vollständigen SoAW-Dokuments
- **DOCX-Export** — Das SoAW als formatiertes Word-Dokument zum Offline-Teilen oder Drucken herunterladen
