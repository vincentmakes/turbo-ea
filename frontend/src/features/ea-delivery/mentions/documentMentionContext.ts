/**
 * The document's mention context (`MentionContext`) for the comment editors
 * deep inside its discussion: the side panel provides it, each comment
 * composer reads it, so the "@" list of a comment lists the document's linked
 * cards and people first without every component in between passing it on.
 */
import { createContext } from "react";

import type { MentionContext } from "./mentionModel";

export const DocumentMentionContext = createContext<MentionContext | undefined>(undefined);
