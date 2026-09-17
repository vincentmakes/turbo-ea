#!/usr/bin/env python3
"""Structural check for deploy/cloud-run/service.yaml.

There is no offline validator for a Cloud Run service manifest, so CI pins the
few properties the guide depends on: one ingress container on 8920, exactly one
always-on instance with CPU allocated, startup ordering, and the data volume.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

MANIFEST = Path(__file__).resolve().parent.parent / "deploy" / "cloud-run" / "service.yaml"
EDGE_PORT = 8920


def check(manifest: dict) -> list[str]:
    errors: list[str] = []
    if manifest.get("apiVersion") != "serving.knative.dev/v1" or manifest.get("kind") != "Service":
        errors.append("must be a serving.knative.dev/v1 Service")
    template = manifest.get("spec", {}).get("template", {})
    annotations = template.get("metadata", {}).get("annotations", {})
    spec = template.get("spec", {})
    containers = spec.get("containers", [])
    names = {c.get("name") for c in containers}

    if annotations.get("autoscaling.knative.dev/minScale") != "1":
        errors.append("minScale must be '1' (the backend never scales to zero)")
    if annotations.get("autoscaling.knative.dev/maxScale") != "1":
        errors.append("maxScale must be '1' (exactly one backend)")
    if annotations.get("run.googleapis.com/cpu-throttling") != "false":
        errors.append("cpu-throttling must be 'false' (background loops run between requests)")
    if spec.get("timeoutSeconds") != 3600:
        errors.append("timeoutSeconds must be 3600 (event stream)")

    with_ports = [c for c in containers if c.get("ports")]
    if len(with_ports) != 1:
        errors.append("exactly one container may declare ports (the ingress container)")
    elif with_ports[0]["ports"][0].get("containerPort") != EDGE_PORT:
        errors.append(f"the ingress container must listen on {EDGE_PORT}")
    elif with_ports[0].get("name") != "nginx":
        errors.append("the ingress container must be the edge nginx")

    try:
        deps = json.loads(annotations.get("run.googleapis.com/container-dependencies", "{}"))
    except json.JSONDecodeError:
        errors.append("container-dependencies is not valid JSON")
        deps = {}
    for dependant, prerequisites in deps.items():
        for name in [dependant, *prerequisites]:
            if name not in names:
                errors.append(f"container-dependencies names unknown container {name!r}")

    for c in containers:
        if "startupProbe" not in c:
            errors.append(f"container {c.get('name')!r} has no startupProbe (needed for ordering)")

    backend = next((c for c in containers if c.get("name") == "backend"), None)
    if backend is None:
        errors.append("no backend container")
    else:
        mounts = {m.get("mountPath") for m in backend.get("volumeMounts", [])}
        if "/app/data" not in mounts:
            errors.append("the backend must mount the data volume at /app/data")
    volumes = {v.get("name") for v in spec.get("volumes", [])}
    if "data" not in volumes:
        errors.append("a volume named 'data' is required")
    return errors


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else MANIFEST
    errors = check(yaml.safe_load(path.read_text()))
    for error in errors:
        print(f"{path}: {error}", file=sys.stderr)
    if not errors:
        print(f"{path}: ok")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
