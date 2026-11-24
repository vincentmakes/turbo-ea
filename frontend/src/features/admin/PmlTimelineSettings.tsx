import { useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api, apiErrorMessage } from "@/api/client";
import { hasPermission } from "@/components/RequirePermission";
import { useOptionalAuthUser } from "@/hooks/AuthContext";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useFieldLabel } from "@/hooks/useResolveLabel";
import { useSubmitOnce } from "@/hooks/useSubmitOnce";
import type { FieldDef } from "@/types";

interface Mapping {
  actual_start_key: string | null;
  actual_end_key: string | null;
}

const path = "/settings/pml/timeline";

export default function PmlTimelineSettings() {
  const { t } = useTranslation(["admin", "common"]);
  const { data, loading, error } = useApiQuery<Mapping>(path);
  const metamodel = useMetamodel();
  const user = useOptionalAuthUser();
  if (loading || metamodel.loading) return <CircularProgress size={24} />;
  if (error || !data)
    return <Alert severity="error">{error?.message || t("pml.timeline.loadError")}</Alert>;

  const initiative = metamodel.types.find((type) => type.key === "Initiative");
  if (!initiative) return <Alert severity="error">{t("pml.timeline.loadError")}</Alert>;
  const fields = initiative.fields_schema?.flatMap((section) => section?.fields ?? []) ?? [];
  return (
    <TimelineEditor
      initial={data}
      fields={fields}
      canCreate={hasPermission(user?.permissions, "admin.metamodel")}
      refreshMetamodel={metamodel.invalidateCache}
    />
  );
}

function TimelineEditor({
  initial,
  fields,
  canCreate,
  refreshMetamodel,
}: {
  initial: Mapping;
  fields: FieldDef[];
  canCreate: boolean;
  refreshMetamodel: () => Promise<void>;
}) {
  const { t } = useTranslation(["admin", "common"]);
  const fieldLabel = useFieldLabel();
  const [mapping, setMapping] = useState(initial);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const submit = useSubmitOnce();
  const options = fields.filter(
    (field) =>
      field.type === "date" &&
      !field.readonly &&
      !field.ext_locked &&
      field.key !== "startDate" &&
      field.key !== "endDate",
  );

  const availableKey = (key: string | null) =>
    options.some((field) => field.key === key) ? key : null;

  const save = async (createDefaults: ("start" | "end")[] = []) => {
    setError("");
    setSaved(false);
    try {
      await submit.run(async () => {
        const request = {
          actual_start_key: availableKey(mapping.actual_start_key),
          actual_end_key: availableKey(mapping.actual_end_key),
          create_defaults: createDefaults,
        };
        const next = await api.put<Mapping>(path, request);
        setMapping(next);
        setSaved(true);
        if (createDefaults.length) await refreshMetamodel();
      });
    } catch (err) {
      setError(apiErrorMessage(err, t("pml.timeline.loadError")));
    }
  };

  const select = (side: "start" | "end") => {
    const name = side === "start" ? "actual_start_key" : "actual_end_key";
    const other = side === "start" ? mapping.actual_end_key : mapping.actual_start_key;
    const label = side === "start" ? t("pml.timeline.actualStart") : t("pml.timeline.actualEnd");
    const defaultKey = side === "start" ? "actualStart" : "actualEnd";
    const selected = availableKey(mapping[name]);
    const canCreateDefault =
      canCreate && !selected && !fields.some((field) => field.key === defaultKey);
    return (
      <Box key={side} sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap" }}>
        <TextField
          select
          label={label}
          value={selected ?? ""}
          disabled={submit.busy}
          onChange={(event) => {
            setMapping({ ...mapping, [name]: event.target.value || null });
            setSaved(false);
          }}
          sx={{ minWidth: 240, flex: 1 }}
        >
          <MenuItem value="">{t("pml.timeline.none")}</MenuItem>
          {options.map((field) => (
            <MenuItem key={field.key} value={field.key} disabled={field.key === other}>
              {fieldLabel(field)}
            </MenuItem>
          ))}
        </TextField>
        {canCreateDefault && (
          <Button onClick={() => void save([side])} disabled={submit.busy}>
            {side === "start" ? t("pml.timeline.createStart") : t("pml.timeline.createEnd")}
          </Button>
        )}
      </Box>
    );
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h6">{t("pml.timeline.title")}</Typography>
      {error && <Alert severity="error">{error}</Alert>}
      {saved && <Alert severity="success">{t("pml.timeline.saved")}</Alert>}
      {select("start")}
      {select("end")}
      <Box>
        <Button variant="contained" onClick={() => void save()} disabled={submit.busy}>
          {t("common:actions.save")}
        </Button>
      </Box>
    </Box>
  );
}
