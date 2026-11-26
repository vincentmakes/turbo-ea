# Idiomas personalizados

O Turbo EA acompanha dez idiomas integrados. Quando a sua organização precisa de outro — neerlandês, polonês, hebraico, híndi, tailandês, uma variante regional como o português do Brasil —, um administrador pode adicioná-lo como **idioma personalizado** e preencher as suas traduções sem esperar por uma nova versão.

Um idioma personalizado fica no seu banco de dados, não no código da aplicação. Você o adiciona, traduz, revê e oferece aos seus usuários quando estiver pronto. Os idiomas integrados não são afetados.

Um idioma personalizado abrange toda a interface do usuário **e** os nomes que o seu metamodelo dá às coisas: tipos de card, subtipos, seções, campos e as suas opções, relações, funções de stakeholder, categorias, painéis, regulamentações, tipos de recurso e a ajuda das fases do ciclo de vida.

Você precisa da permissão **admin.settings** para tudo o que está nesta página.

## Adicionar um idioma personalizado

Vá a **Admin > Configurações > Geral**. A seção **Idiomas personalizados** fica logo abaixo de [Idiomas Habilitados](settings.md#idiomas-habilitados).

Clique em **Adicionar idioma** e preencha:

| Campo | Descrição |
|-------|-----------|
| **Código do idioma** | Um código de idioma curto: duas ou três letras minúsculas, seguidas opcionalmente de uma escrita (`zh-Hant`) e de uma região de duas letras maiúsculas (`pt-BR`) — `nl`, `he`, `hi`, `th`, `pt-BR`. Não pode ser o código de um idioma integrado. |
| **Nome nativo** | O nome que os usuários veem no menu de idioma, escrito no próprio idioma — *Nederlands*, *עברית*, *हिन्दी*, *ไทย*. |
| **Nome em inglês** | O nome do idioma em inglês — *Dutch*, *Hebrew*. É o idioma para o qual se instrui o provedor de IA a traduzir. Apenas letras, espaços, parênteses e hifens. |
| **Escrita da direita para a esquerda** | Ative-a para um idioma escrito da direita para a esquerda, como hebraico, persa ou urdu. Vem desativada por padrão; a caixa de diálogo assinala-o quando o código é de um idioma normalmente escrito da direita para a esquerda, mas nunca a ativa por você. |

Qualquer escrita funciona: latina, cirílica, hebraica, árabe, devanágari, tailandesa e outras, incluindo os caracteres de ligação e as marcas de que essas escritas precisam. Com **Escrita da direita para a esquerda** ativada, toda a aplicação é organizada da direita para a esquerda para os usuários que escolhem o idioma, como acontece com o árabe.

Um idioma regional é um idioma próprio: `pt-BR` não aproveita nada do português integrado, e `zh-Hant` não aproveita nada do chinês integrado. Enquanto um texto não estiver traduzido, é mostrado em inglês.

Um idioma novo começa desativado: os usuários não o veem até você o oferecer. Cada idioma da lista mostra uma barra de progresso com quantos textos estão traduzidos, e dois contadores:

- **Ausentes** — textos que ainda não têm tradução.
- **Alterados em inglês** — textos que estavam traduzidos, mas cujo texto em inglês mudou desde então. Até serem traduzidos de novo, os usuários veem a tradução antiga, o que normalmente é melhor do que recorrer ao inglês.

Ofereça um idioma aos seus usuários com o respetivo interruptor. Os usuários poderão então escolhê-lo no menu de idioma, como qualquer idioma integrado. Os textos que ainda faltam aparecem em inglês.

## Instalar um idioma a partir da biblioteca da comunidade

Outros usuários do Turbo EA compartilham suas traduções na [biblioteca de idiomas da comunidade](https://github.com/vincentmakes/turbo-ea-translations). Abaixo dos seus próprios idiomas, o bloco **Idiomas da comunidade** lista os idiomas que ela contém, cada um com seu nome nativo e seu código, a parte da interface que traduz e a versão do Turbo EA com que seu pacote foi criado.

!!! warning "Fornecido pela comunidade, não revisado"
    Os pacotes são escritos por membros da comunidade. **O projeto Turbo EA não os revisa.** Verificações automáticas garantem que um pacote não possa adicionar marcação, links ou marcadores de posição quebrados que o texto em inglês não tenha, mas ninguém verifica se as traduções são precisas ou completas. Revise um idioma antes de oferecê-lo aos seus usuários.

**Instalar** baixa o pacote do idioma e o importa. O que acontece:

- O pacote é baixado da biblioteca da comunidade — exatamente o arquivo que a biblioteca lista, verificado pela soma de verificação dela.
- Cada texto passa pelas mesmas verificações de um [arquivo importado](#the-language-pack-file); um texto rejeitado aparece no relatório e nunca é salvo.
- Um idioma novo é adicionado **desativado**. Veja-o em **Revisar textos** e depois ative-o para seus usuários.
- O relatório mostra o que foi aplicado, o que foi rejeitado e por quê, e o que não existe na sua versão do Turbo EA.

O idioma passa então a constar como **instalado**, e sua linha na sua própria lista traz a marca **Fornecido pela comunidade, não revisado**. Uma instalação com falha — um pacote que não pode ser baixado, não corresponde à soma de verificação da biblioteca ou não é um pacote válido — não instala nada e é registrada no [registro de Segurança e administração](audit-log.md). Em **Revisar textos**, cada tradução mostra de onde veio — *Biblioteca da comunidade*, *Corrigido à mão*, *Tradução por IA*, *Arquivo importado* ou *MCP*.

Quando a biblioteca tem um pacote mais recente de um idioma que você instalou a partir dela, o idioma mostra **Atualização disponível**. **Atualizar** mescla o novo pacote no seu idioma. Os textos que você corrigiu à mão são mantidos, a menos que você marque **Substituir também os textos corrigidos à mão**. O nome, a direção e o interruptor do seu idioma permanecem como estão.

Se você mesmo adicionou um idioma e a biblioteca tem o mesmo código, a linha dele mostra **Adicionado neste servidor** e oferece **Adicionar textos da comunidade**: o pacote é mesclado ao seu idioma da mesma forma — os textos corrigidos à mão são mantidos, a menos que você escolha o contrário — e o idioma passa a ser marcado como fornecido pela comunidade.

O Turbo EA só contata a biblioteca quando você pede: na primeira vez que a seção é exibida, a lista é baixada e guardada; depois, a lista guardada é exibida (com a data em que foi baixada) até você clicar em **Atualizar**. Nada é verificado em segundo plano, então um pacote mais recente só aparece como **Atualização disponível** depois de uma atualização. Se a biblioteca não puder ser acessada, o bloco informa isso e continua mostrando a lista do último download bem-sucedido.

### Desativar a biblioteca

O endereço da biblioteca é definido pela variável de ambiente `LANGUAGE_CATALOGUE_URL` (valor do Helm `customLanguages.catalogueUrl`). Defina-a como um valor vazio para desativar o recurso, por exemplo em uma instalação sem acesso à internet; o bloco então informa que a biblioteca da comunidade está desativada. Você também pode apontá-la para uma cópia da biblioteca no seu próprio servidor: os pacotes são baixados dos arquivos `packs/<code>/pack.json` ao lado do `index.json` dela.

### Contribuir com um idioma

Traduziu um idioma que ainda não está na biblioteca, ou melhorou um? Exporte-o com **Exportar pacote de idioma > Compartilhar (pacote da comunidade)** e proponha-o à biblioteca — veja o [guia de contribuição](https://github.com/vincentmakes/turbo-ea-translations/blob/main/CONTRIBUTING.md) dela.

## Três formas de traduzir

Use a que preferir; podem ser combinadas e o resultado é o mesmo.

### 1. Exportar um arquivo e importá-lo de volta

**Exportar pacote de idioma** baixa um arquivo de pacote de idioma (JSON). Escolha o que ele contém:

- **Textos novos e alterados (a traduzir)** — o texto em inglês de cada texto ausente ou alterado. Use-o para a primeira tradução e após cada atualização.
- **Todos os textos em inglês (a traduzir)** — o texto em inglês de todos os textos, para traduzir tudo de novo.
- **Traduções atuais (inclui os rótulos próprios desta instalação)** — as traduções que você já tem, incluindo os nomes do seu próprio metamodelo. Use-o como cópia de segurança ou para levar o idioma para outra instalação sua.
- **Compartilhar (pacote da comunidade)** — as traduções que você já tem, mas apenas o que é igual em todas as instalações do Turbo EA: o texto da interface e os nomes do metamodelo integrado tal como o Turbo EA os fornece. Tudo o que é específico da sua instalação fica de fora — tipos de card, campos e opções que você criou, nomes integrados que renomeou, os seus painéis e categorias. É este o arquivo a compartilhar com outros usuários do Turbo EA.

Traduza o arquivo onde quiser — uma agência de tradução, uma ferramenta de tradução ou um chat de IA — e depois escolha **Importar pacote de idioma**. A importação verifica o arquivo, salva os textos seção por seção e mostra um relatório: quantos textos foram aplicados, ficaram inalterados ou foram limpos, quais foram rejeitados e porquê, e que chaves não existem nesta versão.

### 2. Traduzir com o seu provedor de IA

Se houver um provedor de IA configurado em [Funcionalidades de IA](ai.md), **Traduzir com IA** traduz o idioma em segundo plano. Escolha:

- **Textos novos e alterados** — apenas os ausentes e os alterados. É a escolha habitual.
- **Tudo** — todos os textos de novo. Os textos que você corrigiu manualmente são mantidos, a menos que marque também **Substituir também os textos corrigidos manualmente**.

A caixa de diálogo mostra quantos textos serão enviados e, depois, o progresso durante a execução; você pode fechá-la e voltar, ou **Parar a tradução**. Os nomes dos seus tipos de card, campos e relações são traduzidos primeiro, e o resto da interface é depois traduzido com esses nomes como referência, para que a mesma coisa tenha o mesmo nome em todo o lado. Um texto que a IA devolva numa forma inutilizável não é salvo; permanece ausente e é tentado de novo na execução seguinte.

Esta opção não depende de as sugestões de descrição por IA para os cards estarem ativadas — apenas de haver um provedor configurado.

### 3. Por meio de um assistente de IA (MCP)

Um assistente de IA conectado por meio da [integração MCP](mcp.md) pode traduzir o idioma por você, usando três ferramentas:

- `list_custom_languages` — que idiomas personalizados existem e até onde cada um está traduzido.
- `get_untranslated_strings` — os textos em inglês que ainda faltam traduzir, página a página, com as instruções de tradução.
- `submit_translations` — envia as traduções de volta. Mostra primeiro uma pré-visualização e salva após a confirmação, como qualquer ferramenta de escrita do MCP.

Peça ao assistente, por exemplo: *«Traduza os textos ausentes do nosso idioma personalizado neerlandês, começando pelos nomes do metamodelo.»* O assistente trabalha com as suas próprias permissões, e cada alteração que faz fica registrada no registro de auditoria.

## O arquivo de pacote de idioma

Um pacote de idioma é um arquivo JSON como este:

```json
{
  "format": "turbo-ea-language-pack",
  "format_version": 1,
  "app_version": "2.214.0",
  "locale": {"code": "nl", "name": "Nederlands", "english_name": "Dutch", "rtl": false},
  "mode": "missing",
  "instructions": "Translate every value under \"strings\" from English into Dutch. …",
  "strings": {
    "metamodel": {
      "type.Application.label": "Application",
      "type.Application.field.businessCriticality": "Business Criticality"
    },
    "common": {
      "actions.save": "Save",
      "actions.cancel": "Cancel"
    }
  },
  "source_hashes": {
    "metamodel": {
      "type.Application.label": "5c1e0a9d7b32",
      "type.Application.field.businessCriticality": "a90d3f17c4e8"
    },
    "common": {
      "actions.save": "1f3a9c0b2d4e",
      "actions.cancel": "7b2e4d6a8c01"
    }
  }
}
```

- **strings** contém o texto a traduzir, agrupado por seção (`metamodel`, `common`, `admin`, `cards`, …). Traduza apenas os **valores**; nunca altere as chaves.
- A seção **metamodel** contém os nomes de tipos de card, campos, opções, relações e os restantes rótulos guardados no seu banco de dados. São rótulos curtos a que o resto da interface se refere: traduza-os primeiro e use as mesmas palavras para eles em todo o lado.
- Mantenha exatamente como está tudo o que estiver entre chavetas duplas, como `{{count}}` ou `{{name}}`: a aplicação preenche aí um valor. Mantenha também as tags como `<1>` e `</1>` e as referências como `$t(common:actions.save)`.
- **source_hashes** regista a partir de que texto em inglês cada texto foi feito. Deixe-o no arquivo: na importação, indica ao Turbo EA se o inglês mudou desde a exportação do arquivo. Para a seção **metamodel** é obrigatório — uma entrada sem o seu hash é recusada — porque é o que impede que uma tradução recaia sobre um nome renomeado entretanto.
- **instructions** repete estas regras em palavras simples, para que possa entregar o arquivo tal como está a um tradutor ou a um chat de IA.

Na importação, cada texto é verificado individualmente. Uma chave que esta versão do Turbo EA não tem — vinda de um pacote feito para outra versão — é contada como não existente nesta versão e nomeada no relatório. Um texto é rejeitado quando está vazio ou é muito mais longo do que o inglês, quando perde ou acrescenta um marcador ou uma referência `$t(...)`, ou quando traz uma tag ou um link que o texto em inglês não tem. Na seção **metamodel**, uma tradução é também recusada se não trouxer hash, e ignorada se o nome a partir do qual foi feita mudou desde a exportação do arquivo — uma tradução de «Application» nunca recai sobre um tipo de card que alguém renomeou. Uma tradução idêntica à já armazenada é indicada como inalterada. Um texto rejeitado nunca impede que os outros sejam salvos.

Um arquivo exportado para outro código de idioma pode ainda assim ser importado; é pedida confirmação antes.

## Revisar e corrigir textos

**Revisar textos** lista os textos de um idioma com o texto em inglês ao lado de cada tradução. Filtre por seção, por estado (ausentes, alterados em inglês, traduzidos) ou por texto, e edite ou limpe qualquer tradução no próprio local. As suas correções entram em vigor assim que as salvar.

## Após uma atualização

Cada versão do Turbo EA acrescenta e altera algum texto em inglês, e você pode renomear elementos do seu metamodelo. Depois, o idioma personalizado mostra os textos novos como **ausentes** e os alterados como **alterados em inglês** — todo o resto mantém a sua tradução. Preencha a lacuna de qualquer das três formas acima: exporte os textos novos e alterados, execute **Traduzir com IA** com **Textos novos e alterados**, ou peça ao seu assistente.

As correções feitas manualmente são mantidas. Uma execução de IA sobre **Tudo** deixa-as em paz, a menos que marque **Substituir também os textos corrigidos manualmente**.

## Limites

- **O site de documentação não é abrangido.** Este manual permanece nos idiomas integrados.
- **As pesquisas mantêm os rótulos com que foram criadas.** Uma pesquisa criada antes de as opções de um campo serem traduzidas mantém os rótulos de opção com que foi criada.
- **Formas plurais.** O inglês tem duas formas plurais (*one card*, *2 cards*). Um idioma com mais — como polonês, russo ou árabe — pode acrescentar as suas formas extra (`_few`, `_many`, …) ao lado das inglesas num arquivo importado. Uma forma que o pacote não traga recorre à forma geral do idioma (a tradução `_other`), nunca ao inglês. A tradução por IA e a tela de revisão também trabalham com as formas extra já armazenadas, mas não criam novas: acrescente-as por meio de um arquivo.
- Excluir um idioma personalizado remove todas as suas traduções, incluindo os nomes de tipos de card, campos e os restantes rótulos do metamodelo. Os usuários que o tinham escolhido voltam ao inglês.
