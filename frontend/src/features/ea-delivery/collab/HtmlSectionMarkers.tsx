/**
 * Section markers for a document rendered as an HTML string (the SoAW
 * preview): React cannot place a component inside `dangerouslySetInnerHTML`,
 * so after each render of that HTML this finds the headings carrying
 * `data-section="<key>"` (`buildPreviewBody(..., { sectionAnchors: true })`)
 * for the sections that have threads, appends a host span to each and
 * portals a `SectionDiscussionMarker` into it. The hosts are removed again
 * when the HTML or the sections change. Nothing is added to the HTML string
 * itself, so a print or export built from it never carries a marker.
 */
import { useContext, useLayoutEffect, useState, type RefObject } from "react";
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
    setHosts(created);
    return () => {
      for (const host of created) host.el.remove();
    };
  }, [containerRef, html, sections]);

  return <>{hosts.map((host) => createPortal(<SectionDiscussionMarker section={host.section} />, host.el, host.section))}</>;
}
