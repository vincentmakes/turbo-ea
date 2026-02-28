# Integração com ServiceNow

A integração com ServiceNow (**Admin > Configurações > ServiceNow**) permite a sincronização bidirecional entre o Turbo EA e seu ServiceNow CMDB. Este guia cobre tudo, desde a configuração inicial até receitas avançadas e melhores práticas operacionais.

## Por que Integrar o ServiceNow com o Turbo EA?

O ServiceNow CMDB e as ferramentas de Arquitetura Empresarial servem a propósitos diferentes, mas complementares:

| | ServiceNow CMDB | Turbo EA |
|--|-----------------|----------|
| **Foco** | Operações de TI — o que está em execução, quem é responsável, quais incidentes ocorreram | Planejamento estratégico — como a cenário deve ser daqui a 3 anos? |
| **Mantido por** | Operações de TI, Gestão de Ativos | Equipe de EA, Arquitetos de Negócio |
| **Ponto forte** | Descoberta automatizada, fluxos de trabalho ITSM, precisão operacional | Contexto de negócio, mapeamento de capacidades, planejamento de ciclo de vida, avaliações |
| **Dados típicos** | Nomes de host, IPs, status de instalação, grupos de atribuição, contratos | Criticidade de negócio, adequação funcional, débito técnico, roadmap estratégico |

**O Turbo EA é o sistema de registro** para sua cenário de arquitetura — nomes, descrições, planos de ciclo de vida, avaliações e contexto de negócio residem aqui. O ServiceNow complementa o Turbo EA com metadados operacionais e técnicos (nomes de host, IPs, dados de SLA, status de instalação) provenientes de descoberta automatizada e fluxos de trabalho ITSM. A integração mantém os dois sistemas conectados, respeitando que o Turbo EA lidera.

### O que Você Pode Fazer

- **Sincronização pull** — Alimente o Turbo EA com CIs do ServiceNow e depois assuma a propriedade. Pulls subsequentes atualizam apenas campos operacionais (IPs, status, SLAs) que o SNOW descobre automaticamente
- **Sincronização push** — Exporte dados curados pelo EA de volta para o ServiceNow (nomes, descrições, avaliações, planos de ciclo de vida) para que as equipes ITSM vejam o contexto do EA
- **Sincronização bidirecional** — O Turbo EA lidera a maioria dos campos; o SNOW lidera um pequeno conjunto de campos operacionais/técnicos. Ambos os sistemas permanecem sincronizados
- **Mapeamento de identidade** — Rastreamento persistente de referência cruzada (sys_id <-> card UUID) garante que os registros permaneçam vinculados entre sincronizações

---

## Arquitetura da Integração

```
+------------------+         HTTPS / Table API          +------------------+
|   Turbo EA       | <--------------------------------> |  ServiceNow      |
|                  |                                     |                  |
|  Cards           |  Pull: SNOW CIs -> Turbo Cards      |  CMDB CIs        |
|  (Application,   |  Push: Turbo Cards -> SNOW CIs      |  (cmdb_ci_appl,  |
|   ITComponent,   |                                     |   cmdb_ci_server, |
|   Provider, ...) |  Identity Map tracks sys_id <-> UUID |   core_company)  |
+------------------+                                     +------------------+
```

A integração utiliza a Table API do ServiceNow sobre HTTPS. As credenciais são criptografadas em repouso usando Fernet (AES-128-CBC) derivado da sua `SECRET_KEY`. Todas as operações de sincronização são registradas como eventos com `source: "servicenow_sync"` para uma trilha de auditoria completa.

---

## Planejando sua Integração

Antes de configurar qualquer coisa, responda a estas perguntas:

### 1. Quais tipos de card precisam de dados do ServiceNow?

Comece pequeno. Os pontos de integração mais comuns são:

| Prioridade | Tipo no Turbo EA | Origem no ServiceNow | Por quê |
|------------|------------------|----------------------|---------|
| **Alta** | Application | `cmdb_ci_business_app` | Aplicações são o núcleo do EA — o CMDB possui nomes, proprietários e status oficiais |
| **Alta** | ITComponent (Software) | `cmdb_ci_spkg` | Produtos de software alimentam o rastreamento de EOL e o radar tecnológico |
| **Média** | ITComponent (Hardware) | `cmdb_ci_server` | Paisagem de servidores para mapeamento de infraestrutura |
| **Média** | Provider | `core_company` | Registro de fornecedores para gestão de custos e relacionamentos |
| **Baixa** | Interface | `cmdb_ci_endpoint` | Endpoints de integração (frequentemente mantidos manualmente no EA) |
| **Baixa** | DataObject | `cmdb_ci_database` | Instâncias de banco de dados |

### 2. Qual sistema é a fonte da verdade para cada campo?

Esta é a decisão mais importante. O padrão deve ser **Turbo EA lidera** — a ferramenta de EA é o sistema de registro para sua cenário de arquitetura. O ServiceNow deve liderar apenas para um conjunto restrito de campos operacionais e técnicos provenientes de descoberta automatizada ou fluxos de trabalho ITSM. Todo o resto — nomes, descrições, avaliações, planejamento de ciclo de vida, custos — é de propriedade e curadoria da equipe de EA no Turbo EA.

**Modelo recomendado — "Turbo EA lidera, SNOW complementa":**

| Tipo de Campo | Fonte da Verdade | Por quê |
|---------------|------------------|---------|
| **Nomes e descrições** | **Turbo lidera** | A equipe de EA cura nomes oficiais e escreve descrições estratégicas; nomes no CMDB podem ser confusos ou gerados automaticamente |
| **Criticidade de negócio** | **Turbo lidera** | Avaliação estratégica da equipe de EA — não são dados operacionais |
| **Adequação funcional / técnica** | **Turbo lidera** | Pontuações do modelo TIME são uma preocupação do EA |
| **Ciclo de vida (todas as fases)** | **Turbo lidera** | Plan, phaseIn, active, phaseOut, endOfLife — todos são dados de planejamento do EA |
| **Dados de custo** | **Turbo lidera** | O EA rastreia o custo total de propriedade; o CMDB pode ter itens de contrato, mas o EA possui a visão consolidada |
| **Tipo de hospedagem, categoria** | **Turbo lidera** | O EA classifica aplicações por modelo de hospedagem para análise estratégica |
| **Metadados técnicos** | SNOW lidera | IPs, versões de SO, nomes de host, números de série — dados de descoberta automatizada que o EA não mantém |
| **SLA / status operacional** | SNOW lidera | Status de instalação, metas de SLA, métricas de disponibilidade — dados operacionais ITSM |
| **Grupo de atribuição / suporte** | SNOW lidera | Propriedade operacional rastreada nos fluxos de trabalho do ServiceNow |
| **Datas de descoberta** | SNOW lidera | Primeira/última descoberta, último escaneamento — metadados de automação do CMDB |

### 3. Com que frequência você deve sincronizar?

| Cenário | Frequência | Observações |
|---------|------------|-------------|
| Importação inicial | Uma vez | Modo aditivo, revise cuidadosamente |
| Gestão ativa da cenário | Diariamente | Automatizado via cron fora do horário de pico |
| Relatórios de conformidade | Semanalmente | Antes de gerar relatórios |
| Ad-hoc | Conforme necessário | Antes de grandes revisões ou apresentações de EA |

---

## Passo 1: Pré-requisitos do ServiceNow

### Criar uma Conta de Serviço

No ServiceNow, crie uma conta de serviço dedicada (nunca use contas pessoais):

| Papel | Finalidade | Obrigatório? |
|-------|-----------|--------------|
| `itil` | Acesso de leitura às tabelas do CMDB | Sim |
| `cmdb_read` | Leitura de Configuration Items | Sim |
| `rest_api_explorer` | Útil para testar consultas | Recomendado |
| `import_admin` | Acesso de escrita nas tabelas de destino | Apenas para sincronização push |

**Melhor prática**: Crie um papel personalizado com acesso somente leitura apenas às tabelas específicas que planeja sincronizar. O papel `itil` é amplo — um papel com escopo personalizado limita o raio de impacto.

### Requisitos de Rede

- O backend do Turbo EA deve alcançar sua instância SNOW via HTTPS (porta 443)
- Configure regras de firewall e listas de IPs permitidos
- Formato da URL da instância: `https://empresa.service-now.com` ou `https://empresa.servicenowservices.com`

### Escolher o Método de Autenticação

| Método | Vantagens | Desvantagens | Recomendação |
|--------|-----------|--------------|--------------|
| **Basic Auth** | Configuração simples | Credenciais enviadas a cada requisição | Apenas para desenvolvimento/testes |
| **OAuth 2.0** | Baseado em token, com escopo, auditável | Mais etapas de configuração | **Recomendado para produção** |

Para OAuth 2.0:
1. No ServiceNow: **System OAuth > Application Registry**
2. Crie um novo endpoint OAuth API para clientes externos
3. Anote o Client ID e Client Secret
4. Rotacione os secrets em um ciclo de 90 dias

---

## Passo 2: Criar uma Conexão

Navegue até **Admin > ServiceNow > aba Conexões**.

### Criar e Testar

1. Clique em **Adicionar Conexão**
2. Preencha:

| Campo | Valor de Exemplo | Observações |
|-------|------------------|-------------|
| Nome | `CMDB Produção` | Rótulo descritivo para sua equipe |
| URL da Instância | `https://empresa.service-now.com` | Deve usar HTTPS |
| Tipo de Autenticação | Basic Auth ou OAuth 2.0 | OAuth recomendado para produção |
| Credenciais | (conforme tipo de autenticação) | Criptografadas em repouso via Fernet |

3. Clique em **Criar**, depois clique no **ícone de teste** (símbolo de wifi) para verificar a conectividade

- **Chip verde "Conectado"** — Pronto para uso
- **Chip vermelho "Falhou"** — Verifique credenciais, rede e URL

### Múltiplas Conexões

Você pode criar múltiplas conexões para:
- Instâncias de **produção** vs **desenvolvimento**
- Instâncias SNOW **regionais** (ex.: EMEA, APAC)
- **Equipes diferentes** com contas de serviço separadas

Cada mapeamento referencia uma conexão específica.

---

## Passo 3: Projetar seus Mapeamentos

Mude para a aba **Mapeamentos**. Um mapeamento conecta um tipo de card do Turbo EA a uma tabela do ServiceNow.

### Criar um Mapeamento

Clique em **Adicionar Mapeamento** e configure:

| Campo | Descrição | Exemplo |
|-------|-----------|---------|
| **Conexão** | Qual instância do ServiceNow usar | CMDB Produção |
| **Tipo de Card** | O tipo de card do Turbo EA a sincronizar | Application |
| **Tabela SNOW** | O nome API da tabela do ServiceNow | `cmdb_ci_business_app` |
| **Direção da Sincronização** | Quais operações estão disponíveis (veja abaixo) | ServiceNow -> Turbo EA |
| **Modo de Sincronização** | Como lidar com exclusões | Conservador |
| **Taxa Máxima de Exclusão** | Limite de segurança para exclusões em massa | 50% |
| **Consulta de Filtro** | Consulta codificada do ServiceNow para limitar o escopo | `active=true^install_status=1` |
| **Pular Staging** | Aplicar alterações diretamente sem revisão | Desativado (recomendado para sincronização inicial) |

### Mapeamentos Comuns de Tabelas SNOW

| Tipo no Turbo EA | Tabela no ServiceNow | Descrição |
|------------------|----------------------|-----------|
| Application | `cmdb_ci_business_app` | Aplicações de negócio (mais comum) |
| Application | `cmdb_ci_appl` | CIs de aplicação gerais |
| ITComponent (Software) | `cmdb_ci_spkg` | Pacotes de software |
| ITComponent (Hardware) | `cmdb_ci_server` | Servidores físicos/virtuais |
| ITComponent (SaaS) | `cmdb_ci_cloud_service_account` | Contas de serviços em nuvem |
| Provider | `core_company` | Fornecedores / empresas |
| Interface | `cmdb_ci_endpoint` | Endpoints de integração |
| DataObject | `cmdb_ci_database` | Instâncias de banco de dados |
| System | `cmdb_ci_computer` | CIs de computador |
| Organization | `cmn_department` | Departamentos |

### Exemplos de Consulta de Filtro

Sempre filtre para evitar importar registros obsoletos ou desativados:

```
# Apenas CIs ativos (filtro mínimo recomendado)
active=true

# CIs ativos com status de instalação "Instalado"
active=true^install_status=1

# Aplicações em uso de produção
active=true^used_for=Production

# CIs atualizados nos últimos 30 dias
active=true^sys_updated_on>=javascript:gs.daysAgoStart(30)

# Grupo de atribuição específico
active=true^assignment_group.name=IT Operations

# Excluir CIs desativados
active=true^install_statusNOT IN7,8
```

**Melhor prática**: Sempre inclua `active=true` no mínimo. Tabelas do CMDB frequentemente contêm milhares de registros desativados ou descomissionados que não devem ser importados para sua cenário de EA.

---

## Passo 4: Configurar Mapeamentos de Campos

Cada mapeamento contém **mapeamentos de campos** que definem como os campos individuais são traduzidos entre os dois sistemas. O campo Turbo EA Field oferece sugestões de autocompletar baseadas no tipo de card selecionado — incluindo campos principais, datas de ciclo de vida e todos os atributos personalizados do esquema do tipo.

### Adicionar Campos

Para cada mapeamento de campo, você configura:

| Configuração | Descrição |
|--------------|-----------|
| **Campo Turbo EA** | Caminho do campo no Turbo EA (o autocompletar sugere opções baseadas no tipo de card) |
| **Campo SNOW** | Nome da coluna API do ServiceNow (ex.: `name`, `short_description`) |
| **Direção** | Fonte da verdade por campo: SNOW lidera ou Turbo lidera |
| **Transformação** | Como converter valores: Direto, Mapa de Valores, Data, Booleano |
| **Identidade** (checkbox ID) | Usado para correspondência de registros durante a sincronização inicial |

### Caminhos de Campo do Turbo EA

O autocompletar agrupa campos por seção. Aqui está a referência completa de caminhos:

| Caminho | Destino | Valor de Exemplo |
|---------|---------|------------------|
| `name` | Nome de exibição do card | `"SAP S/4HANA"` |
| `description` | Descrição do card | `"Sistema ERP principal para finanças"` |
| `lifecycle.plan` | Ciclo de vida: Data de planejamento | `"2024-01-15"` |
| `lifecycle.phaseIn` | Ciclo de vida: Data de introdução | `"2024-03-01"` |
| `lifecycle.active` | Ciclo de vida: Data de ativação | `"2024-06-01"` |
| `lifecycle.phaseOut` | Ciclo de vida: Data de descontinuação | `"2028-12-31"` |
| `lifecycle.endOfLife` | Ciclo de vida: Data de fim de vida | `"2029-06-30"` |
| `attributes.<key>` | Qualquer atributo personalizado do esquema de campos do tipo de card | Varia conforme o tipo de campo |

Por exemplo, se seu tipo Application possui um campo com a chave `businessCriticality`, selecione `attributes.businessCriticality` no menu suspenso.

### Campos de Identidade — Como Funciona a Correspondência

Marque um ou mais campos como **Identidade** (ícone de chave). Esses são usados durante a primeira sincronização para corresponder registros do ServiceNow a cards existentes no Turbo EA:

1. **Consulta ao mapa de identidade** — Se um vínculo sys_id <-> card UUID já existir, use-o
2. **Correspondência exata de nome** — Correspondência pelo valor do campo de identidade (ex.: correspondência pelo nome da aplicação)
3. **Correspondência aproximada** — Se não houver correspondência exata, usa SequenceMatcher com limite de similaridade de 85%

**Melhor prática**: Sempre marque o campo `name` como campo de identidade. Se os nomes diferirem entre os sistemas (ex.: SNOW inclui números de versão como "SAP S/4HANA v2.1", mas o Turbo EA tem "SAP S/4HANA"), limpe-os antes da primeira sincronização para melhor qualidade de correspondência.

Após a primeira sincronização estabelecer vínculos no mapa de identidade, sincronizações subsequentes usam o mapa de identidade persistente e não dependem da correspondência por nome.

---

## Passo 5: Executar sua Primeira Sincronização

Mude para a aba **Painel de Sincronização**.

### Disparar uma Sincronização

Para cada mapeamento ativo, você vê botões Pull e/ou Push dependendo da direção de sincronização configurada:

- **Pull** (ícone de download na nuvem) — Busca dados do SNOW para o Turbo EA
- **Push** (ícone de upload na nuvem) — Envia dados do Turbo EA para o ServiceNow

### O que Acontece Durante uma Sincronização Pull

```
1. BUSCAR     Recuperar todos os registros correspondentes do SNOW (lotes de 500)
2. COMBINAR   Combinar cada registro com um card existente:
              a) Mapa de identidade (consulta persistente sys_id <-> card UUID)
              b) Correspondência exata de nome nos campos de identidade
              c) Correspondência aproximada de nome (limite de similaridade de 85%)
3. TRANSFORMAR Aplicar mapeamentos de campo para converter formato SNOW -> Turbo EA
4. COMPARAR   Comparar dados transformados com os campos existentes do card
5. STAGING    Atribuir uma ação a cada registro:
              - create: Novo, nenhum card correspondente encontrado
              - update: Correspondência encontrada, campos diferem
              - skip:   Correspondência encontrada, sem diferenças
              - delete: No mapa de identidade mas ausente do SNOW
6. APLICAR    Executar ações em staging (criar/atualizar/arquivar cards)
```

Quando **Pular Staging** está ativado, os passos 5 e 6 se fundem — as ações são aplicadas diretamente sem gravar registros em staging.

### Revisando os Resultados da Sincronização

A tabela **Histórico de Sincronização** mostra após cada execução:

| Coluna | Descrição |
|--------|-----------|
| Iniciado | Quando a sincronização começou |
| Direção | Pull ou Push |
| Status | `completed`, `failed` ou `running` |
| Buscados | Total de registros recuperados do ServiceNow |
| Criados | Novos cards criados no Turbo EA |
| Atualizados | Cards existentes atualizados |
| Excluídos | Cards arquivados (exclusão suave) |
| Erros | Registros que falharam no processamento |
| Duração | Tempo total de execução |

Clique no **ícone de lista** em qualquer execução para inspecionar registros individuais em staging, incluindo a diferença campo a campo para cada atualização.

### Procedimento Recomendado para a Primeira Sincronização

```
1. Definir mapeamento para modo ADITIVO com staging ATIVADO
2. Executar sincronização pull
3. Revisar registros em staging — verificar se as criações estão corretas
4. Ir ao Inventário, verificar os cards importados
5. Ajustar mapeamentos de campo ou consulta de filtro se necessário
6. Executar novamente até ficar satisfeito
7. Mudar para modo CONSERVADOR para uso contínuo
8. Após várias execuções bem-sucedidas, ativar Pular Staging
```

---

## Entendendo Direção de Sincronização vs Direção de Campo

Este é o conceito mais comumente mal interpretado. Existem **dois níveis de direção** que trabalham juntos:

### Nível de Tabela: Direção da Sincronização

Definida no próprio mapeamento. Controla **quais operações de sincronização estão disponíveis** no Painel de Sincronização:

| Direção da Sincronização | Botão Pull? | Botão Push? | Usar quando... |
|--------------------------|-------------|-------------|----------------|
| **ServiceNow -> Turbo EA** | Sim | Não | O CMDB é a fonte principal, você apenas importa |
| **Turbo EA -> ServiceNow** | Não | Sim | A ferramenta de EA enriquece o CMDB com avaliações |
| **Bidirecional** | Sim | Sim | Ambos os sistemas contribuem com campos diferentes |

### Nível de Campo: Direção

Definida **por mapeamento de campo**. Controla **qual valor do sistema prevalece** durante uma execução de sincronização:

| Direção do Campo | Durante Pull (SNOW -> Turbo) | Durante Push (Turbo -> SNOW) |
|------------------|------------------------------|------------------------------|
| **SNOW lidera** | Valor é importado do ServiceNow | Valor é **ignorado** (não enviado) |
| **Turbo lidera** | Valor é **ignorado** (não sobrescrito) | Valor é exportado para o ServiceNow |

### Como Funcionam Juntos — Exemplo

Mapeamento: Application <-> `cmdb_ci_business_app`, **Bidirecional**

| Campo | Direção | Pull faz... | Push faz... |
|-------|---------|-------------|-------------|
| `name` | **Turbo lidera** | Ignora (EA cura nomes) | Envia nome do EA -> SNOW |
| `description` | **Turbo lidera** | Ignora (EA escreve descrições) | Envia descrição -> SNOW |
| `lifecycle.active` | **Turbo lidera** | Ignora (EA gerencia ciclo de vida) | Envia data de go-live -> SNOW |
| `attributes.businessCriticality` | **Turbo lidera** | Ignora (avaliação do EA) | Envia avaliação -> campo personalizado SNOW |
| `attributes.ipAddress` | SNOW lidera | Importa IP da descoberta | Ignora (dados operacionais) |
| `attributes.installStatus` | SNOW lidera | Importa status operacional | Ignora (dados ITSM) |

**Insight chave**: A direção no nível da tabela determina *quais botões aparecem*. A direção no nível do campo determina *quais campos realmente são transferidos* durante cada operação. Um mapeamento bidirecional onde o Turbo EA lidera a maioria dos campos e o SNOW lidera apenas campos operacionais/técnicos é a configuração mais poderosa.

### Melhor Prática: Direção de Campo por Tipo de Dado

O padrão deve ser **Turbo lidera** para a grande maioria dos campos. Defina SNOW lidera apenas para metadados operacionais e técnicos provenientes de descoberta automatizada ou fluxos de trabalho ITSM.

| Categoria de Dados | Direção Recomendada | Justificativa |
|---------------------|---------------------|---------------|
| **Nomes, rótulos de exibição** | **Turbo lidera** | A equipe de EA cura nomes oficiais e limpos — nomes no CMDB são frequentemente gerados automaticamente ou inconsistentes |
| **Descrição** | **Turbo lidera** | Descrições do EA capturam contexto estratégico, valor de negócio e significado arquitetural |
| **Criticidade de negócio (modelo TIME)** | **Turbo lidera** | Avaliação essencial do EA — não são dados operacionais |
| **Adequação funcional/técnica** | **Turbo lidera** | Pontuação e classificação de roadmap específicas do EA |
| **Ciclo de vida (todas as fases)** | **Turbo lidera** | Plan, phaseIn, active, phaseOut, endOfLife são decisões de planejamento do EA |
| **Dados de custo** | **Turbo lidera** | O EA rastreia o custo total de propriedade e alocação orçamentária |
| **Tipo de hospedagem, classificação** | **Turbo lidera** | Categorização estratégica mantida por arquitetos |
| **Informações de fornecedor/provedor** | **Turbo lidera** | O EA gerencia estratégia de fornecedores, contratos e risco — o SNOW pode ter um nome de fornecedor, mas o EA possui o relacionamento |
| Metadados técnicos (SO, IP, hostname) | SNOW lidera | Dados de descoberta automatizada — o EA não mantém isso |
| Metas de SLA, métricas de disponibilidade | SNOW lidera | Dados operacionais de fluxos de trabalho ITSM |
| Status de instalação, estado operacional | SNOW lidera | O CMDB rastreia se um CI está instalado, desativado, etc. |
| Grupo de atribuição, equipe de suporte | SNOW lidera | Propriedade operacional gerenciada no ServiceNow |
| Metadados de descoberta (primeiro/último visto) | SNOW lidera | Timestamps de automação do CMDB |

---

## Pular Staging — Quando Usar

Por padrão, sincronizações pull seguem um fluxo de trabalho **stage-e-depois-aplique**:

```
Buscar -> Combinar -> Transformar -> Comparar -> STAGING -> Revisar -> APLICAR
```

Os registros são gravados em uma tabela de staging, permitindo que você revise o que será alterado antes de aplicar. Isso é visível no Painel de Sincronização em "Ver registros em staging."

### Modo Pular Staging

Quando você ativa **Pular Staging** em um mapeamento, os registros são aplicados diretamente:

```
Buscar -> Combinar -> Transformar -> Comparar -> APLICAR DIRETAMENTE
```

Nenhum registro de staging é criado — as alterações acontecem imediatamente.

| | Staging (padrão) | Pular Staging |
|--|-------------------|---------------|
| **Etapa de revisão** | Sim — inspecione diferenças antes de aplicar | Não — alterações são aplicadas imediatamente |
| **Tabela de registros em staging** | Preenchida com entradas de criação/atualização/exclusão | Não preenchida |
| **Trilha de auditoria** | Registros em staging + histórico de eventos | Apenas histórico de eventos |
| **Desempenho** | Ligeiramente mais lento (grava linhas de staging) | Ligeiramente mais rápido |
| **Desfazer** | Pode abortar antes de aplicar | Deve reverter manualmente |

### Quando Usar Cada Um

| Cenário | Recomendação |
|---------|--------------|
| Primeira importação | **Usar staging** — Revise o que será criado antes de aplicar |
| Mapeamento novo ou alterado | **Usar staging** — Verifique se as transformações de campo produzem saída correta |
| Mapeamento estável e bem testado | **Pular staging** — Não há necessidade de revisar cada execução |
| Sincronizações diárias automatizadas (cron) | **Pular staging** — Execuções autônomas não podem esperar por revisão |
| CMDB grande (10.000+ CIs) | **Pular staging** — Evita criar milhares de linhas de staging |
| Ambiente sensível a conformidade | **Usar staging** — Mantenha trilha de auditoria completa na tabela de staging |

**Melhor prática**: Comece com staging ativado nas suas primeiras sincronizações. Quando estiver confiante de que o mapeamento produz resultados corretos, ative pular staging para execuções automatizadas.

---

## Modos de Sincronização e Segurança de Exclusão

### Modos de Sincronização

| Modo | Criações | Atualizações | Exclusões | Melhor Para |
|------|----------|--------------|-----------|-------------|
| **Aditivo** | Sim | Sim | **Nunca** | Importações iniciais, ambientes de baixo risco |
| **Conservador** | Sim | Sim | Apenas cards **criados pela sincronização** | Padrão para sincronizações contínuas |
| **Estrito** | Sim | Sim | Todos os cards vinculados | Espelho completo do CMDB |

**Aditivo** nunca remove cards do Turbo EA, tornando-o a opção mais segura para primeiras importações e ambientes onde o Turbo EA contém cards não presentes no ServiceNow (cards criados manualmente, cards de outras fontes).

**Conservador** (padrão) rastreia se cada card foi originalmente criado pelo motor de sincronização. Apenas esses cards podem ser auto-arquivados se desaparecerem do ServiceNow. Cards criados manualmente no Turbo EA ou importados de outras fontes nunca são afetados.

**Estrito** arquiva qualquer card vinculado cujo CI correspondente no ServiceNow não aparece mais nos resultados da consulta, independentemente de quem o criou. Use isso apenas quando o ServiceNow for a fonte absoluta da verdade e você quiser que o Turbo EA o espelhe exatamente.

### Taxa Máxima de Exclusão — Rede de Segurança

Como rede de segurança, o motor **ignora todas as exclusões** se a contagem exceder a taxa configurada:

```
exclusões / total_vinculados > taxa_máxima_exclusão  ->  IGNORAR TODAS AS EXCLUSÕES
```

Exemplo com 10 registros vinculados e limite de 50%:

| Cenário | Exclusões | Taxa | Resultado |
|---------|-----------|------|-----------|
| 3 CIs removidos normalmente | 3 / 10 = 30% | Abaixo do limite | Exclusões prosseguem |
| 6 CIs removidos de uma vez | 6 / 10 = 60% | **Acima do limite** | Todas as exclusões ignoradas |
| SNOW retorna vazio (indisponibilidade) | 10 / 10 = 100% | **Acima do limite** | Todas as exclusões ignoradas |

Isso previne perda catastrófica de dados causada por alterações na consulta de filtro, indisponibilidades temporárias do ServiceNow ou nomes de tabela mal configurados.

**Melhor prática**: Mantenha a taxa de exclusão em **50% ou menos** para tabelas com menos de 100 registros. Para tabelas grandes (1.000+), você pode definir com segurança em 25%.

### Progressão Recomendada

```
Semana 1:     Modo ADITIVO, staging ATIVADO, executar manualmente, revisar cada registro
Semana 2-4:   Modo CONSERVADOR, staging ATIVADO, executar diariamente, verificar resultados por amostragem
Mês 2+:       Modo CONSERVADOR, staging DESATIVADO (pular), cron diário automatizado
```

---

## Receitas Recomendadas por Tipo

### Receita 1: Aplicações do CMDB (Mais Comum)

**Objetivo**: Importar a cenário de aplicações do ServiceNow e depois assumir a propriedade de nomes, descrições, avaliações e ciclo de vida no Turbo EA. O SNOW lidera apenas campos operacionais.

**Mapeamento:**

| Configuração | Valor |
|--------------|-------|
| Tipo de Card | Application |
| Tabela SNOW | `cmdb_ci_business_app` |
| Direção | Bidirecional |
| Modo | Conservador |
| Filtro | `active=true^install_status=1` |

**Mapeamentos de campo:**

| Campo Turbo EA | Campo SNOW | Direção | Transformação | ID? |
|----------------|------------|---------|---------------|-----|
| `name` | `name` | **Turbo lidera** | Direto | Sim |
| `description` | `short_description` | **Turbo lidera** | Direto | |
| `lifecycle.active` | `go_live_date` | **Turbo lidera** | Data | |
| `lifecycle.endOfLife` | `retirement_date` | **Turbo lidera** | Data | |
| `attributes.businessCriticality` | `busines_criticality` | **Turbo lidera** | Mapa de Valores | |
| `attributes.hostingType` | `hosting_type` | **Turbo lidera** | Direto | |
| `attributes.installStatus` | `install_status` | SNOW lidera | Direto | |
| `attributes.ipAddress` | `ip_address` | SNOW lidera | Direto | |

Configuração do mapa de valores para `businessCriticality`:

```json
{
  "mapping": {
    "1 - most critical": "missionCritical",
    "2 - somewhat critical": "businessCritical",
    "3 - less critical": "businessOperational",
    "4 - not critical": "administrativeService"
  }
}
```

**Dica para a primeira sincronização**: No primeiro pull, os valores do SNOW preenchem todos os campos (já que os cards ainda não existem). Depois disso, os campos liderados pelo Turbo são de propriedade da equipe de EA — pulls subsequentes atualizam apenas os campos operacionais liderados pelo SNOW (status de instalação, IP), enquanto a equipe de EA gerencia todo o resto diretamente no Turbo EA.

**Após a importação**: Refine os nomes das aplicações, escreva descrições estratégicas, mapeie para Capacidades de Negócio, adicione avaliações de adequação funcional/técnica e defina fases do ciclo de vida — tudo isso agora é de propriedade do Turbo EA e será enviado de volta ao ServiceNow nas sincronizações push.

---

### Receita 2: Componentes de TI (Servidores)

**Objetivo**: Importar a infraestrutura de servidores para mapeamento de infraestrutura e análise de dependências. Servidores são mais operacionais que aplicações, então mais campos vêm do SNOW — mas o Turbo EA ainda lidera nomes e descrições.

**Mapeamento:**

| Configuração | Valor |
|--------------|-------|
| Tipo de Card | ITComponent |
| Tabela SNOW | `cmdb_ci_server` |
| Direção | Bidirecional |
| Modo | Conservador |
| Filtro | `active=true^hardware_statusNOT IN6,7` |

**Mapeamentos de campo:**

| Campo Turbo EA | Campo SNOW | Direção | Transformação | ID? |
|----------------|------------|---------|---------------|-----|
| `name` | `name` | **Turbo lidera** | Direto | Sim |
| `description` | `short_description` | **Turbo lidera** | Direto | |
| `attributes.manufacturer` | `manufacturer.name` | **Turbo lidera** | Direto | |
| `attributes.operatingSystem` | `os` | SNOW lidera | Direto | |
| `attributes.ipAddress` | `ip_address` | SNOW lidera | Direto | |
| `attributes.serialNumber` | `serial_number` | SNOW lidera | Direto | |
| `attributes.hostname` | `host_name` | SNOW lidera | Direto | |

**Observação**: Para servidores, campos operacionais/de descoberta como SO, IP, número de série e hostname naturalmente vêm da descoberta automatizada do SNOW. Mas a equipe de EA ainda possui o nome de exibição (que pode diferir do hostname) e a descrição para contexto estratégico.

**Após a importação**: Vincule Componentes de TI a Aplicações usando relações, o que alimenta o grafo de dependências e os relatórios de infraestrutura.

---

### Receita 3: Produtos de Software com Rastreamento de EOL

**Objetivo**: Importar produtos de software e combinar com a integração endoflife.date do Turbo EA. O Turbo EA lidera em nomes, descrições e fornecedor — a versão é um campo factual que o SNOW pode liderar.

**Mapeamento:**

| Configuração | Valor |
|--------------|-------|
| Tipo de Card | ITComponent |
| Tabela SNOW | `cmdb_ci_spkg` |
| Direção | Bidirecional |
| Modo | Conservador |
| Filtro | `active=true` |

**Mapeamentos de campo:**

| Campo Turbo EA | Campo SNOW | Direção | Transformação | ID? |
|----------------|------------|---------|---------------|-----|
| `name` | `name` | **Turbo lidera** | Direto | Sim |
| `description` | `short_description` | **Turbo lidera** | Direto | |
| `attributes.version` | `version` | SNOW lidera | Direto | |
| `attributes.vendor` | `manufacturer.name` | **Turbo lidera** | Direto | |

**Após a importação**: Vá em **Admin > EOL** e use Busca em Massa para automaticamente corresponder Componentes de TI importados com produtos do endoflife.date. Isso fornece rastreamento automatizado de risco EOL que combina inventário do CMDB com dados públicos de ciclo de vida.

---

### Receita 4: Fornecedores / Provedores (Bidirecional)

**Objetivo**: Manter o registro de fornecedores sincronizado. O Turbo EA possui nomes de fornecedores, descrições e contexto estratégico. O SNOW complementa com dados operacionais de contato.

**Mapeamento:**

| Configuração | Valor |
|--------------|-------|
| Tipo de Card | Provider |
| Tabela SNOW | `core_company` |
| Direção | Bidirecional |
| Modo | Aditivo |
| Filtro | `vendor=true` |

**Mapeamentos de campo:**

| Campo Turbo EA | Campo SNOW | Direção | Transformação | ID? |
|----------------|------------|---------|---------------|-----|
| `name` | `name` | **Turbo lidera** | Direto | Sim |
| `description` | `notes` | **Turbo lidera** | Direto | |
| `attributes.website` | `website` | **Turbo lidera** | Direto | |
| `attributes.contactEmail` | `email` | SNOW lidera | Direto | |

**Por que o Turbo lidera na maioria dos campos**: A equipe de EA cura a estratégia de fornecedores, gerencia relacionamentos e rastreia riscos — isso inclui o nome de exibição do fornecedor, descrição e presença web. O SNOW lidera apenas em dados operacionais de contato que podem ser atualizados por equipes de compras ou gestão de ativos.

---

### Receita 5: Enviar Avaliações do EA de Volta ao ServiceNow

**Objetivo**: Exportar avaliações específicas do EA para campos personalizados do ServiceNow para que as equipes ITSM possam ver o contexto do EA.

**Mapeamento:**

| Configuração | Valor |
|--------------|-------|
| Tipo de Card | Application |
| Tabela SNOW | `cmdb_ci_business_app` |
| Direção | Turbo EA -> ServiceNow |
| Modo | Aditivo |

**Mapeamentos de campo:**

| Campo Turbo EA | Campo SNOW | Direção | Transformação | ID? |
|----------------|------------|---------|---------------|-----|
| `name` | `name` | SNOW lidera | Direto | Sim |
| `attributes.businessCriticality` | `u_ea_business_criticality` | Turbo lidera | Mapa de Valores | |
| `attributes.functionalSuitability` | `u_ea_functional_fit` | Turbo lidera | Mapa de Valores | |
| `attributes.technicalSuitability` | `u_ea_technical_fit` | Turbo lidera | Mapa de Valores | |

> **Importante**: A sincronização push para campos personalizados (prefixados com `u_`) requer que essas colunas já existam no ServiceNow. Trabalhe com seu administrador do ServiceNow para criá-las antes de configurar o mapeamento de push. A conta de serviço precisa do papel `import_admin` para acesso de escrita.

**Por que isso importa**: As equipes ITSM veem as avaliações do EA diretamente nos fluxos de trabalho de incidentes/mudanças do ServiceNow. Quando uma aplicação "Missão Crítica" tem um incidente, as regras de escalonamento de prioridade podem usar a pontuação de criticidade fornecida pelo EA.

---

## Referência de Tipos de Transformação

### Direto (padrão)

Passa o valor sem alteração. Use para campos de texto que possuem o mesmo formato em ambos os sistemas.

### Mapa de Valores

Traduz valores enumerados entre sistemas. Configure com um mapeamento JSON:

```json
{
  "mapping": {
    "1": "missionCritical",
    "2": "businessCritical",
    "3": "businessOperational",
    "4": "administrativeService"
  }
}
```

O mapeamento se inverte automaticamente ao enviar do Turbo EA para o ServiceNow. Por exemplo, durante o push, `"missionCritical"` se torna `"1"`.

### Formato de Data

Trunca valores datetime do ServiceNow (`2024-06-15 14:30:00`) para apenas data (`2024-06-15`). Use para datas de fases do ciclo de vida onde o horário é irrelevante.

### Booleano

Converte entre booleanos de string do ServiceNow (`"true"`, `"1"`, `"yes"`) e booleanos nativos. Útil para campos como "is_virtual", "active", etc.

---

## Melhores Práticas de Segurança

### Gestão de Credenciais

| Prática | Detalhes |
|---------|----------|
| **Criptografia em repouso** | Todas as credenciais criptografadas via Fernet (AES-128-CBC) derivado da `SECRET_KEY`. Se você rotacionar a `SECRET_KEY`, reinsira todas as credenciais do ServiceNow. |
| **Menor privilégio** | Crie uma conta de serviço SNOW dedicada com acesso somente leitura a tabelas específicas. Conceda acesso de escrita apenas se usar sincronização push. |
| **OAuth 2.0 preferido** | Basic Auth envia credenciais em cada chamada API. OAuth usa tokens de curta duração com restrições de escopo. |
| **Rotação de credenciais** | Rotacione senhas ou client secrets a cada 90 dias. |

### Segurança de Rede

| Prática | Detalhes |
|---------|----------|
| **HTTPS obrigatório** | URLs HTTP são rejeitadas no momento da validação. Todas as conexões devem usar HTTPS. |
| **Validação de nome de tabela** | Nomes de tabela validados contra `^[a-zA-Z0-9_]+$` para prevenir injeção. |
| **Validação de sys_id** | Valores de sys_id validados como strings hexadecimais de 32 caracteres. |
| **Lista de IPs permitidos** | Configure o Controle de Acesso por IP do ServiceNow para permitir apenas o IP do seu servidor Turbo EA. |

### Controle de Acesso

| Prática | Detalhes |
|---------|----------|
| **Protegido por RBAC** | Todos os endpoints do ServiceNow requerem a permissão `servicenow.manage`. |
| **Trilha de auditoria** | Todas as alterações criadas pela sincronização publicam eventos com `source: "servicenow_sync"`, visíveis no histórico do card. |
| **Sem exposição de credenciais** | Senhas e secrets nunca são retornados nas respostas da API. |

### Checklist de Produção

- [ ] Conta de serviço dedicada do ServiceNow (não uma conta pessoal)
- [ ] OAuth 2.0 com concessão de credenciais de cliente
- [ ] Cronograma de rotação de credenciais (a cada 90 dias)
- [ ] Conta de serviço restrita apenas às tabelas mapeadas
- [ ] Lista de IPs permitidos do ServiceNow configurada para o IP do servidor Turbo EA
- [ ] Taxa máxima de exclusão definida em 50% ou menos
- [ ] Execuções de sincronização monitoradas para contagens incomuns de erros ou exclusões
- [ ] Consultas de filtro incluem `active=true` no mínimo

---

## Manual Operacional

### Sequência de Configuração Inicial

```
1. Criar conta de serviço do ServiceNow com os papéis mínimos necessários
2. Verificar conectividade de rede (o Turbo EA consegue alcançar o SNOW via HTTPS?)
3. Criar conexão no Turbo EA e testá-la
4. Verificar se os tipos do metamodelo possuem todos os campos que deseja sincronizar
5. Criar primeiro mapeamento com modo ADITIVO, staging ATIVADO
6. Usar o botão Pré-visualizar (via API) para verificar se o mapeamento produz saída correta
7. Executar primeira sincronização pull — revisar registros em staging no Painel de Sincronização
8. Aplicar registros em staging
9. Verificar cards importados no Inventário
10. Ajustar mapeamentos de campo se necessário, re-executar
11. Mudar mapeamento para modo CONSERVADOR para uso contínuo
12. Após várias execuções bem-sucedidas, ativar Pular Staging para automação
```

### Operações Contínuas

| Tarefa | Frequência | Como |
|--------|------------|------|
| Executar sincronização pull | Diariamente ou semanalmente | Painel de Sincronização > Botão Pull (ou cron) |
| Revisar estatísticas de sincronização | Após cada execução | Verificar contagens de erros/exclusões |
| Testar conexões | Mensalmente | Clicar no botão de teste em cada conexão |
| Rotacionar credenciais | Trimestralmente | Atualizar tanto no SNOW quanto no Turbo EA |
| Revisar mapa de identidade | Trimestralmente | Verificar entradas órfãs via estatísticas de sincronização |
| Auditar histórico de cards | Conforme necessário | Filtrar eventos por fonte `servicenow_sync` |

### Configurar Sincronizações Automatizadas

Sincronizações podem ser disparadas via API para automação:

```bash
# Sincronização pull diária às 2:00 da manhã
0 2 * * * curl -s -X POST \
  -H "Authorization: Bearer $TURBOEA_TOKEN" \
  "https://turboea.empresa.com/api/v1/servicenow/sync/pull/$MAPPING_ID" \
  >> /var/log/turboea-sync.log 2>&1
```

**Melhor prática**: Execute sincronizações durante horários fora do pico. Para tabelas grandes do CMDB (10.000+ CIs), espere 2-5 minutos dependendo da latência de rede e contagem de registros.

### Planejamento de Capacidade

| Tamanho do CMDB | Duração Esperada | Recomendação |
|-----------------|------------------|--------------|
| < 500 CIs | < 30 segundos | Sincronizar diariamente, staging opcional |
| 500-5.000 CIs | 30s - 2 minutos | Sincronizar diariamente, pular staging |
| 5.000-20.000 CIs | 2-5 minutos | Sincronizar à noite, pular staging |
| 20.000+ CIs | 5-15 minutos | Sincronizar semanalmente, usar consultas de filtro para dividir |

---

## Solução de Problemas

### Problemas de Conexão

| Sintoma | Causa | Solução |
|---------|-------|---------|
| `Connection failed: [SSL]` | Certificado autoassinado ou expirado | Garanta que o SNOW use um certificado de CA pública válido |
| `HTTP 401: Unauthorized` | Credenciais incorretas | Reinsira usuário/senha; verifique se a conta não está bloqueada |
| `HTTP 403: Forbidden` | Papéis insuficientes | Conceda `itil` e `cmdb_read` à conta de serviço |
| `Connection failed: timed out` | Bloqueio de firewall | Verifique as regras; adicione o IP do Turbo EA à lista de permitidos no SNOW |
| Teste OK mas sincronização falha | Permissões de nível de tabela | Conceda acesso de leitura à tabela CMDB específica |

### Problemas de Sincronização

| Sintoma | Causa | Solução |
|---------|-------|---------|
| 0 registros buscados | Tabela ou filtro incorreto | Verifique o nome da tabela; simplifique a consulta de filtro |
| Todos os registros são "create" | Incompatibilidade de identidade | Marque `name` como identidade; verifique se os nomes correspondem entre os sistemas |
| Alta contagem de erros | Falhas de transformação | Verifique os registros em staging para mensagens de erro |
| Exclusões ignoradas | Taxa excedida | Aumente o limite ou investigue por que os CIs desapareceram |
| Alterações não visíveis | Cache do navegador | Atualize a página; verifique o histórico do card para eventos |
| Cards duplicados | Múltiplos mapeamentos para o mesmo tipo | Use um mapeamento por tipo de card por conexão |
| Alterações push rejeitadas | Permissões SNOW insuficientes | Conceda o papel `import_admin` à conta de serviço |

### Ferramentas de Diagnóstico

```bash
# Pré-visualizar como os registros serão mapeados (5 amostras, sem efeitos colaterais)
POST /api/v1/servicenow/mappings/{mapping_id}/preview

# Navegar tabelas na instância SNOW
GET /api/v1/servicenow/connections/{conn_id}/tables?search=cmdb

# Inspecionar colunas de uma tabela
GET /api/v1/servicenow/connections/{conn_id}/tables/cmdb_ci_business_app/fields

# Filtrar registros em staging por ação ou status
GET /api/v1/servicenow/sync/runs/{run_id}/staged?action=create
GET /api/v1/servicenow/sync/runs/{run_id}/staged?action=update
GET /api/v1/servicenow/sync/runs/{run_id}/staged?status=error
```

---

## Referência da API (Rápida)

Todos os endpoints requerem `Authorization: Bearer <token>` e permissão `servicenow.manage`. Caminho base: `/api/v1`.

### Conexões

| Método | Caminho | Descrição |
|--------|---------|-----------|
| GET | `/servicenow/connections` | Listar conexões |
| POST | `/servicenow/connections` | Criar conexão |
| GET | `/servicenow/connections/{id}` | Obter conexão |
| PATCH | `/servicenow/connections/{id}` | Atualizar conexão |
| DELETE | `/servicenow/connections/{id}` | Excluir conexão + todos os mapeamentos |
| POST | `/servicenow/connections/{id}/test` | Testar conectividade |
| GET | `/servicenow/connections/{id}/tables` | Navegar tabelas SNOW |
| GET | `/servicenow/connections/{id}/tables/{table}/fields` | Listar colunas da tabela |

### Mapeamentos

| Método | Caminho | Descrição |
|--------|---------|-----------|
| GET | `/servicenow/mappings` | Listar mapeamentos com mapeamentos de campo |
| POST | `/servicenow/mappings` | Criar mapeamento com mapeamentos de campo |
| GET | `/servicenow/mappings/{id}` | Obter mapeamento com mapeamentos de campo |
| PATCH | `/servicenow/mappings/{id}` | Atualizar mapeamento (substitui campos se fornecidos) |
| DELETE | `/servicenow/mappings/{id}` | Excluir mapeamento |
| POST | `/servicenow/mappings/{id}/preview` | Pré-visualização simulada (5 registros de amostra) |

### Operações de Sincronização

| Método | Caminho | Descrição |
|--------|---------|-----------|
| POST | `/servicenow/sync/pull/{mapping_id}` | Sincronização pull (`?auto_apply=true` padrão) |
| POST | `/servicenow/sync/push/{mapping_id}` | Sincronização push |
| GET | `/servicenow/sync/runs` | Listar histórico de sincronização (`?limit=20`) |
| GET | `/servicenow/sync/runs/{id}` | Obter detalhes da execução + estatísticas |
| GET | `/servicenow/sync/runs/{id}/staged` | Listar registros em staging de uma execução |
| POST | `/servicenow/sync/runs/{id}/apply` | Aplicar registros em staging pendentes |
