# Audit-Log

Das **Audit-Log** unter **Admin → Einstellungen → Audit-Log** (`/admin/settings?tab=audit-log`) beantwortet die beiden Fragen, die eine Sicherheitsprüfung an eine Instanz stellt, die eine Landkarte der gesamten IT-Landschaft enthält: *Was hat sich darin geändert* und *wer hat sich wie angemeldet*. Es ist in zwei Unterregisterkarten aufgeteilt:

| Unterregisterkarte | URL | Was sie aufzeichnet |
|--------------------|-----|---------------------|
| **Änderungen** | `/admin/settings?tab=audit-log` | Jeden Schreibvorgang in der Landschaft — Karten, Beziehungen, Risiken, Tags, Stakeholder-Rollen, Entscheidungsentwürfe —, gruppiert in Mutations-Batches, mit einem Diff pro Ereignis und einem **Rollback** |
| **Sicherheit & Administration** | `/admin/settings?tab=audit-log&view=security` | An- und Abmeldungen, fehlgeschlagene Versuche, Sperrungen, SSO- und Proxy-Sitzungen, Passwortereignisse und Rollenübernahme |

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
- Exporte dieses Protokolls selbst.

!!! note "Kommt mit der nächsten Version"
    **Administrative Aktionen** — Änderungen an Benutzern, Rollen, Einstellungen, dem Metamodell, Erweiterungen, Importen und Integrationen — und **Datenexporte** (CSV-/JSON-Exporte des Inventars, Workspace- und Migrationsexporte) werden mit der nächsten Version in demselben Protokoll aufgezeichnet.

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

### Eintragsdetails

Klicken Sie auf eine Zeile, um die Eintragsleiste zu öffnen. Sie zeigt jedes Feld des Eintrags, einschließlich des User-Agents des Browsers und der mit ihm aufgezeichneten **Details** — den Grundcode einer fehlgeschlagenen Anmeldung, den Zeitpunkt, zu dem eine Sperre endet, den Identitätsanbieter einer SSO-Anmeldung. Zeichnet ein Eintrag eine Änderung auf, erscheinen die Details als Tabelle mit alten und neuen Werten. Geheimnisse werden nie gespeichert: Ein Passwort, Token oder Client-Secret wird vor dem Schreiben des Eintrags durch `***` ersetzt.

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
| `access.audit_log.exported` | jemand das Sicherheitsprotokoll als CSV exportiert |

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

## Was nicht aufgezeichnet wird

- **Token-Erneuerung.** Die Web-App erneuert ihre Sitzung zeitgesteuert, sodass jede offene Registerkarte Einträge erzeugen würde, von denen keiner etwas bedeutet.
- **Anfragen, die wegen eines abgelaufenen oder ungültigen Sitzungstokens abgewiesen werden.** Sie entstehen jedes Mal, wenn eine Sitzung regulär endet.
- **Abrufe von OData-Feeds.** Excel und Power BI fragen den OData-Feed einer gespeicherten Ansicht zeitgesteuert ab, sodass jede Aktualisierung einen Eintrag erzeugen würde.
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
| `details` | Grundcodes und alte/neue Werte, Geheimnisse bereits maskiert |

Wer den Stream in einen zentralen Log-Speicher überträgt, hält eine Kopie außerhalb der Instanz vor, außer Reichweite aller, die sie administrieren können — genau das braucht eine Prüfung auf Insider-Bedrohungen. Wie Sie ihn erfassen, steht unter [Protokollierung und der Audit-Stream](operations.md#logging-and-the-audit-stream).

## Client-IP-Adresse { #client-ip-address }

Die Spalte **IP** zeichnet die Adresse des Clients auf, nicht die des Proxys vor dem Backend. Der mitgelieferte Edge-nginx setzt den Header `X-Real-IP` auf die Adresse, von der er die Verbindung erhalten hat, und das Backend liest diesen Header, weil das veröffentlichte Backend-Image **`TRUST_PROXY_HEADERS=true`** setzt. Ein Wert, der keine gültige IP-Adresse ist, wird verworfen statt aufgezeichnet.

- **Lassen Sie `TRUST_PROXY_HEADERS` eingeschaltet**, solange jede Anfrage das Backend über den mitgelieferten nginx erreicht — der Standard-Stack, das [Helm-Chart](kubernetes.md) und die [Vorlagen für verwaltete Container](managed-containers.md) arbeiten alle so.
- **Schalten Sie es aus** (`TRUST_PROXY_HEADERS=false`), wenn Sie den Backend-Container direkt freigeben, ohne den mitgelieferten nginx davor: Ein Client könnte dann seinen eigenen `X-Real-IP` senden und die aufgezeichnete Adresse selbst wählen.
- **Hinter einem weiteren Load Balancer** sieht der mitgelieferte nginx dessen Adresse, sodass jeder Eintrag diese aufzeichnet. Eine Einstellung, mit der nginx der von Ihrem Load Balancer weitergereichten Client-Adresse vertrauen kann (`NGINX_TRUSTED_PROXIES`), ist für eine spätere Version geplant.
