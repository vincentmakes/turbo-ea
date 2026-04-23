# Registo de Riscos

O **Registo de Riscos** captura os riscos de arquitetura ao longo de todo o seu ciclo de vida — da identificação à mitigação, avaliação residual, monitorização e fecho (ou aceitação formal). Vive como um separador dentro de **EA Delivery → Riscos**, ao lado de Iniciativas, Princípios de EA e Decisões de Arquitetura.

## Alinhamento com TOGAF

O registo implementa o processo de Gestão de Riscos de Arquitetura da **TOGAF ADM Fase G — Governança da Implementação** (TOGAF 10 §27):

| Passo TOGAF | O que é capturado |
|-------------|-------------------|
| Classificação do risco | `Categoria` (security, compliance, operational, technology, financial, reputational, strategic) |
| Identificação do risco | `Título`, `Descrição`, `Origem` (manual ou promovida a partir de um achado TurboLens) |
| Avaliação inicial | `Probabilidade inicial × Impacto inicial → Nível inicial` (derivado automaticamente) |
| Mitigação | `Plano de mitigação`, `Proprietário`, `Data-alvo de resolução` |
| Avaliação residual | `Probabilidade residual × Impacto residual → Nível residual` (editável assim que a mitigação é planeada) |
| Monitorização / aceitação | Fluxo de `Estado`: identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed (com um ramo lateral `accepted` que requer uma justificação explícita) |

## Criar um risco

Três caminhos convergem no mesmo diálogo **Criar risco** — cada variante pré-preenche campos diferentes para que possa editar e submeter:

1. **Manual** — separador Riscos → **+ Novo risco**. Formulário em branco.
2. **A partir de um achado CVE** — TurboLens → Segurança e Conformidade → painel CVE → **Criar risco**. Pré-preenche título (ID do CVE sobre o card), descrição (texto do NVD + impacto de negócio + CVSS), categoria `security`, probabilidade/impacto a partir do CVE, mitigação a partir da remediação do achado e liga o card afetado.
3. **A partir de um achado de conformidade** — TurboLens → Segurança e Conformidade → separador Conformidade → **Criar risco** num achado não conforme. Pré-preenche categoria `compliance`, probabilidade/impacto a partir da severidade + estado da regulação, descrição a partir do requisito + lacuna.

As três variantes incluem os campos **Proprietário**, **Categoria** e **Data-alvo de resolução** para atribuir responsabilidade logo na criação — sem necessidade de reabrir o risco.

A promoção é **idempotente** — depois que um achado é promovido, o seu botão passa a **Abrir risco R-000123** e navega diretamente para a página de detalhe do risco.

## Propriedade → Todo + notificação

Atribuir um **proprietário** (na criação ou mais tarde) gera automaticamente:

- Um **Todo de sistema** na página de Todos do proprietário. A descrição é `[Risk R-000123] <título>`, a data-limite reflete a data-alvo de resolução do risco e o link volta ao detalhe do risco. O Todo é marcado como **concluído** automaticamente quando o risco atinge `mitigated` / `monitoring` / `accepted` / `closed`.
- Uma **notificação no sino** (`risk_assigned`) — visível no menu do sino e na página de notificações, com e-mail opcional se o utilizador tiver ativado essa preferência. A auto-atribuição também dispara o sino, para que o rasto seja consistente entre fluxos de equipa e pessoais.

Limpar ou reatribuir o proprietário mantém o Todo sincronizado — o antigo é removido / reatribuído.

## Ligar riscos a cards

Os riscos são **muitos-para-muitos** com os cards. Um risco pode afetar várias Aplicações ou Componentes de TI, e um card pode ter vários riscos ligados:

- A partir da página de detalhe do risco: painel **Cards afetados** → procurar e adicionar. Clique num `×` para desligar.
- A partir de qualquer página de detalhe de card: o novo separador **Riscos** lista cada risco ligado a esse card, com um regresso em um clique ao registo.

## Matriz de riscos

Tanto a Visão Geral de Segurança do TurboLens como a página do Registo de Riscos apresentam um mapa de calor probabilidade × impacto 4×4. As células são **clicáveis** — clique numa para filtrar a lista abaixo por esse compartimento, clique novamente (ou no × do chip) para limpar. No Registo de Riscos pode alternar a matriz entre as vistas **Inicial** e **Residual** para que o progresso da mitigação apareça visualmente.

## Fluxo de estado

A página de detalhe mostra sempre um único botão primário **Próximo passo** mais uma pequena linha de ações laterais, de modo que o caminho sequencial seja óbvio mas as saídas de governança fiquem a um clique de distância:

| Estado atual | Próximo passo (botão primário) | Ações laterais |
|---|---|---|
| identified | Iniciar análise | Aceitar risco |
| analysed | Planear mitigação | Aceitar risco |
| mitigation_planned | Iniciar mitigação | Aceitar risco |
| in_progress | Marcar mitigado | Aceitar risco |
| mitigated | Iniciar monitorização | Retomar mitigação · Fechar sem monitorização |
| monitoring | Fechar | Retomar mitigação · Aceitar risco |
| accepted | — | Reabrir · Fechar |
| closed | — | Reabrir |

Grafo completo de transições (validado pelo servidor):

```
identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed
       │           │             │                │            ▲           ▲
       └───────────┴─────────────┴────────────────┴──── accepted (justificação requerida)
                                                              │
                              reopen → in_progress ◄──────────┘
```

- **Aceitar** um risco requer uma justificação de aceitação. Utilizador, carimbo temporal e justificação ficam registados no registo.
- **Reabrir** um risco `accepted` / `closed` volta para `in_progress`. O estado `mitigated` também permite uma «Retomar mitigação» manual sem necessidade de uma reabertura completa.

## Permissões

| Permissão | Quem a recebe por omissão |
|-----------|----------------------------|
| `risks.view` | admin, bpm_admin, member, viewer |
| `risks.manage` | admin, bpm_admin, member |

Os viewers podem ver o registo e os riscos nos cards mas não podem criar, editar ou apagar.
