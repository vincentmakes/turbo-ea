# Instalação e configuração

Este guia o acompanha pela instalação do Turbo EA com Docker, configuração do ambiente, carga de dados de demonstração e início de serviços opcionais como sugestões de IA e o servidor MCP.

## Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

Cerca de 2 GB de espaço livre em disco, alguns minutos de largura de banda para o primeiro pull de imagens e as portas `8920` (HTTP) e opcionalmente `9443` (HTTPS) livres no host.

## Passo 1: Obter a configuração

Você precisa de `docker-compose.yml` e de um arquivo `.env` configurado em um diretório de trabalho. A maneira mais simples é clonar o repositório:

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
cp .env.example .env
```

Abra `.env` e defina os dois valores obrigatórios:

```dotenv
# Credenciais do PostgreSQL (usadas pelo contêiner de banco de dados integrado).
# Escolha uma senha forte — ela persiste no volume integrado.
POSTGRES_PASSWORD=choose-a-strong-password

# Chave de assinatura JWT. Gere uma com:
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=your-generated-secret
```

Todo o restante em `.env.example` tem valores padrão razoáveis.

!!! note
    O backend recusa-se a iniciar com a `SECRET_KEY` de exemplo fora do desenvolvimento. Gere uma real antes de prosseguir.

## Passo 2: Pull e arranque

A pilha integrada (Postgres + backend + frontend + nginx de borda) é executada a partir de imagens multi-arquitetura pré-compiladas no GHCR — nenhuma compilação local necessária:

```bash
docker compose pull
docker compose up -d
```

Abra **http://localhost:8920** e registre o primeiro usuário. O primeiro usuário registrado é automaticamente promovido a **Admin**.

Para alterar a porta do host, defina `HOST_PORT` em `.env` (padrão `8920`). A terminação HTTPS direta é tratada no [Passo 5](#passo-5-https-direto-opcional).

## Passo 3: Carregar dados de demonstração (opcional)

O Turbo EA pode iniciar vazio (apenas o metamodelo integrado) ou com o conjunto de dados de demonstração **NexaTech Industries**, ideal para avaliação, treinamento e exploração de recursos.

Defina o flag de seed em `.env` **antes do primeiro arranque**:

```dotenv
SEED_DEMO=true
```

Em seguida `docker compose up -d` (se já iniciou, consulte «Redefinir e re-semear» abaixo).

### Opções de carregamento

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `SEED_DEMO` | `false` | Carrega o conjunto completo NexaTech Industries, incluindo dados BPM e PPM |
| `SEED_BPM` | `false` | Carrega apenas processos BPM de demonstração (subconjunto de `SEED_DEMO`) |
| `SEED_PPM` | `false` | Carrega apenas dados de projetos PPM (subconjunto de `SEED_DEMO`) |
| `RESET_DB` | `false` | Elimina todas as tabelas e as recria a partir do zero ao iniciar |

`SEED_DEMO=true` já inclui dados BPM e PPM — não é necessário definir os flags de subconjunto separadamente.

!!! note "Os dados de demonstração são carregados uma única vez"
    Cada seeder é executado **uma vez por instalação** e regista isso. Eliminar
    conteúdo de demonstração — um diagrama de exemplo, um inquérito de
    demonstração — é definitivo: não voltará no próximo reinício, mesmo com
    `SEED_DEMO=true` ainda definido. Para recuperar o conjunto de dados de
    demonstração, reponha a base de dados (ver *Repor e recarregar* abaixo).

### Conta de administrador de demonstração

Quando os dados de demonstração são carregados, uma conta de administrador padrão é criada:

| Campo | Valor |
|-------|-------|
| **Email** | `admin@turboea.demo` |
| **Senha** | `TurboEA!2025` |
| **Função** | Admin |

!!! warning
    A conta de administrador de demonstração usa credenciais conhecidas e públicas. Altere a senha — ou crie sua própria conta de administrador e desative esta — para qualquer ambiente além da avaliação local.

### O que a demo inclui

Cerca de 150 cards distribuídos pelas quatro camadas de arquitetura, além de relações, etiquetas, comentários, tarefas, diagramas BPM, dados PPM, ADR e um Statement of Architecture Work:

- **Núcleo EA** — Organizações, ~20 Capacidades de Negócio, Contextos de Negócio, ~15 Aplicações, ~20 Componentes de TI, Interfaces, Objetos de Dados, Plataformas, Objetivos, 6 Iniciativas, 5 grupos de etiquetas, 60+ relações.
- **BPM** — ~30 processos de negócio em uma hierarquia de 4 níveis com diagramas BPMN 2.0, vínculos elemento-card e avaliações de processo.
- **PPM** — Relatórios de status, Work Breakdown Structures, ~60 tarefas, linhas de orçamento e custo, e um registro de riscos sobre as 6 Iniciativas de demonstração.
- **EA Delivery** — Architecture Decision Records e Statements of Architecture Work.

### Redefinir e re-semear

Para apagar o banco de dados e recomeçar:

```dotenv
RESET_DB=true
SEED_DEMO=true
```

Reinicie a pilha, então **remova `RESET_DB=true` de `.env`** — deixá-lo definido redefinirá o banco a cada reinício:

```bash
docker compose up -d
# Verifique que os novos dados estão presentes, então edite .env para remover RESET_DB
```

## Passo 4: Serviços opcionais (perfis do Compose)

Ambos os complementos são opcionais via perfis do Docker Compose e funcionam ao lado da pilha principal sem perturbá-la.

### Sugestões de descrição com IA

Gere descrições de cards com um LLM local (Ollama integrado) ou um fornecedor comercial. O contêiner Ollama integrado é o caminho mais simples para configurações auto-hospedadas.

Adicione a `.env`:

```dotenv
AI_PROVIDER_URL=http://ollama:11434
AI_MODEL=gemma3:4b
AI_AUTO_CONFIGURE=true
```

Inicie com o perfil `ai`:

```bash
docker compose --profile ai up -d
```

O modelo é baixado automaticamente no primeiro arranque (alguns minutos, dependendo de sua conexão). Veja [Capacidades de IA](../admin/ai.md) para a referência completa de configuração, incluindo como usar OpenAI / Gemini / Claude / DeepSeek em vez do Ollama integrado.

### Servidor MCP

O servidor MCP permite que ferramentas de IA — Claude Desktop, Cursor, GitHub Copilot e outras — consultem seus dados EA via [Model Context Protocol](https://modelcontextprotocol.io/) com RBAC por usuário. Somente leitura.

```bash
docker compose --profile mcp up -d
```

Veja [Integração MCP](../admin/mcp.md) para a configuração OAuth e detalhes das ferramentas.

### Ambos juntos

```bash
docker compose --profile ai --profile mcp up -d
```

## Passo 5: HTTPS direto (opcional)

O nginx de borda integrado pode terminar TLS por conta própria — útil se você não tem um reverse proxy externo. Adicione a `.env`:

```dotenv
TURBO_EA_TLS_ENABLED=true
TLS_CERTS_DIR=./certs
TURBO_EA_TLS_CERT_FILE=cert.pem
TURBO_EA_TLS_KEY_FILE=key.pem
HOST_PORT=80
TLS_HOST_PORT=443
```

Coloque `cert.pem` e `key.pem` em `./certs/` (o diretório é montado em modo somente leitura no contêiner nginx). A imagem deriva `server_name` e o esquema encaminhado de `TURBO_EA_PUBLIC_URL`, serve tanto HTTP quanto HTTPS e redireciona HTTP para HTTPS automaticamente.

Para configurações atrás de um reverse proxy existente (Caddy, Traefik, Cloudflare Tunnel), deixe `TURBO_EA_TLS_ENABLED=false` e deixe o proxy gerenciar o TLS.

## Permitir a incorporação de diagramas (opcional)

Um [diagrama publicado](../guide/diagrams.md) pode ser incorporado noutro site — uma página do Confluence, um portal de intranet — mas só se indicar esse site primeiro. Por predefinição, nenhum site externo pode colocar o Turbo EA numa frame.

```dotenv
TURBO_EA_EMBED_ALLOWED_ORIGINS=https://asuaempresa.atlassian.net
```

Separe várias origens por vírgulas. Reinicie a stack para a alteração ter efeito.

Isto aplica-se **apenas** às páginas de diagramas publicados. A aplicação em si — incluindo o editor de diagramas — permanece não incorporável de qualquer forma, e as ligações publicadas continuam a funcionar quando abertas diretamente mesmo sem esta definição.

## Fixar uma versão

`docker compose pull` usa `:latest` por padrão. Para fixar uma versão específica em produção, defina `TURBO_EA_TAG`:

```bash
TURBO_EA_TAG=1.0.0 docker compose up -d
```

As versões publicadas são marcadas como `:<full-version>`, `:<major>.<minor>`, `:<major>` e `:latest`. O workflow de publicação exclui pre-releases (`-rc.N`) de `:latest` e das tags curtas `:X.Y` / `:X`. Veja [Lançamentos](../reference/releases.md) para a árvore completa de tags e a política do canal de pré-lançamento.

## Usar um PostgreSQL existente

Se você já executa uma instância PostgreSQL gerenciada ou compartilhada, aponte o backend para ela e dispense o serviço `db` integrado.

Crie o banco de dados e o usuário no seu servidor existente:

```sql
CREATE USER turboea WITH PASSWORD 'your-password';
CREATE DATABASE turboea OWNER turboea;
```

Substitua as variáveis de conexão em `.env`:

```dotenv
POSTGRES_HOST=your-postgres-host
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=your-password
```

Em seguida inicie como de costume: `docker compose up -d`. O serviço `db` integrado permanece definido em `docker-compose.yml`; você pode deixá-lo ocioso ou pará-lo explicitamente.

### Orçamento de conexões

O backend é executado como um único processo e abre **até `DB_POOL_SIZE + DB_MAX_OVERFLOW` conexões — 30 por predefinição**. O serviço `db` incluído permite 100, pelo que os valores predefinidos nunca causam problemas. Uma instância gerida num plano económico limita frequentemente a base de dados muito abaixo de 30, e o PostgreSQL responde então:

```
too many connections for database "turboea"
```

Verifique os seus limites antes de mudar:

```sql
SELECT datname, datconnlimit FROM pg_database WHERE datname = 'turboea';
SELECT rolname, rolconnlimit FROM pg_roles    WHERE rolname = 'turboea';
SHOW max_connections;
```

`-1` em `datconnlimit` ou `rolconnlimit` significa «sem limite específico»; qualquer valor inferior a 30 exige aumentar o limite ou reduzir o pool:

```dotenv
DB_POOL_SIZE=8
DB_MAX_OVERFLOW=2
DB_POOL_TIMEOUT=30
```

Um pool mais pequeno significa menos pedidos servidos em simultâneo, não pedidos perdidos: quando o pool está cheio, um pedido aguarda até `DB_POOL_TIMEOUT` segundos por uma conexão livre. Deixe algumas conexões livres para as cópias de segurança e para as suas próprias sessões `psql`.

## Verificar imagens

Desde `1.0.0`, cada imagem publicada é assinada com cosign keyless OIDC e traz uma SBOM SPDX gerada pelo buildkit. Veja [Cadeia de suprimentos](../admin/supply-chain.md) para o comando de verificação e como obter a SBOM do registro.

## Desenvolvimento a partir do código fonte

Se você quiser construir a pilha a partir do código fonte (modificando código backend ou frontend), use a sobreposição Compose de desenvolvimento:

```bash
docker compose -f docker-compose.yml -f dev/docker-compose.dev.yml up -d --build
```

Ou o alvo de conveniência:

```bash
make up-dev
```

O guia completo do desenvolvedor — nomenclatura de branches, comandos de lint e teste, verificações pre-commit — está em [CONTRIBUTING.md](https://github.com/vincentmakes/turbo-ea/blob/main/CONTRIBUTING.md).

## Referência rápida

| Cenário | Comando |
|---------|---------|
| Primeiro arranque (dados vazios) | `docker compose pull && docker compose up -d` |
| Primeiro arranque com dados de demonstração | Defina `SEED_DEMO=true` em `.env`, então o mesmo comando |
| Adicionar sugestões de IA | Adicione variáveis IA, então `docker compose --profile ai up -d` |
| Adicionar servidor MCP | `docker compose --profile mcp up -d` |
| Fixar uma versão | `TURBO_EA_TAG=1.0.0 docker compose up -d` |
| Redefinir e re-semear | `RESET_DB=true` + `SEED_DEMO=true`, reinicie, então remova `RESET_DB` |
| Usar Postgres externo | Substitua variáveis `POSTGRES_*` em `.env`, então `docker compose up -d` |
| Construir do código fonte | `make up-dev` |

## Próximos passos

- Abra **http://localhost:8920** (ou seu `HOST_PORT` configurado) e faça login. Se carregou dados de demonstração, use `admin@turboea.demo` / `TurboEA!2025`. Caso contrário, registre-se — o primeiro usuário é automaticamente promovido a Admin.
- Explore o [Dashboard](../guide/dashboard.md) para uma visão geral do seu panorama EA.
- Personalize [tipos de cards e campos](../admin/metamodel.md) — o metamodelo é totalmente baseado em dados, sem alterações de código.
- Para implantações de produção, revise [Política de compatibilidade](../reference/compatibility.md) e [Cadeia de suprimentos](../admin/supply-chain.md).
