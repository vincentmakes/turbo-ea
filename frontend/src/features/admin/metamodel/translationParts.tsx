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
 */
export function TranslationRow({
  reference,
  value,
  onChange,
}: {
  reference: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 2,
        alignItems: "center",
        py: 0.5,
      }}
    >
      <Typography
        variant="body2"
        color="text.secondary"
        sx={{
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          fontFamily: "monospace",
          fontSize: 12,
        }}
        title={reference}
      >
        {reference}
      </Typography>
      <TextField
        size="small"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={reference}
        fullWidth
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
