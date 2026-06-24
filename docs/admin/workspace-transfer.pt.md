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
- **Dados de módulos** — BPM (diagramas de processo, elementos, versões de fluxo, avaliações), PPM (relatórios de status, custos, orçamentos, riscos, tarefas, WBS, dependências), o registro de riscos do GRC (riscos, tarefas de mitigação e ocorrências, vínculos de card), decisões de arquitetura e Statements of Architecture Work, diagramas de desenho livre, relatórios salvos, marcadores, portais web e pesquisas.
- **Assets** — anexos de arquivo binários, XML de diagramas e BPMN, e o logo/favicon viajam como arquivos separados dentro da pasta `assets/` do pacote.

## O que nunca está incluído

Por segurança, **os segredos nunca são exportados**:

- Senha SMTP
- Segredo de cliente SSO
- Chave de API do provedor de IA
- Credenciais do ServiceNow

Você precisa reinseri-los na instância de destino após importar. Isso é inevitável por design: valores criptografados estão atrelados ao `SECRET_KEY` da instância de origem e não podem ser descriptografados em nenhum outro lugar.

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

## Após importar

- Reinsira quaisquer credenciais de SMTP, SSO e IA em suas respectivas abas de configurações.
- Usuários sintéticos referenciados pelo pacote são criados **desativados**; ative-os em **Administração → Usuários** conforme necessário.

## Permissões

A Transferência de workspace é controlada por duas permissões dedicadas, ambas concedidas aos administradores:

- `admin.export_workspace` — exportar o pacote.
- `admin.import_workspace` — pré-visualizar e aplicar uma importação.
