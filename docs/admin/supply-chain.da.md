# Forsyningskæde

Fra version 1.0.0 og fremefter bærer container-imagene, Turbo EA publicerer til GHCR, verificerbare forsyningskæde-metadata, så operatører kan bekræfte, at et image kom fra dette projekts CI, før det trækkes ind i produktion.

Denne side dækker, hvad der er signeret, hvordan det verificeres, hvor SBOM'en lever, og hvordan den (i øjeblikket informative) Trivy-scanning passer ind.

---

## Hvad er signeret

Hvert image bygget af `.github/workflows/docker-publish.yml` og pushet til `ghcr.io/vincentmakes/turbo-ea/<image>` er signeret med [cosign](https://github.com/sigstore/cosign) ved hjælp af **nøgleløs OIDC**: der er ingen langtidsholdbar signeringsnøgle. Certifikatet udstedes af Sigstores Fulcio for workflow-identiteten (`https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@<ref>`), registreres i den offentlige Rekor-transparenslog og kasseres, så snart signaturen er oprettet.

Signerede images:

- `ghcr.io/vincentmakes/turbo-ea/db`
- `ghcr.io/vincentmakes/turbo-ea/backend`
- `ghcr.io/vincentmakes/turbo-ea/frontend`
- `ghcr.io/vincentmakes/turbo-ea/nginx`
- `ghcr.io/vincentmakes/turbo-ea/mcp-server`

`ollama`-imaget genopbygges manuelt uden for matrixen og er i øjeblikket ikke signeret; hvis du er afhængig af den medfølgende Ollama-profil og har brug for verifikation, så byg det fra kildekoden.

Signaturen gælder for OCI manifest list-digest, så en enkelt signatur dækker transparent både `linux/amd64` og `linux/arm64`. Der er ingen per-platform-signatur at jagte.

---

## Verifikation af et image

Installer [cosign](https://docs.sigstore.dev/cosign/installation/), derefter:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend:1.0.0
```

Hvad flagene gør:

- `--certificate-identity-regexp` — accepterer enhver workflow-sti inde i dette repo, så den samme kommando virker, uanset om imaget blev publiceret fra `docker-publish.yml` på `main` eller på et tag. Hvis du vil være strengere, så erstat med `--certificate-identity 'https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@refs/tags/v1.0.0'`.
- `--certificate-oidc-issuer` — pinner OIDC-issueren til GitHubs token-endpoint. En signatur præget af en hvilken som helst anden issuer (f.eks. en forks CI) vil fejle verifikation.

En vellykket verifikation udskriver den signerede payload og en Rekor transparenslog-post-URL. En fejl forlader ikke-nul med en diagnostik — fejl dit deploy på det.

Du kan også verificere efter digest, hvilket er den strengeste form (immun over for tag-remapping):

```bash
DIGEST=$(docker buildx imagetools inspect ghcr.io/vincentmakes/turbo-ea/backend:1.0.0 --format '{{ .Manifest.Digest }}')
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend@${DIGEST}
```

---

## SBOM

En [SPDX](https://spdx.dev/) software bill of materials genereres automatisk af buildkit (`sbom: true` på build-trinnet) og vedhæftes hvert image som en OCI-referent. Der er intet ekstra at installere — den lever i registret sammen med imaget.

Træk den med:

```bash
docker buildx imagetools inspect --format '{{ json .SBOM }}' \
  ghcr.io/vincentmakes/turbo-ea/backend:1.0.0 | jq .
```

SBOM'en lister hver pakke, buildkit observerede i det endelige image (apk-pakker, Python-wheels, Node-moduler osv.) med versioner og kilde-URL'er. Nyttige input til din egen sårbarhedsscanner, licens-compliance-værktøj eller komponentlager.

---

## Sårbarhedsscanning (Trivy)

Publicerings-workflowet kører [Trivy](https://github.com/aquasecurity/trivy) mod hvert bygget image for HIGH- og CRITICAL-CVE'er og uploader resultatet som SARIF til repository'ets GitHub **Security**-faneblad.

Scanningen er i øjeblikket **ikke-blokerende** (`exit-code: 0`). Årsager:

- Baserne er alpine-baserede (`python:3.12-alpine`, `postgres:18-alpine`, `nginx:alpine`). Alpine-images bærer regelmæssigt baseline-fund mod musl-libc og apk transitive afhængigheder — mange af dem, der ikke er tilgængelige gennem nogen sti, Turbo EA faktisk bruger, men Trivy rapporterer dem alligevel.
- At behandle disse fund som hårde fejl fra dag ét ville blokere hver publicering uden at give operatører tid til at reagere. Den faseopdelte plan er: send informative scanninger, fang baseline i `.github/trivy-allowlist.yaml` med begrundelse per CVE, *derefter* vend porten til håndhævende.

**Til operatører:** Hvis Trivy-resultater betyder noget for dit deploy, så kør din egen scanner mod det trukne image. Den publicerede SBOM er et rent input. Stol ikke på, at upstream-porten er håndhævende endnu.

**Til bidragydere:** Hvis du opdager et fund, der faktisk er udnytteligt i en Turbo EA-anvendelsessti, så rapportér det venligst via [privat sikkerhedsråd](https://github.com/vincentmakes/turbo-ea/security/advisories/new) i stedet for at kommentere i et offentligt issue. Se [`SECURITY.md`](https://github.com/vincentmakes/turbo-ea/blob/main/SECURITY.md).

---

## Action SHA-pinning

Hver GitHub Action, der bruges af publicerings-workflowet, er pinnet til en 40-tegns commit-SHA, ikke et flydende major-tag. Dette betyder, at en kompromitteret upstream-vedligeholder eller en typosquat ikke stille kan ændre, hvad der kører i vores CI uden en synlig diff i dette repo. Opdateringer flyder gennem Dependabots `github-actions`-økosystem på en månedlig kadence, så opdateringer stadig sker — de går bare gennem gennemgang.
