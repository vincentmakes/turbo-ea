# Terraform

Teams, der styrer deres cloud med Terraform, kan udrulle Turbo EA på samme måde. Repositoriet leverer fire rodmoduler under [`deploy/terraform/`](https://github.com/vincentmakes/turbo-ea/tree/main/deploy/terraform) — ét for hver administreret containertjeneste på siden [Administrerede containertjenester](managed-containers.md), plus ét, der installerer Helm-chartet fra siden [Kubernetes og cloud](kubernetes.md) på et cluster, du allerede driver. Denne side handler om modulerne; de to linkede sider er fortsat referencen for, hvad hver platform kan og ikke kan.

## Hvad modulerne bygger

| Modul | Platform | Opretter | Du medbringer |
|---|---|---|---|
| `ecs-fargate` | AWS ECS Fargate | Cluster, task og service, Application Load Balancer med HTTPS, EFS, Secrets Manager-hemmeligheder, RDS for PostgreSQL (valgfrit) | En VPC med offentlige og private subnets (NAT), et ACM-certifikat |
| `azure-container-apps` | Azure Container Apps | Miljø, container app, Log Analytics, storage-konto og filshare, Flexible Server (valgfrit) | En ressourcegruppe; eventuelt et delegeret subnet og en privat DNS-zone |
| `cloud-run` | Google Cloud Run | Service, Filestore, Secret Manager-hemmeligheder, Artifact Registry-remote-repository, global HTTPS-load balancer med administreret certifikat, Cloud SQL (valgfrit) | Et projekt, en VPC med et subnet, private services access på den VPC |
| `kubernetes` | Ethvert Kubernetes-cluster | Namespace, Secret med legitimationsoplysninger, Helm-releasen | Et cluster og en kubeconfig, en PostgreSQL-server |

De tre cloud-moduler bygger **den samme containergruppe** som skabelonerne på siden om administrerede containertjenester: edge-nginx på port 8920 foran frontend, backend og den valgfrie MCP-server, alle på `localhost`; præcis én backend, aldrig skaleret og aldrig skaleret til nul; `/app/data` på et persistent share ejet af bruger 1000; TLS termineret i platformens kant. Samme form, andet værktøj — alt, hvad platformsiden siger om prober, overlap ved udrulning og startlåsen, gælder uændret.

Tre konventioner gælder for alle fire:

- **Udgivelsen er et eksplicit input.** `image_tag` (eller `chart_version` for Kubernetes-modulet) har ingen standardværdi, der kan blive forældet; `terraform.tfvars.example` ved siden af hvert modul bærer den aktuelle udgivelse.
- **Databasen oprettes som standard, med en kontakt til din egen.** `create_database = false` sammen med `db_host` og `db_password` peger backenden mod en server, du allerede driver. Uanset hvor databasen kommer fra, ejer modulet objekterne i hemmelighedslageret (`SECRET_KEY` og databaseadgangskoden), så containerdefinitionen har én form.
- **Netværket oprettes aldrig.** VPC-, VNet- og subnet-id'er er input; hvert moduls README lister, hvad de allerede skal levere.

## Hurtig start

```bash
cd deploy/terraform/<modul>
cp terraform.tfvars.example terraform.tfvars
# rediger terraform.tfvars, og hold hemmeligheden ude af enhver fil:
export TF_VAR_secret_key="$(openssl rand -base64 48)"
terraform init
terraform plan
terraform apply
```

Peg DNS på det output, modulet nævner — `alb_dns_name` på AWS, `fqdn` på Azure, `load_balancer_ip` på Google Cloud —, åbn `public_url` og registrér dig: den første bruger bliver administrator.

!!! warning "State indeholder hemmeligheder"
    `secret_key`, genererede databaseadgangskoder og Container Apps' hemmelighedsværdier havner alle i Terraform-state. Brug en krypteret remote backend med adgangskontrol (S3 med SSE og låsning, en Azure Storage-container, en GCS-bucket, Terraform Cloud) — aldrig en `terraform.tfstate` på en bærbar til en rigtig instans. Opbevar `SECRET_KEY` sammen med dine databasebackups: mistes den, ugyldiggøres alle sessioner og alle krypterede indstillinger, og databasen alene kan ikke bringe dem tilbage.

## AWS ECS Fargate

**Før du starter**: en VPC med mindst to offentlige subnets (load balancer) og to private subnets i forskellige Availability Zones (task, EFS-mount targets, database); en NAT-gateway, så de private subnets kan hente images fra ghcr.io; et ACM-certifikat til hostnavnet i samme region.

Input, der skal sættes: `region`, `vpc_id`, `public_subnet_ids`, `private_subnet_ids`, `certificate_arn`, `public_url`, `image_tag`. Valgfrit `route53_zone_id` — så opretter modulet selv alias-posten. Den oprettede RDS-instans er privat, krypteret, har sletningsbeskyttelse slået til og gemmer syv dages backups; medbring din egen med `create_database = false`, `db_host` og `db_security_group_id` (modulet åbner porten fra tasken).

Udrulninger er stop-så-start (`deployment_minimum_healthy_percent = 0`), så en opgradering koster et til to minutters nedetid og kører aldrig to backends. Til en shell: `aws ecs execute-command … --container backend --interactive --command sh`. For at bruge Amazon Bedrock som AI-udbyder skal du tilføje IAM-politikken fra [AI-funktioner](ai.md) til modulets task-rolle.

## Azure Container Apps

**Før du starter**: en eksisterende ressourcegruppe. Til VNet-integration et `/27`-subnet delegeret til `Microsoft.App/environments`. Til en database, der ikke kan nås fra internettet, et *andet* subnet delegeret til `Microsoft.DBforPostgreSQL/flexibleServers` og en privat DNS-zone, der ender på `.postgres.database.azure.com` og er knyttet til VNet'et — sæt `postgresql_delegated_subnet_id` og `postgresql_private_dns_zone_id` sammen. Uden dem beholder den oprettede server et offentligt endpoint begrænset til Azure-tjenester.

Input, der skal sættes: `subscription_id`, `resource_group_name`, `location`, `public_url`, `image_tag` samt globalt unikke `storage_account_name` og `postgresql_server_name`. Den første udrulning svarer på outputtet `fqdn`; bind et brugerdefineret domæne med `az containerapp hostname add` / `bind` som beskrevet på siden om administrerede containertjenester, sæt derefter `public_url`, og kør apply igen. Azure har intet flag for sletningsbeskyttelse på en Flexible Server, så modulet sætter i stedet `CanNotDelete`-låse på serveren og storage-kontoen (`db_deletion_protection`, `storage_deletion_protection`).

## Google Cloud Run

**Før du starter**: et projekt, et VPC-netværk med et subnet i regionen og **private services access** på den VPC — Cloud SQL's private IP kræver det. Har VPC'en det ikke endnu, så sæt `create_private_service_connection = true` én gang; en anden peering på en VPC, der allerede har en, fejler.

Input, der skal sættes: `project_id`, `region`, `network`, `subnetwork`, `public_url`, `image_tag`. Modulet aktiverer API'erne, opretter et Artifact Registry-remote-repository, der proxyer ghcr.io (Cloud Run kan ikke hente direkte fra ghcr.io), en Filestore-instans til `/app/data` (standardniveauet `BASIC_HDD` starter ved 1 TiB og er den dominerende omkostning), kører et engangsjob, der gør sharet ejet af bruger 1000, og sætter en global HTTPS-load balancer med et Google-administreret certifikat foran servicen. Opret DNS A-posten for værten i `public_url`, der peger på `load_balancer_ip`; certifikatet forbliver `PROVISIONING`, indtil posten kan opløses. Uploads over 32 MiB — en stor workspace-import — fejler på Cloud Runs HTTP/1-sti; det er en platformgrænse, ikke en modulindstilling.

## Kubernetes

Modulet `kubernetes` pakker det udgivne chart ind i en `helm_release`, til teams hvis clusters selv styres af Terraform. Det opretter namespacet og en Secret med `SECRET_KEY` og `POSTGRES_PASSWORD` (eller bruger via `existing_secret` en, der er produceret af External Secrets eller Sealed Secrets), renderer chartets egne values-nøgler og videregiver Secreten ved navn — hemmeligheder rejser aldrig gennem values. Input, der skal sættes: `chart_version`, `public_url`, `db_host` og enten `secret_key` + `db_password` eller `existing_secret`. Ingress-klasse, annotationer og TLS går gennem objektet `ingress`; alt, hvad modulet ikke eksponerer (`backend.resources`, `seed.demo`…), går gennem `extra_values`, en liste af chart-values-dokumenter, der flettes efter det genererede.

De to `provider`-blokke læser en kubeconfig; erstat dem med dit clusters egen autentificering (EKS-token, AKS-legitimationsoplysninger, GKE-auth-plugin), når Terraform også opretter clusteret.

## Opgraderinger og fjernelse

En opgradering er en ændring af `image_tag` (eller `chart_version`) efterfulgt af `terraform apply`; backenden kører migreringer ved opstart, under startlåsen på platforme, der overlapper gammel og ny instans. Læs først [udgivelsesnoterne](https://github.com/vincentmakes/turbo-ea/blob/main/CHANGELOG.md), og tag en databasebackup som ved enhver anden installation — [Drift og opgraderinger](operations.md) gælder.

`terraform destroy` afvises, mens sletningsbeskyttelsen er slået til: slå `db_deletion_protection` fra (AWS, Google Cloud og låsene på Azure), `deletion_protection` på Cloud Run-servicen, og tag på AWS stilling til det endelige RDS-snapshot (`db_skip_final_snapshot`), kør apply, og destroy. Navnet på en slettet Cloud SQL-instans kan ikke genbruges i en uge.

## Validering uden cloud

Hvert modul leverer tests under `tests/`, der kører mod **mock-providere**: rigtige provider-skemaer, opdigtede værdier, ingen legitimationsoplysninger, intet oprettet. De fastlåser den kobling, platformsiderne afhænger af — én backend, kanten på port 8920, hemmeligheder ved reference, datavolumen, kontakterne til egne ressourcer — og CI kører dem sammen med `terraform validate` og `tflint` ved hver ændring. Hvad de ikke kan bevise, er, at en cloud accepterer planen; den første `terraform plan` mod en rigtig konto er den kontrol. OpenTofu afprøves ikke, men modulerne undgår enhver Terraform-specifik funktion.

## Fejlfinding

| Symptom | Årsag og løsning |
|---|---|
| `Error creating Service Networking Connection … already exists` (Google Cloud) | VPC'en har allerede private services access. Sæt `create_private_service_connection = false`. |
| Det Google-administrerede certifikat forbliver `PROVISIONING` | DNS A-posten for værten i `public_url` opløses endnu ikke til `load_balancer_ip`. Ret DNS og vent; intet at anvende. |
| `Permission denied` under `/app/data` på Cloud Run | Sharet er ikke ejet af bruger 1000 — f.eks. efter en gendannelse. Ændr `chown_job_token`, og kør apply for at køre jobbet igen. |
| `postgresql_delegated_subnet_id and postgresql_private_dns_zone_id must be set together` (Azure) | Privat adgang kræver begge; zonen skal være knyttet til VNet'et, og subnettet skal være et andet end miljøets. |
| `db_host is required when create_database is false` | Egen database kræver `db_host` og `db_password` (`TF_VAR_db_password`). |
| `terraform destroy` nægter | Sletningsbeskyttelse eller en `CanNotDelete`-lås er slået til; se *Opgraderinger og fjernelse*. |
| Applikationen svarer på platformens URL, men ikke på `public_url` | DNS peger et andet sted hen, eller `public_url` nævner stadig platformens FQDN — sæt den til den endelige origin, og kør apply; sessionscookien er bundet til den. |
