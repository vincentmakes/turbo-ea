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

Sobald ein SoAW genehmigt ist, können Sie Abzeichnungen von Stakeholdern anfordern. Klicken Sie auf **Unterschriften anfordern** und verwenden Sie das Suchfeld, um Unterzeichner nach Name oder E-Mail zu finden und hinzuzufügen. Das System verfolgt, wer unterschrieben hat, und sendet Benachrichtigungen an ausstehende Unterzeichner.

### Vorschau und Export

- **Vorschaumodus** — Schreibgeschützte Ansicht des vollständigen SoAW-Dokuments
- **DOCX-Export** — Das SoAW als formatiertes Word-Dokument zum Offline-Teilen oder Drucken herunterladen

## Architecture Decision Records (ADR)

Ein **Architecture Decision Record (ADR)** dokumentiert wichtige Architekturentscheidungen zusammen mit ihrem Kontext, den Konsequenzen und den erwogenen Alternativen. ADRs bieten eine nachvollziehbare Historie, warum zentrale Designentscheidungen getroffen wurden.

### ADR-Übersicht

Die EA Delivery-Seite verfügt über einen eigenen **Entscheidungen**-Tab, der alle ADRs auflistet. Jedes ADR zeigt:

- Referenznummer (automatisch generiert: ADR-001, ADR-002 usw.)
- Titel
- Status (Entwurf, In Überprüfung, Unterschrieben)
- Verknüpfte Initiativen (über Kartenverknüpfung)
- Unterzeichner und deren Status

Sie können nach Status filtern und nach Titel oder Referenznummer suchen.

### Ein ADR erstellen

ADRs können von drei Stellen aus erstellt werden:

1. **EA Delivery → Entscheidungen-Tab**: Klicken Sie auf **+ Neues ADR**, geben Sie den Titel ein und verknüpfen Sie optional Karten (einschließlich Initiativen).
2. **Initiative-„+"-Knopf** (Initiativen-Tab): Wählen Sie **Neue Architekturentscheidung** aus dem Menü — die Initiative wird automatisch als Kartenverknüpfung hinzugefügt.
3. **Karten-Ressourcen-Tab**: Klicken Sie auf **ADR erstellen** — die aktuelle Karte wird automatisch verknüpft.

In allen Fällen können Sie während der Erstellung weitere Karten suchen und verknüpfen. Initiativen werden über denselben Kartenverknüpfungsmechanismus wie jede andere Karte verknüpft, sodass ein ADR mit mehreren Initiativen verknüpft werden kann. Der Editor öffnet sich mit Abschnitten für Kontext, Entscheidung, Konsequenzen und Erwogene Alternativen.

### Der ADR-Editor

Der Editor bietet:

- Rich-Text-Bearbeitung für jeden Abschnitt (Kontext, Entscheidung, Konsequenzen, Erwogene Alternativen)
- Kartenverknüpfung — verbinden Sie das ADR mit relevanten Karten (Anwendungen, IT-Komponenten, Initiativen usw.). Initiativen werden über die Standard-Kartenverknüpfung verknüpft, nicht über ein eigenes Feld, sodass ein ADR mehrere Initiativen referenzieren kann
- Verwandte Entscheidungen — referenzieren Sie andere ADRs

### Abzeichnungsworkflow

ADRs unterstützen einen formalen Abzeichnungsprozess:

1. Erstellen Sie das ADR im Status **Entwurf**
2. Klicken Sie auf **Unterschriften anfordern** und suchen Sie Unterzeichner nach Name oder E-Mail
3. Das ADR wechselt zu **In Überprüfung** — jeder Unterzeichner erhält eine Benachrichtigung und eine Aufgabe
4. Unterzeichner prüfen und klicken auf **Unterschreiben**
5. Wenn alle Unterzeichner unterschrieben haben, wechselt das ADR automatisch zum Status **Unterschrieben**

Unterschriebene ADRs sind gesperrt und können nicht bearbeitet werden. Um Änderungen vorzunehmen, erstellen Sie eine **neue Revision**.

### Revisionen

Unterschriebene ADRs können überarbeitet werden:

1. Öffnen Sie ein unterschriebenes ADR
2. Klicken Sie auf **Überarbeiten**, um einen neuen Entwurf basierend auf der unterschriebenen Version zu erstellen
3. Die neue Revision übernimmt den Inhalt und die Kartenverknüpfungen
4. Jede Revision hat eine fortlaufende Revisionsnummer

### ADR-Vorschau

Klicken Sie auf das Vorschau-Symbol, um eine schreibgeschützte, formatierte Version des ADR anzuzeigen — nützlich zur Überprüfung vor der Unterschrift.

## Registerkarte Ressourcen

Karten enthalten jetzt eine **Ressourcen**-Registerkarte, die Folgendes zusammenfasst:

- **Architekturentscheidungen** — mit dieser Karte verknüpfte ADRs. Sie können bestehende ADRs verknüpfen oder ein neues ADR direkt über die Ressourcen-Registerkarte erstellen — das neue ADR wird automatisch mit der Karte verknüpft.
- **Dateianhänge** — Dateien hochladen und verwalten (PDF, DOCX, XLSX, Bilder, bis zu 10 MB)
- **Dokumentenlinks** — URL-basierte Dokumentenverweise
