# Migração de plataforma

> Plataformas de origem suportadas hoje: **SAP LeanIX**. Adaptadores adicionais (Ardoq, Mega HOPEX, BiZZdesign, Avolution Abacus, …) se conectam ao mesmo pipeline de staging e aplicação e aparecem automaticamente no diálogo de upload quando são lançados.

O importador de migração de plataforma (**Administração → Configurações → Migração**) ingere um workspace LeanIX completo e o aterrissa como cards, relações, tags, partes interessadas, documentos, comentários e um metamodelo totalmente desenvolvido no Turbo EA em uma única operação por etapas, revisável.

## Para quem é isso?

Para clientes que migram do LeanIX (SAP LeanIX) para o Turbo EA. O importador aceita a planilha xlsx **Full Snapshot** do LeanIX — a exportação multi-aba com uma aba por tipo de fact sheet, uma aba por tipo de relação, mais `TagGroups`, `Tags`, `Documents`, `Comments`, `Types` e uma aba de referência `ReadMe`. Uploads em outros formatos são rejeitados já no passo de envio com uma mensagem de erro clara.

## Como obter a exportação

No LeanIX, abra **Administration → Export → Full Snapshot**. Isso produz uma única planilha XLSX contendo todas as fact sheets **ativas**, além de suas relações, grupos de tags, tags, documentos (chamados *resources* no LeanIX) e comentários.

**Fact sheets arquivadas não são incluídas** no Full Snapshot — restaure-as primeiro no LeanIX se desejar que cheguem ao Turbo EA.

## O fluxo de trabalho

1. **Carregar** o snapshot em **Configurações → Migração → Nova migração**. O arquivo permanece no disco do servidor; o banco apenas armazena metadados. O parsing roda em background e o status avança automaticamente de `uploaded → parsed`.

2. **Revisar** cada tipo de entidade na visualização por abas. Cada linha staged carrega uma ação:
    - `create` — será adicionada ao Turbo EA
    - `update` — já existe; os campos do diff serão mesclados
    - `skip` — já existe sem alterações
    - `conflict` — endpoint faltante, tipo não mapeado, colisão com built-in, e-mail malformado, etc. — veja a coluna *Note* para o motivo completo

    Cada aba exibe acima da tabela uma linha de **pílulas de filtro** — uma por tipo de card quando aplicável, senão por ação — para reduzir uma lista longa (centenas de cards, dezenas de tipos de fact sheet) a uma fatia por vez. A aba **Cards** exibe o **nome** do card resolvido ao lado do UUID de origem. A coluna *Note* mostra o motivo completo do conflito; as linhas `update` listam os nomes de campo alterados com um tooltip que detalha a transição `antigo → novo`.

    As abas **Novos tipos**, **Campos personalizados** e **Novas relações** exibem o metamodelo personalizado do tenant do seu workspace de origem. Por padrão são aceitas como estão e criam tipos de card / campos / tipos de relação não-built-in correspondentes no Turbo EA.

3. **Mapear os campos importados** (opcional, na aba **Campos personalizados**). Para cada coluna personalizada da plataforma de origem, escolha uma de três opções no menu suspenso ao lado da linha:
    - **Importar como novo campo personalizado** (padrão) — a coluna aterrissa como novo atributo no tipo de card destino, sob uma seção sintética *Imported from {source}*.
    - **Mapear para um campo Turbo EA existente** — o valor é roteado para um campo built-in do tipo de card destino (ex.: enviar `businessCriticality` do LeanIX para o slot `businessCriticality` próprio do TEA). A linha do campo de metamodelo é então ignorada no apply, portanto nenhuma coluna órfã é criada.
    - **Mapear para uma fase de ciclo de vida** — para colunas de data, o valor é roteado para o slot padrão `plan` / `phaseIn` / `active` / `phaseOut` / `endOfLife` em `card.lifecycle`. Valores de data/datetime são auto-convertidos para `YYYY-MM-DD` (o sufixo `T00:00:00` que algumas plataformas escrevem em células datetime é removido); valores não-parseáveis são descartados para não corromper o mapa de lifecycle.
    - **Não importar este campo** — a coluna é completamente ignorada, nem como atributo nem como campo de metamodelo.

    O mapeamento é por migração e pode ser editado enquanto o status for `parsed` ou `previewed`. As colunas-base da plataforma de origem que o adaptador roteia diretamente para os slots padrão do Turbo EA (ex.: LeanIX `name`, `displayName`, `description`, `status`, `category → subtype`, `lifecycle:*`, `qualitySeal`, `completion`) são listadas no topo da aba em um banner informativo somente-leitura — não há decisão de mapeamento a tomar.

4. **Aplicar** quando estiver satisfeito. O pipeline de apply executa 12 passagens ordenadas por dependências (tipos do metamodelo → campos do metamodelo → tipos de relação do metamodelo → usuários → cards → grupos de tags → tags → vínculos card-tag → relações → assinaturas → documentos → comentários) em savepoints individuais — uma linha com falha não envenena o restante do import. O status avança de `applying → applied` (ou `failed` se os erros cruzarem o limite de segurança).

    Se o snapshot analisado contiver linhas em **conflict**, um banner de aviso aparece acima das abas de staging (com chips clicáveis que saltam para a aba afetada) e clicar em **Aplicar** abre um diálogo de confirmação detalhando quais tipos carregam conflitos. Você precisa reconhecer explicitamente que as linhas em conflito serão ignoradas antes do apply executar. O *Resultado do apply* posterior mostra um chip *conflitos* dedicado ao lado de *criados / atualizados / ignorados / erros* — conflitos não são skips silenciosos, são um resultado de primeira ordem visível no histórico de migração.

## O que é importado

| LeanIX | Turbo EA |
|---|---|
| Application, ITComponent, Business Capability, Business Context, Process, DataObject, Interface, Provider, TechCategory, Platform, Objective, Project / Initiative | Mapeamento direto 1:1 de tipo de card |
| User Group | Organization com subtipo `team`, tagada `leanix_origin=UserGroup` |
| Fases do ciclo de vida (plan / phaseIn / active / phaseOut / endOfLife) | Carregadas literalmente para `cards.lifecycle` |
| Hierarquia (`childParentRelation`) | Dobrada em `Card.parent_id` |
| Arestas Successor/Predecessor (`*SuccessorRelation`) | Armazenadas como relações; a direção é invertida no import para a convenção do Turbo EA «source sucede target» casar com a semântica do LeanIX «X tem sucessor Y». Os novos tipos de card do tenant têm `has_successors=true` para que a visão de linhagem seja renderizada. |
| Relações (50+ tipos de aresta padrão do LeanIX, tanto em notação xlsx `applicationITComponentRelation` quanto GraphQL `relApplicationToITComponent`) | Relações nativas do Turbo EA com atributos de aresta |
| Tipos de relação definidos pelo tenant (Server↔Application, lxSystem*, lxDora*, microservice*, ESG*, etc.) | Novas linhas `relation_types` não-built-in, criadas automaticamente na mesma passagem de import para que cada aresta efetivamente aterrisse |
| Tags (grupos single/multi) | Grupos de tags + tags + joins por card |
| Subscriptions (uma por papel RESPONSIBLE/OBSERVER) | Linhas de stakeholder; usuários auto-criados desativados (`is_active=false`) |
| Documentos (URL) | Anexos do tipo documento |
| Comentários (nível superior + respostas, achatados) | Linhas de comentário |
| Tipos de fact sheet personalizados do tenant (ex.: `ESGCapability`, `Server`, `System`, `TechPlatform`, `TechnicalStack`) | Novos tipos de card não-built-in com `has_hierarchy=true`, `has_successors=true` e uma seção `Imported from LeanIX` pré-preenchida |
| Campos personalizados do tenant | Anexados ao `fields_schema` do tipo alvo sob uma seção sintética `Imported from LeanIX`. Tipo do campo e lista **completa** de opções enum são extraídos da aba `ReadMe` da planilha — `currentMaturity` aterrissa como single-select com todos os 5 valores (`adHoc, repeatable, defined, managed, optimized`) mesmo quando os dados usam apenas um |
| Tipos de relação personalizados do tenant | Novos tipos de relação não-built-in, com tipos de endpoint traduzidos via o mapa LX↔TEA (`UserGroup → Organization`, etc.) |

### Por que a aba ReadMe importa

A primeira aba do xlsx (`ReadMe`) é a referência autoritativa de campos do LeanIX: cada coluna documentada com seu tipo (`String`, `Integer`, `Percent`, `Datetime`, `Boolean`, `String list`) e, quando aplicável, sua restrição enum completa (`Possible values: one of A, B, C.`). O importador lê essa aba primeiro e a usa como fonte primária de verdade para os metadados de campo — recorrendo à aba in-data `Types` apenas quando a ReadMe não cobre uma coluna. É a diferença entre um campo importado como entrada de texto livre e um dropdown adequado com as opções corretas.

## O que **não** é importado

O snapshot não carrega estes itens — o importador sinaliza o faltante na coluna *Note* por linha:

- **Binários de documentos** — apenas as URLs estão no snapshot; o importador cria documentos do tipo link. Recarregue os binários manualmente.
- **Threading de comentários** — as respostas são achatadas para comentários de nível superior para preservar o texto; pais de thread exigiriam metadados de UI do LeanIX ausentes do snapshot.
- **Senhas de usuário e vínculos SSO** — usuários auto-criados aterrissam desativados. Convide-os ou vincule-os a SSO posteriormente.
- **Histórico de auditoria** anterior ao import — o histórico do Turbo EA começa no timestamp do apply.
- **Diagramas / pôsteres / dashboards / buscas salvas / preferências de notificação / tokens de API / webhooks** — sem equivalente no Turbo EA, ou sem análogo no snapshot.

## Reexecução de um import

A idempotência é embutida. A tabela `migration_identity_map` registra a correspondência UUID LeanIX → Turbo EA para cada entidade importada. Um re-upload do mesmo snapshot (ou de um snapshot atualizado do mesmo workspace) detecta entidades existentes e escreve linhas staged `update`/`skip` em vez de duplicar `create`. O `external_id` do card carrega o `factSheetId` do LeanIX, então o vínculo sobrevive mesmo se a identity map for limpa.

Se precisar refazer um import (ex.: deletou em massa os cards importados pela UI e quer reinseri-los), use o ícone lixeira na linha da migração para apagá-la, e então recarregue. Migrações `applied` são deletáveis; isso libera o lock de idempotência por hash de arquivo, permitindo recarregar o mesmo snapshot. Linhas órfãs em `migration_identity_map` apontando para cards inexistentes são automaticamente podadas na próxima passagem de staging — limpeza manual da identity map nunca é necessária.

## Permissão

Esta página é controlada pela permissão `admin.migrate`. Por padrão apenas o papel **admin** a possui; conceda-a explicitamente a outros papéis em **Configurações → Papéis** se desejar que um não-admin conduza a migração.

## Limitações a considerar

- **Uma migração em andamento por hash de arquivo.** Recarregar exatamente os mesmos bytes enquanto uma migração para esse hash ainda está ativa retorna o registro de migração existente (o hash SHA-256 é a chave natural de idempotência). Apague o registro de migração primeiro se realmente quiser ingerir o mesmo arquivo novamente.
- **Workspaces grandes** (10k+ fact sheets): o parser é em streaming, mas o pipeline de apply escreve linhas em uma transação por passagem. Planeje ~15 minutos para imports muito grandes.
- **Campos, valores e tags personalizados são tolerados, não pré-mapeados.** Qualquer coluna do LeanIX que não esteja no metamodelo built-in do Turbo EA aterrissa verbatim no mapa `attributes` do card importado e aparece na aba **Campos personalizados** para que um admin possa tratá-la (roteá-la para um campo TEA existente, para uma fase de ciclo de vida, ou ignorá-la — veja *Mapear os campos importados* no fluxo acima). O mesmo vale para grupos de tags definidos pelo tenant e tipos de relação adicionados pelas plataformas de origem (ex.: `lxSystemSystem*`, `*Lx*Dora*`, `microservice*`, `eSGCapability*`) — aparecem inalterados nas abas **Novos tipos** / **Novas relações**, prontos para decisão do admin.
- **E-mails de assinatura aceitam ambos os separadores.** O export «Full Snapshot» do LeanIX separa e-mails em células `subscriptions:<RoleType>[:<RoleName>]` com `;`; o export GraphQL CSV usa `,`. O parser aceita qualquer um. Linhas com e-mail malformado (sem `@`, ou separador não dividido) são staged como `conflict` com motivo claro em vez de criadas como usuários falsos — corrija o export de origem e recarregue.

## Limpeza

Apagar um registro de migração (Configurações → Migração → ícone lixeira) remove tanto as linhas de banco para essa migração (registros staged cascateiam) quanto o arquivo de snapshot em disco. Migrações nos status `uploaded`, `parsed`, `previewed`, `failed`, `aborted` e `applied` são todas deletáveis; uma migração `applying` deve terminar (ou falhar) antes de poder ser removida.
