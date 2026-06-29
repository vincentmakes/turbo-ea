# Relatórios Salvos

O Turbo EA permite **salvar configurações de relatórios** para que você possa retornar rapidamente a visualizações específicas sem reconfigurar filtros e eixos a cada vez.

## Salvando um Relatório

A partir de qualquer página de relatório (Portfólio, Mapa de Capacidades, Ciclo de Vida, Dependências, Custos, Matriz, Qualidade dos Dados ou EOL):

1. Configure o relatório com os filtros, agrupamentos e seleções de eixos desejados
2. Clique no botão **Salvar** na barra de ferramentas do relatório
3. Insira um **nome** para o relatório salvo
4. Escolha a **visibilidade**:

| Visibilidade | Quem pode ver |
|--------------|---------------|
| **Privado** | Apenas você |
| **Compartilhado** | Você e usuários específicos que você selecionar |
| **Público** | Todos os usuários da plataforma |

Para relatórios compartilhados, você pode conceder **permissões de edição** a usuários específicos, permitindo que eles atualizem a configuração salva.

5. Clique em **Salvar** — uma miniatura é automaticamente capturada da visualização atual

## Galeria de Relatórios Salvos

Navegue até **Relatórios > Relatórios Salvos** para ver todos os relatórios salvos aos quais você tem acesso. A galeria mostra miniaturas de pré-visualização organizadas em abas:

- **Meus Relatórios** — Relatórios que você criou
- **Compartilhados Comigo** — Relatórios que outros compartilharam com você
- **Públicos** — Relatórios visíveis para todos

### Ações

- **Abrir** — Clique em um relatório para carregá-lo com a configuração salva
- **Editar** — Atualize o nome, visibilidade ou configurações de compartilhamento
- **Duplicar** — Crie uma cópia com um novo nome
- **Excluir** — Remova o relatório salvo (apenas o criador ou usuários com permissões de edição podem excluir)

## Relatórios personalizados com o seu assistente de IA

Além dos tipos de relatório integrados, o Turbo EA pode criar **relatórios totalmente personalizados** a partir de uma descrição em linguagem natural, usando um assistente de IA conectado através do **servidor MCP**.

### Como funciona

1. Conecte o servidor MCP do Turbo EA ao seu assistente de IA (por exemplo, Claude Code) — consulte o guia **Integração MCP**.
2. Descreva o relatório que deseja em linguagem natural, por exemplo *«Contar aplicações por criticidade de negócio como gráfico de pizza»* ou *«Custo anual total de componentes de TI agrupados por fornecedor»*.
3. O assistente chama `get_report_builder_schema` para ler o seu metamodelo ao vivo (tipos de cartão, campos, relações, etiquetas), monta uma **especificação** de relatório segura e a pré-visualiza com os seus dados reais usando `preview_custom_report`, de modo que vê resultados reais antes de salvar qualquer coisa.
4. Quando estiver satisfeito, o assistente **publica** o relatório com `create_saved_report`. Ele aparece na galeria de **Relatórios salvos** e abre como um relatório nativo e interativo.

### O que os relatórios personalizados podem fazer

- **Conscientes do metamodelo**: os seus tipos de cartão, subtipos, campos, relações e etiquetas são refletidos automaticamente, sem programação.
- **Agrupar e agregar**: agrupar por atributo, subtipo, fase do ciclo de vida, grupo de etiquetas ou cartão relacionado, e medir com contagem, soma, média, mínimo ou máximo.
- **Filtrar e percorrer**: filtrar os cartões de origem e, opcionalmente, seguir um salto de relação para cartões relacionados.
- **Muitas visualizações**: exibir como tabela, gráfico de barras/colunas/pizza/rosca/dispersão/treemap/linhas, ou como blocos de KPI.
- **Seguro e governado**: os relatórios são somente leitura, funcionam inteiramente com regras declarativas (sem código, sem SQL), e os campos de custo permanecem atrás da permissão **Ver custos**, exatamente como qualquer outro relatório.

Os relatórios personalizados são salvos como qualquer outro relatório, portanto, aplicam-se as mesmas opções de visibilidade e compartilhamento (privado / compartilhado / público).
