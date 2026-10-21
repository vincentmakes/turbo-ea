"""Helpers for opening / committing mutation batches around MCP write tools.

Every MCP write tool flows through these helpers so the audit log gets a
batch row, every event the underlying backend handler publishes is
stamped with the same ``batch_id``, and commits above the per-call
confirmation threshold (S3) must present the ``confirm_token`` their
dry-run was issued.

Usage from a tool handler::

    async with mutation_batch(
        token, tool_name="create_cards_bulk",
        row_count=len(cards), dry_run=dry_run,
        confirm_token=confirm_token,
    ) as batch:
        client = batch.client()
        data = await client.post("/cards/bulk-create",
                                 json={"cards": cards, "dry_run": dry_run})
        batch.summary = {"rows": len(cards), "results": data.get("results", [])}
        # On block exit, the batch is committed with the summary.

The context manager guarantees:

- A batch row exists before any write — so events emitted by the
  underlying handler land with the right ``batch_id`` even if the
  request crashes mid-flight.
- On clean exit, the batch is closed (``committed_at`` stamped) — dry-run
  batches included: a preview is recorded in the audit log like any
  other call, and closing it never needs a token.
- On exception, the batch is closed with an error summary so the
  half-done state is still queryable via ``get_change_history``.
"""

from __future__ import annotations

from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from typing import Any

from turbo_ea_mcp.api_client import TurboEAClient


@dataclass
class BatchContext:
    """Mutable handle returned by :func:`mutation_batch`. The tool
    handler sets :attr:`summary` before the context manager exits so the
    commit call persists per-row outcomes."""

    token: str
    batch_id: str | None
    open_response: dict[str, Any]
    summary: dict[str, Any] | None = field(default=None)
    dry_run: bool = True

    @property
    def confirm_token_issued(self) -> str | None:
        """Token the backend issued to this dry-run — only present above
        the confirmation threshold. The agent passes it back on the
        commit call, whose batch open the backend verifies it against.
        A real batch's open response echoes the token it presented; that
        one was not *issued* here, so it is never reported."""
        if not self.dry_run:
            return None
        tok = self.open_response.get("confirm_token")
        return tok if isinstance(tok, str) and tok else None

    def client(self) -> TurboEAClient:
        """``TurboEAClient`` with the batch id pre-set so every backend
        write inside the context is stamped with the same id."""
        return TurboEAClient(self.token, batch_id=self.batch_id)


@asynccontextmanager
async def mutation_batch(
    token: str,
    *,
    tool_name: str,
    row_count: int,
    dry_run: bool,
    confirm_token: str | None = None,
):
    """Open a mutation batch, yield a :class:`BatchContext`, commit on exit.

    Args:
        token: Turbo EA JWT for backend calls.
        tool_name: The MCP tool that opened the batch (lands in the
            audit log so admins can filter MCP-driven writes by tool).
        row_count: Number of rows the wrapper intends to write. Above
            the threshold the backend issues a ``confirm_token`` to a
            dry-run and requires one from a real batch.
        dry_run: Whether this batch is in preview mode. Dry-run batches
            are recorded and closed like any other; the token they were
            issued authorises the *next* real batch of the same tool.
        confirm_token: On a real batch above the threshold, the token the
            dry-run was issued. It travels in the open body, where the
            backend checks it (same user, same tool, 15 minutes, single
            use) before any write happens.
    """
    # Use a fresh client for the open/commit calls — the batch id is
    # not yet known so no ``X-Turbo-EA-Batch`` header.
    bootstrap = TurboEAClient(token)
    open_payload: dict[str, Any] = {"tool_name": tool_name, "dry_run": dry_run}
    if confirm_token:
        open_payload["confirm_token"] = confirm_token
    open_resp = await bootstrap.post(
        f"/mutation-batches?row_count={row_count}", json=open_payload
    )
    batch_id = open_resp.get("id") if isinstance(open_resp, dict) else None
    ctx = BatchContext(
        token=token,
        batch_id=batch_id,
        open_response=open_resp if isinstance(open_resp, dict) else {},
        dry_run=dry_run,
    )
    try:
        yield ctx
    except Exception as exc:  # noqa: BLE001 — surface the cause in audit
        # Best-effort close so a failed batch is still queryable. We
        # don't re-raise from the commit call; the original exception
        # is what the caller needs to see.
        try:
            await bootstrap.post(
                f"/mutation-batches/{batch_id}/commit",
                json={"summary": {"status": "errored", "error": str(exc)}},
            )
        except Exception:  # noqa: BLE001
            pass
        raise
    else:
        commit_body: dict[str, Any] = {"summary": ctx.summary or {"status": "ok"}}
        if ctx.confirm_token_issued:
            # Ignored by a current backend; a backend older than 2.175.1
            # refused to close a token-bearing dry-run without it (#1302).
            commit_body["confirm_token"] = ctx.confirm_token_issued
        await bootstrap.post(f"/mutation-batches/{batch_id}/commit", json=commit_body)
