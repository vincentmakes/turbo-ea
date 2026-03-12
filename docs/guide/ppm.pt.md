# Gerenciamento de Portfólio de Projetos (PPM)

O módulo **PPM** fornece uma solução completa de gerenciamento de portfólio de projetos para rastreamento de iniciativas, orçamentos, riscos, tarefas e cronogramas. Integra-se diretamente com o tipo de card Iniciativa para enriquecer cada projeto com relatórios de status, acompanhamento de custos e visualização Gantt.

!!! note
    O módulo PPM pode ser habilitado ou desabilitado por um administrador nas [Configurações](../admin/settings.md). Quando desabilitado, a navegação e funcionalidades do PPM ficam ocultas.

## Painel do Portfólio

O **Painel do Portfólio** é o ponto de entrada principal para o PPM. Ele fornece:

- **Cards de KPI** — Total de iniciativas, orçamento total, custo real total e resumos de status de saúde
- **Gráficos circulares de saúde** — Distribuição de saúde de cronograma, custos e escopo (No Caminho / Em Risco / Fora do Caminho)
- **Distribuição de status** — Detalhamento por subtipo de iniciativa e status
- **Visão geral Gantt** — Barras de cronograma mostrando as datas de início e fim de cada iniciativa, com indicadores de saúde RAG

### Agrupamento e filtragem

Use a barra de ferramentas para:

- **Agrupar por** qualquer tipo de card relacionado (ex., Organização, Plataforma)
- **Filtrar por subtipo** (Ideia, Programa, Projeto, Épico)
- **Pesquisar** por nome de iniciativa

Esses filtros são mantidos na URL, então atualizar a página preserva sua visualização atual.

## Visão Detalhada da Iniciativa

Clique em qualquer iniciativa para abrir sua página de detalhes com sete abas:

### Aba Visão Geral

A visão geral mostra um resumo da saúde e finanças da iniciativa:

- **Resumo de saúde** — Indicadores de cronograma, custos e escopo do último relatório de status
- **Orçamento vs. Real** — Card de KPI combinado mostrando orçamento total e gasto real com variação
- **Atividade recente** — Resumo do último relatório de status

### Aba Relatórios de Status

Relatórios de status mensais acompanham a saúde do projeto ao longo do tempo. Cada relatório inclui:

| Campo | Descrição |
|-------|-----------|
| **Data do relatório** | A data do período de reporte |
| **Saúde do cronograma** | No Caminho, Em Risco ou Fora do Caminho |
| **Saúde dos custos** | No Caminho, Em Risco ou Fora do Caminho |
| **Saúde do escopo** | No Caminho, Em Risco ou Fora do Caminho |
| **Resumo** | Resumo executivo do status atual |
| **Realizações** | O que foi alcançado neste período |
| **Próximos passos** | Atividades planejadas para o próximo período |

### Aba Orçamento e Custos

Acompanhamento de dados financeiros com dois tipos de itens:

- **Linhas de orçamento** — Orçamento planejado por ano fiscal e categoria (CapEx / OpEx). As linhas de orçamento são agrupadas de acordo com o **mês de início do ano fiscal** configurado nas [Configurações](../admin/settings.md#início-do-ano-fiscal). Por exemplo, se o ano fiscal começa em abril, uma linha de orçamento de junho de 2026 pertence ao AF 2026–2027
- **Linhas de custo** — Despesas reais com data, descrição e categoria

Os totais de orçamento e custos são automaticamente acumulados nos atributos `costBudget` e `costActual` do card de Iniciativa.

### Aba Gestão de Riscos

O registro de riscos rastreia os riscos do projeto com:

| Campo | Descrição |
|-------|-----------|
| **Título** | Breve descrição do risco |
| **Probabilidade** | Pontuação de probabilidade (1–5) |
| **Impacto** | Pontuação de impacto (1–5) |
| **Pontuação de risco** | Calculada automaticamente como probabilidade x impacto |
| **Status** | Aberto, Mitigando, Mitigado, Fechado ou Aceito |
| **Mitigação** | Ações de mitigação planejadas |
| **Responsável** | Usuário responsável pelo gerenciamento do risco |

### Aba Tarefas

O gerenciador de tarefas suporta as visualizações **quadro Kanban** e **lista** com quatro colunas de status:

- **A fazer** — Tarefas ainda não iniciadas
- **Em progresso** — Tarefas sendo trabalhadas atualmente
- **Concluído** — Tarefas concluídas
- **Bloqueado** — Tarefas que não podem prosseguir

As tarefas podem ser filtradas e agrupadas por item da Estrutura Analítica do Projeto (EAP/WBS).

Os filtros de exibição (modo de visualização, filtro WBS, alternância de agrupamento) são mantidos na URL entre atualizações de página.

### Aba Gantt

O diagrama de Gantt visualiza o cronograma do projeto com:

- **Pacotes de trabalho (WBS)** — Itens hierárquicos da estrutura analítica do projeto com datas de início/fim
- **Tarefas** — Barras de tarefas individuais vinculadas a pacotes de trabalho
- **Marcos** — Datas-chave marcadas com indicadores de diamante
- **Barras de progresso** — Porcentagem de conclusão visual, arrastável para ajustar diretamente
- **Marcas trimestrais** — Grade de cronograma para orientação

### Aba Detalhes do Card

A última aba mostra a visualização completa de detalhes do card, incluindo todas as seções padrão.

## Estrutura Analítica do Projeto (EAP / WBS)

A EAP fornece uma decomposição hierárquica do escopo do projeto:

- **Pacotes de trabalho** — Agrupamentos lógicos de tarefas com datas de início/fim e acompanhamento de conclusão
- **Marcos** — Eventos significativos ou pontos de conclusão
- **Hierarquia** — Relações pai-filho entre itens da EAP
- **Auto-conclusão** — A porcentagem de conclusão é calculada automaticamente a partir das proporções de tarefas concluídas/totais, acumulada recursivamente pela hierarquia WBS até os itens pai. A conclusão do nível superior representa o progresso geral da iniciativa

## Integração com os detalhes do card

Quando o PPM está ativado, os cards de **Iniciativa** exibem uma aba **PPM** como última aba na [visualização de detalhes do card](card-details.md). Ao clicar nesta aba, você é direcionado diretamente à visualização detalhada PPM da iniciativa (aba Visão Geral). Isso fornece um ponto de acesso rápido de qualquer card de Iniciativa à sua página completa do projeto PPM.

Por outro lado, a aba **Detalhes do Card** dentro da visualização detalhada PPM da iniciativa mostra as seções padrão do card sem a aba PPM, evitando navegação circular.

## Permissões

| Permissão | Descrição |
|-----------|-----------|
| `ppm.view` | Visualizar o painel PPM, diagrama de Gantt e relatórios de iniciativas. Concedido a todos os papéis por padrão |
| `ppm.manage` | Criar e gerenciar relatórios de status, tarefas, custos, riscos e itens WBS. Concedido aos papéis Admin, Admin BPM e Membro |
| `reports.ppm_dashboard` | Visualizar o painel do portfólio PPM. Concedido a todos os papéis por padrão |
