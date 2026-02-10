import uuid

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDMixin


class TagGroup(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "tag_groups"

    name: Mapped[str] = mapped_column(String(200), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(String(1000))

    tags: Mapped[list["Tag"]] = relationship("Tag", back_populates="group", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<TagGroup(id={self.id}, name={self.name!r})>"


class Tag(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "tags"

    name: Mapped[str] = mapped_column(String(200), nullable=False)
    color: Mapped[str | None] = mapped_column(String(7))  # hex color e.g. #FF0000
    group_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("tag_groups.id", ondelete="CASCADE"), nullable=False
    )

    group: Mapped[TagGroup] = relationship("TagGroup", back_populates="tags")

    __table_args__ = (UniqueConstraint("name", "group_id", name="uq_tag_name_group"),)

    def __repr__(self) -> str:
        return f"<Tag(id={self.id}, name={self.name!r})>"


class FactSheetTag(Base, TimestampMixin):
    __tablename__ = "fact_sheet_tags"

    fact_sheet_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("fact_sheets.id", ondelete="CASCADE"),
        primary_key=True,
    )
    tag_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("tags.id", ondelete="CASCADE"),
        primary_key=True,
    )
