# Configurações

A página de **Configurações** em **Admin → Configurações** (`/admin/settings`) é o hub central de configuração. Está organizada em abas — escolha a aba certa na tabela abaixo para o aprofundamento dedicado:

| Aba | URL | O que controla | Guia completo |
|-----|-----|----------------|---------------|
| **Geral** | `/admin/settings?tab=general` | Aparência (logo, favicon, moeda, formato de data, idiomas habilitados, ano fiscal), e-mail SMTP, **alternâncias de módulos** (BPM, PPM, GRC, TurboLens, Sponsor button) | Esta página |
| **Autenticação** | `/admin/settings?tab=authentication` | Provedores SSO, registro, política de senha | [Autenticação e SSO](sso.md) |
| **IA** | `/admin/settings?tab=ai` | Provedor LLM, modelo, backend de busca web, alternâncias de sugestão IA por tipo de card | [Capacidades de IA](ai.md) |
| **EOL** | `/admin/settings?tab=eol` | Vinculação em massa de produtos a entradas de endoflife.date | [Fim de vida (EOL)](eol.md) |
| **Portais web** | `/admin/settings?tab=web-portals` | Slugs de portais públicos somente leitura, filtros de visibilidade | [Portais web](web-portals.md) |
| **ServiceNow** | `/admin/settings?tab=servicenow` | Conexão ServiceNow, configuração de sincronização, mapeamento de identidade | [Integração com ServiceNow](servicenow.md) |
| **TurboLens** | `/admin/settings?tab=turbolens` | Alternâncias específicas de TurboLens, regulamentações habilitadas, polling de análises | Veja a seção [Configurações do TurboLens](#configuracoes-do-turbolens) abaixo |

O restante desta página cobre a aba **Geral**.

![Configurações gerais](../assets/img/pt/28_admin_config_geral.png)

## Aparência

### Logo

Faça upload de um logotipo personalizado que aparece na barra de navegação superior. Formatos suportados: PNG, JPEG, SVG, WebP, GIF. Clique em **Redefinir** para reverter ao logotipo padrão do Turbo EA.

### Favicon

Faça upload de um ícone de navegador personalizado (favicon). A alteração entra em vigor no próximo carregamento de página. Clique em **Redefinir** para reverter ao ícone padrão.

### Moeda

Selecione a moeda usada para campos de custo em toda a plataforma. Isso afeta como os valores de custo são formatados nas páginas de detalhe de cards, relatórios e exportações. Mais de 40 moedas são suportadas, incluindo USD, EUR, GBP, JPY, CNY, CHF, INR, BRL, IDR e mais.

### Formato de data

Escolha como as datas são exibidas em todo o aplicativo. O formato selecionado aplica-se às datas de ciclo de vida dos cards, à grade de inventário, às assinaturas de ADR e SoAW, ao Registro de Riscos, aos relatórios e tarefas do PPM, às versões de fluxos de processos BPM, aos comentários, ao histórico, ao feed de atividade do painel, às notificações e às páginas de administração. Cinco formatos são oferecidos com pré-visualização em tempo real:

- `MM/DD/YYYY` — estilo EUA (ex. `04/29/2026`)
- `DD/MM/YYYY` — estilo europeu (ex. `29/04/2026`)
- `YYYY-MM-DD` — ISO 8601 (ex. `2026-04-29`)
- `DD MMM YYYY` — padrão (ex. `29 abr 2026`)
- `MMM DD, YYYY` (ex. `abr 29, 2026`)

As alterações entram em vigor imediatamente para todos os usuários — não é necessário recarregar.

### Idiomas Habilitados

Alterne quais idiomas estão disponíveis para os usuários no seletor de idioma. Todos os oito idiomas suportados podem ser individualmente habilitados ou desabilitados:

- English, Deutsch, Français, Español, Italiano, Português, 中文, Русский

Pelo menos um idioma deve permanecer habilitado o tempo todo.

### Início do Ano Fiscal

Selecione o mês em que o ano fiscal da sua organização começa (janeiro a dezembro). Esta configuração afeta como as **linhas de orçamento** no módulo PPM são agrupadas por ano fiscal. Por exemplo, se o ano fiscal começa em abril, uma linha de orçamento de junho de 2026 pertence ao AF 2026–2027.

O padrão é **janeiro** (ano civil = ano fiscal).

## Gestão de dados

Controle por quanto tempo as **fichas arquivadas** são mantidas antes de serem excluídas permanentemente.

Quando uma ficha é arquivada, ela fica oculta no inventário, nos relatórios e nas relações, mas mantém todo o seu histórico e pode ser restaurada a qualquer momento antes da purga.

| Campo | Descrição |
|-------|-----------|
| **Período de retenção (dias)** | Número de dias que uma ficha arquivada é mantida antes de ser excluída permanentemente. O padrão é **30**. |
| **Manter fichas arquivadas indefinidamente** | Quando ativado (retenção definida como **0**), as fichas arquivadas nunca são excluídas automaticamente e são mantidas — com o seu histórico — indefinidamente. |

A purga é executada de hora em hora e relê esta configuração a cada execução, portanto as alterações entram em vigor sem reiniciar a aplicação. Os avisos de arquivamento e as caixas de diálogo de confirmação refletem automaticamente o período configurado.

## E-mail (SMTP)

Configure a entrega de e-mail para convites, notificações de pesquisas e outras mensagens do sistema.

| Campo | Descrição |
|-------|-----------|
| **Host SMTP** | O hostname do seu servidor de e-mail (ex.: `smtp.gmail.com`) |
| **Porta SMTP** | Porta do servidor (tipicamente 587 para TLS) |
| **Usuário SMTP** | Nome de usuário para autenticação |
| **Senha SMTP** | Senha de autenticação (armazenada criptografada) |
| **Usar TLS** | Habilitar criptografia TLS (recomendado) |
| **Endereço de Remetente** | O endereço de e-mail do remetente para mensagens enviadas |
| **URL Base do App** | A URL pública da sua instância Turbo EA (usada em links de e-mail) |

Após configurar, clique em **Enviar E-mail de Teste** para verificar se as configurações funcionam corretamente.

!!! note
    E-mail é opcional. Se o SMTP não estiver configurado, recursos que enviam e-mails (convites, notificações de pesquisa) simplesmente ignorarão a entrega de e-mail.

## Módulo BPM

Alterne o módulo de **Business Process Management** ligado ou desligado. Quando desabilitado:

- O item de navegação **BPM** é oculto para todos os usuários
- Cards de Processo de Negócio permanecem no banco de dados, mas recursos específicos de BPM (editor de fluxo de processo, painel BPM, relatórios BPM) não estão acessíveis

Isso é útil para organizações que não usam BPM e desejam uma experiência de navegação mais limpa.

## Módulo PPM

Alterne o módulo de **Gestão de Portfólio de Projetos** (PPM) ligado ou desligado. Quando desabilitado:

- O item de navegação **PPM** é oculto para todos os usuários
- Cards de Iniciativa permanecem no banco de dados, mas recursos específicos de PPM (relatórios de status, acompanhamento de orçamento e custos, registro de riscos, quadro de tarefas, gráfico de Gantt) não estão acessíveis

Quando habilitado, cards de Iniciativa ganham uma aba **PPM** na sua visualização de detalhes e o painel do portfólio PPM fica disponível na navegação principal. Veja [Gestão de Portfólio de Projetos](../guide/ppm.md) para o guia completo de funcionalidades.

## Módulo GRC

Alterne o módulo de **Governança, Risco e Conformidade** (GRC) ligado ou desligado. Quando desabilitado:

- O item de navegação **GRC** é oculto para todos os usuários
- O workspace `/grc` (princípios de Governança e ADRs, Registro de Riscos, achados de Conformidade) deixa de estar acessível e exibe o placeholder padrão «módulo desabilitado» para quem chega por um link direto
- As abas **Riscos** e **Conformidade** no detalhe do card ficam ocultas, de modo que os cards individuais também não exibem mais dados de GRC
- Os riscos e os achados de conformidade permanecem no banco de dados — as permissões subjacentes `risks.*` e `compliance.*` continuam inalteradas, de modo que os dados são preservados e reaparecem sem alterações se o módulo for reativado

Consulte o [guia do GRC](../guide/grc.md) para a referência completa de funcionalidades.

## Botão Apoiar

Mostre ou oculte o botão **Apoiar** no menu de utilizador (avatar). Quando está oculto, os utilizadores deixam de ver o botão Apoiar no seu menu de perfil. O botão Apoiar — e a caixa de diálogo que explica como apoiar o Turbo EA — permanece sempre disponível neste painel de definições, pelo que os administradores ainda conseguem aceder-lhe mesmo quando está oculto no menu.

Se a sua empresa apoia o Turbo EA e gostaria que o seu logótipo fosse divulgado em turbo-ea.org, contacte [sponsorship@turbo-ea.org](mailto:sponsorship@turbo-ea.org).

## Configurações do TurboLens

A aba **TurboLens** reúne as alternâncias que regem a superfície de análise IA. Ao contrário dos interruptores por módulo acima, o TurboLens **não** é um on/off binário — está «pronto» quando tanto um provedor IA está configurado (na aba **IA**) quanto os dados de análise sincronizaram pelo menos uma vez. A página também expõe:

- **Regulamentações habilitadas** — marque quais dos seis frameworks integrados (EU AI Act, LGPD/GDPR, NIS2, DORA, SOC 2, ISO 27001) participam das [varreduras de Conformidade](../guide/compliance.md). Regulamentações personalizadas definidas em **Metamodelo → Regulamentações** também podem ser habilitadas aqui.
- **Cadência de polling de análises** — com que frequência a UI re-consulta as análises TurboLens de longa duração para obter progresso. Cadência maior = menor latência percebida, mais carga de API.
- **TTL do cache de resultados** — por quanto tempo os resultados de análises concluídas ficam em cache antes do botão **Executar análise** voltar a ser habilitado.

Veja [Inteligência IA TurboLens](../guide/turbolens.md) para a superfície de funcionalidades completa e [Conformidade](../guide/compliance.md) para o fluxo de varredura.
