#!/usr/bin/env python3
"""Every release pin under deploy/ must be the same, real release.

The Bicep parameters, the CloudFormation template, the Cloud Run manifest and
the Terraform tfvars examples each carry a Turbo EA version. Nothing ties them
to /VERSION on purpose — that file moves on every PR and the examples should
not — but they must agree with each other and name a version CHANGELOG.md has
a section for, so a typo or a half-done bump fails CI instead of shipping.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DEPLOY = ROOT / "deploy"
VERSION_RE = r"[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?"


def collect() -> dict[str, list[str]]:
    """Return {file: [pins]} for every deployment template."""
    pins: dict[str, list[str]] = {}

    bicepparam = DEPLOY / "azure-container-apps" / "main.bicepparam"
    pins[str(bicepparam)] = re.findall(
        rf"param imageTag = '({VERSION_RE})'", bicepparam.read_text()
    )

    # CloudFormation's !If / !Ref tags are not plain YAML; read the one
    # parameter block textually.
    cfn = DEPLOY / "ecs-fargate" / "template.yaml"
    pins[str(cfn)] = re.findall(
        rf'^  ImageTag:\n    Type: String\n    Default: "({VERSION_RE})"', cfn.read_text(), re.M
    )

    manifest = DEPLOY / "cloud-run" / "service.yaml"
    pins[str(manifest)] = re.findall(rf"image: \S+:({VERSION_RE})\s*$", manifest.read_text(), re.M)

    for tfvars in sorted((DEPLOY / "terraform").glob("*/terraform.tfvars.example")):
        pins[str(tfvars)] = re.findall(
            rf'^\s*(?:image_tag|chart_version)\s*=\s*"({VERSION_RE})"', tfvars.read_text(), re.M
        )
    return pins


def check(pins: dict[str, list[str]], changelog: str) -> list[str]:
    errors: list[str] = []
    for path, found in pins.items():
        if not found:
            errors.append(f"{path}: no release pin found")
    versions = {v for found in pins.values() for v in found}
    if len(versions) > 1:
        detail = "; ".join(f"{Path(p).relative_to(ROOT)} → {', '.join(v)}" for p, v in pins.items())
        errors.append(f"deploy/ templates pin different releases: {detail}")
    for version in versions:
        if f"## [{version}]" not in changelog:
            errors.append(f"CHANGELOG.md has no '## [{version}]' section for the pinned release")
    return errors


def main() -> int:
    errors = check(collect(), (ROOT / "CHANGELOG.md").read_text())
    for error in errors:
        print(error, file=sys.stderr)
    if not errors:
        print("deploy/ release pins: ok")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
