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

## How It Works

1. Launches headless Chromium via Playwright
2. Logs in via `POST /api/v1/auth/login` and injects the JWT into `sessionStorage`
3. Resolves card UUIDs from demo data (e.g., "NexaCore ERP" → UUID)
4. For each locale: switches the user locale, then navigates through each page definition
5. Waits for selectors, executes actions (scroll, click, hover), then captures the screenshot
6. Saves to the appropriate output directory with the correct locale-specific filename
