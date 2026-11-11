/**
 * What the page's section markers read from `DocumentSidePanel`: each
 * section's thread counts on the document shown (`sectionThreadCounts`) and a
 * way to open the Discussion filtered to one section. Absent (`null`) for a
 * document not saved yet, or outside a side panel: no marker then.
 */
import { createContext } from "react";

import type { SectionThreadCount } from "./discussionModel";

export interface SectionDiscussion {
  counts: Record<string, SectionThreadCount>;
  /** Open the Discussion (the drawer below `lg`) with the filter set to `section` alone. */
  openSection: (section: string) => void;
}

export const SectionDiscussionContext = createContext<SectionDiscussion | null>(null);
