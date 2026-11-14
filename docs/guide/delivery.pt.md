# Entregas de EA

O módulo de **Entregas de EA** gerencia **iniciativas de arquitetura e seus artefatos** — diagramas, Statements of Architecture Work (SoAW) e Architecture Decision Records (ADR). Ele fornece uma visão única de todos os projetos de arquitetura em andamento e seus entregáveis.

Quando o PPM está habilitado — a configuração típica — Entregas de EA vive **dentro do módulo PPM**: abra **PPM** na navegação superior e mude para a aba **EA Delivery** (`/ppm?tab=ea-delivery`). Quando o PPM está desabilitado, **EA Delivery** aparece no menu **IT Governance** com o nome **EA Governance** (apontando para `/reports/ea-delivery`); se o GRC estiver desativado, ou se o seu papel não puder abrir IT Governance, aparece em vez disso como um item de nível superior **Entrega EA**. A URL legada `/ea-delivery` continua funcionando como redirecionamento em ambos os casos, para que os favoritos existentes ainda resolvam.

![Gestão de Entregas de EA](../assets/img/pt/17_entrega_ea.png)

## Espaço de trabalho de Iniciativas

Entregas de EA é um **espaço de trabalho de dois painéis** (sem separadores internos):

- **Barra lateral à esquerda** — uma árvore indentada e filtrável de todas as iniciativas (com as iniciativas filhas aninhadas). Pesquise por nome, filtre por Status / Subtipo / Artefatos ou marque favoritos.
- **Espaço de trabalho à direita** — os entregáveis, iniciativas filhas e detalhes da iniciativa selecionada à esquerda. Selecionar outra linha atualiza o espaço de trabalho.

A seleção faz parte do URL (`?initiative=<id>`), pelo que pode partilhar um link direto para uma iniciativa ou recarregar a página sem perder o contexto.

Um único botão principal **+ Novo artefato ▾** no topo da página permite criar um novo SoAW, diagrama ou ADR — automaticamente vinculado à iniciativa selecionada (ou não vinculado se nada estiver selecionado). Os grupos de entregáveis vazios no espaço de trabalho também expõem um botão **+ Adicionar …**, para que a criação esteja sempre a um clique.

Cada linha da árvore mostra:

| Elemento | Significado |
|----------|-------------|
| **Nome** | Nome da iniciativa |
| **Chip de contagem** | Total de artefatos vinculados (SoAW + diagramas + ADRs) |
| **Ponto de status** | Ponto colorido para No Prazo / Em Risco / Fora do Prazo / Em Espera / Concluído |
| **Estrela** | Botão de favorito — os favoritos sobem ao topo |

A linha sintética **Artefatos não vinculados** no topo da árvore aparece quando há SoAWs, diagramas ou ADRs ainda não vinculados a uma iniciativa. Abra-a para os religar.

### Quem vê o quê

As Entregas de EA abrem para qualquer papel que tenha **Ver documentos SoAW** (`soaw.view`) ou **Ver registos de decisões de arquitetura** (`adr.view`). Cada tipo de artefato segue então a sua própria permissão:

| Artefato | Listado com | Criado com |
|----------|-------------|--------------|
| **SoAW** | `soaw.view` | `soaw.manage` |
| **Diagrama** | `diagrams.view` | `diagrams.manage` (também necessário para vincular ou desvincular um diagrama) |
| **ADR** | `adr.view` | `adr.manage` |

Um grupo que não pode ver fica fora do espaço de trabalho, e **+ Novo artefato** e **+ Adicionar …** oferecem apenas os tipos que pode criar — um papel que só pode ler não vê nenhum dos dois botões. Assim, um papel apenas com `adr.view` obtém a página com as decisões de cada iniciativa e nada sobre SoAW.

## Statement of Architecture Work (SoAW)

Um **Statement of Architecture Work (SoAW)** é um documento formal definido pelo [padrão TOGAF](https://pubs.opengroup.org/togaf-standard/) (The Open Group Architecture Framework). Ele estabelece o escopo, abordagem, entregáveis e governança para um engajamento de arquitetura. No TOGAF, o SoAW é produzido durante a **Fase Preliminar** e **Fase A (Visão de Arquitetura)** e serve como um acordo entre a equipe de arquitetura e suas partes interessadas.

O Turbo EA fornece um editor de SoAW integrado com templates de seções alinhados ao TOGAF, edição de texto rico e capacidades de exportação — para que você possa criar e gerenciar documentos SoAW diretamente junto com seus dados de arquitetura.

### Criando um SoAW

1. Selecione a iniciativa à esquerda (opcional — também pode criar um SoAW sem vinculação).
2. Clique em **+ Novo artefato ▾** no topo da página (ou no botão **+ Adicionar** dentro da secção *Entregáveis*) e escolha **Novo Statement of Architecture Work**.
3. Insira o título do documento.
4. O editor abre com **templates de seções pré-construídos** baseados no padrão TOGAF.

### O Editor de SoAW

O editor oferece:

- **Edição de texto rico** — Barra de ferramentas completa de formatação (títulos, negrito, itálico, listas, links) alimentada pelo editor TipTap
- **Links** — Uma URL digitada ou colada torna-se um link enquanto você escreve, e todo link em um documento abre em uma nova aba. Endereços em documentos escritos antes do suporte a links são convertidos em links ao serem exibidos
- **Templates de seções** — Seções predefinidas seguindo os padrões TOGAF (ex.: Descrição do Problema, Objetivos, Abordagem, Partes Interessadas, Restrições, Plano de Trabalho)
- **Tabelas editáveis inline** — Adicione e edite tabelas dentro de qualquer seção
- **Menções** — escreva **@** no texto de uma seção para mencionar um card ou uma decisão (ver [Discussão, menções e histórico](#soaw-collaboration))
- **Histórico de versões do documento** — uma tabela que os autores preenchem à mão (versão, data, revisado por, descrição). Faz parte do documento e não é a vista [Histórico](#soaw-collaboration)
- **Fluxo de status** — Documentos progridem através de estágios definidos:

| Status | Significado |
|--------|-------------|
| **Rascunho** | Sendo escrito, ainda não pronto para revisão |
| **Em Revisão** | Enviado para assinatura — bloqueado até que as assinaturas sejam recolhidas |
| **Aprovado** | Revisado e aceito |
| **Assinado** | Formalmente assinado |

### Fluxo de Assinatura

A partir de um SoAW em rascunho ou aprovado, você pode solicitar assinaturas das partes interessadas. Clique em **Solicitar Assinaturas** e use o campo de pesquisa para encontrar e adicionar signatários por nome ou e-mail. O sistema rastreia quem assinou e envia notificações para os signatários pendentes.

Um SoAW em revisão fica **bloqueado**, para que os signatários assinem exatamente o que lhes foi enviado: apenas a sua iniciativa ainda pode mudar. Para editar o conteúdo, clique em **Recolher assinaturas**, o que o devolve a rascunho. Um signatário que clique em **Rejeitar** também o devolve a rascunho, com o mesmo número de revisão. Só um SoAW em rascunho pode ser eliminado.

### Revisões

Um SoAW assinado é somente leitura. Clique em **Nova revisão** para iniciar um novo rascunho a partir dele, com o mesmo nome e o número de revisão seguinte. Existe uma única revisão aberta de cada vez: enquanto uma revisão está a ser redigida, o SoAW assinado indica-o e oferece **Abrir a revisão** em vez de iniciar outra. Só a revisão mais recente pode ser revisada, e uma rejeição não altera o número de revisão.

Uma revisão anterior mostra um banner com uma ligação para a revisão atual, e a faixa **Revisões** em cada revisão lista-as todas. As listas de SoAW — os entregáveis da iniciativa, a aba SoAW, o relatório de Entregas de EA — mostram a revisão atual de cada documento e qualquer revisão em redação.

### Discussão, menções e histórico {: #soaw-collaboration }

Um SoAW tem a mesma discussão, as mesmas menções e o mesmo histórico que uma decisão: a discussão num painel ao lado do seu editor e da sua pré-visualização, o histórico atrás do botão **Histórico** no topo da página. O comportamento comum é descrito uma única vez, no guia de GRC: [Discussão](grc.md#decision-discussion), [Menções](grc.md#decision-mentions), [Histórico](grc.md#decision-history) e [Limitações conhecidas](grc.md#collaboration-limits). O que muda num SoAW:

- **Quem pode publicar.** Publicar, responder, resolver e reabrir exigem a permissão `soaw.comment`, que os membros e administradores têm por predefinição e os visualizadores não; a leitura da discussão segue `soaw.view`. Os signatários do SoAW podem sempre comentá-lo. Quem pode editar SoAW (`soaw.manage`) pode eliminar qualquer comentário.
- **Seções.** Um tópico é associado a uma das seções próprias do SoAW com uma etiqueta de seção, ou a nenhuma (um tópico geral). Um SoAW tem muitas seções, por isso a caixa de redação mostra uma etiqueta para cada seção já discutida e para a escolhida; **Mais…** abre uma lista pesquisável das restantes. As etiquetas no topo da discussão filtram-na por seção, tal como numa decisão. Um tópico associado a uma seção personalizada entretanto removida mostra *Seção removida*. Cada seção apresenta ao lado do seu título o mesmo ícone de chat que a de uma decisão, no editor e na pré-visualização, com o número de tópicos abertos quando há discussão; clique nele para abrir a discussão sobre essa seção com a seção já selecionada para um novo comentário.
- **Rejeição.** Qualquer signatário que tenha a permissão de assinar (`soaw.sign`) — ou a permissão de edição — pode rejeitar um SoAW, tal como nas decisões; até agora, rejeitar exigia a permissão de edição. O motivo abre um tópico **Motivo da rejeição** na discussão.
- **Menções.** Um SoAW não tem cards ligados, por isso, sem nada escrito depois de **@**, os cards são listados por ordem alfabética; num comentário, os signatários do SoAW aparecem primeiro entre as pessoas. **Procurar…** funciona como numa decisão.
- **Nota de assinatura.** **Assinar** abre agora uma caixa de diálogo onde o signatário pode acrescentar uma nota opcional; esta aparece na discussão como **Nota de assinatura** e no Histórico.
- **Histórico.** Uma versão contém o nome do SoAW, as suas informações de documento, a sua tabela Histórico de versões do documento e todas as seções; a iniciativa não faz parte de uma versão. O Histórico regista o que acontece ao documento; a tabela Histórico de versões do documento, no documento, só regista o que os seus autores nela escrevem. Um SoAW com o status **Aprovado** ainda pode ser editado, por isso, tal como num rascunho, as suas gravações são guardadas como versões e uma versão anterior pode ser restaurada nele.

### Pré-visualização e Exportação

- **Modo de pré-visualização** — Visualização somente leitura do documento SoAW completo
- **Exportação DOCX** — Baixe o SoAW como um documento Word formatado para compartilhamento offline ou impressão
- **Exportação PDF** — Abre uma visualização pronta para impressão em uma nova aba; use *Salvar como PDF* do navegador. Permita pop-ups para este site se nada abrir.

### Aba SoAW nos cards de Iniciativa

![Card de iniciativa — aba SoAW](../assets/img/pt/55_iniciativa_soaw_tab.png)

As iniciativas também expõem uma aba **SoAW** dedicada diretamente na sua página de detalhe. A aba lista a revisão atual de cada SoAW vinculado àquela iniciativa, mais qualquer revisão em redação (título, chip de status, número de revisão, data da última modificação) com um botão **+ Novo SoAW** que pré-seleciona a iniciativa atual — para que você possa redigir ou abrir um SoAW sem sair do card no qual está trabalhando. A criação reutiliza o mesmo diálogo da página Entregas de EA, e o novo documento aparece em ambos os lugares. A aba é mostrada aos papéis que têm **Ver documentos SoAW** (`soaw.view`); o botão **+ Novo SoAW** e a ação de excluir um rascunho exigem **Criar e editar documentos SoAW** (`soaw.manage`), quer você possa ou não editar a própria iniciativa.

## Registros de Decisões de Arquitetura (ADR)

Um **Registro de Decisão de Arquitetura (ADR)** captura uma decisão de arquitetura importante junto com seu contexto, consequências e alternativas consideradas. O espaço de trabalho de Entregas de EA mostra os ADR **vinculados à iniciativa selecionada** em linha, sob a secção de entregáveis *Decisões de Arquitetura* — assim você pode lê-los e abri-los sem sair da visualização da iniciativa. Use o split-button **+ Novo artefato ▾** (ou **+ Adicionar** na secção) para criar um novo ADR pré-vinculado à iniciativa selecionada.

O **registo principal de ADR** — onde cada ADR a nível do panorama é filtrado, pesquisado, assinado, revisado e visualizado — vive no módulo GRC em **GRC → Governação → [Decisões](grc.md#governance)**. Consulte o guia GRC para o ciclo de vida completo do ADR (colunas da grelha, barra lateral de filtros, fluxo de assinatura, revisões, pré-visualização).

## Aba de Recursos

![Aba de Recursos do card](../assets/img/pt/17c_ficha_recursos.png)

Os cards agora incluem uma aba de **Recursos** que consolida:

- **Decisões de Arquitetura** — os ADR não são mais listados aqui. Agora cada card tem sua própria aba **ADR**; consulte [Detalhe do card](card-details.md) para ver o que ela mostra e como vincular, criar ou desvincular decisões a partir de um card.
- **Anexos de Arquivos** — Carregue e gerencie arquivos (documentos, folhas de cálculo, apresentações, ficheiros OpenDocument e Office antigos, imagens, arquivos, mensagens do Outlook e e-mail, CSV, Markdown, JSON e XML — até 20 MB). Ao carregar, selecione uma **categoria de documento** entre: Arquitetura, Segurança, Conformidade, Operações, Notas de Reunião, Design ou Outro. A categoria aparece como um chip ao lado de cada arquivo.
- **Links de Documentos** — Referências de documentos baseadas em URL. Ao adicionar um link, selecione um **tipo de link** entre: Documentação, Segurança, Conformidade, Arquitetura, Operações, Suporte ou Outro. O tipo de link aparece como um chip ao lado de cada link, e o ícone muda de acordo com o tipo selecionado.
