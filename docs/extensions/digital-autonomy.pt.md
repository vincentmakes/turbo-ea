# Digital Autonomy Assessment

**Digital Autonomy Assessment** traz para o Turbo EA o **Digital Autonomy
Assessment Framework (DAAF)** da Universidade de Utreque, ao nível da aplicação.
Acrescenta uma secção **Digital Autonomy** a cada cartão de Aplicação — 22
indicadores ponderados repartidos por exposição ao risco, capacidade de mitigação
e importância estratégica, cada um pontuado de 1 a 5 segundo a grelha original do
DAAF e com ajuda contextual —, calcula automaticamente uma pontuação de autonomia
de 1 a 10 e coloca toda a sua carteira num **quadrante de autonomia**.

Responde a uma pergunta que a maioria dos inventários deixa em aberto: *se este
fornecedor deixasse amanhã de estar disponível, de ser comportável ou de poder ser
usado legalmente, qual seria a nossa exposição e o que poderíamos realmente
fazer?*

!!! note "Idioma da interface"
    O conteúdo deste referencial está disponível em inglês, alemão, francês,
    espanhol, italiano e dinamarquês. Em português, a secção e os indicadores são
    apresentados **em inglês**, pelo que os rótulos citados abaixo aparecem tal
    como surgem no ecrã.

## Em resumo

| | |
|---|---|
| **Licença** | **Gratuita** — funciona sem qualquer direito de licença |
| **Versão mínima do Turbo EA** | 2.17.0 |
| **Permissão** | `ext.digital-autonomy.view` |
| **Autorizações de acesso a dados** | nenhuma |
| **Exige reiniciar o backend** | não |
| **Onde aparece** | Secções **Digital Autonomy** e **Digital autonomy score** nos cartões de Aplicação · **Relatórios → Digital Autonomy** · **Novo a partir de modelo** na página de inquéritos |

## Primeiros passos

1. Instale a extensão em **Admin → Extensões**. Não há licença a aplicar nem
   reinício: os campos surgem de imediato.
2. Atribua `ext.digital-autonomy.view` em **Admin → Utilizadores e papéis** aos
   papéis que devem ver o relatório. Os administradores já a têm.
3. Decida entre a avaliação **rápida** e a **completa** — ver
   [Avaliação rápida ou completa](#avaliacao-rapida-ou-completa). A versão
   completa com 22 indicadores vem ativa de origem.
4. Pontue as suas aplicações, cartão a cartão ou
   [por inquérito](#recolher-pontuacoes-por-inquerito).

## Os indicadores

A secção **Digital Autonomy** aparece em cada cartão de Aplicação, agrupada em
oito dimensões (A–H). Cada indicador é pontuado de **1 a 5** com a sua própria
grelha.

![A secção «Digital Autonomy» num cartão de Aplicação](../assets/img/en/65_ext_digital_autonomy_indicators.png)

Clique num número para pontuar; volte a clicar no número selecionado para limpar.
Ao passar o rato sobre um número surge o texto da grelha para esse nível, e cada
indicador traz uma **ajuda** expansível com a nota explicativa do DAAF e as
definições dos termos que utiliza (*decisão de adequação*, *CLOUD Act*,
*FISA 702*, entre outros).

Os indicadores assinalados como **Rápido** compõem a avaliação rápida.

| Dimensão | Indicador | Peso | Rápido |
|---|---|---|---|
| **A · Risco geopolítico e de conformidade legal** | A1 · Supplier jurisdiction | 3 | ✔ |
| | A2 · Sanctions and geopolitical risk | 2 | |
| | A3 · Hosting and data location | 2 | ✔ |
| **B · Dependências de fornecedor e cadeia de abastecimento** | B1 · Vendor concentration | 3 | ✔ |
| **C · Resiliência técnica** | C1 · Alternative available | 3 | ✔ |
| | C2 · Migratability | 3 | |
| | C3 · Data portability | 3 | |
| | C4 · Encryption management | 2 | |
| | C5 · Software transparency and openness | 3 | |
| **D · Resiliência organizacional** | D1 · Internal expertise and knowledge continuity | 3 | ✔ |
| | D2 · Exit plan in place | 3 | |
| | D3 · Backup strategy | 2 | |
| **E · Resiliência contratual** | E1 · Exit clauses and transition arrangement | 3 | ✔ |
| | E2 · Contractual flexibility | 2 | |
| **F · Importância organizacional** | F1 · Impact on outage | 3 | ✔ |
| | F2 · Integration dependencies | 2 | |
| **G · Sensibilidade dos dados, gestão de acessos e política** | G1 · Personal data | 3 | ✔ |
| | G2 · Research data and knowledge security | 3 | |
| | G3 · Intellectual property | 2 | |
| **H · Impacto académico** | H1 · Academic freedom | 3 | ✔ |
| | H2 · Research collaboration | 2 | |
| | H3 · Long-term archiving | 2 | |

!!! note "Que direção é a boa?"
    As grelhas não estão todas orientadas do mesmo modo, e o controlo colore-as em
    conformidade. Nos indicadores de **risco** (A, B, F, G, H) **1 é o melhor** —
    o nível 1 de A1 é, por exemplo, «EU/EEA jurisdiction. No extraterritorial
    claims. Full EU protection.» e o nível 5 «No adequacy decision, no safeguards.
    Direct access by foreign governments.» Nos indicadores de **capacidade**
    (C, D, E) **5 é o melhor**. Não precisa de o memorizar: os botões estão
    graduados por cor e legendados **Low** e **High**.

## A pontuação

A secção só de leitura **Digital autonomy score** fica por baixo dos indicadores e
é recalculada automaticamente sempre que guarda.

![A pontuação de autonomia digital calculada num cartão de Aplicação](../assets/img/en/64_ext_digital_autonomy_score.png)

| Campo | Significado |
|---|---|
| **Risk exposure** | Média ponderada das dimensões A (geopolítica) e B (concentração de fornecedores) |
| **Mitigation capacity** | Média ponderada da resiliência técnica (C), organizacional (D) e contratual (E) |
| **Strategic importance** | Média ponderada de F (importância organizacional), G (sensibilidade dos dados) e H (impacto académico) |
| **Digital autonomy score** | Um único valor de 1 a 10, apresentado como medidor |

**Quanto mais alto, melhor** — 10 é ótimo, 1 é urgente.

!!! warning "Uma avaliação parcial não produz pontuação alguma"
    Todas as fórmulas estão protegidas: se faltar sequer um indicador necessário,
    a pontuação fica vazia em vez de mostrar um número enganador. Uma aplicação só
    aparece no relatório de quadrante quando a sua avaliação está completa.

Como as pontuações ficam guardadas no cartão como qualquer outro campo, estão
disponíveis em todo o lado: no inventário, nos filtros, nas exportações e nos seus
próprios relatórios.

## Avaliação rápida ou completa

A extensão inclui **duas variantes dos mesmos quatro cálculos**: uma lê os 22
indicadores e outra apenas os nove da avaliação rápida. O par que estiver
**ativo** determina tanto o que é calculado *como* quantos indicadores o cartão
mostra.

Alterne em **Admin → Metamodelo → Cálculos**:

- **Avaliação completa (predefinição)** — as quatro linhas
  *Digital Autonomy — … (full)* estão ativas e as *(quick)* inativas. Os cartões
  mostram os 22 indicadores.
- **Avaliação rápida** — ative as quatro linhas *Digital Autonomy — … (quick)* e
  desative as quatro *(full)*. Os cartões mostram apenas os nove indicadores
  rápidos e a pontuação é calculada a partir deles.

!!! tip "Não existe um interruptor de visualização separado"
    Esta única escolha nos cálculos constitui todo o comutador. O cartão esconde
    automaticamente os 13 indicadores exclusivos da avaliação completa assim que o
    conjunto rápido está ativo, e o relatório segue a mesma definição. Nunca ative
    ambas as variantes ao mesmo tempo: escrevem nos mesmos campos.

## Recolher pontuações por inquérito

Em vez de preencher 22 indicadores para cada aplicação, pergunte a quem sabe. Em
**Admin → Inquéritos**, use **Novo a partir de modelo**:

- **New DAAF survey — Quick (9)** cria o rascunho *DAAF Quick Scan*.
- **New DAAF survey — Full (22)** cria o rascunho *DAAF Full Assessment*.

Ambos visam cartões de Aplicação e abrem como **rascunho** no editor de
inquéritos, pelo que nada é enviado antes da sua revisão. Escolha o papel de parte
interessada que o deve receber (e eventuais filtros — uma fase do ciclo de vida,
um subtipo) e envie. Quem responde encontra o mesmo controlo de pontuação 1–5 e a
mesma ajuda contextual do cartão; ao aplicar as respostas, as pontuações são
escritas nos cartões.

Pode gerar um novo inquérito a partir de um modelo sempre que quiser — uma
reavaliação anual é apenas um clique.

## O relatório de quadrante

**Relatórios → Digital Autonomy** representa cada aplicação totalmente avaliada.

![O relatório «Autonomy quadrant»](../assets/img/en/63_ext_digital_autonomy_quadrant.png)

O eixo horizontal é **risco × importância estratégica** e o vertical a **capacidade
de mitigação** (alta em cima), dando quatro quadrantes:

| Quadrante | Significado | O que fazer |
|---|---|---|
| **Optimal** | Pouca exposição, mitigação sólida | Manter e monitorizar periodicamente. |
| **Manageable** | Muita exposição, mas com um recurso alternativo sólido | Riscos aceites com uma alternativa sólida. |
| **Attention** | Pouca exposição, mitigação fraca | Construir mitigação ou aceitar o risco deliberadamente. |
| **Critical** | Muita exposição, mitigação fraca | Ação urgente: migrar ou mitigar. |

Cada ponto está numerado e corresponde a uma linha da lista junto ao gráfico,
**ordenada por pontuação crescente — primeiro os mais urgentes**. Clicar num ponto
ou numa linha abre a aplicação num painel lateral sem sair do relatório.

**Filtros e eixos**

- Os seletores **Risk exposure**, **Mitigation capacity** e **Strategic
  importance** permitem colocar outros campos numéricos em cada eixo — útil se
  mantiver equivalentes próprios. A sua escolha fica memorizada no navegador.
- **Ciclo de vida** e **Subtipo** restringem o conjunto.

O relatório guarda-se, partilha-se, imprime-se e exporta-se como habitualmente.
Uma vista guardada aparece em **Relatórios → Guardados**.

## Permissões

| Permissão | Permite |
|---|---|
| `ext.digital-autonomy.view` | Ver o relatório **Relatórios → Digital Autonomy** |

Pontuar os indicadores usa os seus direitos normais de **edição** de cartões de
Aplicação: quem pode editar uma aplicação pode pontuá-la. Alternar entre avaliação
rápida e completa, bem como criar inquéritos a partir dos modelos, exige as
permissões de administrador habituais de **Cálculos** e **Inquéritos**.

## Se a extensão for desativada ou removida

Ao desativar ou desinstalar, as duas secções são retiradas do tipo de cartão, mas
**os valores guardados nos seus cartões nunca são tocados**. Reative a extensão e
todas as pontuações reaparecem tal como estavam. Os campos são fundidos de forma
aditiva, pelo que também se preservam os campos que os seus administradores
tenham acrescentado por conta própria nessas secções.

## Idiomas

Os rótulos dos indicadores, as perguntas, as grelhas e a ajuda estão disponíveis
em **inglês, alemão, francês, espanhol, italiano e dinamarquês**. Em português,
chinês, russo e árabe o conteúdo do referencial recorre ao inglês — o referencial
de origem não oferece esses idiomas.

## Atribuição e licença

Esta extensão reproduz o **Digital Autonomy Assessment Framework (DAAF)**, criado
na **Universidade de Utreque** por **Tim van Neerbos** (Lead Enterprise Architect)
no âmbito do projeto Digital Autonomy.

- Fonte: <https://github.com/utrechtuniversity/digital-autonomy-assessment-tool>
- Ferramenta original: <https://utrechtuniversity.github.io/digital-autonomy-assessment-tool/>
- Licença: **Creative Commons Atribuição – Não Comercial – Partilha nos Mesmos
  Termos 4.0 Internacional (CC BY-NC-SA 4.0)** —
  <https://creativecommons.org/licenses/by-nc-sa/4.0/>
- © 2026 Universiteit Utrecht — Tim van Neerbos

**Foram efetuadas alterações.** Os indicadores, ponderações, grelhas, notas de
ajuda e a pontuação de 1 a 10 do referencial foram adaptados para funcionar
nativamente dentro do Turbo EA ao nível do cartão de Aplicação: um tipo de campo
de pontuação 1–5 próprio, os cálculos de níveis e de pontuação, os modelos de
inquérito e o relatório de quadrante de autonomia.

As traduções multilingues das grelhas e da ajuda provêm do projeto DAAF (feitas
com a colaboração de **Thomas Steenbergen, SIVON**; o alemão, o francês, o
espanhol, o italiano e o dinamarquês são, de acordo com a fonte, traduções feitas
com o melhor empenho e ainda não revistas por falantes nativos).

De acordo com a cláusula **Não Comercial** do referencial, esta extensão é
distribuída **gratuitamente**, e de acordo com **Partilha nos Mesmos Termos** o
conteúdo DAAF adaptado que incorpora mantém-se licenciado sob CC BY-NC-SA 4.0.
