# Erweiterungen

Der **Extension Store** (Admin → Erweiterungen) installiert vom Anbieter signierte Erweiterungen, die kundenspezifische Funktionen hinzufügen — zusätzliche Metamodell-Inhalte, Integrationen, Hintergrundjobs und sogar neue Seiten — ohne den Turbo-EA-Kern zu verändern („Clean Core“-Prinzip).

Erweiterungen lassen sich auf zwei Wegen installieren: **mit einem Klick aus dem integrierten Store** (sofern die Instanz Internetzugang hat) oder durch **direktes Hochladen der Dateien** — die Erweiterung ist ein signiertes `.teax`-Paket, die Lizenz eine signierte Textdatei, beide typischerweise per E-Mail versandt. Der dateibasierte Weg benötigt weder Store-Konto noch ausgehende Verbindung, sodass der gesamte Ablauf identisch auf **abgeschotteten (air-gapped)** Instanzen funktioniert.

Die Seite hat zwei Tabs: **Store** durchsucht den Erweiterungskatalog Ihres Anbieters mit Ein-Klick-Installation, **Installiert** verwaltet Lizenzen und installiert aus Dateien.

**Erweiterungen werden von Turbo EA erstellt und signiert** — sie sind nicht selbst erstellbar und nicht für Dritte offen. Wenn Sie eine auf Ihre Organisation zugeschnittene Funktion benötigen, erstellen und lizenzieren wir sie für Sie. Siehe [Turbo-EA-Beratung](https://www.turbo-ea.org/consulting).

## So funktioniert das Vertrauensmodell

Zwei unabhängige Prüfungen schützen Ihre Instanz:

1. **Herkunft (Signatur).** Jedes Paket trägt eine Ed25519-Signatur des Anbieter-Schlüssels. Turbo EA prüft sie beim Hochladen *und erneut bei jedem Backend-Start*. Unsignierte, manipulierte oder fremde Pakete werden abgelehnt — eine installierte Erweiterung ist garantiert genau das, was der Anbieter gebaut hat.
2. **Aktivierung (Lizenz).** Eine signierte Lizenzdatei enthält Ihre Berechtigungen — eine pro Erweiterung, jede mit eigenem Ablaufdatum. Eine installierte Erweiterung läuft nur, solange eine gültige Berechtigung existiert. Lizenzen sind **an Ihre Instanz-ID gebunden** — eine für eine andere Instanz ausgestellte Lizenz wird abgelehnt.

## Ihre Instanz-ID

Jede Installation erzeugt einmalig eine eindeutige **Instanz-ID** (`TEA-XXXX-XXXX-XXXX`), die oben auf Admin → Erweiterungen mit einem Kopier-Button angezeigt wird. Sie ist Ihre Lizenzidentität: Geben Sie sie beim Kauf an (der In-App-Store sendet sie automatisch; die Storefront-Kasse fragt danach), damit jede für diese Instanz gekaufte Erweiterung — von jedem Administrator, unter jeder E-Mail-Adresse — in einer gemeinsamen Lizenz landet. Sie identifiziert nur Ihre Instanz; sie ist niemals ein Zugangsschlüssel und kann daher bedenkenlos an Ihren Anbieter weitergegeben werden.

Die ID wandert mit einem Workspace-Transfer mit, sodass ein Umzug auf einen neuen Host die Lizenz gültig lässt. Nach einer **Neuinstallation** erhält die Instanz eine neue ID — bitten Sie Ihren Anbieter, die Lizenz dafür neu auszustellen (ein schnelles „Re-Key" auf dessen Seite).

## Der Store-Tab

Der Tab **Store** funktioniert ohne jede Konfiguration und listet die veröffentlichten Erweiterungen des Anbieters mit Beschreibung und Preis:

- **Kaufen** öffnet die Zahlungsseite in einem neuen Browser-Tab. Sobald die Zahlung bestätigt ist, wird Ihre Lizenz automatisch angewendet (eine Kopie kommt zusätzlich per E-Mail).
- **Installieren** (bzw. **Aktualisieren**, wenn eine neuere Version veröffentlicht ist) prüft zuerst Ihre Lizenz — fehlt sie, bietet ein Dialog Kauf oder Einfügen einer Lizenz an und fährt danach automatisch fort — und lädt das Paket durch exakt dieselbe Signaturprüfung und Dry-Run-Vorschau wie ein manueller Upload. Erweiterungen mit Demo zeigen einen **In Aktion ansehen**-Link, und eine veröffentlichte neuere Version macht aus der Schaltfläche **Aktualisieren**.

Der Store-Tab ist schreibgeschützt und anonym: kein Konto, kein Token, und es werden keinerlei Informationen über Ihre Instanz übertragen — es wird nur der öffentliche Katalog des Anbieters gelesen. Abgeschottete Instanzen brauchen keine Konfiguration — der Tab zeigt dann einfach einen freundlichen Hinweis — und nutzen den dateibasierten Ablauf unten; die Storefront-Website des Anbieters bietet dieselben Käufe und Downloads von jedem Browser mit Internetzugang.

## Eine Erweiterung installieren

1. Falls noch nicht geschehen, wenden Sie zuerst Ihre Lizenz an (siehe unten).
2. Öffnen Sie **Admin → Erweiterungen**, wählen Sie im Store-Tab **Aus Datei installieren…** und laden Sie die erhaltene `.teax`-Datei hoch.
3. Turbo EA prüft die Signatur und zeigt eine **Vorschau**: Bei Erweiterungen mit Inhalten ist das ein Probelauf aller Kartentypen, Tag-Gruppen, Karten und Beziehungen, die die Erweiterung anlegen oder aktualisieren würde — es wird noch nichts geschrieben.
4. Prüfen Sie die Vorschau und klicken Sie auf **Erweiterung installieren**.
5. Enthält die Erweiterung Backend-Code, fordert ein Banner zum Neustart des Backend-Containers auf (`docker compose restart backend`). Inhalts- und UI-Erweiterungen sind sofort aktiv — Benutzer erhalten neue Oberflächen beim nächsten Laden der Seite.

Das erneute Hochladen desselben Pakets ist unbedenklich — die Vorschau zeigt alles als „übersprungen“ und das Anwenden ändert nichts.

## Lizenzen und Verlängerung

Wenden Sie eine Lizenz über **Lizenz eingeben…** im Tab Installiert an (Text einfügen oder Datei hochladen) — die Schaltfläche erscheint auch an jeder Erweiterungszeile, der eine Lizenz fehlt. Die Seite zeigt dann den Lizenznehmer sowie einen Chip pro Berechtigung mit Ablaufdatum.

Überschreitet eine Berechtigung ihr Ablaufdatum, beginnt eine **Kulanzfrist** (standardmäßig 30 Tage): Alles funktioniert weiter, Administratoren sehen einen Warnhinweis. Danach wird die Erweiterung **weich deaktiviert** — ihre Seiten verschwinden, ihre API lehnt Anfragen ab, ihre Hintergrundjobs pausieren. **Es werden niemals Daten gelöscht.** Das Anwenden einer erneuerten Lizenzdatei stellt sofort alles wieder her, ohne Neustart.

Über den Store gekaufte Lizenzen verlängern sich auf verbundenen Instanzen von selbst: Nach jeder erfolgreichen Zahlung holt Ihre Instanz die verlängerte Lizenz automatisch — nichts einzufügen. Auf einer abgeschotteten Instanz gilt: die aktualisierte Lizenzdatei aus der Verlängerungs-E-Mail einfügen (oder beim Anbieter anfordern) — fertig.

## Aktivieren, Deaktivieren und Deinstallieren

- Der Schalter **Aktiviert** deaktiviert eine Erweiterung sofort weich (ohne Neustart) und lässt sich jederzeit zurückschalten. Bei Inhaltspaketen werden dabei ihre Kartentypen im Metamodell ausgeblendet — Karten bleiben, wo sie sind.
- **Deinstallieren** entfernt die Dateien der Erweiterung und blendet ihre Kartentypen im Metamodell aus. Karten und die eigenen Tabellen der Erweiterung bleiben bewusst erhalten, und bei einer Neuinstallation erscheint alles — Typen eingeschlossen — wieder.

## Berechtigungen

Die gesamte Seite und alle zugehörigen API-Routen sind durch die dedizierte Berechtigung `admin.manage_extensions` geschützt (der eingebauten Admin-Rolle zugewiesen). Erweiterungen können eigene Berechtigungsschlüssel definieren (`ext.<name>.…`), die nach dem Laden der Erweiterung unter **Admin → Benutzer & Rollen** erscheinen.

## Erweiterte Feldfunktionen

Manche Erweiterungen schalten erweiterte Möglichkeiten frei, Ihre Daten zu beschreiben, die der Kern von sich aus nicht bietet:

- **Feld-Hilfetext** — ein aufklappbarer Hinweis unter einem Feld, der bei der Dateneingabe angezeigt wird, sodass sich ein Formular selbst erklärt.
- **Benutzerdefinierte Feldtypen** — neue Feldarten über den eingebauten Satz hinaus (zum Beispiel eine konfigurierbare Bewertung von 1–5 oder 0–10).

Diese Optionen erscheinen im Feldeditor des Metamodells **nur, solange die bereitstellende Erweiterung installiert und lizenziert ist**. Wird eine solche Erweiterung später deaktiviert oder läuft ihre Lizenz ab, werden bereits erfasste Werte weiterhin als einfacher, schreibgeschützter Text angezeigt — nichts wird geleert oder gelöscht — und die Bearbeitungsoptionen verschwinden einfach, bis die Erweiterung wieder aktiv ist.

## Wo Erweiterungsseiten erscheinen

Erweiterungsseiten erscheinen in der Navigation, sobald die Erweiterung installiert und lizenziert ist — in der Regel als eigener Menüpunkt der obersten Ebene, wobei einige Berichte unter dem Menü **Berichte** neben den eingebauten platziert werden.
