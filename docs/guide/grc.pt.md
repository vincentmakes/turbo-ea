# GRC

O módulo **GRC** reúne Governança, Risco e Conformidade num único espaço de trabalho em `/grc`. Consolida tarefas que antes viviam entre Entrega EA e TurboLens, para que arquitetas, proprietários de risco e revisores de conformidade trabalhem sobre um terreno comum.

!!! note
    O módulo GRC pode ser habilitado ou desabilitado por um administrador em [Configurações](../admin/settings.md). Quando desabilitado, a navegação e os recursos do GRC ficam ocultos.

GRC tem três abas:

Você pode apontar diretamente para qualquer aba via `/grc?tab=governance`, `/grc?tab=risk` ou `/grc?tab=compliance`.

![GRC — aba Governança](../assets/img/pt/52_grc_governanca.png)

## Governança

A aba Governança divide-se em duas **sub-abas**, com link profundo via `/grc?tab=governance&sub=principles` (padrão) e `/grc?tab=governance&sub=decisions`:

### Princípios

Visualizador somente leitura dos Princípios EA publicados no metamodelo (declaração, justificativa, implicações). O catálogo é editado em **Administração → Metamodelo → Princípios**.

### Decisões

![GRC — sub-aba Decisões](../assets/img/pt/52a_grc_decisoes.png)

A sub-aba Decisões é o **registro principal dos Architecture Decision Records (ADR)** — cada ADR ao longo do panorama, independentemente da iniciativa à qual está vinculado. Substitui a antiga aba Decisões de Entregas de EA, dissolvida quando o módulo GRC entrou em cena.

Os ADR documentam decisões de arquitetura importantes junto com seu contexto, consequências e alternativas consideradas. As decisões emitidas pelo assistente TurboLens Architect chegam aqui como rascunhos para aprovação.

O registo responde antes de mais a uma pergunta: **que decisões estão em vigor hoje?** Cada decisão assinada tem uma [vigência](#standing) que o Turbo EA calcula a partir das suas datas, das suas revisões e das outras decisões que atuam sobre ela, e a grelha lista apenas a revisão atual de cada decisão, a menos que peça também as anteriores.

A grelha também pode ser **agrupada por estado** ou **por vigência** através do botão *Agrupar por* junto à caixa de pesquisa: cada estado ou vigência recolhe-se sob o seu próprio cabeçalho, e a caixa de seleção do cabeçalho seleciona todo o grupo para uma exportação em massa.

#### Status e vigência {: #standing }

Uma decisão tem dois estados distintos:

- O **Status** é o fluxo de assinatura, e é sobre ele que atua: **Rascunho** → **Em Revisão** (assinaturas solicitadas) → **Assinado**. Uma decisão tomada fora do Turbo EA e [registada como decidida](#recording-a-past-decision) mostra **Registado** em vez de Assinado.
- A **Vigência** indica a situação atual de uma decisão assinada ou registada. É derivada — nunca definida manualmente — e um rascunho ou uma decisão em revisão não tem nenhuma (*Ainda não assinada*).

| Vigência | Significado |
|----------|-------------|
| **Agendada** | Assinada, mas a data *Em vigor desde* ainda não chegou |
| **Em vigor** | Assinada e efetiva |
| **Em vigor (alterada)** | Em vigor, e outra decisão assinada altera-a; a alteração ainda não foi integrada numa [revisão consolidada](#amendments-and-consolidated-revisions) |
| **Substituída** | Uma revisão posterior da mesma decisão, ou uma decisão que a substitui, entrou em vigor |
| **Revogada** | Uma decisão assinada que a revoga entrou em vigor |
| **Expirada** | A sua data *Válida até* já passou (está em vigor até esse dia, inclusive) |

A página da decisão indica o motivo com um banner — *Esta decisão foi substituída por …*, *Esta decisão entra em vigor em …*, *A revisão 3 entra em vigor em …* — com uma ligação para a decisão em causa.

#### Colunas da tabela

A grade de ADR espelha o layout da grade de Inventário:

| Coluna | Descrição |
|--------|-----------|
| **N.º de ref.** | Número de referência gerado automaticamente (ADR-001, ADR-002, …) com um ponto de status; uma revisão após a primeira acrescenta o seu número (ADR-012 · Rev. 2) |
| **Status** | Chip colorido — Rascunho, Em Revisão, Assinado ou Registado |
| **Vigência** | A situação atual de uma decisão assinada — ver [Status e vigência](#standing); vazia até ser assinada |
| **Título** | Título do ADR |
| **Decisão** | Trecho em texto simples da decisão |
| **Cards vinculados** | Pílulas coloridas correspondentes à cor do tipo de cada card vinculado |
| **Criado por** | Autor do ADR |
| **Criado** | Data de criação |
| **Modificado** | Data da última modificação |
| **Assinado** | Data de assinatura |
| **Assinado por** | Uma pílula por signatário que assinou |
| **Decidida em** / **Em vigor desde** / **Válida até** | As [datas](#decision-dates) da decisão |
| **Decisores** | As pessoas que tomaram a decisão |

Cada coluna possui um **filtro de cabeçalho** — filtros de texto nas colunas de texto, filtros de data nas colunas de data — cada um com seu próprio botão **Redefinir**. Assim que algum filtro de coluna está ativo, um botão **Limpar filtros de coluna** aparece na barra de ferramentas da grade para limpá-los todos de uma vez. Largura, ordem e ordenação das colunas e os filtros ativos são lembrados por navegador.

#### Barra lateral de filtros

A barra lateral persistente à esquerda tem duas abas:

- **Filtros** — filtros de facetas sobre a lista de ADRs:
    - **Em vigor** — um clique mostra apenas as decisões em vigor hoje (Em vigor e Em vigor (alterada)); clique novamente para o limpar
    - **Mostrar revisões anteriores** — desativado por predefinição, para que cada decisão apareça uma só vez, como a sua revisão atual (mais uma revisão em redação). Ative-o para listar também as revisões anteriores; o botão **Exportar** segue a mesma opção
    - **Tipos de card** — caixas de seleção com pontos coloridos que filtram por tipos de cards vinculados
    - **Cards vinculados** — filtrar por cards vinculados específicos
    - **Status** — Rascunho / Em Revisão / Assinado (uma decisão registada conta como assinada)
    - **Vigência** — Agendada / Em vigor / Em vigor (alterada) / Substituída / Revogada / Expirada / Ainda não assinada
    - **Assinado por** — filtrar por signatário
    - **Data de criação / modificação / assinatura / da decisão** — intervalos de datas de/até (**Data da decisão** corresponde à data *Decidida em* de uma decisão assinada ou registada)
- **Colunas** — escolha quais colunas da grade ficam visíveis. **N.º de ref.** e **Título** são sempre exibidos; **Redefinir** restaura a seleção padrão. Sua escolha é lembrada por navegador.

Use a barra de **filtro rápido** para pesquisa de texto completo. Clique com o botão direito em qualquer linha para um menu de contexto (**Editar**, **Pré-visualizar**, **Duplicar**, **Excluir**).

#### Exportar e importar decisões {: #decisions-import }

**Exportar** (junto a **+ Nova decisão**) transfere as decisões que a barra lateral de filtros mostra atualmente como um ficheiro `.xlsx`, uma linha por revisão de decisão. As colunas, por ordem: `reference_number`, `title`, `status`, `revision_number`, as quatro secções (`context`, `decision`, `consequences`, `alternatives_considered`) como texto simples, `cards` e `related_decisions` (separadas por ponto e vírgula), `author`, `signatories`, `signed_at`, `created_at`, `updated_at`, e depois os dados próprios do registo — `standing` (como chave, por exemplo `in_force`), `decided_on`, `effective_from`, `valid_until`, `decision_makers`, `participants`, e as ligações tipificadas `replaces`, `amends`, `revokes` e `consolidates` como referências. A formatação, como o negrito ou as ligações, não passa para a folha de cálculo. Para partilhar decisões com toda a formatação, selecione linhas na grelha e utilize o botão **Export** da própria grelha, que gera um documento Word.

**Importar** cria decisões em massa a partir de um ficheiro `.xlsx`. Clique em **Transferir modelo** para obter um livro inicial, preencha uma decisão por linha e carregue-o:

- Cada linha torna-se uma nova decisão em **rascunho** com a próxima referência `ADR-NNN`. O estado e as assinaturas nunca são importados — uma decisão é assinada através do **fluxo de assinatura** — e a pré-visualização avisa sobre uma linha cujo `status` não seja rascunho (draft).
- Uma linha cuja `reference_number` já pertence a uma decisão é **ignorada**: a importação nunca altera uma decisão existente, pelo que reimportar uma exportação não altera nada.
- `title` é obrigatório. Nas quatro colunas de secção, uma linha em branco inicia um novo parágrafo, as linhas que começam por `- ` tornam-se uma lista com marcadores e as que começam por `1. ` uma lista numerada.
- `cards` associa fichas pelo nome exato, entre as fichas que pode ver; uma ficha que não é encontrada, ou cujo nome é partilhado por várias fichas, é ignorada com um aviso e a decisão é importada na mesma.
- `related_decisions` lista referências, quer de decisões existentes, quer de outras linhas do mesmo ficheiro (mesmo linhas posteriores); cada uma torna-se uma ligação **Relaciona-se com**. Uma referência com várias revisões liga-se à revisão atual.
- Todas as outras colunas — vigência, datas, pessoas e ligações tipificadas incluídas — são ignoradas: uma importação cria rascunhos, nunca decisões assinadas ou registadas.
- Uma exportação contém uma linha por revisão, pelo que um ficheiro pode ter várias linhas para a mesma referência (uma revisão aberta, ou revisões anteriores quando **Mostrar revisões anteriores** está ativo). Na instância de origem são todas ignoradas; noutras instâncias apenas a linha com o `revision_number` mais alto é importada (a última linha quando os números são iguais ou estão em falta) e cada uma das outras linhas é ignorada com o aviso *Revisão anterior de ADR-012 ignorada*. Uma entrada de `related_decisions` que indique essa referência liga-se à linha importada.

A pré-visualização mostra quantas linhas serão criadas, ignoradas e quantas falharão, com cada erro e aviso listado por linha; nada é escrito até confirmar. A importação requer a permissão `adr.manage`.

#### Criar um ADR

Os ADR podem ser criados a partir de três locais — todos abrem o mesmo editor e alimentam o mesmo registro:

1. **GRC → Governança → Decisões**: clique em **+ Novo ADR**, preencha o título e opcionalmente vincule cards (incluindo iniciativas).
2. **Espaço de trabalho de Entregas de EA**: selecione uma iniciativa, clique em **+ Novo artefato ▾** no cabeçalho da página (ou **+ Adicionar** na secção *Decisões de Arquitetura*) e escolha **Nova Decisão de Arquitetura** — a iniciativa fica pré-vinculada.
3. **Card → aba Recursos**: clique em **Criar ADR** — o card atual fica pré-vinculado.

Em todos os casos você pode pesquisar e vincular cards adicionais durante a criação. As iniciativas são vinculadas através do mesmo mecanismo de vinculação de cards de qualquer outro card, de modo que um ADR pode referenciar múltiplas iniciativas. O editor abre com seções para **Contexto**, **Decisão**, **Consequências** e **Alternativas Consideradas**.

#### O Editor de ADR

O editor oferece:

- Edição de texto rico para cada seção (Contexto, Decisão, Consequências, Alternativas Consideradas)
- Vinculação de cards — conecte o ADR a cards relevantes (aplicações, componentes de TI, iniciativas, …). As iniciativas são vinculadas através da vinculação padrão de cards, não por um campo dedicado, permitindo que um ADR referencie múltiplas iniciativas
- **Datas** — *Decidida em*, *Em vigor desde* e um *Válida até* opcional (ver [Datas](#decision-dates))
- **Pessoas** — os *Decisores* e os *Participantes* (ver [Pessoas](#decision-people))
- **Esta decisão…** — ligações tipificadas a outras decisões (ver [Ligações entre decisões](#decision-links))
- **Resumo das alterações** — apenas numa revisão: o que mudou nesta revisão e porquê
- **Ficheiros** — documentos anexados à decisão (ver [Ficheiros](#decision-files))

#### Datas {: #decision-dates }

- **Decidida em** — o dia em que a decisão foi tomada. Não pode estar no futuro.
- **Em vigor desde** — o dia em que entra em vigor. Até lá, uma decisão assinada está **Agendada**.
- **Válida até** — opcional, para uma decisão com prazo limitado, como uma derrogação. No dia seguinte, a decisão fica **Expirada**. Não pode ser anterior a *Em vigor desde*, nem já ter passado quando a decisão é enviada para revisão.

Se ficarem vazias, *Decidida em* e *Em vigor desde* assumem a data da assinatura final. A renovação de uma decisão expirada é uma nova revisão ou uma nova decisão, assinada como qualquer outra.

#### Pessoas {: #decision-people }

Os **Decisores** são as pessoas que tomaram a decisão; os **Participantes** são as pessoas que nela participaram. Escolha um utilizador do Turbo EA, ou escreva um nome e prima Enter para alguém que não tem conta. Ambos são registados separadamente dos **signatários**, que aprovam o registo no Turbo EA. Ao solicitar assinaturas, **Adicionar decisores** na caixa de diálogo adiciona aos signatários, com um só clique, todos os decisores que são utilizadores do Turbo EA.

#### Ligações entre decisões {: #decision-links }

A secção **Esta decisão…** de uma decisão liga-a a outras. Escolha o tipo de ligação e a decisão e, opcionalmente, acrescente uma nota para um caso parcial — por exemplo *apenas a secção 3*:

| Ligação | Mostrada na outra decisão como | Efeito quando esta decisão está assinada e efetiva |
|---------|--------------------------------|----------------------------------------------------|
| **Substitui** | Substituída por | A outra decisão fica **Substituída** |
| **Altera** | Alterada por | A outra decisão fica **Em vigor (alterada)** |
| **Revoga** | Revogada por | A outra decisão fica **Revogada** |
| **Relaciona-se com** | Relacionada com | Nenhum — uma referência cruzada |

As ligações são mostradas em ambas as decisões e apontam para a revisão atual da decisão. Atuam sobre a decisão inteira, incluindo todas as suas revisões, e só depois de a decisão que as contém estar assinada e efetiva: um rascunho que revoga outra decisão não altera nada até ser assinado, e um com uma data *Em vigor desde* posterior atua nessa data (a outra decisão indica *Esta decisão será revogada por … em …*). Uma decisão não pode ligar-se a uma das suas próprias revisões, e todas as decisões a que se liga têm de estar assinadas antes de ser enviada para revisão ou registada.

#### Revogar ou substituir uma decisão

Uma decisão assinada nunca é retirada manualmente: é revogada ou substituída por outra decisão assinada, para que o registo guarde quem a decidiu e quando. Abra a decisão assinada e utilize o menu **Revisar**:

- **Revisar esta decisão** — uma nova revisão da mesma decisão, com a mesma referência (ver [Revisões](#revisions)).
- **Substituir por uma nova decisão** — um novo rascunho intitulado *Substitui: …* que já contém uma ligação **Substitui** e os mesmos cards vinculados.
- **Revogar** — um novo rascunho intitulado *Revogação de ADR-012 — …* que já contém uma ligação **Revoga** e os mesmos cards vinculados.

Complete o novo rascunho e envie-o pelo fluxo de assinatura como qualquer outra decisão. O menu não está disponível numa revisão anterior (abra a atual) nem numa decisão já revogada ou substituída. Quando uma decisão assinada substitui, altera ou revoga outra, o autor dessa decisão recebe uma notificação **Vigência de ADR alterada**.

#### Alterações e revisões consolidadas {: #amendments-and-consolidated-revisions }

Uma decisão alterada por outra continua em vigor, e a sua página lista as decisões que a alteram. Para dar aos leitores um único texto atual, clique em **Criar revisão consolidada** nesse banner: inicia uma revisão da decisão alterada que indica a decisão que a altera (*Consolida a alteração de …*). Integre a alteração no texto, descreva-a no **Resumo das alterações** e envie a revisão para assinatura. Quando estiver assinada e efetiva, a decisão volta a estar **Em vigor**, e a decisão que a alterava mostra *A alteração feita por esta decisão está consolidada em …*. Uma alteração também deixa de contar quando a decisão que a faz é revogada, substituída ou expira — mas não quando é apenas revisada: a sua revisão mantém a alteração, e o banner indica a revisão atual da decisão que a faz.

#### Ficheiros {: #decision-files }

A secção **Ficheiros** anexa documentos a uma decisão — uma ata assinada, uma análise de suporte. Os ficheiros aceitam os mesmos formatos que os [anexos dos cards](card-details.md#resources-tab), até 20 MB cada, e só podem ser carregados enquanto o carregamento de ficheiros estiver ativado (eliminar um é sempre possível). Só podem ser adicionados e eliminados num rascunho guardado: assim que a decisão é enviada para revisão, ficam bloqueados com ela. Uma revisão transporta os ficheiros da sua decisão.

#### Fluxo de Assinatura

Os ADR suportam um processo formal de assinatura:

1. Crie o ADR no status **Rascunho**.
2. Clique em **Solicitar Assinaturas** e pesquise signatários por nome ou e-mail (ou clique em **Adicionar decisores**). Só é possível solicitar assinaturas a partir de um rascunho.
3. O ADR passa para **Em Revisão** — cada signatário recebe uma notificação e uma tarefa.
4. Os signatários revisam e clicam em **Assinar**.
5. Quando todos os signatários assinarem, o ADR passa automaticamente para o status **Assinado**.

**Uma decisão em revisão fica bloqueada**, para que os signatários assinem exatamente o que lhes foi enviado: o texto, as datas, as pessoas, as ligações, os ficheiros e os painéis de extensões ficam só de leitura, e apenas os cards vinculados ainda podem mudar. Para a editar, clique em **Recolher assinaturas**, o que a devolve a rascunho. Um signatário que clique em **Rejeitar** também a devolve a rascunho, com o mesmo número de revisão.

ADR assinados ficam bloqueados e não podem ser editados — para mudanças crie uma nova revisão.

#### Registar uma decisão passada {: #recording-a-past-decision }

Uma decisão tomada fora do Turbo EA — numa reunião do conselho de administração antes de o registo existir, por exemplo — pode ser introduzida como decidida sem recolher assinaturas. Redija-a como rascunho, indique pelo menos um decisor, clique em **Registar como decidida** e indique a data **Decidida em** (não no futuro) e, se for diferente, a data **Em vigor desde** (por predefinição, a data da decisão).

A decisão fica então bloqueada como uma decisão assinada e recebe a sua vigência, mas o seu status indica **Registado**, e a sua página diz *Registada por … em …, não assinada no Turbo EA*. O registo exige a permissão `adr.record`, que por predefinição só o papel Admin tem, e cada registo aparece no [registo de Segurança e administração](../admin/audit-log.md) como `admin.adr.recorded`. Um rascunho de revisão também pode ser registado, desde que a sua data de decisão não seja anterior à da revisão anterior.

#### Revisões {: #revisions }

Abra um ADR assinado e escolha **Revisar → Revisar esta decisão** para criar um novo rascunho baseado na versão assinada. A revisão mantém a referência da decisão e recebe o número de revisão seguinte — **ADR-012 · Rev. 2** — e herda o conteúdo, os cards vinculados, as ligações **Relaciona-se com**, as pessoas, os ficheiros e a data *Válida até*. Não herda as datas de decisão e de entrada em vigor, os signatários, o resumo das alterações nem as ligações substitui / altera / revoga, que ficam na revisão que as criou. Cada revisão mantém o seu próprio rastro de assinaturas.

- **Uma revisão aberta de cada vez.** Enquanto uma revisão está a ser redigida, a revisão atual indica-o e o menu **Revisar** abre esse rascunho em vez de iniciar outro.
- **A revisão atual é a que está em vigor.** Quando uma revisão está assinada e efetiva, as anteriores ficam **Substituídas** e mostram um banner com uma ligação para a atual. A faixa **Revisões** em cada revisão lista a cadeia completa e assinala a atual.
- **Só a revisão atual pode ser revisada**, e não depois de a decisão ter sido revogada ou substituída. Uma decisão expirada ou alterada ainda pode ser revisada.
- **Uma rejeição não conta como revisão**: o número de revisão só muda quando é criada uma nova revisão.
- As decisões revisadas antes da versão 2.199.0 mantêm os números de referência com que foram emitidas, e continuam a ler-se como uma única decisão com uma única faixa de revisões.

#### Pré-visualização

Clique no ícone de pré-visualização para ver uma versão somente leitura e formatada do ADR — útil para revisão antes de assinar.

Na pré-visualização, clique em **PDF** para abrir uma cópia pronta para impressão em uma nova aba — metadados e datas, as quatro seções, pessoas, cartões vinculados, ligações a outras decisões, nomes dos ficheiros, seções de extensões e o bloco de assinaturas (ou a linha de registo), com o aprovador e a data de impressão no rodapé. O editor tem o mesmo botão **PDF** mais **Word**, que baixa a decisão como `.docx` enquanto ela não estiver assinada; ambos exportam o estado atual do editor, incluindo alterações não salvas.

## Risco

![GRC — Registro de riscos](../assets/img/pt/53_grc_registo_riscos.png)

Incorpora o **Registro de riscos** TOGAF Fase G. Ciclo de vida completo, fluxo de status, alternadores da matriz e comportamento dos proprietários estão documentados no [guia do Registro de riscos](risks.md). Os pontos mais relevantes:

## Conformidade

![GRC — Registo de conformidade](../assets/img/pt/54_grc_conformidade.png)


A aba Conformidade é um registro de fonte dupla — descobertas podem ser **redigidas manualmente** por um revisor **ou** produzidas por uma **varredura IA** sob demanda contra as regulamentações habilitadas (EU AI Act, LGPD/GDPR, NIS2, DORA, SOC 2, ISO 27001 vêm habilitadas por padrão). Ambos os tipos de descoberta compartilham o mesmo ciclo de vida, podem ser promovidos a um Risco e bulk-actionados a partir da grade. Veja o [guia de Conformidade](compliance.md) para o ciclo de vida completo, o diálogo de criação manual, o fluxo de varredura, o detector semântico EU AI Act e o loop de promoção a Risco.

A mesma aba Conformidade também aparece no Detalhe do card (auto-ocultada quando o card não tem descobertas vinculadas), de modo que um Application Owner possa triar suas descobertas sem sair do card.

## Permissões

| Permissão | Papéis padrão |
|-----------|---------------|
| `grc.view` | admin, bpm_admin, member, viewer |
| `grc.manage` | admin, bpm_admin, member |
| `adr.view` / `adr.manage` / `adr.sign` | `adr.view`: admin, bpm_admin, member, viewer; `adr.manage` e `adr.sign`: admin, bpm_admin, member |
| `adr.record` | admin — [registar uma decisão passada como decidida](#recording-a-past-decision) |
| `risks.view` / `risks.manage` | ver [Registro de riscos § Permissões](risks.md) |
| `compliance.view` / `compliance.manage` | ver [TurboLens § Security & Compliance](turbolens.md) |

`grc.view` controla a visibilidade da própria rota GRC — sem ele, a entrada do menu superior fica oculta. Cada aba ainda impõe sua própria permissão de domínio, de modo que uma visualizadora possa ler o registro sem poder disparar uma varredura LLM, por exemplo.
