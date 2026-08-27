# Slack Notifications

Ihr Team lebt ohnehin in Slack. **Slack Notifications** sendet jeder Person ihre
Turbo-EA-Benachrichtigungen als **Slack-Direktnachricht** — ein zugewiesenes
Todo, eine Entscheidung, die auf ihre Unterschrift wartet, ein Risiko, das auf
ihrem Tisch gelandet ist — mit einer Schaltfläche direkt zurück zur Karte.

Die Kontrolle bleibt bei jedem selbst: In den eigenen
Benachrichtigungseinstellungen erscheint neben In-App und E-Mail eine Spalte
**Slack**, in der man genau ankreuzt, welche Benachrichtigungstypen dort ankommen
sollen. **Standardmäßig ist nichts eingeschaltet.**

## Auf einen Blick

| | |
|---|---|
| **Lizenz** | Kommerziell — eine signierte Berechtigung ist erforderlich |
| **Mindestversion von Turbo EA** | 2.89.1 |
| **Berechtigung** | `ext.slack-notify.admin` |
| **Datenzugriffs-Grants** | `core.notifications.channel`, `core.users.read` |
| **Backend-Neustart nötig** | ja — die Erweiterung enthält Backend-Code |
| **Wo sie erscheint** | **Admin → Einstellungen → Integrationen → Slack** · eine Spalte **Slack** in den [Benachrichtigungseinstellungen](../guide/notifications.md) aller Personen |

Erforderlich ist nur **ausgehendes HTTPS zu `slack.com`** — keine eingehende
URL, kein OAuth-Callback und keine Slack-Marketplace-Prüfung. Die Erweiterung
funktioniert daher auch auf selbst gehosteten oder abgeschotteten Instanzen.

## Einrichtung

Öffnen Sie **Admin → Einstellungen → Integrationen** und wählen Sie den
Unterreiter **Slack**. Das Panel führt Sie durch drei nummerierte Schritte.

### 1. Slack-App erstellen

Das Panel zeigt ein fertiges **App-Manifest**. Wählen Sie in Slack **Create New
App → From a manifest**, wählen Sie Ihren Workspace, fügen Sie das Manifest ein
(es gibt eine Schaltfläche **Manifest kopieren**), dann **Install to Workspace**
und kopieren Sie das **Bot User OAuth Token** — es beginnt mit `xoxb-`.

Das Manifest fordert genau vier Bot-Scopes an, sonst nichts:

| Scope | Wofür |
|---|---|
| `chat:write` | Die Direktnachricht senden |
| `im:write` | Die Direktnachricht-Unterhaltung mit einer Person öffnen |
| `users:read` | Das Mitgliederverzeichnis lesen |
| `users:read.email` | Ein Turbo-EA-Konto per E-Mail einem Slack-Mitglied zuordnen |

!!! warning "Token-Rotation ausgeschaltet lassen"
    Das Manifest deaktiviert Slacks **Token-Rotation** bewusst. Eingeschaltet
    läuft das Bot-Token alle 12 Stunden ab — was diese Version nicht erneuern
    kann; die Zustellung würde zweimal täglich stoppen.

### 2. Workspace verbinden

| Feld | Hinweise |
|---|---|
| **Bot-User-OAuth-Token** | Das `xoxb-…`-Token. Verschlüsselt gespeichert; später leer lassen, um es zu behalten |
| **In Slack-Nachrichten angezeigter Name** | Standard *Turbo EA*. Wird in Schaltfläche und Fußzeile der Nachricht verwendet |
| **Benachrichtigungen an Slack senden** | Standardmäßig an — ein Pausenschalter, kein Einrichtungsschritt |

Klicken Sie **Speichern**, dann **Verbindung testen**; eine Kachel bestätigt
*Connected to …*.

### 3. Personen zuordnen

Konten werden **über die E-Mail-Adresse** zugeordnet, sobald jemand zum ersten
Mal eine Nachricht erhalten soll; das Ergebnis wird zwischengespeichert. Die
Karte **Personen** listet alle auf, die problematischsten zuerst, mit Kacheln für
**verbunden**, **nicht in Slack** und **noch nicht geprüft**.

Wessen Slack-Adresse von der Turbo-EA-E-Mail abweicht, dem tragen Sie die
**Slack-Mitglieds-ID** (etwa `U01ABCDEF`) ein und klicken **Speichern** — eine
manuelle Zuordnung sticht die E-Mail-Zuordnung immer. **Testnachricht senden**
belegt, dass eine Zuordnung durchgängig funktioniert. Leeren des Feldes gibt die
Person wieder an die E-Mail-Suche zurück.

Personen, die Slack nicht kennt, werden automatisch einmal täglich erneut
geprüft; wer dem Slack-Workspace erst nach seinem Turbo-EA-Konto beitritt, wird
also ohne Zutun erfasst.

!!! note "Gespeichert werden nur Mitglieds-IDs"
    Die Erweiterung speichert Slack-Mitglieds-IDs und sonst nichts —
    E-Mail-Adressen bleiben in Turbo EA.

## Was jede Person selbst steuert

Sobald die Erweiterung läuft, erhält jede Person in den
**Benachrichtigungseinstellungen** eine Spalte **Slack**, neben In-App und
E-Mail.

![Die Spalte «Slack» im Dialog der Benachrichtigungseinstellungen](../assets/img/en/71_ext_slack_notification_preferences.png)

- **Jeder Typ ist standardmäßig aus.** Niemand erhält eine Slack-Nachricht, bevor
  er diesen Typ für sich selbst eingeschaltet hat.
- Eine Fußzeile unter der Tabelle sagt jeder Person, ob ihr Konto mit Slack
  verbunden ist oder ob sie eine Administratorin oder einen Administrator um die
  Zuordnung bitten sollte.
- Die reine In-App-Ankündigung zu Produktaktualisierungen wird nie an Slack
  zugestellt.

Turbo EA entscheidet, welche Benachrichtigungstypen es gibt und wer sie
abonniert hat; die Erweiterung transportiert lediglich die Nachricht.

## Wie eine Nachricht aussieht

Eine Slack-Direktnachricht enthält den **Titel** der Benachrichtigung in
Fettschrift, den Nachrichtentext, eine Schaltfläche **Open in Turbo EA** (mit dem
von Ihnen konfigurierten Namen), die zur betreffenden Karte oder Seite führt, und
eine kleine Fußzeile mit App-Name und Benachrichtigungstyp.

Die Zustellung ist streng einseitig — von Turbo EA nach Slack — und immer eine
persönliche Direktnachricht. In Kanäle wird nie etwas gepostet.

## Zustellung überwachen

Die Karte **Zustellprotokoll** zeigt, wie viele Nachrichten **warten**,
**gesendet** und **fehlgeschlagen** sind, dazu die 50 jüngsten Protokollzeilen.

Nachrichten werden eingereiht und binnen Sekunden gesendet. Bei Rate-Limits oder
Fehlern von Slack wiederholt die Erweiterung den Versuch mit wachsendem Abstand
und gibt nach sechs Versuchen auf; dauerhafte Fehler — ein widerrufenes Token,
eine gelöschte Person, ein fehlender Scope — brechen sofort ab, statt sinnlos zu
wiederholen. Zugestellte Zeilen werden nach 14 Tagen entfernt.

Eine Warteschlange, die stillsteht, hat genau zwei Ursachen, und das Panel nennt
die zutreffende:

- **Es ist kein Bot-Token gespeichert** — Token einfügen und speichern.
- **Die Zustellung ist ausgeschaltet** — *Benachrichtigungen an Slack senden*
  wieder einschalten.

**Fehlgeschlagene erneut versuchen** reiht alles wieder ein, was aufgegeben
wurde, und prüft Personen erneut, die Slack nicht kannte. Das ist der Weg zurück
nach einem Ausfall oder einem Tokenwechsel.

## Berechtigungen

| Berechtigung | Erlaubt |
|---|---|
| `ext.slack-notify.admin` | Die Workspace-Verbindung konfigurieren, Personen zuordnen, Testnachrichten senden, das Zustellprotokoll lesen und Wiederholungen auslösen |

Der Unterreiter ist für alle anderen ausgeblendet. **Endanwenderinnen und
Endanwender brauchen keine zusätzliche Berechtigung** — sie setzen lediglich
Häkchen in ihren eigenen Benachrichtigungseinstellungen.

## Wenn die Lizenz abläuft oder die Erweiterung deaktiviert wird

Die Zustellung pausiert und die Spalte **Slack** verschwindet aus dem Dialog,
**alle Einstellungen und Opt-ins bleiben jedoch erhalten**. Eine erneuerte Lizenz
nimmt die Zustellung wieder auf. Dasselbe gilt für den Schalter
*Benachrichtigungen an Slack senden*, der die Zustellung pausiert, ohne etwas zu
deinstallieren — wartende Nachrichten bleiben einfach in der Warteschlange.

Das Bot-Token wird verschlüsselt gespeichert und ist vom Workspace-Transfer
ausgenommen.

## Grenzen

- **Nur Direktnachrichten** — keine Kanalbeiträge.
- **Keine interaktiven Schaltflächen.** Aktionen wie *Erledigt* oder *Genehmigen*
  direkt aus Slack heraus bietet diese Version nicht; die Nachricht verlinkt
  stattdessen zurück nach Turbo EA.
- **Keine Sammelnachrichten** — jede Benachrichtigung ist eine eigene Nachricht
  statt einer gebündelten Zusammenfassung.
- **Slack-Token-Rotation nicht einschalten** (siehe Warnung oben).
