# Releases und Vorabversionen

Wie Turbo EA Versionen, Tags und Container-Images veröffentlicht. Diese Seite dient Betreibern, die Produktionsversionen festlegen müssen, und Mitwirkenden, die Releases erstellen, als Referenz.

---

## Versionierung

Turbo EA folgt [Semantic Versioning](https://semver.org/). Die einzige Quelle für die aktuelle Version ist die Datei `/VERSION` im Stammverzeichnis des Repositorys.

- **Patch** (z. B. `1.0.0` → `1.0.1`): nur Fehlerbehebungen. Ein Upgrade ist immer sicher.
- **Minor** (z. B. `1.0.0` → `1.1.0`): neue Funktionen. Abwärtskompatibel gemäß der [Kompatibilitätsrichtlinie](compatibility.md).
- **Major** (z. B. `1.x` → `2.0.0`): inkompatible Änderungen. Migrationshinweise werden mit dem Release veröffentlicht.

Die Version wird einmal pro PR erhöht, nicht pro Commit. Der CHANGELOG-Eintrag des PRs verwendet die neue Version als Überschrift; CI schlägt mit [`version-check.yml`](https://github.com/TommasoChi/turbo-ea/blob/main/.github/workflows/version-check.yml) fehl, wenn `/VERSION` ohne passende Überschrift `## [<version>]` in `CHANGELOG.md` erhöht wird.

---

## Tags für Container-Images

Jeder Push nach `main` und jedes Tag `v*.*.*` löst `.github/workflows/docker-publish.yml` aus, das Multi-Arch-Images (`amd64` + `arm64`) erstellt und in GHCR veröffentlicht.

Für ein Release-Tag wie `v1.2.3` lauten die veröffentlichten Tags für jedes Image:

| Tag                 | Verweist auf                | Stabil?                            |
|---------------------|-----------------------------|------------------------------------|
| `1.2.3`             | genau dieses Release        | ja — in Produktion festlegen       |
| `1.2`               | neuesten Patch von `1.2.x`  | wird bei Patches aktualisiert      |
| `1`                 | neueste Minor-Version von `1.x` | wird bei Minor-Versionen aktualisiert |
| `latest`            | neueste Nicht-Vorabversion  | wird bei jedem Release aktualisiert |
| `sha-<short>`       | genau dieser Commit         | ja — Debugging / Vorabversion      |

Bei Pushes nach `main` (ohne Tag) werden nur die Tags `main` und `sha-<short>` erstellt — niemals `latest` und niemals ein SemVer-Tag.

Alle veröffentlichten Image-Manifeste sind mit Cosign und schlüssellosem OIDC signiert. Informationen zur Verifizierung und SBOM finden Sie unter [Supply Chain](../admin/supply-chain.md).

---

## Vorabversionskanal

Bei Minor-Versionen, die Container-Layout, Basis-Images, Standard-UIDs, Volume-Namen, Standard-Ports oder das Schema so ändern, dass Betreiber handeln müssen, wird vor dem endgültigen Tag ein **Release Candidate** erstellt.

Konventionen:

- RC-Tags haben das Format `vX.Y.0-rc.N` — niemals bei einem Patch-Release, sondern nur bei Minor-Versionen mit für Betreiber sichtbaren Änderungen.
- Die `docker/metadata-action` des Publish-Workflows ist mit `flavor: latest=auto` konfiguriert. Dadurch werden SemVer-Vorabversions-Tags automatisch von `:latest`, `:X.Y` und `:X` ausgeschlossen — RCs werden nur als `:X.Y.0-rc.N` veröffentlicht. Betreiber, die `:latest` festlegen, erhalten so nicht versehentlich einen RC.
- GitHub kennzeichnet ein Release mit dem Tag `vX.Y.0-rc.N` automatisch als Vorabversion. Ein stabiles Tag erstellt ein gewöhnliches Release.

Erprobungszeit:

- Ein RC bleibt mindestens **48–72 Stunden** verfügbar oder bis mindestens ein Betreiber außerhalb des Maintainer-Teams ein erfolgreiches Upgrade meldet — je nachdem, was länger dauert.
- Fehlerberichte zu einem RC werden als `vX.Y.0-rc.N+1` veröffentlicht, wenn eine Behebung sinnvoll ist. Der vorherige RC bleibt zur Reproduzierbarkeit in GHCR.

Beförderung zur finalen Version:

- Das finale Tag `vX.Y.0` verweist auf den Merge des Promotion-PRs, der Version und Changelog nach dem letzten RC aktualisiert. Der Publish-Workflow erstellt die Multi-Arch-Images neu und versieht sie erneut mit Tags; der Digest unterscheidet sich vom RC, weil sich Version und Build-Eingaben ändern.
- Die Tags `:X.Y`, `:X` und `:latest` verweisen ab diesem Zeitpunkt auf das finale Release.

---

## Release erstellen (Checkliste für Maintainer)

Für ein normales Patch- oder Minor-Release ist kein RC-Kanal erforderlich:

1. Erhöhen Sie auf einem Feature-Branch `VERSION` und fügen Sie die passende Überschrift `## [<version>] - YYYY-MM-DD` zu `CHANGELOG.md` hinzu.
2. Führen Sie `python scripts/dump_openapi.py` aus, wenn sich eine Backend-Route oder ein Schema geändert hat; übernehmen Sie das Ergebnis, falls es sich geändert hat.
3. Öffnen Sie den PR. CI führt Linting, Tests, die OpenAPI-Abweichungsprüfung und `version-check.yml` aus.
4. Führen Sie einen Squash-Merge nach `main` durch. Führen Sie vor dem Taggen dieses Commits die vollständigen Repository-Audits `security-audit` und `ponytail-audit` aus. Lesen Sie beide Berichte, beheben Sie blockierende Sicherheitsbefunde sowie alle Must- und Should-Befunde und prüfen Sie, dass beide Audits den finalen Commit abdecken. Dokumentieren Sie die beiden abgeschlossenen Berichte in einem Codex- oder Claude-Chat wie in `SETUP.md` beschrieben. Dies gilt für stabile Tags und Release-Candidate-Tags.
5. Erstellen Sie auf `main` das Tag `git tag -s v<version> -m "v<version>"` (oder `git tag v<version>`, falls kein Signaturschlüssel eingerichtet ist), und führen Sie `git push origin v<version>` aus.
6. Der Workflow `Publish GitHub Release` extrahiert den Abschnitt `## [<version>]` aus `CHANGELOG.md` und erstellt ein GitHub Release.
7. Der Workflow `Publish Docker images to GHCR` erstellt, signiert und veröffentlicht die Multi-Arch-Images.
8. Verifizieren Sie mit Cosign:
   ```bash
   cosign verify \
     --certificate-identity-regexp '^https://github\.com/TommasoChi/turbo-ea/\.github/workflows/docker-publish\.yml@refs/(heads/main|tags/v[^/]+)$' \
     --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
     ghcr.io/tommasochi/turbo-ea/backend:<version>
   ```
   Erfordert Cosign 2.6 oder neuer (oder 3.x) — die Signatur ist ein Sigstore-Bundle; siehe [Supply Chain](../admin/supply-chain.md).

Für eine Minor-Version, die einen RC erfordert:

1. Derselbe PR- und Merge-Ablauf wie oben, aber die Version auf `1.Y.0-rc.1` erhöhen.
2. Erstellen Sie nach dem Merge das Tag `v1.Y.0-rc.1` und pushen Sie es. Der Publish-Workflow erstellt und veröffentlicht die RC-Images (nur `:1.Y.0-rc.1`, niemals `:latest` oder kurze Tags — `flavor: latest=auto` übernimmt das). GitHub kennzeichnet das Release automatisch als Vorabversion.
3. Warten Sie die Erprobungszeit ab. Beheben Sie gemeldete Probleme bei Bedarf mit `-rc.2`, `-rc.3` usw.
4. Für die Promotion erhöhen Sie `VERSION` in einem finalen PR auf `1.Y.0` (der CHANGELOG-Eintrag fasst alle RC-Korrekturen zusammen), führen den Merge durch und führen beide Release-Audits für den finalen Commit aus und dokumentieren sie. Taggen und pushen Sie anschließend `v1.Y.0`. `:latest` und die kurzen Tags verweisen nun auf das beförderte Release.

---

## Ende des Lebenszyklus

Nur die neueste Minor-Versionsreihe erhält Sicherheitskorrekturen. Die vollständige Richtlinie finden Sie in [`SECURITY.md`](https://github.com/TommasoChi/turbo-ea/blob/main/SECURITY.md). Ältere Minor-Versionsreihen haben das Ende ihres Lebenszyklus erreicht und erhalten keine Backports — Betreiber älterer Versionen sollten Upgrades gemäß der Kompatibilitätsrichtlinie planen.
