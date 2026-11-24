# Introdução ao Turbo EA

### O que é o Turbo EA?

**Turbo EA** é uma plataforma moderna e auto-hospedada para **Gestão de Arquitetura Empresarial**. Ela permite que organizações documentem, visualizem e gerenciem todos os componentes de sua arquitetura de negócios e tecnologia em um único lugar.

### Para quem é este guia?

Este guia é para **todos que utilizam o Turbo EA** — arquitetos empresariais, gerentes de TI, analistas de negócios, desenvolvedores e administradores. Seja você avaliando a plataforma, gerenciando o cenário de TI da sua organização no dia a dia ou configurando o sistema como administrador, você encontrará as informações necessárias aqui. Nenhum conhecimento técnico avançado é necessário para começar.

### Principais Benefícios

- **Visibilidade abrangente**: Visualize todas as aplicações, processos, capacidades e tecnologias em toda a organização em uma única plataforma.
- **Tomada de decisão informada**: Relatórios visuais (portfólio, mapas de capacidade, dependências, ciclo de vida, custos e mais) que facilitam a avaliação do estado atual da infraestrutura tecnológica.
- **Gestão do ciclo de vida**: Acompanhe o status de cada componente tecnológico através de cinco fases — do planejamento à aposentadoria.
- **Colaboração**: Múltiplos usuários podem trabalhar simultaneamente, com papéis configuráveis, atribuições de partes interessadas, comentários, tarefas e notificações.
- **Descrições com IA**: Gere descrições de cards com um único clique. O Turbo EA combina busca na web com um LLM local ou comercial para produzir resumos contextualizados por tipo — completos com pontuações de confiança e links de fontes. Executa inteiramente na sua infraestrutura para privacidade, ou conecte-se a provedores comerciais (OpenAI, Google Gemini, Anthropic Claude e mais). Totalmente controlado pelo administrador: escolha quais tipos de card recebem sugestões de IA, selecione seu provedor de busca e escolha o modelo.
- **Diagramas visuais**: Crie diagramas de arquitetura com o editor DrawIO integrado, totalmente sincronizado com seu inventário de cards.
- **Modelagem de processos de negócio**: Editor de fluxo de processos BPMN 2.0 com vinculação de elementos, fluxos de aprovação e avaliações de maturidade.
- **Integração com ServiceNow**: Sincronização bidirecional com o CMDB do ServiceNow para manter seu cenário de EA conectado com dados de operações de TI.
- **Multi-idioma**: Disponível em inglês, espanhol, francês, alemão, italiano, português e chinês.

### Conceitos Principais

| Termo | Significado |
|-------|-------------|
| **Card** | O elemento básico da plataforma. Representa qualquer componente de arquitetura: uma aplicação, um processo, uma capacidade de negócio, etc. |
| **Tipo de Card** | A categoria à qual um card pertence (Aplicação, Processo de Negócio, Organização, etc.) |
| **Relacionamento** | Uma conexão entre dois cards que descreve como eles se relacionam (ex.: "utiliza", "depende de", "faz parte de") |
| **Metamodelo** | A estrutura que define quais tipos de card existem, quais campos possuem e como se relacionam entre si. Totalmente configurável pelo administrador |
| **Ciclo de Vida** | As fases temporais de um componente: Planejamento, Implantação, Ativo, Desativação, Fim de Vida |
| **Inventário** | Lista pesquisável e filtrável de todos os cards de qualquer tipo. Edição em lote, importação-exportação Excel/CSV e visualizações salvas com compartilhamento |
| **Relatórios** | Visualizações pré-construídas: Portfólio, Mapa de Capacidades, Ciclo de Vida, Dependências, Custos, Matriz, Qualidade dos Dados e Fim de Vida |
| **BPM** | Business Process Management — modele processos com um editor BPMN 2.0, vincule elementos do diagrama a cards e avalie maturidade, risco e automação |
| **PML** | Project Portfolio Management — gerencie cards de Iniciativa como projetos completos com relatórios de status, Work Breakdown Structures, quadros kanban e Gantt, orçamentos, custos e um registro de riscos por iniciativa |
| **TurboLens** | Inteligência EA com IA — análise de fornecedores, detecção de duplicatas, avaliação de modernização, o assistente Architecture AI de 5 etapas e varreduras de Conformidade (EU AI Act / LGPD / NIS2 / DORA / SOC 2 / ISO 27001) |
| **EA Delivery** | A superfície de entrega alinhada com TOGAF — Statements of Architecture Work, Architecture Decision Records e o Registro de Riscos no nível do panorama |
| **SoAW** | Statement of Architecture Work — documento TOGAF formal que delimita o escopo de uma iniciativa de arquitetura |
| **ADR** | Architecture Decision Record — captura contexto, alternativas e consequências de uma decisão, com fluxo de status e vinculação a cards |
| **Registro de Riscos** | Registro de riscos no nível do panorama (TOGAF Fase G), separado dos riscos no nível de iniciativa do PML. A atribuição de proprietário cria automaticamente um Todo |
| **Portal Web** | Visão pública, baseada em slug e somente leitura de parte do panorama EA — compartilhável sem login |
| **Servidor MCP** | Acesso de IA somente leitura via Model Context Protocol — consulte dados EA do Claude Desktop, Cursor, GitHub Copilot e outros clientes MCP |
| **RBAC** | Controle de Acesso Baseado em Funções — funções no nível do aplicativo mais funções de stakeholder por card, com mais de 50 permissões granulares |
