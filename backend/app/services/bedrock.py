"""Amazon Bedrock access — the one place the Converse API is spoken.

Turbo EA has two independent AI clients: ``ai_service.call_llm`` (card
description suggestions, portfolio insights) and ``turbolens_ai.call_ai``
(every TurboLens analysis). Both must know about a provider or half the AI
features silently report "not configured" (the trap reported in #1120). Every
other provider is a plain HTTP POST, so the duplication there is one URL and
one header dict; Bedrock is an SDK with a credential chain, a client factory
and its own error taxonomy, so it lives here once and both callers delegate.

``boto3`` is imported lazily inside the functions rather than at module scope:
importing botocore eagerly costs real time at boot for an optional provider,
and the pure helpers (``is_valid_region``, ``parse_credentials``,
``build_converse_request``) stay importable and testable without the SDK.

Authentication has two modes. An empty API key uses boto3's default credential
chain — the ECS task role, an EKS service account (IRSA), an EC2 instance
profile, or ``AWS_*`` environment variables — which is what makes Bedrock
attractive inside AWS: nothing to store, nothing to rotate. An explicit
``ACCESS_KEY_ID:SECRET_ACCESS_KEY[:SESSION_TOKEN]`` in the (encrypted) API key
field covers installs outside AWS.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any, Literal

logger = logging.getLogger("turboea.bedrock")

ErrorKind = Literal[
    "credentials_missing",
    "credentials_invalid",
    "quota",
    "unreachable",
    "other",
]

# The AWS region is stored in the shared ``providerUrl`` settings slot (the UI
# labels that field "AWS Region" for Bedrock), so every existing "is AI
# configured?" gate keeps working unchanged. Validate the shape here so a URL
# pasted out of habit is rejected at save time rather than by the SDK later.
REGION_RE = re.compile(r"^[a-z]{2}(-[a-z]+)+-\d+$")

# Generation can legitimately take minutes. botocore's default 60s read timeout
# with legacy retries would abandon a slow response *and re-send the prompt*,
# so both timeouts and the retry mode are set explicitly.
_RUNTIME_READ_TIMEOUT = 180
_CONTROL_READ_TIMEOUT = 15
_CONNECT_TIMEOUT = 10

_CREDENTIALS_INVALID_CODES = frozenset(
    {
        "AccessDeniedException",
        "UnrecognizedClientException",
        "InvalidSignatureException",
        "ExpiredTokenException",
        "ExpiredToken",
        "InvalidClientTokenId",
        "AuthFailure",
    }
)
_QUOTA_CODES = frozenset(
    {
        "ThrottlingException",
        "Throttling",
        "TooManyRequestsException",
        "ServiceQuotaExceededException",
        "ModelTimeoutException",
    }
)


class BedrockError(RuntimeError):
    """A Bedrock call failed, classified so callers can map it to their own vocabulary.

    ``ai_service`` re-raises these as ``httpx.HTTPError`` (the shape every other
    provider fails with, which the routes already translate to a 502);
    ``turbolens_ai`` maps ``kind`` onto its ``AI_KEY_INVALID`` /
    ``AI_QUOTA_EXCEEDED`` tokens.
    """

    def __init__(self, message: str, *, kind: ErrorKind = "other", code: str = "") -> None:
        super().__init__(message)
        self.kind: ErrorKind = kind
        self.code = code


def is_valid_region(region: str) -> bool:
    """True for an AWS region code such as ``eu-central-1`` or ``us-gov-west-1``."""
    return bool(REGION_RE.match(region.strip()))


def parse_credentials(api_key: str) -> dict[str, str]:
    """Explicit IAM credentials from the API key field, or ``{}`` for the ambient chain."""
    raw = (api_key or "").strip()
    if not raw:
        return {}
    parts = raw.split(":")
    if len(parts) == 2 and all(p.strip() for p in parts):
        return {
            "aws_access_key_id": parts[0].strip(),
            "aws_secret_access_key": parts[1].strip(),
        }
    if len(parts) == 3 and all(p.strip() for p in parts):
        return {
            "aws_access_key_id": parts[0].strip(),
            "aws_secret_access_key": parts[1].strip(),
            "aws_session_token": parts[2].strip(),
        }
    raise BedrockError(
        "Bedrock credentials must be ACCESS_KEY_ID:SECRET_ACCESS_KEY",
        kind="credentials_invalid",
        code="InvalidCredentialFormat",
    )


def build_converse_request(
    model: str,
    messages: list[dict[str, str]],
    *,
    max_tokens: int,
    temperature: float | None = None,
) -> dict[str, Any]:
    """Map Turbo EA's chat messages onto a Converse request.

    Converse takes system instructions as a separate ``system`` parameter (the
    same shape as the native Anthropic API), never as a message with
    ``role: "system"`` — sending one is a ``ValidationException``.
    """
    system_blocks: list[dict[str, str]] = []
    converse_messages: list[dict[str, Any]] = []
    for msg in messages:
        text = msg.get("content", "")
        if msg.get("role") == "system":
            if text:
                system_blocks.append({"text": text})
        else:
            converse_messages.append({"role": msg.get("role", "user"), "content": [{"text": text}]})

    inference_config: dict[str, Any] = {"maxTokens": max_tokens}
    if temperature is not None:
        inference_config["temperature"] = temperature

    request: dict[str, Any] = {
        "modelId": model,
        "messages": converse_messages,
        "inferenceConfig": inference_config,
    }
    if system_blocks:
        request["system"] = system_blocks
    return request


def _client_config(read_timeout: int) -> Any:
    from botocore.config import Config

    return Config(
        connect_timeout=_CONNECT_TIMEOUT,
        read_timeout=read_timeout,
        retries={"max_attempts": 2, "mode": "standard"},
    )


def _make_client(service: str, region: str, credentials: dict[str, str], read_timeout: int) -> Any:
    """Build a Bedrock client. The single seam tests patch — nothing else touches boto3.

    A fresh ``Session`` per call on purpose: boto3's default session is not safe
    to create clients from concurrently, and TurboLens background batches overlap
    with description suggestions from the request path.
    """
    import boto3

    session = boto3.session.Session(region_name=region, **credentials)
    return session.client(service, config=_client_config(read_timeout))


def _classify_error(exc: BaseException) -> BedrockError:
    """Map a botocore exception onto a ``BedrockError`` by error code, never by message text."""
    from botocore.exceptions import (
        ClientError,
        ConnectTimeoutError,
        EndpointConnectionError,
        NoCredentialsError,
        NoRegionError,
        PartialCredentialsError,
        ReadTimeoutError,
    )

    if isinstance(exc, (NoCredentialsError, PartialCredentialsError)):
        return BedrockError(
            "No AWS credentials found. Attach an IAM role to the container or "
            "enter ACCESS_KEY_ID:SECRET_ACCESS_KEY.",
            kind="credentials_missing",
            code=type(exc).__name__,
        )
    if isinstance(exc, NoRegionError):
        return BedrockError("No AWS region configured.", kind="other", code="NoRegionError")
    if isinstance(exc, (EndpointConnectionError, ConnectTimeoutError, ReadTimeoutError)):
        return BedrockError(
            f"Cannot reach Bedrock: {type(exc).__name__}",
            kind="unreachable",
            code=type(exc).__name__,
        )
    if isinstance(exc, ClientError):
        error = exc.response.get("Error", {}) if isinstance(exc.response, dict) else {}
        code = error.get("Code", "ClientError")
        message = error.get("Message", str(exc))
        if code in _CREDENTIALS_INVALID_CODES:
            kind: ErrorKind = "credentials_invalid"
        elif code in _QUOTA_CODES:
            kind = "quota"
        else:
            # ValidationException lands here, and its message is the one that
            # tells an admin to use a regional inference profile id — keep it.
            kind = "other"
        return BedrockError(f"{code}: {message}", kind=kind, code=code)
    return BedrockError(str(exc) or type(exc).__name__, kind="other", code=type(exc).__name__)


def _converse_sync(
    region: str,
    model: str,
    messages: list[dict[str, str]],
    *,
    credentials: dict[str, str],
    max_tokens: int,
    temperature: float | None,
) -> dict[str, Any]:
    client = _make_client("bedrock-runtime", region, credentials, _RUNTIME_READ_TIMEOUT)
    request = build_converse_request(
        model, messages, max_tokens=max_tokens, temperature=temperature
    )
    response: dict[str, Any] = client.converse(**request)
    return response


async def converse(
    region: str,
    model: str,
    messages: list[dict[str, str]],
    *,
    api_key: str = "",
    max_tokens: int = 4096,
    temperature: float | None = None,
) -> dict[str, Any]:
    """Call the Bedrock Converse API. Returns ``{"text": str, "truncated": bool}``.

    One interface for every Bedrock model (Claude, Nova, Llama, Mistral, …) —
    the per-model payload differences of the older InvokeModel API are exactly
    what Converse exists to remove.
    """
    region = (region or "").strip()
    if not is_valid_region(region):
        raise BedrockError(
            f"'{region}' is not a valid AWS region (e.g. eu-central-1).",
            kind="other",
            code="InvalidRegion",
        )
    if not model:
        raise BedrockError("No Bedrock model configured.", kind="other", code="NoModel")

    credentials = parse_credentials(api_key)
    try:
        response = await asyncio.to_thread(
            _converse_sync,
            region,
            model,
            messages,
            credentials=credentials,
            max_tokens=max_tokens,
            temperature=temperature,
        )
    except BedrockError:
        raise
    except Exception as exc:  # noqa: BLE001 — classified, then re-raised as BedrockError
        error = _classify_error(exc)
        logger.warning("Bedrock Converse call failed: %s", error)
        raise error from exc

    content = response.get("output", {}).get("message", {}).get("content", [])
    text = "".join(block.get("text", "") for block in content if isinstance(block, dict))
    truncated = response.get("stopReason") == "max_tokens"
    return {"text": text, "truncated": truncated}


def _is_on_demand(summary: dict[str, Any]) -> bool:
    """Whether a foundation model can be called without provisioned throughput.

    An id that needs provisioned throughput would read as available in the
    picker and then fail at call time. The field is only *usually* present, so
    an absent one is treated as callable: hiding a model an admin can actually
    use is the worse of the two failures, and the one they cannot diagnose.
    """
    types = summary.get("inferenceTypesSupported")
    if types is None:
        return True
    return "ON_DEMAND" in types


def _list_model_ids_sync(region: str, *, credentials: dict[str, str]) -> list[str]:
    from botocore.exceptions import ClientError

    client = _make_client("bedrock", region, credentials, _CONTROL_READ_TIMEOUT)

    foundation = client.list_foundation_models(byOutputModality="TEXT")
    foundation_ids = sorted(
        {
            summary.get("modelId", "")
            for summary in foundation.get("modelSummaries", [])
            if summary.get("modelId") and _is_on_demand(summary)
        }
    )

    # Newer models are reachable only through a regional inference profile, so a
    # test that lists foundation models alone reports a working model as "not
    # found". Profiles come first for that reason. The action is separate in IAM
    # and older policies predate it, so a refusal here degrades rather than fails.
    profile_ids: list[str] = []
    try:
        token: str | None = None
        while True:
            kwargs = {"nextToken": token} if token else {}
            page = client.list_inference_profiles(**kwargs)
            profile_ids.extend(
                p.get("inferenceProfileId", "")
                for p in page.get("inferenceProfileSummaries", [])
                if p.get("inferenceProfileId")
            )
            token = page.get("nextToken")
            if not token:
                break
    except ClientError as exc:
        logger.warning("Bedrock list_inference_profiles failed: %s", exc)

    ordered = sorted(set(profile_ids)) + [m for m in foundation_ids if m not in set(profile_ids)]
    return ordered


async def list_model_ids(region: str, *, api_key: str = "") -> list[str]:
    """Model ids and inference-profile ids available in the region, profiles first."""
    region = (region or "").strip()
    if not is_valid_region(region):
        raise BedrockError(
            f"'{region}' is not a valid AWS region (e.g. eu-central-1).",
            kind="other",
            code="InvalidRegion",
        )
    credentials = parse_credentials(api_key)
    try:
        return await asyncio.to_thread(_list_model_ids_sync, region, credentials=credentials)
    except BedrockError:
        raise
    except Exception as exc:  # noqa: BLE001 — classified, then re-raised as BedrockError
        error = _classify_error(exc)
        logger.warning("Bedrock model listing failed: %s", error)
        raise error from exc
