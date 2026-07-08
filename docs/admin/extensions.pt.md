# Extensões

A **loja de extensões** (Admin → Extensões) instala extensões assinadas pelo fornecedor que adicionam capacidades específicas do cliente — conteúdo adicional do metamodelo, integrações, tarefas em segundo plano e até novas páginas — sem alterar o núcleo do Turbo EA (princípio «clean core»).

Tudo é entregue como ficheiros: a extensão é um pacote `.teax` assinado e a licença um ficheiro de texto assinado, ambos normalmente enviados por e-mail. Não é necessária ativação online, conta de loja nem ligação de saída, pelo que o fluxo funciona de forma idêntica em instâncias **isoladas (air-gapped)**.

## Como funciona a confiança

Duas verificações independentes protegem a sua instância:

1. **Proveniência (assinatura).** Cada pacote tem uma assinatura Ed25519 da chave do fornecedor. O Turbo EA verifica-a no carregamento *e novamente em cada arranque do backend*. Pacotes não assinados, adulterados ou de terceiros são rejeitados — uma extensão instalada é exatamente o que o fornecedor construiu.
2. **Ativação (licença).** Um ficheiro de licença assinado lista os seus direitos — um por extensão, cada um com a sua validade. Uma extensão instalada só funciona enquanto existir um direito utilizável.

## Instalar uma extensão

1. Se ainda não o fez, aplique primeiro a sua licença (ver abaixo).
2. Abra **Admin → Extensões**, escolha **Instalar extensão** e carregue o ficheiro `.teax` recebido.
3. O Turbo EA verifica a assinatura e mostra uma **pré-visualização**: para extensões com conteúdo é uma simulação de cada tipo de cartão, grupo de etiquetas, cartão e relação que a extensão criaria ou atualizaria — nada é escrito ainda.
4. Reveja a pré-visualização e prima **Instalar extensão**.
5. Se a extensão incluir código de backend ou de interface, um aviso pede o reinício do contentor do backend (`docker compose restart backend`). Extensões só de conteúdo ficam ativas de imediato.

Carregar o mesmo pacote outra vez é seguro — a pré-visualização mostra tudo como «ignorado» e aplicar não altera nada.

## Licenças e renovação

Cole o texto da licença recebido (ou carregue o ficheiro) no cartão **Licença**. A página mostra então o titular e um selo por direito com a respetiva validade.

Quando um direito ultrapassa a validade entra num **período de tolerância** (30 dias por predefinição): tudo continua a funcionar e os administradores veem um aviso. Após a tolerância, a extensão é **desativada suavemente** — as suas páginas desaparecem, a sua API recusa pedidos e as suas tarefas em segundo plano ficam em pausa. **Nunca são apagados dados.** Aplicar uma licença renovada restaura tudo de imediato, sem reinício.

A renovação numa instância isolada resume-se, portanto, a pedir ao fornecedor um novo ficheiro de licença (por e-mail) e colá-lo — nada mais.

## Ativar, desativar e desinstalar

- O interruptor **Ativada** desativa a extensão de imediato (sem reinício) e pode ser revertido a qualquer momento.
- **Desinstalar** remove os ficheiros da extensão. Os dados que ela criou — tipos de cartão, cartões e as suas próprias tabelas — são deliberadamente mantidos e reaparecem se reinstalar. É preciso um reinício para descarregar por completo o código de backend.

## Permissões

Toda a página e as suas rotas de API estão protegidas pela permissão dedicada `admin.manage_extensions` (atribuída ao papel Admin integrado). As extensões podem definir as suas próprias chaves de permissão (`ext.<nome>.…`), que aparecem em **Admin → Utilizadores e papéis** depois de a extensão ser carregada.
