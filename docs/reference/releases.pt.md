# Lançamentos e canal de pré-lançamento

Como o Turbo EA gere versões, etiquetas e publica imagens de contentores. Esta página é uma referência para operadores que precisam de fixar versões em produção e para contribuidores que preparam lançamentos.

---

## Versionamento

O Turbo EA segue [Semantic Versioning](https://semver.org/). A única fonte de verdade da versão atual é o ficheiro `/VERSION` na raiz do repositório.

- **Patch** (por exemplo, `1.0.0` → `1.0.1`): apenas correções de erros. A atualização é sempre segura.
- **Minor** (por exemplo, `1.0.0` → `1.1.0`): novas funcionalidades. Compatível com versões anteriores, de acordo com a [política de compatibilidade](compatibility.md).
- **Major** (por exemplo, `1.x` → `2.0.0`): alterações incompatíveis. As notas de migração acompanham o lançamento.

A versão é incrementada uma vez por PR, não por commit. A entrada do CHANGELOG do PR usa a nova versão como título; a CI falha com [`version-check.yml`](https://github.com/TommasoChi/turbo-ea/blob/main/.github/workflows/version-check.yml) se `/VERSION` for incrementado sem um título `## [<version>]` correspondente em `CHANGELOG.md`.

---

## Etiquetas de imagens de contentores

Cada push para `main` e cada etiqueta `v*.*.*` aciona `.github/workflows/docker-publish.yml`, que compila e publica no GHCR imagens multi-arquitetura (`amd64` + `arm64`).

Para uma etiqueta de lançamento como `v1.2.3`, as etiquetas publicadas em cada imagem são:

| Etiqueta      | Aponta para                         | Estável?                              |
|---------------|-------------------------------------|---------------------------------------|
| `1.2.3`       | exatamente esse lançamento          | sim — fixe em produção                 |
| `1.2`         | o patch mais recente de `1.2.x`      | avança com os patches                  |
| `1`           | a versão minor mais recente de `1.x`| avança com versões minor               |
| `latest`      | a versão não preliminar mais recente | avança a cada lançamento               |
| `sha-<short>` | o commit exato                      | sim — depuração / pré-lançamento       |

Nos pushes para `main` (sem etiqueta), só são produzidas as etiquetas `main` e `sha-<short>` — nunca `latest` nem qualquer etiqueta semver.

Todos os manifestos das imagens publicadas são assinados com Cosign através de OIDC sem chave. Os detalhes de verificação e SBOM estão em [Supply Chain](../admin/supply-chain.md).

---

## Canal de pré-lançamento

Para versões minor que alteram a disposição dos contentores, as imagens base, os UID predefinidos, os nomes dos volumes, as portas predefinidas ou o esquema de modo a exigir uma ação do operador, é criada uma **release candidate** antes da etiqueta final.

Convenções:

- As etiquetas RC seguem `vX.Y.0-rc.N` — nunca numa versão patch, apenas em versões minor com alterações visíveis para os operadores.
- `docker/metadata-action` do fluxo de publicação está configurado com `flavor: latest=auto`. Isto exclui automaticamente as etiquetas semver de pré-lançamento de `:latest`, `:X.Y` e `:X` — as RC são publicadas apenas como `:X.Y.0-rc.N`. Os operadores que fixam `:latest` não obtêm acidentalmente uma RC.
- O GitHub marca automaticamente como pré-lançamento as releases com a etiqueta `vX.Y.0-rc.N`. Uma etiqueta estável cria uma release normal.

Período de avaliação:

- Uma RC permanece disponível durante pelo menos **48–72 horas**, ou até que pelo menos um operador fora da equipa mantenedora confirme uma atualização bem-sucedida — aplica-se o período mais longo.
- Os relatórios de erros de uma RC são publicados como `vX.Y.0-rc.N+1` quando a correção se justifica. A RC anterior permanece no GHCR para permitir a reprodução.

Promoção para a versão final:

- A etiqueta final `vX.Y.0` aponta para o merge do PR de promoção, que atualiza a versão e o changelog após a última RC. O fluxo de publicação volta a compilar e etiquetar as imagens multi-arquitetura; o digest será diferente do da RC porque a versão e os dados de compilação mudam.
- As etiquetas `:X.Y`, `:X` e `:latest` passam então a apontar para o lançamento final.

---

## Preparar um lançamento (lista do maintainer)

Para um lançamento patch ou minor normal, não é necessário um canal RC:

1. Num ramo de funcionalidade, incremente `VERSION` e adicione o título correspondente `## [<version>] - YYYY-MM-DD` a `CHANGELOG.md`.
2. Execute `python scripts/dump_openapi.py` se alguma rota do backend ou algum esquema tiver mudado; inclua o resultado se tiver mudado.
3. Abra o PR. A CI executa lint, testes, verificação de diferenças OpenAPI e `version-check.yml`.
4. Faça squash e merge para `main`. Antes de criar a etiqueta nesse commit, execute `security-audit` e `ponytail-audit` no repositório inteiro. Leia ambos os relatórios, resolva os resultados de segurança bloqueantes e todos os Must e Should, e confirme que ambas as auditorias abrangem o commit final. Num chat do Codex ou Claude, registe os dois relatórios concluídos conforme descrito em `SETUP.md`. Isto aplica-se às etiquetas estáveis e às release candidates.
5. A partir de `main`: execute `git tag -s v<version> -m "v<version>"` (ou `git tag v<version>` se não estiver configurada uma chave de assinatura) e `git push origin v<version>`.
6. O fluxo `Publish GitHub Release` extrai a secção `## [<version>]` de `CHANGELOG.md` e cria um GitHub Release.
7. O fluxo `Publish Docker images to GHCR` compila, assina e publica as imagens multi-arquitetura.
8. Verifique com Cosign:
   ```bash
   cosign verify \
     --certificate-identity-regexp '^https://github\.com/TommasoChi/turbo-ea/\.github/workflows/docker-publish\.yml@refs/(heads/main|tags/v[^/]+)$' \
     --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
     ghcr.io/tommasochi/turbo-ea/backend:<version>
   ```
   Requer Cosign 2.6 ou posterior (ou 3.x) — a assinatura é um pacote Sigstore; consulte [Supply Chain](../admin/supply-chain.md).

Para uma versão minor que requer uma RC:

1. Siga o mesmo fluxo de PR e merge descrito acima, mas incremente a versão para `1.Y.0-rc.1`.
2. Após o merge, crie a etiqueta `v1.Y.0-rc.1` e envie-a. O fluxo de publicação compila e publica as imagens RC (apenas `:1.Y.0-rc.1`, nunca `:latest` nem etiquetas curtas — `flavor: latest=auto` trata disso). O GitHub marca automaticamente a release como pré-lançamento.
3. Aguarde o período de avaliação. Resolva os problemas comunicados com `-rc.2`, `-rc.3`, conforme necessário.
4. Para promover: incremente `VERSION` para `1.Y.0` num PR final (a entrada do CHANGELOG consolida todas as correções das RC), faça merge, execute e registe ambas as auditorias de release no commit final e, depois, crie a etiqueta `v1.Y.0` e envie-a. As etiquetas `:latest` e as curtas passam a apontar para o lançamento promovido.

---

## Fim de vida

Só a linha minor mais recente recebe correções de segurança. Consulte [`SECURITY.md`](https://github.com/vincentmakes/turbo-ea/blob/main/SECURITY.md) para obter a política completa. As linhas minor mais antigas chegaram ao fim de vida e não receberão backports — os operadores de versões antigas devem planear as atualizações segundo a política de compatibilidade.
