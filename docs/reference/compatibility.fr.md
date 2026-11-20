# Politique de compatibilité

À partir de la version `1.0.0`, Turbo EA s’engage à garantir une compatibilité descendante documentée au sein d’une même branche majeure. Cette page constitue le contrat : elle décrit ce qui reste stable, ce qui peut changer et le fonctionnement des dépréciations, afin que les responsables puissent planifier leurs mises à niveau sans surprise.

La politique s’applique à `1.x`. Une future branche `2.x` pourra la réviser ; le cas échéant, un guide de migration sera publié avec les notes de version de `2.0.0`.

---

## Éléments couverts

### Schéma de base de données (migrations Alembic)

Dans `1.x` :

- Les migrations sont **additives** ou **rétrocompatibles lors d’une mise à niveau**.
- De nouvelles colonnes peuvent être ajoutées à tout moment.
- Les colonnes existantes ne sont pas supprimées sans cycle de dépréciation.
- Les colonnes existantes ne sont pas renommées sans cycle de dépréciation (un renommage suit les étapes add-new-column → backfill → deprecate-old-column → drop-in-next-major).
- Les changements de type se limitent à un élargissement (par exemple, `varchar(80)` → `varchar(255)`) ; les réductions passent par une dépréciation.
- Les contraintes de clé étrangère ne deviennent pas plus strictes sans cycle de dépréciation (par exemple, `ON DELETE SET NULL` ne devient pas `ON DELETE CASCADE`).

Les responsables peuvent effectuer les mises à niveau en confiance ; la migration automatique au démarrage du backend peut être exécutée sans risque sur les données de production.

### Métamodèle intégré

Dans `1.x`, le métamodèle livré dans `backend/app/services/seed.py` est stable :

- Les clés des types de fiches intégrés (`Application`, `Initiative`, `BusinessCapability`, etc.) ne sont ni renommées ni supprimées.
- Les clés des champs intégrés de ces types ne sont pas supprimées sans cycle de dépréciation.
- Les clés des types de relation intégrés ne sont ni renommées ni supprimées sans cycle de dépréciation.
- Les sous-types par défaut livrés avec les types intégrés sont stables.

Les personnalisations propres aux responsables (types de fiches personnalisés, champs ajoutés depuis l’interface d’administration, types de relation personnalisés) leur appartiennent et ne sont pas couvertes par cette politique.

### API REST (`/api/v1/`)

Dans `1.x` :

- Les points de terminaison sous `/api/v1/` ne sont pas supprimés sans cycle de dépréciation.
- Les noms des champs de requête et de réponse existants ne sont pas renommés sans cycle de dépréciation.
- Les types de champs ne changent pas de manière incompatible (par exemple, chaîne → tableau).
- Les nouveaux champs de requête facultatifs et les nouveaux champs de réponse ne sont pas incompatibles et peuvent être ajoutés dans toute version mineure.
- Les nouveaux points de terminaison ne sont pas incompatibles et peuvent être ajoutés dans toute version mineure.
- La sémantique d’authentification (JWT `Bearer`, forme de la charge utile de `/auth/login`) est stable.
- La sémantique des codes d’état HTTP est stable pour les chemins de réussite et d’erreur documentés.

Le comportement au-delà de la surface documentée (en-têtes non documentés, texte des messages d’erreur internes, ordre sans `sort_by`) n’est pas couvert.

### Clés d’autorisation

Les clés d’autorisation définies dans `backend/app/core/permissions.py` sont stables dans `1.x`. De nouvelles clés peuvent être ajoutées ; les clés existantes ne sont ni renommées ni supprimées sans cycle de dépréciation.

L’ensemble des autorisations accordées **par défaut** aux rôles initialisés (`admin`, `bpm_admin`, `member`, `viewer`) peut changer entre versions mineures, avec une mention dans le CHANGELOG. Les responsables ayant personnalisé les autorisations des rôles de leur déploiement ne sont pas concernés.

### Configuration (variables d’environnement)

Les variables d’environnement existantes documentées dans `CLAUDE.md` et `README.md` sont stables dans `1.x`. De nouvelles variables peuvent être ajoutées avec des valeurs par défaut raisonnables. Les valeurs par défaut peuvent changer avec une mention dans le CHANGELOG si cela concerne les responsables (par exemple, un nouveau port par défaut).

### Secrets chiffrés au repos

Le marqueur de préfixe `enc:` et la clé dérivée de Fernet dans `backend/app/core/encryption.py` sont stables dans `1.x`. Les responsables n’ont pas besoin de rechiffrer les secrets lors des mises à niveau mineures.

---

## Cycle de dépréciation

Lorsqu’un élément couvert par cette politique doit être supprimé :

1. **Le déclarer obsolète dans la version mineure N.** L’entrée du CHANGELOG comprend une section `Deprecated` signalant le changement. Pour les points de terminaison API, la route dépréciée émet l’en-tête de réponse `Deprecation: true` (RFC 8594) et un en-tête `Sunset` indiquant la première date de retrait prévue.
2. **Continuer à le prendre en charge dans la version mineure N+1.** Le retrait ne peut pas intervenir dans la même version mineure que la dépréciation. La forme dépréciée reste fonctionnelle.
3. **Retrait au plus tôt dans la version mineure `N+2` ou dans `2.0`** (selon la première échéance). Le retrait s’accompagne d’une section `Removed` dans le CHANGELOG et d’une note de migration.

Pour les changements de forme des données (migrations Alembic), la même cadence `N` → `N+1` s’applique, sous la forme add-new → backfill → drop-old.

---

## Éléments non couverts

Les éléments suivants sont explicitement hors périmètre et peuvent changer à tout moment :

- La **structure interne des modules Python** sous `backend/app/`. Les imports de `app.models`, `app.services`, etc. ne font pas partie de l’API publique. Les extensions ou scripts dépendant d’imports internes doivent figer une version précise de Turbo EA.
- La **structure des blocs JSONB** stockés dans les tables intégrées (`fields_schema`, `section_config`, `attributes`, `lifecycle`), au-delà de ce que lit l’API REST documentée. La forme JSON sur disque peut évoluer pour prendre en charge de nouvelles fonctions.
- Les **éléments internes du frontend** : chemins des fichiers de composants, signatures de props des composants dans `frontend/src/`, contenu de `frontend/src/types/index.ts` et styles des composants MUI. Les responsables utilisant le frontend fourni sont protégés de ces changements ; toute personne intégrant des composants de l’arborescence source assume cette responsabilité.
- Les **personnalisations du métamodèle introduites par le responsable**. Si vous ajoutez un type de fiche ou un champ personnalisé depuis l’interface d’administration, vous êtes responsable de sa migration lorsque vous le modifiez.
- Les **données de démonstration et d’initialisation** (`SEED_DEMO=true`). Le jeu de démonstration peut évoluer librement entre les versions.
- Les **services tiers fournis** : version de DrawIO, image Ollama incluse, version de swagger-ui-dist intégré. Ils peuvent être mis à niveau à tout moment.
- Le **comportement avec des configurations autres que celles par défaut** explicitement signalées comme expérimentales dans les entrées du CHANGELOG.

---

## Ce que « 1.0.0 » change réellement

Par rapport à la série `0.x`, `1.0.0` n’est pas une version fonctionnelle en soi : c’est le point de départ des engagements ci-dessus. Le code livré dans `1.0.0` est le même que celui de `0.71.0`, auquel s’ajoutent le renforcement de la chaîne d’approvisionnement et les changements du processus de contribution décrits dans l’[entrée du CHANGELOG de `1.0.0`](https://github.com/vincentmakes/turbo-ea/blob/main/CHANGELOG.md#100---2026-05-05).

Les versions antérieures à `1.0` n’étaient pas couvertes par cette politique. Les migrations entre versions `0.x` pouvaient inclure, et ont effectivement inclus, des suppressions de schéma, des renommages et des changements incompatibles du métamodèle. À partir de `1.0.0`, ces changements suivent le cycle de dépréciation.
