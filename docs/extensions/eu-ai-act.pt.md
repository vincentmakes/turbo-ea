# EU AI Act Register

O Regulamento da UE sobre IA aplica-se por fases, e todos os fornecedores e
responsáveis pela implantação de sistemas de IA têm de responder às mesmas quatro
perguntas: quais dos seus sistemas são sistemas de IA, que nível de risco tem cada
um, que obrigações decorrem do seu papel e onde está a evidência?

O **EU AI Act Register** responde-lhes nos cartões que o seu repositório de EA já
contém. Destina-se a fornecedores e responsáveis pela implantação de sistemas de IA
e de modelos de IA de finalidade geral (GPAI) que mantêm, ou querem manter, o seu
panorama de TI no Turbo EA.

!!! warning "Regista a sua avaliação — não é aconselhamento jurídico"
    O registo está estruturado segundo o Regulamento (UE) 2024/1689, na redação
    dada pelo Regulamento (UE) 2026/1744. Regista e organiza o trabalho de
    conformidade da sua organização e as decisões das suas pessoas. Não é
    aconselhamento jurídico e não garante a conformidade.

## O registo vive nos seus cartões

O registo **não mantém tabelas próprias** para o seu conteúdo. Cada atributo
regulamentar é um campo de um cartão, editado na própria vista de cartão do Turbo
EA com um texto de ajuda que cita o artigo:

| Objeto do registo | No Turbo EA |
|---|---|
| Sistemas de IA | Cartões de **Aplicação** com *In AI Act scope* ativado |
| Modelos de IA de finalidade geral | Cartões de **Componente de TI** com *GPAI model (Art. 3(63))* ativado |
| Governação da IA de uma organização | Cartões de **Organização** |

A extensão acrescenta estas secções:

| Tipo de cartão | Secção | Contém |
|---|---|---|
| **Aplicação** | EU AI Act | In AI Act scope, Operator role, Risk tier, Annex III category, Annex I regime, Placed on the market before the high-risk date (Art. 111(2)), Art. 6(3) derogation claimed, Art. 6(3) rationale, Intended purpose, Art. 50 transparency duties, Substantially modified (Art. 25), AI Act classification completeness (%) |
| **Aplicação** | EU AI Act — Provider obligations | um estado por obrigação do fornecedor, do Art. 9 ao Art. 73 |
| **Aplicação** | EU AI Act — Deployer obligations | um estado por obrigação do responsável pela implantação do Art. 26, a FRIA (FRIA required, o seu estado e data) e o registo do Art. 49(3) |
| **Componente de TI** | EU AI Act — GPAI / Model | GPAI model (Art. 3(63)), Model origin, Systemic risk (Art. 51), Training compute (log10 FLOPs), os estados das obrigações dos Art. 53 e Art. 55, AI Act classification completeness (%) |
| **Organização** | AI governance (EU AI Act) | AI literacy programme (Art. 4), Body governed by public law, AI governance contact |

Cada estado de obrigação é um de **Not started**, **In progress**,
**Implemented** ou **Not applicable**.

Os campos só aparecem onde são relevantes. Uma Aplicação mostra apenas o
interruptor *In AI Act scope* até ser guardada como abrangida. Depois, cada estado
de obrigação aparece apenas onde a sua obrigação pode aplicar-se ao papel, ao nível
de risco e às condições do cartão, o campo *Placed on the market before the
high-risk date (Art. 111(2))* aparece nos sistemas de risco elevado, e os campos
GPAI de um Componente de TI seguem o seu interruptor GPAI. Um estado já preenchido
permanece visível para poder ser limpo, e os valores ocultos são mantidos, nunca
apagados.

**O chip do cabeçalho.** Cada cartão de sistema de IA e de modelo GPAI mostra
**Obligations implemented** no seu cabeçalho — por exemplo *Obligations
implemented: 0 of 1*. A sua dica lista o que ainda está em aberto, com o estado e
o prazo de cada obrigação, e nomeia qualquer dado de classificação em falta; um
clique abre as obrigações em aberto desse sistema na área de trabalho. Onde não há
nada a contar, indica **No AI Act obligations apply**, **AI Act obligations:
classify first** ou **Prohibited practice (Art. 5)**.

![Um cartão de sistema de IA com a sua secção EU AI Act e o chip do cabeçalho](../assets/img/en/107_ext_eu_ai_act_card.png)

### Duas medidas

O registo apresenta dois valores, e respondem a perguntas diferentes — um sistema
pode estar totalmente classificado e não ter nada implementado.

| | Classification completeness | Obligations implemented |
|---|---|---|
| **Pergunta** | Quanto da classificação está registado? | Quantas das obrigações aplicáveis estão cumpridas? |
| **Sistemas de IA** | Operator role, nível de risco, finalidade prevista e, nos sistemas de risco elevado, a categoria do anexo III ou o regime do anexo I | As obrigações que se aplicam ao sistema por papel, nível de risco e deveres selecionados |
| **Modelos GPAI** | Origem do modelo e classificação do risco sistémico | As obrigações do Art. 53, mais as do Art. 55 para um modelo de risco sistémico |
| **Mostrado** | O campo do cartão *AI Act classification completeness (%)*, o dashboard | O chip do cabeçalho do cartão, o dashboard, o Register e o separador Obligations |

**Implemented** e **Not applicable** contam como cumpridas; **In progress** e
**Not started** não. Onde não há percentagem, o registo diz porquê: **No
obligations apply**, **Classify first** (papel ou nível de risco ainda não
definidos) ou **Prohibited practice** (nada a implementar — o sistema tem de ser
descontinuado ou redesenhado para sair do Art. 5).

## Em resumo

| | |
|---|---|
| **Licença** | Comercial — é necessário um direito de utilização assinado |
| **Versão mínima do Turbo EA** | 2.186.0 |
| **Permissões** | `ext.eu-ai-act.view`, `ext.eu-ai-act.manage`, `ext.eu-ai-act.submit`, `ext.eu-ai-act.admin` |
| **Concessões de acesso a dados** | `core.cards.read`, `core.cards.write`, `core.users.read`, `metamodel.custom_field_types` |
| **Reinício do backend necessário** | Sim — inclui código de backend |
| **Onde aparece** | **Regulamento da IA da UE** no menu **GRC**, com sete separadores (uma entrada de nível superior quando o menu GRC não está disponível para si) · **Relatórios → Regulamento da IA da UE - Painel** (o dashboard como relatório guardável) · as secções EU AI Act e o chip **Obligations implemented** nos cartões · quatro modelos de inquérito · o livro Excel do registo e os documentos Word Annex IV / FRIA |

Enriquece também a regulamentação **EU AI Act** do
[scanner de conformidade](../guide/compliance.md) do núcleo, cujas deteções de IA
alimentam as [Suggestions](#suggestions).

## Primeiros passos

1. **Abra EU AI Act → Settings.** Verifique a **Taxonomy baseline**, defina uma
   **Reference date** se os prazos devem ser avaliados face a uma data diferente de
   hoje e, opcionalmente, carregue os dados de demonstração.
2. **Encontre os sistemas de IA que já tem.** Em **Suggestions**, prima **Find
   suggestions** e aceite os sistemas e modelos que pertencem ao âmbito.
3. **Classifique cada sistema** em **Classify** e aceite o resultado no seu cartão.
4. **Acompanhe as obrigações** em **Obligations**, registando cada estado no
   cartão.
5. **Congele um instantâneo** em **Audit** e descarregue o livro do registo, e os
   documentos Annex IV e FRIA a partir do **Register**.

!!! tip "Recolha os dados junto de quem os possui"
    Quatro modelos de inquérito em **Admin → Inquéritos → Novo a partir de modelo**
    recolhem os campos do AI Act junto dos proprietários dos cartões: **AI system
    intake (EU AI Act)**, **Provider obligations check (EU AI Act)**, **Deployer
    obligations check (EU AI Act)** e **GPAI model check (EU AI Act)**. Cada um
    abre como rascunho, dirigido aos stakeholders responsáveis pelos cartões.

## A área de trabalho

**Regulamento da IA da UE** no menu **GRC** tem sete separadores: **Dashboard**, **Register**,
**Classify**, **Obligations**, **Suggestions**, **Audit** e **Settings**. Cada
lista é uma grelha do Turbo EA com a mesma barra lateral do Inventário — um
separador **Filters** (pesquisa em todas as colunas, mais facetas como nível de
risco, papel, estado, gravidade ou prazo) e um separador **Columns** (mostrar,
ocultar e fixar colunas, lembrado por grelha). Uma linha que nomeia um cartão abre-o
no painel do cartão.

### Dashboard

Cinco mosaicos — **AI systems in scope**, **High-risk**, **Unclassified**, **GPAI
models** e **Overdue obligations** — que abrem cada um as linhas por detrás do seu
número, e uma linha **Validation** com as deteções bloqueantes e os avisos, mais uma
ligação **Open audit**. Abaixo:

- **Risk-tier distribution** pelos sistemas no âmbito.
- **Compliance quadrant** — cada sistema posicionado pela exposição regulamentar
  (as obrigações aplicáveis) face a **Obligations implemented**, em quatro zonas:
  **Act now**, **On track**, **Monitor** e **Comfortable**. Os sistemas na mesma
  posição partilham um disco que mostra quantos lá estão. Os sistemas sem
  percentagem não são representados; uma linha sob o gráfico conta-os.
- **Ranked by urgency** — os mesmos sistemas como lista, com uma coluna por medida.
  Clicar num sistema abre a sua **caixa de diálogo de estado**: as duas medidas com
  o seu detalhe, os dados de classificação ainda em falta e as obrigações em aberto
  com estado e prazo, com **Open card** e **Show in Obligations**.
- **Applicability timeline (Art. 113)** — os marcos da tabela em
  [Obligations](#obligations), cada um marcado como em vigor ou em contagem
  decrescente.

![O dashboard do EU AI Act](../assets/img/en/104_ext_eu_ai_act_dashboard.png)

### Register

Duas vistas — **AI systems** e **GPAI models** — cada uma uma grelha dos cartões do
registo. Para um sistema mostra o nível de risco, o papel, a base de classificação,
**Obligations implemented** (um clique abre as obrigações em aberto desse sistema) e
o número em atraso; para um modelo, a sua origem, o risco sistémico, a capacidade
de computação de treino e os sistemas que o usam. **New AI system** e **New GPAI
model** criam um cartão do tipo certo com o interruptor predefinido, e **Open in
inventory** lista os mesmos cartões no Inventário. Uma linha do registo *é* o seu
cartão: clique nela para editar as secções do AI Act no detalhe do cartão.

A coluna **Documents** da vista AI systems oferece duas transferências Word por
sistema, pré-preenchidas a partir do repositório: **Annex IV.docx**, a documentação
técnica do anexo IV, e **FRIA.docx**, o esqueleto da avaliação de impacto nos
direitos fundamentais do Art. 27. Ambos começam com uma nota sobre o formulário
simplificado do anexo IV para PME e pequenas empresas de média capitalização
(Art. 11(1)) e sobre a reutilização da avaliação de impacto sobre a proteção de
dados (Art. 27(4)).

### Classify

O assistente de classificação faz um conjunto guiado de perguntas sobre um sistema e
propõe um nível de risco, com o artigo por detrás de cada razão. Escolha o sistema
em **Classify a system** e responda:

1. **AI system or not** — é um sistema de IA na aceção do Art. 3(1)? Se não, o
   resultado é **Out of scope**.
2. **Role** — o papel de operador da sua organização para este sistema, e se o
   modificou substancialmente, lhe pôs a sua marca ou alterou a sua finalidade
   prevista (o que o pode tornar seu fornecedor nos termos do Art. 25).
3. **Prohibited practices (Art. 5)** — incluindo as duas práticas que o
   Regulamento (UE) 2026/1744 proíbe a partir de 2 de dezembro de 2026: material
   íntimo ou sexualmente explícito realista de uma pessoa identificável sem o seu
   consentimento (Art. 5(1)(ba)) e material de abuso sexual de crianças
   (Art. 5(1)(bb)). Cada uma indica quem é visado, como fornecedor ou como
   responsável pela implantação. A um fornecedor de um sistema que gera imagens,
   vídeo, áudio ou texto é também perguntado se o sistema poderia produzir esse
   material e se salvaguardas o impedem de forma fiável; só a resposta de que essas
   salvaguardas não existem o torna uma prática proibida.
4. **High risk under Annex I** — um produto, ou o componente de segurança de um
   produto, abrangido pela legislação da União enumerada. Após um regime, o
   assistente pergunta se um fundamento do Art. 6(1a)–(1c) retira o sistema do
   Art. 6(1): é usado exclusivamente para aspetos não relacionados com a segurança,
   ou o produto é avaliado por um terceiro apenas quanto a riscos que não a saúde e
   a segurança.
5. **High risk under Annex III** — se a finalidade prevista cabe num caso de uso do
   anexo III, e se o sistema cria perfis de pessoas singulares.
6. **The Art. 6(3) derogation** — se se aplica uma condição de derrogação. Uma
   derrogação invocada tem de ser documentada em **Art. 6(4) rationale**; esse texto
   é escrito no cartão, e a validação bloqueia sem ele.
7. **Transparency duties (Art. 50)** — divulgação de chatbots, marcação de conteúdo
   sintético, avisos de reconhecimento de emoções, rotulagem de deepfakes e de
   textos de interesse público.

**Evaluate** mostra a **Proposed classification** com as suas razões fundamentadas
em artigos, e não escreve nada no cartão. **Accept & write to card** escreve os
campos de classificação no cartão — papel, nível de risco, base, derrogação e
deveres de transparência — e regista a avaliação como a aceite.

Executar o assistente requer a permissão de gestão da extensão e um cartão que
possa abrir; aceitar requer também direitos de edição nesse cartão. Se puder abrir o
cartão mas não editá-lo, pode na mesma executar o assistente e ver a proposta, mas
**Accept & write to card** fica desativado e diz porquê: *You may not edit this
card, so the classification cannot be written to it.*

![O assistente de classificação com uma classificação proposta](../assets/img/en/105_ext_eu_ai_act_classify.png)

**O histórico de avaliações é o rasto de auditoria.** Cada execução é guardada —
quem classificou que sistema, quando e porquê — de modo que a pergunta *«porque é
que este sistema é de risco elevado, e quem decidiu?»* continue a ter resposta anos
depois. Cada linha nomeia o cartão (um cartão arquivado é marcado **archived**, um
cartão que já não existe indica **Deleted card**), a pessoa que a executou em
**By**, o nível de risco e o estado: **Draft**, **Accepted** ou **Superseded**.
Executar de novo o assistente acrescenta uma entrada nova; aceitá-la marca a
anteriormente aceite como **Superseded** e nunca a altera. Os detalhes de uma
avaliação mostram **Run by**, **Accepted by** e, quando uma posterior a substituiu,
**Superseded by** com a data — uma entrada substituída mantém quem a aceitou. Nas
entradas substituídas antes da versão 1.6.0 só se conhece a pessoa que as
substituiu, pelo que **Accepted by** mostra «—». O histórico lista apenas avaliações
de cartões que pode abrir. A coluna **Taxonomy baseline** está oculta por omissão;
ative-a em **Columns**.

### Obligations

Cada obrigação aplicável de cada sistema de IA — ou, mudando para **GPAI model**, de
cada modelo GPAI — numa só grelha: o cartão, o grupo, a obrigação, o artigo, o
estado, o prazo, o marco e um **Evidence hint** que diz que prova a obrigação
espera. Filtre por estado, grupo e prazo (em atraso, **Due soon**, **Later**), ou
escolha um único cartão na barra de ferramentas. Os estados são campos do cartão,
pelo que os regista abrindo o cartão; uma obrigação não cumprida na sua data está em
atraso, e uma ainda não vencida mostra **Due soon** a partir de 180 dias antes da
sua data.

Que obrigações se aplicam decorre do papel, do nível de risco e das condições de
cada sistema — 32 obrigações no total para fornecedores, responsáveis pela
implantação e modelos GPAI, na base alterada. As suas datas são escalonadas
conforme alteradas pelo Regulamento (UE) 2026/1744:

| Data | Marco | Artigo |
|---|---|---|
| 2 de fevereiro de 2025 | Práticas proibidas e literacia em matéria de IA | Art. 113(a) |
| 2 de agosto de 2025 | Obrigações dos modelos de IA de finalidade geral | Art. 113(b) |
| 2 de agosto de 2026 | Aplicação geral (incl. transparência do Art. 50) | Art. 113 |
| 2 de dezembro de 2026 | Outras práticas proibidas (Art. 5(1)(ba), (bb)) | Art. 113(a) |
| 2 de dezembro de 2027 | Sistemas de IA de risco elevado do anexo III | Art. 113(c)(i) |
| 2 de agosto de 2028 | IA de risco elevado em produtos regulamentados do anexo I | Art. 113(c)(ii) |
| 2 de agosto de 2030 | IA de risco elevado já no mercado, destinada a autoridades públicas | Art. 111(2) |

Os prazos são avaliados face à **Reference date** em Settings (hoje quando está
vazia). Três regras moldam a lista:

- **Anexo I secção B (Art. 2(2)).** Um sistema que é de risco elevado apenas através
  de um produto abrangido pelo anexo I secção B — veículos, aviação, equipamento
  marítimo, ferrovia e maquinaria — não tem nenhuma obrigação do AI Act no registo
  e indica **No obligations apply**. Os estados já registados ficam no cartão, sem
  serem contados. Um sistema que também cai num caso de uso do anexo III mantém
  todas as suas obrigações.
- **Sistemas já no mercado (Art. 111(2)).** Registe no cartão de um sistema de risco
  elevado se foi *Placed on the market before the high-risk date (Art. 111(2))*.
  Colocado no mercado antes dessa data sem alteração significativa da sua conceção:
  as obrigações de risco elevado são postas de parte (a transparência do Art. 50
  continua a contar); colocado no mercado antes dessa data e destinado a ser usado
  por autoridades públicas: passam para 2 de agosto de 2030; alterado de forma
  significativa, não colocado no mercado antes dessa data ou deixado vazio: aplicam-se
  na íntegra.
- **Registar um sistema com derrogação (Art. 49(2)).** Um fornecedor que invoca a
  derrogação do Art. 6(3) tem mais uma obrigação: registar o sistema na base de
  dados da UE como avaliado como não sendo de risco elevado.

![O separador Obligations em todos os sistemas de IA](../assets/img/en/106_ext_eu_ai_act_obligations.png)

### Suggestions

**Find suggestions** percorre os seus cartões e propõe decisões de registo, cada uma
com a sua evidência:

- **AI Act scope** — uma Aplicação sobre a qual ainda não se decidiu, com um dos
  subtipos de IA do núcleo (**AI Agent**, **MCP Server**) ou assinalada pelo scanner
  de conformidade como tendo funcionalidades de IA.
- **GPAI check** — um Componente de TI sobre o qual ainda não se decidiu, com o
  subtipo **AI Model**, um sinal do scanner, ou usado por sistemas já no âmbito.
- **Bootstrap checklist** — um sistema de risco elevado em que nenhuma das
  obrigações aplicáveis tem ainda um estado; aceitá-la define cada uma como **Not
  started**, para que o trabalho se torne visível.

Uma faixa acima da lista liga às deteções de EU AI Act do próprio scanner de
conformidade.

Nada é escrito num cartão até uma pessoa premir **Accept** numa linha; **Dismiss**
remove-a da lista. O estado — **Proposed**, **Accepted** ou **Dismissed** — escolhe-se
na barra lateral. Aceitar requer direitos de edição no cartão além da permissão de
gestão; sem eles, **Accept** fica desativado e diz: *You may not edit this card, so
the suggestion cannot be written to it.*

### Audit

- **Live validation** — as deteções para o registo tal como está na data de
  referência, cada uma com a sua gravidade (**Blocking** ou **Warning**), regra,
  artigo, cartão e mensagem; **Open card** abre o cartão que precisa de correção.
- **Rule coverage** — as regras que uma máquina não consegue verificar. São
  reportadas como não executadas, porque precisam de uma pessoa, em vez de serem
  ignoradas em silêncio.
- **Snapshots** — **Freeze snapshot** captura o registo numa **Reference date**.
  Cada instantâneo passa então por três estados:
    1. **Draft** — prima **Validate** para o verificar.
    2. **Validated** — prima **Finalize**. É recusado enquanto subsistir uma deteção
       bloqueante.
    3. **Final** — o instantâneo é imutável, faz parte do rasto de auditoria e já não
       pode ser validado de novo nem apagado.

  **XLSX** descarrega um instantâneo como livro Excel do registo (requer a permissão
  de submissão). Um instantâneo final é sempre descarregado sem alterações: o seu
  conteúdo é verificado face ao hash fixado quando foi finalizado. Um instantâneo em
  rascunho mantém as datas e as deteções com que foi tirado — tire um novo após uma
  atualização que altere as regras.

### Settings

**Taxonomy baseline** — a regulamentação de que derivam todas as projeções e
prazos. **ai-act-2026-omnibus**, o regulamento na redação do Regulamento (UE)
2026/1744, é a predefinição; **ai-act-2024**, o regulamento tal como adotado, com as
suas datas originais, continua selecionável para que as avaliações e os instantâneos
feitos com ele permaneçam legíveis.

**Reference date** — os prazos são avaliados face a esta data; vazio significa hoje.

**Demo data** — **Load demo data** semeia um pequeno panorama de demonstração: todos
os níveis de risco, um modelo GPAI de risco sistémico, um rasto de avaliações aceites
e material para sugestões. Todos os cartões de demonstração têm *(AI demo)* no nome;
**Remove demo data** apaga-os de novo.

## Quem vê e pode fazer o quê

- **Só vê os sistemas cujos cartões pode abrir.** O registo, as obrigações, os
  números e a cronologia do dashboard, as deteções, as sugestões, o histórico de
  avaliações e os documentos Annex IV / FRIA mostram a uma pessoa apenas os sistemas
  cujos cartões pode abrir no Inventário, e todos os números — contagens,
  percentagens, itens em atraso, deteções bloqueantes — são calculados sobre o que
  consegue ver. Um cartão a que um sistema visível se refere mas que não pode abrir
  indica **Card not accessible**. Onde algo foi omitido, o dashboard e o Register
  dizem-no numa linha: *Some systems are not shown because you do not have access to
  their cards.* Onde não resta nada a mostrar, o dashboard e o separador Obligations
  mostram a mesma linha em vez de uma lista vazia. Um papel que só tem a permissão
  da extensão e nenhum acesso aos cartões não vê, portanto, nenhum sistema.
- **Os instantâneos abrangem todo o registo.** Os instantâneos e as suas
  transferências Excel são o registo oficial: contêm todos os sistemas e nunca são
  filtrados, quem quer que olhe. Todas as pessoas com a permissão de visualização
  veem a lista de instantâneos no separador Audit; descarregar um requer a permissão
  de submissão. Através da API, o conteúdo guardado de um instantâneo é devolvido a
  quem tem a permissão de submissão e a quem o registo nada oculta; os restantes
  recebem apenas a sua data, base e estado.
- **Aceitar requer dois direitos.** **Accept & write to card**, e aceitar uma
  sugestão, requerem a permissão `ext.eu-ai-act.manage` da extensão **e** direitos de
  edição no cartão. Quem pode abrir o cartão mas não o editar pode na mesma
  executar o assistente e ver a proposta; o botão fica desativado com o seu motivo, e
  nada é escrito. Para lhe permitir aceitar, dê ao seu papel direitos de edição no
  tipo de cartão, ou faça-o stakeholder do cartão num papel que possa editar.
  Executar o assistente, ou aceitar ou rejeitar uma sugestão, num cartão que não
  pode abrir é recusado.
- **O histórico do cartão nomeia quem aceitou.** No Turbo EA 2.209.0 e posteriores,
  uma alteração feita por **Accept & write to card** ou por uma sugestão aceite é
  registada no separador Histórico do cartão em nome da pessoa que a fez, com o chip
  **Extension**. As versões anteriores mostram **System**. Carregar ou remover os
  dados de demonstração é registado como a extensão.
- **O histórico de avaliações mostra apenas nomes de apresentação** — nunca um
  e-mail. Onde os nomes não podem ser lidos, mostra «—».

## Permissões

| Permissão | Concede |
|---|---|
| `ext.eu-ai-act.view` | Ver o registo de sistemas de IA, os dashboards e os resultados de validação |
| `ext.eu-ai-act.manage` | Executar classificações, editar dados do AI Act e decidir sobre sugestões |
| `ext.eu-ai-act.submit` | Congelar instantâneos do registo e descarregar exportações do registo |
| `ext.eu-ai-act.admin` | Configurar as definições do AI Act (versão da taxonomia, data de referência, dados de demonstração) |

Editar os próprios dados do registo usa também os seus direitos normais de edição de
cartões, uma vez que cada campo do AI Act vive num cartão.

## Se a licença caducar ou a extensão for desativada

A área de trabalho e o seu relatório desaparecem, mas **nada é apagado**. Os seus
dados do AI Act vivem em cartões comuns, pelo que cada valor fica exatamente onde
está, visível e editável no inventário. Aplicar uma licença renovada restabelece a
área de trabalho de imediato.

## Notas e limitações

- A validação cobre o que uma máquina consegue verificar. As regras que não consegue
  verificar são listadas em **Rule coverage** como não executadas; trate uma
  validação limpa como uma lista de verificação, não como um veredito de
  conformidade.
- Os campos do cartão são partilhados pelas duas bases, e um cartão não consegue
  saber qual está selecionada. Em **ai-act-2024**, um cartão de risco elevado com um
  regime do anexo I secção B oculta estados de obrigação que essa base ainda conta, e
  o campo do Art. 111(2) aparece embora essa base o ignore. O registo, o dashboard e
  as exportações seguem sempre a base selecionada.
- As opções de resposta do assistente são mostradas no seu idioma quando a base
  fornece uma tradução.
- Após atualizar de uma versão anterior, execute de novo o assistente para a IA em
  produtos regulamentados (os fundamentos do anexo I) e para os sistemas geradores de
  conteúdo (a pergunta das salvaguardas), e registe o estado do Art. 111(2) dos
  sistemas de risco elevado já no mercado.
