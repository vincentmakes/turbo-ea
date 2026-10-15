# Audit-Log

Das **Audit-Log** unter **Admin → Einstellungen → Audit-Log** (`/admin/settings?tab=audit-log`) beantwortet die beiden Fragen, die eine Sicherheitsprüfung an eine Instanz stellt, die eine Landkarte der gesamten IT-Landschaft enthält: *Was hat sich darin geändert* und *wer hat sich wie angemeldet*. Es ist in zwei Unterregisterkarten aufgeteilt:

| Unterregisterkarte | URL | Was sie aufzeichnet |
|--------------------|-----|---------------------|
| **Änderungen** | `/admin/settings?tab=audit-log` | Jeden Schreibvorgang in der Landschaft — Karten, Beziehungen, Risiken, Tags, Stakeholder-Rollen, Entscheidungsentwürfe —, gruppiert in Mutations-Batches, mit einem Diff pro Ereignis und einem **Rollback** |
| **Sicherheit & Administration** | `/admin/settings?tab=audit-log&view=security` | Anmeldungen und Abmeldungen, fehlgeschlagene Versuche, Sperrungen, SSO- und Proxy-Sitzungen, Passwortereignisse, Rollenübernahme und jede administrative Aktion |

Die beiden sind bewusst getrennt. **Änderungen** ist ein Arbeitswerkzeug — es existiert, damit Sie einen fehlerhaften Schreibvorgang sehen und rückgängig machen können — und hält nur eine kurze Historie vor. **Sicherheit & Administration** ist eine Beweisspur: Ihre Einträge lassen sich weder bearbeiten noch löschen, und sie wird standardmäßig ein Jahr lang aufbewahrt.

## Wer es sehen darf

Beide Unterregisterkarten erfordern die Berechtigung **`admin.events`** („Audit-Trail und Ereignisstrom anzeigen“), die standardmäßig nur die Rolle **Admin** besitzt. Um einer Sicherheits- oder Compliance-Verantwortlichen Lesezugriff zu geben, ohne sie zur Administratorin zu machen, legen Sie unter [Benutzer und Rollen](users.md#rollen) eine Rolle mit `admin.events` an und weisen Sie sie ihr zu.

## Änderungen

Die Unterregisterkarte **Änderungen** ist das Register der Mutations-Batches. Jeder ändernde Schreibvorgang landet hier als Batch, zusammen mit der Person, die ihn ausgelöst hat, und seiner Herkunft:

| Herkunft | Bedeutung |
|----------|-----------|
| **Web** | Die Weboberfläche von Turbo EA |
| **API** | Ein direkter Aufruf der REST-API (ein Skript, eine Integration) |
| **KI-Werkzeug** | Ein KI-Assistent, der über den [MCP-Server](mcp.md) verbunden ist |
| **Erweiterung** | Eine installierte [Erweiterung](extensions.md), aufgezeichnet als `ext:<key>`-Batch |

Klicken Sie auf einen Batch, um seine Seitenleiste zu öffnen: Der Diff pro Ereignis zeigt den alten und neuen Wert jedes Felds, und **Rollback** nimmt die Schreibvorgänge an Karten, Beziehungen, Risiken, Stakeholder-Rollen, Tags und Entscheidungsentwürfen zurück, die er vorgenommen hat.

Batches werden **`MUTATION_BATCH_RETENTION_DAYS`** Tage lang aufbewahrt (eine Umgebungsvariable, Standard **15**) und danach automatisch bereinigt. Die Ereignisse selbst bleiben auch danach in der Registerkarte **Historie** jeder Karte erhalten.

## Sicherheit & Administration

![Sicherheits- und Administrationsprotokoll](../assets/img/de/62_admin_audit_log_sicherheit.png)

Die Unterregisterkarte **Sicherheit & Administration** listet einen Eintrag pro sicherheitsrelevanter Aktion, die neuesten zuerst:

- An- und Abmeldungen, per Passwort, SSO oder über einen vertrauenswürdigen Reverse Proxy;
- fehlgeschlagene Anmeldeversuche, jeweils mit einem **Grundcode**, der angibt, warum sie fehlschlugen;
- Kontosperrungen nach wiederholten Fehlversuchen;
- Registrierungen sowie das Festlegen, Zurücksetzen und Ändern von Passwörtern;
- Rollenübernahme — eine Administratorin, die **Als Rolle anzeigen…** startet und beendet;
- administrative Aktionen — Änderungen an Benutzern, Rollen, Einstellungen, dem Metamodell, Tags, Berechnungen, Erweiterungen, Importen, Integrationen, öffentlichen Portalen und veröffentlichten Diagrammen, Umfragen und dem Betreiberzugang (siehe [Administrative Aktionen](#administrative-actions));
- Datenexporte — die CSV- und JSON-Exporte von Karten, Workspace-Exporte und Exporte für eine andere EA-Plattform (siehe [Datenexporte](#data-exports)) — sowie Exporte dieses Protokolls selbst.

### Spalten

| Spalte | Beschreibung |
|--------|--------------|
| **Wann** | Datum und Uhrzeit der Aktion |
| **Kategorie** | `auth` (Authentifizierung), `admin` (administrative Aktionen) oder `access` (Exporte und anderer Datenzugriff) |
| **Aktion** | Was geschah, zum Beispiel `auth.login.failed` — siehe den [Aktionskatalog](#action-catalogue) |
| **Ergebnis** | **Erfolg** oder **Fehlschlag** |
| **Akteur** | Der angemeldete Benutzer, der die Aktion ausgeführt hat. Leer, wenn niemand angemeldet war — etwa bei einer fehlgeschlagenen Anmeldung |
| **Betroffenes Konto** | Das Konto, um das es ging — die bei einer fehlgeschlagenen Anmeldung eingegebene E-Mail-Adresse oder der Benutzer, dessen Passwort zurückgesetzt wurde |
| **Ziel** | Das Objekt, auf das sich die Aktion bezog, falls es eines gibt — zum Beispiel die beim Start einer Rollenübernahme gewählte Rolle |
| **IP** | Die IP-Adresse des Clients (siehe [Client-IP-Adresse](#client-ip-address)) |
| **Herkunft** | Woher die Anfrage kam: Web, API, KI-Werkzeug, Erweiterung, Ops oder System |
| **Übernommene Rolle** | Wenn eine Administratorin die App als andere Rolle betrachtete, diese Rolle. Akteur bleibt die tatsächliche Administratorin |

Spalten lassen sich wie in jeder anderen Datentabelle ein- und ausblenden, umsortieren und fixieren; **Wann** und **Aktion** werden immer angezeigt.

### Filter

Die Filterleiste links grenzt die Liste nach **Kategorie**, **Ergebnis**, **Aktion**, **Akteur**, **IP-Adresse** und einem **Zeitraum** ein. Jede Abschnittsüberschrift zeigt, wie viele Werte ausgewählt sind, und die eingeklappte Leiste zeigt die Anzahl aktiver Filter. Die Registerkarte **Spalten** derselben Leiste blendet Spalten ein und aus und fixiert sie. Ihre Filter und Ihr Spaltenlayout werden in diesem Browser gespeichert.

Eine Suche nach einer E-Mail-Adresse trifft Akteur, betroffenes Konto und Ziel, sodass eine einzige Adresse sowohl findet, was diese Person getan hat, als auch, was gegen ihr Konto versucht wurde.

### Einen Eintrag lesen

Klicken Sie auf eine Zeile, um die Eintragsleiste zu öffnen. Sie zeigt jedes Feld des Eintrags — wann, wer, von welcher IP-Adresse und mit welchem Browser — und unter **Details**, was der Eintrag aufgezeichnet hat, in Klartext statt als gespeicherte Schlüssel:

- **Änderungen** — ein Satz pro Änderung. Die Bearbeitung eines Kartentyps lautet zum Beispiel *Feld „Geschäftskritikalität“ (Einfachauswahl) zum Abschnitt „Governance“ hinzugefügt* oder *Option „Hoch“ im Feld „Geschäftskritikalität“ umbenannt in „Kritisch“*. Felder, Abschnitte, Optionen, Rollen und Portale werden mit ihrer Bezeichnung genannt, Berechtigungen mit ihrer Beschreibung und Sprachen mit ihrem Namen.
- **Vorher / Nachher** — eine Tabelle der geänderten Werte, eine Zeile pro Feld, jedes Feld mit seiner Bezeichnung. Die Werte sind formatiert: Ja oder Nein, Datumsangaben im Datumsformat des Arbeitsbereichs, Farben als Farbfeld, Dateigrößen in KB oder MB. Geheimnisse werden nie gespeichert: Ein Passwort, Token oder Client-Secret wird vor dem Schreiben des Eintrags ersetzt und als **Geheimer Wert** angezeigt.
- **Kontext** — Angaben, die eine Änderung einordnen, ohne Teil von ihr zu sein: die aktuelle Adresse eines Portals und ob es veröffentlicht ist, ob die Zugangsdaten einer Verbindung ersetzt wurden, wie viele Zeilen ein Import betroffen hat.

Eine fehlgeschlagene Anmeldung zeigt ihren **Grund** oberhalb der Details — ein falsches Passwort, ein unbekanntes Konto, ein vorübergehend gesperrtes Konto.

Einträge, die vor Version 2.161.0 geschrieben wurden, zeigen ihre Details so, wie sie aufgezeichnet wurden: Alte und neue Werte erscheinen weiterhin in der Tabelle, und was die Leiste nicht lesen kann, wird als Roh-JSON angezeigt.

Die Leiste bietet keine Aktionen. Einträge können weder bearbeitet noch gelöscht werden.

### CSV exportieren

**CSV exportieren** in der Symbolleiste lädt die Einträge, die den aktuellen Filtern entsprechen, als CSV-Datei herunter, bis zu 50 000 Zeilen. Der Export wird selbst aufgezeichnet, als `access.audit_log.exported`, sodass ein Export des Sicherheitsprotokolls darin immer eine Spur hinterlässt.

## Aktionskatalog { #action-catalogue }

| Aktion | Aufgezeichnet, wenn |
|--------|---------------------|
| `auth.login.succeeded` | sich ein Benutzer mit E-Mail und Passwort anmeldet |
| `auth.login.failed` | eine Passwortanmeldung abgewiesen wird. Der **Grundcode** gibt an, warum (siehe unten) |
| `auth.login.locked` | der fünfte Fehlversuch in Folge das Konto für 15 Minuten sperrt. Die Details enthalten den Zeitpunkt, zu dem die Sperre endet |
| `auth.logout` | sich ein angemeldeter Benutzer abmeldet. Eine Abmeldung ohne gültige Sitzung zeichnet nichts auf |
| `auth.sso.succeeded` | sich ein Benutzer über einen SSO-Anbieter anmeldet. Die Details enthalten den Anbieter, das Subject des Identitätsanbieters und ob das Konto durch diese Anmeldung angelegt wurde |
| `auth.sso.failed` | eine SSO-Anmeldung abgewiesen wird — eine nicht zugelassene Domain, eine fehlende E-Mail-Adresse, ein lokales Konto mit derselben E-Mail, ein inaktives Konto. Die Details enthalten den Anbieter und den Grund |
| `auth.proxy_session.succeeded` | sich ein Benutzer über einen vertrauenswürdigen [Reverse Proxy](sso.md#reverse-proxy-authentifizierung) anmeldet |
| `auth.proxy_session.failed` | eine Anmeldung über den Reverse Proxy abgewiesen wird |
| `auth.register` | ein Benutzer per Selbstregistrierung ein Konto anlegt |
| `auth.password.set` | ein eingeladener Benutzer sein erstes Passwort festlegt |
| `auth.password.reset_requested` | Jemand fordert eine E-Mail zum Zurücksetzen des Passworts an. Immer als Erfolg mit der eingegebenen Adresse erfasst, damit die Antwort nichts verrät; die Details nennen, ob ein Konto gefunden und ob eine E-Mail gesendet wurde |
| `auth.password.reset` | ein Passwort über einen Zurücksetzungslink geändert wird |
| `auth.password.changed` | ein angemeldeter Benutzer sein eigenes Passwort ändert |
| `auth.impersonation.started` | eine Administratorin **Als Rolle anzeigen…** startet. Ziel ist die gewählte Rolle |
| `auth.impersonation.stopped` | die Administratorin zu ihrer eigenen Rolle zurückkehrt |

**Grundcodes** bei `auth.login.failed`:

| Grund | Bedeutung |
|-------|-----------|
| `unknown_user` | Kein Konto hat diese E-Mail-Adresse |
| `sso_account` | Das Konto meldet sich per SSO an und hat kein Passwort |
| `no_password` | Für das Konto ist noch kein Passwort festgelegt — eine Einladung, die nie angenommen wurde |
| `locked` | Das Konto ist nach wiederholten Fehlversuchen gesperrt |
| `bad_password` | Das Passwort ist falsch |
| `inactive` | Das Konto ist deaktiviert |

**Grundcodes** bei `auth.sso.failed`, `auth.proxy_session.failed`, `auth.password.set` und `auth.password.reset`:

| Grund | Bedeutung |
|-------|-----------|
| `expired` | Der zeitlich begrenzte Zugang des Kontos ist abgelaufen |
| `hd_mismatch` | Das Google-Konto gehört zu einer nicht zugelassenen Domäne |
| `no_email` | Der Identitätsanbieter hat keine E-Mail-Adresse zurückgegeben |
| `no_subject` | Der Identitätsanbieter hat keine Subjektkennung zurückgegeben |
| `local_account` | Ein lokales Passwortkonto verwendet diese E-Mail-Adresse bereits |
| `no_account` | Es gibt kein Konto, und Konten werden nicht automatisch angelegt |
| `exchange_failed` | Der Identitätsanbieter hat die Anmeldung nicht abgeschlossen |
| `unauthenticated` | Der Reverse-Proxy hat die Anfrage nicht authentifiziert |
| `identity_rejected` | Die weitergereichte Identität wurde abgelehnt (Domäne oder unbestätigte E-Mail) |
| `invalid_token` | Der Einladungs- oder Zurücksetzungslink war ungültig oder ist abgelaufen |

Eine Häufung von `unknown_user`-Fehlschlägen von einer IP-Adresse ist das Muster von Password Spraying; eine Reihe von `bad_password` gegen ein Konto, gefolgt von `auth.login.locked`, ist ein Rateversuch gegen dieses Konto.

### Administrative Aktionen { #administrative-actions }

Jede Änderung, die ein Administrator an der Konfiguration der Instanz vornimmt, wird in der Kategorie `admin` erfasst. **Akteur** ist der Administrator, **Ziel** ist das geänderte Objekt — ein Benutzer, eine Rolle, eine Einstellung, ein Kartentyp — mit seinem Namen zum damaligen Zeitpunkt, und die **Details** führen auf, was sich geändert hat, als alte und neue Werte, beschränkt auf die tatsächlich geänderten Felder. Für jeden Eintrag gelten zwei Regeln:

- **Geheimnisse werden maskiert.** Ein SMTP-Passwort, ein SSO-Client-Secret, ein KI-Anbieterschlüssel, ein ServiceNow-Zugangsdatum oder jeder andere geheime Wert wird als `***` geschrieben: Der Eintrag zeigt, dass er sich geändert hat, aber nie, was er war oder geworden ist.
- **Weder Lizenztext noch Zugangsdaten werden gespeichert.** Eine Erweiterungslizenz wird identifiziert, nicht kopiert, und ein Passwort, das ein Administrator für einen Benutzer setzt, wird als geändert erfasst, nie mit seinem Wert.

Eine Speicherung, die nichts ändert, wird nicht erfasst, ebenso wenig wie ein Benutzer, der in seinem Profil den eigenen Namen oder die eigene Sprache ändert. Umfangreiche Konfiguration — die Felder, Übersetzungen oder das Layout eines Kartentyps, die Filter eines Portals — wird nach ihrer Größe zusammengefasst statt kopiert; ist die Größe gleich geblieben, kommt ein kurzer Fingerabdruck des Inhalts hinzu, sodass der Eintrag dennoch zeigt, dass sich etwas geändert hat. Die rollenbezogenen Berechtigungsüberschreibungen eines Kartentyps sind die Ausnahme: Jede geänderte Zelle wird mit altem und neuem Wert aufgeführt, wobei ein leerer Wert bedeutet, dass die eigene Berechtigung der Rolle gilt.

| Bereich | Aktionen | Was erfasst wird |
|------|---------|------------------|
| **Benutzer & Rollen** | `admin.user.created`, `.updated`, `.deleted`, `.bulk_updated`, `.bulk_deleted`, `.unlocked`; `admin.user.invitation.resent`, `.deleted`; `admin.role.created`, `.updated`, `.archived`, `.restored`; `admin.stakeholder_role.created`, `.updated`, `.deleted`, `.archived`, `.restored` | Konten, die erstellt, bearbeitet, aktiviert oder deaktiviert, gelöscht (einzeln oder in Masse) und entsperrt werden, mit den geänderten Feldern — Rolle, E-Mail, Name, Aktivstatus; erneut gesendete oder widerrufene Einladungen; Anwendungsrollen und Stakeholder-Rollen je Typ, mit den erteilten oder entzogenen Berechtigungen |
| **Einstellungen** | `admin.settings.updated` | Ein Eintrag pro gespeicherter Einstellung — E-Mail, Authentifizierung und SSO, Registrierung, KI, MCP, Sprachen, Modulschalter, Branding, Logo und Favicon, Aufbewahrungsfristen. Das Ziel ist die Einstellung; die Details sind ihr alter und neuer Wert, mit maskierten Geheimnissen |
| **Metamodell** | `admin.metamodel.type.*` (including `.references_generated`), `admin.metamodel.relation_type.*`, `admin.metamodel.resource_type.*`, `admin.principle.*` (including `.imported`), `admin.regulation.*` | Kartentypen, Beziehungstypen und Ressourcentypen, die erstellt, geändert, gelöscht oder wiederhergestellt werden, mit den geänderten Eigenschaften; für einen Typ generierte Kartenreferenzen; EA-Prinzipien, einschließlich der aus dem Katalog importierten; Compliance-Regulierungen |
| **Tags & Berechnungen** | `admin.tag_group.*`, `admin.tag.*`, `admin.calculation.*` | Tag-Gruppen und Tags; berechnete Felder, die erstellt, geändert, gelöscht, aktiviert oder deaktiviert werden, mit alter und neuer Formel, sowie eine Ausführung einer Berechnung über alle Karten (`.recalculated`) |
| **Erweiterungen** | `admin.extension.install.uploaded`, `.applied`, `.discarded`; `admin.extension.store.claimed`, `.refreshed`, `.installed`; `admin.extension.enabled`, `.disabled`, `.uninstalled`; `admin.extension.license.updated`, `.removed` | Hochgeladene, installierte oder verworfene Pakete; Lizenzen und Downloads aus dem Erweiterungs-Store; aktivierte, deaktivierte und deinstallierte Erweiterungen; ersetzte oder entfernte Lizenz — mit der Erweiterung und ihrer Version, nie mit dem Lizenztext |
| **Workspace-Transfer & Migration** | `admin.workspace.import.uploaded`, `.applied`, `.completed`, `.discarded`; `admin.migration.uploaded`, `.field_mappings.updated`, `.applied`, `.deleted` | Ein hochgeladenes [Workspace-Paket](workspace-transfer.md), dessen Import gestartet, abgeschlossen oder verworfen wird; eine hochgeladene [Plattformmigration](migration.md), deren Feldzuordnungen bearbeitet werden, die angewendet oder gelöscht wird |
| **Integrationen** | `admin.servicenow.connection.*`, `admin.servicenow.mapping.*`, `admin.servicenow.sync.pulled`, `.pushed`, `.applied` | ServiceNow-Verbindungen, mit maskierten Zugangsdaten, und Zuordnungen; jeder Abruf, jede Übertragung und jedes Anwenden von Staging-Datensätzen |
| **Öffentliche Freigabe** | `admin.web_portal.created`, `.updated`, `.deleted`; `admin.diagram.published`, `.unpublished` | [Web-Portale](web-portals.md) und veröffentlichte Diagramme — alles, was Daten ohne Konto erreichbar macht |
| **Umfragen** | `admin.survey.sent`, `admin.survey.closed` | Eine Umfrage, die an ihre Empfänger gesendet oder geschlossen wird |
| **Betreiberzugang** | `admin.ops.rescue_access.granted`, `.revoked` | Über die [Betriebs-API](ops-api.md) gewährter oder widerrufener Notfallzugang, erfasst neben den bestehenden `ops.*`-Ereignissen |

### Datenexporte { #data-exports }

Jedes Mal, wenn Daten die Instanz in großem Umfang verlassen, hält ein `access`-Eintrag fest, wer sie mitgenommen hat, wie viel und in welcher Form. Der Eintrag wird geschrieben, bevor die Datei gesendet wird, sodass auch ein Export, dessen Download nie abgeschlossen wurde, aufgezeichnet ist.

| Aktion | Aufgezeichnet, wenn | Details |
|--------|---------------------|---------|
| `access.export.cards` | Karten über den CSV- oder JSON-Export der API (`/cards/export/csv`, `/cards/export/json`) exportiert werden, wie es Skripte, Integrationen und KI-Assistenten tun | `format` (`csv` oder `json`), `type` (der oder die Kartentypen) und `rows` (die Anzahl der Karten). Das Ziel ist der Kartentyp, wenn der Export genau einen umfasste |
| `access.export.workspace` | ein vollständiges [Workspace-Paket](workspace-transfer.md) heruntergeladen wird — über **Workspace-Transfer** oder von einer Steuerungsebene über die [Betriebs-API](ops-api.md), die keinen Akteur und `requested_by: ops` aufzeichnet | `include_archived` und `size_bytes` |
| `access.export.migration` | der Workspace unter **Admin → Einstellungen → Migration** für eine andere EA-Plattform exportiert wird (siehe [Plattformmigration](migration.md)) | Die Zielplattform, `include_archived` und `size_bytes` |
| `access.audit_log.exported` | jemand das Sicherheitsprotokoll als CSV exportiert | `rows` |

## Was nicht aufgezeichnet wird

- **Token-Erneuerung.** Die Web-App erneuert ihre Sitzung zeitgesteuert, sodass jede offene Registerkarte Einträge erzeugen würde, von denen keiner etwas bedeutet.
- **Anfragen, die wegen eines abgelaufenen oder ungültigen Sitzungstokens abgewiesen werden.** Sie entstehen jedes Mal, wenn eine Sitzung regulär endet.
- **Abrufe von OData-Feeds.** Excel und Power BI fragen den OData-Feed einer gespeicherten Ansicht zeitgesteuert ab, sodass jede Aktualisierung einen Eintrag erzeugen würde.
- **Im Browser erstellte Tabellen und Präsentationen.** Die Excel- und PowerPoint-Downloads des Inventars und der Berichte entstehen aus Daten, die die Seite bereits geladen hat; sie sind Lesezugriffe, keine Exporte vom Server.
- **Reiner Lesezugriff** — eine Karte öffnen, einen Bericht ausführen, das Inventar durchsuchen.

## Aufbewahrung { #retention }

Einträge werden standardmäßig **365 Tage** lang aufbewahrt. Ändern Sie das unter **Admin → Einstellungen → Allgemein → Datenverwaltung → Aufbewahrung des Sicherheitsprotokolls**: eine beliebige Anzahl von Tagen bis 3650 oder **0**, um Einträge unbegrenzt zu behalten. Ein Job löscht einmal pro Nacht die Einträge, die älter als dieser Zeitraum sind, und liest die Einstellung jedes Mal neu, sodass eine Änderung ohne Neustart wirksam wird.

Dieser Aufbewahrungsjob ist das Einzige, was jemals einen Eintrag löscht. Es gibt weder in der Oberfläche noch in der API eine Aktion zum Bearbeiten oder Löschen, für keine Rolle.

Das Protokoll ist bewusst **nicht** Teil des [Workspace-Transfers](workspace-transfer.md): Es ist die Sicherheitshistorie dieser Instanz, kein Inhalt des Workspaces, und das Klonen einer Instanz kopiert es nicht.

## Der JSON-Audit-Stream

Jeder Eintrag wird vom Backend außerdem als **eine JSON-Zeile** über den Logger **`turbo_ea.audit`** geschrieben, im selben Moment, in dem er gespeichert wird. Das Backend protokolliert auf die Standardausgabe, sodass der Stream überall dort ankommt, wo Ihre Container-Logs bereits gesammelt werden — `docker compose logs backend`, die Log-Erfassung von Kubernetes oder ein beliebiger SIEM-Shipper —, ohne Konfiguration in Turbo EA:

```bash
docker compose logs -f backend | grep turbo_ea.audit
```

Die Zeile wird geschrieben, sobald der Eintrag erfasst wird. Schlägt die Transaktion der Anfrage danach fehl, existiert die Zeile ohne Datensatz: Die Tabelle ist die Aufzeichnung, der Stream der Live-Feed.

Jede Zeile enthält dieselben Felder wie der Eintrag:

| Feld | Inhalt |
|------|--------|
| `audit_id`, `created_at` | Die ID des Eintrags und der Zeitpunkt, zu dem er geschrieben wurde |
| `category`, `action`, `outcome` | Was geschah und ob es gelang |
| `actor_user_id`, `actor_email` | Wer es getan hat |
| `subject_email` | Das betroffene Konto |
| `target_type`, `target_id`, `target_label` | Worauf es sich bezog |
| `ip`, `user_agent` | Der Client |
| `origin` | web, api, mcp, ext, ops oder system |
| `impersonator_user_id`, `impersonated_role` | Gesetzt, während eine Administratorin die App als andere Rolle betrachtet |
| `details` | Bis zu vier Schlüssel, Geheimnisse bereits maskiert: `reason` (ein Fehlercode), `changes` (`{field: {old, new}}`), `items` (semantische Änderungen, `{kind, …}` — z. B. `field.added`) und `context` (einfache Angaben) |

Wer den Stream in einen zentralen Log-Speicher überträgt, hält eine Kopie außerhalb der Instanz vor, außer Reichweite aller, die sie administrieren können — genau das braucht eine Prüfung auf Insider-Bedrohungen. Wie Sie ihn erfassen, steht unter [Protokollierung und der Audit-Stream](operations.md#logging-and-the-audit-stream).

## Client-IP-Adresse { #client-ip-address }

Die Spalte **IP** zeichnet die Adresse des Clients auf, nicht die des Proxys vor dem Backend. Der mitgelieferte Edge-nginx setzt den Header `X-Real-IP` auf die Adresse, von der er die Verbindung erhalten hat, und das Backend liest diesen Header, weil das veröffentlichte Backend-Image **`TRUST_PROXY_HEADERS=true`** setzt. Ein Wert, der keine gültige IP-Adresse ist, wird verworfen statt aufgezeichnet.

- **Lassen Sie `TRUST_PROXY_HEADERS` eingeschaltet**, solange jede Anfrage das Backend über den mitgelieferten nginx erreicht — der Standard-Stack, das [Helm-Chart](kubernetes.md) und die [Vorlagen für verwaltete Container](managed-containers.md) arbeiten alle so.
- **Schalten Sie es aus** (`TRUST_PROXY_HEADERS=false`), wenn Sie den Backend-Container direkt freigeben, ohne den mitgelieferten nginx davor: Ein Client könnte dann seinen eigenen `X-Real-IP` senden und die aufgezeichnete Adresse selbst wählen.
- **Hinter einem Load Balancer, einem Ingress-Controller oder einem CDN** erhält der mitgelieferte nginx jede Verbindung von diesem Zwischenglied und zeichnet daher von sich aus für jeden Benutzer die Adresse des Load Balancers auf. Setzen Sie **`NGINX_TRUSTED_PROXIES`** am nginx-Container wie unten beschrieben.

### Hinter einem Load Balancer { #behind-a-load-balancer }

`NGINX_TRUSTED_PROXIES` listet die Adressen der Zwischenglieder vor dem mitgelieferten nginx auf, als IP-Adressen oder CIDR-Bereiche, getrennt durch Kommas oder Leerzeichen. nginx liest die Client-Adresse dann aus dem Header `X-Forwarded-For`, den diese Zwischenglieder hinzufügen — aber nur bei einer Verbindung, die von einer der aufgeführten Adressen kommt — und überspringt dabei jede aufgeführte Adresse, sodass eine Kette von Proxys auf die erste Adresse hinausläuft, die nicht zu Ihnen gehört. Diese Adresse ersetzt die der Verbindung, und der Header `X-Real-IP`, den das Backend liest, trägt sie unverändert weiter. Leer, die Voreinstellung, vertraut niemandem.

Den Wert finden Sie im Zugriffsprotokoll des Edge-nginx (`docker compose logs nginx`, `kubectl logs deployment/turbo-ea-nginx` oder die Protokollansicht der Plattform): Die Adresse am Anfang jeder Zeile ist das Zwischenglied, dem Sie vertrauen müssen, und das letzte Feld in Anführungszeichen ist der `X-Forwarded-For`-Header, den es gesendet hat.

| Bereitstellung | Wo setzen | Typischer Wert |
|----------------|-----------|----------------|
| Docker Compose, Browser erreichen nginx direkt | — | Leer lassen |
| Docker Compose hinter Ihrem eigenen Reverse Proxy | `NGINX_TRUSTED_PROXIES` in `.env` | Die Adresse des Reverse Proxys, wie nginx sie sieht |
| [Kubernetes](kubernetes.md) hinter einem Ingress-Controller | Chart-Wert `nginx.trustedProxies` | Das Pod-CIDR des Clusters, zum Beispiel `10.244.0.0/16` |
| [AWS ECS Fargate](managed-containers.md#aws-ecs-fargate) | `NginxTrustedProxies` / Terraform `nginx_trusted_proxies` | Die CIDR-Bereiche der Subnetze des Load Balancers |
| [Azure Container Apps](managed-containers.md#azure-container-apps) | `nginxTrustedProxies` / Terraform `nginx_trusted_proxies` | Das Infrastruktur-Subnetz der Umgebung |
| [Google Cloud Run](managed-containers.md#google-cloud-run) | `NGINX_TRUSTED_PROXIES` im Manifest / Terraform `nginx_trusted_proxies` | Die Adressen, die das Zugriffsprotokoll zeigt |

Halten Sie die Liste so eng wie die Zwischenglieder selbst. Jeder aufgeführten Adresse wird geglaubt, wenn sie den Client benennt; ein Bereich, aus dem sich Ihre Benutzer verbinden — etwa ganz `10.0.0.0/8` bei einer internen Bereitstellung —, ließe jeden von ihnen eine andere Adresse ins Protokoll schreiben. Ohne Einstellung zeigt die Spalte den Load Balancer: nicht hilfreich, aber nie gefälscht.

Die Ratenbegrenzung der Anmeldung zählt Versuche pro Client-Adresse aus demselben Header; hinter einem Load Balancer verhindert diese Einstellung also auch, dass die Fehlversuche einer Person alle anderen ausbremsen. Das gilt für Anmeldungen, die das Backend über den Edge-nginx erreichen; der MCP-Server meldet sich direkt beim Backend an, seine eigenen Anmeldeaufrufe teilen sich daher weiterhin die Adresse des MCP-Containers. Der Schlüssel pro Client vertraut diesem Header genauso wie das Audit-Protokoll: Er setzt voraus, dass Anmeldungen das Backend nur über den Edge-nginx erreichen, was die mitgelieferte Compose-Datei und das Helm-Chart sicherstellen, indem sie das Backend nicht freigeben. Ein Aufrufer, der das Backend direkt erreichen könnte, könnte sich mit einem selbst gesetzten Header sein eigenes Kontingent wählen; lassen Sie das Backend daher unerreichbar oder schalten Sie `TRUST_PROXY_HEADERS` aus.
