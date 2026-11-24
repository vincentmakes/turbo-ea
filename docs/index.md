# Introduction to Turbo EA

### What is Turbo EA?

**Turbo EA** is a modern, self-hosted platform for **Enterprise Architecture Management**. It enables organizations to document, visualize, and manage all components of their business and technology architecture in one place.

### Who is this guide for?

This guide is for **everyone who uses Turbo EA** — enterprise architects, IT managers, business analysts, developers, and administrators. Whether you are evaluating the platform, managing your organization's IT landscape day-to-day, or configuring the system as an admin, you will find the information you need here. No advanced technical knowledge is required to get started.

### Key Benefits

- **Comprehensive visibility**: View all applications, processes, capabilities, and technologies across the organization in a single platform.
- **Informed decision-making**: Visual reports (portfolio, capability maps, dependencies, lifecycle, cost, and more) that facilitate evaluation of the current state of technology infrastructure.
- **Lifecycle management**: Track the status of every technology component through five phases — from planning through retirement.
- **Collaboration**: Multiple users can work simultaneously, with configurable roles, stakeholder assignments, comments, todos, and notifications.
- **AI-powered descriptions**: Generate card descriptions with a single click. Turbo EA combines web search with a local or commercial LLM to produce type-aware summaries — complete with confidence scores and source links. Runs entirely on your infrastructure for privacy, or connect to commercial providers (OpenAI, Google Gemini, Anthropic Claude, and more). Fully admin-controlled: choose which card types get AI suggestions, pick your search provider, and select the model.
- **Visual diagrams**: Create architecture diagrams with the embedded DrawIO editor, fully synchronized with your card inventory.
- **Business process modeling**: BPMN 2.0 process flow editor with element linking, approval workflows, and maturity assessments.
- **ServiceNow integration**: Bi-directional sync with ServiceNow CMDB to keep your EA landscape connected with IT operations data.
- **Multi-language**: Available in English, Spanish, French, German, Italian, Portuguese, and Chinese.

### Key Concepts

| Term | Meaning |
|------|---------|
| **Card** | The basic element of the platform. Represents any architecture component: an application, a process, a business capability, etc. |
| **Card Type** | The category a card belongs to (Application, Business Process, Organization, etc.) |
| **Relationship** | A connection between two cards that describes how they relate (e.g., "uses", "depends on", "is part of") |
| **Metamodel** | The structure that defines what card types exist, what fields they have, and how they relate to each other. Fully admin-configurable |
| **Lifecycle** | The temporal phases of a component: Plan, Phase In, Active, Phase Out, End of Life |
| **Inventory** | Searchable, filterable list of all cards across every type. Bulk edit, Excel/CSV import-export, and saved views with sharing |
| **Reports** | Pre-built visualizations: Portfolio, Capability Map, Lifecycle, Dependencies, Cost, Matrix, Data Quality, and End-of-Life |
| **BPM** | Business Process Management — model business processes with a BPMN 2.0 editor, link diagram elements to cards, and assess maturity, risk, and automation |
| **PML** | Project Master List — manage Initiative cards as full projects with status reports, Work Breakdown Structures, kanban + Gantt task boards, budgets, costs, and a per-initiative risk register |
| **TurboLens** | AI-powered EA intelligence — vendor analysis, duplicate detection, modernization assessment, the 5-step Architecture AI wizard, and compliance scans against EU AI Act / GDPR / NIS2 / DORA / SOC 2 / ISO 27001 |
| **EA Delivery** | The TOGAF-aligned delivery surface — Statements of Architecture Work, Architecture Decision Records, and the landscape-level Risk Register |
| **SoAW** | Statement of Architecture Work — a formal TOGAF document scoping an architecture initiative |
| **ADR** | Architecture Decision Record — captures a decision's context, alternatives, and consequences, with status workflow and card linking |
| **Risk Register** | Landscape-level TOGAF Phase G risk register, separate from initiative-level PML risks. Owner assignment auto-creates a Todo |
| **Web Portal** | Public, slug-based, read-only view of part of the EA landscape — shareable without a login |
| **MCP Server** | Read-only AI tool access via the Model Context Protocol — query EA data from Claude Desktop, Cursor, GitHub Copilot, and other MCP clients |
| **RBAC** | Role-Based Access Control — app-level roles plus per-card stakeholder roles with 50+ granular permissions |
