# Cálculos

O recurso de **Cálculos** (**Admin > Metamodelo > aba Cálculos**) permite definir **fórmulas que computam automaticamente valores de campos** quando cards são salvos. Isso é poderoso para derivar métricas, pontuações e agregações dos seus dados de arquitetura.

## Como Funciona

1. Um administrador define uma fórmula direcionada a um tipo de card e campo específicos
2. Quando qualquer card desse tipo é criado ou atualizado, a fórmula é executada automaticamente
3. O resultado é gravado no campo alvo
4. O campo alvo é marcado como **somente leitura** na página de detalhe do card (usuários veem um badge "calculado")

## Criando um Cálculo

Clique em **+ Novo Cálculo** e configure:

| Campo | Descrição |
|-------|-----------|
| **Nome** | Nome descritivo para o cálculo |
| **Tipo Alvo** | O tipo de card ao qual este cálculo se aplica |
| **Campo Alvo** | O campo onde o resultado é armazenado |
| **Fórmula** | A expressão a ser avaliada (veja a sintaxe abaixo) |
| **Ordem de Execução** | Ordem de execução quando múltiplos cálculos existem para o mesmo tipo (menor executa primeiro) |
| **Ativo** | Habilitar ou desabilitar o cálculo |

## Sintaxe de Fórmulas

Fórmulas usam uma linguagem de expressão segura e isolada. Você pode referenciar os campos do card atual, os cards relacionados e filhos, o card pai e as datas do ciclo de vida.

!!! warning "Use a chave do campo, não o rótulo"
    Campos são referenciados pela sua **chave**, normalmente em camelCase
    (`costTotalAnnual`), e não pelo rótulo exibido no card (`Custo anual total`). Um nome que
    não existe é resolvido como `None`, e qualquer operação aritmética sobre `None` falha com
    um **erro de avaliação** genérico.

    Você encontra a chave em **Admin > Metamodelo >** *(tipo de card)*, abrindo o campo e lendo
    a sua **Chave**. Mais simples: no editor de fórmulas, os chips abaixo da caixa de fórmula
    listam `data.<chave>` para cada campo do tipo selecionado, e digitar `data.` abre o
    autocompletar.

### Variáveis de Contexto

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `data.<chaveDoCampo>` | Qualquer campo personalizado do card atual, pela sua chave | `data.costTotalAnnual` |
| `data.name`, `data.description`, `data.status`, `data.subtype`, `data.approval_status`, `data.reference` | Propriedades internas do card | `data.subtype` |
| `data.lifecycle.<fase>` | Datas do ciclo de vida, onde a fase é `plan`, `phaseIn`, `active`, `phaseOut` ou `endOfLife` | `data.lifecycle.endOfLife` |
| `relations.<chaveDoTipoDeRelação>` | Array dos cards ligados por esse tipo de relação, em qualquer direção | `relations.relAppToITC` |
| `relation_count.<chaveDoTipoDeRelação>` | Número de cards ligados por esse tipo de relação | `relation_count.relAppToITC` |
| `children` | Array dos cards filhos diretos (tipos hierárquicos) | `SUM(PLUCK(children, "attributes.costTotalAnnual"))` |
| `children_count` | Número de filhos diretos | `children_count` |
| `parent` | O card pai (objeto com `id`, `name`, `type`, `subtype`, `attributes`), ou `None` para um card raiz | `IF(parent, parent.attributes.businessCriticality, data.businessCriticality)` |
| `hierarchy_level` | Profundidade do card atual na sua hierarquia pai-filho (`1` = raiz, sem limite). `1` para tipos de card não hierárquicos | `hierarchy_level * 10` |

A chave do tipo de relação é a que aparece em **Admin > Metamodelo > Relações**, por exemplo
`relAppToITC` ou `relInitiativeToApp`. A direção não importa: um card encontra um tipo de
relação sob a mesma chave, esteja ele na ponta de origem ou de destino. Cards arquivados são
excluídos de `relations`, `relation_count` e `children`.

### Ler campos de um card relacionado

Cada item em `relations.<chaveDoTipoDeRelação>` e em `children` é um objeto invólucro, e não
os campos do card relacionado diretamente:

```json
{
  "id": "8f1c…",
  "name": "NexaCore ERP",
  "type": "Application",
  "attributes":     { "costTotalAnnual": 45000, "businessCriticality": "missionCritical" },
  "rel_attributes": { "costTotalAnnual": 12000 }
}
```

* `attributes` contém os valores dos campos do próprio card relacionado.
* `rel_attributes` contém os valores armazenados **no próprio vínculo**, se o tipo de relação
  definir um esquema de atributos. Por exemplo, `relAppToITC` carrega o seu próprio
  `costTotalAnnual`, de modo que você pode registrar o quanto uma aplicação gasta com um
  componente de TI específico.

Isso importa para `PLUCK` e `FILTER`, que recebem um caminho de chave e por isso precisam do
prefixo `attributes.` para alcançar um campo:

```
# Somar o custo anual dos componentes de TI que esta aplicação usa
SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))

# Somar, em vez disso, o custo registrado em cada vínculo aplicação-componente
SUM(PLUCK(relations.relAppToITC, "rel_attributes.costTotalAnnual"))
```

Extrair uma chave simples como `"costTotalAnnual"` procura por ela no objeto invólucro, não
encontra nada e devolve uma lista de `None`, que `SUM` apresenta como `0`. Uma fórmula sobre
relações que insiste em devolver `0` é quase sempre um prefixo `attributes.` faltando.

### Lidando com valores vazios

Um campo sem valor é resolvido como `None`, e `None` em uma expressão aritmética gera erro.
Envolva com `COALESCE` todo campo que possa estar vazio:

```
COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0) + COALESCE(data.infraCost, 0)
```

`SUM`, `AVG`, `MIN` e `MAX` já ignoram entradas não numéricas, portanto não precisam de
proteção.

### Dados de PPM em cards de Iniciativa

As linhas de orçamento e de custo do módulo PPM não fazem parte do contexto das fórmulas, mas
os seus totais são consolidados no card de Iniciativa como atributos comuns, de modo que uma
fórmula pode lê-los:

* `data.costBudget` é a soma de todas as linhas de orçamento PPM da iniciativa.
* `data.costActual` é a soma dos realizados de todas as linhas de custo PPM.

Ambos são totais que combinam capex e opex. A abertura por categoria e por exercício fiscal
permanece nas tabelas do PPM e não é exposta às fórmulas. Como o PPM é dono desses dois campos
assim que a iniciativa tem linhas de orçamento ou de custo, você pode lê-los, mas não pode
usá-los como campo alvo de um cálculo.

A partir de outro card, leia-os através da relação como de costume:

```
SUM(PLUCK(relations.relInitiativeToApp, "attributes.costBudget"))
```

!!! warning "Edições no PPM não disparam recálculo"
    Adicionar ou editar uma linha de orçamento ou de custo do PPM atualiza `costBudget` /
    `costActual` na iniciativa, mas não reexecuta os cálculos que os leem. Salve o card, ou
    execute o cálculo para o tipo, para atualizar tudo que derive desses dois campos.

### Funções Incorporadas

| Função | Descrição | Exemplo |
|--------|-----------|---------|
| `IF(condition, true_val, false_val)` | Lógica condicional. Apenas o ramo escolhido é avaliado | `IF(data.businessCriticality == "missionCritical", 100, 25)` |
| `SUM(array)` | Soma de valores numéricos | `SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `AVG(array)` | Média de valores numéricos | `AVG(PLUCK(children, "attributes.numberOfUsers"))` |
| `MIN(array)` | Valor mínimo | `MIN(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `MAX(array)` | Valor máximo | `MAX(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))` |
| `COUNT(array)` | Número de itens | `COUNT(relations.relAppToInterface)` |
| `ROUND(value, decimals)` | Arredondar um número | `ROUND(data.costTotalAnnual / 12, 2)` |
| `ABS(value)` | Valor absoluto | `ABS(data.budgetVariance)` |
| `LN(value)` | Logaritmo natural. Devolve `None` para zero, valores negativos e entradas não numéricas | `LN(data.numberOfUsers)` |
| `COALESCE(a, b, ...)` | Primeiro valor não nulo | `COALESCE(data.customScore, 0)` |
| `LOWER(text)` | Texto em minúsculas | `LOWER(data.productName)` |
| `UPPER(text)` | Texto em maiúsculas | `UPPER(data.subtype)` |
| `CONCAT(a, b, ...)` | Juntar strings | `CONCAT(data.name, " (", data.subtype, ")")` |
| `CONTAINS(text, search)` | Verificar se texto contém substring | `CONTAINS(data.description, "legacy")` |
| `PLUCK(array, caminho)` | Extrair um caminho de chave de cada item | `PLUCK(relations.relAppToITC, "attributes.costTotalAnnual")` |
| `FILTER(array, caminho, value)` | Manter os itens cujo caminho de chave é igual a um valor | `FILTER(relations.relOrgToApp, "attributes.hostingType", "onPremise")` |
| `MAP_SCORE(value, mapping)` | Mapear valores categóricos para pontuações | `MAP_SCORE(data.businessCriticality, {"missionCritical": 3, "businessCritical": 2})` |

As funções embutidas seguras do Python `len`, `str`, `int`, `float`, `bool`, `abs`, `round`,
`min`, `max` e `sum` também estão disponíveis, assim como os operadores e comparações usuais.

### Exemplos de Fórmulas { #example-formulas }

**Soma de vários campos de custo do mesmo card:**
```
COALESCE(data.licenseCost, 0) + COALESCE(data.supportCost, 0) + COALESCE(data.infraCost, 0)
```

**Custo anual total dos componentes de TI que uma aplicação usa:**
```
SUM(PLUCK(relations.relAppToITC, "attributes.costTotalAnnual"))
```

**Pontuação de risco baseada em criticidade:**
```
IF(data.businessCriticality == "missionCritical", 100, IF(data.businessCriticality == "businessCritical", 75, 25))
```

**Contagem de interfaces relacionadas:**
```
relation_count.relAppToInterface
```

**Contagem de aplicações on-premise em uma organização:**
```
COUNT(FILTER(relations.relOrgToApp, "attributes.hostingType", "onPremise"))
```

**Consolidar um custo a partir dos cards filhos:**
```
SUM(PLUCK(children, "attributes.costTotalAnnual"))
```

**Posicionamento TIME Model (Tolerar / Investir / Migrar / Eliminar)**, o mesmo exemplo que você verá no painel **Formula Reference** dentro de **Admin → Metamodelo → Cálculos** ao criar um novo cálculo. Tipo alvo = `Application`, campo alvo = `timeModel`. Assume que você adicionou dois campos `single_select` chamados `businessFit` e `technicalFit` com as opções `excellent`, `adequate`, `insufficient`, `unreasonable`:
```
# ── TIME Model (Tolerate / Invest / Migrate / Eliminate) ──
# Assumes single_select fields: businessFit and technicalFit
# with options: excellent, adequate, insufficient, unreasonable.
#
# Scoring: Map each dimension to 1-4 numeric scale.
# Business Fit  = Y-axis (how well does it serve the business?)
# Technical Fit = X-axis (how healthy is the technology?)
#
# Quadrant logic (threshold at score 2.5):
#   Invest    = high business + high technical
#   Migrate   = high business + low technical
#   Tolerate  = low business  + high technical
#   Eliminate = low business  + low technical
#
bf = MAP_SCORE(data.businessFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
tf = MAP_SCORE(data.technicalFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
IF(bf is None or tf is None, None, IF(bf >= 2.5, IF(tf >= 2.5, "invest", "migrate"), IF(tf >= 2.5, "tolerate", "eliminate")))
```

Como o exemplo mostra, uma fórmula pode ocupar várias linhas. Uma linha no formato
`nome = expressão` guarda um valor intermediário que as linhas seguintes podem reutilizar, e o
valor da última linha é o que é gravado no campo alvo.

Este é também o exemplo prático referenciado pelo [Guia do Iniciante em EA](../beginners-guide/customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation).

**Comentários** são suportados usando `#`:
```
# Calcular pontuação de risco ponderada
IF(data.businessCriticality == "missionCritical", data.riskScore * 2, data.riskScore)
```

## Validar e testar

O editor de fórmulas oferece duas verificações distintas, e elas se comportam de forma
diferente:

* **Validar** executa a fórmula contra um card sintético. Cada campo numérico recebe o valor
  fictício `1`, e o card **não tem relações, nem filhos, nem dados próprios de card pai**.
  Isso confirma que a sintaxe é analisada corretamente e que os nomes usados existem, mas uma
  fórmula que agrega sobre `relations` ou `children` sempre vai mostrar `0` ou um resultado
  vazio aqui. Isso é esperado e não indica uma fórmula quebrada.
* **Testar**, disponível em um cálculo salvo, é executado contra um card real escolhido por
  você. É a opção certa para tudo que envolva relações, filhos ou o card pai. Nada é gravado
  no card, o resultado é apenas exibido.

## Quando os cálculos são executados

Os cálculos de um card são reavaliados quando:

* o card é criado ou salvo;
* uma relação que toca o card é criada, atualizada ou removida (ambas as pontas da relação são
  recalculadas);
* o card é reatribuído a outro pai, o que recalcula toda a sua subárvore;
* você executa o cálculo manualmente a partir da lista, o que o avalia para cada card do tipo
  alvo e salva os resultados.

Eles **não** são reavaliados quando outro card do qual a fórmula lê é editado. Se você mudar
um custo em um componente de TI, a aplicação que o agrega não vai se mover até que essa
aplicação seja salva, uma relação dela mude, ou você execute o cálculo para o tipo. Para
agregações sobre dados mantidos por outras pessoas, execute o cálculo periodicamente ou após
uma importação em massa.

!!! note "Nota"
    O mesmo vale para os valores derivados de `parent` e `hierarchy_level`: eles são
    atualizados na reatribuição de pai e em uma execução manual, não a cada edição do card
    pai. Proteja sempre uma referência a `parent` com `IF(parent, …)` para que cards raiz,
    onde `parent` é `None`, não gerem erro.

## Ordem de Execução

Quando múltiplos cálculos direcionam o mesmo tipo de card, eles são executados na ordem especificada pelo valor da **ordem de execução**. Isso é importante quando um cálculo depende do resultado de outro: defina a dependência para executar primeiro (número menor).

O Turbo EA rejeita um conjunto de cálculos que formaria um ciclo, por exemplo um campo A calculado a partir do campo B enquanto B é calculado a partir de A.
