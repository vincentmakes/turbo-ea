/**
 * Create a dashboard, or edit one's name, description, icon and access.
 *
 * Access is a list of role keys: empty means every role. A role with full
 * access (the wildcard) sees every dashboard anyway, so it is shown as an
 * always-included, disabled chip and never sent (the API refuses it). A role
 * that has since been archived stays in the list as an inert, outlined chip
 * until someone removes it — it grants nothing.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import IconPicker from "@/components/IconPicker";
import { api } from "@/api/client";
import { useApiQuery } from "@/hooks/useApiQuery";
import type { AppRole, Dashboard } from "@/types";
import { isWildcardRole } from "./dashboardUtils";

const DEFAULT_ICON = "dashboard";
const MAX_NAME = 200;

interface Props {
  open: boolean;
  /** The dashboard to edit; omitted to create one. */
  dashboard?: Dashboard | null;
  onClose: () => void;
  onSaved: (dashboard: Dashboard) => void;
}

/** A row of the access picker. */
interface RoleOption {
  key: string;
  label: string;
  color?: string;
  archived: boolean;
  wildcard: boolean;
}

export default function DashboardSettingsDialog({ open, dashboard, onClose, onSaved }: Props) {
  const { t } = useTranslation("common");
  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth disableRestoreFocus>
      <DialogTitle>{dashboard ? t("dashboard.settings.editTitle") : t("dashboard.settings.createTitle")}</DialogTitle>
      {open && <SettingsForm dashboard={dashboard ?? null} onClose={onClose} onSaved={onSaved} />}
    </Dialog>
  );
}

function SettingsForm({
  dashboard,
  onClose,
  onSaved,
}: {
  dashboard: Dashboard | null;
  onClose: () => void;
  onSaved: (dashboard: Dashboard) => void;
}) {
  const { t } = useTranslation("common");
  const [name, setName] = useState(dashboard?.name ?? "");
  const [description, setDescription] = useState(dashboard?.description ?? "");
  const [icon, setIcon] = useState(dashboard?.icon || DEFAULT_ICON);
  const [roleKeys, setRoleKeys] = useState<string[]>(dashboard?.allowed_roles ?? []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  // Archived roles are fetched too, so a stored archived key still has a label.
  const { data: roles } = useApiQuery<AppRole[]>("/roles?include_archived=true");

  const options = useMemo<RoleOption[]>(
    () =>
      (roles ?? []).map((r) => ({
        key: r.key,
        label: r.label,
        color: r.color,
        archived: r.is_archived,
        wildcard: isWildcardRole(r),
      })),
    [roles],
  );
  const byKey = useMemo(() => new Map(options.map((o) => [o.key, o])), [options]);
  const wildcard = options.filter((o) => o.wildcard && !o.archived);
  const selectable = options.filter((o) => !o.wildcard && !o.archived);

  const selected: RoleOption[] = roleKeys
    .filter((key) => !byKey.get(key)?.wildcard)
    .map((key) => byKey.get(key) ?? { key, label: key, archived: true, wildcard: false });
  // The wildcard roles head the list once access is restricted at all.
  const value = selected.length > 0 ? [...wildcard, ...selected] : [];

  const trimmed = name.trim();
  const nameError = trimmed === "" ? t("dashboard.settings.nameRequired") : null;
  const tooLong = trimmed.length > MAX_NAME;

  const handleSave = async () => {
    setTouched(true);
    if (nameError || tooLong) return;
    setSaving(true);
    setError(null);
    const body = {
      name: trimmed,
      description: description.trim() || null,
      icon: icon || null,
      allowed_roles: selected.map((o) => o.key),
    };
    try {
      const saved = dashboard
        ? await api.patch<Dashboard>(`/dashboards/${dashboard.id}`, body)
        : await api.post<Dashboard>("/dashboards", body);
      onSaved(saved);
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : t("dashboard.settings.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <DialogContent>
        <Stack spacing={2.5} sx={{ pt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}
          <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
            <Box>
              <IconPicker value={icon} onChange={setIcon} />
            </Box>
            <TextField
              size="small"
              fullWidth
              required
              autoFocus
              label={t("dashboard.settings.name")}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => setTouched(true)}
              error={touched && (!!nameError || tooLong)}
              helperText={touched ? (nameError ?? (tooLong ? t("dashboard.settings.nameTooLong") : " ")) : " "}
              slotProps={{ htmlInput: { "data-testid": "dashboard-name" } }}
            />
          </Box>
          <TextField
            size="small"
            fullWidth
            multiline
            minRows={2}
            label={t("dashboard.settings.description")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Autocomplete
            multiple
            options={selectable}
            value={value}
            disableCloseOnSelect
            isOptionEqualToValue={(a, b) => a.key === b.key}
            getOptionLabel={(o) => o.label}
            getOptionDisabled={(o) => o.wildcard}
            onChange={(_, next) => setRoleKeys(next.filter((o) => !o.wildcard).map((o) => o.key))}
            renderTags={(items, getTagProps) =>
              items.map((o, index) => {
                const { key, ...itemProps } = getTagProps({ index });
                const inert = o.wildcard;
                return (
                  <Chip
                    key={key}
                    {...itemProps}
                    size="small"
                    label={
                      o.wildcard
                        ? t("dashboard.settings.alwaysIncluded", { label: o.label })
                        : o.archived
                          ? t("dashboard.settings.archivedRole", { label: o.label })
                          : o.label
                    }
                    variant={o.archived ? "outlined" : "filled"}
                    disabled={inert}
                    onDelete={inert ? undefined : itemProps.onDelete}
                    data-testid={`role-chip-${o.key}`}
                    sx={
                      o.archived || !o.color
                        ? undefined
                        : { bgcolor: o.color, color: (theme) => theme.palette.getContrastText(o.color!) }
                    }
                  />
                );
              })
            }
            renderInput={(params) => (
              <TextField
                {...params}
                size="small"
                label={t("dashboard.settings.access")}
                placeholder={value.length === 0 ? t("dashboard.settings.everyone") : undefined}
                helperText={t("dashboard.settings.accessHelp")}
              />
            )}
          />
          {value.length === 0 && (
            <Typography variant="caption" color="text.secondary" data-testid="access-everyone">
              {t("dashboard.settings.everyoneHint")}
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t("actions.cancel")}</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving || (touched && (!!nameError || tooLong))}>
          {dashboard ? t("actions.save") : t("actions.create")}
        </Button>
      </DialogActions>
    </>
  );
}
