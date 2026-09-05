# Extensões

As **extensões** acrescentam capacidades ao Turbo EA sem alterar o núcleo:
conteúdo adicional de metamodelo, integrações com as ferramentas que as suas
equipas já usam, relato regulamentar e páginas inteiramente novas. São criadas e
assinadas pela Turbo EA e instalam-se em **Admin → Extensões**.

Esta secção descreve *o que faz* cada extensão publicada e como utilizá-la. Para
saber como funciona a própria loja — confiança e assinaturas, licenças,
identificadores de instância, instalação, atualizações e períodos experimentais —
consulte [Administração → Loja de extensões](../admin/extensions.md).

## Extensões disponíveis

### Estratégia, planeamento e transformação

| Extensão | O que faz | Licença |
|----------|-----------|---------|
| [Digital Autonomy Assessment](digital-autonomy.md) | Avalia cada aplicação segundo o Digital Autonomy Assessment Framework da Universidade de Utreque — 22 indicadores ponderados, uma pontuação de autonomia automática de 1 a 10 e um quadrante risco/mitigação | **Gratuita** |
| [EA Value Tracker](value-savings.md) | Transforma as decisões de arquitetura num registo financeiro auditável: poupanças declaradas por categoria, aprovação da realização com quatro olhos e um painel de valor | Comercial |
| [Roadmap Studio](roadmap-studio.md) | Planeia futuros alternativos do panorama como cenários, percorre os patamares de transição, compara-os por custo e exposição ao fim de vida, e leva-os da revisão à decisão de um comité | Comercial |
| [Automations](automations.md) | Executa regras de governação construídas a partir de listas pendentes — quando um cartão, uma relação ou uma tarefa muda ou um horário dispara, se as condições se verificam, então define campos, etiquetas e papéis, cria tarefas, levanta riscos, arquiva rascunhos de decisão, notifica pessoas ou chama um webhook — cada execução é um lote de auditoria com Reverter | Comercial |

### Integrações

| Extensão | O que faz | Licença |
|----------|-----------|---------|
| [Jira Todo Sync](jira-todos.md) | Mantém alinhadas nos dois sentidos as tarefas do Turbo EA e um projeto do Jira Cloud — estado, título, prazo e responsável | Comercial |
| [Slack Notifications](slack-notify.md) | Entrega a cada pessoa as suas notificações do Turbo EA como mensagem direta do Slack, com adesão voluntária por pessoa e por tipo | Comercial |

### Regulamentações

| Extensão | O que faz | Licença |
|----------|-----------|---------|
| [DORA Register of Information](dora-roi.md) | Mantém o registo de informação do art. 28.º do DORA sobre os seus cartões existentes e exporta o pacote oficial de submissão xBRL-CSV | Comercial |

## O que todas as extensões têm em comum

- **Assinadas pelo fornecedor.** Cada pacote traz uma assinatura Ed25519 que o
  Turbo EA verifica no carregamento *e* em cada arranque do backend. O que se
  instala é exatamente o que o fornecedor produziu.
- **Sujeitas a licença em execução** (exceto as gratuitas). Se uma licença expirar,
  a extensão é desativada de forma suave — as suas páginas desaparecem e as suas
  tarefas param — mas **os seus dados nunca são eliminados**. Uma licença renovada
  repõe tudo.
- **Privilégio mínimo.** Tudo o que uma extensão lê ou escreve para além dos seus
  próprios dados é declarado como **autorização** dentro do pacote assinado, sendo
  por isso visível antes da instalação. Ver
  [Autorizações de acesso a dados](../admin/extensions.md).
- **Permissões próprias.** Cada extensão define chaves de permissão com o formato
  `ext.<nome>.…` que aparecem em **Admin → Utilizadores e papéis** assim que é
  carregada: é você quem decide quem a pode utilizar.
- **Auditáveis.** Qualquer alteração que uma extensão faça ao seu inventário fica
  registada no **Admin → Registo de auditoria** com a origem **Extensão** e pode
  ser revertida.

## Antes de instalar

Verifique a **versão mínima do Turbo EA** indicada na página de cada extensão:
não será instalada num núcleo mais antigo. As extensões com código de backend
exigem um reinício pontual do backend após a instalação; o Turbo EA mostra então
um aviso.
