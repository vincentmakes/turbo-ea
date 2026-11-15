"""The picture store behind decision and SoAW text (``document_image_service``),
the raster sniff it relies on, and the hourly purge body in ``main``."""

from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app import main
from app.models.document_image import DocumentImage
from app.services import document_image_service as service
from app.services.attachment_validation import sniff_raster_image
from tests.conftest import create_user

NOW = datetime(2026, 11, 14, 12, 0, tzinfo=timezone.utc)
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 32
GIF = b"GIF89a" + b"\x00" * 32
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"\x00" * 32


class TestSniffRasterImage:
    @pytest.mark.parametrize(
        ("head", "mime"),
        [
            (PNG, "image/png"),
            (JPEG, "image/jpeg"),
            (GIF, "image/gif"),
            (b"GIF87a" + b"\x00" * 4, "image/gif"),
            (WEBP, "image/webp"),
        ],
        ids=["png", "jpeg", "gif89", "gif87", "webp"],
    )
    def test_the_four_raster_formats(self, head, mime):
        assert sniff_raster_image(head) == mime

    @pytest.mark.parametrize(
        "head",
        [
            b'<svg xmlns="http://www.w3.org/2000/svg"></svg>',
            b'<?xml version="1.0"?><svg/>',
            b"MZ\x90\x00" + b"\x00" * 32,
            b"%PDF-1.7",
            b"RIFF\x00\x00\x00\x00WAVEfmt ",
            b"",
        ],
        ids=["svg", "xml-svg", "exe", "pdf", "wav", "empty"],
    )
    def test_anything_else_is_not_a_picture(self, head):
        assert sniff_raster_image(head) is None


@pytest.fixture
def utc_clock(monkeypatch):
    """The service's clock fixed at ``NOW``; it answers a UTC read only."""

    class _Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            assert tz is timezone.utc, "the clock is read without a time zone"
            return NOW

    monkeypatch.setattr(service, "datetime", _Clock)


async def _image(db, kind="adr", *, created_at=None, used_at=None, data=PNG) -> DocumentImage:
    row = await service.store(db, kind, data, mime_type="image/png", created_by=None)
    if created_at is not None or used_at is not None:
        row.created_at = created_at or row.created_at
        row.used_at = used_at
        await db.flush()
    return row


class TestStoreAndLoad:
    async def test_store_records_size_hash_and_uploader(self, db):
        user = await create_user(db, email="u@test.com")
        row = await service.store(db, "soaw", JPEG, mime_type="image/jpeg", created_by=user.id)
        assert (row.kind, row.mime_type, row.size, row.created_by, row.used_at) == (
            "soaw",
            "image/jpeg",
            len(JPEG),
            user.id,
            None,
        )
        assert row.sha256 == hashlib.sha256(JPEG).hexdigest()
        assert isinstance(row.id, uuid.UUID)

    async def test_an_unknown_kind_is_refused(self, db):
        with pytest.raises(ValueError, match="^Unknown document kind 'pdf'$"):
            await service.store(db, "pdf", PNG, mime_type="image/png", created_by=None)
        with pytest.raises(ValueError, match="^Unknown document kind 'pdf'$"):
            await service.load(db, "pdf", uuid.uuid4())
        with pytest.raises(ValueError, match="^Unknown document kind 'pdf'$"):
            await service.existing(db, "pdf", [uuid.uuid4()])

    async def test_load_by_kind_and_id(self, db):
        row = await _image(db, "adr")
        found = await service.load(db, "adr", str(row.id))
        assert found is not None and found.id == row.id and found.data == PNG
        assert (await service.load(db, "adr", str(row.id).upper())).id == row.id
        assert await service.load(db, "soaw", row.id) is None
        assert await service.load(db, "adr", uuid.uuid4()) is None
        assert await service.load(db, "adr", "not-a-uuid") is None

    async def test_existing_answers_the_ids_of_that_kind(self, db):
        adr = await _image(db, "adr")
        soaw = await _image(db, "soaw")
        found = await service.existing(
            db, "adr", [str(adr.id), str(soaw.id), str(uuid.uuid4()), "junk"]
        )
        assert found == {str(adr.id)}
        assert await service.existing(db, "adr", []) == set()
        assert await service.existing(db, "adr", ["junk"]) == set()

    async def test_existing_answers_only_the_ids_asked_for(self, db):
        asked = await _image(db, "adr")
        await _image(db, "adr")
        assert await service.existing(db, "adr", [asked.id]) == {str(asked.id)}

    async def test_a_malformed_id_skips_only_itself(self, db):
        row = await _image(db, "adr")
        assert await service.existing(db, "adr", ["junk", str(row.id)]) == {str(row.id)}
        assert await service.mark_used(db, ["junk", row.id], now=NOW) == 1


class TestMarkUsed:
    async def test_stamps_only_the_unstamped(self, db):
        earlier = NOW - timedelta(days=3)
        fresh = await _image(db)
        stamped = await _image(db, used_at=earlier)
        other = await _image(db)
        count = await service.mark_used(db, [str(fresh.id), stamped.id, "junk"], now=NOW)
        assert count == 1
        rows = {
            r.id: r.used_at
            for r in (
                await db.execute(select(DocumentImage).execution_options(populate_existing=True))
            )
            .scalars()
            .all()
        }
        assert rows == {fresh.id: NOW, stamped.id: earlier, other.id: None}

    async def test_nothing_to_stamp(self, db):
        assert await service.mark_used(db, []) == 0
        assert await service.mark_used(db, ["junk"]) == 0

    async def test_counts_every_row_stamped_and_none_already_stamped(self, db):
        first, second = await _image(db), await _image(db)
        assert await service.mark_used(db, [first.id, second.id], now=NOW) == 2
        assert await service.mark_used(db, [first.id, second.id], now=NOW) == 0

    async def test_defaults_to_the_current_utc_time(self, db, utc_clock):
        row = await _image(db)
        assert await service.mark_used(db, [row.id]) == 1
        await db.refresh(row)
        assert row.used_at == NOW


class TestPurgeUnused:
    async def test_deletes_only_never_used_rows_past_the_grace(self, db):
        old_unused = await _image(db, created_at=NOW - timedelta(days=8))
        edge = await _image(db, created_at=NOW - timedelta(days=7))
        young = await _image(db, created_at=NOW - timedelta(days=6, hours=23))
        old_used = await _image(db, created_at=NOW - timedelta(days=30), used_at=NOW)
        assert await service.purge_unused_once(db, now=NOW) == 1
        left = set((await db.execute(select(DocumentImage.id))).scalars().all())
        assert left == {edge.id, young.id, old_used.id}
        assert old_unused.id not in left
        assert await service.purge_unused_once(db, now=NOW) == 0

    async def test_defaults_to_the_current_utc_time(self, db, utc_clock):
        """Without ``now`` the cutoff is the UTC clock less the grace."""
        past = await _image(db, created_at=NOW - service.UNUSED_GRACE - timedelta(minutes=1))
        within = await _image(db, created_at=NOW - service.UNUSED_GRACE + timedelta(minutes=1))
        assert await service.purge_unused_once(db) == 1
        left = set((await db.execute(select(DocumentImage.id))).scalars().all())
        assert left == {within.id}
        assert past.id not in left

    async def test_the_grace_is_seven_days(self):
        assert timedelta(days=7) == service.UNUSED_GRACE

    async def test_the_main_body_commits_only_when_it_deleted(self, db, monkeypatch):
        commits = []
        real_commit = db.commit

        async def commit():
            commits.append(1)
            await real_commit()

        monkeypatch.setattr(db, "commit", commit)
        await _image(db, created_at=NOW - timedelta(days=9))
        assert await main._purge_document_images_once(db, now=NOW) == 1
        assert commits == [1]
        assert await main._purge_document_images_once(db, now=NOW) == 0
        assert commits == [1]

    async def test_the_main_body_purges_by_the_time_it_is_given_and_logs_the_count(
        self, db, caplog
    ):
        later = datetime.now(timezone.utc) + timedelta(days=30)
        await _image(db)  # uploaded now: young by the clock, past the grace by ``later``
        with caplog.at_level(logging.INFO, logger=main.logger.name):
            assert await main._purge_document_images_once(db, now=later) == 1
        assert [r.getMessage() for r in caplog.records if r.name == main.logger.name] == [
            "Auto-purged 1 never-used document picture(s)."
        ]
