# Tags

La fonctionnalité **Tags** (**Admin > Métamodèle > onglet Tags**) vous permet de créer des étiquettes de classification que les utilisateurs peuvent appliquer aux fiches. Les tags sont organisés en **groupes de tags**, chacun avec son propre mode de sélection, ses restrictions de type et un indicateur optionnel d'obligation qui s'intègre au workflow d'approbation et au score de qualité des données.

## Groupes de tags

Un groupe de tags est une catégorie de tags. Par exemple, vous pouvez créer des groupes comme « Domaine Métier », « Cadre de Conformité » ou « Propriété par Équipe ».

### Créer un groupe de tags

Cliquez sur **+ Nouveau groupe de tags** et configurez :

| Champ | Description |
|-------|-------------|
| **Nom** | Nom affiché sur le détail de la fiche, les filtres d'inventaire et les rapports. |
| **Description** | Texte libre optionnel, visible uniquement par les administrateurs. |
| **Mode** | **Sélection unique** — un tag par fiche. **Sélection multiple** — plusieurs tags par fiche. |
| **Obligatoire** | Lorsqu'il est coché, le groupe participe à la barrière d'approbation et au score de qualité de chaque type de fiche auquel il s'applique. Voir [Groupes de tags obligatoires](#groupes-de-tags-obligatoires) ci-dessous. |
| **Restreindre aux types** | Liste facultative de types de fiches autorisés. Vide signifie que le groupe est disponible pour tous les types ; sinon, seuls les types listés voient le groupe dans le détail, les filtres et les portails. |

### Gérer les tags

Dans chaque groupe, vous pouvez ajouter des tags individuels :

1. Cliquez sur **+ Ajouter un tag** dans un groupe de tags.
2. Saisissez le **nom** du tag.
3. Définissez éventuellement une **couleur** pour la distinction visuelle — la couleur détermine le fond du chip sur le détail de fiche, l'inventaire, les rapports et les portails web.

Les tags apparaissent sur les pages de détail des fiches dans la section **Tags**, où les utilisateurs autorisés peuvent les appliquer ou les retirer.

## Restrictions de type

Définir **Restreindre aux types** sur un groupe de tags limite sa portée partout en même temps :

- **Détail de la fiche** — le groupe et ses tags ne s'affichent que sur les types de fiches correspondants.
- **Barre latérale de filtres d'inventaire** — le chip du groupe n'apparaît dans le `TagPicker` que lorsque la vue d'inventaire est filtrée sur un type correspondant.
- **Portails web** — le groupe n'est proposé aux lecteurs du portail que lorsque celui-ci présente un type correspondant.
- **Rapports** — les listes déroulantes de regroupement / filtre n'incluent le groupe que pour les types correspondants.

L'interface d'administration affiche les types ciblés sous forme de petits chips sur chaque groupe de tags, pour voir la portée d'un coup d'œil.

## Groupes de tags obligatoires

Marquer un groupe de tags comme **Obligatoire** en fait une exigence de gouvernance : chaque fiche à laquelle le groupe s'applique doit porter au moins un tag du groupe.

### Barrière d'approbation

Une fiche ne peut pas passer à **Approuvée** tant qu'un groupe de tags obligatoire applicable n'est pas satisfait. Tenter d'approuver renvoie l'erreur `approval_blocked_mandatory_missing` et la page de détail liste les groupes manquants. Deux précautions rendent la barrière sûre :

- Un groupe ne s'applique à une fiche que si sa liste **Restreindre aux types** est vide ou inclut le type de la fiche.
- Un groupe obligatoire qui **n'a pas encore de tags configurés** est silencieusement ignoré — cela évite une barrière d'approbation inaccessible à cause d'une configuration d'administrateur incomplète.

Une fois les tags requis ajoutés, la fiche peut être approuvée normalement.

### Contribution à la qualité des données

Les groupes obligatoires applicables alimentent également le score de qualité des données de la fiche. Chaque groupe satisfait augmente le score aux côtés des autres éléments obligatoires (champs requis, côtés de relation obligatoires) qui composent le calcul de complétude.

### Indicateurs visuels

Les groupes obligatoires portent un chip **Obligatoire** dans la liste d'administration et dans la section Tags du détail de la fiche. Les tags obligatoires manquants apparaissent dans la bannière d'état d'approbation et dans l'info-bulle de l'anneau de qualité des données, pour que les utilisateurs sachent exactement quoi ajouter.

## Permissions

| Permission | Ce qu'elle autorise |
|------------|---------------------|
| `tags.manage` | Créer, modifier et supprimer des groupes et des tags dans l'interface d'administration, et appliquer/retirer des tags sur n'importe quelle fiche, indépendamment des autres permissions. |
| `inventory.edit` + `card.edit` | Appliquer ou retirer des tags sur les fiches que l'utilisateur peut modifier (via son rôle d'application ou un rôle de partie prenante sur cette fiche). |

`tags.manage` est attribué par défaut au rôle admin. `inventory.edit` appartient à admin, bpm_admin et member ; `card.edit` est accordé par les affectations de rôle de partie prenante sur la fiche concernée.

Les lecteurs (viewers) **voient** les tags mais ne peuvent pas les modifier.

## Où les tags apparaissent

- **Détail de la fiche** — la section Tags liste les groupes applicables et les tags actuellement attachés. Les groupes obligatoires affichent un chip ; les groupes restreints n'apparaissent que lorsque le type de la fiche correspond.
- **Barre latérale de filtres d'inventaire** — un `TagPicker` groupé permet de filtrer la grille d'inventaire par un ou plusieurs tags. Les groupes et tags sont filtrés selon la portée du type courant.
- **Rapports** — le découpage par tags est disponible dans les rapports de portefeuille, de matrice et dans d'autres rapports qui prennent en charge des dimensions de regroupement / filtre.
- **Portails web** — les éditeurs de portails peuvent exposer des filtres basés sur les tags aux lecteurs anonymes, pour que les consommateurs externes découpent les paysages publics de la même façon.
- **Dialogues de création / édition** — le même `TagPicker` apparaît lors de la création d'une nouvelle fiche, afin que les tags requis puissent être définis dès le départ — particulièrement utile pour les groupes obligatoires.
