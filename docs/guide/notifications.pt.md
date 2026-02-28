# Notificações

O Turbo EA mantém você informado sobre alterações em cards, tarefas e documentos que são importantes para você. As notificações são entregues **dentro do aplicativo** (através do sino de notificações) e opcionalmente **por e-mail** se o SMTP estiver configurado.

## Sino de Notificações

O **ícone de sino** na barra de navegação superior mostra um badge com a contagem de notificações não lidas. Clique nele para abrir um dropdown com suas 20 notificações mais recentes.

Cada notificação mostra:

- **Ícone** indicando o tipo de notificação
- **Resumo** do que aconteceu (ex.: "Uma tarefa foi atribuída a você em SAP S/4HANA")
- **Tempo** desde que a notificação foi criada (ex.: "5 minutos atrás")

Clique em qualquer notificação para navegar diretamente até o card ou documento relevante. As notificações são automaticamente marcadas como lidas quando você as visualiza.

## Tipos de Notificação

| Tipo | Gatilho |
|------|---------|
| **Tarefa atribuída** | Uma tarefa é atribuída a você |
| **Card atualizado** | Um card no qual você é parte interessada é atualizado |
| **Comentário adicionado** | Um novo comentário é publicado em um card no qual você é parte interessada |
| **Status de aprovação alterado** | O status de aprovação de um card muda (aprovado, rejeitado, quebrado) |
| **Assinatura de SoAW solicitada** | Você é solicitado a assinar um Statement of Architecture Work |
| **SoAW assinado** | Um SoAW que você acompanha recebe uma assinatura |
| **Solicitação de pesquisa** | Uma pesquisa é enviada que requer sua resposta |

## Entrega em Tempo Real

As notificações são entregues em tempo real usando Server-Sent Events (SSE). Você não precisa atualizar a página — novas notificações aparecem automaticamente e a contagem do badge é atualizada instantaneamente.

## Preferências de Notificação

Clique no **ícone de engrenagem** no dropdown de notificações (ou vá ao menu do seu perfil) para configurar suas preferências de notificação.

Para cada tipo de notificação, você pode alternar independentemente:

- **No aplicativo** — Se aparece no sino de notificações
- **E-mail** — Se um e-mail também é enviado (requer que o SMTP esteja configurado por um administrador)

Alguns tipos de notificação (ex.: solicitações de pesquisa) podem ter entrega por e-mail imposta pelo sistema e não podem ser desabilitados.
