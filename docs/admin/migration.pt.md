# Migração de plataforma (LeanIX)

O importador de migração de plataforma (**Administração → Configurações → Migração**) ingere um workspace LeanIX completo e o aterrissa como cards, relações, tags, partes interessadas, documentos, comentários e um metamodelo totalmente desenvolvido no Turbo EA em uma única operação por etapas, revisável.

## Para quem é isso?

Para clientes que migram do LeanIX (SAP LeanIX) para o Turbo EA. O importador aceita **dois formatos de snapshot**, ambos detectados automaticamente pelo conteúdo do arquivo:

- **Full Export `.xlsx`** (padrão para a maioria dos clientes) — a planilha multi-aba produzida pelo LeanIX via *Reports → Full Export*. Uma aba por tipo de fact sheet, uma aba por tipo de relação, mais `TagGroups`, `Tags`, `Documents`, `Comments`, `Types` e uma aba de referência `ReadMe`. Qualquer usuário do LeanIX pode produzi-lo; sem acesso de administrador requerido.
- **Snapshot JSON comprimido com gzip** (`workspace-<id>-<data>.json.gz`) — o snapshot de clonagem entre tenants produzido via **Administration → Workspace → Conduct a Data Snapshot**. Apenas administradores.

Ambos os formatos convergem para o mesmo modelo interno — o parser detecta automaticamente qual foi carregado pelo conteúdo do arquivo (magic ZIP `PK\x03\x04` para xlsx e magic gzip `\x1f\x8b` para o JSON), portanto uma extensão mal nomeada é roteada corretamente.

## Como obter a exportação

- **Full Export xlsx** — No LeanIX, **Reports → … → Full Export** produz um arquivo como `20260518_snapshot_demo.xlsx`. Contém todas as fact sheets ativas, todas as relações, os metadados de tag/documento/comentário e uma aba `ReadMe` que descreve cada coluna e seus valores permitidos.
- **Snapshot JSON Workspace** — No LeanIX, **Administration → Workspace → Conduct a Data Snapshot** dispara o snapshot de clonagem entre tenants. O arquivo de saída chama-se tipicamente `workspace-<id>-<data>.json.gz`. Requer acesso de administrador no LeanIX.

Se não tiver acesso de administrador no LeanIX mas dispor de um token API a nível de tenant, a combinação das consultas GraphQL `allFactSheets`, `subscriptions`, `relations` e `documents` produz um dataset JSON correspondente ao formato snapshot — o importador também o aceita.

## O fluxo de trabalho

1. **Carregar** o snapshot em **Configurações → Migração → Nova migração**. O arquivo permanece no disco do servidor; o banco apenas armazena metadados. O parsing roda em background e o status avança automaticamente de `uploaded → parsed`.

2. **Revisar** cada tipo de entidade na visualização por abas. Cada linha staged carrega uma ação:
    - `create` — será adicionada ao Turbo EA
    - `update` — já existe; os campos do diff serão mesclados
    - `skip` — já existe sem alterações
    - `conflict` — endpoint faltante, tipo não mapeado ou colisão com built-in — veja a coluna *Note* para o motivo

    As abas **Novos tipos**, **Campos personalizados** e **Novas relações** exibem o metamodelo personalizado do tenant do seu workspace LeanIX. Por padrão são aceitas como estão e criam tipos de card / campos / tipos de relação não-built-in correspondentes no Turbo EA. Para controle mais fino, edite a chave/rótulo/tipo propostos no JSON do registro staged antes de aplicar.

3. **Aplicar** quando estiver satisfeito. O pipeline de apply executa 12 passagens ordenadas por dependências em savepoints individuais — uma linha com falha não envenena o restante do import. O status avança de `applying → applied` (ou `failed` se os erros cruzarem o limite de segurança).

## O que é importado

| LeanIX | Turbo EA |
|---|---|
| Application, ITComponent, Business Capability, Business Context, Process, DataObject, Interface, Provider, TechCategory, Platform, Objective, Project / Initiative | Mapeamento direto 1:1 de tipo de card |
| User Group | Organization com subtipo `team`, tagada `leanix_origin=UserGroup` |
| Fases do ciclo de vida (plan / phaseIn / active / phaseOut / endOfLife) | Carregadas literalmente para `cards.lifecycle` |
| Hierarquia (`childParentRelation`) | Dobrada em `Card.parent_id` |
| Arestas Successor/Predecessor (`*SuccessorRelation`) | Armazenadas como relações; os novos tipos de card do tenant têm `has_successors=true` para que a visão de linhagem seja renderizada |
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

A idempotência é embutida. A tabela `leanix_identity_map` registra a correspondência UUID LeanIX → Turbo EA para cada entidade importada. Um re-upload do mesmo snapshot (ou de um snapshot atualizado do mesmo workspace) detecta entidades existentes e escreve linhas staged `update`/`skip` em vez de duplicar `create`. O `external_id` do card carrega o `factSheetId` do LeanIX, então o vínculo sobrevive mesmo se a identity map for limpa.

Se precisar refazer um import (ex.: deletou em massa os cards importados pela UI e quer reinseri-los), use o ícone lixeira na linha da migração para apagá-la, e então recarregue. Migrações `applied` são deletáveis; isso libera o lock de idempotência por hash de arquivo, permitindo recarregar o mesmo snapshot. Linhas órfãs em `leanix_identity_map` apontando para cards inexistentes são automaticamente podadas na próxima passagem de staging — limpeza manual da identity map nunca é necessária.

## Permissão

Esta página é controlada pela permissão `admin.migrate`. Por padrão apenas o papel **admin** a possui; conceda-a explicitamente a outros papéis em **Configurações → Papéis** se desejar que um não-admin conduza a migração.

## Limitações a considerar

- **Uma migração em andamento por hash de arquivo.** Recarregar exatamente os mesmos bytes enquanto uma migração para esse hash ainda está ativa retorna o registro de migração existente (o hash SHA-256 é a chave natural de idempotência). Apague o registro de migração primeiro se realmente quiser ingerir o mesmo arquivo novamente.
- **Workspaces grandes** (10k+ fact sheets): o parser é em streaming, mas o pipeline de apply escreve linhas em uma transação por passagem. Planeje ~15 minutos para imports muito grandes.
- **Campos, valores e tags personalizados são tolerados, não pré-mapeados.** Qualquer coluna do LeanIX que não esteja no metamodelo built-in do Turbo EA aterrissa verbatim no mapa `attributes` do card importado e aparece na aba **Campos personalizados** para que um admin possa promovê-la. O mesmo vale para grupos de tags definidos pelo tenant e tipos de relação adicionados pelos clientes do LeanIX (ex.: `lxSystemSystem*`, `*Lx*Dora*`, `microservice*`, `eSGCapability*`) — aparecem inalterados nas abas **Novos tipos** / **Novas relações**, prontos para decisão do admin.

## Limpeza

Apagar um registro de migração (Configurações → Migração → ícone lixeira) remove tanto as linhas de banco para essa migração (registros staged cascateiam) quanto o arquivo de snapshot em disco. Migrações nos status `uploaded`, `parsed`, `previewed`, `failed`, `aborted` e `applied` são todas deletáveis; uma migração `applying` deve terminar (ou falhar) antes de poder ser removida.
