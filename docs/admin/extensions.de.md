# Erweiterungen

Der **Extension Store** (Admin → Erweiterungen) installiert vom Anbieter signierte Erweiterungen, die kundenspezifische Funktionen hinzufügen — zusätzliche Metamodell-Inhalte, Integrationen, Hintergrundjobs und sogar neue Seiten — ohne den Turbo-EA-Kern zu verändern („Clean Core“-Prinzip).

Alles wird als Datei geliefert: Die Erweiterung ist ein signiertes `.teax`-Paket, die Lizenz eine signierte Textdatei — beide typischerweise per E-Mail versandt. Es sind weder Online-Aktivierung noch Store-Konto noch ausgehende Verbindungen nötig; der gesamte Ablauf funktioniert daher identisch auf **abgeschotteten (air-gapped)** Instanzen.

## So funktioniert das Vertrauensmodell

Zwei unabhängige Prüfungen schützen Ihre Instanz:

1. **Herkunft (Signatur).** Jedes Paket trägt eine Ed25519-Signatur des Anbieter-Schlüssels. Turbo EA prüft sie beim Hochladen *und erneut bei jedem Backend-Start*. Unsignierte, manipulierte oder fremde Pakete werden abgelehnt — eine installierte Erweiterung ist garantiert genau das, was der Anbieter gebaut hat.
2. **Aktivierung (Lizenz).** Eine signierte Lizenzdatei enthält Ihre Berechtigungen — eine pro Erweiterung, jede mit eigenem Ablaufdatum. Eine installierte Erweiterung läuft nur, solange eine gültige Berechtigung existiert.

## Eine Erweiterung installieren

1. Falls noch nicht geschehen, wenden Sie zuerst Ihre Lizenz an (siehe unten).
2. Öffnen Sie **Admin → Erweiterungen**, wählen Sie **Erweiterung installieren** und laden Sie die erhaltene `.teax`-Datei hoch.
3. Turbo EA prüft die Signatur und zeigt eine **Vorschau**: Bei Erweiterungen mit Inhalten ist das ein Probelauf aller Kartentypen, Tag-Gruppen, Karten und Beziehungen, die die Erweiterung anlegen oder aktualisieren würde — es wird noch nichts geschrieben.
4. Prüfen Sie die Vorschau und klicken Sie auf **Erweiterung installieren**.
5. Enthält die Erweiterung Backend- oder UI-Code, fordert ein Banner zum Neustart des Backend-Containers auf (`docker compose restart backend`). Reine Inhaltserweiterungen sind sofort aktiv.

Das erneute Hochladen desselben Pakets ist unbedenklich — die Vorschau zeigt alles als „übersprungen“ und das Anwenden ändert nichts.

## Lizenzen und Verlängerung

Fügen Sie den erhaltenen Lizenztext in der Karte **Lizenz** ein (oder laden Sie die Lizenzdatei hoch). Die Seite zeigt dann den Lizenznehmer sowie einen Chip pro Berechtigung mit Ablaufdatum.

Überschreitet eine Berechtigung ihr Ablaufdatum, beginnt eine **Kulanzfrist** (standardmäßig 30 Tage): Alles funktioniert weiter, Administratoren sehen einen Warnhinweis. Danach wird die Erweiterung **weich deaktiviert** — ihre Seiten verschwinden, ihre API lehnt Anfragen ab, ihre Hintergrundjobs pausieren. **Es werden niemals Daten gelöscht.** Das Anwenden einer erneuerten Lizenzdatei stellt sofort alles wieder her, ohne Neustart.

Die Verlängerung auf einer abgeschotteten Instanz ist damit: neue Lizenzdatei beim Anbieter anfordern (per E-Mail), einfügen — fertig.

## Aktivieren, Deaktivieren und Deinstallieren

- Der Schalter **Aktiviert** deaktiviert eine Erweiterung sofort weich (ohne Neustart) und lässt sich jederzeit zurückschalten.
- **Deinstallieren** entfernt die Dateien der Erweiterung. Von ihr erzeugte Daten — Kartentypen, Karten und eigene Tabellen — bleiben bewusst erhalten und erscheinen bei einer Neuinstallation wieder. Zum vollständigen Entladen von Backend-Code ist ein Neustart nötig.

## Berechtigungen

Die gesamte Seite und alle zugehörigen API-Routen sind durch die dedizierte Berechtigung `admin.manage_extensions` geschützt (der eingebauten Admin-Rolle zugewiesen). Erweiterungen können eigene Berechtigungsschlüssel definieren (`ext.<name>.…`), die nach dem Laden der Erweiterung unter **Admin → Benutzer & Rollen** erscheinen.
