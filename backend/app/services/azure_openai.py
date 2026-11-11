"""Azure Hosted OpenAI — where a chat request goes, whichever endpoint was entered.

Azure serves Chat Completions on two paths, and the Azure portal hands out
either as "the endpoint" depending on the page ([#1386]):

- the **deployment API**, ``{resource}/openai/deployments/{deployment}/chat/completions``,
  which names the deployment in the URL and requires a dated ``api-version``;
- the **v1 API**, ``{resource}/openai/v1/chat/completions``, which takes the
  deployment name as ``model`` in the body like OpenAI itself and takes no
  dated ``api-version`` at all.

Both card suggestions (``ai_service``) and TurboLens (``turbolens_ai``) used
to append the deployment path to whatever was entered, so a v1 endpoint became
``…/openai/v1/openai/deployments/…`` and every call was a 404. ``chat_target``
is the one place that decides, from the entered URL alone, which path to call.

[#1386]: https://github.com/vincentmakes/turbo-ea/issues/1386
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import httpx

from app.services import openai_chat

# The v1 endpoint, as entered: with or without the operation after it. The
# slash before ``openai`` must be a path separator, not the ``//`` of the scheme.
_V1_ENDPOINT = re.compile(r"(?<!/)/openai/v1(?:/chat/completions)?$", re.IGNORECASE)

# What may follow the resource root in a deployment-API URL: a bare
# ``/openai``, or a whole "Target URI" copied from the portal.
_DEPLOYMENT_SUFFIX = re.compile(r"(?<!/)/openai(?:/deployments(?:/.*)?)?$", re.IGNORECASE)

# Azure's error code for a deployment name the resource does not have.
_DEPLOYMENT_NOT_FOUND = "DeploymentNotFound"


@dataclass(frozen=True)
class ChatTarget:
    """One Chat Completions request: where it goes and how it names the model."""

    url: str
    # The ``api-version`` query parameter; ``None`` on the v1 API, which has none.
    params: dict[str, str] | None
    # The ``model`` for the request body; ``None`` when the URL names the deployment.
    model: str | None


def _endpoint(provider_url: str) -> str:
    """The entered URL without its query string, fragment and trailing slashes."""
    return re.split(r"[?#]", provider_url.strip())[0].rstrip("/")


def chat_target(provider_url: str, deployment: str, api_version: str) -> ChatTarget:
    """Where a chat request for ``deployment`` goes, given the entered endpoint.

    An endpoint ending in ``/openai/v1`` is the v1 API: the deployment is the
    body's ``model`` and ``api_version`` is not sent. Anything else is the
    deployment API; a trailing ``/openai`` or a pasted Target URI is cut back
    to the resource root first, and a path in front of it (a gateway) is kept.
    """
    endpoint = _endpoint(provider_url)
    v1 = _V1_ENDPOINT.search(endpoint)
    if v1:
        return ChatTarget(
            url=f"{endpoint[: v1.start()]}/openai/v1/chat/completions",
            params=None,
            model=deployment,
        )
    root = _DEPLOYMENT_SUFFIX.sub("", endpoint)
    return ChatTarget(
        url=f"{root}/openai/deployments/{deployment}/chat/completions",
        params={"api-version": api_version},
        model=None,
    )


def not_found_detail(resp: httpx.Response, target: ChatTarget, deployment: str) -> str:
    """What a 404 from Azure means, for the admin running the connection test.

    Azure answers 404 for three different mistakes. Only an unknown deployment
    says so in its error code; a wrong path and an ``api-version`` Azure does
    not know both read "Resource not found", so those name the path that was
    called and what to check. Azure AI Foundry shows no API version at all
    (#1386), so the deployment-API hint also points at the v1 endpoint.
    """
    if openai_chat.error_code(resp) == _DEPLOYMENT_NOT_FOUND:
        return f"Azure OpenAI deployment '{deployment}' not found"
    path = httpx.URL(target.url).path
    if target.params is None:
        hint = f"check the Provider URL and that the deployment '{deployment}' exists"
    else:
        version = target.params["api-version"]
        hint = (
            "check the Provider URL (the resource endpoint, such as "
            f"https://your-resource.openai.azure.com) and the API version '{version}', "
            "which must be an Azure OpenAI API version, not the version of the model. "
            "An endpoint ending in /openai/v1/ needs no API version"
        )
    return f"Azure OpenAI answered 404 for {path}: {hint}"
