# Integracao MCP (acesso para ferramentas de IA)

O Turbo EA inclui um **servidor MCP** (Model Context Protocol) integrado que permite que ferramentas de IA — como Claude Desktop, GitHub Copilot, Cursor e VS Code — consultem seus dados de EA diretamente. Os usuarios se autenticam atraves do provedor SSO existente, e cada consulta respeita suas permissoes individuais.

Este recurso e **opcional** e **nao inicia automaticamente**. Requer que o SSO esteja configurado, que o perfil MCP esteja ativado no Docker Compose e que um administrador o ative na interface de configuracoes.

---

## Como funciona

```
Ferramenta de IA (Claude, Copilot, etc.)
    │
    │  Protocolo MCP (HTTP + SSE)
    ▼
Servidor MCP do Turbo EA (:8001, interno)
    │
    │  OAuth 2.1 com PKCE
    │  delega ao provedor SSO
    ▼
Backend do Turbo EA (:8000)
    │
    │  RBAC por usuario
    ▼
PostgreSQL
```

1. Um usuario adiciona a URL do servidor MCP a sua ferramenta de IA.
2. Na primeira conexao, a ferramenta abre uma janela do navegador para autenticacao SSO.
3. Apos o login, o servidor MCP emite seu proprio token de acesso (respaldado pelo JWT do Turbo EA do usuario).
4. A ferramenta de IA usa este token para todas as solicitacoes subsequentes. Os tokens se renovam automaticamente.
5. Cada consulta passa pelo sistema de permissoes normal do Turbo EA — os usuarios so veem os dados aos quais tem acesso.

---

## Pre-requisitos

Antes de habilitar o MCP, voce deve ter:

- **SSO configurado e funcionando** — O MCP delega a autenticacao ao seu provedor SSO (Microsoft Entra ID, Google Workspace, Okta ou OIDC generico). Consulte o guia de [Autenticacao e SSO](sso.md).
- **HTTPS com um dominio publico** — O fluxo OAuth requer uma URI de redirecionamento estavel. Implante atras de um proxy reverso com terminacao TLS (Caddy, Traefik, Cloudflare Tunnel, etc.).

---

## Configuracao

### Passo 1: Iniciar o servico MCP

O servidor MCP e um perfil opcional do Docker Compose. Adicione `--profile mcp` ao seu comando de inicializacao:

```bash
docker compose --profile mcp up --build -d
```

Isso inicia um container Python leve (porta 8001, apenas interno) junto ao backend e frontend. O Nginx redireciona automaticamente as solicitacoes `/mcp/` para ele.

### Passo 2: Configurar variaveis de ambiente

Adicione estas ao seu arquivo `.env`:

```dotenv
TURBO_EA_PUBLIC_URL=https://seu-dominio.exemplo.com
MCP_PUBLIC_URL=https://seu-dominio.exemplo.com/mcp
```

| Variavel | Padrao | Descricao |
|----------|--------|-----------|
| `TURBO_EA_PUBLIC_URL` | `http://localhost:8920` | A URL publica da sua instancia Turbo EA |
| `MCP_PUBLIC_URL` | `http://localhost:8920/mcp` | A URL publica do servidor MCP (usada nas URIs de redirecionamento OAuth) |
| `MCP_PORT` | `8001` | Porta interna do container MCP (raramente precisa de alteracao) |

### Passo 3: Adicionar a URI de redirecionamento OAuth ao seu aplicativo SSO

No registro de aplicativo do seu provedor SSO (o mesmo que voce configurou para o login do Turbo EA), adicione esta URI de redirecionamento:

```
https://seu-dominio.exemplo.com/mcp/oauth/callback
```

Isso e necessario para o fluxo OAuth que autentica os usuarios quando se conectam a partir da ferramenta de IA.

### Passo 4: Habilitar MCP nas configuracoes de administracao

1. Va para **Configuracoes** na area de administracao e selecione a aba **AI**.
2. Role ate a secao **Integracao MCP (Acesso a ferramentas IA)**.
3. Ative o interruptor para **habilitar** o MCP.
4. A interface mostrara a URL do servidor MCP e instrucoes de configuracao para compartilhar com sua equipe.

!!! warning
    O interruptor fica desabilitado se o SSO nao estiver configurado. Configure o SSO primeiro.

---

## Conectar ferramentas de IA

Uma vez habilitado o MCP, compartilhe a **URL do servidor MCP** com sua equipe. Cada usuario a adiciona a sua ferramenta de IA:

### Claude Desktop

1. Abra **Configuracoes > Conectores > Adicionar conector personalizado**.
2. Insira a URL do servidor MCP: `https://seu-dominio.exemplo.com/mcp`
3. Clique em **Conectar** — uma janela do navegador abre para o login SSO.
4. Apos a autenticacao, o Claude pode consultar seus dados de EA.

### VS Code (GitHub Copilot / Cursor)

Adicione ao `.vscode/mcp.json` do seu workspace:

```json
{
  "servers": {
    "turbo-ea": {
      "type": "http",
      "url": "https://seu-dominio.exemplo.com/mcp/mcp"
    }
  }
}
```

O duplo `/mcp/mcp` e intencional — o primeiro `/mcp/` e o caminho do proxy Nginx, o segundo e o endpoint do protocolo MCP.

---

## Teste local (modo stdio)

Para desenvolvimento local ou testes sem SSO/HTTPS, voce pode executar o servidor MCP em **modo stdio** — o Claude Desktop o inicia diretamente como processo local.

**1. Instalar o pacote do servidor MCP:**

```bash
pip install ./mcp-server
```

**2. Adicionar a configuracao do Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "turbo-ea": {
      "command": "python",
      "args": ["-m", "turbo_ea_mcp", "--stdio"],
      "env": {
        "TURBO_EA_URL": "http://localhost:8000",
        "TURBO_EA_EMAIL": "seu@email.com",
        "TURBO_EA_PASSWORD": "sua-senha"
      }
    }
  }
}
```

Neste modo, o servidor se autentica com email/senha e renova o token automaticamente em segundo plano.

---

## Capacidades disponiveis

O servidor MCP fornece acesso **somente leitura** aos dados de EA. Ele nao pode criar, modificar ou excluir nada.

### Ferramentas

| Ferramenta | Descricao |
|------------|-----------|
| `search_cards` | Pesquisar e filtrar cards por tipo, status ou texto livre |
| `get_card` | Obter detalhes completos de um card por UUID |
| `get_card_relations` | Obter todas as relacoes conectadas a um card |
| `get_card_hierarchy` | Obter ancestrais e filhos de um card |
| `list_card_types` | Listar todos os tipos de card no metamodelo |
| `get_relation_types` | Listar tipos de relacao, opcionalmente filtrados por tipo de card |
| `get_dashboard` | Obter dados do painel de KPIs (contagens, qualidade de dados, aprovacoes) |
| `get_landscape` | Obter cards agrupados por um tipo relacionado |

### Recursos

| URI | Descricao |
|-----|-----------|
| `turbo-ea://types` | Todos os tipos de card no metamodelo |
| `turbo-ea://relation-types` | Todos os tipos de relacao |
| `turbo-ea://dashboard` | KPIs do painel e estatisticas resumidas |

### Prompts guiados

| Prompt | Descricao |
|--------|-----------|
| `analyze_landscape` | Analise em varias etapas: visao geral do painel, tipos, relacoes |
| `find_card` | Pesquisar um card por nome, obter detalhes e relacoes |
| `explore_dependencies` | Mapear as dependencias de um card |

---

## Permissoes

| Papel | Acesso |
|-------|--------|
| **Administrador** | Configurar ajustes MCP (permissao `admin.mcp`) |
| **Todos os usuarios autenticados** | Consultar dados de EA atraves do servidor MCP (respeita suas permissoes existentes no nivel de card e aplicacao) |

A permissao `admin.mcp` controla quem pode gerenciar as configuracoes de MCP. Esta disponivel apenas para o papel de Administrador por padrao. Papeis personalizados podem receber esta permissao atraves da pagina de administracao de Papeis.

O acesso a dados atraves do MCP segue o mesmo modelo RBAC da interface web — nao ha permissoes de dados especificas do MCP.

---

## Seguranca

- **Autenticacao delegada por SSO**: Os usuarios se autenticam atraves do provedor SSO corporativo. O servidor MCP nunca ve ou armazena senhas.
- **OAuth 2.1 com PKCE**: O fluxo de autenticacao utiliza Proof Key for Code Exchange (S256) para prevenir a interceptacao de codigos de autorizacao.
- **RBAC por usuario**: Cada consulta MCP e executada com as permissoes do usuario autenticado. Sem contas de servico compartilhadas.
- **Acesso somente leitura**: O servidor MCP so pode ler dados. Nao pode criar, atualizar ou excluir cards, relacoes ou quaisquer outros recursos.
- **Rotacao de tokens**: Tokens de acesso expiram apos 1 hora. Tokens de renovacao duram 30 dias. Codigos de autorizacao sao de uso unico e expiram apos 10 minutos.
- **Porta apenas interna**: O container MCP expoe a porta 8001 apenas na rede Docker interna. Todo acesso externo passa pelo proxy reverso Nginx.

---

## Solucao de problemas

| Problema | Solucao |
|----------|---------|
| O interruptor MCP esta desabilitado nas configuracoes | O SSO deve ser configurado primeiro. Va para Configuracoes > aba Autenticacao e configure um provedor SSO. |
| «host not found» nos logs do Nginx | O servico MCP nao esta em execucao. Inicie-o com `docker compose --profile mcp up -d`. A configuracao do Nginx lida com isso de forma elegante (resposta 502, sem queda). |
| O callback OAuth falha | Verifique se adicionou `https://seu-dominio.exemplo.com/mcp/oauth/callback` como URI de redirecionamento no registro do aplicativo SSO. |
| A ferramenta de IA nao consegue conectar | Verifique se `MCP_PUBLIC_URL` corresponde a URL acessivel a partir da maquina do usuario. Certifique-se de que o HTTPS esta funcionando. |
| O usuario obtem resultados vazios | O MCP respeita as permissoes RBAC. Se um usuario tem acesso restrito, vera apenas os cards que seu papel permite. |
| A conexao cai apos 1 hora | A ferramenta de IA deveria lidar com a renovacao de tokens automaticamente. Caso contrario, reconecte. |
