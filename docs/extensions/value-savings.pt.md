# EA Value Tracker

Toda a função de EA acaba por ouvir a mesma pergunta do diretor financeiro ou do
CIO: *quanto vale realmente a arquitetura para nós?* Os roteiros e os diagramas
não respondem; os números respondem.

**EA Value Tracker** transforma as [decisões de arquitetura](../guide/delivery.md)
do Turbo EA num registo financeiro auditável do valor criado pela sua prática de
EA. O valor é declarado onde nasce — na decisão —, é congelado com a assinatura e
mais tarde reconciliado com o que foi realmente realizado, sob aprovação com
quatro olhos. Um painel consolida tudo, pelo que a resposta na revisão orçamental
é um relatório e não uma busca por folhas de cálculo.

## Em resumo

| | |
|---|---|
| **Licença** | Comercial — é necessário um direito assinado |
| **Versão mínima do Turbo EA** | 2.14.0 |
| **Permissões** | `ext.value-savings.record`, `ext.value-savings.approve` |
| **Autorizações de acesso a dados** | nenhuma |
| **Exige reiniciar o backend** | sim — inclui código de backend |
| **Onde aparece** | Painel **Valor e poupanças** nas decisões · registo **Realização de valor** por baixo do bloco de assinaturas · quatro colunas nas tabelas de decisões · **Relatórios → EA Value Tracker** |

## O ciclo de vida

O valor percorre quatro fases, apresentadas como uma sequência em cada decisão:

**Declarado (rascunho)** › **Declarado (aprovado)** › **Realizado (pendente)** ›
**Realizado (aprovado)**

1. Enquanto uma decisão está a ser redigida, os arquitetos anexam-lhe **poupanças
   declaradas**.
2. **A assinatura congela-as.** Os valores aprovados pelos signatários passam a
   declarações aprovadas e deixam de poder ser editados.
3. Depois da execução, alguém **regista o que foi realmente realizado** face a cada
   declaração.
4. Uma **segunda pessoa aprova** a realização — quem regista nunca pode aprovar os
   seus próprios números.

## Declarar valor numa decisão

Abra um rascunho de decisão (**EA Delivery → Decisões**) e desça até **Valor e
poupanças**, logo a seguir às consequências.

![O painel «Valor e poupanças» num rascunho de decisão](../assets/img/en/66_ext_value_tracker_claims.png)

Prima **Adicionar poupança** e preencha a caixa de diálogo:

| Campo | Notas |
|---|---|
| **Categoria** | **Poupanças diretas**, **Poupanças indiretas**, **Custos evitados**, **Viabilização de receitas** ou **Riscos evitados** |
| **Montante** | Na moeda do seu espaço de trabalho. Tem de ser superior a zero |
| **Ano fiscal** | Derivado do início do exercício definido nas [Definições gerais](../admin/settings.md) |
| **Tipo** | **Pontual** ou **Recorrente** |
| **Responsável** | Uma ou mais pessoas que respondem pelo valor |
| **Descrição** | Texto livre opcional |

Acrescente tantas declarações quantas a decisão justificar. Junto ao título do
painel é apresentado um total acumulado e, por baixo, uma etiqueta por categoria.

!!! note "«Recorrente» é informativo"
    Uma entrada **recorrente** permanece no ano fiscal que lhe atribuiu — nunca é
    projetada automaticamente para exercícios seguintes. A distinção existe para
    que quem lê diferencie uma poupança anual recorrente de uma pontual, e para
    que o painel apresente separadamente o montante recorrente anual.

Editar declarações exige a permissão habitual `adr.manage`.

## O que acontece na assinatura

Quando os signatários assinam a decisão, o Turbo EA congela a decisão inteira,
incluindo as declarações. O editor desaparece do corpo do documento e:

- as declarações passam a **Declarado (aprovado)** e ficam só de leitura;
- surge um registo **Realização de valor** **por baixo do bloco de assinaturas**;
- no cabeçalho da decisão surgem um botão **Realização de valor** e as etiquetas
  **Declarado** e **Realizado**, ao lado de Duplicar e Nova revisão.

Para alterar um valor aprovado, crie uma **nova revisão** da decisão. É
deliberado: os números que os signatários aprovaram permanecem exatamente como os
aprovaram.

## Registar e aprovar o valor realizado

![O registo «Realização de valor» por baixo do bloco de assinaturas](../assets/img/en/67_ext_value_tracker_realization.png)

**Registar.** Quem tiver `ext.value-savings.record` vê um botão **Registar** em
cada declaração aprovada ainda sem realização. A caixa de diálogo pede o
**montante** efetivo, o **ano fiscal**, uma pessoa **aprovadora** e uma descrição
opcional.

A pessoa aprovadora **tem de ser diferente de quem regista** — uma regra dos
quatro olhos imposta pelo servidor, não apenas pelo formulário. Ao guardar, a
linha é criada como **Pendente** e é gerada uma tarefa para quem aprova («Aprovar
valor realizado: …») ligada à decisão, com a notificação de atribuição habitual.

**Aprovar.** A pessoa designada — que também precisa de
`ext.value-savings.approve` — abre a decisão e prime **Aprovar** ou **Rejeitar** na
linha pendente. A tarefa é concluída e o valor passa a **Realizado (aprovado)**.
As linhas rejeitadas são conservadas para a trilha de auditoria.

**Correções.**

- Só quem decidiu pode inverter mais tarde a sua decisão ou premir **Retirar
  decisão** para devolver a linha a pendente (o que reabre a tarefa).
- Só quem registou pode eliminar a sua própria linha, e apenas enquanto estiver
  pendente. Quem aprova rejeita em vez de eliminar.
- Para corrigir um valor já aprovado, registe uma **nova entrada de ajuste** em vez
  de alterar o histórico.

## O painel

**Relatórios → EA Value Tracker** consolida tudo.

![O painel do EA Value Tracker](../assets/img/en/68_ext_value_tracker_dashboard.png)

**Barra de ferramentas**

- **Declarado** / **Realizado** — a base de todo o relatório: valor *declarado* nas
  decisões ou valor efetivamente *realizado*.
- **Ano fiscal** — o exercício em curso vem pré-selecionado; desmarque tudo para
  ver todos os anos.
- Filtros de **Categoria** e **Pessoa**.
- **Incluir rascunhos** ou **Incluir pendentes**.

**Indicadores** — Realizado (aprovado), Declarações aprovadas, Recorrente (anual),
Rascunho e o número de decisões que contribuem.

O **funil de poupanças** mostra as quatro fases lado a lado, tornando imediata a
diferença entre o prometido e o concretizado.

![Poupanças por categoria](../assets/img/en/69_ext_value_tracker_categories.png)

**Poupanças por categoria** é um anel com o total ao centro. **Poupanças por
pessoa (repartição igual)** atribui a uma entrada com *N* responsáveis
*montante ÷ N* a cada um, para que nenhum valor seja contado duas vezes.

![Poupanças por ano fiscal](../assets/img/en/70_ext_value_tracker_fiscal_years.png)

**Poupanças por ano fiscal** abrange uma janela fixa de quatro anos para trás a
dois anos para a frente e ignora deliberadamente o filtro de exercício, para que a
tendência permaneça sempre legível.

Duas tabelas completam o quadro: a **repartição por pessoa** e as **decisões que
contribuem** — o registo completo, com uma ligação **Abrir** para cada decisão.

O relatório guarda-se, partilha-se, imprime-se e exporta-se para XLSX e PPTX como
qualquer relatório do núcleo, podendo seguir diretamente para um dossiê de comité
de acompanhamento.

## Nas tabelas de decisões

São acrescentadas quatro colunas à tabela de decisões partilhada, tanto em
**EA Delivery → Decisões** como em **GRC → Governação → Decisões**:

| Coluna | Mostra |
|---|---|
| **Poupanças declaradas** | Total declarado nessa decisão |
| **Realizado** | Total das realizações aprovadas |
| **Aprovador de poupanças** | Quem aprovou as realizações |
| **Fase das poupanças** | A fase mais avançada alcançada |

Comportam-se como colunas nativas — ordenação, filtro rápido e tema funcionam — e
podem ser ocultadas ou fixadas a partir do seletor de colunas.

## Permissões

| Permissão | Permite |
|---|---|
| `adr.view` (núcleo) | Ver os painéis, as colunas e o painel de valor |
| `adr.manage` (núcleo) | Acrescentar, editar e eliminar declarações numa decisão não assinada |
| `ext.value-savings.record` | Registar uma realização face a uma declaração aprovada |
| `ext.value-savings.approve` | Aprovar ou rejeitar uma realização — **e** ser a pessoa designada como aprovadora |

Atribua as duas permissões da extensão em **Admin → Utilizadores e papéis**. Note
que `ext.value-savings.approve` não basta por si só: o servidor verifica também
que é você a pessoa aprovadora designada nessa linha.

## Se a licença expirar ou a extensão for desativada

Os painéis, as colunas e o painel de valor desaparecem, mas **nada é eliminado**.
As declarações residem na própria decisão e acompanham uma transferência de espaço
de trabalho; as realizações permanecem nas tabelas próprias da extensão. Uma
licença renovada repõe tudo.

## Notas e limitações

- As poupanças **não** são deliberadamente incluídas na exportação para Word da
  decisão: essa exportação é o documento de decisão, não o registo financeiro.
- As realizações registam-se face a uma declaração aprovada, pelo que uma decisão
  tem de estar assinada antes de se poder realizar valor contra ela.
- A extensão inclui código de backend, pelo que instalá-la ou atualizá-la exige um
  reinício pontual do backend. O Turbo EA mostra então um aviso.
