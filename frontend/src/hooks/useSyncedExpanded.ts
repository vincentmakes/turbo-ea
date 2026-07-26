import { useEffect, useState } from "react";

/**
 * Accordion expand state that tracks a prop which may arrive late.
 *
 * Card-detail section expansion comes from the metamodel's `section_config`,
 * which loads asynchronously — sections routinely mount before it is known, so
 * they first render with a fallback and only later receive the configured
 * value. MUI's uncontrolled `defaultExpanded` latches at mount and ignores that
 * update, which silently dropped the admin's "collapsed by default" setting.
 *
 * Keeping the accordion controlled and re-syncing when (and only when) the
 * incoming value actually changes honours a config that lands after first
 * paint, while still leaving a manual toggle by the user in place afterwards.
 */
export function useSyncedExpanded(initial: boolean): [boolean, (v: boolean) => void] {
  const [expanded, setExpanded] = useState(initial);

  useEffect(() => {
    setExpanded(initial);
  }, [initial]);

  return [expanded, setExpanded];
}

export default useSyncedExpanded;
