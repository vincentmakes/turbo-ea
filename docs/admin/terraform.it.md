# Terraform

I team che gestiscono il proprio cloud con Terraform possono distribuire Turbo EA nello stesso modo. Il repository fornisce quattro moduli radice in [`deploy/terraform/`](https://github.com/vincentmakes/turbo-ea/tree/main/deploy/terraform): uno per ciascun servizio di container gestito trattato nella pagina [Servizi di container gestiti](managed-containers.md), più uno che installa il chart Helm della pagina [Kubernetes e cloud](kubernetes.md) su un cluster che già gestisci. Questa pagina riguarda i moduli; le due pagine collegate restano il riferimento su ciò che ogni piattaforma può e non può fare.

## Cosa costruiscono i moduli

| Modulo | Piattaforma | Crea | Tu fornisci |
|---|---|---|---|
| `ecs-fargate` | AWS ECS Fargate | Cluster, task e servizio, Application Load Balancer con HTTPS, EFS, segreti di Secrets Manager, RDS for PostgreSQL (opzionale) | Una VPC con subnet pubbliche e private (NAT), un certificato ACM |
| `azure-container-apps` | Azure Container Apps | Ambiente, container app, Log Analytics, account di archiviazione e condivisione file, Flexible Server (opzionale) | Un gruppo di risorse; opzionalmente una subnet delegata e una zona DNS privata |
| `cloud-run` | Google Cloud Run | Servizio, Filestore, segreti di Secret Manager, repository remoto di Artifact Registry, bilanciatore HTTPS globale con certificato gestito, Cloud SQL (opzionale) | Un progetto, una VPC con una subnet, l'accesso ai servizi privati su quella VPC |
| `kubernetes` | Qualsiasi cluster Kubernetes | Namespace, Secret con le credenziali, la release Helm | Un cluster e un kubeconfig, un server PostgreSQL |

I tre moduli cloud costruiscono **lo stesso gruppo di container** dei modelli della pagina Servizi di container gestiti: l'nginx di bordo sulla porta 8920 davanti al frontend, al backend e al server MCP opzionale, tutti su `localhost`; esattamente un backend, mai scalato e mai ridotto a zero; `/app/data` su una condivisione persistente di proprietà dell'utente 1000; TLS terminato al bordo della piattaforma. Stessa forma, altro strumento: tutto ciò che la pagina della piattaforma dice su probe, sovrapposizione al deploy e lock di avvio vale invariato.

Tre convenzioni valgono per tutti e quattro:

- **La versione è un input esplicito.** `image_tag` (o `chart_version` per il modulo Kubernetes) non ha alcun valore predefinito che possa diventare obsoleto; il `terraform.tfvars.example` accanto a ogni modulo riporta la versione corrente.
- **Il database viene creato per impostazione predefinita, con un interruttore per il proprio.** `create_database = false` insieme a `db_host` e `db_password` punta il backend a un server che già gestisci. Comunque sia stato ottenuto il database, il modulo possiede gli oggetti dell'archivio segreti (`SECRET_KEY` e la password del database), così la definizione del container ha una sola forma.
- **La rete non viene mai creata.** Gli identificativi di VPC, VNet e subnet sono input; il README di ogni modulo elenca ciò che devono già fornire.

## Avvio rapido

```bash
cd deploy/terraform/<modulo>
cp terraform.tfvars.example terraform.tfvars
# modifica terraform.tfvars, poi tieni il segreto fuori da qualsiasi file:
export TF_VAR_secret_key="$(openssl rand -base64 48)"
terraform init
terraform plan
terraform apply
```

Punta il DNS all'output indicato dal modulo — `alb_dns_name` su AWS, `fqdn` su Azure, `load_balancer_ip` su Google Cloud —, apri `public_url` e registrati: il primo utente diventa amministratore.

!!! warning "Lo stato contiene segreti"
    `secret_key`, le password del database generate e i valori dei segreti di Container Apps finiscono tutti nello stato Terraform. Usa un backend remoto cifrato con controllo degli accessi (S3 con SSE e locking, un container di Azure Storage, un bucket GCS, Terraform Cloud), mai un `terraform.tfstate` su un portatile per un'istanza reale. Conserva `SECRET_KEY` insieme ai backup del database: perderlo invalida ogni sessione e ogni impostazione cifrata, e il database da solo non può ripristinarle.

## AWS ECS Fargate

**Prima di iniziare**: una VPC con almeno due subnet pubbliche (bilanciatore) e due subnet private in zone di disponibilità diverse (task, mount target EFS, database); un gateway NAT perché le subnet private possano scaricare le immagini da ghcr.io; un certificato ACM per l'hostname nella stessa regione.

Input da impostare: `region`, `vpc_id`, `public_subnet_ids`, `private_subnet_ids`, `certificate_arn`, `public_url`, `image_tag`. Facoltativo `route53_zone_id`: il modulo crea allora da sé il record alias. L'istanza RDS creata è privata, cifrata, con protezione dall'eliminazione attiva e conserva sette giorni di backup; porta la tua con `create_database = false`, `db_host` e `db_security_group_id` (il modulo apre la porta dal task).

I deploy sono stop-then-start (`deployment_minimum_healthy_percent = 0`): un aggiornamento di versione costa uno o due minuti di inattività e non esegue mai due backend. Per una shell: `aws ecs execute-command … --container backend --interactive --command sh`.

## Azure Container Apps

**Prima di iniziare**: un gruppo di risorse esistente. Per l'integrazione con la VNet, una subnet `/27` delegata a `Microsoft.App/environments`. Per un database non raggiungibile da Internet, una *seconda* subnet delegata a `Microsoft.DBforPostgreSQL/flexibleServers` e una zona DNS privata che termina in `.postgres.database.azure.com` collegata alla VNet — imposta `postgresql_delegated_subnet_id` e `postgresql_private_dns_zone_id` insieme. Senza di essi il server creato mantiene un endpoint pubblico limitato ai servizi Azure.

Input da impostare: `subscription_id`, `resource_group_name`, `location`, `public_url`, `image_tag`, e `storage_account_name` e `postgresql_server_name` univoci a livello globale. Il primo deploy risponde sull'output `fqdn`; associa un dominio personalizzato con `az containerapp hostname add` / `bind` come descritto nella pagina Servizi di container gestiti, poi imposta `public_url` e applica di nuovo. Azure non ha un flag di protezione dall'eliminazione su un Flexible Server, quindi il modulo applica lock `CanNotDelete` al server e all'account di archiviazione (`db_deletion_protection`, `storage_deletion_protection`).

## Google Cloud Run

**Prima di iniziare**: un progetto, una rete VPC con una subnet nella regione e **l'accesso ai servizi privati** su quella VPC — l'IP privato di Cloud SQL ne ha bisogno. Se la VPC non ce l'ha ancora, imposta una volta `create_private_service_connection = true`; un secondo peering su una VPC che ne ha già uno fallisce.

Input da impostare: `project_id`, `region`, `network`, `subnetwork`, `public_url`, `image_tag`. Il modulo abilita le API, crea un repository remoto di Artifact Registry che fa da proxy per ghcr.io (Cloud Run non può scaricare direttamente da ghcr.io), un'istanza Filestore per `/app/data` (il livello predefinito `BASIC_HDD` parte da 1 TiB ed è il costo dominante), esegue un job una tantum che assegna la condivisione all'utente 1000 e mette davanti al servizio un bilanciatore HTTPS globale con certificato gestito da Google. Crea il record DNS A dell'host di `public_url` verso `load_balancer_ip`; il certificato resta `PROVISIONING` finché quel record non risolve. I caricamenti oltre 32 MiB — un'importazione grande dell'area di lavoro — falliscono sul percorso HTTP/1 di Cloud Run; è un limite della piattaforma, non un'impostazione del modulo.

## Kubernetes

Il modulo `kubernetes` incapsula il chart pubblicato in un `helm_release`, per i team i cui cluster sono a loro volta gestiti con Terraform. Crea il namespace e un Secret con `SECRET_KEY` e `POSTGRES_PASSWORD` (oppure usa tramite `existing_secret` uno prodotto da External Secrets o Sealed Secrets), genera le chiavi di values proprie del chart e passa il Secret per nome: i segreti non viaggiano mai nei values. Input da impostare: `chart_version`, `public_url`, `db_host`, e `secret_key` + `db_password` oppure `existing_secret`. Classe di Ingress, annotazioni e TLS passano dall'oggetto `ingress`; tutto ciò che il modulo non espone (`backend.resources`, `seed.demo`…) passa da `extra_values`, un elenco di documenti di values del chart uniti dopo quello generato.

I due blocchi `provider` leggono un kubeconfig; sostituiscili con l'autenticazione del tuo cluster (token EKS, credenziali AKS, plugin di autenticazione GKE) quando Terraform crea anche il cluster.

## Aggiornamenti e rimozione

Un aggiornamento di versione è una modifica di `image_tag` (o `chart_version`) seguita da `terraform apply`; il backend esegue le migrazioni all'avvio, sotto il lock di avvio sulle piattaforme che sovrappongono la vecchia e la nuova istanza. Leggi prima le [note di rilascio](https://github.com/vincentmakes/turbo-ea/blob/main/CHANGELOG.md) ed esegui un backup del database come per ogni altra installazione — [Operazioni e aggiornamenti](operations.md) si applica.

`terraform destroy` viene rifiutato finché la protezione dall'eliminazione è attiva: disattiva `db_deletion_protection` (AWS, Google Cloud e i lock su Azure), `deletion_protection` sul servizio Cloud Run e, su AWS, decidi sullo snapshot finale di RDS (`db_skip_final_snapshot`), applica e distruggi. Il nome di un'istanza Cloud SQL eliminata non può essere riutilizzato per una settimana.

## Validazione senza cloud

Ogni modulo include test in `tests/` eseguiti contro **provider simulati**: schemi di provider reali, valori inventati, nessuna credenziale, nulla di creato. Fissano il cablaggio da cui dipendono le pagine di piattaforma — un backend, il bordo sulla porta 8920, i segreti per riferimento, il volume dati, gli interruttori per le risorse proprie — e la CI li esegue insieme a `terraform validate` e `tflint` a ogni modifica. Ciò che non possono dimostrare è che un cloud accetti il piano; il primo `terraform plan` contro un account reale è quella verifica. OpenTofu non viene esercitato, ma i moduli evitano ogni funzionalità esclusiva di Terraform.

## Risoluzione dei problemi

| Sintomo | Causa e rimedio |
|---|---|
| `Error creating Service Networking Connection … already exists` (Google Cloud) | La VPC ha già l'accesso ai servizi privati. Imposta `create_private_service_connection = false`. |
| Il certificato gestito da Google resta `PROVISIONING` | Il record DNS A dell'host di `public_url` non risolve ancora a `load_balancer_ip`. Correggi il DNS e attendi; nulla da applicare. |
| `Permission denied` sotto `/app/data` su Cloud Run | La condivisione non appartiene all'utente 1000, per esempio dopo un ripristino. Cambia `chown_job_token` e applica per rieseguire il job. |
| `postgresql_delegated_subnet_id and postgresql_private_dns_zone_id must be set together` (Azure) | L'accesso privato richiede entrambi; la zona deve essere collegata alla VNet e la subnet deve essere diversa da quella dell'ambiente. |
| `db_host is required when create_database is false` | Portare il proprio database richiede `db_host` e `db_password` (`TF_VAR_db_password`). |
| `terraform destroy` rifiuta | La protezione dall'eliminazione o un lock `CanNotDelete` è attivo; vedi *Aggiornamenti e rimozione*. |
| L'applicazione risponde all'URL della piattaforma ma non a `public_url` | Il DNS punta altrove, oppure `public_url` indica ancora il FQDN della piattaforma: impostalo sull'origine definitiva e applica; il cookie di sessione è legato a essa. |
