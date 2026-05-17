# Vos 30 premiers jours avec Turbo EA

Vous avez installé Turbo EA. L'écran de connexion fonctionne, les données de démonstration se chargent, chaque entrée de menu vous montre quelque chose — et vous voilà devant un inventaire vide en vous demandant par où commencer concrètement. Ce guide est fait pour vous.

Il s'agit d'un parcours séquencé et orienté, couvrant la **première initiative EA concrète** que la plupart des organisations mènent sur Turbo EA : maîtriser un inventaire applicatif et l'utiliser pour répondre à de vraies questions de portefeuille. Il ignore délibérément les modules plus avancés (Registre des risques, Conformité, PPM, TurboLens AI) — ceux-ci deviennent utiles une fois que votre inventaire est vivant, pas avant.

## À qui s'adresse ce guide

- Aux **Architectes d'entreprise** qui démarrent une nouvelle pratique EA ou migrent depuis des tableurs, Confluence ou un autre outil.
- Aux **Architectes de solution et propriétaires d'applications** à qui l'on demande de « remplir l'outil EA » sans grand contexte.
- Aux **Administrateurs** préparant la plateforme pour un déploiement plus large.

Vous aurez besoin du rôle **admin** (ou au minimum de `admin.metamodel` et `inventory.edit`) pour suivre chaque étape. Les rôles en lecture seule peuvent toujours en tirer parti — ils ne pourront simplement pas effectuer les modifications du métamodèle en page 5.

## L'arc crawl → walk → run

N'essayez pas de modéliser toute l'entreprise dès la première semaine. Les équipes qui réussissent avec l'outillage EA suivent un chemin par phases :

1. **Crawl** — Un périmètre étroit (un domaine métier, un pays, une plateforme). Un seul type de fiche (Applications). Cinq champs par fiche. Atteindre une donnée « suffisamment bonne » sur 50 à 200 fiches.
2. **Walk** — Ajouter les capacités métier depuis le catalogue intégré. Cartographier les applications par rapport aux capacités. Lancer votre première analyse de portefeuille. La montrer à une partie prenante.
3. **Run** — Étendre aux processus, interfaces, objets de données. Ajouter davantage de champs personnalisés. Ouvrir les modules plus avancés.

Ce guide couvre la phase **crawl** et le début de **walk**. À la fin, vous disposerez d'un portefeuille applicatif fonctionnel avec une disposition TIME (**T**olérer / **I**nvestir / **M**igrer / **É**liminer) et d'un Rapport de portefeuille que vous pourrez présenter à un DSI.

## Que contient ce guide

| # | Page | Ce que vous ferez |
|---|------|------------------|
| 1 | [Planifiez votre déploiement](plan-your-rollout.md) | Cadrer l'initiative, choisir les parties prenantes, fixer un objectif réaliste de qualité de données |
| 2 | [Commencez par votre inventaire applicatif](start-with-applications.md) | Peupler les Applications via import, ServiceNow ou saisie manuelle |
| 3 | [Tirez parti des catalogues de référence](leverage-reference-catalogues.md) | Éviter des mois de modélisation manuelle en important capacités et processus |
| 4 | [Personnalisez le métamodèle — légèrement](customise-the-metamodel.md) | Ajouter un champ personnalisé (TIME) de la bonne manière |
| 5 | [Votre première analyse : Harmonisation applicative](your-first-analysis.md) | Cartographier les applis vers les capacités, lancer le Rapport de portefeuille et la Carte thermique des capacités |

!!! tip "Bonne pratique"
    Lisez les cinq pages dans l'ordre avant d'ouvrir Turbo EA. Le plan dans votre tête vaut plus que les 50 premières fiches dans l'inventaire.

## Prérequis

- Une instance Turbo EA en fonctionnement (voir [Installation & Configuration](../getting-started/setup.md)).
- Un compte administrateur (le premier utilisateur à s'inscrire devient automatiquement administrateur).
- **Optionnel mais recommandé pour les nouveaux utilisateurs :** démarrez la pile avec `SEED_DEMO=true` une fois pour voir à quoi ressemble un inventaire peuplé (l'entreprise fictive NexaTech Industries). Vous pourrez ensuite réinitialiser avec `RESET_DB=true` et démarrer proprement sur vos vraies données.
- Une idée approximative du **domaine métier** que vous souhaitez modéliser en premier. « Tout l'IT » n'est pas un domaine.

## Ce que vous allez ignorer — pour l'instant

Ce sont des modules puissants, mais ils supposent que vous disposez déjà d'un inventaire peuplé. Ne les ouvrez pas encore :

- **Registre des risques** et **analyse de Conformité** — utiles une fois que vous avez des applications et des capacités auxquelles rattacher des risques.
- **PPM** (Gestion du portefeuille de projets) — utile une fois que vous disposez d'un pipeline de projets à suivre.
- **TurboLens AI** (analyse des fournisseurs, détection de doublons, assistant Architect) — utile une fois que vous avez suffisamment de fiches pour que l'IA puisse y trouver des motifs.

Vous trouverez un court pointeur « et ensuite » vers chacun d'eux sur la [dernière page](your-first-analysis.md) de ce guide.

Prêt ? Direction [Planifiez votre déploiement](plan-your-rollout.md).
