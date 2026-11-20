# Kompatibilitätsrichtlinie

Ab Version `1.0.0` gewährleistet Turbo EA dokumentierte Abwärtskompatibilität innerhalb einer Hauptversionsreihe. Diese Seite ist der Vertrag: Sie beschreibt, was stabil bleibt, was sich ändern kann und wie Einstellungen als veraltet gekennzeichnet werden, damit Betreiber Upgrades ohne Überraschungen planen können.

Die Richtlinie gilt für `1.x`. Eine künftige Reihe `2.x` kann sie überarbeiten; in diesem Fall wird mit den Versionshinweisen zu `2.0.0` ein Migrationsleitfaden veröffentlicht.

---

## Was abgedeckt ist

### Datenbankschema (Alembic-Migrationen)

Innerhalb von `1.x` gilt:

- Migrationen sind **additiv** oder beim Upgrade **abwärtskompatibel**.
- Neue Spalten können jederzeit hinzugefügt werden.
- Bestehende Spalten werden nicht ohne einen Veraltungszyklus entfernt.
- Bestehende Spalten werden nicht ohne einen Veraltungszyklus umbenannt (eine Umbenennung erfolgt als add-new-column → backfill → deprecate-old-column → drop-in-next-major).
- Typänderungen beschränken sich auf Erweiterungen (z. B. `varchar(80)` → `varchar(255)`); Verengungen durchlaufen einen Veraltungszyklus.
- Fremdschlüsselbedingungen werden ohne Veraltungszyklus nicht verschärft (z. B. wird `ON DELETE SET NULL` nicht zu `ON DELETE CASCADE`).

Betreiber können sicher aktualisieren; die automatische Migration beim Backend-Start kann gefahrlos auf Produktionsdaten ausgeführt werden.

### Integriertes Metamodell

Innerhalb von `1.x` ist das in `backend/app/services/seed.py` ausgelieferte Metamodell stabil:

- Schlüssel integrierter Kartentypen (`Application`, `Initiative`, `BusinessCapability` usw.) werden weder umbenannt noch entfernt.
- Schlüssel integrierter Felder dieser Typen werden nicht ohne Veraltungszyklus entfernt.
- Schlüssel integrierter Beziehungstypen werden nicht ohne Veraltungszyklus umbenannt oder entfernt.
- Standard-Untertypen, die mit integrierten Typen ausgeliefert werden, sind stabil.

Eigene Anpassungen der Betreiber (eigene Kartentypen, über die Admin-Oberfläche hinzugefügte Felder und eigene Beziehungstypen) liegen in ihrer Verantwortung und sind von dieser Richtlinie nicht abgedeckt.

### REST-API (`/api/v1/`)

Innerhalb von `1.x` gilt:

- Endpunkte unter `/api/v1/` werden nicht ohne Veraltungszyklus entfernt.
- Bestehende Feldnamen in Anfragen und Antworten werden nicht ohne Veraltungszyklus umbenannt.
- Feldtypen ändern sich nicht inkompatibel (z. B. von String zu Array).
- Neue optionale Anfragefelder und Antwortfelder sind nicht-breaking und können in jeder Nebenversion erscheinen.
- Neue Endpunkte sind nicht-breaking und können in jeder Nebenversion erscheinen.
- Die Authentifizierungssemantik (`Bearer`-JWT, Form der Nutzlast von `/auth/login`) ist stabil.
- Die Semantik der HTTP-Statuscodes ist für dokumentierte Erfolgs- und Fehlerpfade stabil.

Verhalten außerhalb der dokumentierten Oberfläche (nicht dokumentierte Header, interne Fehlertexte, Reihenfolge ohne Angabe von `sort_by`) ist nicht abgedeckt.

### Berechtigungsschlüssel

Die in `backend/app/core/permissions.py` definierten Berechtigungsschlüssel sind innerhalb von `1.x` stabil. Neue Schlüssel können hinzugefügt werden; bestehende werden nicht ohne Veraltungszyklus umbenannt oder entfernt.

Die **standardmäßig** an die initial angelegten Rollen (`admin`, `bpm_admin`, `member`, `viewer`) vergebenen Berechtigungen können sich zwischen Nebenversionen ändern; dies wird im CHANGELOG erwähnt. Betreiber, die Rollenberechtigungen in ihrer Bereitstellung angepasst haben, sind davon nicht betroffen.

### Konfiguration (Umgebungsvariablen)

Bestehende Umgebungsvariablen, die in `CLAUDE.md` und `README.md` dokumentiert sind, bleiben innerhalb von `1.x` stabil. Neue Variablen können mit sinnvollen Standardwerten hinzukommen. Standardwerte können sich mit einem Hinweis im CHANGELOG ändern, wenn dies für Betreiber relevant ist (z. B. ein neuer Standardport).

### Verschlüsselte Geheimnisse im Ruhezustand

Die Präfixmarkierung `enc:` und der von Fernet abgeleitete Schlüssel in `backend/app/core/encryption.py` bleiben innerhalb von `1.x` stabil. Betreiber müssen Geheimnisse bei Nebenversionen nicht erneut verschlüsseln.

---

## Veraltungszyklus

Wenn etwas, das von dieser Richtlinie abgedeckt ist, entfernt werden muss:

1. **In Nebenversion N als veraltet kennzeichnen.** Der CHANGELOG-Eintrag enthält einen Abschnitt `Deprecated`, der die Änderung nennt. Bei API-Endpunkten sendet die veraltete Route den Antwortheader `Deprecation: true` (RFC 8594) sowie einen `Sunset`-Header mit dem frühesten geplanten Entfernungstermin.
2. **In Nebenversion N+1 weiter unterstützen.** Die Entfernung darf nicht in derselben Nebenversion wie die Veraltung erfolgen. Die veraltete Form bleibt funktionsfähig.
3. **Früheste Entfernung in Nebenversion `N+2` oder in `2.0`** (je nachdem, was zuerst eintritt). Die Entfernung wird mit einem Abschnitt `Removed` im CHANGELOG und einem Migrationshinweis veröffentlicht.

Bei Änderungen der Datenform gilt derselbe Rhythmus `N` → `N+1`, umgesetzt als add-new → backfill → drop-old.

---

## Was nicht abgedeckt ist

Folgendes liegt ausdrücklich außerhalb des Geltungsbereichs und kann sich jederzeit ändern:

- Die **interne Python-Modulanordnung** unter `backend/app/`. Importe von `app.models`, `app.services` usw. gehören nicht zur öffentlichen API. Plugins oder Skripte, die von internen Importen abhängen, sollten eine bestimmte Turbo-EA-Version festschreiben.
- Die **Struktur von JSONB-Blobs** in integrierten Tabellen (`fields_schema`, `section_config`, `attributes`, `lifecycle`), soweit sie nicht von der dokumentierten REST-API gelesen wird. Die JSON-Form auf dem Datenträger kann sich für neue Funktionen weiterentwickeln.
- **Frontend-Interna**: Komponentenpfade, Prop-Signaturen von Komponenten in `frontend/src/`, Inhalt von `frontend/src/types/index.ts` und MUI-Komponentenstile. Betreiber des mitgelieferten Frontends sind davon abgeschirmt; wer Komponenten aus dem Quellbaum einbettet, trägt selbst die Verantwortung.
- **Vom Betreiber eingeführte Metamodell-Anpassungen.** Wenn Sie über die Admin-Oberfläche einen eigenen Kartentyp oder ein eigenes Feld hinzufügen, liegt die Migration bei späteren Änderungen in Ihrer Verantwortung.
- **Demo- und Seed-Daten** (`SEED_DEMO=true`). Der Demo-Datensatz kann sich zwischen Versionen frei weiterentwickeln.
- **Gebündelte Drittanbieterdienste**: DrawIO-Version, gebündeltes Ollama-Image und Version von eingebettetem swagger-ui-dist. Diese können jederzeit aktualisiert werden.
- **Verhalten bei Nicht-Standardkonfigurationen**, die in CHANGELOG-Einträgen ausdrücklich als experimentell gekennzeichnet sind.

---

## Was sich mit „1.0.0“ tatsächlich ändert

Im Vergleich zur Reihe `0.x` ist `1.0.0` selbst keine Funktionsversion — ab diesem Zeitpunkt gelten lediglich die oben genannten Zusagen. Der in `1.0.0` ausgelieferte Code entspricht dem in `0.71.0` ausgelieferten Code, ergänzt um die Lieferkettenhärtung und Änderungen am Beitragsprozess aus dem [CHANGELOG-Eintrag zu `1.0.0`](https://github.com/vincentmakes/turbo-ea/blob/main/CHANGELOG.md#100---2026-05-05).

Vorversionen von `1.0` waren nicht von dieser Richtlinie abgedeckt. Migrationen zwischen `0.x`-Versionen konnten und enthielten Schemaentfernungen, Umbenennungen und inkompatible Metamodelländerungen. Ab `1.0.0` durchlaufen solche Änderungen den Veraltungszyklus.
