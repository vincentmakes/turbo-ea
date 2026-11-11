"""Tests for the Azure Hosted OpenAI request target (azure_openai.py, #1386).

Pure: which URL a chat request goes to for each form of endpoint an admin
can paste from the Azure portal, and what a 404 is reported as.
"""

from __future__ import annotations

import httpx
import pytest

from app.services.azure_openai import ChatTarget, chat_target, not_found_detail

ROOT = "https://my-resource.openai.azure.com"
V1_URL = f"{ROOT}/openai/v1/chat/completions"
DEPLOYMENT_URL = f"{ROOT}/openai/deployments/gpt-5/chat/completions"


def _resp(body, status: int = 404) -> httpx.Response:
    return httpx.Response(status, json=body, request=httpx.Request("POST", "https://x"))


class TestChatTargetV1:
    def test_the_endpoint_of_issue_1386_is_the_v1_api(self):
        """The portal's ``…/openai/v1/`` used to get the deployment path
        appended to it: ``…/openai/v1/openai/deployments/gpt-5/…`` — a 404."""
        target = chat_target(f"{ROOT}/openai/v1/", "gpt-5", "2025-08-07")
        assert target == ChatTarget(url=V1_URL, params=None, model="gpt-5")

    @pytest.mark.parametrize(
        "entered",
        [
            f"{ROOT}/openai/v1",
            f"{ROOT}/openai/v1///",
            f"  {ROOT}/openai/v1/  ",
            f"{ROOT}/OpenAI/V1/",
            f"{ROOT}/openai/v1/chat/completions",
            f"{ROOT}/openai/v1/Chat/Completions/",
            f"{ROOT}/openai/v1/?api-version=preview",
            f"{ROOT}/openai/v1#section",
        ],
    )
    def test_every_way_of_writing_the_v1_endpoint(self, entered):
        assert chat_target(entered, "gpt-5", "2024-10-21") == ChatTarget(
            url=V1_URL, params=None, model="gpt-5"
        )

    def test_a_bare_v1_path_is_the_v1_endpoint_too(self):
        """Mirrored in aiProviderUi.test.ts: nothing has to precede the path."""
        assert chat_target("/openai/v1", "d", "v") == ChatTarget(
            url="/openai/v1/chat/completions", params=None, model="d"
        )

    def test_a_gateway_path_in_front_of_it_is_kept(self):
        target = chat_target("https://gw.example.com/ai/team-a/openai/v1/", "d", "v")
        assert target.url == "https://gw.example.com/ai/team-a/openai/v1/chat/completions"
        assert target.params is None
        assert target.model == "d"

    @pytest.mark.parametrize(
        "entered",
        [
            # v1 has to be the end of the path, not a segment of something else.
            f"{ROOT}/openai/v1beta",
            f"{ROOT}/openai/v1/responses",
            f"{ROOT}/xopenai/v1",
            f"{ROOT}/v1",
        ],
    )
    def test_what_only_resembles_the_v1_endpoint_is_not_it(self, entered):
        target = chat_target(entered, "d", "2024-10-21")
        assert target.params == {"api-version": "2024-10-21"}
        assert target.model is None
        assert target.url.endswith("/openai/deployments/d/chat/completions")


class TestChatTargetDeploymentApi:
    def test_the_resource_endpoint_is_called_as_before(self):
        assert chat_target(ROOT, "gpt-5", "2024-10-21") == ChatTarget(
            url=DEPLOYMENT_URL, params={"api-version": "2024-10-21"}, model=None
        )

    @pytest.mark.parametrize(
        "entered",
        [
            f"{ROOT}/",
            f"  {ROOT}//  ",
            f"{ROOT}/openai",
            f"{ROOT}/OpenAI/",
            f"{ROOT}/openai/deployments",
            f"{ROOT}/openai/deployments/",
            # The "Target URI" the portal shows for a deployment, pasted whole:
            # the configured deployment and API version are the ones used.
            f"{ROOT}/openai/deployments/other/chat/completions?api-version=2025-01-01-preview",
            f"{ROOT}/openai/Deployments/other/chat/completions",
            f"{ROOT}?api-version=2024-02-01",
            f"{ROOT}/#top",
        ],
    )
    def test_whatever_follows_the_resource_root_is_cut_back_to_it(self, entered):
        assert chat_target(entered, "gpt-5", "2024-10-21") == ChatTarget(
            url=DEPLOYMENT_URL, params={"api-version": "2024-10-21"}, model=None
        )

    def test_only_slashes_are_trimmed_from_the_end(self):
        target = chat_target("https://gw.example.com/PROXYX//", "d", "v")
        assert target.url == "https://gw.example.com/PROXYX/openai/deployments/d/chat/completions"

    def test_a_gateway_path_is_kept(self):
        target = chat_target("https://gw.example.com/ai/team-a/openai", "d", "v")
        assert (
            target.url == "https://gw.example.com/ai/team-a/openai/deployments/d/chat/completions"
        )

    @pytest.mark.parametrize(
        ("entered", "root"),
        [
            # A host or a path segment that merely contains the word.
            ("https://openai", "https://openai"),
            ("https://openai.example.com", "https://openai.example.com"),
            ("https://gw.example.com/myopenai", "https://gw.example.com/myopenai"),
            ("https://gw.example.com/openai/proxy", "https://gw.example.com/openai/proxy"),
            (
                "https://gw.example.com/openai/deploymentsx",
                "https://gw.example.com/openai/deploymentsx",
            ),
        ],
    )
    def test_only_a_trailing_openai_path_is_cut(self, entered, root):
        assert chat_target(entered, "d", "v").url == f"{root}/openai/deployments/d/chat/completions"

    def test_only_the_first_query_or_fragment_mark_ends_the_url(self):
        target = chat_target(f"{ROOT}/openai?a=1?b=/openai/v1", "d", "v")
        assert target.url == f"{ROOT}/openai/deployments/d/chat/completions"
        assert target.params == {"api-version": "v"}

    def test_the_target_cannot_be_changed_after_the_fact(self):
        target = chat_target(ROOT, "d", "v")
        with pytest.raises(AttributeError):
            target.url = "https://elsewhere"  # type: ignore[misc]


class TestNotFoundDetail:
    DEPLOYMENT = ChatTarget(url=DEPLOYMENT_URL, params={"api-version": "2025-08-07"}, model=None)
    V1 = ChatTarget(url=V1_URL, params=None, model="gpt-5")

    @pytest.mark.parametrize("target", [DEPLOYMENT, V1])
    def test_an_unknown_deployment_is_named_as_such(self, target):
        resp = _resp({"error": {"code": "DeploymentNotFound", "message": "does not exist"}})
        assert not_found_detail(resp, target, "gpt-5") == (
            "Azure OpenAI deployment 'gpt-5' not found"
        )

    @pytest.mark.parametrize(
        "body",
        [
            {"error": {"code": "404", "message": "Resource not found"}},
            {"error": {"code": "deploymentnotfound"}},
            {"error": {"code": 404}},
            {"error": "Resource not found"},
            {},
        ],
    )
    def test_any_other_404_on_the_deployment_api_names_the_path_and_the_version(self, body):
        """#1386: a model version entered as the API version reads as
        "Resource not found", which was reported as a missing deployment."""
        assert not_found_detail(_resp(body), self.DEPLOYMENT, "gpt-5") == (
            "Azure OpenAI answered 404 for /openai/deployments/gpt-5/chat/completions: "
            "check the Provider URL (the resource endpoint, such as "
            "https://your-resource.openai.azure.com) and the API version '2025-08-07', "
            "which must be an Azure OpenAI API version, not the version of the model. "
            "An endpoint ending in /openai/v1/ needs no API version"
        )

    def test_any_other_404_on_the_v1_api_has_no_version_to_check(self):
        resp = _resp({"error": {"code": "404", "message": "Resource not found"}})
        assert not_found_detail(resp, self.V1, "gpt-5") == (
            "Azure OpenAI answered 404 for /openai/v1/chat/completions: "
            "check the Provider URL and that the deployment 'gpt-5' exists"
        )

    def test_a_404_that_is_not_json(self):
        resp = httpx.Response(404, text="<html>", request=httpx.Request("POST", "https://x"))
        assert not_found_detail(resp, self.V1, "d") == (
            "Azure OpenAI answered 404 for /openai/v1/chat/completions: "
            "check the Provider URL and that the deployment 'd' exists"
        )

    def test_the_path_keeps_a_gateway_prefix_and_drops_the_host(self):
        target = ChatTarget(
            url="https://gw.example.com/team-a/openai/v1/chat/completions", params=None, model="d"
        )
        assert not_found_detail(_resp({}), target, "d").startswith(
            "Azure OpenAI answered 404 for /team-a/openai/v1/chat/completions: "
        )
