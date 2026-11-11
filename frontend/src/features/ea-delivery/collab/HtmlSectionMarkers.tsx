/**
 * Section markers for a document rendered as an HTML string (the SoAW
 * preview): React cannot place a component inside `dangerouslySetInnerHTML`,
 * so after each render of that HTML this finds the headings carrying
 * `data-section="<key>"` (`buildPreviewBody(..., { sectionAnchors: true })`)
 * for the sections that have threads, appends a host span to each and
 * portals a `SectionDiscussionMarker` into it. The hosts are removed again
 * when the HTML or the sections change. Nothing is added to the HTML string
 * itself, so a print or export built from it never carries a marker.
 *
 * React 19 reassigns `innerHTML` whenever the `dangerouslySetInnerHTML`
 * object is a new one, even with the same string, which drops the hosts out
 * of the document. After every render the hosts are checked, and when one is
 * no longer connected they are all placed again.
 */
import { useContext, useLayoutEffect, useRef, useState, type RefObject } from "react";
import { createPortal } from "react-dom";
import SectionDiscussionMarker from "./SectionDiscussionMarker";
import { SectionDiscussionContext } from "./sectionDiscussionContext";

interface Props {
  /** The element the HTML is rendered into. */
  containerRef: RefObject<HTMLElement | null>;
  /** The HTML rendered there: the hosts are placed again whenever it changes. */
  html: string;
}

interface Host {
  section: string;
  el: HTMLElement;
}

export default function HtmlSectionMarkers({ containerRef, html }: Props) {
  const ctx = useContext(SectionDiscussionContext);
  const [hosts, setHosts] = useState<Host[]>([]);
  // Bumped when a host has been dropped from the document, to place them again.
  const [placement, setPlacement] = useState(0);
  // The hosts placed last, read by the check below (state lags one render).
  const placed = useRef<Host[]>([]);
  // The sections with threads, as a stable string: a re-read that changes
  // only the counts re-renders the markers without moving their hosts.
  const sections = ctx ? Object.keys(ctx.counts).sort().join("\n") : "";

  useLayoutEffect(() => {
    const root = containerRef.current;
    const wanted = new Set(sections ? sections.split("\n") : []);
    const created: Host[] = [];
    if (root) {
      for (const heading of root.querySelectorAll<HTMLElement>("[data-section]")) {
        const section = heading.getAttribute("data-section") ?? "";
        if (!wanted.has(section)) continue;
        const el = document.createElement("span");
        el.className = "no-print";
        heading.appendChild(el);
        created.push({ section, el });
      }
    }
    placed.current = created;
    setHosts(created);
    return () => {
      for (const host of created) host.el.remove();
    };
  }, [containerRef, html, sections, placement]);

  // No dependency list on purpose: whatever re-rendered, check the hosts.
  useLayoutEffect(() => {
    if (placed.current.some((host) => !host.el.isConnected)) setPlacement((n) => n + 1);
  });

  return <>{hosts.map((host) => createPortal(<SectionDiscussionMarker section={host.section} />, host.el, host.section))}</>;
}
