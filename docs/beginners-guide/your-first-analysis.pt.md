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

## Etapa 2 — Escolha como você preencherá o campo TIME

Você tem duas opções. Escolha uma (ou use ambas, com cálculo como padrão e substituição manual para exceções):

### Opção A — Entrada manual de TIME (recomendada para o primeiro passe)

Você adicionou um campo `timeDisposition` de seleção única na página anterior. Use-o. Com o Dono da Aplicação em um workshop de uma hora, você normalmente pode classificar 30–50 aplicações:

- **Tolerar** — funciona, baixo custo, não é um diferencial estratégico. Deixe como está.
- **Investir** — estratégico, área de crescimento, financie melhorias.
- **Migrar** — substituir ou mover para uma nova plataforma dentro do horizonte de planejamento.
- **Eliminar** — duplicado, fim de vida, descomissionar.

Use o modo **Grid Edit** do inventário com a coluna `timeDisposition` visível para fazer isso com velocidade.

### Opção B — TIME calculado via uma fórmula

Se você quer uma recomendação inicial que os donos então validam, o recurso [Cálculos](../admin/calculations.md) pode derivar um valor TIME padrão a partir de dados de custo e ciclo de vida.

Exemplo de fórmula no campo `timeDisposition` do tipo `Application`:

```
IF(lifecycle_endOfLife <= TODAY() + 365, "eliminate",
   IF(costTotalAnnual > 500000, "invest",
      IF(costTotalAnnual < 50000, "tolerate", "migrate")))
```

O que ela faz:

- Aplicações chegando ao fim de vida em um ano → **Eliminar**.
- Apps estratégicos de alto gasto → **Investir**.
- Apps utilitários de baixo custo → **Tolerar**.
- Tudo o mais → **Migrar** (o padrão que precisa de revisão humana).

A fórmula é executada automaticamente toda vez que um card é salvo, e o Turbo EA marca o campo como somente leitura com um selo "calculado" para que os usuários não se desviem acidentalmente da regra.

!!! warning "Não faça"
    Um TIME calculado é uma **hipótese inicial**, não um veredito. Ou revise cada resultado com o dono antes de confiar nele, ou desligue o cálculo e confie na entrada manual uma vez que o workshop esteja feito.

O padrão híbrido: mantenha o cálculo ligado enquanto você está construindo o inventário, desligue-o para o workshop, mude o campo de volta para edição manual para as decisões finais.

## Etapa 3 — Execute o Relatório de Portfólio

1. Vá para **Relatórios → Portfólio**.
2. Configure os eixos:
    - **Tipo de card**: `Application`
    - **Eixo X**: uma medida de adequação técnica se você tiver uma (caso contrário, divisão de custos, idade ou ciclo de vida).
    - **Eixo Y**: uma medida de valor de negócio (caso contrário, `costTotalAnnual` como substituto).
    - **Tamanho**: `costTotalAnnual` — quanto maior o gasto, maior a bolha.
    - **Cor**: `timeDisposition` — isso é o que torna o relatório pronto para decisão.
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
