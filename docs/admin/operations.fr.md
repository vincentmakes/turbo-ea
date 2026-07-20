# Exploitation et mises à niveau

Cette page est le guide de l'opérateur pour exploiter Turbo EA en production : comment fonctionnent les mises à niveau et les migrations de base de données, comment sauvegarder et revenir en arrière, quels environnements mettre en place, et les pièges qui guettent les équipes à grande échelle.

## Images de production et épinglage de version

Les images publiées sur `ghcr.io/vincentmakes/turbo-ea/*` sont la manière recommandée d'exploiter la production — le `docker-compose.yml` fourni les récupère par défaut, et la compilation depuis les sources relève du développement. Au-delà de la commodité, les images publiées offrent des garanties de chaîne d'approvisionnement qu'une compilation locale n'a pas : chaque publication est multi-architecture (amd64 + arm64), signée avec cosign (OIDC sans clé, vérifiable par rapport à l'identité du workflow GitHub Actions) et attestée avec une provenance SLSA et un SBOM. Les images sont bloquées à la publication en cas de CVE critique, re-scannées quotidiennement une fois en ligne, et reconstruites chaque semaine contre des dépôts Alpine à jour, de sorte que les correctifs des images de base arrivent automatiquement. Si votre organisation impose la vérification des signatures d'images à l'admission, les signatures cosign s'y intègrent directement — voir [Chaîne d'approvisionnement](supply-chain.md) pour les commandes de vérification.

L'habitude la plus importante : **épinglez votre version**. Le tag `:latest` est repositionné lors des versions publiées et de la reconstruction hebdomadaire — pas à chaque commit — et peut donc évoluer selon un calendrier que vous ne contrôlez pas. Définissez un tag explicite dans votre `.env` :

```bash
TURBO_EA_TAG=2.23.1
```

Voir [Épingler une version](../getting-started/setup.md) pour les bases et [Versions](../reference/releases.md) pour l'arborescence complète des tags et la politique des canaux de préversion.

## Comment fonctionnent les mises à niveau : les migrations Alembic

La compatibilité du schéma de base de données est gérée automatiquement via [Alembic](https://alembic.sqlalchemy.org/). Au démarrage, le backend exécute `alembic upgrade head` : chaque migration en attente entre votre schéma actuel et la nouvelle version est appliquée — dans l'ordre — avant que l'application ne serve du trafic.

Les migrations sont numérotées séquentiellement et cumulatives, ce qui rend les sauts de version sûrs : si vous passez, par exemple, de 2.10 à 2.23, toutes les migrations intermédiaires s'exécutent dans l'ordre. Il n'est pas nécessaire de passer par chaque version mineure.

Quelques comportements à connaître :

| Situation | Ce qui se passe au démarrage |
|---|---|
| Base de données neuve | Les tables sont créées directement et la base est estampillée à head — aucun rejeu de migrations. |
| Base de données existante | Les migrations en attente s'exécutent automatiquement avant que l'API ne soit disponible. |
| `RESET_DB=true` | Toutes les tables sont supprimées, recréées et réensemencées. À ne jamais activer en production. |

Au sein d'une même ligne de version majeure, les migrations restent additives et rétrocompatibles à la mise à niveau — voir la [Politique de compatibilité](../reference/compatibility.md) pour le contrat complet.

!!! warning "Ne jamais exécuter un backend plus ancien sur un schéma plus récent"
    Alembic ne migre que vers l'avant au démarrage. Un code ancien face à un schéma plus récent est un comportement indéfini — c'est la contrainte clé du retour en arrière (voir ci-dessous).

## La procédure de mise à niveau

1. **Lisez le changelog.** Passez en revue les entrées de `CHANGELOG.md` entre votre version actuelle et la cible. Les changements incompatibles augmentent la version majeure.
2. **Sauvegardez** la base de données et le volume de données (voir ci-dessous).
3. **Montez le tag et récupérez les images :**

    ```bash
    TURBO_EA_TAG=2.24.0 docker compose pull
    docker compose up -d
    ```

4. **Surveillez les journaux de démarrage** et confirmez que les migrations se terminent proprement avant que l'API ne serve du trafic :

    ```bash
    docker compose logs -f backend
    ```

!!! note "Fenêtres de maintenance"
    Les migrations sont généralement rapides, mais sur de grands inventaires certaines migrations de données peuvent prendre quelques minutes, pendant lesquelles le backend ne répond pas. Planifiez les mises à niveau dans une fenêtre de maintenance.

## Sauvegardes

Effectuez une sauvegarde **avant chaque mise à niveau**, et automatisez-en une chaque nuit dans tous les cas :

```bash
docker compose exec db pg_dump -U turboea turboea > backup-$(date +%F).sql
```

Ajustez l'utilisateur et le nom de la base si vous avez modifié `POSTGRES_USER` / `POSTGRES_DB`. Un instantané du volume `postgres_data` est une alternative équivalente.

Sauvegardez également le volume **`backend_data`** — il contient les pièces jointes, les extensions installées et les bundles de transfert d'espace de travail qui ne résident pas dans PostgreSQL.

Deux points supplémentaires sur la posture de reprise :

- **Testez vos restaurations périodiquement.** Une sauvegarde jamais restaurée est un espoir, pas un plan.
- **Les cartes archivées sont supprimées de manière réversible** avec une fenêtre de 30 jours avant la purge définitive — c'est votre filet de sécurité pour les erreurs de données, distinct de la reprise d'infrastructure.

## Retour en arrière et reprise

Les migrations de schéma sont effectivement **à sens unique en production** : Alembic prend certes en charge les rétrogradations, mais les migrations portant des données ne peuvent pas toujours être inversées sans perte, et l'application n'exécute jamais de rétrogradation automatiquement. La stratégie de retour en arrière fiable est la suivante :

1. Arrêtez la pile.
2. Restaurez la sauvegarde de base de données prise avant la mise à niveau.
3. Remettez `TURBO_EA_TAG` sur la version précédente.
4. `docker compose up -d` — la base restaurée correspond au schéma de l'ancien code, tout est cohérent.

!!! warning "Ne jamais revenir en arrière sur l'image seule"
    Revenir à l'image précédente tout en gardant la base de données migrée est la seule combinaison contre laquelle le système de migration automatique ne peut pas vous protéger. La sauvegarde de la base et le tag de l'image évoluent ensemble.

## Environnements et gouvernance des versions

Pour la plupart des organisations, **deux environnements** (Staging + Production) suffisent, car les mises à niveau sont des images publiées par l'éditeur, pas des builds personnalisés — vous validez, vous ne développez pas. Une chaîne complète Dev/SIT/UAT/Prod n'apporte de la valeur que si vous construisez des extensions personnalisées ou des intégrations lourdes.

| Environnement | Rôle | Remarques |
|---|---|---|
| Dev / bac à sable (optionnel) | Essayer des changements de métamodèle, démos | `SEED_DEMO=true` pour le jeu de données de démonstration ; `RESET_DB=true` repart de zéro. |
| Staging | Valider les nouvelles versions en premier | Données proches de la production ; reçoit les nouveaux tags en premier. |
| Production | Tag épinglé, sauvegardes, mises à niveau en fenêtre de maintenance | Jamais `latest`, jamais `RESET_DB`. |

Deux bonnes façons d'amener des données réalistes en staging :

- **[Transfert d'espace de travail](workspace-transfer.md)** : exportez l'espace de travail de production sous forme de bundle `.zip` et importez-le en staging. Les secrets (identifiants SMTP, SSO, IA, ServiceNow) sont retirés par conception et ne quittent jamais l'instance.
- **Restauration de base de données** : restaurez un `pg_dump` de production dans la base de staging. Les secrets chiffrés en base sont dérivés de `SECRET_KEY` ; le staging a donc besoin du même `SECRET_KEY`, sinon vous y ressaisissez les identifiants d'intégration.

Côté gouvernance :

- Traitez le fichier `.env` et le `TURBO_EA_TAG` épinglé comme de la configuration-as-code — conservez-les dans votre Git interne et faites des mises à niveau un changement revu (une pull request qui monte le tag).
- Comme le staging et la production tirent le même tag GHCR épinglé, vous validez l'artefact identique au bit près que vous allez promouvoir.
- Mettre à niveau le staging → laisser reposer quelques jours → promouvoir le même tag en production.

## Pièges courants

1. **Exploiter `latest` sans épinglage** — un `docker compose pull` de routine devient une mise à niveau imprévue avec des migrations imprévues, au rythme des publications plutôt qu'au vôtre.
2. **Mettre à niveau sans sauvegarde** — les migrations sont à sens unique ; la sauvegarde *est* votre retour en arrière.
3. **Perdre ou changer `SECRET_KEY`** — il signe les JWT *et* dérive la clé de chiffrement des secrets stockés (identifiants SMTP, SSO, ServiceNow). Le changer rend les secrets stockés indéchiffrables. Traitez-le comme un identifiant de base de données : dans un coffre, stable, sauvegardé.
4. **`RESET_DB=true` oublié dans un fichier d'environnement** — il fait exactement ce qu'il dit, à chaque démarrage.
5. **Modifier la base de données directement** — l'état du schéma appartient à Alembic, et du DDL manuel entrera en collision avec les migrations futures. Idem pour les données : passez par l'API ou l'interface afin que les permissions, les événements d'audit et le recalcul de la qualité des données restent corrects.
6. **Ne pas persister les volumes** — `postgres_data` et `backend_data` doivent survivre à la recréation des conteneurs ; vérifiez que vos outils d'instantané et de sauvegarde couvrent les deux.
7. **Revenir en arrière sur l'image sans restaurer la base** — voir [Retour en arrière et reprise](#retour-en-arriere-et-reprise).
