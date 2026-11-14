# Detalhes do Card

Clicar em qualquer card no inventário abre a **visualização de detalhe** onde você pode ver e editar todas as informações sobre o componente.

![Visualização de Detalhe do Card](../assets/img/pt/04_detalhe_ficha.png)

## Cabeçalho do Card

A parte superior do card mostra:

- **Ícone e rótulo do tipo** — Indicador colorido do tipo de card
- **Nome do card** — Editável inline
- **Alias** — O outro nome do card, exibido sob o título quando definido. O lápis de edição do título permite alterar o nome e o alias em conjunto. Os aliases são considerados por todas as caixas de pesquisa, de modo que um card é encontrado pelo nome que a sua organização realmente usa.
- **Subtipo** — Classificação secundária (se aplicável)
- **Chip de origem** — Exibido quando o card não foi criado na interface web: **MCP** para um card criado por um assistente de IA pelo [servidor MCP](../admin/mcp.md), **API** para um script ou integração, **Extensão** para uma extensão instalada, **Sistema** para uma tarefa em segundo plano. Passe o mouse sobre ele para ver quem criou o card e quando — a pessoa continua sendo o criador; o chip indica qual canal ela usou. Cards criados na interface web, e cards criados antes de o Turbo EA registrar o canal, não exibem chip.
- **Badge de status de aprovação** — Rascunho, Aprovado, Quebrado ou Rejeitado
- **Botão de sugestão IA** — Clique para gerar uma descrição com IA (visível quando a IA está habilitada para este tipo de card e o usuário tem permissão de edição)
- **Anel de qualidade dos dados** — Indicador visual da completude das informações (0-100%). Passe o cursor por cima para ver as três coisas que mais aumentariam a pontuação, cada uma com os pontos que acrescentaria (por exemplo *Preencher Criticidade de negócio +12,5%*). Clique nele (ou foque-o e pressione Enter) para abrir o detalhamento completo num painel à direita da página que permanece aberto enquanto edita: cada item ainda por preencher, ordenado pelo quanto acrescenta, e uma lista **Já contabilizado** com o que já está preenchido. Cada item ainda por preencher é um link: ao clicar, abre-se a seção onde ele é preenchido **em modo de edição**, com esse campo em foco (ou a caixa de diálogo **Adicionar relação** para o tipo de relação, o editor de etiquetas ou o formulário de adição da aba **Partes Interessadas**), e o painel continua aberto. Sem o direito de editar essa parte da ficha, o link apenas abre a seção e a página rola até ela. Enquanto um campo obrigatório estiver vazio, a pontuação permanece em 0%; o detalhamento nomeia esses campos e mostra qual seria a pontuação sem eles. Feche o painel com o botão **Fechar** do seu cabeçalho; o navegador lembra se ele está aberto, por isso continua lá na ficha seguinte. Numa janela com menos de 900 px de largura, abre-se em vez disso como uma gaveta, que se fecha quando segue um dos seus links.

![Painel com o detalhamento da qualidade dos dados](../assets/img/pt/63_ficha_qualidade_dados_detalhamento.png)

Ao criar um **Objeto de dados**, escolha um dos subtipos configurados para esse tipo de card. Pode fazer a mesma escolha ao criar um Objeto de dados a partir da hierarquia, de um predecessor ou sucessor, de uma célula de relação do inventário ou de um elemento ArchiMate.

Quando um administrador ativa o [modo TurboRPG](../admin/settings.md#turborpg-qualidade-dos-dados-gamificada) (qualidade dos dados gamificada), cada gravação que aumenta a pontuação é celebrada como um ganho de vida num jogo: um **+X%** luminoso sai da secção que acabou de gravar, voa até à pontuação e atinge-a — o anel pisca e brilha, o seu preenchimento aumenta até à nova pontuação e o número vai subindo. Assim que se desloca para além do cabeçalho, uma fina barra de pontuação fixada sob a barra superior mantém a pontuação à vista e o ganho aterra nela. Clique na pontuação da barra — o chip com o chevron — para abrir o mesmo detalhe do anel. Atingir a faixa verde (80%) e atingir 100% são marcos com uma breve chuva de confete. Limpar ou remover dados reproduz o inverso atenuado: um **−X%** vermelho sai da pontuação de volta para a secção, e a barra esvazia-se e conta em sentido inverso, sem clarão nem confete. Com a redução de movimento ativada no sistema operativo, nada voa; vê, em vez disso, um **+X%** ou **−X%** estático.
- **Menu de ações** — Arquivar, excluir e ações de aprovação. Também inclui uma ação de um clique **Observar este cartão** (quando o tipo de card define um papel de Observador), permitindo que qualquer usuário com permissão de leitura siga o card sem precisar abrir a aba Partes interessadas.

### Logótipo personalizado

Os cartões de um tipo que o permita podem ter o seu próprio **logótipo** em vez
do ícone genérico do tipo — assim, uma Aplicação para SAP, Kafka ou Jira mostra
a marca do próprio produto. Logótipos reconhecíveis tornam um inventário muito
mais rápido de percorrer, sobretudo para quem o consulta sem o manter.

Passe o rato sobre o ícone no canto superior esquerdo do cartão e clique para
**carregar**, **substituir** ou **remover** a imagem. O ícone do tipo não
desaparece: passa a um pequeno emblema no canto do logótipo, pelo que continua
a perceber-se num relance de que tipo de cartão se trata.

- **Formatos aceites** — PNG, JPEG, WebP ou GIF, até 1 MB. O formato SVG não é
  aceite, porque pode conter scripts.
- **Onde aparece** — no cabeçalho do cartão, na coluna **Logótipo** opcional
  do [Inventário](inventory.md) e em qualquer portal web publicado sobre esse
  tipo de cartão.
- **Sem logótipo** — o cartão volta ao ícone do seu tipo, tal como antes.

Os logótipos estão disponíveis nos tipos de cartão que um administrador tenha
ativado; de origem, são Aplicação e Componente de TI. Consulte
[Metamodelo](../admin/metamodel.md).

Clique no logótipo e escolha **Escolher um ícone de marca…** para selecionar de
um conjunto integrado de vários milhares de marcas: procure o produto pelo nome e
selecione-o; não é preciso qualquer ficheiro de imagem. **Carregar** permite usar
o seu próprio ficheiro. Um assistente de IA ligado por [MCP](../admin/mcp.md)
pode definir logótipos da mesma forma em massa e, se um produto não constar do
conjunto, vai buscar a marca por si.

O mesmo menu está disponível na coluna **Logótipo** do
[Inventário](inventory.md) — passe o rato sobre uma célula de logótipo e clique
—, para que se possam colocar marcas num panorama acabado de importar sem abrir
cada cartão. É cartão a cartão de propósito: o logótipo não é oferecido nem ao
preenchimento para baixo nem à edição em massa.

### Fluxo de Aprovação

Os cards podem passar por um ciclo de aprovação:

| Status | Significado |
|--------|-------------|
| **Rascunho** | Estado padrão, ainda não revisado |
| **Aprovado** | Revisado e aceito por uma parte responsável |
| **Quebrado** | Estava aprovado, mas foi editado desde então — precisa de nova revisão |
| **Rejeitado** | Revisado e rejeitado, precisa de correções |

Quando um card aprovado é editado, seu status muda automaticamente para **Quebrado** para indicar que precisa de nova revisão. Arquivar o card pai tem o mesmo efeito sobre os cards filhos aprovados que são deslocados na hierarquia. Todas as pessoas com um papel de parte interessada no card são notificadas — exceto quem fez a alteração — e a mudança fica registada na aba **Histórico** do card. Uma ação que quebra vários cards, como uma edição em massa, envia a cada pessoa um único resumo em vez de uma notificação por card.

## Aba de Detalhe (Principal)

A aba de detalhe é organizada em **seções** que podem ser reordenadas e configuradas por um administrador por tipo de card (veja [Editor de Layout de Card](../admin/metamodel.md#card-layout-editor)).

### Seção de Descrição

- **Descrição** — Descrição em texto rico do componente. Suporta o recurso de sugestão de IA para geração automática
- **Campos adicionais de descrição** — Um administrador pode atribuir qualquer campo próprio de um tipo de card à seção de descrição, que pode assim conter campos além da própria descrição
- **Links** — Um endereço web (`http://` ou `https://`) digitado na descrição, em qualquer campo de texto, em um comentário ou em uma tarefa torna-se um link que abre em uma nova aba

### Seção de Ciclo de Vida

O modelo de ciclo de vida acompanha um componente através de cinco fases:

| Fase | Descrição |
|------|-----------|
| **Planejamento** | Em consideração, ainda não iniciado |
| **Implantação** | Sendo implementado ou implantado |
| **Ativo** | Atualmente operacional |
| **Desativação** | Sendo descomissionado |
| **Fim de Vida** | Não mais em uso ou com suporte |

Cada fase tem um **seletor de data** para que você possa registrar quando o componente entrou ou entrará nessa fase. Uma barra de linha do tempo visual mostra a posição do componente em seu ciclo de vida.

Se uma fase tiver uma data posterior à de uma fase que deveria vir depois dela — por exemplo, **Desativação** após **Fim de Vida** —, um ícone de aviso aparece ao lado dessa data, e o mesmo aviso é exibido abaixo do campo durante a edição. É apenas uma indicação: as datas ainda podem ser salvas como foram inseridas.

Um ícone de informação ao lado de cada fase na linha do tempo explica o que a fase significa – passe o cursor sobre ele para ler a definição. Mostra uma explicação padrão, a menos que o seu administrador a tenha alterado para descrever como a sua organização usa a fase, ou a tenha removido. A linha do tempo, com os seus ícones, continua visível enquanto você edita as datas. Os textos são definidos em **Admin → Metamodelo → Fases do ciclo de vida** (veja [Fases do ciclo de vida](../admin/metamodel.md#lifecycle-phases)).

### Seções de Atributos Personalizados

Dependendo do tipo de card, você verá seções adicionais com **campos personalizados** configurados no metamodelo. Os tipos de campo incluem:

- **Texto** — Entrada de texto livre
- **Texto multilinha** — Entrada de texto livre que preserva quebras de linha, exibida como uma área de texto que cresce automaticamente
- **Número** — Valor numérico
- **Custo** — Valor numérico exibido com a moeda configurada na plataforma
- **Booleano** — Escolha numa lista Sim / Não, com **Nenhum** para o limpar; exibido como etiqueta verde *Sim* ou azul *Não*, — quando não definido
- **Data** — Seletor de data
- **URL** — Link clicável (validado para http/https/mailto)
- **Seleção única** — Menu suspenso com opções predefinidas
- **Seleção múltipla** — Multi-seleção com exibição de chips

Onde o seu administrador escreveu um **texto de ajuda** para um campo, um ícone de informação aparece ao lado do seu rótulo: passe o cursor sobre ele (ou chegue até ele com a tecla Tab) para ler o que o campo significa. Enquanto você edita a seção, o mesmo ícone fica ao lado do campo. No Inventário, passar o cursor sobre o cabeçalho da coluna do campo também o mostra.

Campos marcados como **calculados** mostram um badge e não podem ser editados manualmente — seus valores são computados por [fórmulas definidas pelo administrador](../admin/calculations.md).

### Seção de Custos (Aplicação e Componente de TI)

As Aplicações e os Componentes de TI registam o seu custo como uma lista de **itens de custo** (por exemplo licenças, alojamento, suporte), e não como um único número digitado. A seção **Custos** mostra um ano fiscal de cada vez, com um navegador **‹ ›** ao longo de seis anos: os quatro anteriores ao atual, o atual e o **Forecast**.

- **TCO** — O custo total de propriedade do ano é a soma dos seus itens. Nunca é digitado à mão.
- **Gráfico e blocos** — Uma barra empilhada mostra como o TCO se distribui pelos itens. Cada item tem um bloco com o seu **montante anual** e a **data de renovação**; uma renovação nos próximos 90 dias é mostrada a laranja. Os custos são sempre anuais.
- **Adicionar e editar** — Um item é adicionado, editado ou eliminado numa caixa de diálogo. Os itens vêm do catálogo que um administrador gere em [Metamodelo → Itens de custo](../admin/metamodel.md#itens-de-custo).
- **Copiar para Forecast** — Copia os itens do ano que está a ver para o ano Forecast, para iniciar um plano a partir dos valores atuais.

**Um novo ano fiscal.** Quando o ano fiscal muda e um card ainda não tem custos para o novo ano atual, a seção mostra os itens do ano anterior marcados como **não confirmados**, com as datas de renovação avançadas. Ficam assim até alguém os confirmar ou editar um montante. O Forecast e os anos passados nunca recorrem a outro ano.

**Quem pode ver e editar os custos.** Pode **ver** os custos com a permissão `costs.view`, ou se tiver qualquer papel de parte interessada no card. Pode **editar** os custos com a permissão `costs.edit`, ou se tiver no card um papel de parte interessada que permita editá-lo (por exemplo Responsável). Os observadores só podem ver. Por predefinição, só os administradores têm `costs.edit`; os papéis existentes mantêm `costs.view`.

O campo **Custo anual total** (`costTotalAnnual`) do card é derivado dos itens do ano atual e é só de leitura: a grelha, a importação de folha de cálculo, o arrastar para preencher, a API, o MCP, o ServiceNow e o LeanIX já não o podem definir, e qualquer valor enviado é substituído. Um card sem itens de custo tem o campo de custo vazio, não 0. As Iniciativas e os Fornecedores mantêm os seus campos de custo habituais.

### Seção de Licenças (Aplicação e Componente de TI)

A seção **Licenciamento** regista, ano a ano, quantas licenças o card tem contratadas e quantas são realmente usadas. Fica junto dos Custos e tem o mesmo navegador **‹ ›** ao longo de seis anos: os quatro anteriores ao atual, o atual e o **Forecast**. As métricas que o card acompanha (**Utilizadores**, **Instalações**) vêm do seu **Modelo de licenciamento**, mostrado no topo da secção. Quem pode editar o card altera-o com **Editar**: marque **Utilizadores** e/ou **Instalações** e depois **Guardar**. O modelo não aparece entre os restantes campos do card.

![Seção de Licenças](../assets/img/en/104_card_licensing.png)

- **Por métrica e tipo de licença** — Cada métrica tem um bloco com um mosaico por tipo de licença que mostra a quantidade **licenciada**, a quantidade **real**, a **% de utilização** e um estado: **Conforme**, **Perto do limite** (a partir de 80 %), **Sobrelicenciado** (real acima do licenciado) ou **Sem dados**. Uma barra empilhada soma os tipos. Os tipos de licença vêm do catálogo que um administrador gere em [Metamodelo → Tipos de licença](../admin/metamodel.md#tipos-de-licença).
- **Adicionar e editar** — Uma quantidade é adicionada, editada ou eliminada numa caixa de diálogo. Deixar **Real** vazio significa «sem dados», o que é diferente de 0.
- **Forecast** — O ano Forecast só aceita a quantidade licenciada. **Copiar para Forecast** copia as quantidades licenciadas do ano que está a ver.

**Um novo ano fiscal.** Quando um card ainda não tem dados de licenciamento para o novo ano atual, a seção mostra as quantidades licenciadas do ano anterior marcadas como **não confirmadas**, sem quantidade real, para que um novo ano nunca herde o consumo do anterior. Ficam assim até alguém as confirmar ou editar uma quantidade.

**Quem pode ver e editar as licenças.** Pode **vê-las** com a permissão `licenses.view`, ou se tiver qualquer papel de stakeholder no card. Pode **editá-las** com a permissão `licenses.edit`, ou se tiver no card um papel de stakeholder que permita editar o card. Por predefinição, só os administradores têm `licenses.edit`. Uma alteração aparece no separador Histórico como **Licenças atualizadas**, com os tipos de licença afetados mas não as quantidades, e não pode ser revertida.

### Seção de Hierarquia

Para tipos de card que suportam hierarquia (ex.: Organização, Capacidade de Negócio, Aplicação):

- **Pai** — O card pai na hierarquia (clique para navegar)
- **Filhos** — Lista de cards filhos (clique em qualquer um para navegar)
- **Abrir em nova aba** — O pai, os filhos e o breadcrumb são links: clique com o botão do meio ou com Ctrl/Cmd (ou clique direito → *Abrir em nova aba*) para abrir esse card em uma nova aba do navegador sem sair deste
- **Agrupar por subtipo** — Quando um card tem muitos filhos de subtipos diferentes (por exemplo unidades de negócio, regiões e equipas sob uma mesma empresa), estes são agrupados automaticamente em secções recolhíveis por subtipo, cada uma com a sua contagem, com uma secção final **Sem subtipo** para os filhos não classificados. O botão agrupar/lista junto à contagem de **filhos** alterna entre a vista agrupada e a lista simples.
- **Breadcrumb de hierarquia** — Mostra o caminho completo da raiz até o card atual
- **Tipo de ligação** — Quando um administrador configurou tipos de ligação para este tipo de card, cada ligação pai-filho pode ser rotulada — por exemplo, uma subsidiária *comercial* e outra de *vendas*. O rótulo pertence ao card filho: o card pai mostra-o ao lado de cada filho, e o card filho ao lado do seu pai. Remover um card ou movê-lo para o nível superior limpa o seu rótulo, e a alteração fica registada na aba **Histórico**.

### Seção de Relacionamentos

Mostra todas as conexões com outros cards, agrupadas por tipo de relacionamento. Para cada relacionamento:

- **Nome do card relacionado** — Clique para navegar até o card relacionado. Clique com o botão do meio ou com Ctrl/Cmd (ou clique direito → *Abrir em nova aba*) para abri-lo em uma nova aba do navegador — o mesmo vale para a lista **+N em subelementos**, para as listas de linhagem e para o hover card de uma parte interessada
- **Tipo de relacionamento** — A natureza da conexão (ex.: "utiliza", "roda em", "depende de")
- **Adicionar relacionamento** — Clique em **+** para abrir a caixa desse relacionamento. Ela lista os cartões correspondentes enquanto você digita (as melhores correspondências primeiro, e mais são carregados ao rolar) e oculta os já ligados, com uma legenda indicando quantos são. Clicar num cartão liga-o de imediato e ele aparece como etiqueta no topo — clique no **×** de uma etiqueta para desfazer essa adição. A caixa permanece aberta para adicionar quantos quiser e no telemóvel abre em ecrã inteiro. Os relacionamentos sem secção própria são alcançados pelo botão **Adicionar relacionamento** no fim da secção. Quando o tipo ligado é hierárquico (capacidade de negócio, organização e afins), a caixa mostra-o como uma árvore indentada em vez de uma lista alfabética, para que possa escolher uma subcapacidade pelo seu ramo. A pesquisa mantém visíveis os pais de cada correspondência como contexto, e os cartões que não pode escolher (já ligados, acabados de adicionar ou o próprio cartão) permanecem no lugar a cinzento, para que os níveis à volta continuem a fazer sentido.
- **Ordenação** — Os cartões relacionados são listados em ordem alfabética por nome
- **Remover relacionamento** — Clique no ícone de exclusão para remover um relacionamento
- **Agrupar por subtipo** — Quando uma seção de relacionamentos tem muitos cards relacionados, eles são agrupados automaticamente em grupos de subtipo recolhíveis (cada um com uma contagem), com um grupo final **Sem subtipo** para os cards não classificados. Use o botão de alternância no cabeçalho da seção para alternar entre a visualização agrupada e a lista simples.
- **Cards ligados a subelementos** — Quando um card tem subelementos, cada grupo de relacionamentos exibe um chip **+N em subelementos** que conta os cards ligados mais abaixo na hierarquia — por exemplo, as aplicações associadas às subcapacidades de uma capacidade. Ao clicar, abre-se uma lista somente leitura em que cada linha indica o subelemento que detém a ligação (um card alcançado por vários subelementos aparece uma única vez, com todos listados). A contagem inclui apenas cards que ainda não constam do grupo acima. Para alterar uma ligação, abra o subelemento que a detém. A lista está organizada em secções de subtipo recolhíveis, pelo que o subtipo é indicado uma vez por secção em vez de em cada linha. Dentro de uma secção surgem primeiro os cards cuja fase do ciclo de vida exige atenção (fim de vida, depois descontinuação), e a fase de cada card é apresentada como um ponto colorido junto ao nome — passe o rato por cima para ver o nome da fase.

![Grupos de relacionamentos com o chip de subelementos](../assets/img/pt/59_ficha_subelementos_chip.png)

![Cards ligados através de subelementos, agrupados por subtipo](../assets/img/pt/60_ficha_subelementos_relacoes.png)

### Seção de Dependências

Uma [Layered Dependency View](reports.md) do card e de tudo o que está a um salto de distância, agrupado nas quatro camadas de arquitetura. Shift-clique em um card para recentralizar a vista e percorrer o panorama sem sair da página.

O ícone **abrir em nova aba** na barra de ferramentas abre o [relatório de dependências](reports.md) completo em uma nova aba, centralizado no card em que a vista estiver centralizada naquele momento — ou seja, o card para o qual você navegou, não necessariamente o de partida. Útil quando você precisa do que o relatório acrescenta em torno da mesma imagem: viagem no tempo, as marcas de transição, a vista de tabela e salvar a vista como relatório.

### Seção de Tags

Aplique tags dos [grupos de tags](../admin/tags.md) configurados. Dependendo do modo do grupo, você pode selecionar uma tag (seleção única) ou múltiplas tags (seleção múltipla).

### Aba de Recursos {: #resources-tab }

A aba de **Recursos** consolida todos os materiais de apoio de um card:

- **Anexos de Arquivos** — Carregue e gerencie arquivos (documentos, folhas de cálculo, apresentações, ficheiros OpenDocument e Office antigos, imagens, arquivos, mensagens do Outlook e e-mail, CSV, Markdown, JSON e XML — até 20 MB). Ao carregar, selecione uma **categoria de documento** entre: Arquitetura, Segurança, Conformidade, Operações, Notas de Reunião, Design ou Outro. A categoria aparece como um chip ao lado de cada arquivo. Use o ícone de substituição ao lado de um arquivo para carregar uma nova versão no seu lugar — a entrada passa a ser datada e atribuída como um novo envio, e a versão anterior permanece apenas na aba Histórico do card — e o ícone de lápis para renomeá-lo ou alterar a sua categoria; a extensão deve permanecer a mesma.
- **Links de Documentos** — Referências de documentos baseadas em URL. Ao adicionar um link, selecione um **tipo de link** entre: Documentação, Segurança, Conformidade, Arquitetura, Operações, Suporte ou Outro. O tipo de link aparece como um chip ao lado de cada link, e o ícone muda de acordo com o tipo selecionado. Use o ícone de lápis ao lado de um link para alterar o seu nome, URL ou tipo de link; a URL deve começar por `http://`, `https://` ou `mailto:`, e cada alteração fica registada na aba Histórico do card.
- **Diagramas** — Vincule [diagramas](diagrams.pt.md) existentes a este card. Os diagramas vinculados são exibidos como pré-visualizações em miniatura que você pode clicar para abrir no editor de diagramas. Use o botão **Vincular Diagrama** para pesquisar e anexar um diagrama existente, ou clique no ícone de desvincular para remover a associação. Os [diagramas ArchiMate](archimate.pt.md) que referenciam o card através de um dos seus elementos também são listados, marcados como **ArchiMate**, e abrem-se no Architecture Studio; as suas ligações vêm do modelo, pelo que não podem ser vinculadas nem desvinculadas aqui, e só vê os das camadas que pode consultar.

### Seção EOL

Exibida por padrão em Aplicações e Componentes de TI, e em qualquer outro tipo de card cujo administrador a tenha [ativado](../admin/eol.md#fim-de-vida-em-outros-tipos-de-card). Se o card estiver vinculado a um produto do [endoflife.date](https://endoflife.date/) (via [Administração de EOL](../admin/eol.md)):

- **Nome do produto e versão** — um produto personalizado é designado pelo seu título e marcado como **Personalizado**
- **Status de suporte** — Com código de cores, com a mesma regra do relatório de EOL: Suportado, Aproximando-se do EOL (a menos de seis meses da data de EOL ou depois de terminado o suporte ativo), Fim de Vida
- **Datas importantes** — Data de lançamento, fim do suporte ativo, data de EOL, a última versão e a sua data de lançamento
- **Notas de lançamento** — uma ligação para a página do produto no endoflife.date, ou a **Página do fornecedor** de um produto personalizado

**Vincular**, **Alterar** e **Desvincular** só aparecem se puder editar a ficha. Os utilizadores com a permissão **Gerir EOL** podem definir um [produto EOL personalizado](../admin/eol.md) diretamente a partir desta secção, através da ligação **Defini-lo como produto personalizado…** sob a pesquisa de produto: o formulário abre com o nome da ficha (ou o que escreveu) como nome do produto, e a ficha fica vinculada ao novo produto ao guardar. Dispõem também de um atalho para **Gerir produtos personalizados** nas definições e podem adicionar um ciclo de lançamento em falta a partir da lista de ciclos. Os restantes utilizadores veem uma sugestão para pedir a um gestor de EOL quando o endoflife.date não tem correspondência. Os produtos personalizados comportam-se como os produtos do endoflife.date em todos os outros locais.

## Aba de Comentários

![Seção de Comentários do Card](../assets/img/pt/05_ficha_comentarios.png)

- **Adicionar comentários** — Deixe notas, perguntas ou decisões sobre o componente
- **Respostas em thread** — Responda a comentários específicos para criar conversações encadeadas
- **Timestamps** — Veja quando cada comentário foi postado e por quem. Um comentário publicado por um assistente de IA pelo servidor MCP traz um chip **MCP** ao lado do autor
- **Links** — Um endereço web em um comentário é clicável e abre em uma nova aba

## Aba de Tarefas

![Tarefas Associadas a um Card](../assets/img/pt/06_ficha_tarefas.png)

- **Criar tarefas** — Adicione tarefas vinculadas a este card específico
- **Atribuir** — Defina uma pessoa responsável para cada tarefa
- **Data de vencimento** — Defina prazos
- **Status** — Alterne entre Aberto e Concluído
- **Recorrente** — Ative **Repetir** para que uma tarefa se repita conforme um cronograma (a cada N dias, semanas, meses ou anos); ao concluí-la, a próxima ocorrência é criada automaticamente

## Aba de Partes Interessadas

![Partes Interessadas do Card](../assets/img/pt/07_ficha_partes_interessadas.png)

Partes interessadas são pessoas com um **papel** específico neste card. Os papéis disponíveis dependem do tipo de card (configurado no [metamodelo](../admin/metamodel.md)). Papéis comuns incluem:

- **Proprietário da Aplicação** — Responsável por decisões de negócio
- **Proprietário Técnico** — Responsável por decisões técnicas
- **Papéis personalizados** — Papéis adicionais conforme definido pelo seu administrador

Atribuições de partes interessadas afetam **permissões**: as permissões efetivas de um usuário em um card são a combinação do seu papel em nível de aplicação e quaisquer papéis de parte interessada que ele possua naquele card.

Quando um papel tem uma **cor** definida no metamodelo, o seu grupo é marcado com ela, permitindo distinguir um proprietário de um observador num relance.

Onde um papel tem uma **descrição**, um ícone de informação aparece ao lado do seu nome: passe o cursor sobre ele para ler o que o papel significa. A descrição também aparece sob o nome do papel no seletor de papéis ao adicionar uma parte interessada.

### Pesquisar e convidar

Escolha uma parte interessada via o **autocompletar pesquisável** — comece a digitar e o menu suspenso filtra tanto por nome quanto por e-mail (o e-mail aparece como linha secundária, para que dois usuários com o mesmo nome possam ser distinguidos num relance).

Se o e-mail que você digita não corresponder a um usuário existente, uma opção **«Convidar «email» como novo usuário»** aparece no final do menu suspenso. Selecioná-la expande um mini-formulário inline dentro do próprio seletor — edite opcionalmente o nome exibido e envie. O novo usuário recebe o **papel padrão** definido em [Usuários e Papéis](../admin/users.md#papeis). O novo usuário é convidado via o e-mail de convite padrão **e** atribuído ao papel de parte interessada escolhido no card numa única ação, assim você nunca precisa deixar o card para integrar um colaborador.

O caminho de convite requer a permissão **`users.invite`**, uma forma delegada de `admin.users` que administradores podem conceder a membros confiáveis. Uma proteção contra escalada de privilégios impede que não-admins convidem usuários para qualquer outro papel: sem `admin.users`, um usuário convidado só pode receber o papel padrão, Membro ou Visualizador.

## Aba de Histórico

![Histórico de Alterações do Card](../assets/img/pt/08_ficha_historico.png)

Uma alteração que não veio da interface web traz um chip ao lado do nome da pessoa: **MCP** quando um assistente de IA a fez pelo [servidor MCP](../admin/mcp.md) em nome dessa pessoa, ou **API**, **Extensão** ou **Sistema** nos demais casos.

Mostra a **trilha de auditoria completa** das alterações feitas no card: **quem** fez a alteração, **quando** foi feita e **o que** foi modificado (valor anterior vs. novo valor). Isso permite total rastreabilidade de todas as modificações ao longo do tempo.

Uma alteração aos custos do card aparece como **Custos atualizados**, com um resumo legível dos itens afetados. Os montantes só são mostrados aos utilizadores que podem ver os custos desse card, e uma alteração de custos não pode ser revertida a partir do registo de auditoria.

Tudo o que move a data **Modificado** do card aparece aqui: uma edição manual, uma importação de planilha, uma migração de plataforma ou sincronização com o ServiceNow, uma alteração de etiqueta, uma edição em massa, ou uma movimentação hierárquica que arrastou este card. A manutenção do sistema não altera nenhum dos dois: recalcular as pontuações de qualidade dos dados, reexecutar os campos calculados e preencher níveis hierárquicos ou identificadores de card deixam o histórico e a data **Modificado** intactos.

## Aba de ADR

Cada card possui uma aba **ADR** que lista as [decisões de arquitetura](delivery.md) vinculadas a ele — a revisão atual de cada decisão, mais qualquer revisão em redação — exibindo a referência, o título, a vigência (ou o status, enquanto ainda não está assinada), todos os cards vinculados e a data da última modificação. Clique em uma linha para abrir a decisão; as revisões anteriores são acessíveis a partir dela.

Se você tiver permissão para gerenciar vínculos de ADR, a aba também oferece **Vincular ADR** para anexar uma decisão existente e **Criar ADR** para criar uma nova já vinculada a este card, além de uma ação de desvinculação em cada linha. Em cards sem decisões vinculadas a aba fica oculta, a menos que você tenha essa permissão, de modo que usuários somente leitura nunca veem uma aba vazia.

Abaixo da lista, **Mencionado em** lista as decisões e os Statements of Architecture Work cujo texto menciona este card, e aqueles cuja discussão o menciona (assinalados *na discussão*), com a referência ou revisão de cada documento e a sua vigência ou status. Uma menção não vincula o card à decisão; apenas aparece aqui. A lista mostra apenas os documentos que você pode abrir e não aparece quando não há nenhum. Ver [Menções](grc.md#decision-mentions).

## Aba de Riscos (GRC habilitado, quando presente)

Quando o [módulo GRC](grc.md) está habilitado **e** o card tem pelo menos um risco vinculado, aparece uma aba **Riscos** que lista cada risco vinculado ao card com um caminho de um clique de volta ao [Registro de Riscos](risks.md). A aba é auto-ocultada quando não há risco vinculado, de modo que cards sem atividade GRC não carregam uma aba vazia.

## Aba de Conformidade (GRC habilitado, quando presente)

Quando o [módulo GRC](grc.md) está habilitado **e** o card tem pelo menos uma descoberta de conformidade vinculada, aparece uma aba **Conformidade** que lista cada descoberta atualmente vinculada ao card. As mesmas ações Reconhecer / Aceitar / **Criar risco** / **Abrir risco** que na [grade de Conformidade GRC](compliance.md) estão disponíveis, de modo que o proprietário do card possa triar suas próprias descobertas sem deixar o card. Auto-ocultada quando não há descoberta vinculada.

## Aba de Fluxo de Processo (apenas cards de Processo de Negócio)

Para cards de **Processo de Negócio**, uma aba adicional de **Fluxo de Processo** aparece com um visualizador/editor de diagrama BPMN integrado. Veja [BPM](bpm.md) para detalhes sobre gerenciamento de fluxos de processo.

## Aba PPM (apenas cards de Iniciativa)

Quando o [módulo PPM](ppm.md) está ativado, os cards de **Iniciativa** exibem uma aba **PPM** adicional como última aba. Ao clicar nesta aba, você é direcionado à visualização detalhada PPM da iniciativa, onde pode gerenciar relatórios de status, orçamentos, riscos, tarefas e cronogramas Gantt.

## Arquivamento

Cards podem ser **arquivados** (exclusão temporária) através do menu de ações. Cards arquivados:

- São ocultados da visualização padrão do inventário (visíveis apenas com o filtro "Mostrar arquivados")
- São automaticamente **excluídos permanentemente após 30 dias**
- Podem ser restaurados antes que a janela de 30 dias expire
