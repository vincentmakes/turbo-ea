# Extensões

A **loja de extensões** (Admin → Extensões) instala extensões assinadas pelo fornecedor que adicionam capacidades específicas do cliente — conteúdo adicional do metamodelo, integrações, tarefas em segundo plano e até novas páginas — sem alterar o núcleo do Turbo EA (princípio «clean core»).

Tudo é entregue como ficheiros: a extensão é um pacote `.teax` assinado e a licença um ficheiro de texto assinado, ambos normalmente enviados por e-mail. Não é necessária ativação online, conta de loja nem ligação de saída, pelo que o fluxo funciona de forma idêntica em instâncias **isoladas (air-gapped)**.

A página tem dois separadores: **Loja** percorre o catálogo de extensões do fornecedor com instalação num clique (se a instância tiver acesso à Internet), e **Instaladas** gere licenças e instala a partir de ficheiros.

## Como funciona a confiança

Duas verificações independentes protegem a sua instância:

1. **Proveniência (assinatura).** Cada pacote tem uma assinatura Ed25519 da chave do fornecedor. O Turbo EA verifica-a no carregamento *e novamente em cada arranque do backend*. Pacotes não assinados, adulterados ou de terceiros são rejeitados — uma extensão instalada é exatamente o que o fornecedor construiu.
2. **Ativação (licença).** Um ficheiro de licença assinado lista os seus direitos — um por extensão, cada um com a sua validade. Uma extensão instalada só funciona enquanto existir um direito utilizável.

## O separador Loja

O separador **Loja** funciona sem qualquer configuração e lista as extensões publicadas pelo fornecedor com descrição e preço:

- **Comprar** abre a página de pagamento num novo separador do navegador. Assim que o pagamento é confirmado, a sua licença é aplicada automaticamente (uma cópia também chega por e-mail).
- **Instalar** (ou **Atualizar** quando é publicada uma versão mais recente) verifica primeiro a sua licença — se a extensão ainda não tiver licença, um diálogo propõe comprá-la ou colar uma licença e depois continua automaticamente — e descarrega o pacote com exatamente a mesma verificação de assinatura e pré-visualização de simulação de um carregamento manual.

O separador Loja é só de leitura e anónimo: sem conta, sem token, e nada sobre a sua instância é enviado — apenas o catálogo público do fornecedor é lido. As instâncias isoladas não precisam de configuração — o separador mostra então simplesmente uma indicação amigável — e usam o fluxo baseado em ficheiros abaixo; o site da loja do fornecedor oferece as mesmas compras e transferências a partir de qualquer navegador com ligação à Internet.

## Instalar uma extensão

1. Se ainda não o fez, aplique primeiro a sua licença (ver abaixo).
2. Abra **Admin → Extensões**, escolha **Instalar a partir de ficheiro…** no separador Loja e carregue o ficheiro `.teax` recebido.
3. O Turbo EA verifica a assinatura e mostra uma **pré-visualização**: para extensões com conteúdo é uma simulação de cada tipo de cartão, grupo de etiquetas, cartão e relação que a extensão criaria ou atualizaria — nada é escrito ainda.
4. Reveja a pré-visualização e prima **Instalar extensão**.
5. Se a extensão incluir código de backend ou de interface, um aviso pede o reinício do contentor do backend (`docker compose restart backend`). Extensões só de conteúdo ficam ativas de imediato.

Carregar o mesmo pacote outra vez é seguro — a pré-visualização mostra tudo como «ignorado» e aplicar não altera nada.

## Licenças e renovação

Aplique uma licença através de **Introduzir licença…** no separador Instaladas (cole o texto ou carregue o ficheiro); o botão também aparece em cada linha de extensão que precise dela. A página mostra então o titular e um distintivo por direito com a respetiva data de expiração.

Quando um direito ultrapassa a validade entra num **período de tolerância** (30 dias por predefinição): tudo continua a funcionar e os administradores veem um aviso. Após a tolerância, a extensão é **desativada suavemente** — as suas páginas desaparecem, a sua API recusa pedidos e as suas tarefas em segundo plano ficam em pausa. **Nunca são apagados dados.** Aplicar uma licença renovada restaura tudo de imediato, sem reinício.

As licenças compradas na Loja renovam-se sozinhas nas instâncias ligadas: após cada pagamento bem-sucedido, a sua instância obtém automaticamente a licença prolongada — nada a colar. Numa instância isolada, a renovação resume-se a colar o ficheiro de licença atualizado do e-mail de renovação (ou pedi-lo ao fornecedor) — nada mais.

## Ativar, desativar e desinstalar

- O interruptor **Ativada** desativa a extensão de imediato (sem reinício) e pode ser revertido a qualquer momento.
- **Desinstalar** remove os ficheiros da extensão. Os dados que ela criou — tipos de cartão, cartões e as suas próprias tabelas — são deliberadamente mantidos e reaparecem se reinstalar. É preciso um reinício para descarregar por completo o código de backend.

## Permissões

Toda a página e as suas rotas de API estão protegidas pela permissão dedicada `admin.manage_extensions` (atribuída ao papel Admin integrado). As extensões podem definir as suas próprias chaves de permissão (`ext.<nome>.…`), que aparecem em **Admin → Utilizadores e papéis** depois de a extensão ser carregada.
