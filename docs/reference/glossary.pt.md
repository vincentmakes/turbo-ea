# Glossário de Termos

| Termo | Definição |
|-------|-----------|
| **ADR (Architecture Decision Record)** | Um documento formal que registra uma decisão de arquitetura importante, incluindo contexto, justificativa, consequências e alternativas consideradas. Os ADRs suportam um fluxo de assinatura e uma cadeia de revisões |
| **Status de Aprovação** | O estado de revisão de um card: Rascunho, Aprovado, Quebrado ou Rejeitado. Cards aprovados mudam para Quebrado quando editados |
| **Favorito / Visualização Salva** | Uma configuração salva de filtros, colunas e ordenação no Inventário que pode ser recarregada com um clique |
| **BPM** | Business Process Management (Gestão de Processos de Negócio) — a disciplina de modelar, analisar e melhorar processos de negócio |
| **BPMN** | Business Process Model and Notation — a notação padrão para modelagem de processos de negócio (versão 2.0) |
| **Capacidade de Negócio** | O que uma organização pode fazer, independentemente de como o faz |
| **Cálculo** | Uma fórmula definida pelo administrador que calcula automaticamente o valor de um campo quando um card é salvo |
| **Card** | A unidade básica de informação no Turbo EA representando qualquer componente de arquitetura |
| **Tipo de Card** | A categoria à qual um card pertence (ex.: Aplicação, Processo de Negócio, Organização) |
| **Pontuação de Confiança** | Uma classificação de 0–100% indicando o quão confiável é uma descrição gerada por IA |
| **Qualidade de Dados** | Uma pontuação de completude de 0–100% baseada nos campos preenchidos e seus pesos configurados |
| **Anexo de arquivo** | Um arquivo binário (PDF, DOCX, XLSX, imagens, até 10 MB) carregado diretamente em um card pela aba Recursos |
| **Diagrama** | Um diagrama visual de arquitetura criado com o editor DrawIO integrado |
| **DrawIO** | A ferramenta de diagramação de código aberto integrada, utilizada para diagramas visuais de arquitetura |
| **Arquitetura Empresarial (EA)** | A disciplina que organiza e documenta a estrutura de negócios e tecnologia de uma organização |
| **EOL (End of Life)** | A data em que um produto tecnológico perde o suporte do fornecedor. Rastreado via integração com endoflife.date |
| **Iniciativa** | Um projeto ou programa envolvendo mudanças na arquitetura |
| **Ciclo de Vida** | As cinco fases pelas quais um componente passa: Planejamento, Implantação, Ativo, Desativação, Fim de Vida |
| **LLM** | Large Language Model (Modelo de Linguagem de Grande Escala) — um modelo de IA que gera texto (ex.: Ollama, OpenAI, Anthropic Claude, Google Gemini) |
| **MCP** | Model Context Protocol — um padrão aberto que permite que ferramentas de IA (Claude, Copilot, Cursor) se conectem a fontes de dados externas. O servidor MCP integrado do Turbo EA fornece acesso somente leitura aos dados de EA com RBAC por usuário |
| **Metamodelo** | O modelo orientado a dados que define a estrutura da plataforma: tipos de card, campos, relações e papéis |
| **Notificação** | Um alerta no aplicativo ou por e-mail disparado por eventos do sistema (tarefa atribuída, card atualizado, comentário adicionado, etc.) |
| **Ollama** | Uma ferramenta de código aberto para executar LLMs localmente em seu próprio hardware |
| **Portfólio** | Uma coleção de aplicações ou tecnologias gerenciadas como um grupo |
| **Número de referência** | Um identificador sequencial gerado automaticamente para ADRs (ex.: ADR-001, ADR-002) que fornece um rótulo único e legível |
| **Relacionamento** | Uma conexão entre dois cards que descreve como eles se relacionam (ex.: "utiliza", "depende de", "executa em") |
| **Aba Recursos** | Uma aba na página de detalhes do card que consolida Decisões de Arquitetura, anexos de arquivo e links de documentos em um só lugar |
| **Revisão (ADR)** | Uma nova versão de um ADR assinado que herda o conteúdo e os vínculos de cards da versão anterior, com um número de revisão incrementado |
| **Relatório Salvo** | Uma configuração de relatório persistida com filtros, eixos e configurações de visualização que pode ser recarregada |
| **Seção** | Uma área agrupável da página de detalhes do card contendo campos relacionados, configurável por tipo de card |
| **Signatário** | Um usuário designado para revisar e assinar um documento ADR ou SoAW. O fluxo de assinatura rastreia as assinaturas pendentes e concluídas |
| **SoAW** | Statement of Architecture Work — um documento formal TOGAF que define o escopo e as entregas de uma iniciativa |
| **SSO** | Single Sign-On — login usando credenciais corporativas por meio de um provedor de identidade (Microsoft, Google, Okta, OIDC) |
| **Stakeholder** | Uma pessoa com um papel específico em um card (ex.: Proprietário da Aplicação, Proprietário Técnico) |
| **Pesquisa** | Um questionário de manutenção de dados direcionado a tipos de card específicos para coletar informações dos stakeholders |
| **Tag / Grupo de Tags** | Um rótulo de classificação organizado em grupos com modos de seleção única ou múltipla |
| **TOGAF** | The Open Group Architecture Framework — uma metodologia de EA amplamente utilizada. O recurso SoAW do Turbo EA é alinhado com o TOGAF |
| **Portal Web** | Uma visualização pública e somente leitura de cards selecionados, acessível sem autenticação por meio de uma URL única |
| **Sugestão de IA** | Uma descrição de card gerada automaticamente produzida pela combinação de resultados de pesquisa na web com um Large Language Model (LLM) |
