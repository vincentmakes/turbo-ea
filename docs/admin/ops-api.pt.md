# API de operações (implementações geridas)

A API de operações (`/api/v1/ops`) é uma superfície de gestão **opcional** utilizada por um plano de controlo Turbo EA Cloud para operar instâncias alojadas. Numa instalação autoalojada, está **desativada por predefinição** — todas as rotas respondem `404`, exceto se a instância tiver sido iniciada com uma variável de ambiente `OPS_PUBLIC_KEY`. O Turbo EA não contém lógica de faturação nem de licenciamento.

## Autenticação

Cada pedido de operações tem de ser assinado com a chave Ed25519 **privada** detida pelo plano de controlo; a instância verifica a assinatura com a chave **pública** de `OPS_PUBLIC_KEY` (base64, 32 bytes em bruto). A assinatura abrange o método HTTP, o caminho com a cadeia de consulta, um hash SHA-256 do corpo, um carimbo temporal e um nonce de utilização única:

```
canonical = METHOD \n PATH_WITH_QUERY \n sha256(body) \n timestamp \n nonce
```

Cabeçalhos: `X-Ops-Timestamp` (segundos Unix, ±5 minutos), `X-Ops-Nonce` (utilizado uma vez, proteção contra repetição), `X-Ops-Signature` (assinatura Ed25519 em base64).

## Endpoints

| Método | Caminho | Função |
|--------|------|---------|
| GET | `/api/v1/ops/info` | Versão, contagens de utilizadores/cartões, estado da base de dados |
| POST | `/api/v1/ops/rescue-access` | Cria uma conta de administrador operador **por tempo limitado** |
| DELETE | `/api/v1/ops/rescue-access` | Revoga imediatamente uma conta de recuperação |
| GET | `/api/v1/ops/export` | Transmite o pacote de exportação da área de trabalho sem segredos |

## Acesso de recuperação — garantias de transparência

O acesso de operador por tempo limitado («acesso de recuperação») foi concebido para nunca ocorrer de forma invisível:

- **Cada concessão e revogação notifica todos os administradores da instância** na aplicação *e* por e-mail, incluindo o nome do operador, o motivo indicado e a hora de expiração.
- **Cada ação é registada no próprio registo de eventos da instância.**
- **A expiração é aplicada pela própria instância**: as contas de recuperação têm um carimbo temporal `access_expires_at`; as contas expiradas são rejeitadas durante a autenticação e desativadas por uma tarefa em segundo plano de hora a hora. Uma interrupção do plano de controlo nunca pode prolongar o acesso.
- As contas de recuperação usam um endereço reservado dedicado (`rescue-…@rescue.turboea.invalid`), pelo que são fáceis de reconhecer na lista de utilizadores e podem ser desativadas manualmente em qualquer altura.

## Exportação da área de trabalho

`GET /api/v1/ops/export` devolve o mesmo pacote que **Administração → Definições → Migração → Transferência da área de trabalho → Exportar**: a área de trabalho completa sem quaisquer segredos. O plano de controlo utiliza-o para exportações de dados solicitadas pelos clientes (portabilidade de dados do RGPD) e para cópias de segurança antes de atualizações ou eliminações.
