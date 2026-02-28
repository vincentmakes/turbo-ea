# Gestão de Processos de Negócio (BPM)

O módulo **BPM** permite documentar, modelar e analisar os **processos de negócio** da organização. Ele combina diagramas visuais BPMN 2.0 com avaliações de maturidade e relatórios.

!!! note
    O módulo BPM pode ser habilitado ou desabilitado por um administrador em [Configurações](../admin/settings.md). Quando desabilitado, a navegação e os recursos de BPM ficam ocultos.

## Navegador de Processos

![Navegador de Processos de Negócio](../assets/img/en/14_bpm_navigator.png)

O **Navegador de Processos** organiza processos em três categorias principais:

- **Processos de Gestão** — Planejamento, governança e controle
- **Processos Core de Negócio** — Atividades primárias de criação de valor
- **Processos de Suporte** — Atividades que suportam as operações core de negócio

**Filtros:** Tipo, Maturidade (Inicial / Definido / Gerenciado / Otimizado), Nível de automação, Risco (Baixo / Médio / Alto / Crítico), Profundidade (L1 / L2 / L3).

## Painel BPM

![Painel BPM com Estatísticas](../assets/img/en/15_bpm_dashboard.png)

O **Painel BPM** fornece uma visão executiva do status dos processos:

| Indicador | Descrição |
|-----------|-----------|
| **Total de Processos** | Número total de processos de negócio documentados |
| **Cobertura de Diagramas** | Porcentagem de processos com um diagrama BPMN associado |
| **Alto Risco** | Número de processos com nível de risco alto |
| **Risco Crítico** | Número de processos com nível de risco crítico |

Gráficos mostram a distribuição por tipo de processo, nível de maturidade e nível de automação. Uma tabela de **processos de maior risco** ajuda a priorizar investimentos.

## Editor de Fluxo de Processo

Cada card de Processo de Negócio pode ter um **diagrama de fluxo de processo BPMN 2.0**. O editor usa [bpmn-js](https://bpmn.io/) e oferece:

- **Modelagem visual** — Arraste e solte elementos BPMN: tarefas, eventos, gateways, raias e sub-processos
- **Templates iniciais** — Escolha entre 6 templates BPMN pré-construídos para padrões comuns de processo (ou comece de uma tela em branco)
- **Extração de elementos** — Quando você salva um diagrama, o sistema extrai automaticamente todas as tarefas, eventos, gateways e raias para análise

### Vinculação de Elementos

Elementos BPMN podem ser **vinculados a cards de EA**. Por exemplo, vincule uma tarefa no seu diagrama de processo à Aplicação que a suporta. Isso cria uma conexão rastreável entre seu modelo de processo e seu cenário de arquitetura:

- Selecione qualquer tarefa, evento ou gateway no diagrama BPMN
- O painel **Vinculador de Elementos** mostra cards correspondentes (Aplicação, Objeto de Dados, Componente de TI)
- Vincule o elemento a um card — a conexão é armazenada e visível tanto no fluxo de processo quanto nos relacionamentos do card

### Fluxo de Aprovação

Diagramas de fluxo de processo seguem um fluxo de aprovação com controle de versão:

| Status | Descrição |
|--------|-----------|
| **Rascunho** | Sendo editado, ainda não submetido para revisão |
| **Pendente** | Submetido para aprovação, aguardando revisão |
| **Publicado** | Aprovado e visível como a versão atual |
| **Arquivado** | Versão publicada anteriormente, mantida para histórico |

Submeter um rascunho cria um snapshot de versão. Os aprovadores podem aprovar (publicar) ou rejeitar (com comentários) a submissão.

## Avaliações de Processo

Cards de Processo de Negócio suportam **avaliações** que pontuam o processo em:

- **Eficiência** — Quão bem o processo utiliza recursos
- **Eficácia** — Quão bem o processo atinge seus objetivos
- **Conformidade** — Quão bem o processo atende aos requisitos regulatórios

Dados de avaliação alimentam os Relatórios de BPM.

## Relatórios de BPM

Três relatórios especializados estão disponíveis a partir do Painel BPM:

- **Relatório de Maturidade** — Distribuição de processos por nível de maturidade, tendências ao longo do tempo
- **Relatório de Risco** — Visão geral da avaliação de risco, destacando processos que precisam de atenção
- **Relatório de Automação** — Análise dos níveis de automação em todo o cenário de processos
