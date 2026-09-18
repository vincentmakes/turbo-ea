"""Tests for the shared Amazon Bedrock helper (services/bedrock.py).

No AWS, no network: every test patches ``_make_client``, the single seam
through which the module touches boto3.
"""

from __future__ import annotations

import ast
import asyncio
import pathlib
import threading
from unittest.mock import MagicMock

import pytest
from botocore.exceptions import (
    ClientError,
    EndpointConnectionError,
    NoCredentialsError,
    PartialCredentialsError,
)

from app.services import bedrock

BACKEND_ROOT = pathlib.Path(__file__).resolve().parents[2]


def _client_error(code: str, message: str = "boom") -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": message}}, "Converse")


# ---------------------------------------------------------------------------
# Import cost
# ---------------------------------------------------------------------------


class TestLazyImport:
    def test_boto3_is_not_imported_at_module_scope(self):
        """boto3/botocore cost real time to import; Bedrock is an optional provider."""
        tree = ast.parse((BACKEND_ROOT / "app/services/bedrock.py").read_text())
        top_level_imports: list[str] = []
        for node in tree.body:
            if isinstance(node, ast.Import):
                top_level_imports.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom) and node.module:
                top_level_imports.append(node.module)
        offenders = [m for m in top_level_imports if m.split(".")[0] in ("boto3", "botocore")]
        assert offenders == []


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


class TestIsValidRegion:
    @pytest.mark.parametrize(
        "region",
        ["eu-central-1", "us-east-1", "ap-southeast-2", "us-gov-west-1", "eu-central-2"],
    )
    def test_accepts_regions(self, region):
        assert bedrock.is_valid_region(region)

    @pytest.mark.parametrize(
        "value",
        ["", "   ", "eu-central", "EU-CENTRAL-1", "http://localhost:11434", "us_east_1", "1"],
    )
    def test_rejects_non_regions(self, value):
        assert not bedrock.is_valid_region(value)

    def test_trims_whitespace(self):
        assert bedrock.is_valid_region("  eu-central-1  ")


class TestParseCredentials:
    def test_empty_means_ambient_chain(self):
        assert bedrock.parse_credentials("") == {}
        assert bedrock.parse_credentials("   ") == {}

    def test_key_and_secret(self):
        assert bedrock.parse_credentials("AKIAEXAMPLE:secret") == {
            "aws_access_key_id": "AKIAEXAMPLE",
            "aws_secret_access_key": "secret",
        }

    def test_key_secret_and_session_token(self):
        assert bedrock.parse_credentials("AKIAEXAMPLE:secret:token") == {
            "aws_access_key_id": "AKIAEXAMPLE",
            "aws_secret_access_key": "secret",
            "aws_session_token": "token",
        }

    @pytest.mark.parametrize("value", ["sk-no-colon", "AKIA:", ":secret", "a:b:c:d"])
    def test_malformed_raises(self, value):
        with pytest.raises(bedrock.BedrockError) as exc:
            bedrock.parse_credentials(value)
        assert exc.value.kind == "credentials_invalid"


class TestBuildConverseRequest:
    def test_system_message_becomes_the_system_parameter(self):
        req = bedrock.build_converse_request(
            "model-x",
            [
                {"role": "system", "content": "be terse"},
                {"role": "user", "content": "hello"},
            ],
            max_tokens=100,
        )
        assert req["system"] == [{"text": "be terse"}]
        # A system role inside messages is a ValidationException on Converse.
        assert req["messages"] == [{"role": "user", "content": [{"text": "hello"}]}]
        assert all(m["role"] != "system" for m in req["messages"])

    def test_no_system_key_when_there_is_no_system_message(self):
        req = bedrock.build_converse_request(
            "model-x", [{"role": "user", "content": "hi"}], max_tokens=10
        )
        assert "system" not in req

    def test_several_system_messages_are_kept_in_order(self):
        req = bedrock.build_converse_request(
            "model-x",
            [
                {"role": "system", "content": "one"},
                {"role": "system", "content": "two"},
                {"role": "user", "content": "hi"},
            ],
            max_tokens=10,
        )
        assert req["system"] == [{"text": "one"}, {"text": "two"}]

    def test_inference_config(self):
        req = bedrock.build_converse_request(
            "model-x", [{"role": "user", "content": "hi"}], max_tokens=512, temperature=0.1
        )
        assert req["inferenceConfig"] == {"maxTokens": 512, "temperature": 0.1}

    def test_temperature_omitted_when_none(self):
        req = bedrock.build_converse_request(
            "model-x", [{"role": "user", "content": "hi"}], max_tokens=512
        )
        assert req["inferenceConfig"] == {"maxTokens": 512}

    def test_model_id(self):
        req = bedrock.build_converse_request(
            "eu.anthropic.claude-x", [{"role": "user", "content": "hi"}], max_tokens=1
        )
        assert req["modelId"] == "eu.anthropic.claude-x"


# ---------------------------------------------------------------------------
# converse
# ---------------------------------------------------------------------------


def _converse_response(text: str = "hello", stop_reason: str = "end_turn") -> dict:
    return {
        "output": {"message": {"role": "assistant", "content": [{"text": text}]}},
        "stopReason": stop_reason,
    }


class TestConverse:
    @pytest.mark.asyncio
    async def test_returns_text_and_builds_a_runtime_client(self, monkeypatch):
        client = MagicMock()
        client.converse.return_value = _converse_response("the answer")
        calls: list[tuple] = []

        def fake_make_client(service, region, credentials, read_timeout):
            calls.append((service, region, credentials, read_timeout))
            return client

        monkeypatch.setattr(bedrock, "_make_client", fake_make_client)

        out = await bedrock.converse(
            "eu-central-1",
            "model-x",
            [{"role": "user", "content": "q"}],
            api_key="AKIA:secret",
            max_tokens=256,
        )

        assert out == {"text": "the answer", "truncated": False}
        service, region, credentials, _timeout = calls[0]
        assert service == "bedrock-runtime"
        assert region == "eu-central-1"
        assert credentials == {"aws_access_key_id": "AKIA", "aws_secret_access_key": "secret"}
        assert client.converse.call_args.kwargs["modelId"] == "model-x"
        assert client.converse.call_args.kwargs["inferenceConfig"]["maxTokens"] == 256

    @pytest.mark.asyncio
    async def test_no_api_key_uses_the_ambient_credential_chain(self, monkeypatch):
        client = MagicMock()
        client.converse.return_value = _converse_response()
        seen: dict = {}

        def fake_make_client(service, region, credentials, read_timeout):
            seen["credentials"] = credentials
            return client

        monkeypatch.setattr(bedrock, "_make_client", fake_make_client)
        await bedrock.converse("eu-central-1", "m", [{"role": "user", "content": "q"}])
        assert seen["credentials"] == {}

    @pytest.mark.asyncio
    async def test_truncation_from_stop_reason(self, monkeypatch):
        client = MagicMock()
        client.converse.return_value = _converse_response("cut", stop_reason="max_tokens")
        monkeypatch.setattr(bedrock, "_make_client", lambda *a, **k: client)

        out = await bedrock.converse("eu-central-1", "m", [{"role": "user", "content": "q"}])
        assert out == {"text": "cut", "truncated": True}

    @pytest.mark.asyncio
    async def test_several_text_blocks_are_joined(self, monkeypatch):
        client = MagicMock()
        client.converse.return_value = {
            "output": {"message": {"content": [{"text": "a"}, {"text": "b"}]}},
            "stopReason": "end_turn",
        }
        monkeypatch.setattr(bedrock, "_make_client", lambda *a, **k: client)
        out = await bedrock.converse("eu-central-1", "m", [{"role": "user", "content": "q"}])
        assert out["text"] == "ab"

    @pytest.mark.asyncio
    async def test_empty_content_yields_empty_text(self, monkeypatch):
        client = MagicMock()
        client.converse.return_value = {"output": {"message": {"content": []}}}
        monkeypatch.setattr(bedrock, "_make_client", lambda *a, **k: client)
        out = await bedrock.converse("eu-central-1", "m", [{"role": "user", "content": "q"}])
        assert out == {"text": "", "truncated": False}

    @pytest.mark.asyncio
    async def test_runs_off_the_event_loop(self, monkeypatch):
        """boto3 is synchronous — blocking the loop would stall every other request."""
        loop_thread = threading.get_ident()
        observed: dict = {}

        client = MagicMock()

        def converse(**kwargs):
            observed["thread"] = threading.get_ident()
            return _converse_response()

        client.converse.side_effect = converse
        monkeypatch.setattr(bedrock, "_make_client", lambda *a, **k: client)

        await bedrock.converse("eu-central-1", "m", [{"role": "user", "content": "q"}])
        assert observed["thread"] != loop_thread

    @pytest.mark.asyncio
    async def test_invalid_region_refused_before_the_sdk(self, monkeypatch):
        monkeypatch.setattr(
            bedrock,
            "_make_client",
            lambda *a, **k: pytest.fail("client must not be built for a bad region"),
        )
        with pytest.raises(bedrock.BedrockError) as exc:
            await bedrock.converse("not-a-region", "m", [{"role": "user", "content": "q"}])
        assert exc.value.code == "InvalidRegion"

    @pytest.mark.asyncio
    async def test_missing_model_refused(self, monkeypatch):
        monkeypatch.setattr(bedrock, "_make_client", lambda *a, **k: MagicMock())
        with pytest.raises(bedrock.BedrockError) as exc:
            await bedrock.converse("eu-central-1", "", [{"role": "user", "content": "q"}])
        assert exc.value.code == "NoModel"

    @pytest.mark.asyncio
    async def test_client_error_is_classified(self, monkeypatch):
        client = MagicMock()
        client.converse.side_effect = _client_error("ThrottlingException", "slow down")
        monkeypatch.setattr(bedrock, "_make_client", lambda *a, **k: client)

        with pytest.raises(bedrock.BedrockError) as exc:
            await bedrock.converse("eu-central-1", "m", [{"role": "user", "content": "q"}])
        assert exc.value.kind == "quota"
        assert exc.value.code == "ThrottlingException"


# ---------------------------------------------------------------------------
# Error classification
# ---------------------------------------------------------------------------


class TestClassifyError:
    @pytest.mark.parametrize(
        "code,kind",
        [
            ("AccessDeniedException", "credentials_invalid"),
            ("UnrecognizedClientException", "credentials_invalid"),
            ("InvalidSignatureException", "credentials_invalid"),
            ("ExpiredTokenException", "credentials_invalid"),
            ("ThrottlingException", "quota"),
            ("TooManyRequestsException", "quota"),
            ("ServiceQuotaExceededException", "quota"),
            ("ValidationException", "other"),
            ("ResourceNotFoundException", "other"),
        ],
    )
    def test_client_error_codes(self, code, kind):
        err = bedrock._classify_error(_client_error(code))
        assert err.kind == kind
        assert err.code == code

    def test_validation_message_is_preserved(self):
        """It is the message that tells an admin to use an inference profile id."""
        err = bedrock._classify_error(
            _client_error(
                "ValidationException",
                "Invocation of model ID anthropic.claude-x with on-demand throughput "
                "isn't supported. Use an inference profile instead.",
            )
        )
        assert "inference profile" in str(err)

    def test_no_credentials(self):
        err = bedrock._classify_error(NoCredentialsError())
        assert err.kind == "credentials_missing"

    def test_partial_credentials(self):
        err = bedrock._classify_error(
            PartialCredentialsError(provider="env", cred_var="aws_secret_access_key")
        )
        assert err.kind == "credentials_missing"

    def test_endpoint_connection_error(self):
        err = bedrock._classify_error(EndpointConnectionError(endpoint_url="https://x"))
        assert err.kind == "unreachable"

    def test_unknown_exception(self):
        err = bedrock._classify_error(RuntimeError("weird"))
        assert err.kind == "other"
        assert err.code == "RuntimeError"


# ---------------------------------------------------------------------------
# list_model_ids
# ---------------------------------------------------------------------------


def _foundation_page(*ids: str, on_demand: bool = True) -> dict:
    return {
        "modelSummaries": [
            {
                "modelId": i,
                "inferenceTypesSupported": ["ON_DEMAND"] if on_demand else ["PROVISIONED"],
            }
            for i in ids
        ]
    }


class TestListModelIds:
    @pytest.mark.asyncio
    async def test_lists_profiles_first_then_foundation_models(self, monkeypatch):
        client = MagicMock()
        client.list_foundation_models.return_value = _foundation_page(
            "anthropic.claude-3-haiku", "amazon.nova-lite"
        )
        client.list_inference_profiles.return_value = {
            "inferenceProfileSummaries": [{"inferenceProfileId": "eu.anthropic.claude-sonnet-4"}]
        }
        monkeypatch.setattr(bedrock, "_make_client", lambda *a, **k: client)

        ids = await bedrock.list_model_ids("eu-central-1")

        assert ids[0] == "eu.anthropic.claude-sonnet-4"
        assert set(ids[1:]) == {"anthropic.claude-3-haiku", "amazon.nova-lite"}
        assert client.list_foundation_models.call_args.kwargs == {"byOutputModality": "TEXT"}

    @pytest.mark.asyncio
    async def test_uses_the_control_plane_client(self, monkeypatch):
        client = MagicMock()
        client.list_foundation_models.return_value = _foundation_page("m")
        client.list_inference_profiles.return_value = {"inferenceProfileSummaries": []}
        seen: dict = {}

        def fake_make_client(service, region, credentials, read_timeout):
            seen["service"] = service
            return client

        monkeypatch.setattr(bedrock, "_make_client", fake_make_client)
        await bedrock.list_model_ids("eu-central-1")
        assert seen["service"] == "bedrock"

    @pytest.mark.asyncio
    async def test_provisioned_only_models_are_dropped(self, monkeypatch):
        client = MagicMock()
        client.list_foundation_models.return_value = {
            "modelSummaries": [
                {"modelId": "on-demand-model", "inferenceTypesSupported": ["ON_DEMAND"]},
                {"modelId": "provisioned-model", "inferenceTypesSupported": ["PROVISIONED"]},
            ]
        }
        client.list_inference_profiles.return_value = {"inferenceProfileSummaries": []}
        monkeypatch.setattr(bedrock, "_make_client", lambda *a, **k: client)

        ids = await bedrock.list_model_ids("eu-central-1")
        assert ids == ["on-demand-model"]

    @pytest.mark.asyncio
    async def test_a_model_without_the_field_is_kept(self, monkeypatch):
        """Hiding a callable model is worse than listing one that later fails."""
        client = MagicMock()
        client.list_foundation_models.return_value = {
            "modelSummaries": [{"modelId": "legacy-model"}]
        }
        client.list_inference_profiles.return_value = {"inferenceProfileSummaries": []}
        monkeypatch.setattr(bedrock, "_make_client", lambda *a, **k: client)

        assert await bedrock.list_model_ids("eu-central-1") == ["legacy-model"]

    @pytest.mark.asyncio
    async def test_inference_profiles_are_paginated(self, monkeypatch):
        client = MagicMock()
        client.list_foundation_models.return_value = _foundation_page()
        pages = [
            {"inferenceProfileSummaries": [{"inferenceProfileId": "eu.a"}], "nextToken": "t1"},
            {"inferenceProfileSummaries": [{"inferenceProfileId": "eu.b"}]},
        ]
        client.list_inference_profiles.side_effect = pages
        monkeypatch.setattr(bedrock, "_make_client", lambda *a, **k: client)

        ids = await bedrock.list_model_ids("eu-central-1")
        assert ids == ["eu.a", "eu.b"]
        assert client.list_inference_profiles.call_args_list[1].kwargs == {"nextToken": "t1"}

    @pytest.mark.asyncio
    async def test_profile_access_denied_degrades_to_foundation_models(self, monkeypatch):
        """Older IAM policies predate ListInferenceProfiles — still show what we can."""
        client = MagicMock()
        client.list_foundation_models.return_value = _foundation_page("anthropic.claude-3-haiku")
        client.list_inference_profiles.side_effect = _client_error("AccessDeniedException")
        monkeypatch.setattr(bedrock, "_make_client", lambda *a, **k: client)

        ids = await bedrock.list_model_ids("eu-central-1")
        assert ids == ["anthropic.claude-3-haiku"]

    @pytest.mark.asyncio
    async def test_foundation_model_failure_raises(self, monkeypatch):
        client = MagicMock()
        client.list_foundation_models.side_effect = _client_error("AccessDeniedException")
        monkeypatch.setattr(bedrock, "_make_client", lambda *a, **k: client)

        with pytest.raises(bedrock.BedrockError) as exc:
            await bedrock.list_model_ids("eu-central-1")
        assert exc.value.kind == "credentials_invalid"

    @pytest.mark.asyncio
    async def test_missing_credentials_raises(self, monkeypatch):
        client = MagicMock()
        client.list_foundation_models.side_effect = NoCredentialsError()
        monkeypatch.setattr(bedrock, "_make_client", lambda *a, **k: client)

        with pytest.raises(bedrock.BedrockError) as exc:
            await bedrock.list_model_ids("eu-central-1")
        assert exc.value.kind == "credentials_missing"

    @pytest.mark.asyncio
    async def test_invalid_region_refused(self, monkeypatch):
        monkeypatch.setattr(
            bedrock,
            "_make_client",
            lambda *a, **k: pytest.fail("client must not be built for a bad region"),
        )
        with pytest.raises(bedrock.BedrockError):
            await bedrock.list_model_ids("nonsense")

    @pytest.mark.asyncio
    async def test_duplicate_ids_are_removed(self, monkeypatch):
        client = MagicMock()
        client.list_foundation_models.return_value = _foundation_page("shared", "shared", "other")
        client.list_inference_profiles.return_value = {
            "inferenceProfileSummaries": [
                {"inferenceProfileId": "shared"},
                {"inferenceProfileId": "shared"},
            ]
        }
        monkeypatch.setattr(bedrock, "_make_client", lambda *a, **k: client)

        ids = await bedrock.list_model_ids("eu-central-1")
        assert ids == ["shared", "other"]


# ---------------------------------------------------------------------------
# Concurrency
# ---------------------------------------------------------------------------


class TestConcurrency:
    @pytest.mark.asyncio
    async def test_each_call_builds_its_own_client(self, monkeypatch):
        """boto3's default session is not safe for concurrent client creation."""
        built = 0

        def fake_make_client(service, region, credentials, read_timeout):
            nonlocal built
            built += 1
            client = MagicMock()
            client.converse.return_value = _converse_response()
            return client

        monkeypatch.setattr(bedrock, "_make_client", fake_make_client)

        await asyncio.gather(
            *[
                bedrock.converse("eu-central-1", "m", [{"role": "user", "content": "q"}])
                for _ in range(3)
            ]
        )
        assert built == 3
