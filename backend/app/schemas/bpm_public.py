"""Account-less response shapes for the public Process Navigator portal.

These are deliberately **separate models**, not a trimmed view of the internal
BPM payloads. A subtractive filter over the internal shape fails open: the next
field added to ``/reports/bpm/process-map``'s item — or to
``bpm_workflow._version_response`` — would publish itself to every anonymous
visitor. Listing the public fields explicitly means a new internal field is
invisible here until someone deliberately adds it.

Same reasoning, and the same shape, as ``app.schemas.ppm_public`` and as
``_user_response`` vs ``_user_response_lite`` in ``app/api/v1/users.py``.

What is withheld here, unconditionally and with no switch to turn it on:

* **The application and data landscape.** The internal process-map item carries
  ``apps[]`` (with each Application's *full* attributes, costs included),
  ``data_objects[]``, ``app_count`` and ``total_cost``. A navigator portal
  publishes the Process House and its flows; it does not publish which systems
  run them, and a bare per-process application count is itself an inventory
  signal ("Order-to-Cash is supported by 14 systems") that nobody asked to
  publish. The Apps and Data drawer tabs are not rendered by a portal at all.
* **Business contexts** (``ctx_ids`` / ``business_contexts``) — fetched by the
  authenticated navigator today but never read by it.
* **Every identifier except the process card's own.** Organization references
  become opaque per-response tokens (``o0``, ``o1``, …); element, application,
  data-object, IT-component and user ids are not emitted at all.
* **The flow's audit trail.** ``created_by``/``submitted_by``/``approved_by``/
  ``withdrawn_by`` and their resolved display names, ``withdrawal_reason``,
  ``based_on_id`` and ``draft_element_links`` all stay behind the login.
  Publishing an approver's name is a personal-data leak that no switch asks for.
* **Governance signals** — ``data_quality``, ``approval_status`` and tags.

Why the process card's own UUID *is* published: the flow endpoint needs a stable
handle for it, and ``?open=`` / ``?zoom=`` deep links into a published house must
survive a reload and a concurrent card creation, which a positional token cannot.
The portal links nowhere, so the id grants no navigation, and the flow route
re-checks portal scope on every request — the security lives in that check, not
in the opacity of the id. Note for future work: a real card id on a public
surface is also usable against any *other* unauthenticated by-id route (today
only ``GET /cards/{id}/logo``, which is public by design), so a new one must
account for portals handing these out.
"""

from __future__ import annotations

from pydantic import BaseModel

# The only ``cards.attributes`` keys a navigator portal publishes: the four
# colour overlays the Process House draws, plus the sibling ordering it sorts by.
# A whitelist rather than a blacklist because ``BusinessProcess`` is an
# admin-extensible card type — an administrator can add any field to it,
# including a ``type: "cost"`` one, and a subtractive filter would publish the
# next one added. ``maturity`` is the real key; it is *not* ``maturityLevel``
# (see ``ATTR_COLORS`` / ``OVERLAY_OPTIONS`` in ``ProcessNavigator.tsx``).
PUBLIC_PROCESS_ATTRIBUTES: tuple[str, ...] = (
    "processType",
    "maturity",
    "automationLevel",
    "riskLevel",
    "sortOrder",
)


class BpmPublicRef(BaseModel):
    """A named thing referenced by an opaque, per-response token.

    Used for Organizations, which the House's organization filter matches on
    client-side within a single payload — so the token only has to be stable
    for the life of one response, and a real card id would be published for
    nothing.
    """

    token: str
    name: str


class BpmPublicProcess(BaseModel):
    """One node of the published Process House.

    ``parent_id`` shares the id space with ``id`` so the client's ``buildTree``
    still assembles the hierarchy. A process whose parent is out of the portal's
    scope simply becomes a root — the same re-rooting the authenticated
    navigator already does for a filtered tree.
    """

    id: str
    name: str
    subtype: str | None = None
    parent_id: str | None = None
    description: str | None = None
    lifecycle: dict = {}
    attributes: dict = {}
    org_tokens: list[str] = []
    # Whether a *published* ProcessFlowVersion exists — never a draft, and never
    # the legacy ``process_diagrams`` row.
    has_flow: bool = False
    # Number of steps in that published flow. Zero unless ``has_flow``: the
    # legacy ``PUT /bpm/processes/{id}/diagram`` writes ``process_elements`` rows
    # itself, with no approval involved, so counting the table would leak the
    # shape of an unapproved flow.
    step_count: int = 0


class BpmPublicProcessMap(BaseModel):
    """Everything the published Process House needs, in one round-trip.

    ``row_order`` rides along rather than being a second request. It is served
    by ``GET /settings/bpm-row-order``, which happens to be unauthenticated
    today, but a portal must not depend on another route's incidental
    public-ness — and one round-trip is the posture the PPM board set.
    """

    row_order: list[str] = []
    organizations: list[BpmPublicRef] = []
    items: list[BpmPublicProcess] = []


class BpmPublicStep(BaseModel):
    """One step of a published BPMN flow.

    ``bpmn_element_id`` is an id local to the BPMN XML, not a card id, and it is
    the correlation key the viewer needs to place overlays — it is already
    inside the XML the visitor is holding.

    The four link fields are populated only when the portal enables
    ``show_element_links``; they carry **names, never ids**. The viewer's and the
    Steps tab's existing truthiness guards then render the reduced row with no
    extra branching.
    """

    bpmn_element_id: str
    element_type: str
    name: str | None = None
    documentation: str | None = None
    lane_name: str | None = None
    is_automated: bool = False
    sequence_order: int = 0
    application_name: str | None = None
    data_object_name: str | None = None
    it_component_name: str | None = None
    organizations: list[BpmPublicRef] = []


class BpmPublicFlow(BaseModel):
    """The published BPMN flow for one in-scope process.

    ``bpmn_xml`` is ``None`` and ``steps`` empty when the process has no
    published version — including when it has only drafts, only archived or
    withdrawn revisions, or only a legacy ``process_diagrams`` row. That is not
    an error: the House marks such a process as having no flow, and the drawer
    renders its empty state.
    """

    revision: int | None = None
    published_at: str | None = None
    bpmn_xml: str | None = None
    svg_thumbnail: str | None = None
    steps: list[BpmPublicStep] = []
