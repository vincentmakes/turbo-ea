# Terraform

Los equipos que gestionan su nube con Terraform pueden desplegar Turbo EA de la misma forma. El repositorio incluye cuatro módulos raíz en [`deploy/terraform/`](https://github.com/vincentmakes/turbo-ea/tree/main/deploy/terraform): uno por cada servicio de contenedores gestionado que cubre la página [Servicios de contenedores gestionados](managed-containers.md), más uno que instala el chart de Helm de la página [Kubernetes y nube](kubernetes.md) en un clúster que ya opera. Esta página trata de los módulos; las dos páginas enlazadas siguen siendo la referencia sobre lo que cada plataforma puede y no puede hacer.

## Qué construyen los módulos

| Módulo | Plataforma | Crea | Usted aporta |
|---|---|---|---|
| `ecs-fargate` | AWS ECS Fargate | Clúster, tarea y servicio, Application Load Balancer con HTTPS, EFS, secretos de Secrets Manager, RDS for PostgreSQL (opcional) | Una VPC con subredes públicas y privadas (NAT), un certificado ACM |
| `azure-container-apps` | Azure Container Apps | Entorno, container app, Log Analytics, cuenta de almacenamiento y recurso compartido de archivos, Flexible Server (opcional) | Un grupo de recursos; opcionalmente una subred delegada y una zona DNS privada |
| `cloud-run` | Google Cloud Run | Servicio, Filestore, secretos de Secret Manager, repositorio remoto de Artifact Registry, balanceador de carga HTTPS global con certificado gestionado, Cloud SQL (opcional) | Un proyecto, una VPC con una subred, acceso a servicios privados en esa VPC |
| `kubernetes` | Cualquier clúster de Kubernetes | Namespace, Secret de credenciales, la release de Helm | Un clúster y un kubeconfig, un servidor PostgreSQL |

Los tres módulos de nube construyen **el mismo grupo de contenedores** que las plantillas de la página Servicios de contenedores gestionados: el nginx de borde en el puerto 8920 delante del frontend, el backend y el servidor MCP opcional, todos compartiendo `localhost`; exactamente un backend, nunca escalado y nunca reducido a cero; `/app/data` en un recurso compartido persistente propiedad del usuario 1000; TLS terminado en el borde de la plataforma. Misma forma, distinta herramienta: todo lo que la página de la plataforma dice sobre sondas, solapamiento en el despliegue y el bloqueo de arranque se aplica sin cambios.

Tres convenciones rigen para los cuatro:

- **La versión es una entrada explícita.** `image_tag` (o `chart_version` en el módulo de Kubernetes) no tiene un valor por defecto que pueda quedar obsoleto; el `terraform.tfvars.example` junto a cada módulo lleva la versión actual.
- **La base de datos se crea por defecto, con un conmutador para traer la suya.** `create_database = false` junto con `db_host` y `db_password` apunta el backend a un servidor que ya opera. Sea cual sea el origen de la base, el módulo es dueño de los objetos del almacén de secretos (`SECRET_KEY` y la contraseña de la base), de modo que la definición del contenedor tiene una sola forma.
- **La red nunca se crea.** Los identificadores de VPC, VNet y subredes son entradas; el README de cada módulo enumera lo que ya deben proporcionar.

## Inicio rápido

```bash
cd deploy/terraform/<módulo>
cp terraform.tfvars.example terraform.tfvars
# edite terraform.tfvars y mantenga el secreto fuera de cualquier archivo:
export TF_VAR_secret_key="$(openssl rand -base64 48)"
terraform init
terraform plan
terraform apply
```

Apunte el DNS a la salida que nombra el módulo — `alb_dns_name` en AWS, `fqdn` en Azure, `load_balancer_ip` en Google Cloud —, abra `public_url` y regístrese: el primer usuario se convierte en administrador.

!!! warning "El estado contiene secretos"
    `secret_key`, las contraseñas de base generadas y los valores de los secretos de Container Apps acaban todos en el estado de Terraform. Use un backend remoto cifrado con control de acceso (S3 con SSE y bloqueo, un contenedor de Azure Storage, un bucket de GCS, Terraform Cloud); nunca un `terraform.tfstate` en un portátil para una instancia real. Guarde `SECRET_KEY` junto con las copias de seguridad de la base: perderlo invalida todas las sesiones y todos los ajustes cifrados, y la base por sí sola no puede recuperarlos.

## AWS ECS Fargate

**Antes de empezar**: una VPC con al menos dos subredes públicas (balanceador) y dos subredes privadas en zonas de disponibilidad distintas (tarea, destinos de montaje de EFS, base de datos); una puerta de enlace NAT para que las subredes privadas puedan descargar imágenes de ghcr.io; un certificado ACM para el nombre de host en la misma región.

Entradas que fijar: `region`, `vpc_id`, `public_subnet_ids`, `private_subnet_ids`, `certificate_arn`, `public_url`, `image_tag`. Opcionalmente `route53_zone_id`; el módulo crea entonces el registro alias por sí mismo. La instancia RDS creada es privada, cifrada, con protección contra eliminación activada y conserva siete días de copias; traiga la suya con `create_database = false`, `db_host` y `db_security_group_id` (el módulo abre el puerto desde la tarea).

Los despliegues son parar-y-arrancar (`deployment_minimum_healthy_percent = 0`), así que una actualización de versión cuesta uno o dos minutos de inactividad y nunca ejecuta dos backends. Para abrir una shell: `aws ecs execute-command … --container backend --interactive --command sh`.

## Azure Container Apps

**Antes de empezar**: un grupo de recursos existente. Para la integración con VNet, una subred `/27` delegada a `Microsoft.App/environments`. Para una base no accesible desde Internet, una *segunda* subred delegada a `Microsoft.DBforPostgreSQL/flexibleServers` y una zona DNS privada terminada en `.postgres.database.azure.com` vinculada a la VNet — fije `postgresql_delegated_subnet_id` y `postgresql_private_dns_zone_id` juntos. Sin ellos, el servidor creado conserva un punto de conexión público restringido a los servicios de Azure.

Entradas que fijar: `subscription_id`, `resource_group_name`, `location`, `public_url`, `image_tag`, y unos `storage_account_name` y `postgresql_server_name` únicos a nivel global. El primer despliegue responde en la salida `fqdn`; vincule un dominio personalizado con `az containerapp hostname add` / `bind` como describe la página Servicios de contenedores gestionados, fije después `public_url` y vuelva a aplicar. Azure no tiene un indicador de protección contra eliminación en un Flexible Server, así que el módulo coloca bloqueos `CanNotDelete` en el servidor y en la cuenta de almacenamiento (`db_deletion_protection`, `storage_deletion_protection`).

## Google Cloud Run

**Antes de empezar**: un proyecto, una red VPC con una subred en la región y **acceso a servicios privados** en esa VPC; la IP privada de Cloud SQL lo necesita. Si la VPC aún no lo tiene, fije una vez `create_private_service_connection = true`; un segundo emparejamiento en una VPC que ya lo tiene falla.

Entradas que fijar: `project_id`, `region`, `network`, `subnetwork`, `public_url`, `image_tag`. El módulo habilita las API, crea un repositorio remoto de Artifact Registry que hace de proxy de ghcr.io (Cloud Run no puede descargar directamente de ghcr.io), una instancia de Filestore para `/app/data` (el nivel por defecto `BASIC_HDD` empieza en 1 TiB y es el coste dominante), ejecuta un trabajo puntual que asigna el recurso compartido al usuario 1000 y coloca delante del servicio un balanceador HTTPS global con un certificado gestionado por Google. Cree el registro DNS A del host de `public_url` apuntando a `load_balancer_ip`; el certificado permanece en `PROVISIONING` hasta que ese registro resuelva. Las subidas de más de 32 MiB — una importación grande de espacio de trabajo — fallan en la ruta HTTP/1 de Cloud Run; es un límite de la plataforma, no un ajuste del módulo.

## Kubernetes

El módulo `kubernetes` envuelve el chart publicado en un `helm_release`, para equipos cuyos clústeres también se gestionan con Terraform. Crea el namespace y un Secret con `SECRET_KEY` y `POSTGRES_PASSWORD` (o usa mediante `existing_secret` uno producido por External Secrets o Sealed Secrets), genera las claves de values propias del chart y pasa el Secret por nombre: los secretos nunca viajan por los values. Entradas que fijar: `chart_version`, `public_url`, `db_host`, y o bien `secret_key` + `db_password` o bien `existing_secret`. La clase de Ingress, las anotaciones y TLS van por el objeto `ingress`; todo lo que el módulo no expone (`backend.resources`, `seed.demo`…) va por `extra_values`, una lista de documentos de values del chart fusionados después del generado.

Los dos bloques `provider` leen un kubeconfig; sustitúyalos por la autenticación propia de su clúster (token de EKS, credenciales de AKS, plugin de autenticación de GKE) cuando Terraform también cree el clúster.

## Actualizaciones y eliminación

Una actualización de versión es un cambio de `image_tag` (o `chart_version`) seguido de `terraform apply`; el backend ejecuta las migraciones al arrancar, bajo el bloqueo de arranque en las plataformas que solapan la instancia antigua y la nueva. Lea primero las [notas de la versión](https://github.com/vincentmakes/turbo-ea/blob/main/CHANGELOG.md) y haga una copia de la base como en cualquier otra instalación — [Operaciones y actualizaciones](operations.md) se aplica.

`terraform destroy` se rechaza mientras la protección contra eliminación esté activa: desactive `db_deletion_protection` (AWS, Google Cloud y los bloqueos en Azure), `deletion_protection` en el servicio de Cloud Run y, en AWS, decida sobre la instantánea final de RDS (`db_skip_final_snapshot`), aplique y destruya. El nombre de una instancia de Cloud SQL eliminada no puede reutilizarse durante una semana.

## Validación sin nube

Cada módulo incluye pruebas en `tests/` que se ejecutan contra **proveedores simulados**: esquemas de proveedor reales, valores inventados, sin credenciales, nada creado. Fijan el cableado del que dependen las páginas de plataforma — un backend, el borde en el puerto 8920, secretos por referencia, el volumen de datos, los conmutadores para traer lo suyo — y la CI las ejecuta junto con `terraform validate` y `tflint` en cada cambio. Lo que no pueden probar es que una nube acepte el plan; el primer `terraform plan` contra una cuenta real es esa comprobación. OpenTofu no se ejercita, pero los módulos evitan toda característica exclusiva de Terraform.

## Solución de problemas

| Síntoma | Causa y solución |
|---|---|
| `Error creating Service Networking Connection … already exists` (Google Cloud) | La VPC ya tiene acceso a servicios privados. Fije `create_private_service_connection = false`. |
| El certificado gestionado por Google permanece en `PROVISIONING` | El registro DNS A del host de `public_url` aún no resuelve a `load_balancer_ip`. Corrija el DNS y espere; nada que aplicar. |
| `Permission denied` bajo `/app/data` en Cloud Run | El recurso compartido no pertenece al usuario 1000, por ejemplo tras restaurarlo. Cambie `chown_job_token` y aplique para ejecutar el trabajo de nuevo. |
| `postgresql_delegated_subnet_id and postgresql_private_dns_zone_id must be set together` (Azure) | El acceso privado necesita ambos; la zona debe estar vinculada a la VNet y la subred debe ser distinta de la del entorno. |
| `db_host is required when create_database is false` | Traer su base requiere `db_host` y `db_password` (`TF_VAR_db_password`). |
| `terraform destroy` se niega | La protección contra eliminación o un bloqueo `CanNotDelete` está activo; véase *Actualizaciones y eliminación*. |
| La aplicación responde en la URL de la plataforma pero no en `public_url` | El DNS apunta a otro sitio, o `public_url` aún nombra el FQDN de la plataforma: fíjelo al origen definitivo y aplique; la cookie de sesión está ligada a él. |
