# Paramètres généraux

La page **Paramètres** (**Admin > Paramètres**) fournit une configuration centralisée pour l'apparence de la plateforme, l'e-mail et les bascules de modules.

## Apparence

### Logo

Téléchargez un logo personnalisé qui apparaît dans la barre de navigation supérieure. Formats pris en charge : PNG, JPEG, SVG, WebP, GIF. Cliquez sur **Réinitialiser** pour revenir au logo Turbo EA par défaut.

### Favicon

Téléchargez une icône de navigateur personnalisée (favicon). Le changement prend effet au prochain chargement de page. Cliquez sur **Réinitialiser** pour revenir à l'icône par défaut.

### Devise

Sélectionnez la devise utilisée pour les champs de coût dans toute la plateforme. Cela affecte la manière dont les valeurs de coût sont formatées dans les pages de détail des fiches, les rapports et les exports. Plus de 20 devises sont prises en charge, incluant USD, EUR, GBP, JPY, CNY, CHF, INR, BRL, et plus.

### Langues activées

Basculez les langues disponibles pour les utilisateurs dans leur sélecteur de langue. Les huit langues supportées peuvent être activées ou désactivées individuellement :

- English, Deutsch, Français, Español, Italiano, Português, 中文, Русский

Au moins une langue doit rester activée en permanence.

### Début de l'exercice fiscal

Sélectionnez le mois de début de l'exercice fiscal de votre organisation (janvier à décembre). Ce paramètre affecte le regroupement des **lignes budgétaires** dans le module PPM par exercice fiscal. Par exemple, si l'exercice fiscal commence en avril, une ligne budgétaire de juin 2026 appartient à l'EF 2026–2027.

La valeur par défaut est **janvier** (année civile = exercice fiscal).

## E-mail (SMTP)

Configurez la livraison d'e-mails pour les e-mails d'invitation, les notifications d'enquête et autres messages système.

| Champ | Description |
|-------|-------------|
| **Hôte SMTP** | Le nom d'hôte de votre serveur de messagerie (par ex. `smtp.gmail.com`) |
| **Port SMTP** | Port du serveur (généralement 587 pour TLS) |
| **Utilisateur SMTP** | Nom d'utilisateur d'authentification |
| **Mot de passe SMTP** | Mot de passe d'authentification (stocké chiffré) |
| **Utiliser TLS** | Activer le chiffrement TLS (recommandé) |
| **Adresse d'expédition** | L'adresse e-mail de l'expéditeur pour les messages sortants |
| **URL de base de l'application** | L'URL publique de votre instance Turbo EA (utilisée dans les liens des e-mails) |

Après la configuration, cliquez sur **Envoyer un e-mail de test** pour vérifier que les paramètres fonctionnent correctement.

!!! note
    L'e-mail est optionnel. Si le SMTP n'est pas configuré, les fonctionnalités qui envoient des e-mails (invitations, notifications d'enquête) passeront gracieusement la livraison par e-mail.

## Module BPM

Activez ou désactivez le module **Gestion des processus métier**. Lorsqu'il est désactivé :

- L'élément de navigation **BPM** est masqué pour tous les utilisateurs
- Les fiches Processus Métier restent dans la base de données mais les fonctionnalités spécifiques au BPM (éditeur de flux de processus, tableau de bord BPM, rapports BPM) ne sont pas accessibles

Ceci est utile pour les organisations qui n'utilisent pas le BPM et souhaitent une expérience de navigation plus épurée.

## Module PPM

Activez ou désactivez le module **Gestion de portefeuille de projets** (PPM). Lorsqu'il est désactivé :

- L'élément de navigation **PPM** est masqué pour tous les utilisateurs
- Les fiches Initiative restent dans la base de données mais les fonctionnalités spécifiques au PPM (rapports de statut, suivi budgétaire et des coûts, registre des risques, tableau de tâches, diagramme de Gantt) ne sont pas accessibles

Lorsqu'il est activé, les fiches Initiative disposent d'un onglet **PPM** dans leur vue de détail et le tableau de bord du portefeuille PPM est disponible dans la navigation principale. Voir [Gestion de portefeuille de projets](../guide/ppm.md) pour le guide complet des fonctionnalités.
