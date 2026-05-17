# Aproveite os Catálogos de Referência

O erro clássico nesta fase: gastar três semanas em workshops elaborando um modelo de capacidade de negócio sob medida, mais duas semanas alinhando-o com os executivos, e então descobrir que o modelo é 80% idêntico ao que toda outra empresa do seu setor usa.

**Não modele do zero.** O Turbo EA vem com três catálogos curados que lhe dão um ponto de partida testado em batalha que você pode adaptar em dias em vez de meses:

- **Catálogo de Capacidades de Negócio** — hierarquias de capacidades multinível por setor (bancário, varejo, manufatura, seguros, setor público, etc.) mais capacidades macro intersetoriais.
- **Catálogo de Processos** — processos de negócio de referência por setor, prontos para serem importados como cards `BusinessProcess`.
- **Catálogo de Cadeias de Valor** — cadeias de valor ponta a ponta para emoldurar o mapa de capacidades.

Esta página foca no Catálogo de Capacidades de Negócio, porque é aquele que alimenta o Mapa de Calor de Capacidades na página final. Os outros dois funcionam da mesma forma.

## Por que começar com capacidades

Uma **Capacidade de Negócio** é *o que o negócio faz*, expresso em linguagem estável e independente de tecnologia — "Gestão de Pedidos", "Onboarding de Clientes", "Tratamento de Sinistros". As capacidades mal mudam ao longo dos anos; as aplicações mudam o tempo todo. É por isso que o mapeamento aplicação-para-capacidade é a relação mais útil em todo o metamodelo:

- Permite que você pergunte **"quantas aplicações dão suporte ao Onboarding de Clientes?"** — e identifique redundância.
- Permite que você pergunte **"quais capacidades dependem de uma única aplicação envelhecida?"** — e identifique fragilidade.
- Sobrevive a reorganizações, trocas de fornecedor e migrações para a nuvem.

Você não precisa de 500 capacidades para obter valor. Você precisa de **20–60 capacidades, com dois ou três níveis de profundidade**, no seu escopo.

## Importe um mapa inicial de capacidades

1. Navegue até **Catálogo de Capacidades** no menu principal (sob Guia do Usuário).
2. Use os filtros no topo:
    - **Setor** — escolha o seu (ou "Intersetorial" se nada se encaixar).
    - **Nível** — comece com L1 e L2 visíveis. Você sempre pode aprofundar depois.
3. Navegue pela árvore. Expanda alguns ramos para ter uma noção da profundidade.
4. Marque as capacidades que você quer importar. **A seleção cascateia**: marcar um L1 marca seus descendentes; marcar um L2 também marca seu ancestral L1 para que a hierarquia permaneça conectada.
5. Clique em **Criar cards a partir da seleção**.

O Turbo EA cria um card `BusinessCapability` por nó marcado, preserva a hierarquia pai-filho e carimba cada card com um `catalogueId` estável para que reimportações sejam **idempotentes** — executar a importação duas vezes não cria duplicatas.

Referência completa: [Catálogo de Capacidades](../guide/capability-catalogue.md).

!!! tip "Boa prática"
    Escolha uma subárvore, não o catálogo inteiro. Para uma Racionalização do Portfólio de Aplicações no domínio de Vendas, importar a capacidade L1 "Vendas e Gestão de Clientes" mais seus filhos L2 geralmente é suficiente — isso são 10–15 capacidades, não 300.

## Quão fundo ir

A profundidade certa depende do que você fará com ela:

| Profundidade | Quando usar | Contagem típica de cards |
|--------------|-------------|--------------------------|
| **Apenas L1** | Resumos em nível executivo, escopos muito pequenos | 8–12 |
| **L1 + L2** | O ponto ideal para um primeiro rollout — legível em uma tela, útil em relatórios | 30–60 |
| **L1 + L2 + L3** | Planejamento detalhado baseado em capacidades, grandes empresas | 100–250 |
| **L4 e mais profundo** | Aprofundamentos específicos, não para uma baseline inicial | varia |

Vá para **L1 + L2** no seu primeiro passe. Você sempre pode importar níveis adicionais depois via o mesmo catálogo — a reimportação idempotente os encaixará sob os pais existentes.

## Uma palavra sobre processos e cadeias de valor

O **Catálogo de Processos** e o **Catálogo de Cadeias de Valor** funcionam da mesma forma: filtrar, marcar, criar em massa. Se seu primeiro caso de uso é Racionalização do Portfólio de Aplicações, você pode pulá-los por enquanto — o mapeamento de capacidades é suficiente para conduzir a análise na página final.

Você os quererá quando:

- Você passar de "racionalizar aplicações" para "otimizar a cadeia de valor de pedido-a-pagamento".
- Você começar a construir fluxos de processo BPMN sobre os cards `BusinessProcess` resultantes (veja [BPM](../guide/bpm.md)).

## E se meu setor não estiver no catálogo?

Duas opções:

1. **Escolha o setor mais próximo** e pode. As entradas "Intersetoriais" (Finanças, RH, TI, Compras) aplicam-se a praticamente toda empresa.
2. **Combine catálogos** — importe "Intersetorial" primeiro, depois complete com alguns itens de um catálogo setorial específico.

De qualquer forma, **importe primeiro, personalize depois**. Renomear uma capacidade importada ou adicionar um filho é muito mais rápido do que digitar toda a estrutura do zero. E você mantém o `catalogueId` para que futuras atualizações do catálogo se mesclem de forma limpa.

!!! warning "Não faça"
    Não crie tipos de card personalizados para capacidades ou processos apenas para "torná-los seus". Os tipos integrados vêm com os campos certos, os tipos de relação certos e os relatórios certos — equivalentes personalizados não terão isso.

## Verifique antes de prosseguir

Você terminou esta página quando:

- O mapa de capacidades para seu escopo existe no inventário (filtre por Tipo = `Business Capability`).
- A hierarquia está intacta — abra algumas capacidades L2 e verifique se o breadcrumb pai mostra o L1 correto.
- A contagem de capacidades está entre 20 e 60.

Você ainda não mapeou nenhuma aplicação para capacidades — isso fica para a página final. Primeiro, vamos adicionar um campo personalizado às Aplicações para tornar a análise realmente útil.

Próximo: [Personalize o metamodelo — levemente](customise-the-metamodel.md).
