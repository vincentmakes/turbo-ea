# Chaîne d'approvisionnement

À partir de la version 1.0.0, les images de conteneurs que Turbo EA publie sur GHCR portent des métadonnées de chaîne d'approvisionnement vérifiables, afin que les opérateurs puissent confirmer qu'une image provient bien de la CI de ce projet avant de la déployer en production.

Cette page décrit ce qui est signé, la version de cosign dont vous avez besoin, comment vérifier une image et le chart Helm, où se trouve la SBOM et comment s'intègre le garde-fou Trivy.

---

## Ce qui est signé

Chaque image construite par `.github/workflows/docker-publish.yml` et poussée vers `ghcr.io/vincentmakes/turbo-ea/<image>` est signée avec [cosign](https://github.com/sigstore/cosign) en mode **OIDC sans clé** : il n'existe aucune clé de signature de longue durée. Le certificat est émis par le Fulcio de Sigstore pour l'identité du workflow (`https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@<ref>`), consigné dans le journal de transparence public Rekor et détruit dès que la signature est créée.

Images signées :

- `ghcr.io/vincentmakes/turbo-ea/db`
- `ghcr.io/vincentmakes/turbo-ea/backend`
- `ghcr.io/vincentmakes/turbo-ea/frontend`
- `ghcr.io/vincentmakes/turbo-ea/nginx`
- `ghcr.io/vincentmakes/turbo-ea/mcp-server`

Le chart Helm, `ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea`, est signé de la même manière par `.github/workflows/helm-publish.yml` à chaque tag de version (identité `…/helm-publish.yml@<ref>`).

L'image `ollama` est reconstruite manuellement hors de la matrice et n'est pas signée pour l'instant ; si vous dépendez du profil Ollama fourni et avez besoin d'une vérification, construisez-la depuis les sources.

La signature porte sur le digest de la liste de manifestes OCI : une seule signature couvre donc de façon transparente `linux/amd64` et `linux/arm64`. Il n'y a aucune signature par plateforme à rechercher.

---

## Format de signature et version de cosign requise

**Vérifiez avec cosign 2.6 ou plus récent, ou n'importe quelle version 3.x.** Les clients plus anciens — cosign 2.5 et antérieurs — répondent `no signatures found` pour chaque image et chart publiés depuis la 1.37.0, alors que la signature est bien là.

La raison est un changement de format de stockage, pas de signature. Jusqu'à la 1.36.0, le workflow de publication utilisait cosign 2, qui rangeait la signature sous le tag `sha256-<digest>.sig` à côté de l'image. Depuis la 1.37.0 (juin 2026, lorsque l'installateur de cosign est passé à cosign 3), la signature est un [bundle Sigstore](https://docs.sigstore.dev/about/bundle/) : un *referrer* OCI 1.1 de l'image. GHCR n'implémente pas l'API referrers, cosign range donc le bundle sous le tag d'index de repli `sha256-<digest>` — sans suffixe `.sig` —, exactement l'endroit qu'un client antérieur à 2.6 ne consulte jamais. `cosign tree` montre ce qui est attaché à une image :

```bash
cosign tree ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

| Versions | Format de signature | Vérifiable avec |
|----------|---------------------|-----------------|
| 1.0.0 – 1.36.0 | tag historique `sha256-<digest>.sig` | n'importe quel cosign |
| 1.37.0 et suivantes, et chaque chart Helm | bundle Sigstore (referrer OCI) | cosign ≥ 2.6, ou 3.x |

Chaque publication vérifie désormais sa propre signature avec cosign 2.6 — le client le plus ancien que cette page promet — avant que le job ne passe au vert : un futur changement de format ferait échouer la CI plutôt que votre déploiement. Le projet émet délibérément une seule signature, au format Sigstore actuel : si un contrôleur d'admission ou un moteur de politiques de votre cluster ne lit encore que le tag historique, mettez-le à jour plutôt que d'attendre une seconde signature.

---

## Vérifier une image

Installez [cosign](https://docs.sigstore.dev/cosign/installation/) 2.6 ou plus récent, puis :

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

Rôle des options :

- `--certificate-identity-regexp` — accepte n'importe quel chemin de workflow de ce dépôt, si bien que la même commande fonctionne que l'image ait été publiée depuis `docker-publish.yml` sur `main` ou sur un tag. Pour être plus strict, remplacez-la par `--certificate-identity 'https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@refs/tags/v<version>'`.
- `--certificate-oidc-issuer` — fixe l'émetteur OIDC au point de terminaison de jetons de GitHub. Une signature produite par tout autre émetteur (par exemple la CI d'un fork) échouera à la vérification.

Une vérification réussie affiche la charge utile signée et une entrée du journal de transparence Rekor. Un échec renvoie un code de sortie non nul accompagné d'un diagnostic — faites échouer votre déploiement dessus. Si le diagnostic est `no signatures found`, vérifiez d'abord `cosign version` : voir la section ci-dessus.

Vous pouvez aussi vérifier par digest, la forme la plus stricte (insensible au déplacement des tags) :

```bash
DIGEST=$(docker buildx imagetools inspect ghcr.io/vincentmakes/turbo-ea/backend:<version> --format '{{ .Manifest.Digest }}')
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend@${DIGEST}
```

---

## Vérifier le chart Helm

Le chart est un artefact OCI du même registre et se vérifie avec la même commande :

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea:<version>
```

Une exception concernant l'identité du tag : le chart `2.141.0`, première version du chart, a été poussé sans être signé (son étape de signature a échoué sur l'authentification au registre) puis signé après coup depuis la branche `main` ; son identité de certificat est donc `…/helm-publish.yml@refs/heads/main` et non une référence de tag. L'expression régulière ci-dessus accepte les deux ; une `--certificate-identity` stricte doit, pour cette seule version, indiquer `refs/heads/main`.

---

## SBOM

Une nomenclature logicielle [SPDX](https://spdx.dev/) est générée automatiquement par buildkit (`sbom: true` à l'étape de construction) et attachée à chaque image en tant que referrer OCI. Rien de plus à installer — elle vit dans le registre, à côté de l'image.

Récupérez-la avec :

```bash
docker buildx imagetools inspect --format '{{ json .SBOM }}' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version> | jq .
```

La SBOM liste chaque paquet que buildkit a observé dans l'image finale (paquets apk, wheels Python, modules Node, etc.) avec versions et URL sources. Une entrée utile pour votre propre scanner de vulnérabilités, vos outils de conformité des licences ou votre inventaire de composants.

---

## Analyse de vulnérabilités (Trivy)

Le workflow de publication exécute [Trivy](https://github.com/aquasecurity/trivy) sur chaque image construite, en deux étapes :

- **Observation** — les résultats HIGH et CRITICAL sont téléversés au format SARIF dans l'onglet **Security** du dépôt GitHub. Cette étape ne fait jamais échouer le job.
- **Garde-fou** — tout résultat CRITICAL disposant d'un correctif **fait échouer la publication**, sauf si la CVE figure dans `.github/trivy-allowlist` avec une justification écrite (chaque entrée est réévaluée chaque trimestre et retirée dès qu'un correctif amont est publié).

Ces deux mêmes étapes sont rejouées chaque jour contre les manifestes `:latest` réellement publiés, et un résultat HIGH ou CRITICAL corrigeable sur une image publiée déclenche une reconstruction contre des dépôts Alpine à jour. Les résultats HIGH restent pour l'instant en simple observation : les images de base reposent sur Alpine (`python:3.12-alpine`, `postgres:18-alpine`, `nginx:alpine`) et portent régulièrement des résultats de fond contre musl-libc et des dépendances apk transitives qu'aucun chemin de code de Turbo EA n'atteint, mais que Trivy signale malgré tout.

**Pour les opérateurs :** le garde-fou protège les images publiées, mais exécutez aussi votre propre scanner sur l'image récupérée — votre politique peut différer de la nôtre. La SBOM publiée est une entrée propre.

**Pour les contributeurs :** si vous repérez un résultat réellement exploitable dans un chemin d'utilisation de Turbo EA, signalez-le via un [avis de sécurité privé](https://github.com/vincentmakes/turbo-ea/security/advisories/new) plutôt qu'en commentant une issue publique. Voir [`SECURITY.md`](https://github.com/vincentmakes/turbo-ea/blob/main/SECURITY.md).

---

## Épinglage des actions par SHA

Chaque GitHub Action utilisée par le workflow de publication est épinglée sur un SHA de commit de 40 caractères, pas sur un tag majeur flottant. Un mainteneur amont compromis ou un typosquat ne peut donc pas changer silencieusement ce qui s'exécute dans notre CI sans un diff visible dans ce dépôt. Les mises à jour passent par l'écosystème `github-actions` de Dependabot à cadence mensuelle, pour que les rafraîchissements continuent — simplement via une revue.
