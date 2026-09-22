# Cadeia de suprimentos

A partir da versão 1.0.0, as imagens de contêiner que o Turbo EA publica no GHCR carregam metadados verificáveis da cadeia de suprimentos, para que os operadores possam confirmar que uma imagem veio da CI deste projeto antes de levá-la à produção.

Esta página explica o que é assinado, qual versão do cosign você precisa, como verificar uma imagem e o chart do Helm, onde fica a SBOM e como o portão do Trivy se encaixa.

---

## O que é assinado

Toda imagem construída por `.github/workflows/docker-publish.yml` e enviada para `ghcr.io/vincentmakes/turbo-ea/<image>` é assinada com [cosign](https://github.com/sigstore/cosign) usando **OIDC sem chave**: não existe nenhuma chave de assinatura de longa duração. O certificado é emitido pelo Fulcio do Sigstore para a identidade do fluxo de trabalho (`https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@<ref>`), registrado no log público de transparência Rekor e descartado assim que a assinatura é criada.

Imagens assinadas:

- `ghcr.io/vincentmakes/turbo-ea/db`
- `ghcr.io/vincentmakes/turbo-ea/backend`
- `ghcr.io/vincentmakes/turbo-ea/frontend`
- `ghcr.io/vincentmakes/turbo-ea/nginx`
- `ghcr.io/vincentmakes/turbo-ea/mcp-server`

O chart do Helm, `ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea`, é assinado da mesma forma por `.github/workflows/helm-publish.yml` em cada tag de versão (identidade `…/helm-publish.yml@<ref>`).

A imagem `ollama` é reconstruída manualmente fora da matriz e atualmente não é assinada; se você depende do perfil Ollama incluído e precisa de verificação, construa-a a partir do código-fonte.

A assinatura se aplica ao digest da lista de manifestos OCI, então uma única assinatura cobre de forma transparente tanto `linux/amd64` quanto `linux/arm64`. Não há assinatura por plataforma para procurar.

---

## Formato da assinatura e versão do cosign necessária

**Verifique com o cosign 2.6 ou mais recente, ou com qualquer versão 3.x.** Clientes mais antigos — cosign 2.5 e anteriores — respondem `no signatures found` para toda imagem e chart publicados desde a 1.37.0, embora a assinatura esteja lá.

O motivo é uma mudança no formato de armazenamento, não na assinatura. Até a 1.36.0 o fluxo de publicação usava o cosign 2, que guardava a assinatura sob a tag `sha256-<digest>.sig` ao lado da imagem. Desde a 1.37.0 (junho de 2026, quando o instalador do cosign passou para o cosign 3) a assinatura é um [bundle do Sigstore](https://docs.sigstore.dev/about/bundle/): um *referrer* OCI 1.1 da imagem. O GHCR não implementa a API de referrers, então o cosign mantém o bundle sob a tag de índice alternativa `sha256-<digest>` — sem o sufixo `.sig` —, exatamente o lugar que um cliente anterior à 2.6 nunca consulta. `cosign tree` mostra o que está anexado a uma imagem:

```bash
cosign tree ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

| Versões | Formato da assinatura | Verificável com |
|---------|-----------------------|-----------------|
| 1.0.0 – 1.36.0 | tag legada `sha256-<digest>.sig` | qualquer cosign |
| 1.37.0 e posteriores, e todos os charts do Helm | bundle do Sigstore (referrer OCI) | cosign ≥ 2.6, ou 3.x |

Cada publicação agora verifica a própria assinatura com o cosign 2.6 — o cliente mais antigo que esta página promete — antes que o job fique verde, de modo que uma futura mudança de formato faria a CI falhar, e não a sua implantação. O projeto emite deliberadamente uma única assinatura, no formato atual do Sigstore: se um controlador de admissão ou um mecanismo de políticas no seu cluster ainda lê apenas a tag legada, atualize-o em vez de esperar uma segunda assinatura.

---

## Verificar uma imagem

Instale o [cosign](https://docs.sigstore.dev/cosign/installation/) 2.6 ou mais recente e então:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

O que as opções fazem:

- `--certificate-identity-regexp` — aceita qualquer caminho de fluxo de trabalho dentro deste repositório, então o mesmo comando funciona quer a imagem tenha sido publicada a partir de `docker-publish.yml` em `main` ou em uma tag. Se quiser ser mais rigoroso, substitua por `--certificate-identity 'https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@refs/tags/v<version>'`.
- `--certificate-oidc-issuer` — fixa o emissor OIDC no endpoint de tokens do GitHub. Uma assinatura emitida por qualquer outro emissor (por exemplo, a CI de um fork) falhará na verificação.

Uma verificação bem-sucedida imprime a carga assinada e uma entrada do log de transparência Rekor. Uma falha termina com código de saída diferente de zero e um diagnóstico — faça sua implantação falhar com ele. Se o diagnóstico for `no signatures found`, verifique primeiro `cosign version`: veja a seção acima.

Você também pode verificar por digest, a forma mais rigorosa (imune ao remapeamento de tags):

```bash
DIGEST=$(docker buildx imagetools inspect ghcr.io/vincentmakes/turbo-ea/backend:<version> --format '{{ .Manifest.Digest }}')
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend@${DIGEST}
```

---

## Verificar o chart do Helm

O chart é um artefato OCI no mesmo registro e é verificado com o mesmo comando:

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea:<version>
```

Uma exceção na identidade da tag: o chart `2.141.0`, a primeira versão do chart, foi enviado mas não assinado (sua etapa de assinatura falhou na autenticação com o registro) e foi assinado depois a partir do branch `main`, então sua identidade de certificado é `…/helm-publish.yml@refs/heads/main` em vez de uma referência de tag. A expressão regular acima aceita ambas; uma `--certificate-identity` rigorosa precisa indicar `refs/heads/main` para essa única versão.

---

## SBOM

Uma lista de materiais de software [SPDX](https://spdx.dev/) é gerada automaticamente pelo buildkit (`sbom: true` na etapa de build) e anexada a cada imagem como referrer OCI. Não há nada extra para instalar — ela vive no registro ao lado da imagem.

Obtenha-a com:

```bash
docker buildx imagetools inspect --format '{{ json .SBOM }}' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version> | jq .
```

A SBOM lista cada pacote que o buildkit observou na imagem final (pacotes apk, wheels Python, módulos Node etc.) com versões e URLs de origem. Entradas úteis para o seu próprio scanner de vulnerabilidades, ferramentas de conformidade de licenças ou inventário de componentes.

---

## Varredura de vulnerabilidades (Trivy)

O fluxo de publicação executa o [Trivy](https://github.com/aquasecurity/trivy) em cada imagem construída, em duas etapas:

- **Observação** — os achados HIGH e CRITICAL são enviados como SARIF para a aba **Security** do repositório no GitHub. Esta etapa nunca faz o job falhar.
- **Portão** — qualquer achado CRITICAL com correção disponível **faz a publicação falhar**, a menos que a CVE esteja listada em `.github/trivy-allowlist` com uma justificativa escrita (cada entrada é reavaliada trimestralmente e removida assim que o upstream lança um patch).

As mesmas duas etapas são repetidas diariamente contra os manifestos `:latest` realmente publicados, e um achado HIGH ou CRITICAL corrigível em uma imagem publicada dispara uma reconstrução contra repositórios Alpine atualizados. Os achados HIGH permanecem por enquanto apenas em observação: as bases são alpine (`python:3.12-alpine`, `postgres:18-alpine`, `nginx:alpine`) e carregam regularmente achados de fundo contra a musl-libc e dependências apk transitivas que nenhum caminho de código do Turbo EA alcança, mas que o Trivy reporta mesmo assim.

**Para operadores:** o portão protege as imagens publicadas, mas execute também o seu próprio scanner sobre a imagem baixada — sua política pode diferir da nossa. A SBOM publicada é uma entrada limpa.

**Para colaboradores:** se você encontrar um achado realmente explorável em um caminho de uso do Turbo EA, reporte-o por meio de um [aviso de segurança privado](https://github.com/vincentmakes/turbo-ea/security/advisories/new) em vez de comentar em uma issue pública. Veja [`SECURITY.md`](https://github.com/vincentmakes/turbo-ea/blob/main/SECURITY.md).

---

## Fixação de actions por SHA

Toda GitHub Action usada pelo fluxo de publicação está fixada em um SHA de commit de 40 caracteres, não em uma tag major flutuante. Assim, um mantenedor upstream comprometido ou um typosquat não consegue mudar silenciosamente o que roda na nossa CI sem um diff visível neste repositório. As atualizações fluem pelo ecossistema `github-actions` do Dependabot em cadência mensal, para que as renovações continuem acontecendo — apenas passando por revisão.
