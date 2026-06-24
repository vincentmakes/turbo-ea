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
- **Moduldaten** — BPM (Prozessdiagramme, Elemente, Flow-Versionen, Assessments), PPM (Statusberichte, Kosten, Budgets, Risiken, Aufgaben, WBS, Abhängigkeiten), das GRC-Risikoregister (Risiken, Mitigationsaufgaben und -occurrences, Kartenverknüpfungen), Architektur-Entscheidungen und Statements of Architecture Work, Freihand-Diagramme, gespeicherte Berichte, Lesezeichen, Web-Portale und Umfragen.
- **Assets** — binäre Datei-Anhänge, Diagramm- und BPMN-XML sowie Logo/Favicon reisen als separate Dateien im `assets/`-Ordner des Bundles.

## Was niemals enthalten ist

Aus Sicherheitsgründen werden **Geheimnisse niemals exportiert**:

- SMTP-Passwort
- SSO-Client-Secret
- API-Schlüssel des AI-Providers
- ServiceNow-Zugangsdaten

Diese müssen Sie nach dem Import auf der Zielinstanz erneut eingeben. Das ist konstruktionsbedingt unvermeidbar: Verschlüsselte Werte sind an den `SECRET_KEY` der Quellinstanz gebunden und können nirgendwo sonst entschlüsselt werden.

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

## Nach dem Import

- Geben Sie alle SMTP-, SSO- und AI-Zugangsdaten unter den jeweiligen Einstellungs-Tabs erneut ein.
- Vom Bundle referenzierte synthetische Benutzer werden **deaktiviert** erstellt; aktivieren Sie sie bei Bedarf unter **Admin → Benutzer**.

## Berechtigungen

Der Workspace-Transfer ist durch zwei dedizierte Berechtigungen geschützt, die beide Administratoren erteilt werden:

- `admin.export_workspace` — das Bundle exportieren.
- `admin.import_workspace` — einen Import in der Vorschau anzeigen und anwenden.
