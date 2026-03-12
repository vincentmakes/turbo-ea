# Allgemeine Einstellungen

Die **Einstellungen**-Seite (**Admin > Einstellungen**) bietet eine zentrale Konfiguration für das Erscheinungsbild der Plattform, E-Mail und Modulumschaltungen.

## Erscheinungsbild

### Logo

Laden Sie ein benutzerdefiniertes Logo hoch, das in der oberen Navigationsleiste erscheint. Unterstützte Formate: PNG, JPEG, SVG, WebP, GIF. Klicken Sie auf **Zurücksetzen**, um zum Standard-Turbo-EA-Logo zurückzukehren.

### Favicon

Laden Sie ein benutzerdefiniertes Browser-Symbol (Favicon) hoch. Die Änderung wird beim nächsten Seitenaufruf wirksam. Klicken Sie auf **Zurücksetzen**, um zum Standardsymbol zurückzukehren.

### Währung

Wählen Sie die Währung, die für Kostenfelder in der gesamten Plattform verwendet wird. Dies beeinflusst, wie Kostenwerte auf Kartendetailseiten, in Berichten und Exporten formatiert werden. Über 20 Währungen werden unterstützt, darunter USD, EUR, GBP, JPY, CNY, CHF, INR, BRL und mehr.

### Aktivierte Sprachen

Schalten Sie um, welche Sprachen den Benutzern in ihrer Sprachauswahl zur Verfügung stehen. Alle acht unterstützten Gebietsschemas können einzeln aktiviert oder deaktiviert werden:

- English, Deutsch, Français, Español, Italiano, Português, 中文, Русский

Mindestens eine Sprache muss jederzeit aktiviert bleiben.

### Beginn des Geschäftsjahres

Wählen Sie den Monat, in dem das Geschäftsjahr Ihrer Organisation beginnt (Januar bis Dezember). Diese Einstellung beeinflusst, wie **Budgetzeilen** im PPM-Modul nach Geschäftsjahr gruppiert werden. Wenn das Geschäftsjahr beispielsweise im April beginnt, gehört eine Budgetzeile vom Juni 2026 zum GJ 2026–2027.

Der Standardwert ist **Januar** (Kalenderjahr = Geschäftsjahr).

## E-Mail (SMTP)

Konfigurieren Sie die E-Mail-Zustellung für Einladungs-E-Mails, Umfragebenachrichtigungen und andere Systemnachrichten.

| Feld | Beschreibung |
|------|-------------|
| **SMTP-Host** | Hostname Ihres Mailservers (z.B. `smtp.gmail.com`) |
| **SMTP-Port** | Server-Port (typischerweise 587 für TLS) |
| **SMTP-Benutzer** | Benutzername für die Authentifizierung |
| **SMTP-Passwort** | Passwort für die Authentifizierung (verschlüsselt gespeichert) |
| **TLS verwenden** | TLS-Verschlüsselung aktivieren (empfohlen) |
| **Absenderadresse** | Die Absender-E-Mail-Adresse für ausgehende Nachrichten |
| **App-Basis-URL** | Die öffentliche URL Ihrer Turbo EA-Instanz (wird in E-Mail-Links verwendet) |

Nach der Konfiguration klicken Sie auf **Test-E-Mail senden**, um zu überprüfen, ob die Einstellungen korrekt funktionieren.

!!! note
    E-Mail ist optional. Wenn SMTP nicht konfiguriert ist, überspringen Funktionen, die E-Mails senden (Einladungen, Umfragebenachrichtigungen), den E-Mail-Versand ohne Fehlermeldung.

## BPM-Modul

Schalten Sie das **Business Process Management**-Modul ein oder aus. Wenn deaktiviert:

- Der **BPM**-Navigationspunkt wird für alle Benutzer ausgeblendet
- Geschäftsprozess-Karten verbleiben in der Datenbank, aber BPM-spezifische Funktionen (Prozessfluss-Editor, BPM-Dashboard, BPM-Berichte) sind nicht zugänglich

Dies ist nützlich für Organisationen, die BPM nicht nutzen und eine übersichtlichere Navigation wünschen.

## PPM-Modul

Schalten Sie das **Projektportfoliomanagement**-Modul (PPM) ein oder aus. Wenn deaktiviert:

- Der **PPM**-Navigationspunkt wird für alle Benutzer ausgeblendet
- Initiativen-Karten verbleiben in der Datenbank, aber PPM-spezifische Funktionen (Statusberichte, Budget- und Kostenverfolgung, Risikoregister, Aufgabentafel, Gantt-Diagramm) sind nicht zugänglich

Wenn aktiviert, erhalten Initiativen-Karten einen **PPM**-Tab in ihrer Detailansicht und das PPM-Portfolio-Dashboard wird in der Hauptnavigation verfügbar. Siehe [Projektportfoliomanagement](../guide/ppm.md) für die vollständige Funktionsübersicht.
