# Benachrichtigungen

Turbo EA hält Sie über Änderungen an Karten, Aufgaben und Dokumenten, die für Sie relevant sind, auf dem Laufenden. Benachrichtigungen werden **in der Anwendung** (über die Benachrichtigungsglocke) und optional **per E-Mail** zugestellt, sofern SMTP konfiguriert ist.

## Benachrichtigungsglocke

Das **Glockensymbol** in der oberen Navigationsleiste zeigt ein Badge mit der Anzahl ungelesener Benachrichtigungen. Klicken Sie darauf, um ein Dropdown mit Ihren 20 neuesten Benachrichtigungen zu öffnen.

Jede Benachrichtigung zeigt:

- **Symbol**, das den Benachrichtigungstyp anzeigt
- **Zusammenfassung** des Geschehens (z.B. «Eine Aufgabe wurde Ihnen für SAP S/4HANA zugewiesen»)
- **Zeitangabe** seit der Erstellung der Benachrichtigung (z.B. «vor 5 Minuten»)

Klicken Sie auf eine beliebige Benachrichtigung, um direkt zur relevanten Karte oder zum Dokument zu navigieren. Benachrichtigungen werden automatisch als gelesen markiert, wenn Sie sie anzeigen.

## Benachrichtigungstypen

| Typ | Auslöser |
|-----|----------|
| **Aufgabe zugewiesen** | Eine Aufgabe wird Ihnen zugewiesen |
| **Karte aktualisiert** | Eine Karte, bei der Sie Stakeholder sind, wird aktualisiert |
| **Kommentar hinzugefügt** | Ein neuer Kommentar wird auf einer Karte gepostet, bei der Sie Stakeholder sind |
| **Genehmigungsstatus geändert** | Der Genehmigungsstatus einer Karte ändert sich (genehmigt, abgelehnt, ungültig) |
| **SoAW-Unterschrift angefordert** | Sie werden gebeten, ein Statement of Architecture Work zu unterschreiben |
| **SoAW unterschrieben** | Ein SoAW, das Sie verfolgen, erhält eine Unterschrift |
| **Umfrageanfrage** | Eine Umfrage wurde gesendet, die Ihre Antwort erfordert |

## Echtzeit-Zustellung

Benachrichtigungen werden in Echtzeit über Server-Sent Events (SSE) zugestellt. Sie müssen die Seite nicht aktualisieren — neue Benachrichtigungen erscheinen automatisch und die Badge-Anzahl wird sofort aktualisiert.

## Benachrichtigungseinstellungen

Klicken Sie auf das **Zahnradsymbol** im Benachrichtigungs-Dropdown (oder gehen Sie zu Ihrem Profilmenü), um Ihre Benachrichtigungseinstellungen zu konfigurieren.

Für jeden Benachrichtigungstyp können Sie unabhängig umschalten:

- **In der App** — Ob sie in der Benachrichtigungsglocke erscheint
- **E-Mail** — Ob zusätzlich eine E-Mail gesendet wird (erfordert SMTP-Konfiguration durch einen Administrator)

Einige Benachrichtigungstypen (z.B. Umfrageanfragen) können eine vom System erzwungene E-Mail-Zustellung haben und können nicht deaktiviert werden.
