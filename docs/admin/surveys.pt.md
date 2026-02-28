# Pesquisas

O módulo de **Pesquisas** (**Admin > Pesquisas**) permite que administradores criem **pesquisas de manutenção de dados** que coletam informações estruturadas de partes interessadas sobre cards específicos.

## Caso de Uso

Pesquisas ajudam a manter seus dados de arquitetura atualizados, alcançando as pessoas mais próximas de cada componente. Por exemplo:

- Pergunte aos proprietários de aplicações para confirmar a criticidade de negócio e datas do ciclo de vida anualmente
- Colete avaliações de adequação técnica das equipes de TI
- Obtenha atualizações de custos dos responsáveis pelo orçamento

## Ciclo de Vida da Pesquisa

Cada pesquisa progride por três estados:

| Status | Significado |
|--------|-------------|
| **Rascunho** | Sendo projetada, ainda não visível para respondentes |
| **Ativa** | Aberta para respostas, partes interessadas atribuídas a veem em suas Tarefas |
| **Encerrada** | Não aceita mais respostas |

## Criando uma Pesquisa

1. Navegue até **Admin > Pesquisas**
2. Clique em **+ Nova Pesquisa**
3. O **Construtor de Pesquisas** abre com a seguinte configuração:

### Tipo Alvo

Selecione a qual tipo de card a pesquisa se aplica (ex.: Aplicação, Componente de TI). A pesquisa será enviada para cada card deste tipo que corresponda aos seus filtros.

### Filtros

Opcionalmente restrinja o escopo filtrando cards (ex.: apenas aplicações Ativas, apenas cards pertencentes a uma organização específica).

### Perguntas

Desenhe suas perguntas. Cada pergunta pode ser:

- **Texto livre** — Resposta aberta
- **Seleção única** — Escolha uma opção de uma lista
- **Seleção múltipla** — Escolha múltiplas opções
- **Número** — Entrada numérica
- **Data** — Seletor de data
- **Booleano** — Alternância Sim/Não

### Auto-ações

Configure regras que atualizam automaticamente atributos do card com base nas respostas da pesquisa. Por exemplo, se um respondente selecionar "Missão Crítica" para criticidade de negócio, o campo `businessCriticality` do card pode ser atualizado automaticamente.

## Enviando uma Pesquisa

Uma vez que sua pesquisa está no status **Ativa**:

1. Clique em **Enviar** para distribuir a pesquisa
2. Cada card alvo gera uma tarefa para as partes interessadas atribuídas
3. Partes interessadas veem a pesquisa na aba **Minhas Pesquisas** na [página de Tarefas](../guide/tasks.md)

## Visualizando Resultados

Navegue até **Admin > Pesquisas > [Nome da Pesquisa] > Resultados** para ver:

- Status de resposta por card (respondido, pendente)
- Respostas individuais com respostas por pergunta
- Uma ação **Aplicar** para executar regras de auto-ação nos atributos dos cards
