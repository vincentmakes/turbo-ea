# Planeamento de transição

O planeamento de transição é uma ferramenta manual de planeamento em **EA Delivery** para modelar alterações ao seu panorama — substituir uma aplicação por outra para uma determinada organização, descontinuar um sistema legado ou introduzir uma nova plataforma — e comunicá-las como um **único diagrama antes/depois**. Oferece um resultado semelhante ao TurboLens Architect, mas sem qualquer IA: mantém o controlo total de cada alteração proposta.

O resultado é uma Layered Dependency View que mostra o estado atual e o planeado numa única imagem, com indicadores de alteração:

- **Cruz vermelha** — um cartão ou relação marcado para remoção
- **Mais verde** — um cartão ou relação recém-adicionado
- **Setas de troca azuis** — uma substituição: o cartão sucessor e as ligações que herda

## Criar um plano

Abra **EA Delivery** e use **Adicionar → Novo plano de transição** numa iniciativa (ou crie um plano sem ligação e associe-o mais tarde). Um plano constrói-se em quatro passos:

1. **Objetivos de negócio** *(opcional)* — indique os cartões Objetivo que esta alteração apoia. Aparecem na camada de Estratégia do diagrama, para que cada interessado veja o *porquê* ao lado do *quê*, e preenchem previamente as ligações da iniciativa ao confirmar o plano.
2. **Âmbito e linha de base** — escolha um ou mais cartões de âmbito (uma organização, uma capacidade de negócio, aplicações individuais, …) e uma profundidade de dependências (1–3). **Capturar linha de base** tira um instantâneo do panorama circundante como imagem «antes». O instantâneo mantém o diagrama estável mesmo que o inventário mude; use **Atualizar linha de base** para a recapturar mais tarde — qualquer alteração planeada cujo alvo tenha desaparecido é assinalada.
3. **Alterações planeadas** — aplique operações de alteração a partir da caixa de ferramentas:
    - **Adicionar cartão** — traga um cartão existente para a imagem, ou proponha um completamente novo (nome + tipo).
    - **Remover cartão** — marque um cartão para descontinuação. As suas ligações ficam vermelhas.
    - **Substituir cartão** — escolha o cartão a substituir e o seu sucessor (existente ou proposto). O sucessor herda as relações do antecessor, mostradas como arestas de troca azuis; corte relações herdadas individuais com **Remover relação**.
    - **Adicionar / remover relação** — trace novas ligações ou corte as existentes. Os tipos de relação são validados contra o metamodelo.
4. **Pré-visualização ao vivo** — o diagrama antes/depois fundido atualiza-se enquanto planeia. Guarde o plano em qualquer altura; aparece na secção **Entregáveis** da iniciativa.

## Compreender as consequências

O planeamento de transição é mais do que um editor de diagramas — enquanto planeia, um painel de **Consequências** torna o impacto arquitetural visível. Os mesmos números aparecem na pré-visualização partilhável e são integrados no ADR confirmado:

- **Análise de lacunas** — um resumo ao estilo TOGAF Adicionado / Removido / Modificado / Mantido.
- **Impacto / raio de afetação** — remover ou substituir um cartão mostra o que depende dele (« *N aplicações, M interfaces dependem deste* »), a partir da análise de impacto do cartão.
- **Lacunas de cobertura de capacidades** — se uma capacidade de negócio perde *todas* as suas aplicações de suporte no estado alvo, é assinalada.
- **Diferenças de custo e risco** — o custo anual estimado antes → depois (com a diferença) e o número de riscos abertos nos cartões afetados. Os cartões propostos contribuem com o seu custo estimado, também escrito no cartão criado ao confirmar.

## Confirmar um plano

Um plano em rascunho pode ser **confirmado** (requer a permissão *Confirmar planos de transição*). A confirmação:

- cria um cartão **Iniciativa** (com o nome e as datas de início/fim escolhidos) ligado aos objetivos apoiados,
- cria os **cartões propostos** e as **relações** selecionados, ligando cada cartão novo à iniciativa,
- carimba uma data de **fim de vida** (a data de fim da iniciativa) nos cartões removidos e substituídos, para que os relatórios de ciclo de vida e os roteiros reflitam o plano,
- opcionalmente cria um **rascunho de Architecture Decision Record** que documenta cada alteração — incluindo as relações cortadas, que são apenas documentadas e nunca eliminadas.

!!! note
    A confirmação nunca arquiva nem elimina nada. Os cartões removidos recebem uma data de fim de vida; a sua descontinuação efetiva continua a ser um passo humano deliberado através dos fluxos normais do inventário.

Após a confirmação, o plano torna-se apenas de leitura e liga à iniciativa criada.

## Permissões

| Permissão | Concede |
|-----------|---------|
| `transition_plans.view` | Ver planos de transição |
| `transition_plans.manage` | Criar, editar e eliminar planos |
| `transition_plans.commit` | Confirmar um plano (criar iniciativa, cartões, relações, rascunho de ADR, carimbar datas de fim de vida) |

Os membros podem ver, gerir e confirmar planos por predefinição; os visualizadores apenas os podem consultar.
