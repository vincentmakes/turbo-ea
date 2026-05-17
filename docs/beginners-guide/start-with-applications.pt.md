# Comece Com Seu Inventário de Aplicações

O Turbo EA vem com 13 tipos de card prontos para uso. Você será tentado a populá-los todos. Não faça isso.

**Comece com Aplicações**. Aplicações são o tipo de card de maior alavancagem em qualquer primeiro rollout:

- Elas são as mais fáceis de obter — departamentos de TI quase sempre têm uma lista em algum lugar (CMDB, rastreador de licenças, sistema financeiro, ou até mesmo uma planilha).
- Elas ancoram todas as outras camadas — uma vez que você tenha Aplicações, mapear para Capacidades, Processos e Componentes de TI se torna enriquecimento incremental em vez de um exercício de campo aberto.
- Elas conduzem o primeiro relatório útil (Racionalização de Portfólio) com o menor número de dependências.

Outros tipos de card vêm depois. Uma segunda onda comum são as Capacidades de Negócio (página 4) e depois Interfaces ou Objetos de Dados.

## Como é o "viável mínimo"

Para cada card de Aplicação no seu escopo inicial, preencha estes campos e **apenas** estes campos:

| Campo | Por que importa | De onde vem |
|-------|----------------|-------------|
| **Nome** | Identidade. Use o nome que as pessoas realmente usam, não o rótulo da licença. | Sua fonte existente |
| **Descrição** | Uma frase: o que esta aplicação faz pelo negócio? | Entrevista com o dono, ou sugestão de IA (veja [Inventário](../guide/inventory.md#ai-description-suggestions)) |
| **Fase do ciclo de vida** | Plan / Phase In / Active / Phase Out / End of Life | CMDB, ou entrevista com o dono |
| **Dono de Negócio** (stakeholder) | A pessoa responsável pela aplicação | Organograma |
| **Custo — Total Anual** | Usado pelo Relatório de Portfólio e fórmula TIME | Finanças, ou estimativa aproximada |

Cinco campos. Só isso. O anel de Qualidade de Dados marcará ~50% e tudo bem — você pode refinar no segundo passe.

!!! warning "Não faça"
    Não tente preencher a **data de End of Life**, **Fornecedor**, **Stack tecnológica** e 12 campos personalizados no primeiro passe. Você vai se esgotar por volta do card 30.

## Três formas de popular o inventário

Escolha o caminho que combina com sua fonte de dados. Você pode misturá-los — importar a maior parte e depois corrigir manualmente a cauda longa.

### Caminho A — Importação Excel / CSV (recomendado para a maioria dos inícios)

Se suas aplicações estão em uma planilha (ou você pode exportá-las de um CMDB), este é o caminho mais rápido. **Não comece montando a planilha à mão** — deixe o Turbo EA fornecer o modelo.

1. **Crie primeiro um card de Application fictício manualmente**. Vá para **Inventário → + Criar**, Tipo = `Application`, dê um nome como *"_TEMPLATE — apagar"*. Preencha os cinco campos mínimos (descrição, ciclo de vida, dono, custo) para que a exportação contenha valores reais que sirvam de exemplo.
2. **Filtre o inventário por Tipo = `Application`** e clique em **Exportar** na barra de ferramentas. Você obtém um arquivo `.xlsx` com uma linha de dados reais e uma coluna por campo — esse é o seu modelo. Os cabeçalhos de coluna correspondem às chaves de campo que o importador espera.
3. **Edite a planilha offline**: preserve a estrutura das colunas, substitua a linha única por todas as suas aplicações reais e remova a linha fictícia no final (ou deixe-a — você remove o card do Turbo EA após a importação).
4. **Importe o arquivo editado**: **Inventário → Importar**, arraste o `.xlsx`. O relatório de validação mostra exatamente quais linhas criarão novos cards, quais atualizarão cards existentes (correspondidos por nome ou ID) e quais falharão.
5. Execute a importação e, em seguida, arquive o card `_TEMPLATE`.

Referência completa: [Inventário → Importação de Excel](../guide/inventory.md#excel-import).

**Dica para a primeira importação:** inclua apenas os cinco campos mínimos, mais uma coluna para o e-mail do Dono de Negócio (o importador tentará casá-lo com usuários existentes). Pule todo o resto. Você pode fazer uma segunda importação depois com mais colunas repetindo o ciclo exportar-editar-importar.

### Caminho B — Sincronização com ServiceNow

Se você tem um CMDB do ServiceNow e acesso de administrador à sua API, a integração busca registros de Aplicação diretamente.

1. Vá para **Admin → Integração com ServiceNow**.
2. Crie uma conexão (URL, credenciais — as credenciais são armazenadas criptografadas).
3. Defina um mapeamento: ServiceNow `cmdb_ci_business_app` → Turbo EA `Application`, com regras em nível de campo.
4. Execute uma sincronização **pull**. Por padrão, os registros chegam em uma área de **staging** para revisão pelo administrador antes de serem aplicados.

Veja [Admin → Integração com ServiceNow](../admin/servicenow.md) para a configuração completa. Trate a primeira sincronização como exploratória — revise o que chegou, refine o mapeamento, e então execute-a de verdade.

### Caminho C — Entrada manual

Para parques pequenos (menos de ~30 apps) ou quando nenhuma fonte utilizável existe:

1. **Inventário** → **+ Criar** (canto superior direito).
2. Tipo = **Application**, preencha Nome e (opcionalmente) Descrição.
3. Clique em **Sugerir com IA** se quiser uma descrição inicial obtida de uma busca na web.
4. Salve e siga em frente. Você preencherá o resto a partir da página de detalhes do card.

A entrada manual é lenta, mas produz os dados de mais alta qualidade porque cada card é tocado pelo dono na entrada.

## Use o fluxo de aprovação como uma porta de qualidade

Cada card carrega um **Status de Aprovação**: Draft → Approved → (Broken se editado substancialmente após a aprovação).

Um fluxo prático:

1. Novos cards chegam como **Draft**. O Arquiteto (você) faz uma rápida passada — nome correto, descrição sensata, ciclo de vida certo.
2. Uma vez que os campos mínimos estão preenchidos, **aprove** o card. Isso sinaliza para os consumidores downstream que o card é confiável.
3. Se alguém depois editar um campo substancial, o Turbo EA automaticamente vira o status para **Broken** até ser re-aprovado.

Filtre o inventário por `Approval Status = Approved` para obter uma visão limpa para o relatório de portfólio ao final deste guia.

!!! tip "Boa prática"
    Aprove em lotes ao final de cada dia. Isso o força a reler o que você importou e a pegar os piores problemas de qualidade de dados cedo.

## Quando parar de popular e seguir em frente

Você terminou esta página quando:

- Toda aplicação no seu escopo tem um card.
- Cada card tem os cinco campos mínimos preenchidos.
- A qualidade média de dados em todo o conjunto é **≥ 40%**.
- Pelo menos 50% dos cards estão aprovados.

Não espere pela perfeição. Vá para a próxima página — [Aproveite os catálogos de referência](leverage-reference-catalogues.md) — e volte para enriquecer depois que você tiver mapeado as capacidades.
