import { useEffect } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
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
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [3, 4] },
      }),
      Underline,
      Placeholder.configure({ placeholder: placeholder ?? "Start typing..." }),
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
          bgcolor: "grey.50",
        }}
      >
        {btn(
          "format_bold",
          "Bold",
          () => editor.chain().focus().toggleBold().run(),
          editor.isActive("bold"),
        )}
        {btn(
          "format_italic",
          "Italic",
          () => editor.chain().focus().toggleItalic().run(),
          editor.isActive("italic"),
        )}
        {btn(
          "format_underlined",
          "Underline",
          () => editor.chain().focus().toggleUnderline().run(),
          editor.isActive("underline"),
        )}
        {btn(
          "format_strikethrough",
          "Strikethrough",
          () => editor.chain().focus().toggleStrike().run(),
          editor.isActive("strike"),
        )}

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        {btn(
          "title",
          "Heading",
          () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
          editor.isActive("heading", { level: 3 }),
        )}
        {btn(
          "format_list_bulleted",
          "Bullet list",
          () => editor.chain().focus().toggleBulletList().run(),
          editor.isActive("bulletList"),
        )}
        {btn(
          "format_list_numbered",
          "Numbered list",
          () => editor.chain().focus().toggleOrderedList().run(),
          editor.isActive("orderedList"),
        )}

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        {btn("format_quote", "Blockquote", () =>
          editor.chain().focus().toggleBlockquote().run(),
          editor.isActive("blockquote"),
        )}
        {btn("horizontal_rule", "Divider", () =>
          editor.chain().focus().setHorizontalRule().run(),
        )}

        <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />

        {btn("undo", "Undo", () => editor.chain().focus().undo().run())}
        {btn("redo", "Redo", () => editor.chain().focus().redo().run())}
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
