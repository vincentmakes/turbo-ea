# Risk Register

The **Risk Register** captures architecture risks through their full lifecycle — from identification to mitigation, residual assessment, monitoring and closure (or formal acceptance). It lives as a tab inside **EA Delivery → Risks**, alongside Initiatives, EA Principles, and Architecture Decisions.

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

1. **Manual** — Risks tab → **+ New risk**. Blank form.
2. **From a CVE finding** — TurboLens → Security & Compliance → CVE drawer → **Create risk**. Pre-fills title (CVE ID on card), description (NVD text + business impact + CVSS), category `security`, probability/impact from the CVE, mitigation from the finding's remediation, and links the affected card.
3. **From a compliance finding** — TurboLens → Security & Compliance → Compliance tab → **Create risk** on a non-compliant finding. Pre-fills category `compliance`, probability/impact from regulation severity + status, description from requirement + gap.

All three variants include **Owner**, **Category**, and **Target resolution date** fields so you can assign accountability at creation time — no need to re-open the risk to add them.

Promotion is **idempotent** — once a finding has been promoted its button flips to **Open risk R-000123** and navigates straight to the risk detail page.

## Ownership → Todo + notification

Assigning an **owner** (either at create time or later) automatically:

- Creates a **system Todo** on the owner's Todos page. The description reads `[Risk R-000123] <title>`, the due date mirrors the risk's target resolution date, and the link jumps back to the risk detail. The Todo auto-marks as **done** when the risk reaches `mitigated` / `monitoring` / `accepted` / `closed`.
- Fires a **bell notification** (`risk_assigned`) — shown in the bell dropdown and the notifications page, with optional email if the user has opted in. Self-assignment also fires the bell, so the trail is consistent across team and personal workflows.

Clearing or reassigning the owner keeps the Todo in sync — the old one is removed / reassigned.

## Linking risks to cards

Risks are **many-to-many** with Cards. A risk can affect multiple Applications or IT Components, and a Card can have multiple risks linked to it:

- From the risk detail page: **Affected cards** panel → search and add. Click an `×` to unlink.
- From any Card detail page: new **Risks** tab lists every risk linked to that card, with a one-click path back to the register.

## Risk matrix

Both the TurboLens Security Overview and the Risk Register page render a 4×4 probability × impact heatmap. Cells are **clickable** — click one to filter the list below to just that bucket, click again (or the chip's ×) to clear. On the Risk Register you can toggle the matrix between **Initial** and **Residual** views so mitigation progress shows up visually.

## Status workflow

The detail page always shows a single **primary Next step** button plus a smaller row of side actions, so the sequential path is obvious but governance escape hatches remain one click away:

| Current state | Next step (primary button) | Side actions |
|---|---|---|
| identified | Start analysis | Accept risk |
| analysed | Plan mitigation | Accept risk |
| mitigation_planned | Start mitigation | Accept risk |
| in_progress | Mark mitigated | Accept risk |
| mitigated | Start monitoring | Resume mitigation · Close without monitoring |
| monitoring | Close | Resume mitigation · Accept risk |
| accepted | — | Reopen · Close |
| closed | — | Reopen |

Full transition graph (enforced server-side):

```
identified → analysed → mitigation_planned → in_progress → mitigated → monitoring → closed
       │           │             │                │            ▲           ▲
       └───────────┴─────────────┴────────────────┴──── accepted (rationale required)
                                                              │
                              reopen → in_progress ◄──────────┘
```

- **Accepting** a risk requires an acceptance rationale. The user, timestamp and rationale are captured on the record.
- **Reopening** an `accepted` / `closed` risk goes back to `in_progress`. `mitigated` also allows a manual "Resume mitigation" without needing a full reopen.

## Permissions

| Permission | Who gets it by default |
|------------|------------------------|
| `risks.view` | admin, bpm_admin, member, viewer |
| `risks.manage` | admin, bpm_admin, member |

Viewers can see the register and risks on cards but cannot create, edit or delete.
