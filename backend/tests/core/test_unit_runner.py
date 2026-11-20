"""The unit runner must propagate a failing service test."""

import os
import shutil
import subprocess
from pathlib import Path


def test_unit_runner_does_not_mask_service_failure(tmp_path):
    root = tmp_path / "project"
    scripts = root / "scripts"
    bin_dir = root / "backend" / "venv" / "bin"
    scripts.mkdir(parents=True)
    bin_dir.mkdir(parents=True)
    runner = scripts / "test.sh"
    shutil.copyfile(Path(__file__).resolve().parents[3] / "scripts" / "test.sh", runner)
    (bin_dir / "activate").write_bytes(
        b"python() {\n"
        b'  if [ "$1" = "-c" ]; then return 0; fi\n'
        b'  if [ "$1" != "-m" ] || [ "$2" != "pytest" ]; then return 2; fi\n'
        b'  printf "%s %s\\n" "$PYTHONUTF8" "$*" >> phases\n'
        b'  for arg in "$@"; do\n'
        b'    if [ "$arg" = "tests/services/test_calculation_engine.py" ]; then return 1; fi\n'
        b"  done\n"
        b"  return 0\n"
        b"}\n"
    )

    result = subprocess.run(
        [
            "git",
            "-c",
            "alias.turbo-runner=!bash",
            "turbo-runner",
            str(runner),
            "--unit",
            "--maxfail=1",
        ],
        cwd=root,
        env={**os.environ, "PYTHONUTF8": "0"},
        capture_output=True,
        text=True,
        check=False,
    )

    output = f"stdout:\n{result.stdout}\nstderr:\n{result.stderr}"
    phases = root / "backend" / "phases"
    assert phases.exists(), output
    invocations = phases.read_text().splitlines()
    assert len(invocations) == 1, output
    utf8, *args = invocations[0].split()
    assert utf8 == "1", output
    assert "tests/core/" in args, output
    assert "tests/services/test_calculation_engine.py" in args, output
    assert "tests/services/test_bpmn_parser.py" in args, output
    assert "--maxfail=1" in args, output
    assert result.returncode == 1, output
