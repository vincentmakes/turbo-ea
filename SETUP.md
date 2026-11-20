# SETUP: starting from scratch on Windows (no administrator rights)

This file lists what to install on a new machine to work on Turbo EA with Claude Code.
Everything is installed in user space: no system-wide MSI installers, and no `winget install` that asks for admin rights.

Sections of this file:

1. System prerequisites
2. Node (user-level globals and project)
3. Clone the repository
   - Folders outside the repository
4. Python (uv and the backend venv)
5. User-level Claude Code plugins and skills (caveman, superpowers, claude-md-management, ponytail, humanizer)
6. Project-level Claude Code skills
   - [Project agents for Claude Code and Codex](#project-agents-for-claude-code-and-codex)
7. Tools
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

## 3. Clone the repository

From the workspace folder (the one that holds `software\`):

```powershell
git clone https://github.com/TommasoChi/turbo-ea.git software\turbo-ea
```

### Folders outside the repository

Next to the clone, inside `software\`, there are folders that are **not** part of the repository and are never
committed: `turbo-ea-conf` (the local test instance: `.env` and Compose files, database backups) and
`turbo-ea-vapt` (the isolated security-test stack: backups, test accounts, reports). They hold the environment
files, the backups and the reports, so that sensitive information stays out of the repository. Create them by
hand next to the clone; nothing in them is ever added to a commit.

---

## 4. Python

The backend requires Python **3.11 or newer** (`requires-python = ">=3.11"` in `backend/pyproject.toml`).
The machine has Python 3.12.16 managed by **uv** (0.13.7): the interpreter lives in `%USERPROFILE%\.local\bin\python.exe`.
`uv` also installed `graphify` (section 7).

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

## 5. User-level Claude Code plugins and skills

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

### superpowers

The project's working method: brainstorming, plans, task-by-task execution, TDD, review. Version 7.0.2.
GitHub: <https://github.com/obra/superpowers> (author Jesse Vincent). Installed from the
`claude-plugins-official` marketplace: <https://github.com/anthropics/claude-plugins-official>.

```powershell
claude plugin install superpowers@claude-plugins-official
```

Check: `"superpowers@claude-plugins-official": true` in `enabledPlugins`.

### claude-md-management

A skill to audit and improve `CLAUDE.md` files. Version 1.0.0.
GitHub: <https://github.com/anthropics/claude-plugins-official/tree/main/plugins/claude-md-management>
(marketplace `claude-plugins-official`, author Anthropic).

```powershell
claude plugin install claude-md-management@claude-plugins-official
```

Check: `"claude-md-management@claude-plugins-official": true` in `enabledPlugins`.

### ponytail

Keeps changes small: the "smallest change that fully solves the task" mode, plus the review and audit skills
(`ponytail:ponytail-review`, `ponytail:ponytail-audit`) that the `code-reviewer` and the development agents use.
Version 5.3.3.
GitHub: <https://github.com/DietrichGebert/ponytail> (marketplace `ponytail`, author Dietrich Gebert).

```powershell
claude plugin marketplace add DietrichGebert/ponytail
claude plugin install ponytail@ponytail
```

Check: the folder `%USERPROFILE%\.claude\plugins\cache\ponytail\ponytail\<version>` exists. The plugin is
**enabled by the project**: `.claude/settings.json` has `"ponytail@ponytail": true`, which arrives with the
clone, so its line in the user-level `enabledPlugins` may stay `false`. It adds its own context to every
session opened on Turbo EA.

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

---

## 6. Project-level Claude Code skills

All ten project skills are versioned under [.claude/skills](.claude/skills). The nine external skills have source commits and content hashes in [skills-lock.json](skills-lock.json). The commands below are for refreshing the project copies.

After installing the Ponytail plugin (section 5), run `.\.agents\restore-skills.ps1` from the project root in PowerShell. It creates ten junctions to the project skills and six to the installed Ponytail skills. It also checks existing junctions before making changes. Rerun it to check an existing checkout.

### async-python-patterns

The [backend-dev](.claude/agents/backend-dev.md) agent loads it for asynchronous code and concurrency in Python.

- Re-import into the project with `npx skills add wshobson/agents --skill async-python-patterns --agent claude-code --copy`.
- Source on GitHub. [wshobson/agents](https://github.com/wshobson/agents/blob/9c61ab243def98f72da12abd41cfcf5bcd91af9d/plugins/python-development/skills/async-python-patterns/SKILL.md)

### python-error-handling

The [backend-dev](.claude/agents/backend-dev.md) agent loads it for validation, exceptions and handling of partial failures.

- Re-import into the project with `npx skills add wshobson/agents --skill python-error-handling --agent claude-code --copy`.
- Source on GitHub. [wshobson/agents](https://github.com/wshobson/agents/blob/9c61ab243def98f72da12abd41cfcf5bcd91af9d/plugins/python-development/skills/python-error-handling/SKILL.md)

### python-resource-management

The [backend-dev](.claude/agents/backend-dev.md) agent loads it to manage connections, files and other resources.

- Re-import into the project with `npx skills add wshobson/agents --skill python-resource-management --agent claude-code --copy`.
- Source on GitHub. [wshobson/agents](https://github.com/wshobson/agents/blob/9c61ab243def98f72da12abd41cfcf5bcd91af9d/plugins/python-development/skills/python-resource-management/SKILL.md)

### python-type-safety

Used on request for annotations, protocols and type checking in Python.

- Re-import into the project with `npx skills add wshobson/agents --skill python-type-safety --agent claude-code --copy`.
- Source on GitHub. [wshobson/agents](https://github.com/wshobson/agents/blob/9c61ab243def98f72da12abd41cfcf5bcd91af9d/plugins/python-development/skills/python-type-safety/SKILL.md)

### python-anti-patterns

The [code-reviewer](.claude/agents/code-reviewer.md) agent uses it during backend review.

- Re-import into the project with `npx skills add wshobson/agents --skill python-anti-patterns --agent claude-code --copy`.
- Source on GitHub. [wshobson/agents](https://github.com/wshobson/agents/blob/9c61ab243def98f72da12abd41cfcf5bcd91af9d/plugins/python-development/skills/python-anti-patterns/SKILL.md)

### material-ui-styling

The [frontend-dev](.claude/agents/frontend-dev.md) agent loads it to choose how to style MUI components.

- Re-import into the project with `npx skills add mui/material-ui --skill material-ui-styling --agent claude-code --copy`.
- Source on GitHub. [mui/material-ui](https://github.com/mui/material-ui/blob/80739f32f3ee8fb4e1a6cd29ccb35bac78e28cdf/skills/material-ui-styling/SKILL.md)

### material-ui-theming

The [frontend-dev](.claude/agents/frontend-dev.md) agent loads it for the MUI theme and design tokens.

- Re-import into the project with `npx skills add mui/material-ui --skill material-ui-theming --agent claude-code --copy`.
- Source on GitHub. [mui/material-ui](https://github.com/mui/material-ui/blob/80739f32f3ee8fb4e1a6cd29ccb35bac78e28cdf/skills/material-ui-theming/SKILL.md)

### vercel-composition-patterns

The [frontend-dev](.claude/agents/frontend-dev.md) agent consults it on request for component structure: boolean props, compound components, state and context, React 19 APIs. It is not preloaded: the skill and its rules are about 50 KB.

- Install into the project with `npx skills add vercel-labs/agent-skills --skill vercel-composition-patterns --agent claude-code --copy`. In the repository the folder is `composition-patterns`, but the installer uses the name in the skill's frontmatter.
- Source on GitHub. [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills/tree/1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62/skills/composition-patterns) (MIT licence; checked at commit `1a2c79d4`).
- Skills Skanner Security finds 0 HIGH and 6 MEDIUM: all six are `react.dev` links in `AGENTS.md`, harmless.
- The installer also writes a copy in `.agents/skills/`, which is ignored by git.
- The other skills of the same repository were evaluated and are not used: `react-best-practices` (little value on this code) and `web-design-guidelines` (it downloads its rules at run time).

### security-audit

Used for release audits or on request, following the [release rules](.claude/rules/release-audit.md).

- Re-import into the project with `npx skills add cloudflare/security-audit-skill --skill security-audit --agent claude-code --copy`.
- Source on GitHub. [cloudflare/security-audit-skill](https://github.com/cloudflare/security-audit-skill/blob/c1c8a8c1471069fb0e188eeaff69b8e8db6564a8/skills/security-audit/SKILL.md)

### translate

The `/translate` command starts the [translator](.claude/agents/translator.md) agent to bring the locales level with the English text.

- Installed through the Turbo EA clone.
- Source on GitHub. [translate skill in the fork](https://github.com/TommasoChi/turbo-ea/tree/main/.claude/skills/translate)
- Updated by the Turbo EA maintainers, through a PR to the repository.

The specialised agents are defined in `.claude/agents/`. The per-area rules are in `.claude/rules/` and are referenced from [CLAUDE.md](CLAUDE.md).

### Project agents for Claude Code and Codex

Each role has one shared definition in `.claude/agents/<name>.md`. Its Codex profile in `.codex/agents/<name>.toml` refers to that file and sets the model and reasoning effort. Both directories are versioned with Turbo EA.

| Agent | Responsibility | Claude Code definition | Claude model | Claude effort | Codex TOML profile | Codex model | Codex effort |
| --- | --- | --- | --- | --- | --- | --- | --- |
| backend-dev | Backend implementation and regression tests | [.claude/agents/backend-dev.md](.claude/agents/backend-dev.md) | sonnet | medium | [.codex/agents/backend-dev.toml](.codex/agents/backend-dev.toml) | gpt-6.1-terra | medium |
| frontend-dev | Frontend implementation and regression tests | [.claude/agents/frontend-dev.md](.claude/agents/frontend-dev.md) | sonnet | medium | [.codex/agents/frontend-dev.toml](.codex/agents/frontend-dev.toml) | gpt-6.1-terra | medium |
| translator | Nine non-English locales and translation parity checks | [.claude/agents/translator.md](.claude/agents/translator.md) | sonnet | medium | [.codex/agents/translator.toml](.codex/agents/translator.toml) | gpt-6-luna | medium |
| docs-keeper | Manual, screenshot references and screenshot capture | [.claude/agents/docs-keeper.md](.claude/agents/docs-keeper.md) | sonnet | medium | [.codex/agents/docs-keeper.toml](.codex/agents/docs-keeper.toml) | gpt-6.2-sol | medium |
| code-simplifier | Simplifies the changed code without changing behaviour, then re-runs the tests of the files it touched | [.claude/agents/code-simplifier.md](.claude/agents/code-simplifier.md) | opus | high | — | — | — |
| code-reviewer | Independent, read-only code review of the branch diff (ponytail-review, python-anti-patterns, project rules) | [.claude/agents/code-reviewer.md](.claude/agents/code-reviewer.md) | opus | high | — | — | — |
| security-reviewer | Independent, read-only security review of the branch diff (security-review, permission and CardReadScope rules) | [.claude/agents/security-reviewer.md](.claude/agents/security-reviewer.md) | opus | high | — | — | — |
| spec-plan-reviewer | Fresh, read-only review of each spec or plan before presentation | [.claude/agents/spec-plan-reviewer.md](.claude/agents/spec-plan-reviewer.md) | opus | medium | [.codex/agents/spec-plan-reviewer.toml](.codex/agents/spec-plan-reviewer.toml) | gpt-6.2-astra | high |
| vapt | Security assessment of the isolated test stack (Claude) and defensive review (Codex) | [.claude/agents/vapt.md](.claude/agents/vapt.md) | opus | high | [.codex/agents/vapt.toml](.codex/agents/vapt.toml) | gpt-6.2-astra | high |

After development, start `code-simplifier`, `code-reviewer` and `security-reviewer`, one after the other, each in a fresh context: tests, simplify, tests of the touched files, code review and its fixes, security review and its fixes. The `security-reviewer` run also satisfies the hook that blocks `gh pr create`. The calling session owns commits, pushes and pull requests. To change a role's duties for both tools, edit its shared definition. To change its Codex model or reasoning effort, edit its TOML profile.

#### Run a read-only spec or plan review in Codex

The `spec-plan-reviewer` inherits the calling turn's filesystem permissions. Its TOML declares `sandbox_mode = "read-only"`, but starting the agent from a `workspace-write` turn still gives it write access.

1. Before delegating, select read-only permissions in the calling session. To keep working in a writable development chat, open a separate PowerShell terminal at the Turbo EA project root and start a review session:

   ```powershell
   codex -s read-only
   ```

2. Ask Codex to start a fresh `spec-plan-reviewer` and give it the repository-relative path to the committed spec. For a plan, ask for a **new instance** and give it both the plan path and the corresponding spec path.
3. To verify the effective settings, inspect the child session's `turn_context` record. The verified values are `model = gpt-6.2-astra`, `effort = high` and `sandbox_policy.type = read-only`. A `workspace-write` value means the review must be relaunched from a read-only turn.

See the [spec and plan review rule](.claude/rules/spec-and-plan-review.md) for what each review must cover.

#### Run the Codex VAPT agent

The `vapt` profile reviews the diff and existing evidence from the isolated `turboea-vapt` stack (`http://localhost:8930`). Its output belongs in `../turbo-ea-vapt/reports/`. The child inherits the parent session's permissions. Use a dedicated parent with a read-only filesystem and one writable directory.

From the Turbo EA checkout in PowerShell, launch the Codex desktop runtime. The agent shell keeps its existing network restrictions.

```powershell
$codex = (Get-Command codex.exe -All | Where-Object Source -Like '*WindowsApps*' | Select-Object -First 1).Source
$reports = (Resolve-Path -LiteralPath '../turbo-ea-vapt/reports').Path
$vaptPermissions = @(
    '-a', 'never',
    '-c', "permissions.vapt_reports.extends=':read-only'",
    '-c', "permissions.vapt_reports.filesystem={'$reports'='write'}",
    '-c', 'permissions.vapt_reports.network.enabled=false',
    '-c', "default_permissions='vapt_reports'"
)
& $codex @vaptPermissions
```

Ask that session to start a fresh `vapt` by name. For a startup check, ask the child to reply `READY` without running any tools. In its `turn_context`, verify `gpt-6.2-astra`, `high`, and the resolved reports directory as the only writable filesystem entry. If the parent has broader permissions, start a session with the settings above before delegating.

---

## 7. Tools

### Graphify (code graph)

Builds a knowledge graph of the code (code only, no model calls). In the development process it is
step 11: git hooks rebuild it after every commit, checkout, merge and rebase, so there is nothing to run by
hand. `graphify-out/` stays untracked and is never referenced in a PR. Python package `graphifyy` (with two "y"), version 0.9.112, installed with **uv** as a
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

#### Git hooks that keep the graph current

The four Graphify hooks are versioned in [.githooks](.githooks). In a fresh clone with Graphify installed, select that directory for this repository:

```powershell
git config --local core.hooksPath .githooks
```

`post-commit`, `post-checkout`, `post-merge` and `post-rewrite` refresh the code graph. Existing installations using `graphify hook install` in `.git/hooks` can keep using them. Check for other hooks in that directory before switching, as Git reads hooks from a single directory.

The hooks run after a commit, so edits that are not committed yet are not in the graph. To include
them, run `graphify update .` in the repo.

#### Graphify search reminder for Claude Code and Codex

Both tools use the same [search reminder](.claude/hooks/graphify-search.cjs). For an exact string or
filename, continue the search. For callers, dependencies or the impact of a change, consult Graphify
first. The reminder allows the search to proceed.

The project registers this handler in [.claude/settings.json](.claude/settings.json) for Claude's `Grep` and `Glob` and in [.codex/hooks.json](.codex/hooks.json) for Codex shell commands. In Codex it matches direct `rg` and `grep` commands, including `rg --files`.

In Codex, open **Settings → Hooks** for Turbo EA and approve the `PreToolUse` entry that runs
`graphify-search.cjs`.

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

**Codex.** The committed [.codex/config.toml](.codex/config.toml) sets `TRAIL_INVOKED_AS` and `DO_NOT_TRACK`. The Windows hooks put the checkout's `node_modules/.bin` on their own PATH. Use `.\node_modules\.bin\trail.cmd` for direct shell commands. To make the bare command available when launching Codex from this PowerShell session, prepend the local bin directory before launching it:

```powershell
$env:PATH = "$trailBin;$env:PATH"
codex
```

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

Codex loads the Windows command hooks from the versioned [.codex/hooks.json](.codex/hooks.json). Open the project from its root so the commands resolve the shared hook and local executable. The file also registers the Graphify search reminder.

All nine Trail handlers use the same `.trail/hook.cjs`:

| Codex event | Matcher | Trail handler | Purpose |
| --- | --- | --- | --- |
| `SessionStart` | `startup\|resume\|clear\|compact\|fork` | `session-start` | Load context and standing notes at startup and when the session resumes or its context restarts. |
| `UserPromptSubmit` | All prompts | `prompt` | Retrieve notes and code pointers relevant to the request. |
| `PreToolUse` | `^apply_patch$` | `pre-edit` | Recall relevant notes before a patch. |
| `PreToolUse` | `^Bash$` | `pre-edit` | Recall notes for files named by a shell command, including PowerShell reads through `exec_command`. |
| `PreToolUse` | `^Bash$` | `pre-bash` | Apply Trail's command checks before execution. |
| `PostToolUse` | `^Bash$` | `codex-post-bash` | Read the exit status and record successful and failed commands correctly. |
| `PostToolUse` | `^apply_patch$` | `post-edit` | Mark the map as needing an update and recall notes not already shown. |
| `Stop` | Every completed turn | `stop` | Run end-of-turn bookkeeping and start a local background index update when an edit marked it dirty. |
| `SessionEnd` | All session endings | `session-end` | Call Trail's closing handler; its telemetry flush stays disabled by `DO_NOT_TRACK=1`. |

Codex exposes shell commands as `Bash` to its hooks even on Windows.
Unlike Claude, Codex reports failed commands through `PostToolUse`, so it
uses Trail's existing `codex-post-bash` handler instead of `post-bash-fail`.
The existing `pre-edit` handler also accepts shell commands and delivers
file notes before execution. This replaces the earlier `tool-savings`
entry: running both post-command handlers could record one result twice
and treat a failed command as successful. No custom script or change to
the shared hook is needed. Each command keeps `TRAIL_INVOKED_AS=trail`,
`DO_NOT_TRACK=1` and the local bin path.

Open **Settings → Hooks** for Turbo EA and approve the project commands you have reviewed. Codex may request approval again when a command changes.

Claude's project events and status-line command are in [.claude/settings.json](.claude/settings.json). Keep personal permissions and any machine-specific PATH in `.claude/settings.local.json`.

Both hosts call the same script. Matching event coverage does not make every
upstream behavior identical: some note-saving reminders and command warnings
in the installed Trail version are specific to Claude. No automatic note
creation is enabled by this configuration.

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
- In Claude and Codex, the edit hooks report that the map needs updating;
  the `Stop` hook can start a local structural update in the background at
  the end of a turn. This update makes no LLM calls. In Codex the edit event
  is `apply_patch`; changes made through other tools are still checked by
  the next Trail search.
- `SessionStart` loads the available context; it is not a full rebuild.

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
above also recall notes before shell commands and patches, and after patches,
that name a file listed in a note's `touches`. Repeated reads and the
pre/post pair do not repeat a note already shown in the session. Commands
that do not name a matching file do not receive file-related notes.

**Automatic note recall with the project settings above.** With
`TRAIL_INVOKED_AS=trail`, the startup hook can include the project's standing
notes (`standing: true`). Claude's configured file hooks also recall notes
relevant to a file read or edit. Codex receives file-related notes through
the file and command hooks above; the environment variable alone would not
register those events. `UserPromptSubmit` also retrieves notes relevant to
the message.

Verification covered the shared startup hook for both hosts and a real
file-related note through Claude's hook. Standing notes were tested on a
temporary copy because none of the project's current notes were marked
`standing: true`. Codex hooks were checked with simulated events on an
isolated copy: startup and resume variants return context, prompt and file
notes arrive, unrelated commands receive no file note, and repeated events
do not duplicate it. Successful and failed shell results are recorded once
with the correct status; output without a valid exit header is not recorded
as success. After a patch, `Stop` rebuilt the small copy's index locally;
`SessionEnd` completed within Codex's three-second limit without queued
telemetry. These are handler tests, not proof of automatic execution in an
approved live chat. The temporary copies were removed and no project notes
were changed.

#### Update

The package update is manual: repeat from the Turbo EA root
the install block with `@latest`, including turning telemetry off
and checking it. The npm package and the code index therefore have
separate updates. Before using the hooks of a new version,
check their effects on a copy of the project.
