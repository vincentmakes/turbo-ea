# Gestão de Fim de Vida (EOL)

A página de administração de **EOL** (**Admin > Configurações > EOL**) ajuda você a acompanhar os ciclos de vida de produtos tecnológicos vinculando seus cards ao banco de dados público [endoflife.date](https://endoflife.date/).

![Gestão de Fim de Vida](../assets/img/pt/29_admin_config_eol.png)

## Por que Rastrear EOL?

Saber quando produtos tecnológicos atingem o fim de vida ou fim de suporte é essencial para:

- **Gestão de risco** — Software sem suporte é uma vulnerabilidade de segurança
- **Planejamento orçamentário** — Planeje migrações e atualizações antes que o suporte termine
- **Conformidade** — Muitas regulamentações exigem software com suporte

## Busca em Massa

O recurso de busca em massa escaneia os cards de um tipo que rastreia o fim de vida (**Aplicação** e **Componente de TI** por padrão, veja [Fim de vida em outros tipos de card](#fim-de-vida-em-outros-tipos-de-card)) e encontra automaticamente produtos correspondentes no banco de dados do endoflife.date.

### Executando uma Busca em Massa

1. Navegue até **Admin > Configurações > EOL**
2. Selecione o tipo de card a escanear (qualquer tipo que rastreie o fim de vida)
3. Clique em **Buscar**
4. O sistema realiza **correspondência aproximada** contra o catálogo de produtos do endoflife.date

### Revisando Resultados

Para cada card, a busca retorna:

- **Pontuação de correspondência** (0-100%) — Quão próximo o nome do card corresponde a um produto conhecido
- **Nome do produto** — O produto correspondente no endoflife.date
- **Versões/ciclos disponíveis** — As versões de lançamento do produto com suas datas de suporte

### Filtrando Resultados

Use os controles de filtro para focar em:

- **Todos os itens** — Cada card que foi escaneado
- **Apenas não vinculados** — Cards ainda não vinculados a um produto EOL
- **Já vinculados** — Cards que já possuem um link EOL

Um resumo estatístico mostra: total de cards escaneados, já vinculados, não vinculados e correspondências encontradas.

### Vinculando Cards a Produtos

1. Revise a correspondência sugerida para cada card
2. Selecione a **versão/ciclo do produto** correto no dropdown
3. Clique em **Vincular** para salvar a associação

Uma vez vinculado, a página de detalhe do card mostra uma **seção EOL** com:

- **Nome do produto e versão**
- **Status de suporte** — Com código de cores: Suportado (verde), Aproximando-se do EOL (laranja), Fim de Vida (vermelho)
- **Datas importantes** — Data de lançamento, fim do suporte ativo, fim do suporte de segurança, data de EOL

## Fim de vida em outros tipos de card

O fim de vida é rastreado por padrão em **Aplicações** e **Componentes de TI**. Qualquer outro tipo de card, nativo ou personalizado, também pode rastreá-lo: abra **Admin > Metamodelo**, escolha o tipo e, no seu **Layout da ficha**, desative **Oculta do detalhe da ficha** na seção **Fim de vida**. O mesmo interruptor oculta o fim de vida em Aplicações ou Componentes de TI se você não o rastreia ali.

Esse único interruptor decide tudo sobre o fim de vida do tipo:

- a seção **Fim de vida** nos seus cards (e a opção de vincular ao criar um card),
- o lugar do tipo no [Relatório de EOL](../guide/reports.md), no gráfico **Cobertura de fim de vida** do relatório de Qualidade dos dados e nos filtros e agrupamentos de fim de vida dos painéis,
- a coluna e o filtro **Fim de vida** no [Inventário](../guide/inventory.md),
- o seletor de tipo da **Busca em massa** desta página.

Ocultar a seção nunca exclui nada: os cards mantêm seus vínculos e suas datas de ciclo de vida, e voltam a aparecer em todos os relatórios quando a seção é exibida novamente.

## Produtos EOL personalizados

O endoflife.date acompanha o software mais popular, mas não tudo o que executa: uma plataforma interna, uma ferramenta especializada de um fornecedor ou um equipamento licenciado muitas vezes não tem entrada aí. Para esses, defina um **produto EOL personalizado** — o seu próprio produto, com os seus próprios ciclos de lançamento — e vincule fichas a ele exatamente como faria com um produto do endoflife.date. Os produtos personalizados alimentam o mesmo estado da ficha, a coluna **Fim de vida** do inventário, o [Relatório de EOL](../guide/reports.md) e os indicadores de qualidade dos dados.

Os produtos personalizados são listados no separador **Produtos personalizados** de **Admin > Configurações > EOL**. Criá-los e editá-los requer a permissão **Gerir EOL** (`eol.manage`); qualquer pessoa que possa ver os dados de EOL pode vê-los.

![Produtos EOL personalizados](../assets/img/pt/29b_admin_config_eol_personalizados.png)

### Criar um produto personalizado

Há duas formas de criar um:

- **A partir de uma ficha** — na secção **Fim de vida** da ficha, pesquise o produto. Quando o endoflife.date não tem correspondência, a secção oferece **Criar produto personalizado**, pré-preenchido com o que escreveu (ou com o nome da ficha). Introduza o nome do produto e os primeiros ciclos e guarde: a ficha fica vinculada ao novo produto e ciclo de uma só vez.
- **A partir do separador Produtos personalizados** — clique em **Adicionar produto**.

Cada produto tem:

- **Nome do produto** — como é apresentado em todo o lado.
- **Chave** — um identificador curto em minúsculas (letras, dígitos, pontos, hífens, sublinhados) sugerido a partir do nome. As ligações das fichas guardam-na, pelo que **não pode ser alterada** após a criação.
- **Ligação do fornecedor ou da política de lançamentos** e **Descrição** — opcionais.
- **Ciclos de lançamento** — cada um com um nome (por exemplo `2.4`), uma **Data de lançamento**, um fim de **Suporte ativo**, um **Fim de vida** e, opcionalmente, a **Última versão** e a sua data de lançamento.

O suporte ativo e o fim de vida aceitam cada um uma **data**, ou uma de duas respostas quando não se conhece nenhuma data: *Ainda com suporte* / *Suporte ativo terminado* e *Sem fim de vida anunciado* / *Já em fim de vida*. O estado (Suportado, Aproximando-se do EOL, Fim de vida) é calculado a partir deles com a mesma regra dos produtos do endoflife.date.

### Gerir ciclos na grelha

O separador Produtos personalizados mostra uma linha por ciclo de lançamento, agrupada por produto. Funciona como as outras grelhas: fixar e reordenar colunas, mostrá-las ou ocultá-las e filtrar por produto, estado ou utilização a partir do painel esquerdo. A coluna **Fichas vinculadas** mostra quantas das fichas que pode ver usam cada ciclo. A **Descrição** e a **Ligação** do produto também estão disponíveis como colunas; ficam ocultas no início, por isso ative-as no separador **Colunas** do painel.

Clique em **Editar na grelha** para alterar as células diretamente. As datas e as respostas de suporte abrem um pequeno editor, e pode arrastar o valor de uma célula para baixo numa coluna (como no Excel) para o copiar para vários ciclos. O menu da linha (**⋮**) adiciona um ciclo ao produto, edita o nome, a ligação e a descrição do produto, ou elimina um ciclo ou o produto.

Um produto ou um ciclo não pode ser eliminado enquanto houver fichas vinculadas a ele, incluindo fichas que não pode ver. Para retirar um ciclo usado por fichas, mude-lhe antes o nome (ao mudar o nome, as fichas vinculadas acompanham-no) ou vincule primeiro essas fichas a outro ciclo. A ligação de um produto é oferecida nas suas fichas como ligação para as notas de lançamento.

Também pode adicionar um ciclo em falta a partir de uma ficha: depois de selecionado um produto personalizado na secção Fim de vida da ficha, a lista de ciclos termina com **Adicionar ciclo…**.

### Contribuir com um produto personalizado para o endoflife.date

Se um produto personalizado for um produto público de um fornecedor, considere propô-lo ao endoflife.date para que todos beneficiem. Escolha **Propor ao endoflife.date** no menu da linha:

1. Leia o aviso: propor publica o nome do produto e as suas datas. Nunca proponha produtos internos ou confidenciais.
2. Escolha a **categoria** do endoflife.date. A caixa de diálogo mostra uma pré-visualização do ficheiro do produto no formato do endoflife.date (`products/<key>.md`).
3. Clique em **Abrir no GitHub**. O GitHub abre um novo ficheiro no repositório do endoflife.date com o conteúdo preenchido (oferece criar um fork do repositório se não puder escrever nele). Complete a descrição e o resumo da política de lançamentos e abra depois o pull request a partir da sua própria conta do GitHub. Para ficheiros longos, use antes **Copiar ficheiro** e cole-o num novo ficheiro.

O Turbo EA nunca envia nada para o GitHub por si próprio e não guarda credenciais do GitHub. O endoflife.date revê cada proposta de acordo com o seu [guia de contribuição](https://github.com/endoflife-date/endoflife.date/blob/master/CONTRIBUTING.md).

### Mudar para o endoflife.date

Quando o endoflife.date começa a acompanhar um produto que manteve como personalizado, a grelha mostra junto dele uma indicação **No endoflife.date**. A indicação só aparece para uma correspondência próxima (o mesmo nome, ou o nome do seu produto contido no do endoflife.date), pelo que um nome curto do endoflife.date que apenas ocorre dentro do seu não a ativa. Clique na indicação, ou escolha **Mudar para um produto do endoflife.date…** no menu da linha:

1. Escolha o produto do endoflife.date.
2. Para cada um dos seus ciclos, escolha o ciclo do endoflife.date para o qual as suas fichas devem passar (os ciclos com o mesmo nome são emparelhados automaticamente), ou mantenha-o no produto personalizado.
3. Opcionalmente, elimine o produto personalizado quando nenhuma ficha o vincular.

Só são movidas as fichas que pode ver. As datas de ciclo de vida nas fichas nunca são alteradas.

## Relatório de EOL

Dados de EOL vinculados alimentam o [Relatório de EOL](../guide/reports.md), que fornece uma visualização em painel do status de suporte do seu cenário tecnológico em todos os cards vinculados.

## Encontrar o que ainda não está ligado

Dois locais fora desta página listam os cartões sem qualquer informação de fim de vida — nem uma ligação aqui nem uma data de fim de vida própria:

- O filtro e a coluna **Fim de vida** no [Inventário](../guide/inventory.md) — escolha um tipo de cartão e depois a opção **(vazio)**.
- O valor **Sem dados de fim de vida** no [Relatório de EOL](../guide/reports.md) e o gráfico **Cobertura de fim de vida** no final do relatório de Qualidade dos dados.
