/**
 * The panel's "Contribute to endoflife.date" tab: what the product still
 * lacks before it is worth proposing, the two pieces only a contribution
 * needs (category, release-policy summary) saved on the product, the
 * generated `products/<slug>.md` file, and the way to GitHub.
 *
 * Nothing is sent anywhere by Turbo EA: the user copies the file or opens
 * GitHub's new-file page and submits the pull request from their own
 * account. Proposing makes the product and its dates public, which is why
 * the tab leads with that warning.
 */
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Link from "@mui/material/Link";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import {
  EOL_DATE_CATEGORIES,
  EOL_DATE_CONTRIBUTING,
  buildEolProductFile,
  contributionReadiness,
  eolDateSlug,
  githubNewFileUrl,
  isContributionReady,
  type EolDateCategory,
} from "@/lib/eolContribution";
import { STATUS_COLORS } from "@/theme/tokens";
import type { EolCustomProduct } from "@/types";

// Stryker disable all: layout, spacing and typography are presentation; jsdom lays nothing out
const SX = {
  warning: { mb: 2 },
  intro: { mb: 2 },
  heading: { mt: 1 },
  readinessHeader: { display: "flex", alignItems: "center", gap: 1, mb: 0.5 },
  checkIcon: { minWidth: 32 },
  fields: { mt: 2 },
  actions: { display: "flex", gap: 1, justifyContent: "flex-end" },
  preview: {
    m: 0,
    p: 1.5,
    maxHeight: 360,
    overflow: "auto",
    bgcolor: "action.hover",
    borderRadius: 1,
    fontSize: 12,
    fontFamily: "monospace",
    whiteSpace: "pre",
    direction: "ltr",
  },
  previewHeading: { mt: 3, mb: 1 },
  alert: { mt: 2 },
  buttons: { display: "flex", flexWrap: "wrap", gap: 1, mt: 2 },
  steps: { mt: 0.5, mb: 1, pl: 3 },
  stepsHeading: { mt: 3 },
} as const;
// Stryker restore all

export interface CustomEolContributeTabProps {
  product: EolCustomProduct;
  canManage: boolean;
  /** Called after the category / note were saved; the parent reloads. */
  onChanged: () => void;
  onError: (message: string) => void;
}

export default function CustomEolContributeTab({
  product,
  canManage,
  onChanged,
  onError,
}: CustomEolContributeTabProps) {
  const { t } = useTranslation(["admin", "cards", "common"]);
  const savedCategory = product.eol_category ?? "";
  const savedNote = product.release_policy_note ?? "";
  const [category, setCategory] = useState<EolDateCategory | "">(savedCategory);
  const [policyNote, setPolicyNote] = useState(savedNote);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);

  const dirty = category !== savedCategory || policyNote !== savedNote;
  const readiness = contributionReadiness(product, { category: category || null, policyNote });
  const ready = isContributionReady(readiness);
  const fileName = `products/${eolDateSlug(product.key)}.md`;

  const file = useMemo(
    () =>
      category
        ? buildEolProductFile(product, {
            category,
            policyNote,
            policyPlaceholder: t("eol.custom.propose.policyPlaceholder"),
            descriptionPlaceholder: t("eol.custom.propose.descriptionPlaceholder"),
          })
        : "",
    [product, category, policyNote, t],
  );
  const githubUrl = file ? githubNewFileUrl(product.key, file) : null;

  const save = async () => {
    setSaving(true);
    try {
      await api.patch(`/eol/custom-products/${encodeURIComponent(product.key)}`, {
        eol_category: category || null,
        release_policy_note: policyNote.trim() || null,
      });
      onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setCategory(savedCategory);
    setPolicyNote(savedNote);
    setCopied(false);
  };

  const copy = async () => {
    setCopyFailed(false);
    try {
      await navigator.clipboard.writeText(file);
      setCopied(true);
    } catch {
      setCopied(false);
      setCopyFailed(true);
    }
  };

  return (
    <Box>
      <Alert severity="warning" sx={SX.warning}>
        {t("eol.custom.propose.publicWarning")}
      </Alert>
      <Typography variant="body2" color="text.secondary" sx={SX.intro}>
        {t("eol.custom.contribute.intro", { file: fileName })}
      </Typography>

      <Box sx={SX.readinessHeader}>
        <Typography variant="subtitle2">{t("eol.custom.contribute.readiness")}</Typography>
        <Chip
          size="small"
          color={ready ? "success" : "default"}
          variant={ready ? "filled" : "outlined"}
          label={t(ready ? "eol.custom.contribute.ready" : "eol.custom.contribute.notReady")}
          data-testid="eol-contribute-readiness"
        />
      </Box>
      <List dense disablePadding aria-label={t("eol.custom.contribute.readiness")}>
        {readiness.map((item) => (
          <ListItem key={item.id} disableGutters data-testid={`eol-check-${item.id}`} data-ok={item.ok}>
            <ListItemIcon sx={SX.checkIcon}>
              <MaterialSymbol
                icon={item.ok ? "check_circle" : "cancel"}
                size={20}
                color={item.ok ? STATUS_COLORS.success : STATUS_COLORS.error}
              />
            </ListItemIcon>
            <ListItemText
              primary={t(`eol.custom.contribute.check.${item.id}`)}
              secondary={item.ok ? undefined : t(`eol.custom.contribute.hint.${item.id}`)}
            />
          </ListItem>
        ))}
      </List>

      <Stack spacing={2} sx={SX.fields}>
        <FormControl fullWidth>
          <InputLabel>{t("eol.custom.propose.category")}</InputLabel>
          <Select
            label={t("eol.custom.propose.category")}
            value={category}
            displayEmpty
            renderValue={(v) =>
              v ? (
                t(`eol.custom.propose.categories.${v}`)
              ) : (
                <Typography component="em" color="text.secondary" sx={{ fontSize: "inherit" }}>
                  {t("cards:eol.custom.milestone.choose")}
                </Typography>
              )
            }
            onChange={(e) => {
              setCategory(e.target.value as EolDateCategory | "");
              setCopied(false);
            }}
            inputProps={{ "aria-label": t("eol.custom.propose.category") }}
          >
            {EOL_DATE_CATEGORIES.map((c) => (
              <MenuItem key={c} value={c}>
                {t(`eol.custom.propose.categories.${c}`)}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField
          multiline
          minRows={3}
          fullWidth
          label={t("eol.custom.contribute.policyNote")}
          helperText={t("eol.custom.contribute.policyNoteHelp")}
          placeholder={t("eol.custom.propose.policyPlaceholder")}
          value={policyNote}
          onChange={(e) => {
            setPolicyNote(e.target.value);
            setCopied(false);
          }}
          inputProps={{ maxLength: 5000 }}
        />
        {canManage && (
          <Box sx={SX.actions}>
            <Button onClick={cancel} disabled={!dirty || saving}>
              {t("common:actions.cancel")}
            </Button>
            <Button variant="contained" onClick={save} disabled={!dirty || saving}>
              {t("common:actions.save")}
            </Button>
          </Box>
        )}
      </Stack>

      <Typography variant="subtitle2" sx={SX.previewHeading}>
        {t("eol.custom.contribute.preview")}
      </Typography>
      {file ? (
        <Box component="pre" data-testid="eol-contribute-preview" sx={SX.preview}>
          {file}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {t("eol.custom.propose.chooseCategory")}
        </Typography>
      )}

      {file && !githubUrl && (
        <Alert severity="info" sx={SX.alert}>
          {t("eol.custom.propose.tooLong")}
        </Alert>
      )}
      {copied && (
        <Alert severity="success" sx={SX.alert} onClose={() => setCopied(false)}>
          {t("eol.custom.propose.copied")}
        </Alert>
      )}
      {copyFailed && (
        <Alert severity="error" sx={SX.alert} onClose={() => setCopyFailed(false)}>
          {t("eol.custom.propose.copyFailed")}
        </Alert>
      )}

      <Box sx={SX.buttons}>
        <Button
          variant="outlined"
          disabled={!file}
          onClick={copy}
          startIcon={<MaterialSymbol icon="content_copy" size={16} />}
        >
          {t("eol.custom.propose.copy")}
        </Button>
        {githubUrl ? (
          <Button
            variant="contained"
            href={githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            startIcon={<MaterialSymbol icon="open_in_new" size={16} />}
          >
            {t("eol.custom.propose.openGithub")}
          </Button>
        ) : (
          !file && (
            <Button
              variant="contained"
              disabled
              startIcon={<MaterialSymbol icon="open_in_new" size={16} />}
            >
              {t("eol.custom.propose.openGithub")}
            </Button>
          )
        )}
      </Box>

      <Typography variant="subtitle2" sx={SX.stepsHeading}>
        {t("eol.custom.contribute.stepsHeading")}
      </Typography>
      <Box component="ol" sx={SX.steps}>
        {(["fork", "file", "pr"] as const).map((step) => (
          <Typography key={step} component="li" variant="body2">
            {t(`eol.custom.contribute.steps.${step}`)}
          </Typography>
        ))}
      </Box>
      <Link
        href={EOL_DATE_CONTRIBUTING}
        target="_blank"
        rel="noopener noreferrer"
        variant="body2"
      >
        {t("eol.custom.propose.guide")}
      </Link>
    </Box>
  );
}
