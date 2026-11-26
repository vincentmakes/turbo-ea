/**
 * The report of a merge into a custom language — what was applied, unchanged,
 * cleared, rejected (with each reason) and not a string of this version. Shown
 * after a file import (`ImportPackDialog`) and after an install from the
 * community library (`CommunityInstallDialog`).
 */
import { useTranslation } from "react-i18next";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import Typography from "@mui/material/Typography";
import {
  MAX_LISTED_REJECTIONS,
  MAX_LISTED_UNKNOWN,
  namespaceLabel,
  reasonLabel,
  type ImportReportData,
} from "./customLocaleUtils";

export default function ImportReport({ report }: { report: ImportReportData }) {
  const { t } = useTranslation(["admin", "common"]);
  const troubled = report.rejected.length > 0 || report.failedNamespaces.length > 0 || !!report.stopped;
  return (
    <Box sx={{ mt: 2 }} data-testid="import-report">
      <Alert severity={troubled ? "warning" : "success"}>
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
  );
}
