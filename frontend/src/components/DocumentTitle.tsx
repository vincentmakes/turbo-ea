import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router";

import { useAppTitle } from "@/hooks/useAppTitle";
import { usePageTitleSlots, type PageTitleSlot } from "@/hooks/usePageTitle";
import { composeTitle, titleKeyForPath } from "@/lib/pageTitle";

/**
 * The single writer of `document.title` (#1085). Renders nothing.
 *
 * Mounted in `App` as a sibling of `<AppRoutes />` — inside `<BrowserRouter>`
 * so it can read the location, and outside `AppRoutes` so it is unaffected by
 * that component's `loading` early return and covers the public and
 * unauthenticated routes for free (#590).
 *
 * Nothing else in the app may assign `document.title`: two writers fight, which
 * is exactly what `PublicDiagramPage` used to do before it moved onto
 * `usePageSubject`.
 */
export default function DocumentTitle(): null {
  const { pathname } = useLocation();
  const { t } = useTranslation("nav");
  const appTitle = useAppTitle();
  const slots = usePageTitleSlots();

  // A slot published from another route is stale by construction — see the
  // path-keying note in `hooks/usePageTitle.ts`.
  const current = (slot: PageTitleSlot) => {
    const entry = slots[slot];
    return entry && entry.path === pathname ? entry.text : "";
  };

  const titleKey = titleKeyForPath(pathname);
  // A page's own subject replaces the generic route label; its tab qualifies it.
  const head = current("subject") || (titleKey ? t(titleKey) : "");
  const title = composeTitle([head, current("section")], appTitle);

  useEffect(() => {
    document.title = title;
  }, [title]);

  return null;
}
