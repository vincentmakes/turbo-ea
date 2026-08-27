# Jira Todo Sync

Schluss mit zwei Aufgabenlisten. **Jira Todo Sync** spiegelt Turbo-EA-Todos in
ein Jira-Cloud-Projekt Ihrer Wahl und hält beide Seiten abgeglichen: Ein in Turbo
EA angelegtes Todo wird binnen Sekunden zu einem Jira-Vorgang, das Abschließen
überführt den Vorgang in den Status «Erledigt», und Jira-Vorgänge, die auf einen
Filter Ihrer Wahl passen, erscheinen als Todos. Titel, Fälligkeitsdaten und
Zuständigkeiten werden in beide Richtungen abgeglichen.

## Auf einen Blick

| | |
|---|---|
| **Lizenz** | Kommerziell — eine signierte Berechtigung ist erforderlich |
| **Mindestversion von Turbo EA** | 2.68.0 |
| **Berechtigung** | `ext.jira-todos.admin` |
| **Datenzugriffs-Grants** | `core.todos.read`, `core.todos.write`, `core.events.todo`, `core.users.read` |
| **Backend-Neustart nötig** | ja — die Erweiterung enthält Backend-Code |
| **Wo sie erscheint** | **Admin → Einstellungen → Integrationen → Jira Todo Sync** · Vorgangsschlüssel-Kacheln auf der Todos-Seite und in den Todo-Tabs der Karten |

Unterstützt wird ausschließlich **Jira Cloud**. Die Verbindung ist rein
ausgehend — Turbo EA ruft die REST-API von Jira mit einer Konto-E-Mail und einem
API-Token auf. Es gibt keinen OAuth-Callback, keine zu installierende Jira-App
und keinen eingehenden Netzwerkzugriff; die Erweiterung funktioniert daher auch
auf selbst gehosteten oder abgeschotteten Instanzen.

## Einrichtung

### 1. Ein Atlassian-API-Token erstellen

1. Öffnen Sie
   <https://id.atlassian.com/manage-profile/security/api-tokens> und melden Sie
   sich mit dem Atlassian-Konto an, unter dem die Synchronisierung laufen soll.
   Verwenden Sie nach Möglichkeit ein **eigenes Dienstkonto** — Vorgänge werden
   unter diesem Konto angelegt und überführt. (Dieser direkte Link ist der
   verlässliche Weg; die Token-Seite ist über das Profilmenü nicht mehr
   offensichtlich erreichbar.)
2. Klicken Sie **Create API token** — die einfache Variante, **nicht** *Create
   API token with scopes*. **Tokens mit Scopes werden nicht unterstützt.**
3. Vergeben Sie einen Namen (etwa `turbo-ea-sync`) und wählen Sie eine
   Gültigkeitsdauer. Atlassian verlangt eine und begrenzt sie auf **ein Jahr**.
4. **Kopieren Sie das Token sofort** — es wird nur ein einziges Mal angezeigt.

!!! warning "Tokens laufen ab"
    Läuft das Token ab, bricht die Synchronisierung mit Authentifizierungsfehlern
    ab, bis ein neues eingetragen wird. Notieren Sie sich das Ablaufdatum
    gleich bei der Erstellung.

### 2. Turbo EA verbinden

Öffnen Sie **Admin → Einstellungen → Integrationen** und wählen Sie den
Unterreiter **Jira Todo Sync**.

Unter **Jira-Cloud-Verbindung** tragen Sie ein:

| Feld | Hinweise |
|---|---|
| **Site-URL** | Zum Beispiel `https://ihre-site.atlassian.net` |
| **Konto-E-Mail** | Das Atlassian-Konto, zu dem das Token gehört |
| **API-Token** | Verschlüsselt gespeichert. Später leer lassen, um das gespeicherte Token zu behalten |

Klicken Sie **Verbindung testen**. Bei Erfolg wird *Connected as …* gemeldet.

### 3. Den Umfang festlegen

Unter **Sync-Umfang**:

- **Jira-Projekt** — aus der Liste wählen, die aus Jira geladen wird, sobald die
  Verbindungsdaten eingetragen sind. Übertragene Todos entstehen hier als
  Vorgänge des Typs **Task**.
- **Pull-Filter (JQL)** — Vorgänge, die auf dieses JQL passen, werden als Todos
  gespiegelt. Leer lassen für den Standard
  `project = "<KEY>" AND statusCategory != Done`.
- **Abrufintervall (Sekunden)** — wie oft Jira abgefragt wird. Standard 300,
  Minimum 60.

Unter **Richtungen** stehen drei Schalter:

| Schalter | Standard | Wirkung |
|---|---|---|
| **Todos nach Jira übertragen** | an | In Turbo EA angelegte Todos werden zu Jira-Vorgängen; das Abschließen eines Todos überführt den Vorgang |
| **Vorgänge aus Jira abrufen** | an | Passende Jira-Vorgänge erscheinen als Todos; das Lösen eines Vorgangs schließt das Todo ab |
| **Freigabe-Todos spiegeln (einseitig)** | **aus** | Freigaben zu Risiken, Entscheidungen und Projekten werden zu Jira-Vorgängen mit Rückverweis — abgeschlossen werden müssen sie weiterhin in Turbo EA |

Klicken Sie **Konfiguration speichern**. **Jetzt synchronisieren** startet sofort
einen Durchlauf.

Die Zuordnung der Zuständigen muss nicht konfiguriert werden — Turbo EA ordnet
Personen automatisch anhand der E-Mail-Adresse Jira-Konten zu.

## Verhalten der Synchronisierung

| Ereignis | Wirkung |
|---|---|
| Todo in Turbo EA angelegt | Binnen Sekunden entsteht ein Jira-Vorgang (Titel, Beschreibung mit Rückverweis, Fälligkeit, Zuständige) |
| Todo abgeschlossen oder bearbeitet | Der Vorgang wird auf «Erledigt» überführt bzw. seine Felder aktualisiert |
| Vorgang passt auf das JQL | Er wird als Todo gespiegelt |
| Vorgang in Jira gelöst | Das Todo wird beim nächsten Abruf abgeschlossen (wiederkehrende Todos rücken auf den nächsten Zyklus) |
| Vorgang in Jira wieder geöffnet | Das Todo wird wieder geöffnet |
| **Beide Seiten bearbeitet** | **Die neuere Änderung gewinnt; bei Gleichstand gewinnt Jira** |
| Todo in Turbo EA gelöscht | Der Vorgang wird **nie gelöscht** — ein Kommentar vermerkt die Entfernung |
| Vorgang in Jira gelöscht | Ein abgerufenes Todo wird entfernt; ein in Turbo EA erzeugtes Todo bleibt bestehen und wird im Protokoll markiert |

**Das Übertragen erfolgt nahezu in Echtzeit, das Abrufen im Intervall.** In Turbo
EA vorgenommene Änderungen erreichen Jira binnen Sekunden. Änderungen in Jira
werden beim nächsten Abruf übernommen — standardmäßig innerhalb von fünf Minuten.
Jeder Durchlauf gleicht zusätzlich beide Seiten ab, sodass ein Jira-Ausfall oder
ein verlorenes Ereignis von selbst geheilt wird, statt Änderungen zu verlieren.

Abgeglichen werden vier Felder: **Titel**, **Fälligkeitsdatum**, **Status
(erledigt)** und **Zuständige**. Der Titel entspricht der **ersten Zeile** des
Todo-Texts; wird ein Vorgang in Jira umbenannt, ersetzt das genau diese erste
Zeile und lässt weitere Detailzeilen unangetastet.

### Die Vorgangsschlüssel-Kachel

Ein synchronisiertes Todo trägt seinen Jira-Vorgangsschlüssel (etwa `PROJ-123`)
als kleinen Link — sowohl auf der [Todos-Seite](../guide/tasks.md) als auch im
Todo-Tab einer Karte. Ein Klick öffnet den Vorgang in Jira. Die Kachel dient der
Orientierung — abgeschlossen wird ein Todo immer in Turbo EA oder über die
Synchronisierung.

### Freigabe-Todos

Freigabeanforderungen — ein Risiko, eine Entscheidung oder ein Projekt, das auf
jemandes Zustimmung wartet — sind Systemtodos und werden **nie** als gewöhnliche
Todos übertragen. Ist **Freigabe-Todos spiegeln** eingeschaltet, entsteht ein
**einseitiger** Jira-Vorgang, der direkt auf die Seite verweist, auf der die
Freigabe tatsächlich stattfindet.

Eine Freigabe kann niemals aus Jira heraus erteilt werden. Schließt jemand den
Spiegel-Vorgang, während die Pflicht noch offen ist, öffnet die Synchronisierung
ihn mit einem Kommentar wieder, der nach Turbo EA zurückverweist. Ist die
Freigabe in Turbo EA erledigt, wird der Spiegel beim nächsten Abruf auf
«Erledigt» gesetzt.

Wird der Schalter ausgeschaltet, entstehen keine *neuen* Spiegel mehr; bestehende
werden weiter gepflegt.

## Überwachung

Die Zeile **Status** zeigt, wann zuletzt synchronisiert wurde, einen etwaigen
Fehler und eine Zusammenfassung. **Letzte Aktivität** darunter listet die 50
jüngsten Aktionen mit Zeit, Richtung (**Turbo EA → Jira**, **Jira → Turbo EA**
oder **Sync**), Vorgang und Detailmeldung. Warnungen und Fehler sind farblich
hervorgehoben — hier zeigen sich nicht zuordenbare Zuständige oder abgelehnte
Statusübergänge.

## Berechtigungen

| Berechtigung | Erlaubt |
|---|---|
| `ext.jira-todos.admin` | Die Synchronisierung konfigurieren und betreiben — Verbindung, Projekt, Filter, manueller Lauf, Protokoll |

Der Unterreiter ist für alle ohne diese Berechtigung vollständig ausgeblendet.
**Endanwenderinnen und Endanwender brauchen keine zusätzliche Berechtigung**:
synchronisierte Todos erscheinen einfach in ihrer gewohnten Todo-Liste, mit der
Vorgangsschlüssel-Kachel.

## Wenn die Lizenz abläuft oder die Erweiterung deaktiviert wird

Der Synchronisierungs-Job und sein Ereignis-Handler pausieren sofort, und die
Datenzugriffs-Grants werden entzogen. **Es wird nichts gelöscht** — Todos behalten
ihre Kacheln, und die Einstellungen bleiben erhalten. Eine erneuerte Lizenz nimmt
die Synchronisierung dort wieder auf, wo sie aufgehört hat.

Das API-Token wird auf Ihrer Instanz verschlüsselt gespeichert und ist vom
Workspace-Transfer ausgenommen; es verlässt die Instanz also nie, auf der es
eingetragen wurde.

## Fehlersuche und Grenzen

- **Nur Jira Cloud.** Jira Data Center wird nicht unterstützt.
- **Ein Projekt pro Instanz**, und Vorgänge entstehen stets als Typ **Task**.
- **Abruf statt Webhooks.** Änderungen auf der Jira-Seite kommen beim nächsten
  Abruf an. Jira-Cloud-Webhooks würden eine OAuth-App und eine aus dem Internet
  erreichbare Instanz erfordern und trotzdem einen abgleichenden Abruf brauchen —
  daher arbeitet die Synchronisierung bewusst intervallbasiert.
- **Zuordnung von Zuständigen und E-Mail-Datenschutz.** Turbo EA ordnet Personen
  zunächst über die E-Mail-Adresse zu und weicht dann auf eine exakte
  Übereinstimmung des Anzeigenamens unter den zuweisbaren Projektmitgliedern aus.
  Wessen E-Mail in Jira verborgen ist *und* wessen Anzeigename sich zwischen
  beiden Systemen unterscheidet, lässt sich nicht zuordnen; diese Zuständigen
  bleiben unverändert, und das Protokoll nennt die E-Mail-Adresse, die nicht
  gefunden wurde. Ein nicht zuordenbarer Turbo-EA-Zuständiger hebt niemals
  stillschweigend die Zuweisung des Jira-Vorgangs auf.
- **Das Leeren eines Fälligkeitsdatums in Jira wird nicht zurückgespiegelt.**
  Leeren Sie es stattdessen in Turbo EA.
- **Spiegel von Freigabe-Todos sind einseitig und hinken bis zu einem
  Abrufintervall hinterher**, weil die Freigabeprozesse des Kerns keine
  Änderungsereignisse aussenden.
- **Jetzt synchronisieren** meldet *A sync is already running*, wenn bereits ein
  Lauf aktiv ist.
- Nach dem Wechsel des `SECRET_KEY` Ihrer Instanz lässt sich das gespeicherte
  Token nicht mehr entschlüsseln, und das Panel zeigt wieder *Not configured
  yet* — tragen Sie das Token erneut ein.
