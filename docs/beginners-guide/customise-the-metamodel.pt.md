# Personalize o Metamodelo — Levemente

O metamodelo do Turbo EA é totalmente **configurável pelo administrador** — cada tipo de card, campo, subtipo, relação e papel de stakeholder é dado, não código. Você será tentado a redesenhá-lo. **Não faça isso.**

As equipes que têm sucesso personalizam o metamodelo **apenas quando os campos padrão não conseguem responder à sua pergunta**. As equipes que fracassam gastam seu primeiro mês renomeando `Application` para `Solution`, adicionando 30 campos personalizados e nunca chegam a um relatório funcional.

## O que já existe no metamodelo

Antes de adicionar qualquer coisa, conheça o que você já tem. O tipo de card **Application** integrado vem com estes campos prontos para uso (entre outros):

| Campo integrado | Tipo | Para que serve |
|-----------------|------|----------------|
| `businessCriticality` | `single_select` | Mission-critical / Important / Useful / Marginal |
| `functionalSuitability` | `single_select` | Perfect / Appropriate / Insufficient / Unreasonable |
| `technicalSuitability` | `single_select` | Fully Appropriate / Adequate / Unreasonable / Inappropriate |
| `timeModel` | `single_select` (obrigatório) | **Tolerar / Investir / Migrar / Eliminar** — a disposição canônica TIME do Gartner |
| `riskLevel` | `single_select` | Low / Medium / High / Critical |
| `businessValue` | `single_select` | Conduz o eixo Y do Relatório de Portfólio |
| `costTotalAnnual` | `cost` | Custo anual total |
| `lifecycle.*` | datas | Plan / Phase In / Active / Phase Out / End of Life |

Tudo o que uma Racionalização do Portfólio de Aplicações precisa já está lá, incluindo o **TIME Model**. Você não precisa adicionar um campo TIME — você o preenche (manualmente ou via um cálculo, veja [Sua Primeira Análise](your-first-analysis.md)). O mesmo vale para `functionalSuitability` e `technicalSuitability`, as duas dimensões de adequação que classicamente conduzem o posicionamento TIME.

## O teste das duas perguntas antes de adicionar um campo

Quando você de fato se vir precisando de um campo que genuinamente não está no metamodelo, pergunte-se:

1. **Vou filtrar, agrupar ou relatar sobre este campo?** Se não, ele pertence à descrição ou a uma tag — não a um campo.
2. **A mesma resposta é necessária em cada card deste tipo?** Se não, é uma relação ou um anexo, não um campo.

Se você não consegue responder "sim" a ambas, não adicione o campo.

## Se você realmente precisa de um campo personalizado

Para o caso raro em que um campo genuinamente novo é necessário (por exemplo, uma flag `cloudReadiness`, uma classificação regulatória, um marcador de segmento de cliente), o fluxo é:

1. Vá para **Admin → Metamodelo**, clique no tipo, mude para a aba **Campos**.
2. Escolha a seção (ou crie uma nova) e clique em **+ Adicionar campo**.
3. Preencha:
    - **Chave** em lower camel-case (por exemplo, `cloudReadiness`) — torna-se a chave do atributo no JSON e nas fórmulas.
    - **Rótulo** (e uma tradução para cada localidade que você suporta — usuários não anglófonos verão a chave bruta caso contrário).
    - **Tipo** — `text`, `number`, `cost`, `boolean`, `date`, `url`, `single_select`, `multiple_select`.
    - **Peso** — `0` para excluir da Qualidade de Dados, `1`+ para incluir e ponderar.
    - **Obrigatório** — deixe **desligado** para o primeiro rollout; obrigatório bloqueia a aprovação de todo card existente.
4. Para tipos select, adicione as opções (chave + rótulo + cor) e traduza cada opção.
5. Salve.

O campo fica imediatamente disponível no **Inventário** (Colunas, filtros), no Detalhe do Card e em fórmulas de **Cálculos** como `<fieldKey>`. Referência completa: [Admin → Metamodelo](../admin/metamodel.md).

## Opção: derivar um campo automaticamente com um Cálculo { #option-derive-a-field-automatically-with-a-calculation }

Além da opção padrão de fazer com que os usuários preencham um campo manualmente, o Turbo EA pode **computar o valor de um campo automaticamente** a partir de outros campos no mesmo card — incluindo os integrados — usando o recurso **Cálculos**. O campo computado torna-se somente leitura e carrega um selo "calculado" para que os usuários não se desviem da regra.

O exemplo canônico é o cálculo **TIME Model** que deriva o campo integrado `timeModel` em Application a partir de uma dimensão de adequação de negócio e uma de adequação técnica. Ele vem como uma das entradas do painel **Formula Reference** dentro de **Admin → Metamodelo → Cálculos** quando você cria um novo cálculo, então você pode escolhê-lo diretamente do painel. Tipo alvo = `Application`, campo alvo = `timeModel`; a fórmula fornecida pelo painel está reproduzida em [Admin → Cálculos → Exemplos de Fórmulas](../admin/calculations.md#example-formulas).

A fórmula assume dois campos `single_select` chamados `businessFit` e `technicalFit` com as opções `excellent` / `adequate` / `insufficient` / `unreasonable`. Eles não estão no metamodelo integrado — adicione-os em Application seguindo os passos de campo personalizado acima se você quiser usar este cálculo.

!!! warning "Don't"
    Um TIME calculado é uma **hipótese inicial**, não um veredito. Ou revise cada resultado com o Dono da Aplicação antes de confiar nele, ou desligue o cálculo e confie na entrada manual uma vez que o workshop de validação esteja feito.

O padrão híbrido que funciona bem na prática: mantenha o cálculo ligado enquanto você está construindo o inventário e tem majoritariamente dados de adequação; desligue-o para o workshop de validação; depois deixe-o desligado para que as decisões manuais permaneçam.

## Alternativa: usar um Grupo de Tags

Se o valor é informativo em vez de consultável, um **Grupo de Tags** (Admin → Tags) é mais leve do que um campo personalizado — sem mudança de metamodelo, sem migração, mais fácil de evoluir. Use um Grupo de Tags quando:

- O valor é descritivo ("Voltado ao cliente", "Apenas interno", "Adquirido em 2024").
- Você pode adicionar novas opções com frequência.
- Você não precisa dele em um dropdown de filtro, mas um chip de tag com busca enquanto digita está bom.

Use um campo personalizado quando:

- Você precisa do valor nos eixos do Relatório de Portfólio (X, Y, cor).
- Você quer que seja ponderado na Qualidade de Dados.
- É um vocabulário controlado que não mudará com frequência.

## Antipadrões a evitar

Estes são os erros mais comuns de metamodelo em primeiros rollouts:

!!! warning "Não renomeie tipos de card integrados"
    Renomear `Application` para `Solution` parece arrumado mas quebra o mapeamento conceitual que o Mapa de Calor de Capacidades, o Relatório de Portfólio e os catálogos todos assumem. Se sua organização os chama de "Soluções", configure a tradução do **rótulo** — a `key` subjacente permanece como `Application`.

!!! warning "Não adicione 30 campos personalizados no primeiro dia"
    Cada campo personalizado adiciona atrito à coleta de dados e dilui a pontuação de Qualidade de Dados. Adicione um campo, use-o por um mês, depois adicione o próximo.

!!! warning "Não duplique campos integrados"
    Antes de adicionar `timeDisposition`, `funcFit`, `techFit` ou `appBusinessValue`, verifique a lista de campos existentes — provavelmente um campo integrado equivalente já existe (`timeModel`, `functionalSuitability`, `technicalSuitability`, `businessValue`). Duplicatas dividem seus dados e quebram relatórios.

!!! warning "Não torne novos campos `required` no primeiro dia"
    `Required` bloqueia a aprovação para todo card existente que não tenha um valor. Torne um campo obrigatório somente **depois** de tê-lo preenchido em 80%+ da população.

!!! warning "Não crie tipos de card personalizados em vez de campos personalizados"
    "Mobile App" deveria ser um subtipo de `Application`, não um novo tipo de card. Novos tipos não obtêm mapeamento de capacidades, relatórios de portfólio ou importações de catálogo de graça.

## Outras extensões leves que você pode querer

Estas são extensões comuns de segundo passe, mas **não as adicione até que você realmente precise**:

| Necessidade | Onde adicionar | Tipo |
|-------------|---------------|------|
| Prontidão para nuvem | Application | `single_select` (Pronto / Precisa refatorar / Fica on-premise) |
| Flag de voltado ao cliente | Application | `boolean` |
| Classificação regulatória | Application, DataObject | `multiple_select` (GDPR, PCI-DSS, …) |
| Categoria de risco de perda | Application, IT Component | `single_select` (Ponto único de falha, etc.) |
| Divisão de custos | Application | Campos `cost` adicionais para `costRunTotalAnnual`, `costChangeTotalAnnual` |

Cada um passa no teste das duas perguntas para análises de portfólio. Vários deles também são bons candidatos para uma fórmula **calculada** em vez de entrada manual — que é o que a próxima página cobre, usando o próprio `timeModel` como exemplo prático.

Próximo: [Sua primeira análise: Harmonização de Aplicações](your-first-analysis.md).
