# Gestion de Portefeuille de Projets (PPM)

Le module **PPM** fournit une solution complète de gestion de portefeuille de projets pour le suivi des initiatives, budgets, risques, tâches et calendriers. Il s'intègre directement avec le type de carte Initiative pour enrichir chaque projet avec des rapports de statut, un suivi des coûts et une visualisation Gantt.

!!! note
    Le module PPM peut être activé ou désactivé par un administrateur dans les [Paramètres](../admin/settings.md). Lorsqu'il est désactivé, la navigation et les fonctionnalités PPM sont masquées.

## Tableau de Bord du Portefeuille

Le **Tableau de Bord du Portefeuille** est le point d'entrée principal pour PPM. Il fournit :

- **Cartes KPI** — Total des initiatives, budget total, coût réel total et résumés de l'état de santé
- **Graphiques circulaires de santé** — Distribution de la santé du calendrier, des coûts et du périmètre (En cours / À risque / Hors piste)
- **Distribution des statuts** — Répartition par sous-type d'initiative et statut
- **Aperçu Gantt** — Barres de chronologie montrant les dates de début et de fin de chaque initiative, avec des indicateurs de santé RAG

### Regroupement et filtrage

Utilisez la barre d'outils pour :

- **Regrouper par** tout type de carte lié (p. ex., Organisation, Plateforme)
- **Filtrer par sous-type** (Idée, Programme, Projet, Épique)
- **Rechercher** par nom d'initiative

Ces filtres sont conservés dans l'URL, donc l'actualisation de la page conserve votre vue actuelle.

## Vue Détaillée de l'Initiative

Cliquez sur n'importe quelle initiative pour ouvrir sa page de détail avec sept onglets :

### Onglet Vue d'Ensemble

La vue d'ensemble montre un résumé de la santé et des finances de l'initiative :

- **Résumé de santé** — Indicateurs de calendrier, coût et périmètre du dernier rapport de statut
- **Budget vs. Réel** — Carte KPI combinée montrant le budget total et les dépenses réelles avec écart
- **Activité récente** — Résumé du dernier rapport de statut

### Onglet Rapports de Statut

Les rapports de statut mensuels suivent la santé du projet au fil du temps. Chaque rapport comprend :

| Champ | Description |
|-------|-------------|
| **Date du rapport** | La date de la période de rapport |
| **Santé du calendrier** | En cours, À risque ou Hors piste |
| **Santé des coûts** | En cours, À risque ou Hors piste |
| **Santé du périmètre** | En cours, À risque ou Hors piste |
| **Résumé** | Résumé exécutif du statut actuel |
| **Réalisations** | Ce qui a été accompli pendant cette période |
| **Prochaines étapes** | Activités planifiées pour la prochaine période |

### Onglet Budget et Coûts

Suivi des données financières avec deux types de lignes :

- **Lignes de budget** — Budget planifié par année fiscale et catégorie (CapEx / OpEx). Les lignes budgétaires sont regroupées selon le **mois de début de l'exercice fiscal** configuré dans les [Paramètres](../admin/settings.md#début-de-lexercice-fiscal). Par exemple, si l'exercice fiscal commence en avril, une ligne budgétaire de juin 2026 appartient à l'EF 2026–2027
- **Lignes de coût** — Dépenses réelles avec date, description et catégorie

Les totaux de budget et de coûts sont automatiquement agrégés dans les attributs `costBudget` et `costActual` de la carte Initiative.

### Onglet Gestion des Risques

Le registre des risques suit les risques du projet avec :

| Champ | Description |
|-------|-------------|
| **Titre** | Brève description du risque |
| **Probabilité** | Score de probabilité (1–5) |
| **Impact** | Score d'impact (1–5) |
| **Score de risque** | Calculé automatiquement comme probabilité x impact |
| **Statut** | Ouvert, En atténuation, Atténué, Fermé ou Accepté |
| **Atténuation** | Actions d'atténuation planifiées |
| **Responsable** | Utilisateur responsable de la gestion du risque |

### Onglet Tâches

Le gestionnaire de tâches prend en charge les vues **tableau Kanban** et **liste** avec quatre colonnes de statut :

- **À faire** — Tâches pas encore commencées
- **En cours** — Tâches en cours de réalisation
- **Terminé** — Tâches terminées
- **Bloqué** — Tâches qui ne peuvent pas progresser

Les tâches peuvent être filtrées et regroupées par élément de Structure de Découpage du Travail (WBS).

Les filtres d'affichage (mode de vue, filtre WBS, bascule de regroupement) sont conservés dans l'URL entre les actualisations de page.

### Onglet Gantt

Le diagramme de Gantt visualise le calendrier du projet avec :

- **Lots de travaux (WBS)** — Éléments hiérarchiques de structure de découpage du travail avec dates de début/fin
- **Tâches** — Barres de tâches individuelles liées aux lots de travaux
- **Jalons** — Dates clés marquées par des indicateurs en losange
- **Barres de progression** — Pourcentage d'achèvement visuel, ajustable par glisser-déposer
- **Repères trimestriels** — Grille de chronologie pour l'orientation

### Onglet Détails de la Carte

Le dernier onglet affiche la vue complète des détails de la carte, y compris toutes les sections standard.

## Structure de Découpage du Travail (WBS)

La WBS fournit une décomposition hiérarchique du périmètre du projet :

- **Lots de travaux** — Regroupements logiques de tâches avec dates de début/fin et suivi de l'achèvement
- **Jalons** — Événements significatifs ou points d'achèvement
- **Hiérarchie** — Relations parent-enfant entre les éléments WBS
- **Auto-achèvement** — Le pourcentage d'achèvement est automatiquement calculé à partir des ratios de tâches terminées/totales, puis cumulé récursivement à travers la hiérarchie WBS jusqu'aux éléments parents. Le taux d'achèvement du niveau supérieur représente la progression globale de l'initiative

## Intégration avec les détails de la fiche

Lorsque le PPM est activé, les fiches **Initiative** affichent un onglet **PPM** en dernière position dans la [vue détaillée de la fiche](card-details.md). Cliquer sur cet onglet ouvre directement la vue détaillée PPM de l'initiative (onglet Aperçu). Cela offre un point d'accès rapide depuis n'importe quelle fiche Initiative vers sa page de projet PPM complète.

Inversement, l'onglet **Détails de la fiche** dans la vue détaillée PPM de l'initiative affiche les sections standard sans l'onglet PPM, évitant ainsi une navigation circulaire.

## Permissions

| Permission | Description |
|-----------|-------------|
| `ppm.view` | Voir le tableau de bord PPM, le diagramme de Gantt et les rapports d'initiatives. Accordé à tous les rôles par défaut |
| `ppm.manage` | Créer et gérer les rapports de statut, tâches, coûts, risques et éléments WBS. Accordé aux rôles Admin, Admin BPM et Membre |
| `reports.ppm_dashboard` | Voir le tableau de bord du portefeuille PPM. Accordé à tous les rôles par défaut |
