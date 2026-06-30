# Einstellungen

Die **Einstellungen**-Seite unter **Admin → Einstellungen** (`/admin/settings`) ist die zentrale Konfigurationsstelle. Sie ist in Reiter organisiert — wähle den passenden Reiter aus der Tabelle unten für den entsprechenden Deep Dive:

| Reiter | URL | Was er steuert | Vollständige Anleitung |
|--------|-----|----------------|------------------------|
| **Allgemein** | `/admin/settings?tab=general` | Erscheinungsbild (Logo, Favicon, Währung, Datumsformat, aktivierte Sprachen, Geschäftsjahr), SMTP-E-Mail, **Modul-Schalter** (BPM, PPM, GRC, TurboLens, Sponsor button) | Diese Seite |
| **Authentifizierung** | `/admin/settings?tab=authentication` | SSO-Provider, Registrierung, Passwortrichtlinie | [Authentifizierung & SSO](sso.md) |
| **KI** | `/admin/settings?tab=ai` | LLM-Provider, Modell, Websuch-Backend, Pro-Kartentyp-KI-Suggestionsschalter | [KI-Funktionen](ai.md) |
| **EOL** | `/admin/settings?tab=eol` | Massen-Verknüpfung von Produkten zu endoflife.date-Einträgen | [End-of-Life (EOL)](eol.md) |
| **Webportale** | `/admin/settings?tab=web-portals` | Öffentliche schreibgeschützte Portal-Slugs, Sichtbarkeits-Filter | [Webportale](web-portals.md) |
| **ServiceNow** | `/admin/settings?tab=servicenow` | ServiceNow-Verbindung, Sync-Konfiguration, Identitäts-Mapping | [ServiceNow-Integration](servicenow.md) |
| **TurboLens** | `/admin/settings?tab=turbolens` | TurboLens-spezifische Schalter, aktivierte Regulierungen, Analyse-Polling | Siehe Abschnitt [TurboLens-Einstellungen](#turbolens-einstellungen) unten |

Der Rest dieser Seite behandelt den **Allgemein**-Reiter.

![Allgemeine Einstellungen](../assets/img/de/28_admin_einstellungen_allgemein.png)

## Erscheinungsbild

### Logo

Laden Sie ein benutzerdefiniertes Logo hoch, das in der oberen Navigationsleiste erscheint. Unterstützte Formate: PNG, JPEG, SVG, WebP, GIF. Klicken Sie auf **Zurücksetzen**, um zum Standard-Turbo-EA-Logo zurückzukehren.

### Favicon

Laden Sie ein benutzerdefiniertes Browser-Symbol (Favicon) hoch. Die Änderung wird beim nächsten Seitenaufruf wirksam. Klicken Sie auf **Zurücksetzen**, um zum Standardsymbol zurückzukehren.

### Währung

Wählen Sie die Währung, die für Kostenfelder in der gesamten Plattform verwendet wird. Dies beeinflusst, wie Kostenwerte auf Kartendetailseiten, in Berichten und Exporten formatiert werden. Über 40 Währungen werden unterstützt, darunter USD, EUR, GBP, JPY, CNY, CHF, INR, BRL, IDR und mehr.

### Datumsformat

Wählen Sie, wie Datumsangaben in der gesamten Anwendung dargestellt werden. Das gewählte Format gilt für Lebenszyklus-Daten von Karten, das Inventar-Grid, signierte ADR- und SoAW-Dokumente, das Risikoregister, PPM-Berichte und -Aufgaben, BPM-Prozessflussversionen, Kommentare, Verlauf, den Aktivitätsstrom des Dashboards, Benachrichtigungen und Admin-Seiten. Fünf Formate stehen mit Live-Vorschau zur Auswahl:

- `MM/DD/YYYY` — US-Stil (z. B. `04/29/2026`)
- `DD/MM/YYYY` — Europäischer Stil (z. B. `29/04/2026`)
- `YYYY-MM-DD` — ISO 8601 (z. B. `2026-04-29`)
- `DD MMM YYYY` — Standard (z. B. `29 Apr 2026`)
- `MMM DD, YYYY` (z. B. `Apr 29, 2026`)

Änderungen werden für alle Benutzer sofort wirksam — kein Neuladen erforderlich.

### Aktivierte Sprachen

Schalten Sie um, welche Sprachen den Benutzern in ihrer Sprachauswahl zur Verfügung stehen. Alle acht unterstützten Gebietsschemas können einzeln aktiviert oder deaktiviert werden:

- English, Deutsch, Français, Español, Italiano, Português, 中文, Русский

Mindestens eine Sprache muss jederzeit aktiviert bleiben.

### Beginn des Geschäftsjahres

Wählen Sie den Monat, in dem das Geschäftsjahr Ihrer Organisation beginnt (Januar bis Dezember). Diese Einstellung beeinflusst, wie **Budgetzeilen** im PPM-Modul nach Geschäftsjahr gruppiert werden. Wenn das Geschäftsjahr beispielsweise im April beginnt, gehört eine Budgetzeile vom Juni 2026 zum GJ 2026–2027.

Der Standardwert ist **Januar** (Kalenderjahr = Geschäftsjahr).

## Datenverwaltung

Legen Sie fest, wie lange **archivierte Karten** aufbewahrt werden, bevor sie endgültig gelöscht werden.

Wenn eine Karte archiviert wird, ist sie im Inventar, in Berichten und in Beziehungen ausgeblendet, behält aber ihre vollständige Historie und kann jederzeit vor der Bereinigung wiederhergestellt werden.

| Feld | Beschreibung |
|------|--------------|
| **Aufbewahrungsdauer (Tage)** | Anzahl der Tage, die eine archivierte Karte aufbewahrt wird, bevor sie endgültig gelöscht wird. Der Standardwert ist **30**. |
| **Archivierte Karten unbegrenzt aufbewahren** | Wenn aktiviert (Aufbewahrung auf **0** gesetzt), werden archivierte Karten nie automatisch gelöscht und – mitsamt ihrer Historie – unbegrenzt aufbewahrt. |

Die Bereinigung läuft stündlich und liest diese Einstellung bei jedem Durchlauf neu, sodass Änderungen ohne Neustart der Anwendung wirksam werden. Archiv-Banner und Bestätigungsdialoge zeigen die konfigurierte Dauer automatisch an.

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

## GRC-Modul

Schalten Sie das **Governance, Risk and Compliance**-Modul (GRC) ein oder aus. Wenn deaktiviert:

- Der **GRC**-Navigationspunkt wird für alle Benutzer ausgeblendet
- Der Arbeitsbereich `/grc` (Governance-Prinzipien und ADRs, Risikoregister, Compliance-Findings) ist nicht erreichbar und zeigt für jeden direkten Link den Standard-Platzhalter „Modul deaktiviert"
- Die **Risiken**- und **Compliance**-Reiter in der Kartendetailansicht werden ausgeblendet, sodass auch einzelne Karten keine GRC-Daten mehr anzeigen
- Risiken und Compliance-Findings verbleiben in der Datenbank — die zugrunde liegenden Berechtigungen `risks.*` und `compliance.*` bleiben unverändert, sodass die Daten erhalten bleiben und unverändert wieder erscheinen, wenn das Modul erneut aktiviert wird

Siehe den [GRC-Leitfaden](../guide/grc.md) für die vollständige Funktionsübersicht.

## Sponsor-Schaltfläche

Blenden Sie die **Sponsor**-Schaltfläche im Benutzermenü (Avatar) ein oder aus. Wenn sie ausgeblendet ist, sehen Benutzer die Sponsor-Schaltfläche nicht mehr in ihrem Profilmenü. Die Sponsor-Schaltfläche — und der Dialog, der erklärt, wie man Turbo EA unterstützt — bleibt in diesem Einstellungsbereich immer verfügbar, sodass Administratoren sie auch dann erreichen, wenn sie im Menü ausgeblendet ist.

Wenn Ihr Unternehmen Turbo EA sponsert und sein Logo auf turbo-ea.org präsentieren möchte, wenden Sie sich an [sponsorship@turbo-ea.org](mailto:sponsorship@turbo-ea.org).

## TurboLens-Einstellungen

Der **TurboLens**-Reiter bündelt die Schalter, die die KI-Analyse-Oberfläche regeln. Anders als die per-Modul-Schalter oben ist TurboLens **kein** binäres An/Aus — es ist «bereit», wenn sowohl ein KI-Provider konfiguriert ist (unter dem **KI**-Reiter) als auch die Analyse-Daten mindestens einmal synchronisiert wurden. Die Seite exponiert ausserdem:

- **Aktivierte Regulierungen** — markiere, welche der sechs eingebauten Frameworks (EU AI Act, GDPR, NIS2, DORA, SOC 2, ISO 27001) an [Compliance-Scans](../guide/compliance.md) teilnehmen. Eigene unter **Metamodell → Regulierungen** definierte Regulierungen können hier ebenfalls aktiviert werden.
- **Analyse-Polling-Kadenz** — wie oft die UI lang laufende TurboLens-Analysen auf Fortschritt erneut abfragt. Höhere Kadenz = geringere wahrgenommene Latenz, mehr API-Last.
- **Ergebnis-Cache-TTL** — wie lange abgeschlossene Analyseergebnisse zwischengespeichert werden, bevor der **Analyse ausführen**-Button wieder aktiviert wird.

Siehe [TurboLens KI-Intelligenz](../guide/turbolens.md) für die vollständige Funktionsoberfläche und [Compliance](../guide/compliance.md) für den Scan-Workflow.
