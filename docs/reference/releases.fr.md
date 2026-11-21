# Versions et canal de prépublication

Comment Turbo EA versionne, étiquette et publie ses images de conteneur. Cette page sert de référence aux opérateurs qui doivent fixer une version en production et aux contributeurs qui préparent une version.

---

## Versionnement

Turbo EA suit [Semantic Versioning](https://semver.org/). L’unique source de vérité pour la version actuelle est le fichier `/VERSION` à la racine du dépôt.

- **Patch** (par ex. `1.0.0` → `1.0.1`) : corrections de bogues uniquement. La mise à niveau est toujours sûre.
- **Minor** (par ex. `1.0.0` → `1.1.0`) : nouvelles fonctionnalités. Rétrocompatible selon la [politique de compatibilité](compatibility.md).
- **Major** (par ex. `1.x` → `2.0.0`) : changements incompatibles. Les notes de migration accompagnent la version.

La version est incrémentée une fois par PR, et non par commit. L’entrée du CHANGELOG du PR utilise la nouvelle version comme titre ; la CI échoue avec [`version-check.yml`](https://github.com/TommasoChi/turbo-ea/blob/main/.github/workflows/version-check.yml) si `/VERSION` est incrémenté sans titre `## [<version>]` correspondant dans `CHANGELOG.md`.

---

## Tags des images de conteneur

Chaque push vers `main` et chaque tag `v*.*.*` déclenche `.github/workflows/docker-publish.yml`, qui crée et publie sur GHCR des images multi-architecture (`amd64` + `arm64`).

Pour un tag de version tel que `v1.2.3`, les tags publiés pour chaque image sont :

| Tag                 | Pointe vers                | Stable ?                            |
|---------------------|----------------------------|-------------------------------------|
| `1.2.3`             | exactement cette version   | oui — à fixer en production         |
| `1.2`               | dernier patch de `1.2.x`   | avance avec les correctifs          |
| `1`                 | dernière version minor de `1.x` | avance avec les versions minor |
| `latest`            | dernière version non préliminaire | avance à chaque version |
| `sha-<short>`       | commit exact               | oui — débogage / prépublication    |

Pour les pushes vers `main` (sans tag), seuls les tags `main` et `sha-<short>` sont créés — jamais `latest`, jamais de tag semver.

Tous les manifestes des images publiées sont signés avec Cosign et OIDC sans clé. Les détails de vérification et de SBOM se trouvent dans [Supply Chain](../admin/supply-chain.md).

---

## Canal de prépublication

Pour les versions minor qui modifient l’agencement des conteneurs, les images de base, les UID par défaut, les noms de volumes, les ports par défaut ou le schéma d’une manière nécessitant une action de l’opérateur, une **release candidate** est créée avant le tag final.

Conventions :

- Les tags RC suivent `vX.Y.0-rc.N` — jamais pour une version patch, uniquement pour les versions minor avec des changements visibles par les opérateurs.
- `docker/metadata-action` du workflow de publication est configuré avec `flavor: latest=auto`. Cela exclut automatiquement les tags semver de prépublication de `:latest`, `:X.Y` et `:X` — les RC ne sont publiées qu’en `:X.Y.0-rc.N`. Les opérateurs qui fixent `:latest` ne récupèrent donc pas accidentellement une RC.
- GitHub marque automatiquement comme prépublication une release portant le tag `vX.Y.0-rc.N`. Un tag stable crée une release ordinaire.

Période d’évaluation :

- Une RC reste disponible pendant au moins **48 à 72 heures**, ou jusqu’à ce qu’au moins un opérateur extérieur à l’équipe de maintenance confirme la réussite d’une mise à niveau — la période la plus longue étant retenue.
- Les rapports de bogues sur une RC donnent lieu à `vX.Y.0-rc.N+1` si une correction est justifiée. La RC précédente reste sur GHCR pour assurer la reproductibilité.

Promotion vers la version finale :

- Le tag final `vX.Y.0` pointe vers le merge du PR de promotion, qui met à jour la version et le changelog après la dernière RC. Le workflow de publication reconstruit et retague les images multi-architecture ; le digest diffère de celui de la RC, car la version et les entrées de compilation changent.
- Les tags `:X.Y`, `:X` et `:latest` pointent alors vers la version finale.

---

## Préparer une version (liste de contrôle du mainteneur)

Pour une version patch ou minor normale — aucun canal RC n’est nécessaire :

1. Sur une branche de fonctionnalité, incrémentez `VERSION` et ajoutez le titre correspondant `## [<version>] - YYYY-MM-DD` dans `CHANGELOG.md`.
2. Exécutez `python scripts/dump_openapi.py` si une route backend ou un schéma a changé ; intégrez le résultat s’il a changé.
3. Ouvrez le PR. La CI exécute le lint, les tests, la vérification des écarts OpenAPI et `version-check.yml`.
4. Effectuez un squash merge vers `main`. Avant de créer le tag sur ce commit, lancez les audits complets du dépôt `security-audit` et `ponytail-audit`. Lisez les deux rapports, corrigez les constats de sécurité bloquants ainsi que tous les constats Must et Should, puis vérifiez que les deux audits couvrent le commit final. Dans un chat Codex ou Claude, consignez les deux rapports terminés comme indiqué dans `SETUP.md`. Cette règle s’applique aux tags stables comme aux tags de release candidate.
5. Depuis `main`, exécutez `git tag -s v<version> -m "v<version>"` (ou `git tag v<version>` si aucune clé de signature n’est configurée), puis `git push origin v<version>`.
6. Le workflow `Publish GitHub Release` extrait la section `## [<version>]` de `CHANGELOG.md` et crée une GitHub Release.
7. Le workflow `Publish Docker images to GHCR` crée, signe et publie les images multi-architecture.
8. Vérifiez avec Cosign :
   ```bash
   cosign verify \
     --certificate-identity-regexp '^https://github\.com/TommasoChi/turbo-ea/\.github/workflows/docker-publish\.yml@refs/(heads/main|tags/v[^/]+)$' \
     --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
     ghcr.io/tommasochi/turbo-ea/backend:<version>
   ```
   Nécessite Cosign 2.6 ou ultérieur (ou 3.x) — la signature est un bundle Sigstore ; voir [Supply Chain](../admin/supply-chain.md).

Pour une version minor qui nécessite une RC :

1. Suivez le même processus de PR et de fusion que ci-dessus, mais définissez la version sur `1.Y.0-rc.1`.
2. Après la fusion, créez le tag `v1.Y.0-rc.1` et poussez-le. Le workflow de publication crée et pousse les images RC (uniquement `:1.Y.0-rc.1`, jamais `:latest` ni les tags courts — `flavor: latest=auto` s’en charge). GitHub marque automatiquement la release comme prépublication.
3. Attendez la fin de la période d’évaluation. Traitez les problèmes signalés avec `-rc.2`, `-rc.3` si nécessaire.
4. Pour la promotion, définissez `VERSION` sur `1.Y.0` dans un PR final (l’entrée du CHANGELOG regroupe toutes les corrections des RC), fusionnez, exécutez et consignez les deux audits de release sur le commit final, puis créez le tag `v1.Y.0` et poussez-le. Les tags `:latest` et courts pointent alors vers la version promue.

---

## Fin de vie

Seule la dernière série minor reçoit des correctifs de sécurité. Consultez [`SECURITY.md`](https://github.com/TommasoChi/turbo-ea/blob/main/SECURITY.md) pour la politique complète. Les anciennes séries minor sont en fin de vie et ne recevront aucun rétroportage — les opérateurs utilisant d’anciennes versions doivent planifier leur mise à niveau conformément à la politique de compatibilité.
