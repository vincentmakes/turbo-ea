# Operações e atualizações

Esta página é o guia do operador para executar o Turbo EA em produção: como funcionam as atualizações e as migrações de banco de dados, como fazer backup e reverter, quais ambientes manter e as armadilhas que pegam as equipes em grande escala.

## Imagens de produção e fixação de versão

As imagens publicadas em `ghcr.io/vincentmakes/turbo-ea/*` são a forma recomendada de executar produção — o `docker-compose.yml` padrão as baixa por padrão, e compilar a partir do código-fonte é um fluxo de trabalho de desenvolvimento. Além da conveniência, as imagens publicadas trazem garantias de cadeia de suprimentos que uma compilação local não tem: cada publicação é multiarquitetura (amd64 + arm64), assinada com cosign (OIDC sem chave, verificável contra a identidade do workflow do GitHub Actions) e atestada com proveniência SLSA e um SBOM. As imagens são bloqueadas na publicação diante de CVEs críticos, reescaneadas diariamente depois de publicadas e reconstruídas semanalmente contra repositórios Alpine atualizados, de modo que os patches das imagens base chegam automaticamente. Se a sua organização exige verificação de assinatura de imagens na admissão, as assinaturas cosign se encaixam diretamente — veja [Cadeia de suprimentos](supply-chain.md) para os comandos de verificação.

O hábito mais importante: **fixe a sua versão**. A tag `:latest` é reatribuída nos lançamentos e na reconstrução semanal — não a cada commit — e por isso pode se mover segundo um cronograma que você não controla. Defina uma tag explícita no seu `.env`:

```bash
TURBO_EA_TAG=2.23.1
```

Veja [Fixar uma versão](../getting-started/setup.md) para o básico e [Lançamentos](../reference/releases.md) para a árvore completa de tags e a política de canais de pré-lançamento.

## Como funcionam as atualizações: migrações do Alembic

A compatibilidade do esquema do banco de dados é tratada automaticamente via [Alembic](https://alembic.sqlalchemy.org/). Na inicialização, o backend executa `alembic upgrade head`, de modo que cada migração pendente entre o seu esquema atual e a nova versão é aplicada — em ordem — antes de a aplicação servir tráfego.

As migrações são numeradas sequencialmente e cumulativas, o que torna os saltos de versão seguros: se você atualizar, por exemplo, da 2.10 para a 2.23, todas as migrações intermediárias são executadas em sequência. Não é preciso passar por cada versão menor.

Alguns comportamentos que vale conhecer:

| Situação | O que acontece na inicialização |
|---|---|
| Banco de dados novo | As tabelas são criadas diretamente e o banco é marcado em head — sem reexecução de migrações. |
| Banco de dados existente | As migrações pendentes são executadas automaticamente antes de a API ficar disponível. |
| `RESET_DB=true` | Todas as tabelas são removidas, recriadas e repovoadas. Nunca ative em produção. |

Dentro de uma mesma linha de versão principal, as migrações permanecem aditivas e retrocompatíveis na atualização — veja a [Política de compatibilidade](../reference/compatibility.md) para o contrato completo.

!!! warning "Nunca execute um backend antigo contra um esquema mais novo"
    O Alembic só migra para frente na inicialização. Código antigo contra um esquema mais novo é comportamento indefinido — essa é a restrição-chave da reversão (veja abaixo).

## O procedimento de atualização

1. **Leia o changelog.** Revise as entradas do `CHANGELOG.md` entre a sua versão atual e a de destino. Mudanças incompatíveis incrementam a versão principal.
2. **Faça backup** do banco de dados e do volume de dados (veja abaixo).
3. **Suba a tag e baixe as imagens:**

    ```bash
    TURBO_EA_TAG=2.24.0 docker compose pull
    docker compose up -d
    ```

4. **Acompanhe os logs de inicialização** e confirme que as migrações terminam sem erros antes de a API servir tráfego:

    ```bash
    docker compose logs -f backend
    ```

!!! note "Janelas de manutenção"
    As migrações costumam ser rápidas, mas em inventários grandes algumas migrações de dados podem levar alguns minutos, durante os quais o backend não responde. Agende as atualizações em uma janela de manutenção.

## Backups

Faça um backup **antes de cada atualização**, e automatize um backup noturno de qualquer forma:

```bash
docker compose exec db pg_dump -U turboea turboea > backup-$(date +%F).sql
```

Ajuste o usuário e o nome do banco se você alterou `POSTGRES_USER` / `POSTGRES_DB`. Um snapshot do volume `postgres_data` é uma alternativa equivalente.

Faça backup também do volume **`backend_data`** — ele guarda os anexos de arquivo, as extensões instaladas e os bundles de transferência de espaço de trabalho que não residem no PostgreSQL.

Mais dois pontos sobre a postura de recuperação:

- **Teste as suas restaurações periodicamente.** Um backup que nunca foi restaurado é uma esperança, não um plano.
- **Cartões arquivados são excluídos de forma reversível** com uma janela de 30 dias antes da remoção definitiva — essa é a sua rede de segurança para erros de dados, distinta da recuperação de infraestrutura.

## Reversão e recuperação

As migrações de esquema são, na prática, **apenas para frente em produção**: embora o Alembic tecnicamente suporte downgrades, migrações que carregam dados nem sempre podem ser revertidas sem perdas, e a aplicação nunca executa downgrades automaticamente. A estratégia de reversão confiável é:

1. Pare a pilha.
2. Restaure o backup do banco de dados feito antes da atualização.
3. Volte o `TURBO_EA_TAG` para a versão anterior.
4. `docker compose up -d` — o banco restaurado corresponde ao esquema do código antigo, então tudo fica consistente.

!!! warning "Nunca reverta apenas a imagem"
    Reverter a imagem mantendo o banco de dados migrado é a única combinação da qual o sistema de migração automática não pode protegê-lo. O backup do banco e a tag da imagem se movem juntos.

## Ambientes e governança de lançamentos

Para a maioria das organizações, **dois ambientes** (Staging + Produção) bastam, porque as atualizações são imagens lançadas pelo fornecedor, não builds personalizados — você valida, não desenvolve. Uma cadeia completa Dev/SIT/UAT/Prod agrega valor principalmente se você constrói extensões próprias ou integrações pesadas.

| Ambiente | Propósito | Observações |
|---|---|---|
| Dev / sandbox (opcional) | Experimentar mudanças de metamodelo, demonstrações | `SEED_DEMO=true` para o conjunto de dados de demonstração; `RESET_DB=true` recomeça do zero. |
| Staging | Validar primeiro as novas versões | Dados semelhantes aos de produção; recebe as novas tags primeiro. |
| Produção | Tag fixada, backups, atualizações em janela de manutenção | Nunca `latest`, nunca `RESET_DB`. |

Duas boas formas de levar dados realistas para o staging:

- **[Transferência de espaço de trabalho](workspace-transfer.md)**: exporte o espaço de trabalho de produção como um bundle `.zip` e importe-o no staging. Os segredos (credenciais SMTP, SSO, IA, ServiceNow) são removidos por concepção e nunca saem da instância.
- **Restauração de banco de dados**: restaure um `pg_dump` de produção no banco de staging. Os segredos criptografados no banco derivam do `SECRET_KEY`, então o staging precisa do mesmo `SECRET_KEY`, ou você reinsere lá as credenciais de integração.

Quanto à governança:

- Trate o arquivo `.env` e o `TURBO_EA_TAG` fixado como configuração como código — mantenha-os no seu Git interno e faça das atualizações uma mudança revisada (uma pull request que sobe a tag).
- Como staging e produção baixam a mesma tag GHCR fixada, você valida o artefato idêntico byte a byte que vai promover.
- Atualize o staging → deixe assentar por alguns dias → promova a mesma tag para produção.

## Armadilhas comuns

1. **Executar `latest` sem fixação** — um `docker compose pull` de rotina vira uma atualização não planejada com migrações não planejadas, no cronograma dos lançamentos e não no seu.
2. **Atualizar sem backup** — as migrações são apenas para frente; o backup *é* a sua reversão.
3. **Perder ou alterar o `SECRET_KEY`** — ele assina os JWTs *e* deriva a chave de criptografia dos segredos armazenados (credenciais SMTP, SSO, ServiceNow). Alterá-lo torna os segredos armazenados indecifráveis. Trate-o como uma credencial de banco de dados: em cofre, estável, com backup.
4. **`RESET_DB=true` esquecido em um arquivo de ambiente** — ele faz exatamente o que diz, a cada inicialização.
5. **Editar o banco de dados diretamente** — o estado do esquema pertence ao Alembic, e DDL manual colidirá com migrações futuras. O mesmo vale para os dados: use a API ou a interface para que permissões, eventos de auditoria e o recálculo da qualidade dos dados permaneçam corretos.
6. **Não persistir os volumes** — `postgres_data` e `backend_data` precisam sobreviver à recriação dos contêineres; verifique se as suas ferramentas de snapshot e backup cobrem os dois.
7. **Reverter a imagem sem restaurar o banco de dados** — veja [Reversão e recuperação](#reversao-e-recuperacao).
