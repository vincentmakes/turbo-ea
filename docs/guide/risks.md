# Risk Register

The **Risk Register** captures architecture risks through their full lifecycle — from identification to mitigation, residual assessment, monitoring and closure (or formal acceptance). It lives under **EA Delivery → Risks** alongside SoAW and ADR documents.

## TOGAF alignment

The register implements the Architecture Risk Management process from **TOGAF ADM Phase G — Implementation Governance** (TOGAF 10 §27):

| TOGAF step | What you capture |
|-----------|------------------|
| Risk classification | `Category` (security, compliance, operational, technology, financial, reputational, strategic) |
| Risk identification | `Title`, `Description`, `Source` (manual or promoted from a TurboLens finding) |
| Initial assessment | `Initial probability × Initial impact → Initial level` (derived automatically) |
| Mitigation | `Mitigation plan`, `Owner`, `Target resolution date` |
| Residual assessment | `Residual probability × Residual impact → Residual level` (editable once mitigation is planned) |
| Monitoring / acceptance | `Status` workflow: identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed (with an `accepted` side-branch requiring an explicit rationale) |

## Creating a risk

Three paths all land in the same **Create risk** dialog — each variant prefills different fields so you can edit and submit:

1. **Manual** — Risks page → **+ New risk**. Blank form.
2. **From a CVE finding** — TurboLens → Security & Compliance → CVE drawer → **Create risk**. Pre-fills title (CVE ID on card), description (NVD text + business impact + CVSS), category `security`, probability/impact from the CVE, mitigation from the finding's remediation, and links the affected card.
3. **From a compliance finding** — TurboLens → Security & Compliance → Compliance tab → **Create risk** on a non-compliant finding. Pre-fills category `compliance`, probability/impact from regulation severity + status, description from requirement + gap.

Promotion is **idempotent** — once a finding has been promoted its button flips to **Open risk R-000123** and navigates straight to the risk detail page.

## Linking risks to cards

Risks are **many-to-many** with Cards. A risk can affect multiple Applications or IT Components, and a Card can have multiple risks linked to it:

- From the risk detail page: **Affected cards** panel → search and add. Click an `×` to unlink.
- From any Card detail page: new **Risks** tab lists every risk linked to that card, with a one-click path back to the register.

## Risk matrix

Both the TurboLens Security Overview and the Risk Register page render a 4×4 probability × impact heatmap. Cells are **clickable** — click one to filter the list below to just that bucket, click again (or the chip's ×) to clear. On the Risk Register you can toggle the matrix between **Initial** and **Residual** views so mitigation progress shows up visually.

## Status workflow

The stepper on the detail page enforces valid transitions:

```
identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed
       │           │                                                   ▲
       └───────────┴──────────── accepted (requires rationale) ────────┘
```

- **Accepting** a risk requires an acceptance rationale. The user, timestamp and rationale are captured on the record.
- **Reopening** is always possible — `closed`, `monitoring` and `accepted` risks all allow a move back to `in_progress`.

## Permissions

| Permission | Who gets it by default |
|------------|------------------------|
| `risks.view` | admin, bpm_admin, member, viewer |
| `risks.manage` | admin, bpm_admin, member |

Viewers can see the register and risks on cards but cannot create, edit or delete.
