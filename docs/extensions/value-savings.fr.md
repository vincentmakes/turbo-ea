# EA Value Tracker

Toute fonction EA finit par se voir poser la même question par le directeur
financier ou le DSI : *que vaut réellement l'architecture pour nous ?* Les
feuilles de route et les schémas n'y répondent pas — les chiffres, si.

**EA Value Tracker** transforme les [décisions d'architecture](../guide/delivery.md)
de Turbo EA en registre financier auditable de la valeur créée par votre pratique
EA. La valeur est déclarée là où elle naît — sur la décision —, figée à la
signature, puis rapprochée de ce qui a réellement été réalisé, sous approbation à
quatre yeux. Un tableau de bord consolide le tout : la réponse à la question du
comité budgétaire tient dans un rapport, plus dans une fouille de tableurs.

## En bref

| | |
|---|---|
| **Licence** | Commerciale — un droit signé est requis |
| **Version minimale de Turbo EA** | 2.14.0 |
| **Permissions** | `ext.value-savings.record`, `ext.value-savings.approve` |
| **Autorisations d'accès aux données** | aucune |
| **Redémarrage du backend requis** | oui — l'extension embarque du code backend |
| **Où elle apparaît** | Panneau **Valeur & économies** sur les décisions · registre **Réalisation de la valeur** sous le bloc de signature · quatre colonnes dans les tableaux de décisions · **Rapports → EA Value Tracker** |

## Le cycle de vie

La valeur traverse quatre étapes, affichées en fil sur chaque décision :

**Déclaré (brouillon)** › **Déclaré (approuvé)** › **Réalisé (en attente)** ›
**Réalisé (approuvé)**

1. Pendant la rédaction d'une décision, les architectes y attachent des
   **économies déclarées**.
2. **La signature les fige.** Les chiffres approuvés par les signataires
   deviennent des déclarations approuvées et ne sont plus modifiables.
3. Après la mise en œuvre, quelqu'un **enregistre ce qui a réellement été
   réalisé** en regard de chaque déclaration.
4. Une **seconde personne approuve** la réalisation — celle qui enregistre ne
   peut jamais approuver ses propres chiffres.

## Déclarer de la valeur sur une décision

Ouvrez un brouillon de décision (**EA Delivery → Décisions**) et faites défiler
jusqu'à **Valeur & économies**, juste après les conséquences.

![Le panneau « Valeur & économies » sur un brouillon de décision](../assets/img/en/66_ext_value_tracker_claims.png)

Cliquez sur **Ajouter une économie** et complétez la boîte de dialogue :

| Champ | Remarques |
|---|---|
| **Catégorie** | **Économies directes**, **Économies indirectes**, **Coûts évités**, **Levier de revenus** ou **Risques évités** |
| **Montant** | Dans la devise de votre espace de travail. Doit être supérieur à zéro |
| **Exercice** | Dérivé du début d'exercice défini dans les [Paramètres généraux](../admin/settings.md) |
| **Type** | **Ponctuel** ou **Récurrent** |
| **Responsable** | Une ou plusieurs personnes redevables du chiffre |
| **Description** | Texte libre facultatif |

Ajoutez autant de déclarations que la décision le justifie. Un total courant
figure à côté du titre du panneau, avec une pastille par catégorie en dessous.

!!! note "« Récurrent » est une information"
    Une entrée **récurrente** reste dans l'exercice que vous lui avez donné —
    elle n'est jamais reportée automatiquement sur les exercices suivants. La
    distinction existe pour que le lecteur différencie une économie annuelle
    récurrente d'un gain ponctuel, et pour que le tableau de bord présente
    séparément le montant récurrent annuel.

La modification des déclarations requiert la permission habituelle `adr.manage`.

## Ce qui se passe à la signature

Lorsque les signataires signent la décision, Turbo EA fige l'ensemble de la
décision — déclarations comprises. L'éditeur disparaît du corps du document et :

- les déclarations passent en **Déclaré (approuvé)** et deviennent en lecture
  seule ;
- un registre **Réalisation de la valeur** apparaît **sous le bloc de
  signature** ;
- un bouton **Réalisation de la valeur** et les pastilles **Déclaré** et
  **Réalisé** apparaissent dans l'en-tête de la décision, à côté de Dupliquer et
  Nouvelle révision.

Pour changer un chiffre approuvé, créez une **nouvelle révision** de la décision.
C'est délibéré : les chiffres approuvés par les signataires restent exactement
tels qu'ils les ont approuvés.

## Enregistrer et approuver la valeur réalisée

![Le registre « Réalisation de la valeur » sous le bloc de signature](../assets/img/en/67_ext_value_tracker_realization.png)

**Enregistrer.** Toute personne disposant de `ext.value-savings.record` voit un
bouton **Enregistrer** sur chaque déclaration approuvée sans réalisation. La
boîte de dialogue demande le **montant** réel, l'**exercice**, un
**approbateur** et une description facultative.

L'approbateur **doit être une autre personne que celle qui enregistre** — une
règle des quatre yeux appliquée par le serveur, pas seulement par le formulaire.
L'enregistrement crée la ligne en **En attente** et génère une tâche pour
l'approbateur (« Approuver la valeur réalisée : … ») avec un lien vers la
décision, ainsi que la notification d'affectation habituelle.

**Approuver.** La personne désignée — qui doit aussi détenir
`ext.value-savings.approve` — ouvre la décision et clique sur **Approuver** ou
**Rejeter** sur la ligne en attente. La tâche est clôturée et le chiffre devient
**Réalisé (approuvé)**. Les lignes rejetées sont conservées pour la piste
d'audit.

**Corrections.**

- Seule la personne ayant statué peut inverser sa décision par la suite ou
  cliquer sur **Retirer la décision** pour remettre la ligne en attente (ce qui
  rouvre la tâche).
- Seule la personne qui a enregistré peut supprimer sa propre ligne, et seulement
  tant qu'elle est en attente. Les approbateurs rejettent au lieu de supprimer.
- Pour corriger un chiffre déjà approuvé, enregistrez une **nouvelle écriture de
  correction** plutôt que de modifier l'historique.

## Le tableau de bord

**Rapports → EA Value Tracker** consolide l'ensemble.

![Le tableau de bord EA Value Tracker](../assets/img/en/68_ext_value_tracker_dashboard.png)

**Barre d'outils**

- **Déclaré** / **Réalisé** — la base de tout le rapport : valeur *déclarée* sur
  les décisions ou valeur réellement *réalisée*.
- **Exercice** — l'exercice en cours est présélectionné ; désélectionnez tout
  pour voir toutes les années.
- Filtres **Catégorie** et **Personne**.
- **Inclure les brouillons** ou **Inclure les éléments en attente**.

**Indicateurs clés** — Réalisé (approuvé), Déclarations approuvées, Récurrent
(annuel), Brouillon, et le nombre de décisions contributrices.

L'**entonnoir des économies** présente les quatre étapes côte à côte : l'écart
entre le promis et l'encaissé saute aux yeux.

![Économies par catégorie](../assets/img/en/69_ext_value_tracker_categories.png)

**Économies par catégorie** est un anneau avec le total au centre.
**Économies par personne (répartition égale)** attribue à une entrée portée par
*N* personnes *montant ÷ N* à chacune, afin qu'aucune valeur ne soit comptée deux
fois.

![Économies par exercice](../assets/img/en/70_ext_value_tracker_fiscal_years.png)

**Économies par exercice** couvre une fenêtre fixe allant de quatre ans en
arrière à deux ans en avant et ignore délibérément le filtre d'exercice, pour que
la tendance reste toujours lisible.

Deux tableaux complètent le tout : la **répartition par personne** et les
**décisions contributrices** — le registre complet, avec un lien **Ouvrir** vers
chaque décision.

Le rapport s'enregistre, se partage, s'imprime et s'exporte en XLSX et PPTX comme
n'importe quel rapport du cœur : il peut aller directement dans un dossier de
comité de pilotage.

## Dans les tableaux de décisions

Quatre colonnes sont ajoutées au tableau de décisions partagé, aussi bien dans
**EA Delivery → Décisions** que dans **GRC → Gouvernance → Décisions** :

| Colonne | Contenu |
|---|---|
| **Économies déclarées** | Total déclaré sur cette décision |
| **Réalisé** | Total des réalisations approuvées |
| **Approbateur des économies** | Qui a approuvé les réalisations |
| **Étape des économies** | L'étape la plus avancée atteinte |

Elles se comportent comme des colonnes natives — tri, filtre rapide et thème
fonctionnent — et peuvent être masquées ou figées depuis le sélecteur de
colonnes.

## Permissions

| Permission | Autorise |
|---|---|
| `adr.view` (cœur) | Voir les panneaux, les colonnes et le tableau de bord |
| `adr.manage` (cœur) | Ajouter, modifier et supprimer des déclarations sur une décision non signée |
| `ext.value-savings.record` | Enregistrer une réalisation sur une déclaration approuvée |
| `ext.value-savings.approve` | Approuver ou rejeter une réalisation — **et** être la personne désignée comme approbateur |

Attribuez les deux permissions d'extension dans **Admin → Utilisateurs et rôles**.
Notez que `ext.value-savings.approve` ne suffit pas à elle seule : le serveur
vérifie en plus que vous êtes bien l'approbateur désigné sur cette ligne.

## Si la licence expire ou l'extension est désactivée

Les panneaux, les colonnes et le tableau de bord disparaissent, mais **rien n'est
supprimé**. Les déclarations résident dans la décision elle-même et suivent un
transfert d'espace de travail ; les réalisations restent dans les tables propres à
l'extension. Une licence renouvelée rétablit l'ensemble.

## Remarques et limites

- Les économies ne figurent délibérément **pas** dans l'export Word de la
  décision : cet export est le document de décision, pas le registre financier.
- Les réalisations s'enregistrent en regard d'une déclaration approuvée ; une
  décision doit donc être signée avant que de la valeur puisse être réalisée.
- L'extension embarque du code backend : son installation et ses mises à jour
  nécessitent un redémarrage ponctuel du backend. Turbo EA affiche alors un
  bandeau.
