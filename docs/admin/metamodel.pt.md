# Metamodelo

O **Metamodelo** define toda a estrutura de dados da sua plataforma — quais tipos de cards existem, quais campos possuem, como se relacionam entre si e como as páginas de detalhe dos cards são estruturadas. Tudo é **orientado a dados**: você configura o metamodelo através da interface de administração, não alterando código.

![Configuração do Metamodelo](../assets/img/en/20_admin_metamodel.png)

Navegue até **Admin > Metamodelo** para acessar o editor do metamodelo. Ele possui seis abas: **Tipos de Card**, **Tipos de Relacionamento**, **Cálculos**, **Princípios EA**, **Tags** e **Grafo do Metamodelo**.

## Tipos de Card

A aba de Tipos de Card lista todos os tipos no sistema. O Turbo EA vem com 14 tipos incorporados em quatro camadas de arquitetura:

| Camada | Tipos |
|--------|-------|
| **Estratégia e Transformação** | Objetivo, Plataforma, Iniciativa |
| **Arquitetura de Negócio** | Organização, Capacidade de Negócio, Contexto de Negócio, Processo de Negócio |
| **Aplicação e Dados** | Aplicação, Interface, Objeto de Dados |
| **Arquitetura Técnica** | Componente de TI, Categoria Tecnológica, Fornecedor, Sistema |

### Criando um Tipo Personalizado

Clique em **+ Novo Tipo** para criar um tipo de card personalizado. Configure:

| Campo | Descrição |
|-------|-----------|
| **Chave** | Identificador único (minúsculas, sem espaços) — não pode ser alterado após a criação |
| **Rótulo** | Nome de exibição mostrado na interface |
| **Ícone** | Nome do ícone Google Material Symbol |
| **Cor** | Cor da marca para o tipo (usada no inventário, relatórios e diagramas) |
| **Categoria** | Agrupamento por camada de arquitetura |
| **Possui Hierarquia** | Se cards deste tipo podem ter relacionamentos pai/filho |

### Editando um Tipo

Clique em qualquer tipo para abrir o **Painel de Detalhe do Tipo**. Aqui você pode configurar:

#### Campos

Campos definem os atributos personalizados disponíveis nos cards deste tipo. Cada campo possui:

| Configuração | Descrição |
|--------------|-----------|
| **Chave** | Identificador único do campo |
| **Rótulo** | Nome de exibição |
| **Tipo** | text, number, cost, boolean, date, url, single_select ou multiple_select |
| **Opções** | Para campos de seleção: as escolhas disponíveis com rótulos e cores opcionais |
| **Obrigatório** | Se o campo deve ser preenchido para pontuação de qualidade dos dados |
| **Peso** | Quanto este campo contribui para a pontuação de qualidade dos dados (0-10) |
| **Somente leitura** | Impede edição manual (útil para campos calculados) |

Clique em **+ Adicionar Campo** para criar um novo campo, ou clique em um campo existente para editá-lo no **Diálogo de Editor de Campo**.

#### Seções

Campos são organizados em **seções** na página de detalhe do card. Você pode:

- Criar seções nomeadas para agrupar campos relacionados
- Definir seções com layout de **1 coluna** ou **2 colunas**
- Organizar campos em **grupos** dentro de uma seção (renderizados como sub-cabeçalhos recolhíveis)
- Arrastar campos entre seções e reordená-los

O nome de seção especial `__description` adiciona campos à seção de Descrição da página de detalhe do card.

#### Subtipos (Sub-modelos)

Os subtipos atuam como **sub-modelos** dentro de um tipo de card. Cada subtipo pode controlar quais campos são visíveis para cards desse subtipo, enquanto todos os campos permanecem definidos ao nível do tipo de card.

Por exemplo, o tipo Aplicação possui subtipos: Aplicação de Negócio, Microsserviço, Agente de IA e Implantação. Um administrador poderia ocultar campos relacionados a servidores para o subtipo SaaS, pois não são relevantes.

**Configurar a visibilidade de campos por subtipo:**

1. Abra um tipo de card na administração do metamodelo.
2. Clique em qualquer chip de subtipo para abrir o diálogo **Modelo de subtipo**.
3. Ative ou desative a visibilidade dos campos usando os interruptores — campos desativados serão ocultados para cards desse subtipo.
4. Campos ocultos são excluídos da pontuação de qualidade dos dados, para que os utilizadores não sejam penalizados por campos que não podem ver.

Quando nenhum subtipo é selecionado num card (ou o tipo não possui subtipos), todos os campos são visíveis. Campos ocultos preservam os seus dados — se o subtipo de um card mudar, os valores anteriormente ocultos são mantidos.

#### Papéis de Partes Interessadas

Defina papéis personalizados para este tipo (ex.: "Proprietário da Aplicação", "Proprietário Técnico"). Cada papel carrega **permissões em nível de card** que são combinadas com o papel em nível de aplicação do usuário ao acessar um card. Veja [Usuários e Papéis](users.md) para mais informações sobre o modelo de permissões.

### Excluindo um Tipo

- **Tipos incorporados** são excluídos temporariamente (ocultos) e podem ser restaurados
- **Tipos personalizados** são excluídos permanentemente

## Tipos de Relacionamento

Tipos de relacionamento definem as conexões permitidas entre tipos de card. Cada tipo de relacionamento especifica:

| Campo | Descrição |
|-------|-----------|
| **Chave** | Identificador único |
| **Rótulo** | Rótulo da direção direta (ex.: "utiliza") |
| **Rótulo Inverso** | Rótulo da direção inversa (ex.: "é utilizado por") |
| **Tipo de Origem** | O tipo de card no lado "de" |
| **Tipo de Destino** | O tipo de card no lado "para" |
| **Cardinalidade** | n:m (muitos-para-muitos) ou 1:n (um-para-muitos) |

Clique em **+ Novo Tipo de Relacionamento** para criar um relacionamento, ou clique em um existente para editar seus rótulos e atributos.

## Cálculos

Campos calculados usam fórmulas definidas pelo administrador para computar automaticamente valores quando cards são salvos. Veja [Cálculos](calculations.md) para o guia completo.

## Tags

Grupos de tags e tags podem ser gerenciados a partir desta aba. Veja [Tags](tags.md) para o guia completo.

## Princípios EA

O separador **Princípios EA** permite definir os princípios de arquitetura que governam o panorama de TI da sua organização. Estes princípios servem como guardrails estratégicos — por exemplo, «Reutilizar antes de comprar antes de construir» ou «Se compramos, compramos SaaS».

Cada princípio tem quatro campos:

| Campo | Descrição |
|-------|-----------|
| **Título** | Um nome conciso para o princípio |
| **Enunciado** | O que o princípio estabelece |
| **Justificação** | Porque é que este princípio é importante |
| **Implicações** | Consequências práticas de seguir o princípio |

Os princípios podem ser **ativados** ou **desativados** individualmente através do interruptor em cada cartão.

### Como os princípios influenciam os insights de IA

Quando gera **Insights IA do portfólio** no [Relatório de portfólio](../guide/reports.md#ai-portfolio-insights), todos os princípios ativos são incluídos na análise. A IA avalia os dados do seu portfólio em relação a cada princípio e reporta:

- Se o portfólio **está alinhado** ou **viola** o princípio
- Pontos de dados específicos como evidência
- Ações corretivas recomendadas

Por exemplo, um princípio «Comprar SaaS» faria com que a IA sinalize aplicações alojadas on-premise ou em IaaS e sugira prioridades de migração para a cloud.

## Grafo do Metamodelo

A aba **Grafo do Metamodelo** mostra um diagrama visual SVG de todos os tipos de card e seus tipos de relacionamento. Esta é uma visualização somente leitura que ajuda você a entender as conexões no seu metamodelo de forma rápida.

## Editor de Layout de Card

Para cada tipo de card, a seção **Layout** no painel do tipo controla como a página de detalhe do card é estruturada:

- **Ordem das seções** — Arraste seções (Descrição, EOL, Ciclo de Vida, Hierarquia, Relacionamentos e seções personalizadas) para reordená-las
- **Visibilidade** — Oculte seções que não são relevantes para um tipo
- **Expansão padrão** — Escolha se cada seção começa expandida ou recolhida
- **Layout de colunas** — Defina 1 ou 2 colunas por seção personalizada
