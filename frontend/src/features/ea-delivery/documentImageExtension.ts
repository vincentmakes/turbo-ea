/**
 * The TipTap image node of a decision or SoAW section.
 *
 * Built on `@tiptap/extension-image` with three changes:
 * - a picture is kept only when its `src` is this kind's own route (pasted or
 *   loaded HTML naming an external, `data:` or other-kind picture makes no
 *   node, so it is never stored, never fetched);
 * - no input rule: typing `![x](https://…)` stays text;
 * - an `align` attribute, stored as `data-align` (`center` | `right`; absent
 *   is left).
 *
 * Attributes render in a fixed order — `src, alt, title, width, height,
 * data-align` — which is the server's canonical form, so a document loaded
 * and serialised with no edit comes back byte-identical.
 */
import type { NodeViewRenderer, NodeViewRendererProps } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import Image from "@tiptap/extension-image";
import { documentImagePath, type DocumentImageKind } from "./documentImages";

export type DocumentImageAlign = "center" | "right";

/** The largest width / height the server keeps. */
const MAX_DIMENSION = 4000;

/** `null` unless `value` is `center` or `right`. */
export function parseAlign(value: string | null | undefined): DocumentImageAlign | null {
  return value === "center" || value === "right" ? value : null;
}

/** A positive integer up to 4000 written as plain digits, else `null`. */
export function parseDimension(raw: string | null | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const n = Number(raw);
  return n >= 1 && n <= MAX_DIMENSION ? n : null;
}

/** A measured size (a resize commits `offsetWidth`) as the stored integer. */
export function renderDimension(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return String(Math.min(MAX_DIMENSION, Math.max(1, Math.round(value))));
}

function dimension(name: "width" | "height") {
  return {
    default: null,
    parseHTML: (el: HTMLElement) => parseDimension(el.getAttribute(name)),
    renderHTML: (attrs: Record<string, unknown>) => {
      const value = renderDimension(attrs[name]);
      return value === null ? {} : { [name]: value };
    },
  };
}

export function createDocumentImageExtension(kind: DocumentImageKind) {
  return Image.extend({
    addAttributes() {
      return {
        src: {
          default: null,
          // Stored relative, even when the browser absolutised a pasted copy.
          parseHTML: (el: HTMLElement) => documentImagePath(el.getAttribute("src"), kind),
        },
        alt: { default: null },
        title: { default: null },
        width: dimension("width"),
        height: dimension("height"),
        align: {
          default: null,
          parseHTML: (el: HTMLElement) => parseAlign(el.getAttribute("data-align")),
          renderHTML: (attrs: Record<string, unknown>) =>
            attrs.align ? { "data-align": attrs.align } : {},
        },
      };
    },

    parseHTML() {
      return [
        {
          tag: "img[src]",
          getAttrs: (el: HTMLElement) =>
            documentImagePath(el.getAttribute("src"), kind) === null ? false : null,
        },
      ];
    },

    addInputRules() {
      return [];
    },

    // The resize view puts the picture inside a flex container; the
    // container carries `data-align` too, so the editor's CSS can place it.
    addNodeView() {
      const render = this.parent?.() as NodeViewRenderer | null | undefined;
      if (!render) return null;
      return (props: NodeViewRendererProps) => {
        const view = render(props);
        const container = view.dom as HTMLElement;
        const sync = (node: PMNode) => {
          const align = parseAlign(node.attrs.align as string | null);
          if (align) container.dataset.align = align;
          else delete container.dataset.align;
        };
        sync(props.node);
        const update = view.update?.bind(view);
        if (update) {
          view.update = (node, decorations, innerDecorations) => {
            const kept = update(node, decorations, innerDecorations);
            if (kept) sync(node);
            return kept;
          };
        }
        return view;
      };
    },
  }).configure({
    inline: false,
    allowBase64: false,
    resize: {
      enabled: true,
      directions: ["top-left", "top-right", "bottom-left", "bottom-right"],
      minWidth: 32,
      minHeight: 32,
      alwaysPreserveAspectRatio: true,
    },
  });
}
