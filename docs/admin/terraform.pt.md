# Terraform

Equipes que gerenciam sua nuvem com Terraform podem implantar o Turbo EA da mesma forma. O repositório traz quatro módulos raiz em [`deploy/terraform/`](https://github.com/vincentmakes/turbo-ea/tree/main/deploy/terraform): um para cada serviço de contêineres gerenciado coberto na página [Serviços de contêineres gerenciados](managed-containers.md), mais um que instala o chart Helm da página [Kubernetes e nuvem](kubernetes.md) em um cluster que você já opera. Esta página trata dos módulos; as duas páginas vinculadas continuam sendo a referência sobre o que cada plataforma pode ou não fazer.

## O que os módulos constroem

| Módulo | Plataforma | Cria | Você traz |
|---|---|---|---|
| `ecs-fargate` | AWS ECS Fargate | Cluster, tarefa e serviço, Application Load Balancer com HTTPS, EFS, segredos do Secrets Manager, RDS for PostgreSQL (opcional) | Uma VPC com sub-redes públicas e privadas (NAT), um certificado ACM |
| `azure-container-apps` | Azure Container Apps | Ambiente, container app, Log Analytics, conta de armazenamento e compartilhamento de arquivos, Flexible Server (opcional) | Um grupo de recursos; opcionalmente uma sub-rede delegada e uma zona DNS privada |
| `cloud-run` | Google Cloud Run | Serviço, Filestore, segredos do Secret Manager, repositório remoto do Artifact Registry, balanceador de carga HTTPS global com certificado gerenciado, Cloud SQL (opcional) | Um projeto, uma VPC com uma sub-rede, acesso a serviços privados nessa VPC |
| `kubernetes` | Qualquer cluster Kubernetes | Namespace, Secret de credenciais, a release do Helm | Um cluster e um kubeconfig, um servidor PostgreSQL |

Os três módulos de nuvem constroem **o mesmo grupo de contêineres** que os modelos da página Serviços de contêineres gerenciados: o nginx de borda na porta 8920 na frente do frontend, do backend e do servidor MCP opcional, todos compartilhando `localhost`; exatamente um backend, nunca escalado e nunca reduzido a zero; `/app/data` em um compartilhamento persistente pertencente ao usuário 1000; TLS terminado na borda da plataforma. Mesma forma, outra ferramenta — tudo o que a página da plataforma diz sobre sondas, sobreposição na implantação e o bloqueio de inicialização vale sem alteração.

Três convenções valem para os quatro:

- **A versão é uma entrada explícita.** `image_tag` (ou `chart_version` no módulo Kubernetes) não tem valor padrão que possa ficar desatualizado; o `terraform.tfvars.example` ao lado de cada módulo traz a versão atual.
- **O banco de dados é criado por padrão, com uma chave para trazer o seu.** `create_database = false` junto com `db_host` e `db_password` aponta o backend para um servidor que você já opera. Seja qual for a origem do banco, o módulo é dono dos objetos do cofre de segredos (`SECRET_KEY` e a senha do banco), de modo que a definição do contêiner tem uma única forma.
- **A rede nunca é criada.** Identificadores de VPC, VNet e sub-redes são entradas; o README de cada módulo lista o que elas já precisam fornecer.

## Início rápido

```bash
cd deploy/terraform/<módulo>
cp terraform.tfvars.example terraform.tfvars
# edite terraform.tfvars e mantenha o segredo fora de qualquer arquivo:
export TF_VAR_secret_key="$(openssl rand -base64 48)"
terraform init
terraform plan
terraform apply
```

Aponte o DNS para a saída que o módulo indica — `alb_dns_name` na AWS, `fqdn` no Azure, `load_balancer_ip` no Google Cloud —, abra `public_url` e registre-se: o primeiro usuário torna-se administrador.

!!! warning "O estado contém segredos"
    `secret_key`, as senhas de banco geradas e os valores dos segredos do Container Apps acabam todos no estado do Terraform. Use um backend remoto criptografado com controle de acesso (S3 com SSE e bloqueio, um contêiner do Azure Storage, um bucket do GCS, Terraform Cloud) — nunca um `terraform.tfstate` em um notebook para uma instância real. Guarde `SECRET_KEY` junto com os backups do banco: perdê-lo invalida todas as sessões e todas as configurações criptografadas, e o banco sozinho não as recupera.

## AWS ECS Fargate

**Antes de começar**: uma VPC com pelo menos duas sub-redes públicas (balanceador) e duas sub-redes privadas em zonas de disponibilidade diferentes (tarefa, destinos de montagem do EFS, banco); um gateway NAT para que as sub-redes privadas baixem imagens do ghcr.io; um certificado ACM para o nome de host na mesma região.

Entradas a definir: `region`, `vpc_id`, `public_subnet_ids`, `private_subnet_ids`, `certificate_arn`, `public_url`, `image_tag`. Opcionalmente `route53_zone_id` — o módulo então cria o registro alias por conta própria. A instância RDS criada é privada, criptografada, com proteção contra exclusão ativa e mantém sete dias de backups; traga a sua com `create_database = false`, `db_host` e `db_security_group_id` (o módulo abre a porta a partir da tarefa).

As implantações são parar-e-iniciar (`deployment_minimum_healthy_percent = 0`), então uma atualização de versão custa um ou dois minutos de indisponibilidade e nunca executa dois backends. Para um shell: `aws ecs execute-command … --container backend --interactive --command sh`. Para usar o Amazon Bedrock como fornecedor de IA, adicione a política IAM de [Funcionalidades de IA](ai.md) ao papel de tarefa do módulo.

## Azure Container Apps

**Antes de começar**: um grupo de recursos existente. Para integração com VNet, uma sub-rede `/27` delegada a `Microsoft.App/environments`. Para um banco inacessível pela Internet, uma *segunda* sub-rede delegada a `Microsoft.DBforPostgreSQL/flexibleServers` e uma zona DNS privada terminada em `.postgres.database.azure.com` vinculada à VNet — defina `postgresql_delegated_subnet_id` e `postgresql_private_dns_zone_id` juntos. Sem eles, o servidor criado mantém um ponto de extremidade público restrito aos serviços do Azure.

Entradas a definir: `subscription_id`, `resource_group_name`, `location`, `public_url`, `image_tag`, e `storage_account_name` e `postgresql_server_name` globalmente únicos. A primeira implantação responde na saída `fqdn`; vincule um domínio personalizado com `az containerapp hostname add` / `bind` como descrito na página Serviços de contêineres gerenciados, depois defina `public_url` e aplique de novo. O Azure não tem um sinalizador de proteção contra exclusão em um Flexible Server, por isso o módulo coloca bloqueios `CanNotDelete` no servidor e na conta de armazenamento (`db_deletion_protection`, `storage_deletion_protection`).

## Google Cloud Run

**Antes de começar**: um projeto, uma rede VPC com uma sub-rede na região e **acesso a serviços privados** nessa VPC — o IP privado do Cloud SQL precisa dele. Se a VPC ainda não o tiver, defina uma vez `create_private_service_connection = true`; um segundo peering em uma VPC que já tem um falha.

Entradas a definir: `project_id`, `region`, `network`, `subnetwork`, `public_url`, `image_tag`. O módulo habilita as APIs, cria um repositório remoto do Artifact Registry que faz proxy do ghcr.io (o Cloud Run não consegue baixar diretamente do ghcr.io), uma instância do Filestore para `/app/data` (o nível padrão `BASIC_HDD` começa em 1 TiB e é o custo dominante), executa um job único que atribui o compartilhamento ao usuário 1000 e coloca na frente do serviço um balanceador HTTPS global com certificado gerenciado pelo Google. Crie o registro DNS A do host de `public_url` apontando para `load_balancer_ip`; o certificado fica em `PROVISIONING` até esse registro resolver. Uploads acima de 32 MiB — uma importação grande de espaço de trabalho — falham no caminho HTTP/1 do Cloud Run; é um limite da plataforma, não uma configuração do módulo.

## Kubernetes

O módulo `kubernetes` envolve o chart publicado em um `helm_release`, para equipes cujos clusters também são gerenciados pelo Terraform. Ele cria o namespace e um Secret com `SECRET_KEY` e `POSTGRES_PASSWORD` (ou usa, via `existing_secret`, um produzido pelo External Secrets ou Sealed Secrets), gera as chaves de values do próprio chart e passa o Secret pelo nome — segredos nunca trafegam pelos values. Entradas a definir: `chart_version`, `public_url`, `db_host`, e `secret_key` + `db_password` ou `existing_secret`. Classe de Ingress, anotações e TLS passam pelo objeto `ingress`; tudo o que o módulo não expõe (`backend.resources`, `seed.demo`…) passa por `extra_values`, uma lista de documentos de values do chart mesclados após o gerado.

Os dois blocos `provider` leem um kubeconfig; substitua-os pela autenticação do seu cluster (token do EKS, credenciais do AKS, plugin de autenticação do GKE) quando o Terraform também criar o cluster.

## Atualizações e remoção

Uma atualização de versão é uma mudança de `image_tag` (ou `chart_version`) seguida de `terraform apply`; o backend executa as migrações na inicialização, sob o bloqueio de inicialização nas plataformas que sobrepõem a instância antiga e a nova. Leia antes as [notas de versão](https://github.com/vincentmakes/turbo-ea/blob/main/CHANGELOG.md) e faça backup do banco como em qualquer outra instalação — [Operações e atualizações](operations.md) se aplica.

`terraform destroy` é recusado enquanto a proteção contra exclusão estiver ativa: desative `db_deletion_protection` (AWS, Google Cloud e os bloqueios no Azure), `deletion_protection` no serviço do Cloud Run e, na AWS, decida sobre o snapshot final do RDS (`db_skip_final_snapshot`), aplique e destrua. O nome de uma instância do Cloud SQL excluída não pode ser reutilizado por uma semana.

## Validação sem nuvem

Cada módulo traz testes em `tests/` que rodam contra **provedores simulados**: esquemas de provedor reais, valores inventados, sem credenciais, nada criado. Eles fixam a fiação de que as páginas de plataforma dependem — um backend, a borda na porta 8920, segredos por referência, o volume de dados, as chaves para trazer o seu — e a CI os executa junto com `terraform validate` e `tflint` a cada mudança. O que não podem provar é que uma nuvem aceite o plano; o primeiro `terraform plan` contra uma conta real é essa verificação. O OpenTofu não é exercitado, mas os módulos evitam todo recurso exclusivo do Terraform.

## Solução de problemas

| Sintoma | Causa e correção |
|---|---|
| `Error creating Service Networking Connection … already exists` (Google Cloud) | A VPC já tem acesso a serviços privados. Defina `create_private_service_connection = false`. |
| O certificado gerenciado pelo Google fica em `PROVISIONING` | O registro DNS A do host de `public_url` ainda não resolve para `load_balancer_ip`. Corrija o DNS e aguarde; nada a aplicar. |
| `Permission denied` em `/app/data` no Cloud Run | O compartilhamento não pertence ao usuário 1000 — por exemplo, após uma restauração. Altere `chown_job_token` e aplique para executar o job de novo. |
| `postgresql_delegated_subnet_id and postgresql_private_dns_zone_id must be set together` (Azure) | O acesso privado exige ambos; a zona deve estar vinculada à VNet e a sub-rede deve ser diferente da do ambiente. |
| `db_host is required when create_database is false` | Trazer o seu banco exige `db_host` e `db_password` (`TF_VAR_db_password`). |
| `terraform destroy` recusa | A proteção contra exclusão ou um bloqueio `CanNotDelete` está ativo; veja *Atualizações e remoção*. |
| A aplicação responde na URL da plataforma, mas não em `public_url` | O DNS aponta para outro lugar, ou `public_url` ainda nomeia o FQDN da plataforma — defina a origem final e aplique; o cookie de sessão está vinculado a ela. |
