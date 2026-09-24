# Screenshot Capture Automation

Automated screenshot capture for Turbo EA documentation and marketing site using [Playwright](https://playwright.dev/).

## Prerequisites

1. **Turbo EA running** with demo data:
   ```bash
   SEED_DEMO=true docker compose up --build -d
   ```

2. **Install dependencies** (one-time):
   ```bash
   cd scripts/screenshots
   npm install
   npm run install-browsers
   ```

### Screenshot 27 needs an AI provider

`27_ai_suggest_panel` clicks the sparkle button on a card, which the app only
renders once `GET /ai/status` reports **both** `enabled` and `configured` —
i.e. the workspace has an AI provider URL *and* a model set. Without one the
click is a silent `WARNING` and the capture falls through to plain card
detail, which is how that file once shipped byte-identical to
`04_card_detail.png`. Configure a provider on the capture instance before a
full run, and check the captured file actually differs from `04`. The entry
waits up to two minutes for the answer, so a small local model on CPU
(e.g. Ollama with `gemma3:1b`) is enough.

### The diagram shots need DrawIO

`99_diagram_editor`, `99a_diagram_sync_drawer` and `99b_diagram_viewer_legend`
open the DrawIO editor, which the app loads same-origin from `/drawio/`. The
Docker images serve it; the Vite dev server does not. Without Docker, build the
frontend, copy DrawIO's `src/main/webapp` (the tag the root `Dockerfile` clones)
into `frontend/dist/drawio/` together with `frontend/drawio-config/*.js`, and
capture against `npx vite preview`, which proxies `/api` like the dev server.

`99b` saves a colour view onto the demo diagram — view mode only has a legend
to show once one is saved — so it writes to the database. Run it once before a
full refresh, so `16_diagrams` and the other diagram shots show the same saved
state in every locale:

```bash
npx tsx capture.ts --locale en --only 99b
```

### Capturing from a sandbox

`PLAYWRIGHT_EXECUTABLE_PATH` points Playwright at an already-installed Chromium
whose revision differs from the npm package's. `SCREENSHOT_BROWSER_ARGS` passes
extra Chromium flags — needed where the only way out is an HTTP proxy, because
the Inter and Material Symbols webfonts come from Google Fonts and without them
every icon renders as its ligature name:

```bash
PLAYWRIGHT_EXECUTABLE_PATH=/opt/pw-browsers/chromium \
SCREENSHOT_BROWSER_ARGS="--proxy-server=$HTTPS_PROXY --ignore-certificate-errors-spki-list=<proxy CA SPKI hash>" \
npx tsx capture.ts --base-url http://127.0.0.1:4173 --locale en
```

Chromium never sends loopback traffic through a proxy, so the app itself is
still reached directly. Compare the first capture with the committed image
before starting a full run.

## Usage

```bash
cd scripts/screenshots

# Capture all doc screenshots (all 10 locales)
npm run capture

# Single locale (--locale takes ONE code, not a list)
npm run capture:en
npm run capture:es
npx tsx capture.ts --locale da

# One locale at a time — preferred for a full refresh, because a navigation
# timeout is fatal to the whole run, so this limits the blast radius to one locale
for L in en de fr es it pt zh ru da ar; do npx tsx capture.ts --locale "$L"; done

# Marketing site screenshots
npm run capture:marketing

# Both docs and marketing
npx tsx capture.ts --all

# Only specific screenshots (by ID prefix)
npx tsx capture.ts --only 01,03,10

# Preview what would be captured
npx tsx capture.ts --dry-run

# Custom app URL
npx tsx capture.ts --base-url http://localhost:5173
```

## Configuration

| Option | Env Var | Default | Description |
|--------|---------|---------|-------------|
| `--base-url` | `BASE_URL` | `http://localhost:8920` | Running app URL |
| `--email` | `SCREENSHOT_EMAIL` | `admin@turboea.demo` | Login email |
| `--password` | `SCREENSHOT_PASSWORD` | `TurboEA!2025` | Login password |
| `--locale` | — | all 10 | Single locale to capture (repeat the command per locale) |
| — | `PLAYWRIGHT_EXECUTABLE_PATH` | Playwright's own | Chromium binary to launch instead of the downloaded one |
| — | `SCREENSHOT_BROWSER_ARGS` | *(none)* | Extra Chromium flags, space-separated (e.g. a proxy) |

The credentials above are the demo admin created by the backend seeder when
`SEED_DEMO`/`SEED_BPM`/`SEED_PPM` is set and no admin exists yet — the same pair
published in the root `README.md`.

## Output Locations

| Mode | Output Directory | Naming |
|------|------------------|--------|
| Docs | `docs/assets/img/{locale}/` | `NN_description.png` (locale-specific names) |
| Marketing | `marketing-site/assets/screenshots/` | `kebab-case.png` |

## Adding a New Screenshot

1. Add an entry to `pages.ts` in either `DOC_PAGES` or `MARKETING_PAGES`
2. Provide `route`, `waitFor` selector, optional `actions`, and per-locale `filenames`
3. Run `npx tsx capture.ts --only <id>` to test it
4. Reference the image from the matching doc page in all 10 locale files

Routes can carry ids looked up in the demo data at run time:
`{{cardId:<key>}}` (`CARD_LOOKUPS`), `{{draftId:<key>}}` (a draft flow version
of that process), `{{diagramId:<key>}}` (`DIAGRAM_LOOKUPS`, by exact name) and
`{{riskId:<key>}}` (`RISK_LOOKUPS`, by reference). Besides `click`, `scroll`,
`hover`, `type` and `wait`, an action can be `waitFor` — wait for a selector,
with its own timeout, for state that takes an unpredictable time to appear —
and a `scroll` can take `align: "start"` to put its target just under the app
bar instead of wherever the browser centres it.

## How It Works

1. Launches headless Chromium via Playwright
2. Logs in via `POST /api/v1/auth/login`, which sets the httpOnly auth cookie on the browser context
3. Resolves card UUIDs from demo data (e.g., "SAP S/4HANA" → UUID)
4. For each locale: switches the user locale — via `PATCH /users/{id}` *and* the
   `turboea-locale` localStorage key the SPA's detector actually reads (see
   `detection.lookupLocalStorage` in `frontend/src/i18n/index.ts`; writing
   i18next's default `i18nextLng` is inert, and getting this wrong makes the
   login page — the one screen with no signed-in user — render in English for
   every locale) — then navigates through each page definition
5. Waits for selectors, executes actions (scroll, click, hover), then captures the screenshot
6. Saves to the appropriate output directory with the correct locale-specific filename
