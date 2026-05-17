# Sua Primeira Análise: Harmonização de Aplicações

Este é o retorno. Você tem um inventário de aplicações, um mapa de capacidades e um campo de disposição TIME. Agora você os conecta e produz os dois relatórios que justificam todo o programa de EA para um CIO:

- Um **Relatório de Portfólio** que mostra cada aplicação dimensionada por custo, colorida pela disposição TIME.
- Um **Mapa de Calor de Capacidades** que mostra onde você tem redundância (várias aplicações por capacidade) e fragilidade (uma única aplicação por capacidade).

## Etapa 1 — Mapeie aplicações para capacidades

A relação mais valiosa em todo o metamodelo é **Application → Business Capability** (`supports` / `supported by`). Você a definirá para cada aplicação no escopo.

### Caminho em massa: modo de edição em grade do inventário

1. Vá para **Inventário**, filtre por Tipo = `Application`.
2. Certifique-se de que a coluna de relação **Business Capability** está visível (aba Colunas → Relações).
3. Alterne o modo **Grid Edit** na barra de ferramentas.
4. Clique na célula de capacidade em cada linha e escolha uma ou mais capacidades.
5. Salve.

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

## Etapa 2 — Escolha como você preencherá o TIME Model

O campo integrado **TIME Model** em Application (`timeModel`, obrigatório, quatro opções: `tolerate` / `invest` / `migrate` / `eliminate`) é a coluna de decisão que conduz o restante da análise. Você tem duas maneiras de preenchê-lo.

### Opção A — Entrada manual de TIME (recomendada para o primeiro passe)

Com o Dono da Aplicação em um workshop de uma hora, você normalmente pode classificar 30–50 aplicações:

- **Tolerar** — funciona, baixo custo, não é um diferencial estratégico. Deixe como está.
- **Investir** — estratégico, área de crescimento, financie melhorias.
- **Migrar** — substituir ou mover para uma nova plataforma dentro do horizonte de planejamento.
- **Eliminar** — duplicado, fim de vida, descomissionar.

Use o modo **Grid Edit** do inventário com a coluna **TIME Model** visível para capturar decisões com velocidade.

### Opção B — TIME calculado via uma fórmula

Em vez de pedir a cada Dono de Aplicação para definir TIME manualmente, você pode derivar `timeModel` automaticamente a partir das duas dimensões integradas de adequação (`functionalSuitability` × `technicalSuitability`) usando o recurso **Cálculos**. Este é o posicionamento canônico de quatro quadrantes do Gartner.

O exemplo prático — a fórmula, a tabela de quadrantes e o padrão híbrido recomendado — está em [Personalize o metamodelo → Opção: derivar um campo automaticamente com um Cálculo](customise-the-metamodel.md#option-derive-a-field-automatically-with-a-calculation). Use-o como uma recomendação inicial que os donos então validam, não como um veredito.

## Etapa 3 — Execute o Relatório de Portfólio

1. Vá para **Relatórios → Portfólio**.
2. Configure os eixos:
    - **Tipo de card**: `Application`
    - **Eixo X**: `technicalSuitability` (o campo integrado de adequação técnica).
    - **Eixo Y**: `functionalSuitability` ou `businessValue` (campos integrados de adequação ao negócio).
    - **Tamanho**: `costTotalAnnual` — quanto maior o gasto, maior a bolha.
    - **Cor**: `timeModel` — isso é o que torna o relatório pronto para decisão.
3. Salve a configuração como uma visão nomeada ("Portfólio de Aplicações — Domínio de Vendas") para poder voltar a ela.

O que procurar:

- **Bolhas vermelhas grandes** (candidatos a Eliminar de alto custo) — sua economia mais rápida.
- **Bolhas âmbar grandes** (candidatos a Migrar de alto custo) — suas decisões de transformação mais consequentes.
- **Aglomerados no canto superior direito da matriz** que não estão verdes — apps estratégicos que não estão recebendo o investimento.

Referência: [Relatórios](../guide/reports.md).

## Etapa 4 — Execute o Mapa de Calor de Capacidades

1. Vá para **Relatórios → Mapa de Capacidades**.
2. O mapa de calor mostra sua hierarquia de capacidades de negócio com a intensidade da cor da célula proporcional ao **número de aplicações que dão suporte àquela capacidade**.

O que procurar:

- **Células quentes** (muitos apps por capacidade) — candidata à redundância. O caso de negócio mais comum para uma Racionalização do Portfólio de Aplicações vive aqui.
- **Células frias** com aplicações que você esperaria — lacunas em seu mapeamento, ou capacidades genuinamente subatendidas.
- **Células brancas** no meio de um ramo ativo — aplicações não mapeadas, ou capacidades não modeladas.

Referência: [Relatórios → Mapa de Capacidades](../guide/reports.md).

## Etapa 5 — Apresente e itere

Você agora tem uma visão de portfólio defensável. Coloque os dois relatórios diante do CIO de Vendas (ou de quem quer que seja dono do seu escopo) e:

- Confirme as decisões TIME nas 10 aplicações de maior custo.
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
