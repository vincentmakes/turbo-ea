# Automations

Grande parte da governação de EA é uma lista de coisas que alguém prometeu
fazer à mão: levantar um risco quando uma aplicação ultrapassa um limiar de
custo sem responsável, ir atrás do responsável técnico quando um componente
chega ao fim de vida, avisar o responsável de negócio quando um cartão aprovado
é editado. A lista está certa; o que falha é o fazer, porque cada item é um
lembrete na cabeça de alguém e não uma regra que a plataforma cumpre.

**Automations** transforma essas promessas em regras que o Turbo EA executa por
si. Uma regra constrói-se inteiramente a partir de listas pendentes — *quando*
algo acontece no panorama, *se* as condições se verificam, *então* executar
ações — e cada execução fica registada como um lote de mutação no Registo de
auditoria, pelo que uma regra que correu mal se desfaz com um clique.

## Num relance

| | |
|---|---|
| **Licença** | Comercial — é necessária uma habilitação assinada |
| **Versão mínima do Turbo EA** | 2.126.0 |
| **Permissões** | `ext.automations.view`, `ext.automations.manage` |
| **Concessões de acesso a dados** | Cartões (leitura + escrita), eventos de cartão e de tarefa, tarefas (leitura + escrita), o diretório de utilizadores, riscos (leitura + escrita), registos de decisão, notificações, papéis de partes interessadas |
| **Reinício do backend necessário** | Sim — a extensão traz código de backend |
| **Onde aparece** | **Automations** na secção **Admin** do menu do utilizador · um chip com o número de execuções no detalhe do cartão |

## Uma regra: quando, se, então

![A grelha de regras](../assets/img/en/86_ext_automations_rules.png)

O separador **Regras** lista cada regra com o seu gatilho, o tipo de cartão, as
ações, um interruptor de ativação, a última execução e um botão de reprodução.
Abra uma para ver o editor.

![O editor de regras](../assets/img/en/87_ext_automations_editor.png)

O editor lê-lhe a regra em palavras simples no topo e percorre depois as suas
três partes:

**Quando** — o que inicia uma execução. Uma regra observa um tipo de cartão e
dispara com um de:

| Gatilho | Dispara quando |
|---|---|
| um cartão é criado / atualizado / arquivado / restaurado | esse cartão muda |
| uma relação é adicionada / removida | uma relação, opcionalmente de um tipo indicado, toca o cartão |
| uma tarefa é concluída | uma tarefa associada ao cartão é fechada |
| segundo um horário | chega a vez de uma expressão cron de cinco campos (UTC) — a regra verifica então todos os cartões do tipo |

**Se** — as condições, em grupos aninhados **todas as** / **qualquer uma das**.
Cada linha é um campo, um operador e um valor escolhidos em listas pendentes:
os campos próprios do cartão e as fases do ciclo de vida, as suas etiquetas, os
seus papéis de partes interessadas (*não é detido por ninguém*, *é detido
por*…), as suas relações, o seu estado de fim de vida nas Aplicações e nos
Componentes de TI e — em *um cartão é atualizado* — o que **mudou**, para que
uma regra dispare apenas quando um valor passou de um estado a outro. Deixe o
grupo vazio para executar em todos os cartões.

**Então** — as ações, executadas por ordem. Uma ação que falha interrompe a
execução e a linha da execução indica qual foi o passo que falhou.

| Ação | O que faz | Precisa de |
|---|---|---|
| Definir / limpar um campo, definir uma data do ciclo de vida, definir o subtipo, o pai, o nome ou a descrição | Edita o cartão | escrita no inventário |
| Definir etiquetas | Substitui, adiciona ou remove etiquetas, respeitando os grupos de escolha única | escrita no inventário |
| Criar um cartão relacionado, ligar uma relação | Adiciona um cartão de outro tipo e liga-o, ou liga dois cartões existentes | escrita no inventário |
| Arquivar o cartão | Arquiva-o (recuperável durante 30 dias) | escrita no inventário |
| Atribuir / remover um papel de parte interessada | Dá um papel a uma pessoa, a quem detém um papel, a quem detém o papel no cartão pai ou à pessoa que acionou a regra | papéis de partes interessadas |
| Criar uma tarefa | Uma tarefa no cartão para um responsável, com prazo | tarefas |
| Notificar pessoas | Uma notificação na aplicação / por e-mail segundo as preferências de cada destinatário | notificações |
| Levantar um risco, atualizar um risco | Regista um risco no Registo de Riscos com categoria, probabilidade e impacto, ligado ao cartão e com um proprietário; uma execução posterior pode atualizar o título, o proprietário ou a data-alvo | riscos |
| Arquivar um rascunho de decisão | Um registo de decisão de arquitetura em rascunho ligado ao cartão — nunca assinado por uma regra | registos de decisão |
| Chamar um webhook | Um pedido HTTPS assinado a um sistema externo com o cartão, o que mudou e a regra | — |
| Parar | Termina a lista de ações | — |

Os títulos, as descrições e as mensagens são modelos: `{{card.name}}`,
`{{card.attributes.costTotalAnnual}}`, `{{actor.name}}`, `{{change.old}}` e
semelhantes são preenchidos por cartão, e o editor propõe as variáveis num
menu.

Por baixo das ações há duas opções. **Disparar uma vez por cartão** (ativa por
predefinição) lembra-se daquilo para que uma regra disparou, para que uma regra
noturna não levante o mesmo risco todas as noites; volta a disparar quando os
valores que lê mudam. A **Recuperação noturna** volta a verificar todos os
cartões às 03:00 UTC, pelo que um evento perdido se corrige sozinho.

## Simular e Executar agora

**Simular** executa a regra em todos os cartões do seu tipo em modo de
pré-visualização — nada é escrito — e mostra quantos cartões correspondem e,
por cartão, exatamente o que cada ação faria. Ativar uma regra que nunca foi
simulada pede-lhe que a simule primeiro; pode ainda assim ativá-la sem o fazer.

**Executar agora** faz o mesmo a sério: dispara de imediato para cada cartão
correspondente, respeitando *disparar uma vez por cartão* a menos que assinale
*disparar de novo para os cartões já tratados*. A caixa de resultado mostra o
que foi feito, cartão a cartão, e liga ao lote de auditoria.

![Resultados da execução](../assets/img/en/88_ext_automations_run_results.png)

## Execuções e o Registo de auditoria

![O separador de execuções](../assets/img/en/89_ext_automations_runs.png)

Cada execução é uma linha no separador **Execuções**: que regra, em que cartão,
como começou (um evento, o horário, a recuperação noturna, Executar agora),
como terminou e cada linha de ação. Filtre por regra ou por resultado; o número
de execuções de um cartão aparece como chip na sua página de detalhe.

Cada escrita feita por uma execução chega a **Admin → Definições → Registo de
auditoria** como um lote de extensão com diferenças por evento. Uma
**varredura** — um horário, a recuperação noturna ou Executar agora — é **um
único lote para todos os cartões em que disparou**, pelo que uma regra que
correu mal é um só **Reverter**, e não um por cartão. Reverter anula as escritas
em cartões e relações e, a partir do Turbo EA 2.127.0, os riscos que a execução
levantou ou editou, os papéis que atribuiu, as etiquetas que definiu e os
rascunhos de decisão que arquivou. As tarefas e as notificações ficam
deliberadamente no lugar — um pedido a uma pessoa e uma mensagem entregue não se
desfazem eliminando-os — e a pré-visualização da reversão di-lo antes de
qualquer coisa ser aplicada.

## As notificações são agrupadas

Uma regra nunca envia uma notificação por cartão. Uma varredura recolhe o que
cada pessoa tem a receber e envia **uma** notificação por pessoa e por regra no
final — um único cartão chega como mensagem própria, vários como um resumo que
nomeia os cartões, cujo título define na ação (*Título do resumo*). As
alterações que chegam uma a uma — uma importação que toca trezentos cartões —
enviam a primeira notificação de imediato e retêm as restantes durante a
**janela de agrupamento** das Definições; no minuto seguinte, o que se acumulou
é enviado como um único resumo. As preferências de notificação de cada pessoa
continuam a decidir entre o sino, o e-mail ou um canal de extensão.

## Modelos

O separador **Modelos** é uma galeria de regras prontas a usar — uma aplicação
dispendiosa sem responsável, fim de vida dentro de 180 dias, uma nova aplicação
sem capacidade de negócio, um cartão aprovado que foi editado, qualidade de
dados baixa durante um mês, uma aplicação a entrar em desativação, um cartão
arquivado com relações em aberto, uma iniciativa a tornar-se ativa, uma
aplicação crítica sem responsável técnico, um novo fornecedor registado, um
componente de TI em fim de vida. Cada um abre no editor, desativado, para que o
ajuste e o simule.

## Definições

![Definições](../assets/img/en/90_ext_automations_settings.png)

| Definição | O que faz |
|---|---|
| **Pessoa de reserva** | Recebe a tarefa, o risco ou a notificação quando uma regra não encontra ninguém no papel que pediu |
| **Lista de anfitriões permitidos para webhooks** | Os anfitriões que a ação *Chamar um webhook* pode alcançar, um por linha; vazia, permite qualquer anfitrião HTTPS público. Os endereços privados e internos são sempre recusados |
| **Cartões verificados por execução agendada** | Quantos cartões uma varredura agendada examina antes de parar e deixar o resto para a seguinte |
| **Agrupar as notificações que chegam dentro de** | A janela de agrupamento, em minutos; 0 envia cada uma no minuto seguinte |

## Dados de demonstração

**Carregar dados de demonstração**, nas Definições, instala os modelos e três
regras de demonstração sobre o panorama de exemplo, ativa a maioria delas e
executa algumas uma vez, para que os separadores Regras, Execuções e Registo de
auditoria tenham algo para mostrar. **Remover** retira exatamente isso — as
regras, as execuções, as tarefas e os riscos que criaram.

## Permissões

| Permissão | Concede |
|---|---|
| `ext.automations.view` | Ver as regras, as suas execuções e a galeria de modelos, e o chip com o número de execuções nos cartões |
| `ext.automations.manage` | Criar, editar, ativar, simular, executar e eliminar regras; alterar as definições; carregar dados de demonstração |

## Se a licença expirar ou a extensão for desativada

A página desaparece do menu, os horários param e os eventos deixam de ser
despachados. Nada é eliminado: as regras, as suas execuções e tudo o que
escreveram — cartões, riscos, tarefas, decisões — ficam exatamente como estão.
Renovar a licença ou reativar a extensão traz as regras de volta, ainda ativas.

## Notas e limitações

- O Turbo EA permite a uma extensão 60 lotes auditados por minuto. Uma varredura
  sobre um inventário muito grande faz uma pausa nesse limite e continua no
  ciclo seguinte; Executar agora di-lo no seu resultado e a varredura seguinte
  retoma os cartões restantes.
- Uma regra que observa *um cartão é atualizado* só vê as alterações feitas
  depois de ter sido ativada; use Executar agora ou espere pela recuperação
  noturna para o panorama existente. As condições sobre **o que mudou**
  correspondem apenas a atualizações em direto.
- Os webhooks são apenas HTTPS, assinados com um segredo por instância, nunca
  seguem redirecionamentos e expiram ao fim de 10 segundos; a resposta fica
  registada na execução.
- Uma regra só pode atualizar os riscos que ela própria levantou, e nunca pode
  assinar uma decisão, fazer transitar um risco ou concluir uma tarefa — esses
  continuam a ser atos humanos.
