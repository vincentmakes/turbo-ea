# Suggestions de description par IA

![Parametres de suggestion IA](../assets/img/en/26_admin_settings_ai.png)

Turbo EA peut générer automatiquement des descriptions de fiches en combinant la **recherche web** et un **grand modèle de langage (LLM)**. Lorsqu'un utilisateur clique sur le bouton de suggestion IA sur une fiche, le système recherche sur le web des informations pertinentes sur le composant, puis utilise un LLM pour produire une description concise et adaptée au type -- complète avec un score de confiance et des liens vers les sources cliquables.

Cette fonctionnalité est **optionnelle** et **entièrement contrôlée par l'administrateur**. Elle peut s'exécuter entièrement sur votre propre infrastructure en utilisant une instance Ollama locale, ou se connecter à des fournisseurs LLM commerciaux.

---

## Comment ca marche

Le pipeline de suggestion IA comporte deux étapes :

1. **Recherche web** -- Turbo EA interroge un fournisseur de recherche (DuckDuckGo, Google Custom Search ou SearXNG) en utilisant le nom et le type de la fiche comme contexte. Par exemple, une fiche Application nommee « SAP S/4HANA » généré une recherche pour « SAP S/4HANA software application ».

2. **Extraction LLM** -- Les résultats de recherche sont envoyes au LLM configuré avec un prompt système adapté au type. Le modèle produit une description, un score de confiance (0-100%) et liste les sources utilisees.

Le résultat est affiche à l'utilisateur avec :

- Une **description modifiable** qu'il peut examiner et modifier avant de l'appliquer
- Un **badge de confiance** montrant la fiabilité de la suggestion
- Des **liens vers les sources** pour que l'utilisateur puisse verifier les informations

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

Les fournisseurs commerciaux necessitent une clé API, qui est stockee chiffree dans la base de données en utilisant le chiffrement symetrique Fernet.

---

## Fournisseurs de recherche

| Fournisseur | Configuration | Notes |
|-------------|---------------|-------|
| **DuckDuckGo** | Aucune configuration nécessaire | Par défaut. Extraction HTML sans dépendance. Aucune clé API requise. |
| **Google Custom Search** | Nécessité une clé API et un ID de moteur de recherche personnalisé | Entrez au format `API_KEY:CX` dans le champ URL de recherche. Résultats de meilleure qualité. |
| **SearXNG** | Nécessité une URL d'instance SearXNG auto-hébergée | Moteur de meta-recherche axe sur la confidentialité. API JSON. |

---

## Installation

### Option A : Ollama intégré (Docker Compose)

La manière la plus simple de commencer. Turbo EA inclut un conteneur Ollama optionnel dans sa configuration Docker Compose.

**1. Demarrez avec le profil AI :**

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
- Télécharger le modèle configuré s'il n'est pas déjà present (s'exécuté en arriere-plan, peut prendre quelques minutes)

**3. Vérifiez** dans l'interface d'administration : allez dans **Paramètres > Suggestions IA** et confirmez que le statut indiqué connecté.

### Option B : Instance Ollama externe

Si vous exécutez déjà Ollama sur un serveur separe :

1. Allez dans **Paramètres > Suggestions IA** dans l'interface d'administration.
2. Sélectionnez **Ollama** comme type de fournisseur.
3. Entrez l'**URL du fournisseur** (par ex. `http://votre-serveur:11434`).
4. Cliquez sur **Tester la connexion** -- le système affichera les modèles disponibles.
5. Sélectionnez un **modèle** dans la liste déroulante.
6. Cliquez sur **Sauvegarder**.

### Option C : Fournisseur LLM commercial

1. Allez dans **Paramètres > Suggestions IA** dans l'interface d'administration.
2. Sélectionnez votre fournisseur (OpenAI, Google Gemini, Azure OpenAI, OpenRouter ou Anthropic Claude).
3. Entrez votre **clé API** -- elle sera chiffree avant le stockage.
4. Entrez le **nom du modèle** (par ex. `gpt-4o`, `gemini-pro`, `claude-sonnet-4-20250514`).
5. Cliquez sur **Tester la connexion** pour verifier.
6. Cliquez sur **Sauvegarder**.

---

## Options de configuration

Une fois connecté, vous pouvez affiner la fonctionnalité dans **Paramètres > Suggestions IA** :

### Activer/désactiver par type de fiche

Tous les types de fiches ne bénéficient pas également des suggestions IA. Vous pouvez activer ou désactiver l'IA pour chaque type individuellement. Par exemple, vous pourriez l'activer pour les fiches Application et Composant IT mais la désactiver pour les fiches Organisation ou les descriptions sont spécifiques à l'entreprise.

### Fournisseur de recherche

Choisissez quel fournisseur de recherche web utiliser pour collecter le contexte avant l'envoi au LLM. DuckDuckGo fonctionne immédiatement sans configuration. Google Custom Search et SearXNG necessitent une configuration supplémentaire (voir le tableau des fournisseurs de recherche ci-dessus).

### Sélection du modèle

Pour Ollama, l'interface d'administration affiche tous les modèles actuellement téléchargés sur l'instance Ollama. Pour les fournisseurs commerciaux, entrez directement l'identifiant du modèle.

---

## Utilisation des suggestions IA

![Panneau de suggestion IA sur le detail de la fiche](../assets/img/en/27_ai_suggest_panel.png)

Une fois configuré par un administrateur, les utilisateurs disposant de la permission `ai.suggest` (accordee par défaut aux rôles Admin, Admin BPM et Membre) verront un bouton étincelle sur les pages de détail des fiches et dans le dialogue de création de fiche.

### Sur une fiche existante

1. Ouvrez la vue détail de n'importe quelle fiche.
2. Cliquez sur le **bouton étincelle** (visible a côté de la section description lorsque l'IA est activée pour ce type de fiche).
3. Attendez quelques secondes pour la recherche web et le traitement LLM.
4. Examinez la suggestion : lisez la description générée, vérifiez le score de confiance et les liens vers les sources.
5. **Modifiez** le texte si nécessaire -- la suggestion est entièrement modifiable avant l'application.
6. Cliquez sur **Appliquer** pour définir la description, ou **Ignorer** pour la rejeter.

### Lors de la création d'une nouvelle fiche

1. Ouvrez le dialogue **Créer une fiche**.
2. Après avoir entre le nom de la fiche, le bouton de suggestion IA devient disponible.
3. Cliquez dessus pour pre-remplir la description avant la sauvegarde.

!!! note
    Les suggestions IA ne generent que le champ **description**. Elles ne remplissent pas d'autres attributs comme le cycle de vie, le coût ou les champs personnalisés.

---

## Permissions

| Rôle | Acces |
|------|-------|
| **Admin** | Acces complet : configurer les paramètres IA et utiliser les suggestions |
| **Admin BPM** | Utiliser les suggestions |
| **Membre** | Utiliser les suggestions |
| **Lecteur** | Pas d'acces aux suggestions IA |

La clé de permission est `ai.suggest`. Les rôles personnalisés peuvent recevoir cette permission via la page d'administration des Rôles.

---

## Confidentialité et sécurité

- **Option auto-hébergée** : Lorsque vous utilisez Ollama, tout le traitement IA s'effectue sur votre propre infrastructure. Aucune donnée ne quitte votre réseau.
- **Clés API chiffrées** : Les clés API des fournisseurs commerciaux sont chiffrées avec le chiffrement symetrique Fernet avant d'être stockees dans la base de données.
- **Contexte de recherche uniquement** : Le LLM reçoit les résultats de recherche web et le nom/type de la fiche -- pas vos données internes de fiches, relations ou autres métadonnées sensibles.
- **Contrôle utilisateur** : Chaque suggestion doit être examinee et explicitement appliquee par un utilisateur. L'IA ne modifié jamais les fiches automatiquement.

---

## Dépannage

| Probleme | Solution |
|----------|----------|
| Le bouton de suggestion IA n'est pas visible | Vérifiez que l'IA est activée pour le type de fiche dans Paramètres > Suggestions IA, et que l'utilisateur à la permission `ai.suggest`. |
| Statut « IA non configurée » | Allez dans Paramètres > Suggestions IA et complétez la configuration du fournisseur. Cliquez sur Tester la connexion pour verifier. |
| Le modèle n'apparaît pas dans la liste déroulante | Pour Ollama : assurez-vous que le modèle est téléchargé (`ollama pull nom-du-modele`). Pour les fournisseurs commerciaux : entrez le nom du modèle manuellement. |
| Suggestions lentes | La vitesse d'inference LLM dépend du matériel (pour Ollama) ou de la latence réseau (pour les fournisseurs commerciaux). Les modèles plus petits comme `gemma3:4b` sont plus rapides que les plus grands. |
| Scores de confiance faibles | Le LLM peut ne pas trouver suffisamment d'informations pertinentes via la recherche web. Essayez un nom de fiche plus spécifique, ou envisagez d'utiliser Google Custom Search pour de meilleurs résultats. |
| Le test de connexion échoué | Vérifiez que l'URL du fournisseur est accessible depuis le conteneur backend. Pour les configurations Docker, assurez-vous que les deux conteneurs sont sur le même réseau. |

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
