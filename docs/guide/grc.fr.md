# GRC

Le module **GRC** réunit la Gouvernance, le Risque et la Conformité dans un espace de travail unique à `/grc`. Il regroupe des activités auparavant éparpillées entre Livraison EA et TurboLens, afin que l'architecte, le propriétaire de risque et l'examinateur de conformité partagent un terrain commun.

!!! note
    Le module GRC peut être activé ou désactivé par un administrateur dans les [Paramètres](../admin/settings.md). Lorsqu'il est désactivé, la navigation et les fonctionnalités GRC sont masquées.

GRC comporte trois onglets :

Tu peux pointer directement sur un onglet via `/grc?tab=governance`, `/grc?tab=risk` ou `/grc?tab=compliance`.

![GRC — onglet Gouvernance](../assets/img/fr/52_grc_gouvernance.png)

## Gouvernance

L'onglet Gouvernance se divise en deux **sous-onglets**, deep-linkables via `/grc?tab=governance&sub=principles` (par défaut) et `/grc?tab=governance&sub=decisions` :

### Principes

Navigateur en lecture seule des Principes EA publiés dans le métamodèle (énoncé, justification, implications). Le catalogue se modifie depuis **Administration → Métamodèle → Principes**.

### Décisions

![GRC — sous-onglet Décisions](../assets/img/fr/52a_grc_decisions.png)

Le sous-onglet Décisions est le **registre principal des Architecture Decision Records (ADR)** — chaque ADR à l'échelle du paysage, indépendamment de l'initiative à laquelle il est lié. Il remplace l'ancien onglet Décisions d'EA Delivery, dissous lors de l'arrivée du module GRC.

Les ADR documentent les décisions d'architecture importantes ainsi que leur contexte, conséquences et alternatives envisagées. Les décisions émises par l'assistant TurboLens Architect arrivent ici sous forme de brouillons à valider.

Le registre répond d'abord à une question : **quelles décisions sont en vigueur aujourd'hui ?** Chaque décision signée porte une [validité](#standing) que Turbo EA déduit de ses dates, de ses révisions et des autres décisions qui agissent sur elle, et la grille ne liste que la révision actuelle de chaque décision, sauf si vous demandez les révisions antérieures.

La grille peut aussi être **regroupée par statut** ou **par validité** via le bouton *Grouper par* à côté du champ de recherche : chaque statut ou validité se replie sous son propre en-tête, et la case de l'en-tête sélectionne tout le groupe pour un export groupé.

#### Statut et validité {: #standing }

Une décision a deux états distincts :

- Le **statut** est le workflow de signature, et c'est sur lui que vous agissez : **Brouillon** → **En revue** (signatures demandées) → **Signé**. Une décision prise en dehors de Turbo EA et [enregistrée comme décidée](#recording-a-past-decision) affiche **Enregistré** au lieu de Signé.
- La **validité** indique où en est aujourd'hui une décision signée ou enregistrée. Elle est déduite — jamais définie à la main — et un brouillon ou une décision en revue n'en a pas (*Pas encore signée*).

| Validité | Signification |
|----------|---------------|
| **Programmée** | Signée, mais sa date *En vigueur à partir du* n'est pas encore atteinte |
| **En vigueur** | Signée et applicable |
| **En vigueur (modifiée)** | En vigueur, et une autre décision signée la modifie ; la modification n'est pas encore intégrée dans une [révision consolidée](#amendments-and-consolidated-revisions) |
| **Remplacée** | Une révision ultérieure de la même décision, ou une décision qui la remplace, a pris effet |
| **Révoquée** | Une décision signée qui la révoque a pris effet |
| **Expirée** | Sa date *Valable jusqu'au* est dépassée (elle reste en vigueur jusqu'à ce jour inclus) |

La page de la décision en donne la raison dans un bandeau — *Cette décision a été remplacée par …*, *Cette décision entre en vigueur le …*, *La révision 3 entre en vigueur le …* — avec un lien vers la décision concernée.

#### Colonnes du tableau

La grille ADR reprend la disposition de la grille Inventaire :

| Colonne | Description |
|---------|-------------|
| **N° de réf.** | Numéro de référence généré automatiquement (ADR-001, ADR-002, …) avec un point de statut ; une révision après la première ajoute son numéro (ADR-012 · Rév. 2) |
| **Statut** | Puce colorée — Brouillon, En revue, Signé ou Enregistré |
| **Validité** | Où en est aujourd'hui une décision signée — voir [Statut et validité](#standing) ; vide tant qu'elle n'est pas signée |
| **Titre** | Titre de l'ADR |
| **Décision** | Extrait en texte brut de la décision |
| **Fiches liées** | Pilules colorées correspondant à la couleur du type de chaque fiche liée |
| **Créé par** | Auteur de l'ADR |
| **Créé** | Date de création |
| **Modifié** | Date de dernière modification |
| **Signé** | Date de signature |
| **Signé par** | Une pilule par signataire ayant signé |
| **Décidée le** / **En vigueur à partir du** / **Valable jusqu'au** | Les [dates](#decision-dates) de la décision |
| **Décideurs** | Les personnes qui ont pris la décision |

Chaque colonne dispose d'un **filtre d'en-tête** — filtres textuels sur les colonnes de texte, filtres de date sur les colonnes de date — chacun avec son propre bouton **Réinitialiser**. Dès qu'un filtre de colonne est actif, un bouton **Effacer les filtres de colonne** apparaît dans la barre d'outils de la grille pour tous les effacer d'un coup. La largeur, l'ordre et le tri des colonnes ainsi que les filtres actifs sont mémorisés par navigateur.

#### Barre latérale de filtres

La barre latérale persistante à gauche comporte deux onglets :

- **Filtres** — filtres à facettes sur la liste des ADR :
    - **En vigueur** — un clic n'affiche que les décisions en vigueur aujourd'hui (En vigueur et En vigueur (modifiée)) ; cliquez à nouveau pour l'effacer
    - **Afficher les révisions antérieures** — désactivé par défaut, de sorte que chaque décision apparaît une seule fois, sous sa révision actuelle (plus une révision en cours de rédaction). Activez-le pour lister aussi les révisions antérieures ; le bouton **Exporter** suit le même réglage
    - **Types de fiche** — cases à cocher avec des points colorés filtrant par types de fiches liées
    - **Fiches liées** — filtrer par fiches liées spécifiques
    - **Statut** — Brouillon / En revue / Signé (une décision enregistrée compte comme signée)
    - **Validité** — Programmée / En vigueur / En vigueur (modifiée) / Remplacée / Révoquée / Expirée / Pas encore signée
    - **Signé par** — filtrer par signataire
    - **Date de création** / **Date de modification** / **Date de signature** / **Date de décision** — plages de dates de/à (**Date de décision** porte sur la date *Décidée le* d'une décision signée ou enregistrée)
- **Colonnes** — choisir les colonnes visibles de la grille. **N° de réf.** et **Titre** sont toujours affichés ; **Réinitialiser** restaure la sélection par défaut. Votre choix est mémorisé par navigateur.

Utilisez la barre de **filtre rapide** pour une recherche en texte intégral. Faites un clic droit sur n'importe quelle ligne pour un menu contextuel (**Modifier**, **Aperçu**, **Dupliquer**, **Supprimer**).

#### Exporter et importer des décisions {: #decisions-import }

**Exporter** (à côté de **+ Nouvelle décision**) télécharge les décisions actuellement affichées par la barre latérale de filtres sous forme de fichier `.xlsx`, une ligne par révision de décision. Les colonnes, dans l'ordre : `reference_number`, `title`, `status`, `revision_number`, les quatre sections (`context`, `decision`, `consequences`, `alternatives_considered`) en texte brut, `cards` et `related_decisions` (séparées par des points-virgules), `author`, `signatories`, `signed_at`, `created_at`, `updated_at`, puis les données propres au registre — `standing` (sous forme de clé, par ex. `in_force`), `decided_on`, `effective_from`, `valid_until`, `decision_makers`, `participants`, et les liens typés `replaces`, `amends`, `revokes` et `consolidates` sous forme de références. La mise en forme (gras, liens, etc.) n'est pas reprise dans le tableur. Pour partager des décisions entièrement mises en forme, sélectionnez des lignes dans la grille et utilisez le bouton **Export** de la grille, qui produit un document Word.

**Importer** crée des décisions en masse à partir d'un fichier `.xlsx`. Cliquez sur **Télécharger le modèle** pour obtenir un classeur de départ, renseignez une décision par ligne et importez-le :

- Chaque ligne devient une nouvelle décision **brouillon** avec la prochaine référence `ADR-NNN`. Le statut et les signatures ne sont jamais importés — une décision est signée via le **workflow de signature** — et l'aperçu vous avertit d'une ligne dont le `status` n'est pas « draft ».
- Une ligne dont la `reference_number` appartient déjà à une décision est **ignorée** : l'import ne modifie jamais une décision existante, de sorte que réimporter un export ne change rien.
- `title` est obligatoire. Dans les quatre colonnes de section, une ligne vide commence un nouveau paragraphe, les lignes commençant par `- ` deviennent une liste à puces et celles commençant par `1. ` une liste numérotée.
- `cards` lie des fiches par leur nom exact, parmi les fiches que vous pouvez voir ; une fiche introuvable, ou dont le nom est partagé par plusieurs fiches, est ignorée avec un avertissement et la décision est tout de même importée.
- `related_decisions` liste des références, soit de décisions existantes, soit d'autres lignes du même fichier (y compris des lignes ultérieures) ; chacune devient un lien **Se rapporte à**. Une référence qui a plusieurs révisions pointe vers sa révision actuelle.
- Toutes les autres colonnes — validité, dates, personnes et liens typés compris — sont ignorées : un import crée des brouillons, jamais des décisions signées ou enregistrées.
- Un export contient une ligne par révision, si bien qu'un fichier peut porter plusieurs lignes pour une même référence (une révision ouverte, ou des révisions antérieures lorsque **Afficher les révisions antérieures** est activé). Sur l'instance d'où il provient, elles sont toutes ignorées ; ailleurs, seule la ligne ayant le `revision_number` le plus élevé est importée (la dernière ligne lorsque les numéros sont égaux ou absents) et chaque autre ligne est ignorée avec l'avertissement *Révision antérieure de ADR-012 ignorée*. Une entrée de `related_decisions` qui nomme cette référence pointe vers la ligne importée.

L'aperçu indique combien de lignes seront créées, ignorées et en échec, avec chaque erreur et avertissement listés par ligne ; rien n'est écrit tant que vous n'avez pas confirmé. L'import requiert la permission `adr.manage`.

#### Créer un ADR

Les ADR peuvent être créés depuis trois endroits — tous ouvrent le même éditeur et alimentent le même registre :

1. **GRC → Gouvernance → Décisions** : cliquez sur **+ Nouvel ADR**, remplissez le titre et liez optionnellement des fiches (y compris des initiatives).
2. **Espace de travail EA Delivery** : sélectionnez une initiative, puis cliquez sur **+ Nouvel artefact ▾** en haut de la page (ou **+ Ajouter** dans la section *Décisions d'architecture*) et choisissez **Nouvelle décision d'architecture** — l'initiative est pré-liée.
3. **Fiche → onglet Ressources** : cliquez sur **Créer ADR** — la fiche courante est pré-liée.

Dans tous les cas, vous pouvez rechercher et lier des fiches supplémentaires lors de la création. Les initiatives sont liées via le même mécanisme de liaison de fiches que toute autre fiche, ce qui permet à un ADR de référencer plusieurs initiatives. L'éditeur s'ouvre avec des sections pour **Contexte**, **Décision**, **Conséquences** et **Alternatives envisagées**.

#### L'éditeur ADR

L'éditeur offre :

- Édition de texte riche pour chaque section (Contexte, Décision, Conséquences, Alternatives envisagées)
- Liaison de fiches — connectez l'ADR aux fiches pertinentes (applications, composants IT, initiatives, …). Les initiatives sont liées via la fonctionnalité standard de liaison de fiches, et non via un champ dédié, ce qui permet à un ADR de référencer plusieurs initiatives
- **Dates** — *Décidée le*, *En vigueur à partir du* et un *Valable jusqu'au* facultatif (voir [Dates](#decision-dates))
- **Personnes** — les *Décideurs* et les *Participants* (voir [Personnes](#decision-people))
- **Cette décision…** — des liens typés vers d'autres décisions (voir [Liens entre décisions](#decision-links))
- **Résumé des modifications** — sur une révision uniquement : ce qui a changé dans cette révision, et pourquoi
- **Fichiers** — des documents joints à la décision (voir [Fichiers](#decision-files))

#### Dates {: #decision-dates }

- **Décidée le** — le jour où la décision a été prise. Il ne peut pas être dans le futur.
- **En vigueur à partir du** — le jour où elle prend effet. Jusque-là, une décision signée est **Programmée**.
- **Valable jusqu'au** — facultatif, pour une décision limitée dans le temps comme une dérogation. Le lendemain, la décision est **Expirée**. Cette date ne peut pas être antérieure à *En vigueur à partir du*, ni déjà passée lorsque la décision est envoyée pour revue.

Laissées vides, *Décidée le* et *En vigueur à partir du* prennent la date de la dernière signature. Le renouvellement d'une décision expirée est une nouvelle révision ou une nouvelle décision, signée comme toute autre.

#### Personnes {: #decision-people }

Les **Décideurs** sont les personnes qui ont pris la décision ; les **Participants** sont les personnes qui y ont pris part. Choisissez un utilisateur Turbo EA, ou saisissez un nom et appuyez sur Entrée pour une personne sans compte. Les deux sont enregistrés séparément des **signataires**, qui approuvent l'enregistrement dans Turbo EA. Lorsque vous demandez des signatures, **Ajouter des décideurs** dans la boîte de dialogue ajoute en un clic aux signataires chaque décideur qui est un utilisateur Turbo EA.

#### Liens entre décisions {: #decision-links }

La section **Cette décision…** d'une décision la lie à d'autres. Choisissez le type de lien et la décision, et ajoutez éventuellement une note pour un cas partiel — par exemple *section 3 uniquement* :

| Lien | Affiché sur l'autre décision comme | Effet une fois cette décision signée et applicable |
|------|------------------------------------|----------------------------------------------------|
| **Remplace** | Remplacée par | L'autre décision devient **Remplacée** |
| **Modifie** | Modifiée par | L'autre décision devient **En vigueur (modifiée)** |
| **Révoque** | Révoquée par | L'autre décision devient **Révoquée** |
| **Se rapporte à** | Liée à | Aucun — un renvoi |

Les liens sont affichés sur les deux décisions et pointent vers la révision actuelle de la décision. Ils agissent sur la décision entière, toutes ses révisions comprises, et seulement une fois que la décision qui les porte est signée et applicable : un brouillon qui en révoque une autre ne change rien tant qu'il n'est pas signé, et un brouillon avec une date *En vigueur à partir du* ultérieure agit à cette date (l'autre décision indique *Cette décision sera révoquée par … le …*). Une décision ne peut pas être liée à l'une de ses propres révisions, et chaque décision à laquelle elle est liée doit être signée avant qu'elle soit envoyée pour revue ou enregistrée.

#### Révoquer ou remplacer une décision {: #revoking-or-replacing-a-decision }

Une décision signée n'est jamais retirée à la main : elle est révoquée ou remplacée par une autre décision signée, de sorte que le registre conserve qui l'a prise et quand. Ouvrez la décision signée et utilisez le menu **Réviser** :

- **Réviser cette décision** — une nouvelle révision de la même décision, sous la même référence (voir [Révisions](#revisions)).
- **Remplacer par une nouvelle décision** — un nouveau brouillon intitulé *Remplace : …* qui porte déjà un lien **Remplace** et les mêmes fiches liées.
- **Révoquer** — un nouveau brouillon intitulé *Révocation de ADR-012 — …* qui porte déjà un lien **Révoque** et les mêmes fiches liées.

Complétez le nouveau brouillon et faites-le passer par le workflow de signature comme toute autre décision. Le menu n'est pas proposé sur une révision antérieure (ouvrez la révision actuelle) ni sur une décision déjà révoquée ou remplacée. Lorsqu'une décision signée en remplace, modifie ou révoque une autre, l'auteur de cette dernière reçoit une notification **Validité d'ADR modifiée**.

#### Modifications et révisions consolidées {: #amendments-and-consolidated-revisions }

Une décision modifiée par une autre reste en vigueur, et sa page liste les décisions qui la modifient. Pour offrir aux lecteurs un texte unique et à jour, cliquez sur **Créer une révision consolidée** dans ce bandeau : cela démarre une révision de la décision modifiée qui nomme la décision modificatrice (*Consolide la modification apportée par …*). Intégrez la modification au texte, décrivez-la dans le **Résumé des modifications** et envoyez la révision en signature. Une fois signée et applicable, la décision est de nouveau **En vigueur**, et la décision modificatrice affiche *La modification apportée par cette décision est consolidée dans …*. Une modification cesse aussi de compter dès que la décision modificatrice est révoquée, remplacée ou expire — mais pas lorsqu'elle est simplement révisée : sa révision conserve la modification, et le bandeau nomme la révision actuelle de la décision modificatrice.

#### Fichiers {: #decision-files }

La section **Fichiers** joint des documents à une décision — un procès-verbal signé, une analyse à l'appui. Les fichiers acceptent les mêmes formats que les [pièces jointes des fiches](card-details.md#onglet-ressources), jusqu'à 20 Mo chacun, et ne peuvent être téléversés que tant que le téléversement de fichiers est activé (la suppression reste toujours possible). Ils ne peuvent être ajoutés et supprimés que sur un brouillon enregistré : une fois la décision envoyée pour revue, ils sont verrouillés avec elle. Une révision reprend les fichiers de sa décision.

#### Workflow de signature

Les ADR prennent en charge un processus formel de signature :

1. Créez l'ADR avec le statut **Brouillon**.
2. Cliquez sur **Demander des signatures** et recherchez des signataires par nom ou e-mail (ou cliquez sur **Ajouter des décideurs**). Les signatures ne peuvent être demandées qu'à partir d'un brouillon.
3. L'ADR passe à **En revue** — chaque signataire reçoit une notification et une tâche.
4. Les signataires examinent et cliquent sur **Signer**.
5. Une fois que tous les signataires ont signé, l'ADR passe automatiquement au statut **Signé**.

**Une décision en revue est verrouillée**, afin que les signataires signent exactement ce qui leur a été envoyé : le texte, les dates, les personnes, les liens, les fichiers et les panneaux d'extension sont en lecture seule, et seules les fiches liées peuvent encore changer. Pour la modifier, cliquez sur **Rappeler les signatures**, ce qui la remet en brouillon. Un signataire qui clique sur **Rejeter** la remet également en brouillon, sous le même numéro de révision.

Les ADR signés sont verrouillés et ne peuvent pas être modifiés — pour apporter des changements, créez une nouvelle révision.

#### Enregistrer une décision passée {: #recording-a-past-decision }

Une décision prise en dehors de Turbo EA — lors d'un comité de direction antérieur à l'existence du registre, par exemple — peut être saisie comme décidée sans collecter de signatures. Rédigez-la comme brouillon, indiquez au moins un décideur, puis cliquez sur **Enregistrer comme décidée** et indiquez la date **Décidée le** (pas dans le futur) et, si elle diffère, la date **En vigueur à partir du** (par défaut, la date de décision).

La décision est alors verrouillée comme une décision signée et reçoit sa validité, mais son statut indique **Enregistré**, et sa page affiche *Enregistrée par … le …, non signée dans Turbo EA.* L'enregistrement requiert la permission `adr.record`, que seul le rôle Admin détient par défaut, et chaque enregistrement apparaît dans le [journal Sécurité et administration](../admin/audit-log.md) sous `admin.adr.recorded`. Un brouillon de révision peut aussi être enregistré, à condition que sa date de décision ne soit pas antérieure à celle de sa révision précédente.

#### Révisions

Ouvrez un ADR signé et choisissez **Réviser → Réviser cette décision** pour créer un nouveau brouillon basé sur la version signée. La révision conserve la référence de la décision et prend le numéro de révision suivant — **ADR-012 · Rév. 2** — et hérite du contenu, des fiches liées, des liens **Se rapporte à**, des personnes, des fichiers et de la date *Valable jusqu'au*. Elle n'hérite pas des dates de décision et d'entrée en vigueur, des signataires, du résumé des modifications ni des liens remplace / modifie / révoque, qui restent sur la révision qui les a créés. Chaque révision conserve sa propre trace de signature.

- **Une seule révision ouverte à la fois.** Tant qu'une révision est en cours de rédaction, la révision actuelle l'indique et le menu **Réviser** ouvre ce brouillon au lieu d'en démarrer un autre.
- **La révision actuelle est celle en vigueur.** Une fois qu'une révision est signée et applicable, les précédentes sont **Remplacées** et affichent un bandeau avec un lien vers la révision actuelle. La barre **Révisions** de chaque révision liste toute la chaîne et signale la révision actuelle.
- **Seule la révision actuelle peut être révisée**, et plus du tout une fois la décision révoquée ou remplacée. Une décision expirée ou modifiée peut toujours être révisée.
- **Un rejet ne compte pas comme une révision** : le numéro de révision ne change que lorsqu'une nouvelle révision est créée.
- Les décisions révisées avant la version 2.199.0 conservent les numéros de référence sous lesquels elles ont été émises, et se lisent toujours comme une seule décision avec une seule barre de révisions.

#### Aperçu

Cliquez sur l'icône d'aperçu pour afficher une version en lecture seule et formatée de l'ADR — utile pour la revue avant signature.

Depuis l'aperçu, cliquez sur **PDF** pour ouvrir une copie prête à imprimer dans un nouvel onglet — métadonnées et dates, les quatre sections, personnes, fiches liées, liens vers d'autres décisions, noms de fichiers, sections d'extension et bloc de signatures (ou la mention d'enregistrement), avec l'approbateur et la date d'impression en pied de page. L'éditeur propose le même bouton **PDF** ainsi que **Word**, qui télécharge la décision au format `.docx` tant qu'elle n'est pas signée ; les deux exportent l'état courant de l'éditeur, modifications non enregistrées comprises.

## Risque

![GRC — Registre des risques](../assets/img/fr/53_grc_registre_risques.png)

Intègre le **Registre des risques** TOGAF Phase G. Le cycle de vie complet, le workflow de statut, les bascules de matrice et le comportement des propriétaires sont documentés dans le [guide du Registre des risques](risks.md). L'essentiel :

## Conformité

![GRC — Registre de conformité](../assets/img/fr/54_grc_conformite.png)


L'onglet Conformité est un registre à deux sources — les constats peuvent être **saisis manuellement** par un examinateur **ou** produits par un **scan IA** à la demande contre les réglementations activées (EU AI Act, RGPD, NIS2, DORA, SOC 2, ISO 27001 sont activées par défaut). Les deux types de constats partagent le même cycle de vie, peuvent être promus en Risque et bulk-actionnés depuis la grille. Voir le [guide Conformité](compliance.md) pour le cycle de vie complet, le dialogue de création manuelle, le workflow de scan, le détecteur sémantique EU AI Act et la boucle de promotion en Risque.

Le même onglet Conformité apparaît aussi sur le Détail de la fiche (auto-masqué quand la fiche n'a pas de constats liés), de sorte qu'un Application Owner peut trier ses constats sans quitter la fiche.

## Permissions

| Permission | Rôles par défaut |
|------------|------------------|
| `grc.view` | admin, bpm_admin, member, viewer |
| `grc.manage` | admin, bpm_admin, member |
| `adr.view` / `adr.manage` / `adr.sign` | `adr.view` : admin, bpm_admin, member, viewer ; `adr.manage` et `adr.sign` : admin, bpm_admin, member |
| `adr.record` | admin — [enregistrer une décision passée comme décidée](#recording-a-past-decision) |
| `risks.view` / `risks.manage` | voir [Registre des risques § Permissions](risks.md) |
| `compliance.view` / `compliance.manage` | voir [TurboLens § Security & Compliance](turbolens.md) |

`grc.view` contrôle la visibilité de la route GRC elle-même — sans elle, l'entrée du menu supérieur est masquée. Chaque onglet impose en plus sa permission propre au domaine, de sorte qu'un visualiseur peut consulter le registre sans pouvoir déclencher un scan LLM, par exemple.
