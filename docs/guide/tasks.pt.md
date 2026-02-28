# Tarefas e Pesquisas

A página de **Tarefas** centraliza todos os itens de trabalho pendentes em um único lugar. Ela tem duas abas: **Minhas Tarefas** e **Minhas Pesquisas**.

![Seção Minhas Tarefas](../assets/img/en/18_tasks.png)

## Minhas Tarefas

Tarefas são itens atribuídos a você ou criados por você. Elas podem estar vinculadas a cards específicos ou serem independentes.

### Filtragem

Use as abas de status para filtrar:

- **Abertas** — Tarefas ainda pendentes ou em andamento
- **Concluídas** — Tarefas completadas
- **Todas** — Tudo

### Gerenciando Tarefas

- **Alternância rápida** — Clique na caixa de seleção para marcar uma tarefa como concluída (ou reabri-la)
- **Link do card** — Se uma tarefa está vinculada a um card, clique no nome do card para navegar até sua página de detalhe
- **Tarefas do sistema** — Algumas tarefas são geradas automaticamente pelo sistema (ex.: "Responder pesquisa para Card X"). Estas incluem um link direto para a ação relevante

### Criando Tarefas

Você pode criar tarefas a partir de dois lugares:

1. **Desta página** — Clique em **+ Nova Tarefa**, insira um título, opcionalmente defina um responsável, data de vencimento e vincule a um card
2. **Da aba de Tarefas de um card** — Crie uma tarefa que é automaticamente vinculada àquele card

Cada tarefa rastreia:

| Campo | Descrição |
|-------|-----------|
| **Título** | O que precisa ser feito |
| **Status** | Aberto ou Concluído |
| **Responsável** | O usuário responsável |
| **Data de vencimento** | Prazo opcional |
| **Card** | O card vinculado (opcional) |

## Minhas Pesquisas

A aba de **Pesquisas** mostra todas as pesquisas de manutenção de dados que precisam da sua resposta. Pesquisas são criadas por administradores para coletar informações de partes interessadas sobre cards específicos (veja [Administração de Pesquisas](../admin/surveys.md)).

Cada pesquisa pendente mostra:

- O nome da pesquisa e o card alvo
- Um botão **Responder** que navega até o formulário de resposta

O formulário de resposta da pesquisa apresenta perguntas configuradas pelo administrador. Suas respostas podem atualizar automaticamente atributos do card, dependendo de como a pesquisa foi configurada.
