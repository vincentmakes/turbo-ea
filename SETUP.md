# SETUP: starting from scratch on Windows (no administrator rights)

This file lists what to install on a new machine to work on Turbo EA with Claude Code.
Everything is installed in user space: no system-wide MSI installers, and no `winget install` that asks for admin rights.

Sections of this file:

1. System prerequisites
2. Node (user-level globals and project)
3. Python (uv and the backend venv)
4. User-level Claude Code plugins and skills (caveman, superpowers, claude-md-management, humanizer)
5. Project-level Claude Code skills
6. Tools
   - Graphify (code graph)
   - Trail (local install, shared hook and telemetry turned off)

A final verification section will follow.

---

## 1. System prerequisites

| Program | Verified version | Where it lives on the machine |
|---|---|---|
| Git for Windows | 2.54.0 | `%LOCALAPPDATA%\Programs\Git` |
| GitHub CLI (`gh`) | 2.97.0 | `%LOCALAPPDATA%\GitHub CLI\bin` |
| Docker Desktop | Latest stable release | `%LOCALAPPDATA%\Programs\DockerDesktop` (per-user install) |

### Required variable for Claude Code: `CLAUDE_CODE_GIT_BASH_PATH`

Claude Code's Bash tool needs `bash.exe`, **not** the `git-bash.exe` launcher
(which opens a separate MinTTY window and never returns the output).

```powershell
[Environment]::SetEnvironmentVariable(
  "CLAUDE_CODE_GIT_BASH_PATH",
  "$env:LOCALAPPDATA\Programs\Git\bin\bash.exe",
  "User")
```

### `gh` and the PATH

`gh` lives in the **user** `PATH`, not the system one. Check:

```powershell
[Environment]::GetEnvironmentVariable("Path", "User") -split ";" | Select-String "GitHub CLI"
gh --version
gh auth status
```

If it is missing, add the folder to the user PATH:

```powershell
$p = [Environment]::GetEnvironmentVariable("Path", "User")
[Environment]::SetEnvironmentVariable("Path", "$p;$env:LOCALAPPDATA\GitHub CLI\bin", "User")
```

Then run `gh auth login` (access to the fork `TommasoChi/turbo-ea`).

### Docker

With WSL 2 already enabled, download the latest stable
[Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/).
In the installer choose the per-user mode and use WSL 2 as the backend. Start Docker Desktop before running the checks.

Docker is needed for `./scripts/test.sh` (it starts a throwaway Postgres), for building the
`turboea-fork-*:local` images and for `scripts/docs/docker-docs.sh`. After installing, check:

```powershell
docker --version
docker compose version
docker run --rm hello-world
```

---

## 2. Node

Node is installed in user space with **nvm-windows** (`%LOCALAPPDATA%\Programs\nvm`); the active
version lives in `%LOCALAPPDATA%\Programs\Nodejs`. Both folders are on the user PATH.

| What | Verified version |
|---|---|
| Node | 26.13.1 |
| npm | 12.2.3 |

The frontend installs only with **npm 11 or newer**: npm 10 refuses the lockfile.

```powershell
node --version
npm --version
```

### User-level globals

No global (`-g`) package is needed for Turbo EA. To list the ones present: `npm ls -g --depth=0`.

### Project

```powershell
cd frontend
npm install
```

Check (from the same folder):

```powershell
npx tsc --noEmit -p .
npm run test:run
```

`npm run dev` starts Vite on `localhost:5173` and proxies `/api` to `:8000`.

---

## 3. Python

The backend requires Python **3.11 or newer** (`requires-python = ">=3.11"` in `backend/pyproject.toml`).
The machine has Python 3.12.16 managed by **uv** (0.13.7): the interpreter lives in `%USERPROFILE%\.local\bin\python.exe`.
`uv` also installed `graphify` (section 6).

### uv and Python

```powershell
winget install --id astral-sh.uv --scope user
uv python install 3.12
python --version
```

`uv` is on the user PATH (`...\WinGet\Packages\astral-sh.uv_Microsoft.Winget.Source_8wekyb3d8bbwe`). If `winget`
cannot be used without administrator rights, download a portable `uv` and put it on the user PATH.

The uv interpreter is marked "externally managed": a direct `python -m pip install` fails. To install
packages outside a venv use `uv pip install --python <interpreter> --break-system-packages <package>`.
Turbo EA does not need this: the whole backend lives in a venv.

### Project: the backend venv

```powershell
cd software\turbo-ea\backend
python -m venv venv
venv\Scripts\activate
pip install -e ".[dev]"
```

The development dependencies are in `backend/pyproject.toml`, section `[project.optional-dependencies] dev`:
`pytest` (below 9.2), `pytest-asyncio`, `pytest-cov`, `pytest-xdist`, `mutmut` (pinned version), `httpx`,
`ruff`, `vulture` (pinned version), `pip-audit`, `pip-tools`, `mypy`. `mutmut` and `vulture` are pinned
on purpose: do not upgrade them on your own.

The machine already has a venv in `backend/venv` (Python 3.12.10, `ruff` 0.16.0).

### Check

```powershell
cd software\turbo-ea\backend
ruff format . ; ruff check .
cd ..
./scripts/test.sh tests/services/test_license_status.py
```

`./scripts/test.sh` is run from Git Bash: it starts a throwaway Postgres with Docker, creates the venv if it is
missing and installs the dependencies on the first run. Test paths are **relative to `backend/`**: with a
`backend/` prefix it collects no tests and exits without an error.

Known issue: on a fresh venv the `pip install -e "$BACKEND_DIR[dev]"` step of `scripts/test.sh` can get the path
wrong in Git Bash. In that case install the dependencies by hand as above and run it again.
On this machine 11 backend tests always fail for Windows reasons (time zones with `time.tzset`,
`python3` lookup, timing thresholds, an IPv6 nginx directive); they are not defects in the product code.

---

## 4. User-level Claude Code plugins and skills

Plugins are installed once per user and apply to every project. They live in
`%USERPROFILE%\.claude\plugins`; the list of enabled ones is in `%USERPROFILE%\.claude\settings.json`
under `enabledPlugins`.

### caveman

Makes Claude answer briefly ("caveman" mode). Version 4.1.0.
GitHub: <https://github.com/JuliusBrussee/caveman> (marketplace `caveman`).
From the terminal:

```powershell
claude plugin marketplace add JuliusBrussee/caveman
claude plugin install caveman@caveman
```

Or inside Claude Code:

```text
/plugin marketplace add JuliusBrussee/caveman
/plugin install caveman@caveman
```

Check: `"caveman@caveman": true` must appear in `settings.json`, and the folder
`%USERPROFILE%\.claude\plugins\cache\caveman\caveman\<version>` must exist.

To switch it off in a chat: type `normal mode` (or `stop caveman`). To switch it off completely: set
`false` on its line in `enabledPlugins`.

The npm package `@juliusbrussee/caveman-code` is a different program (a terminal agent with its own
API keys) and must **not** be installed: the plugin does not depend on it.

Update: scheduled job `update-caveman-weekly`, every Wednesday at about 08:50, with the same
procedure (scanner, artifact).

### superpowers

The project's working method: brainstorming, plans, task-by-task execution, TDD, review. Version 7.0.2.
GitHub: <https://github.com/obra/superpowers> (author Jesse Vincent). Installed from the
`claude-plugins-official` marketplace: <https://github.com/anthropics/claude-plugins-official>.

```powershell
claude plugin install superpowers@claude-plugins-official
```

Check: `"superpowers@claude-plugins-official": true` in `enabledPlugins`.

Update: scheduled job `update-superpowers-weekly`, every Wednesday at about 08:45. The security
scanner checks the changed files and the job republishes the "Development process" artifact.

### claude-md-management

A skill to audit and improve `CLAUDE.md` files. Version 1.0.0.
GitHub: <https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-md-management>
(marketplace `claude-plugins-official`, author Anthropic).

```powershell
claude plugin install claude-md-management@claude-plugins-official
```

Check: `"claude-md-management@claude-plugins-official": true` in `enabledPlugins`.

Update: scheduled job `update-claude-md-management-weekly`, every Wednesday at about 08:40, with
the same procedure (scanner, artifact).

### humanizer

A skill that rewrites AI-sounding text so it reads naturally without changing its meaning. It is not a
plugin: it is a user skill in `%USERPROFILE%\.claude\skills\humanizer` (repo `blader/humanizer`, version 4.0.0),
installed with the skills CLI.
GitHub: <https://github.com/blader/humanizer>.

```powershell
npx skills add blader/humanizer --global
```

Check: the folder `%USERPROFILE%\.claude\skills\humanizer` exists and `claude plugin list` shows
`humanizer@skills-dir` as loaded.

It is used on request only, for example on documents and presentations; no step of the development process
calls it. With caveman switched on, type `normal mode` first.

Update: scheduled job `update-humanizer-weekly`, every Wednesday at about 08:50, with the same
procedure (scanner, artifact).

---

## 5. Project-level Claude Code skills

The nine skills are versioned in `.claude/skills/` and arrive with the Turbo EA clone. Open Claude Code from the repository root and check that the skills are available in the `/` menu.

The re-import commands are needed when you work on the project's copies. Run them from the repo root. The `--copy` option creates the files in the Claude Code folder. The sources of the external skills are recorded in [skills-lock.json](skills-lock.json).

The local job `update-security-audit-skill` runs on Wednesdays for all the external skills listed in the lockfile. It runs `npx --yes skills update -p -y` and checks the changed files with Skills Scanner Security. The fork maintainer reviews the diff of `.claude/skills/` and `skills-lock.json` before merging the updates.

### async-python-patterns

The [backend-dev](.claude/agents/backend-dev.md) agent loads it for asynchronous code and concurrency in Python.

- Re-import into the project with `npx skills add wshobson/agents --skill async-python-patterns --agent claude-code --copy`.
- Source on GitHub. [wshobson/agents](https://github.com/wshobson/agents/blob/9c61ab243def98f72da12abd41cfcf5bcd91af9d/plugins/python-development/skills/async-python-patterns/SKILL.md)
- The local copy is updated by the `update-security-audit-skill` job.

### python-error-handling

The [backend-dev](.claude/agents/backend-dev.md) agent loads it for validation, exceptions and handling of partial failures.

- Re-import into the project with `npx skills add wshobson/agents --skill python-error-handling --agent claude-code --copy`.
- Source on GitHub. [wshobson/agents](https://github.com/wshobson/agents/blob/9c61ab243def98f72da12abd41cfcf5bcd91af9d/plugins/python-development/skills/python-error-handling/SKILL.md)
- The local copy is updated by the `update-security-audit-skill` job.

### python-resource-management

The [backend-dev](.claude/agents/backend-dev.md) agent loads it to manage connections, files and other resources.

- Re-import into the project with `npx skills add wshobson/agents --skill python-resource-management --agent claude-code --copy`.
- Source on GitHub. [wshobson/agents](https://github.com/wshobson/agents/blob/9c61ab243def98f72da12abd41cfcf5bcd91af9d/plugins/python-development/skills/python-resource-management/SKILL.md)
- The local copy is updated by the `update-security-audit-skill` job.

### python-type-safety

Used on request for annotations, protocols and type checking in Python.

- Re-import into the project with `npx skills add wshobson/agents --skill python-type-safety --agent claude-code --copy`.
- Source on GitHub. [wshobson/agents](https://github.com/wshobson/agents/blob/9c61ab243def98f72da12abd41cfcf5bcd91af9d/plugins/python-development/skills/python-type-safety/SKILL.md)
- The local copy is updated by the `update-security-audit-skill` job.

### python-anti-patterns

The [reviewer](.claude/agents/reviewer.md) agent uses it during backend review.

- Re-import into the project with `npx skills add wshobson/agents --skill python-anti-patterns --agent claude-code --copy`.
- Source on GitHub. [wshobson/agents](https://github.com/wshobson/agents/blob/9c61ab243def98f72da12abd41cfcf5bcd91af9d/plugins/python-development/skills/python-anti-patterns/SKILL.md)
- The local copy is updated by the `update-security-audit-skill` job.

### material-ui-styling

The [frontend-dev](.claude/agents/frontend-dev.md) agent loads it to choose how to style MUI components.

- Re-import into the project with `npx skills add mui/material-ui --skill material-ui-styling --agent claude-code --copy`.
- Source on GitHub. [mui/material-ui](https://github.com/mui/material-ui/blob/80739f32f3ee8fb4e1a6cd29ccb35bac78e28cdf/skills/material-ui-styling/SKILL.md)
- The local copy is updated by the `update-security-audit-skill` job.

### material-ui-theming

The [frontend-dev](.claude/agents/frontend-dev.md) agent loads it for the MUI theme and design tokens.

- Re-import into the project with `npx skills add mui/material-ui --skill material-ui-theming --agent claude-code --copy`.
- Source on GitHub. [mui/material-ui](https://github.com/mui/material-ui/blob/80739f32f3ee8fb4e1a6cd29ccb35bac78e28cdf/skills/material-ui-theming/SKILL.md)
- The local copy is updated by the `update-security-audit-skill` job.

### security-audit

Used for release audits or on request, following the [release rules](.claude/rules/release-audit.md).

- Re-import into the project with `npx skills add cloudflare/security-audit-skill --skill security-audit --agent claude-code --copy`.
- Source on GitHub. [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill/blob/c1c8a8c1471069fb0e188eeaff69b8e8db6564a8/skills/security-audit/SKILL.md)
- The local copy is updated by the `update-security-audit-skill` job.

### translate

The `/translate` command starts the [translator](.claude/agents/translator.md) agent to bring the locales level with the English text.

- Installed through the Turbo EA clone.
- Source on GitHub. [translate skill in the fork](https://github.com/TommasoChi/turbo-ea/tree/main/.claude/skills/translate)
- Updated by the Turbo EA maintainers, through a PR to the repository.

The specialised agents are defined in `.claude/agents/`. The per-area rules are in `.claude/rules/` and are referenced from [CLAUDE.md](CLAUDE.md).

---

## 6. Tools

### Graphify (code graph)

Builds a knowledge graph of the code. In the development process it is step 11: `graphify update .`
before the full test suites (code only, no model calls). `graphify-out/` stays untracked and is never
referenced in a PR. Python package `graphifyy` (with two "y"), version 0.9.112, installed with **uv** as a
user tool; it exposes the `graphify` and `graphify-mcp` commands.
GitHub: <https://github.com/Graphify-Labs/graphify> (Apache-2.0 license; site <https://graphify.com>,
documentation <https://docs.graphify.com>, issues <https://github.com/Graphify-Labs/graphify/issues>).

```powershell
uv tool install graphifyy
graphify install
graphify install --platform codex
graphify install --platform agents
```

`graphify install` creates the user skill `%USERPROFILE%\.claude\skills\graphify`; the two variants with
`--platform` do the same for Codex and for the agents (`%USERPROFILE%\.agents\skills\graphify`).

Check:

```powershell
graphify --version
```

In the repo: `cd software\turbo-ea` and then `graphify update .`.

Update: scheduled job `graphify-weekly-update`, every Wednesday at about 08:45. It runs
`%USERPROFILE%\.claude\update-graphify.ps1`: `uv tool upgrade graphifyy`, then `graphify install` for Claude, Codex
and the agents. Afterwards, the security scanner and the artifact.

### Trail

Trail reads the project's shared notes and builds a map of the code.
Install the latest version of `@trailhq/trail-code` into the `node_modules/` at the
root of Turbo EA. [Official source and documentation](https://github.com/trailhq/Trail-Code#readme).

The `.trail/` folder already comes with the repository: `learnings/` holds the shared notes,
`hook.cjs` is the entry point shared by Claude and Codex, and
`.gitignore` excludes the local cache. The hook finds the package in the
`node_modules/` at the project root.

#### Local install with telemetry turned off

Run it from PowerShell at the project root and finish all the commands before opening new Claude
or Codex chats on the project: hooks that are already configured can start
automatically when a session opens.

```powershell
# Start this PowerShell in the Turbo EA project root.

# This also protects the first command, before the persistent preference exists.
$env:DO_NOT_TRACK = '1'

npm.cmd install --prefix . --ignore-scripts --no-save --package-lock=false --no-audit --no-fund @trailhq/trail-code@latest
if ($LASTEXITCODE -ne 0) { throw 'Trail installation failed.' }

& .\node_modules\.bin\trail.cmd telemetry disable
if ($LASTEXITCODE -ne 0) { throw 'Turning telemetry off failed.' }

$trailTelemetryPath = Join-Path $env:USERPROFILE '.graft\telemetry.json'
$trailTelemetry = Get-Content -LiteralPath $trailTelemetryPath -Raw | ConvertFrom-Json
if ($trailTelemetry.enabled -ne $false) {
    throw 'Telemetry does not appear to be turned off persistently.'
}

& .\node_modules\.bin\trail.cmd --version
& .\node_modules\.bin\trail.cmd telemetry status
```

`--prefix .` installs locally. `--no-save` and `--package-lock=false` avoid
changes to the npm manifests; `--ignore-scripts` skips the automatic install
scripts. The executable is `node_modules/.bin/trail.cmd`: invoke it relative
to the project root, with no global install or change to the Windows PATH.
[npm install reference](https://docs.npmjs.com/cli/commands/npm-install/).

`DO_NOT_TRACK=1` applies to this PowerShell and the processes it starts.
`telemetry disable` instead saves `enabled: false` in
`%USERPROFILE%\.graft\telemetry.json`: this choice stays valid in new
sessions, even without the variable. The name `.graft` is still used by Trail
for this file. Do not run `telemetry enable`.

The first commands, including `telemetry disable`, and the hook may update
the configuration automatically: `.trail/hook.cjs`, `.trail/statusline.cjs`,
`.claude/settings.json`, `.claude/settings.local.json` and the registry under
`.trail/cache/.cache/`. They may also update the Trail hooks and skill
under `%USERPROFILE%\.claude\` and create personal state under
`%USERPROFILE%\.trail\`. The package install itself stays local.
`--ignore-scripts` does not prevent these writes the next time Trail starts.

#### Project-only PATH and Trail mode

These settings apply to Claude and Codex sessions opened on Turbo EA. They do
not change the Windows user or system PATH, or the environment of an ordinary
PowerShell opened separately. Changing directory to the project does not make
the bare `trail` command available in that terminal.

`TRAIL_INVOKED_AS=trail` selects Trail mode explicitly. The automatic detection
excludes `node_modules/.bin`, so adding that directory to PATH alone does not
enable all note automations. Keep `DO_NOT_TRACK=1` alongside it, in addition to
the persistent `telemetry disable` preference above.

From the project root, prepare the values for this installation. These commands
only calculate values; they do not write configuration files or change Windows
environment variables:

```powershell
$projectRoot = (Get-Location).Path
if (-not (Test-Path -LiteralPath '.\.trail\hook.cjs')) {
    throw 'Open PowerShell at the Turbo EA project root first.'
}
$trailBin = Join-Path $projectRoot 'node_modules\.bin'
$windowsPath = @(
    [Environment]::GetEnvironmentVariable('Path', 'Machine')
    [Environment]::GetEnvironmentVariable('Path', 'User')
) -join [IO.Path]::PathSeparator
$trailEnvironment = [ordered]@{
    TRAIL_INVOKED_AS = 'trail'
    DO_NOT_TRACK = '1'
    PATH = $trailBin + [IO.Path]::PathSeparator + $windowsPath
}
```

**Claude — `.claude/settings.local.json`.** Print the JSON below and merge its
`env` entries into the existing file, preserving permissions, hooks and other
settings. If `env` already exists, update these three keys inside it:

```powershell
[ordered]@{ env = $trailEnvironment } | ConvertTo-Json -Depth 3
```

**Codex — `.codex/config.toml`.** Print this TOML and merge the three entries
into `[shell_environment_policy.set]`, preserving other entries. Create that
table if it is absent; do not add a duplicate table:

```powershell
'[shell_environment_policy.set]'
$trailEnvironment.GetEnumerator() | ForEach-Object {
    '{0} = {1}' -f $_.Key, (ConvertTo-Json -InputObject $_.Value -Compress)
}
```

The generated PATH is a literal value derived from the project root and the
Windows machine/user PATH, with no hardcoded username. Do not paste an
unexpanded `$env:PATH` or `%PATH%` into these settings. Regenerate the values
if the project moves or the Windows PATH changes. Open new agent sessions
after applying the settings. Codex command hooks also need the variables in
their command: they do not inherit `shell_environment_policy.set`.

#### Verify from an ordinary PowerShell

Run these commands from the Turbo EA project root, including when Claude
and Codex are closed:

```powershell
$env:DO_NOT_TRACK = '1'
& .\node_modules\.bin\trail.cmd --version
& .\node_modules\.bin\trail.cmd telemetry status
```

The version check must print the installed version; the telemetry status must
report that collection is disabled. A bare `trail --version` in an ordinary
PowerShell may still report "command not found": the project-only agent
settings do not apply to it.

#### Shared hook for Claude and Codex

Claude uses the `SessionStart` entry already present in `.claude/settings.json`:

```sh
node "${CLAUDE_PROJECT_DIR:-.}/.trail/hook.cjs" session-start || exit 0
```

Codex uses `.codex/hooks.json`. Merge this Windows example while keeping any
other hooks. Open Codex at the Turbo EA project root: this relative-path
example uses that session directory (`%CD%`) to locate `node_modules/.bin`
and the shared hook. For sessions started in a subdirectory, use the expanded
project-root path calculated above for the working directory and bin path.

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "cmd.exe /d /c \"set TRAIL_INVOKED_AS=trail&&set DO_NOT_TRACK=1&&set PATH=%CD%\\node_modules\\.bin;%PATH%&&node .trail/hook.cjs session-start\"",
            "timeout": 5,
            "statusMessage": "Loading Turbo EA Trail notes"
          }
        ]
      }
    ],
    "PreToolUse": [
      {
        "matcher": "^apply_patch$",
        "hooks": [
          {
            "type": "command",
            "command": "cmd.exe /d /c \"set TRAIL_INVOKED_AS=trail&&set DO_NOT_TRACK=1&&set PATH=%CD%\\node_modules\\.bin;%PATH%&&node .trail/hook.cjs pre-edit\"",
            "timeout": 5,
            "statusMessage": "Loading Trail notes before the edit"
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "^Bash$",
        "hooks": [
          {
            "type": "command",
            "command": "cmd.exe /d /c \"set TRAIL_INVOKED_AS=trail&&set DO_NOT_TRACK=1&&set PATH=%CD%\\node_modules\\.bin;%PATH%&&node .trail/hook.cjs tool-savings\"",
            "timeout": 5,
            "statusMessage": "Loading Trail notes for the command"
          }
        ]
      },
      {
        "matcher": "^apply_patch$",
        "hooks": [
          {
            "type": "command",
            "command": "cmd.exe /d /c \"set TRAIL_INVOKED_AS=trail&&set DO_NOT_TRACK=1&&set PATH=%CD%\\node_modules\\.bin;%PATH%&&node .trail/hook.cjs post-edit\"",
            "timeout": 10,
            "statusMessage": "Updating Trail context after the edit"
          }
        ]
      }
    ]
  }
}
```

All four Trail hooks use the same `.trail/hook.cjs`:

| Codex event | Matcher | Trail handler | Purpose |
| --- | --- | --- | --- |
| `SessionStart` | `startup` | `session-start` | Load the initial project context and standing notes when a new chat starts. |
| `PreToolUse` | `^apply_patch$` | `pre-edit` | Recall relevant notes before a patch. |
| `PostToolUse` | `^Bash$` | `tool-savings` | Recall notes for files named by a shell command, including PowerShell reads through `exec_command`. |
| `PostToolUse` | `^apply_patch$` | `post-edit` | Mark the map as needing an update and recall notes not already shown. |

Codex exposes shell commands as `Bash` to its hooks even on Windows.
Trail's existing `tool-savings` handler is used for note recall: in the
verified installed version, `codex-post-bash` does not include file notes.
No custom script or change to the shared hook is needed. Each command keeps
`TRAIL_INVOKED_AS=trail`, `DO_NOT_TRACK=1` and the local bin path.

Approve the three new entries in **Settings → Hooks**, under Turbo EA:
`PreToolUse / apply_patch`, `PostToolUse / Bash` and
`PostToolUse / apply_patch`. They do not run automatically until approved.
The existing `SessionStart` entry remains unchanged and retains its approval.
A later command change requires a new approval. Open a new project chat
after approving the hooks.

Claude also has personal hooks under `%USERPROFILE%\.claude\`: when the
personal copy handles the event, the project's copy avoids the duplicate
reply. There is no need to create a second script for Codex.

#### Code map and check

If the map does not exist yet, from the project root:

```powershell
& .\node_modules\.bin\trail.cmd build --no-gitignore --no-ignore
```

The map is written to `.trail/cache/`, excluded from Git through
`.trail/.gitignore`. The two flags keep the existing exclusion files.
If the index is already there, check it without rebuilding:

```powershell
& .\node_modules\.bin\trail.cmd status
& .\node_modules\.bin\trail.cmd ask 'CardReadScope' --no-refresh --limit 3
& .\node_modules\.bin\trail.cmd telemetry status
```

The test search must find `backend/app/services/card_read_scope.py`.
`--no-refresh` is only meant to try the existing index; leave it out of
normal searches.

#### When the index is updated

- Before searches (`ask`, `grep`, `skeleton`, `map` and other lookup commands),
  Trail checks whether the code has changed and updates the graph when
  needed. The structural update is local, with no LLM calls.
- In Claude, the edit hooks report that the map needs updating; the `Stop` hook,
  at the end of a turn, can start the synchronisation in the background.
- In Codex, `SessionStart` loads the available context. The `post-edit` hook
  marks the map as needing an update after `apply_patch`; the next Trail search
  checks and updates the graph. No Codex `Stop` hook is configured here.

`--no-refresh` or `GRAFT_NO_REFRESH=1` turn off the update before the
search. If an update fails or is already running, Trail may answer
with the available graph and a warning: check the output.

#### When notes in learnings are saved and read

**Saving into the folder.** The shared notes are Markdown files in
`.trail/learnings/`, recorded with the `trail note` command when a conclusion,
a choice or a solution is worth keeping. Notes from other
collaborators arrive with the clone or with Git updates. `build`
builds the code map and does not copy sources into `learnings/`.
Notes saved with `--personal` live under `%USERPROFILE%\.trail\` instead.

**Reading into the agent's context.** At startup the hook presents the map and
the availability of the notes; it does not insert the contents of all the Markdown files.
Trail searches retrieve the notes that bear on the request. The Codex hooks
above also recall notes before a patch and after shell commands or patches
that name a file listed in a note's `touches`. Repeated reads and the
pre/post pair do not repeat a note already shown in the session. Commands
that do not name a matching file do not receive file-related notes.

**Automatic note recall with the project settings above.** With
`TRAIL_INVOKED_AS=trail`, the startup hook can include the project's standing
notes (`standing: true`). Claude's configured file hooks also recall notes
relevant to a file read or edit. Codex receives file-related notes through
the three additional entries above; the environment variable alone would
not register those events.

Verification covered the shared startup hook for both hosts and a real
file-related note through Claude's hook. Standing notes were tested on a
temporary copy because none of the project's current notes were marked
`standing: true`. Codex file hooks were also checked with simulated shell
and patch events on an isolated copy: matching notes arrive, unrelated
commands receive none, and repeated events do not duplicate the note.
The temporary copies were removed and no project notes were changed.

#### Update

The package update is manual: repeat from the Turbo EA root
the install block with `@latest`, including turning telemetry off
and checking it. The npm package and the code index therefore have
separate updates. Before using the hooks of a new version,
check their effects on a copy of the project.
