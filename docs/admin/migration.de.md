# Plattform-Migration (LeanIX)

Der Plattform-Migrations-Importer (**Admin → Einstellungen → Migration**) importiert einen vollständigen LeanIX-Workspace und legt ihn in einem überprüfbaren, abgestuften Vorgang als Turbo-EA-Karten, Beziehungen, Tags, Stakeholder, Dokumente, Kommentare und ein vollständig ausgearbeitetes Metamodell an.

## Für wen ist das?

Für Kunden, die von LeanIX (SAP LeanIX) zu Turbo EA wechseln. Der Importer akzeptiert **zwei Snapshot-Formate**, beide automatisch nach Dateiinhalt erkannt:

- **`.xlsx` Full Export** (Standard für die meisten Kunden) — die mehrfache Excel-Mappe, die LeanIX über *Reports → Full Export* erzeugt. Ein Blatt pro Fact-Sheet-Typ, ein Blatt pro Beziehungstyp, plus `TagGroups`, `Tags`, `Documents`, `Comments`, `Types` und ein `ReadMe`-Referenzblatt. Jeder LeanIX-Benutzer kann diese Datei erzeugen; kein Admin-Zugang erforderlich.
- **gzip-komprimierter JSON Workspace-Snapshot** (`workspace-<id>-<datum>.json.gz`) — der Mandanten-Klon-Snapshot, der über **Administration → Workspace → Conduct a Data Snapshot** erzeugt wird. Nur für Admins.

Beide Formate landen im selben internen Modell — der Parser erkennt anhand des Dateiinhalts (ZIP-Magic `PK\x03\x04` für xlsx, gzip-Magic `\x1f\x8b` für JSON), welches Format geladen wurde, sodass selbst eine falsch benannte Datei korrekt verarbeitet wird.

## So erhalten Sie den Export

- **xlsx Full Export** — In LeanIX erzeugt **Reports → … → Full Export** eine Datei wie `20260518_snapshot_demo.xlsx` mit allen aktiven Fact Sheets, allen Beziehungen, den Tag-/Dokument-/Kommentar-Metadaten und einem `ReadMe`-Blatt, das jede Spalte und ihre zulässigen Werte dokumentiert.
- **JSON Workspace-Snapshot** — In LeanIX löst **Administration → Workspace → Conduct a Data Snapshot** den Mandanten-Klon-Snapshot aus. Die Ausgabedatei heißt typischerweise `workspace-<id>-<datum>.json.gz`. Für diesen Export benötigen Sie Admin-Zugang in LeanIX.

Falls Sie keinen Admin-Zugang in LeanIX, aber ein Mandanten-API-Token haben, ergibt die Kombination aus den GraphQL-Abfragen `allFactSheets`, `subscriptions`, `relations` und `documents` ein JSON-Datenset im Snapshot-Format — der Importer akzeptiert es ebenfalls.

## Der Workflow

1. **Hochladen** des Snapshots unter **Einstellungen → Migration → Neue Migration**. Die Datei verbleibt auf der Festplatte des Servers; die Datenbank speichert nur Metadaten. Das Parsen läuft im Hintergrund und der Status wechselt automatisch von `uploaded → parsed`.

2. **Überprüfen** jedes Entitäts-Typs in der Tab-Ansicht. Jede staged Zeile trägt eine Aktion:
    - `create` — wird in Turbo EA angelegt
    - `update` — existiert bereits; geänderte Felder werden zusammengeführt
    - `skip` — existiert bereits ohne Änderungen
    - `conflict` — Endpunkt fehlt, Typ nicht zugeordnet oder Built-in-Kollision — siehe Spalte *Note*

    Die Tabs **Neue Typen**, **Custom-Felder** und **Neue Beziehungen** zeigen das mandantenspezifische Metamodell aus Ihrem LeanIX-Workspace. Standardmäßig werden diese unverändert übernommen und legen passende Nicht-Built-in-Kartentypen / -Felder / -Beziehungstypen in Turbo EA an. Für feinere Kontrolle bearbeiten Sie den vorgeschlagenen Schlüssel/Label/Typ im Staged-Record-JSON vor dem Anwenden.

3. **Anwenden**, sobald Sie zufrieden sind. Die Apply-Pipeline läuft in 12 abhängigkeitsgeordneten Pässen unter individuellen Savepoints — eine fehlerhafte Zeile vergiftet nicht den Rest des Imports. Status wechselt von `applying → applied` (oder `failed`, wenn Fehler die Sicherheitsschwelle überschreiten).

## Was wird importiert

| LeanIX | Turbo EA |
|---|---|
| Application, ITComponent, Business Capability, Business Context, Process, DataObject, Interface, Provider, TechCategory, Platform, Objective, Project / Initiative | Direkte 1:1-Kartentyp-Zuordnung |
| User Group | Organisation mit Subtyp `team`, getaggt `leanix_origin=UserGroup` |
| Lifecycle-Phasen (plan / phaseIn / active / phaseOut / endOfLife) | Wortgetreu auf `cards.lifecycle` übernommen |
| Hierarchie (`childParentRelation`) | In `Card.parent_id` zusammengefasst |
| Successor- / Predecessor-Kanten (`*SuccessorRelation`) | Als Beziehungen gespeichert; neue mandantenspezifische Kartentypen erhalten `has_successors=true`, sodass die Lineage-Ansicht angezeigt wird |
| Beziehungen (50+ Standard-LeanIX-Beziehungstypen, sowohl xlsx-Notation `applicationITComponentRelation` als auch GraphQL-Notation `relApplicationToITComponent`) | Native Turbo-EA-Beziehungen mit Kantenattributen |
| Mandantenspezifische Beziehungstypen (Server↔Application, lxSystem*, lxDora*, microservice*, ESG*, etc.) | Neue Nicht-Built-in-`relation_types`-Einträge, im selben Importlauf automatisch angelegt, damit jede Kante tatsächlich landet |
| Tags (Single- / Multi-Gruppen) | Tag-Gruppen + Tags + Pro-Karte-Joins |
| Subscriptions (eine pro RESPONSIBLE-/OBSERVER-Rolle) | Stakeholder-Einträge; Benutzer werden als deaktiviert (`is_active=false`) automatisch angelegt |
| Dokumente (URL) | Dokument-Anhänge |
| Kommentare (Top-Level + Antworten, abgeflacht) | Kommentar-Einträge |
| Mandantenspezifische Fact-Sheet-Typen (z. B. `ESGCapability`, `Server`, `System`, `TechPlatform`, `TechnicalStack`) | Neue Nicht-Built-in-Kartentypen mit `has_hierarchy=true`, `has_successors=true` und vorbefüllter Sektion `Imported from LeanIX` |
| Mandantenspezifische Felder | An die `fields_schema` des Zieltyps unter der synthetischen Sektion `Imported from LeanIX` angehängt. Feldtyp und die **vollständige** Enum-Wertliste werden aus dem `ReadMe`-Referenzblatt der Datei übernommen — `currentMaturity` landet als Single-Select mit allen 5 Werten (`adHoc, repeatable, defined, managed, optimized`), auch wenn die Daten nur einen verwenden |
| Mandantenspezifische Beziehungstypen | Neue Nicht-Built-in-Beziehungstypen, Endpunkttypen über die LX↔TEA-Typzuordnung übersetzt (`UserGroup → Organization`, etc.) |

### Warum das ReadMe-Blatt wichtig ist

Das erste Blatt der xlsx-Datei (`ReadMe`) ist LeanIXs autoritative Feldreferenz: jede Spalte wird mit ihrem Typ (`String`, `Integer`, `Percent`, `Datetime`, `Boolean`, `String list`) und gegebenenfalls ihrer vollständigen Enum-Beschränkung (`Possible values: one of A, B, C.`) dokumentiert. Der Importer liest dieses Blatt zuerst und nutzt es als primäre Wahrheitsquelle für Feld-Metadaten — auf das in-Data-`Types`-Blatt wird nur zurückgegriffen, wenn das ReadMe eine Spalte nicht abdeckt. Das ist der Unterschied zwischen einem importierten Feld als freiem Texteingabefeld und einem korrekten Dropdown mit den passenden Optionen.

## Was wird **nicht** importiert

Der Snapshot enthält Folgendes nicht — der Importer kennzeichnet Fehlendes in der Spalte *Note* pro Zeile:

- **Dokument-Binärdateien** — nur URLs sind im Snapshot enthalten; der Importer legt Link-Dokumente an. Binärdateien manuell neu hochladen.
- **Kommentar-Threading** — Antworten werden zu Top-Level-Kommentaren abgeflacht, um den Inhalt zu erhalten; Thread-Eltern bräuchten LeanIX-UI-Metadaten, die nicht im Snapshot enthalten sind.
- **Benutzer-Passwörter und SSO-Bindungen** — automatisch erstellte Benutzer landen deaktiviert. Laden Sie sie ein oder binden Sie sie nachträglich an SSO.
- **Audit-Verlauf** vor dem Import — der Turbo-EA-Verlauf beginnt mit dem Apply-Zeitstempel.
- **Diagramme / Poster-Ansichten / Dashboards / gespeicherte Suchen / Benachrichtigungseinstellungen / API-Tokens / Webhooks** — kein Äquivalent in Turbo EA oder kein Pendant im Snapshot.

## Wiederholung eines Imports

Idempotenz ist eingebaut. Die Tabelle `leanix_identity_map` speichert die LeanIX → Turbo-EA-UUID-Zuordnung für jede importierte Entität. Ein erneuter Upload desselben Snapshots (oder eines aktualisierten Snapshots aus demselben Workspace) erkennt vorhandene Entitäten und erzeugt `update`/`skip`-Staged-Rows statt doppelter `create`s. Das Feld `external_id` der Karte trägt die LeanIX-`factSheetId`, sodass die Verknüpfung erhalten bleibt, selbst wenn die Identity-Map gelöscht wird.

Wenn Sie einen Import wiederholen müssen (z. B. nach einer Bulk-Löschung der importierten Karten in der UI), nutzen Sie das Papierkorb-Symbol in der Migrations-Zeile, um sie zu löschen, und laden Sie dann erneut hoch. `applied`-Migrationen sind löschbar; das gibt die Dateihash-Idempotenz frei, sodass derselbe Snapshot erneut hochgeladen werden kann. Verwaiste `leanix_identity_map`-Zeilen, die auf nicht mehr existierende Karten zeigen, werden beim nächsten Staging-Lauf automatisch entfernt — eine manuelle Bereinigung der Identity-Map ist nie erforderlich.

## Berechtigung

Diese Seite ist durch die Berechtigung `admin.migrate` geschützt. Standardmäßig hält nur die **admin**-Rolle diese Berechtigung; vergeben Sie sie unter **Einstellungen → Rollen** explizit an andere Rollen, wenn ein Nicht-Admin die Migration steuern soll.

## Einschränkungen

- **Eine laufende Migration pro Dateihash.** Ein erneuter Upload exakt derselben Bytes liefert den bestehenden Migrations-Datensatz zurück (der SHA-256-Hash ist der natürliche Idempotenz-Schlüssel). Löschen Sie den Datensatz vorher, wenn Sie wirklich einen neuen Import derselben Datei wünschen.
- **Große Workspaces** (10k+ Fact Sheets): der Parser streamt, aber die Apply-Pipeline schreibt Zeilen in einer Transaktion pro Pass. Planen Sie für sehr große Importe ~15 Minuten.
- **Custom-Felder, Werte und Tags werden toleriert, nicht vorab zugeordnet.** Jede LeanIX-Spalte, die nicht im Built-in-Metamodell von Turbo EA ist, landet auf der `attributes`-Map der importierten Karte und erscheint im Tab **Custom-Felder**, damit ein Admin sie zu einem First-Class-Feld befördern kann. Dasselbe gilt für mandantenspezifische Tag-Gruppen und neue Beziehungstypen (z. B. `lxSystemSystem*`, `*Lx*Dora*`, `microservice*`, `eSGCapability*`) — sie erscheinen unverändert in den Tabs **Neue Typen** / **Neue Beziehungen**, bereit für eine Admin-Entscheidung.

## Aufräumen

Das Löschen eines Migrations-Datensatzes (Einstellungen → Migration → Papierkorb-Symbol) entfernt sowohl die Datenbankzeilen für diese Migration (Staged Records kaskadieren) als auch die Snapshot-Datei auf der Festplatte. Migrationen in den Status `uploaded`, `parsed`, `previewed`, `failed`, `aborted` und `applied` sind alle löschbar; eine `applying`-Migration muss erst abschließen (oder fehlschlagen), bevor sie entfernt werden kann.
