/**
 * Shared building blocks for the metamodel translation editors.
 *
 * `TranslationDialog` (card types, subtypes, sections, fields, options,
 * stakeholder roles) and `RelationTranslationDialog` (relation verbs) render the
 * same two-column "English source → translation" rows. The matching cleaning
 * helpers live in `./helpers` — they were duplicated verbatim across three files
 * before this split.
 */
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

/**
 * One translatable string: the source text on the left (also the placeholder,
 * so an untranslated field still shows what it will fall back to), the
 * translation input on the right.
 *
 * `multiline` is for prose (a field's help text): the input grows to a few
 * lines and the source is clamped rather than cut to one line, with the full
 * text still in its `title`. `caption` names what the row is — a small label
 * above the source, so a sentence of prose is not read as a field key.
 */
export function TranslationRow({
  reference,
  value,
  onChange,
  multiline = false,
  caption,
}: {
  reference: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  caption?: string;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 2,
        alignItems: multiline ? "start" : "center",
        py: 0.5,
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        {caption && (
          <Typography
            variant="caption"
            color="text.secondary"
            component="div"
            sx={{ fontWeight: 600, lineHeight: 1.4 }}
          >
            {caption}
          </Typography>
        )}
        <Typography
          variant="body2"
          color="text.secondary"
          sx={
            multiline
              ? {
                  fontSize: 12,
                  overflow: "hidden",
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  whiteSpace: "pre-wrap",
                }
              : {
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontFamily: "monospace",
                  fontSize: 12,
                }
          }
          title={reference}
        >
          {reference}
        </Typography>
      </Box>
      <TextField
        size="small"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={reference}
        fullWidth
        {...(multiline ? { multiline: true, minRows: 2, maxRows: 6 } : {})}
      />
    </Box>
  );
}

/** A titled block of `TranslationRow`s with an optional count chip. */
export function TranslationGroup({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <Box sx={{ mb: 2.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
        <Typography variant="subtitle2" fontWeight={700}>
          {title}
        </Typography>
        {count !== undefined && (
          <Chip size="small" label={count} variant="outlined" sx={{ height: 20, fontSize: 11 }} />
        )}
      </Box>
      <Box sx={{ pl: 0.5 }}>{children}</Box>
    </Box>
  );
}
