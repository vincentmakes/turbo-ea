# Diagrammes ArchiMate

L'éditeur **ArchiMate** dessine des diagrammes [ArchiMate 3](https://pubs.opengroup.org/architecture/archimate3-doc/) au-dessus de vos fiches : vous placez des éléments de la notation standard (Business Process, Application Component, Node, etc.), vous les reliez par les relations que le langage autorise et, si vous le souhaitez, vous liez chaque élément à une fiche de votre inventaire. Un diagramme est stocké sous la forme d'un **ArchiMate Model Exchange File** (le format XML de The Open Group, version 3.1) ; il peut donc être échangé avec d'autres outils ArchiMate.

!!! warning "État de la version"
    Cette version livre les fondations d'ArchiMate sous la forme d'un **bac à sable pour les administrateurs**. Le module est désactivé par défaut, les diagrammes ne figurent pas dans le menu [Diagrammes](diagrams.md) et ne peuvent pas encore être publiés ni intégrés. Voir les [Limites connues](#known-limits).

La première ligne affiche le nom du diagramme, les réglages de couleur et de contenu des fiches et la synchronisation. La synchronisation actualise les données des fiches liées. La deuxième ligne contient les outils de dessin, le zoom, l’export SVG et le panneau de propriétés. Utilisez **Grille de points** pour afficher ou masquer les points du fond. Le navigateur mémorise votre choix pour chaque diagramme.

## Activer le module

1. Ouvrez **Admin → Paramètres** et repérez la carte **Diagrammes ArchiMate** (à côté des autres interrupteurs de modules).
2. Activez-la. La carte affiche **ArchiMate est activé**.
3. Vous pouvez la désactiver à tout moment. Les diagrammes sont conservés ; tant que le module est désactivé, les pages sont inaccessibles et toute personne qui suit un lien direct voit l'espace réservé standard « module désactivé ».

## Ouvrir le bac à sable

Tant que le module est activé, les diagrammes ArchiMate se créent et s'ouvrent depuis la page **Diagrammes** et depuis l'onglet **Ressources** de toute fiche qu'ils référencent. `/admin/architectureStudio` reste la liste de vos diagrammes ArchiMate, où vous pouvez les créer, les ouvrir et les supprimer ; il faut une permission sur au moins une couche ArchiMate et le module activé. Dans l'éditeur, **Retour** ramène à la page d'où vous venez.

<!-- Planned screenshot (added with the screenshot capture): 102_archimate_sandbox -->

## Votre premier diagramme

1. Dans le bac à sable, saisissez un **Nom** sous **Nouveau diagramme ArchiMate** et appuyez sur **Créer**. L'éditeur s'ouvre.
2. **Déposez des éléments.** La palette liste les types d'éléments regroupés par couche (Stratégie, Métier, Application, Technologie, Physique, Motivation, Mise en œuvre et migration, Autre). Faites glisser une entrée sur le canevas, ou utilisez le clavier : placez-vous sur une entrée et appuyez sur **Enter** ou **Space** pour déposer l'élément au centre de la zone visible. Un nouvel élément ouvre aussitôt son nom en modification.
3. **Tracez une relation.** Sélectionnez un élément : le panneau contextuel qui l'entoure propose des entrées **Tracer** *relation*. Choisissez-en une, puis cliquez sur l'élément cible. Seules les paires que la table des relations ArchiMate autorise peuvent être reliées : une entrée n'est proposée que si le langage admet cette relation depuis cet élément vers au moins un type d'élément, et une cible que la table n'autorise pas est refusée. Sélectionnez une connexion pour changer son **type d'accès** (pour Access) ou son orientation (pour Association).
4. **Liez un élément à une fiche.** Sélectionnez l'élément et utilisez le panneau contextuel :
    - **Lier à une fiche** ouvre un sélecteur limité aux types de fiche qui correspondent à ce type d'élément (voir [La correspondance](#mapping)).
    - **Créer une fiche** demande un type de fiche et un nom, crée la fiche et la lie en une seule étape.
    - **Ouvrir la fiche liée** et **Délier la fiche** apparaissent dès qu'une fiche est liée.

    Les liens sont toujours explicites. Déposer un élément ne crée **jamais** de fiche, et retirer un élément du diagramme (**Retirer du diagramme**) ne supprime **jamais** une fiche. À l'enregistrement, l'ensemble des fiches auxquelles le diagramme est lié est synchronisé, comme pour les autres diagrammes.
5. **Enregistrez.** L'éditeur enregistre de lui-même trois secondes après votre dernière modification ; le bouton **Enregistrer** enregistre immédiatement. L'état affiche *Enregistrement…*, *Enregistré* ou *Modifications non enregistrées*.

!!! warning "Un enregistrement échoué reste affiché"
    Si un enregistrement échoue, l'erreur reste affichée avec un bouton **Réessayer**, le diagramme reste marqué comme non enregistré et rien n'est abandonné en silence. Quitter la page (fermer l'onglet, utiliser le bouton Précédent du navigateur ou ouvrir une autre page de l'application) alors que des modifications ne sont pas enregistrées, ou que leur enregistrement a échoué, demande d'abord une confirmation.

## La correspondance {#mapping}

La **correspondance** (mapping) indique à quel concept ArchiMate correspond un type de fiche, un sous-type ou un type de relation de Turbo EA. L'éditeur la lit pour décider quelles fiches peuvent être liées à quel élément. Chaque type de fiche, sous-type et type de relation porte un type d'élément ou de relation ArchiMate ; une relation porte en outre un **indicateur de sens** (lorsqu'il est activé, la relation ArchiMate est tracée de la fiche cible vers la fiche source ; par exemple « Organisation *utilise* Application » est une relation ArchiMate *Serving* de l'application vers l'organisation) et, pour Access, un **type d'accès**.

!!! note
    Dans cette version, la correspondance est **en lecture seule** : elle contient les valeurs par défaut ci-dessous. L'écran d'administration permettant de la modifier (**ARCHI MAP** dans **Admin → Métamodèle**) sera livré plus tard. Cette version ne crée ni ne modifie de relations entre fiches à partir d'une relation tracée.

Les noms d'éléments et de relations sont ceux du format d'échange de The Open Group. Un type de fiche dont l'élément est vide (`—`) n'a pas de correspondance par défaut ; ses fiches ne peuvent donc pas être liées tant qu'un type d'élément n'est pas défini. Un sous-type utilise sa propre correspondance s'il en a une, sinon celle du type de fiche.

### Types de fiche et sous-types

| Type de fiche | Élément ArchiMate |
|---|---|
| Objectif | `Goal` |
| Objectif › Objectif métier | `Goal` |
| Objectif › Jalon de valeur | `Assessment` |
| Plateforme | `Grouping` |
| Initiative | `WorkPackage` |
| Organisation | `BusinessActor` |
| Organisation › Région | `Location` |
| Capacité métier | `Capability` |
| Contexte métier | — |
| Contexte métier › Processus | `BusinessProcess` |
| Contexte métier › Chaîne de valeur | `ValueStream` |
| Contexte métier › Parcours client | `BusinessProcess` |
| Contexte métier › Produit métier | `Product` |
| Contexte métier › Capacité ESG | `Capability` |
| Processus métier | `BusinessProcess` |
| Processus métier › Catégorie de processus | `BusinessFunction` |
| Processus métier › Groupe de processus | `BusinessFunction` |
| Application | `ApplicationComponent` |
| Interface | `ApplicationInterface` |
| Objet de données | `BusinessObject` |
| Composant IT | `Node` |
| Composant IT › Logiciel | `SystemSoftware` |
| Composant IT › Matériel | `Device` |
| Composant IT › SaaS | `TechnologyService` |
| Composant IT › PaaS | `TechnologyService` |
| Composant IT › IaaS | `TechnologyService` |
| Composant IT › Service | `TechnologyService` |
| Composant IT › Modèle IA | `SystemSoftware` |
| Catégorie technologique | `Grouping` |
| Fournisseur | `BusinessActor` |

### Types de relation

Pour une relation Access, `crud` signifie que le type d'accès suit les indicateurs Create/Read/Update/Delete de la relation elle-même : la lecture seule donne Read, toute création, mise à jour ou suppression donne Write, les deux donnent Read/Write et aucune donne Access simple. Les relations « succède à » existent pour chaque type de fiche qui en possède et correspondent à Association, sauf celle de Business Context, qui a sa propre ligne dans le tableau.

| Relation | Relation ArchiMate | Remarque |
|---|---|---|
| Objectif → Capacité métier, *améliore* | `Association` | — |
| Plateforme → Objectif, *prend en charge* | `Influence` | — |
| Plateforme → Application, *exécute* | `Aggregation` | — |
| Plateforme → Composant IT, *implémente* | `Aggregation` | — |
| Initiative → Objectif, *prend en charge* | `Influence` | — |
| Initiative → Plateforme, *affecte* | `Association` | — |
| Initiative → Capacité métier, *améliore* | `Association` | — |
| Initiative → Application, *affecte* | `Association` | — |
| Initiative → Interface, *affecte* | `Association` | — |
| Initiative → Objet de données, *affecte* | `Association` | — |
| Initiative → Composant IT, *affecte* | `Association` | — |
| Organisation → Objectif, *possède* | `Association` | — |
| Organisation → Initiative, *possède* | `Assignment` | — |
| Organisation → Contexte métier, *possède* | `Association` | — |
| Organisation → Application, *utilise* | `Serving` | dessinée de la cible vers la source |
| Organisation → Composant IT, *possède* | `Association` | — |
| Application → Capacité métier, *prend en charge* | `Realization` | — |
| Application → Contexte métier, *prend en charge* | `Association` | — |
| Application → Interface, *fournit / consomme* | `Association` | — |
| Application → Objet de données, *CRUD* | `Access` | type d'accès tiré des indicateurs CRUD |
| Application → Composant IT, *utilise* | `Serving` | dessinée de la cible vers la source |
| Composant IT → Catégorie technologique, *appartient à* | `Aggregation` | dessinée de la cible vers la source |
| Composant IT → Plateforme, *implémente* | `Aggregation` | dessinée de la cible vers la source |
| Interface → Objet de données, *transfère* | `Association` | — |
| Interface → Composant IT, *utilise* | `Association` | — |
| Fournisseur → Initiative, *prend en charge* | `Association` | — |
| Fournisseur → Application, *propose* | `Association` | — |
| Fournisseur → Composant IT, *propose* | `Association` | — |
| Contexte métier → Capacité métier, *est associé à* | `Association` | — |
| Processus métier → Capacité métier, *prend en charge* | `Realization` | — |
| Processus métier → Application, *est pris en charge par* | `Serving` | dessinée de la cible vers la source |
| Processus métier → Objet de données, *utilise* | `Access` | type d'accès tiré des indicateurs CRUD |
| Processus métier → Composant IT, *utilise* | `Serving` | dessinée de la cible vers la source |
| Processus métier → Processus métier, *dépend de* | `Association` | — |
| Processus métier → Processus métier, *appelle* | `Triggering` | — |
| Processus métier → Organisation, *appartient à* | `Assignment` | dessinée de la cible vers la source |
| Processus métier → Initiative, *est affecté par* | `Association` | — |
| Processus métier → Objectif, *prend en charge* | `Influence` | — |
| Processus métier → Contexte métier, *réalise* | `Realization` | — |
| Objectif → Contexte métier, *est un objectif pour* | `Association` | — |
| Contexte métier → Contexte métier, *succède à* | `Triggering` | dessinée de la cible vers la source |

Cliquez avec le bouton droit sur un connecteur et choisissez **Droit** ou **Orthogonal**. Le tracé est conservé quand vous déplacez un nœud et après avoir enregistré puis rouvert le diagramme.

## Le fichier Exchange {#exchange-file}

La barre d'outils propose **Exporter en fichier Exchange** et **Importer un fichier Exchange**, ainsi que **Exporter en SVG** pour obtenir une image.

- **Exporter** télécharge le diagramme sous forme d'ArchiMate Model Exchange File (`.xml`, format 3.1).
- **Importer** remplace tout le contenu du diagramme ouvert, après confirmation (**Remplacer le diagramme ?**). Les diagrammes créés avec d'autres outils (comme Archi) peuvent être lus s'ils respectent le format de The Open Group.
- Les fichiers de plus de 5 Mo sont refusés, de même que ceux qui contiennent une déclaration DOCTYPE ou d'entité.

**Ce qui n'est pas conservé à l'importation :**

- **Dossiers** (la section `organizations`) : ils sont abandonnés et l'éditeur vous le signale.
- **Notes, groupes et connexions simples** venant d'autres outils : les étiquettes et conteneurs sans élément derrière eux, ainsi que les connexions sans relation, sont ignorés.
- **Types de propriété autres que string** : chaque définition de propriété est lue comme une chaîne de caractères.
- **Autres langues d'un nom** : un seul nom est conservé par élément, relation et vue.
- Les polices et les autres styles au-delà de l'essentiel ne sont pas conservés.

## Vérifier le modèle

Le bouton **Vérifier le modèle** de la barre d'outils envoie le diagramme courant au serveur, qui le valide selon les règles d'échange de The Open Group et liste chaque problème trouvé (100 au maximum). Chaque message porte un code ; le symbole `…` représente le nom ou l'identifiant concerné :

| Code | Message |
|---|---|
| `too_large` | Le modèle dépasse 5 Mo. |
| `xml_invalid` | Le modèle n'est pas un XML bien formé. |
| `dtd_forbidden` | Les déclarations DOCTYPE et d'entité ne sont pas autorisées. |
| `wrong_root` | L'élément racine n'est pas un modèle ArchiMate. |
| `missing_identifier` | Un élément, une relation ou un nœud du diagramme n'a pas d'identifiant. |
| `unknown_element_type` | Type d'élément inconnu : … |
| `unknown_relationship_type` | Type de relation inconnu : … |
| `unknown_access_type` | Type d'accès inconnu sur … |
| `duplicate_identifier` | Identifiant en double : … |
| `dangling_source` | La relation … part d'un élément qui n'existe pas. |
| `dangling_target` | La relation … aboutit à un élément qui n'existe pas. |
| `relationship_not_allowed` | ArchiMate n'autorise pas la relation … : ni entre ces deux éléments, ni d'une relation vers elle-même. |
| `dangling_element_ref` | Le nœud de diagramme … représente un élément qui n'existe pas. |
| `dangling_relationship_ref` | La connexion de diagramme … représente une relation qui n'existe pas. |
| `connection_endpoint_mismatch` | La connexion de diagramme … ne relie pas les nœuds de sa relation. |

La vérification des relations refuse aussi une relation qui pointe vers une autre relation, sauf s'il s'agit d'une Association, d'une Aggregation ou d'une Composition. S'il n'y a rien à signaler, la boîte de dialogue indique **Aucun problème détecté.**

## Raccourcis clavier

Appuyez sur **Raccourcis clavier** dans la barre d'outils pour afficher la liste. Cliquez d'abord sur le canevas pour qu'il ait le focus.

| Action | Raccourci |
|--------|-----------|
| Annuler | `Ctrl+Z` |
| Rétablir | `Ctrl+Y` / `Ctrl+Shift+Z` |
| Copier | `Ctrl+C` |
| Coller | `Ctrl+V` |
| Supprimer | `Delete` / `Backspace` |
| Renommer | `F2` / `Enter` |
| Tout sélectionner | `Ctrl+A` |
| Zoom avant | `Ctrl++` |
| Zoom arrière | `Ctrl+-` |
| Ajuster à l'écran | `Ctrl+0` |

Dans la palette, `Enter` ou `Space` sur une entrée ayant le focus dépose cet élément.

## Limites connues {#known-limits}

- **Une seule vue est modifiée par fichier.** Si un fichier importé contient plusieurs vues, la première est modifiée et les autres sont conservées intactes à l'enregistrement.
- **Les relations entre relations** (une Association, Aggregation ou Composition qui pointe vers une autre relation) sont lues et écrites, et le vérificateur les accepte, mais elles ne sont pas dessinées.
- **Tracer une relation nécessite la souris.** Le clavier permet de déposer des éléments, pas de les relier.
- **Les dépôts au clavier s'empilent.** Chaque élément déposé avec `Enter` ou `Space` arrive au centre de la zone visible ; les dépôts successifs se superposent donc jusqu'à ce que vous les déplaciez.
- **Pas encore de publication.** Les diagrammes ArchiMate ne peuvent être ni publiés ni intégrés et n'apparaissent pas dans le menu **Diagrammes** ; on y accède depuis la liste du bac à sable ou depuis l'onglet **Ressources** d'une fiche qui les référence.
- **Les jonctions (junctions) n'ont pas d'étiquette.** Une jonction And ou Or est un simple point.
- La correspondance est en lecture seule (voir [La correspondance](#mapping)) et les dossiers sont abandonnés à l'importation (voir [Le fichier Exchange](#exchange-file)).

---

ArchiMate® est une marque déposée de The Open Group. Turbo EA dessine la notation ArchiMate et n'est pas certifié par The Open Group.
