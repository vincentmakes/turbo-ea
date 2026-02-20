/**
 * DrawIO PostConfig.js — loaded AFTER app.min.js.
 *
 * All custom logic (graph access, context menu, cell insertion) is now
 * handled from the parent window via same-origin iframe access — see
 * DiagramEditor.tsx bootstrapDrawIO().  This file is kept as a placeholder
 * to suppress the 404 that DrawIO logs when it tries to load it.
 */
