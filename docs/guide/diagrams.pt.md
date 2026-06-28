# Diagramas

O módulo **Diagramas** permite criar **diagramas visuais de arquitetura** utilizando um editor [DrawIO](https://www.drawio.com/) integrado -- totalmente conectado ao seu inventário de cartões. Arraste cartões para a tela, conecte-os com relações, navegue pelas hierarquias e recoloridos por qualquer atributo -- o diagrama permanece sincronizado com os seus dados EA.

![Galeria de diagramas](../assets/img/pt/16_diagramas.png)

## Galeria de diagramas

A galeria lista cada diagrama como um cartão compacto com miniatura, nome, autor e o número de cartões que referencia. **Crie**, **Abra**, **Edite detalhes**, organize ou **Exclua** qualquer diagrama.

### Encontrar diagramas

- **Barra lateral de filtros** — o painel à esquerda restringe a galeria a **Todos os diagramas**, **Criados por mim** ou seus **Favoritos**. Recolha-a em uma barra estreita com o chevron; em telas pequenas o botão **Filtros** a abre como um painel deslizante.
- **Pesquisa** — a caixa de pesquisa corresponde ao nome de um diagrama, ao seu autor e aos nomes dos cartões desenhados nele, para que você possa encontrar um diagrama pelo seu conteúdo.
- **Ordenação** — por atualizado recentemente, criado recentemente ou nome.
- **Favoritos** — clique na estrela de qualquer cartão para adicioná-lo aos seus favoritos pessoais; o filtro **Favoritos** mostra todos eles.

### Grupos

Agrupe diagramas relacionados em **grupos** — rótulos compartilhados em todo o espaço de trabalho. Um diagrama pode pertencer a vários grupos ao mesmo tempo. Na visualização de cartão, a galeria mostra cada grupo como um cabeçalho recolhível; o que não foi atribuído aparece em **Sem agrupamento**.

- Use **Gerenciar grupos** na barra lateral para criar, renomear, recolorir ou excluir grupos.
- Use **Adicionar a grupos…** no menu de um diagrama para colocá-lo em um ou mais grupos (você pode criar um novo grupo na hora).
- Selecionar um grupo na barra lateral filtra a galeria apenas para esse grupo.


## O editor de diagramas

Abrir um diagrama lança o editor DrawIO em ecrã inteiro num iframe da mesma origem. A barra de ferramentas nativa do DrawIO está disponível para formas, conectores, texto e layout -- cada ação própria do Turbo EA é exposta via o menu de contexto do clique direito, o botão Sync da barra de ferramentas e a seta superior sobre cada cartão.

### Inserir cartões

Use a caixa de diálogo **Inserir cartões** (a partir da barra de ferramentas ou do menu de contexto) para adicionar cartões à tela:

- Os **chips de tipo com contadores ao vivo** na coluna esquerda filtram os resultados.
- Pesquise por nome na coluna direita; cada linha tem uma caixa de seleção.
- **Inserir selecionados** adiciona os cartões escolhidos em grelha; **Inserir todos** adiciona cada cartão que corresponde ao filtro atual (com confirmação acima de 50 resultados).

A mesma caixa abre em modo seleção única para **Mudar cartão vinculado** e **Vincular a cartão existente**.

Cada cartão na tela mostra o seu **ícone de tipo de cartão** como um pequeno glifo branco no canto superior esquerdo, ao lado da cor do tipo — assim o tipo de um cartão é transmitido tanto pelo ícone quanto pela cor. Isso corresponde aos ícones usados em toda a aplicação e melhora a legibilidade para utilizadores daltónicos. O ícone aparece nos cartões inseridos a partir de agora. Para adicionar ícones aos cartões já presentes num diagrama mais antigo, clique em **Aplicar ícones de tipo de cartão** na barra de ferramentas do editor.

### Ações do clique direito

- **Cartões sincronizados**: *Abrir cartão*, *Mudar cartão vinculado*, *Desvincular cartão*, *Remover do diagrama*.
- **Formas simples / células não vinculadas**: *Vincular a cartão existente*, *Converter em cartão* (mantém a geometria e transforma a forma num cartão pendente com a sua etiqueta), *Converter em contentor* (transforma a forma num swimlane onde aninhar outros cartões).

### O menu de expansão

Cada cartão sincronizado tem uma pequena seta. Um clique abre um menu com três secções, cada uma carregada num único round-trip:

- **Mostrar dependências** -- vizinhos por relações de saída ou de entrada, agrupados por tipo de relação com contadores. Cada linha é uma caixa; confirme com **Inserir (N)**.
- **Drill-Down** -- transforma o cartão atual num contentor swimlane com os seus filhos `parent_id` aninhados. Escolha que filhos incluir ou *Aprofundar em todos*.
- **Roll-Up** -- envolve o cartão atual e os irmãos selecionados (cartões que partilham o mesmo `parent_id`) num novo contentor pai.

As linhas com contador a zero ficam a cinzento, e os vizinhos / filhos já presentes na tela são ignorados automaticamente.

### A hierarquia na tela

Os contentores correspondem ao `parent_id` de um cartão:

- **Arrastar um cartão para dentro de** um contentor do mesmo tipo abre «Adicionar «filho» como filho de «pai»?». **Sim** põe em fila uma alteração hierárquica; **Não** devolve o cartão à posição anterior.
- **Arrastar um cartão para fora de** um contentor pede o desligamento (colocar `parent_id = null`).
- **Arrastos entre tipos diferentes** voltam silenciosamente à posição -- a hierarquia é restrita a cartões do mesmo tipo.
- Todos os movimentos confirmados caem no balde **Alterações hierárquicas** do painel Sync com ações *Aplicar* e *Descartar*.

### Remover cartões do diagrama

Eliminar um cartão da tela é tratado como um gesto **puramente visual** -- «Não quero vê-lo aqui». O cartão permanece no inventário; as suas arestas de relação conectadas desaparecem em silêncio com ele. As setas desenhadas à mão que não sejam relações EA registadas nunca são removidas automaticamente. **O arquivamento é tarefa da página Inventário**, não do diagrama.

### Eliminação de arestas

Remover uma aresta que carrega uma relação real abre «Eliminar a relação entre ORIGEM e DESTINO?»:

- **Sim** põe a eliminação em fila no painel Sync; **Sincronizar tudo** emite o `DELETE /relations/{id}` no backend.
- **Não** restaura a aresta no lugar (estilo e extremidades preservados).

### Perspetivas de visualização

O menu pendente **Vista** na barra de ferramentas recoloria cada cartão da tela por um atributo:

- **Cores dos cartões** (predefinição) -- cada cartão usa a cor do seu tipo.
- **Estado de aprovação** -- recoloria por `aprovado` / `pendente` / `quebrado`.
- **Valores de campo** -- escolha qualquer campo de seleção única nos tipos de cartão presentes na tela (ex.: *Ciclo de vida*, *Estado*). Células sem valor caem num cinzento neutro.

Uma legenda flutuante no canto inferior esquerdo mostra o mapeamento ativo. A vista escolhida é guardada com o diagrama.

### Painel Sync

O botão **Sync** da barra de ferramentas abre o painel lateral com tudo o que está em fila para a próxima sincronização:

- **Novos cartões** -- formas convertidas em cartões pendentes, prontas para serem enviadas ao inventário.
- **Novas relações** -- arestas desenhadas entre cartões, prontas a serem criadas no inventário.
- **Relações removidas** -- arestas de relação eliminadas da tela, em fila para `DELETE /relations/{id}`. *Manter no inventário* reinsere a aresta.
- **Alterações hierárquicas** -- movimentos arrastar-para-dentro / arrastar-para-fora de contentores confirmados, em fila como atualizações de `parent_id`.
- **Inventário alterado** -- cartões atualizados no inventário desde a abertura do diagrama, prontos a serem trazidos de volta para a tela.

O botão Sync da barra mostra uma pílula pulsante «N por sincronizar» sempre que haja trabalho pendente. Sair do separador com alterações por sincronizar dispara um aviso do navegador, e a tela é guardada automaticamente no armazenamento local a cada cinco segundos para poder ser restaurada após uma atualização acidental.

### Vincular diagramas a cartões

Os diagramas podem ser vinculados a **qualquer cartão** a partir do separador **Recursos** do cartão (ver [Detalhes do cartão](card-details.pt.md#separador-recursos)). Quando um diagrama está vinculado a um cartão **Iniciativa**, aparece também no módulo [EA Delivery](delivery.md) ao lado dos documentos SoAW.
