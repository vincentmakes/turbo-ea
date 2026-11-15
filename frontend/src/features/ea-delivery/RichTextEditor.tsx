import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Extension,
  PasteRule,
  getMarkRange,
  mergeAttributes,
  type AnyExtension,
  type PasteRuleFinder,
  type Range,
} from "@tiptap/core";
import { Link } from "@tiptap/extension-link";
import { Plugin } from "@tiptap/pm/state";
import { useEditor, useEditorState, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import type { Theme } from "@mui/material/styles";
import Alert from "@mui/material/Alert";
import LinearProgress from "@mui/material/LinearProgress";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useFileUploadsEnabled } from "@/hooks/useFileUploadsEnabled";
import { DOCUMENT_CONTENT_SX } from "@/lib/documentContentCss";
import { DOCUMENT_IMAGE_SX } from "@/lib/documentImageMarkup";
import { isStorableHref, normaliseLinkHref } from "@/lib/linkify";
import type { MentionKind } from "@/lib/mentionHtml";
import { plainListTags } from "./collab/discussionModel";
import { createDocumentImageExtension, parseAlign, type DocumentImageAlign } from "./documentImageExtension";
import { createDocumentTableExtensions } from "./documentTableExtension";
import {
  DOCUMENT_IMAGE_ACCEPT,
  clipboardHtmlHasText,
  documentImagePath,
  documentImageSrc,
  imageRefusal,
  uploadDocumentImage,
  type DocumentImageKind,
} from "./documentImages";
import LinkDialog, { type LinkDialogResult } from "./LinkDialog";
import TableMenu from "./TableMenu";
import { MENTION_CHIP_SX } from "./mentions/MentionContainer";
import MentionBrowseDialog from "./mentions/MentionBrowseDialog";
import MentionPopup from "./mentions/MentionPopup";
import { createMentionExtension } from "./mentions/mentionExtension";
import { useMentionLabels } from "./mentions/mentionLabels";
import {
  mentionInsertContent,
  overFollowingSpace,
  rangeFits,
  type MentionContext,
  type MentionPick,
} from "./mentions/mentionModel";
import {
  createMentionSuggestionStore,
  type MentionSuggestionStore,
} from "./mentions/mentionSuggestionStore";

interface Props {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  /**
   * What "@" may mention here. Absent: no mention support at all. Documents
   * pass `["card", "decision"]`; people (`"user"`) belong in comments only.
   */
  mentions?: MentionKind[];
  /**
   * `"comment"`: the comment grammar (no headings, rules, code blocks or
   * underline) and Ctrl/Cmd+Enter calls `onSubmit`. Defaults to `"document"`.
   */
  variant?: "document" | "comment";
  /** Comment variant: Ctrl/Cmd+Enter. Not called while the "@" popup is open. */
  onSubmit?: () => void;
  /**
   * What the document knows, for the "@" list's order: its linked cards and
   * (in comments) its people come first.
   */
  mentionContext?: MentionContext;
  /** Each new non-zero value puts the caret at the end of the text. */
  focusRequest?: number;
  /**
   * Document variant: the store this section's pictures belong to. A stored
   * picture is kept (read-only editors included); inserting one by button,
   * paste or drop is offered while editable and file uploads are on.
   * Absent: no picture support.
   */
  imageKind?: DocumentImageKind;
}

/**
 * Ctrl/Cmd+Enter submits a comment. Its priority is above StarterKit's
 * HardBreak, which binds `Mod-Enter` to a line break; while the "@" popup is
 * open the key is swallowed (neither a submit nor a line break).
 */
function submitShortcut(store: MentionSuggestionStore, submit: () => void): AnyExtension {
  return Extension.create({
    name: "commentSubmit",
    priority: 1000,
    addKeyboardShortcuts() {
      return {
        "Mod-Enter": () => {
          if (!store.isOpen()) submit();
          return true;
        },
      };
    },
  });
}

/**
 * Ctrl/Cmd+K opens the link dialog. Handled (so ProseMirror prevents the
 * browser default, and the app's global search shortcut, which skips a
 * prevented event, stays shut) only while the editor is editable: a locked
 * editor lets Ctrl/Cmd+K open the search as everywhere else.
 */
function linkShortcut(open: { current: () => void }): AnyExtension {
  return Extension.create({
    name: "linkShortcut",
    addKeyboardShortcuts() {
      return {
        "Mod-k": () => {
          if (!this.editor.isEditable) return false;
          open.current();
          return true;
        },
      };
    },
  });
}

/** What autolink, the paste rule and `setLink` may turn into a link (see `DocumentLink`). */
const linkCandidate = (url: unknown) =>
  isStorableHref(url) || (typeof url === "string" && normaliseLinkHref(url) !== null);

/**
 * Links. StarterKit's own copy is switched off and this one registered in its
 * place, because the stored-link policy needs its parse and render rules:
 *
 * - One policy everywhere (`isStorableHref`, the server's comment rule):
 *   http(s) and mailto only. A stored `ftp:`, `tel:` or relative anchor loads
 *   as plain text, and a mark whose href is anything else renders without one.
 * - `isAllowedUri` is ALSO what autolink and the paste rule ask about the
 *   *text* they found (`www.x.io`, `ann@x.io`) before linkify turns it into
 *   the href (`https://www.x.io`, `mailto:ann@x.io`), so it accepts what
 *   `normaliseLinkHref` can make storable (`linkCandidate`). Every href this
 *   editor writes is storable all the same: autolink and paste store
 *   linkify's href, and the link dialog normalises before `setLink`.
 *   `shouldAutoLink` gains the same check, so pasting `ftp://…` over a
 *   selection (a path that consults no `isAllowedUri`) does not link it.
 * - A click while editing places the caret (`openOnClick: false`); the
 *   Ctrl/Cmd+click plugin below opens the link. In a read-only editor
 *   nothing here acts, so the anchor's own `target="_blank"` follows it.
 * - The mark is inclusive because autolink is on (TipTap ties the two): text
 *   typed at the end of a link joins it. The dialog leaves the caret after
 *   the link with the mark dropped from what is typed next, and ArrowRight
 *   at a link's end steps out of it (`exitable`).
 */
const DocumentLink = Link.extend({
  addOptions() {
    const parent = this.parent!();
    return {
      ...parent,
      shouldAutoLink: (url: string) => parent.shouldAutoLink(url) && linkCandidate(url),
    };
  },
  parseHTML() {
    return [
      {
        tag: "a[href]",
        getAttrs: (dom: HTMLElement) => (isStorableHref(dom.getAttribute("href")) ? null : false),
      },
    ];
  },
  // TipTap's paste rule asks linkify without the default protocol, so a
  // pasted `www.x.io` would be stored as `http://…` where a typed one gets
  // `https://`. The rule is kept; only the href each match carries is
  // rebuilt by `normaliseLinkHref` (bare host → https, bare address →
  // mailto, an explicit scheme kept exactly as pasted).
  addPasteRules() {
    return (this.parent?.() ?? []).map((rule) => {
      // The link rule's finder is linkify's `findPlainUrls`, a function.
      const find = rule.find as Exclude<PasteRuleFinder, RegExp>;
      return new PasteRule({
        find: (text, event) =>
          find(text, event)?.map((match) => ({
            ...match,
            data: { ...match.data, href: normaliseLinkHref(match.text) ?? match.data?.href },
          })),
        handler: rule.handler,
      });
    });
  },
  renderHTML(props) {
    if (isStorableHref(props.HTMLAttributes.href)) return this.parent!(props);
    return ["a", mergeAttributes(this.options.HTMLAttributes, props.HTMLAttributes, { href: null }), 0];
  },
  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() ?? []),
      // Ctrl/Cmd+click on a link while editing opens it in a new tab, as in
      // Word; a plain click is a caret placement.
      new Plugin({
        props: {
          handleClick: (view, _pos, event) => {
            if (!view.editable || event.button !== 0 || !(event.ctrlKey || event.metaKey)) {
              return false;
            }
            const anchor = (event.target as Element | null)?.closest?.("a") ?? null;
            if (!anchor || !view.dom.contains(anchor)) return false;
            const href = anchor.getAttribute("href");
            if (!href || !isStorableHref(href)) return false;
            window.open(href, "_blank", "noopener,noreferrer");
            return true;
          },
        },
      }),
    ];
  },
});

/**
 * The server keeps attribute-less tags only in a comment and escapes any
 * other, so a comment's lists carry no `start` / `type`: a list typed as
 * "3. " or pasted as a lettered list is a plain numbered list. This plugin
 * resets the two attributes on every change (typed, pasted, loaded), and
 * `plainListTags` strips them from what is sent, whatever the editor holds.
 */
function plainCommentLists(): AnyExtension {
  return Extension.create({
    name: "plainCommentLists",
    addProseMirrorPlugins() {
      return [
        new Plugin({
          appendTransaction: (transactions, _old, state) => {
            if (!transactions.some((tr) => tr.docChanged)) return null;
            const tr = state.tr;
            state.doc.descendants((node, pos) => {
              if (node.type.name !== "orderedList") return;
              if (node.attrs.start !== 1 || node.attrs.type != null) {
                tr.setNodeMarkup(pos, undefined, { ...node.attrs, start: 1, type: null });
              }
            });
            return tr.docChanged ? tr : null;
          },
        }),
      ];
    },
  });
}

/**
 * Pictures on the editor surface: the shared rules (`DOCUMENT_IMAGE_SX`, built
 * from the same table as the `DOCUMENT_IMAGE_CSS` the previews, print and
 * export use), plus the resize view's own wrapper. While
 * editing, the picture sits in that view's flex container, which carries the
 * same `data-align`; `flex-end` follows the writing direction, so right-to-left
 * locales mirror as the logical margins do.
 */
const EDITOR_IMAGE_SX = {
  ...DOCUMENT_IMAGE_SX,
  "& [data-resize-container]": { my: 1 },
  "& [data-resize-wrapper]": { maxWidth: "100%" },
  // The view writes the committed size as inline px; the height follows the
  // width so a picture narrowed by `max-width` keeps its proportions.
  "& [data-resize-wrapper] img": { display: "block", height: "auto !important" },
  '& [data-resize-container][data-align="center"]': { justifyContent: "center" },
  '& [data-resize-container][data-align="right"]': { justifyContent: "flex-end" },
  "& [data-resize-handle]": {
    width: 10,
    height: 10,
    bgcolor: "primary.main",
    border: "1px solid",
    borderColor: "background.paper",
    borderRadius: "2px",
    opacity: 0,
    zIndex: 1,
  },
  '& [data-resize-handle="top-left"], & [data-resize-handle="bottom-right"]': {
    cursor: "nwse-resize",
  },
  '& [data-resize-handle="top-right"], & [data-resize-handle="bottom-left"]': {
    cursor: "nesw-resize",
  },
  "& [data-resize-container]:hover [data-resize-handle], & .ProseMirror-selectednode [data-resize-handle], & [data-resize-state='true'] [data-resize-handle]":
    { opacity: 1 },
  "& .ProseMirror-selectednode img": {
    outline: "2px solid",
    outlineColor: (theme: Theme) => theme.palette.primary.main,
  },
  // A read-only document cannot be resized (the view only drops its handles
  // on a document change, not when the editor locks).
  '&[contenteditable="false"] [data-resize-handle]': { display: "none" },
};

/**
 * Tables while editing, on top of the shared table rules: the node view's
 * wrapper scrolls a table wider than the text, a cell selection is tinted, and
 * the column-resize handle (a decoration `columnResizing` draws in the cell
 * under the pointer) is a thin bar on the cell's inline-end edge. Resizing is
 * refused at event time while the editor is locked; a handle left over from
 * before the lock is hidden here, and so is the resize cursor.
 */
const EDITOR_TABLE_SX = {
  "& .tableWrapper": { overflowX: "auto", maxWidth: "100%" },
  "& td, & th": { position: "relative", boxSizing: "border-box" },
  "& .selectedCell::after": {
    content: '""',
    position: "absolute",
    inset: 0,
    bgcolor: "action.selected",
    pointerEvents: "none",
    zIndex: 2,
  },
  "& .column-resize-handle": {
    position: "absolute",
    insetInlineEnd: "-2px",
    top: 0,
    bottom: 0,
    width: "4px",
    bgcolor: "primary.main",
    pointerEvents: "none",
    zIndex: 3,
  },
  '&.resize-cursor[contenteditable="true"]': { cursor: "col-resize" },
  '&[contenteditable="false"] .column-resize-handle': { display: "none" },
};

export default function RichTextEditor({
  content,
  onChange,
  placeholder,
  readOnly,
  mentions,
  variant = "document",
  onSubmit,
  mentionContext,
  focusRequest = 0,
  imageKind,
}: Props) {
  const { t } = useTranslation("delivery");
  const isComment = variant === "comment";
  const [store] = useState(createMentionSuggestionStore);
  const mentionLabels = useMentionLabels();
  // The editor is built once; the latest submit callback is read through a ref.
  const onSubmitRef = useRef(onSubmit);
  useEffect(() => {
    onSubmitRef.current = onSubmit;
  }, [onSubmit]);
  const hasMentions = Boolean(mentions && mentions.length > 0);
  // The node is registered whenever the document has a picture store, even
  // read-only: without it a stored picture would vanish on the next save.
  const hasImages = Boolean(imageKind) && !isComment;
  const { fileUploadsEnabled } = useFileUploadsEnabled();
  const canInsertImages = hasImages && !readOnly && fileUploadsEnabled;
  // The editor is built once; its paste / drop handlers read these refs.
  const canInsertImagesRef = useRef(canInsertImages);
  useEffect(() => {
    canInsertImagesRef.current = canInsertImages;
  }, [canInsertImages]);
  const insertImagesRef = useRef<(files: File[], at: number | null) => void>(() => {});
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The editor is built once; its Ctrl/Cmd+K shortcut reads the latest opener.
  const openLinkRef = useRef<() => void>(() => {});
  const [uploading, setUploading] = useState(0);
  const [imageError, setImageError] = useState("");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // The comment grammar keeps p, br, strong, em, s, code, lists,
        // blockquote and links only.
        heading: isComment ? false : { levels: [3, 4] },
        horizontalRule: isComment ? false : undefined,
        codeBlock: isComment ? false : undefined,
        underline: isComment ? false : undefined,
        // Registered below as `DocumentLink`.
        link: false,
      }),
      // A URL typed or pasted becomes a link as you type, stored with the
      // attributes every outbound link in the app carries. `sanitizeRichHtml`
      // re-stamps target/rel at render time for content written before this,
      // so the stored attributes are a convenience, not the safety net.
      DocumentLink.configure({
        openOnClick: false,
        enableClickSelection: false,
        autolink: true,
        linkOnPaste: true,
        defaultProtocol: "https",
        HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
        isAllowedUri: (url) => linkCandidate(url),
      }),
      linkShortcut(openLinkRef),
      Placeholder.configure({ placeholder: placeholder ?? t("richText.startTyping") }),
      ...(hasMentions ? [createMentionExtension(store, mentionLabels)] : []),
      ...(isComment ? [submitShortcut(store, () => onSubmitRef.current?.()), plainCommentLists()] : []),
      ...(hasImages && imageKind ? [createDocumentImageExtension(imageKind)] : []),
      // Every document editor, read-only included: one without the table
      // nodes would drop a stored table on the next save. Never in a comment,
      // where a pasted table flattens to its paragraphs.
      ...(isComment ? [] : createDocumentTableExtensions()),
    ],
    content,
    editable: !readOnly,
    editorProps: {
      // A pasted picture FILE is uploaded. Clipboard HTML with text in it
      // (a copy from Word or Excel also carries a rendered picture of the
      // selection) is pasted as text instead.
      handlePaste: (_view, event) => {
        const data = event.clipboardData;
        const files = Array.from(data?.files ?? []);
        if (files.length === 0 || !canInsertImagesRef.current) return false;
        if (clipboardHtmlHasText(data?.getData("text/html") ?? "")) return false;
        insertImagesRef.current(files, null);
        return true;
      },
      // Dropped files land where they were dropped; a drag inside the
      // document (`moved`) is ProseMirror's own.
      handleDrop: (view, event, _slice, moved) => {
        if (moved || !canInsertImagesRef.current) return false;
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0) return false;
        let at: number | null = null;
        try {
          at = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? null;
        } catch {
          // No layout to measure against: insert at the caret.
        }
        event.preventDefault();
        insertImagesRef.current(files, at);
        return true;
      },
    },
    onUpdate: ({ editor: e }) => {
      // A locked document reports no edit: what changes it there is the
      // editor's own upkeep (the empty paragraph TipTap keeps after a final
      // picture, list or rule appears on the first selection change).
      if (!e.isEditable) return;
      const html = e.getHTML();
      onChange(isComment ? plainListTags(html) : html);
    },
    // The "@" popup belongs to the focused editor: leaving it (another field,
    // a click outside, the toolbar) dismisses it. A click on a row does not
    // blur. The toolbar's "Mention…" button reads back what was dismissed;
    // coming back into the editor forgets it.
    onBlur: () => store.dismiss(),
    onFocus: () => {
      store.takeDismissed();
    },
  });

  useEffect(() => {
    if (focusRequest > 0 && editor && !editor.isDestroyed) editor.commands.focus("end");
  }, [editor, focusRequest]);

  // An editor going away takes its "@" popup with it.
  useEffect(() => () => store.close(), [store]);

  // The browse dialog, and the "@query" text it replaces (null: at the caret).
  const [browse, setBrowse] = useState<{ range: Range | null } | null>(null);
  useEffect(() => {
    store.setBrowseHandler((range) => setBrowse({ range }));
    return () => store.setBrowseHandler(null);
  }, [store]);
  // The dialog is modal, but a reply to a request started before it opened
  // can still lock the page or replace the text under it: an editor no longer
  // editable takes nothing, and a saved "@query" range that no longer fits
  // the document gives way to the caret.
  const closeBrowse = (picks: MentionPick[]) => {
    const saved = browse?.range ?? null;
    setBrowse(null);
    if (!editor || editor.isDestroyed || !editor.isEditable) return;
    const { doc, selection } = editor.state;
    const size = doc.content.size;
    const range = saved && rangeFits(saved, size) ? saved : null;
    const chain = editor.chain().focus();
    if (picks.length === 0) {
      // Cancel changes nothing: the caret goes back after the "@query".
      (range ? chain.setTextSelection(range.to) : chain).run();
      return;
    }
    // One space after each mention, never two: a space already there is
    // taken over, as a pick in the popup does.
    const at = range ?? { from: selection.from, to: selection.to };
    const target = overFollowingSpace(at, doc.textBetween(at.to, Math.min(at.to + 1, size)));
    chain.insertContentAt(target, mentionInsertContent(picks)).run();
  };

  // The link dialog: the range it applies to (a link under the caret is
  // taken whole), the selection Cancel gives back, and the href shown.
  const [linkEdit, setLinkEdit] = useState<{
    range: Range;
    selection: Range;
    href: string;
    editing: boolean;
    askText: boolean;
  } | null>(null);
  const openLink = () => {
    if (!editor || editor.isDestroyed || !editor.isEditable) return;
    const { state } = editor;
    const { from, to, empty, $from } = state.selection;
    const editing = editor.isActive("link");
    const mark = editing ? getMarkRange($from, state.schema.marks.link) : undefined;
    const range = mark && mark.from <= from && mark.to >= to ? mark : { from, to };
    setLinkEdit({
      range,
      selection: { from, to },
      href: editing ? String(editor.getAttributes("link").href ?? "") : "",
      editing,
      askText: empty && !editing,
    });
  };
  useEffect(() => {
    openLinkRef.current = openLink;
  });
  // As `closeBrowse`: an editor destroyed or locked meanwhile takes nothing,
  // and a saved range that no longer fits the document changes nothing.
  const closeLink = (
    result: { kind: "cancel" } | { kind: "remove" } | ({ kind: "apply" } & LinkDialogResult),
  ) => {
    const saved = linkEdit;
    setLinkEdit(null);
    if (!saved || !editor || editor.isDestroyed || !editor.isEditable) return;
    const size = editor.state.doc.content.size;
    const chain = editor.chain().focus();
    if (result.kind === "cancel") {
      (rangeFits(saved.selection, size) ? chain.setTextSelection(saved.selection) : chain).run();
      return;
    }
    if (!rangeFits(saved.range, size)) {
      chain.run();
      return;
    }
    chain.setTextSelection(saved.range);
    if (result.kind === "remove") {
      chain.unsetLink().run();
      return;
    }
    const { href, text } = result;
    if (text !== undefined) {
      chain.insertContent({ type: "text", text, marks: [{ type: "link", attrs: { href } }] });
    } else {
      chain.setLink({ href }).setTextSelection(saved.range.to);
    }
    // The caret ends after the link, and what is typed there next is not
    // part of it (the mark is inclusive, see `DocumentLink`).
    chain.unsetMark("link").run();
  };

  // Each file in turn: refused with a reason, or uploaded and inserted. The
  // first lands at `at` (a drop) or the caret, each next one after it. As in
  // `closeBrowse`, an editor destroyed or locked while the upload ran takes
  // nothing.
  const insertImages = async (files: File[], at: number | null) => {
    if (!imageKind) return;
    let target = at;
    for (const file of files) {
      const refusal = imageRefusal(file);
      if (refusal) {
        setImageError(refusal);
        continue;
      }
      setUploading((n) => n + 1);
      try {
        const stored = await uploadDocumentImage(imageKind, file);
        const src =
          documentImagePath(stored.src, imageKind) ??
          documentImagePath(documentImageSrc(imageKind, stored.id), imageKind);
        if (!src) throw new Error("");
        if (!editor || editor.isDestroyed || !editor.isEditable) continue;
        const node = { type: "image", attrs: { src } };
        const chain = editor.chain().focus();
        if (target !== null && target <= editor.state.doc.content.size) {
          chain.insertContentAt(target, node).run();
        } else {
          chain.insertContent(node).run();
        }
        // The next file goes after this one, not over it (an inserted
        // picture may be left selected).
        target = editor.state.selection.to;
      } catch (err) {
        // The detail names the real reason (wrong bytes, uploads switched off).
        const detail = err instanceof Error ? err.message : "";
        setImageError(detail || t("richText.imageUploadFailed"));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  useEffect(() => {
    insertImagesRef.current = (files, at) => void insertImages(files, at);
  });

  // The picture selected, for the alignment buttons (selection changes do
  // not re-render the editor on their own).
  const selectedImage = useEditorState({
    editor,
    selector: ({ editor: e }): { align: DocumentImageAlign | null } | null =>
      e && hasImages && e.isActive("image")
        ? { align: parseAlign(e.getAttributes("image").align as string | null) }
        : null,
  });
  // Whether the caret is in a link, for the link button.
  const inLink = useEditorState({
    editor,
    selector: ({ editor: e }) => Boolean(e?.isActive("link")),
  });

  // Sync editable state when readOnly changes. No update is emitted: an
  // untouched document must not report its own re-serialisation as an edit.
  // The empty transaction tells node views (mention chips) to re-read
  // whether the editor is editable.
  useEffect(() => {
    if (editor && !editor.isDestroyed && editor.isEditable !== !readOnly) {
      editor.setEditable(!readOnly, false);
      editor.view.dispatch(editor.state.tr.setMeta("editableChanged", true));
    }
  }, [editor, readOnly]);

  // Sync external content changes (e.g. loading from API)
  useEffect(() => {
    if (editor && content !== editor.getHTML()) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
    // Only re-sync when `content` identity changes from the parent
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content]);

  if (!editor) return null;

  const setAlign = (align: DocumentImageAlign | null) =>
    editor.chain().focus().updateAttributes("image", { align }).run();

  const btn = (
    icon: string,
    title: string,
    action: () => void,
    isActive?: boolean,
  ) => (
    <Tooltip title={title} key={title}>
      <IconButton
        size="small"
        onClick={action}
        sx={{
          borderRadius: 1,
          bgcolor: isActive ? "action.selected" : "transparent",
          mx: 0.15,
        }}
      >
        <MaterialSymbol icon={icon} size={18} />
      </IconButton>
    </Tooltip>
  );

  return (
    <Box
      sx={{
        border: "1px solid",
        borderColor: "divider",
        borderRadius: 1,
        "&:focus-within": { borderColor: "primary.main" },
      }}
    >
      {/* Toolbar */}
      {!readOnly && <Box
        sx={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          px: 0.5,
          py: 0.25,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "action.hover",
        }}
      >
        {btn(
          "format_bold",
          t("richText.bold"),
          () => editor.chain().focus().toggleBold().run(),
          editor.isActive("bold"),
        )}
        {btn(
          "format_italic",
          t("richText.italic"),
          () => editor.chain().focus().toggleItalic().run(),
          editor.isActive("italic"),
        )}
        {!isComment &&
          btn(
            "format_underlined",
            t("richText.underline"),
            () => editor.chain().focus().toggleUnderline().run(),
            editor.isActive("underline"),
          )}
        {btn(
          "format_strikethrough",
          t("richText.strikethrough"),
          () => editor.chain().focus().toggleStrike().run(),
          editor.isActive("strike"),
        )}
        {btn(
          "code",
          t("richText.code"),
          () => editor.chain().focus().toggleCode().run(),
          editor.isActive("code"),
        )}
        {btn("link", t("richText.link"), openLink, inLink)}

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        {!isComment &&
          btn(
            "format_h3",
            t("richText.heading"),
            () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
            editor.isActive("heading", { level: 3 }),
          )}
        {!isComment &&
          btn(
            "format_h4",
            t("richText.subheading"),
            () => editor.chain().focus().toggleHeading({ level: 4 }).run(),
            editor.isActive("heading", { level: 4 }),
          )}
        {btn(
          "format_list_bulleted",
          t("richText.bulletList"),
          () => editor.chain().focus().toggleBulletList().run(),
          editor.isActive("bulletList"),
        )}
        {btn(
          "format_list_numbered",
          t("richText.numberedList"),
          () => editor.chain().focus().toggleOrderedList().run(),
          editor.isActive("orderedList"),
        )}

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        {btn("format_quote", t("richText.blockquote"), () =>
          editor.chain().focus().toggleBlockquote().run(),
          editor.isActive("blockquote"),
        )}
        {!isComment &&
          btn(
            "code_blocks",
            t("richText.codeBlock"),
            () => editor.chain().focus().toggleCodeBlock().run(),
            editor.isActive("codeBlock"),
          )}
        {!isComment &&
          btn("horizontal_rule", t("richText.divider"), () =>
            editor.chain().focus().setHorizontalRule().run(),
          )}
        {!isComment && <TableMenu editor={editor} />}

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        {hasMentions && (
          <>
            {btn("alternate_email", t("richText.mention"), () => {
              // Pressed while "@query" is being typed, it replaces that text
              // as the popup's "Browse…" row does; else it inserts at the caret.
              if (store.isOpen()) store.browse();
              else setBrowse({ range: store.takeDismissed() });
            })}
            <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
          </>
        )}

        {canInsertImages &&
          btn("image", t("richText.insertImage"), () => fileInputRef.current?.click())}
        {canInsertImages && (
          <input
            ref={fileInputRef}
            type="file"
            hidden
            multiple
            accept={DOCUMENT_IMAGE_ACCEPT}
            data-testid="rich-text-image-input"
            onChange={(e) => {
              const files = Array.from(e.target.files ?? []);
              // Picking the same file again must fire onChange again.
              e.target.value = "";
              if (files.length > 0) void insertImages(files, null);
            }}
          />
        )}
        {/* Aligning is an edit of the text, not an upload: offered whatever
            the upload setting. */}
        {selectedImage && (
          <>
            {btn("format_align_left", t("richText.alignLeft"), () => setAlign(null), selectedImage.align === null)}
            {btn("format_align_center", t("richText.alignCenter"), () => setAlign("center"), selectedImage.align === "center")}
            {btn("format_align_right", t("richText.alignRight"), () => setAlign("right"), selectedImage.align === "right")}
          </>
        )}
        {(canInsertImages || selectedImage) && (
          <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
        )}

        {btn("undo", t("richText.undo"), () => editor.chain().focus().undo().run())}
        {btn("redo", t("richText.redo"), () => editor.chain().focus().redo().run())}
      </Box>}
      {hasImages && uploading > 0 && (
        <LinearProgress aria-label={t("richText.imageUploading")} sx={{ height: 2 }} />
      )}
      {hasImages && imageError && (
        <Alert severity="error" onClose={() => setImageError("")} sx={{ borderRadius: 0 }}>
          {imageError}
        </Alert>
      )}

      {/* Editor content */}
      <Box
        sx={[
          MENTION_CHIP_SX,
          {
          "& .tiptap": {
            minHeight: 120,
            px: 2,
            py: 1.5,
            outline: "none",
            fontSize: "0.9rem",
            lineHeight: 1.7,
            "& p.is-editor-empty:first-of-type::before": {
              content: "attr(data-placeholder)",
              color: "text.disabled",
              float: "left",
              height: 0,
              pointerEvents: "none",
            },
            // The shared display rules (links, code, code blocks, the
            // sub-heading, tables, pictures), so text looks the same here
            // as in the preview; the editor's own rules follow.
            ...DOCUMENT_CONTENT_SX,
            // A wide table scrolls in its own wrapper here (see
            // `EDITOR_TABLE_SX`), so the editable root never scrolls.
            overflowX: "visible",
            "& h3": { fontSize: "1.1rem", fontWeight: 600, mt: 2, mb: 1 },
            "& ul, & ol": { pl: 3 },
            // A click on a link while editing places the caret.
            "& a": { ...DOCUMENT_CONTENT_SX["& a"], cursor: "text" },
            "& blockquote": {
              borderLeft: "3px solid",
              borderColor: "divider",
              pl: 2,
              ml: 0,
              color: "text.secondary",
            },
            ...EDITOR_IMAGE_SX,
            ...EDITOR_TABLE_SX,
          },
          },
        ]}
      >
        <EditorContent editor={editor} />
      </Box>
      {hasMentions && (
        <MentionPopup
          store={store}
          kinds={mentions ?? []}
          context={mentionContext}
          hidden={Boolean(browse)}
        />
      )}
      <LinkDialog
        open={Boolean(linkEdit)}
        href={linkEdit?.href ?? ""}
        editing={linkEdit?.editing ?? false}
        askText={linkEdit?.askText ?? false}
        onCancel={() => closeLink({ kind: "cancel" })}
        onApply={(r) => closeLink({ kind: "apply", ...r })}
        onRemove={() => closeLink({ kind: "remove" })}
      />
      {hasMentions && (
        <MentionBrowseDialog
          open={Boolean(browse)}
          kinds={mentions ?? []}
          onCancel={() => closeBrowse([])}
          onInsert={closeBrowse}
        />
      )}
    </Box>
  );
}
