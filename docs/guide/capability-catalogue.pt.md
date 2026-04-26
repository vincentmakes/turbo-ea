# Catálogo de capacidades

O Turbo EA é entregue com o **[Business Capability Reference Catalogue](https://capabilities.turbo-ea.org)** — um catálogo aberto e curado de capacidades de negócio mantido em [github.com/vincentmakes/turbo-ea-capabilities](https://github.com/vincentmakes/turbo-ea-capabilities). A página Catálogo de capacidades permite navegar nesta referência e criar em massa as cartas `BusinessCapability` correspondentes, em vez de digitá-las uma a uma.

## Abrir a página

Clique no ícone do utilizador no canto superior direito da aplicação e depois em **Catálogo de capacidades**. A página está disponível para qualquer utilizador com a permissão `inventory.view`.

## O que vê

- **Cabeçalho** — a versão ativa do catálogo, o número de capacidades que contém e (para administradores) os controlos para verificar e obter atualizações.
- **Barra de filtros** — pesquisa em texto integral por id, nome, descrição e aliases, mais chips de nível (L1 → L4), um seletor múltiplo de setor e um interruptor «Mostrar obsoletas».
- **Barra de ações** — contadores de correspondências, o seletor global de nível (expande/recolhe todos os L1 nível a nível), expandir/recolher tudo, selecionar visíveis, limpar seleção.
- **Grade de L1** — uma carta por capacidade de primeiro nível. O nome do L1 ocupa uma faixa de cabeçalho azul claro; as capacidades filhas são listadas por baixo, indentadas com um fino traço vertical para sinalizar a profundidade — a mesma convenção de hierarquia usada no resto da aplicação, para que a página não tenha uma identidade visual própria. Os nomes longos quebram em várias linhas em vez de serem cortados. Cada cabeçalho de L1 também expõe o seu próprio seletor `−` / `+`: `+` abre o nível seguinte de descendentes apenas para esse L1, `−` fecha o nível aberto mais profundo. Ambos os botões estão sempre visíveis (a direção indisponível fica desativada), a ação está restrita a esse único L1 — os outros ramos não se movem — e o seletor global de nível no topo da página não é afetado.

## Selecionar capacidades

Marque a caixa ao lado de uma capacidade para a adicionar à seleção. A seleção propaga-se pela subárvore em ambas as direções, mas nunca toca em ancestrais:

- **Marcar** uma capacidade não selecionada adiciona-a e a cada descendente selecionável.
- **Desmarcar** uma capacidade selecionada remove-a, juntamente com cada descendente selecionável.

Desmarcar um único filho remove apenas esse filho e o que estiver abaixo — o pai e os irmãos permanecem selecionados. Desmarcar um pai remove toda a subárvore numa única ação. Para compor uma seleção «L1 + algumas folhas», escolha o L1 (isto seleciona toda a subárvore) e depois desmarque as capacidades L2/L3 que não pretende — o L1 permanece selecionado e a sua caixa continua marcada.

A página adopta automaticamente o tema claro/escuro da aplicação — no modo escuro é apresentado o mesmo layout neutro sobre papel `#1e1e1e` com texto e destaques em cor lavanda.

As capacidades que **já existem** no seu inventário aparecem com um **ícone de visto verde** em vez de uma caixa. Não podem ser selecionadas — nunca poderá criar duas vezes a mesma Business Capability através do catálogo. A correspondência prefere a marca `attributes.catalogueId` deixada por uma importação anterior (assim o visto verde sobrevive às alterações do nome visível) e recorre a uma comparação do nome visível insensível a maiúsculas para as cartas criadas à mão.

## Criação em massa de cartas

Quando há uma ou mais capacidades selecionadas, surge um botão fixo no fundo da página **Criar N capacidades**. Usa a permissão habitual `inventory.create` — se o seu papel não permitir criar cartas, o botão fica desativado.

Após a confirmação, o Turbo EA:

- Cria uma carta `BusinessCapability` por cada entrada de catálogo selecionada.
- **Preserva automaticamente a hierarquia do catálogo** — quando o pai e o filho estão ambos selecionados (ou o pai já existe localmente), o `parent_id` da nova carta filha é ligado à carta certa.
- **Ignora silenciosamente as correspondências existentes**. O diálogo de resultado indica quantas foram criadas e quantas foram ignoradas.
- Carimba os `attributes` de cada nova carta com `catalogueId`, `catalogueVersion`, `catalogueImportedAt` e `capabilityLevel` para que possa rastrear a sua origem.

Voltar a executar a mesma importação é seguro — é idempotente.

**Ligação bidirecional.** A hierarquia é reparada em ambas as direções, pelo que a ordem de importação não importa:

- Selecionar apenas um filho cujo **pai do catálogo já existe** como carta enxerta automaticamente o novo filho nesse pai existente.
- Selecionar apenas um pai cujos **filhos do catálogo já existem** como cartas re-associa esses filhos sob a nova carta — independentemente da posição atual (de primeiro nível ou aninhados à mão sob outra carta). Na importação, o catálogo é a fonte de verdade da hierarquia; se preferir um pai diferente para uma carta específica, edite-a depois da importação. O diálogo de resultado indica quantas cartas foram re-associadas, em conjunto com os contadores de criadas e ignoradas.

## Vista de detalhe

Clique no nome de qualquer capacidade para abrir um diálogo de detalhe que mostra a sua breadcrumb, descrição, setor, aliases, referências e uma vista totalmente expandida da sua subárvore. As correspondências existentes na subárvore são marcadas com um visto verde.

## Atualizar o catálogo (administradores)

O catálogo é distribuído **embutido** como dependência Python, pelo que a página funciona offline / em implementações isoladas. Os administradores (`admin.metamodel`) podem obter uma versão mais recente quando quiserem:

1. Clique em **Verificar atualizações**. O Turbo EA consulta `https://capabilities.turbo-ea.org/api/version.json` e indica se há uma versão mais recente disponível.
2. Em caso afirmativo, clique no botão **Obter v…** que aparece. O Turbo EA descarrega o catálogo mais recente e armazena-o como sobreposição do lado do servidor; tem efeito imediato para todos os utilizadores.

A versão ativa do catálogo é sempre apresentada no chip de cabeçalho. A sobreposição só prevalece sobre o pacote embutido quando a sua versão é estritamente superior — uma atualização do Turbo EA que entregue um catálogo embutido mais recente continuará, portanto, a funcionar como esperado.

O URL remoto é configurável através da variável de ambiente `CAPABILITY_CATALOGUE_URL`, para implementações auto-hospedadas que façam espelho interno do catálogo público.
