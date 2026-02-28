# Configurações Gerais

A página de **Configurações** (**Admin > Configurações**) fornece configuração centralizada para a aparência da plataforma, e-mail e alternâncias de módulos.

## Aparência

### Logo

Faça upload de um logotipo personalizado que aparece na barra de navegação superior. Formatos suportados: PNG, JPEG, SVG, WebP, GIF. Clique em **Redefinir** para reverter ao logotipo padrão do Turbo EA.

### Favicon

Faça upload de um ícone de navegador personalizado (favicon). A alteração entra em vigor no próximo carregamento de página. Clique em **Redefinir** para reverter ao ícone padrão.

### Moeda

Selecione a moeda usada para campos de custo em toda a plataforma. Isso afeta como os valores de custo são formatados nas páginas de detalhe de cards, relatórios e exportações. Mais de 20 moedas são suportadas, incluindo USD, EUR, GBP, JPY, CNY, CHF, INR, BRL e mais.

### Idiomas Habilitados

Alterne quais idiomas estão disponíveis para os usuários no seletor de idioma. Todos os sete idiomas suportados podem ser individualmente habilitados ou desabilitados:

- English, Deutsch, Français, Español, Italiano, Português, 中文

Pelo menos um idioma deve permanecer habilitado o tempo todo.

## E-mail (SMTP)

Configure a entrega de e-mail para convites, notificações de pesquisas e outras mensagens do sistema.

| Campo | Descrição |
|-------|-----------|
| **Host SMTP** | O hostname do seu servidor de e-mail (ex.: `smtp.gmail.com`) |
| **Porta SMTP** | Porta do servidor (tipicamente 587 para TLS) |
| **Usuário SMTP** | Nome de usuário para autenticação |
| **Senha SMTP** | Senha de autenticação (armazenada criptografada) |
| **Usar TLS** | Habilitar criptografia TLS (recomendado) |
| **Endereço de Remetente** | O endereço de e-mail do remetente para mensagens enviadas |
| **URL Base do App** | A URL pública da sua instância Turbo EA (usada em links de e-mail) |

Após configurar, clique em **Enviar E-mail de Teste** para verificar se as configurações funcionam corretamente.

!!! note
    E-mail é opcional. Se o SMTP não estiver configurado, recursos que enviam e-mails (convites, notificações de pesquisa) simplesmente ignorarão a entrega de e-mail.

## Módulo BPM

Alterne o módulo de **Business Process Management** ligado ou desligado. Quando desabilitado:

- O item de navegação **BPM** é oculto para todos os usuários
- Cards de Processo de Negócio permanecem no banco de dados, mas recursos específicos de BPM (editor de fluxo de processo, painel BPM, relatórios BPM) não estão acessíveis

Isso é útil para organizações que não usam BPM e desejam uma experiência de navegação mais limpa.
