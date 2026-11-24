# Referência da API

O Turbo EA expõe uma **API REST** completa que alimenta tudo o que se pode fazer na interface web. Você pode usá-la para automatizar atualizações de inventário, integrar pipelines de CI/CD, construir painéis personalizados ou levar dados de EA para outras ferramentas (BI, GRC, ITSM, planilhas).

A especificação OpenAPI 3 completa é renderizada ao vivo mais abaixo nesta página: cada endpoint, parâmetro e formato de resposta, regenerado a partir do código do backend a cada release.

---

## URL base

Todos os endpoints da API ficam sob o prefixo `/api/v1`:

```
https://seu-dominio.example.com/api/v1
```

Localmente (configuração padrão do Docker):

```
http://localhost:8920/api/v1
```

A única exceção é o endpoint de saúde, montado em `/api/health` (sem prefixo de versão).

---

## Referência OpenAPI ao vivo

A Swagger UI interativa abaixo é gerada diretamente a partir do código-fonte do FastAPI a cada release e enviada com o manual do usuário — não é necessária uma instância de backend em execução para consultá-la. Use o filtro para restringir endpoints por tag e expanda qualquer operação para ver parâmetros, esquemas de requisição/resposta e exemplos. O esquema bruto pode ser baixado em JSON a partir de [`/api/openapi.json`](/api/openapi.json) para geradores de código como `openapi-generator-cli`.

<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css">
<div id="swagger-ui"></div>
<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
<script>
window.addEventListener('DOMContentLoaded', function () {
  window.SwaggerUIBundle({
    url: '/api/openapi.json',
    dom_id: '#swagger-ui',
    deepLinking: true,
    filter: true,
    docExpansion: 'list',
    defaultModelsExpandDepth: 1,
    supportedSubmitMethods: []
  });
});
</script>

!!! info "Experimentar endpoints na sua própria instância"
    «Try it out» está desativado aqui de propósito: o site de documentação não atua como proxy da sua API. Para enviar requisições reais, execute Turbo EA em modo de desenvolvimento (`ENVIRONMENT=development`) e abra `/api/docs` na sua própria instância: clique em **Authorize**, cole um JWT (sem o prefixo `Bearer `) e use **Try it out**. Em produção esses endpoints ficam desativados por segurança; esta página continua sendo o navegador somente leitura.

---

## Autenticação

Todos os endpoints, exceto `/auth/*`, o health check e os portais web públicos, exigem um JSON Web Token enviado no cabeçalho `Authorization`:

```
Authorization: Bearer <access_token>
```

### Obter um token

`POST /api/v1/auth/login` com seu e-mail e senha:

```bash
curl -X POST https://seu-dominio.example.com/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "voce@example.com", "password": "sua-senha"}'
```

A resposta contém um `access_token`:

```json
{
  "access_token": "eyJhbGciOiJIUzI1NiIs...",
  "token_type": "bearer"
}
```

Os tokens são válidos por 24 horas por padrão (`ACCESS_TOKEN_EXPIRE_MINUTES`). Use `POST /api/v1/auth/refresh` para estender uma sessão sem reinserir credenciais.

!!! tip "Usuários SSO"
    Se a sua organização usa Single Sign-On, não é possível entrar com e-mail/senha. Peça a um administrador para criar uma conta de serviço com senha local para automação, ou capture o JWT do session storage do navegador após um login SSO normal (apenas para desenvolvimento).

### Usar o token

```bash
curl https://seu-dominio.example.com/api/v1/cards \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIs..."
```

---

## Permissões

A API aplica **as mesmas regras de RBAC da interface web**. Todo endpoint que altera dados verifica tanto o papel de aplicação do chamador quanto quaisquer papéis de stakeholder que ele possua sobre a card afetada. Não existem «permissões de API» separadas nem atalhos para contas de serviço — scripts de automação rodam com as permissões do usuário cujo token usam.

Se uma requisição falhar com `403 Forbidden`, o token é válido mas o usuário não possui a permissão exigida. Veja a página [Usuários e papéis](users.md) para o registro de permissões.

---

## Grupos de endpoints comuns

A referência ao vivo acima é a fonte completa da verdade; a tabela abaixo é um mapa rápido dos grupos mais usados:

| Prefixo | Propósito |
|---------|-----------|
| `/auth` | Login, registro, callback SSO, refresh de token, dados do usuário atual |
| `/cards` | CRUD de cards (entidade central), hierarquia, histórico, aprovação, exportação CSV |
| `/relations` | CRUD de relações entre cards |
| `/metamodel` | Tipos de card, campos, seções, subtipos, tipos de relação |
| `/reports` | KPIs do painel, portfólio, matriz, ciclo de vida, dependências, custo, qualidade dos dados |
| `/bpm` | Gestão de processos de negócio — diagramas, elementos, versões de fluxo, avaliações |
| `/ppm` | Lista principal de projetos — iniciativas, relatórios de estado, WBS, tarefas, custos e riscos |
| `/turbolens` | Análise com IA (fornecedores, duplicatas, segurança, IA de arquitetura) |
| `/risks` | Registro de riscos de EA (Fase G do TOGAF) |
| `/diagrams` | Diagramas DrawIO |
| `/soaw` | Documentos Statement of Architecture Work |
| `/adr` | Architecture Decision Records |
| `/users`, `/roles` | Administração de usuários e papéis (somente admin) |
| `/settings` | Configurações da aplicação (logo, moeda, SMTP, IA, interruptores de módulo) |
| `/servicenow` | Sincronização bidirecional com a CMDB do ServiceNow |
| `/events`, `/notifications` | Trilha de auditoria e notificações de usuário (incluindo stream SSE) |

---

## Paginação, filtragem e ordenação

Endpoints de listagem aceitam um conjunto consistente de parâmetros de consulta:

| Parâmetro | Descrição |
|-----------|-----------|
| `page` | Número da página (começa em 1) |
| `page_size` | Itens por página (padrão 50, máximo 200) |
| `sort_by` | Campo para ordenar (ex.: `name`, `updated_at`) |
| `sort_dir` | `asc` ou `desc` |
| `search` | Filtro de texto livre (onde houver suporte) |

Filtros específicos por recurso são documentados por endpoint na referência ao vivo acima (ex.: `/cards` aceita `type`, `status`, `parent_id`, `approval_status`).

---

## Eventos em tempo real (Server-Sent Events)

`GET /api/v1/events/stream` é uma conexão SSE de longa duração que envia eventos conforme acontecem (card criada, atualizada, aprovada etc.). A interface web a utiliza para atualizar badges e listas sem polling. Qualquer cliente HTTP com suporte a SSE pode se inscrever — útil para construir painéis em tempo real ou pontes externas de notificação.

---

## Geração de código

Como a API é totalmente descrita por OpenAPI 3, você pode gerar clientes tipados em qualquer linguagem importante:

```bash
# Baixar o esquema (não é preciso ter uma instância em execução)
curl https://docs.turbo-ea.org/api/openapi.json -o turbo-ea-openapi.json

# Gerar um cliente Python
openapi-generator-cli generate \
  -i turbo-ea-openapi.json \
  -g python \
  -o ./turbo-ea-client-py

# … ou TypeScript, Go, Java, C# etc.
```

Para automação em Python, o caminho mais simples costuma ser `httpx` ou `requests` com chamadas escritas à mão — a API é pequena o suficiente para que um gerador raramente compense.

---

## Rate limiting

Endpoints sensíveis à autenticação (login, registro, redefinição de senha) têm rate limit via `slowapi` para se proteger de ataques de força bruta. Os demais endpoints não são limitados por padrão; se precisar conter um script de automação pesado, faça-o no lado do cliente ou atrás do seu reverse proxy.

---

## Versionamento e estabilidade

- A API é versionada via prefixo `/api/v1`. Uma mudança incompatível introduziria um `/api/v2` em paralelo.
- Dentro de `v1`, mudanças aditivas (novos endpoints, novos campos opcionais) podem sair em releases menores e de patch. Remoções ou mudanças de contrato ficam reservadas a uma versão maior.
- A versão atual é informada por `GET /api/health` para que a automação possa detectar atualizações.

---

## Solução de problemas

| Problema | Solução |
|----------|---------|
| `/api/docs` retorna 404 na sua própria instância | A Swagger UI está desativada em produção. Defina `ENVIRONMENT=development` e reinicie o backend, ou use a referência ao vivo acima. |
| A referência ao vivo acima aparece vazia | Verifique o console do navegador — o embed carrega `/api/openapi.json`; proxies corporativos ou bloqueadores rigorosos às vezes bloqueiam scripts servidos por CDN. |
| `401 Unauthorized` | Token ausente, malformado ou expirado. Reautentique-se via `/auth/login` ou `/auth/refresh`. |
| `403 Forbidden` | O token é válido, mas o usuário não tem a permissão necessária. Verifique o papel em [Usuários e papéis](users.md). |
| `422 Unprocessable Entity` | Falha de validação do Pydantic. O corpo da resposta lista quais campos estão inválidos e por quê. |
| Erros de CORS em um app de navegador | Adicione a origem do frontend a `ALLOWED_ORIGINS` no `.env` e reinicie o backend. |
