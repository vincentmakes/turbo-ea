# Calculs

La fonctionnalité **Calculs** (**Admin > Métamodèle > onglet Calculs**) vous permet de définir des **formules qui calculent automatiquement des valeurs de champs** lorsque les fiches sont sauvegardées. C'est un outil puissant pour dériver des métriques, des scores et des agrégations à partir de vos données d'architecture.

## Comment ça marche

1. Un administrateur définit une formule ciblant un type de fiche et un champ spécifiques
2. Lorsqu'une fiche de ce type est créée ou mise à jour, la formule s'exécute automatiquement
3. Le résultat est écrit dans le champ cible
4. Le champ cible est marqué en **lecture seule** sur la page de détail de la fiche (les utilisateurs voient un badge « calculé »)

## Création d'un calcul

Cliquez sur **+ Nouveau calcul** et configurez :

| Champ | Description |
|-------|-------------|
| **Nom** | Nom descriptif du calcul |
| **Type cible** | Le type de fiche auquel ce calcul s'applique |
| **Champ cible** | Le champ où le résultat est stocké |
| **Formule** | L'expression à évaluer (voir la syntaxe ci-dessous) |
| **Ordre d'exécution** | Ordre d'exécution lorsque plusieurs calculs existent pour le même type (le plus petit s'exécute en premier) |
| **Actif** | Activer ou désactiver le calcul |

## Syntaxe des formules

Les formules utilisent un langage d'expression sécurisé et isolé. Vous pouvez référencer les attributs de la fiche, les données des fiches liées et les informations du cycle de vie.

### Variables de contexte

| Variable | Description | Exemple |
|----------|-------------|---------|
| `fieldKey` | N'importe quel attribut de la fiche courante | `businessCriticality` |
| `related_{type_key}` | Tableau de fiches liées d'un type donné | `related_applications` |
| `lifecycle_plan`, `lifecycle_active`, etc. | Valeurs de dates du cycle de vie | `lifecycle_endOfLife` |

### Fonctions intégrées

| Fonction | Description | Exemple |
|----------|-------------|---------|
| `IF(condition, valeur_vraie, valeur_fausse)` | Logique conditionnelle | `IF(riskLevel == "critical", 100, 25)` |
| `SUM(tableau)` | Somme des valeurs numériques | `SUM(PLUCK(related_applications, "costTotalAnnual"))` |
| `AVG(tableau)` | Moyenne des valeurs numériques | `AVG(PLUCK(related_applications, "dataQuality"))` |
| `MIN(tableau)` | Valeur minimale | `MIN(PLUCK(related_itcomponents, "riskScore"))` |
| `MAX(tableau)` | Valeur maximale | `MAX(PLUCK(related_itcomponents, "costAnnual"))` |
| `COUNT(tableau)` | Nombre d'éléments | `COUNT(related_interfaces)` |
| `ROUND(valeur, decimales)` | Arrondir un nombre | `ROUND(avgCost, 2)` |
| `ABS(valeur)` | Valeur absolue | `ABS(delta)` |
| `COALESCE(a, b, ...)` | Première valeur non nulle | `COALESCE(customScore, 0)` |
| `LOWER(texte)` | Texte en minuscules | `LOWER(status)` |
| `UPPER(texte)` | Texte en majuscules | `UPPER(category)` |
| `CONCAT(a, b, ...)` | Concaténer des chaînes | `CONCAT(firstName, " ", lastName)` |
| `CONTAINS(texte, recherche)` | Vérifier si le texte contient une sous-chaîne | `CONTAINS(description, "legacy")` |
| `PLUCK(tableau, cle)` | Extraire un champ de chaque élément | `PLUCK(related_applications, "name")` |
| `FILTER(tableau, cle, valeur)` | Filtrer les éléments par valeur de champ | `FILTER(related_interfaces, "status", "ACTIVE")` |
| `MAP_SCORE(valeur, correspondance)` | Associer des valeurs catégorielles à des scores | `MAP_SCORE(criticality, {"high": 3, "medium": 2, "low": 1})` |

### Exemples de formules

**Coût annuel total des applications liées :**
```
SUM(PLUCK(related_applications, "costTotalAnnual"))
```

**Score de risque basé sur la criticité :**
```
IF(riskLevel == "critical", 100, IF(riskLevel == "high", 75, IF(riskLevel == "medium", 50, 25)))
```

**Nombre d'interfaces actives :**
```
COUNT(FILTER(related_interfaces, "status", "ACTIVE"))
```

**Les commentaires** sont pris en charge avec `#` :
```
# Calculer le score de risque pondéré
IF(businessCriticality == "missionCritical", riskScore * 2, riskScore)
```

## Exécution des calculs

Les calculs s'exécutent automatiquement lorsqu'une fiche est sauvegardée. Vous pouvez également déclencher manuellement un calcul pour l'exécuter sur toutes les fiches du type cible :

1. Trouvez le calcul dans la liste
2. Cliquez sur le bouton **Exécuter**
3. La formule est évaluée pour chaque fiche correspondante et les résultats sont sauvegardés

## Ordre d'exécution

Lorsque plusieurs calculs ciblent le même type de fiche, ils s'exécutent dans l'ordre spécifié par leur valeur d'**ordre d'exécution**. C'est important lorsqu'un calcul dépend du résultat d'un autre -- définissez la dépendance pour qu'elle s'exécute en premier (numéro inférieur).
