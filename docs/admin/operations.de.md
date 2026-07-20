# Betrieb & Upgrades

Diese Seite ist der Betriebsleitfaden für Turbo EA in Produktion: wie Upgrades und Datenbankmigrationen funktionieren, wie Sie sichern und zurückrollen, welche Umgebungen sinnvoll sind und welche Fallstricke Teams im großen Maßstab erwischen.

## Produktions-Images und Versions-Pinning

Die veröffentlichten Images unter `ghcr.io/vincentmakes/turbo-ea/*` sind der empfohlene Weg für den Produktionsbetrieb — die mitgelieferte `docker-compose.yml` zieht sie standardmäßig, und der Build aus dem Quellcode ist ein Entwicklungs-Workflow. Über die Bequemlichkeit hinaus bieten die veröffentlichten Images Lieferketten-Garantien, die ein lokaler Build nicht hat: Jede Veröffentlichung ist multi-arch (amd64 + arm64), mit cosign signiert (schlüsselloses OIDC, verifizierbar gegen die GitHub-Actions-Workflow-Identität) und mit SLSA-Provenance sowie einer SBOM attestiert. Die Images werden zum Veröffentlichungszeitpunkt auf kritische CVEs geprüft, nach der Veröffentlichung täglich neu gescannt und wöchentlich gegen frische Alpine-Repositories neu gebaut, sodass Basis-Image-Patches automatisch einfließen. Wenn Ihre Organisation Image-Signaturprüfung bei der Zulassung erzwingt, fügen sich die cosign-Signaturen direkt ein — siehe [Lieferkette](supply-chain.md) für die Verifikationsbefehle.

Die wichtigste Gewohnheit: **Pinnen Sie Ihre Version.** Der Tag `:latest` wird bei Releases und beim wöchentlichen Rebuild neu gesetzt — nicht bei jedem Commit — und kann sich daher nach einem Zeitplan bewegen, den Sie nicht kontrollieren. Setzen Sie einen expliziten Tag in Ihrer `.env`:

```bash
TURBO_EA_TAG=2.23.1
```

Siehe [Eine Version pinnen](../getting-started/setup.md) für die Grundlagen und [Releases](../reference/releases.md) für den vollständigen Tag-Baum und die Pre-Release-Kanalpolitik.

## Wie Upgrades funktionieren: Alembic-Migrationen

Die Kompatibilität des Datenbankschemas wird automatisch über [Alembic](https://alembic.sqlalchemy.org/) gehandhabt. Beim Start führt das Backend `alembic upgrade head` aus, sodass jede ausstehende Migration zwischen Ihrem aktuellen Schema und der neuen Version — in Reihenfolge — angewendet wird, bevor die App Anfragen bedient.

Migrationen sind sequenziell nummeriert und kumulativ, das heißt, Versionssprünge sind sicher: Wenn Sie beispielsweise von 2.10 auf 2.23 aktualisieren, laufen alle Zwischenmigrationen der Reihe nach durch. Sie müssen nicht jedes Minor-Release einzeln durchlaufen.

Einige Verhaltensweisen, die man kennen sollte:

| Situation | Was beim Start passiert |
|---|---|
| Frische Datenbank | Tabellen werden direkt angelegt und die Datenbank wird auf head gestempelt — kein Migrations-Replay. |
| Bestehende Datenbank | Ausstehende Migrationen laufen automatisch, bevor die API verfügbar wird. |
| `RESET_DB=true` | Alle Tabellen werden gelöscht, neu erstellt und neu befüllt. Niemals in Produktion setzen. |

Innerhalb einer Major-Versionslinie bleiben Migrationen additiv und beim Upgrade abwärtskompatibel — siehe die [Kompatibilitätsrichtlinie](../reference/compatibility.md) für den vollständigen Vertrag.

!!! warning "Niemals ein älteres Backend gegen ein neueres Schema betreiben"
    Alembic migriert beim Start nur vorwärts. Alter Code gegen ein neueres Schema ist undefiniertes Verhalten — das ist die zentrale Rollback-Einschränkung (siehe unten).

## Der Upgrade-Ablauf

1. **Changelog lesen.** Prüfen Sie die `CHANGELOG.md`-Einträge zwischen Ihrer aktuellen Version und dem Ziel. Breaking Changes erhöhen die Major-Version.
2. **Sichern** Sie die Datenbank und das Daten-Volume (siehe unten).
3. **Tag erhöhen und pullen:**

    ```bash
    TURBO_EA_TAG=2.24.0 docker compose pull
    docker compose up -d
    ```

4. **Beobachten Sie die Start-Logs** und bestätigen Sie, dass die Migrationen sauber abschließen, bevor die API Anfragen bedient:

    ```bash
    docker compose logs -f backend
    ```

!!! note "Wartungsfenster"
    Migrationen sind in der Regel schnell, aber bei großen Inventaren können manche Datenmigrationen einige Minuten dauern, während derer das Backend nicht erreichbar ist. Planen Sie Upgrades in einem Wartungsfenster.

## Backups

Erstellen Sie **vor jedem Upgrade** ein Backup und automatisieren Sie unabhängig davon ein nächtliches:

```bash
docker compose exec db pg_dump -U turboea turboea > backup-$(date +%F).sql
```

Passen Sie Benutzer- und Datenbanknamen an, falls Sie `POSTGRES_USER` / `POSTGRES_DB` geändert haben. Ein Snapshot des Volumes `postgres_data` ist eine gleichwertige Alternative.

Sichern Sie außerdem das Volume **`backend_data`** — es enthält Dateianhänge, installierte Erweiterungen und Workspace-Transfer-Bundles, die nicht in PostgreSQL liegen.

Zwei weitere Punkte zur Wiederherstellungsstrategie:

- **Testen Sie Ihre Restores regelmäßig.** Ein Backup, das nie wiederhergestellt wurde, ist eine Hoffnung, kein Plan.
- **Archivierte Karten sind soft-deleted** mit einem 30-Tage-Fenster vor der endgültigen Löschung — das ist Ihr Sicherheitsnetz für Datenfehler, getrennt von der Infrastruktur-Wiederherstellung.

## Rollback und Wiederherstellung

Schemamigrationen sind in Produktion effektiv **nur vorwärts gerichtet**: Alembic unterstützt Downgrades zwar technisch, aber datentragende Migrationen lassen sich nicht immer verlustfrei umkehren, und die App führt Downgrades nie automatisch aus. Die zuverlässige Rollback-Strategie ist:

1. Stack stoppen.
2. Das vor dem Upgrade erstellte Datenbank-Backup wiederherstellen.
3. `TURBO_EA_TAG` auf die vorherige Version zurücksetzen.
4. `docker compose up -d` — die wiederhergestellte Datenbank passt zum Schema des alten Codes, alles ist konsistent.

!!! warning "Niemals nur das Image zurückrollen"
    Das Image zurückzurollen und die migrierte Datenbank zu behalten ist die eine Kombination, vor der das automatische Migrationssystem Sie nicht schützen kann. Datenbank-Backup und Image-Tag bewegen sich gemeinsam.

## Umgebungen und Release-Governance

Für die meisten Organisationen reichen **zwei Umgebungen** (Staging + Produktion), denn Upgrades sind vom Anbieter veröffentlichte Images, keine eigenen Builds — Sie validieren, Sie entwickeln nicht. Eine vollständige Dev/SIT/UAT/Prod-Kette lohnt sich vor allem, wenn Sie eigene Erweiterungen oder umfangreiche Integrationen bauen.

| Umgebung | Zweck | Hinweise |
|---|---|---|
| Dev / Sandbox (optional) | Metamodell-Änderungen ausprobieren, Demos | `SEED_DEMO=true` für den Demo-Datensatz; `RESET_DB=true` liefert einen sauberen Neustart. |
| Staging | Neue Versionen zuerst validieren | Produktionsnahe Daten; erhält neue Tags zuerst. |
| Produktion | Gepinnter Tag, Backups, Upgrades im Wartungsfenster | Niemals `latest`, niemals `RESET_DB`. |

Zwei gute Wege, realistische Daten nach Staging zu bringen:

- **[Workspace Transfer](workspace-transfer.md)**: Exportieren Sie den Produktions-Workspace als `.zip`-Bundle und importieren Sie ihn in Staging. Geheimnisse (SMTP-, SSO-, KI-, ServiceNow-Zugangsdaten) werden konzeptbedingt entfernt und verlassen die Instanz nie.
- **Datenbank-Restore**: Stellen Sie einen Produktions-`pg_dump` in der Staging-Datenbank wieder her. Verschlüsselte Geheimnisse in der Datenbank sind vom `SECRET_KEY` abgeleitet, daher braucht Staging entweder denselben `SECRET_KEY`, oder Sie geben die Integrations-Zugangsdaten dort neu ein.

Zur Governance:

- Behandeln Sie die `.env`-Datei und den gepinnten `TURBO_EA_TAG` als Configuration-as-Code — verwalten Sie sie in Ihrem internen Git und machen Sie Upgrades zu einer geprüften Änderung (ein Pull Request, der den Tag erhöht).
- Da Staging und Produktion denselben gepinnten GHCR-Tag ziehen, validieren Sie das byte-identische Artefakt, das Sie befördern werden.
- Staging aktualisieren → einige Tage beobachten → denselben Tag in die Produktion befördern.

## Häufige Fallstricke

1. **Ungepinntes `latest` betreiben** — ein routinemäßiges `docker compose pull` wird zu einem ungeplanten Upgrade mit ungeplanten Migrationen, nach dem Release-Zeitplan statt nach Ihrem.
2. **Upgrade ohne Backup** — Migrationen sind nur vorwärts gerichtet; das Backup *ist* Ihr Rollback.
3. **`SECRET_KEY` verlieren oder ändern** — er signiert JWTs *und* leitet den Verschlüsselungsschlüssel für gespeicherte Geheimnisse ab (SMTP-, SSO-, ServiceNow-Zugangsdaten). Eine Änderung macht gespeicherte Geheimnisse unentschlüsselbar. Behandeln Sie ihn wie ein Datenbank-Passwort: im Tresor, stabil, gesichert.
4. **`RESET_DB=true` in einer Env-Datei vergessen** — es tut genau das, was es sagt, bei jedem Start.
5. **Die Datenbank direkt bearbeiten** — der Schemazustand gehört Alembic, und manuelles DDL kollidiert mit künftigen Migrationen. Dasselbe gilt für Daten: Nutzen Sie API oder UI, damit Berechtigungen, Audit-Events und die Neuberechnung der Datenqualität korrekt bleiben.
6. **Volumes nicht persistieren** — `postgres_data` und `backend_data` müssen die Neuerstellung von Containern überleben; prüfen Sie, ob Ihre Snapshot- und Backup-Werkzeuge beide abdecken.
7. **Das Image zurückrollen, ohne die Datenbank wiederherzustellen** — siehe [Rollback und Wiederherstellung](#rollback-und-wiederherstellung).
