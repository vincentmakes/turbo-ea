# Entregas de EA

O módulo de **Entregas de EA** gerencia **iniciativas de arquitetura e seus artefatos** — diagramas e Statements of Architecture Work (SoAW). Ele fornece uma visão única de todos os projetos de arquitetura em andamento e seus entregáveis.

![Gestão de Entregas de EA](../assets/img/en/17_ea_delivery.png)

## Visão Geral de Iniciativas

A página é organizada em torno de cards de **Iniciativa**. Cada iniciativa mostra:

| Campo | Descrição |
|-------|-----------|
| **Nome** | Nome da iniciativa |
| **Subtipo** | Ideia, Programa, Projeto ou Epic |
| **Status** | No Prazo, Em Risco, Fora do Prazo, Em Espera ou Concluído |
| **Artefatos** | Contagem de diagramas e documentos SoAW vinculados |

Você pode alternar entre uma visualização em **galeria de cartões** e uma visualização em **lista**, e filtrar iniciativas por status (Ativas ou Arquivadas).

Clicar em uma iniciativa a expande para mostrar todos os seus **diagramas** e **documentos SoAW** vinculados.

## Statement of Architecture Work (SoAW)

Um **Statement of Architecture Work (SoAW)** é um documento formal definido pelo [padrão TOGAF](https://pubs.opengroup.org/togaf-standard/) (The Open Group Architecture Framework). Ele estabelece o escopo, abordagem, entregáveis e governança para um engajamento de arquitetura. No TOGAF, o SoAW é produzido durante a **Fase Preliminar** e **Fase A (Visão de Arquitetura)** e serve como um acordo entre a equipe de arquitetura e suas partes interessadas.

O Turbo EA fornece um editor de SoAW integrado com templates de seções alinhados ao TOGAF, edição de texto rico e capacidades de exportação — para que você possa criar e gerenciar documentos SoAW diretamente junto com seus dados de arquitetura.

### Criando um SoAW

1. Clique em **+ Novo SoAW** dentro de uma iniciativa
2. Insira o título do documento
3. O editor abre com **templates de seções pré-construídos** baseados no padrão TOGAF

### O Editor de SoAW

O editor oferece:

- **Edição de texto rico** — Barra de ferramentas completa de formatação (títulos, negrito, itálico, listas, links) alimentada pelo editor TipTap
- **Templates de seções** — Seções predefinidas seguindo os padrões TOGAF (ex.: Descrição do Problema, Objetivos, Abordagem, Partes Interessadas, Restrições, Plano de Trabalho)
- **Tabelas editáveis inline** — Adicione e edite tabelas dentro de qualquer seção
- **Fluxo de status** — Documentos progridem através de estágios definidos:

| Status | Significado |
|--------|-------------|
| **Rascunho** | Sendo escrito, ainda não pronto para revisão |
| **Em Revisão** | Submetido para revisão das partes interessadas |
| **Aprovado** | Revisado e aceito |
| **Assinado** | Formalmente assinado |

### Fluxo de Assinatura

Uma vez que um SoAW é aprovado, você pode solicitar assinaturas das partes interessadas. Clique em **Solicitar Assinaturas** e use o campo de pesquisa para encontrar e adicionar signatários por nome ou e-mail. O sistema rastreia quem assinou e envia notificações para os signatários pendentes.

### Pré-visualização e Exportação

- **Modo de pré-visualização** — Visualização somente leitura do documento SoAW completo
- **Exportação DOCX** — Baixe o SoAW como um documento Word formatado para compartilhamento offline ou impressão

## Registros de Decisões de Arquitetura (ADR)

Um **Registro de Decisão de Arquitetura (ADR)** documenta decisões de arquitetura importantes junto com seu contexto, consequências e alternativas consideradas. Os ADR fornecem um histórico rastreável de por que escolhas de design fundamentais foram feitas.

### Visão Geral dos ADR

A página de Entregas de EA possui uma aba dedicada de **Decisões** que lista todos os ADR. Cada ADR mostra:

- Número de referência (gerado automaticamente: ADR-001, ADR-002, etc.)
- Título
- Status (Rascunho, Em Revisão, Assinado)
- Iniciativas vinculadas (via vinculação de cards)
- Signatários e seu status

Você pode filtrar por status e pesquisar por título ou número de referência.

### Criando um ADR

Os ADR podem ser criados a partir de três locais:

1. **Entregas de EA → aba Decisões**: Clique em **+ Novo ADR**, preencha o título e opcionalmente vincule cards (incluindo iniciativas).
2. **Botão «+» da iniciativa** (aba Iniciativas): Escolha **Nova Decisão de Arquitetura** no menu — a iniciativa é pré-vinculada como um vínculo de card.
3. **Aba Recursos do cartão**: Clique em **Criar ADR** — o cartão atual é pré-vinculado.

Em todos os casos, você pode pesquisar e vincular cartões adicionais durante a criação. As iniciativas são vinculadas através do mesmo mecanismo de vinculação de cards utilizado para qualquer outro card, o que significa que um ADR pode ser vinculado a múltiplas iniciativas. O editor abre com seções para Contexto, Decisão, Consequências e Alternativas Consideradas.

### O Editor de ADR

O editor oferece:

- Edição de texto rico para cada seção (Contexto, Decisão, Consequências, Alternativas Consideradas)
- Vinculação de cards — conecte o ADR a cards relevantes (aplicações, componentes de TI, iniciativas, etc.). As iniciativas são vinculadas através da funcionalidade padrão de vinculação de cards, não por meio de um campo dedicado, permitindo que um ADR referencie múltiplas iniciativas
- Decisões relacionadas — referencie outros ADR

### Fluxo de Assinatura

Os ADR suportam um processo formal de assinatura:

1. Crie o ADR com status **Rascunho**
2. Clique em **Solicitar Assinaturas** e pesquise signatários por nome ou e-mail
3. O ADR passa para **Em Revisão** — cada signatário recebe uma notificação e uma tarefa
4. Os signatários revisam e clicam em **Assinar**
5. Quando todos os signatários tiverem assinado, o ADR passa automaticamente para o status **Assinado**

ADR assinados ficam bloqueados e não podem ser editados. Para fazer alterações, crie uma **nova revisão**.

### Revisões

ADR assinados podem ser revisados:

1. Abra um ADR assinado
2. Clique em **Revisar** para criar um novo rascunho baseado na versão assinada
3. A nova revisão herda o conteúdo e os vínculos de cards
4. Cada revisão tem um número de revisão incremental

### Pré-visualização do ADR

Clique no ícone de pré-visualização para ver uma versão somente leitura e formatada do ADR — útil para revisão antes da assinatura.

## Aba de Recursos

Os cards agora incluem uma aba de **Recursos** que consolida:

- **Decisões de Arquitetura** — ADR vinculados a este card. Você pode vincular ADRs existentes ou criar um novo diretamente a partir da aba Recursos — o novo ADR é vinculado automaticamente ao card.
- **Anexos de Arquivos** — Carregue e gerencie arquivos (PDF, DOCX, XLSX, imagens, até 10 MB)
- **Links de Documentos** — Referências de documentos baseadas em URL
