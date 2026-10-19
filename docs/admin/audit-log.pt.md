# Registro de auditoria

O **Registro de auditoria**, em **Admin → Configurações → Registro de auditoria** (`/admin/settings?tab=audit-log`), responde às duas perguntas que uma revisão de segurança faz a uma instância que guarda o mapa de todo o panorama de TI: *o que mudou nele* e *quem entrou, e como*. Ele é dividido em duas subabas:

| Subaba | URL | O que registra |
|--------|-----|----------------|
| **Alterações** | `/admin/settings?tab=audit-log` | Cada escrita no panorama — cards, relações, riscos, etiquetas, papéis de partes interessadas, rascunhos de decisão —, agrupada em lotes de mutação, com um diff por evento e um **Reverter (Rollback)** |
| **Segurança e administração** | `/admin/settings?tab=audit-log&view=security` | Entradas e saídas, tentativas falhadas, bloqueios, sessões SSO e de proxy, eventos de senha, personificação de papel e cada ação administrativa |

As duas são separadas de propósito. **Alterações** é uma ferramenta de trabalho — existe para que você veja e desfaça uma escrita errada — e mantém um histórico curto. **Segurança e administração** é uma trilha de evidências: suas entradas não podem ser editadas nem excluídas, e ela é mantida por um ano por padrão.

## Quem pode ver

As duas subabas exigem a permissão **`admin.events`** («Ver a trilha de auditoria e o fluxo de eventos»), que por padrão só o papel **Admin** possui. Para dar acesso de leitura a um responsável de segurança ou conformidade sem torná-lo administrador, crie um papel com `admin.events` em [Usuários e Papéis](users.md#papeis) e atribua-o a ele.

## Alterações

A subaba **Alterações** é o registro dos lotes de mutação. Cada escrita que altera dados chega aqui como um lote, junto com quem a fez e de onde veio:

| Origem | Significado |
|--------|-------------|
| **Web** | A interface web do Turbo EA |
| **API** | Uma chamada direta à API REST (um script, uma integração) |
| **Ferramenta de IA** | Um assistente de IA conectado pelo [servidor MCP](mcp.md) |
| **Extensão** | Uma [extensão](extensions.md) instalada, registrada como lote `ext:<key>` |

Clique em um lote para abrir seu painel: o diff por evento mostra o valor antigo e o novo de cada campo, e **Reverter** desfaz as escritas em cards, relações, riscos, papéis de partes interessadas, etiquetas e rascunhos de decisão que ele fez.

Os lotes são mantidos por **`MUTATION_BATCH_RETENTION_DAYS`** dias (uma variável de ambiente, padrão **15**) e depois removidos automaticamente. Os eventos em si continuam na aba **Histórico** de cada card depois que o lote some.

## Segurança e administração

![Registro de segurança e administração](../assets/img/pt/62_admin_registro_auditoria_seguranca.png)

A subaba **Segurança e administração** lista uma entrada para cada ação relevante para a segurança, as mais recentes primeiro:

- entradas e saídas, com senha, SSO ou por um proxy reverso confiável;
- tentativas de entrada com falha, cada uma com um **código de motivo** que diz por que falhou;
- bloqueios de conta após falhas repetidas;
- cadastros, e senhas definidas, redefinidas ou alteradas;
- personificação de papel — um administrador que inicia e encerra **Ver como papel…**;
- ações administrativas — alterações em usuários, papéis, configurações, metamodelo, tags, cálculos, extensões, importações, integrações, portais públicos e diagramas publicados, pesquisas e acesso do operador (veja [Ações administrativas](#administrative-actions));
- exportações de dados — as exportações CSV e JSON de cards, as exportações do workspace e as exportações para outra plataforma de EA (veja [Exportações de dados](#data-exports)) — e as exportações deste próprio registro.

### Colunas

| Coluna | Descrição |
|--------|-----------|
| **Quando** | Data e hora da ação |
| **Categoria** | `auth` (autenticação), `admin` (ações administrativas) ou `access` (exportações e outros acessos a dados) |
| **Ação** | O que aconteceu, por exemplo `auth.login.failed` — veja o [catálogo de ações](#action-catalogue) |
| **Resultado** | **Sucesso** ou **Falha** |
| **Ator** | O usuário conectado que executou a ação. Vazio quando ninguém estava conectado — numa entrada com falha, por exemplo |
| **Sujeito** | A conta a que a ação se referia — o endereço de e-mail digitado numa entrada com falha, ou o usuário cuja senha foi redefinida |
| **Alvo** | O objeto sobre o qual se agiu, quando há um — por exemplo, o papel escolhido ao iniciar uma personificação |
| **IP** | O endereço IP do cliente (veja [Endereço IP do cliente](#client-ip-address)) |
| **Origem** | De onde veio a requisição: web, API, ferramenta de IA, extensão, ops ou sistema |
| **Papel personificado** | Quando um administrador estava vendo o aplicativo como outro papel, esse papel. O ator continua sendo o administrador real |

As colunas podem ser exibidas, ocultadas, reordenadas e congeladas como em qualquer outra tabela de dados; **Quando** e **Ação** são sempre exibidas.

### Filtros

A barra lateral de filtros à esquerda restringe a lista por **categoria**, **resultado**, **ação**, **ator**, **endereço IP** e um **intervalo de datas**. Cada cabeçalho de seção mostra quantos valores estão selecionados, e a barra recolhida mostra o número de filtros ativos. A aba **Colunas** da mesma barra exibe, oculta e congela colunas. Seus filtros e o layout das colunas ficam salvos neste navegador.

Uma busca por endereço de e-mail encontra o ator, o sujeito e o alvo, de modo que digitar um único endereço mostra tanto o que essa pessoa fez quanto o que foi tentado contra a conta dela.

### Ler uma entrada

Clique em uma linha para abrir o painel da entrada. Ele mostra cada campo da entrada — quando, quem, de qual endereço IP e com qual navegador — e, em **Detalhes**, o que a entrada registrou, escrito em linguagem simples em vez de chaves internas:

- **Alterações** — uma frase por alteração. A edição de um tipo de ficha aparece, por exemplo, como *Campo “Criticidade de negócio” (Seleção única) adicionado à seção “Governança”* ou *Opção “Alta” do campo “Criticidade de negócio” renomeada para “Crítica”*. Campos, seções, opções, papéis e portais são indicados pelo rótulo, as permissões pela descrição e os idiomas pelo nome.
- **Antes / Depois** — uma tabela dos valores alterados, uma linha por campo, cada campo indicado pelo rótulo. Os valores são formatados: Sim ou Não, datas no formato de data do espaço de trabalho, cores como amostra, tamanhos de arquivo em KB ou MB. Segredos nunca são armazenados: uma senha, um token ou um segredo de cliente é substituído antes de a entrada ser gravada e aparece como **Valor secreto**.
- **Contexto** — fatos que enquadram uma alteração sem fazer parte dela: o endereço atual de um portal e se ele está publicado, se as credenciais de uma conexão foram substituídas, quantas linhas uma importação afetou.

Um login com falha mostra o seu **Motivo** acima dos detalhes — uma senha incorreta, uma conta desconhecida, uma conta temporariamente bloqueada.

As entradas gravadas antes da versão 2.161.0 mostram os detalhes como foram registrados: os valores antigos e novos continuam aparecendo na tabela, e o que o painel não consegue ler é mostrado como JSON bruto.

O painel não oferece ações. As entradas não podem ser editadas nem excluídas.

### Exportar CSV

**Exportar CSV**, na barra de ferramentas, baixa as entradas que correspondem aos filtros atuais como arquivo CSV, até 50 000 linhas. A própria exportação é registrada, como `access.audit_log.exported`, de modo que exportar o registro de segurança sempre deixa um rastro nele.

## Catálogo de ações { #action-catalogue }

| Ação | Registrada quando |
|------|-------------------|
| `auth.login.succeeded` | um usuário entra com e-mail e senha |
| `auth.login.failed` | uma entrada com senha é recusada. O **código de motivo** diz por quê (veja abaixo) |
| `auth.login.locked` | a quinta tentativa com falha seguida bloqueia a conta por 15 minutos. Os detalhes trazem a hora em que o bloqueio termina |
| `auth.logout` | um usuário conectado sai. Uma saída sem sessão válida não registra nada |
| `auth.sso.succeeded` | um usuário entra por um provedor SSO. Os detalhes trazem o provedor, o sujeito do provedor de identidade e se a conta foi criada por essa entrada |
| `auth.sso.failed` | uma entrada por SSO é recusada — um domínio não permitido, um endereço de e-mail ausente, uma conta local com o mesmo e-mail, uma conta inativa. Os detalhes trazem o provedor e o motivo |
| `auth.proxy_session.succeeded` | um usuário entra por um [proxy reverso](sso.md#autenticacao-por-proxy-reverso) confiável |
| `auth.proxy_session.failed` | uma entrada pelo proxy reverso é recusada |
| `auth.register` | um usuário cria uma conta pelo autocadastro |
| `auth.password.set` | um usuário convidado define sua primeira senha |
| `auth.password.reset_requested` | Alguém pede um e-mail de reposição da palavra-passe. Registado sempre como sucesso com o endereço escrito, para que a resposta não revele nada; os detalhes indicam se uma conta correspondeu e se foi enviado um e-mail |
| `auth.password.reset` | uma senha é alterada por um link de redefinição |
| `auth.password.changed` | um usuário conectado altera a própria senha |
| `auth.impersonation.started` | um administrador inicia **Ver como papel…**. O alvo é o papel escolhido |
| `auth.impersonation.stopped` | o administrador volta ao próprio papel |

**Códigos de motivo** de `auth.login.failed`:

| Motivo | Significado |
|--------|-------------|
| `unknown_user` | Nenhuma conta tem esse endereço de e-mail |
| `sso_account` | A conta entra por SSO e não tem senha |
| `no_password` | A conta ainda não tem senha — um convite que nunca foi aceito |
| `locked` | A conta está bloqueada após falhas repetidas |
| `bad_password` | A senha está errada |
| `inactive` | A conta está desativada |

**Códigos de motivo** de `auth.sso.failed`, `auth.proxy_session.failed`, `auth.password.set` e `auth.password.reset`:

| Motivo | Significado |
|--------|-------------|
| `expired` | O acesso temporário da conta terminou |
| `hd_mismatch` | A conta Google pertence a um domínio não permitido |
| `no_email` | O provedor de identidade não devolveu nenhum endereço de e-mail |
| `no_subject` | O provedor de identidade não devolveu nenhum identificador de sujeito |
| `local_account` | Uma conta local com palavra-passe já usa esse e-mail |
| `no_account` | Não existe nenhuma conta e as contas não são criadas automaticamente |
| `exchange_failed` | O provedor de identidade não concluiu o início de sessão |
| `unauthenticated` | O proxy reverso não autenticou o pedido |
| `identity_rejected` | A identidade encaminhada foi rejeitada (domínio ou e-mail não verificado) |
| `invalid_token` | A ligação de convite ou de reposição era inválida ou expirou |

Uma rajada de falhas `unknown_user` vindas de um mesmo endereço IP é a cara de um ataque de *password spraying*; uma sequência de `bad_password` contra uma conta seguida de `auth.login.locked` é uma tentativa de adivinhar a senha dessa conta.

### Ações administrativas { #administrative-actions }

Cada alteração que um administrador faz na configuração da instância é registrada na categoria `admin`. O **ator** é o administrador, o **alvo** é o objeto alterado — um usuário, um papel, uma configuração, um tipo de ficha — com o nome que tinha naquele momento, e os **detalhes** indicam o que mudou como valores antigos e novos, limitados aos campos que realmente mudaram. Duas regras valem para cada entrada:

- **Os segredos são mascarados.** Uma senha SMTP, um segredo de cliente SSO, uma chave de provedor de IA, uma credencial do ServiceNow ou qualquer outro valor secreto é escrito como `***`: a entrada mostra que ele mudou, nunca o que era nem o que passou a ser.
- **Nunca são armazenados o texto de uma licença nem uma credencial.** Uma licença de extensão é identificada, não copiada, e uma senha que um administrador define para um usuário é registrada como alterada, nunca com o seu valor.

Uma gravação que não altera nada não é registrada, nem um usuário que edita o próprio nome ou idioma no perfil. Configurações extensas — os campos, as traduções ou o layout de um tipo de ficha, os filtros de um portal — são resumidas pelo tamanho em vez de copiadas; quando o tamanho não mudou, é acrescentada uma breve impressão digital do conteúdo, para que a entrada ainda mostre que algo mudou. As substituições de permissão por papel de um tipo de ficha são a exceção: cada célula alterada é listada com o valor antigo e o novo, e um valor vazio significa que vale a permissão do próprio papel.

| Área | Ações | O que é registrado |
|------|---------|------------------|
| **Usuários e papéis** | `admin.user.created`, `.updated`, `.deleted`, `.bulk_updated`, `.bulk_deleted`, `.unlocked`; `admin.user.invitation.resent`, `.deleted`; `admin.role.created`, `.updated`, `.archived`, `.restored`; `admin.stakeholder_role.created`, `.updated`, `.deleted`, `.archived`, `.restored` | Contas criadas, editadas, ativadas ou desativadas, excluídas (uma a uma ou em massa) e desbloqueadas, com os campos alterados — papel, e-mail, nome, estado ativo; convites reenviados ou revogados; papéis da aplicação e papéis de partes interessadas por tipo, com as permissões concedidas ou retiradas |
| **Configurações** | `admin.settings.updated` | Uma entrada por configuração salva — e-mail, autenticação e SSO, registro, IA, MCP, idiomas, ativação de módulos, identidade visual, logotipo e favicon, períodos de retenção. O alvo é a configuração; os detalhes são o seu valor antigo e novo, com os segredos mascarados |
| **Metamodelo** | `admin.metamodel.type.*` (including `.references_generated`), `admin.metamodel.relation_type.*`, `admin.metamodel.resource_type.*`, `admin.metamodel.category.*` (including `.reordered`), `admin.principle.*` (including `.imported`), `admin.regulation.*` | Tipos de ficha, tipos de relação e tipos de recurso criados, alterados, excluídos ou restaurados, com as propriedades alteradas; referências de fichas geradas para um tipo; princípios EA, incluindo os importados do catálogo; regulamentações de conformidade; categorias de tipos de ficha (camadas de arquitetura) criadas, renomeadas, recoloridas, reordenadas ou excluídas |
| **Tags e cálculos** | `admin.tag_group.*`, `admin.tag.*`, `admin.calculation.*` | Grupos de tags e tags; campos calculados criados, alterados, excluídos, ativados ou desativados, com a fórmula antiga e a nova, e a execução de um cálculo em todas as fichas (`.recalculated`) |
| **Extensões** | `admin.extension.install.uploaded`, `.applied`, `.discarded`; `admin.extension.store.claimed`, `.refreshed`, `.installed`; `admin.extension.enabled`, `.disabled`, `.uninstalled`; `admin.extension.license.updated`, `.removed` | Pacotes enviados, instalados ou descartados; licenças e downloads da loja de extensões; extensões ativadas, desativadas e desinstaladas; a licença substituída ou removida — com a extensão e a sua versão, nunca o texto da licença |
| **Transferência de workspace e migração** | `admin.workspace.import.uploaded`, `.applied`, `.completed`, `.discarded`; `admin.migration.uploaded`, `.field_mappings.updated`, `.applied`, `.deleted` | Um [pacote de workspace](workspace-transfer.md) enviado, a sua importação iniciada, concluída ou descartada; uma [migração de plataforma](migration.md) enviada, os seus mapeamentos de campos editados, aplicada ou excluída |
| **Integrações** | `admin.servicenow.connection.*`, `admin.servicenow.mapping.*`, `admin.servicenow.sync.pulled`, `.pushed`, `.applied` | Conexões do ServiceNow, com as credenciais mascaradas, e mapeamentos; cada pull, push e aplicação de registros preparados |
| **Exposição pública** | `admin.web_portal.created`, `.updated`, `.deleted`; `admin.diagram.published`, `.unpublished` | [Portais web](web-portals.md) e diagramas publicados — tudo o que torna os dados acessíveis sem uma conta |
| **Pesquisas** | `admin.survey.sent`, `admin.survey.closed` | Uma pesquisa enviada aos destinatários, ou encerrada |
| **Acesso do operador** | `admin.ops.rescue_access.granted`, `.revoked` | Acesso de resgate concedido ou revogado pela [API de operações](ops-api.md), registrado junto aos eventos `ops.*` existentes |

### Exportações de dados { #data-exports }

Toda vez que dados saem da instância em massa, uma entrada `access` registra quem os levou, quanto e em que formato. A entrada é gravada antes de o arquivo ser enviado, então uma exportação cujo download nunca terminou também fica registrada.

| Ação | Registrada quando | Detalhes |
|------|-------------------|----------|
| `access.export.cards` | Cards são exportados pela exportação CSV ou JSON da API (`/cards/export/csv`, `/cards/export/json`), como fazem scripts, integrações e assistentes de IA | `format` (`csv` ou `json`), `type` (o tipo ou tipos de card) e `rows` (o número de cards). O alvo é o tipo de card quando a exportação abrangeu exatamente um |
| `access.export.workspace` | Um [pacote de workspace](workspace-transfer.md) completo é baixado — em **Transferência de workspace**, ou por um plano de controle pela [API de operações](ops-api.md), que não registra ator e registra `requested_by: ops` | `include_archived` e `size_bytes` |
| `access.export.migration` | O workspace é exportado para outra plataforma de EA em **Admin → Configurações → Migração** (veja [Migração de plataforma](migration.md)) | A plataforma de destino, `include_archived` e `size_bytes` |
| `access.audit_log.exported` | Alguém exporta o registro de segurança para CSV | `rows` |

## O que não é registrado

- **A renovação do token.** O aplicativo web renova a sessão periodicamente, então cada aba aberta acrescentaria entradas e nenhuma significaria nada.
- **Requisições recusadas por um token de sessão expirado ou inválido.** Elas acontecem toda vez que uma sessão termina normalmente.
- **Leituras de feeds OData.** O Excel e o Power BI consultam o feed OData de uma visualização salva de forma agendada, então cada atualização acrescentaria uma entrada.
- **Planilhas e apresentações geradas no navegador.** Os downloads em Excel e PowerPoint do inventário e dos relatórios são montados com dados que a página já carregou, então são leituras, não exportações do servidor.
- **O simples acesso de leitura** — abrir um card, executar um relatório, pesquisar no inventário.

## Retenção { #retention }

As entradas são mantidas por **365 dias** por padrão. Altere isso em **Admin → Configurações → Geral → Gestão de dados → Retenção do registro de segurança**: qualquer número de dias até 3650, ou **0** para manter as entradas para sempre. Uma tarefa exclui toda noite as entradas mais antigas que o período e relê a configuração a cada execução, então uma mudança entra em vigor sem reiniciar.

Essa tarefa de retenção é a única coisa que exclui uma entrada. Não há ação de edição nem de exclusão na interface ou na API, para nenhum papel.

O registro **não** faz parte, de propósito, da [Transferência de workspace](workspace-transfer.md): ele é o histórico de segurança desta instância, não conteúdo do workspace, e clonar uma instância não o copia.

## O fluxo de auditoria JSON

O backend também grava cada entrada como **uma linha JSON** no logger **`turbo_ea.audit`**, no mesmo instante em que ela é armazenada. O backend registra na saída padrão, então o fluxo chega a tudo o que já coleta os logs dos seus contêineres — `docker compose logs backend`, a coleta de logs do Kubernetes ou qualquer agente de envio para um SIEM —, sem nenhuma configuração no Turbo EA:

```bash
docker compose logs -f backend | grep turbo_ea.audit
```

A linha é gravada no momento em que a entrada é registada. Se a transação do pedido falhar depois, a linha existe sem registo: a tabela é o registo oficial e o fluxo é o feed em tempo real.

Cada linha traz os mesmos campos da entrada:

| Campo | Conteúdo |
|-------|----------|
| `audit_id`, `created_at` | O identificador da entrada e o momento em que foi gravada |
| `category`, `action`, `outcome` | O que aconteceu e se deu certo |
| `actor_user_id`, `actor_email` | Quem fez |
| `subject_email` | A conta envolvida |
| `target_type`, `target_id`, `target_label` | Sobre o que agiu |
| `ip`, `user_agent` | O cliente |
| `origin` | web, api, mcp, ext, ops ou system |
| `impersonator_user_id`, `impersonated_role` | Preenchidos enquanto um administrador vê o aplicativo como outro papel |
| `details` | Até quatro chaves, com os segredos já mascarados: `reason` (um código de falha), `changes` (`{field: {old, new}}`), `items` (alterações semânticas, `{kind, …}` — por ex. `field.added`) e `context` (fatos simples) |

Enviar o fluxo para um repositório central de logs guarda uma cópia fora da instância, longe do alcance de quem pode administrá-la — é disso que uma revisão de ameaças internas precisa. Veja [Logs e fluxo de auditoria](operations.md#logging-and-the-audit-stream) para coletá-lo.

## Endereço IP do cliente { #client-ip-address }

A coluna **IP** registra o endereço do cliente, não o do proxy à frente do backend. O nginx de borda incluído define o cabeçalho `X-Real-IP` com o endereço de onde recebeu a conexão, e o backend lê esse cabeçalho porque a imagem publicada do backend define **`TRUST_PROXY_HEADERS=true`**. Um valor que não é um endereço IP válido é descartado em vez de registrado.

- **Mantenha `TRUST_PROXY_HEADERS` ativado** enquanto toda requisição chegar ao backend pelo nginx incluído — a pilha padrão, o [chart Helm](kubernetes.md) e os [modelos de contêineres gerenciados](managed-containers.md) funcionam todos assim.
- **Desative-o** (`TRUST_PROXY_HEADERS=false`) se você expuser o contêiner do backend diretamente, sem o nginx incluído à frente: um cliente poderia então enviar o próprio `X-Real-IP` e escolher o endereço registrado.
- **Atrás de um balanceador de carga, um controlador de ingress ou uma CDN**, o nginx incluído recebe todas as conexões desse intermediário e, sozinho, registra o endereço do balanceador para todos os usuários. Defina **`NGINX_TRUSTED_PROXIES`** no contêiner do nginx, como descrito abaixo.

### Atrás de um balanceador de carga { #behind-a-load-balancer }

`NGINX_TRUSTED_PROXIES` lista os endereços dos intermediários à frente do nginx incluído, como endereços IP ou faixas CIDR separados por vírgulas ou espaços. O nginx passa então a ler o endereço do cliente do cabeçalho `X-Forwarded-For` que esses intermediários acrescentam — mas somente em uma conexão vinda de um dos endereços listados — e ignora cada endereço listado nesse cabeçalho, de modo que uma cadeia de proxies se resolve no primeiro endereço que não é um dos seus. Esse endereço substitui o da conexão, e o cabeçalho `X-Real-IP` que o backend lê o transporta sem alteração. Vazio, o padrão, não confia em ninguém.

Para descobrir o valor, leia o log de acesso do nginx de borda (`docker compose logs nginx`, `kubectl logs deployment/turbo-ea-nginx` ou o visualizador de logs da plataforma): o endereço no início de cada linha é o intermediário em quem confiar, e o último campo entre aspas é o cabeçalho `X-Forwarded-For` que ele enviou.

| Implantação | Onde definir | Valor típico |
|-------------|--------------|--------------|
| Docker Compose, os navegadores chegam diretamente ao nginx | — | Deixar vazio |
| Docker Compose atrás do seu próprio proxy reverso | `NGINX_TRUSTED_PROXIES` no `.env` | O endereço do proxy reverso, como o nginx o vê |
| [Kubernetes](kubernetes.md) atrás de um controlador de ingress | Valor do chart `nginx.trustedProxies` | O CIDR de pods do cluster, por exemplo `10.244.0.0/16` |
| [AWS ECS Fargate](managed-containers.md#aws-ecs-fargate) | `NginxTrustedProxies` / Terraform `nginx_trusted_proxies` | As faixas CIDR das sub-redes do balanceador de carga |
| [Azure Container Apps](managed-containers.md#azure-container-apps) | `nginxTrustedProxies` / Terraform `nginx_trusted_proxies` | A sub-rede de infraestrutura do ambiente |
| [Google Cloud Run](managed-containers.md#google-cloud-run) | `NGINX_TRUSTED_PROXIES` no manifesto / Terraform `nginx_trusted_proxies` | Os endereços que o log de acesso mostra |

Mantenha a lista tão estreita quanto os próprios intermediários. Cada endereço listado é acreditado quando aponta o cliente, então uma faixa de onde seus usuários se conectam — todo o `10.0.0.0/8` em uma implantação interna, por exemplo — permitiria a qualquer um deles gravar outro endereço no registro. Sem configuração, a coluna mostra o balanceador de carga: pouco útil, mas nunca falsificado.

O limite de taxa de entrada conta as tentativas por endereço de cliente a partir do mesmo cabeçalho, então atrás de um balanceador de carga esta configuração também impede que as tentativas com falha de uma pessoa atrasem todas as outras. Isso vale para as entradas que chegam ao backend pelo nginx de borda; o servidor MCP entra diretamente no backend, então as suas próprias chamadas de entrada continuam compartilhando o endereço do contêiner MCP. A chave por cliente confia nesse cabeçalho tal como o registo de auditoria: parte do princípio de que os inícios de sessão só chegam ao backend através do nginx de borda, o que o ficheiro compose incluído e o chart Helm garantem ao não expor o backend. Um cliente que conseguisse chegar diretamente ao backend poderia escolher a sua própria quota definindo ele próprio o cabeçalho; mantenha o backend sem exposição ou desative `TRUST_PROXY_HEADERS`.
