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

O separador Loja é só de leitura e anónimo: sem conta, sem token, e nada sobre a sua instância é enviado — apenas o catálogo público do fornecedor é lido. As instâncias isoladas não precisam de configuração — o separador mostra então simplesmente uma indicação amigável — e usam o fluxo baseado em ficheiros abaixo; o site da loja do fornecedor oferece as mesmas compras e transferências a partir de qualquer navegador com ligação à Internet.

## Instalar uma extensão

1. Se ainda não o fez, aplique primeiro a sua licença (ver abaixo).
2. Abra **Admin → Extensões**, escolha **Instalar a partir de ficheiro…** no separador Loja e carregue o ficheiro `.teax` recebido.
3. O Turbo EA verifica a assinatura e mostra uma **pré-visualização**: para extensões com conteúdo é uma simulação de cada tipo de cartão, grupo de etiquetas, cartão e relação que a extensão criaria ou atualizaria — nada é escrito ainda.
4. Reveja a pré-visualização e prima **Instalar extensão**.
5. Se a extensão incluir código de backend, um aviso pede o reinício do contentor do backend (`docker compose restart backend`). Extensões de conteúdo e de interface ficam ativas de imediato — os utilizadores veem a nova interface no próximo carregamento da página.

Carregar o mesmo pacote outra vez é seguro — a pré-visualização mostra tudo como «ignorado» e aplicar não altera nada.

## Licenças e renovação

Aplique uma licença através de **Introduzir licença…** no separador Instaladas (cole o texto ou carregue o ficheiro); o botão também aparece em cada linha de extensão que precise dela. A página mostra então o titular e um distintivo por direito com a respetiva data de expiração.

Quando um direito ultrapassa a validade entra num **período de tolerância** (30 dias por predefinição): tudo continua a funcionar e os administradores veem um aviso. Após a tolerância, a extensão é **desativada suavemente** — as suas páginas desaparecem, a sua API recusa pedidos e as suas tarefas em segundo plano ficam em pausa. **Nunca são apagados dados.** Aplicar uma licença renovada restaura tudo de imediato, sem reinício.

As licenças compradas na Loja renovam-se sozinhas nas instâncias ligadas: após cada pagamento bem-sucedido, a sua instância obtém automaticamente a licença prolongada — nada a colar. Numa instância isolada, a renovação resume-se a colar o ficheiro de licença atualizado do e-mail de renovação (ou pedi-lo ao fornecedor) — nada mais.

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

## Onde as páginas de extensão aparecem

As páginas de extensão aparecem na navegação assim que a extensão está instalada e licenciada — geralmente como seu próprio item de menu de nível superior, embora alguns relatórios sejam colocados no menu **Relatórios** ao lado dos integrados.
