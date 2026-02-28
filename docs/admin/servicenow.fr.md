# Intégration ServiceNow

L'intégration ServiceNow (**Admin > Paramètres > ServiceNow**) permet la synchronisation bidirectionnelle entre Turbo EA et votre ServiceNow CMDB. Ce guide couvre tout, de la configuration initiale aux recettes avancées et aux bonnes pratiques opérationnelles.

## Pourquoi intégrer ServiceNow avec Turbo EA ?

ServiceNow CMDB et les outils d'architecture d'entreprise servent des objectifs différents mais complémentaires :

| | ServiceNow CMDB | Turbo EA |
|--|-----------------|----------|
| **Focus** | Opérations IT -- ce qui fonctionne, qui en est responsable, quels incidents se sont produits | Planification stratégique -- à quoi devrait ressembler le paysage dans 3 ans ? |
| **Maintenu par** | Opérations IT, Gestion des actifs | Équipe EA, Architectes métier |
| **Point fort** | Découverte automatisée, workflows ITSM, précision opérationnelle | Contexte métier, cartographie des capacités, planification du cycle de vie, évaluations |
| **Données typiques** | Noms d'hotes, IP, statut d'installation, groupes d'affectation, contrats | Criticite métier, adéquation fonctionnelle, dette technique, feuille de route stratégique |

**Turbo EA est le système de référence** pour votre paysage d'architecture -- les noms, descriptions, plans de cycle de vie, évaluations et contexte métier vivent tous ici. ServiceNow complète Turbo EA avec des métadonnées opérationnelles et techniques (noms d'hotes, IP, données SLA, statut d'installation) provenant de la découverte automatisée et des workflows ITSM. L'intégration maintient ces deux systèmes connectés tout en respectant que Turbo EA dirige.

### Ce que vous pouvez faire

- **Synchronisation pull** -- Alimenter Turbo EA avec des CI depuis ServiceNow, puis en prendre la propriété. Les pulls suivants ne mettent à jour que les champs opérationnels (IP, statut, SLA) que SNOW decouvre automatiquement
- **Synchronisation push** -- Exporter les données curées par l'EA vers ServiceNow (noms, descriptions, évaluations, plans de cycle de vie) pour que les équipes ITSM voient le contexte EA
- **Synchronisation bidirectionnelle** -- Turbo EA dirige la plupart des champs ; SNOW dirige un petit ensemble de champs opérationnels/techniques. Les deux systèmes restent synchronisés
- **Cartographie d'identité** -- Un suivi persistant de références croisées (sys_id <-> UUID de fiche) garantit que les enregistrements restent liés entre les synchronisations

---

## Architecture de l'intégration

```
+------------------+         HTTPS / Table API          +------------------+
|   Turbo EA       | <--------------------------------> |  ServiceNow      |
|                  |                                     |                  |
|  Fiches          |  Pull: SNOW CIs -> Fiches Turbo     |  CMDB CIs        |
|  (Application,   |  Push: Fiches Turbo -> SNOW CIs     |  (cmdb_ci_appl,  |
|   ITComponent,   |                                     |   cmdb_ci_server, |
|   Provider, ...) |  Identity Map suit sys_id <-> UUID   |   core_company)  |
+------------------+                                     +------------------+
```

L'intégration utilise l'API Table de ServiceNow via HTTPS. Les identifiants sont chiffrés au repos en utilisant Fernet (AES-128-CBC) derive de votre `SECRET_KEY`. Toutes les opérations de synchronisation sont enregistrees comme événements avec `source: "servicenow_sync"` pour une piste d'audit complète.

---

## Planification de votre intégration

Avant de configurer quoi que ce soit, répondez à ces questions :

### 1. Quels types de fiches ont besoin de données depuis ServiceNow ?

Commencez petit. Les points d'intégration les plus courants sont :

| Priorité | Type Turbo EA | Source ServiceNow | Pourquoi |
|----------|---------------|-------------------|----------|
| **Haute** | Application | `cmdb_ci_business_app` | Les applications sont le coeur de l'EA -- la CMDB à les noms, proprietaires et statuts faisant autorite |
| **Haute** | ITComponent (Logiciel) | `cmdb_ci_spkg` | Les produits logiciels alimentent le suivi EOL et le radar technologique |
| **Moyenne** | ITComponent (Matériel) | `cmdb_ci_server` | Paysage de serveurs pour la cartographie d'infrastructure |
| **Moyenne** | Provider | `core_company` | Registre de fournisseurs pour la gestion des coûts et des relations |
| **Faible** | Interface | `cmdb_ci_endpoint` | Points d'intégration (souvent maintenus manuellement en EA) |
| **Faible** | DataObject | `cmdb_ci_database` | Instances de base de données |

### 2. Quel système est la source de vérité pour chaque champ ?

C'est la décision la plus importante. Le choix par défaut devrait être **Turbo EA dirige** -- l'outil EA est le système de référence pour votre paysage d'architecture. ServiceNow ne devrait diriger que pour un ensemble restreint de champs opérationnels et techniques provenant de la découverte automatisée ou des workflows ITSM. Tout le reste -- noms, descriptions, évaluations, planification du cycle de vie, coûts -- est possédé et cure par l'équipe EA dans Turbo EA.

**Modèle recommandé -- « Turbo EA dirige, SNOW complète » :**

| Type de champ | Source de vérité | Pourquoi |
|---------------|-----------------|----------|
| **Noms et descriptions** | **Turbo dirige** | L'équipe EA cure les noms faisant autorite et écrit les descriptions stratégiques ; les noms CMDB peuvent être brouillons ou auto-générés |
| **Criticite métier** | **Turbo dirige** | Évaluation stratégique de l'équipe EA -- pas des données opérationnelles |
| **Adéquation fonctionnelle / technique** | **Turbo dirige** | Les scores du modèle TIME relevent de l'EA |
| **Cycle de vie (toutes les phases)** | **Turbo dirige** | Plan, phaseIn, active, phaseOut, endOfLife -- toutes des données de planification EA |
| **Données de coût** | **Turbo dirige** | L'EA suit le coût total de possession ; la CMDB peut avoir des lignes de contrat mais l'EA possédé la vue consolidee |
| **Type d'hebergement, catégorie** | **Turbo dirige** | L'EA classe les applications par modèle d'hebergement pour l'analyse stratégique |
| **Métadonnées techniques** | SNOW dirige | IP, versions OS, noms d'hotes, numéros de serie -- données de découverte automatisée que l'EA ne maintient pas |
| **SLA / statut opérationnel** | SNOW dirige | Statut d'installation, objectifs SLA, métriques de disponibilité -- données opérationnelles ITSM |
| **Groupe d'affectation / support** | SNOW dirige | Propriété opérationnelle suivie dans les workflows ServiceNow |
| **Dates de découverte** | SNOW dirige | Première/derniere découverte, dernier scan -- métadonnées d'automatisation CMDB |

### 3. À quelle fréquence synchroniser ?

| Scénario | Fréquence | Notes |
|----------|-----------|-------|
| Import initial | Une fois | Mode additif, examiner attentivement |
| Gestion active du paysage | Quotidien | Automatise via cron pendant les heures creuses |
| Rapports de conformite | Hebdomadaire | Avant de générer les rapports |
| Ad-hoc | Selon les besoins | Avant les revues ou presentations EA majeures |

---

## Étape 1 : Prerequis ServiceNow

### Créer un compte de service

Dans ServiceNow, créez un compte de service dédié (n'utilisez jamais de comptes personnels) :

| Rôle | Objectif | Requis ? |
|------|----------|----------|
| `itil` | Acces en lecture aux tables CMDB | Oui |
| `cmdb_read` | Lire les éléments de configuration | Oui |
| `rest_api_explorer` | Utile pour tester les requetes | Recommandé |
| `import_admin` | Acces en ecriture aux tables cibles | Uniquement pour le push sync |

**Bonne pratique** : Créez un rôle personnalisé avec un acces en lecture seule aux tables spécifiques que vous prévoyez de synchroniser. Le rôle `itil` est large -- un rôle personnalisé limite le rayon d'impact.

### Exigences réseau

- Le backend Turbo EA doit pouvoir atteindre votre instance SNOW via HTTPS (port 443)
- Configurez les regles de pare-feu et les listes blanches IP
- Format de l'URL de l'instance : `https://entreprise.service-now.com` ou `https://entreprise.servicenowservices.com`

### Choisir la méthode d'authentification

| Méthode | Avantages | Inconvenients | Recommandation |
|---------|-----------|---------------|----------------|
| **Basic Auth** | Configuration simple | Identifiants envoyes à chaque requete | Développement/test uniquement |
| **OAuth 2.0** | Base sur les jetons, scope, compatible audit | Plus d'étapes de configuration | **Recommandé pour la production** |

Pour OAuth 2.0 :
1. Dans ServiceNow : **System OAuth > Application Registry**
2. Créez un nouveau point de terminaison OAuth API pour les clients externes
3. Notez le Client ID et le Client Secret
4. Renouvelez les secrets tous les 90 jours

---

## Étape 2 : Créer une connexion

Naviguez vers **Admin > ServiceNow > onglet Connexions**.

### Créer et tester

1. Cliquez sur **Ajouter une connexion**
2. Remplissez :

| Champ | Exemple de valeur | Notes |
|-------|-------------------|-------|
| Nom | `CMDB Production` | Libellé descriptif pour votre équipe |
| URL de l'instance | `https://entreprise.service-now.com` | Doit utiliser HTTPS |
| Type d'auth | Basic Auth ou OAuth 2.0 | OAuth recommandé pour la production |
| Identifiants | (selon le type d'auth) | Chiffrés au repos via Fernet |

3. Cliquez sur **Créer**, puis cliquez sur l'**icône de test** (symbole wifi) pour verifier la connectivite

- **Badge vert « Connecté »** -- Prêt à l'emploi
- **Badge rouge « Échoué »** -- Vérifiez les identifiants, le réseau et l'URL

### Connexions multiples

Vous pouvez créer plusieurs connexions pour :
- Instances de **Production** vs **développement**
- Instances SNOW **regionales** (par ex. EMEA, APAC)
- **Différentes équipes** avec des comptes de service séparés

Chaque mapping référence une connexion spécifique.

---

## Étape 3 : Concevoir vos mappings

Basculez vers l'onglet **Mappings**. Un mapping connecté un type de fiche Turbo EA à une table ServiceNow.

### Créer un mapping

Cliquez sur **Ajouter un mapping** et configurez :

| Champ | Description | Exemple |
|-------|-------------|---------|
| **Connexion** | Quelle instance ServiceNow utiliser | CMDB Production |
| **Type de fiche** | Le type de fiche Turbo EA a synchroniser | Application |
| **Table SNOW** | Le nom API de la table ServiceNow | `cmdb_ci_business_app` |
| **Direction de sync** | Quelles opérations sont disponibles (voir ci-dessous) | ServiceNow -> Turbo EA |
| **Mode de sync** | Comment gérer les suppressions | Conservateur |
| **Ratio max de suppression** | Seuil de sécurité pour les suppressions en masse | 50% |
| **Requete de filtre** | Requete encodee ServiceNow pour limiter le perimetre | `active=true^install_status=1` |
| **Sauter le staging** | Appliquer les modifications directement sans examen | Désactivé (recommandé pour la synchronisation initiale) |

### Mappings de tables SNOW courants

| Type Turbo EA | Table ServiceNow | Description |
|---------------|------------------|-------------|
| Application | `cmdb_ci_business_app` | Applications métier (le plus courant) |
| Application | `cmdb_ci_appl` | CI d'applications généraux |
| ITComponent (Logiciel) | `cmdb_ci_spkg` | Paquets logiciels |
| ITComponent (Matériel) | `cmdb_ci_server` | Serveurs physiques/virtuels |
| ITComponent (SaaS) | `cmdb_ci_cloud_service_account` | Comptes de services cloud |
| Provider | `core_company` | Fournisseurs / entreprises |
| Interface | `cmdb_ci_endpoint` | Points de terminaison d'intégration |
| DataObject | `cmdb_ci_database` | Instances de base de données |
| System | `cmdb_ci_computer` | CI d'ordinateurs |
| Organization | `cmn_department` | Departements |

### Exemples de requetes de filtre

Toujours filtrer pour eviter d'importer des enregistrements obsoletes ou retirés :

```
# Uniquement les CI actifs (filtre minimum recommande)
active=true

# CI actifs avec statut d'installation « Installe »
active=true^install_status=1

# Applications en utilisation de production
active=true^used_for=Production

# CI mis a jour dans les 30 derniers jours
active=true^sys_updated_on>=javascript:gs.daysAgoStart(30)

# Groupe d'affectation specifique
active=true^assignment_group.name=IT Operations

# Exclure les CI retires
active=true^install_statusNOT IN7,8
```

**Bonne pratique** : Incluez toujours `active=true` au minimum. Les tables CMDB contiennent souvent des milliers d'enregistrements retirés ou décommissionnés qui ne devraient pas être importes dans votre paysage EA.

---

## Étape 4 : Configurer les mappings de champs

Chaque mapping contient des **mappings de champs** qui definissent comment les champs individuels se traduisent entre les deux systèmes. Le champ Turbo EA fournit des suggestions d'autocompletion basées sur le type de fiche sélectionné -- incluant les champs principaux, les dates de cycle de vie et tous les attributs personnalisés du schema du type.

### Ajout de champs

Pour chaque mapping de champ, vous configurez :

| Paramètre | Description |
|-----------|-------------|
| **Champ Turbo EA** | Chemin du champ dans Turbo EA (l'autocompletion suggere des options basées sur le type de fiche) |
| **Champ SNOW** | Nom de colonne API ServiceNow (par ex. `name`, `short_description`) |
| **Direction** | Source de vérité par champ : SNOW dirige ou Turbo dirige |
| **Transformation** | Comment convertir les valeurs : Direct, Correspondance de valeurs, Date, Booleen |
| **Identité** (case ID) | Utilise pour la correspondance des enregistrements lors de la synchronisation initiale |

### Chemins de champs Turbo EA

L'autocompletion regroupe les champs par section. Voici la référence complète des chemins :

| Chemin | Cible | Exemple de valeur |
|--------|-------|-------------------|
| `name` | Nom d'affichage de la fiche | `"SAP S/4HANA"` |
| `description` | Description de la fiche | `"Systeme ERP principal pour les finances"` |
| `lifecycle.plan` | Cycle de vie : Date de planification | `"2024-01-15"` |
| `lifecycle.phaseIn` | Cycle de vie : Date de mise en service | `"2024-03-01"` |
| `lifecycle.active` | Cycle de vie : Date d'activation | `"2024-06-01"` |
| `lifecycle.phaseOut` | Cycle de vie : Date de retrait progressif | `"2028-12-31"` |
| `lifecycle.endOfLife` | Cycle de vie : Date de fin de vie | `"2029-06-30"` |
| `attributes.<cle>` | Tout attribut personnalisé du schema de champs du type de fiche | Varie selon le type de champ |

Par exemple, si votre type Application à un champ avec la clé `businessCriticality`, sélectionnez `attributes.businessCriticality` dans la liste déroulante.

### Champs d'identité -- Comment fonctionne la correspondance

Marquez un ou plusieurs champs comme **Identité** (icône de clé). Ceux-ci sont utilises lors de la première synchronisation pour faire correspondre les enregistrements ServiceNow aux fiches Turbo EA existantes :

1. **Recherche dans la carte d'identité** -- Si un lien sys_id <-> UUID de fiche existe déjà, l'utiliser
2. **Correspondance exacte du nom** -- Correspondance sur la valeur du champ d'identité (par ex. correspondance par nom d'application)
3. **Correspondance approximative** -- Si aucune correspondance exacte, utilisation de SequenceMatcher avec un seuil de similarite de 85%

**Bonne pratique** : Marquez toujours le champ `name` comme champ d'identité. Si les noms different entre les systèmes (par ex. SNOW inclut des numéros de version comme « SAP S/4HANA v2.1 » mais Turbo EA a « SAP S/4HANA »), nettoyez-les avant la première synchronisation pour une meilleure qualité de correspondance.

Après la première synchronisation qui etablit les liens de la carte d'identité, les synchronisations suivantes utilisent la carte d'identité persistante et ne reposent plus sur la correspondance par nom.

---

## Étape 5 : Exécuter votre première synchronisation

Basculez vers l'onglet **Tableau de bord de synchronisation**.

### Declenchement d'une synchronisation

Pour chaque mapping actif, vous voyez des boutons Pull et/ou Push selon la direction de synchronisation configurée :

- **Pull** (icône de téléchargement cloud) -- Récupéré les données de SNOW vers Turbo EA
- **Push** (icône d'envoi cloud) -- Envoie les données Turbo EA vers ServiceNow

### Ce qui se passe pendant un Pull Sync

```
1. FETCH     Recuperer tous les enregistrements correspondants de SNOW (lots de 500)
2. MATCH     Faire correspondre chaque enregistrement a une fiche existante :
             a) Carte d'identite (recherche persistante sys_id <-> UUID de fiche)
             b) Correspondance exacte du nom sur les champs d'identite
             c) Correspondance approximative du nom (seuil de similarite 85%)
3. TRANSFORM Appliquer les mappings de champs pour convertir SNOW -> format Turbo EA
4. DIFF      Comparer les donnees transformees aux champs de la fiche existante
5. STAGE     Assigner une action a chaque enregistrement :
             - create : Nouveau, aucune fiche correspondante trouvee
             - update : Correspondance trouvee, champs differents
             - skip :   Correspondance trouvee, aucune difference
             - delete : Dans la carte d'identite mais absent de SNOW
6. APPLY     Executer les actions du staging (creer/mettre a jour/archiver les fiches)
```

Lorsque **Sauter le staging** est active, les étapes 5 et 6 fusionnent -- les actions sont appliquees directement sans écrire d'enregistrements en staging.

### Examen des résultats de synchronisation

Le tableau **Historique de synchronisation** affiche après chaque exécution :

| Colonne | Description |
|---------|-------------|
| Debut | Quand la synchronisation a commence |
| Direction | Pull ou Push |
| Statut | `completed`, `failed` ou `running` |
| Récupérés | Nombre total d'enregistrements récupérés de ServiceNow |
| Créés | Nouvelles fiches créées dans Turbo EA |
| Mis à jour | Fiches existantes mises à jour |
| Supprimés | Fiches archivées (supprimées de manière logique) |
| Erreurs | Enregistrements qui n'ont pas pu être traites |
| Durée | Temps reel |

Cliquez sur l'**icône de liste** sur n'importe quelle exécution pour inspecter les enregistrements individuels du staging, y compris le diff au niveau des champs pour chaque mise à jour.

### Procédure recommandée pour la première synchronisation

```
1. Definir le mapping en mode ADDITIF avec le staging ACTIVE
2. Executer la synchronisation pull
3. Examiner les enregistrements en staging -- verifier que les creations sont correctes
4. Aller dans l'Inventaire, verifier les fiches importees
5. Ajuster les mappings de champs ou la requete de filtre si necessaire
6. Relancer jusqu'a satisfaction
7. Basculer en mode CONSERVATEUR pour l'utilisation continue
8. Apres plusieurs executions reussies, activer Sauter le staging
```

---

## Comprendre la direction de synchronisation vs la direction des champs

C'est le concept le plus frequemment mal compris. Il y à **deux niveaux de direction** qui fonctionnent ensemble :

### Niveau table : Direction de synchronisation

Définie sur le mapping lui-même. Contrôle **quelles opérations de synchronisation sont disponibles** sur le tableau de bord de synchronisation :

| Direction de sync | Bouton Pull ? | Bouton Push ? | A utiliser quand... |
|-------------------|--------------|--------------|---------------------|
| **ServiceNow -> Turbo EA** | Oui | Non | La CMDB est la source maitresse, vous importez uniquement |
| **Turbo EA -> ServiceNow** | Non | Oui | L'outil EA enrichit la CMDB avec des évaluations |
| **Bidirectionnel** | Oui | Oui | Les deux systèmes contribuent des champs différents |

### Niveau champ : Direction

Définie **par mapping de champ**. Contrôle **quelle valeur du système prend le dessus** lors d'une exécution de synchronisation :

| Direction du champ | Pendant le Pull (SNOW -> Turbo) | Pendant le Push (Turbo -> SNOW) |
|--------------------|--------------------------------|--------------------------------|
| **SNOW dirige** | La valeur est importee depuis ServiceNow | La valeur est **ignoree** (non pushee) |
| **Turbo dirige** | La valeur est **ignoree** (non ecrasee) | La valeur est exportee vers ServiceNow |

### Comment ils fonctionnent ensemble -- Exemple

Mapping : Application <-> `cmdb_ci_business_app`, **Bidirectionnel**

| Champ | Direction | Le Pull fait... | Le Push fait... |
|-------|-----------|----------------|----------------|
| `name` | **Turbo dirige** | Ignore (l'EA cure les noms) | Pousse le nom EA -> SNOW |
| `description` | **Turbo dirige** | Ignore (l'EA écrit les descriptions) | Pousse la description -> SNOW |
| `lifecycle.active` | **Turbo dirige** | Ignore (l'EA géré le cycle de vie) | Pousse la date de mise en prod -> SNOW |
| `attributes.businessCriticality` | **Turbo dirige** | Ignore (évaluation EA) | Pousse l'évaluation -> champ SNOW personnalisé |
| `attributes.ipAddress` | SNOW dirige | Importe l'IP depuis la découverte | Ignore (donnée opérationnelle) |
| `attributes.installStatus` | SNOW dirige | Importe le statut opérationnel | Ignore (donnée ITSM) |

**Point clé** : La direction au niveau de la table déterminé *quels boutons apparaissent*. La direction au niveau du champ déterminé *quels champs sont effectivement transferes* lors de chaque opération. Un mapping bidirectionnel ou Turbo EA dirige la plupart des champs et SNOW ne dirige que les champs opérationnels/techniques est la configuration la plus puissante.

### Bonne pratique : Direction des champs par type de données

Le choix par défaut devrait être **Turbo dirige** pour la grande majorite des champs. Ne définissez SNOW dirige que pour les métadonnées opérationnelles et techniques provenant de la découverte automatisée ou des workflows ITSM.

| Catégorie de données | Direction recommandée | Justification |
|-----------------------|----------------------|---------------|
| **Noms, libelles d'affichage** | **Turbo dirige** | L'équipe EA cure des noms faisant autorite et propres -- les noms CMDB sont souvent auto-générés ou incoherents |
| **Description** | **Turbo dirige** | Les descriptions EA capturent le contexte stratégique, la valeur métier et la signification architecturale |
| **Criticite métier (modèle TIME)** | **Turbo dirige** | Évaluation fondamentale de l'EA -- pas des données opérationnelles |
| **Adéquation fonctionnelle/technique** | **Turbo dirige** | Notation et classification de feuille de route spécifiques à l'EA |
| **Cycle de vie (toutes les phases)** | **Turbo dirige** | Plan, phaseIn, active, phaseOut, endOfLife sont toutes des décisions de planification EA |
| **Données de coût** | **Turbo dirige** | L'EA suit le coût total de possession et l'allocation budgétaire |
| **Type d'hebergement, classification** | **Turbo dirige** | Categorisation stratégique maintenue par les architectes |
| **Informations fournisseur** | **Turbo dirige** | L'EA géré la stratégie fournisseur, les contrats et les risques -- SNOW peut avoir un nom de fournisseur mais l'EA possédé la relation |
| Métadonnées techniques (OS, IP, nom d'hote) | SNOW dirige | Données de découverte automatisée -- l'EA ne maintient pas cela |
| Objectifs SLA, métriques de disponibilité | SNOW dirige | Données opérationnelles des workflows ITSM |
| Statut d'installation, état opérationnel | SNOW dirige | La CMDB suit si un CI est installe, retiré, etc. |
| Groupe d'affectation, équipe de support | SNOW dirige | Propriété opérationnelle gérée dans ServiceNow |
| Métadonnées de découverte (première/derniere fois vu) | SNOW dirige | Horodatages d'automatisation CMDB |

---

## Sauter le staging -- Quand l'utiliser

Par défaut, les synchronisations pull suivent un workflow **staging puis application** :

```
Fetch -> Match -> Transform -> Diff -> STAGE -> Review -> APPLY
```

Les enregistrements sont ecrits dans une table de staging, vous permettant de passer en revue ce qui va changer avant d'appliquer. Ceci est visible dans le tableau de bord de synchronisation sous « Voir les enregistrements en staging ».

### Mode Sauter le staging

Lorsque vous activez **Sauter le staging** sur un mapping, les enregistrements sont appliques directement :

```
Fetch -> Match -> Transform -> Diff -> APPLIQUER DIRECTEMENT
```

Aucun enregistrement de staging n'est créé -- les modifications sont immediates.

| | Staging (par défaut) | Sauter le staging |
|--|---------------------|-------------------|
| **Étape de revue** | Oui -- inspecter les diffs avant d'appliquer | Non -- les modifications s'appliquent immédiatement |
| **Table d'enregistrements staging** | Remplie avec les entrees de création/mise à jour/suppression | Non remplie |
| **Piste d'audit** | Enregistrements staging + historique des événements | Historique des événements uniquement |
| **Performance** | Légèrement plus lent (ecriture des lignes de staging) | Légèrement plus rapide |
| **Annulation** | Peut annuler avant d'appliquer | Doit revenir manuellement |

### Quand utiliser chaque option

| Scénario | Recommandation |
|----------|---------------|
| Premier import | **Utiliser le staging** -- Examiner ce qui sera créé avant d'appliquer |
| Mapping nouveau ou modifié | **Utiliser le staging** -- Verifier que les transformations de champs produisent le bon résultat |
| Mapping stable et bien teste | **Sauter le staging** -- Pas besoin de revoir chaque exécution |
| Synchronisations quotidiennes automatisées (cron) | **Sauter le staging** -- Les exécutions sans surveillance ne peuvent pas attendre une revue |
| CMDB volumineuse (10 000+ CI) | **Sauter le staging** -- Evite de créer des milliers de lignes de staging |
| Environnement sensible à la conformite | **Utiliser le staging** -- Maintenir une piste d'audit complète dans la table de staging |

**Bonne pratique** : Commencez avec le staging active pour vos premières synchronisations. Une fois que vous etes confiant que le mapping produit des résultats corrects, activez le saut de staging pour les exécutions automatisées.

---

## Modes de synchronisation et sécurité des suppressions

### Modes de synchronisation

| Mode | Creations | Mises à jour | Suppressions | Ideal pour |
|------|-----------|-------------|-------------|------------|
| **Additif** | Oui | Oui | **Jamais** | Imports initiaux, environnements a faible risque |
| **Conservateur** | Oui | Oui | Uniquement les fiches **créées par la sync** | Par défaut pour les synchronisations continues |
| **Strict** | Oui | Oui | Toutes les fiches liées | Miroir complet de la CMDB |

Le mode **Additif** ne supprime jamais de fiches de Turbo EA, ce qui en fait l'option la plus sure pour les premiers imports et les environnements ou Turbo EA contient des fiches absentes de ServiceNow (fiches créées manuellement, fiches d'autres sources).

Le mode **Conservateur** (par défaut) suit si chaque fiche a été originellement créée par le moteur de synchronisation. Seules ces fiches peuvent être auto-archivées si elles disparaissent de ServiceNow. Les fiches créées manuellement dans Turbo EA ou importees d'autres sources ne sont jamais touchees.

Le mode **Strict** archive toute fiche liée dont le CI ServiceNow correspondant n'apparaît plus dans les résultats de la requete, quel que soit le créateur. Utilisez-le uniquement lorsque ServiceNow est la source de vérité absolue et que vous souhaitez que Turbo EA soit un miroir exact.

### Ratio max de suppression -- Filet de sécurité

Par mesure de sécurité, le moteur **saute toutes les suppressions** si le nombre dépasse le ratio configuré :

```
suppressions / total_lies > ratio_max_suppression  ->  SAUTER TOUTES LES SUPPRESSIONS
```

Exemple avec 10 enregistrements liés et un seuil de 50% :

| Scénario | Suppressions | Ratio | Résultat |
|----------|-------------|-------|----------|
| 3 CI supprimés normalement | 3 / 10 = 30% | Sous le seuil | Les suppressions procèdent |
| 6 CI supprimés d'un coup | 6 / 10 = 60% | **Au-dessus du seuil** | Toutes les suppressions sautees |
| SNOW retourne vide (panne) | 10 / 10 = 100% | **Au-dessus du seuil** | Toutes les suppressions sautees |

Cela prévient la perte catastrophique de données suite à des changements de requete de filtre, des pannes temporaires de ServiceNow ou des noms de tables mal configurés.

**Bonne pratique** : Maintenez le ratio de suppression à **50% ou moins** pour les tables avec moins de 100 enregistrements. Pour les grandes tables (1 000+), vous pouvez le définir en sécurité à 25%.

### Progression recommandée

```
Semaine 1 :   Mode ADDITIF, staging ACTIVE, executer manuellement, examiner chaque enregistrement
Semaine 2-4 : Mode CONSERVATEUR, staging ACTIVE, executer quotidiennement, verifier les resultats par echantillonnage
Mois 2+ :     Mode CONSERVATEUR, staging DESACTIVE (sauter), cron quotidien automatise
```

---

## Recettes recommandees par type

### Recette 1 : Applications depuis la CMDB (La plus courante)

**Objectif** : Importer le paysage applicatif depuis ServiceNow, puis prendre la propriété des noms, descriptions, évaluations et cycle de vie dans Turbo EA. SNOW ne dirige que les champs opérationnels.

**Mapping :**

| Paramètre | Valeur |
|-----------|--------|
| Type de fiche | Application |
| Table SNOW | `cmdb_ci_business_app` |
| Direction | Bidirectionnel |
| Mode | Conservateur |
| Filtre | `active=true^install_status=1` |

**Mappings de champs :**

| Champ Turbo EA | Champ SNOW | Direction | Transformation | ID ? |
|----------------|------------|-----------|---------------|------|
| `name` | `name` | **Turbo dirige** | Direct | Oui |
| `description` | `short_description` | **Turbo dirige** | Direct | |
| `lifecycle.active` | `go_live_date` | **Turbo dirige** | Date | |
| `lifecycle.endOfLife` | `retirement_date` | **Turbo dirige** | Date | |
| `attributes.businessCriticality` | `busines_criticality` | **Turbo dirige** | Correspondance de valeurs | |
| `attributes.hostingType` | `hosting_type` | **Turbo dirige** | Direct | |
| `attributes.installStatus` | `install_status` | SNOW dirige | Direct | |
| `attributes.ipAddress` | `ip_address` | SNOW dirige | Direct | |

Configuration de la correspondance de valeurs pour `businessCriticality` :

```json
{
  "mapping": {
    "1 - most critical": "missionCritical",
    "2 - somewhat critical": "businessCritical",
    "3 - less critical": "businessOperational",
    "4 - not critical": "administrativeService"
  }
}
```

**Conseil pour la première sync** : Lors du tout premier pull, les valeurs SNOW remplissent tous les champs (puisque les fiches n'existent pas encore). Après cela, les champs ou Turbo dirige sont possédés par l'équipe EA -- les pulls suivants ne mettent à jour que les champs opérationnels ou SNOW dirige (statut d'installation, IP), tandis que l'équipe EA géré tout le reste directement dans Turbo EA.

**Après l'import** : Affinez les noms d'applications, écrivez les descriptions stratégiques, mappez aux Capacités Métier, ajoutez les évaluations d'adéquation fonctionnelle/technique et définissez les phases du cycle de vie -- tout cela est maintenant possédé par Turbo EA et sera repoussée vers ServiceNow lors des push syncs.

---

### Recette 2 : Composants IT (Serveurs)

**Objectif** : Importer l'infrastructure de serveurs pour la cartographie d'infrastructure et l'analyse de dépendances. Les serveurs sont plus opérationnels que les applications, donc plus de champs viennent de SNOW -- mais Turbo EA dirige toujours les noms et les descriptions.

**Mapping :**

| Paramètre | Valeur |
|-----------|--------|
| Type de fiche | ITComponent |
| Table SNOW | `cmdb_ci_server` |
| Direction | Bidirectionnel |
| Mode | Conservateur |
| Filtre | `active=true^hardware_statusNOT IN6,7` |

**Mappings de champs :**

| Champ Turbo EA | Champ SNOW | Direction | Transformation | ID ? |
|----------------|------------|-----------|---------------|------|
| `name` | `name` | **Turbo dirige** | Direct | Oui |
| `description` | `short_description` | **Turbo dirige** | Direct | |
| `attributes.manufacturer` | `manufacturer.name` | **Turbo dirige** | Direct | |
| `attributes.operatingSystem` | `os` | SNOW dirige | Direct | |
| `attributes.ipAddress` | `ip_address` | SNOW dirige | Direct | |
| `attributes.serialNumber` | `serial_number` | SNOW dirige | Direct | |
| `attributes.hostname` | `host_name` | SNOW dirige | Direct | |

**Note** : Pour les serveurs, les champs opérationnels/de découverte comme l'OS, l'IP, le numéro de serie et le nom d'hote proviennent naturellement de la découverte automatisée de SNOW. Mais l'équipe EA possédé toujours le nom d'affichage (qui peut differer du nom d'hote) et la description pour le contexte stratégique.

**Après l'import** : Liez les Composants IT aux Applications en utilisant les relations, ce qui alimente le graphe de dépendances et les rapports d'infrastructure.

---

### Recette 3 : Produits logiciels avec suivi EOL

**Objectif** : Importer les produits logiciels et les combiner avec l'intégration endoflife.date de Turbo EA. Turbo EA dirige sur les noms, descriptions et le fournisseur -- la version est un champ factuel que SNOW peut diriger.

**Mapping :**

| Paramètre | Valeur |
|-----------|--------|
| Type de fiche | ITComponent |
| Table SNOW | `cmdb_ci_spkg` |
| Direction | Bidirectionnel |
| Mode | Conservateur |
| Filtre | `active=true` |

**Mappings de champs :**

| Champ Turbo EA | Champ SNOW | Direction | Transformation | ID ? |
|----------------|------------|-----------|---------------|------|
| `name` | `name` | **Turbo dirige** | Direct | Oui |
| `description` | `short_description` | **Turbo dirige** | Direct | |
| `attributes.version` | `version` | SNOW dirige | Direct | |
| `attributes.vendor` | `manufacturer.name` | **Turbo dirige** | Direct | |

**Après l'import** : Allez dans **Admin > EOL** et utilisez la recherche en masse pour faire correspondre automatiquement les Composants IT importes avec les produits endoflife.date. Cela vous donne un suivi automatise des risques EOL qui combine l'inventaire CMDB avec les données publiques de cycle de vie.

---

### Recette 4 : Fournisseurs (Bidirectionnel)

**Objectif** : Maintenir le registre de fournisseurs en synchronisation. Turbo EA possédé les noms de fournisseurs, les descriptions et le contexte stratégique. SNOW complète avec les données de contact opérationnelles.

**Mapping :**

| Paramètre | Valeur |
|-----------|--------|
| Type de fiche | Provider |
| Table SNOW | `core_company` |
| Direction | Bidirectionnel |
| Mode | Additif |
| Filtre | `vendor=true` |

**Mappings de champs :**

| Champ Turbo EA | Champ SNOW | Direction | Transformation | ID ? |
|----------------|------------|-----------|---------------|------|
| `name` | `name` | **Turbo dirige** | Direct | Oui |
| `description` | `notes` | **Turbo dirige** | Direct | |
| `attributes.website` | `website` | **Turbo dirige** | Direct | |
| `attributes.contactEmail` | `email` | SNOW dirige | Direct | |

**Pourquoi Turbo dirige pour la plupart des champs** : L'équipe EA cure la stratégie fournisseur, géré les relations et suit les risques -- cela inclut le nom d'affichage du fournisseur, la description et la presence web. SNOW ne dirige que sur les données de contact opérationnelles qui peuvent être mises à jour par les équipes d'approvisionnement ou de gestion des actifs.

---

### Recette 5 : Pousser les évaluations EA vers ServiceNow

**Objectif** : Exporter les évaluations spécifiques à l'EA vers des champs personnalisés ServiceNow pour que les équipes ITSM voient le contexte EA.

**Mapping :**

| Paramètre | Valeur |
|-----------|--------|
| Type de fiche | Application |
| Table SNOW | `cmdb_ci_business_app` |
| Direction | Turbo EA -> ServiceNow |
| Mode | Additif |

**Mappings de champs :**

| Champ Turbo EA | Champ SNOW | Direction | Transformation | ID ? |
|----------------|------------|-----------|---------------|------|
| `name` | `name` | SNOW dirige | Direct | Oui |
| `attributes.businessCriticality` | `u_ea_business_criticality` | Turbo dirige | Correspondance de valeurs | |
| `attributes.functionalSuitability` | `u_ea_functional_fit` | Turbo dirige | Correspondance de valeurs | |
| `attributes.technicalSuitability` | `u_ea_technical_fit` | Turbo dirige | Correspondance de valeurs | |

> **Important** : Le push sync vers des champs personnalisés (préfixés par `u_`) nécessité que ces colonnes existent déjà dans ServiceNow. Travaillez avec votre administrateur ServiceNow pour les créer avant de configurer le mapping push. Le compte de service a besoin du rôle `import_admin` pour l'acces en ecriture.

**Pourquoi c'est important** : Les équipes ITSM voient les évaluations EA directement dans les workflows d'incident/changement ServiceNow. Lorsqu'une application « Mission critique » à un incident, les regles d'escalade de priorité peuvent utiliser le score de criticite fourni par l'EA.

---

## Référence des types de transformation

### Direct (par défaut)

Passe la valeur sans modification. Utilisez pour les champs texte qui ont le même format dans les deux systèmes.

### Correspondance de valeurs

Traduit les valeurs énumérées entre les systèmes. Configurez avec un mapping JSON :

```json
{
  "mapping": {
    "1": "missionCritical",
    "2": "businessCritical",
    "3": "businessOperational",
    "4": "administrativeService"
  }
}
```

Le mapping s'inverse automatiquement lors du push de Turbo EA vers ServiceNow. Par exemple, lors du push, `"missionCritical"` devient `"1"`.

### Format date

Tronque les valeurs datetime de ServiceNow (`2024-06-15 14:30:00`) en date seule (`2024-06-15`). Utilisez pour les dates de phase de cycle de vie ou l'heure n'est pas pertinente.

### Booleen

Convertit entre les booleens en chaînes ServiceNow (`"true"`, `"1"`, `"yes"`) et les booleens natifs. Utile pour les champs comme « is_virtual », « active », etc.

---

## Bonnes pratiques de sécurité

### Gestion des identifiants

| Pratique | Détails |
|----------|---------|
| **Chiffrement au repos** | Tous les identifiants chiffrés via Fernet (AES-128-CBC) derive de `SECRET_KEY`. Si vous changez `SECRET_KEY`, ressaisissez tous les identifiants ServiceNow. |
| **Moindre privilege** | Créez un compte de service SNOW dédié avec un acces en lecture seule aux tables spécifiques. N'accordez l'acces en ecriture que si vous utilisez le push sync. |
| **OAuth 2.0 préféré** | Basic Auth envoie les identifiants à chaque appel API. OAuth utilise des jetons de courte durée avec des restrictions de portee. |
| **Rotation des identifiants** | Changez les mots de passe ou les secrets client tous les 90 jours. |

### Sécurité réseau

| Pratique | Détails |
|----------|---------|
| **HTTPS impose** | Les URL HTTP sont rejetees lors de la validation. Toutes les connexions doivent utiliser HTTPS. |
| **Validation des noms de table** | Les noms de table sont valides par rapport a `^[a-zA-Z0-9_]+$` pour prévenir l'injection. |
| **Validation des sys_id** | Les valeurs sys_id sont validees comme des chaînes hexadecimales de 32 caractères. |
| **Liste blanche IP** | Configurez le contrôle d'acces IP ServiceNow pour n'autoriser que l'IP de votre serveur Turbo EA. |

### Contrôle d'acces

| Pratique | Détails |
|----------|---------|
| **Protégé par RBAC** | Tous les endpoints ServiceNow requierent la permission `servicenow.manage`. |
| **Piste d'audit** | Toutes les modifications créées par la synchronisation publient des événements avec `source: "servicenow_sync"`, visibles dans l'historique de la fiche. |
| **Pas d'exposition des identifiants** | Les mots de passe et secrets ne sont jamais retournes dans les réponses API. |

### Checklist de production

- [ ] Compte de service ServiceNow dédié (pas un compte personnel)
- [ ] OAuth 2.0 avec grant client credentials
- [ ] Calendrier de rotation des identifiants (tous les 90 jours)
- [ ] Compte de service restreint aux tables mappees uniquement
- [ ] Liste blanche IP ServiceNow configurée pour l'IP du serveur Turbo EA
- [ ] Ratio max de suppression défini à 50% ou moins
- [ ] Exécutions de synchronisation surveillees pour les nombres inhabituels d'erreurs ou de suppressions
- [ ] Les requetes de filtre incluent `active=true` au minimum

---

## Guide opérationnel

### Sequence de configuration initiale

```
1. Creer le compte de service ServiceNow avec les roles minimum requis
2. Verifier la connectivite reseau (Turbo EA peut-il atteindre SNOW via HTTPS ?)
3. Creer la connexion dans Turbo EA et la tester
4. Verifier que les types du metamodele ont tous les champs que vous souhaitez synchroniser
5. Creer le premier mapping avec le mode ADDITIF, staging ACTIVE
6. Utiliser le bouton Apercu (via API) pour verifier que le mapping produit le bon resultat
7. Executer la premiere synchronisation pull -- examiner les enregistrements en staging dans le tableau de bord
8. Appliquer les enregistrements en staging
9. Verifier les fiches importees dans l'Inventaire
10. Ajuster les mappings de champs si necessaire, relancer
11. Basculer le mapping en mode CONSERVATEUR pour l'utilisation continue
12. Apres plusieurs executions reussies, activer Sauter le staging pour l'automatisation
```

### Opérations courantes

| Tâche | Fréquence | Comment |
|-------|-----------|---------|
| Exécuter la synchronisation pull | Quotidien ou hebdomadaire | Tableau de bord de sync > bouton Pull (ou cron) |
| Examiner les statistiques de sync | Après chaque exécution | Verifier les compteurs d'erreurs/suppressions |
| Tester les connexions | Mensuel | Cliquer sur le bouton de test de chaque connexion |
| Changer les identifiants | Trimestriel | Mettre à jour dans SNOW et Turbo EA |
| Examiner la carte d'identité | Trimestriel | Verifier les entrees orphelines via les stats de sync |
| Auditer l'historique des fiches | Selon les besoins | Filtrer les événements par source `servicenow_sync` |

### Configuration des synchronisations automatisées

Les synchronisations peuvent être declenchees via API pour l'automatisation :

```bash
# Synchronisation pull quotidienne a 2h00 du matin
0 2 * * * curl -s -X POST \
  -H "Authorization: Bearer $TURBOEA_TOKEN" \
  "https://turboea.entreprise.com/api/v1/servicenow/sync/pull/$MAPPING_ID" \
  >> /var/log/turboea-sync.log 2>&1
```

**Bonne pratique** : Exécutez les synchronisations pendant les heures creuses. Pour les grandes tables CMDB (10 000+ CI), prévoyez 2 a 5 minutes selon la latence réseau et le nombre d'enregistrements.

### Planification de capacité

| Taille CMDB | Durée prevue | Recommandation |
|-------------|--------------|----------------|
| < 500 CI | < 30 secondes | Synchroniser quotidiennement, staging optionnel |
| 500-5 000 CI | 30s - 2 minutes | Synchroniser quotidiennement, sauter le staging |
| 5 000-20 000 CI | 2-5 minutes | Synchroniser la nuit, sauter le staging |
| 20 000+ CI | 5-15 minutes | Synchroniser hebdomadairement, utiliser des requetes de filtre pour diviser |

---

## Dépannage

### Problemes de connexion

| Symptome | Cause | Solution |
|----------|-------|----------|
| `Connection failed: [SSL]` | Certificat auto-signe ou expire | Assurez-vous que SNOW utilise un certificat CA public validé |
| `HTTP 401: Unauthorized` | Mauvais identifiants | Ressaisissez le nom d'utilisateur/mot de passe ; vérifiez que le compte n'est pas verrouille |
| `HTTP 403: Forbidden` | Rôles insuffisants | Accordez `itil` et `cmdb_read` au compte de service |
| `Connection failed: timed out` | Blocage du pare-feu | Vérifiez les regles ; mettez l'IP de Turbo EA en liste blanche dans SNOW |
| Test OK mais sync échoué | Permissions au niveau de la table | Accordez l'acces en lecture à la table CMDB spécifique |

### Problemes de synchronisation

| Symptome | Cause | Solution |
|----------|-------|----------|
| 0 enregistrements récupérés | Mauvaise table ou filtre | Vérifiez le nom de la table ; simplifiez la requete de filtre |
| Tous les enregistrements sont des « create » | Non-correspondance d'identité | Marquez `name` comme identité ; vérifiez que les noms correspondent entre les systèmes |
| Nombre élevé d'erreurs | Echecs de transformation | Vérifiez les enregistrements staging pour les messages d'erreur |
| Suppressions sautees | Ratio dépasse | Augmentez le seuil ou investiguez pourquoi les CI ont disparu |
| Modifications non visibles | Cache du navigateur | Rafraichissement force ; vérifiez l'historique de la fiche pour les événements |
| Fiches en double | Mappings multiples pour le même type | Utilisez un mapping par type de fiche par connexion |
| Modifications push rejetees | Permissions SNOW manquantes | Accordez le rôle `import_admin` au compte de service |

### Outils de diagnostic

```bash
# Apercu du mapping des enregistrements (5 echantillons, sans effet de bord)
POST /api/v1/servicenow/mappings/{mapping_id}/preview

# Parcourir les tables sur l'instance SNOW
GET /api/v1/servicenow/connections/{conn_id}/tables?search=cmdb

# Inspecter les colonnes d'une table
GET /api/v1/servicenow/connections/{conn_id}/tables/cmdb_ci_business_app/fields

# Filtrer les enregistrements staging par action ou statut
GET /api/v1/servicenow/sync/runs/{run_id}/staged?action=create
GET /api/v1/servicenow/sync/runs/{run_id}/staged?action=update
GET /api/v1/servicenow/sync/runs/{run_id}/staged?status=error
```

---

## Référence API (rapide)

Tous les endpoints necessitent `Authorization: Bearer <token>` et la permission `servicenow.manage`. Chemin de base : `/api/v1`.

### Connexions

| Méthode | Chemin | Description |
|---------|--------|-------------|
| GET | `/servicenow/connections` | Lister les connexions |
| POST | `/servicenow/connections` | Créer une connexion |
| GET | `/servicenow/connections/{id}` | Obtenir une connexion |
| PATCH | `/servicenow/connections/{id}` | Mettre à jour une connexion |
| DELETE | `/servicenow/connections/{id}` | Supprimer une connexion + tous les mappings |
| POST | `/servicenow/connections/{id}/test` | Tester la connectivite |
| GET | `/servicenow/connections/{id}/tables` | Parcourir les tables SNOW |
| GET | `/servicenow/connections/{id}/tables/{table}/fields` | Lister les colonnes de la table |

### Mappings

| Méthode | Chemin | Description |
|---------|--------|-------------|
| GET | `/servicenow/mappings` | Lister les mappings avec les mappings de champs |
| POST | `/servicenow/mappings` | Créer un mapping avec les mappings de champs |
| GET | `/servicenow/mappings/{id}` | Obtenir un mapping avec les mappings de champs |
| PATCH | `/servicenow/mappings/{id}` | Mettre à jour un mapping (remplace les champs si fournis) |
| DELETE | `/servicenow/mappings/{id}` | Supprimer un mapping |
| POST | `/servicenow/mappings/{id}/preview` | Aperçu dry-run (5 enregistrements echantillons) |

### Opérations de synchronisation

| Méthode | Chemin | Description |
|---------|--------|-------------|
| POST | `/servicenow/sync/pull/{mapping_id}` | Pull sync (`?auto_apply=true` par défaut) |
| POST | `/servicenow/sync/push/{mapping_id}` | Push sync |
| GET | `/servicenow/sync/runs` | Lister l'historique des syncs (`?limit=20`) |
| GET | `/servicenow/sync/runs/{id}` | Obtenir les détails de l'exécution + statistiques |
| GET | `/servicenow/sync/runs/{id}/staged` | Lister les enregistrements staging d'une exécution |
| POST | `/servicenow/sync/runs/{id}/apply` | Appliquer les enregistrements staging en attente |
