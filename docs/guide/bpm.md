# Business Process Management (BPM)

The **BPM** module allows documenting, modeling, and analyzing the organization's **business processes**. It combines visual BPMN 2.0 diagrams with maturity assessments and reporting.

!!! note
    The BPM module can be enabled or disabled by an administrator in [Settings](../admin/settings.md). When disabled, BPM navigation and features are hidden.

## Process Navigator

![Business Process Navigator](../assets/img/en/14_bpm_navigator.png)

The **Process Navigator** organizes processes into three main categories:

- **Management Processes** — Planning, governance, and control
- **Core Business Processes** — Primary value-creating activities
- **Support Processes** — Activities that support core business operations

**Filters:** Type, Maturity (Initial / Defined / Managed / Optimized), Automation level, Risk (Low / Medium / High / Critical), Depth (L1 / L2 / L3).

## BPM Dashboard

![BPM Dashboard with Statistics](../assets/img/en/15_bpm_dashboard.png)

The **BPM Dashboard** provides an executive view of process status:

| Indicator | Description |
|-----------|-------------|
| **Total Processes** | Total number of documented business processes |
| **Diagram Coverage** | Percentage of processes with an associated BPMN diagram |
| **High Risk** | Number of processes with high risk level |
| **Critical Risk** | Number of processes with critical risk level |

Charts show distribution by process type, maturity level, and automation level. A **top risk processes** table helps prioritize investments.

## Process Flow Editor

Each Business Process card can have a **BPMN 2.0 process flow diagram**. The editor uses [bpmn-js](https://bpmn.io/) and provides:

- **Visual modeling** — Drag and drop BPMN elements: tasks, events, gateways, lanes, and sub-processes
- **Starter templates** — Choose from 6 pre-built BPMN templates for common process patterns (or start from a blank canvas)
- **Element extraction** — When you save a diagram, the system automatically extracts all tasks, events, gateways, and lanes for analysis

### Element Linking

BPMN elements can be **linked to EA cards**. For example, link a task in your process diagram to the Application that supports it. This creates a traceable connection between your process model and your architecture landscape:

- Select any task, event, or gateway in the BPMN diagram
- The **Element Linker** panel shows matching cards (Application, Data Object, IT Component)
- Link the element to a card — the connection is stored and visible in both the process flow and the card's relations

### Approval Workflow

Process flow diagrams follow a version-controlled approval workflow:

| Status | Description |
|--------|-------------|
| **Draft** | Being edited, not yet submitted for review |
| **Pending** | Submitted for approval, awaiting review |
| **Published** | Approved and visible as the current version |
| **Archived** | Previously published version, kept for history |

Submitting a draft creates a version snapshot. Approvers can approve (publish) or reject (with comments) the submission.

## Process Assessments

Business Process cards support **assessments** that score the process on:

- **Efficiency** — How well the process uses resources
- **Effectiveness** — How well the process achieves its goals
- **Compliance** — How well the process meets regulatory requirements

Assessment data feeds into the BPM Reports.

## BPM Reports

Three specialized reports are available from the BPM Dashboard:

- **Maturity Report** — Distribution of processes by maturity level, trends over time
- **Risk Report** — Risk assessment overview, highlighting processes that need attention
- **Automation Report** — Analysis of automation levels across the process landscape
