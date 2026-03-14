# ArchLens AI Intelligence

The **ArchLens** module provides AI-powered analysis of your enterprise architecture landscape. It uses your configured AI provider to perform vendor analysis, duplicate detection, modernization assessment, and architecture recommendations.

!!! note
    ArchLens requires a commercial AI provider (Anthropic Claude, OpenAI, DeepSeek, or Google Gemini) configured in [AI Settings](../admin/ai.md). The module is automatically available when AI is configured.

!!! info "Credits"
    ArchLens is based on the open-source [ArchLens](https://github.com/vinod-ea/archlens) project by [Vinod](https://github.com/vinod-ea), released under the MIT License. The analysis logic has been ported from Node.js to Python and integrated natively into Turbo EA.

## Dashboard

The ArchLens dashboard provides an overview of your landscape analysis:

| Indicator | Description |
|-----------|-------------|
| **Total Cards** | Number of active cards in your portfolio |
| **Avg Quality** | Average data quality score across all cards |
| **Vendors** | Number of analyzed technology vendors |
| **Duplicate Clusters** | Number of identified duplicate groups |
| **Modernizations** | Number of modernization opportunities found |

The dashboard also shows cards grouped by type and highlights the top quality issues.

## Vendor Analysis

Vendor analysis uses AI to categorize your technology vendors into 45+ industry categories (e.g., CRM, ERP, Cloud Infrastructure, Security).

**How to use:**

1. Navigate to **ArchLens > Vendors**
2. Click **Run Analysis**
3. The AI processes your vendor portfolio in batches, categorizing each vendor with reasoning
4. Results show a category breakdown and a detailed vendor table

Each vendor entry includes the category, sub-category, number of associated applications, total annual cost, and the AI's reasoning for the categorization.

## Vendor Resolution

Vendor resolution builds a canonical vendor hierarchy by resolving aliases and identifying parent-child relationships.

**How to use:**

1. Navigate to **ArchLens > Resolution**
2. Click **Resolve Vendors**
3. The AI identifies vendor aliases (e.g., "MSFT" = "Microsoft"), parent companies, and product groupings
4. Results show the resolved hierarchy with confidence scores

## Duplicate Detection

Duplicate detection identifies functional overlaps in your portfolio — cards that serve the same or similar business purpose.

**How to use:**

1. Navigate to **ArchLens > Duplicates**
2. Click **Detect Duplicates**
3. The AI analyzes Application, IT Component, and Interface cards in batches
4. Results show clusters of potential duplicates with evidence and recommendations

For each cluster, you can:

- **Confirm** — Mark the duplicate as confirmed for follow-up
- **Investigate** — Flag for further investigation
- **Dismiss** — Dismiss if not a real duplicate

## Modernization Assessment

Modernization assessment evaluates cards for upgrade opportunities based on current technology trends.

**How to use:**

1. Navigate to **ArchLens > Duplicates** (Modernization section)
2. Select a target card type (Application, IT Component, or Interface)
3. Click **Assess Modernization**
4. Results show each card with modernization type, recommendation, effort level, and priority

## Architecture AI

The Architecture AI is a 3-phase conversational assistant that generates architecture recommendations based on your existing landscape.

**How to use:**

1. Navigate to **ArchLens > Architect**
2. **Phase 1** — Describe your business requirement (e.g., "We need a customer self-service portal"). The AI generates business clarification questions.
3. **Phase 2** — Answer the Phase 1 questions. The AI generates technical deep-dive questions.
4. **Phase 3** — Answer the Phase 2 questions. The AI generates a complete architecture recommendation including:

| Section | Description |
|---------|-------------|
| **Architecture Diagram** | Interactive Mermaid diagram with zoom, SVG download, and code copy |
| **Component Layers** | Organized by architecture layer with existing/new/recommended classification |
| **Gaps & Recommendations** | Capability gaps with market product recommendations ranked by fit |
| **Integrations** | Integration map showing data flows, protocols, and directions |
| **Risks & Next Steps** | Risk assessment with mitigations and prioritized implementation steps |

## Analysis History

All analysis runs are tracked in **ArchLens > History**, showing:

- Analysis type (vendor analysis, vendor resolution, duplicate detection, modernization, architect)
- Status (running, completed, failed)
- Start and completion timestamps
- Error messages (if any)

## Permissions

| Permission | Description |
|------------|-------------|
| `archlens.view` | View analysis results (granted to admin, bpm_admin, member) |
| `archlens.manage` | Trigger analyses (granted to admin) |
