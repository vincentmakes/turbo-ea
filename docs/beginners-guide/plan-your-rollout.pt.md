# Planeje Seu Rollout

Antes de criar um único card, gaste uma hora respondendo a quatro perguntas. As equipes que pulam esta etapa acabam com um inventário em que ninguém confia, porque ninguém concordou para que ele servia.

## 1. Defina um escopo restrito

O maior erro em rollouts de EA é tentar modelar a empresa toda de uma vez. Escolha **um** dos seguintes:

- Um **domínio de negócio** (por exemplo, Vendas, Finanças, Atendimento ao Cliente, Manufatura).
- Uma **entidade legal** ou **região** (uma subsidiária, um país, uma unidade de negócio recém-adquirida).
- Uma **plataforma** (por exemplo, a stack de e-commerce, a plataforma de dados, o parque de ERP).

Um bom primeiro escopo contém aproximadamente **50–200 aplicações**. Menos do que isso e não há nada para analisar; mais do que isso e você ficará sem energia antes de chegar à análise.

!!! warning "Não faça"
    Não escolha "a empresa inteira" ou "toda a TI". Você gastará três meses perseguindo dados e nunca chegará a um relatório funcional.

## 2. Escolha o caso de uso certo para começar

O caso de uso decide quais campos importam, quais stakeholders você precisa e qual relatório você mostrará no final. O mais comum — e aquele que este guia assume a partir da página 3 — é:

> **Racionalização do Portfólio de Aplicações**
>
> Inventariar as aplicações no escopo, classificar cada uma por valor de negócio e adequação técnica, e decidir o que **T**olerar, **I**nvestir, **M**igrar ou **E**liminar (o framework TIME).

Outros casos de uso iniciais válidos — mas escolha **um**:

| Caso de uso | O que você populará principalmente | O que você pulará |
|-------------|-----------------------------------|-------------------|
| **Racionalização do Portfólio de Aplicações** | Aplicações, custos, ciclo de vida, valor de negócio | Modelo detalhado de processos, interfaces |
| **Planejamento baseado em capacidades** | Capacidades de Negócio, Aplicações, mapa de calor de capacidades | Detalhe de custos, stack tecnológica |
| **Avaliação de migração para nuvem** | Aplicações, Componentes de TI, modelo de implantação | Valor de negócio, processos |
| **Integração de fusões e aquisições** | Ambos os portfólios como Aplicações, análise de sobreposição | Datas de ciclo de vida de longo prazo |

Se você não tem certeza, **escolha Racionalização do Portfólio de Aplicações**. É o ponto de partida mais universalmente útil e o restante deste guia é escrito em torno dele.

## 3. Identifique seus stakeholders

O Turbo EA tem um modelo de **Stakeholder** integrado (veja [Detalhes do Card](../guide/card-details.md)): cada card carrega uma lista de pessoas em papéis definidos (Dono de Negócio, Dono Técnico, etc.), definidos por tipo de card no metamodelo. Decida antecipadamente quem preenche cada papel para uma Aplicação:

- **Dono da Aplicação** — responsável pela aplicação no negócio. Uma pessoa por app. Eles aprovam a disposição TIME.
- **Dono Técnico** — responsável por mantê-la rodando. Frequentemente o gerente de engenharia.
- **Arquiteto** — você, provavelmente. Atua como o revisor do lado de EA e aprova cards.

Você não precisa atribuir stakeholders no primeiro dia para cada card, mas precisa saber quem eles *serão* — porque na terceira semana você estará enviando pesquisas a eles para validar os dados.

!!! tip "Boa prática"
    Um nome real no papel de Dono da Aplicação vale mais do que dez campos personalizados perfeitamente preenchidos. Se você só preencher um campo além do nome e do ciclo de vida, faça com que seja o Dono da Aplicação.

## 4. Estabeleça uma meta realista de qualidade de dados

O Turbo EA calcula uma pontuação de **Qualidade de Dados** (0–100%) para cada card, com base nos campos ponderados definidos no metamodelo. É o melhor indicador antecipado de se seu inventário é utilizável.

Metas realistas para os primeiros 90 dias:

| Fase | Meta de qualidade de dados média (Aplicações) | O que está preenchido |
|------|----------------------------------------------|----------------------|
| Fim da semana 2 (Crawl) | **40–60%** | Nome, Fase do ciclo de vida, Descrição, Dono de Negócio |
| Fim da semana 6 (Walk) | **60–75%** | + Mapeamento de capacidades, Custo, Disposição TIME |
| Fim do mês 3 (Run) | **75–90%** | + Stack tecnológica, interfaces, campos personalizados do domínio |

Não busque 100%. Os últimos 10% custam mais do que os primeiros 60% e raramente mudam uma decisão.

## 5. Comprometa-se com um único entregável

Encerre sua sessão de planejamento com uma declaração escrita como:

> *"Até o fim da semana 6, o inventário do domínio de Vendas conterá toda aplicação com custo anual > 50k€, cada uma mapeada para pelo menos uma Capacidade de Negócio e carregando uma disposição TIME. Apresentaremos o Relatório de Portfólio ao CIO de Vendas na semana 7."*

Coloque-a em uma wiki, em um slide de kickoff, na descrição de um canal do Slack — em algum lugar visível. Essa frase é o que impede o rollout de derivar para o purgatório do "ainda estamos coletando dados".

Próximo: [Comece com seu inventário de aplicações](start-with-applications.md).
