# ArchLens — Inteligência de IA

O módulo **ArchLens** fornece análise baseada em IA do seu panorama de arquitetura empresarial. Utiliza o fornecedor de IA configurado para efetuar análise de fornecedores, deteção de duplicados, avaliação de modernização e recomendações de arquitetura.

!!! note
    O ArchLens requer um fornecedor de IA comercial (Anthropic Claude, OpenAI, DeepSeek ou Google Gemini) configurado nas [Definições de IA](../admin/ai.md). O módulo fica automaticamente disponível quando a IA está configurada.

!!! info "Créditos"
    O ArchLens baseia-se no projeto open-source [ArchLens](https://github.com/vinod-ea/archlens) de [Vinod](https://github.com/vinod-ea), publicado sob a licença MIT. A lógica de análise foi portada de Node.js para Python e integrada nativamente no Turbo EA.

## Painel

O painel do ArchLens fornece uma visão geral instantânea da análise do seu panorama.

![Painel ArchLens](../assets/img/pt/48_archlens_painel.png)

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

![Análise de Fornecedores](../assets/img/pt/49_archlens_fornecedores.png)

**Como utilizar:**

1. Navegue até **ArchLens > Fornecedores**
2. Clique em **Executar Análise**
3. A IA processa o seu portfólio de fornecedores em lotes, categorizando cada fornecedor com justificação
4. Os resultados mostram uma distribuição por categoria e uma tabela detalhada de fornecedores

Cada entrada de fornecedor inclui a categoria, subcategoria, número de aplicações associadas, custo anual total e a justificação da IA para a categorização. Alterne entre as vistas de grelha e tabela utilizando o seletor de vista.

## Resolução de Fornecedores

A resolução de fornecedores constrói uma hierarquia canónica de fornecedores, resolvendo aliases e identificando relações pai-filho.

![Resolução de Fornecedores](../assets/img/pt/50_archlens_resolucao.png)

**Como utilizar:**

1. Navegue até **ArchLens > Resolução**
2. Clique em **Resolver Fornecedores**
3. A IA identifica aliases de fornecedores (por exemplo, «MSFT» = «Microsoft»), empresas-mãe e agrupamentos de produtos
4. Os resultados mostram a hierarquia resolvida com pontuações de confiança

A hierarquia organiza os fornecedores em quatro níveis: fornecedor, produto, plataforma e módulo. Cada entrada mostra o número de aplicações e componentes de TI associados, o custo total e uma percentagem de confiança.

## Deteção de Duplicados

A deteção de duplicados identifica sobreposições funcionais no seu portfólio — cards que servem o mesmo propósito de negócio ou um propósito semelhante.

![Deteção de Duplicados](../assets/img/pt/51_archlens_duplicados.png)

**Como utilizar:**

1. Navegue até **ArchLens > Duplicados**
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

1. Navegue até **ArchLens > Duplicados** (separador Modernização)
2. Selecione um tipo de card alvo (Application, IT Component ou Interface)
3. Clique em **Avaliar Modernização**
4. Os resultados mostram cada card com o tipo de modernização, recomendação, nível de esforço (baixo/médio/alto) e prioridade (baixa/média/alta/crítica)

Os resultados são agrupados por prioridade para que possa focar-se primeiro nas oportunidades de modernização mais impactantes.

## Architecture AI

O Architecture AI é um assistente guiado em 5 etapas que gera recomendações de arquitetura com base no seu panorama existente. Liga os seus objetivos de negócio e capacidades a propostas de solução concretas, análise de lacunas, mapeamento de dependências e um diagrama de arquitetura alvo.

![Architecture AI](../assets/img/pt/52_archlens_arquiteto.png)

Um indicador de progresso no topo acompanha o seu avanço pelas cinco etapas: Requisitos, Adequação ao Negócio, Adequação Técnica, Solução e Arquitetura Alvo. O seu progresso é guardado automaticamente na sessão do navegador, pelo que pode navegar para outra página e regressar sem perder o trabalho. Clique em **Nova Avaliação** para iniciar uma nova análise a qualquer momento.

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

Clique em **Selecionar** na opção que pretende prosseguir.

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

### Guardar e confirmar

Após revisar a arquitetura-alvo, tem duas opções:

**Guardar avaliação** — Guarda a avaliação para revisão posterior através do separador «Avaliações». As avaliações guardadas podem ser consultadas por qualquer utilizador com a permissão `archlens.view`.

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

Clique em **Escolher Diferente** para selecionar uma opção de solução diferente. Os resultados são recalculados e guardados com dados atualizados, permitindo comparar abordagens antes de confirmar.

## Histórico de Análises

Todas as execuções de análise são registadas em **ArchLens > Histórico**, mostrando:

![Histórico de Análises](../assets/img/pt/53_archlens_historico.png)

- Tipo de análise (análise de fornecedores, resolução de fornecedores, deteção de duplicados, modernização, arquiteto)
- Estado (em execução, concluída, com falha)
- Timestamps de início e de conclusão
- Mensagens de erro (se existirem)

## Permissões

| Permissão | Descrição |
|-----------|-----------|
| `archlens.view` | Ver resultados de análise (concedida a admin, bpm_admin, member) |
| `archlens.manage` | Acionar análises (concedida a admin) |
