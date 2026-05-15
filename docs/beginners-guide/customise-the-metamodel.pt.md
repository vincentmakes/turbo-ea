# Personalize o Metamodelo — Levemente

O metamodelo do Turbo EA é totalmente **configurável pelo administrador** — cada tipo de card, campo, subtipo, relação e papel de stakeholder é dado, não código. Você será tentado a redesenhá-lo. **Não faça isso.**

As equipes que têm sucesso personalizam o metamodelo **apenas quando os campos padrão não conseguem responder à sua pergunta**. As equipes que fracassam gastam seu primeiro mês renomeando `Application` para `Solution`, adicionando 30 campos personalizados e nunca chegam a um relatório funcional.

## O teste das duas perguntas antes de adicionar um campo

Antes de adicionar um único campo personalizado, pergunte-se:

1. **Vou filtrar, agrupar ou relatar sobre este campo?** Se não, ele pertence à descrição ou a uma tag — não a um campo.
2. **A mesma resposta é necessária em cada card deste tipo?** Se não, é uma relação ou um anexo, não um campo.

Se você não consegue responder "sim" a ambas, não adicione o campo.

## Exemplo prático: adicionar uma disposição TIME

Para uma Racionalização do Portfólio de Aplicações, você precisa de uma única decisão por aplicação: **T**olerar / **I**nvestir / **M**igrar / **E**liminar (o framework **TIME**, popularizado pelo Gartner). O metamodelo padrão não vem com um campo `timeDisposition`, então este é um dos raros casos em que adicionar um campo personalizado é a escolha certa.

Vamos adicioná-lo como um campo `single_select` no tipo `Application`, com quatro opções codificadas por cor, peso 1 para que contribua para a qualidade de dados.

### Etapa 1 — Abra o editor de tipos

1. Vá para **Admin → Metamodelo**.
2. Clique no card do tipo **Application**.
3. A gaveta do tipo abre à direita. Mude para a aba **Campos**.

### Etapa 2 — Adicione o campo

1. Escolha a seção onde você quer que o campo apareça (ou crie uma nova seção chamada "Decisão de Portfólio").
2. Clique em **+ Adicionar campo** nessa seção.
3. Preencha:
    - **Chave**: `timeDisposition`  *(camelCase, sem espaços, torna-se a chave do atributo no JSON)*
    - **Rótulo**: *Disposição de Portfólio (TIME)*
    - **Tipo**: `single_select`
    - **Peso**: `1`  *(contribui para a pontuação de Qualidade de Dados)*
    - **Obrigatório**: deixe **desligado** — obrigatório bloquearia a aprovação de todo card existente.
4. Adicione as quatro opções:

    | Chave | Rótulo | Cor |
    |-------|--------|-----|
    | `tolerate` | Tolerar | cinza / neutro |
    | `invest` | Investir | verde |
    | `migrate` | Migrar | âmbar |
    | `eliminate` | Eliminar | vermelho |

5. **Adicione traduções** para o rótulo e cada opção em cada localidade que você suporta — a página 4 de [Admin → Metamodelo](../admin/metamodel.md) cobre o editor de traduções. Pular isso significa que usuários não anglófonos verão "timeDisposition" literalmente.
6. Salve.

### Etapa 3 — Confirme que funciona

1. Abra qualquer card de Aplicação. O novo campo aparece em sua seção, vazio.
2. Escolha um valor, salve. O anel de Qualidade de Dados deve subir alguns por cento.
3. De volta ao **Inventário**, o campo agora está disponível na aba **Colunas** e como filtro — você já pode filtrar aplicações por TIME.

É isso. Um campo, dez minutos, imediatamente útil.

## Alternativa: usar um Grupo de Tags

Se o valor é informativo em vez de consultável, um **Grupo de Tags** (Admin → Tags) é mais leve do que um campo personalizado — sem mudança de metamodelo, sem migração, mais fácil de evoluir. Use um Grupo de Tags quando:

- O valor é descritivo ("Voltado ao cliente", "Apenas interno", "Adquirido em 2024").
- Você pode adicionar novas opções com frequência.
- Você não precisa dele em um dropdown de filtro, mas um chip de tag com busca enquanto digita está bom.

Use um campo personalizado quando:

- Você precisa do valor nos eixos do Relatório de Portfólio (X, Y, cor).
- Você quer que seja ponderado na Qualidade de Dados.
- É um vocabulário controlado que não mudará com frequência.

A disposição TIME está no campo personalizado porque a usaremos como eixo de cor do Relatório de Portfólio na próxima página.

## Antipadrões a evitar

Estes são os erros mais comuns de metamodelo em primeiros rollouts:

!!! warning "Não renomeie tipos de card integrados"
    Renomear `Application` para `Solution` parece arrumado mas quebra o mapeamento conceitual que o Mapa de Calor de Capacidades, o Relatório de Portfólio e os catálogos todos assumem. Se sua organização os chama de "Soluções", configure a tradução do **rótulo** — a `key` subjacente permanece como `Application`.

!!! warning "Não adicione 30 campos personalizados no primeiro dia"
    Cada campo personalizado adiciona atrito à coleta de dados e dilui a pontuação de Qualidade de Dados. Adicione um campo, use-o por um mês, depois adicione o próximo.

!!! warning "Não torne novos campos `required` no primeiro dia"
    `Required` bloqueia a aprovação para todo card existente que não tenha um valor. Torne um campo obrigatório somente **depois** de tê-lo preenchido em 80%+ da população.

!!! warning "Não crie tipos de card personalizados em vez de campos personalizados"
    "Mobile App" deveria ser um subtipo de `Application`, não um novo tipo de card. Novos tipos não obtêm mapeamento de capacidades, relatórios de portfólio ou importações de catálogo de graça.

## Outras extensões leves que você pode querer

Estas são extensões comuns de segundo passe, mas **não as adicione até que você realmente precise**:

| Necessidade | Onde adicionar | Tipo |
|-------------|---------------|------|
| Avaliação de valor de negócio | Application | `single_select` (Alto/Médio/Baixo) — conduz o eixo Y do Relatório de Portfólio |
| Avaliação de adequação técnica | Application | `single_select` — conduz o eixo X |
| Prontidão para nuvem | Application | `single_select` (Pronto / Precisa refatorar / Fica on-premise) |
| Categoria de risco de perda | Application, IT Component | `single_select` (Ponto único de falha, etc.) |
| Divisão de custos | Application | Campos `cost` para `costRunTotalAnnual`, `costChangeTotalAnnual` |

Cada um passa no teste das duas perguntas para análises de portfólio. Cada um também é um bom candidato para uma fórmula calculada em vez de entrada manual — que é o que a próxima página cobre.

Próximo: [Sua primeira análise: Harmonização de Aplicações](your-first-analysis.md).
