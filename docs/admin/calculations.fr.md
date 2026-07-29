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

Les formules utilisent un langage d'expression sécurisé et isolé. Vous pouvez référencer les champs de la fiche courante, les fiches liées et enfants, la fiche parente et les dates du cycle de vie.

!!! warning "Utilisez la clé du champ, pas son libellé"
    Les champs sont référencés par leur **clé**, généralement en camelCase (`costTotalAnnual`),
    et non par le libellé affiché sur la fiche (`Coût annuel total`). Un nom qui n'existe pas
    est résolu en `None`, et toute opération arithmétique sur `None` échoue avec une
    **erreur d'évaluation** générique.

    Vous trouverez la clé dans **Admin > Métamodèle >** *(type de fiche)* en ouvrant le champ
    et en lisant sa **Clé**. Plus simple : dans l'éditeur de formules, les puces situées sous
    la zone de saisie listent `data.<clé>` pour chaque champ du type sélectionné, et la saisie
    de `data.` ouvre l'autocomplétion.

### Variables de contexte

| Variable | Description | Exemple |
|----------|-------------|---------|
| `data.<cléDuChamp>` | N'importe quel champ personnalisé de la fiche courante, par sa clé | `data.costTotalAnnual` |
| `data.name`, `data.description`, `data.status`, `data.subtype`, `data.approval_status`, `data.reference` | Propriétés intégrées de la fiche | `data.subtype` |
| `data.lifecycle.<phase>` | Dates du cycle de vie, où la phase vaut `plan`, `phaseIn`, `active`, `phaseOut` ou `endOfLife` | `data.lifecycle.endOfLife` |
| `relations.<cléDuTypeDeRelation>` | Tableau des fiches liées par ce type de relation, dans les deux sens | `relations.relAppToITC` |
| `relation_count.<cléDuTypeDeRelation>` | Nombre de fiches liées par ce type de relation | `relation_count.relAppToITC` |
| `children` | Tableau des fiches enfants directes (types hiérarchiques) | `SUM(PLUCK(children, "attributes.costTotalAnnual"))` |
| `children_count` | Nombre d'enfants directs | `children_count` |
| `parent` | La fiche parente (objet avec `id`, `name`, `type`, `subtype`, `attributes`), ou `None` pour une fiche racine | `IF(parent, parent.attributes.businessCriticality, data.businessCriticality)` |
| `hierarchy_level` | Profondeur de la fiche actuelle dans sa hiérarchie parent-enfant (`1` = racine, non plafonnée). `1` pour les types de fiches non hiérarchiques | `hierarchy_level * 10` |

La clé du type de relation est celle affichée dans **Admin > Métamodèle > Relations**, par
exemple `relAppToITC` ou `relInitiativeToApp`. Le sens n'a pas d'importance : une fiche
retrouve un type de relation sous la même clé qu'elle se trouve à l'extrémité source ou
cible. Les fiches archivées sont exclues de `relations`, `relation_count` et `children`.

### Lire les champs d'une fiche liée

Chaque élément de `relations.<cléDuTypeDeRelation>` et de `children` est un objet
enveloppe, et non directement les champs de la fiche liée :

```json
{
  "id": "8f1c…",
  "name": "NexaCore ERP",
  "type": "Application",
  "attributes":     { "costTotalAnnual": 45000, "businessCriticality": "missionCritical" },
  "rel_attributes": { "costTotalAnnual": 12000 }
}
```

* `attributes` contient les valeurs des champs propres à la fiche liée.
* `rel_attributes` contient les valeurs stockées **sur le lien lui-même**, si le type de
  relation définit un schéma d'attributs. Par exemple, `relAppToITC` porte son propre
  `costTotalAnnual`, ce qui permet d'enregistrer ce qu'une application dépense pour un
  composant IT donné.

C'est important pour `PLUCK` et `FILTER`, qui prennent un chemin de clé et ont donc besoin
du préfixe `attributes.` pour atteindre un champ :

```
# Somme du coût annuel des composants IT utilisés par cette application
SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))

# Somme du coût enregistré sur chaque lien application-composant
SUM(PLUCK(relations.relAppToITC, "rel_attributes.costTotalAnnual"))
```

Extraire une clé nue comme `"costTotalAnnual"` la cherche sur l'objet enveloppe, ne trouve
rien et renvoie une liste de `None`, que `SUM` restitue sous la forme `0`. Une formule sur
les relations qui renvoie obstinément `0` est presque toujours un préfixe `attributes.`
manquant.

### Gérer les valeurs vides

Un champ sans valeur est résolu en `None`, et `None` dans une expression arithmétique
déclenche une erreur. Encadrez avec `COALESCE` chaque champ susceptible d'être vide :

```
COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0) + COALESCE(data.infraCost, 0)
```

`SUM`, `AVG`, `MIN` et `MAX` ignorent déjà les entrées non numériques : elles n'ont pas
besoin de protection.

### Données PPM sur les fiches Initiative

La racine `ppm` expose au moteur de formules les lignes de budget et de coût du module PPM,
ventilées entre capex et opex et réparties par exercice — un détail que les attributs
`data.costBudget` / `data.costActual` consolidés sur la fiche ne peuvent pas donner.

| Variable | Description |
|----------|-------------|
| `ppm.capexBudget`, `ppm.opexBudget`, `ppm.totalBudget` | Budget prévu, d'après les lignes de budget PPM |
| `ppm.capexPlanned`, `ppm.opexPlanned`, `ppm.totalPlanned` | Montants prévus sur les lignes de coût PPM |
| `ppm.capexActual`, `ppm.opexActual`, `ppm.totalActual` | Réalisés sur les lignes de coût PPM |
| `ppm.byYear` | Les mêmes neuf mesures par exercice, sous forme de liste `{year, capexBudget, …}` |
| `ppm.currentFiscalYear` | L'exercice dans lequel tombe la date du jour |
| `ppm.unscheduledPlanned`, `ppm.unscheduledActual` | Lignes de coût sans date : comptées dans les totaux, rattachées à aucun exercice |

`byYear` est une liste et non un objet indexé par année, afin que les fonctions `FILTER` et
`PLUCK` habituelles fonctionnent dessus :

```
# Budget capex total, tous exercices confondus
ppm.capexBudget

# Budget capex du seul exercice en cours
SUM(PLUCK(FILTER(ppm.byYear, "year", ppm.currentFiscalYear), "capexBudget"))

# Budget capex de chaque initiative liée à cette fiche
SUM(PLUCK(relations.relInitiativeToApp, "ppm.capexBudget"))
```

Quelques règles à connaître :

* **Un exercice porte le nom de l'année civile où il se termine.** Avec un début d'exercice en
  octobre, le 15 oct. 2025 relève de l'exercice 2026 et le 30 sept. 2025 de l'exercice 2025.
  Avec le début en janvier par défaut, l'exercice correspond simplement à l'année civile.
* **Les lignes de budget et de coût tirent leur exercice de sources différentes.** Une ligne de
  budget porte l'exercice que vous avez saisi ; celui d'une ligne de coût est déduit de sa
  date. Si votre organisation nomme les exercices d'après leur année de *début*, les deux
  divergeront.
* `total*` est la somme de toutes les lignes, pas `capex + opex`. Une ligne dont la catégorie
  n'est ni l'une ni l'autre (issue d'un import, par exemple) compte quand même dans le total.
* Une fiche qui n'est pas une Initiative lit toutes les mesures `ppm` à `0` avec un `byYear`
  vide : une formule sur le mauvais type de fiche renvoie zéro au lieu d'échouer.

Modifier une ligne de budget ou de coût PPM relance les calculs de l'initiative, si bien que
tout ce qui en dérive est mis à jour immédiatement. Les fiches qui lisent les données PPM d'une
*autre* fiche via une relation ne sont pas rafraîchies.

### Fonctions intégrées

| Fonction | Description | Exemple |
|----------|-------------|---------|
| `IF(condition, valeur_vraie, valeur_fausse)` | Logique conditionnelle. Seule la branche retenue est évaluée | `IF(data.businessCriticality == "missionCritical", 100, 25)` |
| `SUM(tableau)` | Somme des valeurs numériques | `SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `AVG(tableau)` | Moyenne des valeurs numériques | `AVG(PLUCK(children, "attributes.numberOfUsers"))` |
| `MIN(tableau)` | Valeur minimale | `MIN(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `MAX(tableau)` | Valeur maximale | `MAX(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `COUNT(tableau)` | Nombre d'éléments | `COUNT(relations.relAppToInterface)` |
| `ROUND(valeur, decimales)` | Arrondir un nombre | `ROUND(data.costTotalAnnual / 12, 2)` |
| `ABS(valeur)` | Valeur absolue | `ABS(data.budgetVariance)` |
| `LN(valeur)` | Logarithme naturel. Renvoie `None` pour zéro, les valeurs négatives et les entrées non numériques | `LN(data.numberOfUsers)` |
| `COALESCE(a, b, ...)` | Première valeur non nulle | `COALESCE(data.customScore, 0)` |
| `LOWER(texte)` | Texte en minuscules | `LOWER(data.productName)` |
| `UPPER(texte)` | Texte en majuscules | `UPPER(data.subtype)` |
| `CONCAT(a, b, ...)` | Concaténer des chaînes | `CONCAT(data.name, " (", data.subtype, ")")` |
| `CONTAINS(texte, recherche)` | Vérifier si le texte contient une sous-chaîne | `CONTAINS(data.description, "legacy")` |
| `PLUCK(tableau, chemin)` | Extraire un chemin de clé de chaque élément | `PLUCK(relations.relAppToITC, "attributes.costTotalAnnual")` |
| `FILTER(tableau, chemin, valeur)` | Conserver les éléments dont le chemin de clé vaut une valeur donnée | `FILTER(relations.relOrgToApp, "attributes.hostingType", "onPremise")` |
| `MAP_SCORE(valeur, correspondance)` | Associer des valeurs catégorielles à des scores | `MAP_SCORE(data.businessCriticality, {"missionCritical": 3, "businessCritical": 2})` |

Les fonctions Python sûres `len`, `str`, `int`, `float`, `bool`, `abs`, `round`, `min`,
`max` et `sum` sont également disponibles, tout comme les opérateurs et comparaisons usuels.

### Exemples de formules { #example-formulas }

**Somme de plusieurs champs de coût de la même fiche :**
```
COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0) + COALESCE(data.infraCost, 0)
```

**Coût annuel total des composants IT utilisés par une application :**
```
SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))
```

**Score de risque basé sur la criticité :**
```
IF(data.businessCriticality == "missionCritical", 100, IF(data.businessCriticality == "businessCritical", 75, 25))
```

**Nombre d'interfaces liées :**
```
relation_count.relAppToInterface
```

**Nombre d'applications on-premise dans une organisation :**
```
COUNT(FILTER(relations.relOrgToApp, "attributes.hostingType", "onPremise"))
```

**Remonter un coût depuis les fiches enfants :**
```
SUM(PLUCK(children, "attributes.costTotalAnnual"))
```

**Placement TIME Model (Tolerate / Invest / Migrate / Eliminate)**, le même exemple que vous verrez dans le panneau **Formula Reference** dans **Admin → Métamodèle → Calculations** lors de la création d'un nouveau calcul. Type cible = `Application`, champ cible = `timeModel`. Suppose que vous avez ajouté deux champs `single_select` nommés `businessFit` et `technicalFit` avec les options `excellent`, `adequate`, `insufficient`, `unreasonable` :
```
# ── TIME Model (Tolerate / Invest / Migrate / Eliminate) ──
# Assumes single_select fields: businessFit and technicalFit
# with options: excellent, adequate, insufficient, unreasonable.
#
# Scoring: Map each dimension to 1-4 numeric scale.
# Business Fit  = Y-axis (how well does it serve the business?)
# Technical Fit = X-axis (how healthy is the technology?)
#
# Quadrant logic (threshold at score 2.5):
#   Invest    = high business + high technical
#   Migrate   = high business + low technical
#   Tolerate  = low business  + high technical
#   Eliminate = low business  + low technical
#
bf = MAP_SCORE(data.businessFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
tf = MAP_SCORE(data.technicalFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
IF(bf is None or tf is None, None, IF(bf >= 2.5, IF(tf >= 2.5, "invest", "migrate"), IF(tf >= 2.5, "tolerate", "eliminate")))
```

Comme le montre cet exemple, une formule peut s'étendre sur plusieurs lignes. Une ligne de
la forme `nom = expression` stocke une valeur intermédiaire réutilisable par les lignes
suivantes, et c'est la valeur de la dernière ligne qui est écrite dans le champ cible.

C'est aussi l'exemple opérationnel référencé par le [Guide du débutant EA](../beginners-guide/customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation).

**Les commentaires** sont pris en charge avec `#` :
```
# Calculer le score de risque pondéré
IF(data.businessCriticality == "missionCritical", data.riskScore * 2, data.riskScore)
```

## Valider et tester

L'éditeur de formules propose deux vérifications distinctes, au comportement différent :

* **Valider** exécute la formule sur une fiche synthétique. Chaque champ numérique reçoit la
  valeur fictive `1`, et la fiche n'a **ni relations, ni enfants, ni données propres de
  parent**. Cela confirme que la syntaxe est correcte et que les noms utilisés existent, mais
  une formule qui agrège `relations` ou `children` affichera toujours `0` ou un résultat vide
  à cet endroit. C'est normal et ne signale pas une formule défectueuse.
* **Tester**, disponible sur un calcul enregistré, s'exécute sur une fiche réelle de votre
  choix. C'est l'option à utiliser dès qu'il est question de relations, d'enfants ou de la
  fiche parente. Rien n'est écrit sur la fiche, le résultat vous est seulement affiché.

## Lire les résultats d'une exécution manuelle

Exécuter un calcul depuis la liste l'évalue pour toutes les fiches du type cible et rend compte
de ce qui s'est passé, pas seulement du nombre de fiches traitées. **Voir le détail** dans le
bandeau de résultat ouvre la ventilation :

* **Un bloc par calcul**, avec le nombre de fiches calculées sans erreur et le nombre en échec.
  Tous les calculs actifs du type s'exécutent ensemble : c'est donc ce qui indique lequel est en
  cause.
* **Une ligne par erreur distincte**, avec le nombre de fiches concernées. Une formule fausse
  l'est de la même façon partout ; vingt et un échecs correspondent donc généralement à une
  seule correction, pas à vingt et une.
* **Les fiches elles-mêmes**, listées sous chaque erreur et cliquables, pour ouvrir l'une
  d'elles et examiner les données en cause. Dix au maximum sont listées par erreur ; au-delà, le
  reste est indiqué sous forme de nombre.

**Copier le rapport** place l'ensemble de la ventilation dans le presse-papiers, en texte brut.

La pastille de statut dans la liste des calculs reflète la même exécution : rouge dès qu'une
fiche a échoué, verte seulement si toutes ont été calculées.

## Quand les calculs s'exécutent

Les calculs d'une fiche sont réévalués lorsque :

* la fiche est créée ou sauvegardée ;
* une relation touchant la fiche est créée, modifiée ou supprimée (les deux extrémités de la
  relation sont recalculées) ;
* la fiche change de parent, ce qui recalcule tout son sous-arbre ;
* vous exécutez le calcul manuellement depuis la liste, ce qui l'évalue pour toutes les
  fiches du type cible et sauvegarde les résultats.

Ils ne sont **pas** réévalués lorsqu'une autre fiche lue par la formule est modifiée. Si vous
changez un coût sur un composant IT, une application qui l'agrège ne bougera pas tant que
cette application n'est pas sauvegardée, qu'une de ses relations ne change pas, ou que le
calcul n'est pas exécuté pour le type. Pour les agrégats portant sur des données maintenues
par d'autres, exécutez le calcul périodiquement ou après un import en masse.

!!! note "Remarque"
    Il en va de même pour les valeurs dérivées de `parent` et de `hierarchy_level` : elles
    sont actualisées lors d'un changement de parent et lors d'une exécution manuelle, pas à
    chaque modification de la fiche parente. Protégez toujours une référence à `parent` avec
    `IF(parent, …)` afin que les fiches racines, où `parent` vaut `None`, ne génèrent pas
    d'erreur.

## Ordre d'exécution

Lorsque plusieurs calculs ciblent le même type de fiche, ils s'exécutent dans l'ordre spécifié par leur valeur d'**ordre d'exécution**. C'est important lorsqu'un calcul dépend du résultat d'un autre : définissez la dépendance pour qu'elle s'exécute en premier (numéro inférieur).

Turbo EA refuse un ensemble de calculs qui formerait un cycle, par exemple un champ A calculé à partir d'un champ B alors que B est calculé à partir de A.
