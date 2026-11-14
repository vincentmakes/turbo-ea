---
title: "Report exports draw chart canvases onto the capture themselves, because WebKit leaves them blank"
author: Claude
date: 2026-11-13
branch: claude/hopeful-meitner-zpu254
cost: { minutes: 65, tokens: 1170000 }
id: l-153f9333
scope: repo
status: active
src: agent
touches:
  - frontend/src/features/reports/reportExport.ts
  - frontend/src/features/reports/reportExport.test.ts
---

## Decided
A PowerPoint deck exported in Safari had every chart blank (Initiative Report, Cost Analysis, Data Quality). html-to-image clones each `<canvas>` as an `<img src=canvas.toDataURL()>` inside the SVG `foreignObject` it rasterises, and WebKit does not paint a nested image in an SVG-as-image on the first draw. The capture in `reportExport.ts` now leaves canvases out of the clone (`captureFilter`) and draws each visible live canvas onto the captured PNG itself (`compositeCanvases`), at its `getBoundingClientRect` offset from the node, scaled to the picture's real pixel size, in DOM order. It is one code path for every browser, so what is verified in Chromium is what runs in Safari. A node without a canvas keeps its PNG byte for byte; when there is no 2D context or the PNG cannot be decoded, the capture is kept as is rather than failing the export.

## Tried and ruled out
- Calling `toPng` several times until WebKit has painted the nested images (the usual workaround): not deterministic, slow, and costly in memory on iOS.

## Watch out
- How to tell which browser made a deck someone sends: PNGs from Apple's ImageIO encoder carry `sRGB` and `eXIf` chunks (and small IDAT chunks); Chromium's carry neither.
- A Chromium run cannot reproduce the WebKit symptom; Chromium paints nested images on the first draw. Test the compositing itself (unit tests on the drawn rectangles), not the absence of the bug.
- The text in that Safari deck was also in the system font, not Inter; not investigated.

In the code:
- frontend/src/features/reports/reportExport.ts (`renderPng`, `captureFilter`, `compositeCanvases`)
- frontend/src/features/reports/reportExport.test.ts ("chart canvases drawn onto the capture")
