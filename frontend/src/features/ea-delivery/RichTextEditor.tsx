import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Divider from "@mui/material/Divider";
import MaterialSymbol from "@/components/MaterialSymbol";

interface Props {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}

export default function RichTextEditor({ content, onChange, placeholder, readOnly }: Props) {
  const { t } = useTranslation("delivery");
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [3, 4] },
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
    ],
    content,
    editable: !readOnly,
    onUpdate: ({ editor: e }) => {
      onChange(e.getHTML());
    },
  });

  // Sync editable state when readOnly changes
  useEffect(() => {
    if (editor) {
      editor.setEditable(!readOnly);
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
        {btn(
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

        {btn(
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
        {btn("horizontal_rule", t("richText.divider"), () =>
          editor.chain().focus().setHorizontalRule().run(),
        )}

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        {btn("undo", t("richText.undo"), () => editor.chain().focus().undo().run())}
        {btn("redo", t("richText.redo"), () => editor.chain().focus().redo().run())}
      </Box>}

      {/* Editor content */}
      <Box
        sx={{
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
        }}
      >
        <EditorContent editor={editor} />
      </Box>
    </Box>
  );
}
