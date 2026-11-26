/**
 * Import a language-pack file into a custom language: parse it in the
 * browser, refuse a file that is not a pack, ask before importing a pack made
 * for another language code, then send one namespace per request (a full pack
 * can exceed a request-size limit) and report what the server applied and
 * rejected. The `metamodel` namespace (database labels) is posted like any
 * other; the server skips a label whose English changed since the pack was
 * made (`source_changed`).
 */
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import LinearProgress from "@mui/material/LinearProgress";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import type {
  CustomLocale,
  CustomLocaleRejectedString,
  CustomLocaleWriteResult,
  LanguagePack,
} from "@/types";
import {
  errorMessage,
  importBody,
  namespaceLabel,
  parseLanguagePack,
  percent,
  readFileText,
  reasonLabel,
  type PackParseError,
  FATAL_IMPORT_STATUSES,
  MAX_PACK_BYTES,
  apiErrorStatus,
} from "./customLocaleUtils";

interface Props {
  locale: CustomLocale;
  onClose: () => void;
  /** Called once an import ran (whatever it applied). */
  onImported: () => void;
}

interface Parsed {
  fileName: string;
  pack: LanguagePack;
  namespaces: string[];
  stringCount: number;
  skipped: number;
}

interface Report {
  applied: number;
  unchanged: number;
  cleared: number;
  unknown: number;
  unknownKeys: { namespace: string; key: string }[];
  rejected: CustomLocaleRejectedString[];
  failedNamespaces: { namespace: string; message: string }[];
  /** Set when a failure that would repeat for every namespace stopped the import. */
  stopped: string | null;
}

const PARSE_ERROR_KEYS: Record<PackParseError, string> = {
  invalid_json: "customLocales.import.invalidJson",
  not_a_pack: "customLocales.import.notAPack",
  unsupported_version: "customLocales.import.unsupportedVersion",
  no_strings: "customLocales.import.noStrings",
};

/** Rejections listed in the report; the rest are summarised by count. */
const MAX_LISTED_REJECTIONS = 100;
/** Unknown keys named under their count. */
const MAX_LISTED_UNKNOWN = 10;

function count(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

export default function ImportPackDialog({ locale, onClose, onImported }: Props) {
  const { t } = useTranslation(["admin", "common"]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [parseError, setParseError] = useState("");
  // Stryker disable next-line BooleanLiteral: handleFile clears it before any pack can be imported
  const [confirmMismatch, setConfirmMismatch] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<Report | null>(null);

  const mismatch = parsed !== null && parsed.pack.locale.code !== locale.code;

  const handleFile = async (file: File | undefined) => {
    setParsed(null);
    setParseError("");
    setConfirmMismatch(false);
    setReport(null);
    if (!file) return;
    if (file.size > MAX_PACK_BYTES) {
      setParseError(t("customLocales.import.tooLarge"));
      return;
    }
    let text: string;
    try {
      text = await readFileText(file);
      // Stryker disable next-line BlockStatement: with an empty catch `text` stays undefined, and parseLanguagePack answers invalid_json — the same message
    } catch {
      setParseError(t("customLocales.import.invalidJson"));
      return;
    }
    const result = parseLanguagePack(text);
    if (!result.ok) {
      setParseError(t(PARSE_ERROR_KEYS[result.error]));
      return;
    }
    setParsed({
      fileName: file.name,
      pack: result.pack,
      namespaces: result.namespaces,
      stringCount: result.stringCount,
      skipped: result.skipped,
    });
  };

  const handleImport = async () => {
    // Stryker disable next-line ConditionalExpression: Import is only enabled once a pack is parsed
    if (!parsed) return;
    setRunning(true);
    setProgress(0);
    const total: Report = {
      applied: 0,
      unchanged: 0,
      cleared: 0,
      unknown: 0,
      unknownKeys: [],
      rejected: [],
      failedNamespaces: [],
      stopped: null,
    };
    const path = `/custom-locales/${encodeURIComponent(locale.code)}/strings`;
    for (let i = 0; i < parsed.namespaces.length; i++) {
      const ns = parsed.namespaces[i];
      try {
        const r = await api.post<CustomLocaleWriteResult>(path, importBody(parsed.pack, ns));
        total.applied += count(r?.applied);
        total.unchanged += count(r?.unchanged);
        total.cleared += count(r?.cleared);
        total.unknown += count(r?.unknown);
        if (Array.isArray(r?.unknown_keys)) total.unknownKeys.push(...r.unknown_keys);
        if (Array.isArray(r?.rejected)) total.rejected.push(...r.rejected);
      } catch (e) {
        const message = errorMessage(
          e,
          t,
          e instanceof Error && e.message ? e.message : t("customLocales.import.requestFailed"),
        );
        if (FATAL_IMPORT_STATUSES.has(apiErrorStatus(e))) {
          // Signed out, not allowed, language gone, catalogue missing: every
          // other namespace would fail the same way.
          total.stopped = message;
          break;
        }
        total.failedNamespaces.push({ namespace: ns, message });
      }
      setProgress(percent(i + 1, parsed.namespaces.length));
    }
    setRunning(false);
    setReport(total);
    onImported();
  };

  const canImport = parsed !== null && !running && !report && (!mismatch || confirmMismatch);

  return (
    <Dialog open onClose={running ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t("customLocales.import.title", { name: locale.name })}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("customLocales.import.description")}
        </Typography>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="language-pack-input"
          onChange={(e) => {
            // Stryker disable next-line OptionalChaining: an <input type="file"> always has a FileList
            void handleFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <Button
          variant="outlined"
          startIcon={<MaterialSymbol icon="upload_file" size={18} />}
          // Stryker disable next-line OptionalChaining: the input is mounted before its button can be clicked
          onClick={() => inputRef.current?.click()}
          disabled={running}
        >
          {t("customLocales.import.chooseFile")}
        </Button>

        {parseError && (
          <Alert severity="error" sx={{ mt: 2 }}>
            {parseError}
          </Alert>
        )}

        {parsed && (
          <Box sx={{ mt: 2 }}>
            <Typography variant="body2">
              {t("customLocales.import.summary", {
                file: parsed.fileName,
                count: parsed.stringCount,
                namespaces: parsed.namespaces.length,
              })}
            </Typography>
            {parsed.skipped > 0 && (
              <Typography variant="body2" color="text.secondary">
                {t("customLocales.import.skippedNonText", { count: parsed.skipped })}
              </Typography>
            )}
            {mismatch && (
              <Alert severity="warning" sx={{ mt: 1 }}>
                {t("customLocales.import.codeMismatch", {
                  packCode: parsed.pack.locale.code,
                  code: locale.code,
                })}
                <FormControlLabel
                  sx={{ display: "block", mt: 1 }}
                  control={
                    <Checkbox
                      size="small"
                      checked={confirmMismatch}
                      onChange={(e) => setConfirmMismatch(e.target.checked)}
                    />
                  }
                  label={t("customLocales.import.confirmMismatch")}
                />
              </Alert>
            )}
          </Box>
        )}

        {(running || report) && (
          <Box sx={{ mt: 2 }}>
            <LinearProgress
              variant="determinate"
              value={progress}
              aria-label={t("customLocales.import.progress")}
            />
          </Box>
        )}

        {report && (
          <Box sx={{ mt: 2 }} data-testid="import-report">
            <Alert
              severity={
                report.rejected.length || report.failedNamespaces.length || report.stopped
                  ? "warning"
                  : "success"
              }
            >
              {t("customLocales.import.result", {
                applied: report.applied,
                unchanged: report.unchanged,
                cleared: report.cleared,
                rejected: report.rejected.length,
                unknown: report.unknown,
              })}
            </Alert>
            {report.stopped && (
              <Alert severity="error" sx={{ mt: 1 }}>
                {t("customLocales.import.stopped", { message: report.stopped })}
              </Alert>
            )}
            {report.unknownKeys.length > 0 && (
              <Box sx={{ mt: 1 }} data-testid="import-unknown-keys">
                <Typography variant="subtitle2">{t("customLocales.import.unknownTitle")}</Typography>
                {report.unknownKeys.slice(0, MAX_LISTED_UNKNOWN).map((u) => (
                  <Typography key={`${u.namespace}:${u.key}`} variant="body2" color="text.secondary">
                    {`${namespaceLabel(u.namespace, t)} · ${u.key}`}
                  </Typography>
                ))}
              </Box>
            )}
            {report.failedNamespaces.map((f) => (
              <Alert severity="error" sx={{ mt: 1 }} key={f.namespace}>
                {t("customLocales.import.namespaceFailed", {
                  namespace: namespaceLabel(f.namespace, t),
                  message: f.message,
                })}
              </Alert>
            ))}
            {report.rejected.length > 0 && (
              <>
                <Typography variant="subtitle2" sx={{ mt: 2 }}>
                  {t("customLocales.import.rejectedTitle")}
                </Typography>
                <List dense disablePadding>
                  {report.rejected.slice(0, MAX_LISTED_REJECTIONS).map((r) => (
                    <ListItem key={`${r.namespace}:${r.key}`} disableGutters>
                      <ListItemText
                        primary={`${namespaceLabel(r.namespace, t)} · ${r.key}`}
                        secondary={reasonLabel(r.reason, t)}
                      />
                    </ListItem>
                  ))}
                </List>
                {report.rejected.length > MAX_LISTED_REJECTIONS && (
                  <Typography variant="caption" color="text.secondary">
                    {t("customLocales.import.moreRejected", {
                      count: report.rejected.length - MAX_LISTED_REJECTIONS,
                    })}
                  </Typography>
                )}
              </>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={running}>
          {t("common:actions.close")}
        </Button>
        {!report && (
          <Button variant="contained" onClick={handleImport} disabled={!canImport}>
            {t("common:actions.import")}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
