/**
 * SecurityLogEntryDrawer — right-side drawer opened from the Security & admin
 * grid. Read-only by design: an audit_log row is immutable, so unlike the
 * batch drawer there is no action here.
 *
 * Shows the entry's metadata (the layout of `AuditLogBatchDrawer`) and its
 * `details`, in plain language (`securityLogDetails.ts` splits them):
 *
 * - **Changes** — one sentence per semantic item (`field.added`, …) through
 *   `securityLog.changes.*`, every argument formatted like a cell value;
 * - a **Field / Before / After** table for `{old, new}` pairs, the field named
 *   through `securityLog.fields.*`;
 * - **Context** — labelled plain facts;
 * - the raw JSON only for what fits none of these (rows written before the
 *   `details` contract).
 *
 * Values are formatted, never shown raw: Yes / No, the workspace date format, a
 * colour swatch, a masked-secret chip, KB / MB, a language's name, a permission
 * key's description from the permission schemas, a code's label.
 */
import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useDateFormat } from "@/hooks/useDateFormat";
import { LOCALE_LABELS, type SupportedLocale } from "@/i18n";
import { originColor } from "./AuditLogBatchDrawer";
import {
  actionLabelKey,
  categoryColor,
  outcomeColor,
  reasonLabelKey,
  type SecurityLogEntry,
} from "./SecurityLogTypes";
import {
  changeKindKey,
  classifyValue,
  describeDetails,
  fieldLabelKey,
  formatBytes,
  formatTarget,
  hasPermissionValue,
  humanise,
  isEmptyDescription,
  isNameArg,
  splitTranslationProperty,
  translationScopeKey,
  valueFieldFor,
  valueLabelKey,
  type ChangeItem,
  type ChangePair,
  type DescribedDetails,
} from "./securityLogDetails";

type AppPermissionSchema = Record<string, { permissions?: Record<string, string> }>;

/** Flatten `GET /roles/permissions-schema` into `{key: description}`. */
export function flattenAppSchema(raw: AppPermissionSchema | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const group of Object.values(raw ?? {})) {
    Object.assign(out, group?.permissions ?? {});
  }
  return out;
}

/**
 * The permission keys' descriptions, fetched only when the entry shows a
 * permission. Both schemas are joined — app keys (`inventory.view`) and card
 * keys (`card.edit`) never collide.
 */
function usePermissionDescriptions(needed: boolean): Record<string, string> {
  const app = useApiQuery<AppPermissionSchema, Record<string, string>>(
    needed ? "/roles/permissions-schema" : null,
    { select: flattenAppSchema },
  );
  const card = useApiQuery<Record<string, string>>(
    needed ? "/stakeholder-roles/permissions-schema" : null,
  );
  return useMemo(() => ({ ...(card.data ?? {}), ...(app.data ?? {}) }), [app.data, card.data]);
}

export interface ValueFormatter {
  /** The value as plain text, for a sentence or a list. */
  text: (value: unknown, field: string) => string;
  /** The value as a table cell: a swatch for a colour, a chip for a secret. */
  node: (value: unknown, field: string) => ReactNode;
  /** A field name's label (`smtp_host` → "SMTP host"). */
  fieldLabel: (field: string) => string;
}

/** Formats every value the drawer shows; see the module doc for the rules. */
export function useValueFormatter(
  permissions: Record<string, string>,
  targetType?: string | null,
): ValueFormatter {
  // Keys are namespace-qualified, so the hook needs no namespace of its own.
  const { t } = useTranslation();
  const { formatDateTime } = useDateFormat();
  const empty = t("admin:auditLog.batch.emptyValue");

  const text = useCallback(
    (value: unknown, field: string): string => {
      switch (classifyValue(value, field)) {
        case "empty":
          return empty;
        case "bool":
          return t(value ? "common:labels.yes" : "common:labels.no");
        case "datetime":
          return formatDateTime(value as string);
        case "bytes":
          return formatBytes(value as number);
        case "masked":
          return t("admin:securityLog.entry.masked");
        case "permission":
          return permissions[value as string] ?? (value as string);
        case "locale":
          return LOCALE_LABELS[value as SupportedLocale] ?? (value as string);
        case "list":
          return (value as unknown[]).map((v) => text(v, field)).join(", ");
        case "code":
          // Only a code this build labels is classified as one.
          return t(`admin:${valueLabelKey(value as string)}`);
        default:
          return typeof value === "string" ? value : JSON.stringify(value);
      }
    },
    [t, empty, formatDateTime, permissions],
  );

  const node = useCallback(
    (value: unknown, field: string): ReactNode => {
      const kind = classifyValue(value, field);
      if (kind === "color") {
        return (
          <Box component="span" sx={{ display: "inline-flex", alignItems: "center", gap: 0.75 }}>
            <Box
              component="span"
              data-testid="security-color-swatch"
              aria-hidden
              sx={{
                width: 12,
                height: 12,
                borderRadius: 0.5,
                border: 1,
                borderColor: "divider",
                bgcolor: value as string,
                flexShrink: 0,
              }}
            />
            <code style={{ fontSize: 12 }}>{value as string}</code>
          </Box>
        );
      }
      if (kind === "masked") {
        return <Chip size="small" variant="outlined" label={text(value, field)} />;
      }
      if (kind === "permission") {
        return (
          <Tooltip title={value as string}>
            <span>{text(value, field)}</span>
          </Tooltip>
        );
      }
      return text(value, field);
    },
    [text],
  );

  const fieldLabel = useCallback(
    (field: string) =>
      t(
        fieldLabelKey(field, targetType).map((k) => `admin:${k}`),
        { defaultValue: humanise(field) },
      ),
    [t, targetType],
  );

  return { text, node, fieldLabel };
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Box sx={{ typography: "body2", wordBreak: "break-word" }}>{children}</Box>
    </Box>
  );
}

/** One item as a sentence: its template with every argument formatted. */
export function useItemSentence(fmt: ValueFormatter): (item: ChangeItem) => string {
  const { t } = useTranslation("admin");
  return useCallback(
    (item: ChangeItem) => {
      const args: Record<string, unknown> = {};
      const generic: string[] = [];
      for (const [arg, value] of Object.entries(item)) {
        if (arg === "kind") continue;
        let shown: string;
        if (isNameArg(item.kind, arg) && typeof value === "string") {
          const scoped = arg === "property" ? splitTranslationProperty(value) : null;
          shown = scoped
            ? t("securityLog.translationScope", {
                scope: t(translationScopeKey(scoped.scope), { defaultValue: humanise(scoped.scope) }),
                name: scoped.name,
              })
            : fmt.fieldLabel(value);
        } else {
          shown = fmt.text(value, valueFieldFor(item, arg));
        }
        args[arg] = shown;
        generic.push(`${fmt.fieldLabel(arg)} = ${shown}`);
      }
      const fallback = humanise(item.kind);
      return t(changeKindKey(item.kind), {
        ...args,
        // `count` selects a plural form (`more`), so it is passed as the number.
        count: item.count as number | undefined,
        defaultValue: generic.length > 0 ? `${fallback}: ${generic.join(", ")}` : fallback,
      });
    },
    [t, fmt],
  );
}

function ChangesList({ items, fmt }: { items: ChangeItem[]; fmt: ValueFormatter }) {
  const { t } = useTranslation("admin");
  const sentence = useItemSentence(fmt);
  return (
    <Box data-testid="security-details-items">
      <Typography variant="caption" color="text.secondary">
        {t("securityLog.entry.changes")}
      </Typography>
      <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5, typography: "body2" }}>
        {items.map((item, i) => (
          <Box component="li" key={i} data-kind={item.kind} sx={{ wordBreak: "break-word" }}>
            {sentence(item)}
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function DiffTable({ pairs, fmt }: { pairs: Record<string, ChangePair>; fmt: ValueFormatter }) {
  const { t } = useTranslation("admin");
  return (
    <TableContainer component={Paper} variant="outlined">
      <Table size="small" data-testid="security-details-diff">
        <TableHead>
          <TableRow>
            <TableCell>{t("securityLog.entry.field")}</TableCell>
            <TableCell>{t("securityLog.entry.old")}</TableCell>
            <TableCell>{t("securityLog.entry.new")}</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {Object.entries(pairs).map(([field, change]) => (
            <TableRow key={field}>
              <TableCell>
                <Tooltip title={field} placement="top-start">
                  <span>{fmt.fieldLabel(field)}</span>
                </Tooltip>
              </TableCell>
              <TableCell sx={{ wordBreak: "break-word" }}>{fmt.node(change.old, field)}</TableCell>
              <TableCell sx={{ wordBreak: "break-word" }}>{fmt.node(change.new, field)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </TableContainer>
  );
}

function ContextList({ context, fmt }: { context: Record<string, unknown>; fmt: ValueFormatter }) {
  const { t } = useTranslation("admin");
  return (
    <Box data-testid="security-details-context">
      <Typography variant="caption" color="text.secondary">
        {t("securityLog.entry.context")}
      </Typography>
      <Box component="dl" sx={{ m: 0, mt: 0.5 }}>
        {Object.entries(context).map(([key, value]) => (
          <Box key={key} sx={{ display: "flex", gap: 1, typography: "body2", minWidth: 0 }}>
            <Box component="dt" sx={{ flexShrink: 0, color: "text.secondary" }}>
              {fmt.fieldLabel(key)}
            </Box>
            <Box component="dd" sx={{ m: 0, wordBreak: "break-word" }}>
              {fmt.node(value, key)}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function DetailsBlock({
  described,
  targetType,
}: {
  described: DescribedDetails;
  targetType: string | null;
}) {
  const { t } = useTranslation("admin");
  const permissions = usePermissionDescriptions(hasPermissionValue(described));
  const fmt = useValueFormatter(permissions, targetType);
  if (isEmptyDescription(described)) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
        {t("securityLog.entry.noDetails")}
      </Typography>
    );
  }
  const { items, changes, context, legacy } = described;
  return (
    <Stack spacing={1.5}>
      {items.length > 0 && <ChangesList items={items} fmt={fmt} />}
      {Object.keys(changes).length > 0 && <DiffTable pairs={changes} fmt={fmt} />}
      {Object.keys(context).length > 0 && <ContextList context={context} fmt={fmt} />}
      {legacy && (
        <Box
          component="pre"
          data-testid="security-details-json"
          sx={{
            m: 0,
            p: 1.5,
            fontSize: 12,
            borderRadius: 1,
            bgcolor: "action.hover",
            overflowX: "auto",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {JSON.stringify(legacy, null, 2)}
        </Box>
      )}
    </Stack>
  );
}

export default function SecurityLogEntryDrawer({
  entry,
  open,
  onClose,
}: {
  entry: SecurityLogEntry | null;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation("admin");
  const { formatDateTime } = useDateFormat();

  if (!entry) return null;
  const empty = t("auditLog.batch.emptyValue");
  const described = describeDetails(entry.details);
  const reason = described.reason;
  const target = formatTarget(entry, (key, opts) => t(key, opts));

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{ sx: { width: { xs: "100%", sm: 560 } } }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2,
          py: 1.5,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <Stack direction="row" alignItems="center" gap={1}>
          <MaterialSymbol icon="admin_panel_settings" size={22} />
          <Typography variant="h6">{t("securityLog.entry.title")}</Typography>
        </Stack>
        <Tooltip title={t("securityLog.entry.close")}>
          <IconButton onClick={onClose} size="small" aria-label={t("securityLog.entry.close")}>
            <MaterialSymbol icon="close" />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ px: 2, py: 2, overflowY: "auto", flex: 1 }}>
        <Stack spacing={1.5}>
          <Meta label={t("securityLog.columns.action")}>
            <Typography variant="body1" fontWeight={600}>
              {t(actionLabelKey(entry.action), { defaultValue: entry.action })}
            </Typography>
            <code style={{ fontSize: 11 }}>{entry.action}</code>
          </Meta>

          <Stack direction="row" gap={2} flexWrap="wrap">
            <Meta label={t("securityLog.columns.category")}>
              <Chip
                size="small"
                label={t(`securityLog.categories.${entry.category}`, {
                  defaultValue: entry.category,
                })}
                variant="outlined"
                sx={{
                  mt: 0.5,
                  borderColor: categoryColor(entry.category),
                  color: categoryColor(entry.category),
                }}
              />
            </Meta>
            <Meta label={t("securityLog.columns.outcome")}>
              <Chip
                size="small"
                label={t(`securityLog.outcomes.${entry.outcome}`, {
                  defaultValue: entry.outcome,
                })}
                sx={{
                  mt: 0.5,
                  bgcolor: outcomeColor(entry.outcome),
                  color: "common.white",
                }}
              />
            </Meta>
            <Meta label={t("securityLog.columns.origin")}>
              {entry.origin ? (
                <Chip
                  size="small"
                  label={entry.origin}
                  color={originColor(entry.origin)}
                  variant={entry.origin === "mcp" ? "filled" : "outlined"}
                  sx={{ mt: 0.5 }}
                />
              ) : (
                empty
              )}
            </Meta>
            <Meta label={t("securityLog.columns.when")}>{formatDateTime(entry.created_at)}</Meta>
          </Stack>

          {reason && (
            <Meta label={t("securityLog.entry.reason")}>
              <Typography variant="body2" data-testid="security-reason">
                {t(reasonLabelKey(reason), { defaultValue: reason })}{" "}
                <code style={{ fontSize: 11, opacity: 0.7 }}>({reason})</code>
              </Typography>
            </Meta>
          )}

          <Stack direction="row" gap={2} flexWrap="wrap">
            <Meta label={t("securityLog.columns.actor")}>{entry.actor_email ?? empty}</Meta>
            <Meta label={t("securityLog.columns.subject")}>{entry.subject_email ?? empty}</Meta>
            <Meta label={t("securityLog.columns.target")}>{target ?? empty}</Meta>
          </Stack>

          <Stack direction="row" gap={2} flexWrap="wrap">
            <Meta label={t("securityLog.columns.ip")}>
              {entry.ip ? <code>{entry.ip}</code> : empty}
            </Meta>
            <Meta label={t("securityLog.columns.impersonatedRole")}>
              {entry.impersonated_role ?? empty}
            </Meta>
          </Stack>

          <Meta label={t("securityLog.columns.userAgent")}>
            {entry.user_agent ? (
              <code style={{ fontSize: 11 }}>{entry.user_agent}</code>
            ) : (
              empty
            )}
          </Meta>

          <Divider sx={{ my: 1 }} />

          <Typography variant="subtitle2">{t("securityLog.entry.details")}</Typography>
          <DetailsBlock described={described} targetType={entry.target_type} />
        </Stack>
      </Box>
    </Drawer>
  );
}
