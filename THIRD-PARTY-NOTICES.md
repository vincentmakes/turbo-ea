# Third-Party Notices

Turbo EA as a whole is licensed under the Functional Source License 1.1 with MIT
Future License (FSL-1.1-MIT) — see [LICENSE](LICENSE).

The following third-party components are incorporated into Turbo EA. They retain
their **own** original licenses; the FSL relicensing of Turbo EA does **not** apply
to them. This file records those components and where they come from.

---

## ArchLens (TurboLens analysis logic)

- **Component:** The TurboLens module's AI analysis logic (vendor analysis, duplicate
  detection, modernization assessment, and the Architecture AI wizard) is a Python
  port of [ArchLens](https://github.com/vinod-ea/archlens).
- **Source files:** `backend/app/services/turbolens_vendors.py`,
  `backend/app/services/turbolens_duplicates.py`,
  `backend/app/services/turbolens_architect.py` (ported from `ai.js`, `resolution.js`,
  and `architect.js` respectively).
- **Author:** [Vinod](https://github.com/vinod-ea)
- **Original license:** MIT

```
MIT License

Copyright (c) Vinod (https://github.com/vinod-ea/archlens)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

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
