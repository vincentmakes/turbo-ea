# Glossary of Terms

| Term | Definition |
|------|------------|
| **ADR (Architecture Decision Record)** | A formal document that captures an important architecture decision, including the context, decision rationale, consequences, and alternatives considered. ADRs support a sign-off workflow and revision chain |
| **Approval Status** | The review state of a card: Draft, Approved, Broken, or Rejected. Approved cards change to Broken when edited |
| **Bookmark / Saved View** | A saved filter, column, and sort configuration in the Inventory that can be reloaded with one click |
| **BPM** | Business Process Management — the discipline of modeling, analyzing, and improving business processes |
| **BPMN** | Business Process Model and Notation — the standard notation for modeling business processes (version 2.0) |
| **Business Capability** | What an organization can do, regardless of how it does it |
| **Calculation** | An admin-defined formula that automatically computes a field value when a card is saved |
| **Card** | The basic unit of information in Turbo EA representing any architecture component |
| **Card Type** | The category a card belongs to (e.g., Application, Business Process, Organization) |
| **Confidence Score** | A 0–100% rating indicating how reliable an AI-generated description is |
| **Data Quality** | A 0–100% completeness score based on filled fields and their configured weights |
| **Diagram** | A visual architecture diagram created with the embedded DrawIO editor |
| **File Attachment** | A binary file (PDF, DOCX, XLSX, images, up to 10 MB) uploaded directly to a card via the Resources tab |
| **DrawIO** | The embedded open-source diagramming tool used for visual architecture diagrams |
| **Enterprise Architecture (EA)** | The discipline that organizes and documents an organization's business and technology structure |
| **EOL (End of Life)** | The date when a technology product loses vendor support. Tracked via integration with endoflife.date |
| **Initiative** | A project or program involving changes to the architecture |
| **Lifecycle** | The five phases a component goes through: Plan, Phase In, Active, Phase Out, End of Life |
| **LLM** | Large Language Model — an AI model that generates text (e.g., Ollama, OpenAI, Anthropic Claude, Google Gemini) |
| **MCP** | Model Context Protocol — an open standard that lets AI tools (Claude, Copilot, Cursor) connect to external data sources. Turbo EA's built-in MCP server provides read-only access to EA data with per-user RBAC |
| **Metamodel** | The data-driven model that defines the platform's structure: card types, fields, relations, and roles |
| **Notification** | An in-app or email alert triggered by system events (todo assigned, card updated, comment added, etc.) |
| **Ollama** | An open-source tool for running LLMs locally on your own hardware |
| **Portfolio** | A collection of applications or technologies managed as a group |
| **Reference Number** | An auto-generated sequential identifier for ADRs (e.g., ADR-001, ADR-002) that provides a unique, human-readable label |
| **Relation** | A connection between two cards that describes how they relate (e.g., "uses", "depends on", "runs on") |
| **Resources Tab** | A card detail tab that consolidates Architecture Decision Records, file attachments, and document links in one place |
| **Saved Report** | A persisted report configuration with filters, axes, and visualization settings that can be reloaded |
| **Revision (ADR)** | A new version of a signed ADR that inherits the content and card links from the previous version, with an incremented revision number |
| **Section** | A groupable area of the card detail page containing related fields, configurable per card type |
| **Signatory** | A user designated to review and sign off on an ADR or SoAW document. The signing workflow tracks pending and completed signatures |
| **SoAW** | Statement of Architecture Work — a formal TOGAF document defining scope and deliverables for an initiative |
| **SSO** | Single Sign-On — login using corporate credentials via an identity provider (Microsoft, Google, Okta, OIDC) |
| **Stakeholder** | A person with a specific role on a card (e.g., Application Owner, Technical Owner) |
| **Survey** | A data-maintenance questionnaire targeting specific card types to collect information from stakeholders |
| **Tag / Tag Group** | A classification label organized into groups with single-select or multi-select modes |
| **TOGAF** | The Open Group Architecture Framework — a widely used EA methodology. Turbo EA's SoAW feature aligns with TOGAF |
| **Web Portal** | A public, read-only view of selected cards accessible without authentication via a unique URL |
| **AI Suggestion** | An auto-generated card description produced by combining web search results with a Large Language Model (LLM) |
