# Tags

O recurso de **Tags** (**Admin > Metamodelo > aba Tags**) permite criar rótulos de classificação que os usuários podem aplicar a cards. As tags são organizadas em **grupos de tags**, cada um com seu próprio modo de seleção, restrições de tipo e um indicador opcional de obrigatoriedade que se integra ao fluxo de aprovação e ao score de qualidade dos dados.

## Grupos de tags

Um grupo de tags é uma categoria de tags. Por exemplo, você pode criar grupos como «Domínio de Negócio», «Framework de Conformidade» ou «Propriedade da Equipe».

### Criar um grupo de tags

Clique em **+ Novo Grupo de Tags** e configure:

| Campo | Descrição |
|-------|-----------|
| **Nome** | Nome exibido no detalhe do card, nos filtros do inventário e nos relatórios. |
| **Descrição** | Texto livre opcional, visível apenas para administradores. |
| **Modo** | **Seleção única** — uma tag por card. **Seleção múltipla** — várias tags por card. |
| **Obrigatório** | Quando marcado, o grupo participa do portão de aprovação e do score de qualidade de cada tipo de card ao qual se aplica. Veja [Grupos de tags obrigatórios](#grupos-de-tags-obrigatorios) abaixo. |
| **Restringir a tipos** | Lista opcional de tipos de card permitidos. Vazia significa que o grupo está disponível em todos os tipos; caso contrário, apenas os tipos listados veem o grupo no detalhe, nos filtros e nos portais. |

### Gerenciar tags

Dentro de cada grupo, você pode adicionar tags individuais:

1. Clique em **+ Adicionar Tag** dentro de um grupo de tags.
2. Informe o **nome** da tag.
3. Opcionalmente defina uma **cor** para distinção visual — a cor determina o fundo do chip no detalhe do card, no inventário, nos relatórios e nos portais web.

As tags aparecem nas páginas de detalhe dos cards na seção **Tags**, onde os usuários com a permissão adequada podem aplicá-las ou removê-las.

## Restrições de tipo

Definir **Restringir a tipos** em um grupo de tags o limita em todos os lugares ao mesmo tempo:

- **Detalhe do card** — o grupo e suas tags só aparecem em tipos de card correspondentes.
- **Barra lateral de filtros do inventário** — o chip do grupo só surge no `TagPicker` quando a visão do inventário está filtrada para um tipo correspondente.
- **Portais web** — o grupo só é exibido aos leitores do portal quando este apresenta um tipo correspondente.
- **Relatórios** — os menus de agrupamento / filtro incluem o grupo apenas para tipos correspondentes.

A interface de administração mostra os tipos atribuídos como pequenos chips em cada grupo de tags, para visualizar o escopo de relance.

## Grupos de tags obrigatórios

Marcar um grupo de tags como **Obrigatório** o transforma em um requisito de governança: cada card ao qual o grupo se aplica deve conter pelo menos uma tag do grupo.

### Portão de aprovação

Um card não pode passar para **Aprovado** enquanto um grupo obrigatório aplicável não estiver satisfeito. Tentar aprovar retorna o erro `approval_blocked_mandatory_missing` e o detalhe do card lista quais grupos estão faltando. Duas salvaguardas mantêm o portão seguro:

- Um grupo só se aplica a um card se sua lista **Restringir a tipos** estiver vazia ou incluir o tipo do card.
- Um grupo obrigatório que **ainda não tem tags configuradas** é silenciosamente ignorado — isso evita um portão de aprovação inacessível por uma configuração administrativa incompleta.

Assim que você adicionar as tags necessárias, o card pode ser aprovado normalmente.

### Contribuição para a qualidade dos dados

Grupos obrigatórios aplicáveis também alimentam o score de qualidade dos dados do card. Cada grupo satisfeito aumenta o score junto com os demais itens obrigatórios (campos requeridos, lados de relação obrigatórios) que compõem o cálculo de completude.

### Indicadores visuais

Grupos obrigatórios exibem um chip **Obrigatório** tanto na lista de administração quanto na seção Tags do detalhe do card. Tags obrigatórias faltantes aparecem no aviso de status de aprovação e na dica do anel de qualidade de dados, para que os usuários saibam exatamente o que adicionar.

## Permissões

| Permissão | O que ela permite |
|-----------|-------------------|
| `tags.manage` | Criar, editar e excluir grupos e tags na interface de administração, e aplicar/remover tags em qualquer card, independentemente de outras permissões. |
| `inventory.edit` + `card.edit` | Aplicar ou remover tags em cards que o usuário pode editar (via papel de aplicação ou papel de stakeholder naquele card específico). |

`tags.manage` é concedida por padrão ao papel admin. `inventory.edit` pertence a admin, bpm_admin e member; `card.edit` é concedida através das atribuições de papel de stakeholder do próprio card.

Os viewers **veem** as tags, mas não podem alterá-las.

## Onde as tags aparecem

- **Detalhe do card** — a seção Tags lista os grupos aplicáveis e as tags atualmente atribuídas. Grupos obrigatórios mostram um chip; grupos restritos só aparecem quando o tipo do card corresponde.
- **Barra lateral de filtros do inventário** — um `TagPicker` agrupado permite filtrar a grade do inventário por uma ou mais tags. Grupos e tags são filtrados pelo escopo do tipo atual.
- **Relatórios** — o fatiamento por tags está disponível nos relatórios de portfólio, matriz e em outros que suportam dimensões de agrupamento / filtro.
- **Portais web** — editores de portal podem expor filtros por tags para leitores anônimos, de modo que consumidores externos fatiem paisagens públicas da mesma forma.
- **Diálogos de criação / edição** — o mesmo `TagPicker` aparece ao criar um novo card, permitindo definir tags requeridas desde o início — particularmente útil para grupos obrigatórios.
