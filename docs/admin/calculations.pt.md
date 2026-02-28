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

Fórmulas usam uma linguagem de expressão segura e isolada. Você pode referenciar atributos do card, dados de cards relacionados e informações do ciclo de vida.

### Variáveis de Contexto

| Variável | Descrição | Exemplo |
|----------|-----------|---------|
| `fieldKey` | Qualquer atributo do card atual | `businessCriticality` |
| `related_{type_key}` | Array de cards relacionados de um determinado tipo | `related_applications` |
| `lifecycle_plan`, `lifecycle_active`, etc. | Valores de data do ciclo de vida | `lifecycle_endOfLife` |

### Funções Incorporadas

| Função | Descrição | Exemplo |
|--------|-----------|---------|
| `IF(condition, true_val, false_val)` | Lógica condicional | `IF(riskLevel == "critical", 100, 25)` |
| `SUM(array)` | Soma de valores numéricos | `SUM(PLUCK(related_applications, "costTotalAnnual"))` |
| `AVG(array)` | Média de valores numéricos | `AVG(PLUCK(related_applications, "dataQuality"))` |
| `MIN(array)` | Valor mínimo | `MIN(PLUCK(related_itcomponents, "riskScore"))` |
| `MAX(array)` | Valor máximo | `MAX(PLUCK(related_itcomponents, "costAnnual"))` |
| `COUNT(array)` | Número de itens | `COUNT(related_interfaces)` |
| `ROUND(value, decimals)` | Arredondar um número | `ROUND(avgCost, 2)` |
| `ABS(value)` | Valor absoluto | `ABS(delta)` |
| `COALESCE(a, b, ...)` | Primeiro valor não nulo | `COALESCE(customScore, 0)` |
| `LOWER(text)` | Texto em minúsculas | `LOWER(status)` |
| `UPPER(text)` | Texto em maiúsculas | `UPPER(category)` |
| `CONCAT(a, b, ...)` | Juntar strings | `CONCAT(firstName, " ", lastName)` |
| `CONTAINS(text, search)` | Verificar se texto contém substring | `CONTAINS(description, "legacy")` |
| `PLUCK(array, key)` | Extrair um campo de cada item | `PLUCK(related_applications, "name")` |
| `FILTER(array, key, value)` | Filtrar itens por valor de campo | `FILTER(related_interfaces, "status", "ACTIVE")` |
| `MAP_SCORE(value, mapping)` | Mapear valores categóricos para pontuações | `MAP_SCORE(criticality, {"high": 3, "medium": 2, "low": 1})` |

### Exemplos de Fórmulas

**Custo anual total de aplicações relacionadas:**
```
SUM(PLUCK(related_applications, "costTotalAnnual"))
```

**Pontuação de risco baseada em criticidade:**
```
IF(riskLevel == "critical", 100, IF(riskLevel == "high", 75, IF(riskLevel == "medium", 50, 25)))
```

**Contagem de interfaces ativas:**
```
COUNT(FILTER(related_interfaces, "status", "ACTIVE"))
```

**Comentários** são suportados usando `#`:
```
# Calcular pontuação de risco ponderada
IF(businessCriticality == "missionCritical", riskScore * 2, riskScore)
```

## Executando Cálculos

Cálculos são executados automaticamente quando um card é salvo. Você também pode acionar manualmente um cálculo para executar em todos os cards do tipo alvo:

1. Encontre o cálculo na lista
2. Clique no botão **Executar**
3. A fórmula é avaliada para cada card correspondente e os resultados são salvos

## Ordem de Execução

Quando múltiplos cálculos direcionam o mesmo tipo de card, eles são executados na ordem especificada pelo valor da **ordem de execução**. Isso é importante quando um cálculo depende do resultado de outro — defina a dependência para executar primeiro (número menor).
