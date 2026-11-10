---
title: "Multi-hop relation queries are a server-evaluated condition stored on a saved view and authored through MCP, not a report designer; no MIT package covers the c…"
author: Claude
date: 2026-11-09
branch: claude/confident-curie-tyo9qq
cost: { minutes: 1, tokens: 3425 }
id: l-c68f48c9
scope: repo
status: active
src: agent
touches:
  - backend/app/services/portal_card_filters.py
  - backend/app/api/v1/reports.py
  - backend/app/services/dashboard_query.py
  - backend/app/api/v1/bookmarks.py
  - mcp-server/turbo_ea_mcp/server.py
---

## Decided
- Analysis of discussion #1366 (chained multi-hop relation queries with a filter at each hop, a path table, a subgraph view, saved as a report). Agreed direction with the owner: skip the designer UI. Store a small condition grammar on a saved view (keys only, never ids, as the dashboards query does), compile it server-side to nested EXISTS clauses, and author it through two MCP tools (an ad hoc query tool and a save-view tool whose dry run returns the count and a sample before the view exists). One evaluator feeds the cards list, the counts endpoint and the OData feed.
- Semantics are decided once in the service, not per surface: any-vs-all at a hop, direction on self-referencing types, whether a parent's relation counts for children, whether archived cards break a chain. Depth capped at three hops. A hidden card in the middle of a chain breaks it for that reader, the rule the dependencies BFS already follows.
- The path table and the subgraph view from the mockup stay out of scope; the result is the set of start cards shown in the inventory.

## Tried and ruled out
- A visual query builder page: the owner only invests in features that reuse a well-maintained MIT component, and none exists for the path/chain part. react-querybuilder (MIT, active) is a boolean condition tree, fit about 30%, and would duplicate the existing filter facets. react-awesome-query-builder's MUI package has had no stable release since 2024. AG Grid Advanced Filter is Enterprise and only filters loaded rows. Popoto and Vaquita are GPL and Neo4j-bound.
- Apache AGE / Cypher in Postgres: changes the DB image, unsupported on several managed offerings, bypasses the ORM and CardReadScope, and two to four hops are plain joins anyway.
- Answering with the MCP server's existing read tools: they hop card by card (N calls), so the answer is not reproducible, not shareable, not a widget.
- A dashboards KPI that counts a saved view: would store a bookmark id in a widget config, breaking on workspace transfer; let the dashboards query accept the same nested condition inline instead.

## Watch out
- The real gap is not the hop count but the filter shape: every relation filter in the product was designed around picking specific related cards (by name in the inventory, by id in reports and portals), so a condition on the far card's attributes has nowhere to live. Earlier discussions #673, #813, #883, #1131 and #1305 are all that one-hop case, which is why the condition grammar must cover one hop well before it chains.
- The bookmark OData feed evaluates only the filters it can express in SQL on the card row itself (types, status, search, approval, subtype, data quality) and skips the relation, attribute and tag facets, because those were browser-side facets with no server twin. A server-side condition grammar is the chance to give the feed the same evaluator.
- The inventory rebuilds the Filters object key by key when restoring a saved view, so a new filters key must be carried through restore, save-as, prefs and deep links or the first manual re-save strips it.
- The grid shows the start cards; its relation column still lists every related card, not only those matching the hop condition, and far-end attributes are not columns.

In the code:
- Server-side one-hop EXISTS to seed the compiler: `backend/app/services/portal_card_filters.py` (`_related`, `relation_condition`, `attribute_condition`).
- Read-scope-per-hop precedent: `GET /reports/dependencies` in `backend/app/api/v1/reports.py`.
- Keys-not-ids validation precedent: `DashboardQuery` / `resolve_query` in `backend/app/services/dashboard_query.py`.
- Feed to fix alongside: `bookmark_odata_feed` in `backend/app/api/v1/bookmarks.py`.
- Saved-view restore: `InventoryPage.tsx` around the `saved.filters.*` block; `Filters` in `InventoryFilterSidebar.tsx`.
- Where the MCP read tools wrap the cards, relations and dependencies endpoints: `mcp-server/turbo_ea_mcp/server.py`.
