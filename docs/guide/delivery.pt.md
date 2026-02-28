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

Uma vez que um SoAW é aprovado, você pode solicitar assinaturas das partes interessadas. O sistema rastreia quem assinou e envia notificações para os signatários pendentes.

### Pré-visualização e Exportação

- **Modo de pré-visualização** — Visualização somente leitura do documento SoAW completo
- **Exportação DOCX** — Baixe o SoAW como um documento Word formatado para compartilhamento offline ou impressão
