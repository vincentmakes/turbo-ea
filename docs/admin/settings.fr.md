# Paramètres généraux

La page **Paramètres** (**Admin > Paramètres**) fournit une configuration centralisée pour l'apparence de la plateforme, l'e-mail et les bascules de modules.

## Apparence

### Logo

Téléchargez un logo personnalisé qui apparaît dans la barre de navigation superieure. Formats pris en charge : PNG, JPEG, SVG, WebP, GIF. Cliquez sur **Réinitialiser** pour revenir au logo Turbo EA par défaut.

### Favicon

Téléchargez une icône de navigateur personnalisée (favicon). Le changement prend effet au prochain chargement de page. Cliquez sur **Réinitialiser** pour revenir à l'icône par défaut.

### Devise

Sélectionnez la devise utilisee pour les champs de coût dans toute la plateforme. Cela affecte la manière dont les valeurs de coût sont formatees dans les pages de détail des fiches, les rapports et les exports. Plus de 20 devises sont prises en charge, incluant USD, EUR, GBP, JPY, CNY, CHF, INR, BRL, et plus.

### Langues activees

Basculez les langues disponibles pour les utilisateurs dans leur sélecteur de langue. Les sept langues supportées peuvent être activees ou désactivées individuellement :

- English, Deutsch, Français, Español, Italiano, Português, 中文

Au moins une langue doit rester activée en permanence.

## E-mail (SMTP)

Configurez la livraison d'e-mails pour les e-mails d'invitation, les notifications d'enquête et autres messages système.

| Champ | Description |
|-------|-------------|
| **Hote SMTP** | Le nom d'hote de votre serveur de messagerie (par ex. `smtp.gmail.com`) |
| **Port SMTP** | Port du serveur (généralement 587 pour TLS) |
| **Utilisateur SMTP** | Nom d'utilisateur d'authentification |
| **Mot de passe SMTP** | Mot de passe d'authentification (stocke chiffre) |
| **Utiliser TLS** | Activer le chiffrement TLS (recommandé) |
| **Adresse d'expedition** | L'adresse e-mail de l'expéditeur pour les messages sortants |
| **URL de base de l'application** | L'URL publique de votre instance Turbo EA (utilisee dans les liens des e-mails) |

Après la configuration, cliquez sur **Envoyer un e-mail de test** pour verifier que les paramètres fonctionnent correctement.

!!! note
    L'e-mail est optionnel. Si le SMTP n'est pas configuré, les fonctionnalités qui envoient des e-mails (invitations, notifications d'enquête) passeront gracieusement la livraison par e-mail.

## Module BPM

Activez ou desactivez le module **Gestion des processus métier**. Lorsqu'il est désactivé :

- L'élément de navigation **BPM** est masque pour tous les utilisateurs
- Les fiches Processus Métier restent dans la base de données mais les fonctionnalités spécifiques au BPM (éditeur de flux de processus, tableau de bord BPM, rapports BPM) ne sont pas accessibles

Ceci est utile pour les organisations qui n'utilisent pas le BPM et souhaitent une experience de navigation plus épurée.
