# Política de compatibilidade

A partir da versão `1.0.0`, o Turbo EA compromete-se a garantir compatibilidade retroativa documentada dentro de cada linha de versão principal. Esta página é o contrato: descreve o que permanece estável, o que pode mudar e como funcionam as descontinuações, para que os operadores possam planear atualizações sem surpresas.

A política aplica-se a `1.x`. Uma futura linha `2.x` poderá revê-la; nesse caso, será publicado um guia de migração com as notas de lançamento da `2.0.0`.

---

## O que está abrangido

### Esquema da base de dados (migrações Alembic)

Em `1.x`:

- As migrações são **aditivas** ou **compatíveis com versões anteriores durante a atualização**.
- Podem ser adicionadas novas colunas a qualquer momento.
- As colunas existentes não serão removidas sem um ciclo de descontinuação.
- As colunas existentes não serão renomeadas sem um ciclo de descontinuação (a renomeação segue as etapas add-new-column → backfill → deprecate-old-column → drop-in-next-major).
- As alterações de tipo limitam-se a ampliações (por exemplo, `varchar(80)` → `varchar(255)`); as reduções passam por descontinuação.
- As restrições de chave externa não se tornam mais rigorosas sem um ciclo de descontinuação (por exemplo, `ON DELETE SET NULL` não passa a `ON DELETE CASCADE`).

Os operadores podem atualizar com confiança; a migração automática no arranque do backend é segura para executar em dados de produção.

### Metamodelo integrado

Em `1.x`, o metamodelo fornecido em `backend/app/services/seed.py` é estável:

- As chaves dos tipos de card integrados (`Application`, `Initiative`, `BusinessCapability`, etc.) não serão renomeadas nem removidas.
- As chaves dos campos integrados desses tipos não serão removidas sem um ciclo de descontinuação.
- As chaves dos tipos de relação integrados não serão renomeadas nem removidas sem um ciclo de descontinuação.
- Os subtipos predefinidos fornecidos com os tipos integrados são estáveis.

As personalizações próprias dos operadores (tipos de card personalizados, campos adicionados através da interface de administração e tipos de relação personalizados) pertencem ao operador e não são abrangidas por esta política.

### API REST (`/api/v1/`)

Em `1.x`:

- Os endpoints em `/api/v1/` não serão removidos sem um ciclo de descontinuação.
- Os nomes dos campos existentes nos pedidos e nas respostas não serão alterados sem um ciclo de descontinuação.
- Os tipos dos campos não mudarão de forma incompatível (por exemplo, de cadeia de caracteres para array).
- Os novos campos opcionais dos pedidos e os novos campos das respostas não são incompatíveis e podem ser introduzidos em qualquer versão menor.
- Os novos endpoints não são incompatíveis e podem ser introduzidos em qualquer versão menor.
- A semântica de autenticação (JWT `Bearer`, formato do payload de `/auth/login`) é estável.
- A semântica dos códigos de estado HTTP é estável para os percursos de sucesso e erro documentados.

O comportamento além da superfície documentada (cabeçalhos não documentados, texto interno das mensagens de erro, ordenação quando `sort_by` não é especificado) não está abrangido.

### Chaves de permissão

As chaves de permissão definidas em `backend/app/core/permissions.py` são estáveis em `1.x`. Podem ser adicionadas novas chaves; as existentes não serão renomeadas nem removidas sem um ciclo de descontinuação.

O conjunto de permissões concedidas **por predefinição** às funções iniciais (`admin`, `bpm_admin`, `member`, `viewer`) pode mudar entre versões menores, com uma indicação no CHANGELOG. Os operadores que personalizaram as permissões das funções na sua implementação não são afetados.

### Configuração (variáveis de ambiente)

As variáveis de ambiente existentes documentadas em `CLAUDE.md` e `README.md` são estáveis em `1.x`. Podem ser adicionadas variáveis novas com valores predefinidos razoáveis. Os valores predefinidos podem mudar com uma indicação no CHANGELOG quando a alteração for relevante para os operadores (por exemplo, uma nova porta predefinida).

### Segredos cifrados em repouso

O marcador de prefixo `enc:` e a chave derivada de Fernet em `backend/app/core/encryption.py` são estáveis em `1.x`. Os operadores não precisam de voltar a cifrar os segredos entre atualizações menores.

---

## Ciclo de descontinuação

Quando for necessário remover algo abrangido por esta política:

1. **Assinalar como descontinuado na versão menor N.** A entrada do CHANGELOG inclui uma secção `Deprecated` que identifica a alteração. Para endpoints da API, a rota descontinuada envia o cabeçalho de resposta `Deprecation: true` (RFC 8594) e um cabeçalho `Sunset` que indica a data mais próxima prevista para a remoção.
2. **Continuar a suportá-lo na versão menor N+1.** A remoção não pode ocorrer na mesma versão menor da descontinuação. A forma descontinuada continua a funcionar.
3. **Remoção mais cedo na versão menor `N+2` ou em `2.0`** (consoante o que ocorrer primeiro). A remoção é acompanhada por uma secção `Removed` no CHANGELOG e uma nota de migração.

Para alterações na forma dos dados (migrações Alembic), aplica-se a mesma cadência `N` → `N+1`, expressa como add-new → backfill → drop-old.

---

## O que não está abrangido

Os elementos seguintes estão explicitamente fora do âmbito e podem mudar a qualquer momento:

- A **estrutura interna dos módulos Python** em `backend/app/`. As importações de `app.models`, `app.services`, etc. não fazem parte da API pública. Os plugins ou scripts que dependam de importações internas devem fixar uma versão específica do Turbo EA.
- A **estrutura dos blocos JSONB** armazenados nas tabelas integradas (`fields_schema`, `section_config`, `attributes`, `lifecycle`), para além do que é lido pela API REST documentada. A estrutura JSON em disco pode evoluir para suportar novas funcionalidades.
- Os **elementos internos do frontend**: caminhos dos ficheiros dos componentes, assinaturas das props dos componentes em `frontend/src/`, conteúdo de `frontend/src/types/index.ts` e estilos dos componentes MUI. Os operadores que utilizam o frontend incluído ficam protegidos destas alterações; quem incorporar componentes da árvore de código-fonte assume essa responsabilidade.
- As **personalizações do metamodelo introduzidas pelo operador**. Se adicionar um tipo de card ou campo personalizado através da interface de administração, a migração quando o alterar fica a seu cargo.
- Os **dados de demonstração e de inicialização** (`SEED_DEMO=true`). O conjunto de dados de demonstração pode evoluir livremente entre versões.
- Os **serviços de terceiros incluídos**: versão do DrawIO, imagem Ollama incluída e versão do swagger-ui-dist incorporado. Podem ser atualizados a qualquer momento.
- O **comportamento com configurações diferentes das predefinidas** explicitamente assinaladas como experimentais nas entradas do CHANGELOG.

---

## O que «1.0.0» realmente altera

Em comparação com a série `0.x`, a `1.0.0` não é, por si só, uma versão de funcionalidades: é o momento em que os compromissos acima começam a aplicar-se. O código fornecido na `1.0.0` é o mesmo que foi fornecido na `0.71.0`, acrescido do reforço da cadeia de fornecimento e das alterações ao processo de contribuição documentadas na [entrada do CHANGELOG da `1.0.0`](https://github.com/vincentmakes/turbo-ea/blob/main/CHANGELOG.md#100---2026-05-05).

As versões anteriores à `1.0` não estavam abrangidas por esta política. As migrações entre versões `0.x` podiam incluir, e incluíram, remoções e renomeações de esquema e alterações incompatíveis do metamodelo. A partir da `1.0.0`, essas alterações seguem o ciclo de descontinuação.
