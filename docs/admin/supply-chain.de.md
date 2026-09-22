# Lieferkette

Ab Version 1.0.0 tragen die Container-Images, die Turbo EA nach GHCR veröffentlicht, überprüfbare Lieferketten-Metadaten, damit Betreiber bestätigen können, dass ein Image aus der CI dieses Projekts stammt, bevor sie es in die Produktion ziehen.

Diese Seite beschreibt, was signiert ist, welche cosign-Version Sie benötigen, wie Sie ein Image und das Helm-Chart verifizieren, wo die SBOM liegt und wie das Trivy-Gate dazupasst.

---

## Was signiert ist

Jedes von `.github/workflows/docker-publish.yml` gebaute und nach `ghcr.io/vincentmakes/turbo-ea/<image>` gepushte Image ist mit [cosign](https://github.com/sigstore/cosign) per **schlüsselloser OIDC** signiert: Es gibt keinen langlebigen Signaturschlüssel. Das Zertifikat wird von Sigstores Fulcio für die Workflow-Identität (`https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@<ref>`) ausgestellt, im öffentlichen Rekor-Transparenzprotokoll festgehalten und verworfen, sobald die Signatur erzeugt ist.

Signierte Images:

- `ghcr.io/vincentmakes/turbo-ea/db`
- `ghcr.io/vincentmakes/turbo-ea/backend`
- `ghcr.io/vincentmakes/turbo-ea/frontend`
- `ghcr.io/vincentmakes/turbo-ea/nginx`
- `ghcr.io/vincentmakes/turbo-ea/mcp-server`

Das Helm-Chart `ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea` wird von `.github/workflows/helm-publish.yml` bei jedem Release-Tag auf dieselbe Weise signiert (Identität `…/helm-publish.yml@<ref>`).

Das `ollama`-Image wird manuell außerhalb der Matrix neu gebaut und ist derzeit nicht signiert; wenn Sie auf das mitgelieferte Ollama-Profil angewiesen sind und eine Verifikation benötigen, bauen Sie es aus dem Quellcode.

Die Signatur gilt für den Digest der OCI-Manifestliste, sodass eine einzige Signatur transparent sowohl `linux/amd64` als auch `linux/arm64` abdeckt. Es gibt keine plattformspezifische Signatur, der man hinterherlaufen müsste.

---

## Signaturformat und benötigte cosign-Version

**Verifizieren Sie mit cosign 2.6 oder neuer oder mit einer beliebigen Version 3.x.** Ältere Clients — cosign 2.5 und darunter — melden für jedes seit 1.37.0 veröffentlichte Image und Chart `no signatures found`, obwohl die Signatur vorhanden ist.

Der Grund ist ein geändertes Speicherformat, nicht eine geänderte Signierung. Bis 1.36.0 lief im Publish-Workflow cosign 2, das die Signatur unter dem Tag `sha256-<digest>.sig` neben dem Image ablegte. Seit 1.37.0 (Juni 2026, als der cosign-Installer auf cosign 3 wechselte) ist die Signatur ein [Sigstore-Bundle](https://docs.sigstore.dev/about/bundle/): ein OCI-1.1-*Referrer* des Images. GHCR implementiert die Referrers-API nicht, daher legt cosign das Bundle unter dem Ausweich-Index-Tag `sha256-<digest>` ab — ohne `.sig`-Suffix — und genau dort schaut ein Client vor 2.6 niemals nach. `cosign tree` zeigt, was an einem Image hängt:

```bash
cosign tree ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

| Releases | Signaturformat | Verifizierbar mit |
|----------|----------------|-------------------|
| 1.0.0 – 1.36.0 | Legacy-Tag `sha256-<digest>.sig` | jedem cosign |
| 1.37.0 und neuer sowie jedes Helm-Chart | Sigstore-Bundle (OCI-Referrer) | cosign ≥ 2.6 oder 3.x |

Jede Veröffentlichung verifiziert ihre eigene Signatur inzwischen mit cosign 2.6 — dem ältesten Client, den diese Seite zusagt —, bevor der Job grün wird. Ein künftiger Formatwechsel würde also die CI scheitern lassen und nicht Ihr Deployment. Das Projekt gibt bewusst eine einzige Signatur im aktuellen Sigstore-Format aus: Liest ein Admission-Controller oder eine Policy-Engine in Ihrem Cluster nur das Legacy-Tag, aktualisieren Sie ihn, statt eine zweite Signatur zu erwarten.

---

## Ein Image verifizieren

Installieren Sie [cosign](https://docs.sigstore.dev/cosign/installation/) 2.6 oder neuer, dann:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

Was die Flags tun:

- `--certificate-identity-regexp` — akzeptiert jeden Workflow-Pfad innerhalb dieses Repos, sodass derselbe Befehl funktioniert, egal ob das Image aus `docker-publish.yml` auf `main` oder auf einem Tag veröffentlicht wurde. Wenn Sie strenger sein möchten, ersetzen Sie es durch `--certificate-identity 'https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@refs/tags/v<version>'`.
- `--certificate-oidc-issuer` — fixiert den OIDC-Issuer auf GitHubs Token-Endpunkt. Eine von einem anderen Issuer (z. B. der CI eines Forks) erzeugte Signatur scheitert an der Verifikation.

Eine erfolgreiche Verifikation gibt die signierte Payload und einen Eintrag im Rekor-Transparenzprotokoll aus. Ein Fehlschlag endet mit einem Exit-Code ungleich null und einer Diagnose — lassen Sie Ihr Deployment daran scheitern. Lautet die Diagnose `no signatures found`, prüfen Sie zuerst `cosign version`: siehe den Abschnitt oben.

Sie können auch per Digest verifizieren, die strengste Form (immun gegen umgehängte Tags):

```bash
DIGEST=$(docker buildx imagetools inspect ghcr.io/vincentmakes/turbo-ea/backend:<version> --format '{{ .Manifest.Digest }}')
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend@${DIGEST}
```

---

## Das Helm-Chart verifizieren

Das Chart ist ein OCI-Artefakt in derselben Registry und wird mit demselben Befehl verifiziert:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea:<version>
```

Eine Ausnahme bei der Tag-Identität: Chart `2.141.0`, das erste Chart-Release, wurde gepusht, aber nicht signiert (sein Signaturschritt scheiterte an der Registry-Authentifizierung) und wurde nachträglich vom Branch `main` signiert. Seine Zertifikatsidentität lautet daher `…/helm-publish.yml@refs/heads/main` statt einer Tag-Referenz. Der reguläre Ausdruck oben akzeptiert beides; eine strikte `--certificate-identity` muss für diese eine Version `refs/heads/main` nennen.

---

## SBOM

Eine [SPDX](https://spdx.dev/)-Software-Stückliste wird automatisch von buildkit erzeugt (`sbom: true` im Build-Schritt) und jedem Image als OCI-Referrer angehängt. Es ist nichts zusätzlich zu installieren — sie liegt in der Registry neben dem Image.

Abrufen mit:

```bash
docker buildx imagetools inspect --format '{{ json .SBOM }}' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version> | jq .
```

Die SBOM listet jedes Paket, das buildkit im finalen Image beobachtet hat (apk-Pakete, Python-Wheels, Node-Module usw.), mit Versionen und Quell-URLs. Nützliche Eingaben für Ihren eigenen Schwachstellenscanner, Ihre Lizenz-Compliance-Werkzeuge oder Ihr Komponenteninventar.

---

## Schwachstellenscan (Trivy)

Der Publish-Workflow lässt [Trivy](https://github.com/aquasecurity/trivy) in zwei Schritten über jedes gebaute Image laufen:

- **Beobachten** — HIGH- und CRITICAL-Funde werden als SARIF in den GitHub-Tab **Security** des Repositorys hochgeladen. Dieser Schritt lässt den Job nie scheitern.
- **Gate** — jeder CRITICAL-Fund mit verfügbarem Fix **lässt die Veröffentlichung scheitern**, sofern die CVE nicht mit schriftlicher Begründung in `.github/trivy-allowlist` steht (jeder Eintrag wird vierteljährlich neu bewertet und entfernt, sobald upstream einen Patch liefert).

Dieselben zwei Schritte laufen täglich erneut gegen die live veröffentlichten `:latest`-Manifeste, und ein behebbarer HIGH- oder CRITICAL-Fund in einem veröffentlichten Image stößt einen Neubau gegen frische Alpine-Repositorys an. HIGH-Funde bleiben vorerst reine Beobachtung: Die Basis-Images sind alpine-basiert (`python:3.12-alpine`, `postgres:18-alpine`, `nginx:alpine`) und tragen regelmäßig Grundrauschen gegen musl-libc und transitive apk-Abhängigkeiten, das kein Turbo-EA-Codepfad erreicht, das Trivy aber dennoch meldet.

**Für Betreiber:** Das Gate schützt die veröffentlichten Images, lassen Sie aber zusätzlich Ihren eigenen Scanner über das gezogene Image laufen — Ihre Richtlinie kann von unserer abweichen. Die veröffentlichte SBOM ist eine saubere Eingabe.

**Für Mitwirkende:** Wenn Sie einen Fund entdecken, der in einem Turbo-EA-Nutzungspfad tatsächlich ausnutzbar ist, melden Sie ihn bitte über eine [private Sicherheitsmeldung](https://github.com/vincentmakes/turbo-ea/security/advisories/new) statt in einem öffentlichen Issue zu kommentieren. Siehe [`SECURITY.md`](https://github.com/vincentmakes/turbo-ea/blob/main/SECURITY.md).

---

## Action-SHA-Pinning

Jede vom Publish-Workflow verwendete GitHub Action ist auf einen 40-stelligen Commit-SHA gepinnt, nicht auf ein bewegliches Major-Tag. Ein kompromittierter Upstream-Maintainer oder ein Typosquat kann also nicht stillschweigend ändern, was in unserer CI läuft, ohne einen sichtbaren Diff in diesem Repository. Aktualisierungen laufen monatlich über Dependabots `github-actions`-Ökosystem, sodass es weiterhin Auffrischungen gibt — sie gehen nur durch ein Review.
