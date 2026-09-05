# Extensions

Les **extensions** ajoutent des fonctionnalités à Turbo EA sans modifier le
cœur — contenu de métamodèle supplémentaire, intégrations avec les outils que vos
équipes utilisent déjà, reporting réglementaire et pages entièrement nouvelles.
Elles sont conçues et signées par Turbo EA et s'installent depuis
**Admin → Extensions**.

Cette section décrit *ce que fait* chaque extension publiée et comment l'utiliser.
Pour le fonctionnement de la boutique elle-même — confiance et signatures,
licences, identifiants d'instance, installation, mises à jour et périodes
d'essai — voir [Administration → Boutique d'extensions](../admin/extensions.md).

## Extensions disponibles

### Stratégie, planification & transformation

| Extension | Rôle | Licence |
|-----------|------|---------|
| [Digital Autonomy Assessment](digital-autonomy.md) | Évalue chaque application selon le Digital Autonomy Assessment Framework de l'université d'Utrecht — 22 indicateurs pondérés, un score d'autonomie automatique de 1 à 10 et un quadrant risque/atténuation | **Gratuite** |
| [EA Value Tracker](value-savings.md) | Transforme les décisions d'architecture en registre financier auditable : économies déclarées par catégorie, approbation de la réalisation à quatre yeux et tableau de bord de la valeur | Commerciale |
| [Roadmap Studio](roadmap-studio.md) | Planifie des futurs alternatifs du paysage sous forme de scénarios, parcourt les paliers de transition, les compare sur le coût et l'exposition à la fin de vie, et les mène de la revue à la décision d'un comité | Commerciale |
| [Automations](automations.md) | Exécute des règles de gouvernance composées à partir de listes déroulantes — quand une fiche, une relation ou une tâche change ou qu'un planning se déclenche, si des conditions sont remplies, alors définir des champs, des étiquettes et des rôles, créer des tâches, signaler des risques, déposer des brouillons de décision, notifier des personnes ou appeler un webhook — chaque exécution étant un lot d'audit que l'on peut annuler | Commerciale |

### Intégrations

| Extension | Rôle | Licence |
|-----------|------|---------|
| [Jira Todo Sync](jira-todos.md) | Maintient les todos Turbo EA et un projet Jira Cloud alignés dans les deux sens — statut, titre, échéance et personne assignée | Commerciale |
| [Slack Notifications](slack-notify.md) | Remet à chaque personne ses notifications Turbo EA sous forme de message direct Slack, avec adhésion volontaire par personne et par type | Commerciale |

### Réglementations

| Extension | Rôle | Licence |
|-----------|------|---------|
| [DORA Register of Information](dora-roi.md) | Tient le registre d'informations DORA (art. 28) sur vos fiches existantes et exporte le paquet de soumission officiel xBRL-CSV | Commerciale |

## Ce que toutes les extensions ont en commun

- **Signées par l'éditeur.** Chaque paquet porte une signature Ed25519 que
  Turbo EA vérifie au téléversement *et* à chaque démarrage du backend. Ce qui
  s'installe est exactement ce que l'éditeur a produit.
- **Soumises à licence à l'exécution** (sauf les extensions gratuites). Si une
  licence expire, l'extension est désactivée en douceur — ses pages disparaissent
  et ses tâches de fond s'arrêtent — mais **vos données ne sont jamais
  supprimées**. Une licence renouvelée rétablit tout.
- **Moindre privilège.** Tout ce qu'une extension lit ou écrit au-delà de ses
  propres données est déclaré comme **autorisation** dans le paquet signé, donc
  visible avant l'installation. Voir
  [Autorisations d'accès aux données](../admin/extensions.md).
- **Ses propres permissions.** Chaque extension définit des clés de permission de
  la forme `ext.<nom>.…` qui apparaissent dans **Admin → Utilisateurs et rôles**
  une fois l'extension chargée : vous décidez qui peut l'utiliser.
- **Auditables.** Toute modification qu'une extension apporte à votre inventaire
  est enregistrée dans le **Admin → Journal d'audit** sous l'origine
  **Extension**, et peut être annulée.

## Avant d'installer

Vérifiez la **version minimale de Turbo EA** indiquée sur la page de chaque
extension — elle ne s'installera pas sur un cœur plus ancien. Les extensions
comportant du code backend nécessitent un redémarrage ponctuel du backend après
installation ; Turbo EA affiche alors un bandeau.
