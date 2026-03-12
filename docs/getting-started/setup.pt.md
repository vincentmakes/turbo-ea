# Instalação e configuração

Este guia orienta a instalação do Turbo EA com Docker, a configuração do ambiente, o carregamento de dados de demonstração e a inicialização de serviços opcionais como IA e servidor MCP.

## Pré-requisitos

- [Docker](https://docs.docker.com/get-docker/) (v20.10+)
- [Docker Compose](https://docs.docker.com/compose/install/) (v2.0+)

## Passo 1: Clonar e configurar

```bash
git clone https://github.com/vincentmakes/turbo-ea.git
cd turbo-ea
cp .env.example .env
```

Abra `.env` em um editor de texto e defina os valores necessários:

```dotenv
# Credenciais do PostgreSQL (usadas pelo contêiner de banco de dados integrado)
POSTGRES_PASSWORD=escolha-uma-senha-forte

# Chave de assinatura JWT — gere uma com:
#   python3 -c "import secrets; print(secrets.token_urlsafe(64))"
SECRET_KEY=sua-chave-gerada

# Porta na qual o aplicativo estará disponível
HOST_PORT=8920
```

## Passo 2: Escolher a opção de banco de dados

### Opção A: Banco de dados integrado (recomendado para começar)

O arquivo `docker-compose.db.yml` inicia um contêiner PostgreSQL junto com o backend e o frontend. Nenhum banco de dados externo é necessário — os dados são persistidos em um volume Docker.

```bash
docker compose -f docker-compose.db.yml up --build -d
```

### Opção B: PostgreSQL externo

Se você já possui um servidor PostgreSQL (banco de dados gerenciado, contêiner separado ou instalação local), use o arquivo base `docker-compose.yml` que inicia apenas o backend e o frontend.

Primeiro, crie um banco de dados e um usuário:

```sql
CREATE USER turboea WITH PASSWORD 'sua-senha';
CREATE DATABASE turboea OWNER turboea;
```

Em seguida, configure seu `.env`:

```dotenv
POSTGRES_HOST=seu-host-postgresql
POSTGRES_PORT=5432
POSTGRES_DB=turboea
POSTGRES_USER=turboea
POSTGRES_PASSWORD=sua-senha
```

Inicie o aplicativo:

```bash
docker compose up --build -d
```

!!! note
    O arquivo base `docker-compose.yml` espera uma rede Docker chamada `guac-net`. Crie-a com `docker network create guac-net` se não existir.

## Passo 3: Carregar dados de demonstração (opcional)

O Turbo EA pode iniciar com um metamodelo vazio (apenas os 14 tipos de card integrados e os tipos de relação) ou com um conjunto de dados de demonstração completo. Os dados de demonstração são ideais para avaliar a plataforma, realizar sessões de treinamento ou explorar funcionalidades.

### Opções de carregamento

Adicione estas variáveis ao seu `.env` **antes da primeira inicialização**:

| Variável | Padrão | Descrição |
|----------|--------|-----------|
| `SEED_DEMO` | `false` | Carrega o conjunto completo de dados NexaTech Industries, incluindo BPM e PPM |
| `SEED_BPM` | `false` | Carrega apenas os processos de demonstração BPM (requer dados base existentes) |
| `SEED_PPM` | `false` | Carrega apenas os dados de projeto PPM (requer dados base existentes) |
| `RESET_DB` | `false` | Exclui todas as tabelas e as recria na inicialização |

### Demonstração completa (recomendada para avaliação)

```dotenv
SEED_DEMO=true
```

Isso carrega todo o conjunto de dados NexaTech Industries com uma única configuração. Você **não** precisa definir `SEED_BPM` ou `SEED_PPM` separadamente — eles são incluídos automaticamente.

### Conta de administrador de demonstração

Quando os dados de demonstração são carregados, uma conta de administrador padrão é criada:

| Campo | Valor |
|-------|-------|
| **E-mail** | `admin@turboea.demo` |
| **Senha** | `TurboEA!2025` |
| **Função** | Administrador |

!!! warning
    A conta de administrador de demonstração usa credenciais conhecidas. Altere a senha ou crie sua própria conta de administrador para qualquer ambiente além da avaliação local.

### O que os dados de demonstração incluem

O conjunto de dados NexaTech Industries contém aproximadamente 150 cards em todas as camadas de arquitetura:

**Dados EA principais** (sempre incluídos com `SEED_DEMO=true`):

- **Organizações** — Hierarquia corporativa: NexaTech Industries com unidades de negócio (Engenharia, Manufatura, Vendas e Marketing), regiões, equipes e clientes
- **Capacidades de negócio** — Mais de 20 capacidades em uma hierarquia multinível
- **Contextos de negócio** — Processos, fluxos de valor, jornadas do cliente, produtos de negócio
- **Aplicações** — Mais de 15 aplicações (NexaCore ERP, Plataforma IoT, Salesforce CRM, etc.) com dados completos de ciclo de vida e custos
- **Componentes TI** — Mais de 20 itens de infraestrutura (bancos de dados, servidores, middleware, SaaS, modelos de IA)
- **Interfaces e objetos de dados** — Definições de API e fluxos de dados entre sistemas
- **Plataformas** — Plataformas Cloud e IoT com subtipos
- **Objetivos e iniciativas** — 6 iniciativas estratégicas com diferentes status de aprovação
- **Tags** — 5 grupos: Valor de Negócio, Stack Tecnológico, Status do Ciclo de Vida, Nível de Risco, Escopo Regulatório
- **Relações** — Mais de 60 relações conectando cards entre todas as camadas
- **Entrega EA** — Registros de decisões de arquitetura e documentos de trabalho de arquitetura

**Dados BPM** (incluídos com `SEED_DEMO=true` ou `SEED_BPM=true`):

- ~30 processos de negócio organizados em uma hierarquia de 4 níveis (categorias, grupos, processos, variantes)
- Diagramas BPMN 2.0 com elementos de processo extraídos (tarefas, eventos, gateways, raias)
- Links de elementos para cards conectando tarefas BPMN a aplicações, componentes TI e objetos de dados
- Avaliações de processos com pontuações de maturidade, eficácia e conformidade

**Dados PPM** (incluídos com `SEED_DEMO=true` ou `SEED_PPM=true`):

- Relatórios de status para 6 iniciativas mostrando a saúde do projeto ao longo do tempo
- Estruturas analíticas de projeto (EAP) com decomposição hierárquica e marcos
- ~60 tarefas entre iniciativas com status, prioridades, responsáveis e tags
- Linhas de orçamento (capex/opex por ano fiscal) e linhas de custo (despesas reais)
- Registro de riscos com pontuações de probabilidade/impacto e planos de mitigação

### Redefinir o banco de dados

Para apagar tudo e começar do zero:

```dotenv
RESET_DB=true
SEED_DEMO=true
```

Reinicie os contêineres e então **remova `RESET_DB` do `.env`** para evitar redefinição a cada reinicialização:

```bash
docker compose -f docker-compose.db.yml up --build -d
# Após confirmar o funcionamento, remova RESET_DB=true do .env
```

## Passo 4: Serviços opcionais

### Sugestões de descrição com IA

O Turbo EA pode gerar descrições de cards usando um LLM local (Ollama) ou provedores comerciais. O contêiner Ollama integrado é a forma mais fácil de começar.

Adicione ao `.env`:

```dotenv
AI_PROVIDER_URL=http://ollama:11434
AI_MODEL=gemma3:4b
AI_AUTO_CONFIGURE=true
```

Inicie com o perfil `ai`:

```bash
docker compose -f docker-compose.db.yml --profile ai up --build -d
```

O modelo é baixado automaticamente na primeira inicialização (isso pode levar alguns minutos dependendo da sua conexão). Consulte [Funcionalidades de IA](../admin/ai.md) para detalhes de configuração.

### Servidor MCP (integração com ferramentas de IA)

O servidor MCP permite que ferramentas de IA como Claude Desktop, Cursor e GitHub Copilot consultem seus dados EA.

```bash
docker compose -f docker-compose.db.yml --profile mcp up --build -d
```

Consulte [Integração MCP](../admin/mcp.md) para detalhes de configuração e autenticação.

### Combinar perfis

Você pode habilitar múltiplos perfis ao mesmo tempo:

```bash
docker compose -f docker-compose.db.yml --profile ai --profile mcp up --build -d
```

## Referência rápida: Comandos de inicialização comuns

| Cenário | Comando |
|---------|---------|
| **Início mínimo** (BD integrado, vazio) | `docker compose -f docker-compose.db.yml up --build -d` |
| **Demo completa** (BD integrado, todos os dados) | Defina `SEED_DEMO=true` no `.env`, depois `docker compose -f docker-compose.db.yml up --build -d` |
| **Demo completa + IA** | Defina `SEED_DEMO=true` + variáveis IA no `.env`, depois `docker compose -f docker-compose.db.yml --profile ai up --build -d` |
| **BD externo** | Configure as variáveis de BD no `.env`, depois `docker compose up --build -d` |
| **Redefinir e recarregar** | Defina `RESET_DB=true` + `SEED_DEMO=true` no `.env`, reinicie, depois remova `RESET_DB` |

## Próximos passos

- Abra **http://localhost:8920** (ou seu `HOST_PORT` configurado) no navegador
- Se carregou dados de demonstração, faça login com `admin@turboea.demo` / `TurboEA!2025`
- Caso contrário, registre uma nova conta — o primeiro usuário recebe automaticamente a função de **Administrador**
- Explore o [Painel de controle](../guide/dashboard.md) para uma visão geral do seu panorama EA
- Configure o [Metamodelo](../admin/metamodel.md) para personalizar tipos de cards e campos
