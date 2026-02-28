# ServiceNow-Integration

Die ServiceNow-Integration (**Admin > Einstellungen > ServiceNow**) ermöglicht eine bidirektionale Synchronisation zwischen Turbo EA und Ihrem ServiceNow CMDB. Dieses Handbuch behandelt alles von der Ersteinrichtung über fortgeschrittene Rezepte bis hin zu operativen Best Practices.

## Warum ServiceNow mit Turbo EA integrieren?

ServiceNow CMDB und Enterprise Architecture-Werkzeuge dienen unterschiedlichen, aber sich ergänzenden Zwecken:

| | ServiceNow CMDB | Turbo EA |
|--|-----------------|----------|
| **Fokus** | IT-Betrieb — was läuft, wem gehört es, welche Incidents gab es | Strategische Planung — wie soll die Landschaft in 3 Jahren aussehen? |
| **Gepflegt von** | IT-Betrieb, Asset Management | EA-Team, Business-Architekten |
| **Stärke** | Automatische Erkennung, ITSM-Workflows, operative Genauigkeit | Geschäftskontext, Fähigkeitszuordnung, Lebenszyklusplanung, Beurteilungen |
| **Typische Daten** | Hostnamen, IPs, Installationsstatus, Zuweisungsgruppen, Verträge | Geschäftskritikalität, funktionale Eignung, technische Schulden, strategische Roadmap |

**Turbo EA ist das führende System** für Ihre Architekturlandschaft — Namen, Beschreibungen, Lebenszykluspläne, Beurteilungen und Geschäftskontext befinden sich alle hier. ServiceNow ergänzt Turbo EA mit operativen und technischen Metadaten (Hostnamen, IPs, SLA-Daten, Installationsstatus), die aus automatischer Erkennung und ITSM-Workflows stammen. Die Integration hält diese beiden Systeme verbunden und respektiert dabei, dass Turbo EA führt.

### Was Sie tun können

- **Pull-Synchronisation** — Turbo EA mit CIs aus ServiceNow befüllen, dann die Verantwortung übernehmen. Laufende Pulls aktualisieren nur operative Felder (IPs, Status, SLAs), die SNOW automatisch erkennt
- **Push-Synchronisation** — Von EA kuratierte Daten zurück an ServiceNow exportieren (Namen, Beschreibungen, Beurteilungen, Lebenszykluspläne), damit ITSM-Teams EA-Kontext sehen
- **Bidirektionale Synchronisation** — Turbo EA führt die meisten Felder; SNOW führt eine kleine Menge operativer/technischer Felder. Beide Systeme bleiben synchron
- **Identitätszuordnung** — Persistente Kreuzreferenzverfolgung (sys_id <-> Karten-UUID) stellt sicher, dass Datensätze über Synchronisationen hinweg verknüpft bleiben

---

## Integrationsarchitektur

```
+------------------+         HTTPS / Table API          +------------------+
|   Turbo EA       | <--------------------------------> |  ServiceNow      |
|                  |                                     |                  |
|  Karten          |  Pull: SNOW CIs -> Turbo-Karten     |  CMDB CIs        |
|  (Application,   |  Push: Turbo-Karten -> SNOW CIs     |  (cmdb_ci_appl,  |
|   ITComponent,   |                                     |   cmdb_ci_server, |
|   Provider, ...) |  Identity Map verfolgt sys_id <-> UUID |   core_company)  |
+------------------+                                     +------------------+
```

Die Integration nutzt die Table API von ServiceNow über HTTPS. Anmeldedaten werden im Ruhezustand mit Fernet (AES-128-CBC), abgeleitet von Ihrem `SECRET_KEY`, verschlüsselt. Alle Synchronisationsoperationen werden als Events mit `source: "servicenow_sync"` protokolliert für eine vollständige Audit-Spur.

---

## Planung Ihrer Integration

Bevor Sie etwas konfigurieren, beantworten Sie diese Fragen:

### 1. Welche Kartentypen benötigen Daten aus ServiceNow?

Fangen Sie klein an. Die häufigsten Integrationspunkte sind:

| Priorität | Turbo EA-Typ | ServiceNow-Quelle | Warum |
|-----------|--------------|-------------------|-------|
| **Hoch** | Application | `cmdb_ci_business_app` | Anwendungen sind der Kern von EA — CMDB hat autoritative Namen, Eigentümer und Status |
| **Hoch** | ITComponent (Software) | `cmdb_ci_spkg` | Softwareprodukte fließen in EOL-Tracking und Tech-Radar ein |
| **Mittel** | ITComponent (Hardware) | `cmdb_ci_server` | Serverlandschaft für Infrastrukturabbildung |
| **Mittel** | Provider | `core_company` | Anbieterregister für Kosten- und Beziehungsmanagement |
| **Niedrig** | Interface | `cmdb_ci_endpoint` | Integrationsendpunkte (oft manuell in EA gepflegt) |
| **Niedrig** | DataObject | `cmdb_ci_database` | Datenbankinstanzen |

### 2. Welches System ist die Quelle der Wahrheit für jedes Feld?

Dies ist die wichtigste Entscheidung. Der Standard sollte sein **Turbo EA führt** — das EA-Werkzeug ist das führende System für Ihre Architekturlandschaft. ServiceNow sollte nur für eine enge Menge operativer und technischer Felder führen, die aus automatischer Erkennung oder ITSM-Workflows stammen. Alles andere — Namen, Beschreibungen, Beurteilungen, Lebenszyklusplanung, Kosten — wird vom EA-Team in Turbo EA gepflegt und kuratiert.

**Empfohlenes Modell — «Turbo EA führt, SNOW ergänzt»:**

| Feldtyp | Quelle der Wahrheit | Warum |
|---------|---------------------|-------|
| **Namen und Beschreibungen** | **Turbo führt** | EA-Team kuratiert autoritative Namen und schreibt strategische Beschreibungen; CMDB-Namen können unordentlich oder automatisch generiert sein |
| **Geschäftskritikalität** | **Turbo führt** | Strategische Bewertung des EA-Teams — keine operativen Daten |
| **Funktionale/technische Eignung** | **Turbo führt** | TIME-Modell-Bewertungen sind eine EA-Angelegenheit |
| **Lebenszyklus (alle Phasen)** | **Turbo führt** | Plan, Einführung, Aktiv, Auslauf, Lebensende — alles EA-Planungsdaten |
| **Kostendaten** | **Turbo führt** | EA verfolgt die Gesamtbetriebskosten; CMDB kann Vertragsposten haben, aber EA besitzt die konsolidierte Ansicht |
| **Hosting-Typ, Kategorie** | **Turbo führt** | EA klassifiziert Anwendungen nach Hosting-Modell für strategische Analyse |
| **Technische Metadaten** | SNOW führt | IPs, OS-Versionen, Hostnamen, Seriennummern — automatische Erkennungsdaten, die EA nicht pflegt |
| **SLA / operativer Status** | SNOW führt | Installationsstatus, SLA-Ziele, Verfügbarkeitsmetriken — operative ITSM-Daten |
| **Zuweisungsgruppe / Support** | SNOW führt | Operative Zuständigkeit, die in ServiceNow-Workflows verfolgt wird |
| **Erkennungsdaten** | SNOW führt | Zuerst/zuletzt erkannt, letzter Scan — CMDB-Automatisierungs-Metadaten |

### 3. Wie oft sollten Sie synchronisieren?

| Szenario | Häufigkeit | Hinweise |
|----------|------------|---------|
| Erstimport | Einmalig | Additiver Modus, sorgfältig prüfen |
| Aktive Landschaftspflege | Täglich | Automatisiert per Cron außerhalb der Hauptzeiten |
| Compliance-Berichterstattung | Wöchentlich | Vor der Berichtserstellung |
| Ad-hoc | Nach Bedarf | Vor wichtigen EA-Reviews oder Präsentationen |

---

## Schritt 1: ServiceNow-Voraussetzungen

### Service-Konto erstellen

Erstellen Sie in ServiceNow ein dediziertes Service-Konto (verwenden Sie nie persönliche Konten):

| Rolle | Zweck | Erforderlich? |
|-------|-------|--------------|
| `itil` | Lesezugriff auf CMDB-Tabellen | Ja |
| `cmdb_read` | Configuration Items lesen | Ja |
| `rest_api_explorer` | Hilfreich zum Testen von Abfragen | Empfohlen |
| `import_admin` | Schreibzugriff auf Zieltabellen | Nur für Push-Synchronisation |

**Best Practice**: Erstellen Sie eine benutzerdefinierte Rolle mit Nur-Lese-Zugriff auf nur die spezifischen Tabellen, die Sie synchronisieren möchten. Die `itil`-Rolle ist breit gefasst — eine benutzerdefinierte, eingegrenzte Rolle begrenzt den Wirkungsradius.

### Netzwerkanforderungen

- Das Turbo EA-Backend muss Ihre SNOW-Instanz über HTTPS (Port 443) erreichen
- Konfigurieren Sie Firewall-Regeln und IP-Allowlists
- Instanz-URL-Format: `https://unternehmen.service-now.com` oder `https://unternehmen.servicenowservices.com`

### Authentifizierungsmethode wählen

| Methode | Vorteile | Nachteile | Empfehlung |
|---------|----------|-----------|------------|
| **Basic Auth** | Einfache Einrichtung | Anmeldedaten bei jeder Anfrage gesendet | Nur für Entwicklung/Tests |
| **OAuth 2.0** | Token-basiert, eingegrenzt, audit-freundlich | Mehr Einrichtungsschritte | **Empfohlen für Produktion** |

Für OAuth 2.0:
1. In ServiceNow: **System OAuth > Application Registry**
2. Erstellen Sie einen neuen OAuth API-Endpunkt für externe Clients
3. Notieren Sie Client-ID und Client-Secret
4. Rotieren Sie Geheimnisse im 90-Tage-Zyklus

---

## Schritt 2: Verbindung erstellen

Navigieren Sie zu **Admin > ServiceNow > Verbindungen**-Tab.

### Erstellen und Testen

1. Klicken Sie auf **Verbindung hinzufügen**
2. Füllen Sie aus:

| Feld | Beispielwert | Hinweise |
|------|-------------|---------|
| Name | `Produktions-CMDB` | Beschreibende Bezeichnung für Ihr Team |
| Instanz-URL | `https://unternehmen.service-now.com` | Muss HTTPS verwenden |
| Auth-Typ | Basic Auth oder OAuth 2.0 | OAuth für Produktion empfohlen |
| Anmeldedaten | (je nach Auth-Typ) | Verschlüsselt gespeichert via Fernet |

3. Klicken Sie auf **Erstellen**, dann klicken Sie auf das **Testsymbol** (WLAN-Symbol), um die Konnektivität zu überprüfen

- **Grüner «Verbunden»-Chip** — Bereit
- **Roter «Fehlgeschlagen»-Chip** — Überprüfen Sie Anmeldedaten, Netzwerk und URL

### Mehrere Verbindungen

Sie können mehrere Verbindungen erstellen für:
- **Produktions-** vs. **Entwicklungs**-Instanzen
- **Regionale** SNOW-Instanzen (z.B. EMEA, APAC)
- **Verschiedene Teams** mit separaten Service-Konten

Jede Zuordnung referenziert eine bestimmte Verbindung.

---

## Schritt 3: Zuordnungen gestalten

Wechseln Sie zum **Zuordnungen**-Tab. Eine Zuordnung verbindet einen Turbo EA-Kartentyp mit einer ServiceNow-Tabelle.

### Eine Zuordnung erstellen

Klicken Sie auf **Zuordnung hinzufügen** und konfigurieren Sie:

| Feld | Beschreibung | Beispiel |
|------|-------------|---------|
| **Verbindung** | Welche ServiceNow-Instanz verwendet werden soll | Produktions-CMDB |
| **Kartentyp** | Der zu synchronisierende Turbo EA-Kartentyp | Application |
| **SNOW-Tabelle** | Der API-Name der ServiceNow-Tabelle | `cmdb_ci_business_app` |
| **Synchronisationsrichtung** | Welche Operationen verfügbar sind (siehe unten) | ServiceNow -> Turbo EA |
| **Synchronisationsmodus** | Wie mit Löschungen umgegangen wird | Konservativ |
| **Max. Löschquote** | Sicherheitsschwelle für Massenlöschungen | 50% |
| **Filterabfrage** | ServiceNow Encoded Query zur Eingrenzung | `active=true^install_status=1` |
| **Staging überspringen** | Änderungen direkt ohne Überprüfung anwenden | Aus (empfohlen für erste Synchronisation) |

### Gängige SNOW-Tabellenzuordnungen

| Turbo EA-Typ | ServiceNow-Tabelle | Beschreibung |
|-------------|-------------------|-------------|
| Application | `cmdb_ci_business_app` | Geschäftsanwendungen (am häufigsten) |
| Application | `cmdb_ci_appl` | Allgemeine Anwendungs-CIs |
| ITComponent (Software) | `cmdb_ci_spkg` | Softwarepakete |
| ITComponent (Hardware) | `cmdb_ci_server` | Physische/virtuelle Server |
| ITComponent (SaaS) | `cmdb_ci_cloud_service_account` | Cloud-Service-Konten |
| Provider | `core_company` | Anbieter / Unternehmen |
| Interface | `cmdb_ci_endpoint` | Integrationsendpunkte |
| DataObject | `cmdb_ci_database` | Datenbankinstanzen |
| System | `cmdb_ci_computer` | Computer-CIs |
| Organization | `cmn_department` | Abteilungen |

### Filterabfrage-Beispiele

Filtern Sie immer, um den Import veralteter oder stillgelegter Datensätze zu vermeiden:

```
# Nur aktive CIs (empfohlener Mindestfilter)
active=true

# Aktive CIs mit Installationsstatus "Installiert"
active=true^install_status=1

# Anwendungen in Produktivnutzung
active=true^used_for=Production

# CIs, die in den letzten 30 Tagen aktualisiert wurden
active=true^sys_updated_on>=javascript:gs.daysAgoStart(30)

# Bestimmte Zuweisungsgruppe
active=true^assignment_group.name=IT Operations

# Stillgelegte CIs ausschließen
active=true^install_statusNOT IN7,8
```

**Best Practice**: Schließen Sie mindestens `active=true` immer ein. CMDB-Tabellen enthalten oft Tausende von stillgelegten oder außer Betrieb genommenen Datensätzen, die nicht in Ihre EA-Landschaft importiert werden sollten.

---

## Schritt 4: Feldzuordnungen konfigurieren

Jede Zuordnung enthält **Feldzuordnungen**, die definieren, wie einzelne Felder zwischen den beiden Systemen übersetzt werden. Das Turbo EA-Feld-Eingabefeld bietet Autovervollständigungsvorschläge basierend auf dem ausgewählten Kartentyp — einschließlich Kernfeldern, Lebenszyklus-Daten und allen benutzerdefinierten Attributen aus dem Typschema.

### Felder hinzufügen

Für jede Feldzuordnung konfigurieren Sie:

| Einstellung | Beschreibung |
|-------------|-------------|
| **Turbo EA-Feld** | Feldpfad in Turbo EA (Autovervollständigung schlägt Optionen basierend auf dem Kartentyp vor) |
| **SNOW-Feld** | API-Name der ServiceNow-Spalte (z.B. `name`, `short_description`) |
| **Richtung** | Pro-Feld-Quelle der Wahrheit: SNOW führt oder Turbo führt |
| **Transformation** | Wie Werte konvertiert werden: Direkt, Wertzuordnung, Datum, Boolean |
| **Identität** (ID-Checkbox) | Wird zum Abgleich von Datensätzen bei der Erstsynchronisation verwendet |

### Turbo EA-Feldpfade

Die Autovervollständigung gruppiert Felder nach Abschnitt. Hier die vollständige Pfadreferenz:

| Pfad | Ziel | Beispielwert |
|------|------|-------------|
| `name` | Karten-Anzeigename | `"SAP S/4HANA"` |
| `description` | Kartenbeschreibung | `"Kern-ERP-System für Finanzen"` |
| `lifecycle.plan` | Lebenszyklus: Planungsdatum | `"2024-01-15"` |
| `lifecycle.phaseIn` | Lebenszyklus: Einführungsdatum | `"2024-03-01"` |
| `lifecycle.active` | Lebenszyklus: Aktivdatum | `"2024-06-01"` |
| `lifecycle.phaseOut` | Lebenszyklus: Auslaufdatum | `"2028-12-31"` |
| `lifecycle.endOfLife` | Lebenszyklus: Lebensenddatum | `"2029-06-30"` |
| `attributes.<schlüssel>` | Beliebiges benutzerdefiniertes Attribut aus dem Feldschemata des Kartentyps | Variiert je nach Feldtyp |

Wenn Ihr Application-Typ beispielsweise ein Feld mit dem Schlüssel `businessCriticality` hat, wählen Sie `attributes.businessCriticality` aus dem Dropdown.

### Identitätsfelder — Wie der Abgleich funktioniert

Markieren Sie ein oder mehrere Felder als **Identität** (Schlüsselsymbol). Diese werden bei der ersten Synchronisation verwendet, um ServiceNow-Datensätze mit bestehenden Turbo EA-Karten abzugleichen:

1. **Identity-Map-Suche** — Wenn eine sys_id <-> Karten-UUID-Verknüpfung bereits existiert, wird sie verwendet
2. **Exakter Namensabgleich** — Abgleich über den Identitätsfeldwert (z.B. Abgleich nach Anwendungsname)
3. **Fuzzy-Abgleich** — Wenn kein exakter Treffer, wird SequenceMatcher mit 85% Ähnlichkeitsschwelle verwendet

**Best Practice**: Markieren Sie immer das `name`-Feld als Identitätsfeld. Wenn sich Namen zwischen den Systemen unterscheiden (z.B. SNOW enthält Versionsnummern wie «SAP S/4HANA v2.1», aber Turbo EA hat «SAP S/4HANA»), bereinigen Sie diese vor der ersten Synchronisation für bessere Abgleichqualität.

Nach der ersten Synchronisation, die Identity-Map-Verknüpfungen erstellt, verwenden nachfolgende Synchronisationen die persistente Identity Map und verlassen sich nicht mehr auf Namensabgleich.

---

## Schritt 5: Ihre erste Synchronisation ausführen

Wechseln Sie zum **Synchronisations-Dashboard**-Tab.

### Eine Synchronisation auslösen

Für jede aktive Zuordnung sehen Sie Pull- und/oder Push-Schaltflächen, abhängig von der konfigurierten Synchronisationsrichtung:

- **Pull** (Cloud-Download-Symbol) — Ruft Daten von SNOW in Turbo EA ab
- **Push** (Cloud-Upload-Symbol) — Sendet Turbo EA-Daten an ServiceNow

### Was während einer Pull-Synchronisation passiert

```
1. ABRUFEN   Alle passenden Datensätze aus SNOW abrufen (Batches von 500)
2. ABGLEICH  Jeden Datensatz mit einer bestehenden Karte abgleichen:
             a) Identity Map (persistenter sys_id <-> Karten-UUID-Lookup)
             b) Exakter Namensabgleich über Identitätsfelder
             c) Fuzzy-Namensabgleich (85% Ähnlichkeitsschwelle)
3. TRANSFORM Feldzuordnungen anwenden, um SNOW -> Turbo EA-Format zu konvertieren
4. DIFF      Transformierte Daten mit bestehenden Kartenfeldern vergleichen
5. STAGING   Jedem Datensatz eine Aktion zuweisen:
             - erstellen: Neu, keine passende Karte gefunden
             - aktualisieren: Treffer gefunden, Felder unterscheiden sich
             - überspringen: Treffer gefunden, keine Unterschiede
             - löschen: In Identity Map, aber in SNOW abwesend
6. ANWENDEN  Staging-Aktionen ausführen (Karten erstellen/aktualisieren/archivieren)
```

Wenn **Staging überspringen** aktiviert ist, verschmelzen die Schritte 5 und 6 — Aktionen werden direkt ohne Staging-Datensätze angewendet.

### Synchronisationsergebnisse überprüfen

Die **Synchronisationshistorie**-Tabelle zeigt nach jedem Lauf:

| Spalte | Beschreibung |
|--------|-------------|
| Gestartet | Wann die Synchronisation begann |
| Richtung | Pull oder Push |
| Status | `abgeschlossen`, `fehlgeschlagen` oder `laufend` |
| Abgerufen | Insgesamt von ServiceNow abgerufene Datensätze |
| Erstellt | Neue Karten in Turbo EA erstellt |
| Aktualisiert | Bestehende Karten aktualisiert |
| Gelöscht | Karten archiviert (weich gelöscht) |
| Fehler | Datensätze, die nicht verarbeitet werden konnten |
| Dauer | Gesamtlaufzeit |

Klicken Sie auf das **Listensymbol** bei einem beliebigen Lauf, um einzelne Staging-Datensätze zu inspizieren, einschließlich des feldweisen Diffs für jede Aktualisierung.

### Empfohlenes Vorgehen für die erste Synchronisation

```
1. Zuordnung auf ADDITIV-Modus mit Staging EIN setzen
2. Pull-Synchronisation ausführen
3. Staging-Datensätze überprüfen — prüfen, ob Erstellungen korrekt aussehen
4. Zum Inventar gehen, importierte Karten überprüfen
5. Feldzuordnungen oder Filterabfrage bei Bedarf anpassen
6. Erneut ausführen bis zufriedenstellend
7. Auf KONSERVATIV-Modus für den laufenden Betrieb umstellen
8. Nach mehreren erfolgreichen Läufen Staging überspringen aktivieren
```

---

## Synchronisationsrichtung vs. Feldrichtung verstehen

Dies ist das am häufigsten missverstandene Konzept. Es gibt **zwei Richtungsebenen**, die zusammenwirken:

### Tabellenebene: Synchronisationsrichtung

Auf der Zuordnung selbst festgelegt. Steuert, **welche Synchronisationsoperationen verfügbar** sind im Synchronisations-Dashboard:

| Synchronisationsrichtung | Pull-Schaltfläche? | Push-Schaltfläche? | Verwenden wenn... |
|--------------------------|-------------------|-------------------|--------------------|
| **ServiceNow -> Turbo EA** | Ja | Nein | CMDB ist die Hauptquelle, Sie importieren nur |
| **Turbo EA -> ServiceNow** | Nein | Ja | EA-Werkzeug bereichert CMDB mit Beurteilungen |
| **Bidirektional** | Ja | Ja | Beide Systeme tragen verschiedene Felder bei |

### Feldebene: Richtung

**Pro Feldzuordnung** festgelegt. Steuert, **welcher Systemwert gewinnt** während eines Synchronisationslaufs:

| Feldrichtung | Während Pull (SNOW -> Turbo) | Während Push (Turbo -> SNOW) |
|-------------|------------------------------|-------------------------------|
| **SNOW führt** | Wert wird aus ServiceNow importiert | Wert wird **übersprungen** (nicht gepusht) |
| **Turbo führt** | Wert wird **übersprungen** (nicht überschrieben) | Wert wird nach ServiceNow exportiert |

### Wie sie zusammenwirken — Beispiel

Zuordnung: Application <-> `cmdb_ci_business_app`, **Bidirektional**

| Feld | Richtung | Pull macht... | Push macht... |
|------|----------|--------------|---------------|
| `name` | **Turbo führt** | Überspringt (EA kuratiert Namen) | Pusht EA-Name -> SNOW |
| `description` | **Turbo führt** | Überspringt (EA schreibt Beschreibungen) | Pusht Beschreibung -> SNOW |
| `lifecycle.active` | **Turbo führt** | Überspringt (EA verwaltet Lebenszyklus) | Pusht Go-Live-Datum -> SNOW |
| `attributes.businessCriticality` | **Turbo führt** | Überspringt (EA-Beurteilung) | Pusht Beurteilung -> SNOW-Custom-Feld |
| `attributes.ipAddress` | SNOW führt | Importiert IP aus Erkennung | Überspringt (operative Daten) |
| `attributes.installStatus` | SNOW führt | Importiert operativen Status | Überspringt (ITSM-Daten) |

**Wesentliche Erkenntnis**: Die Richtung auf Tabellenebene bestimmt, *welche Schaltflächen erscheinen*. Die Richtung auf Feldebene bestimmt, *welche Felder tatsächlich übertragen werden* bei jeder Operation. Eine bidirektionale Zuordnung, bei der Turbo EA die meisten Felder führt und SNOW nur operative/technische Felder führt, ist die leistungsfähigste Konfiguration.

### Best Practice: Feldrichtung nach Datentyp

Der Standard sollte **Turbo führt** für die überwiegende Mehrheit der Felder sein. Setzen Sie SNOW führt nur für operative und technische Metadaten, die aus automatischer Erkennung oder ITSM-Workflows stammen.

| Datenkategorie | Empfohlene Richtung | Begründung |
|---------------|---------------------|------------|
| **Namen, Anzeigebezeichnungen** | **Turbo führt** | EA-Team kuratiert autoritative, saubere Namen — CMDB-Namen sind oft automatisch generiert oder inkonsistent |
| **Beschreibung** | **Turbo führt** | EA-Beschreibungen erfassen strategischen Kontext, Geschäftswert und architektonische Bedeutung |
| **Geschäftskritikalität (TIME-Modell)** | **Turbo führt** | Kernbewertung der EA — keine operativen Daten |
| **Funktionale/technische Eignung** | **Turbo führt** | EA-spezifische Bewertung und Roadmap-Klassifizierung |
| **Lebenszyklus (alle Phasen)** | **Turbo führt** | Planung, Einführung, Aktiv, Auslauf, Lebensende sind alles EA-Planungsentscheidungen |
| **Kostendaten** | **Turbo führt** | EA verfolgt Gesamtbetriebskosten und Budgetzuweisung |
| **Hosting-Typ, Klassifizierung** | **Turbo führt** | Strategische Kategorisierung durch Architekten gepflegt |
| **Anbieter-/Provider-Informationen** | **Turbo führt** | EA verwaltet Anbieterstrategie, Verträge und Risiko — SNOW hat möglicherweise einen Anbieternamen, aber EA besitzt die Beziehung |
| Technische Metadaten (OS, IP, Hostname) | SNOW führt | Automatische Erkennungsdaten — EA pflegt das nicht |
| SLA-Ziele, Verfügbarkeitsmetriken | SNOW führt | Operative Daten aus ITSM-Workflows |
| Installationsstatus, operativer Zustand | SNOW führt | CMDB verfolgt, ob ein CI installiert, stillgelegt usw. ist |
| Zuweisungsgruppe, Support-Team | SNOW führt | Operative Zuständigkeit in ServiceNow verwaltet |
| Erkennungs-Metadaten (zuerst/zuletzt gesehen) | SNOW führt | CMDB-Automatisierungs-Zeitstempel |

---

## Staging überspringen — Wann verwenden

Standardmäßig folgen Pull-Synchronisationen einem **Staging-dann-Anwenden**-Workflow:

```
Abrufen -> Abgleich -> Transformation -> Diff -> STAGING -> Überprüfung -> ANWENDEN
```

Datensätze werden in eine Staging-Tabelle geschrieben, sodass Sie überprüfen können, was sich ändern wird, bevor Sie es anwenden. Dies ist im Synchronisations-Dashboard unter «Staging-Datensätze anzeigen» sichtbar.

### Staging-überspringen-Modus

Wenn Sie **Staging überspringen** bei einer Zuordnung aktivieren, werden Datensätze direkt angewendet:

```
Abrufen -> Abgleich -> Transformation -> Diff -> DIREKT ANWENDEN
```

Keine Staging-Datensätze werden erstellt — Änderungen erfolgen sofort.

| | Staging (Standard) | Staging überspringen |
|--|-------------------|---------------------|
| **Überprüfungsschritt** | Ja — Diffs vor dem Anwenden inspizieren | Nein — Änderungen werden sofort angewendet |
| **Staging-Datensätze-Tabelle** | Wird mit Erstellen/Aktualisieren/Löschen-Einträgen befüllt | Wird nicht befüllt |
| **Audit-Spur** | Staging-Datensätze + Event-Historie | Nur Event-Historie |
| **Leistung** | Etwas langsamer (schreibt Staging-Zeilen) | Etwas schneller |
| **Rückgängig machen** | Kann vor dem Anwenden abbrechen | Muss manuell zurücksetzen |

### Wann welchen Modus verwenden

| Szenario | Empfehlung |
|----------|------------|
| Erstmaliger Import | **Staging verwenden** — Überprüfen, was erstellt wird, bevor es angewendet wird |
| Neue oder geänderte Zuordnung | **Staging verwenden** — Überprüfen, dass Feldtransformationen korrekte Ausgabe erzeugen |
| Stabile, gut getestete Zuordnung | **Staging überspringen** — Keine Notwendigkeit, jeden Lauf zu überprüfen |
| Automatisierte tägliche Synchronisationen (Cron) | **Staging überspringen** — Unbeaufsichtigte Läufe können nicht auf Überprüfung warten |
| Großes CMDB (10.000+ CIs) | **Staging überspringen** — Vermeidet das Erstellen Tausender Staging-Zeilen |
| Compliance-sensible Umgebung | **Staging verwenden** — Vollständige Audit-Spur in der Staging-Tabelle beibehalten |

**Best Practice**: Beginnen Sie mit aktiviertem Staging für Ihre ersten Synchronisationen. Sobald Sie sicher sind, dass die Zuordnung korrekte Ergebnisse liefert, aktivieren Sie Staging überspringen für automatisierte Läufe.

---

## Synchronisationsmodi und Löschungssicherheit

### Synchronisationsmodi

| Modus | Erstellt | Aktualisiert | Löscht | Am besten für |
|-------|---------|-------------|--------|---------------|
| **Additiv** | Ja | Ja | **Nie** | Erstimporte, risikoarme Umgebungen |
| **Konservativ** | Ja | Ja | Nur durch **Synchronisation erstellte** Karten | Standard für laufende Synchronisationen |
| **Strikt** | Ja | Ja | Alle verknüpften Karten | Vollständiger Spiegel des CMDB |

**Additiv** entfernt nie Karten aus Turbo EA, was es zur sichersten Option für Erstimporte und Umgebungen macht, in denen Turbo EA Karten enthält, die nicht in ServiceNow vorhanden sind (manuell erstellte Karten, Karten aus anderen Quellen).

**Konservativ** (Standard) verfolgt, ob jede Karte ursprünglich vom Synchronisationsmotor erstellt wurde. Nur diese Karten können automatisch archiviert werden, wenn sie aus ServiceNow verschwinden. Manuell in Turbo EA erstellte oder aus anderen Quellen importierte Karten werden nie berührt.

**Strikt** archiviert jede verknüpfte Karte, deren entsprechendes ServiceNow CI nicht mehr in den Abfrageergebnissen erscheint, unabhängig davon, wer sie erstellt hat. Verwenden Sie dies nur, wenn ServiceNow die absolute Quelle der Wahrheit ist und Sie möchten, dass Turbo EA es exakt spiegelt.

### Max. Löschquote — Sicherheitsnetz

Als Sicherheitsnetz **überspringt der Motor alle Löschungen**, wenn die Anzahl das konfigurierte Verhältnis übersteigt:

```
Löschungen / gesamt_verknüpft > max_löschquote  ->  ALLE LÖSCHUNGEN ÜBERSPRINGEN
```

Beispiel mit 10 verknüpften Datensätzen und 50%-Schwelle:

| Szenario | Löschungen | Quote | Ergebnis |
|----------|-----------|-------|----------|
| 3 CIs normal entfernt | 3 / 10 = 30% | Unter Schwelle | Löschungen werden ausgeführt |
| 6 CIs auf einmal entfernt | 6 / 10 = 60% | **Über Schwelle** | Alle Löschungen übersprungen |
| SNOW gibt leer zurück (Ausfall) | 10 / 10 = 100% | **Über Schwelle** | Alle Löschungen übersprungen |

Dies verhindert katastrophalen Datenverlust durch Filterabfrage-Änderungen, temporäre ServiceNow-Ausfälle oder falsch konfigurierte Tabellennamen.

**Best Practice**: Halten Sie die Löschquote bei **50% oder niedriger** für Tabellen mit weniger als 100 Datensätzen. Für große Tabellen (1.000+) können Sie sicher 25% einstellen.

### Empfohlene Progression

```
Woche 1:     ADDITIV-Modus, Staging EIN, manuell ausführen, jeden Datensatz überprüfen
Woche 2-4:   KONSERVATIV-Modus, Staging EIN, täglich ausführen, Ergebnisse stichprobenartig prüfen
Monat 2+:    KONSERVATIV-Modus, Staging AUS (überspringen), automatisierter täglicher Cron
```

---

## Empfohlene Rezepte nach Typ

### Rezept 1: Anwendungen aus CMDB (Am häufigsten)

**Ziel**: Die Anwendungslandschaft aus ServiceNow importieren, dann die Verantwortung für Namen, Beschreibungen, Beurteilungen und Lebenszyklus in Turbo EA übernehmen. SNOW führt nur operative Felder.

**Zuordnung:**

| Einstellung | Wert |
|-------------|------|
| Kartentyp | Application |
| SNOW-Tabelle | `cmdb_ci_business_app` |
| Richtung | Bidirektional |
| Modus | Konservativ |
| Filter | `active=true^install_status=1` |

**Feldzuordnungen:**

| Turbo EA-Feld | SNOW-Feld | Richtung | Transformation | ID? |
|---------------|-----------|----------|---------------|-----|
| `name` | `name` | **Turbo führt** | Direkt | Ja |
| `description` | `short_description` | **Turbo führt** | Direkt | |
| `lifecycle.active` | `go_live_date` | **Turbo führt** | Datum | |
| `lifecycle.endOfLife` | `retirement_date` | **Turbo führt** | Datum | |
| `attributes.businessCriticality` | `busines_criticality` | **Turbo führt** | Wertzuordnung | |
| `attributes.hostingType` | `hosting_type` | **Turbo führt** | Direkt | |
| `attributes.installStatus` | `install_status` | SNOW führt | Direkt | |
| `attributes.ipAddress` | `ip_address` | SNOW führt | Direkt | |

Wertzuordnungskonfiguration für `businessCriticality`:

```json
{
  "mapping": {
    "1 - most critical": "missionCritical",
    "2 - somewhat critical": "businessCritical",
    "3 - less critical": "businessOperational",
    "4 - not critical": "administrativeService"
  }
}
```

**Tipp für die erste Synchronisation**: Beim allerersten Pull werden SNOW-Werte alle Felder befüllen (da Karten noch nicht existieren). Danach gehören Turbo-führt-Felder dem EA-Team — nachfolgende Pulls aktualisieren nur die operativen SNOW-führt-Felder (Installationsstatus, IP), während das EA-Team alles andere direkt in Turbo EA verwaltet.

**Nach dem Import**: Anwendungsnamen verfeinern, strategische Beschreibungen schreiben, Geschäftsfähigkeiten zuordnen, Beurteilungen der funktionalen/technischen Eignung hinzufügen und Lebenszyklusphasen setzen — all dies gehört nun Turbo EA und wird bei Push-Synchronisationen an ServiceNow zurückgesendet.

---

### Rezept 2: IT-Komponenten (Server)

**Ziel**: Serverinfrastruktur für Infrastrukturabbildung und Abhängigkeitsanalyse importieren. Server sind operativer als Anwendungen, daher kommen mehr Felder von SNOW — aber Turbo EA führt weiterhin bei Namen und Beschreibungen.

**Zuordnung:**

| Einstellung | Wert |
|-------------|------|
| Kartentyp | ITComponent |
| SNOW-Tabelle | `cmdb_ci_server` |
| Richtung | Bidirektional |
| Modus | Konservativ |
| Filter | `active=true^hardware_statusNOT IN6,7` |

**Feldzuordnungen:**

| Turbo EA-Feld | SNOW-Feld | Richtung | Transformation | ID? |
|---------------|-----------|----------|---------------|-----|
| `name` | `name` | **Turbo führt** | Direkt | Ja |
| `description` | `short_description` | **Turbo führt** | Direkt | |
| `attributes.manufacturer` | `manufacturer.name` | **Turbo führt** | Direkt | |
| `attributes.operatingSystem` | `os` | SNOW führt | Direkt | |
| `attributes.ipAddress` | `ip_address` | SNOW führt | Direkt | |
| `attributes.serialNumber` | `serial_number` | SNOW führt | Direkt | |
| `attributes.hostname` | `host_name` | SNOW führt | Direkt | |

**Hinweis**: Bei Servern kommen operative/Erkennungsfelder wie OS, IP, Seriennummer und Hostname natürlich aus SNOWs automatischer Erkennung. Aber das EA-Team besitzt weiterhin den Anzeigenamen (der sich vom Hostnamen unterscheiden kann) und die Beschreibung für strategischen Kontext.

**Nach dem Import**: IT-Komponenten mit Anwendungen über Beziehungen verknüpfen, was den Abhängigkeitsgraphen und Infrastrukturberichte speist.

---

### Rezept 3: Softwareprodukte mit EOL-Tracking

**Ziel**: Softwareprodukte importieren und mit Turbo EAs endoflife.date-Integration kombinieren. Turbo EA führt bei Namen, Beschreibungen und Anbieter — Version ist ein faktisches Feld, bei dem SNOW führen kann.

**Zuordnung:**

| Einstellung | Wert |
|-------------|------|
| Kartentyp | ITComponent |
| SNOW-Tabelle | `cmdb_ci_spkg` |
| Richtung | Bidirektional |
| Modus | Konservativ |
| Filter | `active=true` |

**Feldzuordnungen:**

| Turbo EA-Feld | SNOW-Feld | Richtung | Transformation | ID? |
|---------------|-----------|----------|---------------|-----|
| `name` | `name` | **Turbo führt** | Direkt | Ja |
| `description` | `short_description` | **Turbo führt** | Direkt | |
| `attributes.version` | `version` | SNOW führt | Direkt | |
| `attributes.vendor` | `manufacturer.name` | **Turbo führt** | Direkt | |

**Nach dem Import**: Gehen Sie zu **Admin > EOL** und verwenden Sie die Massensuche, um importierte IT-Komponenten automatisch mit endoflife.date-Produkten abzugleichen. Dies gibt Ihnen automatisiertes EOL-Risiko-Tracking, das CMDB-Inventar mit öffentlichen Lebenszyklus-Daten kombiniert.

---

### Rezept 4: Anbieter / Provider (Bidirektional)

**Ziel**: Das Anbieterregister synchron halten. Turbo EA besitzt Anbieternamen, Beschreibungen und strategischen Kontext. SNOW ergänzt operative Kontaktdaten.

**Zuordnung:**

| Einstellung | Wert |
|-------------|------|
| Kartentyp | Provider |
| SNOW-Tabelle | `core_company` |
| Richtung | Bidirektional |
| Modus | Additiv |
| Filter | `vendor=true` |

**Feldzuordnungen:**

| Turbo EA-Feld | SNOW-Feld | Richtung | Transformation | ID? |
|---------------|-----------|----------|---------------|-----|
| `name` | `name` | **Turbo führt** | Direkt | Ja |
| `description` | `notes` | **Turbo führt** | Direkt | |
| `attributes.website` | `website` | **Turbo führt** | Direkt | |
| `attributes.contactEmail` | `email` | SNOW führt | Direkt | |

**Warum Turbo bei den meisten Feldern führt**: Das EA-Team kuratiert die Anbieterstrategie, verwaltet Beziehungen und verfolgt Risiken — dies umfasst den Anzeigenamen des Anbieters, die Beschreibung und die Web-Präsenz. SNOW führt nur bei operativen Kontaktdaten, die von Beschaffungs- oder Asset-Management-Teams aktualisiert werden können.

---

### Rezept 5: EA-Beurteilungen an ServiceNow zurückpushen

**Ziel**: EA-spezifische Beurteilungen in ServiceNow-Custom-Felder exportieren, damit ITSM-Teams EA-Kontext sehen.

**Zuordnung:**

| Einstellung | Wert |
|-------------|------|
| Kartentyp | Application |
| SNOW-Tabelle | `cmdb_ci_business_app` |
| Richtung | Turbo EA -> ServiceNow |
| Modus | Additiv |

**Feldzuordnungen:**

| Turbo EA-Feld | SNOW-Feld | Richtung | Transformation | ID? |
|---------------|-----------|----------|---------------|-----|
| `name` | `name` | SNOW führt | Direkt | Ja |
| `attributes.businessCriticality` | `u_ea_business_criticality` | Turbo führt | Wertzuordnung | |
| `attributes.functionalSuitability` | `u_ea_functional_fit` | Turbo führt | Wertzuordnung | |
| `attributes.technicalSuitability` | `u_ea_technical_fit` | Turbo führt | Wertzuordnung | |

> **Wichtig**: Push-Synchronisation zu Custom-Feldern (mit Präfix `u_`) erfordert, dass diese Spalten bereits in ServiceNow existieren. Arbeiten Sie mit Ihrem ServiceNow-Administrator zusammen, um sie vor der Konfiguration der Push-Zuordnung zu erstellen. Das Service-Konto benötigt die Rolle `import_admin` für Schreibzugriff.

**Warum das wichtig ist**: ITSM-Teams sehen EA-Beurteilungen direkt in ServiceNow-Incident-/Change-Workflows. Wenn eine «Mission Critical»-Anwendung einen Incident hat, können Prioritätseskalationsregeln den von EA bereitgestellten Kritikalitätswert verwenden.

---

## Transformationstypen-Referenz

### Direkt (Standard)

Übergibt den Wert unverändert. Verwenden Sie dies für Textfelder, die in beiden Systemen das gleiche Format haben.

### Wertzuordnung

Übersetzt aufgezählte Werte zwischen Systemen. Konfigurieren Sie mit einer JSON-Zuordnung:

```json
{
  "mapping": {
    "1": "missionCritical",
    "2": "businessCritical",
    "3": "businessOperational",
    "4": "administrativeService"
  }
}
```

Die Zuordnung kehrt sich automatisch um, wenn von Turbo EA nach ServiceNow gepusht wird. Zum Beispiel wird beim Push `"missionCritical"` zu `"1"`.

### Datumsformat

Kürzt ServiceNow-Datumszeitwerte (`2024-06-15 14:30:00`) auf nur das Datum (`2024-06-15`). Verwenden Sie dies für Lebenszyklusphasen-Daten, bei denen die Uhrzeit irrelevant ist.

### Boolean

Konvertiert zwischen ServiceNow-String-Booleans (`"true"`, `"1"`, `"yes"`) und nativen Booleans. Nützlich für Felder wie «is_virtual», «active» usw.

---

## Sicherheits-Best-Practices

### Anmeldedatenverwaltung

| Praxis | Details |
|--------|---------|
| **Verschlüsselung im Ruhezustand** | Alle Anmeldedaten via Fernet (AES-128-CBC) verschlüsselt, abgeleitet vom `SECRET_KEY`. Wenn Sie `SECRET_KEY` rotieren, geben Sie alle ServiceNow-Anmeldedaten erneut ein. |
| **Minimale Berechtigung** | Erstellen Sie ein dediziertes SNOW-Service-Konto mit Nur-Lese-Zugriff auf spezifische Tabellen. Gewähren Sie nur Schreibzugriff bei Verwendung von Push-Synchronisation. |
| **OAuth 2.0 bevorzugt** | Basic Auth sendet Anmeldedaten bei jedem API-Aufruf. OAuth verwendet kurzlebige Tokens mit Bereichsbeschränkungen. |
| **Anmeldedaten-Rotation** | Passwörter oder Client-Secrets alle 90 Tage rotieren. |

### Netzwerksicherheit

| Praxis | Details |
|--------|---------|
| **HTTPS erzwungen** | HTTP-URLs werden bei der Validierung abgelehnt. Alle Verbindungen müssen HTTPS verwenden. |
| **Tabellennamen-Validierung** | Tabellennamen werden gegen `^[a-zA-Z0-9_]+$` validiert, um Injection zu verhindern. |
| **sys_id-Validierung** | sys_id-Werte werden als 32-stellige Hex-Strings validiert. |
| **IP-Allowlisting** | Konfigurieren Sie die ServiceNow IP Access Control so, dass nur die IP Ihres Turbo EA-Servers erlaubt ist. |

### Zugriffskontrolle

| Praxis | Details |
|--------|---------|
| **RBAC-geschützt** | Alle ServiceNow-Endpunkte erfordern die Berechtigung `servicenow.manage`. |
| **Audit-Spur** | Alle durch Synchronisation erstellten Änderungen veröffentlichen Events mit `source: "servicenow_sync"`, sichtbar in der Kartenhistorie. |
| **Keine Anmeldedaten-Offenlegung** | Passwörter und Geheimnisse werden nie in API-Antworten zurückgegeben. |

### Produktions-Checkliste

- [ ] Dediziertes ServiceNow-Service-Konto (kein persönliches Konto)
- [ ] OAuth 2.0 mit Client-Credentials-Grant
- [ ] Anmeldedaten-Rotationsplan (alle 90 Tage)
- [ ] Service-Konto auf nur zugeordnete Tabellen beschränkt
- [ ] ServiceNow-IP-Allowlist für Turbo EA-Server-IP konfiguriert
- [ ] Max. Löschquote auf 50% oder niedriger eingestellt
- [ ] Synchronisationsläufe auf ungewöhnliche Fehler- oder Löschungszahlen überwacht
- [ ] Filterabfragen enthalten mindestens `active=true`

---

## Operatives Runbook

### Initiale Einrichtungssequenz

```
1. ServiceNow-Service-Konto mit minimal erforderlichen Rollen erstellen
2. Netzwerkkonnektivität überprüfen (kann Turbo EA SNOW über HTTPS erreichen?)
3. Verbindung in Turbo EA erstellen und testen
4. Überprüfen, dass Metamodell-Typen alle Felder haben, die Sie synchronisieren möchten
5. Erste Zuordnung mit ADDITIV-Modus erstellen, Staging EIN
6. Vorschau-Schaltfläche (via API) verwenden, um zu überprüfen, dass die Zuordnung korrekte Ausgabe erzeugt
7. Erste Pull-Synchronisation ausführen — Staging-Datensätze im Synchronisations-Dashboard überprüfen
8. Staging-Datensätze anwenden
9. Importierte Karten im Inventar überprüfen
10. Feldzuordnungen bei Bedarf anpassen, erneut ausführen
11. Zuordnung auf KONSERVATIV-Modus für laufenden Betrieb umstellen
12. Nach mehreren erfolgreichen Läufen Staging überspringen für Automatisierung aktivieren
```

### Laufender Betrieb

| Aufgabe | Häufigkeit | Wie |
|---------|------------|-----|
| Pull-Synchronisation ausführen | Täglich oder wöchentlich | Synchronisations-Dashboard > Pull-Schaltfläche (oder Cron) |
| Synchronisationsstatistiken überprüfen | Nach jedem Lauf | Fehler-/Löschungszahlen prüfen |
| Verbindungen testen | Monatlich | Test-Schaltfläche bei jeder Verbindung klicken |
| Anmeldedaten rotieren | Vierteljährlich | Sowohl in SNOW als auch in Turbo EA aktualisieren |
| Identity Map überprüfen | Vierteljährlich | Verwaiste Einträge über Synchronisationsstatistiken prüfen |
| Kartenhistorie prüfen | Nach Bedarf | Events nach `servicenow_sync`-Quelle filtern |

### Automatisierte Synchronisationen einrichten

Synchronisationen können per API für die Automatisierung ausgelöst werden:

```bash
# Tägliche Pull-Synchronisation um 2:00 Uhr
0 2 * * * curl -s -X POST \
  -H "Authorization: Bearer $TURBOEA_TOKEN" \
  "https://turboea.unternehmen.com/api/v1/servicenow/sync/pull/$MAPPING_ID" \
  >> /var/log/turboea-sync.log 2>&1
```

**Best Practice**: Führen Sie Synchronisationen außerhalb der Hauptverkehrszeiten aus. Für große CMDB-Tabellen (10.000+ CIs) rechnen Sie mit 2-5 Minuten je nach Netzwerklatenz und Datensatzanzahl.

### Kapazitätsplanung

| CMDB-Größe | Erwartete Dauer | Empfehlung |
|------------|-----------------|------------|
| < 500 CIs | < 30 Sekunden | Täglich synchronisieren, Staging optional |
| 500-5.000 CIs | 30s - 2 Minuten | Täglich synchronisieren, Staging überspringen |
| 5.000-20.000 CIs | 2-5 Minuten | Nächtlich synchronisieren, Staging überspringen |
| 20.000+ CIs | 5-15 Minuten | Wöchentlich synchronisieren, Filterabfragen zum Aufteilen verwenden |

---

## Fehlerbehebung

### Verbindungsprobleme

| Symptom | Ursache | Lösung |
|---------|---------|--------|
| `Connection failed: [SSL]` | Selbstsigniertes oder abgelaufenes Zertifikat | Stellen Sie sicher, dass SNOW ein gültiges öffentliches CA-Zertifikat verwendet |
| `HTTP 401: Unauthorized` | Falsche Anmeldedaten | Benutzername/Passwort erneut eingeben; prüfen, ob das Konto nicht gesperrt ist |
| `HTTP 403: Forbidden` | Unzureichende Rollen | `itil` und `cmdb_read` dem Service-Konto gewähren |
| `Connection failed: timed out` | Firewall-Block | Regeln prüfen; Turbo EAs IP in SNOW auf die Allowlist setzen |
| Test OK aber Synchronisation schlägt fehl | Tabellenebene-Berechtigungen | Lesezugriff auf die spezifische CMDB-Tabelle gewähren |

### Synchronisationsprobleme

| Symptom | Ursache | Lösung |
|---------|---------|--------|
| 0 Datensätze abgerufen | Falsche Tabelle oder Filter | Tabellennamen überprüfen; Filterabfrage vereinfachen |
| Alle Datensätze sind «erstellen» | Identitätsfehler | `name` als Identität markieren; überprüfen, ob Namen zwischen den Systemen übereinstimmen |
| Hohe Fehlerzahl | Transformationsfehler | Staging-Datensätze auf Fehlermeldungen prüfen |
| Löschungen übersprungen | Quote überschritten | Schwelle erhöhen oder untersuchen, warum CIs verschwunden sind |
| Änderungen nicht sichtbar | Browser-Cache | Hart aktualisieren; Kartenhistorie auf Events prüfen |
| Doppelte Karten | Mehrere Zuordnungen für denselben Typ | Eine Zuordnung pro Kartentyp pro Verbindung verwenden |
| Push-Änderungen abgelehnt | Fehlende SNOW-Berechtigungen | Rolle `import_admin` dem Service-Konto gewähren |

### Diagnosewerkzeuge

```bash
# Vorschau, wie Datensätze zugeordnet werden (5 Beispiele, keine Seiteneffekte)
POST /api/v1/servicenow/mappings/{mapping_id}/preview

# Tabellen auf der SNOW-Instanz durchsuchen
GET /api/v1/servicenow/connections/{conn_id}/tables?search=cmdb

# Spalten einer Tabelle inspizieren
GET /api/v1/servicenow/connections/{conn_id}/tables/cmdb_ci_business_app/fields

# Staging-Datensätze nach Aktion oder Status filtern
GET /api/v1/servicenow/sync/runs/{run_id}/staged?action=create
GET /api/v1/servicenow/sync/runs/{run_id}/staged?action=update
GET /api/v1/servicenow/sync/runs/{run_id}/staged?status=error
```

---

## API-Referenz (Kurzfassung)

Alle Endpunkte erfordern `Authorization: Bearer <token>` und die Berechtigung `servicenow.manage`. Basispfad: `/api/v1`.

### Verbindungen

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | `/servicenow/connections` | Verbindungen auflisten |
| POST | `/servicenow/connections` | Verbindung erstellen |
| GET | `/servicenow/connections/{id}` | Verbindung abrufen |
| PATCH | `/servicenow/connections/{id}` | Verbindung aktualisieren |
| DELETE | `/servicenow/connections/{id}` | Verbindung + alle Zuordnungen löschen |
| POST | `/servicenow/connections/{id}/test` | Konnektivität testen |
| GET | `/servicenow/connections/{id}/tables` | SNOW-Tabellen durchsuchen |
| GET | `/servicenow/connections/{id}/tables/{table}/fields` | Tabellenspalten auflisten |

### Zuordnungen

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| GET | `/servicenow/mappings` | Zuordnungen mit Feldzuordnungen auflisten |
| POST | `/servicenow/mappings` | Zuordnung mit Feldzuordnungen erstellen |
| GET | `/servicenow/mappings/{id}` | Zuordnung mit Feldzuordnungen abrufen |
| PATCH | `/servicenow/mappings/{id}` | Zuordnung aktualisieren (ersetzt Felder wenn angegeben) |
| DELETE | `/servicenow/mappings/{id}` | Zuordnung löschen |
| POST | `/servicenow/mappings/{id}/preview` | Probelauf-Vorschau (5 Beispiel-Datensätze) |

### Synchronisationsoperationen

| Methode | Pfad | Beschreibung |
|---------|------|-------------|
| POST | `/servicenow/sync/pull/{mapping_id}` | Pull-Synchronisation (`?auto_apply=true` Standard) |
| POST | `/servicenow/sync/push/{mapping_id}` | Push-Synchronisation |
| GET | `/servicenow/sync/runs` | Synchronisationshistorie auflisten (`?limit=20`) |
| GET | `/servicenow/sync/runs/{id}` | Laufdetails + Statistiken abrufen |
| GET | `/servicenow/sync/runs/{id}/staged` | Staging-Datensätze für einen Lauf auflisten |
| POST | `/servicenow/sync/runs/{id}/apply` | Ausstehende Staging-Datensätze anwenden |
