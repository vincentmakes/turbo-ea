# Transferência de workspace

A Transferência de workspace (**Administração → Configurações → Migração → Transferência de workspace**) move um workspace inteiro do Turbo EA de uma instância para outra como um único pacote autocontido. O caso de uso principal: você constrói um workspace numa instância **local** e precisa promover tudo para **Produção**.

![Transferência de workspace](../assets/img/pt/58_workspace_transfer.png)

## O que está incluído

A exportação captura o workspace completo como um pacote `.zip` contendo uma planilha Excel (todos os dados estruturados, uma aba por domínio) e, quando relevante, uma pasta `assets/` para arquivos não estruturados:

- **Metamodelo** — tipos de card e tipos de relação, incluindo todos os campos personalizados, subtipos, seções e traduções.
- **Configuração** — papéis, papéis de partes interessadas por tipo, grupos de tags e tags, campos calculados, princípios de EA e regulamentos de conformidade.
- **Configurações** — moeda, formato de data, feature flags, branding de login, locales habilitados e o restante das configurações gerais da aplicação.
- **Usuários** — e-mail, nome de exibição, papel e flag de ativo (usados para revincular propriedade e atribuições no destino). Sem senhas ou identidades SSO.
- **Inventário** — cada card (com sua hierarquia, ciclo de vida e atributos), tags de card e relações.
- **Contexto do card** — partes interessadas, links de documentos, comentários, tarefas e anexos de arquivo.
- **Dados de módulos** — BPM (diagramas de processo, elementos, versões de fluxo, avaliações), PPM (relatórios de status, custos, orçamentos, riscos, tarefas, WBS, dependências), o registro de riscos do GRC (riscos, tarefas de mitigação e ocorrências, vínculos de card), as descobertas de conformidade do GRC (com as execuções de análise que elas referenciam), decisões de arquitetura e Statements of Architecture Work, diagramas de desenho livre, relatórios salvos, marcadores (visualizações salvas do inventário, incluindo seus compartilhamentos), portais web e pesquisas.
- **Assets** — anexos de arquivo binários, XML de diagramas e BPMN, e o logo/favicon viajam como arquivos separados dentro da pasta `assets/` do pacote.

## O que nunca está incluído

Por segurança, **os segredos nunca são exportados**:

- Senha SMTP
- Segredo de cliente SSO
- Chave de API do provedor de IA
- Credenciais do ServiceNow

Você precisa reinseri-los na instância de destino após importar. Isso é inevitável por design: valores criptografados estão atrelados ao `SECRET_KEY` da instância de origem e não podem ser descriptografados em nenhum outro lugar.

Algumas outras coisas ficam para trás por design:

- **Os resultados de análise do TurboLens** (análise de fornecedores, clusters de duplicatas, avaliações de modernização, avaliações de arquitetura salvas) e o histórico de KPIs do dashboard são locais à instância — execute novamente as análises no destino. As descobertas de conformidade são a exceção e são transferidas.
- **O estado local do navegador** nunca é transferido: a ordenação ad hoc de colunas da grade do inventário vive no armazenamento local do seu navegador, não no banco de dados. O layout de colunas que você salvou **dentro de uma Visualização Salva** é transferido junto com a visualização.

## Exportando

1. Abra **Administração → Configurações → Migração → Transferência de workspace**.
2. (Opcional) marque **Incluir cards arquivados** para adicionar o inventário arquivado ao pacote.
3. Clique em **Exportar pacote**. Seu navegador baixa `workspace_export_<timestamp>.zip`.

## Importando

1. Na instância de **destino**, abra **Administração → Configurações → Migração → Transferência de workspace**.
2. Em **Importar workspace**, clique em **Escolher pacote…** e selecione o `.zip` que você exportou.
3. O Turbo EA analisa o pacote e exibe uma **pré-visualização em dry-run** — uma tabela por seção mostrando quantas entidades seriam criadas, atualizadas, ignoradas ou estão em conflito. Nada é gravado ainda.
4. Revise a pré-visualização e então clique em **Aplicar importação**.

A importação é **idempotente**: metamodelo e configuração são correspondidos por chave, cards por external id ou por tipo + caminho de hierarquia, e usuários por e-mail. Reimportar o mesmo pacote é seguro — entidades já presentes são ignoradas em vez de duplicadas. Tipos de metamodelo built-in existentes mantêm sua identidade; apenas seu schema editável é mesclado.

### Lendo a pré-visualização

- **Ignorado significa «já presente — nenhuma ação necessária».** Em uma instalação nova você normalmente verá itens ignorados para o conteúdo que acompanha o Turbo EA (papéis de partes interessadas, tipos de recurso, configurações padrão), porque a cópia do pacote é idêntica ao que o destino já tem. Expanda uma linha de seção (a seta à esquerda) para ver o detalhamento por motivo e quaisquer mensagens de conflito ou falha.
- **Aviso de versão.** A pré-visualização mostra de qual versão do Turbo EA o pacote foi exportado e avisa quando ela difere da instância que está importando. O aviso é apenas informativo — a importação é executada mesmo assim — mas exportar e importar na mesma versão é o caminho mais seguro.

## Após importar

- Reinsira quaisquer credenciais de SMTP, SSO e IA em suas respectivas abas de configurações.
- Usuários sintéticos referenciados pelo pacote são criados **desativados**; ative-os em **Administração → Usuários** conforme necessário.
- **Dados pertencentes ao usuário seguem o usuário, correspondido por e-mail.** Tarefas, visualizações salvas, favoritos e outros dados pessoais pertencem à conta cujo e-mail corresponde ao do pacote. Se você entrar no destino com um e-mail diferente do que usou na origem, seus itens pessoais parecerão estar faltando — eles estão vinculados à conta correspondente (possivelmente desativada). Entre com o mesmo e-mail, ou ative a conta correspondente em **Administração → Usuários**.
- Visualizações salvas privadas são visíveis apenas para o proprietário; visualizações compartilhadas e públicas seguem suas configurações de visibilidade.

## Começando do zero

Não há um «desfazer importação» embutido. Para redefinir uma instância de destino e reimportar do zero, reinicie-a uma vez com `RESET_DB=true` (apaga e recria todas as tabelas e depois refaz o seed), e então volte para `RESET_DB=false` **antes** da próxima reinicialização para não apagar os dados recém-importados.

## Permissões

A Transferência de workspace é controlada por duas permissões dedicadas, ambas concedidas aos administradores:

- `admin.export_workspace` — exportar o pacote.
- `admin.import_workspace` — pré-visualizar e aplicar uma importação.
