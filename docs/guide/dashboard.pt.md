# Painel Principal

O Painel Principal é a primeira tela que você vê após fazer login. Ele fornece uma **visão geral rápida** de todo o status da arquitetura empresarial.

![Painel Principal - Visão Superior](../assets/img/pt/01_painel.png)

## Barra de Navegação Superior

Na parte superior da tela, você encontrará a **barra de navegação principal** com os seguintes elementos:

- **Turbo EA** (logo): Clique para retornar ao Painel Principal de qualquer seção
- **Painel**: Visão geral do status da arquitetura
- **Inventário**: Listagem completa de todos os cards
- **Relatórios**: Relatórios visuais e analíticos
- **BPM**: Business Process Management (se habilitado)
- **Diagramas**: Editor visual de diagramas de arquitetura
- **Entrega EA**: Gestão de iniciativas de arquitetura
- **Tarefas**: Tarefas pendentes e pesquisas atribuídas
- **Pesquisar cards**: Barra de busca rápida com autocompletar
- **+ Criar**: Botão para criar rapidamente novos cards
- **Sino de notificações**: Alertas do sistema e [notificações](notifications.md)
- **Ícone de perfil**: Seleção de idioma, alternância de tema, preferências de notificação e acesso à administração
- **Apoiar**: Um botão roxo a rosa ao lado do número da versão no menu de perfil abre uma caixa de diálogo que explica por que o patrocínio é importante, com uma ligação para o blogue e opções únicas ou mensais através do GitHub Sponsors

## Cards de Resumo

A seção principal do Painel exibe **cards de resumo** indicando:

- **Número total de cards**: Contagem de todos os componentes registrados na plataforma
- **Distribuição por tipo**: Quantos elementos de cada tipo existem (Aplicações, Organizações, Objetivos, Capacidades, etc.)
- **Visão geral de status**: Visualizações rápidas do status geral

Clicar em um card de tipo navega para o [Inventário](inventory.md) pré-filtrado para esse tipo.

![Painel Principal - Visão Inferior com Gráficos](../assets/img/pt/02_painel_inferior.png)

## Gráficos e Estatísticas

Na seção inferior do Painel, você encontrará:

- **Gráfico de distribuição por tipo**: Mostra a proporção de cada tipo de card no seu cenário
- **Status de aprovação**: Indica quantos cards estão aprovados, pendentes, quebrados ou rejeitados
- **Qualidade dos dados**: Porcentagem geral de completude das informações em todos os cards
- **Atividade recente**: Um feed das últimas alterações — quem editou o quê e quando

## Aba «Espaço de trabalho»

A aba **Espaço de trabalho** reúne tudo o que está atribuído a você: favoritos, tarefas, pesquisas pendentes, atividade recente em seus cards e a seção **Cards com meu papel**.

Esta última agrupa os cards pelo papel de parte interessada que você desempenha (Application Owner, Business Owner, etc.) e lista os cards sob cada papel. Se seu papel concede a permissão `stakeholders.view` (admin, member e viewer por padrão), um pequeno ícone **person_search** aparece ao lado do título da seção: selecione um usuário na autocompletação e a seção é recarregada com os papéis e cards dele. O título muda para «Funções desempenhadas por {name}». Clique no pequeno ícone de fechar para voltar aos seus próprios papéis. Útil para responder a «o que essa pessoa possui?» com um clique.

## Aba «Administração» — Diretório de partes interessadas

Administradores (qualquer função com `admin.users`) veem um widget **Diretório de partes interessadas** na parte inferior da aba Administração. Ele lista cada tipo de cartão com pelo menos uma parte interessada, junto com o número de titulares distintos. Expanda um tipo de cartão para ver suas funções e, dentro de cada função, os usuários com o número de cartões que cobrem. Clique em um chip de usuário para expandir sua lista de cartões logo abaixo — cada nome de cartão é um link para a página de detalhe. Toda a árvore (tipo de cartão → função → usuário → cartões) chega em uma única ida-e-volta, então a navegação é instantânea.

Um **filtro por nome** no topo do widget restringe a árvore aos usuários que correspondem ao nome ou e-mail digitado; os tipos de cartão correspondentes se auto-expandem para que as correspondências fiquem visíveis sem um clique adicional. Útil para responder «onde Alice aparece na organização?» em um segundo.

Além do diretório, um pequeno **popover de hover** abre sempre que o cursor pausa sobre o nome de uma parte interessada em outras partes do aplicativo — na aba Partes interessadas de um cartão, sobre um proprietário de risco no Registro de riscos ou na página de detalhe de risco — mostrando o portfólio completo daquela pessoa agrupado por função. Clique em qualquer cartão no popover para ir até ele. O popover só busca uma vez por usuário por sessão.
