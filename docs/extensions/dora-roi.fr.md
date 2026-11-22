# DORA Register of Information

Toute entité financière de l'UE doit tenir un **registre d'informations** sur
l'ensemble de ses accords avec des prestataires TIC tiers et le transmettre
chaque année à son autorité de surveillance — 15 modèles imbriqués, remis sous
forme de paquet xBRL-CSV lisible par machine conforme au cadre de l'ABE. Lors de
l'exercice à blanc 2024 des AES, seuls 6,5 % des registres ont passé tous les
contrôles de qualité des données.

Les données dont ce registre a besoin sont exactement celles que contient déjà
votre référentiel EA. **DORA Register of Information** fait de Turbo EA votre
registre.

## Le registre vit sur vos fiches

Cette extension ne tient **aucune table propre** pour le contenu du registre.
Chaque objet du registre est une fiche ou une relation :

| Objet du registre | Dans Turbo EA |
|---|---|
| Entités juridiques dans le périmètre | Cartes **Organisation** avec *In DORA register scope* activé |
| Succursales | Cartes **Organisation** de sous-type **Branch**, enfants de leur siège |
| Prestataires TIC tiers | Cartes **Provider** |
| Accords contractuels | Cartes **ICT Arrangement** (nouveau type de fiche) |
| Services TIC | Cartes **ICT Service** (nouveau type de fiche) |
| Fonctions critiques ou importantes | Cartes **Capacité métier** / **Processus métier** marquées comme fonctions du registre |
| Parties signataires, utilisatrices, prestataires, chaînes de sous-traitance | **Relations** entre ces fiches |

C'est là toute la conception : chaque champ se modifie dans la vue de fiche de
Turbo EA, avec ses marqueurs d'obligation, sa validation, son aide contextuelle et
son score de qualité des données, et le registre est assemblé en direct à partir
des fiches à chaque validation ou export.

![Cartes ICT Service dans l'inventaire avec leur score DORA](../assets/img/en/73_ext_dora_cards.png)

!!! note "Il n'y a volontairement pas d'onglet DORA sur la fiche"
    Les champs ajoutés s'affichent comme des sections d'attributs ordinaires sur
    une fiche, et chaque lien du registre est une relation normale. Rien dans la
    tenue du registre n'est un mode particulier.

## En bref

| | |
|---|---|
| **Licence** | Commerciale — un droit signé est requis |
| **Version minimale de Turbo EA** | 2.182.0 |
| **Permissions** | `ext.dora-roi.view`, `ext.dora-roi.manage`, `ext.dora-roi.submit`, `ext.dora-roi.admin` |
| **Autorisations d'accès aux données** | `core.cards.read`, `core.cards.write`, `metamodel.custom_field_types` |
| **Redémarrage du backend requis** | oui — l'extension embarque du code backend |
| **Où elle apparaît** | **Registre DORA** dans le menu **GRC** (une entrée de premier niveau lorsque le menu GRC ne vous est pas accessible) · **Rapports → Registre DORA - Tableau de bord** · sections **DORA Register** et **DORA Function** sur les fiches · six modèles d'enquête |

## Ce qu'elle ajoute à votre métamodèle

**Deux nouveaux types de fiche**

- **ICT Arrangement** — un accord contractuel portant sur l'utilisation de
  services TIC. Il est **hiérarchique** : les accords généraux sont les parents,
  les accords subséquents ou associés leurs enfants. Porte la dépense annuelle et
  la devise.
- **ICT Service** — un par service fourni au titre d'un accord, portant à la fois
  la ligne de service (type, dates, préavis, droit applicable, localisations,
  degré de dépendance) et son **évaluation** (substituabilité, plan de
  sortie, réintégration, impact d'une interruption, prestataires alternatifs). Ses
  trois champs de localisation — **Country of provision of the services**,
  **Location of the data at rest** et **Location of data management** (là où les
  données sont traitées) — proposent chacun **Not applicable**. Un service sans
  lieu de traitement des données renseigné empêche la finalisation d'un
  instantané : choisissez le pays, ou **Not applicable** si le service n'implique
  aucun traitement de données.

**Un nouveau sous-type** — **Branch** sur Organisation.

**De nouvelles sections sur des types de fiche existants**

| Type de fiche | Section | Contenu |
|---|---|---|
| **Organisation** | DORA Register | Dans le périmètre du registre DORA, LEI, Pays, Type d'entité, Position dans le groupe, Autorité compétente, Total de bilan, Devise de déclaration, Code de succursale |
| **Provider** | DORA Register | LEI, Type d'identifiant, EUID, Autre code d'identification, Type de personne, Pays du siège, Prestataire intragroupe, dépense annuelle, société mère ultime |
| **Capacité métier** / **Processus métier** | DORA Function | Fonction du registre DORA, Identifiant de fonction, Activité agréée, Évaluation de la criticité ou de l'importance, Motifs de criticité, Date de la dernière évaluation, RTO, RPO, Impact d'une interruption |

Chaque section porte en outre un **score DORA (%)** en lecture seule — une barre
de complétude indiquant la part de données de registre encore due par cette fiche.

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
2. **Marquez vos entités juridiques.** Sur chaque fiche Organisation, remplissez
   la section **DORA Register** : activez *In DORA register scope* et renseignez
   le LEI, le pays, le type d'entité et la position dans le groupe. Les
   succursales sont des fiches Organisation de sous-type **Branch**, rattachées à
   leur siège.
3. **Créez une fiche ICT Arrangement par accord contractuel.** Faites des contrats
   ultérieurs des *enfants* du contrat maître — c'est ce qui dérive le type
   d'accord et la référence de l'accord général.
4. **Reliez chaque accord** à sa fiche Provider et aux entités qui signent,
   utilisent ou fournissent, en renseignant l'attribut **rôles DORA** sur chacune.
5. **Créez une fiche ICT Service par service**, puis reliez-la à son contrat, aux
   entités qui l'utilisent, aux fonctions qu'elle soutient et à ses prestataires
   **classés par rang**.
6. **Marquez les fonctions.** Activez *DORA register function* sur les fiches
   Capacité métier ou Processus métier qui sont des fonctions critiques ou
   importantes et complétez leur section **DORA Function** — ou acceptez les
   propositions de [Suggestions](#suggestions).
7. **Validez le registre et corrigez les constats.**

!!! tip "Collectez les données auprès de ceux qui les détiennent"
    Six modèles d'enquête sous **Admin → Enquêtes → Nouveau depuis un modèle**
    recueillent les données obligatoires auprès des responsables de fiches :
    **DORA entity data**, **DORA provider data**, **DORA arrangement data**,
    **DORA ICT service data**, ainsi que **DORA function data** pour les capacités
    et pour les processus. Chacun s'ouvre en brouillon.

### Ce que vous n'avez jamais à saisir

Le registre dérive les éléments suivants au lieu de les demander : le LEI de la
société mère (depuis la hiérarchie des fiches), les dates d'intégration et de
suppression (depuis le cycle de vie de la fiche), le type d'accord et la référence
de l'accord général (depuis la hiérarchie des accords), la nature de la succursale
(depuis le sous-type Branch), le destinataire d'un service sous-traité (depuis le
classement des prestataires) et la date de dernière mise à jour. Le **périmètre
des prestataires** est lui aussi dérivé : seules les fiches Provider réellement
référencées par un accord ou une chaîne d'approvisionnement entrent dans le
registre, les fournisseurs non concernés restant automatiquement à l'écart. Les
conventions de remplissage des ITS (`9999-12-31` pour les dates sans terme,
*not applicable* pour les accords non subséquents) sont appliquées pour vous.

## L'espace de travail

**Registre DORA** dans le menu **GRC** comporte cinq onglets. Le même
tableau de bord est également disponible comme rapport enregistrable sous
**Rapports → Registre DORA - Tableau de bord**.

### Tableau de bord

Six tuiles — **Register completeness**, **Blocking findings**, **Warnings**,
**Critical functions**, **Providers**, **Arrangements** — au-dessus d'un bouton
**Validate now** et d'une ligne indiquant combien des règles actives de l'ABE ont
été exécutées, avec un lien **Rules not run** (voir [Validation](#validation)).
En dessous, une barre de compteurs mène directement à l'inventaire pour chaque
objet du registre, et le tableau **Template completeness** indique les lignes et
les constats par modèle.

![Le tableau « Template completeness »](../assets/img/en/74_ext_dora_template_completeness.png)

Un clic sur un nombre de constats ouvre **Validation findings** : une ligne par
constat, avec sa gravité (**Blocking** ou **Warning**), son modèle, sa ligne de
registre, sa fiche, sa règle, sa colonne et son message, et des filtres sur la
gravité, le modèle, le type de fiche et la règle. La règle est l'une des
suivantes : **Missing**, **Missing key value**, **Invalid value**, **Invalid
LEI**, **Duplicate row**, **Broken reference**, **Unknown column** ou **EBA
rule**. Un clic sur un constat, ou sur son action **Open card**, ouvre dans un
panneau latéral la fiche à corriger ; un constat portant sur les paramètres de
dépôt propose **Open settings** à la place. Le bouton **Rules not run** ouvre la
liste décrite dans [Validation](#validation).

### Registre

Six vues — **Legal entities**, **Branches**, **Contractual arrangements**,
**ICT third-party providers**, **ICT services** et **Functions** — chacune sous
forme de tableau des fiches qui composent cette partie du registre, avec un champ
de recherche, un bouton **New …** créant une fiche au bon type et avec les
indicateurs préréglés, et un lien **Open in inventory**. Un clic sur une ligne
ouvre la fiche dans un panneau latéral.

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
   n'est définie. Les constats bloquants comprennent un service sans lieu de
   traitement des données, tout autre champ clé laissé vide là où il s'applique,
   et un LEI de prestataire qui ne respecte pas le format ISO 17442 ou sa somme de
   contrôle (**Invalid LEI**).
3. **Final** — l'instantané est immuable, l'empreinte de son paquet est figée pour
   l'audit, il conserve les constats et la couverture des règles avec lesquels il
   a été contrôlé, et il ne peut plus être supprimé ni revalidé.

Deux téléchargements sont disponibles à tout moment :

- **xBRL-CSV package** — un paquet de rapport DORA construit selon la taxonomie du
  cadre ABE 4.0 (module DORA 1.1.0), sous forme de `.zip`, contenant les
  métadonnées du rapport, les indicateurs de dépôt, les paramètres et un CSV par
  modèle. Son nom de fichier porte le code pays ISO de l'entité déclarante. Un
  prestataire ayant à la fois un LEI et un EUID est déclaré avec les deux : le LEI
  comme code d'identification et l'EUID comme code d'identification
  supplémentaire. Le paquet est reproductible à l'octet près, et le
  retéléchargement d'un instantané final est vérifié contre son empreinte figée.
- **Excel workbook** — un classeur de relecture avec une page de garde, une
  feuille par modèle reprenant les libellés et codes de colonnes de l'ABE et une
  feuille des membres, pour faire circuler le registre en interne avant le dépôt.

Avant chaque version qui modifie l'export, le paquet construit à partir du
registre de démonstration est validé avec Arelle, le processeur XBRL open source,
contre la taxonomie du cadre 4.0 publiée par l'ABE, y compris les assertions de
validation propres à la taxonomie. Cela couvre la structure du paquet, et non les
contrôles de réception de l'ABE ni ses consultations de registres : savoir si le
portail de votre autorité accepte le fichier est un test distinct, que vous
effectuez vous-même.

### Paramètres

**Filing** — le **Filing scope** (**Consolidated (.CON)** ou **Individual
(.IND)**), la **Reporting currency**, la **Taxonomy version** et la **Reporting
entity**, dont le LEI et le pays déterminent le paquet de rapport.

**Definitions (B_99.01)** — définitions libres facultatives pour les termes issus
de listes fermées employés par votre registre, déposées comme modèle B_99.01.

**Demo data** — **Load demo data** charge un registre d'exemple complet (entités
de groupe et une succursale, prestataires, accords généraux et intragroupe, une
chaîne d'approvisionnement à trois niveaux, fonctions critiques, suggestions et un
instantané en brouillon) pour explorer toutes les fonctionnalités avant de
toucher à de vraies données. Toutes les fiches de démonstration sont nommées
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
sommes de contrôle des LEI, dates, nombres, ainsi que les champs obligatoires et
clés traités comme bloquants lorsqu'ils sont vides), les **membres** (valeurs de
listes fermées confrontées aux listes de codes de la taxonomie), les **clés**
(complétude et unicité des clés primaires, et références entre modèles) et les
**règles de validation de l'ABE exécutables hors ligne**, avec les niveaux de
gravité publiés. Les règles retirées par l'ABE ne sont pas exécutées.

Un EUID de prestataire est contrôlé selon le format EUID : le code pays et
l'identifiant du registre, un point, puis le numéro d'immatriculation. Une valeur
sans point, ou un LEI saisi comme EUID, est signalée par un avertissement. Un
contrôle local est plus strict que celui de l'ABE : un code d'identification de
prestataire déclaré comme LEI qui ne respecte pas le format ISO 17442 ou sa somme
de contrôle est un constat bloquant **Invalid LEI**, alors que la règle de l'ABE
n'est qu'un avertissement. Un LEI invalide de la société mère ultime d'un
prestataire reste un avertissement.

!!! warning "La couverture est partielle — et annoncée honnêtement"
    Turbo EA exécute les règles de l'ABE évaluables hors ligne, et le tableau de
    bord indique combien des règles actives de l'ABE ont été exécutées. **Rules
    not run**, ouvert depuis cette mention ou depuis les constats de validation,
    liste toutes les autres règles avec leur modèle, le texte propre de l'ABE et la
    raison pour laquelle elles ne s'exécutent pas ici : une **EBA expression**
    dépassant les contrôles hors ligne, que les systèmes de l'autorité évaluent sur
    le fichier que vous remettez, ou un **Package check** que l'ABE applique au
    paquet de rapport remis plutôt qu'au registre. Elle nomme aussi les règles de
    LEI, d'EUID et de pays qui ne s'exécutent ici que comme contrôles hors ligne de
    somme de contrôle, de format et de liste de codes, là où l'ABE consulte les
    codes dans le GLEIF et les registres du commerce (BRIS). Considérez une
    validation sans constat comme un solide contrôle préalable, non comme une
    garantie d'acceptation par l'autorité.

## Permissions

| Permission | Autorise |
|---|---|
| `ext.dora-roi.view` | Consulter le registre, les tableaux de bord et les résultats de validation |
| `ext.dora-roi.manage` | Modifier les données du registre et statuer sur les suggestions |
| `ext.dora-roi.submit` | Figer des instantanés à une date de référence et télécharger les paquets de rapport |
| `ext.dora-roi.admin` | Configurer les paramètres de dépôt et charger ou retirer les données de démonstration |

La modification des données du registre s'appuie en outre sur vos droits normaux
d'édition des fiches, puisque chaque champ du registre réside sur une fiche.

## Si la licence expire ou l'extension est désactivée

L'espace de travail et ses rapports disparaissent et le pont d'accès aux données
de fiches s'arrête, mais **rien n'est supprimé**. Votre registre vit sur des
fiches et des relations ordinaires : chaque valeur reste exactement là où elle
est, visible et modifiable dans l'inventaire. Les instantanés et les paramètres
sont conservés. Une licence renouvelée rétablit immédiatement l'espace de travail.

Si le message *The card-data bridge is unavailable* s'affiche, l'extension est
installée mais non licenciée, ou le backend n'a pas été redémarré depuis son
installation.

## Remarques et limites

- **La version 2.0.0 a introduit une rupture.** Les registres construits sur des
  versions antérieures stockaient services et fonctions dans les tables propres à
  l'extension ; ces lignes ne sont pas migrées. Ressaisissez-les sous forme de
  fiches ICT Service et de fonctions (ou rechargez les données de démonstration)
  et relancez **Find suggestions**.
- Les modèles, listes de codes et règles sont livrés sous forme de données
  versionnées générées à partir du cadre ABE publié : une nouvelle version du
  cadre arrive donc comme une mise à jour de l'extension plus un changement de
  **Taxonomy version**.
- Le **score DORA** d'une fiche est un signal de tri, pas un verdict de
  conformité. Les constats du tableau de bord font foi pour les écarts.
- Aucune variante Excel propre à une autorité n'est produite ; le paquet xBRL-CSV
  est l'artefact de dépôt.
