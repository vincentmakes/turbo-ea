import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import CardPicker, { type CardOption } from "@/components/CardPicker";

/**
 * Thin multi-select wrapper around the shared single-select `CardPicker`
 * (per CLAUDE.md every inventory picker must reuse CardPicker): each pick
 * appends a removable chip, already-picked cards are excluded from the list.
 */
export default function MultiCardPicker({
  types,
  values,
  onChange,
  label,
}: {
  types?: string | string[];
  values: CardOption[];
  onChange: (values: CardOption[]) => void;
  label?: string;
}) {
  return (
    <Box>
      <CardPicker
        types={types}
        value={null}
        onChange={(v) => {
          if (v && !values.some((x) => x.id === v.id)) onChange([...values, v]);
        }}
        excludeIds={values.map((v) => v.id)}
        label={label}
      />
      {values.length > 0 && (
        <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap sx={{ mt: 1 }}>
          {values.map((v) => (
            <Chip
              key={v.id}
              label={v.name}
              size="small"
              onDelete={() => onChange(values.filter((x) => x.id !== v.id))}
            />
          ))}
        </Stack>
      )}
    </Box>
  );
}
