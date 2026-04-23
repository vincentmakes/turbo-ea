# TurboLens — Inteligência de IA

O módulo **TurboLens** fornece análise baseada em IA do seu panorama de arquitetura empresarial. Utiliza o fornecedor de IA configurado para efetuar análise de fornecedores, deteção de duplicados, avaliação de modernização e recomendações de arquitetura.

!!! note
    O TurboLens requer um fornecedor de IA comercial (Anthropic Claude, OpenAI, DeepSeek ou Google Gemini) configurado nas [Definições de IA](../admin/ai.md). O módulo fica automaticamente disponível quando a IA está configurada.

!!! info "Créditos"
    O TurboLens baseia-se no projeto open-source [ArchLens](https://github.com/vinod-ea/archlens) de [Vinod](https://github.com/vinod-ea), publicado sob a licença MIT. A lógica de análise foi portada de Node.js para Python e integrada nativamente no Turbo EA.

## Painel

O painel do TurboLens fornece uma visão geral instantânea da análise do seu panorama.

| Indicador | Descrição |
|-----------|-----------|
| **Total de Cards** | Número de cards ativos no seu portfólio |
| **Qualidade Média** | Pontuação média de qualidade de dados em todos os cards |
| **Fornecedores** | Número de fornecedores tecnológicos analisados |
| **Clusters de Duplicados** | Número de grupos de duplicados identificados |
| **Modernizações** | Número de oportunidades de modernização encontradas |
| **Custo Anual** | Custo anual total em todos os cards |

O painel mostra também:

- **Cards por tipo** — Distribuição das contagens de cards por tipo de card
- **Distribuição de qualidade de dados** — Cards agrupados nos níveis Bronze (<50%), Silver (50–80%) e Gold (>80%)
- **Principais problemas de qualidade** — Cards com as pontuações de qualidade de dados mais baixas, com ligações diretas para cada card

## Análise de Fornecedores

A análise de fornecedores utiliza IA para categorizar os seus fornecedores tecnológicos em mais de 45 categorias do setor (por exemplo, CRM, ERP, Infraestrutura Cloud, Segurança).

**Como utilizar:**

1. Navegue até **TurboLens > Fornecedores**
2. Clique em **Executar Análise**
3. A IA processa o seu portfólio de fornecedores em lotes, categorizando cada fornecedor com justificação
4. Os resultados mostram uma distribuição por categoria e uma tabela detalhada de fornecedores

Cada entrada de fornecedor inclui a categoria, subcategoria, número de aplicações associadas, custo anual total e a justificação da IA para a categorização. Alterne entre as vistas de grelha e tabela utilizando o seletor de vista.

## Resolução de Fornecedores

A resolução de fornecedores constrói uma hierarquia canónica de fornecedores, resolvendo aliases e identificando relações pai-filho.

**Como utilizar:**

1. Navegue até **TurboLens > Resolução**
2. Clique em **Resolver Fornecedores**
3. A IA identifica aliases de fornecedores (por exemplo, «MSFT» = «Microsoft»), empresas-mãe e agrupamentos de produtos
4. Os resultados mostram a hierarquia resolvida com pontuações de confiança

A hierarquia organiza os fornecedores em quatro níveis: fornecedor, produto, plataforma e módulo. Cada entrada mostra o número de aplicações e componentes de TI associados, o custo total e uma percentagem de confiança.

## Deteção de Duplicados

A deteção de duplicados identifica sobreposições funcionais no seu portfólio — cards que servem o mesmo propósito de negócio ou um propósito semelhante.

**Como utilizar:**

1. Navegue até **TurboLens > Duplicados**
2. Clique em **Detetar Duplicados**
3. A IA analisa cards de Application, IT Component e Interface em lotes
4. Os resultados mostram clusters de potenciais duplicados com evidências e recomendações

Para cada cluster, pode:

- **Confirmar** — Marcar o duplicado como confirmado para acompanhamento
- **Investigar** — Sinalizar para investigação adicional
- **Dispensar** — Dispensar caso não seja um duplicado real

## Avaliação de Modernização

A avaliação de modernização avalia cards quanto a oportunidades de atualização com base nas tendências tecnológicas atuais.

**Como utilizar:**

1. Navegue até **TurboLens > Duplicados** (separador Modernização)
2. Selecione um tipo de card alvo (Application, IT Component ou Interface)
3. Clique em **Avaliar Modernização**
4. Os resultados mostram cada card com o tipo de modernização, recomendação, nível de esforço (baixo/médio/alto) e prioridade (baixa/média/alta/crítica)

Os resultados são agrupados por prioridade para que possa focar-se primeiro nas oportunidades de modernização mais impactantes.

## Architecture AI

O Architecture AI é um assistente guiado em 5 etapas que gera recomendações de arquitetura com base no seu panorama existente. Liga os seus objetivos de negócio e capacidades a propostas de solução concretas, análise de lacunas, mapeamento de dependências e um diagrama de arquitetura alvo.

<div style="text-align: center;">
<iframe width="560" height="315" src="https://www.youtube.com/embed/FDneDl0ULsA" title="Visão geral do Architecture AI" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
</div>

Um indicador de progresso no topo acompanha o seu avanço pelas cinco etapas: Requisitos, Adequação ao Negócio, Adequação Técnica, Solução e Arquitetura Alvo. Pode clicar em qualquer etapa anteriormente alcançada para navegar para trás e rever fases anteriores — todos os dados subsequentes são preservados e só são eliminados quando volta a submeter ativamente uma fase. O seu progresso é guardado automaticamente na sessão do navegador, pelo que pode navegar para outra página e regressar sem perder o trabalho. Também pode guardar avaliações na base de dados e retomá-las mais tarde (consulte [Guardar e retomar](#guardar--retomar) abaixo). Clique em **Nova Avaliação** para iniciar uma nova análise a qualquer momento.

### Etapa 1: Requisitos

Introduza o seu requisito de negócio em linguagem natural (por exemplo, «Precisamos de um portal de self-service para clientes»). De seguida:

- **Selecione Objetivos de Negócio** — Escolha um ou mais cards de Objetivo existentes no menu de preenchimento automático. Isto ancora a análise da IA nos seus objetivos estratégicos. É necessário pelo menos um objetivo.
- **Selecione Business Capabilities** (opcional) — Escolha cards de Business Capability existentes ou escreva novos nomes de capacidades. As novas capacidades aparecem como chips azuis com a etiqueta «NOVO: nome». Isto ajuda a IA a focar-se em áreas de capacidade específicas.

Clique em **Gerar Perguntas** para continuar.

### Etapa 2: Adequação ao Negócio (Fase 1)

A IA gera perguntas de clarificação de negócio adaptadas ao seu requisito e aos objetivos selecionados. As perguntas surgem em diferentes tipos:

- **Texto** — Campos de resposta de forma livre
- **Escolha única** — Clique num chip de opção para selecionar
- **Escolha múltipla** — Clique em vários chips de opção; pode também escrever uma resposta personalizada e premir Enter

Cada pergunta pode incluir contexto que explica por que motivo a IA está a perguntar (nota de «Impacto»). Responda a todas as perguntas e clique em **Submeter** para avançar para a Fase 2.

### Etapa 3: Adequação Técnica (Fase 2)

A IA gera perguntas de aprofundamento técnico com base nas suas respostas da Fase 1. Estas podem incluir categorias NFR (requisitos não funcionais) como desempenho, segurança ou escalabilidade. Responda a todas as perguntas e clique em **Analisar Capacidades** para gerar opções de solução.

### Etapa 4: Solução (Fase 3)

Esta etapa tem três subfases:

#### 3a: Opções de Solução

A IA gera múltiplas opções de solução, cada uma apresentada como um card com:

| Elemento | Descrição |
|----------|-----------|
| **Abordagem** | Comprar, Construir, Estender ou Reutilizar — chip com código de cores |
| **Resumo** | Breve descrição da abordagem |
| **Prós e Contras** | Principais vantagens e desvantagens |
| **Estimativas** | Custo, duração e complexidade estimados |
| **Pré-visualização do Impacto** | Novos componentes, componentes modificados, componentes retirados e novas integrações que esta opção introduziria |

Clique em **Selecionar** na opção que pretende prosseguir. Se regressar a esta etapa após selecionar uma opção, a opção anteriormente escolhida é visualmente realçada com uma moldura e um distintivo «Selecionado» para que possa identificar facilmente a sua escolha atual.

#### 3b: Análise de Lacunas

Após selecionar uma opção, a IA identifica lacunas de capacidade no seu panorama atual. Cada lacuna mostra:

- **Nome da capacidade** com nível de urgência (crítico/alto/médio)
- **Descrição do impacto** explicando por que esta lacuna é relevante
- **Recomendações de mercado** — Recomendações de produtos ordenadas (ouro nº 1, prata nº 2, bronze nº 3) com fornecedor, justificação, prós/contras, custo estimado e esforço de integração

Selecione os produtos que pretende incluir clicando nos cards de recomendação (surgem caixas de verificação). Clique em **Analisar Dependências** para continuar.

#### 3c: Análise de Dependências

Após selecionar os produtos, a IA identifica dependências adicionais de infraestrutura, plataforma ou middleware exigidas pelas suas seleções. Cada dependência mostra:

- **Necessidade** com nível de urgência
- **Motivo** explicando por que esta dependência é necessária
- **Opções** — Produtos alternativos para satisfazer a dependência, com o mesmo nível de detalhe das recomendações de lacunas

Selecione as dependências e clique em **Gerar Mapa de Capacidades** para produzir a arquitetura alvo final.

### Etapa 5: Arquitetura Alvo

A etapa final gera um mapeamento de capacidades abrangente:

| Secção | Descrição |
|--------|-----------|
| **Resumo** | Narrativa de alto nível da arquitetura proposta |
| **Capacidades** | Lista de Business Capabilities correspondentes — as existentes (verde) e as recentemente propostas (azul) |
| **Cards Propostos** | Novos cards a criar no seu panorama, mostrados com os respetivos ícones de tipo de card e subtipos |
| **Relações Propostas** | Ligações entre cards propostos e elementos do panorama existente |
| **Diagrama de Dependências** | Diagrama C4 interativo que mostra nós existentes ao lado de nós propostos (bordas tracejadas com distintivo verde «NOVO»). Mova, aproxime e explore a arquitetura visualmente |

Nesta etapa, pode clicar em **Escolher Diferente** para voltar atrás e selecionar uma opção de solução diferente, ou **Recomeçar** para iniciar uma avaliação completamente nova.

!!! warning "Avaliação assistida por IA"
    Esta avaliação utiliza IA para gerar recomendações, opções de solução e uma arquitetura-alvo. Deve ser realizada por um profissional de TI qualificado (arquiteto empresarial, arquiteto de soluções, líder de TI) em colaboração com as partes interessadas do negócio. Os resultados gerados requerem julgamento profissional e podem conter imprecisões. Utilize os resultados como ponto de partida para discussões e refinamentos posteriores.

### Guardar e retomar

Após revisar a arquitetura-alvo, pode guardar ou confirmar o seu trabalho:

**Guardar avaliação** — Guarda um snapshot completo da avaliação (todas as respostas, opções selecionadas, análise de lacunas, dependências e arquitetura-alvo) na base de dados. As avaliações guardadas aparecem no separador **Avaliações**.

**Retomar uma avaliação guardada** — As avaliações não confirmadas podem ser reabertas no assistente interativo com o estado completamente restaurado:

- No separador **Avaliações**, clique no botão **Retomar** em qualquer linha de avaliação guardada
- No **Visualizador de avaliação** em modo de leitura, clique em **Retomar** no cabeçalho
- O assistente restaura a fase e o estado exatos onde parou, incluindo todas as perguntas geradas pela IA, as suas respostas, opções selecionadas e seleções de produtos
- Pode continuar de onde parou, escolher uma abordagem diferente ou confirmar para criar uma iniciativa
- Guardar novamente atualiza a avaliação existente (em vez de criar uma nova)

!!! tip "Snapshot completo"
    Uma avaliação guardada é um snapshot completo da sua sessão do assistente. Enquanto não tiver sido confirmada numa iniciativa, pode retomá-la, escolher uma abordagem de solução diferente e voltar a guardá-la tantas vezes quantas necessário.

**Confirmar e criar iniciativa** — Converte a proposta de arquitetura em cards reais no seu panorama:

- **Nome da iniciativa** é pré-preenchido com o título da opção de solução selecionada (editável antes da criação)
- **Datas de início/fim** para o cronograma da iniciativa
- **Novos cards propostos** com interruptores para incluir ou excluir cards individuais, e ícones de edição para renomear cards antes da criação. Esta lista inclui novas Business Capabilities identificadas durante a avaliação.
- **Relações propostas** com interruptores para incluir ou excluir
- Um indicador de progresso mostra o estado de criação (iniciativa → cards → relações → ADR)
- Em caso de sucesso, um link abre o novo card de Iniciativa

### Salvaguardas arquitetónicas

O sistema garante automaticamente a integridade arquitetónica:

- Cada nova aplicação é ligada a pelo menos uma Business Capability
- Cada nova Business Capability é ligada aos objetivos de negócio selecionados
- Cards sem relações (órfãos) são automaticamente removidos da proposta

### Architecture Decision Record

Um rascunho de ADR é criado automaticamente juntamente com a iniciativa com:

- **Contexto** do resumo do mapeamento de capacidades
- **Decisão** capturando a abordagem e os produtos selecionados
- **Alternativas consideradas** das opções de solução não selecionadas

### Mudar abordagem

Clique em **Escolher Diferente** para regressar às opções de solução e selecionar uma abordagem diferente. Todas as suas respostas da Fase 1 e Fase 2 são preservadas — apenas os dados subsequentes (análise de lacunas, dependências, arquitetura-alvo) são repostos. Após selecionar uma nova opção, o assistente prossegue novamente pela análise de lacunas e análise de dependências. Pode guardar a avaliação atualizada ou confirmar quando estiver pronto.

## Segurança e Conformidade

O separador **Segurança e Conformidade** executa uma análise a pedido sobre o panorama atual e produz um relatório de risco conforme a padrões além de uma análise de lacunas regulatórias.

### O que é analisado

- **CVEs** — cada Aplicação e Componente de TI não arquivado é pesquisado na [NIST National Vulnerability Database](https://nvd.nist.gov/) usando os atributos `vendor`, `productName` / `version` do card. Os resultados são contextualizados por uma passagem de IA que classifica **prioridade** (crítica / alta / média / baixa) e **probabilidade** (muito alta / alta / média / baixa) a partir da criticidade de negócio, fase do ciclo de vida, vetor de ataque, explorabilidade e disponibilidade de correção.
- **Conformidade** — o mesmo panorama é verificado pelo LLM configurado contra **Lei da IA da UE**, **RGPD**, **NIS2**, **DORA**, **SOC 2** e **ISO/IEC 27001**. Cada regulação tem a sua própria lista de verificação; os achados são **específicos de um card** (um card concreto é a origem da lacuna) ou **transversais ao panorama** (problema sistémico).

### Executar uma análise

Só utilizadores com `security_compliance.manage` podem disparar análises (admin por omissão). O separador Visão Geral mostra **dois cartões de análise independentes**:

- **Análise de CVE** — consulta o NVD + priorização por IA. Pode ser relançada à vontade; os achados de conformidade permanecem intactos.
- **Análise de conformidade** — análise de lacunas por IA sobre as regulações escolhidas. Substitui os achados de conformidade para as regulações incluídas nesta execução.

Cada análise apresenta uma barra de progresso por fases (carregar cards → consultar NVD → priorização por IA → guardar, ou carregar cards → deteção semântica de IA → verificação por regulação). Ambas podem correr em paralelo.

Atualizar a página **não interrompe uma análise em curso** — a tarefa em segundo plano continua no servidor, e a interface volta a ligar-se automaticamente à sondagem de progresso ao recarregar.

### Estrutura do relatório de risco

- **Visão Geral** — barra de KPI (total de achados, contagens crítico / alto / médio, pontuação global de conformidade), uma **matriz de risco probabilidade × severidade** 5×5, os cinco principais achados críticos e um mapa de calor compacto de conformidade com navegação para o detalhe. A matriz é **clicável**: clicar numa célula abre o sub-separador CVE filtrado nesse compartimento, com um chip descartável acima da tabela para ver (e limpar) o filtro ativo.
- **CVEs** — tabela filtrável com card, ID do CVE (ligado à página de detalhe do NVD), pontuação base CVSS, severidade, prioridade, probabilidade, disponibilidade de correção e estado. Cada linha abre um painel de detalhe com a descrição, vetor CVSS, vetor de ataque, pontuações de explorabilidade / impacto, referências, impacto de negócio e remediação gerados por IA, e uma barra de ações de estado (**Reconhecer → Marcar em andamento → Marcar como mitigado / Aceitar risco / Reabrir**).
- **Conformidade** — um separador por regulação com pontuação global e uma lista em estilo cartão mostrando estado, artigo, categoria, requisito, descrição da lacuna, remediação e evidências. Um pequeno chip **Detetado por IA** destaca cards assinalados como portadores de IA pelo detetor semântico, mesmo que não estejam marcados como subtipos de IA.
- **Exportar CSV** — transfere os achados CVE numa ordem de colunas ao estilo OWASP/NIST (Card, Tipo, CVE, CVSS, Severidade, Vetor de ataque, Probabilidade, Prioridade, Correção, Publicado, Última modificação, Estado, Fornecedor, Produto, Versão, Impacto de negócio, Remediação, Descrição).

### Promover um achado para o Registo de Riscos

Cada painel CVE e cada cartão de achado de conformidade inclui uma ação primária **Criar risco**. Clicá-la abre o diálogo partilhado de criação de risco com título, descrição, categoria, probabilidade, impacto, mitigação e card afetado **pré-preenchidos a partir do achado**. Pode editar qualquer campo antes de submeter, atribuir um **proprietário** e escolher uma **data-alvo de resolução**. Ao submeter, a linha do achado passa a **Abrir risco R-000123** para manter o link visível — as promoções são idempotentes no servidor. Veja o [Registo de Riscos](risks.md) para o ciclo de vida completo alinhado com TOGAF e como a atribuição do proprietário cria um Todo de acompanhamento + notificação no sino.

### Deteção semântica da Lei da IA da UE

As funcionalidades de IA estão frequentemente embutidas em aplicações de uso geral. A passagem da Lei da IA da UE **não se apoia apenas na filtragem por subtipo**: pede ao LLM para assinalar cada card cujo nome, descrição, fornecedor ou interfaces relacionadas sugiram capacidades de IA / ML — LLMs, motores de recomendação, visão computacional, scoring de fraude ou crédito, chatbots, analítica preditiva, deteção de anomalias. Os achados produzidos por esta passagem semântica são marcados **Detetado por IA** para os distinguir de cards já classificados como `AI Agent` / `AI Model`.

### Progresso e retoma

Cada análise escreve o progresso por fases (carregar cards → consultar NVD → priorização por IA → guardar, ou carregar cards → deteção semântica de IA → verificação por regulação) no seu registo de execução. A interface mostra uma barra de progresso em tempo real por análise. **Atualizar a página não interrompe uma análise** — a tarefa em segundo plano continua no servidor, e ao montar, o separador Segurança consulta `/turbolens/security/active-runs` e volta a ligar-se ao ciclo de sondagem.

### Chave de API do NVD (opcional)

Sem chave, o NVD só permite 5 pedidos a cada 30 segundos, o que pode tornar lentas as análises de panoramas grandes. Solicite uma chave gratuita em <https://nvd.nist.gov/developers/request-an-api-key> e configure-a através da variável de ambiente `NVD_API_KEY` para elevar o limite para 50 pedidos a cada 30 segundos.

### Fluxo de estado

Cada achado CVE percorre: **aberto** → **reconhecido** → **em andamento** → **mitigado** (ou **aceite**, quando a equipa aceitou formalmente o risco). A reabertura está sempre disponível. As mudanças de estado são da responsabilidade de utilizadores com `security_compliance.manage`. Para fluxos de governança (titularidade, avaliação residual, justificação de aceitação, Todos e notificações) promova o achado a um Risco — o ciclo completo vive no [Registo de Riscos](risks.md).

## Histórico de Análises

Todas as execuções de análise são registadas em **TurboLens > Histórico**, mostrando:

- Tipo de análise (análise de fornecedores, resolução de fornecedores, deteção de duplicados, modernização, arquiteto, security_compliance)
- Estado (em execução, concluída, com falha)
- Timestamps de início e de conclusão
- Mensagens de erro (se existirem)

## Permissões

| Permissão | Descrição |
|-----------|-----------|
| `turbolens.view` | Ver resultados de análise (concedida a admin, bpm_admin, member) |
| `turbolens.manage` | Acionar análises (concedida a admin) |
| `security_compliance.view` | Ver achados CVE e de conformidade (concedida a admin, bpm_admin, member, viewer) |
| `security_compliance.manage` | Disparar análises de segurança e atualizar o estado dos achados (concedida a admin) |
