# Roadmap Studio

A todas as funções de EA o seu CIO faz as mesmas duas perguntas: *qual será o
aspeto do panorama daqui a três anos* e *o que acontece se escolhermos de outra
forma?* As apresentações respondem mal à primeira e nada à segunda — ficam
desatualizadas na semana seguinte ao comité de direção, e duas delas não se
comparam.

**Roadmap Studio** responde a ambas a partir do inventário que já mantém. Um
**cenário** é um plano assente sobre o seu panorama vivo — retirar isto,
substituir aquilo nesta data, acrescentar estas três coisas que ainda não
existem — guardado como um conjunto de alterações e não como uma cópia do seu
grafo. Nada do que explora toca no seu inventário até um plano ser aprovado e
aplicado, e como o plano é lido em face do que o inventário diz hoje, nunca se
afasta em silêncio da realidade.

## Num relance

| | |
|---|---|
| **Licença** | Comercial — é necessária uma habilitação assinada |
| **Versão mínima do Turbo EA** | 2.119.0 |
| **Permissões** | `ext.roadmap-studio.view`, `.manage`, `.apply`, `.admin` |
| **Concessões de acesso a dados** | Cartões (leitura + escrita), eventos de cartão, tarefas (leitura + escrita), o diretório de utilizadores, os registos de decisão |
| **Reinício do backend necessário** | Sim — a extensão traz código de backend |
| **Onde aparece** | **Roadmap** na navegação principal · um chip no detalhe de um cartão · um painel e uma secção de exportação nas decisões |

## Transformações e cenários

Uma **transformação** é o programa a que pertence um conjunto de planos
concorrentes — «Modernização do ERP», por exemplo — e nomeia os
[Objetivos](../guide/reports.md) pelos quais o programa responde. Por baixo estão
os **cenários**: respostas alternativas à mesma pergunta. Um deles pode ser
marcado como **recomendado**, para que a sala saiba o que o arquiteto propõe
antes de os números serem lidos.

Um cenário fora de qualquer transformação é perfeitamente válido; simplesmente
não tem alternativas em face das quais ser escolhido.

## O inventário de planeamento e a roadmap

![A roadmap: pistas, patamares e a faixa de custos](../assets/img/en/73_ext_roadmap_studio_roadmap.png)

A **roadmap** desenha o plano como barras datadas em pistas, com uma faixa de
custos por baixo a mostrar o custo de funcionamento ano a ano — incluindo o pico
durante um funcionamento em paralelo, que é justamente o número que um caso de
negócio de migração costuma esconder.

![O inventário de planeamento](../assets/img/en/74_ext_roadmap_studio_inventory.png)

O **inventário de planeamento** é o mesmo plano em grelha: os seus cartões vivos
mais os planeados, com cada alteração sobre eles. Os cartões planeados vivem
dentro do cenário e nunca no seu inventário principal.

Uma alteração cujo cartão-alvo tenha entretanto sido arquivado, movido ou
redatado noutro sítio é **assinalada como obsoleta**, com o motivo — assim um
plano escrito há três meses diz-lhe o que se mexeu por baixo dele.

## Patamares e o corte de arquitetura

![A arquitetura num patamar](../assets/img/en/75_ext_roadmap_studio_architecture.png)

Como cada alteração tem uma data, a arquitetura em qualquer momento é apenas o
cenário avaliado nessa data. Dê nome aos momentos que interessam como
**patamares** — «T1 · Consolidação do núcleo, 3.º trim. 2027» — e percorra-os: a
roadmap, a vista de dependências e os números avançam em conjunto.

## Comparar cenários

![Cenários face a não fazer nada](../assets/img/en/76_ext_roadmap_studio_compare.png)

**Comparar** coloca cada cenário ao lado da linha de base de não fazer nada em
custo de funcionamento no horizonte, despesa de transformação, número de cartões
e exposição ao fim de vida, com os **prós e contras** de cada plano escritos ao
lado dos seus números. Uma taxa de desconto opcional aplica-se aos anos futuros.

## Onde o plano encontra o cartão

![O lugar de um cartão nos planos](../assets/img/en/77_ext_roadmap_studio_card_panel.png)

Abra qualquer cartão do seu inventário e um chip diz-lhe que planos o mencionam e
como — como algo que está a ser retirado, como sucessor numa substituição, ou
como cartão que um plano coloca sob um novo pai.

## Revisão, decisão e aplicação

Este é o caminho de governação, e separa três coisas genuinamente diferentes: o
**aconselhamento**, **a decisão** e **a escrita**.

### 1 · Pedir revisão

**Pedir revisão** nomeia as pessoas cuja opinião quer e cria uma tarefa real para
cada uma, que chega à sua página de Tarefas e ao seu sino de notificações. O
seletor abrange todo o diretório — um revisor é quem puder ajudar *neste* plano:
o arquiteto de segurança para um, o parceiro financeiro para outro.

Cada revisor responde na aplicação com **Apoiar**, **Pedir alterações** ou
**Comentar**, mais uma nota. As respostas são aconselhamento. Não decidem nada, e
é por isso que já não usam as palavras «aprovar» e «rejeitar».

### 2 · Discuti-lo

Qualquer pessoa que possa ler o plano pode escrever na sua **discussão**. O fio
carrega toda a história pela ordem em que aconteceu: comentários, cada resposta
de revisão (não apenas a última) e depois as submissões e os votos. O comité lê a
mesma conversa que os revisores tiveram, em vez de receber um veredicto sem os
argumentos que o sustentam.

### 3 · Submetê-lo ao comité de revisão

Um **comité de revisão** é um grupo de pessoas com nome, associado a uma
transformação (ver abaixo). Quando um plano tem um, **Submeter para decisão**
envia-o para lá:

- o estado passa a **A aguardar decisão** e o conteúdo do plano é **bloqueado**,
  para que todos votem sobre o mesmo documento;
- cada membro recebe uma tarefa *Decidir sobre …*, com a habitual notificação de
  atribuição;
- é aqui que escolhe se a aprovação deve arquivar um **registo de decisão** e
  criar as **iniciativas** — decidido na submissão, para que quem vota veja o que
  o seu sim vai criar.

O **controlo de aprovação** (Admin → Definições, ver abaixo) pode reter um plano
antes do seu comité até os revisores terem respondido.

### 4 · O comité vota

Cada membro vota **Aprovar**, **Rejeitar** ou **Abster-se**, com uma nota
opcional, e pode mudar o voto enquanto a ronda estiver aberta. A caixa mostra a
contagem, quantas aprovações ainda faltam e o que cada membro disse.

A ronda resolve-se assim que a **regra de decisão** do comité fica determinada:

| Regra | Aprova quando | Rejeita quando |
|---|---|---|
| **Maioria** (predefinição) | Mais de metade aprova | Rejeitaram tantos que a maioria é impossível |
| **Unanimidade** | Todos os membros aprovam | Um membro rejeita **ou** se abstém |
| **Qualquer membro** | Um membro aprova | Todos votaram, nenhum aprovando |

A rejeição chega assim que a aprovação se tornou aritmeticamente impossível, e
não depois de todos terem votado sobre uma questão já decidida.

O que permite votar é **pertencer ao comité** — `ext.roadmap-studio.apply` não é
necessário. O **autor do plano pode votar** no seu próprio plano; a caixa diz-lo
com clareza e o registo nomeia quem votou.

**Retirar** tira um plano das mãos do comité antes de ele ter decidido. Podem
fazê-lo o autor, quem o submeteu e qualquer membro — um comité que quer uma
reformulação não deveria ter de rejeitar o plano para a pedir. As tarefas dos
membros são removidas, não marcadas como feitas, e o plano volta à revisão.

### 5 · O que a aprovação faz

O voto decisivo faz tudo de uma vez: os cenários concorrentes da mesma
transformação são **rejeitados**, o plano é **bloqueado**, os pedidos em aberto
são saldados, as **iniciativas** são criadas (um programa para a transformação,
um projeto por patamar) e um **registo de decisão** é arquivado em rascunho em
[Entrega EA → Decisões](../guide/delivery.md), nomeando o comité, a sua regra, a
contagem, cada voto com a sua nota, os objetivos, os patamares, os números face a
não fazer nada e cada alternativa rejeitada. Depois são pedidas assinaturas aos
membros que votaram a favor.

Um plano aprovado é só de leitura até alguém com `ext.roadmap-studio.apply` o
**reabrir**, o que limpa a aprovação.

### 6 · Aplicá-lo

**Aplicar** escreve o plano no seu inventário vivo, sob
`ext.roadmap-studio.apply`. É uma ação separada, muitas vezes meses após a
decisão. Cada escrita passa pela maquinaria de lotes auditada, pelo que aparece em
**Admin → Registo de auditoria** e pode ser revertida. Um utilizador `.manage`
pode abrir o mesmo plano só de leitura para verificar que assentaria sem
problemas.

### Cenários sem comité de revisão

Um cenário fora de uma transformação, ou cuja transformação não tem comité,
mantém o caminho mais simples: alguém com `ext.roadmap-studio.apply` aprova-o
diretamente. Uma equipa pequena sem um órgão de governação para reunir não tem de
inventar um.

## Comités de revisão

Os comités geram-se num único sítio: **Definições → Governação → Gerir comités de
revisão** dentro da página Roadmap (requer `ext.roadmap-studio.admin`). Um comité
tem nome, descrição, até 25 membros e uma **regra de decisão**. Associe-o a uma ou
mais transformações a partir de qualquer um dos lados.

Eliminar um comité desassocia as transformações que revia; nunca as elimina, e
nunca toca no registo do que decidiu no passado.

## Definições e histórico

![Definições e histórico de atividade](../assets/img/en/79_ext_roadmap_studio_settings.png)

O separador **Definições** da página Roadmap (requer `ext.roadmap-studio.admin`)
contém:

| Definição | O que faz |
|---|---|
| **Modelo de custos** | Que atributo guarda o custo anual de funcionamento de um cartão, que tipos de cartão o indicador conta, até onde olha a exposição ao fim de vida, e uma taxa de desconto opcional |
| **Controlo de aprovação** | Se as respostas dos revisores retêm um plano antes do comité: nunca, enquanto forem pedidas alterações, ou até todos terem respondido |
| **Comités de revisão** | Abre a caixa dos comités |

O cartão **Histórico** é um registo completo de atividade — cada plano, cartão,
alteração, patamar, pedido de revisão, resposta, submissão, voto, comentário e
decisão, com quem o fez e o que mudou.

## Modo de apresentação e o baralho

![Modo de apresentação](../assets/img/en/78_ext_roadmap_studio_present.png)

O **modo de apresentação** leva uma sala pelo plano patamar a patamar, e a
exportação para PowerPoint segue exatamente a sequência que acabou de percorrer.

## Dados de demonstração

Um clique nas Definições carrega um panorama de exemplo completo com dois
cenários concorrentes, para experimentar tudo antes de introduzir os seus dados.
Outro clique remove todos os vestígios.

## Permissões

| Permissão | Concede |
|---|---|
| `ext.roadmap-studio.view` | Ver cenários, comparações, patamares, a discussão e a decisão |
| `ext.roadmap-studio.manage` | Criar e editar planos, pedir revisão, submeter para decisão, retirar |
| `ext.roadmap-studio.apply` | Aplicar um plano aprovado ao inventário vivo, reabri-lo e aprovar um plano sem comité de revisão |
| `ext.roadmap-studio.admin` | Definições, comités de revisão e dados de demonstração |

Votar não é uma permissão: decorre da **pertença ao comité** que decide sobre
esse plano, mais `ext.roadmap-studio.view` para o abrir. Qualquer pessoa com
`.view` pode escrever na discussão.

## Se a licença expirar ou a extensão for desativada

A página Roadmap e a sua API desaparecem, mas **nada é eliminado** — cenários,
planos, votos e a discussão ficam nas tabelas próprias da extensão. Os cartões
que a extensão criou no seu inventário são cartões vulgares e não são afetados.
Aplicar uma licença renovada traz tudo de volta.

## Notas e limitações

- **Um plano de cada vez** vai ao comité dentro da mesma transformação.
- **Sem presidência e sem votos ponderados.** Cada voto conta uma vez e não há
  voto de qualidade.
- **Sem lembretes.** Uma ronda fica aberta até a regra a resolver ou alguém a
  retirar.
- **O autor do plano pode votar** no seu próprio plano. É deliberado: um comité
  pequeno cujo arquiteto não pudesse votar não conseguiria decidir nada, e cada
  voto é nomeado no registo.
- A extensão traz código de backend, pelo que instalá-la ou atualizá-la exige um
  reinício pontual do backend. O Turbo EA mostra um aviso quando é o caso.
