# Udgivelser og pre-release-kanal

Hvordan Turbo EA versionerer, tagger og publicerer containerimages. Denne side er referencen for operatører, der har brug for at fastlåse versioner i produktion, og for bidragydere, der udgiver releases.

---

## Versionering

Turbo EA følger [Semantic Versioning](https://semver.org/). Den eneste kilde til sandhed for den aktuelle version er `/VERSION`-filen i repository-roden.

- **Patch** (f.eks. `1.0.0` → `1.0.1`): kun fejlrettelser. Altid sikker at opgradere.
- **Minor** (f.eks. `1.0.0` → `1.1.0`): nye funktioner. Bagudkompatibel ifølge [kompatibilitetspolitikken](compatibility.md).
- **Major** (f.eks. `1.x` → `2.0.0`): brydende ændringer. Migrationsnoter leveres med udgivelsen.

Versionen bumpes én gang pr. PR, ikke pr. commit. PR'ens CHANGELOG-post bruger den nye version som overskrift; CI'ens [`version-check.yml`](https://github.com/vincentmakes/turbo-ea/blob/main/.github/workflows/version-check.yml) fejler enhver PR, der bumper `VERSION` uden en matchende `## [<version>]`-overskrift i `CHANGELOG.md`.

---

## Containerimage-tags

Hvert push til `main` og hvert `v*.*.*`-tag udløser `.github/workflows/docker-publish.yml`, som bygger og pusher multi-arch (`amd64` + `arm64`) images til GHCR.

For et release-tag som `v1.2.3` er de publicerede tags på hvert image:

| Tag                 | Peger på                 | Stabilt?                           |
|---------------------|--------------------------|------------------------------------|
| `1.2.3`             | præcis den udgivelse     | ja — fastlås dette i produktion    |
| `1.2`               | seneste patch på `1.2.x` | ruller fremad ved patches          |
| `1`                 | seneste minor på `1.x`   | ruller fremad ved minors           |
| `latest`            | seneste ikke-prerelease  | ruller fremad ved hver udgivelse   |
| `sha-<short>`       | præcis commit            | ja — debugging / pre-release       |

For push til `main` (intet tag) produceres kun `main`- og `sha-<short>`-tags — aldrig `latest`, aldrig noget semver-tag.

Alle publicerede image-manifester er signeret med cosign keyless OIDC. Verifikations- og SBOM-detaljer findes i [Supply Chain](../admin/supply-chain.md).

---

## Pre-release-kanal

For minors, der ændrer containerlayout, base-images, standard-UID'er, volumenavne, standardporte eller skema på en måde, der kræver operatørhandling, udgives en **release candidate** før det endelige tag.

Konventioner:

- RC-tags er `vX.Y.0-rc.N` — aldrig på en patch-udgivelse, kun på minors med operatør-synlige ændringer.
- Publiceringsarbejdsprocessens `docker/metadata-action` er konfigureret med `flavor: latest=auto`. Dette ekskluderer automatisk prerelease-semver-tags fra `:latest`, `:X.Y` og `:X` — RC'er publiceres kun som `:X.Y.0-rc.N`. Operatører, der fastlåser til `:latest`, vil ikke ved en fejl trække en RC.
- GitHub Release for et RC-tag bør flages som en prerelease på Releases-siden. Den nuværende `github-release.yml`-arbejdsproces opretter altid en ikke-prerelease-udgivelse; vedligeholderen vipper prerelease-knappen manuelt, efter at arbejdsprocessen kører (eller redigerer udgivelsen via `gh release edit vX.Y.0-rc.N --prerelease`).

Bagetid:

- En RC forbliver ude i mindst **48–72 timer** før forfremmelse, eller indtil mindst én operatør uden for vedligeholderen rapporterer vellykket opgradering tilbage — hvad der end er længst.
- Fejlrapporter mod en RC sendes som `vX.Y.0-rc.N+1`, hvis problemet er rettelses-værdigt. Den forrige RC efterlades i GHCR for reproducerbarhed.

Forfremmelse til final:

- Det endelige `vX.Y.0`-tag oprettes på den samme commit som den sidste RC. Publiceringsarbejdsprocessen genopbygger og re-tagger multi-arch-images; digestet vil afvige fra RC'en, selvom kilden er identisk (build-input inkluderer tidsstempler).
- `:X.Y`-, `:X`- og `:latest`-tags flyttes for at pege på den endelige udgivelse på dette tidspunkt.

---

## Udgivelse af en release (vedligeholder-tjekliste)

For en normal patch eller minor — ingen RC-kanal nødvendig:

1. På en feature-branch bumpes `VERSION`, og den matchende `## [<version>] - YYYY-MM-DD`-overskrift tilføjes til `CHANGELOG.md`.
2. Kør `python scripts/dump_openapi.py`, hvis nogen backend-rute eller -skema er ændret; commit resultatet, hvis det er ændret.
3. Åbn PR'en. CI kører lint, tests, OpenAPI drift-tjek og `version-check.yml`.
4. Squash-merge til `main`.
5. Fra `main`: `git tag -s v<version> -m "v<version>"` (eller `git tag v<version>`, hvis ingen signeringsnøgle er konfigureret), `git push origin v<version>`.
6. Arbejdsprocessen `Publish GitHub Release` udtrækker `## [<version>]`-sektionen fra `CHANGELOG.md` og opretter en GitHub Release.
7. Arbejdsprocessen `Publish Docker images to GHCR` bygger, signerer og publicerer multi-arch-billederne.
8. Verificér med cosign:
   ```bash
   cosign verify \
     --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
     --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
     ghcr.io/vincentmakes/turbo-ea/backend:<version>
   ```

For en minor, der berettiger en RC:

1. Samme PR-og-merge-flow som ovenfor, men bump til `1.Y.0-rc.1`.
2. Efter merge tagges `v1.Y.0-rc.1` og pushes. Publiceringsarbejdsprocessen bygger og pusher RC-billederne (kun `:1.Y.0-rc.1`, aldrig `:latest` eller korte tags — `flavor: latest=auto` håndterer det). Release-arbejdsprocessen opretter en GitHub Release; vip den manuelt til prerelease bagefter via `gh release edit v1.Y.0-rc.1 --prerelease` eller i GitHub UI'en.
3. Vent på bagevinduet. Adressér eventuelle rapporterede problemer med `-rc.2`, `-rc.3` efter behov.
4. For at forfremme: bump `VERSION` til `1.Y.0` i en endelig PR (CHANGELOG-post konsoliderer alle RC-rettelser), merge, tag `v1.Y.0`, push. `:latest`- og korte tags peger nu på den forfremmede udgivelse.

---

## End-of-life

Kun den seneste minor-linje modtager sikkerhedsrettelser. Se [`SECURITY.md`](https://github.com/vincentmakes/turbo-ea/blob/main/SECURITY.md) for den fulde politik. Ældre minor-linjer er end-of-life og vil ikke modtage backports — operatører på ældre versioner bør planlægge opgraderinger gennem kompatibilitetspolitikken.
