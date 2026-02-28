# Portais Web

O recurso de **Portais Web** (**Admin > Configurações > Portais Web**) permite criar **visualizações públicas e somente leitura** de dados selecionados de cards — acessíveis sem autenticação através de uma URL única.

## Caso de Uso

Portais web são úteis para compartilhar informações de arquitetura com partes interessadas que não possuem uma conta no Turbo EA:

- **Catálogo de tecnologia** — Compartilhe o cenário de aplicações com usuários de negócio
- **Diretório de serviços** — Publique serviços de TI e seus proprietários
- **Mapa de capacidades** — Forneça uma visualização pública das capacidades de negócio

## Criando um Portal

1. Navegue até **Admin > Configurações > Portais Web**
2. Clique em **+ Novo Portal**
3. Configure o portal:

| Campo | Descrição |
|-------|-----------|
| **Nome** | Nome de exibição para o portal |
| **Slug** | Identificador amigável para URL (gerado automaticamente a partir do nome, editável). O portal será acessível em `/portal/{slug}` |
| **Tipo de Card** | Qual tipo de card exibir |
| **Subtipos** | Opcionalmente restringir a subtipos específicos |
| **Mostrar Logo** | Se deve exibir o logotipo da plataforma no portal |

## Configurando Visibilidade

Para cada portal, você controla exatamente quais informações são visíveis. Há dois contextos:

### Propriedades da Visualização em Lista

Quais colunas/propriedades aparecem na lista de cards:

- **Propriedades incorporadas**: descrição, ciclo de vida, tags, qualidade dos dados, status de aprovação
- **Campos personalizados**: Cada campo do esquema do tipo de card pode ser alternado individualmente

### Propriedades da Visualização de Detalhe

Quais informações aparecem quando um visitante clica em um card:

- Mesmos controles de alternância que a visualização em lista, mas para o painel de detalhe expandido

## Acesso ao Portal

Portais são acessados em:

```
https://your-turbo-ea-domain/portal/{slug}
```

Nenhum login é necessário. Visitantes podem navegar pela lista de cards, pesquisar e ver detalhes dos cards — mas apenas as propriedades que você habilitou são mostradas.

!!! note
    Portais são somente leitura. Visitantes não podem editar, comentar ou interagir com cards. Dados sensíveis (partes interessadas, comentários, histórico) nunca são expostos nos portais.
