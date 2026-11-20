# 发布与预发布渠道

介绍 Turbo EA 如何管理版本、标签和容器镜像发布。本页供需要在生产环境固定版本的运维人员以及准备发布的贡献者参考。

---

## 版本管理

Turbo EA 遵循 [Semantic Versioning](https://semver.org/)。当前版本的唯一事实来源是仓库根目录下的 `/VERSION` 文件。

- **Patch**（例如 `1.0.0` → `1.0.1`）：仅修复缺陷。升级始终安全。
- **Minor**（例如 `1.0.0` → `1.1.0`）：新增功能。根据[兼容性政策](compatibility.md)保持向后兼容。
- **Major**（例如 `1.x` → `2.0.0`）：包含破坏性变更。发布时附带迁移说明。

每个 PR 只提升一次版本，而不是每个 commit 一次。PR 的 CHANGELOG 条目以新版本为标题；如果提升了 `/VERSION`，但 `CHANGELOG.md` 中没有对应的 `## [<version>]` 标题，CI 的 [`version-check.yml`](https://github.com/TommasoChi/turbo-ea/blob/main/.github/workflows/version-check.yml) 就会失败。

---

## 容器镜像标签

每次推送到 `main` 以及每个 `v*.*.*` 标签都会触发 `.github/workflows/docker-publish.yml`，构建并将多架构（`amd64` + `arm64`）镜像推送到 GHCR。

对于 `v1.2.3` 这样的发布标签，每个镜像发布的标签如下：

| 标签            | 指向                         | 稳定？                              |
|-----------------|------------------------------|------------------------------------|
| `1.2.3`         | 正好是该版本                 | 是 — 在生产环境固定此标签          |
| `1.2`            | `1.2.x` 中最新的补丁版本     | 随补丁版本向前滚动                 |
| `1`              | `1.x` 中最新的次版本         | 随次版本向前滚动                   |
| `latest`         | 最新的非预发布版本           | 每次发布都会向前滚动               |
| `sha-<short>`    | 精确的 commit                | 是 — 调试 / 预发布                 |

推送到 `main`（没有标签）时，只会生成 `main` 和 `sha-<short>` 标签，不会生成 `latest` 或任何 semver 标签。

所有已发布镜像清单均使用 Cosign 通过无密钥 OIDC 签名。验证和 SBOM 详情请参阅 [Supply Chain](../admin/supply-chain.md)。

---

## 预发布渠道

对于会改变容器布局、基础镜像、默认 UID、卷名称、默认端口或需要运维人员采取行动的架构变更的次版本，最终标签发布前会先创建一个**候选版本**。

约定：

- RC 标签格式为 `vX.Y.0-rc.N`，不会用于补丁版本，只用于包含运维人员可见变更的次版本。
- 发布工作流中的 `docker/metadata-action` 配置为 `flavor: latest=auto`。它会自动将 semver 预发布标签排除在 `:latest`、`:X.Y` 和 `:X` 之外；RC 只会以 `:X.Y.0-rc.N` 发布。固定 `:latest` 的运维人员不会意外拉取 RC。
- GitHub 会自动将带有 `vX.Y.0-rc.N` 标签的 Release 标记为预发布版本。稳定标签会创建普通 Release。

试运行期：

- RC 至少试运行 **48–72 小时**，或直到至少一位维护团队以外的运维人员反馈升级成功，以较长者为准。
- 如果 RC 的错误报告值得修复，则发布为 `vX.Y.0-rc.N+1`。之前的 RC 会保留在 GHCR 中，以便复现。

晋级为正式版本：

- 最终标签 `vX.Y.0` 指向晋级 PR 的合并提交；该 PR 在最后一个 RC 之后更新版本和变更日志。发布工作流会重新构建并重新标记多架构镜像；由于版本和构建输入发生变化，其 digest 会与 RC 不同。
- 此时，`:X.Y`、`:X` 和 `:latest` 标签会指向正式版本。

---

## 发布版本（维护者清单）

对于常规补丁或次版本，无需 RC 渠道：

1. 在功能分支上提升 `VERSION`，并在 `CHANGELOG.md` 中添加对应标题 `## [<version>] - YYYY-MM-DD`。
2. 如果后端路由或架构有变化，运行 `python scripts/dump_openapi.py`；结果发生变化时提交更新。
3. 打开 PR。CI 会运行 lint、测试、OpenAPI 差异检查和 `version-check.yml`。
4. Squash merge 到 `main`。为该提交创建标签前，对整个仓库运行 `security-audit` 和 `ponytail-audit`。阅读两份报告，解决阻止发布的安全发现以及所有 Must 和 Should 项，并确认两项审计都覆盖最终提交。在 Codex 或 Claude 聊天中，按照 `SETUP.md` 的说明记录两份已完成的报告。稳定标签和候选版本标签都必须执行此操作。
5. 在 `main` 上运行：`git tag -s v<version> -m "v<version>"`（未配置签名密钥时运行 `git tag v<version>`），然后运行 `git push origin v<version>`。
6. `Publish GitHub Release` 工作流从 `CHANGELOG.md` 提取 `## [<version>]` 部分并创建 GitHub Release。
7. `Publish Docker images to GHCR` 工作流构建、签名并发布多架构镜像。
8. 使用 Cosign 验证：
   ```bash
   cosign verify \
     --certificate-identity-regexp '^https://github\.com/TommasoChi/turbo-ea/\.github/workflows/docker-publish\.yml@refs/(heads/main|tags/v[^/]+)$' \
     --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
     ghcr.io/tommasochi/turbo-ea/backend:<version>
   ```
   需要 Cosign 2.6 或更高版本（或 3.x）——签名是 Sigstore bundle；请参阅 [Supply Chain](../admin/supply-chain.md)。

对于需要 RC 的次版本：

1. 按照上述相同的 PR 和合并流程操作，但将版本提升为 `1.Y.0-rc.1`。
2. 合并后，创建并推送 `v1.Y.0-rc.1` 标签。发布工作流会构建并推送 RC 镜像（仅 `:1.Y.0-rc.1`，不会发布 `:latest` 或短标签——由 `flavor: latest=auto` 负责）。GitHub 会自动将 Release 标记为预发布版本。
3. 等待试运行期结束。根据需要通过 `-rc.2`、`-rc.3` 等版本处理已报告的问题。
4. 晋级时，在最终 PR 中将 `VERSION` 提升为 `1.Y.0`（CHANGELOG 条目汇总所有 RC 修复），合并后，在最终提交上运行并记录两项发布审计，然后创建并推送 `v1.Y.0` 标签。此时 `:latest` 和短标签会指向晋级后的版本。

---

## 生命周期结束

只有最新的次版本系列会收到安全修复。完整政策请参阅 [`SECURITY.md`](https://github.com/vincentmakes/turbo-ea/blob/main/SECURITY.md)。较早的次版本系列已结束生命周期，不会收到向后移植的修复；使用旧版本的运维人员应按照兼容性政策规划升级。
