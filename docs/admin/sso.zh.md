# 身份验证与 SSO

![身份验证与 SSO 设置](../assets/img/en/25_admin_settings_auth.png)

设置中的**身份验证**标签页允许管理员配置用户登录平台的方式。

#### 自助注册

- **允许自助注册**：启用后，新用户可以通过点击登录页面上的「注册」创建账户。禁用后，只有管理员可以通过邀请用户流程创建账户。

#### SSO（单点登录）配置

SSO 允许用户使用企业身份提供商登录，而不是本地密码。Turbo EA 支持四种 SSO 提供商：

| 提供商 | 描述 |
|--------|------|
| **Microsoft Entra ID** | 适用于使用 Microsoft 365 / Azure AD 的组织 |
| **Google Workspace** | 适用于使用 Google Workspace 的组织 |
| **Okta** | 适用于使用 Okta 作为身份平台的组织 |
| **通用 OIDC** | 适用于任何兼容 OpenID Connect 的提供商（例如 Authentik、Keycloak、Auth0） |

**配置 SSO 的步骤：**

1. 前往**管理 > 设置 > 身份验证**
2. 将**启用 SSO**切换为开启
3. 从下拉菜单中选择您的 **SSO 提供商**
4. 输入身份提供商提供的所需凭据：
   - **客户端 ID**：来自身份提供商的应用程序/客户端 ID
   - **客户端密钥**：应用程序密钥（在数据库中加密存储）
   - 特定于提供商的字段：
     - **Microsoft**：租户 ID（例如 `your-tenant-id` 或 `common` 用于多租户）
     - **Google**：托管域名（可选，限制登录到特定 Google Workspace 域名）
     - **Okta**：Okta 域名（例如 `your-org.okta.com`）
     - **通用 OIDC**：发行者 URL（例如 `https://auth.example.com/application/o/my-app/`）。对于通用 OIDC，系统会尝试通过 `.well-known/openid-configuration` 端点进行自动发现
5. 点击**保存**

**手动 OIDC 端点（高级）：**

如果后端无法访问身份提供商的发现文档（例如由于 Docker 网络或自签名证书），您可以手动指定 OIDC 端点：

- **授权端点**：用户被重定向进行身份验证的 URL
- **令牌端点**：用于交换授权码获取令牌的 URL
- **JWKS URI**：用于验证令牌签名的 JSON Web Key Set URL

这些字段是可选的。如果留空，系统使用自动发现。填写后，它们将覆盖自动发现的值。

**测试 SSO：**

保存后，打开新的浏览器标签页（或无痕窗口），验证 SSO 登录按钮是否出现在登录页面上，以及身份验证是否端到端正常工作。

**重要注意事项：**
- **客户端密钥**在数据库中加密存储，永远不会在 API 响应中暴露
- 启用 SSO 后，本地密码登录仍然可用作备用方案
- 您可以在身份提供商中将重定向 URI 配置为：`https://your-turbo-ea-domain/auth/callback`
