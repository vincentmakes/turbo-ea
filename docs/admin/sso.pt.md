# Autenticação e SSO

![Configurações de Autenticação e SSO](../assets/img/pt/25_admin_config_autenticacao.png)

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

**Mapeamento de papéis:**

Por predefinição, cada novo utilizador SSO chega com o papel predefinido (ou o do seu convite) e um administrador altera-o à mão em **Administração → Utilizadores**. Se o seu fornecedor de identidade já sabe quem deve ser administrador, membro ou leitor — através da pertença a grupos ou de papéis de aplicação —, o Turbo EA pode lê-lo no token de ID e atribuir o papel por si em cada início de sessão. O bloco **Mapeamento de papéis** fica na secção SSO, abaixo dos campos do fornecedor, e é guardado com o mesmo botão **Salvar**. Como o mapeamento atribui papéis, alterar o nome da declaração ou as linhas do mapeamento requer a permissão para gerir utilizadores, além da permissão para gerir as definições; sem ela, o bloco é só de leitura e apenas os âmbitos adicionais podem ser alterados.

- **Nome da declaração**: a declaração (claim) do token de ID que lista os grupos ou papéis do utilizador, por exemplo `roles` (papéis de aplicação do Microsoft Entra), `groups` (Okta, Keycloak) ou `cognito:groups` (Amazon Cognito). Um nome de declaração é obrigatório enquanto o mapeamento tiver linhas. Para desativar o mapeamento de papéis, remova todas as linhas: os papéis passam então a ser inteiramente manuais.
- **Linhas de mapeamento**: cada linha associa um **valor do diretório** (um valor de grupo ou de papel de aplicação tal como a declaração o transporta) a um papel do Turbo EA. Use as setas para ordenar as linhas; prevalece a primeira linha correspondente.
- **Âmbitos adicionais**: âmbitos (scopes) separados por espaços pedidos no início de sessão além de `openid email profile` — por exemplo `groups` para Okta. São pedidos tanto quando o utilizador é enviado para o fornecedor de identidade como quando o código de início de sessão é trocado pelo token de ID. O início de sessão do servidor MCP pede os mesmos âmbitos. Nunca são enviados à Google, que recusa os âmbitos que não conhece.

As regras, todas escolhidas para que um erro de configuração não o possa bloquear:

- **O mapeamento é aplicado em cada início de sessão**, não apenas na criação da conta. Substitui um papel alterado à mão, pelo que remover alguém de um grupo do diretório produz efeito no seu início de sessão seguinte.
- **Prevalece a primeira linha correspondente**, pela ordem das linhas e não pela ordem em que o fornecedor de identidade lista os valores. A correspondência ignora maiúsculas e minúsculas.
- **Um valor da declaração que não corresponda a nenhuma linha** dá o papel predefinido.
- **Um token sem a declaração, ou com a declaração vazia**, deixa inalterado o papel atual do utilizador. Um nome de declaração mal escrito, ou um fornecedor que deixou de enviar a declaração, não pode por isso despromover todos os utilizadores de uma só vez.
- **Uma linha cujo papel não existe ou foi arquivado** dá o papel predefinido. A página de definições assinala essa linha para que possa escolher um papel ativo.
- **O último administrador ativo nunca é despromovido.** Se o mapeamento retirasse o papel de administrador ao único administrador ativo, este mantém-no e o registo de Segurança e administração anota que o papel foi mantido.
- **Enquanto houver um mapeamento definido, o papel dos utilizadores SSO fica bloqueado em Administração → Utilizadores** (o seletor de papel está desativado, com uma indicação; uma alteração de papel em massa ignora essas contas e uma importação de Excel deixa o seu papel como está, e ambas o indicam). Altere antes o papel no diretório, ou passe a conta para início de sessão local para a gerir à mão. As contas locais nunca são afetadas.

Notas por fornecedor de identidade:

| Fornecedor | O que configurar |
|------------|------------------|
| **Microsoft Entra ID** | Prefira os **papéis de aplicação**: declare-os no registo da aplicação, atribua-lhes utilizadores ou grupos e use a declaração `roles`. O mapeamento de papéis requer um **ID de inquilino específico**: com `organizations`, `common` ou `consumers` qualquer inquilino da Microsoft pode iniciar sessão e não é possível guardar um mapeamento. A declaração `groups` contém os ID de objeto dos grupos, não os nomes, e o Entra omite-a por completo do token para um utilizador em mais de 200 grupos. |
| **Okta** | Adicione uma declaração de grupos ao token de ID no servidor de autorização (ou nas definições de início de sessão da aplicação) e adicione `groups` em **Âmbitos adicionais**. Use o nome de declaração que lhe deu, normalmente `groups`. |
| **Keycloak** (Generic OIDC) | Adicione ao cliente um mapeador **Group Membership**, com o nome de declaração do token `groups` e **Add to ID token** ativado, para que uma declaração `groups` de nível superior chegue ao token de ID (desative **Full group path** para obter nomes de grupo simples). As declarações aninhadas como `realm_access.roles` não são lidas. |
| **Amazon Cognito** (Generic OIDC) | Use a declaração `cognito:groups`. |
| **Google Workspace** | Indisponível: os tokens de ID do Google não incluem uma declaração de grupos, pelo que o bloco fica oculto para o Google. |

!!! warning "Limites a ter em conta"
    - **Mapeie papéis de aplicação ou ID de grupo, não nomes de apresentação que os utilizadores possam criar eles próprios.** Se qualquer pessoa puder criar um grupo chamado `ea-admins`, qualquer pessoa pode tornar-se administrador.
    - **A declaração tem de estar presente no token de ID.** O Turbo EA lê apenas o token de ID — não o endpoint userinfo nem uma API de diretório. Alguns fornecedores de identidade precisam tanto do âmbito em **Âmbitos adicionais** como de uma configuração da declaração para que os grupos apareçam no token de ID; inicie sessão uma vez e verifique o resultado antes de contar com ele.
    - **Uma alteração no diretório produz efeito no início de sessão seguinte do utilizador**, não numa sessão já aberta.
    - **O papel de um convite é substituído no primeiro início de sessão** quando o mapeamento atribui um.
    - **Um utilizador cujo token nunca traz a declaração mantém o seu papel atual**, e enquanto houver um mapeamento definido ninguém o pode alterar em Administração → Utilizadores. Corrija a declaração no fornecedor de identidade, ou passe a conta para início de sessão local.
    - **Uma declaração vazia conta como ausente**: remover alguém de todos os grupos mapeados não o despromove. Retire antes o seu acesso à aplicação no fornecedor de identidade.

#### Autenticação por proxy reverso

Se o Turbo EA roda atrás de um proxy que já autentica seus usuários — a autenticação integrada do Azure App Service ("EasyAuth"), oauth2-proxy, Authelia, Cloudflare Access — ele pode aceitar essa identidade diretamente em vez de executar seu próprio SSO por cima. Sem cliente OIDC, sem registro de aplicação, sem client secret. Os usuários chegam ao Turbo EA já autenticados.

Este recurso é configurado inteiramente por variáveis de ambiente e está **desativado por padrão**.

**Antes de qualquer outra coisa, defina o administrador de bootstrap.** O auto-registro fica fechado enquanto a autenticação por proxy está ativa, então é assim que o primeiro administrador entra — esse e-mail recebe o papel de admin no primeiro login:

```
TURBO_EA_PROXY_AUTH_BOOTSTRAP_ADMIN_EMAIL=you@yourcompany.com
```

**Azure App Service (EasyAuth) — configuração recomendada.** O Turbo EA verifica o token de identidade assinado que o Azure encaminha com cada requisição (isso requer o token store do App Service, que vem ativado por padrão). `AUDIENCE` é o client ID do registro de aplicação do seu EasyAuth; substitua `TENANT` pelo ID do seu diretório (tenant):

```
TURBO_EA_PROXY_AUTH_ENABLED=true
TURBO_EA_PROXY_AUTH_TRUST_PLATFORM_HEADERS=true
TURBO_EA_PROXY_AUTH_VERIFY_ID_TOKEN=true
TURBO_EA_PROXY_AUTH_ISSUER=https://login.microsoftonline.com/TENANT/v2.0
TURBO_EA_PROXY_AUTH_AUDIENCE=your-easyauth-app-client-id
TURBO_EA_PROXY_AUTH_JWKS_URI=https://login.microsoftonline.com/TENANT/discovery/v2.0/keys
TURBO_EA_PROXY_AUTH_ALLOWED_DOMAINS=yourcompany.com
TURBO_EA_PROXY_AUTH_LOGOUT_URL=/.auth/logout
```

!!! warning "`TRUST_PLATFORM_HEADERS` é obrigatório no App Service"
    O App Service não consegue injetar um cabeçalho secreto próprio, por isso
    `TURBO_EA_PROXY_AUTH_TRUST_PLATFORM_HEADERS=true` ocupa o lugar de
    `TURBO_EA_PROXY_AUTH_SHARED_SECRET` — é um reconhecimento explícito de que
    você depende de o Azure remover os cabeçalhos de identidade de entrada antes
    que cheguem à sua aplicação. A verificação ocorre **antes** mesmo de o token
    de identidade ser analisado, portanto verificar o token não a substitui. Se
    faltarem tanto esta definição como um segredo partilhado, cada início de
    sessão falha com *Proxy authentication is enabled but not secured*, mesmo com
    `VERIFY_ID_TOKEN=true`.

Se o seu token store estiver desativado, defina adicionalmente `TURBO_EA_PROXY_AUTH_VERIFY_ID_TOKEN=false` e confie apenas na sanitização dos cabeçalhos. Sem um token verificado **novas contas não são criadas automaticamente** — convide os usuários primeiro, ou use o e-mail do administrador de bootstrap.

**Proxy genérico (oauth2-proxy, Authelia, Traefik forwardAuth, …).** Configure o proxy para injetar um cabeçalho com um segredo compartilhado em cada requisição, de modo que uma requisição que não passou pelo proxy nunca possa ser confundida com uma que passou. Gere o valor com `openssl rand -hex 32`:

```
TURBO_EA_PROXY_AUTH_ENABLED=true
TURBO_EA_PROXY_AUTH_MODE=header
TURBO_EA_PROXY_AUTH_SHARED_SECRET=<valor gerado, também definido no proxy>
TURBO_EA_PROXY_AUTH_EMAIL_HEADER=X-Forwarded-Email
TURBO_EA_PROXY_AUTH_ALLOWED_DOMAINS=yourcompany.com
TURBO_EA_PROXY_AUTH_LOGOUT_URL=/oauth2/sign_out
```

**Notas de segurança:**

- O segredo compartilhado (ou, no Azure, o token de identidade verificado) é o que torna a identidade confiável — um cabeçalho sozinho pode ser escrito por qualquer um. A lista de domínios permitidos é obrigatória; defina `TURBO_EA_PROXY_AUTH_ALLOW_ANY_DOMAIN=true` apenas se você realmente aceitar qualquer domínio de e-mail.
- Uma identidade que não foi verificada criptograficamente pode autenticar usuários existentes, mas nunca cria uma nova conta, e convites pendentes não conferem seu papel por esse caminho.
- `TURBO_EA_PROXY_AUTH_LOGOUT_URL` é para onde o Turbo EA envia o navegador após **Sair**, para que a sessão do proxy também seja encerrada. Sem ele, o proxy ainda considera o usuário autenticado — ele volta para a página de login e pode entrar de novo com um clique.

**Tamanho dos cabeçalhos do pedido.** Um proxy de início de sessão acrescenta cookies e cabeçalhos de token a cada pedido. Os pedidos mais longos do Turbo EA levam no URL uma lista de IDs de cards — uma linha de pedido de quase 8 KB —, pelo que cada salto entre o navegador e o Turbo EA tem de aceitar uma linha de pedido de 8 KB juntamente com esses cabeçalhos. O nginx de borda incluído aceita (16 KB por linha de cabeçalho desde a versão 2.217.1). Se executar também o seu próprio nginx ou ingress-nginx à frente, dê-lhe a mesma margem: `large_client_header_buffers 4 16k;`, ou `large-client-header-buffers: "4 16k"` no ConfigMap do ingress-nginx. Um salto demasiado pequeno responde `400 Request Header Or Cookie Too Large` ou `414` nas exportações do Inventário e nos diagramas grandes, enquanto tudo o resto funciona.

**Mapeamento de funções (opcional).** Por predefinição, todos aterram na função predefinida configurada e um administrador promove a partir daí. Se o seu fornecedor de identidade já sabe a resposta — um registo de aplicação Entra que declara as suas próprias funções de aplicação, um oauth2-proxy que reencaminha a pertença a grupos — o Turbo EA pode lê-la e atribuir a função por si:

```
TURBO_EA_PROXY_AUTH_ROLE_CLAIM=roles
TURBO_EA_PROXY_AUTH_ROLE_MAP=ADMIN:admin,MANAGER:member,READ-ONLY:viewer
```

Cada par escreve-se `VALOR_DIRETÓRIO:chave-de-função-turbo-ea`. Quando um utilizador detém várias funções de diretório, **ganha a primeira entrada do mapeamento** — a ordem do mapeamento, e não a ordem pela qual o fornecedor as enviou, porque os dois formatos de identidade do Azure não concordam nisso. A correspondência ignora maiúsculas e minúsculas do lado do diretório. No modo de proxy genérico, o mesmo mapeamento lê um cabeçalho separado por vírgulas em vez de uma reivindicação: `TURBO_EA_PROXY_AUTH_ROLE_HEADER=X-Forwarded-Groups`.

!!! warning "O mapeamento é autoritativo em cada início de sessão"
    Não apenas na criação da conta — retirar a função de diretório de alguém tem de produzir efeito. Enquanto o mapa estiver em vigor, o papel de uma conta que inicia sessão através do proxy fica por isso **bloqueado em Administração → Utilizadores**: o seletor de papel está desativado com uma indicação, uma alteração de papel em massa ignora a conta e uma importação de Excel deixa o seu papel como está, em vez de deixar que uma alteração feita à mão seja substituída silenciosamente no início de sessão seguinte. Deixe `TURBO_EA_PROXY_AUTH_ROLE_MAP` por definir e nada muda: as funções continuam inteiramente manuais.

Os casos limite, todos escolhidos para que um erro de configuração não o possa deixar de fora:

- **`TURBO_EA_PROXY_AUTH_BOOTSTRAP_ADMIN_EMAIL` ganha sempre** ao mapeamento. Se os dois discordarem, esse endereço é administrador.
- **Um valor que não corresponde a nada no mapeamento** — ou que nomeia uma função Turbo EA inexistente ou arquivada — recai na função predefinida.
- **O último administrador ativo nunca é despromovido.** Se o mapa retirasse o papel de administrador ao único administrador ativo, este mantém-no e o registo de Segurança e administração anota que o papel foi mantido.
- **Uma reivindicação totalmente ausente** deixa intacta a função atual do utilizador. Isto é deliberadamente diferente do caso anterior: um `ROLE_CLAIM` mal escrito, ou um arquivo de tokens que deixa de reencaminhar, despromoveria de outro modo todos os utilizadores da instância de uma só vez.
- **A identidade tem de merecer que lhe sejam confiadas permissões.** O mapeamento de funções aplica-se quando o token de identidade foi verificado (`TURBO_EA_PROXY_AUTH_VERIFY_ID_TOKEN=true`) ou existe um segredo partilhado configurado. No App Service com o arquivo de tokens desativado e sem segredo, o mapeamento é ignorado e é escrita uma linha no registo a dizê-lo — o mesmo raciocínio que impede um cabeçalho não verificado de criar uma conta.

**Todas as variáveis:**

| Variável | Padrão | Finalidade |
|----------|---------|---------|
| `TURBO_EA_PROXY_AUTH_ENABLED` | `false` | Chave mestra |
| `TURBO_EA_PROXY_AUTH_MODE` | `azure_easyauth` | `azure_easyauth` ou `header` |
| `TURBO_EA_PROXY_AUTH_SHARED_SECRET` | — | Obrigatório no modo `header`; o proxy o injeta |
| `TURBO_EA_PROXY_AUTH_SECRET_HEADER` | `X-Turbo-EA-Proxy-Secret` | Cabeçalho que carrega o segredo compartilhado |
| `TURBO_EA_PROXY_AUTH_VERIFY_ID_TOKEN` | `false` | Verifica o token de identidade encaminhado (modo Azure) |
| `TURBO_EA_PROXY_AUTH_ISSUER` / `_AUDIENCE` / `_JWKS_URI` | — | Configurações de verificação do token |
| `TURBO_EA_PROXY_AUTH_TRUST_PLATFORM_HEADERS` | `false` | Somente Azure: confiar na sanitização de cabeçalhos da plataforma em vez de um segredo. Obrigatório no App Service |
| `TURBO_EA_PROXY_AUTH_EMAIL_HEADER` | `X-Forwarded-Email` | Modo `header`: cabeçalho do e-mail |
| `TURBO_EA_PROXY_AUTH_NAME_HEADER` | `X-Forwarded-User` | Modo `header`: cabeçalho do nome de exibição |
| `TURBO_EA_PROXY_AUTH_SUBJECT_HEADER` | `X-Forwarded-Subject` | Modo `header`: cabeçalho do identificador estável do sujeito |
| `TURBO_EA_PROXY_AUTH_ALLOWED_DOMAINS` | — | Domínios de e-mail permitidos, separados por vírgula (obrigatório) |
| `TURBO_EA_PROXY_AUTH_ALLOW_ANY_DOMAIN` | `false` | Aceita explicitamente qualquer domínio de e-mail |
| `TURBO_EA_PROXY_AUTH_BOOTSTRAP_ADMIN_EMAIL` | — | Recebe o papel de admin no primeiro login |
| `TURBO_EA_PROXY_AUTH_ROLE_MAP` | — | `VALOR_DIRETÓRIO:chave-de-função,…` — vazio significa que as funções continuam manuais |
| `TURBO_EA_PROXY_AUTH_ROLE_CLAIM` | `roles` | Reivindicação que transporta a função do diretório (modo Azure) |
| `TURBO_EA_PROXY_AUTH_ROLE_HEADER` | `X-Forwarded-Groups` | Modo `header`: cabeçalho de funções separadas por vírgulas |
| `TURBO_EA_PROXY_AUTH_LOGOUT_URL` | — | Para onde Sair envia o navegador |

**Limitações:** o fluxo OAuth do servidor MCP requer que o SSO regular esteja configurado; a autenticação por proxy sozinha não o cobre.
