# Third-Party Notices

Turbo EA as a whole is licensed under the Functional Source License 1.1 with MIT
Future License (FSL-1.1-MIT) — see [LICENSE](LICENSE).

The following third-party components are incorporated into Turbo EA. They retain
their **own** original licenses; the FSL relicensing of Turbo EA does **not** apply
to them. This file records those components and where they come from.

---

## SheetJS Community Edition (`xlsx`)

- **Component:** Excel/CSV import and export in the inventory. The `xlsx` library is
  vendored into the repository as a tarball.
- **Location:** `frontend/xlsx-0.20.3.tgz` (SheetJS Community Edition, v0.20.3).
- **Project:** [SheetJS](https://sheetjs.com/) — https://git.sheetjs.com/sheetjs/sheetjs
- **Original license:** Apache License 2.0

---

## draw.io / diagrams.net (jgraph)

- **Component:** The embedded diagram editor. The frontend Docker image clones and
  bundles draw.io at build time and serves it under `/drawio/`.
- **Version:** jgraph/drawio v26.0.9 — https://github.com/jgraph/drawio
- **Original license:** Apache License 2.0

---

*Bundled runtime dependencies installed from public package registries (npm, PyPI)
retain their own licenses as declared in `frontend/package-lock.json` and the Python
lockfiles; they are not redistributed as source in this repository and are not
enumerated here.*
