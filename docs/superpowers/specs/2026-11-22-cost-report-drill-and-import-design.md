# Cost Report navigation, card badges and Excel import

The Cost Report at `/reports/cost` should stay navigable across Treemap, Sankey and Table, including fullscreen. Cost editors should be able to download an Excel template tied to the configured Cost Items catalogue, preview an import, and update only the cost items named in the workbook. The existing fiscal-year, currency, reporting and TCO rules remain the source of truth.

## Approaches

- Extend the existing Cost Report and reuse the Licensing badge, the existing card picker and fullscreen panel, and the Licensing import interaction. Use the cost catalogue and the existing cost writer for the data model and permissions. This fits the approved workflow and gives all three views the same scope and navigation.
- A separate import page or a static workbook would split the workflow or require people to maintain their own copy of the catalogue. Rebuilding the workbook on every click would repeat work for an unchanged catalogue.

## Card scope and navigation

- Keep **All Cards** available when Application, IT Component, or both type buttons are selected. The picker offers exactly the selected readable types. Each selected root includes its descendants within those types. A mixed selection is the union of its roots and descendants. The selection filters Treemap, Sankey, Table and the related summaries and trend. Without an applicable selection, **All Cards** means every eligible card of the selected types.
- Scope search and hierarchy resolution use the report's module read permissions. Include the full readable hierarchy for the active types, including zero-cost ancestors and intermediate cards. A role that can use the report can scope it without an inventory grant. A hierarchy that is loading or failed to load must not turn a selected scope into all cards.
- Changing type buttons applies only the selected roots for the displayed types. Roots from a temporarily disabled type can be recalled when it is enabled again. Save and restore roots for the types active in the saved report, and keep existing saved reports readable. The scope count reflects the selections currently applied. Clearing the scope affects the displayed types. Resetting the report clears the remembered roots for both.
- Treemap and Sankey retain their existing card and group drill actions. Put the breadcrumb inside the fullscreen surface so it can navigate from a card to its group or back to the report. Keep the same fullscreen surface mounted while a right-click drill loads the card's cost breakdown. Keep card opening and chart tooltips usable in fullscreen.
- Table uses the same fullscreen control. It keeps its breadcrumb and sticky column headers visible, and scrolls inside the panel. Sort, grouping and the selected scope survive entering and leaving fullscreen.

## Card identity

- Reuse the Licensing card badge: the card logo with a small card-type glyph. When the logo is unavailable, show the type glyph as the fallback. In Table, the first column is badge followed by card name, then the existing data columns. Group rows and totals keep their existing labels.
- In Treemap and Sankey, use the same card identity for card tiles and nodes in both display modes. When a card tile or node is too small to carry a badge, put the badge in its tooltip. Keep the card type identifiable, including in the tooltip. Groups and individual cost-item nodes retain their existing visual identity. Carry logo metadata only for cards already visible in the report response and reuse the existing card logo endpoint.

## Excel template

The Cost Report import dialog offers **Download Excel template** before upload. The `.xlsx` is a blank reusable workbook with one input sheet and a Cost Items reference sheet. A row targets one existing Application or IT Component, one fiscal year, and one catalogue cost item.

| Column | Required | Meaning |
| --- | --- | --- |
| Card ID | Yes | The existing card's UUID. The instructions show where to find it. |
| Fiscal Year | Yes | An integer in the workspace's existing cost-edit window. |
| Cost Item | Yes | The stable catalogue key. The reference sheet shows the configured active item keys and labels in catalogue order. |
| Amount | Yes | A non-negative amount in the workspace currency, including zero. |
| Renewal Date | No | A date. An empty cell or absent column writes no renewal date for the imported item, including when it previously had one. |

The template contains the configured Cost Items catalogue, which is shared by Applications and IT Components today. It does not include card records, amounts, or user-specific information. Keep the input headers stable for upload and use the catalogue reference to guide data entry.

### Refresh after a catalogue edit

- Build and reuse an XLSX artifact for the current catalogue revision. Rebuild it when a successful save in **Admin → Metamodel → Cost Items** changes the configuration. Creation, rename, translation changes, reorder, archive and restore all count. Opening the admin screen, cancelling an edit and saving an identical configuration do not cause a rebuild.
- Tie the revision to the persisted catalogue contents, so downloads from another worker and changes applied through another supported catalogue writer also converge on the current template. Each worker may build once for a previously unseen revision. Simultaneous requests for that revision share the build. A first request after an empty cache can build it; repeated downloads at the same revision reuse the bytes.
- Each download uses the persisted catalogue snapshot it reads at the start. After a save commits, a download that starts subsequently uses the new revision. An older build finishing later cannot replace the artifact used for the new revision. Publish only a complete artifact for its revision. If building fails, retain the successful catalogue change and allow a later download to retry. Release the database session before constructing the workbook. Authorize template download through the Cost Report and authorize writes for each imported card separately.

## Preview and apply

1. The report opens the import dialog through an Excel import icon. It accepts `.xlsx` under the existing upload limits. The server parses the first sheet with the expected headers and validates each row against the live catalogue, fiscal-year window and the existing `CostItemWrite` constraints for amounts and dates. Preview shows how many rows can apply and why individual rows would be skipped. A malformed workbook is a file error. Preview writes nothing.
2. Match cards by UUID. Include readable active and archived Applications and IT Components when the user can edit their costs, without reactivating archived cards or adding them to report totals. Access to the report requires `costs.view`. The import also checks existing per-card cost edit authorization, including an eligible stakeholder on a card. A hidden card is indistinguishable from a missing one. Never expose details from a card the caller cannot read. An archived catalogue key can update a line already present in the target year's resolved costs, including through current-year inheritance, and cannot create a new line.
3. Duplicate rows targeting the same card, year and cost item are all skipped for that key. Other valid rows can still apply. Revalidate against the same rules at confirmation and show the actual applied and skipped results, including changes since preview. Show applied counts even if some rows were skipped.
4. Write only the supplied items. A missing renewal date clears the date on that item. Process each card's years in chronological order, regardless of worksheet order. If the current year still inherits its costs, resolve its fallback from the history including valid changes to earlier years in the same workbook. Preview and Apply use that same ordering and inheritance rule. Other items retain the existing shared writer behavior, including materializing inherited lines when the current year first gets its own row. Use the shared writer for year-row locking, derived TCO and cost events. Apply validated rows in one transaction. A write failure after validation rolls back the batch and reports zero applied rows. A repeated application cannot create duplicate cost items. Refresh report data after a successful import without resetting view, scope or year filters.

## Agent's calls

- Use stable IDs and catalogue keys instead of matching by display names. A workbook saved before a catalogue edit can still be imported if its rows validate against the current catalogue.
- The reference sheet lists active items for new entries. The server decides whether an archived key can update a pre-existing line through the normal cost rules.
- An absent optional column and a blank renewal cell mean the same thing. The preview explains the effect on already dated items.
- Preserve a temporarily hidden type's selection during the current report session. Keep saved report compatibility and show only applicable selections in the active filter.
- Apply a card's changes from the oldest year to the newest so the user's row order has no effect on cost inheritance.
- Reuse the existing chart, table and logo components. Test the real browser fullscreen interaction as well as the component behavior, especially right-click drill and the loading state.

## Acceptance

- A mixed picker offers both readable types. Select one card of each type, verify scope and totals in all three views, toggle a type off and back on, and save and restore the mixed report. A user with only one readable type cannot pick cards from the other. Cover a report user without inventory access, zero-cost ancestors, a root beyond the first hierarchy page, and a hierarchy load failure while a scope is set.
- A visible logo and the no-logo fallback appear in Table, Treemap and Sankey. Card tooltips display the badge for small nodes. Table's badge and name share its first column. Fullscreen breadcrumbs navigate during and after a treemap drill without exiting fullscreen. Verify tooltips, opening and closing the card side panel, and Table fullscreen, scroll and exit in a browser.
- Read the generated XLSX and verify headers, current catalogue data and stable keys. Verify repeated downloads reuse the artifact. Change the catalogue and verify the next revision is reflected in the workbook, including archive and restore. Verify download authorization, a failed build followed by a retry, and old and new builds finishing out of order.
- API regression cases cover preview without writes, mixed valid and invalid rows, duplicate keys, amount and date bounds, wrong fiscal years, optional dates clearing old dates, unauthorized or hidden cards, permitted archived cards, unchanged unlisted items and revalidation at confirmation. Reversing worksheet rows must produce identical results for a workbook touching an inherited current year and a historical one. Verify that write failures roll back valid rows, permitted writes update report totals where the card is eligible to appear, and replay keeps one cost line per card, fiscal year and item. Update the OpenAPI contract and the user manual with the feature.

The combined scope behavior supersedes the hidden picker described in [the earlier Cost Report refinements](2026-11-13-cost-report-refinements-design.md). The other report and cost storage behavior follows [the cost items design](2026-11-03-card-cost-items-design.md).
