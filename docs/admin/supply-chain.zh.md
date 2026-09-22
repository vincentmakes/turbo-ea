# 供应链

从 1.0.0 版本起，Turbo EA 发布到 GHCR 的容器镜像都携带可验证的供应链元数据，运维人员可以在将镜像拉入生产环境之前，确认它确实来自本项目的 CI。

本页说明签名了哪些内容、需要哪个版本的 cosign、如何验证镜像和 Helm chart、SBOM 在哪里，以及 Trivy 门禁如何配合。

---

## 签名了哪些内容

由 `.github/workflows/docker-publish.yml` 构建并推送到 `ghcr.io/vincentmakes/turbo-ea/<image>` 的每个镜像，都使用 [cosign](https://github.com/sigstore/cosign) 以 **无密钥 OIDC** 方式签名：不存在任何长期有效的签名密钥。证书由 Sigstore 的 Fulcio 为工作流身份（`https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@<ref>`）签发，记录在公开的 Rekor 透明日志中，并在签名创建后立即丢弃。

已签名的镜像：

- `ghcr.io/vincentmakes/turbo-ea/db`
- `ghcr.io/vincentmakes/turbo-ea/backend`
- `ghcr.io/vincentmakes/turbo-ea/frontend`
- `ghcr.io/vincentmakes/turbo-ea/nginx`
- `ghcr.io/vincentmakes/turbo-ea/mcp-server`

Helm chart `ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea` 由 `.github/workflows/helm-publish.yml` 在每个发布标签上以同样方式签名（身份为 `…/helm-publish.yml@<ref>`）。

`ollama` 镜像在矩阵之外手工重建，目前未签名；如果您依赖内置的 Ollama profile 并需要验证，请从源码构建。

签名作用于 OCI manifest list 的 digest，因此一个签名即可透明地同时覆盖 `linux/amd64` 与 `linux/arm64`，不存在需要逐个查找的按平台签名。

---

## 签名格式与所需的 cosign 版本

**请使用 cosign 2.6 或更新版本，或任意 3.x 版本进行验证。** 更早的客户端（cosign 2.5 及以下）对 1.37.0 之后发布的每个镜像和 chart 都会报告 `no signatures found`，尽管签名确实存在。

原因在于存储格式的变化，而不是签名本身。到 1.36.0 为止，发布工作流使用 cosign 2，它把签名存放在镜像旁边的 `sha256-<digest>.sig` 标签下。从 1.37.0 起（2026 年 6 月，cosign 安装器切换到 cosign 3 时），签名是一个 [Sigstore bundle](https://docs.sigstore.dev/about/bundle/)：镜像的 OCI 1.1 *referrer*。GHCR 没有实现 referrers API，所以 cosign 把 bundle 存放在回退的索引标签 `sha256-<digest>` 下（没有 `.sig` 后缀），而这恰恰是 2.6 之前的客户端从不查看的位置。`cosign tree` 可以显示镜像上附加了什么：

```bash
cosign tree ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

| 版本 | 签名格式 | 可用以下客户端验证 |
|------|----------|--------------------|
| 1.0.0 – 1.36.0 | 旧式 `sha256-<digest>.sig` 标签 | 任意 cosign |
| 1.37.0 及之后，以及所有 Helm chart | Sigstore bundle（OCI referrer） | cosign ≥ 2.6 或 3.x |

现在每次发布都会先用 cosign 2.6（本页承诺支持的最旧客户端）验证自己的签名，然后作业才会变绿，因此将来若格式再次变化，失败的会是 CI 而不是您的部署。项目有意只发出一个采用当前 Sigstore 格式的签名：如果您集群中的准入控制器或策略引擎仍然只读取旧式标签，请升级它，而不是期待第二个签名。

---

## 验证镜像

安装 [cosign](https://docs.sigstore.dev/cosign/installation/) 2.6 或更新版本，然后：

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version>
```

各参数的作用：

- `--certificate-identity-regexp` — 接受本仓库内的任意工作流路径，因此无论镜像是从 `main` 上的 `docker-publish.yml` 还是从某个标签发布的，同一条命令都能用。如需更严格，可改为 `--certificate-identity 'https://github.com/vincentmakes/turbo-ea/.github/workflows/docker-publish.yml@refs/tags/v<version>'`。
- `--certificate-oidc-issuer` — 把 OIDC 签发者固定为 GitHub 的令牌端点。由任何其他签发者（例如某个 fork 的 CI）签出的签名都会验证失败。

验证成功会打印已签名的载荷和一条 Rekor 透明日志记录。验证失败会以非零退出码结束并给出诊断信息——请让您的部署据此失败。若诊断信息是 `no signatures found`，请先检查 `cosign version`：参见上一节。

您也可以按 digest 验证，这是最严格的形式（不受标签重新指向的影响）：

```bash
DIGEST=$(docker buildx imagetools inspect ghcr.io/vincentmakes/turbo-ea/backend:<version> --format '{{ .Manifest.Digest }}')
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/backend@${DIGEST}
```

---

## 验证 Helm chart

chart 是同一注册表中的 OCI 制品，用同一条命令验证：

```bash
cosign verify \
  --certificate-identity-regexp 'https://github.com/vincentmakes/turbo-ea/.+' \
  --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
  ghcr.io/vincentmakes/turbo-ea/charts/turbo-ea:<version>
```

标签身份有一个例外：chart `2.141.0` 是第一个 chart 版本，当时已推送但未签名（其签名步骤在注册表鉴权上失败），后来从 `main` 分支补签，因此它的证书身份是 `…/helm-publish.yml@refs/heads/main` 而不是标签引用。上面的正则表达式两者都接受；若对这一个版本使用严格的 `--certificate-identity`，必须写 `refs/heads/main`。

---

## SBOM

buildkit 会自动生成 [SPDX](https://spdx.dev/) 软件物料清单（构建步骤中的 `sbom: true`），并以 OCI referrer 的形式附加到每个镜像。无需额外安装任何东西——它就存放在注册表中镜像的旁边。

获取方式：

```bash
docker buildx imagetools inspect --format '{{ json .SBOM }}' \
  ghcr.io/vincentmakes/turbo-ea/backend:<version> | jq .
```

SBOM 列出了 buildkit 在最终镜像中观察到的每个软件包（apk 包、Python wheel、Node 模块等）及其版本和来源 URL，可作为您自己的漏洞扫描器、许可证合规工具或组件清单的输入。

---

## 漏洞扫描（Trivy）

发布工作流分两步对每个构建出的镜像运行 [Trivy](https://github.com/aquasecurity/trivy)：

- **观察** — HIGH 和 CRITICAL 级别的发现以 SARIF 形式上传到仓库的 GitHub **Security** 标签页。此步骤从不导致作业失败。
- **门禁** — 任何已有修复的 CRITICAL 发现都会**导致发布失败**，除非该 CVE 已连同书面理由列入 `.github/trivy-allowlist`（每个条目每季度重新评估，一旦上游发布补丁便立即移除）。

同样的两步每天会针对实际已发布的 `:latest` manifest 重新运行；已发布镜像上出现可修复的 HIGH 或 CRITICAL 发现时，会触发针对最新 Alpine 仓库的重建。HIGH 级别的发现目前仍只观察不拦截：基础镜像基于 alpine（`python:3.12-alpine`、`postgres:18-alpine`、`nginx:alpine`），经常带有针对 musl-libc 和 apk 传递依赖的基线发现，这些路径 Turbo EA 的代码根本不会触及，但 Trivy 仍会报告。

**对运维人员：** 门禁保护的是已发布的镜像，但仍请对拉取到的镜像运行您自己的扫描器——您的策略可能与我们的不同。已发布的 SBOM 是一份干净的输入。

**对贡献者：** 如果您发现某个发现在 Turbo EA 的使用路径中确实可被利用，请通过[私密安全通告](https://github.com/vincentmakes/turbo-ea/security/advisories/new)报告，而不要在公开 issue 中评论。参见 [`SECURITY.md`](https://github.com/vincentmakes/turbo-ea/blob/main/SECURITY.md)。

---

## Action 的 SHA 固定

发布工作流使用的每个 GitHub Action 都固定到 40 位的提交 SHA，而不是浮动的主版本标签。这意味着上游维护者被入侵或出现拼写抢注时，都无法在本仓库没有可见 diff 的情况下悄悄改变我们 CI 中运行的内容。更新通过 Dependabot 的 `github-actions` 生态每月推送，因此刷新仍会发生——只是要经过审查。
