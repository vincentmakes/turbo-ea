# Jira Todo Sync

Acabaram as duas listas de tarefas. **Jira Todo Sync** espelha as tarefas do
Turbo EA num projeto do Jira Cloud à sua escolha e mantém ambos os lados
alinhados: uma tarefa criada no Turbo EA torna-se um *issue* do Jira em segundos,
concluí-la faz o *issue* transitar para «concluído», e os *issues* do Jira que
correspondam a um filtro à sua escolha aparecem como tarefas. Títulos, prazos e
responsáveis sincronizam-se nos dois sentidos.

## Em resumo

| | |
|---|---|
| **Licença** | Comercial — é necessário um direito assinado |
| **Versão mínima do Turbo EA** | 2.68.0 |
| **Permissão** | `ext.jira-todos.admin` |
| **Autorizações de acesso a dados** | `core.todos.read`, `core.todos.write`, `core.events.todo`, `core.users.read` |
| **Exige reiniciar o backend** | sim — inclui código de backend |
| **Onde aparece** | **Admin → Definições → Integrações → Jira Todo Sync** · etiquetas com a chave do *issue* na página de tarefas e no separador Tarefas dos cartões |

Só o **Jira Cloud** é suportado. A ligação é apenas de saída: o Turbo EA chama a
API REST do Jira com um e-mail de conta e um token de API. Não há qualquer
*callback* OAuth a expor, nenhuma aplicação Jira a instalar e nenhum acesso de rede
de entrada, pelo que funciona em instâncias auto-alojadas ou atrás de uma
*firewall*.

## Configuração

### 1. Criar um token de API da Atlassian

1. Aceda a
   <https://id.atlassian.com/manage-profile/security/api-tokens> e inicie sessão
   com a conta Atlassian com que a sincronização deve atuar. Use uma **conta de
   serviço dedicada**, se tiver: os *issues* são criados e transitados com esta
   conta. (Esta ligação direta é a via fiável; a página de tokens já não é
   acessível por um caminho de menu evidente.)
2. Clique em **Create API token** — a variante simples, **não** *Create API token
   with scopes*. **Tokens com âmbitos não são suportados.**
3. Dê-lhe um nome (por exemplo `turbo-ea-sync`) e escolha uma validade. A Atlassian
   exige uma e limita-a a **um ano**.
4. **Copie o token de imediato** — só é mostrado uma vez.

!!! warning "Os tokens expiram"
    Quando o token expira, a sincronização para com erros de autenticação até ser
    introduzido um novo. Anote a data de expiração ao criá-lo.

### 2. Ligar o Turbo EA

Abra **Admin → Definições → Integrações** e escolha o subseparador **Jira Todo
Sync**.

Em **Ligação ao Jira Cloud**, preencha:

| Campo | Notas |
|---|---|
| **URL do site** | Por exemplo `https://o-seu-site.atlassian.net` |
| **E-mail da conta** | A conta Atlassian a que o token pertence |
| **Token de API** | Guardado cifrado. Deixe vazio mais tarde para manter o token guardado |

Clique em **Testar ligação**. Em caso de sucesso é indicado *Connected as …*.

### 3. Definir o âmbito

Em **Âmbito da sincronização**:

- **Projeto Jira** — escolha da lista, que é carregada do Jira assim que os dados
  de ligação estiverem preenchidos. As tarefas enviadas são aí criadas como
  *issues* do tipo **Task**.
- **Filtro de importação (JQL)** — os *issues* que correspondam a este JQL são
  espelhados como tarefas. Deixe vazio para o valor predefinido
  `project = "<KEY>" AND statusCategory != Done`.
- **Intervalo de verificação (segundos)** — com que frequência o Jira é consultado.
  Predefinição 300, mínimo 60.

Em **Direções** existem três interruptores:

| Interruptor | Predefinição | Efeito |
|---|---|---|
| **Enviar todos para o Jira** | ativo | As tarefas criadas no Turbo EA tornam-se *issues* do Jira; concluir uma tarefa faz transitar o seu *issue* |
| **Importar issues do Jira** | ativo | Os *issues* correspondentes aparecem como tarefas; resolver um *issue* conclui a sua tarefa |
| **Espelhar todos de assinatura (sentido único)** | **inativo** | As assinaturas de riscos, decisões e projetos tornam-se *issues* do Jira com ligação de retorno, mas continuam a ter de ser concluídas no Turbo EA |

Clique em **Guardar configuração**. **Sincronizar agora** executa logo um ciclo.

A correspondência de responsáveis não precisa de configuração: o Turbo EA associa
automaticamente as pessoas a contas do Jira pelo endereço de e-mail.

## Como se comporta a sincronização

| Evento | Efeito |
|---|---|
| Tarefa criada no Turbo EA | É criado um *issue* do Jira em segundos (título, descrição com ligação de retorno, prazo, responsável) |
| Tarefa concluída ou editada | O *issue* passa a «concluído» ou os seus campos são atualizados |
| *Issue* que corresponde ao JQL | É espelhado como tarefa |
| *Issue* resolvido no Jira | A tarefa é concluída na verificação seguinte (as tarefas recorrentes avançam para o ciclo seguinte) |
| *Issue* reaberto no Jira | A tarefa é reaberta |
| **Alterações dos dois lados** | **Vence a alteração mais recente; em caso de empate, vence o Jira** |
| Tarefa eliminada no Turbo EA | O *issue* **nunca é eliminado** — um comentário regista a remoção |
| *Issue* eliminado no Jira | Uma tarefa importada é removida; uma tarefa criada no Turbo EA é mantida e assinalada no registo |

**O envio é quase imediato; a importação é periódica.** As alterações feitas no
Turbo EA chegam ao Jira em segundos. As feitas no Jira são recolhidas na
verificação seguinte — por predefinição em menos de cinco minutos. Cada ciclo
reconcilia ainda ambos os lados, pelo que uma indisponibilidade do Jira ou um
evento perdido se corrige sozinho em vez de perder alterações.

São mantidos alinhados quatro campos: **título**, **prazo**, **estado concluído** e
**responsável**. O título corresponde à **primeira linha** do texto da tarefa,
pelo que mudar o nome de um *issue* no Jira substitui exatamente essa primeira
linha e deixa intactas as linhas de detalhe seguintes.

### A etiqueta com a chave do *issue*

Uma tarefa sincronizada apresenta a sua chave de *issue* do Jira (por exemplo
`PROJ-123`) como uma pequena ligação, tanto na
[página de tarefas](../guide/tasks.md) como no separador Tarefas de um cartão.
Clicar abre o *issue* no Jira. A etiqueta serve de referência — uma tarefa é
sempre concluída no Turbo EA ou através da sincronização.

### As tarefas de assinatura

Os pedidos de assinatura — um risco, uma decisão ou um projeto à espera de
aprovação — são tarefas de sistema e **nunca** são enviados como tarefas normais.
Com **Espelhar todos de assinatura** ativo, recebem um *issue* do Jira de **sentido
único** que remete diretamente para a página onde a assinatura acontece de facto.

Uma assinatura nunca pode ser dada a partir do Jira. Se alguém fechar o *issue*
espelho enquanto a obrigação continua em aberto, a sincronização reabre-o com um
comentário que remete para o Turbo EA. Quando a assinatura é concluída no
Turbo EA, o espelho passa a «concluído» na verificação seguinte.

Desligar o interruptor impede a criação de *novos* espelhos; os existentes
continuam a ser mantidos.

## Monitorização

A linha **Estado** indica quando ocorreu a última sincronização, o eventual erro e
um resumo do que foi feito. **Atividade recente**, logo abaixo, lista as 50 ações
mais recentes com hora, direção (**Turbo EA → Jira**, **Jira → Turbo EA** ou
**Sync**), *issue* e mensagem de detalhe. Avisos e erros surgem realçados a cor —
é aí que aparecem um responsável não resolvido ou uma transição recusada.

## Permissões

| Permissão | Permite |
|---|---|
| `ext.jira-todos.admin` | Configurar e operar a sincronização — ligação, projeto, filtros, execução manual e registo de atividade |

O subseparador fica totalmente oculto para quem não a possua. **As pessoas
utilizadoras não precisam de qualquer permissão adicional**: as tarefas
sincronizadas aparecem simplesmente na sua lista habitual, com a etiqueta da chave
do *issue*.

## Se a licença expirar ou a extensão for desativada

A tarefa de sincronização e o seu gestor de eventos são suspensos de imediato e as
autorizações de acesso a dados são revogadas. **Nada é eliminado** — as tarefas
mantêm as etiquetas e as definições são preservadas. Uma licença renovada retoma a
sincronização onde parou.

O token de API é guardado cifrado na sua instância e está excluído da transferência
de espaço de trabalho, pelo que nunca sai da instância onde foi introduzido.

## Resolução de problemas e limitações

- **Apenas Jira Cloud.** O Jira Data Center não é suportado.
- **Um projeto por instância**, e os *issues* são sempre criados com o tipo
  **Task**.
- **Verificação periódica, não *webhooks*.** As alterações do lado do Jira chegam
  na verificação seguinte. Os *webhooks* do Jira Cloud exigiriam uma aplicação
  OAuth e uma instância acessível a partir da Internet, e continuaria a ser
  necessária uma verificação de reconciliação — por isso a sincronização é
  periódica por opção de desenho.
- **Correspondência de responsáveis e privacidade do e-mail.** O Turbo EA faz
  corresponder as pessoas pelo endereço de e-mail e, na falta disso, recorre a uma
  correspondência exata do nome apresentado entre as pessoas atribuíveis do
  projeto. Alguém com o e-mail oculto no Jira *e* com um nome apresentado
  diferente entre os dois sistemas não pode ser associado; essas atribuições ficam
  inalteradas e o registo indica o endereço que não foi possível resolver. Uma
  pessoa do Turbo EA não resolvida nunca desatribui silenciosamente o *issue* do
  Jira.
- **Limpar um prazo no Jira não é espelhado de volta.** Limpe-o no Turbo EA.
- **Os espelhos de tarefas de assinatura são de sentido único e podem atrasar-se
  até um intervalo de verificação**, porque os fluxos de assinatura do núcleo não
  emitem eventos de alteração.
- **Sincronizar agora** responde *A sync is already running* se já houver um ciclo
  em curso.
- Após uma rotação da `SECRET_KEY` da sua instância, o token guardado deixa de
  poder ser decifrado e o painel volta a *Not configured yet* — volte a
  introduzi-lo.
