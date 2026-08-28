"""Typed request models for MCP tools.

`set_card_logos` is the only tool with a typed item schema today, and it
earned one: its rows carry four interacting fields, and an agent that guesses
wrong pays in wasted image bytes and a round trip. The other bulk tools take
`list[dict]` and describe their rows in prose.

Do not type the rest by reflex. Type the ones where a machine-readable schema
saves the caller a mistake it would otherwise only discover from the server.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

# `image/jpg` genuinely is accepted and normalised to `image/jpeg`, so the
# advertised enum says so rather than quietly rejecting what half the world
# sends. Modelling this as a plain `str` with a hand-written enum in
# `json_schema_extra` would produce a schema whose `anyOf` and `enum` disagree.
LogoMime = Literal[
    "image/png",
    "image/jpeg",
    "image/webp",
    "image/gif",
    "image/jpg",
]


class CardLogoItem(BaseModel):
    """One card's logo: bytes, a URL to fetch, or a built-in icon slug.

    Exactly one of `image_base64`, `image_url` and `icon_slug` must be given.
    That rule is enforced in the tool body rather than by a validator here, on
    purpose: a row that breaks it is reported as a problem row alongside the
    others, instead of raising and abandoning the whole batch.
    """

    # Extras are ignored rather than forbidden: a stray key from an agent must
    # not fail the batch, and forbidding them would put
    # `additionalProperties: false` in the advertised schema.

    card_id: str = Field(description="UUID of the card to set the logo on.")
    image_base64: str | None = Field(
        default=None,
        description=(
            "The image, base64-encoded. PNG, JPEG, WebP or GIF, under 1 MB. "
            "Use this when you already hold the bytes — a file the user "
            "shared, or a logo you fetched yourself. Mutually exclusive with "
            "image_url and icon_slug."
        ),
    )
    image_url: str | None = Field(
        default=None,
        description=(
            "An https URL the SERVER downloads the image from. Use this for "
            "any brand the built-in packs do not carry, and especially when "
            "you cannot reach the web yourself — filling those gaps is the "
            "expected way to use this tool, not a workaround. Only a short "
            "allowlist of public icon hosts is fetched (a refusal names them); "
            "the answer must be a PNG, JPEG, WebP or GIF under 1 MB, so a "
            "page about a logo will not do — link the image file itself. "
            "Mutually exclusive with image_base64 and icon_slug."
        ),
    )
    mime: LogoMime | None = Field(
        default=None,
        description=(
            "Optional. Sniffed from the bytes when omitted; when supplied it "
            "must agree with them. SVG is refused — it is scriptable and is "
            "not sanitised anywhere in the product."
        ),
    )
    icon_slug: str | None = Field(
        default=None,
        description=(
            "A built-in brand icon, e.g. 'sap' — a shortcut for brands the "
            "packs happen to carry, resolved server-side so no image is "
            "transferred. Two packs ship: 'logos' (full-colour) and "
            "'simpleicons' (one flat brand colour, broader coverage). A bare "
            "slug takes the colour one where both have it; pin a pack with "
            "'logos:sap' or 'simpleicons:sap'. If the brand is not in the "
            "packs, do not give up on the logo — pass image_url (or "
            "image_base64) instead. Mutually exclusive with those two."
        ),
    )
    filename: str | None = Field(
        default=None,
        description="Cosmetic; recorded in the card's history timeline.",
    )
