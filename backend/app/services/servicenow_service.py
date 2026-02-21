"""ServiceNow integration service — REST client, field transformer, sync engine."""

from __future__ import annotations

import base64
import hashlib
import logging
import re
import uuid
from datetime import datetime, timezone
from difflib import SequenceMatcher
from typing import Any

import httpx
from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.models.card import Card
from app.models.servicenow import (
    SnowFieldMapping,
    SnowIdentityMap,
    SnowMapping,
    SnowStagedRecord,
    SnowSyncRun,
)
from app.services.event_bus import event_bus

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Credential encryption helpers
# ---------------------------------------------------------------------------

_fernet: Fernet | None = None


def _get_fernet() -> Fernet:
    """Derive a Fernet key from SECRET_KEY (deterministic)."""
    global _fernet
    if _fernet is None:
        key_bytes = hashlib.sha256(settings.SECRET_KEY.encode()).digest()
        _fernet = Fernet(base64.urlsafe_b64encode(key_bytes))
    return _fernet


def encrypt_credentials(creds: dict) -> dict:
    """Encrypt sensitive credential values."""
    import json

    f = _get_fernet()
    return {"_enc": f.encrypt(json.dumps(creds).encode()).decode()}


def decrypt_credentials(stored: dict) -> dict:
    """Decrypt stored credentials."""
    import json

    enc = stored.get("_enc")
    if not enc:
        return stored  # Legacy unencrypted or empty
    f = _get_fernet()
    try:
        return json.loads(f.decrypt(enc.encode()).decode())
    except InvalidToken:
        logger.error("Failed to decrypt ServiceNow credentials — key may have changed")
        return {}


# ---------------------------------------------------------------------------
# ServiceNow REST Client
# ---------------------------------------------------------------------------

# Validate instance URL pattern
INSTANCE_URL_PATTERN = re.compile(
    r"^https://[\w.-]+\.(service-now\.com|servicenowservices\.com)(:\d+)?(/.*)?$",
    re.IGNORECASE,
)


class ServiceNowClient:
    """Thin async wrapper around the ServiceNow Table API."""

    def __init__(self, instance_url: str, credentials: dict, auth_type: str = "basic"):
        self.instance_url = instance_url.rstrip("/")
        self.credentials = credentials
        self.auth_type = auth_type
        self._client: httpx.AsyncClient | None = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            auth = None
            headers: dict[str, str] = {"Accept": "application/json"}
            if self.auth_type == "basic":
                auth = httpx.BasicAuth(
                    self.credentials.get("username", ""),
                    self.credentials.get("password", ""),
                )
            elif self.auth_type == "oauth2":
                token = self.credentials.get("access_token", "")
                headers["Authorization"] = f"Bearer {token}"
            self._client = httpx.AsyncClient(
                base_url=self.instance_url,
                auth=auth,
                headers=headers,
                timeout=30.0,
            )
        return self._client

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def test_connection(self) -> tuple[bool, str]:
        """Test connectivity by fetching a small result from sys_db_object."""
        try:
            client = await self._get_client()
            resp = await client.get(
                "/api/now/table/sys_db_object",
                params={"sysparm_limit": "1", "sysparm_fields": "name"},
            )
            if resp.status_code == 200:
                return True, "Connection successful"
            return False, f"HTTP {resp.status_code}: {resp.text[:200]}"
        except httpx.HTTPError as exc:
            return False, f"Connection failed: {exc}"

    async def list_tables(self, search: str = "") -> list[dict[str, str]]:
        """List accessible ServiceNow tables."""
        client = await self._get_client()
        params: dict[str, str] = {
            "sysparm_fields": "name,label",
            "sysparm_limit": "200",
            "sysparm_query": "ORDERBYlabel",
        }
        if search:
            params["sysparm_query"] = f"nameLIKE{search}^ORlabelLIKE{search}^ORDERBY label"
        resp = await client.get("/api/now/table/sys_db_object", params=params)
        resp.raise_for_status()
        return resp.json().get("result", [])

    async def list_table_fields(self, table: str) -> list[dict[str, str]]:
        """List columns for a ServiceNow table."""
        if not re.match(r"^[a-zA-Z0-9_]+$", table):
            return []
        client = await self._get_client()
        resp = await client.get(
            "/api/now/table/sys_dictionary",
            params={
                "sysparm_query": f"name={table}^internal_type!=collection",
                "sysparm_fields": "element,column_label,internal_type",
                "sysparm_limit": "500",
            },
        )
        resp.raise_for_status()
        return resp.json().get("result", [])

    async def fetch_records(
        self,
        table: str,
        *,
        fields: list[str] | None = None,
        query: str = "",
        limit: int = 500,
        offset: int = 0,
    ) -> tuple[list[dict], int]:
        """Fetch records from a ServiceNow table. Returns (records, total_count)."""
        if not re.match(r"^[a-zA-Z0-9_]+$", table):
            return [], 0
        client = await self._get_client()
        params: dict[str, str] = {
            "sysparm_limit": str(limit),
            "sysparm_offset": str(offset),
            "sysparm_display_value": "false",
            "sysparm_exclude_reference_link": "true",
        }
        if fields:
            params["sysparm_fields"] = ",".join(["sys_id"] + fields)
        if query:
            params["sysparm_query"] = query
        resp = await client.get(f"/api/now/table/{table}", params=params)
        resp.raise_for_status()
        total = int(resp.headers.get("X-Total-Count", "0"))
        return resp.json().get("result", []), total

    async def create_record(self, table: str, data: dict) -> dict:
        """Create a record in ServiceNow."""
        if not re.match(r"^[a-zA-Z0-9_]+$", table):
            raise ValueError("Invalid table name")
        client = await self._get_client()
        resp = await client.post(
            f"/api/now/table/{table}",
            json=data,
            headers={"Content-Type": "application/json"},
        )
        resp.raise_for_status()
        return resp.json().get("result", {})

    async def update_record(self, table: str, sys_id: str, data: dict) -> dict:
        """Update a record in ServiceNow."""
        if not re.match(r"^[a-zA-Z0-9_]+$", table):
            raise ValueError("Invalid table name")
        if not re.match(r"^[a-f0-9]{32}$", sys_id):
            raise ValueError("Invalid sys_id")
        client = await self._get_client()
        resp = await client.patch(
            f"/api/now/table/{table}/{sys_id}",
            json=data,
            headers={"Content-Type": "application/json"},
        )
        resp.raise_for_status()
        return resp.json().get("result", {})


# ---------------------------------------------------------------------------
# Field Transformer
# ---------------------------------------------------------------------------


class FieldTransformer:
    """Applies field-level mapping transforms between ServiceNow and Turbo EA."""

    @staticmethod
    def transform_value(
        value: Any,
        transform_type: str | None,
        transform_config: dict | None,
        direction: str = "snow_to_turbo",
    ) -> Any:
        """Transform a single field value."""
        if transform_type is None or transform_type == "direct":
            return value

        config = transform_config or {}

        if transform_type == "value_map":
            mapping = config.get("mapping", {})
            if direction == "turbo_to_snow":
                # Reverse lookup
                reverse = {v: k for k, v in mapping.items()}
                return reverse.get(str(value), value)
            return mapping.get(str(value), value)

        if transform_type == "date_format":
            # ServiceNow dates are typically YYYY-MM-DD or YYYY-MM-DD HH:MM:SS
            if not value:
                return None
            if isinstance(value, str) and len(value) >= 10:
                return value[:10]  # Extract just the date portion
            return value

        if transform_type == "boolean":
            if direction == "snow_to_turbo":
                return str(value).lower() in ("true", "1", "yes")
            return "true" if value else "false"

        return value

    @staticmethod
    def apply_mappings(
        record: dict,
        field_mappings: list[SnowFieldMapping],
        direction: str = "snow_to_turbo",
    ) -> dict:
        """Apply field mappings to transform a record.

        For snow_to_turbo: reads from snow_field keys, writes to turbo_field paths.
        For turbo_to_snow: reads from turbo_field paths, writes to snow_field keys.
        """
        result: dict[str, Any] = {}

        for fm in field_mappings:
            # Respect per-field directionality
            if direction == "snow_to_turbo" and fm.direction == "turbo_leads":
                continue
            if direction == "turbo_to_snow" and fm.direction == "snow_leads":
                continue

            if direction == "snow_to_turbo":
                raw = record.get(fm.snow_field)
                transformed = FieldTransformer.transform_value(
                    raw, fm.transform_type, fm.transform_config, direction
                )
                _set_nested(result, fm.turbo_field, transformed)
            else:
                raw = _get_nested(record, fm.turbo_field)
                transformed = FieldTransformer.transform_value(
                    raw, fm.transform_type, fm.transform_config, direction
                )
                result[fm.snow_field] = transformed

        return result


def _set_nested(target: dict, path: str, value: Any) -> None:
    """Set a value at a dotted path (e.g. 'attributes.businessCriticality')."""
    keys = path.split(".")
    for key in keys[:-1]:
        target = target.setdefault(key, {})
    target[keys[-1]] = value


def _get_nested(source: dict, path: str) -> Any:
    """Get a value from a dotted path."""
    keys = path.split(".")
    current: Any = source
    for key in keys:
        if isinstance(current, dict):
            current = current.get(key)
        else:
            return None
    return current


# ---------------------------------------------------------------------------
# Sync Engine
# ---------------------------------------------------------------------------


class SyncEngine:
    """Orchestrates pull/push sync between ServiceNow and Turbo EA."""

    def __init__(self, db: AsyncSession, client: ServiceNowClient):
        self.db = db
        self.client = client

    async def pull_sync(
        self,
        mapping: SnowMapping,
        field_mappings: list[SnowFieldMapping],
        *,
        user_id: uuid.UUID | None = None,
        auto_apply: bool = True,
    ) -> SnowSyncRun:
        """Execute a pull sync: ServiceNow -> Turbo EA.

        1. Create sync run record
        2. Fetch records from ServiceNow
        3. Match against existing cards via identity map
        4. Transform and diff
        5. Stage records
        6. Apply if auto_apply is True
        """
        run = SnowSyncRun(
            connection_id=mapping.connection_id,
            mapping_id=mapping.id,
            status="running",
            direction="pull",
            created_by=user_id,
            stats={
                "fetched": 0,
                "created": 0,
                "updated": 0,
                "deleted": 0,
                "skipped": 0,
                "errors": 0,
            },
        )
        self.db.add(run)
        await self.db.flush()

        try:
            # Collect SNOW fields needed
            snow_fields = [fm.snow_field for fm in field_mappings]
            identity_fields = [fm for fm in field_mappings if fm.is_identity]

            # Fetch all records (paginated)
            all_records: list[dict] = []
            offset = 0
            batch_size = 500
            while True:
                records, total = await self.client.fetch_records(
                    mapping.snow_table,
                    fields=snow_fields,
                    query=mapping.filter_query or "",
                    limit=batch_size,
                    offset=offset,
                )
                all_records.extend(records)
                offset += batch_size
                if offset >= total or not records:
                    break

            run.stats = {**run.stats, "fetched": len(all_records)}  # type: ignore[union-attr]

            # Load existing identity map entries for this mapping
            id_map_result = await self.db.execute(
                select(SnowIdentityMap).where(
                    SnowIdentityMap.mapping_id == mapping.id,
                    SnowIdentityMap.connection_id == mapping.connection_id,
                )
            )
            id_map_entries = {e.snow_sys_id: e for e in id_map_result.scalars().all()}

            # Process each record
            for record in all_records:
                sys_id = record.get("sys_id", "")
                if not sys_id:
                    continue

                try:
                    await self._process_pull_record(
                        run,
                        mapping,
                        field_mappings,
                        identity_fields,
                        record,
                        sys_id,
                        id_map_entries,
                        skip_staging=mapping.skip_staging,
                    )
                except Exception as exc:
                    logger.error("Error processing SNOW record %s: %s", sys_id, exc)
                    run.stats["errors"] = run.stats.get("errors", 0) + 1  # type: ignore[union-attr]

            # Handle deletions (conservative/strict mode)
            if mapping.sync_mode in ("conservative", "strict"):
                await self._process_deletions(
                    run,
                    mapping,
                    all_records,
                    id_map_entries,
                )

            # Apply staged records if auto_apply (skip_staging already applied inline)
            if auto_apply and not mapping.skip_staging:
                await self._apply_staged(run)

            run.status = "completed"
            run.completed_at = datetime.now(timezone.utc)

        except Exception as exc:
            logger.error("Sync run %s failed: %s", run.id, exc)
            run.status = "failed"
            run.error_message = str(exc)[:2000]
            run.completed_at = datetime.now(timezone.utc)

        await self.db.flush()
        return run

    async def _process_pull_record(
        self,
        run: SnowSyncRun,
        mapping: SnowMapping,
        field_mappings: list[SnowFieldMapping],
        identity_fields: list[SnowFieldMapping],
        record: dict,
        sys_id: str,
        id_map_entries: dict[str, SnowIdentityMap],
        *,
        skip_staging: bool = False,
    ) -> None:
        """Process a single ServiceNow record for pull sync."""
        # Step 1: Match — check identity map first
        id_entry = id_map_entries.get(sys_id)
        card_id: uuid.UUID | None = id_entry.card_id if id_entry else None
        existing_card: Card | None = None

        if card_id:
            result = await self.db.execute(select(Card).where(Card.id == card_id))
            existing_card = result.scalar_one_or_none()

        # Step 2: If no identity map match, try fuzzy match on identity fields
        if not existing_card and identity_fields:
            existing_card = await self._fuzzy_match_card(
                mapping.card_type_key, record, identity_fields
            )

        # Step 3: Transform
        transformed = FieldTransformer.apply_mappings(record, field_mappings, "snow_to_turbo")

        # Step 4: Determine action and diff
        action = "skip"
        diff: dict | None = None

        if existing_card:
            diff = self._compute_diff(existing_card, transformed)
            if diff:
                action = "update"
                card_id = existing_card.id
            else:
                action = "skip"
                card_id = existing_card.id
        else:
            action = "create"

        # Step 5: Stage or apply directly
        if skip_staging and action != "skip":
            # Apply directly without writing staged records
            fake_staged = SnowStagedRecord(
                sync_run_id=run.id,
                mapping_id=mapping.id,
                snow_sys_id=sys_id,
                snow_data=record,
                card_id=card_id,
                action=action,
                diff=diff,
                status="applied",
            )
            if action == "create":
                await self._apply_create(fake_staged, mapping, field_mappings)
            elif action == "update":
                await self._apply_update(fake_staged, field_mappings)
        elif not skip_staging:
            staged = SnowStagedRecord(
                sync_run_id=run.id,
                mapping_id=mapping.id,
                snow_sys_id=sys_id,
                snow_data=record,
                card_id=card_id,
                action=action,
                diff=diff,
                status="pending",
            )
            self.db.add(staged)

        # Update stats
        if action != "skip":
            run.stats[action + "d"] = run.stats.get(action + "d", 0) + 1  # type: ignore[union-attr]
        else:
            run.stats["skipped"] = run.stats.get("skipped", 0) + 1  # type: ignore[union-attr]

    async def _fuzzy_match_card(
        self,
        card_type_key: str,
        record: dict,
        identity_fields: list[SnowFieldMapping],
    ) -> Card | None:
        """Try to match a ServiceNow record to an existing card using identity fields."""
        # Use the first identity field (usually 'name')
        for ifield in identity_fields:
            snow_val = record.get(ifield.snow_field)
            if not snow_val or not isinstance(snow_val, str):
                continue

            # Exact name match
            result = await self.db.execute(
                select(Card).where(
                    Card.type == card_type_key,
                    Card.name == snow_val,
                    Card.status == "ACTIVE",
                )
            )
            card = result.scalar_one_or_none()
            if card:
                return card

            # Fuzzy match if no exact match
            result = await self.db.execute(
                select(Card).where(
                    Card.type == card_type_key,
                    Card.status == "ACTIVE",
                )
            )
            candidates = result.scalars().all()
            best_match: Card | None = None
            best_score = 0.0
            for c in candidates:
                score = SequenceMatcher(None, snow_val.lower(), c.name.lower()).ratio()
                if score > best_score and score >= 0.85:
                    best_score = score
                    best_match = c
            if best_match:
                return best_match

        return None

    def _compute_diff(self, card: Card, transformed: dict) -> dict | None:
        """Compute field-level diff between existing card and transformed data."""
        diff: dict[str, dict[str, Any]] = {}

        for key, new_val in transformed.items():
            if key == "name":
                old_val = card.name
                if old_val != new_val and new_val:
                    diff[key] = {"old": old_val, "new": new_val}
            elif key == "description":
                old_val = card.description
                if old_val != new_val and new_val:
                    diff[key] = {"old": old_val, "new": new_val}
            elif key == "lifecycle":
                old_lifecycle = card.lifecycle or {}
                if isinstance(new_val, dict):
                    for lk, lv in new_val.items():
                        if old_lifecycle.get(lk) != lv and lv:
                            diff[f"lifecycle.{lk}"] = {
                                "old": old_lifecycle.get(lk),
                                "new": lv,
                            }
            elif key == "attributes":
                old_attrs = card.attributes or {}
                if isinstance(new_val, dict):
                    for ak, av in new_val.items():
                        if old_attrs.get(ak) != av and av is not None:
                            diff[f"attributes.{ak}"] = {
                                "old": old_attrs.get(ak),
                                "new": av,
                            }

        return diff if diff else None

    async def _process_deletions(
        self,
        run: SnowSyncRun,
        mapping: SnowMapping,
        fetched_records: list[dict],
        id_map_entries: dict[str, SnowIdentityMap],
    ) -> None:
        """Stage deletions for records that exist in identity map but not in SNOW."""
        fetched_sys_ids = {r.get("sys_id") for r in fetched_records if r.get("sys_id")}
        orphaned = [
            entry for sys_id, entry in id_map_entries.items() if sys_id not in fetched_sys_ids
        ]

        if not orphaned:
            return

        # In conservative mode, only delete items created by the integration
        if mapping.sync_mode == "conservative":
            orphaned = [e for e in orphaned if e.created_by_sync]

        # Check deletion ratio safety
        total_mapped = len(id_map_entries)
        if total_mapped > 0:
            ratio = len(orphaned) / total_mapped
            if ratio > mapping.max_deletion_ratio:
                logger.warning(
                    "Deletion ratio %.1f%% exceeds threshold %.1f%% — skipping deletions",
                    ratio * 100,
                    mapping.max_deletion_ratio * 100,
                )
                return

        for entry in orphaned:
            staged = SnowStagedRecord(
                sync_run_id=run.id,
                mapping_id=mapping.id,
                snow_sys_id=entry.snow_sys_id,
                snow_data={},
                card_id=entry.card_id,
                action="delete",
                status="pending",
            )
            self.db.add(staged)
            run.stats["deleted"] = run.stats.get("deleted", 0) + 1  # type: ignore[union-attr]

    async def _apply_staged(self, run: SnowSyncRun) -> dict[str, int]:
        """Apply all pending staged records for a sync run."""
        result = await self.db.execute(
            select(SnowStagedRecord).where(
                SnowStagedRecord.sync_run_id == run.id,
                SnowStagedRecord.status == "pending",
            )
        )
        staged_records = result.scalars().all()

        applied = {"created": 0, "updated": 0, "deleted": 0, "errors": 0}

        # Load mapping for card_type_key
        mapping_result = await self.db.execute(
            select(SnowMapping).where(SnowMapping.id == run.mapping_id)
        )
        mapping = mapping_result.scalar_one_or_none()
        if not mapping:
            return applied

        # Load field mappings
        fm_result = await self.db.execute(
            select(SnowFieldMapping).where(SnowFieldMapping.mapping_id == mapping.id)
        )
        field_mappings = fm_result.scalars().all()

        for staged in staged_records:
            try:
                if staged.action == "create":
                    await self._apply_create(staged, mapping, field_mappings)
                    applied["created"] += 1
                elif staged.action == "update":
                    await self._apply_update(staged, field_mappings)
                    applied["updated"] += 1
                elif staged.action == "delete":
                    await self._apply_delete(staged, mapping)
                    applied["deleted"] += 1
                staged.status = "applied"
            except Exception as exc:
                logger.error("Failed to apply staged record %s: %s", staged.id, exc)
                staged.status = "error"
                staged.error_message = str(exc)[:1000]
                applied["errors"] += 1

        return applied

    async def _apply_create(
        self,
        staged: SnowStagedRecord,
        mapping: SnowMapping,
        field_mappings: list[SnowFieldMapping],
    ) -> None:
        """Create a new card from a staged record."""
        transformed = FieldTransformer.apply_mappings(
            staged.snow_data or {}, field_mappings, "snow_to_turbo"
        )

        card = Card(
            type=mapping.card_type_key,
            name=transformed.get("name", f"SNOW-{staged.snow_sys_id[:8]}"),
            description=transformed.get("description"),
            lifecycle=transformed.get("lifecycle", {}),
            attributes=transformed.get("attributes", {}),
            status="ACTIVE",
            approval_status="DRAFT",
        )
        self.db.add(card)
        await self.db.flush()

        staged.card_id = card.id

        # Create identity map entry
        id_entry = SnowIdentityMap(
            connection_id=mapping.connection_id,
            mapping_id=mapping.id,
            card_id=card.id,
            snow_sys_id=staged.snow_sys_id,
            snow_table=mapping.snow_table,
            created_by_sync=True,
            last_synced_at=datetime.now(timezone.utc),
        )
        self.db.add(id_entry)

        await event_bus.publish(
            event_type="card.created",
            data={"name": card.name, "type": card.type, "source": "servicenow_sync"},
            card_id=card.id,
        )

    async def _apply_update(
        self,
        staged: SnowStagedRecord,
        field_mappings: list[SnowFieldMapping],
    ) -> None:
        """Update an existing card from a staged record."""
        if not staged.card_id:
            return

        result = await self.db.execute(select(Card).where(Card.id == staged.card_id))
        card = result.scalar_one_or_none()
        if not card:
            return

        diff = staged.diff or {}
        for field_path, change in diff.items():
            new_val = change.get("new")
            if field_path == "name" and new_val:
                card.name = new_val
            elif field_path == "description" and new_val:
                card.description = new_val
            elif field_path.startswith("lifecycle."):
                lc_key = field_path.split(".", 1)[1]
                lifecycle = dict(card.lifecycle or {})
                lifecycle[lc_key] = new_val
                card.lifecycle = lifecycle
            elif field_path.startswith("attributes."):
                attr_key = field_path.split(".", 1)[1]
                attrs = dict(card.attributes or {})
                attrs[attr_key] = new_val
                card.attributes = attrs

        # Update identity map timestamp
        id_result = await self.db.execute(
            select(SnowIdentityMap).where(
                SnowIdentityMap.card_id == staged.card_id,
                SnowIdentityMap.snow_sys_id == staged.snow_sys_id,
            )
        )
        id_entry = id_result.scalar_one_or_none()
        if id_entry:
            id_entry.last_synced_at = datetime.now(timezone.utc)

        await event_bus.publish(
            event_type="card.updated",
            data={
                "name": card.name,
                "type": card.type,
                "source": "servicenow_sync",
                "changes": list(diff.keys()),
            },
            card_id=card.id,
        )

    async def _apply_delete(
        self,
        staged: SnowStagedRecord,
        mapping: SnowMapping,
    ) -> None:
        """Archive a card (soft-delete) based on a staged deletion."""
        if not staged.card_id:
            return

        result = await self.db.execute(select(Card).where(Card.id == staged.card_id))
        card = result.scalar_one_or_none()
        if not card or card.status == "ARCHIVED":
            return

        card.status = "ARCHIVED"

        # Remove from identity map
        await self.db.execute(
            delete(SnowIdentityMap).where(
                SnowIdentityMap.card_id == staged.card_id,
                SnowIdentityMap.mapping_id == mapping.id,
            )
        )

        await event_bus.publish(
            event_type="card.archived",
            data={"name": card.name, "type": card.type, "source": "servicenow_sync"},
            card_id=card.id,
        )

    async def push_sync(
        self,
        mapping: SnowMapping,
        field_mappings: list[SnowFieldMapping],
        *,
        user_id: uuid.UUID | None = None,
    ) -> SnowSyncRun:
        """Execute a push sync: Turbo EA -> ServiceNow."""
        run = SnowSyncRun(
            connection_id=mapping.connection_id,
            mapping_id=mapping.id,
            status="running",
            direction="push",
            created_by=user_id,
            stats={"processed": 0, "created": 0, "updated": 0, "skipped": 0, "errors": 0},
        )
        self.db.add(run)
        await self.db.flush()

        try:
            # Get turbo_leads field mappings
            push_fields = [fm for fm in field_mappings if fm.direction == "turbo_leads"]
            if not push_fields:
                run.status = "completed"
                run.completed_at = datetime.now(timezone.utc)
                await self.db.flush()
                return run

            # Fetch all active cards of this type
            cards_result = await self.db.execute(
                select(Card).where(
                    Card.type == mapping.card_type_key,
                    Card.status == "ACTIVE",
                )
            )
            cards = cards_result.scalars().all()

            # Load identity map
            id_map_result = await self.db.execute(
                select(SnowIdentityMap).where(
                    SnowIdentityMap.mapping_id == mapping.id,
                    SnowIdentityMap.connection_id == mapping.connection_id,
                )
            )
            id_map_by_card = {e.card_id: e for e in id_map_result.scalars().all()}

            for card in cards:
                run.stats["processed"] = run.stats.get("processed", 0) + 1  # type: ignore[union-attr]
                try:
                    # Build card data dict for transformation
                    card_data = {
                        "name": card.name,
                        "description": card.description or "",
                        "lifecycle": card.lifecycle or {},
                        "attributes": card.attributes or {},
                    }
                    snow_data = FieldTransformer.apply_mappings(
                        card_data, push_fields, "turbo_to_snow"
                    )

                    id_entry = id_map_by_card.get(card.id)
                    if id_entry:
                        # Update existing SNOW record
                        await self.client.update_record(
                            mapping.snow_table, id_entry.snow_sys_id, snow_data
                        )
                        id_entry.last_synced_at = datetime.now(timezone.utc)
                        run.stats["updated"] = run.stats.get("updated", 0) + 1  # type: ignore[union-attr]
                    else:
                        # Create new SNOW record
                        result = await self.client.create_record(mapping.snow_table, snow_data)
                        new_sys_id = result.get("sys_id", "")
                        if new_sys_id:
                            new_entry = SnowIdentityMap(
                                connection_id=mapping.connection_id,
                                mapping_id=mapping.id,
                                card_id=card.id,
                                snow_sys_id=new_sys_id,
                                snow_table=mapping.snow_table,
                                created_by_sync=True,
                                last_synced_at=datetime.now(timezone.utc),
                            )
                            self.db.add(new_entry)
                        run.stats["created"] = run.stats.get("created", 0) + 1  # type: ignore[union-attr]

                except Exception as exc:
                    logger.error("Push failed for card %s: %s", card.id, exc)
                    run.stats["errors"] = run.stats.get("errors", 0) + 1  # type: ignore[union-attr]

            run.status = "completed"
            run.completed_at = datetime.now(timezone.utc)

        except Exception as exc:
            logger.error("Push sync run %s failed: %s", run.id, exc)
            run.status = "failed"
            run.error_message = str(exc)[:2000]
            run.completed_at = datetime.now(timezone.utc)

        await self.db.flush()
        return run
