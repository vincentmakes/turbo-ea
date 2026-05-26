# Plattform-Migration

> Aktuell unterstützte Quellplattformen: **SAP LeanIX**. Weitere Adapter (Ardoq, Mega HOPEX, BiZZdesign, Avolution Abacus, …) werden über dieselbe Staging- und Apply-Pipeline angebunden und erscheinen automatisch im Upload-Dialog, sobald sie ausgeliefert werden.

Der Plattform-Migrations-Importer (**Admin → Einstellungen → Migration**) importiert einen vollständigen LeanIX-Workspace und legt ihn in einem überprüfbaren, abgestuften Vorgang als Turbo-EA-Karten, Beziehungen, Tags, Stakeholder, Dokumente, Kommentare und ein vollständig ausgearbeitetes Metamodell an.

## Für wen ist das?

Für Kunden, die von LeanIX (SAP LeanIX) zu Turbo EA wechseln. Der Importer akzeptiert die LeanIX-**Full-Snapshot**-xlsx-Mappe — der mehrblättrige Export mit einem Blatt pro Fact-Sheet-Typ, einem Blatt pro Beziehungstyp, plus `TagGroups`, `Tags`, `Documents`, `Comments`, `Types` und einem `ReadMe`-Referenzblatt. Uploads in anderen Formaten werden bereits beim Hochladen mit einer klaren Fehlermeldung abgelehnt.

## So erhalten Sie den Export

In LeanIX öffnen Sie **Administration → Export → Full Snapshot**. Dadurch entsteht eine einzelne XLSX-Mappe mit allen **aktiven** Fact Sheets sowie deren Beziehungen, Tag-Gruppen, Tags, Dokumenten (in LeanIX *Resources* genannt) und Kommentaren.

**Archivierte Fact Sheets sind im Full Snapshot nicht enthalten** — stellen Sie sie zuerst in LeanIX wieder her, falls sie in Turbo EA landen sollen.

## Der Workflow

1. **Hochladen** des Snapshots unter **Einstellungen → Migration → Neue Migration**. Die Datei verbleibt auf der Festplatte des Servers; die Datenbank speichert nur Metadaten. Das Parsen läuft im Hintergrund und der Status wechselt automatisch von `uploaded → parsed`.

2. **Überprüfen** jedes Entitäts-Typs in der Tab-Ansicht. Jede staged Zeile trägt eine Aktion:
    - `create` — wird in Turbo EA angelegt
    - `update` — existiert bereits; geänderte Felder werden zusammengeführt
    - `skip` — existiert bereits ohne Änderungen
    - `conflict` — Endpunkt fehlt, Typ nicht zugeordnet, Built-in-Kollision, ungültige E-Mail-Adresse usw. — siehe Spalte *Note* für den vollständigen Grund

    Jeder Tab zeigt über der Tabelle eine Reihe von **Filter-Pillen** — eine pro Kartentyp (oder pro Aktion, wo das nicht zutrifft) — sodass eine lange Liste (hunderte Karten, Dutzende Fact-Sheet-Typen) auf einen Ausschnitt eingegrenzt werden kann. Der Tab **Karten** zeigt den aufgelösten **Kartennamen** neben der Quell-UUID. Die Spalte *Note* zeigt den vollständigen Konflikt-Grund; Update-Zeilen zeigen die geänderten Feldnamen mit einem Tooltip, der den `alt → neu`-Übergang aufschlüsselt.

    Die Tabs **Neue Typen**, **Custom-Felder** und **Neue Beziehungen** zeigen das mandantenspezifische Metamodell aus Ihrem Quell-Workspace. Standardmäßig werden diese unverändert übernommen und legen passende Nicht-Built-in-Kartentypen / -Felder / -Beziehungstypen in Turbo EA an.

3. **Importierte Felder zuordnen** (optional, im Tab **Custom-Felder**). Wählen Sie für jede mandantenspezifische Quellspalte eine von drei Optionen aus dem Dropdown neben der Zeile:
    - **Als neues Custom-Feld importieren** (Standard) — die Spalte landet als neues Attribut auf dem Ziel-Kartentyp, unter einer synthetischen Sektion *Imported from {source}*.
    - **Auf ein bestehendes Turbo-EA-Feld abbilden** — der Wert wird auf ein Built-in-Feld des Ziel-Kartentyps geleitet (z. B. LeanIX `businessCriticality` auf den gleichnamigen TEA-Slot). Die Metamodell-Feld-Zeile wird beim Anwenden übersprungen, sodass keine verwaiste Spalte angelegt wird.
    - **Auf eine Lifecycle-Phase abbilden** — für Datums-Spalten wird der Wert auf den Standard-Slot `plan` / `phaseIn` / `active` / `phaseOut` / `endOfLife` in `card.lifecycle` geleitet. Datums-/Zeitstempel-Werte werden automatisch in `YYYY-MM-DD` konvertiert (das `T00:00:00`-Suffix, das einige Plattformen für Datetime-Zellen schreiben, wird abgeschnitten); nicht-parsbare Werte werden verworfen, damit sie die Lifecycle-Map nicht verfälschen.
    - **Dieses Feld nicht importieren** — die Spalte wird vollständig übersprungen, weder als Attribut noch als Metamodell-Feld.

    Die Zuordnung gilt pro Migration und kann jederzeit bearbeitet werden, solange der Status `parsed` oder `previewed` ist. Quell-Plattform-Kernspalten, die der Adapter direkt in Turbo-EA-Standardslots leitet (z. B. LeanIX `name`, `displayName`, `description`, `status`, `category → subtype`, `lifecycle:*`, `qualitySeal`, `completion`), werden oben im Tab in einem schreibgeschützten Info-Banner aufgeführt — für diese gibt es keine Zuordnungsentscheidung zu treffen.

4. **Anwenden**, sobald Sie zufrieden sind. Die Apply-Pipeline läuft in 12 abhängigkeitsgeordneten Pässen (Metamodell-Typen → Metamodell-Felder → Metamodell-Beziehungstypen → Benutzer → Karten → Tag-Gruppen → Tags → Karten-Tag-Zuordnungen → Beziehungen → Subscriptions → Dokumente → Kommentare) unter individuellen Savepoints — eine fehlerhafte Zeile vergiftet nicht den Rest des Imports. Status wechselt von `applying → applied` (oder `failed`, wenn Fehler die Sicherheitsschwelle überschreiten).

    Enthält der geparste Snapshot **Konflikt**-Zeilen, erscheint über den Staging-Tabs ein Warnbanner (mit klickbaren Chips, die direkt zum betroffenen Tab springen), und ein Klick auf **Anwenden** öffnet einen Bestätigungsdialog, der aufschlüsselt, welche Entity-Arten Konflikte tragen. Sie müssen ausdrücklich bestätigen, dass die Konflikt-Zeilen übersprungen werden, bevor der Apply läuft. Das *Apply-Ergebnis* nach dem Anwenden zeigt einen eigenen *Konflikte*-Chip neben *erstellt / aktualisiert / übersprungen / Fehler* — Konflikte sind keine stillen Skips, sondern ein erstrangiges Ergebnis, das der Admin in der Migrations-Historie sieht.

## Was wird importiert

| LeanIX | Turbo EA |
|---|---|
| Application, ITComponent, Business Capability, Business Context, Process, DataObject, Interface, Provider, TechCategory, Platform, Objective, Project / Initiative | Direkte 1:1-Kartentyp-Zuordnung |
| User Group | Organisation mit Subtyp `team`, getaggt `leanix_origin=UserGroup` |
| Lifecycle-Phasen (plan / phaseIn / active / phaseOut / endOfLife) | Wortgetreu auf `cards.lifecycle` übernommen |
| Hierarchie (`childParentRelation`) | In `Card.parent_id` zusammengefasst |
| Successor- / Predecessor-Kanten (`*SuccessorRelation`) | Als Beziehungen gespeichert; die Richtung wird beim Import umgekehrt, damit Turbo EAs Konvention „Quelle folgt Ziel" zur LeanIX-Semantik „X hat Nachfolger Y" passt. Neue mandantenspezifische Kartentypen erhalten `has_successors=true`, sodass die Lineage-Ansicht angezeigt wird. |
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

Idempotenz ist eingebaut. Die Tabelle `migration_identity_map` speichert die LeanIX → Turbo-EA-UUID-Zuordnung für jede importierte Entität. Ein erneuter Upload desselben Snapshots (oder eines aktualisierten Snapshots aus demselben Workspace) erkennt vorhandene Entitäten und erzeugt `update`/`skip`-Staged-Rows statt doppelter `create`s. Das Feld `external_id` der Karte trägt die LeanIX-`factSheetId`, sodass die Verknüpfung erhalten bleibt, selbst wenn die Identity-Map gelöscht wird.

Wenn Sie einen Import wiederholen müssen (z. B. nach einer Bulk-Löschung der importierten Karten in der UI), nutzen Sie das Papierkorb-Symbol in der Migrations-Zeile, um sie zu löschen, und laden Sie dann erneut hoch. `applied`-Migrationen sind löschbar; das gibt die Dateihash-Idempotenz frei, sodass derselbe Snapshot erneut hochgeladen werden kann. Verwaiste `migration_identity_map`-Zeilen, die auf nicht mehr existierende Karten zeigen, werden beim nächsten Staging-Lauf automatisch entfernt — eine manuelle Bereinigung der Identity-Map ist nie erforderlich.

## Berechtigung

Diese Seite ist durch die Berechtigung `admin.migrate` geschützt. Standardmäßig hält nur die **admin**-Rolle diese Berechtigung; vergeben Sie sie unter **Einstellungen → Rollen** explizit an andere Rollen, wenn ein Nicht-Admin die Migration steuern soll.

## Einschränkungen

- **Eine laufende Migration pro Dateihash.** Ein erneuter Upload exakt derselben Bytes liefert den bestehenden Migrations-Datensatz zurück (der SHA-256-Hash ist der natürliche Idempotenz-Schlüssel). Löschen Sie den Datensatz vorher, wenn Sie wirklich einen neuen Import derselben Datei wünschen.
- **Große Workspaces** (10k+ Fact Sheets): der Parser streamt, aber die Apply-Pipeline schreibt Zeilen in einer Transaktion pro Pass. Planen Sie für sehr große Importe ~15 Minuten.
- **Custom-Felder, Werte und Tags werden toleriert, nicht vorab zugeordnet.** Jede LeanIX-Spalte, die nicht im Built-in-Metamodell von Turbo EA ist, landet auf der `attributes`-Map der importierten Karte und erscheint im Tab **Custom-Felder**, damit ein Admin sie weiterverarbeiten kann (auf ein bestehendes TEA-Feld leiten, auf eine Lifecycle-Phase abbilden oder überspringen — siehe *Importierte Felder zuordnen* im Workflow oben). Dasselbe gilt für mandantenspezifische Tag-Gruppen und neue Beziehungstypen (z. B. `lxSystemSystem*`, `*Lx*Dora*`, `microservice*`, `eSGCapability*`) — sie erscheinen unverändert in den Tabs **Neue Typen** / **Neue Beziehungen**, bereit für eine Admin-Entscheidung.
- **Subscription-E-Mails dürfen beide Trennzeichen verwenden.** Der LeanIX-„Full Snapshot"-Export trennt E-Mails in `subscriptions:<RoleType>[:<RoleName>]`-Zellen mit `;`; der GraphQL-CSV-Export verwendet `,`. Der Parser akzeptiert beide. Zeilen mit ungültiger E-Mail (fehlendes `@` oder nicht aufgespaltetes Trennzeichen) werden als `conflict` mit klarer Begründung gestaged statt als unsinnige Benutzer angelegt — Quell-Export korrigieren und neu hochladen.

## Aufräumen

Das Löschen eines Migrations-Datensatzes (Einstellungen → Migration → Papierkorb-Symbol) entfernt sowohl die Datenbankzeilen für diese Migration (Staged Records kaskadieren) als auch die Snapshot-Datei auf der Festplatte. Migrationen in den Status `uploaded`, `parsed`, `previewed`, `failed`, `aborted` und `applied` sind alle löschbar; eine `applying`-Migration muss erst abschließen (oder fehlschlagen), bevor sie entfernt werden kann.
