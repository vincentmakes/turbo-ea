# Slack Notifications

A sua equipa já vive no Slack. **Slack Notifications** envia a cada pessoa as suas
notificações do Turbo EA como **mensagem direta do Slack** — uma tarefa atribuída,
uma decisão à espera da sua assinatura, um risco que lhe chegou às mãos — com um
botão que a leva diretamente de volta ao cartão.

Cada pessoa mantém o controlo: nas suas próprias preferências de notificação surge
uma coluna **Slack**, ao lado de Na aplicação e E-mail, onde assinala exatamente
que tipos de notificação devem chegar por ali. **Nada está ativo por
predefinição.**

## Em resumo

| | |
|---|---|
| **Licença** | Comercial — é necessário um direito assinado |
| **Versão mínima do Turbo EA** | 2.89.1 |
| **Permissão** | `ext.slack-notify.admin` |
| **Autorizações de acesso a dados** | `core.notifications.channel`, `core.users.read` |
| **Exige reiniciar o backend** | sim — inclui código de backend |
| **Onde aparece** | **Admin → Definições → Integrações → Slack** · uma coluna **Slack** nas [preferências de notificação](../guide/notifications.md) de todas as pessoas |

Só é necessário **HTTPS de saída para `slack.com`** — nenhum URL de entrada,
nenhum *callback* OAuth e nenhuma revisão do Slack Marketplace. É por isso que
funciona em instâncias auto-alojadas ou atrás de uma *firewall*.

## Configuração

Abra **Admin → Definições → Integrações** e escolha o subseparador **Slack**. O
painel guia-o em três passos numerados.

### 1. Criar a aplicação Slack

O painel mostra um **manifesto de aplicação** já preparado. No Slack escolha
**Create New App → From a manifest**, selecione o seu *workspace*, cole o manifesto
(há um botão **Copiar manifesto**), depois **Install to Workspace** e copie o
**Bot User OAuth Token** — começa por `xoxb-`.

O manifesto pede quatro âmbitos de *bot* e mais nada:

| Âmbito | Para quê |
|---|---|
| `chat:write` | Publicar a mensagem direta |
| `im:write` | Abrir a conversa direta com uma pessoa |
| `users:read` | Ler o diretório de membros |
| `users:read.email` | Associar uma conta do Turbo EA a um membro do Slack por e-mail |

!!! warning "Deixe a rotação de tokens desativada"
    O manifesto desativa propositadamente a **rotação de tokens** do Slack. Se for
    ativada, o token do *bot* expira a cada 12 horas, algo que esta versão não sabe
    renovar: a entrega pararia duas vezes por dia.

### 2. Ligar o *workspace*

| Campo | Notas |
|---|---|
| **Token OAuth do bot** | O token `xoxb-…`. Guardado cifrado; deixe vazio mais tarde para o manter |
| **Nome mostrado nas mensagens do Slack** | *Turbo EA* por predefinição. Usado no botão e no rodapé da mensagem |
| **Entregar notificações no Slack** | Ativo por predefinição — é um interruptor de pausa, não um passo de instalação |

Clique em **Guardar** e depois em **Testar ligação**; uma etiqueta confirma
*Connected to …*.

### 3. Associar as pessoas

As contas são associadas **pelo endereço de e-mail** na primeira vez que alguém
deve receber uma mensagem, e o resultado fica em cache. O cartão **Pessoas** lista
toda a gente, primeiro os casos problemáticos, com etiquetas que indicam quem está
**ligado**, **não está no Slack** ou **ainda não foi verificado**.

Para quem tenha um endereço do Slack diferente do e-mail do Turbo EA, escreva o
seu **ID de membro do Slack** (como `U01ABCDEF`) e clique em **Guardar** — uma
associação manual prevalece sempre sobre a correspondência por e-mail. **Enviar
mensagem de teste** prova que uma associação funciona de ponta a ponta. Esvaziar o
campo devolve a pessoa à pesquisa por e-mail.

As pessoas que o Slack não reconhece são tentadas de novo automaticamente uma vez
por dia, pelo que quem entra no *workspace* do Slack depois de ter conta no
Turbo EA fica coberto sem intervenção.

!!! note "Só são guardados os IDs de membro"
    A extensão guarda IDs de membro do Slack e mais nada — os endereços de e-mail
    permanecem no Turbo EA.

## O que cada pessoa controla

Assim que a extensão está a funcionar, todas as pessoas passam a ter uma coluna
**Slack** nas suas **preferências de notificação**, ao lado de Na aplicação e
E-mail.

![A coluna «Slack» nas preferências de notificação](../assets/img/en/71_ext_slack_notification_preferences.png)

- **Todos os tipos estão desativados por predefinição.** Ninguém recebe uma
  mensagem do Slack antes de ativar esse tipo para si.
- Um rodapé sob a tabela indica a cada pessoa se a sua conta está ligada ao Slack
  ou se deve pedir a associação a um administrador.
- O anúncio de atualização, exclusivo da aplicação, nunca é entregue no Slack.

O Turbo EA decide que tipos de notificação existem e quem os ativou; a extensão
apenas transporta a mensagem.

## Como é uma mensagem

Uma mensagem direta do Slack contém o **título** da notificação a negrito, o seu
texto, um botão **Open in Turbo EA** (com o nome que configurou) que leva ao
cartão ou à página em causa, e um pequeno rodapé com o nome da aplicação e o tipo
de notificação.

A entrega é estritamente de sentido único — do Turbo EA para o Slack — e sempre
sob a forma de mensagem direta pessoal. Nunca é publicado nada num canal.

## Monitorizar a entrega

O cartão **Registo de entrega** mostra quantas mensagens estão **em espera**,
**enviadas** e **falhadas**, além das 50 linhas de registo mais recentes.

As mensagens são colocadas em fila e enviadas em segundos. Se o Slack limitar a
taxa ou devolver um erro, a extensão tenta de novo com esperas crescentes e desiste
ao fim de seis tentativas; as falhas permanentes — token revogado, pessoa
eliminada, âmbito em falta — param de imediato em vez de repetirem em vão. As
linhas entregues são eliminadas ao fim de 14 dias.

Uma fila parada tem exatamente duas causas, e o painel indica a que se aplica:

- **Não há nenhum token de *bot* guardado** — cole o token e guarde.
- **A entrega está desligada** — volte a ligar *Entregar notificações no Slack*.

**Repetir as falhadas** recoloca em fila tudo o que foi abandonado e verifica de
novo as pessoas que o Slack não conhecia. É a via de recuperação após uma
indisponibilidade ou uma troca de token.

## Permissões

| Permissão | Permite |
|---|---|
| `ext.slack-notify.admin` | Configurar a ligação ao *workspace*, associar pessoas, enviar mensagens de teste, consultar o registo e repetir as falhas |

O subseparador está oculto para as restantes pessoas. **As pessoas utilizadoras
não precisam de qualquer permissão adicional** — apenas assinalam caixas nas suas
próprias preferências de notificação.

## Se a licença expirar ou a extensão for desativada

A entrega é suspensa e a coluna **Slack** desaparece da janela, mas **todas as
definições e adesões são mantidas**. Uma licença renovada retoma a entrega. O
mesmo acontece com o interruptor *Entregar notificações no Slack*, que suspende a
entrega sem desinstalar nada: as mensagens pendentes simplesmente aguardam.

O token do *bot* é guardado cifrado e está excluído da transferência de espaço de
trabalho.

## Limitações

- **Apenas mensagens diretas** — nada é publicado em canais.
- **Sem botões interativos.** Ações como *Marcar como concluído* ou *Aprovar* a
  partir do Slack não estão disponíveis nesta versão; a mensagem remete de volta
  para o Turbo EA.
- **Sem resumos** — cada notificação é uma mensagem própria em vez de um resumo
  agrupado.
- **Não ative a rotação de tokens do Slack** (ver o aviso acima).
