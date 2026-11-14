# EA Delivery

Das **EA Delivery**-Modul verwaltet **Architekturinitiativen und deren Artefakte** — Diagramme, Statements of Architecture Work (SoAW) und Architecture Decision Records (ADR). Es bietet eine einheitliche Ansicht aller laufenden Architekturprojekte und ihrer Ergebnisse.

Wenn PPM aktiviert ist — die übliche Konfiguration — lebt EA Delivery **innerhalb des PPM-Moduls**: Öffnen Sie **PPM** in der Top-Navigation und wechseln Sie auf den Reiter **EA Delivery** (`/ppm?tab=ea-delivery`). Wenn PPM deaktiviert ist, erscheint **EA Delivery** im Menü **IT Governance** als **EA Governance** (mit Link zu `/reports/ea-delivery`); ist GRC ausgeschaltet oder darf Ihre Rolle IT Governance nicht öffnen, erscheint stattdessen ein Top-Level-Eintrag **EA Delivery**. Die alte URL `/ea-delivery` funktioniert in beiden Fällen weiterhin als Weiterleitung, sodass bestehende Lesezeichen erhalten bleiben.

![EA Delivery-Verwaltung](../assets/img/de/17_ea_lieferung.png)

## Initiativen-Arbeitsbereich

EA Delivery ist ein **Zwei-Spalten-Arbeitsbereich** (ohne interne Reiter):

- **Linke Seitenleiste** — ein eingerückter, filterbarer Baum aller Initiativen (mit verschachtelten Unterinitiativen). Suchen Sie nach Namen, filtern Sie nach Status / Subtyp / Artefakten oder markieren Sie Favoriten.
- **Rechter Arbeitsbereich** — die Lieferobjekte, untergeordneten Initiativen und Details der links ausgewählten Initiative. Bei der Auswahl einer anderen Zeile wird der Arbeitsbereich neu aufgebaut.

Die Auswahl ist Teil der URL (`?initiative=<id>`), sodass Sie eine bestimmte Initiative direkt verlinken oder die Seite neu laden können, ohne den Kontext zu verlieren.

Eine zentrale primäre Schaltfläche **+ Neues Artefakt ▾** oben auf der Seite erlaubt es, ein neues SoAW, Diagramm oder ADR anzulegen — automatisch mit der ausgewählten Initiative verknüpft (oder unverknüpft, wenn keine Auswahl getroffen wurde). Leere Lieferobjekt-Gruppen im Arbeitsbereich bieten zudem eine **+ Hinzufügen …**-Schaltfläche, sodass das Anlegen immer nur einen Klick entfernt ist.

Jede Baumzeile zeigt:

| Element | Bedeutung |
|---------|-----------|
| **Name** | Name der Initiative |
| **Anzahl-Chip** | Gesamtzahl verknüpfter Artefakte (SoAW + Diagramme + ADRs) |
| **Status-Punkt** | Farbpunkt für Im Plan / Gefährdet / Aus dem Plan / Pausiert / Abgeschlossen |
| **Stern** | Favoriten-Umschalter — Favoriten erscheinen oben |

Die synthetische Zeile **Nicht verknüpfte Artefakte** oben im Baum erscheint, wenn es SoAWs, Diagramme oder ADRs gibt, die noch keiner Initiative zugeordnet sind. Öffnen Sie sie, um sie wieder zu verknüpfen.

### Wer was sieht

EA Delivery öffnet sich für jede Rolle, die **SoAW-Dokumente anzeigen** (`soaw.view`) oder **Architekturentscheidungen anzeigen** (`adr.view`) besitzt. Jede Art von Artefakt folgt dann ihrer eigenen Berechtigung:

| Artefakt | Aufgelistet mit | Erstellt mit |
|----------|-------------|--------------|
| **SoAW** | `soaw.view` | `soaw.manage` |
| **Diagramm** | `diagrams.view` | `diagrams.manage` (auch zum Verknüpfen oder Lösen eines Diagramms erforderlich) |
| **ADR** | `adr.view` | `adr.manage` |

Eine Gruppe, die Sie nicht sehen dürfen, fehlt im Arbeitsbereich, und **+ Neues Artefakt** sowie **+ Hinzufügen …** bieten nur die Arten an, die Sie erstellen dürfen — eine Rolle, die nur lesen kann, sieht keine der beiden Schaltflächen. Eine Rolle mit nur `adr.view` erhält also die Seite mit den Entscheidungen jeder Initiative und nichts zu SoAWs.

## Statement of Architecture Work (SoAW)

Ein **Statement of Architecture Work (SoAW)** ist ein formales Dokument, das durch den [TOGAF-Standard](https://pubs.opengroup.org/togaf-standard/) (The Open Group Architecture Framework) definiert wird. Es legt den Umfang, Ansatz, die Ergebnisse und die Governance für ein Architekturvorhaben fest. In TOGAF wird das SoAW während der **Vorbereitungsphase** und **Phase A (Architekturvision)** erstellt und dient als Vereinbarung zwischen dem Architekturteam und seinen Stakeholdern.

Turbo EA bietet einen integrierten SoAW-Editor mit TOGAF-konformen Abschnittsvorlagen, Rich-Text-Bearbeitung und Exportfunktionen — so können Sie SoAW-Dokumente direkt neben Ihren Architekturdaten erstellen und verwalten.

### Ein SoAW erstellen

1. Wählen Sie die Initiative links aus (optional — Sie können auch ein nicht verknüpftes SoAW erstellen).
2. Klicken Sie oben auf der Seite auf **+ Neues Artefakt ▾** (oder auf die **+ Hinzufügen**-Schaltfläche im Abschnitt *Lieferobjekte*) und wählen Sie **Neues Statement of Architecture Work**.
3. Geben Sie den Dokumenttitel ein.
4. Der Editor öffnet sich mit **vorgefertigten Abschnittsvorlagen** basierend auf dem TOGAF-Standard.

### Der SoAW-Editor

Der Editor bietet:

- **Rich-Text-Bearbeitung** — Vollständige Formatierungswerkzeugleiste (Überschriften, Fett, Kursiv, Listen, Links) unterstützt durch den TipTap-Editor
- **Links** — Eine eingegebene oder eingefügte URL wird beim Tippen zu einem Link, und jeder Link in einem Dokument öffnet sich in einem neuen Tab. Adressen in Dokumenten, die vor der Link-Unterstützung geschrieben wurden, werden bei der Anzeige verlinkt
- **Abschnittsvorlagen** — Vordefinierte Abschnitte gemäß TOGAF-Standards (z.B. Problembeschreibung, Ziele, Ansatz, Stakeholder, Einschränkungen, Arbeitsplan)
- **Inline bearbeitbare Tabellen** — Tabellen in jedem Abschnitt hinzufügen und bearbeiten
- **Erwähnungen** — geben Sie **@** in den Text eines Abschnitts ein, um eine Karte oder eine Entscheidung zu erwähnen (siehe [Diskussion, Erwähnungen und Verlauf](#soaw-collaboration))
- **Dokumentversionshistorie** — eine Tabelle, die die Autoren von Hand ausfüllen (Version, Datum, überarbeitet von, Beschreibung). Sie ist Teil des Dokuments und nicht die Ansicht [Verlauf](#soaw-collaboration)
- **Status-Workflow** — Dokumente durchlaufen definierte Phasen:

| Status | Bedeutung |
|--------|-----------|
| **Entwurf** | Wird geschrieben, noch nicht bereit zur Überprüfung |
| **In Überprüfung** | Zur Unterschrift gesendet — gesperrt, bis die Unterschriften zurückgerufen werden |
| **Genehmigt** | Überprüft und akzeptiert |
| **Unterschrieben** | Formal abgezeichnet |

### Abzeichnungsworkflow

Für ein SoAW im Entwurf oder ein genehmigtes SoAW können Sie Abzeichnungen von Stakeholdern anfordern. Klicken Sie auf **Unterschriften anfordern** und verwenden Sie das Suchfeld, um Unterzeichner nach Name oder E-Mail zu finden und hinzuzufügen. Das System verfolgt, wer unterschrieben hat, und sendet Benachrichtigungen an ausstehende Unterzeichner.

Ein SoAW in Überprüfung ist **gesperrt**, sodass die Unterzeichner genau das unterschreiben, was ihnen gesendet wurde: Nur seine Initiative lässt sich noch ändern. Um den Inhalt zu bearbeiten, klicken Sie auf **Unterschriften zurückrufen**; das SoAW kehrt dann in den Entwurf zurück. Ein Unterzeichner, der auf **Ablehnen** klickt, setzt es ebenfalls auf Entwurf zurück, unter derselben Revisionsnummer. Nur ein SoAW im Entwurf kann gelöscht werden.

### Revisionen

Ein unterzeichnetes SoAW ist schreibgeschützt. Klicken Sie auf **Neue Revision**, um daraus einen neuen Entwurf unter demselben Namen mit der nächsten Revisionsnummer zu beginnen. Es gibt jeweils nur eine offene Revision: Solange eine Revision entworfen wird, weist das unterzeichnete SoAW darauf hin und bietet **Revision öffnen** an, statt eine weitere zu beginnen. Nur die neueste Revision kann überarbeitet werden, und eine Ablehnung ändert die Revisionsnummer nicht.

Eine frühere Revision zeigt ein Banner mit einem Link zur aktuellen, und die Leiste **Revisionen** auf jeder Revision listet alle auf. Listen von SoAWs — die Lieferobjekte der Initiative, der SoAW-Reiter, der EA-Delivery-Bericht — zeigen die aktuelle Revision jedes Dokuments sowie jede Revision, die gerade entworfen wird.

### Diskussion, Erwähnungen und Verlauf {: #soaw-collaboration }

Ein SoAW hat dieselbe Diskussion, dieselben Erwähnungen und denselben Verlauf wie eine Entscheidung: die Diskussion in einem Bereich neben seinem Editor und seiner Vorschau, den Verlauf hinter der Schaltfläche **Verlauf** oben auf der Seite. Das gemeinsame Verhalten ist einmal beschrieben, im GRC-Leitfaden: [Diskussion](grc.md#decision-discussion), [Erwähnungen](grc.md#decision-mentions), [Verlauf](grc.md#decision-history) und [Bekannte Einschränkungen](grc.md#collaboration-limits). Was bei einem SoAW anders ist:

- **Wer posten darf.** Posten, Antworten, Erledigen und Wieder öffnen erfordern die Berechtigung `soaw.comment`, die Mitglieder und Administratoren standardmäßig besitzen und Betrachter nicht; das Lesen der Diskussion folgt `soaw.view`. Die Unterzeichner des SoAW können es immer kommentieren. Wer SoAWs bearbeiten darf (`soaw.manage`), kann jeden Kommentar löschen.
- **Abschnitte.** Ein Diskussionsstrang wird mit einem Abschnitts-Chip einem der eigenen Abschnitte des SoAW zugeordnet oder keinem (ein allgemeiner Diskussionsstrang). Ein SoAW hat viele Abschnitte, daher zeigt das Eingabefeld einen Chip für jeden bereits diskutierten Abschnitt und für den gewählten; **Mehr…** öffnet eine durchsuchbare Liste der übrigen. Die Chips oben in der Diskussion filtern sie nach Abschnitt, wie bei einer Entscheidung. Ein Diskussionsstrang, der einem inzwischen entfernten benutzerdefinierten Abschnitt zugeordnet ist, zeigt *Entfernter Abschnitt*. Jeder Abschnitt trägt neben seiner Überschrift dasselbe Chat-Symbol wie bei einer Entscheidung, im Editor und in der Vorschau, mit der Anzahl der offenen Diskussionsstränge, wenn es eine Diskussion gibt; ein Klick darauf öffnet die Diskussion zu diesem Abschnitt, mit dem bereits für einen neuen Kommentar ausgewählten Abschnitt.
- **Ablehnen.** Jeder Unterzeichner mit der Unterzeichnungsberechtigung (`soaw.sign`) — oder der Bearbeitungsberechtigung — darf ein SoAW ablehnen, wie bei Entscheidungen; bisher erforderte das Ablehnen die Bearbeitungsberechtigung. Der Grund eröffnet in der Diskussion einen Diskussionsstrang **Ablehnungsgrund**.
- **Erwähnungen.** Ein SoAW hat keine verknüpften Karten, daher werden die Karten, solange nach **@** nichts eingegeben ist, alphabetisch aufgelistet; in einem Kommentar stehen unter den Personen die Unterzeichner des SoAW zuerst. **Durchsuchen…** funktioniert wie bei einer Entscheidung.
- **Unterzeichnungsnotiz.** **Unterzeichnen** öffnet jetzt einen Dialog, in dem der Unterzeichner eine optionale Notiz hinzufügen kann; sie erscheint in der Diskussion als **Unterzeichnungsnotiz** und im Verlauf.
- **Verlauf.** Eine Version enthält den Namen des SoAW, seine Dokumentinformationen, seine Tabelle Dokumentversionshistorie und jeden Abschnitt; die Initiative ist nicht Teil einer Version. Der Verlauf hält fest, was mit dem Dokument geschieht; die Tabelle Dokumentversionshistorie im Dokument enthält nur, was ihre Autoren hineinschreiben. Ein SoAW im Status **Genehmigt** kann weiterhin bearbeitet werden; seine Speicherungen werden daher wie bei einem Entwurf als Versionen aufbewahrt, und eine frühere Version kann darin wiederhergestellt werden.

### Vorschau und Export

- **Vorschaumodus** — Schreibgeschützte Ansicht des vollständigen SoAW-Dokuments
- **DOCX-Export** — Das SoAW als formatiertes Word-Dokument zum Offline-Teilen oder Drucken herunterladen
- **PDF-Export** — Öffnet eine druckfertige Ansicht in einem neuen Tab; nutzen Sie *Als PDF speichern* im Browser. Erlauben Sie Pop-ups für diese Seite, falls sich nichts öffnet.

### SoAW-Reiter auf Initiative-Karten

![Initiative-Karte — SoAW-Reiter](../assets/img/de/55_initiative_soaw_tab.png)

Initiativen zeigen außerdem direkt auf ihrer Karten-Detailseite einen eigenen **SoAW**-Reiter. Der Reiter listet die aktuelle Revision jedes mit dieser Initiative verknüpften SoAW auf, dazu jede Revision, die gerade entworfen wird (Titel, Status-Chip, Revisionsnummer, Datum der letzten Änderung) mit einer **+ Neues SoAW**-Schaltfläche, die die aktuelle Initiative vorauswählt — so kannst du SoAWs erstellen oder öffnen, ohne die Karte zu verlassen. Die Erstellung verwendet denselben Dialog wie die EA-Delivery-Seite, und das neue Dokument erscheint an beiden Stellen. Der Reiter wird Rollen angezeigt, die **SoAW-Dokumente anzeigen** (`soaw.view`) besitzen; die Schaltfläche **+ Neues SoAW** und die Lösch-Aktion bei einem Entwurf erfordern **SoAW-Dokumente erstellen und bearbeiten** (`soaw.manage`) — unabhängig davon, ob Sie die Initiative selbst bearbeiten können.

## Architecture Decision Records (ADR)

Ein **Architecture Decision Record (ADR)** hält eine wichtige Architekturentscheidung samt Kontext, Konsequenzen und erwogenen Alternativen fest. Der EA-Delivery-Arbeitsbereich zeigt ADRs, die **mit der gewählten Initiative verknüpft** sind, inline unter dem Deliverable-Abschnitt *Architekturentscheidungen* — so können Sie sie lesen und öffnen, ohne die Initiative-Ansicht zu verlassen. Mit der Split-Schaltfläche **+ Neues Artefakt ▾** (oder **+ Hinzufügen** im Abschnitt) legen Sie ein neues ADR an, das automatisch mit der gewählten Initiative verknüpft wird.

Das **zentrale ADR-Register** — wo alle ADRs landschaftsweit gefiltert, durchsucht, abgezeichnet, revidiert und in der Vorschau betrachtet werden — liegt im GRC-Modul unter **GRC → Governance → [Entscheidungen](grc.md#governance)**. Den vollständigen ADR-Lebenszyklus (Spalten, Filtersidebar, Abzeichnungs-Workflow, Revisionen, Vorschau) finden Sie im GRC-Leitfaden.

## Registerkarte Ressourcen

![Karten-Ressourcen-Tab](../assets/img/de/17c_karten_ressourcen.png)

Karten enthalten jetzt eine **Ressourcen**-Registerkarte, die Folgendes zusammenfasst:

- **Architekturentscheidungen** — ADRs werden hier nicht mehr aufgeführt. Jede Karte besitzt jetzt einen eigenen **ADRs**-Tab; siehe [Kartendetails](card-details.md) dazu, was er anzeigt und wie Sie Entscheidungen mit einer Karte verknüpfen, erstellen oder die Verknüpfung aufheben.
- **Dateianhänge** — Dateien hochladen und verwalten (Dokumente, Tabellen, Präsentationen, OpenDocument- und ältere Office-Dateien, Bilder, Archive, Outlook- und E-Mail-Nachrichten, CSV, Markdown, JSON und XML – bis zu 20 MB). Beim Hochladen wählen Sie eine **Dokumentenkategorie** aus: Architektur, Sicherheit, Compliance, Betrieb, Besprechungsnotizen, Design oder Sonstiges. Die Kategorie wird als Chip neben jeder Datei angezeigt.
- **Dokumentenlinks** — URL-basierte Dokumentenverweise. Beim Hinzufügen eines Links wählen Sie einen **Linktyp** aus: Dokumentation, Sicherheit, Compliance, Architektur, Betrieb, Support oder Sonstiges. Der Linktyp wird als Chip neben jedem Link angezeigt, und das Symbol ändert sich je nach ausgewähltem Typ.
