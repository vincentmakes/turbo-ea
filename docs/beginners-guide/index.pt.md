# Seus Primeiros 30 Dias com o Turbo EA

Então você instalou o Turbo EA. A tela de login funciona, os dados de demonstração carregam, cada item de menu mostra algo para você — e agora você está olhando para um inventário vazio se perguntando por onde realmente começar. Este guia é para você.

É um passo a passo sequenciado e opinativo da **primeira iniciativa concreta de EA** que a maioria das organizações executa no Turbo EA: colocar um inventário de aplicações sob controle e usá-lo para responder perguntas reais de portfólio. Ele deliberadamente ignora os módulos mais avançados (Registro de Riscos, Compliance, PPM, TurboLens AI) — eles se tornam úteis quando seu inventário está vivo, não antes.

## Para quem é este guia

- **Arquitetos Corporativos** iniciando uma nova prática de EA ou migrando de planilhas, Confluence ou outra ferramenta.
- **Arquitetos de Soluções e Donos de Aplicações** solicitados a "preencher a ferramenta de EA" sem muito contexto.
- **Administradores** preparando a plataforma para uma adoção mais ampla.

Você precisará do papel de **admin** (ou pelo menos `admin.metamodel` e `inventory.edit`) para seguir cada etapa. Papéis somente leitura ainda podem se beneficiar — eles apenas não poderão fazer as mudanças de metamodelo na página 5.

## A jornada crawl → walk → run

Não tente modelar a empresa inteira na primeira semana. As equipes que têm sucesso com ferramentas de EA seguem um caminho faseado:

1. **Crawl (engatinhar)** — Um escopo restrito (um domínio de negócio, um país, uma plataforma). Um tipo de card (Aplicações). Cinco campos por card. Chegue a dados "bons o suficiente" em 50–200 cards.
2. **Walk (andar)** — Adicione Capacidades de Negócio do catálogo incluído. Mapeie aplicações para capacidades. Execute sua primeira análise de portfólio. Mostre-a a um stakeholder.
3. **Run (correr)** — Expanda para processos, interfaces, objetos de dados. Adicione mais campos personalizados. Abra os módulos mais avançados.

Este guia cobre **crawl** e o início de **walk**. Ao final, você terá um portfólio de aplicações funcional com uma disposição TIME (**T**olerar / **I**nvestir / **M**igrar / **E**liminar) e um Relatório de Portfólio que você pode colocar diante de um CIO.

## O que há neste guia

| # | Página | O que você fará |
|---|--------|-----------------|
| 1 | [Planeje seu rollout](plan-your-rollout.md) | Defina o escopo da iniciativa, escolha stakeholders, estabeleça uma meta realista de qualidade de dados |
| 2 | [Comece com seu inventário de aplicações](start-with-applications.md) | Popule as Aplicações via importação, ServiceNow ou entrada manual |
| 3 | [Aproveite os catálogos de referência](leverage-reference-catalogues.md) | Pule meses de modelagem manual importando capacidades e processos |
| 4 | [Personalize o metamodelo — levemente](customise-the-metamodel.md) | Adicione um campo personalizado (TIME) da maneira correta |
| 5 | [Sua primeira análise: Harmonização de Aplicações](your-first-analysis.md) | Mapeie aplicações para capacidades, execute o Relatório de Portfólio e o Mapa de Calor de Capacidades |

!!! tip "Boa prática"
    Leia todas as cinco páginas em ordem antes de abrir o Turbo EA. O plano em sua cabeça vale mais do que os primeiros 50 cards no inventário.

## Pré-requisitos

- Uma instância do Turbo EA em execução (consulte [Instalação e Configuração](../getting-started/setup.md)).
- Uma conta de administrador (o primeiro usuário a se registrar se torna admin automaticamente).
- **Opcional, mas recomendado para usuários iniciantes:** inicie a stack com `SEED_DEMO=true` uma vez para ver como é um inventário populado (a empresa fictícia NexaTech Industries). Você pode então resetar com `RESET_DB=true` e começar limpo com seus dados reais.
- Uma ideia geral do **domínio de negócio** que você quer modelar primeiro. "Toda a TI" não é um domínio.

## O que você vai pular — por enquanto

Estes são módulos poderosos, mas presumem que você já tenha um inventário populado. Não os abra ainda:

- **Registro de Riscos** e **Varredura de Compliance** — úteis quando você tiver aplicações e capacidades às quais anexar riscos.
- **PPM** (Project Portfolio Management) — útil quando você tiver um pipeline de projetos que valha a pena rastrear.
- **TurboLens AI** (análise de fornecedores, detecção de duplicatas, assistente Architect) — útil quando você tiver cards suficientes para que a IA encontre padrões.

Você encontrará um curto indicador "próximos passos" para cada um deles na [página final](your-first-analysis.md) deste guia.

Pronto? Vá para [Planeje seu rollout](plan-your-rollout.md).
