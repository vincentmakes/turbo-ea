"""Workspace transfer grants are independent of the interactive invoice permissions."""

from datetime import date
from decimal import Decimal

from sqlalchemy import select

from app.api.v1 import workspace as workspace_api
from app.models.ppm_invoice import PpmInvoice
from app.services.workspace_io import parse_bundle
from tests.conftest import (
    auth_headers,
    create_card,
    create_card_type,
    create_cost_line,
    create_role,
    create_user,
)

WORKSPACE = "/api/v1/admin/workspace"


async def test_workspace_transfer_grants_allow_invoice_backup_and_restore(
    client, db, tmp_path, monkeypatch, patched_async_session
):
    monkeypatch.setattr(workspace_api, "_BUNDLE_DIR", tmp_path)
    await create_role(
        db,
        key="workspace_operator",
        permissions={"admin.export_workspace": True, "admin.import_workspace": True},
    )
    await create_role(
        db,
        key="pml_editor",
        permissions={
            "inventory.view": True,
            "ppm.view": True,
            "ppm.manage": True,
            "costs.view": True,
        },
    )
    operator = auth_headers(await create_user(db, role="workspace_operator"))
    editor = auth_headers(await create_user(db, role="pml_editor"))
    await create_card_type(
        db,
        key="Initiative",
        label="Initiative",
        built_in=True,
        fields_schema=[
            {
                "section": "Timeline",
                "fields": [
                    {"key": "actualStart", "type": "date", "built_in": True},
                    {"key": "actualEnd", "type": "date", "built_in": True},
                ],
            }
        ],
    )
    initiative = await create_card(db, card_type="Initiative", name="Transfer initiative")
    # A historical Cost Item without a budget can still have an invoice.
    cost = await create_cost_line(db, initiative_id=initiative.id, actual=100)
    invoice = PpmInvoice(
        initiative_id=initiative.id,
        cost_item_id=cost.id,
        invoice_date=date(2026, 11, 23),
        invoice_id="00038",
        amount=Decimal("30.11"),
    )
    db.add(invoice)
    await db.flush()
    invoice_id, initiative_id, cost_id = invoice.id, initiative.id, cost.id
    await db.commit()

    financials = f"/api/v1/ppm/initiatives/{initiative_id}/financials"
    denied = await client.get(financials, headers=operator)
    assert denied.status_code in (403, 404)
    allowed = await client.get(financials, headers=editor)
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["invoices"][0]["invoice_id"] == "00038"

    denied_export = await client.get(f"{WORKSPACE}/export", headers=editor)
    assert denied_export.status_code == 403
    exported = await client.get(f"{WORKSPACE}/export", headers=operator)
    assert exported.status_code == 200, exported.text
    with parse_bundle(exported.content) as bundle:
        [exported_invoice] = bundle.sheets["PpmInvoices"]
    assert exported_invoice["invoice_id"] == "00038"
    assert exported_invoice["amount"] == "30.11"

    await db.delete(invoice)
    await db.commit()
    files = {"file": ("workspace.zip", exported.content, "application/zip")}
    denied_upload = await client.post(f"{WORKSPACE}/import", files=files, headers=editor)
    assert denied_upload.status_code == 403
    uploaded = await client.post(f"{WORKSPACE}/import", files=files, headers=operator)
    assert uploaded.status_code == 202, uploaded.text
    transfer = f"{WORKSPACE}/import/{uploaded.json()['id']}"
    preview = await client.get(transfer, headers=operator)
    assert preview.json()["status"] == "previewed", preview.text
    assert preview.json()["diff"]["totals"]["conflict"] == 0
    assert await db.get(PpmInvoice, invoice_id) is None

    denied_apply = await client.post(f"{transfer}/apply", headers=editor)
    assert denied_apply.status_code == 403
    applied = await client.post(f"{transfer}/apply", headers=operator)
    assert applied.status_code == 202, applied.text
    result = await client.get(transfer, headers=operator)
    assert result.json()["status"] == "applied", result.text
    restored = await db.scalar(select(PpmInvoice).where(PpmInvoice.id == invoice_id))
    assert restored is not None
    assert (restored.initiative_id, restored.cost_item_id) == (initiative_id, cost_id)
    assert (restored.invoice_id, restored.amount) == ("00038", Decimal("30.11"))
