import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import { invalidateCache as invalidateMetamodel } from "@/hooks/useMetamodel";
import { ExtensionBoundary, useExtensionUI } from "@/lib/extensionHost";

interface EntitlementInfo {
  state: "active" | "grace" | "expired" | "unlicensed";
  plan: string;
  expires_at?: string | null;
  grace_until?: string | null;
}

interface ExtensionInfo {
  key: string;
  name: string;
  version: string;
  status: string;
  enabled: boolean;
  capabilities: string[];
  last_error?: string | null;
  entitlement: EntitlementInfo;
}

interface LicenseInfo {
  licensee: string;
  customer_id: string;
  issued_at?: string | null;
  grace_days: number;
  entitlements: {
    extension_key: string;
    plan: string;
    expires_at?: string | null;
  }[];
  uploaded_at?: string | null;
}

interface InstallReport {
  dry_run?: boolean;
  sections?: {
    sheet: string;
    created: number;
    updated: number;
    skipped: number;
    conflict: number;
    failed: number;
    errors: string[];
  }[];
  totals?: {
    created: number;
    updated: number;
    skipped: number;
    conflict: number;
    failed: number;
  };
}

interface ExtensionInstall {
  id: string;
  filename: string;
  status: string;
  extension_key?: string | null;
  extension_version?: string | null;
  diff?: InstallReport | null;
  result?: InstallReport | null;
  error_message?: string | null;
}

const POLL_MS = 2000;
const TERMINAL = new Set(["previewed", "installed", "failed"]);

const ENTITLEMENT_COLOR: Record<
  EntitlementInfo["state"],
  "success" | "warning" | "error" | "default"
> = {
  active: "success",
  grace: "warning",
  expired: "error",
  unlicensed: "default",
};

const STATUS_COLOR: Record<string, "success" | "warning" | "error" | "default"> = {
  installed: "success",
  needs_restart: "warning",
  disabled: "default",
  failed: "error",
};

export default function ExtensionsAdmin() {
  const { t } = useTranslation("admin");

  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // License form
  const [licenseText, setLicenseText] = useState("");
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const licenseFileRef = useRef<HTMLInputElement>(null);

  // Bundle install
  const [install, setInstall] = useState<ExtensionInstall | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const bundleFileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Uninstall confirmation
  const [uninstallKey, setUninstallKey] = useState<string | null>(null);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => clearPoll(), [clearPoll]);

  const loadAll = useCallback(async () => {
    try {
      const [exts, lic] = await Promise.all([
        api.get<ExtensionInfo[]>("/admin/extensions"),
        api.get<LicenseInfo>("/admin/extensions/license").catch(() => null),
      ]);
      setExtensions(exts);
      setLicense(lic);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const poll = useCallback(
    (id: string) => {
      clearPoll();
      pollRef.current = setTimeout(async () => {
        try {
          const next = await api.get<ExtensionInstall>(`/admin/extensions/install/${id}`);
          setInstall(next);
          if (!TERMINAL.has(next.status)) {
            poll(id);
          } else if (next.status === "installed") {
            // Content packs can add card types — refresh the metamodel cache.
            void invalidateMetamodel();
            void loadAll();
          }
        } catch (e) {
          setInstallError(e instanceof Error ? e.message : String(e));
        }
      }, POLL_MS);
    },
    [clearPoll, loadAll],
  );

  const submitLicense = async (text: string) => {
    setLicenseBusy(true);
    setLicenseError(null);
    try {
      await api.put("/admin/extensions/license", { text });
      setLicenseText("");
      await loadAll();
    } catch (e) {
      setLicenseError(e instanceof Error ? e.message : String(e));
    } finally {
      setLicenseBusy(false);
    }
  };

  const handleLicenseFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    if (licenseFileRef.current) licenseFileRef.current.value = "";
    await submitLicense(text);
  };

  const handleBundleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setInstallBusy(true);
    setInstallError(null);
    setInstall(null);
    try {
      const created = await api.upload<ExtensionInstall>("/admin/extensions/install", file);
      setInstall(created);
      poll(created.id);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallBusy(false);
      if (bundleFileRef.current) bundleFileRef.current.value = "";
    }
  };

  const handleApply = async () => {
    if (!install) return;
    setInstallBusy(true);
    setInstallError(null);
    try {
      const updated = await api.post<ExtensionInstall>(
        `/admin/extensions/install/${install.id}/apply`,
      );
      setInstall(updated);
      poll(updated.id);
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallBusy(false);
    }
  };

  const handleDiscard = async () => {
    if (!install) return;
    clearPoll();
    try {
      await api.delete(`/admin/extensions/install/${install.id}`);
    } catch {
      /* best-effort cleanup */
    }
    setInstall(null);
    setInstallError(null);
  };

  const handleToggle = async (ext: ExtensionInfo) => {
    try {
      await api.put(`/admin/extensions/${ext.key}/enabled`, { enabled: !ext.enabled });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUninstall = async () => {
    if (!uninstallKey) return;
    try {
      await api.delete(`/admin/extensions/${uninstallKey}`);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUninstallKey(null);
    }
  };

  const needsRestart = extensions.some((x) => x.status === "needs_restart");
  const isWorking = install ? !TERMINAL.has(install.status) : false;
  const report = install?.result || install?.diff || null;

  const uiExtensions = useExtensionUI();
  const adminPanels = uiExtensions.flatMap(({ key, plugin }) =>
    (plugin.adminPanels ?? []).map((panel) => ({ extKey: key, panel })),
  );

  const fmtDate = (iso?: string | null) => (iso ? new Date(iso).toLocaleDateString() : "");

  const entitlementChip = (ent: EntitlementInfo) => {
    const label =
      ent.state === "active"
        ? ent.expires_at
          ? t("extensions.entitlement.activeUntil", "Active until {{date}}", {
              date: fmtDate(ent.expires_at),
            })
          : t("extensions.entitlement.active", "Active")
        : ent.state === "grace"
          ? t("extensions.entitlement.grace", "Grace until {{date}}", {
              date: fmtDate(ent.grace_until),
            })
          : ent.state === "expired"
            ? t("extensions.entitlement.expired", "Expired")
            : t("extensions.entitlement.unlicensed", "Unlicensed");
    return <Chip size="small" color={ENTITLEMENT_COLOR[ent.state]} label={label} />;
  };

  return (
    <Stack spacing={3}>
      <Typography variant="body2" color="text.secondary">
        {t(
          "extensions.intro",
          "Install vendor-signed extensions to add customer-specific capabilities without changing the core. Extensions and licenses are delivered as files, so everything works on air-gapped instances.",
        )}
      </Typography>

      {error && <Alert severity="error">{error}</Alert>}

      {needsRestart && (
        <Alert severity="warning" icon={<MaterialSymbol icon="restart_alt" />}>
          {t(
            "extensions.needsRestart",
            "One or more extensions carry backend or UI code that loads at startup. Restart the backend container to finish (docker compose restart backend).",
          )}
        </Alert>
      )}

      {/* License */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t("extensions.license.title", "License")}
          </Typography>
          {license ? (
            <Box sx={{ mb: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <MaterialSymbol icon="verified" size={20} />
                <Typography variant="subtitle2">
                  {t("extensions.license.licensedTo", "Licensed to {{name}}", {
                    name: license.licensee,
                  })}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {t("extensions.license.uploaded", "uploaded {{date}}", {
                    date: fmtDate(license.uploaded_at),
                  })}
                </Typography>
              </Stack>
              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                {license.entitlements.map((ent) => (
                  <Chip
                    key={ent.extension_key}
                    size="small"
                    variant="outlined"
                    label={
                      ent.expires_at
                        ? `${ent.extension_key} · ${fmtDate(ent.expires_at)}`
                        : ent.extension_key
                    }
                  />
                ))}
              </Stack>
            </Box>
          ) : (
            <Alert severity="info" sx={{ mb: 2 }}>
              {t(
                "extensions.license.none",
                "No license installed. Paste the license text you received (or upload the license file) to activate extensions.",
              )}
            </Alert>
          )}
          <TextField
            value={licenseText}
            onChange={(e) => setLicenseText(e.target.value)}
            placeholder={t("extensions.license.placeholder", "Paste license text here…")}
            multiline
            minRows={3}
            fullWidth
            size="small"
            sx={{ mb: 1, fontFamily: "monospace" }}
          />
          <input ref={licenseFileRef} type="file" accept=".tealic,.json,.txt" hidden onChange={handleLicenseFile} />
          <Stack direction="row" spacing={1}>
            <Button
              variant="contained"
              disabled={licenseBusy || !licenseText.trim()}
              onClick={() => void submitLicense(licenseText)}
              startIcon={
                licenseBusy ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <MaterialSymbol icon="key" />
                )
              }
            >
              {t("extensions.license.apply", "Apply license")}
            </Button>
            <Button
              variant="outlined"
              disabled={licenseBusy}
              onClick={() => licenseFileRef.current?.click()}
              startIcon={<MaterialSymbol icon="upload_file" />}
            >
              {t("extensions.license.uploadFile", "Upload license file…")}
            </Button>
          </Stack>
          {licenseError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {licenseError}
            </Alert>
          )}
        </CardContent>
      </Card>
      {/* Install bundle */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t("extensions.install.title", "Install extension")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {t(
              "extensions.install.help",
              "Upload a signed .teax bundle. The signature is verified and a preview is shown before anything is applied — unsigned or tampered bundles are rejected.",
            )}
          </Typography>

          <input ref={bundleFileRef} type="file" accept=".teax,.zip" hidden onChange={handleBundleFile} />
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              variant="outlined"
              onClick={() => bundleFileRef.current?.click()}
              disabled={installBusy || isWorking}
              startIcon={
                installBusy ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <MaterialSymbol icon="upload" />
                )
              }
            >
              {installBusy
                ? t("extensions.install.uploading", "Uploading…")
                : t("extensions.install.choose", "Choose bundle…")}
            </Button>
            {install && (
              <Button color="inherit" onClick={handleDiscard} disabled={install.status === "applying"}>
                {t("extensions.install.discard", "Discard")}
              </Button>
            )}
          </Stack>

          {installError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {installError}
            </Alert>
          )}

          {install && (
            <Box sx={{ mt: 2 }}>
              <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                <Typography variant="subtitle2">{install.filename}</Typography>
                {install.extension_key && (
                  <Chip
                    size="small"
                    variant="outlined"
                    label={`${install.extension_key} ${install.extension_version ?? ""}`}
                  />
                )}
                <Chip size="small" label={install.status} />
              </Stack>

              {isWorking && <LinearProgress sx={{ mb: 2 }} />}

              {install.error_message && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {install.error_message}
                </Alert>
              )}

              {report?.totals && (
                <Box sx={{ mb: 1 }}>
                  <Typography variant="body2" sx={{ mb: 0.5 }}>
                    {t("extensions.install.previewSummary", "Content preview")} —{" "}
                    {t("extensions.install.created", "Created")}: {report.totals.created},{" "}
                    {t("extensions.install.updated", "Updated")}: {report.totals.updated},{" "}
                    {t("extensions.install.skipped", "Skipped")}: {report.totals.skipped},{" "}
                    {t("extensions.install.failed", "Failed")}: {report.totals.failed}
                  </Typography>
                  <Table size="small">
                    <TableBody>
                      {(report.sections ?? [])
                        .filter((s) => s.created || s.updated || s.skipped || s.failed)
                        .map((s) => (
                          <TableRow key={s.sheet}>
                            <TableCell>{s.sheet}</TableCell>
                            <TableCell align="right">
                              {s.created
                                ? t("extensions.install.nCreated", "{{n}} created", { n: s.created })
                                : ""}
                            </TableCell>
                            <TableCell align="right">
                              {s.updated
                                ? t("extensions.install.nUpdated", "{{n}} updated", { n: s.updated })
                                : ""}
                            </TableCell>
                            <TableCell align="right">
                              {s.skipped
                                ? t("extensions.install.nSkipped", "{{n}} skipped", { n: s.skipped })
                                : ""}
                            </TableCell>
                            <TableCell align="right">
                              {s.failed ? <Chip size="small" color="error" label={s.failed} /> : ""}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </Box>
              )}

              {install.status === "previewed" && (
                <Button
                  variant="contained"
                  color="warning"
                  onClick={handleApply}
                  disabled={installBusy}
                  sx={{ mt: 1 }}
                  startIcon={<MaterialSymbol icon="extension" />}
                >
                  {t("extensions.install.apply", "Install extension")}
                </Button>
              )}

              {install.status === "installed" && (
                <Alert severity="success" sx={{ mt: 1 }}>
                  {t("extensions.install.done", "Extension installed.")}
                </Alert>
              )}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Installed extensions */}
      <Card variant="outlined">
        <CardContent>
          <Typography variant="h6" gutterBottom>
            {t("extensions.list.title", "Installed extensions")}
          </Typography>
          {loading ? (
            <LinearProgress />
          ) : extensions.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t("extensions.list.empty", "No extensions installed yet.")}
            </Typography>
          ) : (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("extensions.list.name", "Name")}</TableCell>
                  <TableCell>{t("extensions.list.version", "Version")}</TableCell>
                  <TableCell>{t("extensions.list.status", "Status")}</TableCell>
                  <TableCell>{t("extensions.list.license", "License")}</TableCell>
                  <TableCell align="center">{t("extensions.list.enabled", "Enabled")}</TableCell>
                  <TableCell align="right" />
                </TableRow>
              </TableHead>
              <TableBody>
                {extensions.map((ext) => (
                  <TableRow key={ext.key}>
                    <TableCell>
                      <Typography variant="body2">{ext.name}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {ext.key}
                        {ext.capabilities.length > 0 && ` · ${ext.capabilities.join(", ")}`}
                      </Typography>
                      {ext.last_error && (
                        <Tooltip title={ext.last_error}>
                          <Chip
                            size="small"
                            color="error"
                            variant="outlined"
                            label={t("extensions.list.loadError", "Load error")}
                            sx={{ ml: 1 }}
                          />
                        </Tooltip>
                      )}
                    </TableCell>
                    <TableCell>{ext.version}</TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        color={STATUS_COLOR[ext.status] ?? "default"}
                        label={t(`extensions.status.${ext.status}`, ext.status)}
                      />
                    </TableCell>
                    <TableCell>{entitlementChip(ext.entitlement)}</TableCell>
                    <TableCell align="center">
                      <Switch
                        size="small"
                        checked={ext.enabled}
                        onChange={() => void handleToggle(ext)}
                        inputProps={{
                          "aria-label": t("extensions.list.enabledToggle", "Toggle extension"),
                        }}
                      />
                    </TableCell>
                    <TableCell align="right">
                      <Tooltip title={t("extensions.list.uninstall", "Uninstall")}>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => setUninstallKey(ext.key)}
                          startIcon={<MaterialSymbol icon="delete" size={18} />}
                        >
                          {t("extensions.list.uninstall", "Uninstall")}
                        </Button>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Extension-contributed admin panels (third UI extension point) */}
      {adminPanels.map(({ extKey, panel }) => (
        <Card variant="outlined" key={`${extKey}:${panel.id}`}>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              {panel.label}
            </Typography>
            <ExtensionBoundary extensionKey={extKey}>
              <panel.component />
            </ExtensionBoundary>
          </CardContent>
        </Card>
      ))}

      <Dialog open={uninstallKey !== null} onClose={() => setUninstallKey(null)}>
        <DialogTitle>{t("extensions.uninstall.title", "Uninstall extension?")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t(
              "extensions.uninstall.body",
              "The extension's files are removed and its features stop working. Data it created (card types, cards, its own tables) is kept and reappears if you reinstall.",
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setUninstallKey(null)}>
            {t("extensions.uninstall.cancel", "Cancel")}
          </Button>
          <Button color="error" variant="contained" onClick={() => void handleUninstall()}>
            {t("extensions.uninstall.confirm", "Uninstall")}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
