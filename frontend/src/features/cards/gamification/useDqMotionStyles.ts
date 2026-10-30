import { useEffect } from "react";
import { injectDqMotionStyles } from "./scoreGain";

/** Make sure the gamification keyframes are in the document (injected once). */
export function useDqMotionStyles(enabled = true): void {
  useEffect(() => {
    if (enabled) injectDqMotionStyles();
  }, [enabled]);
}
