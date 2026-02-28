# End-of-Life (EOL) Management

The **EOL** administration page (**Admin > Settings > EOL**) helps you track technology product lifecycles by linking your cards to the public [endoflife.date](https://endoflife.date/) database.

## Why Track EOL?

Knowing when technology products reach end-of-life or end-of-support is critical for:

- **Risk management** — Unsupported software is a security liability
- **Budget planning** — Plan migrations and upgrades before support ends
- **Compliance** — Many regulations require supported software

## Mass Search

The mass search feature scans your **Application** and **IT Component** cards and automatically finds matching products in the endoflife.date database.

### Running a Mass Search

1. Navigate to **Admin > Settings > EOL**
2. Select the card type to scan (Application or IT Component)
3. Click **Search**
4. The system performs **fuzzy matching** against the endoflife.date product catalog

### Reviewing Results

For each card, the search returns:

- **Match score** (0–100%) — How closely the card name matches a known product
- **Product name** — The matched endoflife.date product
- **Available versions/cycles** — The product's release versions with their support dates

### Filtering Results

Use the filter controls to focus on:

- **All items** — Every card that was scanned
- **Unlinked only** — Cards not yet linked to an EOL product
- **Already linked** — Cards that already have an EOL link

A statistics summary shows: total cards scanned, already linked, unlinked, and matches found.

### Linking Cards to Products

1. Review the suggested match for each card
2. Select the correct **product version/cycle** from the dropdown
3. Click **Link** to save the association

Once linked, the card's detail page shows an **EOL section** with:

- **Product name and version**
- **Support status** — Color-coded: Supported (green), Approaching EOL (orange), End of Life (red)
- **Key dates** — Release date, active support end, security support end, EOL date

## EOL Report

Linked EOL data feeds into the [EOL Report](../guide/reports.md), which provides a dashboard view of your technology landscape's support status across all linked cards.
