# Diagramas ArchiMate

O editor **ArchiMate** desenha diagramas [ArchiMate 3](https://pubs.opengroup.org/architecture/archimate3-doc/) sobre as suas fichas: coloca elementos da notação padrão (Business Process, Application Component, Node, etc.), liga-os com as relações que a linguagem permite e, se quiser, liga cada elemento a uma ficha do seu inventário. Um diagrama é guardado como um **ArchiMate Model Exchange File** (o formato XML do The Open Group, versão 3.1), pelo que pode ser trocado com outras ferramentas ArchiMate.

!!! warning "Estado da versão"
    Esta versão inclui a base do ArchiMate como uma **sandbox para administradores**. O módulo está desativado por predefinição, os diagramas não aparecem no menu [Diagramas](diagrams.md) e ainda não podem ser publicados nem incorporados. Consulte os [Limites conhecidos](#known-limits).

A primeira linha mostra o nome do diagrama, as opções de cor e conteúdo dos cartões e a sincronização. A sincronização atualiza os dados dos cartões vinculados. A segunda linha contém ferramentas de desenho, zoom, exportação SVG e o painel de propriedades. Use **Grade de pontos** para mostrar ou ocultar os pontos no fundo. O navegador lembra sua escolha para cada diagrama.

## Ativar o módulo

1. Abra **Admin → Configurações** e procure o cartão **Diagramas ArchiMate** (junto aos outros interruptores de módulos).
2. Ative-o. O cartão mostra **ArchiMate está ativado**.
3. Pode desativá-lo em qualquer altura. Os diagramas são mantidos; enquanto o módulo estiver desativado as páginas ficam inacessíveis e quem seguir uma ligação direta vê o marcador padrão de «módulo desativado».

## Abrir a sandbox

Enquanto o módulo estiver ativado, os diagramas ArchiMate são criados e abertos a partir da página **Diagramas** e do separador **Recursos** de qualquer card que referenciem. `/admin/architectureStudio` continua a ser a lista dos seus diagramas ArchiMate, onde pode criá-los, abri-los e eliminá-los; é preciso uma permissão em pelo menos uma camada ArchiMate e o módulo ativado. No editor, **Voltar** regressa à página de onde veio.

<!-- Planned screenshot (added with the screenshot capture): 102_archimate_sandbox -->

## O seu primeiro diagrama

1. Na sandbox, escreva um **Nome** em **Novo diagrama ArchiMate** e prima **Criar**. O editor abre-se.
2. **Largue elementos.** A paleta lista os tipos de elemento agrupados por camada (Estratégia, Negócio, Aplicação, Tecnologia, Física, Motivação, Implementação e migração, Outros). Arraste uma entrada para a área de desenho ou use o teclado: posicione-se numa entrada e prima **Enter** ou **Space** para largar o elemento no centro da área visível. Um elemento novo abre logo o seu nome para edição.
3. **Desenhe uma relação.** Selecione um elemento: o painel de contexto à volta dele oferece entradas **Desenhar** *relação*. Escolha uma e clique no elemento de destino. Só podem ser ligados os pares que a tabela de relações do ArchiMate permite: uma entrada só é oferecida se a linguagem admitir essa relação a partir deste elemento para pelo menos um tipo de elemento, e um destino que a tabela não permita é recusado. Selecione uma ligação para alterar o seu **tipo de acesso** (em Access) ou a sua direção (em Association).
4. **Ligue um elemento a uma ficha.** Selecione o elemento e use o painel de contexto:
    - **Ligar a uma ficha** abre um seletor limitado aos tipos de ficha que correspondem a este tipo de elemento (consulte [O mapeamento](#mapping)).
    - **Criar uma ficha** pede um tipo de ficha e um nome, cria a ficha e liga-a num só passo.
    - **Abrir a ficha ligada** e **Desligar a ficha** aparecem quando há uma ficha ligada.

    As ligações são sempre explícitas. Largar um elemento **nunca** cria uma ficha, e remover um elemento do diagrama (**Remover do diagrama**) **nunca** elimina uma ficha. Ao guardar, o conjunto de fichas a que o diagrama está ligado é sincronizado, tal como nos outros diagramas.
5. **Guarde.** O editor guarda sozinho três segundos após a última alteração; o botão **Guardar** guarda de imediato. O estado mostra *A guardar…*, *Guardado* ou *Alterações por guardar*.

!!! warning "Uma gravação falhada permanece visível"
    Se uma gravação falhar, o erro permanece visível com um botão **Tentar novamente**, o diagrama continua marcado como não guardado e nada é descartado em silêncio. Sair da página (fechar o separador, usar o botão Voltar do navegador ou abrir outra página da aplicação) com alterações por guardar ou falhadas pede primeiro confirmação.

## O mapeamento {#mapping}

O **mapeamento** (mapping) indica a que conceito do ArchiMate corresponde um tipo de ficha, um subtipo ou um tipo de relação do Turbo EA. O editor lê-o para decidir que fichas podem ser ligadas a que elemento. Cada tipo de ficha, subtipo e tipo de relação traz um tipo de elemento ou de relação do ArchiMate; uma relação traz ainda um **indicador de direção** (quando ativo, a relação ArchiMate é desenhada da ficha de destino para a ficha de origem; por exemplo, «Organização *usa* Aplicação» é uma relação *Serving* do ArchiMate da aplicação para a organização) e, em Access, um **tipo de acesso**.

!!! note
    Nesta versão o mapeamento é **só de leitura**: contém os valores predefinidos abaixo. O ecrã de administração para o alterar (**ARCHI MAP** em **Admin → Metamodelo**) chegará mais tarde. Esta versão não cria nem altera relações entre fichas a partir de uma relação desenhada.

Os nomes dos elementos e das relações são os do formato de troca do The Open Group. Um tipo de ficha cujo elemento está vazio (`—`) não tem mapeamento predefinido, pelo que as suas fichas não podem ser ligadas até ser definido um tipo de elemento. Um subtipo usa o seu próprio mapeamento se o tiver e, caso contrário, o do tipo de ficha.

### Tipos de ficha e subtipos

| Tipo de ficha | Elemento ArchiMate |
|---|---|
| Objetivo | `Goal` |
| Objetivo › Objetivo de negócio | `Goal` |
| Objetivo › Marco de valor | `Assessment` |
| Plataforma | `Grouping` |
| Iniciativa | `WorkPackage` |
| Organização | `BusinessActor` |
| Organização › Região | `Location` |
| Capacidade de negócio | `Capability` |
| Contexto de negócio | — |
| Contexto de negócio › Processo | `BusinessProcess` |
| Contexto de negócio › Cadeia de valor | `ValueStream` |
| Contexto de negócio › Jornada do cliente | `BusinessProcess` |
| Contexto de negócio › Produto de negócio | `Product` |
| Contexto de negócio › Capacidade ESG | `Capability` |
| Processo de negócio | `BusinessProcess` |
| Processo de negócio › Categoria de processo | `BusinessFunction` |
| Processo de negócio › Grupo de processos | `BusinessFunction` |
| Aplicação | `ApplicationComponent` |
| Interface | `ApplicationInterface` |
| Objeto de dados | `BusinessObject` |
| Componente de TI | `Node` |
| Componente de TI › Software | `SystemSoftware` |
| Componente de TI › Hardware | `Device` |
| Componente de TI › SaaS | `TechnologyService` |
| Componente de TI › PaaS | `TechnologyService` |
| Componente de TI › IaaS | `TechnologyService` |
| Componente de TI › Serviço | `TechnologyService` |
| Componente de TI › Modelo de IA | `SystemSoftware` |
| Categoria tecnológica | `Grouping` |
| Fornecedor | `BusinessActor` |

### Tipos de relação

Numa relação Access, `crud` significa que o tipo de acesso segue os indicadores Create/Read/Update/Delete da própria relação: só leitura dá Read, qualquer criação, atualização ou eliminação dá Write, ambas dão Read/Write e nenhuma dá Access simples. As relações «sucede a» existem para cada tipo de ficha que as tem e correspondem a Association, exceto a de Business Context, que tem uma linha própria na tabela.

| Relação | Relação ArchiMate | Nota |
|---|---|---|
| Objetivo → Capacidade de negócio, *melhora* | `Association` | — |
| Plataforma → Objetivo, *suporta* | `Influence` | — |
| Plataforma → Aplicação, *executa* | `Aggregation` | — |
| Plataforma → Componente de TI, *implementa* | `Aggregation` | — |
| Iniciativa → Objetivo, *suporta* | `Influence` | — |
| Iniciativa → Plataforma, *afeta* | `Association` | — |
| Iniciativa → Capacidade de negócio, *melhora* | `Association` | — |
| Iniciativa → Aplicação, *afeta* | `Association` | — |
| Iniciativa → Interface, *afeta* | `Association` | — |
| Iniciativa → Objeto de dados, *afeta* | `Association` | — |
| Iniciativa → Componente de TI, *afeta* | `Association` | — |
| Organização → Objetivo, *possui* | `Association` | — |
| Organização → Iniciativa, *possui* | `Assignment` | — |
| Organização → Contexto de negócio, *possui* | `Association` | — |
| Organização → Aplicação, *utiliza* | `Serving` | desenhada do destino para a origem |
| Organização → Componente de TI, *possui* | `Association` | — |
| Aplicação → Capacidade de negócio, *suporta* | `Realization` | — |
| Aplicação → Contexto de negócio, *suporta* | `Association` | — |
| Aplicação → Interface, *fornece / consome* | `Association` | — |
| Aplicação → Objeto de dados, *CRUD* | `Access` | tipo de acesso a partir dos indicadores CRUD |
| Aplicação → Componente de TI, *utiliza* | `Serving` | desenhada do destino para a origem |
| Componente de TI → Categoria tecnológica, *pertence a* | `Aggregation` | desenhada do destino para a origem |
| Componente de TI → Plataforma, *implementa* | `Aggregation` | desenhada do destino para a origem |
| Interface → Objeto de dados, *transfere* | `Association` | — |
| Interface → Componente de TI, *utiliza* | `Association` | — |
| Fornecedor → Iniciativa, *suporta* | `Association` | — |
| Fornecedor → Aplicação, *oferece* | `Association` | — |
| Fornecedor → Componente de TI, *oferece* | `Association` | — |
| Contexto de negócio → Capacidade de negócio, *está associado a* | `Association` | — |
| Processo de negócio → Capacidade de negócio, *suporta* | `Realization` | — |
| Processo de negócio → Aplicação, *é suportado por* | `Serving` | desenhada do destino para a origem |
| Processo de negócio → Objeto de dados, *utiliza* | `Access` | tipo de acesso a partir dos indicadores CRUD |
| Processo de negócio → Componente de TI, *utiliza* | `Serving` | desenhada do destino para a origem |
| Processo de negócio → Processo de negócio, *depende de* | `Association` | — |
| Processo de negócio → Processo de negócio, *invoca* | `Triggering` | — |
| Processo de negócio → Organização, *pertence a* | `Assignment` | desenhada do destino para a origem |
| Processo de negócio → Iniciativa, *é afetado por* | `Association` | — |
| Processo de negócio → Objetivo, *suporta* | `Influence` | — |
| Processo de negócio → Contexto de negócio, *realiza* | `Realization` | — |
| Objetivo → Contexto de negócio, *é objetivo para* | `Association` | — |
| Contexto de negócio → Contexto de negócio, *sucede a* | `Triggering` | desenhada do destino para a origem |

Clique com o botão direito num conector e escolha **Reto** ou **Ortogonal**. O traçado mantém-se ao mover um nó e ao guardar e voltar a abrir o diagrama.

## O ficheiro Exchange {#exchange-file}

A barra de ferramentas oferece **Exportar como ficheiro Exchange** e **Importar um ficheiro Exchange**, além de **Exportar como SVG** para obter uma imagem.

- **Exportar** transfere o diagrama como ArchiMate Model Exchange File (`.xml`, formato 3.1).
- **Importar** substitui todo o conteúdo do diagrama aberto, após uma confirmação (**Substituir o diagrama?**). Os diagramas criados com outras ferramentas (como o Archi) podem ser lidos se seguirem o formato do The Open Group.
- Os ficheiros com mais de 5 MB são recusados, tal como os que contêm uma declaração DOCTYPE ou de entidade.

**O que não é mantido ao importar:**

- **Pastas** (a secção `organizations`): são descartadas e o editor avisa-o.
- **Notas, grupos e ligações simples** vindos de outras ferramentas: as etiquetas e os contentores sem um elemento por trás, e as ligações sem relação, são ignorados.
- **Tipos de propriedade diferentes de string**: cada definição de propriedade é lida como cadeia de texto.
- **Outros idiomas de um nome**: só se mantém um nome por elemento, relação e vista.
- Os tipos de letra e outros estilos para além do essencial não são mantidos.

## Verificar o modelo

O botão **Verificar o modelo** na barra de ferramentas envia o diagrama atual ao servidor, que o valida segundo as regras de troca do The Open Group e lista cada problema encontrado (no máximo 100). Cada mensagem tem um código; o símbolo `…` representa o nome ou o identificador em causa:

| Code | Mensagem |
|---|---|
| `too_large` | O modelo excede 5 MB. |
| `xml_invalid` | O modelo não é um XML bem formado. |
| `dtd_forbidden` | As declarações DOCTYPE e de entidade não são permitidas. |
| `wrong_root` | O elemento raiz não é um modelo ArchiMate. |
| `missing_identifier` | Um elemento, uma relação ou um nó do diagrama não tem identificador. |
| `unknown_element_type` | Tipo de elemento desconhecido: … |
| `unknown_relationship_type` | Tipo de relação desconhecido: … |
| `unknown_access_type` | Tipo de acesso desconhecido em … |
| `duplicate_identifier` | Identificador duplicado: … |
| `dangling_source` | A relação … parte de algo que não existe. |
| `dangling_target` | A relação … termina em algo que não existe. |
| `relationship_not_allowed` | O ArchiMate não permite a relação …: nem entre estes dois elementos, nem de uma relação para si própria. |
| `dangling_element_ref` | O nó do diagrama … mostra um elemento que não existe. |
| `dangling_relationship_ref` | A ligação do diagrama … mostra uma relação que não existe. |
| `connection_endpoint_mismatch` | A ligação do diagrama … não une os nós da sua relação. |

A verificação de relações também recusa uma relação que aponte para outra relação, a menos que seja uma Association, Aggregation ou Composition. Se não houver nada a assinalar, a caixa de diálogo diz **Nenhum problema encontrado.**

## Atalhos de teclado

Prima **Atalhos de teclado** na barra de ferramentas para ver a lista. Clique primeiro na área de desenho para que tenha o foco.

| Ação | Atalho |
|------|--------|
| Anular | `Ctrl+Z` |
| Refazer | `Ctrl+Y` / `Ctrl+Shift+Z` |
| Copiar | `Ctrl+C` |
| Colar | `Ctrl+V` |
| Eliminar | `Delete` / `Backspace` |
| Mudar o nome | `F2` / `Enter` |
| Selecionar tudo | `Ctrl+A` |
| Aumentar | `Ctrl++` |
| Reduzir | `Ctrl+-` |
| Ajustar ao ecrã | `Ctrl+0` |

Na paleta, `Enter` ou `Space` numa entrada com foco larga esse elemento.

## Limites conhecidos {#known-limits}

- **Edita-se uma só vista por ficheiro.** Se um ficheiro importado tiver várias vistas, a primeira é editada e as outras são mantidas intactas ao guardar.
- **As relações entre relações** (uma Association, Aggregation ou Composition que aponta para outra relação) são lidas e escritas e o verificador aceita-as, mas não são desenhadas.
- **Desenhar uma relação exige o rato.** O teclado pode largar elementos, mas não ligá-los.
- **As colocações com o teclado empilham-se.** Cada elemento largado com `Enter` ou `Space` fica no centro da área visível, pelo que as colocações sucessivas se sobrepõem até as mover.
- **Ainda sem publicação.** Os diagramas ArchiMate não podem ser publicados nem incorporados e não aparecem no menu **Diagramas**; chega-se a eles pela lista da sandbox ou pelo separador **Recursos** de um card que os referencie.
- **As junções (junctions) não têm etiqueta.** Uma junção And ou Or é um simples ponto.
- O mapeamento é só de leitura (consulte [O mapeamento](#mapping)) e as pastas são descartadas ao importar (consulte [O ficheiro Exchange](#exchange-file)).

---

ArchiMate® é uma marca registada do The Open Group. O Turbo EA desenha a notação ArchiMate e não é certificado pelo The Open Group.
