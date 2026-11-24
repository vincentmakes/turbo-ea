---
title: Keep invoiced totals separate from recorded costs
author: Tom
date: 2026-11-23
branch: feat/pml-financials
id: l-96fdb531
scope: repo
status: active
src: agent
---

PML records invoice amounts without VAT so an initiative can track how much has been invoiced and how much remains. We dropped the separate invoice Provider and invoice-specific currency workflow because this is a tracker. Keep Financials Actual driven by recorded Cost Items, and show invoices and residuals separately so recording or moving an invoice cannot change booked costs.
