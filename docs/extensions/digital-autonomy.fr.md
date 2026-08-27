# Digital Autonomy Assessment

**Digital Autonomy Assessment** apporte dans Turbo EA le **Digital Autonomy
Assessment Framework (DAAF)** de l'université d'Utrecht, au niveau des
applications. L'extension ajoute une section **Autonomie numérique** à chaque
carte Application — 22 indicateurs pondérés répartis entre exposition au risque,
capacité d'atténuation et importance stratégique, chacun noté de 1 à 5 selon la
grille d'origine du DAAF, avec une aide contextuelle —, calcule automatiquement
un score d'autonomie de 1 à 10 et place l'ensemble de votre portefeuille sur un
**quadrant d'autonomie**.

Elle répond à une question que la plupart des cartographies laissent ouverte :
*si ce fournisseur devenait indisponible, inabordable ou juridiquement
inutilisable demain, quelle serait notre exposition et que pourrions-nous
réellement faire ?*

## En bref

| | |
|---|---|
| **Licence** | **Gratuite** — fonctionne sans aucun droit de licence |
| **Version minimale de Turbo EA** | 2.17.0 |
| **Permission** | `ext.digital-autonomy.view` |
| **Autorisations d'accès aux données** | aucune |
| **Redémarrage du backend requis** | non |
| **Où elle apparaît** | Sections **Autonomie numérique** et **Score d'autonomie numérique** sur les cartes Application · **Rapports → Autonomie numérique** · **Nouveau depuis un modèle** sur la page des enquêtes |

## Premiers pas

1. Installez l'extension depuis **Admin → Extensions**. Aucune licence à
   appliquer, aucun redémarrage : les champs apparaissent immédiatement.
2. Attribuez `ext.digital-autonomy.view` dans **Admin → Utilisateurs et rôles**
   aux rôles qui doivent voir le rapport. Les administrateurs l'ont déjà.
3. Choisissez entre l'évaluation **rapide** et l'évaluation **complète** — voir
   [Évaluation rapide ou complète](#evaluation-rapide-ou-complete). La version
   complète à 22 indicateurs est active par défaut.
4. Évaluez vos applications, carte par carte ou
   [par enquête](#collecter-les-evaluations-par-enquete).

## Les indicateurs

La section **Autonomie numérique** apparaît sur chaque carte Application,
regroupée en huit dimensions (A–H). Chaque indicateur se note de **1 à 5** selon
sa propre grille.

![La section « Autonomie numérique » sur une carte Application](../assets/img/en/65_ext_digital_autonomy_indicators.png)

Cliquez sur un chiffre pour noter ; cliquez de nouveau sur le chiffre retenu pour
effacer la note. Le survol d'un chiffre affiche le texte de la grille pour ce
niveau, et chaque indicateur propose une **aide** dépliable reprenant la note
explicative du DAAF et la définition des termes employés (*décision
d'adéquation*, *CLOUD Act*, *FISA 702*, etc.).

Les indicateurs marqués **Rapide** composent l'évaluation rapide.

| Dimension | Indicateur | Poids | Rapide |
|---|---|---|---|
| **A · Risque géopolitique et de conformité juridique** | A1 · Juridiction du fournisseur | 3 | ✔ |
| | A2 · Sanctions et risque géopolitique | 2 | |
| | A3 · Hébergement et localisation des données | 2 | ✔ |
| **B · Dépendances fournisseur et chaîne d'approvisionnement** | B1 · Concentration fournisseur | 3 | ✔ |
| **C · Résilience technique** | C1 · Alternative disponible | 3 | ✔ |
| | C2 · Migrabilité | 3 | |
| | C3 · Portabilité des données | 3 | |
| | C4 · Gestion du chiffrement | 2 | |
| | C5 · Transparence et ouverture du logiciel | 3 | |
| **D · Résilience organisationnelle** | D1 · Expertise interne et continuité des connaissances | 3 | ✔ |
| | D2 · Plan de sortie en place | 3 | |
| | D3 · Stratégie de sauvegarde | 2 | |
| **E · Résilience contractuelle** | E1 · Clauses de sortie et modalités de transition | 3 | ✔ |
| | E2 · Souplesse contractuelle | 2 | |
| **F · Importance organisationnelle** | F1 · Impact d'une interruption | 3 | ✔ |
| | F2 · Dépendances d'intégration | 2 | |
| **G · Sensibilité des données, gestion des accès et politique** | G1 · Données personnelles | 3 | ✔ |
| | G2 · Données de recherche et sécurité des connaissances | 3 | |
| | G3 · Propriété intellectuelle | 2 | |
| **H · Impact académique** | H1 · Liberté académique | 3 | ✔ |
| | H2 · Collaboration de recherche | 2 | |
| | H3 · Archivage à long terme | 2 | |

!!! note "Quel sens est le bon ?"
    Les grilles ne sont pas toutes orientées de la même façon, et le composant
    les colore en conséquence. Pour les indicateurs de **risque** (A, B, F, G, H),
    **1 est le meilleur** — le niveau 1 de A1 est par exemple « Juridiction
    UE/EEE. Aucune revendication extraterritoriale. Protection UE complète. » et
    le niveau 5 « Aucune décision d'adéquation, aucune garantie. Accès direct par
    des gouvernements étrangers. » Pour les indicateurs de **capacité**
    (C, D, E), **5 est le meilleur**. Vous n'avez rien à retenir : les boutons
    sont gradués en couleur et légendés **Faible** et **Élevé**.

## Le score

La section en lecture seule **Score d'autonomie numérique** se trouve sous les
indicateurs et se recalcule automatiquement à chaque enregistrement.

![Le score d'autonomie numérique calculé sur une carte Application](../assets/img/en/64_ext_digital_autonomy_score.png)

| Champ | Signification |
|---|---|
| **Exposition au risque** | Moyenne pondérée des dimensions A (géopolitique) et B (concentration fournisseur) |
| **Capacité d'atténuation** | Moyenne pondérée des résiliences technique (C), organisationnelle (D) et contractuelle (E) |
| **Importance stratégique** | Moyenne pondérée de F (importance organisationnelle), G (sensibilité des données) et H (impact académique) |
| **Score d'autonomie** | Un chiffre unique de 1 à 10, affiché sous forme de jauge |

**Plus c'est élevé, mieux c'est** — 10 est optimal, 1 est urgent.

!!! warning "Une évaluation partielle ne produit aucun score"
    Toutes les formules sont protégées : s'il manque ne serait-ce qu'un
    indicateur nécessaire, le score reste vide plutôt que d'afficher un chiffre
    trompeur. Une application n'apparaît sur le rapport de quadrant qu'une fois
    son évaluation complète.

Comme les scores sont stockés sur la carte comme n'importe quel autre champ, ils
sont disponibles partout : inventaire, filtres, exports et vos propres rapports.

## Évaluation rapide ou complète

L'extension fournit **deux variantes des mêmes quatre calculs** — l'une lit les
22 indicateurs, l'autre uniquement les neuf de l'évaluation rapide. La paire
**active** détermine à la fois ce qui est calculé *et* le nombre d'indicateurs
affichés sur la carte.

Basculez depuis **Admin → Métamodèle → Calculations** :

- **Évaluation complète (par défaut)** — les quatre lignes
  *Digital Autonomy — … (full)* sont actives, les lignes *(quick)* inactives. Les
  cartes affichent les 22 indicateurs.
- **Évaluation rapide** — activez les quatre lignes *Digital Autonomy — …
  (quick)* et désactivez les quatre lignes *(full)*. Les cartes n'affichent que
  les neuf indicateurs rapides, et le score en découle.

!!! tip "Il n'y a pas de bascule d'affichage séparée"
    Ce choix unique dans les calculs constitue tout le commutateur. La carte
    masque automatiquement les 13 indicateurs propres à l'évaluation complète dès
    que le jeu rapide est actif, et le rapport suit le même réglage. N'activez
    jamais les deux variantes en même temps : elles écrivent dans les mêmes
    champs.

## Collecter les évaluations par enquête

Plutôt que de renseigner vous-même 22 indicateurs pour chaque application,
adressez-vous à celles et ceux qui savent. Sur **Admin → Enquêtes**, utilisez
**Nouveau depuis un modèle** :

- **New DAAF survey — Quick (9)** crée le brouillon *DAAF Quick Scan*.
- **New DAAF survey — Full (22)** crée le brouillon *DAAF Full Assessment*.

Les deux ciblent les cartes Application et s'ouvrent en **brouillon** dans
l'éditeur d'enquêtes : rien n'est envoyé avant votre relecture. Choisissez le
rôle de partie prenante destinataire (et d'éventuels filtres — une phase de cycle
de vie, un sous-type), puis envoyez. Les répondants retrouvent le même composant
de notation 1–5 et la même aide contextuelle que sur la carte ; l'application des
réponses réécrit les scores sur les cartes.

Vous pouvez générer une nouvelle enquête depuis un modèle aussi souvent que vous
le souhaitez — une réévaluation annuelle ne demande qu'un clic.

## Le rapport de quadrant d'autonomie

**Rapports → Autonomie numérique** représente chaque application entièrement
évaluée.

![Le rapport « Quadrant d'autonomie »](../assets/img/en/63_ext_digital_autonomy_quadrant.png)

L'axe horizontal est **risque × importance stratégique**, l'axe vertical la
**capacité d'atténuation** (élevée en haut), d'où quatre quadrants :

| Quadrant | Signification | Que faire |
|---|---|---|
| **Optimal** | Faible exposition, atténuation solide | Maintenir et surveiller périodiquement. |
| **Gérable** | Forte exposition, mais repli solide | Risques acceptés avec un repli solide. |
| **Attention** | Faible exposition, atténuation faible | Construire l'atténuation ou accepter le risque délibérément. |
| **Critique** | Forte exposition, atténuation faible | Action urgente : migrer ou atténuer. |

Chaque point est numéroté et correspond à une ligne de la liste située à côté du
graphique, **classée par score croissant — les plus urgents d'abord**. Un clic sur
un point ou une ligne ouvre l'application dans un panneau latéral sans quitter le
rapport.

**Filtres et axes**

- Les sélecteurs **Exposition au risque**, **Capacité d'atténuation** et
  **Importance stratégique** permettent de placer d'autres champs numériques sur
  chaque axe — utile si vous entretenez vos propres équivalents. Votre choix est
  mémorisé dans le navigateur.
- **Cycle de vie** et **Sous-type** restreignent la population.

Le rapport se sauvegarde, se partage, s'imprime et s'exporte comme d'habitude.
Une vue enregistrée apparaît dans **Rapports → Enregistrés**.

## Permissions

| Permission | Autorise |
|---|---|
| `ext.digital-autonomy.view` | Voir le rapport **Rapports → Autonomie numérique** |

La notation des indicateurs s'appuie sur vos droits normaux de **modification**
des cartes Application : qui peut modifier une application peut la noter. Le
basculement entre évaluation rapide et complète, ainsi que la création d'enquêtes
depuis les modèles, relèvent des droits administrateur habituels sur les
**Calculations** et les **Enquêtes**.

## Si l'extension est désactivée ou supprimée

La désactivation ou la désinstallation retire les deux sections du type de carte
mais **ne touche jamais aux valeurs enregistrées sur vos cartes**. Réactivez
l'extension et chaque score réapparaît à l'identique. Les champs sont fusionnés de
façon additive : les champs que vos administrateurs ont eux-mêmes ajoutés dans ces
sections sont également préservés.

## Langues

Les libellés d'indicateurs, les questions, les grilles et l'aide sont fournis en
**anglais, allemand, français, espagnol, italien et danois**. En portugais,
chinois, russe et arabe, le contenu du référentiel revient à l'anglais — le
référentiel d'origine ne propose pas ces langues.

## Attribution et licence

Cette extension reproduit le **Digital Autonomy Assessment Framework (DAAF)**,
créé à l'**université d'Utrecht** par **Tim van Neerbos** (Lead Enterprise
Architect) dans le cadre du projet Digital Autonomy.

- Source : <https://github.com/utrechtuniversity/digital-autonomy-assessment-tool>
- Outil d'origine : <https://utrechtuniversity.github.io/digital-autonomy-assessment-tool/>
- Licence : **Creative Commons Attribution – Pas d'Utilisation Commerciale –
  Partage dans les Mêmes Conditions 4.0 International (CC BY-NC-SA 4.0)** —
  <https://creativecommons.org/licenses/by-nc-sa/4.0/>
- © 2026 Universiteit Utrecht — Tim van Neerbos

**Des modifications ont été apportées.** Les indicateurs, pondérations, grilles,
notes d'aide et la notation de 1 à 10 du référentiel ont été adaptés pour
fonctionner nativement dans Turbo EA au niveau de la carte Application — un type
de champ de notation 1–5 dédié, les calculs de niveaux et de score, les modèles
d'enquête et le rapport de quadrant d'autonomie.

Les traductions multilingues des grilles et de l'aide proviennent du projet DAAF
(réalisées avec le concours de **Thomas Steenbergen, SIVON** ; l'allemand, le
français, l'espagnol, l'italien et le danois sont, selon la source, produits au
mieux et n'ont pas encore été relus par des locuteurs natifs).

Conformément à la clause **Pas d'Utilisation Commerciale**, cette extension est
distribuée **gratuitement**, et conformément au **Partage dans les Mêmes
Conditions**, le contenu DAAF adapté qu'elle embarque reste sous licence
CC BY-NC-SA 4.0.
