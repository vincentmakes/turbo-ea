# DORA Register of Information

Toute entité financière de l'UE doit tenir un **registre d'informations** sur
l'ensemble de ses accords avec des prestataires TIC tiers et le transmettre
chaque année à son autorité de surveillance — 15 modèles imbriqués, remis sous
forme de paquet xBRL-CSV lisible par machine conforme au cadre de l'ABE. Lors de
l'exercice à blanc des AES, 93,5 % des soumissions comportaient au moins une
erreur de données, et 86 % d'entre elles étaient des informations obligatoires
manquantes.

Les données dont ce registre a besoin sont exactement celles que contient déjà
votre référentiel EA. **DORA Register of Information** fait de Turbo EA votre
registre.

## Le registre vit sur vos cartes

Cette extension ne tient **aucune table propre** pour le contenu du registre.
Chaque objet du registre est une carte ou une relation :

| Objet du registre | Dans Turbo EA |
|---|---|
| Entités juridiques dans le périmètre | Cartes **Organisation** avec *In DORA register scope* activé |
| Succursales | Cartes **Organisation** de sous-type **Branch**, enfants de leur siège |
| Prestataires TIC tiers | Cartes **Provider** |
| Accords contractuels | Cartes **ICT Arrangement** (nouveau type de carte) |
| Services TIC | Cartes **ICT Service** (nouveau type de carte) |
| Fonctions critiques ou importantes | Cartes **Capacité métier** / **Processus métier** marquées comme fonctions du registre |
| Parties signataires, utilisatrices, prestataires, chaînes de sous-traitance | **Relations** entre ces cartes |

C'est là toute la conception : chaque champ se modifie dans la vue de carte de
Turbo EA, avec ses marqueurs d'obligation, sa validation, son aide contextuelle et
son score de qualité des données, et le registre est assemblé en direct à partir
des cartes à chaque validation ou export.

![Cartes ICT Service dans l'inventaire avec leur score DORA](../assets/img/en/73_ext_dora_cards.png)

!!! note "Il n'y a volontairement pas d'onglet DORA sur la carte"
    Les champs ajoutés s'affichent comme des sections d'attributs ordinaires sur
    une carte, et chaque lien du registre est une relation normale. Rien dans la
    tenue du registre n'est un mode particulier.

## En bref

| | |
|---|---|
| **Licence** | Commerciale — un droit signé est requis |
| **Version minimale de Turbo EA** | 2.94.0 |
| **Permissions** | `ext.dora-roi.view`, `ext.dora-roi.manage`, `ext.dora-roi.submit`, `ext.dora-roi.admin` |
| **Autorisations d'accès aux données** | `core.cards.read`, `core.cards.write`, `metamodel.custom_field_types` |
| **Redémarrage du backend requis** | oui — l'extension embarque du code backend |
| **Où elle apparaît** | **Registre DORA** dans la navigation principale · **Rapports → Registre DORA** · sections **DORA Register** et **DORA Function** sur les cartes · six modèles d'enquête |

## Ce qu'elle ajoute à votre métamodèle

**Deux nouveaux types de carte**

- **ICT Arrangement** — un accord contractuel portant sur l'utilisation de
  services TIC. Il est **hiérarchique** : les accords généraux sont les parents,
  les accords subséquents ou associés leurs enfants. Porte la dépense annuelle et
  la devise.
- **ICT Service** — un par service fourni au titre d'un accord, portant à la fois
  la ligne de service (type, dates, préavis, droit applicable, localisation des
  données, degré de dépendance) et son **évaluation** (substituabilité, plan de
  sortie, réintégration, impact d'une interruption, prestataires alternatifs).

**Un nouveau sous-type** — **Branch** sur Organisation.

**De nouvelles sections sur des types de carte existants**

| Type de carte | Section | Contenu |
|---|---|---|
| **Organisation** | DORA Register | Dans le périmètre du registre DORA, LEI, Pays, Type d'entité, Position dans le groupe, Autorité compétente, Total de bilan, Devise de déclaration, Code de succursale |
| **Provider** | DORA Register | LEI, Type d'identifiant, EUID, Type de personne, Pays du siège, Prestataire intragroupe, dépense annuelle, société mère ultime |
| **Capacité métier** / **Processus métier** | DORA Function | Fonction du registre DORA, Identifiant de fonction, Activité agréée, Évaluation de criticité, Motifs de criticité, RTO, RPO, Impact d'une interruption |

Chaque section porte en outre un **score DORA (%)** en lecture seule — une barre
de complétude indiquant la part de données de registre encore due par cette carte.

**Neuf types de relation**, dont deux portent des attributs que vous renseignez
relation par relation :

- **Organisation → ICT Arrangement** (*est partie à*) porte l'attribut **rôles
  DORA** : **Entité signataire**, **Utilisation des services TIC**, **Entité
  prestataire (intragroupe)**.
- **ICT Service → Provider** (*est fourni par*) porte un **rang dans la chaîne
  d'approvisionnement** : le **rang 1** est le prestataire direct, les rangs
  suivants sont des sous-traitants.

L'extension ajoute également une réglementation **DORA** au
[scanner de conformité](../guide/compliance.md) du cœur.

## Premiers pas

L'espace de travail s'ouvre sur un **Tableau de bord** doté d'une liste de
contrôle **Getting started** qui suit ces sept étapes et affiche la progression.

![Le tableau de bord du registre DORA](../assets/img/en/72_ext_dora_dashboard.png)

1. **Choisissez l'entité déclarante dans les Paramètres** — l'entité dont il
   s'agit du registre.
2. **Marquez vos entités juridiques.** Sur chaque carte Organisation, remplissez
   la section **DORA Register** : activez *In DORA register scope* et renseignez
   le LEI, le pays, le type d'entité et la position dans le groupe. Les
   succursales sont des cartes Organisation de sous-type **Branch**, rattachées à
   leur siège.
3. **Créez une carte ICT Arrangement par accord contractuel.** Faites des contrats
   ultérieurs des *enfants* du contrat maître — c'est ce qui dérive le type
   d'accord et la référence de l'accord général.
4. **Reliez chaque accord** à sa carte Provider et aux entités qui signent,
   utilisent ou fournissent, en renseignant l'attribut **rôles DORA** sur chacune.
5. **Créez une carte ICT Service par service**, puis reliez-la à son contrat, aux
   entités qui l'utilisent, aux fonctions qu'elle soutient et à ses prestataires
   **classés par rang**.
6. **Marquez les fonctions.** Activez *DORA register function* sur les cartes
   Capacité métier ou Processus métier qui sont des fonctions critiques ou
   importantes et complétez leur section **DORA Function** — ou acceptez les
   propositions de [Suggestions](#suggestions).
7. **Validez le registre et corrigez les constats.**

!!! tip "Collectez les données auprès de ceux qui les détiennent"
    Six modèles d'enquête sous **Admin → Enquêtes → Nouveau depuis un modèle**
    recueillent les données obligatoires auprès des responsables de cartes :
    **DORA entity data**, **DORA provider data**, **DORA arrangement data**,
    **DORA ICT service data**, ainsi que **DORA function data** pour les capacités
    et pour les processus. Chacun s'ouvre en brouillon.

### Ce que vous n'avez jamais à saisir

Le registre dérive les éléments suivants au lieu de les demander : le LEI de la
société mère (depuis la hiérarchie des cartes), les dates d'intégration et de
suppression (depuis le cycle de vie de la carte), le type d'accord et la référence
de l'accord général (depuis la hiérarchie des accords), la nature de la succursale
(depuis le sous-type Branch), le destinataire d'un service sous-traité (depuis le
classement des prestataires) et la date de dernière mise à jour. Le **périmètre
des prestataires** est lui aussi dérivé : seules les cartes Provider réellement
référencées par un accord ou une chaîne d'approvisionnement entrent dans le
registre, les fournisseurs non concernés restant automatiquement à l'écart. Les
conventions de remplissage des ITS (`9999-12-31` pour les dates sans terme,
*not applicable* pour les accords non subséquents) sont appliquées pour vous.

## L'espace de travail

**Registre DORA** dans la navigation principale comporte cinq onglets. Le même
tableau de bord est également disponible comme rapport enregistrable sous
**Rapports → Registre DORA**.

### Tableau de bord

Six tuiles — **Register completeness**, **Blocking findings**, **Warnings**,
**Critical functions**, **Providers**, **Arrangements** — au-dessus d'un bouton
**Validate now**. En dessous, une barre de compteurs mène directement à
l'inventaire pour chaque objet du registre, et le tableau **Template
completeness** indique les lignes et les constats par modèle.

![Le tableau « Template completeness »](../assets/img/en/74_ext_dora_template_completeness.png)

Un clic sur un nombre de constats ouvre le tiroir **Validation findings**, groupé
par ligne de registre, chaque constat étant classé **Missing**, **Invalid value**,
**Duplicate row**, **Broken reference**, **Unknown column** ou **EBA rule**, et
marqué **Blocking** ou **Warning**. Chaque constat propose un bouton **Open card**
qui mène exactement au champ à corriger.

### Registre

Six vues — **Legal entities**, **Branches**, **Contractual arrangements**,
**ICT third-party providers**, **ICT services** et **Functions** — chacune sous
forme de tableau des cartes qui composent cette partie du registre, avec un champ
de recherche, un bouton **New …** créant une carte au bon type et avec les
indicateurs préréglés, et un lien **Open in inventory**. Un clic sur une ligne
ouvre la carte dans un panneau latéral.

### Suggestions

**Find suggestions** parcourt vos relations Prestataire → Application →
Capacité/Processus et propose des mises à jour du registre — fonctions non
marquées et relèvements de criticité — chacune accompagnée de sa justification.
Rien n'est écrit tant que vous n'avez pas cliqué **Accept** sur une ligne ;
**Dismiss** la retire de la liste.

### Soumissions

**New snapshot** fige le registre à une **date de référence**. Chaque instantané
passe ensuite par trois états :

1. **Draft** — cliquez sur **Validate** pour le contrôler. Les constats sont
   listés avec gravité, modèle, ligne, colonne et message.
2. **Validated** — cliquez sur **Finalize**. L'opération est refusée tant qu'il
   reste un constat **bloquant** ou qu'aucune entité déclarante dotée d'un LEI
   n'est définie.
3. **Final** — l'instantané est immuable, l'empreinte de son paquet est figée pour
   l'audit, et il ne peut plus être supprimé ni revalidé.

Deux téléchargements sont disponibles à tout moment :

- **xBRL-CSV package** — le paquet officiel du module DORA du cadre ABE 4.0, sous
  forme de `.zip`, contenant les métadonnées du rapport, les indicateurs de
  dépôt, les paramètres et un CSV par modèle. Il est reproductible à l'octet
  près, et le retéléchargement d'un instantané final est vérifié contre son
  empreinte figée.
- **Excel workbook** — un classeur de relecture avec une page de garde, une
  feuille par modèle reprenant les libellés et codes de colonnes officiels et une
  feuille des membres, pour faire circuler le registre en interne avant le dépôt.

### Paramètres

**Filing** — le **Filing scope** (**Consolidated (.CON)** ou **Individual
(.IND)**), la **Reporting currency**, la **Taxonomy version** et la **Reporting
entity**, dont le LEI et le pays déterminent le paquet de soumission.

**Definitions (B_99.01)** — définitions libres facultatives pour les termes issus
de listes fermées employés par votre registre, déposées comme modèle B_99.01.

**Demo data** — **Load demo data** charge un registre d'exemple complet (entités
de groupe et une succursale, prestataires, accords généraux et intragroupe, une
chaîne d'approvisionnement à trois niveaux, fonctions critiques, suggestions et un
instantané en brouillon) pour explorer toutes les fonctionnalités avant de
toucher à de vraies données. Toutes les cartes de démonstration sont nommées
*Demo DORA — …* et étiquetées **Demo Dora** ; **Remove demo data** les retire.

## Les 15 modèles

| Modèle | Contenu |
|---|---|
| B_01.01 | Entité tenant le registre d'informations |
| B_01.02 | Liste des entités dans le périmètre |
| B_01.03 | Liste des succursales |
| B_02.01 | Accords contractuels – informations générales |
| B_02.02 | Accords contractuels – informations spécifiques |
| B_02.03 | Liste des accords contractuels intragroupe |
| B_03.01 / B_03.02 / B_03.03 | Parties signataires |
| B_04.01 | Entités utilisant les services TIC |
| B_05.01 | Prestataires TIC tiers |
| B_05.02 | Chaînes d'approvisionnement des services TIC |
| B_06.01 | Identification des fonctions |
| B_07.01 | Évaluation des services TIC |
| B_99.01 | Définitions |

## Validation

La validation s'effectue en quatre couches : la **structure** (types de données,
sommes de contrôle des LEI, dates, nombres, ainsi que les indicateurs de champs
obligatoires traités comme bloquants), les **membres** (valeurs de listes fermées
confrontées aux domaines officiels), les **clés** (complétude et unicité des clés
primaires, et références entre modèles) et l'**inventaire de règles de l'ABE**
avec les niveaux de gravité publiés.

!!! warning "La couverture est partielle — et annoncée honnêtement"
    Turbo EA exécute les règles évaluables hors ligne. Celles qui nécessitent le
    moteur d'expressions des AES ou des consultations en direct des registres
    GLEIF/BRIS ne peuvent pas s'exécuter sur votre instance. Plutôt que de les
    ignorer en silence, le tableau de bord indique combien de règles de l'ABE ont
    été exécutées et combien ne l'ont pas été. Considérez une validation sans
    constat comme un solide contrôle préalable, non comme une garantie
    d'acceptation par l'autorité.

## Permissions

| Permission | Autorise |
|---|---|
| `ext.dora-roi.view` | Consulter le registre, les tableaux de bord et les résultats de validation |
| `ext.dora-roi.manage` | Modifier les données du registre et statuer sur les suggestions |
| `ext.dora-roi.submit` | Figer des instantanés à une date de référence et télécharger les paquets de soumission |
| `ext.dora-roi.admin` | Configurer les paramètres de dépôt et charger ou retirer les données de démonstration |

La modification des données du registre s'appuie en outre sur vos droits normaux
d'édition des cartes, puisque chaque champ du registre réside sur une carte.

## Si la licence expire ou l'extension est désactivée

L'espace de travail et ses rapports disparaissent et le pont d'accès aux données
de cartes s'arrête, mais **rien n'est supprimé**. Votre registre vit sur des
cartes et des relations ordinaires : chaque valeur reste exactement là où elle
est, visible et modifiable dans l'inventaire. Les instantanés et les paramètres
sont conservés. Une licence renouvelée rétablit immédiatement l'espace de travail.

Si le message *The card-data bridge is unavailable* s'affiche, l'extension est
installée mais non licenciée, ou le backend n'a pas été redémarré depuis son
installation.

## Remarques et limites

- **La version 2.0.0 a introduit une rupture.** Les registres construits sur des
  versions antérieures stockaient services et fonctions dans les tables propres à
  l'extension ; ces lignes ne sont pas migrées. Ressaisissez-les sous forme de
  cartes ICT Service et de fonctions (ou rechargez les données de démonstration)
  et relancez **Find suggestions**.
- Le contenu de la taxonomie est généré à partir du cadre ABE publié : adopter une
  nouvelle version revient donc à une mise à jour de données plus un changement de
  **Taxonomy version**.
- Le **score DORA** d'une carte est un signal de tri, pas un verdict de
  conformité. Les constats du tableau de bord font foi pour les écarts.
- Aucune variante Excel propre à une autorité n'est produite ; le paquet xBRL-CSV
  est l'artefact de dépôt.
