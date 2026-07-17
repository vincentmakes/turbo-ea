# Metamodelo

O **Metamodelo** define toda a estrutura de dados da sua plataforma — quais tipos de cards existem, quais campos possuem, como se relacionam entre si e como as páginas de detalhe dos cards são estruturadas. Tudo é **orientado a dados**: você configura o metamodelo através da interface de administração, não alterando código.

![Configuração do Metamodelo](../assets/img/pt/20_admin_metamodelo.png)

Navegue até **Admin > Metamodelo** para acessar o editor do metamodelo. Ele possui sete abas: **Tipos de Card**, **Tipos de Relacionamento**, **Cálculos**, **Tags**, **Grafo do Metamodelo**, **Princípios EA** e **Regulações de Conformidade**.

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

#### Cor do tipo

Cada tipo de cartão — incluindo os nativos — tem uma cor personalizável usada no inventário, nos relatórios, nas vistas de dependências e nos diagramas. Isso permite alinhar o Turbo EA às convenções visuais da sua organização (por exemplo, paletas TOGAF/ArchiMate: elementos de negócio em amarelo/laranja, aplicações em azul).

- Escolha uma cor com a amostra de cor no painel. Um aviso aparece quando a cor escolhida tem contraste muito baixo sobre fundos claros ou escuros.
- Os tipos nativos mostram um botão de **redefinir** ao lado da amostra de cor sempre que a cor difere do padrão do Turbo EA, para que seja sempre possível voltar à paleta padrão.
- O texto exibido sobre as cores do tipo (chips, formas de diagrama) alterna automaticamente entre preto e branco para manter a legibilidade, tanto no modo claro quanto no escuro.
- O seletor mostra uma **pré-visualização ao vivo** ao lado da paleta: o nome do tipo, o chip, o ícone do cartão, o subtipo, a pílula de ID do cartão e um nó da vista de dependências, renderizados uma vez no modo claro e outra no modo escuro, atualizando-se durante a escolha.

#### Campos

Campos definem os atributos personalizados disponíveis nos cards deste tipo. Cada campo possui:

| Configuração | Descrição |
|--------------|-----------|
| **Chave** | Identificador único do campo |
| **Rótulo** | Nome de exibição |
| **Tipo** | text, multiline_text, number, cost, boolean, date, url, single_select ou multiple_select |
| **Opções** | Para campos de seleção: as escolhas disponíveis com rótulos e cores opcionais |
| **Obrigatório** | Se o campo deve ser preenchido para pontuação de qualidade dos dados |
| **Qualidade dos dados** | A contribuição de cada campo para a pontuação é gerida no painel **Qualidade dos dados** (ver abaixo) |
| **Somente leitura** | Impede edição manual (útil para campos calculados) |

Clique em **+ Adicionar Campo** para criar um novo campo, ou clique em um campo existente para editá-lo no **Diálogo de Editor de Campo**.

#### Seções

Campos são organizados em **seções** na página de detalhe do card. Você pode:

- Criar seções nomeadas para agrupar campos relacionados
- Definir seções com layout de **1 coluna** ou **2 colunas**
- Organizar campos em **grupos** dentro de uma seção (renderizados como sub-cabeçalhos recolhíveis)
- Reordenar campos dentro de uma seção arrastando-os e mover um campo para outra seção pela ação **mover**

O nome de seção especial `__description` adiciona campos à seção de Descrição da página de detalhe do card.

#### ID do cartão

Ative a **geração de ID do cartão** para atribuir aos cartões deste tipo um ID estável e legível (por exemplo `APP-00001`). O ID aparece como uma etiqueta copiável ao lado do tipo do cartão, como coluna opcional (ordenável e filtrável) no inventário, nas exportações para Excel e nas fórmulas de campos calculados (via `data.reference`).

O **número é sempre gerado automaticamente**; você só controla o **prefixo**. Ao ativar, um prefixo sugerido (derivado do nome do tipo, ex. `APP-`) é mostrado como texto — clique no lápis para alterá-lo. Duas definições ajustam o número:

- **Começar em** — o primeiro número da série (padrão `1`).
- **Dígitos mín.** — largura do preenchimento com zeros (padrão `5`), então `1` aparece como `00001`. É um mínimo; os números aumentam ao ultrapassá-lo. Um **Exemplo** mostra ao vivo o primeiro ID.

Os IDs são **globalmente únicos, somente leitura e nunca reutilizados ou alterados**. A sequência numérica é mantida **por prefixo em todo o workspace**, portanto dois tipos que partilham um prefixo formam uma única série contínua e sem colisões. Assim que um cartão deste tipo tem um ID, todo o formato — prefixo, início e dígitos mín. — fica bloqueado (os campos ficam somente leitura); ainda pode desativar a geração. Salvar nunca atribui IDs aos cartões existentes; use o botão dedicado **Gerar IDs** para preencher o backlog sob demanda (com barra de progresso e confirmação).

#### Pontuação de qualidade dos dados

A pontuação de **qualidade dos dados** de um card mede de forma ponderada o quão completo ele está. Cada fator que contribui — cada campo e cinco fatores integrados — é gerido em um único lugar: a aba **Qualidade dos dados** do editor de tipo de card. (O editor é organizado em abas — Geral, Relações, Papéis das partes interessadas e Qualidade dos dados — as traduções estão disponíveis no ícone do cabeçalho.)

A importância de cada fator é definida com um controle deslizante simples de quatro níveis, que também mostra o número subjacente:

- **Ignorar (0)** — excluído totalmente da pontuação.
- **Normal (1)** — conta uma vez (padrão).
- **Importante (2)** — conta o dobro.
- **Crítico (3)** — conta o triplo.

O painel lista os cinco **fatores integrados** — **Descrição**, **Ciclo de vida** (se alguma data de ciclo de vida estiver definida), **Relações obrigatórias**, **Etiquetas obrigatórias** e **Papéis das partes interessadas** (cada papel definido para o tipo é satisfeito quando uma parte interessada lhe é atribuída) — seguidos de cada campo agrupado pela sua seção, cada um com o mesmo controle deslizante. Por exemplo, defina o **Ciclo de vida** como *Ignorar* para um tipo cujos cards legitimamente nunca têm datas, para que não sejam penalizados.

Uma barra de **composição da pontuação** no topo do painel mostra a parcela de cada fator na pontuação máxima possível, para ver rapidamente quais fatores dominam. No layout do card da aba **Principal**, cada campo — e as seções integradas Descrição, Ciclo de vida e Relações — mostra um pequeno selo com o seu nível atual, para ver a ponderação sem sair dessa aba.

Alterar qualquer importância recalcula imediatamente a pontuação de todos os cards existentes desse tipo. Os campos novos são *Normal* por padrão, portanto contam para a pontuação assim que você os adiciona.

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

#### Traduções

Clique no botão **Traduzir** na barra de ferramentas do drawer do tipo para abrir o **Diálogo de Traduções**. Aqui você pode fornecer traduções para todos os rótulos do metamodelo em cada idioma suportado:

- **Rótulo do tipo** — O nome de exibição do tipo de card
- **Subtipos** — Rótulos para cada subtipo
- **Seções** — Cabeçalhos de seção na página de detalhe do card
- **Campos** — Rótulos de campos e rótulos de opções de seleção
- **Papéis de stakeholder** — Nomes de papéis exibidos na interface de atribuição de stakeholders

As traduções são armazenadas junto com cada tipo de card e são resolvidas no momento da renderização de acordo com o idioma selecionado pelo usuário. Rótulos não traduzidos recorrem ao padrão em inglês.

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

### Atributos de relação

Algumas relações incluem atributos adicionais que define em cada ligação individual em vez de no tipo de relação. Por exemplo, a relação integrada **Organização → Aplicação** («utiliza») tem um atributo **Tipo de utilização** — defina-o como **Proprietário**, **Utilizador** ou **Parte interessada** em cada ligação. Assim, pode modelar uma aplicação *propriedade de* uma organização e *utilizada por* outras através de um único tipo de relação. O valor escolhido aparece como um marcador colorido na secção **Relações** da carta; defina-o ao adicionar a relação ou mais tarde através do ícone de edição na linha da relação.

Só pode existir um tipo de relação entre um determinado par de tipos de carta, por isso utilize estes atributos para qualificar o significado de uma ligação em vez de criar um segundo tipo de relação para a mesma origem e destino.

### Gerir valores de relação

Clique no ícone **Gerir valores de relação** (etiqueta) numa linha de relação para editar os valores dos seus atributos de «tipo». Pode:

- **Adicionar os seus próprios valores** a um seletor existente — por exemplo, um novo Tipo de utilização para além de Proprietário / Utilizador / Parte interessada.
- **Adicionar um seletor de tipo totalmente novo** a uma relação que não tenha nenhum, através de **Adicionar tipo** — incluindo em relações integradas.

Os valores integrados (Proprietário, Utilizador, Parte interessada, os valores de direção do fluxo…) estão **bloqueados**: não podem ser renomeados, recoloridos nem eliminados. No entanto, pode **ocultar** um valor integrado para que deixe de aparecer no seletor nas cartas — um valor já definido permanece visível. Os seus próprios valores são totalmente editáveis e removíveis.

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

### Importar do Catálogo de princípios

O Turbo EA é fornecido com um **catálogo de referência curado com 10 princípios EA padrão do setor** para que não tenha de começar com uma página em branco. Abra o menu do avatar no canto superior direito e selecione **Catálogos de referência → Catálogo de princípios**. A partir daí pode:

- Pesquisar e explorar os princípios incluídos (título, descrição, justificação, implicações).
- Selecionar várias entradas e clicar em **Importar** — os princípios selecionados aparecem no separador «Princípios EA» como entradas padrão totalmente editáveis.
- Reimportar em segurança: os princípios que já existem (identificados pelo seu ID de catálogo estável) são ignorados, mesmo que os tenha renomeado localmente. O catálogo mostra um distintivo verde «Já importado» para estas entradas.

Use o catálogo como ponto de partida e, em seguida, adapte o título, a declaração, a justificação e as implicações de cada princípio à sua organização.

### Como os princípios influenciam os insights de IA

Quando gera **Insights IA do portfólio** no [Relatório de portfólio](../guide/reports.md#ai-portfolio-insights), todos os princípios ativos são incluídos na análise. A IA avalia os dados do seu portfólio em relação a cada princípio e reporta:

- Se o portfólio **está alinhado** ou **viola** o princípio
- Pontos de dados específicos como evidência
- Ações corretivas recomendadas

Por exemplo, um princípio «Comprar SaaS» faria com que a IA sinalize aplicações alojadas on-premise ou em IaaS e sugira prioridades de migração para a cloud.

## Grafo do Metamodelo

![Grafo do Metamodelo](../assets/img/pt/38_grafo_metamodelo.png)

A aba **Grafo do Metamodelo** mostra um diagrama visual SVG de todos os tipos de card e seus tipos de relacionamento. Esta é uma visualização somente leitura que ajuda você a entender as conexões no seu metamodelo de forma rápida.

## Regulações de Conformidade

A aba **Regulações de Conformidade** gerencia os frameworks regulatórios contra os quais o [scanner de Conformidade do GRC](../guide/grc.md#compliance) executa. Seis frameworks vêm habilitados por padrão:

| Regulação | Escopo |
|-----------|--------|
| **Lei da IA da UE** | Requisitos para sistemas de IA / ML colocados no mercado da UE |
| **GDPR** | Regulamento Geral de Proteção de Dados da UE |
| **NIS2** | Diretiva 2 da UE sobre segurança de redes e sistemas de informação |
| **DORA** | Regulamento europeu de resiliência operacional digital para entidades financeiras |
| **SOC 2** | Critérios AICPA Service Organization Controls Trust Services |
| **ISO/IEC 27001** | Norma para sistemas de gestão da segurança da informação |

Em cada linha você pode:

- **Habilitar / desabilitar** a regulação com o seletor — frameworks desabilitados são ignorados em cada varredura subsequente e seus achados excluídos dos painéis. Os achados existentes são preservados (não eliminados) caso você reabilite mais tarde.
- **Editar** o título, descrição do escopo e o contexto de prompt fornecido ao LLM.
- **Adicionar uma regulação personalizada** com **+ Nova Regulação** — por exemplo HIPAA, políticas internas ou frameworks setoriais. As regulações personalizadas são de primeira classe: aparecem na aba dedicada, contribuem para a pontuação global de conformidade e suportam as mesmas ações em achados (reconhecer, aceitar, promover para Risco).
- **Excluir** uma regulação personalizada — as regulações integradas não podem ser excluídas, apenas desabilitadas.

O scanner de conformidade e o fluxo de promoção para Risco funcionam **mesmo sem um provedor de IA configurado** — a entrada manual de achados, transições de status e o caminho de promoção para Risco continuam disponíveis. A IA só é necessária quando você efetivamente dispara uma nova varredura.

## Editor de Layout de Card

Para cada tipo de card, a seção **Layout** no painel do tipo controla como a página de detalhe do card é estruturada:

- **Ordem das seções** — Arraste seções (Descrição, EOL, Ciclo de Vida, Hierarquia, Relacionamentos e seções personalizadas) para reordená-las
- **Visibilidade** — Oculte seções que não são relevantes para um tipo
- **Expansão padrão** — Escolha se cada seção começa expandida ou recolhida
- **Layout de colunas** — Defina 1 ou 2 colunas por seção personalizada
- **Mover campos entre seções** — Usar a ação **mover** de um campo (ao lado dos botões de editar e excluir) para realocá-lo em outra seção, mantendo a sua configuração

## Recursos

O separador **Recursos** faz a gestão das duas listas oferecidas no separador **Recursos** de cada cartão:

- **Tipos de ligação** — a categoria de uma ligação de documento (p. ex. *Documentação*, *Contrato*, *Segurança*). Cada tipo de ligação inclui também um **ícone** apresentado ao lado da ligação.
- **Categorias de ficheiro** — a categoria atribuída a um ficheiro anexado carregado.

Para cada lista pode:

- **Adicionar uma entrada** — com uma chave (um identificador em minúsculas armazenado nos cartões, fixo após a criação), uma etiqueta apresentada e — para os tipos de ligação — um ícone.
- **Editar** a etiqueta, o ícone, a ordem e as traduções por idioma de qualquer entrada, incluindo as integradas.
- **Ativar / desativar** uma entrada com o interruptor — as entradas desativadas desaparecem do seletor, mas os valores existentes nos cartões são preservados.
- **Eliminar** uma entrada personalizada — as entradas integradas não podem ser eliminadas, apenas desativadas.

Um tipo de ligação **Contrato** integrado vem ativado por predefinição. Ambas as listas são incluídas na **Transferência de área de trabalho**, pelo que as suas personalizações se clonam entre instâncias.
