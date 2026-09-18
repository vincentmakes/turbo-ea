# Terraform

Teams, die ihre Cloud mit Terraform verwalten, können Turbo EA auf demselben Weg ausrollen. Das Repository liefert vier Root-Module unter [`deploy/terraform/`](https://github.com/vincentmakes/turbo-ea/tree/main/deploy/terraform) — eines für jeden verwalteten Container-Dienst der Seite [Verwaltete Container-Dienste](managed-containers.md) sowie eines, das das Helm-Chart der Seite [Kubernetes & Cloud](kubernetes.md) auf einem bereits vorhandenen Cluster installiert. Diese Seite behandelt die Module; die beiden verlinkten Seiten bleiben die Referenz dafür, was jede Plattform kann und was nicht.

## Was die Module aufbauen

| Modul | Plattform | Erstellt | Sie bringen mit |
|---|---|---|---|
| `ecs-fargate` | AWS ECS Fargate | Cluster, Task und Service, Application Load Balancer mit HTTPS, EFS, Secrets-Manager-Geheimnisse, RDS for PostgreSQL (optional) | Eine VPC mit öffentlichen und privaten Subnetzen (NAT), ein ACM-Zertifikat |
| `azure-container-apps` | Azure Container Apps | Umgebung, Container-App, Log Analytics, Speicherkonto und Dateifreigabe, Flexible Server (optional) | Eine Ressourcengruppe; optional ein delegiertes Subnetz und eine private DNS-Zone |
| `cloud-run` | Google Cloud Run | Dienst, Filestore, Secret-Manager-Geheimnisse, Artifact-Registry-Remote-Repository, globaler HTTPS-Load-Balancer mit verwaltetem Zertifikat, Cloud SQL (optional) | Ein Projekt, eine VPC mit Subnetz, Private Services Access auf dieser VPC |
| `kubernetes` | Beliebiger Kubernetes-Cluster | Namespace, Secret mit Zugangsdaten, das Helm-Release | Ein Cluster mit kubeconfig, ein PostgreSQL-Server |

Die drei Cloud-Module bauen **dieselbe Containergruppe** wie die Vorlagen der Seite Verwaltete Container-Dienste: das Edge-nginx auf Port 8920 vor Frontend, Backend und optionalem MCP-Server, alle über `localhost` verbunden; genau ein Backend, nie skaliert und nie auf null skaliert; `/app/data` auf einer persistenten Freigabe, die dem Benutzer 1000 gehört; TLS endet am Rand der Plattform. Gleiche Form, anderes Werkzeug — alles, was die Plattformseite über Probes, Überlappung beim Deployment und die Startsperre sagt, gilt unverändert.

Drei Konventionen gelten für alle vier:

- **Das Release ist eine explizite Eingabe.** `image_tag` (bzw. `chart_version` beim Kubernetes-Modul) hat keinen Standardwert, der veralten könnte; die `terraform.tfvars.example` neben jedem Modul trägt das aktuelle Release.
- **Die Datenbank wird standardmäßig erstellt, mit einem Schalter für eine eigene.** `create_database = false` zusammen mit `db_host` und `db_password` richtet das Backend auf einen bereits betriebenen Server aus. Unabhängig davon, woher die Datenbank stammt, gehören die Geheimnis-Objekte (`SECRET_KEY` und das Datenbankpasswort) dem Modul, sodass die Containerdefinition eine einzige Form hat.
- **Das Netzwerk wird nie erstellt.** VPC-, VNet- und Subnetz-IDs sind Eingaben; die README jedes Moduls listet auf, was sie bereits bereitstellen müssen.

## Schnellstart

```bash
cd deploy/terraform/<modul>
cp terraform.tfvars.example terraform.tfvars
# terraform.tfvars bearbeiten, das Geheimnis aber aus jeder Datei heraushalten:
export TF_VAR_secret_key="$(openssl rand -base64 48)"
terraform init
terraform plan
terraform apply
```

Richten Sie DNS auf die vom Modul benannte Ausgabe — `alb_dns_name` auf AWS, `fqdn` auf Azure, `load_balancer_ip` auf Google Cloud —, öffnen Sie `public_url` und registrieren Sie sich: Der erste Benutzer wird Administrator.

!!! warning "Der State enthält Geheimnisse"
    `secret_key`, erzeugte Datenbankpasswörter und die Secret-Werte der Container App landen alle im Terraform-State. Verwenden Sie ein verschlüsseltes Remote-Backend mit Zugriffskontrolle (S3 mit SSE und Locking, ein Azure-Storage-Container, ein GCS-Bucket, Terraform Cloud) — niemals eine `terraform.tfstate` auf einem Laptop für eine echte Instanz. Bewahren Sie `SECRET_KEY` zusammen mit Ihren Datenbank-Backups auf: Geht er verloren, sind alle Sitzungen und alle verschlüsselten Einstellungen ungültig, und die Datenbank allein bringt sie nicht zurück.

## AWS ECS Fargate

**Bevor Sie beginnen**: eine VPC mit mindestens zwei öffentlichen Subnetzen (Load Balancer) und zwei privaten Subnetzen in verschiedenen Availability Zones (Task, EFS-Mount-Ziele, Datenbank); ein NAT-Gateway, damit die privaten Subnetze Images von ghcr.io beziehen können; ein ACM-Zertifikat für den Hostnamen in derselben Region.

Zu setzende Eingaben: `region`, `vpc_id`, `public_subnet_ids`, `private_subnet_ids`, `certificate_arn`, `public_url`, `image_tag`. Optional `route53_zone_id` — das Modul legt den Alias-Eintrag dann selbst an. Die erstellte RDS-Instanz ist privat, verschlüsselt, hat Löschschutz aktiviert und behält sieben Tage Backups; eine eigene bringen Sie mit `create_database = false`, `db_host` und `db_security_group_id` mit (das Modul öffnet den Port vom Task aus).

Deployments laufen als Stop-then-Start (`deployment_minimum_healthy_percent = 0`), ein Release-Upgrade kostet also ein bis zwei Minuten Ausfall und lässt nie zwei Backends laufen. Für eine Shell: `aws ecs execute-command … --container backend --interactive --command sh`. Um Amazon Bedrock als KI-Anbieter zu nutzen, fügen Sie die IAM-Richtlinie aus [KI-Funktionen](ai.md) zur Task-Rolle des Moduls hinzu.

## Azure Container Apps

**Bevor Sie beginnen**: eine vorhandene Ressourcengruppe. Für die VNet-Integration ein `/27`-Subnetz, delegiert an `Microsoft.App/environments`. Für eine nicht aus dem Internet erreichbare Datenbank ein *zweites* Subnetz, delegiert an `Microsoft.DBforPostgreSQL/flexibleServers`, und eine private DNS-Zone, die auf `.postgres.database.azure.com` endet und mit dem VNet verknüpft ist — setzen Sie `postgresql_delegated_subnet_id` und `postgresql_private_dns_zone_id` gemeinsam. Ohne sie behält der erstellte Server einen öffentlichen Endpunkt, der auf Azure-Dienste beschränkt ist.

Zu setzende Eingaben: `subscription_id`, `resource_group_name`, `location`, `public_url`, `image_tag` sowie global eindeutige `storage_account_name` und `postgresql_server_name`. Das erste Deployment antwortet auf der Ausgabe `fqdn`; binden Sie eine eigene Domain mit `az containerapp hostname add` / `bind`, wie auf der Seite Verwaltete Container-Dienste beschrieben, setzen Sie dann `public_url` und wenden Sie erneut an. Azure kennt kein Löschschutz-Flag für einen Flexible Server, daher setzt das Modul stattdessen `CanNotDelete`-Sperren auf den Server und das Speicherkonto (`db_deletion_protection`, `storage_deletion_protection`).

## Google Cloud Run

**Bevor Sie beginnen**: ein Projekt, ein VPC-Netzwerk mit einem Subnetz in der Region und **Private Services Access** auf dieser VPC — die private IP von Cloud SQL braucht ihn. Hat die VPC ihn noch nicht, setzen Sie einmalig `create_private_service_connection = true`; ein zweites Peering auf einer VPC, die bereits eines hat, schlägt fehl.

Zu setzende Eingaben: `project_id`, `region`, `network`, `subnetwork`, `public_url`, `image_tag`. Das Modul aktiviert die APIs, erstellt ein Artifact-Registry-Remote-Repository als Proxy für ghcr.io (Cloud Run kann nicht direkt von ghcr.io ziehen), eine Filestore-Instanz für `/app/data` (die Standardstufe `BASIC_HDD` beginnt bei 1 TiB und ist der größte Kostenfaktor), führt einen einmaligen Job aus, der die Freigabe dem Benutzer 1000 überträgt, und stellt einen globalen HTTPS-Load-Balancer mit von Google verwaltetem Zertifikat vor den Dienst. Legen Sie den DNS-A-Eintrag für den Host von `public_url` auf `load_balancer_ip` an; das Zertifikat bleibt `PROVISIONING`, bis dieser Eintrag auflöst. Uploads über 32 MiB — ein großer Workspace-Import — scheitern am HTTP/1-Pfad von Cloud Run; das ist eine Plattformgrenze, keine Moduleinstellung.

## Kubernetes

Das Modul `kubernetes` kapselt das veröffentlichte Chart in einem `helm_release`, für Teams, deren Cluster selbst mit Terraform verwaltet werden. Es erstellt den Namespace und ein Secret mit `SECRET_KEY` und `POSTGRES_PASSWORD` (oder verwendet über `existing_secret` eines von External Secrets oder Sealed Secrets), rendert die eigenen Values-Schlüssel des Charts und übergibt das Secret namentlich — Geheimnisse wandern nie durch Values. Zu setzende Eingaben: `chart_version`, `public_url`, `db_host` und entweder `secret_key` + `db_password` oder `existing_secret`. Ingress-Klasse, Annotationen und TLS gehen über das Objekt `ingress`; alles, was das Modul nicht abbildet (`backend.resources`, `seed.demo` …), über `extra_values`, eine Liste von Chart-Values-Dokumenten, die nach dem erzeugten zusammengeführt werden.

Die beiden `provider`-Blöcke lesen eine kubeconfig; ersetzen Sie sie durch die Authentifizierung Ihres Clusters (EKS-Token, AKS-Zugangsdaten, GKE-Auth-Plugin), wenn Terraform auch den Cluster erstellt.

## Upgrades und Entfernung

Ein Release-Upgrade ist eine Änderung von `image_tag` (bzw. `chart_version`) gefolgt von `terraform apply`; das Backend führt Migrationen beim Start aus, unter der Startsperre auf Plattformen, die alte und neue Instanz überlappen. Lesen Sie zuerst die [Release Notes](https://github.com/vincentmakes/turbo-ea/blob/main/CHANGELOG.md) und erstellen Sie ein Datenbank-Backup wie bei jeder anderen Installation — [Betrieb & Upgrades](operations.md) gilt.

`terraform destroy` wird verweigert, solange der Löschschutz aktiv ist: Schalten Sie `db_deletion_protection` aus (AWS, Google Cloud und die Sperren auf Azure), `deletion_protection` am Cloud-Run-Dienst und entscheiden Sie auf AWS über den finalen RDS-Snapshot (`db_skip_final_snapshot`), wenden Sie an und zerstören Sie. Der Name einer gelöschten Cloud-SQL-Instanz kann eine Woche lang nicht wiederverwendet werden.

## Validierung ohne Cloud

Jedes Modul liefert Tests unter `tests/`, die gegen **Mock-Provider** laufen: echte Provider-Schemas, erfundene Werte, keine Zugangsdaten, nichts wird erstellt. Sie fixieren die Verdrahtung, von der die Plattformseiten abhängen — ein Backend, das Edge auf Port 8920, Geheimnisse per Referenz, das Datenvolume, die Schalter für eigene Ressourcen —, und CI führt sie bei jeder Änderung zusammen mit `terraform validate` und `tflint` aus. Was sie nicht beweisen können, ist, dass eine Cloud den Plan akzeptiert; der erste `terraform plan` gegen ein echtes Konto ist diese Prüfung. OpenTofu wird nicht getestet, die Module vermeiden aber jedes Terraform-exklusive Feature.

## Fehlerbehebung

| Symptom | Ursache und Abhilfe |
|---|---|
| `Error creating Service Networking Connection … already exists` (Google Cloud) | Die VPC hat bereits Private Services Access. Setzen Sie `create_private_service_connection = false`. |
| Das von Google verwaltete Zertifikat bleibt `PROVISIONING` | Der DNS-A-Eintrag für den Host von `public_url` löst noch nicht auf `load_balancer_ip` auf. DNS korrigieren und warten; nichts anzuwenden. |
| `Permission denied` unter `/app/data` auf Cloud Run | Die Freigabe gehört nicht dem Benutzer 1000 — etwa nach einer Wiederherstellung. `chown_job_token` ändern und anwenden, um den Job erneut auszuführen. |
| `postgresql_delegated_subnet_id and postgresql_private_dns_zone_id must be set together` (Azure) | Privater Zugriff braucht beides; die Zone muss mit dem VNet verknüpft sein und das Subnetz sich von dem der Umgebung unterscheiden. |
| `db_host is required when create_database is false` | Eine eigene Datenbank braucht `db_host` und `db_password` (`TF_VAR_db_password`). |
| `terraform destroy` verweigert | Löschschutz oder eine `CanNotDelete`-Sperre ist aktiv; siehe *Upgrades und Entfernung*. |
| Die Anwendung antwortet unter der Plattform-URL, aber nicht unter `public_url` | DNS zeigt woandershin, oder `public_url` nennt noch den Plattform-FQDN — auf den endgültigen Origin setzen und anwenden; das Sitzungs-Cookie ist daran gebunden. |
