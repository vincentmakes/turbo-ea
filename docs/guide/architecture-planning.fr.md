# Planification d’architecture

La planification d’architecture est un outil de planification manuel dans **EA Delivery** pour modéliser les changements de votre paysage — remplacer une application par une autre pour une organisation donnée, décommissionner un système hérité ou introduire une nouvelle plateforme — et les communiquer sous la forme d’un **unique diagramme avant/après**. Elle offre un résultat similaire au TurboLens Architect, mais sans aucune IA : vous gardez le contrôle total de chaque changement proposé.

Le résultat est une Layered Dependency View montrant l’état actuel et l’état planifié dans une seule image, avec des indicateurs de changement :

- **Croix rouge** — une carte ou une relation marquée pour suppression
- **Plus vert** — une carte ou une relation nouvellement ajoutée
- **Flèches d’échange bleues** — un remplacement : la carte successeur et les connexions dont elle hérite

## Créer un plan

Ouvrez **EA Delivery** et utilisez **Ajouter → Nouveau plan d’architecture** sur une initiative (ou créez un plan non lié et rattachez-le plus tard). Un plan se construit en quatre étapes :

1. **Objectifs métier** *(optionnel)* — nommez les cartes Objectif que ce changement soutient. Elles apparaissent dans la couche Stratégie du diagramme, afin que chaque partie prenante voie le *pourquoi* à côté du *quoi*, et elles préremplissent les liens de l’initiative lors de la validation du plan.
2. **Périmètre et référence** — choisissez une ou plusieurs cartes de périmètre (une organisation, une capacité métier, des applications individuelles, …) et une profondeur de dépendances (1–3). **Capturer la référence** prend un instantané du paysage environnant comme image « avant ». L’instantané garde le diagramme stable même si l’inventaire évolue ; utilisez **Actualiser la référence** pour la recapturer plus tard — tout changement planifié dont la cible a disparu est signalé.
3. **Changements planifiés** — appliquez des opérations de changement depuis la boîte à outils :
    - **Ajouter une carte** — amenez une carte existante dans l’image, ou proposez-en une entièrement nouvelle (nom + type).
    - **Retirer une carte** — marquez une carte pour décommissionnement. Ses connexions passent au rouge.
    - **Remplacer une carte** — choisissez la carte à remplacer et son successeur (existant ou proposé). Le successeur hérite des relations du prédécesseur, affichées comme des arêtes d’échange bleues ; coupez individuellement les relations héritées avec **Retirer une relation**.
    - **Ajouter / retirer une relation** — tracez de nouvelles connexions ou coupez des connexions existantes. Les types de relation sont validés contre le métamodèle.
4. **Aperçu en direct** — le diagramme avant/après fusionné se met à jour au fil de la planification. Enregistrez le plan à tout moment ; il apparaît dans la section **Livrables** de l’initiative.

## Comprendre les conséquences

La planification d’architecture est plus qu’un éditeur de diagramme — pendant que vous planifiez, un panneau **Conséquences** rend l’impact architectural visible. Les mêmes chiffres apparaissent sur l’aperçu partageable et sont intégrés à l’ADR validé :

- **Analyse des écarts** — un récapitulatif façon TOGAF Ajouté / Retiré / Modifié / Conservé.
- **Impact / rayon d’effet** — retirer ou remplacer une carte fait apparaître ce qui en dépend (« *N applications, M interfaces en dépendent* »), à partir de l’analyse d’impact de la carte.
- **Lacunes de couverture des capacités** — si une capacité métier perd *toutes* ses applications de support dans l’état cible, elle est signalée.
- **Écarts de coût et de risque** — le coût annuel estimé avant → après (avec l’écart) et le nombre de risques ouverts sur les cartes concernées. Les cartes proposées apportent leur coût estimé, également inscrit sur la carte créée lors de la validation.

## Valider un plan

Un plan en brouillon peut être **validé** (nécessite la permission *Valider les plans d’architecture*). La validation :

- crée une carte **Initiative** (avec le nom et les dates de début/fin choisis), liée aux objectifs soutenus,
- crée les **cartes proposées** et **relations** sélectionnées, en liant chaque nouvelle carte à l’initiative,
- appose une date de **fin de vie** (la date de fin de l’initiative) sur les cartes retirées et remplacées, afin que les rapports de cycle de vie et les feuilles de route reflètent le plan,
- crée éventuellement un **brouillon d’Architecture Decision Record** documentant chaque changement — y compris les relations coupées, qui sont seulement documentées et jamais supprimées.

!!! note
    La validation n’archive ni ne supprime jamais rien. Les cartes retirées reçoivent une date de fin de vie ; leur décommissionnement effectif reste une étape humaine délibérée via les flux d’inventaire habituels.

Après la validation, le plan devient en lecture seule et pointe vers l’initiative créée.

## Permissions

| Permission | Accorde |
|------------|---------|
| `arch_plans.view` | Voir les plans d’architecture |
| `arch_plans.manage` | Créer, modifier et supprimer des plans |
| `arch_plans.commit` | Valider un plan (créer l’initiative, les cartes, les relations, le brouillon d’ADR, apposer les dates de fin de vie) |

Les membres peuvent voir, gérer et valider les plans par défaut ; les observateurs peuvent uniquement les consulter.
