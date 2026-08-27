import Typography from "@mui/material/Typography";
import { ExtensionBoundary, useExtensionFieldTypes } from "@/lib/extensionHost";
import type { FieldDef } from "@/types";

/**
 * Inventory grid cell for an extension-typed (`ext.*`) attribute column:
 * renders the registered field-type display through the same registry and
 * boundary as card detail's FieldValue, so a custom type looks identical in
 * both places. When the extension is missing/disabled/unlicensed the value
 * degrades to plain text — rendering is never gated. Read-only by design:
 * ext-typed cells are never grid-editable.
 */
export default function ExtFieldCell({ field, value }: { field: FieldDef; value: unknown }) {
  const extFieldTypes = useExtensionFieldTypes();
  const registered = extFieldTypes[field.type];
  if (!registered?.contribution.display) {
    if (value === null || value === undefined || value === "") return null;
    return <Typography variant="body2">{String(value)}</Typography>;
  }
  const Display = registered.contribution.display;
  return (
    <ExtensionBoundary extensionKey={registered.extKey}>
      <Display
        field={{ key: field.key, label: field.label, type: field.type, config: field.config }}
        value={value}
        config={field.config ?? registered.contribution.defaultConfig}
      />
    </ExtensionBoundary>
  );
}
