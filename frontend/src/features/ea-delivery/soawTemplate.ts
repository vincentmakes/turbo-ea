/**
 * TOGAF Statement of Architecture Work — template section definitions.
 *
 * Every section has a unique `id` (used as the key in the persisted
 * `sections` record), a display title, a type that determines the
 * editor widget, and optional metadata (hint text, pre-defined columns
 * for table sections, preamble text, etc.).
 *
 * Template sections cannot be deleted — only hidden.  Custom (user-added)
 * sections are stored in the same `sections` record with ids that start
 * with "custom_".
 */

export type SectionType = "rich_text" | "table" | "togaf_phases";

export interface TemplateSectionDef {
  id: string;
  title: string;
  type: SectionType;
  part: "I" | "II";
  /** Heading depth: 1 = Part header, 2 = main section, 3 = subsection */
  level: 1 | 2 | 3;
  /** Placeholder hint shown when the section content is empty */
  hint?: string;
  /** Introductory text rendered above a table */
  preamble?: string;
  /** Column headers for table-type sections */
  columns?: string[];
}

export const SOAW_TEMPLATE_SECTIONS: TemplateSectionDef[] = [
  // ── Part I ────────────────────────────────────────────────────────────

  {
    id: "1.1",
    title: "1.1 Project Request and Background",
    type: "rich_text",
    part: "I",
    level: 3,
    hint: "Describe the business context, triggers, and background for this architecture initiative.",
  },
  {
    id: "1.2",
    title: "1.2 Project Description and Scope",
    type: "rich_text",
    part: "I",
    level: 3,
    hint: "Provide a high-level description of the project and its boundaries.",
  },
  {
    id: "2.1",
    title: "2.1 Objectives",
    type: "table",
    part: "I",
    level: 3,
    preamble: "The business objectives of this architecture work are as follows:",
    columns: ["Business Objective", "Notes"],
  },
  {
    id: "2.2",
    title: "2.2 Scope",
    type: "rich_text",
    part: "I",
    level: 3,
    hint: "Define the scope boundaries of this architecture engagement.",
  },
  {
    id: "2.3",
    title: "2.3 Stakeholders, Concerns, and Views",
    type: "table",
    part: "I",
    level: 3,
    preamble:
      "The following table shows the stakeholders who will use this document, their concerns, and how the architecture work will meet those concerns.",
    columns: ["Stakeholder", "Concern"],
  },
  {
    id: "3.1",
    title: "3.1 Architecture Process",
    type: "togaf_phases",
    part: "I",
    level: 3,
  },

  // ── Part II ───────────────────────────────────────────────────────────

  {
    id: "4.1",
    title: "4.1 Business Architecture — Baseline",
    type: "rich_text",
    part: "II",
    level: 3,
    hint: "Describe the current-state business architecture: processes, capabilities, organisation.",
  },
  {
    id: "4.2",
    title: "4.2 Business Architecture — Target",
    type: "rich_text",
    part: "II",
    level: 3,
    hint: "Describe the desired future-state business architecture.",
  },
  {
    id: "4.3",
    title: "4.3 Business Architecture — Gap Analysis & Transition",
    type: "rich_text",
    part: "II",
    level: 3,
    hint: "Identify gaps between baseline and target, and outline the transition approach.",
  },
  {
    id: "5.1",
    title: "5.1 Data & Application Architecture — Baseline",
    type: "rich_text",
    part: "II",
    level: 3,
    hint: "Describe the current-state data and application landscape.",
  },
  {
    id: "5.2",
    title: "5.2 Data & Application Architecture — Target",
    type: "rich_text",
    part: "II",
    level: 3,
    hint: "Describe the desired future-state data and application architecture.",
  },
  {
    id: "5.3",
    title: "5.3 Data & Application Architecture — Gap Analysis & Transition",
    type: "rich_text",
    part: "II",
    level: 3,
    hint: "Identify gaps and outline the transition approach for data & applications.",
  },
  {
    id: "6.1",
    title: "6.1 Technology Architecture — Baseline",
    type: "rich_text",
    part: "II",
    level: 3,
    hint: "Describe the current-state technology infrastructure and platforms.",
  },
  {
    id: "6.2",
    title: "6.2 Technology Architecture — Target",
    type: "rich_text",
    part: "II",
    level: 3,
    hint: "Describe the desired future-state technology architecture.",
  },
  {
    id: "6.3",
    title: "6.3 Technology Architecture — Gap Analysis & Transition",
    type: "rich_text",
    part: "II",
    level: 3,
    hint: "Identify gaps and outline the transition approach for technology.",
  },
  {
    id: "7.0",
    title: "7. Gap Analysis, Solution Options, and Risk Summary",
    type: "rich_text",
    part: "II",
    level: 2,
    hint: "Summarise overall gaps across all architecture domains and proposed solution options.",
  },
  {
    id: "7.1",
    title: "Risk Assessment",
    type: "table",
    part: "II",
    level: 3,
    columns: ["Risk #", "Description", "Priority", "Status"],
  },
  {
    id: "7.2",
    title: "Risk Mitigation",
    type: "table",
    part: "II",
    level: 3,
    columns: ["Description", "Status"],
  },
];

/** The TOGAF ADM phases shown in section 3.1 */
export const TOGAF_PHASES = [
  { key: "A", label: "A – Architecture Vision" },
  { key: "B", label: "B – Business Architecture" },
  { key: "C", label: "C – Information Systems Architecture" },
  { key: "D", label: "D – Technology Architecture" },
  { key: "E", label: "E – Opportunities and Solutions" },
  { key: "F", label: "F – Migration Planning" },
  { key: "G", label: "G – Implementation Governance" },
  { key: "H", label: "H – Architecture Change Management" },
  { key: "RM", label: "Requirements Management" },
];

/** Build the default (empty) sections record from the template. */
export function buildDefaultSections(): Record<
  string,
  {
    content: string;
    hidden: boolean;
    table_data?: { columns: string[]; rows: string[][] };
    togaf_data?: Record<string, string>;
  }
> {
  const sections: Record<string, {
    content: string;
    hidden: boolean;
    table_data?: { columns: string[]; rows: string[][] };
    togaf_data?: Record<string, string>;
  }> = {};

  for (const def of SOAW_TEMPLATE_SECTIONS) {
    if (def.type === "table") {
      sections[def.id] = {
        content: "",
        hidden: false,
        table_data: {
          columns: def.columns ?? [],
          rows: [new Array(def.columns?.length ?? 0).fill("")],
        },
      };
    } else if (def.type === "togaf_phases") {
      const togaf: Record<string, string> = {};
      for (const p of TOGAF_PHASES) togaf[p.key] = "";
      sections[def.id] = { content: "", hidden: false, togaf_data: togaf };
    } else {
      sections[def.id] = { content: "", hidden: false };
    }
  }

  return sections;
}
