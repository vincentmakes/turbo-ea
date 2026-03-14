# ArchLens Inteligência Artificial

O módulo **ArchLens** fornece análises impulsionadas por IA da sua paisagem de arquitetura empresarial. Ele utiliza o seu provedor de IA configurado para realizar análises de fornecedores, detecção de duplicados, avaliação de modernização e recomendações de arquitetura.

!!! note
    O ArchLens requer um provedor de IA comercial (Anthropic Claude, OpenAI, DeepSeek ou Google Gemini) configurado nas [Configurações de IA](../admin/ai.md). O módulo está automaticamente disponível quando a IA está configurada.

!!! info "Credits"
    O ArchLens é baseado no projeto de código aberto [ArchLens](https://github.com/vinod-ea/archlens) de [Vinod](https://github.com/vinod-ea), publicado sob a licença MIT. A lógica de análise foi portada de Node.js para Python e integrada nativamente no Turbo EA.

## Painel de controlo

O painel de controlo do ArchLens fornece uma visão geral da sua análise de paisagem:

| Indicador | Descrição |
|-----------|-------------|
| **Total de cartões** | Número de cartões ativos no seu portfólio |
| **Qualidade média** | Pontuação média de qualidade de dados em todos os cartões |
| **Fornecedores** | Número de fornecedores de tecnologia analisados |
| **Clusters de duplicados** | Número de grupos de duplicados identificados |
| **Modernizações** | Número de oportunidades de modernização encontradas |

O painel de controlo também mostra cartões agrupados por tipo e destaca os principais problemas de qualidade.

## Análise de fornecedores

A análise de fornecedores utiliza IA para categorizar os seus fornecedores de tecnologia em mais de 45 categorias industriais (por exemplo, CRM, ERP, infraestrutura cloud, segurança).

**Como utilizar:**

1. Navegue até **ArchLens > Fornecedores**
2. Clique em **Executar análise**
3. A IA processa o seu portfólio de fornecedores em lotes, categorizando cada fornecedor com fundamentação
4. Os resultados mostram uma divisão por categorias e uma tabela detalhada de fornecedores

Cada entrada de fornecedor inclui a categoria, subcategoria, número de aplicações associadas, custo anual total e a fundamentação da IA para a categorização.

## Resolução de fornecedores

A resolução de fornecedores constrói uma hierarquia canónica de fornecedores resolvendo aliases e identificando relações pai-filho.

**Como utilizar:**

1. Navegue até **ArchLens > Resolução**
2. Clique em **Resolver fornecedores**
3. A IA identifica aliases de fornecedores (por exemplo, «MSFT» = «Microsoft»), empresas-mãe e agrupamentos de produtos
4. Os resultados mostram a hierarquia resolvida com pontuações de confiança

## Detecção de duplicados

A detecção de duplicados identifica sobreposições funcionais no seu portfólio — cartões que servem o mesmo ou um propósito de negócio semelhante.

**Como utilizar:**

1. Navegue até **ArchLens > Duplicados**
2. Clique em **Detetar duplicados**
3. A IA analisa cartões de Application, IT Component e Interface em lotes
4. Os resultados mostram clusters de potenciais duplicados com evidências e recomendações

Para cada cluster, pode:

- **Confirmar** — Marcar o duplicado como confirmado para acompanhamento
- **Investigar** — Sinalizar para investigação adicional
- **Descartar** — Descartar se não for um duplicado real

## Avaliação de modernização

A avaliação de modernização avalia cartões para oportunidades de atualização com base nas tendências tecnológicas atuais.

**Como utilizar:**

1. Navegue até **ArchLens > Duplicados** (secção Modernização)
2. Selecione um tipo de cartão alvo (Application, IT Component ou Interface)
3. Clique em **Avaliar modernização**
4. Os resultados mostram cada cartão com tipo de modernização, recomendação, nível de esforço e prioridade

## Architecture AI

A Architecture AI é um assistente conversacional de 3 fases que gera recomendações de arquitetura com base na sua paisagem existente.

**Como utilizar:**

1. Navegue até **ArchLens > Arquiteto**
2. **Fase 1** — Descreva o seu requisito de negócio (por exemplo, «Precisamos de um portal de autoatendimento para clientes»). A IA gera perguntas de clarificação de negócio.
3. **Fase 2** — Responda às perguntas da Fase 1. A IA gera perguntas de aprofundamento técnico.
4. **Fase 3** — Responda às perguntas da Fase 2. A IA gera uma recomendação de arquitetura completa que inclui:

| Secção | Descrição |
|--------|-------------|
| **Diagrama de arquitetura** | Diagrama Mermaid interativo com zoom, download SVG e cópia de código |
| **Camadas de componentes** | Organizadas por camada de arquitetura com classificação existente/novo/recomendado |
| **Lacunas e recomendações** | Lacunas de capacidade com recomendações de produtos de mercado classificadas por adequação |
| **Integrações** | Mapa de integração mostrando fluxos de dados, protocolos e direções |
| **Riscos e próximos passos** | Avaliação de riscos com mitigações e passos de implementação priorizados |

## Histórico de análises

Todas as execuções de análise são registadas em **ArchLens > Histórico**, mostrando:

- Tipo de análise (análise de fornecedores, resolução de fornecedores, detecção de duplicados, modernização, arquiteto)
- Estado (em execução, concluído, falhado)
- Carimbos temporais de início e conclusão
- Mensagens de erro (se existirem)

## Permissões

| Permissão | Descrição |
|-----------|-------------|
| `archlens.view` | Ver resultados de análise (concedido a admin, bpm_admin, member) |
| `archlens.manage` | Executar análises (concedido a admin) |
