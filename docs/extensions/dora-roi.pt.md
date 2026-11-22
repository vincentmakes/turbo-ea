# DORA Register of Information

Todas as entidades financeiras da UE têm de manter um **registo de informação**
sobre todos os seus acordos com terceiros prestadores de TIC e apresentá-lo
anualmente através da sua autoridade de supervisão: 15 modelos interligados,
entregues como um pacote xBRL-CSV legível por máquina conforme ao quadro da EBA.
No ensaio das ESAs de 2024, apenas 6,5 % dos registos passaram todas as
verificações de qualidade dos dados.

Os dados de que o registo precisa são exatamente os que o seu repositório de EA já
contém. **DORA Register of Information** transforma o Turbo EA no seu registo.

!!! note "Idioma da interface"
    A interface desta extensão está disponível em inglês, alemão, francês,
    espanhol, italiano e dinamarquês. Em português é apresentada **em inglês**,
    pelo que os rótulos citados abaixo aparecem tal como surgem no ecrã.

## O registo vive nos seus cartões

Esta extensão não mantém **tabelas próprias** para o conteúdo do registo. Cada
objeto do registo é um cartão ou uma relação:

| Objeto do registo | No Turbo EA |
|---|---|
| Entidades jurídicas no âmbito | Cartões **Organização** com *In DORA register scope* ativo |
| Sucursais | Cartões **Organização** com o subtipo **Branch**, filhos da sua sede |
| Prestadores TIC terceiros | Cartões **Provider** |
| Acordos contratuais | Cartões **ICT Arrangement** (um novo tipo de cartão) |
| Serviços TIC | Cartões **ICT Service** (um novo tipo de cartão) |
| Funções críticas ou importantes | Cartões de **Capacidade de negócio** / **Processo de negócio** marcados como funções do registo |
| Partes signatárias, utilizadoras e prestadoras, cadeias de subcontratação | **Relações** entre esses cartões |

É este todo o desenho: cada campo é editado na própria vista de cartão do
Turbo EA, com os seus marcadores de obrigatoriedade, validação, ajuda contextual e
pontuação de qualidade dos dados, e o registo é montado ao vivo a partir dos
cartões sempre que valida ou exporta.

![Cartões ICT Service no inventário com a sua pontuação DORA](../assets/img/en/73_ext_dora_cards.png)

!!! note "Não existe, propositadamente, um separador DORA no cartão"
    Os campos acrescentados surgem como secções de atributos normais num cartão, e
    cada ligação do registo é uma relação corrente. Nada na manutenção do registo
    é um modo especial.

## Em resumo

| | |
|---|---|
| **Licença** | Comercial — é necessário um direito assinado |
| **Versão mínima do Turbo EA** | 2.182.0 |
| **Permissões** | `ext.dora-roi.view`, `ext.dora-roi.manage`, `ext.dora-roi.submit`, `ext.dora-roi.admin` |
| **Autorizações de acesso a dados** | `core.cards.read`, `core.cards.write`, `metamodel.custom_field_types` |
| **Exige reiniciar o backend** | sim — inclui código de backend |
| **Onde aparece** | **DORA Register** no menu **GRC** (uma entrada de nível superior quando o menu GRC não está disponível para si) · **Relatórios → DORA Register - Dashboard** · secções **DORA Register** e **DORA Function** nos cartões · seis modelos de inquérito |

## O que acrescenta ao seu metamodelo

**Dois novos tipos de cartão**

- **ICT Arrangement** — um acordo contratual sobre o uso de serviços TIC. É
  **hierárquico**: os acordos-quadro são os pais e os acordos subsequentes ou
  associados os seus filhos. Contém a despesa anual e a moeda.
- **ICT Service** — um por serviço prestado ao abrigo de um acordo, com a linha de
  serviço (tipo, datas, pré-avisos, lei aplicável, localizações, grau de
  dependência) e a respetiva **avaliação** (substituibilidade, plano de saída,
  reintegração, impacto de uma interrupção, prestadores alternativos). Os seus três
  campos de localização — **Country of provision of the services**, **Location of
  the data at rest** e **Location of data management** (onde os dados são
  tratados) — oferecem cada um **Not applicable**. Um serviço sem localização do
  tratamento de dados registada impede finalizar um instantâneo: escolha o país,
  ou **Not applicable** se o serviço não envolver tratamento de dados.

**Um novo subtipo** — **Branch** em Organização.

**Novas secções em tipos de cartão existentes**

| Tipo de cartão | Secção | Conteúdo |
|---|---|---|
| **Organização** | DORA Register | No âmbito do registo DORA, LEI, País, Tipo de entidade, Posição no grupo, Autoridade competente, Total do ativo, Moeda de reporte, Código da sucursal |
| **Provider** | DORA Register | LEI, Tipo de identificador, EUID, Outro código de identificação, Tipo de pessoa, País da sede, Prestador intragrupo, despesa anual, empresa-mãe última |
| **Capacidade de negócio** / **Processo de negócio** | DORA Function | Função do registo DORA, Identificador de função, Atividade autorizada, Avaliação de criticidade ou importância, Motivos de criticidade, Data da última avaliação, RTO, RPO, Impacto de uma interrupção |

Cada secção inclui ainda uma **pontuação DORA (%)** só de leitura: uma barra de
completude que mostra quantos dados de registo esse cartão ainda deve.

**Nove tipos de relação**, dois dos quais com atributos que define relação a
relação:

- **Organização → ICT Arrangement** (*é parte de*) tem o atributo **papéis DORA**:
  **Entidade signatária**, **Utilização dos serviços TIC**, **Entidade prestadora
  (intragrupo)**.
- **ICT Service → Provider** (*é prestado por*) tem uma **posição na cadeia de
  subcontratação**: a **posição 1** é o prestador direto e as posições seguintes
  são subcontratados.

A extensão acrescenta ainda uma regulamentação **DORA** ao
[scanner de conformidade](../guide/compliance.md) do núcleo.

## Primeiros passos

A área de trabalho abre num **Dashboard** com uma lista de verificação **Getting
started** que segue estes sete passos e mostra o progresso.

![O dashboard do registo DORA](../assets/img/en/72_ext_dora_dashboard.png)

1. **Escolha a entidade declarante em Settings** — a entidade de que este é o
   registo.
2. **Marque as suas entidades jurídicas.** Em cada cartão Organização preencha a
   secção **DORA Register**: ative *In DORA register scope* e indique o LEI, o
   país, o tipo de entidade e a posição no grupo. As sucursais são cartões
   Organização com o subtipo **Branch**, filhos da sua sede.
3. **Crie um cartão ICT Arrangement por cada acordo contratual.** Faça dos
   contratos posteriores *filhos* do contrato-quadro — é daí que se derivam o tipo
   de acordo e a referência do acordo-quadro.
4. **Relacione cada acordo** com o seu cartão Provider e com as entidades que
   assinam, utilizam ou prestam, indicando em cada uma o atributo **papéis DORA**.
5. **Crie um cartão ICT Service por serviço** e relacione-o com o seu contrato, com
   as entidades que o utilizam, com as funções que suporta e com os seus
   prestadores **por posição**.
6. **Marque as funções.** Ative *DORA register function* nos cartões de Capacidade
   de negócio ou Processo de negócio que sejam funções críticas ou importantes e
   complete a respetiva secção **DORA Function** — ou aceite as propostas de
   [Suggestions](#suggestions).
7. **Valide o registo e resolva os achados.**

!!! tip "Recolha os dados junto de quem os detém"
    Seis modelos de inquérito em **Admin → Inquéritos → Novo a partir de modelo**
    recolhem os dados obrigatórios junto dos responsáveis dos cartões: **DORA
    entity data**, **DORA provider data**, **DORA arrangement data**, **DORA ICT
    service data** e **DORA function data** para capacidades e para processos. Cada
    um abre como rascunho.

### O que nunca terá de escrever

O registo deriva o seguinte em vez de o pedir: o LEI da empresa-mãe (da hierarquia
de cartões), as datas de integração e cessação (do ciclo de vida do cartão), o
tipo de acordo e a referência do acordo-quadro (da hierarquia de acordos), a
natureza da sucursal (do subtipo Branch), o destinatário de um serviço
subcontratado (da ordem de posições dos prestadores) e a data da última
atualização. O **âmbito de prestadores** também é derivado: só entram no registo os
cartões Provider efetivamente referenciados por um acordo ou por uma cadeia de
subcontratação, ficando os fornecedores alheios automaticamente de fora. As
convenções de preenchimento das ITS (`9999-12-31` para datas sem termo,
*not applicable* para acordos não subsequentes) são aplicadas por si.

## A área de trabalho

**DORA Register** no menu **GRC** tem cinco separadores. O mesmo dashboard
está também disponível como relatório guardável em **Relatórios → DORA Register - Dashboard**.

### Dashboard

Seis mosaicos — **Register completeness**, **Blocking findings**, **Warnings**,
**Critical functions**, **Providers**, **Arrangements** — sobre um botão **Validate
now** e uma linha que indica quantas das regras ativas da EBA foram executadas,
com uma ligação **Rules not run** (ver [Validação](#validacao)). Por baixo, uma
barra de contagens liga diretamente ao inventário para cada objeto do registo, e a
tabela **Template completeness** mostra linhas e achados por modelo.

![A tabela «Template completeness»](../assets/img/en/74_ext_dora_template_completeness.png)

Clicar num número de achados abre **Validation findings**: uma linha por achado,
com a sua gravidade (**Blocking** ou **Warning**), modelo, linha de registo,
cartão, regra, coluna e mensagem, e filtros por gravidade, modelo, tipo de cartão
e regra. A regra é uma de **Missing**, **Missing key value**, **Invalid value**,
**Invalid LEI**, **Duplicate row**, **Broken reference**, **Unknown column** ou
**EBA rule**. Clicar num achado, ou na sua ação **Open card**, abre num painel
lateral o cartão a corrigir; um achado sobre as definições de submissão oferece
**Open settings**. O botão **Rules not run** abre a lista descrita em
[Validação](#validacao).

### Register

Seis vistas — **Legal entities**, **Branches**, **Contractual arrangements**,
**ICT third-party providers**, **ICT services** e **Functions** — cada uma como
tabela dos cartões que compõem essa parte do registo, com um campo de pesquisa, um
botão **New …** que cria um cartão com o tipo e os indicadores corretos e uma
ligação **Open in inventory**. Clicar numa linha abre o cartão num painel lateral.

### Suggestions

**Find suggestions** percorre as suas relações Prestador → Aplicação →
Capacidade/Processo e propõe atualizações do registo — funções por marcar e
elevações de criticidade — cada uma com a evidência que a suporta. Nada é escrito
até clicar em **Accept** numa linha; **Dismiss** retira-a da lista.

### Submissions

**New snapshot** fixa o registo numa **data de referência**. Cada instantâneo passa
depois por três estados:

1. **Draft** — clique em **Validate** para o verificar. Os achados são listados com
   gravidade, modelo, linha, coluna e mensagem.
2. **Validated** — clique em **Finalize**. A operação é recusada enquanto houver um
   achado **bloqueante** ou não estiver definida uma entidade declarante com LEI.
   São achados bloqueantes, entre outros, um serviço sem localização do tratamento
   de dados, qualquer outro campo-chave deixado vazio onde se aplica e um LEI de
   prestador que não cumpre o formato ISO 17442 ou a soma de controlo (**Invalid
   LEI**).
3. **Final** — o instantâneo é imutável, o *hash* do seu pacote fica fixado para
   auditoria, mantém os achados e a cobertura de regras com que foi verificado e já
   não pode ser eliminado nem revalidado.

Estão sempre disponíveis dois descarregamentos:

- **xBRL-CSV package** — um pacote de relatório DORA construído segundo a
  taxonomia do quadro EBA 4.0 (módulo DORA 1.1.0), em `.zip`, com os metadados do
  relatório, os indicadores de submissão, os parâmetros e um CSV por modelo. O
  nome do ficheiro inclui o código de país ISO da entidade declarante. Um
  prestador que tem LEI e EUID é declarado com ambos: o LEI como código de
  identificação e o EUID como código de identificação adicional. O pacote é
  reproduzível ao byte, e um novo descarregamento de um instantâneo final é
  verificado face ao seu *hash* fixado.
- **Excel workbook** — um livro de revisão com capa, uma folha por modelo com os
  rótulos e códigos de coluna da EBA e uma folha de membros, para fazer circular
  o registo internamente antes da submissão.

Antes de cada versão que altera a exportação, o pacote construído a partir do
registo de demonstração é validado com o Arelle, o processador XBRL de código
aberto, face à taxonomia do quadro 4.0 publicada pela EBA, incluindo as asserções
de validação da própria taxonomia. Isto cobre a estrutura do pacote, não as
verificações de receção da EBA nem as suas consultas a registos: saber se o portal
da sua autoridade aceita o ficheiro é um teste à parte, que faz você.

### Settings

**Filing** — o **Filing scope** (**Consolidated (.CON)** ou **Individual
(.IND)**), a **Reporting currency**, a **Taxonomy version** e a **Reporting
entity**, cujo LEI e país determinam o pacote de relatório.

**Definitions (B_99.01)** — definições livres opcionais para os termos de listas
fechadas usados pelo seu registo, submetidas como modelo B_99.01.

**Demo data** — **Load demo data** carrega um registo de exemplo completo
(entidades de grupo e uma sucursal, prestadores, acordos-quadro e intragrupo, uma
cadeia de subcontratação de três níveis, funções críticas, sugestões e um
instantâneo em rascunho) para explorar todas as funcionalidades antes de tocar em
dados reais. Todos os cartões de demonstração se chamam *Demo DORA — …* e têm a
etiqueta **Demo Dora**; **Remove demo data** remove-os.

## Os 15 modelos

| Modelo | Conteúdo |
|---|---|
| B_01.01 | Entidade que mantém o registo de informação |
| B_01.02 | Lista de entidades no âmbito |
| B_01.03 | Lista de sucursais |
| B_02.01 | Acordos contratuais – informação geral |
| B_02.02 | Acordos contratuais – informação específica |
| B_02.03 | Lista de acordos contratuais intragrupo |
| B_03.01 / B_03.02 / B_03.03 | Partes signatárias |
| B_04.01 | Entidades que utilizam os serviços TIC |
| B_05.01 | Prestadores TIC terceiros |
| B_05.02 | Cadeias de subcontratação dos serviços TIC |
| B_06.01 | Identificação das funções |
| B_07.01 | Avaliação dos serviços TIC |
| B_99.01 | Definições |

## Validação

A validação decorre em quatro camadas: **estrutura** (tipos de dados, somas de
controlo dos LEI, datas, números e os campos obrigatórios e chave tratados como
bloqueantes quando vazios), **membros** (valores de listas fechadas confrontados
com as listas de códigos da taxonomia), **chaves** (completude e unicidade das
chaves primárias e referências entre modelos) e as **regras de validação da EBA
que podem ser executadas sem ligação**, com as gravidades publicadas. As regras
que a EBA retirou não são executadas.

O EUID de um prestador é verificado face ao formato EUID: o código de país e o
identificador do registo, um ponto, depois o número de registo. Um valor sem
ponto, ou um LEI introduzido como EUID, é comunicado como aviso. Uma verificação
local é mais rigorosa do que a da EBA: um código de identificação de prestador
declarado como LEI que não cumpre o formato ISO 17442 ou a soma de controlo é um
achado bloqueante **Invalid LEI**, ao passo que a regra própria da EBA é um aviso.
Um LEI inválido da empresa-mãe última de um prestador continua a ser um aviso.

!!! warning "A cobertura é parcial — e é declarada com honestidade"
    O Turbo EA executa as regras da EBA que consegue avaliar sem ligação, e o
    dashboard indica quantas das regras ativas da EBA foram executadas. **Rules not
    run**, aberto a partir dessa indicação ou dos achados de validação, lista todas
    as outras regras com o seu modelo, o texto próprio da EBA e o motivo por que não
    são executadas aqui: uma **EBA expression** que excede as verificações sem
    ligação, que os sistemas da autoridade de supervisão avaliam sobre o ficheiro
    que submete, ou uma **Package check** que a EBA aplica ao pacote de relatório
    submetido e não ao registo. Nomeia também as regras de LEI, EUID e país que aqui
    só correm como verificações sem ligação de soma de controlo, formato e lista de
    códigos, enquanto a EBA consulta os códigos no GLEIF e nos registos comerciais
    (BRIS). Considere uma validação sem achados como uma verificação prévia sólida,
    não como uma garantia de aceitação pela autoridade de supervisão.

## Permissões

| Permissão | Permite |
|---|---|
| `ext.dora-roi.view` | Consultar o registo, os dashboards e os resultados da validação |
| `ext.dora-roi.manage` | Editar os dados do registo e decidir sobre as sugestões |
| `ext.dora-roi.submit` | Fixar instantâneos numa data de referência e descarregar os pacotes de relatório |
| `ext.dora-roi.admin` | Configurar as definições de submissão e carregar ou remover os dados de demonstração |

Editar os dados do registo usa ainda os seus direitos normais de edição de
cartões, uma vez que cada campo do registo reside num cartão.

## Se a licença expirar ou a extensão for desativada

A área de trabalho e os seus relatórios desaparecem e a ponte de dados de cartões
para, mas **nada é eliminado**. O seu registo vive em cartões e relações normais,
pelo que cada valor permanece exatamente onde está, visível e editável no
inventário. Instantâneos e definições são preservados. Uma licença renovada repõe
a área de trabalho de imediato.

Se surgir *The card-data bridge is unavailable*, a extensão está instalada mas sem
licença, ou o backend não foi reiniciado desde a instalação.

## Notas e limitações

- **A versão 2.0.0 introduziu uma alteração incompatível.** Os registos construídos
  em versões anteriores guardavam serviços e funções em tabelas próprias da
  extensão; essas linhas não são migradas. Volte a introduzi-los como cartões ICT
  Service e de função (ou recarregue os dados de demonstração) e execute de novo
  **Find suggestions**.
- Os modelos, listas de códigos e regras são entregues como dados versionados
  gerados a partir do quadro publicado pela EBA, pelo que uma nova versão do quadro
  chega como uma atualização da extensão mais uma mudança de **Taxonomy version**.
- A **pontuação DORA** de um cartão é um sinal de triagem, não um veredicto de
  conformidade. Os achados do dashboard é que fazem fé.
- Não são produzidas variantes de Excel específicas de cada autoridade; o pacote
  xBRL-CSV é o artefacto de submissão.
