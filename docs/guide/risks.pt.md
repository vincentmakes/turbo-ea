# Registo de Riscos

O **Registo de Riscos** captura os riscos de arquitetura ao longo de todo o seu ciclo de vida — da identificação à mitigação, avaliação residual, monitorização e fecho (ou aceitação formal). Vive como o separador **Risco** do [módulo GRC](grc.md) em `/grc?tab=risk`.

## Alinhamento com TOGAF

O registo implementa o processo de Gestão de Riscos de Arquitetura da **TOGAF ADM Fase G — Governança da Implementação** (TOGAF 10 §27):

| Passo TOGAF | O que é capturado |
|-------------|-------------------|
| Classificação do risco | `Categoria` (security, compliance, operational, technology, financial, reputational, strategic) |
| Identificação do risco | `Título`, `Descrição`, `Origem` (manual ou promovida a partir de um achado TurboLens) |
| Avaliação inicial | `Probabilidade inicial × Impacto inicial → Nível inicial` (derivado automaticamente) |
| Mitigação | Uma ou mais **tarefas de mitigação** — itens de trabalho atribuídos, únicos ou recorrentes (ver [Tarefas de mitigação](#mitigation-tasks) abaixo). O risco também tem um `Proprietário` e uma `Data-alvo de resolução`. |
| Avaliação residual | `Probabilidade residual × Impacto residual → Nível residual` (editável assim que a mitigação é planeada). Continua a ser uma avaliação **manual** — concluir uma tarefa não a ajusta automaticamente. A página de detalhe mostra ao lado do bloco residual um resumo «X/Y abertas · Z em atraso» como contexto para o juízo humano (alinhado com ISO 31000). |
| Monitorização / aceitação | Fluxo de `Estado`: identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed (com um ramo lateral `accepted` que requer uma justificação explícita) |

## Criar um risco

Três caminhos convergem no mesmo diálogo **Criar risco** — cada variante pré-preenche campos diferentes para que possa editar e submeter:

As três variantes incluem os campos **Proprietário**, **Categoria** e **Data-alvo de resolução** para atribuir responsabilidade logo na criação — sem necessidade de reabrir o risco.

A promoção é **idempotente** — depois que um achado é promovido, o seu botão passa a **Abrir risco R-000123** e navega diretamente para a página de detalhe do risco.

## Propriedade → Todo + notificação

Atribuir um **proprietário** (na criação ou mais tarde) gera automaticamente:

- Um **Todo de sistema** na página de Todos do proprietário. A descrição é `[Risk R-000123] <título>`, a data-limite reflete a data-alvo de resolução do risco e o link volta ao detalhe do risco. O Todo é marcado como **concluído** automaticamente quando o risco atinge `mitigated` / `monitoring` / `accepted` / `closed`.
- Uma **notificação no sino** (`risk_assigned`) — visível no menu do sino e na página de notificações, com e-mail opcional se o utilizador tiver ativado essa preferência. A auto-atribuição também dispara o sino, para que o rasto seja consistente entre fluxos de equipa e pessoais.

Limpar ou reatribuir o proprietário mantém o Todo sincronizado — o antigo é removido / reatribuído.

A mesma mecânica é acionada de forma independente para **cada tarefa de mitigação** do risco, de modo que um colaborador só vê o trabalho que lhe está atribuído — ver [Tarefas de mitigação](#mitigation-tasks) abaixo.

## Ligar riscos a cards

Os riscos são **muitos-para-muitos** com os cards. Um risco pode afetar várias Aplicações ou Componentes de TI, e um card pode ter vários riscos ligados:

- A partir da página de detalhe do risco: painel **Fichas afetadas** → escolha uma ficha e adicione-a. Clique num `×` para desligar. O seletor mostra logo uma lista navegável (não é preciso escrever), carrega mais fichas ao percorrer e esconde as que já estão associadas.
- A partir de qualquer página de detalhe de card: o novo separador **Riscos** lista cada risco ligado a esse card, com um regresso em um clique ao registo.

As fichas associadas são **agrupadas por tipo de ficha**, ordenadas alfabeticamente dentro de cada grupo e coloridas com a cor do próprio tipo, pelo que um risco que toca uma dúzia de fichas de vários tipos continua legível num relance. A mesma ordenação e as mesmas cores aplicam-se à coluna **Fichas** da grelha do registo, onde cada ficha surge como um chip na cor do seu tipo — a dica da célula lista o conjunto completo sob cabeçalhos de tipo.

## Tarefas de mitigação {: #mitigation-tasks }

A mitigação é capturada como **itens de trabalho atribuídos**, não como texto livre. Na página de detalhe do risco, o painel **Tarefas de mitigação** substitui o antigo campo único «plano de mitigação» — cada linha é uma tarefa real com o próprio proprietário, data-limite, histórico e (opcionalmente) regra de recorrência.

### Única vs. recorrente

Uma tarefa de mitigação é **única** por defeito — adequada para «Implementar MFA», «Assinar SCC atualizadas» ou qualquer trabalho com formato de projeto. Ative **Repete-se** no diálogo da tarefa e obtém uma **revisão de controlo recorrente**: por ex. «Re-atestar a documentação de transferência transfronteiriça a cada 12 meses», «Executar o tabletop de resposta a incidentes OT a cada 3 meses», «Auditar credenciais Jenkins semanalmente».

As tarefas recorrentes acumulam um **ciclo** (`occurrence`) por período. O próximo ciclo é criado automaticamente ao fechar o atual — com aritmética de calendário correta: uma tarefa mensal com vencimento a 31 de janeiro avança para 28 de fevereiro, não para 3 de março.

### A janela de antecedência

O sentido de uma revisão de controlo recorrente é que a pessoa responsável seja lembrada **mesmo antes do prazo** — não no momento em que o ciclo anterior foi fechado. Por isso cada tarefa recorrente tem um **Tempo de antecedência** (dias) — quantos dias antes de `due_date` o ciclo se ativa e aparece na lista `/todos` da pessoa atribuída.

Cada ciclo atravessa três estados visíveis:

| Estado | Significado | Visível em /todos? |
|--------|-------------|--------------------|
| **Agendada** | O próximo ciclo existe para a trilha de auditoria («próxima revisão: prazo 15/11/2026») mas está dormente. Hoje ainda está fora da janela de antecedência. | Não |
| **Aberta** | A janela de antecedência abriu-se. Um Todo de sistema `[Risk R-000123] <título da tarefa>` aparece na lista da pessoa atribuída; é disparada uma notificação `task_assigned`. | Sim (separador Abertas) |
| **Concluída** / **Saltada** | A pessoa atribuída fechou o ciclo. O Todo passa para `done` e permanece no separador **Concluídas** como registo histórico. | Sim (separador Concluídas) |

O diálogo sugere uma antecedência razoável por unidade de recorrência (1 dia diária, 2 semanal, 7 mensal, 14 anual — limitada a metade do ciclo, para que a janela nunca se sobreponha ao ciclo anterior). A sugestão atualiza-se à medida que muda a unidade ou o intervalo, até que edite o campo manualmente.

Uma vez por dia às **03:00 UTC** um processo de fundo varre todos os ciclos agendados e promove aqueles cuja janela se abriu. Precisa iniciar uma revisão mais cedo? Clique **Ativar agora** (ícone raio na linha da tarefa) para mudar um ciclo agendado para aberto imediatamente — mesma mecânica de Todo e notificação, sem espera.

### Histórico de auditoria por ciclo

Clique na seta de expansão de uma linha de tarefa para ver o histórico completo de ciclos. Cada ocorrência regista:

- A **data-alvo** no momento do agendamento.
- Quem estava **atribuído** quando o ciclo foi aberto (`assigned_owner_id`), para que as revisões históricas mantenham o seu proprietário original mesmo que o papel mude depois.
- Para ciclos fechados: quem o **concluiu** (`completed_by`), o carimbo temporal, o **instantâneo proprietário-no-fecho** (pode diferir do atribuído se houve rotação a meio do ciclo) e quaisquer notas livres de fecho.
- Para ciclos ativados: o **carimbo temporal de ativação** (para que a auditoria possa verificar que a promoção diária ocorreu no dia certo).

Isto sobrevive limpamente a anos de rotação de proprietários — a resposta de auditoria a «Quem assinou a revisão de janeiro de 2024?» fica a um clique da tarefa e não se perde com reequilíbrios de responsabilidade.

### Permissões e pessoas atribuídas

- **Adicionar / editar / eliminar tarefas** — requer `risks.manage` (admin / bpm_admin / member por defeito).
- **Concluir o ciclo aberto** — `risks.manage` **ou** o utilizador atualmente atribuído a esse ciclo. Assim um Viewer atribuído a uma revisão de controlo pode fechar o seu próprio ciclo sem escalar.
- **Saltar um ciclo / Ativar agora** — exigem sempre `risks.manage`. Saltar avança a recorrência sem afirmar que o trabalho foi feito; ativar adianta um ciclo agendado e é uma ação de planeamento.

### Promoção a partir de uma constatação de conformidade TurboLens

Quando clica em **Criar risco** numa constatação não conforme (ver [TurboLens](turbolens.md#promote-a-finding-to-the-risk-register)), o novo risco recebe também uma **tarefa de mitigação única** inicializada a partir do texto de remediação da constatação — a análise de lacuna passa assim diretamente a trabalho atribuído e acionável.

### Exportação {: #export }

O botão **Exportar** do Registo de Riscos escreve um `.xlsx` de duas folhas: a folha 1 é a grelha de riscos filtrada, a folha 2 é uma linha por ciclo de cada tarefa de cada risco no mesmo filtro, incluindo tempo de antecedência e carimbo de ativação. Use-o para pacotes de auditoria ou para partes interessadas sem acesso ao Turbo EA. Cada linha de tarefa no painel de detalhe dispõe também do próprio botão **Exportar histórico** para um livro por tarefa.

### Importação {: #import }

O botão **Importar**, ao lado de «Exportar», carrega riscos em massa a partir de um ficheiro `.xlsx`. Clique em **Descarregar modelo** para obter um livro inicial com os cabeçalhos corretos, preencha um risco por linha e carregue-o. Uma linha cuja `reference` corresponde a um risco existente é **ignorada** (o importador nunca atualiza riscos existentes), pelo que reimportar um registo exportado anteriormente é idempotente; cada outra linha cria um risco **totalmente novo** com uma referência `R-NNNNNN` gerada automaticamente. A pré-visualização indica quantas linhas serão ignoradas antes de confirmar.

Colunas reconhecidas: `title` (obrigatório), `description`, `category`, `initial_probability`, `initial_impact`, `residual_probability`, `residual_impact`, `status`, `owner_email`, `target_resolution_date` (`YYYY-MM-DD`) e `cards` (nomes de fichas separados por ponto e vírgula). Os responsáveis são associados por e-mail e as fichas por nome exato, **na medida do possível** — tudo o que não puder ser associado é ignorado com um aviso não bloqueante e o risco é importado na mesma. Antes de escrever qualquer coisa, é apresentada uma pré-visualização que mostra quantas linhas serão criadas, quais têm erros e os eventuais avisos; nada é guardado até confirmar. Requer a permissão `risks.manage`.

## Matriz de riscos

Tanto a Visão Geral de Segurança do TurboLens como a página do Registo de Riscos apresentam um mapa de calor probabilidade × impacto 4×4. As células são **clicáveis** — clique numa para filtrar a lista abaixo por esse compartimento, clique novamente (ou no × do chip) para limpar. No Registo de Riscos pode alternar a matriz entre as vistas **Inicial** e **Residual** para que o progresso da mitigação apareça visualmente.

## Grelha do registo

O registo é um AG Grid que segue os padrões da página [Inventário](inventory.md): colunas ordenáveis, filtráveis e redimensionáveis com preferências por utilizador persistidas (colunas visíveis, ordenação, estado da barra lateral). Um botão **+ Novo risco** na barra de ferramentas abre o diálogo de criação manual. O botão **Exportar** da barra de ferramentas escreve um `.xlsx` de duas folhas com a grelha de riscos filtrada na folha 1 e uma linha por ciclo de tarefa de mitigação na folha 2 — ver [Tarefas de mitigação → Exportação](#export) para o formato de colunas.

### Filtrar por fichas afetadas

A barra lateral de filtros à esquerda tem uma secção **Fichas afetadas** que responde às perguntas de paisagem que o filtro de coluna não cobre:

- **Fichas** — escolha uma ou mais fichas concretas para ver todos os riscos que afetam *qualquer uma* delas («mostrar todos os riscos que afetam as aplicações A, B e C»). A lista oferece cada ficha associada a pelo menos um risco, pesquisável por nome.
- **Tipo de ficha** — marque um ou mais tipos para ver todos os riscos que tocam *qualquer* ficha desses tipos («mostrar todos os riscos que afetam uma aplicação»), sem nomear fichas individuais.

Cada lista corresponde a **qualquer uma** das suas próprias seleções; as duas listas combinam-se com **e**. Marcar `Application` e escolher a ficha *Payments Gateway* devolve portanto os riscos que afetam Payments Gateway **e** tocam pelo menos uma aplicação.

Tal como qualquer outro filtro da barra lateral, estes restringem a página inteira — os mosaicos de KPI, a matriz 4×4, a grelha e ambas as folhas da exportação `.xlsx` seguem a seleção ativa.

## Propagação Risco ↔ Constatação

Se um Risco foi [promovido a partir de uma constatação TurboLens](turbolens.md#promote-a-finding-to-the-risk-register), as alterações de estado fluem em **ambos os sentidos**:

- A constatação passa a exibir um back-link **Abrir risco R-000123** assim que é promovida (a ação é idempotente — clicar novamente navega para o risco existente em vez de criar duplicado).
- Quando o Risco atinge `mitigated` / `monitoring` / `closed` / `accepted` (ou é excluído), o motor de retro-propagação transiciona automaticamente cada constatação de conformidade vinculada para o valor correspondente (`mitigated` / `verified` / `accepted` / `in_review`). A justificativa de aceitação capturada no Risco é espelhada na nota de revisão da constatação para que a trilha de auditoria permaneça consistente.

Isto mantém o Registo de Riscos (visão de governança) e a grelha Conformidade (visão operacional) alinhados sem manutenção manual.

## Fluxo de estado

A página de detalhe mostra sempre um único botão primário **Próximo passo** mais uma pequena linha de ações laterais, de modo que o caminho sequencial seja óbvio mas as saídas de governança fiquem a um clique de distância:

| Estado atual | Próximo passo (botão primário) | Ações laterais |
|---|---|---|
| identified | Iniciar análise | Aceitar risco |
| analysed | Planear mitigação | Aceitar risco |
| mitigation_planned | Iniciar mitigação | Aceitar risco |
| in_progress | Marcar mitigado | Aceitar risco |
| mitigated | Iniciar monitorização | Retomar mitigação · Fechar sem monitorização |
| monitoring | Fechar | Retomar mitigação · Aceitar risco |
| accepted | — | Reabrir · Fechar |
| closed | — | Reabrir |

Grafo completo de transições (validado pelo servidor):

```
identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed
       │           │             │                │            ▲           ▲
       └───────────┴─────────────┴────────────────┴──── accepted (justificação requerida)
                                                              │
                              reopen → in_progress ◄──────────┘
```

- **Aceitar** um risco requer uma justificação de aceitação. Utilizador, carimbo temporal e justificação ficam registados no registo.
- **Reabrir** um risco `accepted` / `closed` volta para `in_progress`. O estado `mitigated` também permite uma «Retomar mitigação» manual sem necessidade de uma reabertura completa.

## Permissões

| Permissão | Quem a recebe por omissão |
|-----------|----------------------------|
| `risks.view` | admin, bpm_admin, member, viewer |
| `risks.manage` | admin, bpm_admin, member |

Os viewers podem ver o registo e os riscos nos cards mas não podem criar, editar ou apagar.
