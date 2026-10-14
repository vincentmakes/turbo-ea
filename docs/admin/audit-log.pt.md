# Registro de auditoria

O **Registro de auditoria**, em **Admin → Configurações → Registro de auditoria** (`/admin/settings?tab=audit-log`), responde às duas perguntas que uma revisão de segurança faz a uma instância que guarda o mapa de todo o panorama de TI: *o que mudou nele* e *quem entrou, e como*. Ele é dividido em duas subabas:

| Subaba | URL | O que registra |
|--------|-----|----------------|
| **Alterações** | `/admin/settings?tab=audit-log` | Cada escrita no panorama — cards, relações, riscos, etiquetas, papéis de partes interessadas, rascunhos de decisão —, agrupada em lotes de mutação, com um diff por evento e um **Reverter (Rollback)** |
| **Segurança e administração** | `/admin/settings?tab=audit-log&view=security` | Entradas e saídas, tentativas com falha, bloqueios, sessões SSO e de proxy, eventos de senha e personificação de papel |

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
- exportações deste próprio registro.

!!! note "Na próxima versão"
    As **ações administrativas** — alterações em usuários, papéis, configurações, metamodelo, extensões, importações e integrações — e as **exportações de dados** (exportações CSV/JSON do inventário, exportações de workspace e de migração) serão registradas neste mesmo registro na próxima versão.

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

### Detalhes de uma entrada

Clique em uma linha para abrir o painel da entrada. Ele mostra todos os campos, incluindo o agente de usuário do navegador e os **detalhes** registrados com ela — o código de motivo de uma entrada com falha, a hora em que um bloqueio termina, o provedor de identidade de uma entrada por SSO. Quando uma entrada registra uma alteração, os detalhes aparecem como uma tabela de valores antigos e novos. Segredos nunca são armazenados: uma senha, um token ou um segredo de cliente é substituído por `***` antes de a entrada ser gravada.

O painel não tem ações. As entradas não podem ser editadas nem excluídas.

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
| `auth.password.reset_requested` | alguém pede um e-mail de redefinição de senha. Sempre registrada como sucesso e apenas com o endereço digitado, de modo que o registro nunca revela se essa conta existe |
| `auth.password.reset` | uma senha é alterada por um link de redefinição |
| `auth.password.changed` | um usuário conectado altera a própria senha |
| `auth.impersonation.started` | um administrador inicia **Ver como papel…**. O alvo é o papel escolhido |
| `auth.impersonation.stopped` | o administrador volta ao próprio papel |
| `access.audit_log.exported` | alguém exporta o registro de segurança para CSV |

**Códigos de motivo** de `auth.login.failed`:

| Motivo | Significado |
|--------|-------------|
| `unknown_user` | Nenhuma conta tem esse endereço de e-mail |
| `sso_account` | A conta entra por SSO e não tem senha |
| `no_password` | A conta ainda não tem senha — um convite que nunca foi aceito |
| `locked` | A conta está bloqueada após falhas repetidas |
| `bad_password` | A senha está errada |
| `inactive` | A conta está desativada |

Uma rajada de falhas `unknown_user` vindas de um mesmo endereço IP é a cara de um ataque de *password spraying*; uma sequência de `bad_password` contra uma conta seguida de `auth.login.locked` é uma tentativa de adivinhar a senha dessa conta.

## O que não é registrado

- **A renovação do token.** O aplicativo web renova a sessão periodicamente, então cada aba aberta acrescentaria entradas e nenhuma significaria nada.
- **Requisições recusadas por um token de sessão expirado ou inválido.** Elas acontecem toda vez que uma sessão termina normalmente.
- **Leituras de feeds OData.** O Excel e o Power BI consultam o feed OData de uma visualização salva de forma agendada, então cada atualização acrescentaria uma entrada.
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
| `details` | Códigos de motivo e valores antigos/novos, com os segredos já mascarados |

Enviar o fluxo para um repositório central de logs guarda uma cópia fora da instância, longe do alcance de quem pode administrá-la — é disso que uma revisão de ameaças internas precisa. Veja [Logs e fluxo de auditoria](operations.md#logging-and-the-audit-stream) para coletá-lo.

## Endereço IP do cliente { #client-ip-address }

A coluna **IP** registra o endereço do cliente, não o do proxy à frente do backend. O nginx de borda incluído define o cabeçalho `X-Real-IP` com o endereço de onde recebeu a conexão, e o backend lê esse cabeçalho porque a imagem publicada do backend define **`TRUST_PROXY_HEADERS=true`**. Um valor que não é um endereço IP válido é descartado em vez de registrado.

- **Mantenha `TRUST_PROXY_HEADERS` ativado** enquanto toda requisição chegar ao backend pelo nginx incluído — a pilha padrão, o [chart Helm](kubernetes.md) e os [modelos de contêineres gerenciados](managed-containers.md) funcionam todos assim.
- **Desative-o** (`TRUST_PROXY_HEADERS=false`) se você expuser o contêiner do backend diretamente, sem o nginx incluído à frente: um cliente poderia então enviar o próprio `X-Real-IP` e escolher o endereço registrado.
- **Atrás de outro balanceador de carga**, o nginx incluído vê o endereço desse balanceador, e todas as entradas o registram. Uma configuração que permita ao nginx confiar no endereço do cliente repassado pelo seu balanceador de carga (`NGINX_TRUSTED_PROXIES`) está prevista para uma versão futura.
