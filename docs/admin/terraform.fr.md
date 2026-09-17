# Terraform

Les équipes qui gèrent leur cloud avec Terraform peuvent déployer Turbo EA de la même manière. Le dépôt fournit quatre modules racines sous [`deploy/terraform/`](https://github.com/vincentmakes/turbo-ea/tree/main/deploy/terraform) — un pour chaque service de conteneurs managé couvert par la page [Services de conteneurs managés](managed-containers.md), plus un qui installe le chart Helm de la page [Kubernetes et cloud](kubernetes.md) sur un cluster que vous exploitez déjà. Cette page traite des modules ; les deux pages liées restent la référence sur ce que chaque plateforme peut faire ou non.

## Ce que construisent les modules

| Module | Plateforme | Crée | Vous apportez |
|---|---|---|---|
| `ecs-fargate` | AWS ECS Fargate | Cluster, tâche et service, Application Load Balancer en HTTPS, EFS, secrets Secrets Manager, RDS for PostgreSQL (optionnel) | Un VPC avec des sous-réseaux publics et privés (NAT), un certificat ACM |
| `azure-container-apps` | Azure Container Apps | Environnement, container app, Log Analytics, compte de stockage et partage de fichiers, Flexible Server (optionnel) | Un groupe de ressources ; éventuellement un sous-réseau délégué et une zone DNS privée |
| `cloud-run` | Google Cloud Run | Service, Filestore, secrets Secret Manager, dépôt distant Artifact Registry, équilibreur de charge HTTPS global avec certificat managé, Cloud SQL (optionnel) | Un projet, un VPC avec un sous-réseau, l'accès aux services privés sur ce VPC |
| `kubernetes` | Tout cluster Kubernetes | Namespace, Secret d'identifiants, la release Helm | Un cluster et un kubeconfig, un serveur PostgreSQL |

Les trois modules cloud construisent **le même groupe de conteneurs** que les modèles de la page Services de conteneurs managés : le nginx de bordure sur le port 8920 devant le frontend, le backend et le serveur MCP optionnel, tous partageant `localhost` ; exactement un backend, jamais mis à l'échelle et jamais réduit à zéro ; `/app/data` sur un partage persistant appartenant à l'utilisateur 1000 ; TLS terminé en bordure de plateforme. Même forme, autre outil — tout ce que la page de la plateforme dit des sondes, du chevauchement au déploiement et du verrou de démarrage s'applique tel quel.

Trois conventions valent pour les quatre :

- **La version est une entrée explicite.** `image_tag` (ou `chart_version` pour le module Kubernetes) n'a aucune valeur par défaut susceptible de devenir obsolète ; le `terraform.tfvars.example` à côté de chaque module porte la version courante.
- **La base de données est créée par défaut, avec un commutateur pour la vôtre.** `create_database = false` avec `db_host` et `db_password` pointe le backend vers un serveur que vous exploitez déjà. Quelle que soit l'origine de la base, le module possède les objets du coffre à secrets (`SECRET_KEY` et le mot de passe de la base), de sorte que la définition du conteneur n'a qu'une forme.
- **Le réseau n'est jamais créé.** Les identifiants de VPC, VNet et sous-réseaux sont des entrées ; le README de chaque module liste ce qu'ils doivent déjà fournir.

## Démarrage rapide

```bash
cd deploy/terraform/<module>
cp terraform.tfvars.example terraform.tfvars
# éditez terraform.tfvars, puis gardez le secret hors de tout fichier :
export TF_VAR_secret_key="$(openssl rand -base64 48)"
terraform init
terraform plan
terraform apply
```

Faites pointer le DNS vers la sortie nommée par le module — `alb_dns_name` sur AWS, `fqdn` sur Azure, `load_balancer_ip` sur Google Cloud —, ouvrez `public_url` et inscrivez-vous : le premier utilisateur devient administrateur.

!!! warning "L'état contient des secrets"
    `secret_key`, les mots de passe de base générés et les valeurs des secrets Container Apps se retrouvent tous dans l'état Terraform. Utilisez un backend distant chiffré avec contrôle d'accès (S3 avec SSE et verrouillage, un conteneur Azure Storage, un bucket GCS, Terraform Cloud) — jamais un `terraform.tfstate` sur un portable pour une vraie instance. Conservez `SECRET_KEY` avec vos sauvegardes de base : sa perte invalide toutes les sessions et tous les réglages chiffrés, et la base seule ne peut pas les restituer.

## AWS ECS Fargate

**Avant de commencer** : un VPC avec au moins deux sous-réseaux publics (équilibreur de charge) et deux sous-réseaux privés dans des zones de disponibilité différentes (tâche, cibles de montage EFS, base de données) ; une passerelle NAT pour que les sous-réseaux privés puissent tirer les images depuis ghcr.io ; un certificat ACM pour le nom d'hôte dans la même région.

Entrées à renseigner : `region`, `vpc_id`, `public_subnet_ids`, `private_subnet_ids`, `certificate_arn`, `public_url`, `image_tag`. En option `route53_zone_id` — le module crée alors lui-même l'enregistrement alias. L'instance RDS créée est privée, chiffrée, protégée contre la suppression et conserve sept jours de sauvegardes ; apportez la vôtre avec `create_database = false`, `db_host` et `db_security_group_id` (le module ouvre le port depuis la tâche).

Les déploiements sont de type arrêt-puis-démarrage (`deployment_minimum_healthy_percent = 0`) : une montée de version coûte une à deux minutes d'indisponibilité et ne fait jamais tourner deux backends. Pour un shell : `aws ecs execute-command … --container backend --interactive --command sh`.

## Azure Container Apps

**Avant de commencer** : un groupe de ressources existant. Pour l'intégration VNet, un sous-réseau `/27` délégué à `Microsoft.App/environments`. Pour une base inaccessible depuis Internet, un *second* sous-réseau délégué à `Microsoft.DBforPostgreSQL/flexibleServers` et une zone DNS privée se terminant par `.postgres.database.azure.com` liée au VNet — renseignez `postgresql_delegated_subnet_id` et `postgresql_private_dns_zone_id` ensemble. Sans eux, le serveur créé garde un point de terminaison public restreint aux services Azure.

Entrées à renseigner : `subscription_id`, `resource_group_name`, `location`, `public_url`, `image_tag`, ainsi que des `storage_account_name` et `postgresql_server_name` uniques au niveau mondial. Le premier déploiement répond sur la sortie `fqdn` ; liez un domaine personnalisé avec `az containerapp hostname add` / `bind` comme décrit sur la page Services de conteneurs managés, puis renseignez `public_url` et appliquez à nouveau. Azure n'a pas d'indicateur de protection contre la suppression sur un Flexible Server : le module pose donc des verrous `CanNotDelete` sur le serveur et le compte de stockage (`db_deletion_protection`, `storage_deletion_protection`).

## Google Cloud Run

**Avant de commencer** : un projet, un réseau VPC avec un sous-réseau dans la région, et **l'accès aux services privés** sur ce VPC — l'IP privée de Cloud SQL en a besoin. Si le VPC ne l'a pas encore, positionnez une fois `create_private_service_connection = true` ; un second appairage sur un VPC qui en a déjà un échoue.

Entrées à renseigner : `project_id`, `region`, `network`, `subnetwork`, `public_url`, `image_tag`. Le module active les API, crée un dépôt distant Artifact Registry qui relaie ghcr.io (Cloud Run ne peut pas tirer directement depuis ghcr.io), une instance Filestore pour `/app/data` (le niveau par défaut `BASIC_HDD` commence à 1 Tio et constitue le principal coût), exécute un job ponctuel qui attribue le partage à l'utilisateur 1000, et place un équilibreur de charge HTTPS global avec un certificat géré par Google devant le service. Créez l'enregistrement DNS A de l'hôte de `public_url` vers `load_balancer_ip` ; le certificat reste en `PROVISIONING` tant que cet enregistrement ne résout pas. Les envois de plus de 32 Mio — un gros import d'espace de travail — échouent sur le chemin HTTP/1 de Cloud Run ; c'est une limite de la plateforme, pas un réglage du module.

## Kubernetes

Le module `kubernetes` enveloppe le chart publié dans un `helm_release`, pour les équipes dont les clusters sont eux-mêmes gérés par Terraform. Il crée le namespace et un Secret portant `SECRET_KEY` et `POSTGRES_PASSWORD` (ou utilise via `existing_secret` un Secret produit par External Secrets ou Sealed Secrets), génère les clés de values propres au chart et transmet le Secret par son nom — les secrets ne transitent jamais par les values. Entrées à renseigner : `chart_version`, `public_url`, `db_host`, et soit `secret_key` + `db_password`, soit `existing_secret`. Classe d'Ingress, annotations et TLS passent par l'objet `ingress` ; tout ce que le module n'expose pas (`backend.resources`, `seed.demo`…) passe par `extra_values`, une liste de documents de values fusionnés après celui généré.

Les deux blocs `provider` lisent un kubeconfig ; remplacez-les par l'authentification propre à votre cluster (jeton EKS, identifiants AKS, plugin d'auth GKE) lorsque Terraform crée aussi le cluster.

## Mises à niveau et suppression

Une montée de version est un changement d'`image_tag` (ou de `chart_version`) suivi d'un `terraform apply` ; le backend exécute les migrations au démarrage, sous le verrou de démarrage sur les plateformes qui font se chevaucher l'ancienne et la nouvelle instance. Lisez d'abord les [notes de version](https://github.com/vincentmakes/turbo-ea/blob/main/CHANGELOG.md) et sauvegardez la base comme pour toute autre installation — [Exploitation et mises à niveau](operations.md) s'applique.

`terraform destroy` est refusé tant que la protection contre la suppression est active : désactivez `db_deletion_protection` (AWS, Google Cloud et les verrous sur Azure), `deletion_protection` sur le service Cloud Run et, sur AWS, décidez de l'instantané final RDS (`db_skip_final_snapshot`), appliquez, puis détruisez. Le nom d'une instance Cloud SQL supprimée ne peut pas être réutilisé pendant une semaine.

## Validation sans cloud

Chaque module fournit des tests sous `tests/` qui s'exécutent contre des **providers simulés** : vrais schémas de providers, valeurs inventées, aucun identifiant, rien de créé. Ils figent le câblage dont dépendent les pages de plateforme — un backend, la bordure sur le port 8920, les secrets par référence, le volume de données, les commutateurs « apportez le vôtre » — et la CI les exécute avec `terraform validate` et `tflint` à chaque modification. Ce qu'ils ne peuvent pas prouver, c'est qu'un cloud accepte le plan ; le premier `terraform plan` contre un vrai compte est cette vérification. OpenTofu n'est pas testé, mais les modules évitent toute fonctionnalité propre à Terraform.

## Dépannage

| Symptôme | Cause et remède |
|---|---|
| `Error creating Service Networking Connection … already exists` (Google Cloud) | Le VPC a déjà l'accès aux services privés. Positionnez `create_private_service_connection = false`. |
| Le certificat géré par Google reste en `PROVISIONING` | L'enregistrement DNS A de l'hôte de `public_url` ne résout pas encore vers `load_balancer_ip`. Corrigez le DNS et attendez ; rien à appliquer. |
| `Permission denied` sous `/app/data` sur Cloud Run | Le partage n'appartient pas à l'utilisateur 1000 — par exemple après une restauration. Changez `chown_job_token` et appliquez pour relancer le job. |
| `postgresql_delegated_subnet_id and postgresql_private_dns_zone_id must be set together` (Azure) | L'accès privé exige les deux ; la zone doit être liée au VNet et le sous-réseau doit différer de celui de l'environnement. |
| `db_host is required when create_database is false` | Apporter sa base exige `db_host` et `db_password` (`TF_VAR_db_password`). |
| `terraform destroy` refuse | La protection contre la suppression ou un verrou `CanNotDelete` est actif ; voir *Mises à niveau et suppression*. |
| L'application répond sur l'URL de la plateforme mais pas sur `public_url` | Le DNS pointe ailleurs, ou `public_url` nomme encore le FQDN de la plateforme — mettez l'origine définitive et appliquez ; le cookie de session lui est lié. |
