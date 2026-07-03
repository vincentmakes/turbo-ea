# Workspace-Transfer

Der Workspace-Transfer (**Admin → Einstellungen → Migration → Workspace Transfer**) verschiebt einen kompletten Turbo-EA-Workspace von einer Instanz auf eine andere als ein einziges, in sich geschlossenes Bundle. Der treibende Anwendungsfall: Sie bauen einen Workspace auf einer **lokalen** Instanz auf und müssen alles auf **Produktion** übertragen.

![Workspace-Transfer](../assets/img/de/58_workspace_transfer.png)

## Was ist enthalten

Der Export erfasst den vollständigen Workspace als `.zip`-Bundle, das eine Excel-Mappe (alle strukturierten Daten, ein Blatt pro Domäne) sowie, wo relevant, einen `assets/`-Ordner für unstrukturierte Dateien enthält:

- **Metamodell** — Kartentypen und Beziehungstypen, einschließlich aller Custom-Felder, Subtypen, Sektionen und Übersetzungen.
- **Konfiguration** — Rollen, typspezifische Stakeholder-Rollen, Tag-Gruppen und Tags, berechnete Felder, EA-Prinzipien und Compliance-Regulierungen.
- **Einstellungen** — Währung, Datumsformat, Feature-Flags, Login-Branding, aktivierte Sprachen und die übrigen allgemeinen Anwendungseinstellungen.
- **Benutzer** — E-Mail, Anzeigename, Rolle und Aktiv-Flag (verwendet, um Eigentümerschaft und Zuweisungen auf dem Ziel neu zu verknüpfen). Keine Passwörter oder SSO-Identitäten.
- **Inventar** — jede Karte (mit ihrer Hierarchie, ihrem Lifecycle und ihren Attributen), Karten-Tags und Beziehungen.
- **Karten-Kontext** — Stakeholder, Dokument-Links, Kommentare, Todos und Datei-Anhänge.
- **Moduldaten** — BPM (Prozessdiagramme, Elemente, Flow-Versionen, Assessments), PPM (Statusberichte, Kosten, Budgets, Risiken, Aufgaben, WBS, Abhängigkeiten), das GRC-Risikoregister (Risiken, Mitigationsaufgaben und -occurrences, Kartenverknüpfungen), GRC-Compliance-Befunde (mit den Analyseläufen, auf die sie verweisen), Architektur-Entscheidungen und Statements of Architecture Work, Freihand-Diagramme, gespeicherte Berichte, Lesezeichen (gespeicherte Inventar-Ansichten, einschließlich ihrer Freigaben), Web-Portale und Umfragen.
- **Assets** — binäre Datei-Anhänge, Diagramm- und BPMN-XML sowie Logo/Favicon reisen als separate Dateien im `assets/`-Ordner des Bundles.

## Was niemals enthalten ist

Aus Sicherheitsgründen werden **Geheimnisse niemals exportiert**:

- SMTP-Passwort
- SSO-Client-Secret
- API-Schlüssel des AI-Providers
- ServiceNow-Zugangsdaten

Diese müssen Sie nach dem Import auf der Zielinstanz erneut eingeben. Das ist konstruktionsbedingt unvermeidbar: Verschlüsselte Werte sind an den `SECRET_KEY` der Quellinstanz gebunden und können nirgendwo sonst entschlüsselt werden.

Einige weitere Dinge bleiben absichtlich zurück:

- **TurboLens-Analyseergebnisse** (Vendor-Analyse, Duplikat-Cluster, Modernisierungs-Assessments, gespeicherte Architektur-Assessments) und die KPI-Historie des Dashboards sind instanzlokal — führen Sie die Analysen auf dem Ziel erneut aus. Compliance-Befunde sind die Ausnahme und werden übertragen.
- **Browser-lokaler Zustand** wird niemals übertragen: Die Ad-hoc-Spaltenreihenfolge des Inventar-Rasters liegt im Local Storage Ihres Browsers, nicht in der Datenbank. Ein Spaltenlayout, das Sie **in einer gespeicherten Ansicht** gespeichert haben, wird dagegen mit der Ansicht übertragen.

## Exportieren

1. Öffnen Sie **Admin → Einstellungen → Migration → Workspace Transfer**.
2. (Optional) Aktivieren Sie **Archivierte Karten einschließen**, um archiviertes Inventar zum Bundle hinzuzufügen.
3. Klicken Sie auf **Bundle exportieren**. Ihr Browser lädt `workspace_export_<timestamp>.zip` herunter.

## Importieren

1. Öffnen Sie auf der **Ziel**-Instanz **Admin → Einstellungen → Migration → Workspace Transfer**.
2. Klicken Sie unter **Workspace importieren** auf **Bundle auswählen…** und wählen Sie die von Ihnen exportierte `.zip` aus.
3. Turbo EA parst das Bundle und zeigt eine **Probelauf-Vorschau** — eine Tabelle pro Sektion, die anzeigt, wie viele Entitäten erstellt, aktualisiert, übersprungen oder im Konflikt stehen würden. Es wird noch nichts geschrieben.
4. Überprüfen Sie die Vorschau und klicken Sie dann auf **Import anwenden**.

Der Import ist **idempotent**: Metamodell und Konfiguration werden über den Schlüssel abgeglichen, Karten über die externe ID oder über Typ + Hierarchiepfad, und Benutzer über die E-Mail. Ein erneuter Import desselben Bundles ist sicher — bereits vorhandene Entitäten werden übersprungen statt dupliziert. Bestehende Built-in-Metamodell-Typen behalten ihre Identität; nur ihr editierbares Schema wird zusammengeführt.

### Die Vorschau lesen

- **Übersprungen bedeutet „bereits vorhanden — keine Aktion nötig“.** Auf einer frischen Installation sehen Sie typischerweise übersprungene Einträge für Inhalte, die mit Turbo EA ausgeliefert werden (Stakeholder-Rollen, Ressourcentypen, Standardeinstellungen), weil die Kopie im Bundle mit dem identisch ist, was das Ziel bereits hat. Klappen Sie eine Sektionszeile auf (der Pfeil links), um die Aufschlüsselung nach Grund sowie etwaige Konflikt- oder Fehlermeldungen zu sehen.
- **Versionshinweis.** Die Vorschau zeigt, aus welcher Turbo-EA-Version das Bundle exportiert wurde, und warnt, wenn sie von der importierenden Instanz abweicht. Die Warnung ist rein informativ — der Import läuft trotzdem — aber Export und Import auf derselben Version ist der sicherste Weg.

## Nach dem Import

- Geben Sie alle SMTP-, SSO- und AI-Zugangsdaten unter den jeweiligen Einstellungs-Tabs erneut ein.
- Vom Bundle referenzierte synthetische Benutzer werden **deaktiviert** erstellt; aktivieren Sie sie bei Bedarf unter **Admin → Benutzer**.
- **Benutzereigene Daten folgen dem Benutzer, abgeglichen über die E-Mail.** Todos, gespeicherte Ansichten, Favoriten und andere persönliche Daten gehören zu dem Konto, dessen E-Mail mit der im Bundle übereinstimmt. Wenn Sie sich auf dem Ziel mit einer anderen E-Mail anmelden als auf der Quelle, scheinen Ihre persönlichen Elemente zu fehlen — sie hängen am (möglicherweise deaktivierten) passenden Konto. Melden Sie sich mit derselben E-Mail an oder aktivieren Sie das zugeordnete Konto unter **Admin → Benutzer**.
- Private gespeicherte Ansichten sind nur für ihren Eigentümer sichtbar; geteilte und öffentliche Ansichten folgen ihren Sichtbarkeitseinstellungen.

## Von vorn beginnen

Es gibt kein eingebautes „Import rückgängig machen“. Um eine Zielinstanz zurückzusetzen und von Grund auf neu zu importieren, starten Sie sie einmal mit `RESET_DB=true` neu (löscht und erstellt alle Tabellen neu und führt anschließend das Seeding erneut aus), und setzen Sie den Wert **vor** dem nächsten Neustart wieder auf `RESET_DB=false`, damit Sie die frisch importierten Daten nicht löschen.

## Berechtigungen

Der Workspace-Transfer ist durch zwei dedizierte Berechtigungen geschützt, die beide Administratoren erteilt werden:

- `admin.export_workspace` — das Bundle exportieren.
- `admin.import_workspace` — einen Import in der Vorschau anzeigen und anwenden.
