# Dashboard

Das Dashboard ist der erste Bildschirm, den Sie nach der Anmeldung sehen. Es bietet einen **schnellen Überblick** über den gesamten Status der Unternehmensarchitektur.

![Dashboard - Obere Ansicht](../assets/img/de/01_dashboard.png)

## Obere Navigationsleiste

Am oberen Bildschirmrand finden Sie die **Hauptnavigationsleiste** mit folgenden Elementen:

- **Turbo EA** (Logo): Klicken Sie, um von jedem Bereich aus zum Dashboard zurückzukehren
- **Dashboard**: Übersicht über den Architekturstatus
- **Inventar**: Vollständige Auflistung aller Karten
- **Berichte**: Visuelle und analytische Berichte
- **BPM**: Business Process Management (wenn aktiviert)
- **Diagramme**: Visueller Architekturdiagramm-Editor
- **EA Delivery**: Verwaltung von Architekturinitiativen
- **Aufgaben**: Anstehende Aufgaben und zugewiesene Umfragen
- **Karten suchen**: Schnellsuchleiste mit Autovervollständigung
- **+ Erstellen**: Schaltfläche zum schnellen Erstellen neuer Karten
- **Benachrichtigungsglocke**: Systemhinweise und [Benachrichtigungen](notifications.md)
- **Profilsymbol**: Sprachauswahl, Design-Umschaltung, Benachrichtigungseinstellungen und Zugang zur Administration
- **Unterstützen**: Eine lila-pinke Schaltfläche neben der Versionsnummer im Profilmenü öffnet einen Dialog, der erklärt, warum Sponsoring wichtig ist, mit einem Link zum Blog und einmaligen oder monatlichen Optionen über GitHub Sponsors

## Zusammenfassungskarten

Der Hauptbereich des Dashboards zeigt **Zusammenfassungskarten** mit folgenden Informationen:

- **Gesamtzahl der Karten**: Anzahl aller in der Plattform erfassten Komponenten
- **Verteilung nach Typ**: Wie viele Elemente jedes Typs vorhanden sind (Anwendungen, Organisationen, Ziele, Fähigkeiten usw.)
- **Statusübersicht**: Schnelle Visualisierungen des Gesamtstatus

Ein Klick auf eine Typkarte navigiert zum [Inventar](inventory.md), vorgefiltert nach diesem Typ.

![Dashboard - Untere Ansicht mit Diagrammen](../assets/img/de/02_dashboard_unten.png)

## Diagramme und Statistiken

Im unteren Bereich des Dashboards finden Sie:

- **Verteilungsdiagramm nach Typ**: Zeigt den Anteil jedes Kartentyps in Ihrer Landschaft
- **Genehmigungsstatus**: Zeigt an, wie viele Karten genehmigt, ausstehend, ungültig oder abgelehnt sind
- **Datenqualität**: Gesamtprozentsatz der Informationsvollständigkeit über alle Karten
- **Letzte Aktivitäten**: Ein Feed der neuesten Änderungen — wer hat was wann bearbeitet

## Tab «Arbeitsbereich»

Der Tab **Arbeitsbereich** bündelt alles, was Ihnen zugewiesen ist: Favoriten, Aufgaben, ausstehende Umfragen, jüngste Aktivitäten auf Ihren Karten und den Abschnitt **Karten mit meiner Rolle**.

Letzterer gruppiert Karten nach der Stakeholder-Rolle, die Sie innehaben (Application Owner, Business Owner usw.), und listet die Karten unter jeder Rolle auf. Wenn Ihre Rolle die Berechtigung `stakeholders.view` umfasst (standardmäßig Admin, Member und Viewer), erscheint ein kleines **Personensuche**-Symbol neben dem Abschnittstitel: Wählen Sie damit einen anderen Benutzer aus der Autovervollständigung, und der Abschnitt wird mit dessen Rollen und Karten neu geladen. Der Titel ändert sich zu «Rollen von {name}». Mit dem kleinen Schließen-Symbol kehren Sie zu Ihren eigenen Rollen zurück. Praktisch für die Frage «Wem gehört was?» mit einem Klick.

## Admin-Tab — Stakeholder-Verzeichnis

Administratoren (jede Rolle mit `admin.users`) sehen am unteren Rand des Admin-Tabs ein Widget **Stakeholder-Verzeichnis**. Es listet jeden Kartentyp mit mindestens einem Stakeholder auf, jeweils mit der Anzahl der eindeutigen Inhaber. Klappen Sie einen Kartentyp auf, um seine Rollen zu sehen, und innerhalb jeder Rolle die Benutzer mit der Anzahl ihrer Karten. Klicken Sie auf einen Benutzer-Chip, um seine Kartenliste direkt darunter aufzuklappen — jeder Kartenname ist ein Link zur Karten-Detailseite. Der gesamte Baum (Kartentyp → Rolle → Benutzer → Karten) wird in einer einzigen Abfrage geladen, die Navigation ist also sofort.

Ein **Namensfilter** oben im Widget schränkt den Baum auf Benutzer ein, die dem eingegebenen Namen oder der E-Mail entsprechen; passende Kartentypen werden automatisch aufgeklappt, damit die Treffer ohne weiteren Klick sichtbar sind. Damit beantworten Sie «Wo erscheint Alice in der Organisation?» in einer Sekunde.

Über das Verzeichnis hinaus öffnet sich ein kleines **Hover-Popover**, sobald der Cursor an anderer Stelle in der App über einem Stakeholder-Namen pausiert — im Stakeholder-Tab einer Karte, beim Risikoeigentümer im Risikoregister oder auf der Risiko-Detailseite — und zeigt das vollständige rollenbasierte Stakeholder-Portfolio dieses Benutzers. Klicken Sie auf eine Karte im Popover, um zu ihr zu springen. Das Popover ruft pro Benutzer und Sitzung nur einmal die Daten ab.
