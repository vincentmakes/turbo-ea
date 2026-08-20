# Erweiterungen

Der **Extension Store** (Admin → Erweiterungen) installiert vom Anbieter signierte Erweiterungen, die kundenspezifische Funktionen hinzufügen — zusätzliche Metamodell-Inhalte, Integrationen, Hintergrundjobs und sogar neue Seiten — ohne den Turbo-EA-Kern zu verändern („Clean Core“-Prinzip).

Erweiterungen lassen sich auf zwei Wegen installieren: **mit einem Klick aus dem integrierten Store** (sofern die Instanz Internetzugang hat) oder durch **direktes Hochladen der Dateien** — die Erweiterung ist ein signiertes `.teax`-Paket, die Lizenz eine signierte Textdatei, beide typischerweise per E-Mail versandt. Der dateibasierte Weg benötigt weder Store-Konto noch ausgehende Verbindung, sodass der gesamte Ablauf identisch auf **abgeschotteten (air-gapped)** Instanzen funktioniert.

Die Seite hat zwei Tabs: **Store** durchsucht den Erweiterungskatalog Ihres Anbieters mit Ein-Klick-Installation, **Installiert** verwaltet Lizenzen und installiert aus Dateien.

**Erweiterungen werden von Turbo EA erstellt und signiert** — sie sind nicht selbst erstellbar und nicht für Dritte offen. Wenn Sie eine auf Ihre Organisation zugeschnittene Funktion benötigen, erstellen und lizenzieren wir sie für Sie. Siehe [Turbo-EA-Beratung](https://www.turbo-ea.org/consulting).

## So funktioniert das Vertrauensmodell

Zwei unabhängige Prüfungen schützen Ihre Instanz:

1. **Herkunft (Signatur).** Jedes Paket trägt eine Ed25519-Signatur des Anbieter-Schlüssels. Turbo EA prüft sie beim Hochladen *und erneut bei jedem Backend-Start*. Unsignierte, manipulierte oder fremde Pakete werden abgelehnt — eine installierte Erweiterung ist garantiert genau das, was der Anbieter gebaut hat.
2. **Aktivierung (Lizenz).** Eine signierte Lizenzdatei enthält Ihre Berechtigungen — eine pro Erweiterung, jede mit eigenem Ablaufdatum. Eine installierte Erweiterung läuft nur, solange eine gültige Berechtigung existiert. Lizenzen sind **an Ihre Instanz-ID gebunden** — eine für eine andere Instanz ausgestellte Lizenz wird abgelehnt.

## Kostenlose Erweiterungen

Manche Erweiterungen sind **kostenlos** und benötigen überhaupt keine Lizenz. Sie werden sofort installiert und ausgeführt — es gibt keinen Kaufschritt und keine einzufügende Lizenzdatei. Kostenlose Erweiterungen sind auf den Reitern „Store“ und „Installiert“ mit einem **Kostenlos**-Abzeichen gekennzeichnet, und die Aktionen **Kaufen** und **Erneuern** sind für sie ausgeblendet. Die Signaturprüfung gilt weiterhin genauso wie bei kostenpflichtigen Erweiterungen (eine kostenlose Erweiterung ist ebenfalls vom Anbieter signiert), sodass die Herkunft in jedem Fall garantiert ist. Da sie keine Berechtigung benötigen, laufen kostenlose Erweiterungen nie ab und treten nie in eine Kulanzfrist ein.

## Ihre Instanz-ID

Jede Installation erzeugt einmalig eine eindeutige **Instanz-ID** (`TEA-XXXX-XXXX-XXXX`), die oben auf Admin → Erweiterungen mit einem Kopier-Button angezeigt wird. Sie ist Ihre Lizenzidentität: Geben Sie sie beim Kauf an (der In-App-Store sendet sie automatisch; die Storefront-Kasse fragt danach), damit jede für diese Instanz gekaufte Erweiterung — von jedem Administrator, unter jeder E-Mail-Adresse — in einer gemeinsamen Lizenz landet. Sie identifiziert nur Ihre Instanz; sie ist niemals ein Zugangsschlüssel und kann daher bedenkenlos an Ihren Anbieter weitergegeben werden.

Die ID wandert mit einem Workspace-Transfer mit, sodass ein Umzug auf einen neuen Host die Lizenz gültig lässt. Nach einer **Neuinstallation** erhält die Instanz eine neue ID — bitten Sie Ihren Anbieter, die Lizenz dafür neu auszustellen (ein schnelles „Re-Key" auf dessen Seite).

## Der Store-Tab

Der Tab **Store** funktioniert ohne jede Konfiguration und listet die veröffentlichten Erweiterungen des Anbieters mit Beschreibung und Preis:

- **Kaufen** öffnet die Zahlungsseite in einem neuen Browser-Tab. Sobald die Zahlung bestätigt ist, wird Ihre Lizenz automatisch angewendet (eine Kopie kommt zusätzlich per E-Mail).
- **Installieren** (bzw. **Aktualisieren**, wenn eine neuere Version veröffentlicht ist) prüft zuerst Ihre Lizenz — fehlt sie, bietet ein Dialog Kauf oder Einfügen einer Lizenz an und fährt danach automatisch fort — und lädt das Paket durch exakt dieselbe Signaturprüfung und Dry-Run-Vorschau wie ein manueller Upload. Erweiterungen mit Demo zeigen einen **In Aktion ansehen**-Link, und eine veröffentlichte neuere Version macht aus der Schaltfläche **Aktualisieren**.

Wenn der Katalog Kategorien enthält, zeigt jeder Eintrag kleine Pillen (free oder commercial, plus Themen wie integration) und über der Liste erscheint eine Filterleiste — klicken Sie auf Pillen, um die Liste einzugrenzen (mehrere Pillen kombinieren sich), und **All** setzt die Ansicht zurück.

Der Store-Tab ist schreibgeschützt und anonym: kein Konto, kein Token, und es werden keinerlei Informationen über Ihre Instanz übertragen — es wird nur der öffentliche Katalog des Anbieters gelesen. Abgeschottete Instanzen brauchen keine Konfiguration — der Tab zeigt dann einfach einen freundlichen Hinweis — und nutzen den dateibasierten Ablauf unten; die Storefront-Website des Anbieters bietet dieselben Käufe und Downloads von jedem Browser mit Internetzugang. Wenn etwas zwischen Ihrer Instanz und dem Store die Anfrage blockiert — ein Proxy, eine Firewall oder ein Bot-Schutz vor dem Store —, sagt der Tab dies und nennt den zurückgegebenen HTTP-Status, sodass eine blockierte Instanz nie mit einer abgeschotteten verwechselt wird.

Die Instanz **prüft den Katalog außerdem einmal täglich** und meldet Änderungen, damit eine neue Erweiterung — oder ein Sicherheitsfix für eine bereits genutzte — nicht darauf warten muss, dass jemand zufällig diese Seite öffnet. Administratoren (alle, deren Rolle `admin.manage_extensions` gewährt) erhalten eine Benachrichtigung in der Glocke, wenn eine neue Erweiterung im Store veröffentlicht wird, und eine weitere, wenn für eine installierte Erweiterung eine neuere Version vorliegt. Jede Änderung wird einmal angekündigt, und ein ereignisreicher Release-Tag kommt als eine Benachrichtigung pro Art an, nicht als eine pro Erweiterung. Es wird nichts heruntergeladen oder installiert — die Benachrichtigung führt Sie lediglich hierher. Die tägliche Prüfung lässt sich unter [Admin → Einstellungen → Update-Benachrichtigungen](settings.md#update-notifications) vollständig deaktivieren.

## Testphasen

Einige kostenpflichtige Erweiterungen bieten eine **kostenlose 30-Tage-Testphase** — achten Sie auf die Schaltfläche **30-Tage-Test starten** im Store-Tab (oder auf die Testoption auf der Store-Website). Eine Testphase zu starten funktioniert wie ein Kauf ohne Bezahlung: Es wird keine Kreditkarte benötigt, Ihre Lizenz aktualisiert sich automatisch (für Air-Gapped-Installationen kommt zusätzlich eine Kopie per E-Mail), und die Erweiterung läuft 30 Tage lang mit vollem Funktionsumfang.

- Jede Turbo-EA-Instanz kann eine bestimmte Erweiterung **einmal** testen.
- Eine Testphase endet exakt am Enddatum — es gibt keine Kulanzfrist. Die Erweiterung stellt dann den Betrieb ein, bis Sie abonnieren; **Ihre Daten werden niemals gelöscht**, und alles ist sofort wieder da, sobald eine Abonnementlizenz angewendet wird.
- Der Tab «Installiert» zeigt Test-Berechtigungen als **Testphase bis …** an.
- Testphasen enden von selbst — es gibt nichts zu kündigen, und es wird niemals etwas berechnet.

## Eine Erweiterung installieren

1. Falls noch nicht geschehen, wenden Sie zuerst Ihre Lizenz an (siehe unten).
2. Öffnen Sie **Admin → Erweiterungen**, wählen Sie im Store-Tab **Aus Datei installieren…** und laden Sie die erhaltene `.teax`-Datei hoch.
3. Turbo EA prüft die Signatur und zeigt eine **Vorschau**: Bei Erweiterungen mit Inhalten ist das ein Probelauf aller Kartentypen, Tag-Gruppen, Karten und Beziehungen, die die Erweiterung anlegen oder aktualisieren würde — es wird noch nichts geschrieben.
4. Prüfen Sie die Vorschau und klicken Sie auf **Erweiterung installieren**.
5. Enthält die Erweiterung Backend-Code, fordert ein Banner zum Neustart des Backend-Containers auf (`docker compose restart backend`). Inhalts- und UI-Erweiterungen sind sofort aktiv — Benutzer erhalten neue Oberflächen beim nächsten Laden der Seite.

Das erneute Hochladen desselben Pakets ist unbedenklich — die Vorschau zeigt alles als „übersprungen“ und das Anwenden ändert nichts.

## Eine Erweiterung aktualisieren

Veröffentlicht der Store eine neuere Version einer installierten Erweiterung, zeigt der Tab «Installiert» neben der Version einen Chip **Auf X aktualisieren** (und die Schaltfläche im Store-Tab wird zu **Aktualisieren**). Ein Klick durchläuft dieselbe Signaturprüfung, Vorschau und Anwendung wie eine Neuinstallation. Zwei Schutzmechanismen greifen:

- Die Aktualisierung einer bewusst **deaktivierten** Erweiterung lässt sie deaktiviert — die neue Version landet auf der Festplatte, aber ihre Inhalte bleiben verborgen und nichts läuft, bis Sie sie wieder aktivieren.
- Die Installation eines Bundles, das **älter** ist als die installierte Version, verlangt zuerst eine ausdrückliche Bestätigung: Ein Downgrade versteht möglicherweise Daten nicht, die die neuere Version geschrieben hat. Gelöscht wird in keinem Fall etwas.

## Lizenzen und Verlängerung

Wenden Sie eine Lizenz über **Lizenz eingeben…** im Tab Installiert an (Text einfügen oder Datei hochladen) — die Schaltfläche erscheint auch an jeder Erweiterungszeile, der eine Lizenz fehlt. Die Seite zeigt dann den Lizenznehmer sowie einen Chip pro Berechtigung mit Ablaufdatum.

Ihre Instanz hält **jeweils nur eine Lizenz** — das Anwenden einer neuen ersetzt die vorherige. Über den Store ausgestellte Lizenzen enthalten immer alle Käufe Ihrer Instanz, das Ersetzen ist also sicher. Wenn Sie zusätzlich manuell ausgestellte Lizenzen besitzen, bitten Sie Ihren Anbieter um eine kombinierte Lizenz, statt Dateien pro Erweiterung anzuwenden; würde eine angewendete Lizenz Berechtigungen entfernen, die die aktuelle noch abdeckt, listet Turbo EA sie auf und fragt zuerst nach einer Bestätigung (Daten werden in keinem Fall gelöscht).

Überschreitet eine Berechtigung ihr Ablaufdatum, beginnt eine **Kulanzfrist** (standardmäßig 30 Tage): Alles funktioniert weiter, Administratoren sehen einen Warnhinweis. Danach wird die Erweiterung **weich deaktiviert** — ihre Seiten verschwinden, ihre API lehnt Anfragen ab, ihre Hintergrundjobs pausieren. **Es werden niemals Daten gelöscht.** Das Anwenden einer erneuerten Lizenzdatei stellt sofort alles wieder her, ohne Neustart.

Über den Store gekaufte Lizenzen verlängern sich auf verbundenen Instanzen von selbst: Nach jeder erfolgreichen Zahlung holt Ihre Instanz die verlängerte Lizenz automatisch — nichts einzufügen. Auf einer abgeschotteten Instanz gilt: die aktualisierte Lizenzdatei aus der Verlängerungs-E-Mail einfügen (oder beim Anbieter anfordern) — fertig.

### Auto-Verlängerungsstatus und Kündigung

Jeder Berechtigungs-Chip sagt, was am jeweiligen Datum passiert: **Verlängert sich am {Datum}** bei einem aktiven Abonnement oder **Läuft am {Datum} ab — wird nicht verlängert** nach einer Kündigung. Diese Angabe stammt aus der signierten Lizenz selbst und stimmt daher auch auf abgeschotteten Instanzen — die nach jeder Abonnementänderung per E-Mail verschickte Lizenzdatei trägt den aktuellen Status; nach dem Einfügen ist der Chip aktuell.

Um das Verlängerungsdatum zu sehen, die automatische Verlängerung zu kündigen oder wiederherzustellen, die Zahlungsmethode zu ändern oder Rechnungen herunterzuladen, nutzen Sie **Abonnement verwalten** neben dem Lizenznehmernamen (bei über den Store gekauften Lizenzen sichtbar). Es öffnet Ihr Abrechnungsportal in einem neuen Tab — kein Konto nötig. Auf einer abgeschotteten Instanz erreicht der Button den Store nicht; verwenden Sie stattdessen den Link **Abonnement verwalten** in jeder Lizenz-E-Mail (nur Ihr Browser braucht Internetzugang, Ihre Turbo-EA-Instanz nicht).

Eine Kündigung schaltet nie sofort etwas ab: Die Erweiterung funktioniert bis zum Ende des bezahlten Zeitraums weiter, danach greift der normale Kulanz- und Soft-Disable-Ablauf. **Ihre Daten werden nie gelöscht**, und ein erneutes Abonnement stellt alles wieder her.

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

## Datenzugriffs-Grants

Die meisten Erweiterungen arbeiten nur mit ihren eigenen Daten. Eine Erweiterung, die Kerndaten integriert — zum Beispiel ein Konnektor, der Todos mit einem externen Task-Tracker wie Jira oder MS Planner synchronisiert ([#921](https://github.com/vincentmakes/turbo-ea/discussions/921)) — muss in ihrem signierten Manifest **Grants** deklarieren:

- `core.todos.read` / `core.todos.write` — Todos über das Erweiterungs-SDK lesen oder ändern. Schreiben schließt Lesen ein. Bei System-Todos (etwa Signaturanfragen) kann eine Sync-Erweiterung nur die als Chip angezeigte externe Referenz setzen — sie kann sie niemals erledigen, bearbeiten, neu zuweisen oder löschen, und Todos einer anderen Erweiterung bleiben ebenfalls tabu.
- `core.events.todo` — Todo-Änderungsereignisse empfangen, damit ein Konnektor sofort reagiert statt erst beim nächsten Abfragezyklus.
- `core.users.read` — Benutzer nachschlagen (nur Name, E-Mail und Aktiv-Status), damit ein Konnektor Zuständige mit Konten im externen Tool abgleichen kann. Rollen-, Anmelde- oder Einstellungsdaten werden nicht offengelegt, und Erweiterungen können Benutzer niemals ändern.
- `core.cards.read` — Karten, Relationen und das Metamodell lesen, z. B. damit ein Konnektor Ihre Applikationen mit Einträgen in einem externen System abgleichen kann. Archivierte Karten bleiben ausgeblendet.
- `core.cards.write` — Karten anlegen, ändern oder archivieren und Relationen hinzufügen, mit exakt derselben Validierung wie im Editor der App. Änderungen führen Feldwerte zusammen statt sie zu ersetzen, sodass eine Erweiterung niemals Daten löschen kann, die sie nicht verwaltet, und es gibt **kein endgültiges Löschen** — Archivieren mit Wiederherstellungsfenster ist die einzige Entfernung, die einer Erweiterung möglich ist.
- `core.events.card` — Änderungsereignisse zu Karten und Relationen empfangen, damit ein Konnektor sofort auf Inventaränderungen reagiert statt erst beim nächsten Abfragezyklus.

Grants sind Teil des vom Anbieter signierten Bundles, stehen also beim Paketieren fest und sind vor der Installation sichtbar. Sie gelten nur, solange die Erweiterung installiert, aktiviert und lizenziert ist — Deaktivieren oder ein Lizenzablauf entzieht den Zugriff sofort, ohne Neustart. Jede Änderung einer Erweiterung wird in **Admin → Audit-Log** unter der Herkunft **Erweiterung** aufgezeichnet, und ein aus einem externen Tracker gespiegeltes Todo zeigt einen Chip mit Link auf das externe Element.

Jede Änderung einer Erweiterung erscheint unter **Admin → Audit-Log** als `ext:<key>`-Batch mit Feld-Diffs und kann dort wie jeder andere Batch zurückgerollt werden. Betreiber behalten das letzte Wort: Die Umgebungsvariable `EXTENSION_WRITES_ENABLED=false` pausiert sofort alle Schreibzugriffe von Erweiterungen (Lesezugriffe laufen weiter, kein Neustart nötig), und `EXTENSION_MAX_WRITES_PER_BATCH` / `EXTENSION_MAX_BATCHES_PER_MINUTE` begrenzen, wie viel eine einzelne Erweiterung pro Batch und pro Minute ändern darf.

## Wo Erweiterungsseiten erscheinen

Erweiterungsseiten erscheinen in der Navigation, sobald die Erweiterung installiert und lizenziert ist — in der Regel als eigener Menüpunkt der obersten Ebene, wobei einige Berichte unter dem Menü **Berichte** neben den eingebauten platziert werden.
