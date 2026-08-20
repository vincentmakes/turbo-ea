# Extensões

A **loja de extensões** (Admin → Extensões) instala extensões assinadas pelo fornecedor que adicionam capacidades específicas do cliente — conteúdo adicional do metamodelo, integrações, tarefas em segundo plano e até novas páginas — sem alterar o núcleo do Turbo EA (princípio «clean core»).

As extensões instalam-se de duas formas: **com um clique a partir da Loja integrada** (se a instância tiver acesso à Internet) ou **carregando os ficheiros diretamente** — a extensão é um pacote `.teax` assinado e a licença um ficheiro de texto assinado, ambos normalmente enviados por e-mail. O fluxo baseado em ficheiros não requer conta de loja nem ligação de saída, pelo que funciona de forma idêntica em instâncias **isoladas (air-gapped)**.

A página tem dois separadores: **Loja** percorre o catálogo de extensões do fornecedor com instalação num clique, e **Instaladas** gere licenças e instala a partir de ficheiros.

**As extensões são criadas e assinadas pela Turbo EA** — não são de criação própria nem abertas a terceiros. Se precisar de uma funcionalidade adaptada à sua organização, podemos criá-la e licenciá-la para si. Consulte [a consultoria da Turbo EA](https://www.turbo-ea.org/consulting).

## Como funciona a confiança

Duas verificações independentes protegem a sua instância:

1. **Proveniência (assinatura).** Cada pacote tem uma assinatura Ed25519 da chave do fornecedor. O Turbo EA verifica-a no carregamento *e novamente em cada arranque do backend*. Pacotes não assinados, adulterados ou de terceiros são rejeitados — uma extensão instalada é exatamente o que o fornecedor construiu.
2. **Ativação (licença).** Um ficheiro de licença assinado lista os seus direitos — um por extensão, cada um com a sua validade. Uma extensão instalada só funciona enquanto existir um direito utilizável. As licenças estão **vinculadas ao ID da sua instância** — uma licença emitida para outra instância é recusada.

## Extensões gratuitas

Algumas extensões são **gratuitas** e não exigem nenhuma licença. Elas são instaladas e executadas de imediato: não há etapa de compra nem arquivo de licença para colar. As extensões gratuitas são marcadas com um selo **Grátis** nas abas Loja e Instaladas, e as ações **Comprar** e **Renovar** ficam ocultas para elas. A verificação de assinatura continua a ser aplicada exatamente como nas extensões pagas (uma extensão gratuita também é assinada pelo fornecedor), portanto a procedência é garantida em qualquer caso. Como não precisam de nenhum direito, as extensões gratuitas nunca expiram nem entram em período de carência.

## O ID da sua instância

Cada instalação gera uma única vez um **ID de instância** (`TEA-XXXX-XXXX-XXXX`), mostrado no topo de Admin → Extensões com um botão de cópia. É a sua identidade de licenciamento: indique-o na compra (a Loja integrada envia-o automaticamente; o checkout da loja online pede-o) para que cada extensão comprada para esta instância — por qualquer administrador, com qualquer e-mail — acabe numa única licença combinada. Apenas identifica a sua instância; nunca é uma credencial, pelo que pode partilhá-lo com o fornecedor sem risco.

O ID viaja com uma transferência de workspace, pelo que mudar para um novo servidor mantém a licença válida. Após uma **reinstalação completa**, a instância recebe um ID novo — peça ao fornecedor que reemita a licença para ele (um rápido «re-key» do lado dele).

## O separador Loja

O separador **Loja** funciona sem qualquer configuração e lista as extensões publicadas pelo fornecedor com descrição e preço:

- **Comprar** abre a página de pagamento num novo separador do navegador. Assim que o pagamento é confirmado, a sua licença é aplicada automaticamente (uma cópia também chega por e-mail).
- **Instalar** (ou **Atualizar** quando é publicada uma versão mais recente) verifica primeiro a sua licença — se a extensão ainda não tiver licença, um diálogo propõe comprá-la ou colar uma licença e depois continua automaticamente — e descarrega o pacote com exatamente a mesma verificação de assinatura e pré-visualização de simulação de um carregamento manual. As extensões com demonstração mostram uma ligação **Ver em ação**, e uma versão mais recente publicada transforma o botão em **Atualizar**.

Quando o catálogo inclui categorias, cada item mostra pequenas pílulas (free ou commercial, além de temas como integration) e uma barra de filtros aparece acima da lista — clique nas pílulas para restringi-la (várias pílulas se combinam) e **All** repõe a vista.

O separador Loja é só de leitura e anónimo: sem conta, sem token, e nada sobre a sua instância é enviado — apenas o catálogo público do fornecedor é lido. As instâncias isoladas não precisam de configuração — o separador mostra então simplesmente uma indicação amigável — e usam o fluxo baseado em ficheiros abaixo; o site da loja do fornecedor oferece as mesmas compras e transferências a partir de qualquer navegador com ligação à Internet. Se algo entre a sua instância e a loja bloquear o pedido — um proxy, uma firewall ou uma proteção anti-bots à frente da loja —, o separador indica-o e mostra o estado HTTP recebido, para que uma instância bloqueada nunca seja confundida com uma isolada.

A instância também **verifica o catálogo uma vez por dia** e comunica as alterações, para que uma extensão nova — ou uma correção de segurança de alguma que já utiliza — não fique à espera de que alguém abra esta página por acaso. Os administradores (qualquer pessoa cujo perfil conceda `admin.manage_extensions`) recebem uma notificação no sino quando é publicada uma nova extensão na loja e outra quando uma extensão instalada tem uma versão mais recente. Cada alteração é anunciada uma só vez e um dia de lançamentos intenso chega como uma notificação por tipo em vez de uma por extensão. Nada é descarregado nem instalado — a notificação limita-se a trazê-lo até aqui. A verificação diária pode ser desativada por completo em [Admin → Definições → Notificações de atualização](settings.md#update-notifications).

## Avaliações

Algumas extensões pagas oferecem uma **avaliação gratuita de 30 dias** — procure o botão **Iniciar avaliação de 30 dias** na aba Loja (ou a opção de avaliação no site da loja). Iniciar uma avaliação funciona como uma compra sem pagamento: não é necessário cartão de crédito, a sua licença é atualizada automaticamente (uma cópia também chega por e-mail para instalações isoladas) e a extensão funciona com todas as funcionalidades durante 30 dias.

- Cada instância do Turbo EA pode avaliar uma determinada extensão **uma única vez**.
- Uma avaliação termina exatamente na data de término — não há período de carência. A extensão deixa então de funcionar até que você assine; **os seus dados nunca são excluídos**, e tudo volta assim que uma licença de assinatura é aplicada.
- A aba «Instaladas» mostra os direitos de avaliação como **Avaliação até …**.
- As avaliações terminam por si mesmas — não há nada a cancelar e nada é jamais cobrado.

## Instalar uma extensão

1. Se ainda não o fez, aplique primeiro a sua licença (ver abaixo).
2. Abra **Admin → Extensões**, escolha **Instalar a partir de ficheiro…** no separador Loja e carregue o ficheiro `.teax` recebido.
3. O Turbo EA verifica a assinatura e mostra uma **pré-visualização**: para extensões com conteúdo é uma simulação de cada tipo de cartão, grupo de etiquetas, cartão e relação que a extensão criaria ou atualizaria — nada é escrito ainda.
4. Reveja a pré-visualização e prima **Instalar extensão**.
5. Se a extensão incluir código de backend, um aviso pede o reinício do contentor do backend (`docker compose restart backend`). Extensões de conteúdo e de interface ficam ativas de imediato — os utilizadores veem a nova interface no próximo carregamento da página.

Carregar o mesmo pacote outra vez é seguro — a pré-visualização mostra tudo como «ignorado» e aplicar não altera nada.

## Atualizar uma extensão

Quando a loja publica uma versão mais recente de uma extensão instalada, o separador Instaladas mostra um selo **Atualizar para X** ao lado da versão (e o botão do separador Loja passa a **Atualizar**). Um clique executa a mesma verificação de assinatura, a mesma pré-visualização e a mesma aplicação de uma instalação nova. Aplicam-se duas salvaguardas:

- Atualizar uma extensão que você **desativou** deliberadamente mantém-na desativada: a nova versão chega ao disco, mas o seu conteúdo permanece oculto e nada é executado até que a reative.
- Instalar um pacote **mais antigo** do que a versão instalada pede primeiro uma confirmação explícita: um downgrade pode não compreender os dados escritos pela versão mais recente. Em nenhum caso algo é eliminado.

## Licenças e renovação

Aplique uma licença através de **Introduzir licença…** no separador Instaladas (cole o texto ou carregue o ficheiro); o botão também aparece em cada linha de extensão que precise dela. A página mostra então o titular e um distintivo por direito com a respetiva data de expiração.

A sua instância mantém **apenas uma licença de cada vez** — aplicar uma nova substitui a anterior. As licenças emitidas pela Store contêm sempre todas as compras feitas para a sua instância, pelo que a substituição é segura. Se também possuir licenças emitidas manualmente, peça ao seu fornecedor uma licença combinada em vez de aplicar ficheiros por extensão; se uma licença aplicada removesse direitos que a atual ainda cobre, o Turbo EA lista-os e pede primeiro confirmação (em nenhum caso são eliminados dados).

Quando um direito ultrapassa a validade entra num **período de tolerância** (30 dias por predefinição): tudo continua a funcionar e os administradores veem um aviso. Após a tolerância, a extensão é **desativada suavemente** — as suas páginas desaparecem, a sua API recusa pedidos e as suas tarefas em segundo plano ficam em pausa. **Nunca são apagados dados.** Aplicar uma licença renovada restaura tudo de imediato, sem reinício.

As licenças compradas na Loja renovam-se sozinhas nas instâncias ligadas: após cada pagamento bem-sucedido, a sua instância obtém automaticamente a licença prolongada — nada a colar. Numa instância isolada, a renovação resume-se a colar o ficheiro de licença atualizado do e-mail de renovação (ou pedi-lo ao fornecedor) — nada mais.

### Estado da renovação automática e cancelamento

Cada chip de titularidade indica o que acontece na sua data: **Renova em {data}** para uma subscrição ativa, ou **Expira em {data} — não será renovado** após um cancelamento. A informação vem da própria licença assinada, pelo que também é exata em instâncias isoladas — o ficheiro de licença enviado por e-mail após qualquer alteração da subscrição traz o estado atualizado; cole-o e o chip fica atual.

Para ver a data de renovação, cancelar ou restaurar a renovação automática, alterar o método de pagamento ou descarregar faturas, use **Gerir subscrição** junto ao nome do licenciado (visível em licenças compradas na Loja). Abre o seu portal de faturação num novo separador — sem necessidade de conta. Numa instância isolada o botão não consegue chegar à loja; use antes o link **Gerir subscrição** incluído em cada e-mail de licença (só o seu navegador precisa de Internet, a sua instância Turbo EA não).

Cancelar nunca desliga nada de imediato: a extensão continua a funcionar até ao fim do período pago e depois aplica-se o fluxo normal de tolerância + desativação suave. **Os seus dados nunca são eliminados**, e voltar a subscrever restaura tudo.

## Ativar, desativar e desinstalar

- O interruptor **Ativada** desativa uma extensão imediatamente de forma suave (sem reinício) e pode ser revertido a qualquer momento. Para pacotes de conteúdo, isto oculta os seus tipos de cartão do metamodelo — os cartões ficam onde estão.
- **Desinstalar** remove os ficheiros da extensão e oculta os seus tipos de cartão do metamodelo. Os cartões e as tabelas próprias da extensão são deliberadamente mantidos, e tudo — tipos incluídos — reaparece se a reinstalar.

## Permissões

Toda a página e as suas rotas de API estão protegidas pela permissão dedicada `admin.manage_extensions` (atribuída ao papel Admin integrado). As extensões podem definir as suas próprias chaves de permissão (`ext.<nome>.…`), que aparecem em **Admin → Utilizadores e papéis** depois de a extensão ser carregada.

## Recursos de campo avançados

Algumas extensões desbloqueiam maneiras avançadas de descrever seus dados que o núcleo não oferece sozinho:

- **Texto de ajuda do campo** — uma orientação recolhível exibida abaixo de um campo durante a entrada de dados, para que um formulário se explique sozinho.
- **Tipos de campo personalizados** — novos tipos além do conjunto integrado (por exemplo, uma avaliação configurável de 1 a 5 ou de 0 a 10).

Essas opções aparecem no editor de campos do metamodelo **somente enquanto a extensão que as fornece estiver instalada e licenciada**. Se essa extensão for posteriormente desativada ou sua licença expirar, os valores que você já registrou continuam sendo exibidos como texto somente leitura — nada é apagado ou excluído — e as opções de edição simplesmente desaparecem até que a extensão esteja ativa novamente.

## Concessões de acesso a dados

A maioria das extensões trabalha apenas com os seus próprios dados. Uma extensão que se integra com os dados do núcleo — por exemplo, um conector que sincroniza os todos com um gestor de tarefas externo como o Jira ou o MS Planner ([#921](https://github.com/vincentmakes/turbo-ea/discussions/921)) — precisa declarar **grants** no seu manifesto assinado:

- `core.todos.read` / `core.todos.write` — ler ou alterar todos através do SDK de extensões. Escrever inclui ler. Nos todos de sistema (como pedidos de assinatura), uma extensão de sincronização só pode definir a referência externa mostrada como chip — nunca pode concluí-los, editá-los, reatribuí-los ou eliminá-los, e os todos de outra extensão continuam fora do seu alcance.
- `core.events.todo` — receber os eventos de alteração dos todos, para que um conector reaja de imediato em vez de esperar pelo próximo ciclo de sondagem.
- `core.users.read` — consultar utilizadores (apenas nome, e-mail e estado ativo) para que um conector possa fazer corresponder responsáveis a contas da ferramenta externa. Não são expostos dados de função, início de sessão ou preferências, e as extensões nunca podem alterar utilizadores.
- `core.cards.read` — ler cartões, relações e o metamodelo, por exemplo para que um conector possa fazer corresponder as suas aplicações a registos de um sistema externo. Os cartões arquivados permanecem fora de vista.
- `core.cards.write` — criar, atualizar ou arquivar cartões e adicionar relações, com exatamente a validação que o editor da aplicação aplica. As atualizações fundem os valores dos campos em vez de os substituir, pelo que uma extensão nunca pode apagar dados que não gere, e **não existe eliminação permanente** — arquivar, com a sua janela de restauro, é a única remoção possível para uma extensão.
- `core.events.card` — receber eventos de alteração de cartões e relações, para que um conector reaja de imediato às mudanças do inventário em vez de esperar pelo próximo ciclo de consulta.

Os grants fazem parte do pacote assinado pelo fornecedor: ficam fixados no empacotamento e são visíveis antes da instalação. Só se aplicam enquanto a extensão está instalada, ativada e licenciada — desativá-la ou deixar a licença expirar revoga o acesso imediatamente, sem reinício. Cada alteração feita por uma extensão fica registada em **Admin → Registo de auditoria** sob a origem **Extensão**, e um todo espelhado de um gestor externo mostra um chip com ligação ao item externo.

Cada alteração feita por uma extensão aparece em **Admin → Registo de auditoria** como um lote `ext:<chave>` com diferenças campo a campo, e pode ser revertida aí como qualquer outro lote. Os operadores têm a última palavra: a variável de ambiente `EXTENSION_WRITES_ENABLED=false` pausa de imediato todas as escritas de extensões (as leituras continuam, sem reinício), e `EXTENSION_MAX_WRITES_PER_BATCH` / `EXTENSION_MAX_BATCHES_PER_MINUTE` limitam quanto uma extensão pode alterar por lote e por minuto.

## Onde as páginas de extensão aparecem

As páginas de extensão aparecem na navegação assim que a extensão está instalada e licenciada — geralmente como seu próprio item de menu de nível superior, embora alguns relatórios sejam colocados no menu **Relatórios** ao lado dos integrados.
