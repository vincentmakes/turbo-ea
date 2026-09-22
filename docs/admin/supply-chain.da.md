# Forsyningskæde

Fra version 1.0.0 og fremefter bærer de container-images, Turbo EA publicerer til GHCR, verificerbare forsyningskæde-metadata, så operatører kan bekræfte, at et image kom fra dette projekts CI, før det trækkes ind i produktion.

Denne side dækker, hvad der er signeret, hvilken cosign-version du har brug for, hvordan du verificerer et image og Helm-chartet, hvor SBOM'en lever, og hvordan Trivy-porten passer ind.

---

## Hvad er signeret

Hvert image bygget af `.github/workflows/docker-publish.yml` og pushet til `ghcr.io/vincentmakes/turbo-ea/<image>` er signeret med [cosign](https://github.com/sigstore/cosign) ved hjælp af **nøgleløs OIDC**: der er ingen langtidsholdbar signeringsnøgle. Certifikatet udstedes af Sigstores Fulcio for workflow-identiteten (`https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@<ref>`), registreres i den offentlige Rekor-transparenslog og kasseres, så snart signaturen er oprettet.

Signerede images:

- `ghcr.io/vincentmakes/turbo-ea/db`
- `ghcr.io/vincentmakes/turbo-ea/backend`
- `ghcr.io/vincentmakes/turbo-ea/frontend`
- `ghcr.io/vincentmakes/turbo-ea/nginx`
- `ghcr.io/vincentmakes/turbo-ea/mcp-server`

Helm-chartet, `ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea`, signeres på samme måde af `.github/workflows/helm-publish.yml` ved hvert release-tag (identitet `…/helm-publish.yml@<ref>`).

`ollama`-imaget genopbygges manuelt uden for matrixen og er i øjeblikket ikke signeret; hvis du er afhængig af den medfølgende Ollama-profil og har brug for verifikation, så byg det fra kildekoden.

Signaturen gælder for OCI manifest list-digest, så en enkelt signatur dækker transparent både `linux/amd64` og `linux/arm64`. Der er ingen per-platform-signatur at jagte.

---

## Signaturformat og den cosign-version, du har brug for

**Verificér med cosign 2.6 eller nyere, eller en hvilken som helst cosign 3.x.** Ældre klienter — cosign 2.5 og derunder — rapporterer `no signatures found` for hvert image og chart publiceret siden 1.37.0, selvom signaturen er der.

Årsagen er en ændring af lagringsformatet, ikke af signeringen. Op til 1.36.0 kørte publicerings-workflowet cosign 2, som gemte signaturen under tagget `sha256-<digest>.sig` ved siden af imaget. Siden 1.37.0 (juni 2026, da cosign-installeren skiftede til cosign 3) er signaturen et [Sigstore-bundle](https://docs.sigstore.dev/about/bundle/): en OCI 1.1-*referrer* til imaget. GHCR implementerer ikke referrers-API'et, så cosign gemmer bundlet under fallback-indekstagget `sha256-<digest>` — uden `.sig`-suffiks — hvilket er præcis det sted, en klient før 2.6 aldrig kigger. `cosign tree` viser, hvad der er vedhæftet et image:

```bash
cosign tree ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

| Releases | Signaturformat | Verificeres med |
|----------|----------------|-----------------|
| 1.0.0 – 1.36.0 | ældre `sha256-<digest>.sig`-tag | enhver cosign |
| 1.37.0 og senere, samt hvert Helm-chart | Sigstore-bundle (OCI-referrer) | cosign ≥ 2.6 eller 3.x |

Hver publicering verificerer nu sin egen signatur med cosign 2.6 — den ældste klient, denne side lover — før jobbet bliver grønt, så en fremtidig formatændring ville få CI til at fejle frem for dit deploy. Projektet udsender bevidst én enkelt signatur i det aktuelle Sigstore-format: hvis en admission controller eller policy-motor i dit cluster stadig kun læser det ældre tag, så opgradér den i stedet for at forvente en anden signatur.

---

## Verifikation af et image

Installér [cosign](https://docs.sigstore.dev/cosign/installation/) 2.6 eller nyere, derefter:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

Hvad flagene gør:

- `--certificate-identity-regexp` — accepterer enhver workflow-sti inde i dette repo, så den samme kommando virker, uanset om imaget blev publiceret fra `docker-publish.yml` på `main` eller på et tag. Hvis du vil være strengere, så erstat med `--certificate-identity 'https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@refs/tags/v<version>'`.
- `--certificate-oidc-issuer` — pinner OIDC-issueren til GitHubs token-endpoint. En signatur udstedt af en hvilken som helst anden issuer (f.eks. en forks CI) vil fejle verifikation.

En vellykket verifikation udskriver den signerede payload og en post i Rekor-transparensloggen. En fejl afslutter med en ikke-nul exit-kode og en diagnostik — lad dit deploy fejle på den. Hvis diagnostikken er `no signatures found`, så tjek først `cosign version`: se afsnittet ovenfor.

Du kan også verificere efter digest, hvilket er den strengeste form (immun over for tag-remapping):

```bash
DIGEST=$(docker buildx imagetools inspect ghcr.io/vincentmakes/turbo-ea/backend:<version> --format '{{ .Manifest.Digest }}')
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend@${DIGEST}
```

---

## Verifikation af Helm-chartet

Chartet er et OCI-artefakt i samme registry og verificeres med samme kommando:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea:<version>
```

Én undtagelse fra tag-identiteten: chart `2.141.0`, den første chart-release, blev pushet men ikke signeret (dets signeringstrin fejlede på registry-autentificering) og blev signeret efterfølgende fra `main`-branchen, så dets certifikatidentitet er `…/helm-publish.yml@refs/heads/main` frem for en tag-reference. Det regulære udtryk ovenfor accepterer begge; en streng `--certificate-identity` skal for netop den version angive `refs/heads/main`.

---

## SBOM

En [SPDX](https://spdx.dev/) software bill of materials genereres automatisk af buildkit (`sbom: true` på build-trinnet) og vedhæftes hvert image som en OCI-referrer. Der er intet ekstra at installere — den lever i registret sammen med imaget.

Træk den med:

```bash
docker buildx imagetools inspect --format '{{ json .SBOM }}' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version> | jq .
```

SBOM'en lister hver pakke, buildkit observerede i det endelige image (apk-pakker, Python-wheels, Node-moduler osv.) med versioner og kilde-URL'er. Nyttige input til din egen sårbarhedsscanner, licens-compliance-værktøj eller komponentlager.

---

## Sårbarhedsscanning (Trivy)

Publicerings-workflowet kører [Trivy](https://github.com/aquasecurity/trivy) mod hvert bygget image i to trin:

- **Observér** — HIGH- og CRITICAL-fund uploades som SARIF til repository'ets GitHub **Security**-faneblad. Dette trin får aldrig jobbet til at fejle.
- **Port** — ethvert CRITICAL-fund med en tilgængelig rettelse **får publiceringen til at fejle**, medmindre CVE'en står i `.github/trivy-allowlist` med en skriftlig begrundelse (hver post revurderes kvartalsvis og fjernes, så snart upstream udsender en patch).

De samme to trin køres dagligt igen mod de faktisk publicerede `:latest`-manifester, og et rettelsesbart HIGH- eller CRITICAL-fund på et publiceret image udløser en genopbygning mod friske Alpine-repositorier. HIGH-fund forbliver indtil videre kun under observation: baserne er alpine-baserede (`python:3.12-alpine`, `postgres:18-alpine`, `nginx:alpine`) og bærer regelmæssigt baseline-fund mod musl-libc og transitive apk-afhængigheder, som ingen kodesti i Turbo EA når, men som Trivy rapporterer alligevel.

**Til operatører:** porten beskytter de publicerede images, men kør også din egen scanner mod det trukne image — din politik kan afvige fra vores. Den publicerede SBOM er et rent input.

**Til bidragydere:** hvis du opdager et fund, der faktisk kan udnyttes i en Turbo EA-anvendelsessti, så rapportér det venligst via en [privat sikkerhedsmeddelelse](https://github.com/vincentmakes/turbo-ea/security/advisories/new) i stedet for at kommentere i et offentligt issue. Se [`SECURITY.md`](https://github.com/vincentmakes/turbo-ea/blob/main/SECURITY.md).

---

## Action SHA-pinning

Hver GitHub Action, der bruges af publicerings-workflowet, er pinnet til en 40-tegns commit-SHA, ikke et flydende major-tag. Det betyder, at en kompromitteret upstream-vedligeholder eller en typosquat ikke stille kan ændre, hvad der kører i vores CI, uden en synlig diff i dette repo. Opdateringer flyder gennem Dependabots `github-actions`-økosystem i en månedlig kadence, så opdateringer stadig sker — de går bare gennem review.
