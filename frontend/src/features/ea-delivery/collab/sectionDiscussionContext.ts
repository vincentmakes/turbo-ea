/**
 * What the page's section markers read from `DocumentSidePanel`: each
 * section's thread counts on the document shown (`sectionThreadCounts`, only
 * sections with a thread have an entry), whether the reader may comment
 * (every section then carries a marker to start a thread on it) and a way to
 * open the Discussion on one section. Absent (`null`) for a document not
 * saved yet, or outside a side panel: no marker then.
 */
import { createContext } from "react";

import type { SectionThreadCount } from "./discussionModel";

export interface SectionDiscussion {
  counts: Record<string, SectionThreadCount>;
  /** The reader may start a thread (false until the discussion has loaded). */
  canComment: boolean;
  /**
   * Open the Discussion (the drawer below `lg`) with the filter set to
   * `section` alone and, for a reader who may comment, that section chosen in
   * the new-thread composer with the caret in it.
   */
  openSection: (section: string) => void;
}

export const SectionDiscussionContext = createContext<SectionDiscussion | null>(null);
