# Personalize o Metamodelo — Levemente

O metamodelo do Turbo EA é totalmente **configurável pelo administrador** — cada tipo de card, campo, subtipo, relação e papel de stakeholder é dado, não código. Você será tentado a redesenhá-lo. **Não faça isso.**

As equipes que têm sucesso personalizam o metamodelo **apenas quando os campos padrão não conseguem responder à sua pergunta**. As equipes que fracassam gastam seu primeiro mês renomeando `Application` para `Solution`, adicionando 30 campos personalizados e nunca chegam a um relatório funcional.

## O que já existe no metamodelo

Antes de adicionar qualquer coisa, conheça o que você já tem. O tipo de card **Application** integrado vem com estes campos prontos para uso (entre outros):

| Campo integrado | Tipo | Para que serve |
|-----------------|------|----------------|
| `businessCriticality` | `single_select` (obrigatório) | Crítico para a missão / Crítico para o negócio / Operacional / Administrativo |
| `functionalSuitability` | `single_select` | Perfeito / Apropriado / Insuficiente / Inadequado |
| `technicalSuitability` | `single_select` | Totalmente apropriado / Adequado / Inadequado / Inapropriado |
| `timeModel` | `single_select` (obrigatório) | **Tolerar / Investir / Migrar / Eliminar** — a disposição canônica TIME do Gartner |
| `costTotalAnnual` | `cost` | Custo anual total |
| `lifecycle.*` | datas | Plan / Phase In / Active / Phase Out / End of Life |

Tudo o que uma Racionalização do Portfólio de Aplicações precisa já está lá, incluindo o **Modelo TIME**. Você não precisa adicionar um campo TIME — você o deriva com um cálculo (abaixo) ou o preenche manualmente, veja [Sua Primeira Análise](your-first-analysis.md). O mesmo vale para `functionalSuitability` e `technicalSuitability`, as duas dimensões de adequação que classicamente conduzem o posicionamento TIME, e para `businessCriticality`, que agrupa o relatório Portfólio de aplicações.

## O teste das duas perguntas antes de adicionar um campo

Quando você de fato se vir precisando de um campo que genuinamente não está no metamodelo, pergunte-se:

1. **Vou filtrar, agrupar ou relatar sobre este campo?** Se não, ele pertence à descrição ou a uma tag — não a um campo.
2. **A mesma resposta é necessária em cada card deste tipo?** Se não, é uma relação ou um anexo, não um campo.

Se você não consegue responder "sim" a ambas, não adicione o campo.

## Se você realmente precisa de um campo personalizado

Para o caso raro em que um campo genuinamente novo é necessário (por exemplo, uma flag `cloudReadiness`, uma classificação regulatória, um marcador de segmento de cliente), o fluxo é:

1. Vá para **Admin → Metamodelo** e clique no tipo. O layout do card está na aba **Geral**.
2. Escolha a seção (ou crie uma com **Adicionar seção**) e clique em **+ Campo**.
3. Preencha:
    - **Chave** em lower camel-case (por exemplo, `cloudReadiness`) — torna-se a chave do atributo no JSON e nas fórmulas.
    - **Rótulo** (e uma tradução para cada localidade que você suporta — usuários não anglófonos verão a chave bruta caso contrário).
    - **Tipo** — `text`, `multiline_text`, `number`, `cost`, `percentage`, `boolean`, `date`, `url`, `single_select`, `multiple_select`.
    - **Obrigatório** — deixe **desligado** para o primeiro rollout; enquanto um campo obrigatório estiver vazio, a pontuação de Qualidade de Dados do card fica fixada em 0.
4. Para tipos select, adicione as opções (chave + rótulo + cor) e traduza cada opção.
5. Salve.
6. Opcional: defina quanto o campo conta para a Qualidade de Dados na aba **Qualidade dos dados** do tipo.

O campo fica imediatamente disponível no **Inventário** (Colunas, filtros), no Detalhe do Card e em fórmulas de **Cálculos** como `<fieldKey>`. Referência completa: [Admin → Metamodelo](../admin/metamodel.md).

## Opção: derivar um campo automaticamente com um Cálculo { #option-derive-a-field-automatically-with-a-calculation }

Além da opção padrão de fazer com que os usuários preencham um campo manualmente, o Turbo EA pode **computar o valor de um campo automaticamente** a partir de outros campos no mesmo card — incluindo os integrados — usando o recurso **Cálculos**. O campo computado torna-se somente leitura e carrega um selo "calculado" para que os usuários não se desviem da regra.

O exemplo canônico é o cálculo do **Modelo TIME**, que deriva o campo integrado `timeModel` em Application a partir das duas avaliações de adequação integradas. Crie-o em **Admin → Metamodelo → Cálculos** com **Novo cálculo**: Tipo de ficha alvo = `Application`, Campo alvo = **Modelo TIME**, e esta fórmula:

```
# TIME Model from the built-in Functional and Technical Suitability (Gartner quadrants)
ff = MAP_SCORE(data.functionalSuitability, {"perfect": 4, "appropriate": 3, "insufficient": 2, "unreasonable": 1})
tf = MAP_SCORE(data.technicalSuitability, {"fullyAppropriate": 4, "adequate": 3, "unreasonable": 2, "inappropriate": 1})
IF(ff is None or tf is None, None, IF(ff >= 2.5, IF(tf >= 2.5, "invest", "migrate"), IF(tf >= 2.5, "tolerate", "eliminate")))
```

Cada avaliação é convertida em uma pontuação de 4 (melhor) a 1 (pior), e as duas pontuações posicionam a aplicação em um dos quatro quadrantes: funcional alta + técnica alta = **Investir**, funcional alta + técnica baixa = **Migrar**, funcional baixa + técnica alta = **Tolerar**, baixa em ambas = **Eliminar**. Uma aplicação sem uma das avaliações não recebe valor TIME, de modo que as lacunas permanecem visíveis.

É o mesmo exemplo de TIME que você encontra no painel **Referência de fórmulas** do editor de cálculos, então também pode copiá-lo de lá. Ele lê apenas campos que Application já possui, então **você não precisa adicionar nenhum campo** — e não deveria (veja *Não duplique campos integrados* abaixo). Mais sintaxe de fórmulas: [Admin → Cálculos](../admin/calculations.md).

Depois de salvar, ative o cálculo (**Ativo**) e clique em **Recalcular todos** na sua linha para que cada aplicação existente receba seu valor. O passo a passo está em [Sua Primeira Análise → Etapa 3](your-first-analysis.md).

!!! warning "Don't"
    Um TIME calculado é uma **hipótese inicial**, não um veredito. Revise cada resultado com o Dono da Aplicação antes de confiar nele.

O padrão híbrido que funciona bem na prática: mantenha o cálculo ativo enquanto você constrói o inventário e coleta as avaliações de adequação; revise os resultados no workshop de validação; e, se as decisões precisarem se afastar da fórmula, desligue o cálculo (o interruptor **Ativo**) para que o campo volte a ser editável e as decisões manuais permaneçam.

## Alternativa: usar um Grupo de Tags

Se o valor é informativo em vez de consultável, um **Grupo de Tags** (Admin → Metamodelo → Etiquetas) é mais leve do que um campo personalizado — sem mudança de metamodelo, sem migração, mais fácil de evoluir. Use um Grupo de Tags quando:

- O valor é descritivo ("Voltado ao cliente", "Apenas interno", "Adquirido em 2024").
- Você pode adicionar novas opções com frequência.
- Você não precisa dele em um dropdown de filtro, mas um chip de tag com busca enquanto digita está bom.

Use um campo personalizado quando:

- Você quer agrupar ou colorir um relatório por ele (por exemplo, o Portfólio de aplicações).
- Você quer que seja ponderado na Qualidade de Dados.
- É um vocabulário controlado que não mudará com frequência.

## Antipadrões a evitar

Estes são os erros mais comuns de metamodelo em primeiros rollouts:

!!! warning "Não renomeie tipos de card integrados"
    Renomear `Application` para `Solution` parece arrumado mas quebra o mapeamento conceitual que o Mapa de capacidades, o relatório Portfólio de aplicações e os catálogos todos assumem. Se sua organização os chama de "Soluções", configure a tradução do **rótulo** — a `key` subjacente permanece como `Application`.

!!! warning "Não adicione 30 campos personalizados no primeiro dia"
    Cada campo personalizado adiciona atrito à coleta de dados e dilui a pontuação de Qualidade de Dados. Adicione um campo, use-o por um mês, depois adicione o próximo.

!!! warning "Não duplique campos integrados"
    Antes de adicionar `timeDisposition`, `funcFit`, `techFit` ou `appCriticality`, verifique a lista de campos existentes — provavelmente um campo integrado equivalente já existe (`timeModel`, `functionalSuitability`, `technicalSuitability`, `businessCriticality`). Duplicatas dividem seus dados e quebram relatórios.

!!! warning "Não torne novos campos `required` no primeiro dia"
    Enquanto um campo obrigatório estiver vazio, a pontuação de Qualidade de Dados do card fica fixada em 0 e um banner de aviso lista o que está faltando — em todos os cards existentes de uma só vez. Torne um campo obrigatório somente **depois** de tê-lo preenchido em 80%+ da população.

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
