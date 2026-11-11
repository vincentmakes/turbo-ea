import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Extension, type AnyExtension, type Range } from "@tiptap/core";
import { Plugin } from "@tiptap/pm/state";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { MentionKind } from "@/lib/mentionHtml";
import { plainListTags } from "./collab/discussionModel";
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
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // The comment grammar keeps p, br, strong, em, s, code, lists,
        // blockquote and links only.
        heading: isComment ? false : { levels: [3, 4] },
        horizontalRule: isComment ? false : undefined,
        codeBlock: isComment ? false : undefined,
        underline: isComment ? false : undefined,
        // StarterKit bundles the Link extension. A URL typed or pasted becomes
        // a link as you type, stored with the attributes every outbound link
        // in the app carries; `whenNotEditable` keeps a click in edit mode as
        // a caret placement and makes it follow the link once read-only.
        // `sanitizeRichHtml` re-stamps target/rel at render time for content
        // written before this, so the stored attributes are a convenience,
        // not the safety net.
        link: {
          openOnClick: "whenNotEditable",
          autolink: true,
          linkOnPaste: true,
          defaultProtocol: "https",
          HTMLAttributes: { target: "_blank", rel: "noopener noreferrer" },
        },
      }),
      Placeholder.configure({ placeholder: placeholder ?? t("richText.startTyping") }),
      ...(hasMentions ? [createMentionExtension(store, mentionLabels)] : []),
      ...(isComment ? [submitShortcut(store, () => onSubmitRef.current?.()), plainCommentLists()] : []),
    ],
    content,
    editable: !readOnly,
    onUpdate: ({ editor: e }) => {
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

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        {!isComment &&
          btn(
            "title",
            t("richText.heading"),
            () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
            editor.isActive("heading", { level: 3 }),
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
          btn("horizontal_rule", t("richText.divider"), () =>
            editor.chain().focus().setHorizontalRule().run(),
          )}

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

        {btn("undo", t("richText.undo"), () => editor.chain().focus().undo().run())}
        {btn("redo", t("richText.redo"), () => editor.chain().focus().redo().run())}
      </Box>}

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
            "& h3": { fontSize: "1.1rem", fontWeight: 600, mt: 2, mb: 1 },
            "& h4": { fontSize: "1rem", fontWeight: 600, mt: 1.5, mb: 0.5 },
            "& ul, & ol": { pl: 3 },
            "& a": { color: "primary.main", wordBreak: "break-all" },
            "& blockquote": {
              borderLeft: "3px solid",
              borderColor: "divider",
              pl: 2,
              ml: 0,
              color: "text.secondary",
            },
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
