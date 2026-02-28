# Autenticação e SSO

![Configurações de Autenticação e SSO](../assets/img/en/25_admin_settings_auth.png)

A aba de **Autenticação** em Configurações permite que administradores configurem como os usuários fazem login na plataforma.

#### Auto-registro

- **Permitir auto-registro**: Quando habilitado, novos usuários podem criar contas clicando em "Cadastrar-se" na página de login. Quando desabilitado, apenas administradores podem criar contas pelo fluxo de Convidar Usuário.

#### Configuração de SSO (Single Sign-On)

SSO permite que usuários façam login usando seu provedor de identidade corporativo em vez de uma senha local. O Turbo EA suporta quatro provedores SSO:

| Provedor | Descrição |
|----------|-----------|
| **Microsoft Entra ID** | Para organizações que usam Microsoft 365 / Azure AD |
| **Google Workspace** | Para organizações que usam Google Workspace |
| **Okta** | Para organizações que usam Okta como plataforma de identidade |
| **OIDC Genérico** | Para qualquer provedor compatível com OpenID Connect (ex.: Authentik, Keycloak, Auth0) |

**Passos para configurar SSO:**

1. Vá para **Admin > Configurações > Autenticação**
2. Alterne **Habilitar SSO** para ligado
3. Selecione seu **Provedor SSO** no dropdown
4. Insira as credenciais necessárias do seu provedor de identidade:
   - **Client ID**: O ID de aplicação/cliente do seu provedor de identidade
   - **Client Secret**: O segredo da aplicação (armazenado criptografado no banco de dados)
   - Campos específicos do provedor:
     - **Microsoft**: Tenant ID (ex.: `your-tenant-id` ou `common` para multi-tenant)
     - **Google**: Hosted Domain (opcional, restringe o login a um domínio específico do Google Workspace)
     - **Okta**: Okta Domain (ex.: `your-org.okta.com`)
     - **OIDC Genérico**: Issuer URL (ex.: `https://auth.example.com/application/o/my-app/`). Para OIDC Genérico, o sistema tenta auto-descoberta via o endpoint `.well-known/openid-configuration`
5. Clique em **Salvar**

**Endpoints OIDC Manuais (Avançado):**

Se o backend não conseguir acessar o documento de descoberta do seu provedor de identidade (ex.: devido à rede Docker ou certificados autoassinados), você pode especificar manualmente os endpoints OIDC:

- **Authorization Endpoint**: A URL para onde os usuários são redirecionados para autenticar
- **Token Endpoint**: A URL usada para trocar o código de autorização por tokens
- **JWKS URI**: A URL para o JSON Web Key Set usado para verificar assinaturas de tokens

Esses campos são opcionais. Se deixados em branco, o sistema usa auto-descoberta. Quando preenchidos, eles sobrescrevem os valores auto-descobertos.

**Testando SSO:**

Após salvar, abra uma nova aba do navegador (ou janela anônima) e verifique se o botão de login SSO aparece na página de login e se a autenticação funciona de ponta a ponta.

**Notas importantes:**
- O **Client Secret** é armazenado criptografado no banco de dados e nunca exposto em respostas da API
- Quando SSO está habilitado, o login com senha local permanece disponível como alternativa
- Você pode configurar a URI de redirecionamento no seu provedor de identidade como: `https://your-turbo-ea-domain/auth/callback`
