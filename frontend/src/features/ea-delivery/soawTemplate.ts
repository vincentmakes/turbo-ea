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

import i18n from "@/i18n";

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

const t = (key: string) => i18n.t(`delivery:${key}`) as string;

/** Returns the SOAW template sections with translated labels. */
export function getTemplateSections(): TemplateSectionDef[] {
  return [
    // -- Part I --
    {
      id: "1.1",
      title: t("template.section_1_1.title"),
      type: "rich_text",
      part: "I",
      level: 3,
      hint: t("template.section_1_1.hint"),
    },
    {
      id: "1.2",
      title: t("template.section_1_2.title"),
      type: "rich_text",
      part: "I",
      level: 3,
      hint: t("template.section_1_2.hint"),
    },
    {
      id: "2.1",
      title: t("template.section_2_1.title"),
      type: "table",
      part: "I",
      level: 3,
      preamble: t("template.section_2_1.preamble"),
      columns: [t("template.section_2_1.col_objective"), t("template.section_2_1.col_notes")],
    },
    {
      id: "2.2",
      title: t("template.section_2_2.title"),
      type: "rich_text",
      part: "I",
      level: 3,
      hint: t("template.section_2_2.hint"),
    },
    {
      id: "2.3",
      title: t("template.section_2_3.title"),
      type: "table",
      part: "I",
      level: 3,
      preamble: t("template.section_2_3.preamble"),
      columns: [t("template.section_2_3.col_stakeholder"), t("template.section_2_3.col_concern")],
    },
    {
      id: "3.1",
      title: t("template.section_3_1.title"),
      type: "togaf_phases",
      part: "I",
      level: 3,
    },

    // -- Part II --
    {
      id: "4.1",
      title: t("template.section_4_1.title"),
      type: "rich_text",
      part: "II",
      level: 3,
      hint: t("template.section_4_1.hint"),
    },
    {
      id: "4.2",
      title: t("template.section_4_2.title"),
      type: "rich_text",
      part: "II",
      level: 3,
      hint: t("template.section_4_2.hint"),
    },
    {
      id: "4.3",
      title: t("template.section_4_3.title"),
      type: "rich_text",
      part: "II",
      level: 3,
      hint: t("template.section_4_3.hint"),
    },
    {
      id: "5.1",
      title: t("template.section_5_1.title"),
      type: "rich_text",
      part: "II",
      level: 3,
      hint: t("template.section_5_1.hint"),
    },
    {
      id: "5.2",
      title: t("template.section_5_2.title"),
      type: "rich_text",
      part: "II",
      level: 3,
      hint: t("template.section_5_2.hint"),
    },
    {
      id: "5.3",
      title: t("template.section_5_3.title"),
      type: "rich_text",
      part: "II",
      level: 3,
      hint: t("template.section_5_3.hint"),
    },
    {
      id: "6.1",
      title: t("template.section_6_1.title"),
      type: "rich_text",
      part: "II",
      level: 3,
      hint: t("template.section_6_1.hint"),
    },
    {
      id: "6.2",
      title: t("template.section_6_2.title"),
      type: "rich_text",
      part: "II",
      level: 3,
      hint: t("template.section_6_2.hint"),
    },
    {
      id: "6.3",
      title: t("template.section_6_3.title"),
      type: "rich_text",
      part: "II",
      level: 3,
      hint: t("template.section_6_3.hint"),
    },
    {
      id: "7.0",
      title: t("template.section_7_0.title"),
      type: "rich_text",
      part: "II",
      level: 2,
      hint: t("template.section_7_0.hint"),
    },
    {
      id: "7.1",
      title: t("template.section_7_1.title"),
      type: "table",
      part: "II",
      level: 3,
      columns: [
        t("template.section_7_1.col_riskNum"),
        t("template.section_7_1.col_description"),
        t("template.section_7_1.col_priority"),
        t("template.section_7_1.col_status"),
      ],
    },
    {
      id: "7.2",
      title: t("template.section_7_2.title"),
      type: "table",
      part: "II",
      level: 3,
      columns: [t("template.section_7_2.col_description"), t("template.section_7_2.col_status")],
    },
  ];
}

/**
 * @deprecated Use getTemplateSections() instead for translated labels.
 * Kept as a lazy-initialized getter for backward compatibility.
 */
export const SOAW_TEMPLATE_SECTIONS: TemplateSectionDef[] = new Proxy([] as TemplateSectionDef[], {
  get(target, prop, receiver) {
    const sections = getTemplateSections();
    if (prop === Symbol.iterator) return sections[Symbol.iterator].bind(sections);
    return Reflect.get(sections, prop, receiver);
  },
});

/** Returns the TOGAF ADM phases with translated labels. */
export function getTogafPhases(): { key: string; label: string }[] {
  return [
    { key: "A", label: t("template.togaf.phaseA") },
    { key: "B", label: t("template.togaf.phaseB") },
    { key: "C", label: t("template.togaf.phaseC") },
    { key: "D", label: t("template.togaf.phaseD") },
    { key: "E", label: t("template.togaf.phaseE") },
    { key: "F", label: t("template.togaf.phaseF") },
    { key: "G", label: t("template.togaf.phaseG") },
    { key: "H", label: t("template.togaf.phaseH") },
    { key: "RM", label: t("template.togaf.phaseRM") },
  ];
}

/**
 * @deprecated Use getTogafPhases() instead for translated labels.
 * Kept as a lazy-initialized getter for backward compatibility.
 */
export const TOGAF_PHASES: { key: string; label: string }[] = new Proxy(
  [] as { key: string; label: string }[],
  {
    get(target, prop, receiver) {
      const phases = getTogafPhases();
      if (prop === Symbol.iterator) return phases[Symbol.iterator].bind(phases);
      return Reflect.get(phases, prop, receiver);
    },
  },
);

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
  const templateSections = getTemplateSections();
  const togafPhases = getTogafPhases();
  const sections: Record<string, {
    content: string;
    hidden: boolean;
    table_data?: { columns: string[]; rows: string[][] };
    togaf_data?: Record<string, string>;
  }> = {};

  for (const def of templateSections) {
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
      for (const p of togafPhases) togaf[p.key] = "";
      sections[def.id] = { content: "", hidden: false, togaf_data: togaf };
    } else {
      sections[def.id] = { content: "", hidden: false };
    }
  }

  return sections;
}
