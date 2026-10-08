# Mutation testing

Line coverage says a test *ran* a line. Mutation testing says a test would
*notice the line being wrong*: the tool makes one small change at a time —
`<` to `<=`, a condition to `True`, a return value to `None` — and reruns the
tests that reach it. The mutant is **killed** when a test fails and
**survives** when every test still passes. A survivor is a change to the code
that nothing checks.

| Suite | Tool | Config |
|---|---|---|
| backend | [mutmut](https://github.com/boxed/mutmut) 3, pinned exactly | `[tool.mutmut]` in `backend/pyproject.toml` |
| MCP server | mutmut, same pin | `[tool.mutmut]` in `mcp-server/pyproject.toml` |
| frontend | [StrykerJS](https://stryker-mutator.io/) + `@stryker-mutator/vitest-runner` | `frontend/stryker.config.json` |

The rule this enforces is gate 3 of the Testing Conventions in `CLAUDE.md`.

## What runs where

**On every pull request** (`ci.yml`): `Backend Mutation Tests`,
`MCP Mutation Tests` and `Frontend Mutation Tests`, each when its suite
changed.

1. `changed_lines.py` lists the lines the PR adds or modifies (merge base vs.
   working tree; a pure deletion adds nothing to test).
2. The suite's tool mutates what those lines belong to:
   - mutmut: every top-level **function or method** the change touches
     (`mutmut_scope.py run --changed`). mutmut cannot scope below a function.
   - Stryker: the exact **line ranges** (`stryker_scope.py args`), because its
     `--mutate` accepts `file:first-last`.
3. The collector keeps the mutants that sit **on a changed line** and writes
   them as records (`mutmut_scope.py collect`, `stryker_scope.py collect`).
4. `gate.py --scope diff` scores them: killed / (killed + survived). It fails
   under the `[diff]` floor in `floors.toml`, once at least `min_mutants` are
   in scope; below that it warns and the PR's Test Plan answers for each
   survivor.

**Every working-day evening** (`mutation-nightly.yml`, Sunday to Thursday,
17:13 UTC; GitHub starts it several hours late, so the results land before the
next morning): the whole codebase, so the existing features are measured, not
just new lines.

- Every mutable file is dealt into shards (6 backend, 1 MCP, 8 frontend) and
  each shard caches its results: mutmut's `mutants/` directory, Stryker's
  incremental file. mutmut saves every verdict as it lands, so a shard that
  runs out of its `--budget` stops cleanly and the next night resumes from the
  functions still unchecked (see below). Once the baseline is complete, only
  functions that changed are re-tested, plus the survivors that a changed
  test runs.
  Stryker alone cannot resume, because it writes its incremental file only
  when a whole run completes. `stryker_scope.py nightly` therefore splits
  each frontend shard into stable chunks of files, each with its own
  incremental file and last report, runs them oldest first until the budget
  is spent, and lets a chunk cut off by the budget keep its previous report.
  A chunk whose last report was made from the same inputs is skipped (see
  below).
- The `report` job runs `gate.py --scope suite --allow-pending` per suite
  against the `[suite]` floor and each `[modules]` floor. A floor applies once
  everything it covers is measured; until then the summary shows baseline
  progress. It names files whose score fell since the previous night.
- It keeps one open issue, **Mutation survivors (nightly)**, with the current
  backlog: critical modules first, then by survivor count, per function.
- The PR jobs restore the nightly's mutmut cache. That is what spares them
  mutmut's stats pass, a **serial** run of the whole suite that maps each test
  to the functions it reaches (about an hour for the backend on a runner).

## Floors

`floors.toml` holds three kinds of floor, all integer percentages:

| Section | Measured on | Enforced by |
|---|---|---|
| `[diff]` | mutants on a PR's changed lines | the PR jobs |
| `[suite]` | every mutant of a suite | the nightly |
| `[modules]` | every mutant of one critical file | the nightly |

They only go up. A PR that raises a measured score raises its floor in the
same diff. Nothing ever lowers one, and the way past a floor is never to
exclude code from mutation.

A mutant that **no test reaches** counts as survived. It is the worst
finding, not an exemption.

## Running it locally

The Python suites need their dev dependencies (`pip install -e ".[dev]"`,
which brings the pinned mutmut). The backend also needs the test database:
`./scripts/test.sh` starts one, or point `POSTGRES_*` at any Postgres and set
`TEST_DB_REQUIRED=1` so a missing database fails instead of skipping.

```bash
make mutation-diff                                   # the PR gate, against origin/main
make mutation-diff BASE=origin/some-branch
make mutation-backend FILE=app/services/lifecycle.py # one module, every mutant
make mutation-mcp FILE=turbo_ea_mcp/oauth.py
make mutation-frontend FILE=src/lib/searchRank.ts
make mutation-clean
```

Then read the results:

```bash
cd backend && mutmut browse        # interactive: every mutant, its diff, re-test one
cd backend && mutmut show app.services.lifecycle.x_is_live_in_fiscal_year__mutmut_7
open frontend/reports/mutation/index.html
```

Never run `mutmut run` by hand; go through `mutmut_scope.py` (the make targets
do). It builds the shadow root (below) and passes the mutant-name patterns
that scope the run.

## Dealing with a survivor

In this order:

1. **Add the assertion it exposes.** The survivor's diff shows exactly which
   behaviour no test pins: a boundary (`<` vs `<=`), a branch nobody takes,
   a value nobody checks.
2. **Delete the code it proves dead**, when no behaviour depends on it.
3. **Suppress it with a reason**, only when the mutant is *equivalent*: it
   cannot change behaviour, so no test could ever kill it.

   ```python
   x = max(0, n)  # pragma: no mutate, equivalent: n is a count, never negative
   # pragma: no mutate block, generated lookup table, compared whole in test_x
   ```

   ```ts
   // Stryker disable next-line EqualityOperator: 0 and -0 render the same here
   ```

   The Python separator is a **comma**. mutmut splits its pragma on one, so
   `# pragma: no mutate block: why` silently degrades to a single-line pragma.
   Stryker takes the reason after a colon. Every suppression carries a reason
   of real words (`test_mutation_pragmas.py` checks), and the PR's Test Plan
   names it.

A PR that only adds tests to kill survivors from the nightly issue is a
complete PR on its own: no product change, no version bump. It raises the
touched module's floor in the same diff.

## Why it is built this way

Each of these was found the hard way while wiring it up; keep them.

- **The shadow root** (`shadow_root.py`). mutmut copies the source and the
  tests into `<suite>/mutants/` and runs them from there, so every test that
  finds a file with `Path(__file__).parents[N]` — workflow guards, migration
  tests, the extension loader's `VERSION` check — looks one directory too
  deep, and the stats pass (run with `-x`) stops at the first. The script
  makes `<suite>/mutants` a link to `.mutation/<suite>/<suite>/`, inside a
  per-suite mirror of the repository made of symlinks, so the parents line up
  again.
- **Source scans are left out.** Some guard tests read `app/` as text with
  `ast` or a regex. Under mutmut `app/` is its rewritten copy, so those scans
  fail, and they could never kill a runtime mutant anyway. Mark such a test
  module with `pytestmark = pytest.mark.source_scan` (or one test with the
  decorator) and `backend/tests/mutation_plugin.py` deselects it whenever
  mutmut runs pytest. A missed one stops the stats pass, which runs with
  `-x`, and the log names it. The plugin keys on `MUTANT_UNDER_TEST` being
  *set*: mutmut runs its clean test with it set to an empty string, and that
  clean test is the whole suite (see below).
- **Decorated functions are never mutated.** mutmut skips any function with
  a decorator other than a bare `@staticmethod` / `@classmethod`, which
  includes every FastAPI route handler. The PR job lists changed functions
  of that kind in its summary. Logic that should be held to a mutation score
  belongs in a plain function the handler calls, as the shared write paths
  already are (`card_write_service`, `adr_service`, `risk_service`).
- **Never scope with `only_mutate`.** It is not part of mutmut's config
  fingerprint, so changing it between runs keeps the old test-to-function
  stats, and every function newly in scope reads "no tests". Runs are scoped
  by mutant-name patterns instead, and every run generates every file.
- **Always pass patterns.** Without mutant names, mutmut's "clean test" step
  reruns the whole suite serially a second time.
- **A nightly shard names only the functions still unchecked.** mutmut keeps
  a verdict only for mutants it was *not* asked for by name: every mutant a
  pattern on its command line matches is re-tested, verdict or not. A shard
  that passed its files' patterns re-tested its whole baseline every night,
  fastest first, and once that took the whole budget, the unchecked mutants
  (the slow ones, last in mutmut's order) never came up: on 2026-10-07 the
  backend shards ran at over a mutant a second all night and the baseline
  stayed at 95%. `mutmut_scope.py run --shard` therefore runs mutmut once on
  a name that matches nothing, which regenerates the mutants, resets the
  verdicts of every function whose code changed, and stops before any test.
  It then reads the `.meta` file beside each mutated file and names only the
  functions that still have a mutant without a verdict, or, where only some
  of a function's mutants lack one, those mutants by name, so the killed
  ones are not re-run. A PR's changed functions and `--files` still name
  everything, because there a re-test is what was asked for. None of this
  shrinks mutmut's clean test: a function pattern never matches the name
  mutmut files that function's tests under, so it runs the whole suite.
- **A changed test reopens the survivors it runs.** mutmut keeps a verdict
  until its function's *code* changes; a new or edited test revisits
  nothing, so a tests-only PR's kills would never reach the nightly and its
  floors would fail against the old survivors. Between generating and
  naming, `reopen_survivors` resets every survived or untested mutant whose
  function a changed test module runs (by mutmut's own stats, which the
  generate step has just updated with any new tests). "Changed" is judged
  against `mutants/mutmut-tests-digest.json`, a hash per test module that
  each run leaves in the cached directory; the first run, with no digest
  yet, asks git what changed since the commit mutmut's stats were built at,
  fetching that commit into the shallow checkout, and treats every test
  module as changed if git cannot say.
- **`TEST_DB_REQUIRED=1`.** `backend/tests/conftest.py` skips every database
  test when Postgres is unreachable. Under mutmut that reads as "nothing kills
  anything" and still exits 0, so the mutation jobs turn the skip into a
  failure.
- **One schema per mutmut worker.** mutmut forks several pytest runs at once;
  `_worker_schema()` gives each its own Postgres schema, as it already did for
  pytest-xdist.
- **Stryker's Babel.** The instrumenter needs Babel 8, while the app's
  security override pins `@babel/core` to 7 everywhere. A nested override in
  `frontend/package.json` gives the instrumenter its own; without it,
  printing any TypeScript generic crashes Stryker.
- **Stryker runs Vitest in worker threads**, where `vi.stubEnv("TZ", …)` is
  silently ignored, so a suite that pins a timezone fails Stryker's initial
  run and aborts it. `frontend/vitest.stryker.config.ts` finds those suites
  by scanning for the stub and leaves them out of mutation runs only.
- **Static mutants are ignored** (`ignoreStatic`). A mutant in a module-level
  initialiser (`ROUTE_PERMISSIONS`, a lookup table, a constant) runs once at
  import, so Stryker cannot tell which tests cover it and reruns the whole
  suite for each one. On nine `lib/` files, 236 of them took an estimated
  95% of the run, about 19 hours. That is enough to keep a nightly chunk from
  ever finishing, and to time out a PR that edits one table. They are reported
  `Ignored`, and the gate counts `Ignored` as excluded. Tables like these are
  covered by the guard tests that pin them instead (`routePermissions.test.ts`
  reads `App.tsx` and the backend registry off disk).
- **Frontend source scans skip inside Stryker's sandbox.** Some Vitest
  suites read `src/` as text: the route tables parsed out of `App.tsx`, every
  literal `t()` key, the per-field label pins. In the sandbox the files being
  mutated are instrumented copies, so such a scan reads mutant switches and
  fails Stryker's initial run. Then the whole chunk is lost; the `t()` scan
  did that to the chunk holding `src/i18n/index.ts`. Wrap such a test in
  `describeSourceScan` / `itSourceScan` from `src/test/sourceScan.ts`; they
  skip under the `MUTATION_SANDBOX` flag that `vitest.stryker.config.ts` sets.
  `test_ci_workflow_mutation.py` fails any test that reads files off disk
  without them, unless it is allowlisted there with a reason.
- **An unchanged frontend chunk is skipped.** Stryker pays a full dry run,
  several minutes, for every chunk, even when it reuses every result. Each
  chunk therefore records `inputs_digest` (every file under `src/`, the
  lockfile and the Stryker, Vitest and TypeScript configs) next to its report,
  and `stryker_scope.py nightly` skips a chunk whose recorded digest matches.
  A night with no frontend change costs minutes, and the second half of the
  budget re-runs only the chunks the first half failed or did not reach. The
  digest covers all of `src/`, not just the chunk's files and the tests,
  because a mutant's tests also run every module the file imports.
- **A lost runner loses half a night, not all of it.** GitHub sometimes takes
  a runner away mid-job ("The runner has received a shutdown signal"). A job
  in that state runs no later step, not even an `always()` one, so the
  shard's cache and records would never be saved. The nightly therefore splits
  each backend and frontend shard's budget into two halves. Between them a
  checkpoint saves the cache under `…-<run id>-checkpoint` and uploads the
  records (`overwrite: true`). Each half costs one more mutmut clean test,
  about 20 minutes, which is why there are two halves and not more.
- **mutmut's children are memory-capped.** The nightly runs mutmut under
  `ulimit -v` (`MUTMUT_VMEM_KB`). A mutant that allocates without bound then
  dies of `MemoryError`, which counts as killed, instead of starving the runner
  until GitHub shuts it down. Stryker gets no such cap, because V8 reserves
  more address space than any sensible limit.
- **Stryker's dry run** runs every test related to the mutated files, which
  for a shared `lib/` helper is a large part of the suite, so
  `dryRunTimeoutMinutes` is raised from its default of 5.
- **mutmut is pinned exactly** because `mutmut_scope.py` reads its `results`
  and `show` output. To bump it: change both pins, run
  `backend/tests/core/test_mutation_scripts.py`, then
  `make mutation-backend FILE=app/services/lifecycle.py` and check that
  `collect` still places every mutant on a source line.

## Files

| File | Role |
|---|---|
| `changed_lines.py` | lines a change adds or modifies, per file |
| `mutmut_scope.py` | runs mutmut (PR, shard, files) and turns its results into records |
| `stryker_scope.py` | `--mutate` value for a change; the chunked, resumable nightly; Stryker reports to records |
| `gate.py` | the one scorer: floors, summaries, survivor backlog, regressions |
| `shadow_root.py` | the symlinked mirror mutmut's copy runs inside |
| `floors.toml` | every floor |

Tests: `backend/tests/core/test_mutation_scripts.py` (the scripts),
`backend/tests/core/test_conftest_mutation.py` (per-process schemas, `TEST_DB_REQUIRED`, `source_scan`),
`backend/tests/services/test_ci_workflow_mutation.py` (the workflows),
`backend/tests/services/test_mutation_pragmas.py` (suppression reasons).
