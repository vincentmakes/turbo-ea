# Portails web

La fonctionnalité **Portails web** (**Admin > Paramètres > Portails web**) vous permet de créer des **vues publiques en lecture seule** de données de fiches sélectionnées -- accessibles sans authentification via une URL unique.

## Cas d'utilisation

Les portails web sont utiles pour partager des informations d'architecture avec des parties prenantes qui n'ont pas de compte Turbo EA :

- **Catalogue technologique** -- Partager le paysage applicatif avec les utilisateurs métier
- **Annuaire de services** -- Publier les services IT et leurs responsables
- **Carte de capacités** -- Fournir une vue publique des capacités métier

## Création d'un portail

1. Naviguez vers **Admin > Paramètres > Portails web**
2. Cliquez sur **+ Nouveau portail**
3. Configurez le portail :

| Champ | Description |
|-------|-------------|
| **Nom** | Nom d'affichage du portail |
| **Slug** | Identifiant compatible URL (généré automatiquement à partir du nom, modifiable). Le portail sera accessible à `/portal/{slug}` |
| **Type de fiche** | Quel type de fiche afficher |
| **Sous-types** | Optionnellement restreindre à des sous-types spécifiques |
| **Afficher le logo** | Si le logo de la plateforme doit être affiché sur le portail |

## Configuration de la visibilité

Pour chaque portail, vous contrôlez exactement quelles informations sont visibles. Il y a deux contextes :

### Propriétés de la vue liste

Quelles colonnes/propriétés apparaissent dans la liste des fiches :

- **Propriétés intégrées** : description, cycle de vie, tags, qualité des données, statut d'approbation
- **Champs personnalisés** : Chaque champ du schema du type de fiche peut être activé/désactivé individuellement

### Propriétés de la vue détail

Quelles informations apparaissent lorsqu'un visiteur clique sur une fiche :

- Mêmes contrôles de bascule que la vue liste, mais pour le panneau de détail développé

## Accès au portail

Les portails sont accessibles à :

```
https://votre-domaine-turbo-ea/portal/{slug}
```

Aucune connexion n'est requise. Les visiteurs peuvent parcourir la liste des fiches, rechercher et consulter les détails des fiches -- mais seules les propriétés que vous avez activées sont affichées.

!!! note
    Les portails sont en lecture seule. Les visiteurs ne peuvent pas modifier, commenter ou interagir avec les fiches. Les données sensibles (parties prenantes, commentaires, historique) ne sont jamais exposées sur les portails.
