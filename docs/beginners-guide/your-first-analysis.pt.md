# Sua Primeira Análise: Harmonização de Aplicações

Este é o retorno. Você tem um inventário de aplicações, um mapa de capacidades e o campo integrado Modelo TIME. Agora você os conecta e produz os dois relatórios que justificam todo o programa de EA para um CIO:

- O relatório **Portfólio de aplicações**, com cada aplicação agrupada por **Criticidade de negócio** e colorida pela sua disposição **TIME** (**T**olerar / **I**nvestir / **M**igrar / **E**liminar).
- O **Mapa de capacidades**, um mapa de calor que mostra onde você tem redundância (várias aplicações por capacidade) e fragilidade (uma única aplicação por capacidade).

## Etapa 1 — Mapeie aplicações para capacidades

A relação mais valiosa em todo o metamodelo é **Application → Business Capability** (`suporta` / `é suportado por`). Você a definirá para cada aplicação no escopo.

### Caminho em massa: modo de edição em grade do inventário

1. Vá para **Inventário**, filtre por Tipo = `Application`.
2. Certifique-se de que a coluna de relação **Business Capability** está visível (aba Colunas → Relações).
3. Alterne o modo **Edição em grade** na barra de ferramentas.
4. Clique na célula de capacidade em cada linha e escolha uma ou mais capacidades. Cada alteração é salva assim que você a faz.

Para 50–200 apps, isso leva uma tarde e um café.

### Caminho card a card

Para mapeamentos de alto julgamento (ou quando um workshop com o Dono da Aplicação está envolvido), abra cada card de Aplicação e use a seção **Relações**. Você obtém o seletor completo com busca, visualização da hierarquia e a capacidade de definir atributos de relação.

### Quantas capacidades por aplicação?

| Contagem de mapeamento | O que significa |
|------------------------|-----------------|
| **0** | Não mapeada — seu inventário está incompleto. Filtre por estas e corrija. |
| **1** | O caso limpo e ideal — esta aplicação dá suporte a exatamente uma capacidade. |
| **2–3** | Tudo bem — muitos apps abrangem algumas capacidades relacionadas. |
| **4+** | Suspeito — você pode estar confundindo "usa dados de" com "dá suporte a". Reverifique. |

!!! tip "Boa prática"
    O mapeamento do primeiro passe é rápido e bruto. O segundo passe — feito com o Dono da Aplicação revisando — é o que torna os dados confiáveis. Planeje para ambos.

## Etapa 2 — Avalie criticidade e adequação

Três campos integrados na seção **Avaliação** de cada card de Aplicação alimentam a análise. Preencha-os com o Dono da Aplicação — em um workshop de uma hora você normalmente pode avaliar 30–50 aplicações usando a **Edição em grade** com as três colunas visíveis.

| Campo | Opções | O que responde |
|-------|--------|----------------|
| **Criticidade de negócio** | Crítico para a missão / Crítico para o negócio / Operacional / Administrativo | Quanto o negócio depende desta aplicação? |
| **Adequação funcional** | Perfeito / Apropriado / Insuficiente / Inadequado | Quão bem ela faz o que o negócio precisa? |
| **Adequação técnica** | Totalmente apropriado / Adequado / Inadequado / Inapropriado | Quão saudável é a tecnologia por baixo? |

A Criticidade de negócio agrupa o relatório da Etapa 4. As duas avaliações de adequação são o que o cálculo TIME da Etapa 3 lê.

Editar esses campos em um card aprovado muda seu status de aprovação para **Quebrado**. Reaprove os cards em lote após o workshop.

## Etapa 3 — Derive o TIME com um campo calculado

O campo integrado **Modelo TIME** em Application (`timeModel`, quatro opções: `tolerate` / `invest` / `migrate` / `eliminate`) é a coluna de decisão que conduz o restante da análise. Em vez de pedir a cada Dono de Aplicação que escolha uma, derive-o das duas avaliações de adequação com um **cálculo** — o posicionamento clássico do Gartner:

| | Adequação técnica alta | Adequação técnica baixa |
|---|---|---|
| **Adequação funcional alta** | **Investir** | **Migrar** |
| **Adequação funcional baixa** | **Tolerar** | **Eliminar** |

1. Vá para **Admin → Metamodelo → Cálculos** e clique em **Novo cálculo**.
2. Defina **Tipo de ficha alvo** = `Application` e **Campo alvo** = **Modelo TIME**.
3. Cole a fórmula de [Personalize o metamodelo → Opção: derivar um campo automaticamente com um Cálculo](customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation). Ela usa os campos de adequação integrados, então nenhum campo personalizado é necessário.
4. Clique em **Validar**, salve e depois use **Testar** em algumas aplicações que você conhece bem para conferir o resultado.
5. Ative o cálculo (**Ativo**) na lista e depois clique em **Recalcular todos** na sua linha para preencher o Modelo TIME em todas as aplicações.

A partir daí, o Modelo TIME é recalculado sempre que uma aplicação é salva, exibe um selo **calculado** e não pode mais ser editado manualmente. Uma aplicação sem uma das duas avaliações de adequação não recebe valor TIME — isso é intencional: mostra quais avaliações ainda estão faltando.

!!! warning "Don't"
    Um TIME calculado é uma **hipótese inicial**, não um veredito. Revise os resultados com os Donos das Aplicações antes de apresentá-los. Quando uma decisão precisar prevalecer sobre a fórmula, desligue o cálculo (o interruptor **Ativo**) e edite o Modelo TIME manualmente na **Edição em grade**.

Referência: [Admin → Cálculos](../admin/calculations.md).

## Etapa 4 — Execute o relatório Portfólio de aplicações

1. Vá para **Relatórios → Portfólio de aplicações**.
2. Defina **Agrupar por** = **Criticidade de negócio**.
3. Defina **Colorir aplicações por** = **Modelo TIME**.
4. Clique no ícone de marcador (**Salvar relatório**) e dê um nome à visão ("Portfólio de Aplicações — Domínio de Vendas"). Você a encontrará novamente em **Relatórios → Relatórios salvos**.

Cada nível de Criticidade de negócio vira uma caixa, com um chip por aplicação colorido pela sua disposição TIME e uma barra mostrando a composição. Para focar em um domínio, use o filtro **Relacionado por** com as capacidades do seu escopo.

O que procurar:

- **Aplicações «Crítico para a missão» e «Crítico para o negócio» marcadas como Migrar** — suas decisões de modernização mais consequentes. Elas vêm primeiro.
- **Aplicações «Administrativo» e «Operacional» marcadas como Eliminar ou Migrar** — seus ganhos de simplificação mais rápidos: aposente-as ou consolide-as em outra plataforma.
- **Aplicações «Crítico para a missão» marcadas como Investir** — confirme que elas estão realmente recebendo o investimento.
- **Aplicações sem cor** (TIME *Não definido*) — uma das duas avaliações de adequação está faltando. Volte à Etapa 2.

Referência: [Relatórios → Relatório de Portfólio](../guide/reports.md#relatorio-de-portfolio).

## Etapa 5 — Execute o Mapa de capacidades

1. Vá para **Relatórios → Mapa de capacidades**.
2. Mantenha a **Métrica do mapa de calor** em **Contagem de aplicações**: a intensidade da cor da célula é proporcional ao número de aplicações que dão suporte àquela capacidade.
3. Opcional: ative **Mostrar aplicações** e defina **Colorir aplicações por** = **Modelo TIME** para ver a disposição TIME das aplicações dentro de cada capacidade.

O que procurar:

- **Células quentes** (muitos apps por capacidade) — candidata à redundância. O caso de negócio mais comum para uma Racionalização do Portfólio de Aplicações vive aqui.
- **Células frias** com aplicações que você esperaria — lacunas em seu mapeamento, ou capacidades genuinamente subatendidas.
- **Células brancas** no meio de um ramo ativo — aplicações não mapeadas, ou capacidades não modeladas.

Referência: [Relatórios → Mapa de Capacidades](../guide/reports.md#mapa-de-capacidades).

## Etapa 6 — Apresente e itere

Você agora tem uma visão de portfólio defensável. Coloque os dois relatórios diante do CIO de Vendas (ou de quem quer que seja dono do seu escopo) e:

- Confirme as decisões TIME nas aplicações «Crítico para a missão» e «Crítico para o negócio».
- Identifique as 3 principais células quentes no mapa de calor como candidatos a projetos de racionalização.
- Capture acompanhamentos como comentários ou todos nas próprias aplicações — o Turbo EA os rastreia por card.

É isso. Você tem uma prática de EA funcional no Turbo EA.

## O que vem a seguir

Uma vez que seu portfólio de aplicações esteja vivo e confiável, estes se tornam próximos passos de alto valor. Nenhum deles é útil antes de você ter um inventário populado — que é o motivo pelo qual este guia os adiou deliberadamente.

| Módulo | Quando abri-lo | Onde encontrá-lo |
|--------|----------------|------------------|
| **Registro de Riscos** | Quando você estiver pronto para rastrear riscos de arquitetura contra aplicações e capacidades (TOGAF Fase G). | [Registro de Riscos](../guide/risks.md) |
| **GRC / Compliance** | Quando você precisar mapear aplicações e capacidades contra regulamentações (GDPR, NIS2, EU AI Act, DORA, SOC 2, ISO 27001). | [GRC](../guide/grc.md) |
| **PPM** | Quando as decisões de racionalização se tornarem projetos com orçamentos, cronogramas e relatórios de status. | [PPM](../guide/ppm.md) |
| **TurboLens AI** | Quando você tiver cards suficientes para que a IA encontre duplicatas de fornecedores, candidatos a modernização e recomendações de arquitetura. | [TurboLens](../guide/turbolens.md) |
| **BPM** | Quando você estiver pronto para modelar os processos que ficam sobre suas aplicações. | [BPM](../guide/bpm.md) |
| **Diagramas** | Quando você precisar de diagramas de arquitetura de forma livre que permaneçam em sincronia com o inventário. | [Diagramas](../guide/diagrams.md) |
| **EA Delivery** | Quando você começar a produzir Statements of Architecture Work e Architecture Decision Records no estilo TOGAF. | [EA Delivery](../guide/delivery.md) |

Bem-vindo ao Turbo EA.
