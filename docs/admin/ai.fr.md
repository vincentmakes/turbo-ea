# Fonctionnalités IA

![Paramètres de suggestion IA](../assets/img/en/26_admin_settings_ai.png)

Turbo EA inclut des fonctionnalités alimentées par l'IA qui utilisent un **grand modèle de langage (LLM)** pour aider les utilisateurs. Toutes les fonctionnalités IA partagent une seule **configuration de fournisseur IA** — configurez une fois, utilisez partout.

Fonctionnalités IA actuellement disponibles :

- **Suggestions de description** — Génération automatique de descriptions de fiches à l'aide de la recherche web + LLM
- **Analyses du portefeuille** — Analyse stratégique à la demande du portefeuille applicatif

Ces fonctionnalités sont **optionnelles** et **entièrement contrôlées par l'administrateur**. Elles peuvent s'exécuter entièrement sur votre propre infrastructure en utilisant une instance Ollama locale, ou se connecter à des fournisseurs LLM commerciaux.

---

## Comment ça marche

Le pipeline de suggestion IA comporte deux étapes :

1. **Recherche web** -- Turbo EA interroge un fournisseur de recherche (DuckDuckGo, Google Custom Search ou SearXNG) en utilisant le nom et le type de la fiche comme contexte. Par exemple, une fiche Application nommée « SAP S/4HANA » génère une recherche pour « SAP S/4HANA software application ».

2. **Extraction LLM** -- Les résultats de recherche sont envoyés au LLM configuré avec un prompt système adapté au type. Le modèle produit une description, un score de confiance (0-100%) et liste les sources utilisées.

Le résultat est affiché à l'utilisateur avec :

- Une **description modifiable** qu'il peut examiner et modifier avant de l'appliquer
- Un **badge de confiance** montrant la fiabilité de la suggestion
- Des **liens vers les sources** pour que l'utilisateur puisse vérifier les informations

---

## Fournisseurs LLM pris en charge

| Fournisseur | Type | Configuration |
|-------------|------|---------------|
| **Ollama** | Auto-hébergé | URL du fournisseur (par ex. `http://ollama:11434`) + nom du modèle |
| **OpenAI** | Commercial | Clé API + nom du modèle (par ex. `gpt-4o`) |
| **Google Gemini** | Commercial | Clé API + nom du modèle |
| **Azure OpenAI** | Commercial | Clé API + URL de déploiement |
| **OpenRouter** | Commercial | Clé API + nom du modèle |
| **Anthropic Claude** | Commercial | Clé API + nom du modèle |

Les fournisseurs commerciaux nécessitent une clé API, qui est stockée chiffrée dans la base de données en utilisant le chiffrement symétrique Fernet.

---

## Fournisseurs de recherche

| Fournisseur | Configuration | Notes |
|-------------|---------------|-------|
| **DuckDuckGo** | Aucune configuration nécessaire | Par défaut. Extraction HTML sans dépendance. Aucune clé API requise. |
| **Google Custom Search** | Nécessite une clé API et un ID de moteur de recherche personnalisé | Entrez au format `API_KEY:CX` dans le champ URL de recherche. Résultats de meilleure qualité. |
| **SearXNG** | Nécessite une URL d'instance SearXNG auto-hébergée | Moteur de meta-recherche axé sur la confidentialité. API JSON. |

---

## Installation

### Option A : Ollama intégré (Docker Compose)

La manière la plus simple de commencer. Turbo EA inclut un conteneur Ollama optionnel dans sa configuration Docker Compose.

**1. Démarrez avec le profil AI :**

```bash
docker compose --profile ai up --build -d
```

**2. Activez la configuration automatique** en ajoutant ces variables à votre `.env` :

```dotenv
AI_AUTO_CONFIGURE=true
AI_MODEL=gemma3:4b          # ou mistral, llama3:8b, etc.
```

Au démarrage, le backend va :

- Détecter le conteneur Ollama
- Sauvegarder les paramètres de connexion dans la base de données
- Télécharger le modèle configuré s'il n'est pas déjà présent (s'exécute en arrière-plan, peut prendre quelques minutes)

**3. Vérifiez** dans l'interface d'administration : allez dans **Paramètres > Suggestions IA** et confirmez que le statut indique connecté.

### Option B : Instance Ollama externe

Si vous exécutez déjà Ollama sur un serveur séparé :

1. Allez dans **Paramètres > Suggestions IA** dans l'interface d'administration.
2. Sélectionnez **Ollama** comme type de fournisseur.
3. Entrez l'**URL du fournisseur** (par ex. `http://votre-serveur:11434`).
4. Cliquez sur **Tester la connexion** -- le système affichera les modèles disponibles.
5. Sélectionnez un **modèle** dans la liste déroulante.
6. Cliquez sur **Sauvegarder**.

### Option C : Fournisseur LLM commercial

1. Allez dans **Paramètres > Suggestions IA** dans l'interface d'administration.
2. Sélectionnez votre fournisseur (OpenAI, Google Gemini, Azure OpenAI, OpenRouter ou Anthropic Claude).
3. Entrez votre **clé API** -- elle sera chiffrée avant le stockage.
4. Entrez le **nom du modèle** (par ex. `gpt-4o`, `gemini-pro`, `claude-sonnet-4-20250514`).
5. Cliquez sur **Tester la connexion** pour vérifier.
6. Cliquez sur **Sauvegarder**.

---

## Options de configuration

Une fois connecté, vous pouvez affiner la fonctionnalité dans **Paramètres > Suggestions IA** :

### Activer/désactiver par type de fiche

Tous les types de fiches ne bénéficient pas également des suggestions IA. Vous pouvez activer ou désactiver l'IA pour chaque type individuellement. Par exemple, vous pourriez l'activer pour les fiches Application et Composant IT mais la désactiver pour les fiches Organisation où les descriptions sont spécifiques à l'entreprise.

### Fournisseur de recherche

Choisissez quel fournisseur de recherche web utiliser pour collecter le contexte avant l'envoi au LLM. DuckDuckGo fonctionne immédiatement sans configuration. Google Custom Search et SearXNG nécessitent une configuration supplémentaire (voir le tableau des fournisseurs de recherche ci-dessus).

### Sélection du modèle

Pour Ollama, l'interface d'administration affiche tous les modèles actuellement téléchargés sur l'instance Ollama. Pour les fournisseurs commerciaux, entrez directement l'identifiant du modèle.

---

## Utilisation des suggestions IA

![Panneau de suggestion IA sur le détail de la fiche](../assets/img/en/27_ai_suggest_panel.png)

Une fois configuré par un administrateur, les utilisateurs disposant de la permission `ai.suggest` (accordée par défaut aux rôles Admin, Admin BPM et Membre) verront un bouton étincelle sur les pages de détail des fiches et dans le dialogue de création de fiche.

### Sur une fiche existante

1. Ouvrez la vue détail de n'importe quelle fiche.
2. Cliquez sur le **bouton étincelle** (visible à côté de la section description lorsque l'IA est activée pour ce type de fiche).
3. Attendez quelques secondes pour la recherche web et le traitement LLM.
4. Examinez la suggestion : lisez la description générée, vérifiez le score de confiance et les liens vers les sources.
5. **Modifiez** le texte si nécessaire -- la suggestion est entièrement modifiable avant l'application.
6. Cliquez sur **Appliquer** pour définir la description, ou **Ignorer** pour la rejeter.

### Lors de la création d'une nouvelle fiche

1. Ouvrez le dialogue **Créer une fiche**.
2. Après avoir entré le nom de la fiche, le bouton de suggestion IA devient disponible.
3. Cliquez dessus pour pré-remplir la description avant la sauvegarde.

### Suggestions spécifiques aux Applications

Pour les fiches **Application**, l'IA peut également suggérer des champs supplémentaires lorsqu'elle trouve des preuves dans les résultats de recherche web :

- **Application commerciale** — activé si des pages de tarification, d'informations de licence ou de contact commercial sont trouvées
- **Type d'hébergement** — suggéré comme On-Premise, Cloud (SaaS), Cloud (PaaS), Cloud (IaaS) ou Hybride selon le modèle de déploiement du produit

Ces champs ne sont suggérés que lorsque l'IA trouve des preuves claires — ils ne sont pas spéculés. L'utilisateur peut examiner et ajuster les valeurs avant de les appliquer.

!!! note
    En dehors des champs spécifiques aux Applications, les suggestions IA génèrent principalement le champ **description**. Les champs personnalisés pour les autres types de fiches ne sont pas encore couverts.

---

## Analyses du portefeuille

Lorsque cette fonctionnalité est activée, le rapport de portefeuille applicatif affiche un bouton **Analyses IA**. Un clic envoie un résumé de la vue actuelle du portefeuille — regroupement, distributions d'attributs et données de cycle de vie — au LLM configuré, qui renvoie 3 à 5 analyses exploitables.

Les analyses se concentrent sur :

- **Risques de concentration** — trop d'applications dans un groupe ou un état
- **Opportunités de modernisation** — basées sur les données de cycle de vie et d'hébergement
- **Équilibre du portefeuille** — diversité des sous-types, groupes et attributs
- **Préoccupations de cycle de vie** — applications approchant de la fin de vie
- **Facteurs de coût ou de complexité** — basés sur les distributions d'attributs

### Activer les analyses du portefeuille

1. Allez dans **Paramètres > IA > Analyses du portefeuille**.
2. Activez **Analyses du portefeuille**.
3. Cliquez sur **Enregistrer**.

---

## Permissions

| Rôle | Accès |
|------|-------|
| **Admin** | Accès complet : configurer les paramètres IA, utiliser les suggestions et les analyses du portefeuille |
| **Admin BPM** | Utiliser les suggestions et les analyses du portefeuille |
| **Membre** | Utiliser les suggestions et les analyses du portefeuille |
| **Lecteur** | Pas d'accès aux fonctionnalités IA |

Les clés de permission sont `ai.suggest` et `ai.portfolio_insights`. Les rôles personnalisés peuvent recevoir ces permissions via la page d'administration des Rôles.

---

## Confidentialité et sécurité

- **Option auto-hébergée** : Lorsque vous utilisez Ollama, tout le traitement IA s'effectue sur votre propre infrastructure. Aucune donnée ne quitte votre réseau.
- **Clés API chiffrées** : Les clés API des fournisseurs commerciaux sont chiffrées avec le chiffrement symétrique Fernet avant d'être stockées dans la base de données.
- **Contexte de recherche uniquement** : Le LLM reçoit les résultats de recherche web et le nom/type de la fiche -- pas vos données internes de fiches, relations ou autres métadonnées sensibles.
- **Contrôle utilisateur** : Chaque suggestion doit être examinée et explicitement appliquée par un utilisateur. L'IA ne modifie jamais les fiches automatiquement.

---

## Dépannage

| Problème | Solution |
|----------|----------|
| Le bouton de suggestion IA n'est pas visible | Vérifiez que l'IA est activée pour le type de fiche dans Paramètres > Suggestions IA, et que l'utilisateur a la permission `ai.suggest`. |
| Statut « IA non configurée » | Allez dans Paramètres > Suggestions IA et complétez la configuration du fournisseur. Cliquez sur Tester la connexion pour vérifier. |
| Le modèle n'apparaît pas dans la liste déroulante | Pour Ollama : assurez-vous que le modèle est téléchargé (`ollama pull nom-du-modele`). Pour les fournisseurs commerciaux : entrez le nom du modèle manuellement. |
| Suggestions lentes | La vitesse d'inférence LLM dépend du matériel (pour Ollama) ou de la latence réseau (pour les fournisseurs commerciaux). Les modèles plus petits comme `gemma3:4b` sont plus rapides que les plus grands. |
| Scores de confiance faibles | Le LLM peut ne pas trouver suffisamment d'informations pertinentes via la recherche web. Essayez un nom de fiche plus spécifique, ou envisagez d'utiliser Google Custom Search pour de meilleurs résultats. |
| Le test de connexion échoue | Vérifiez que l'URL du fournisseur est accessible depuis le conteneur backend. Pour les configurations Docker, assurez-vous que les deux conteneurs sont sur le même réseau. |

---

## Variables d'environnement

Ces variables d'environnement fournissent la configuration initiale de l'IA. Une fois sauvegardées via l'interface d'administration, les paramètres de la base de données prennent le dessus.

| Variable | Défaut | Description |
|----------|--------|-------------|
| `AI_PROVIDER_URL` | *(vide)* | URL du fournisseur LLM compatible Ollama |
| `AI_MODEL` | *(vide)* | Nom du modèle LLM (par ex. `gemma3:4b`, `mistral`) |
| `AI_SEARCH_PROVIDER` | `duckduckgo` | Fournisseur de recherche web : `duckduckgo`, `google` ou `searxng` |
| `AI_SEARCH_URL` | *(vide)* | URL du fournisseur de recherche ou identifiants API |
| `AI_AUTO_CONFIGURE` | `false` | Activer automatiquement l'IA au démarrage si le fournisseur est accessible |
