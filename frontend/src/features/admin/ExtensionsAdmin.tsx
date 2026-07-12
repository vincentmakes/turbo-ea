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
  Link,
  Stack,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { api, ApiError } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import { invalidateExtensionCapabilities } from "@/hooks/useExtensionCapabilities";
import { invalidateCache as invalidateMetamodel } from "@/hooks/useMetamodel";
import { ExtensionBoundary, useExtensionUI } from "@/lib/extensionHost";

interface EntitlementInfo {
  state: "active" | "grace" | "expired" | "unlicensed";
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
  grace_days: number;
  entitlements: {
    extension_key: string;
    expires_at?: string | null;
  }[];
  uploaded_at?: string | null;
  // Why the stored license is not in effect (bound to another instance,
  // failed verification) — null/absent when everything is fine.
  problem?: string | null;
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

interface StoreItem {
  key: string;
  name: string;
  description: string;
  price: string;
  payment_link: string;
  demo_url?: string;
  version: string;
  installed_version?: string | null;
  update_available: boolean;
  entitlement_state: EntitlementInfo["state"];
}

interface StoreCatalog {
  configured: boolean;
  reachable: boolean;
  store_url: string;
  items: StoreItem[];
}

interface ClaimResult {
  status: "applied" | "pending";
  license?: LicenseInfo | null;
}

const POLL_MS = 2000;
const CLAIM_POLL_MS = 5000;
const CLAIM_MAX_POLLS = 120; // ~10 minutes
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

function makeClaimToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export default function ExtensionsAdmin() {
  const { t } = useTranslation("admin");

  const [tab, setTab] = useState<"store" | "installed">("store");
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [license, setLicense] = useState<LicenseInfo | null>(null);
  const [catalog, setCatalog] = useState<StoreCatalog | null>(null);
  const [instanceId, setInstanceId] = useState("");
  const [instanceCopied, setInstanceCopied] = useState(false);
  const [storeBusyKey, setStoreBusyKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // License dialog: opened from the install gate (with a store item to buy)
  // or from per-row "Enter license…" (gateItem null).
  const [licenseDialogOpen, setLicenseDialogOpen] = useState(false);
  const [gateItem, setGateItem] = useState<StoreItem | null>(null);
  const [licenseText, setLicenseText] = useState("");
  const [licenseBusy, setLicenseBusy] = useState(false);
  const [licenseError, setLicenseError] = useState<string | null>(null);
  const licenseFileRef = useRef<HTMLInputElement>(null);

  // Purchase claim polling (Buy → Stripe tab → poll until license lands).
  const [claiming, setClaiming] = useState<{ token: string; itemKey: string } | null>(null);
  const claimPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const claimCountRef = useRef(0);

  // Bundle install pipeline (shared by store install + manual upload).
  const [install, setInstall] = useState<ExtensionInstall | null>(null);
  const [installBusy, setInstallBusy] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const bundleFileRef = useRef<HTMLInputElement>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Continue an install automatically once its license arrives.
  const pendingInstallRef = useRef<string | null>(null);

  // Store installs are one-click: a trusted, signed catalogue bundle
  // auto-applies straight through "previewed" to "installed" (unless the
  // dry-run preview reports failures). Manual .teax uploads keep the
  // explicit preview → Install step, where reviewing the diff matters.
  const autoApplyRef = useRef(false);

  const [uninstallKey, setUninstallKey] = useState<string | null>(null);
  const [renewBusy, setRenewBusy] = useState(false);
  const [removeLicenseOpen, setRemoveLicenseOpen] = useState(false);
  const [removeLicenseBusy, setRemoveLicenseBusy] = useState(false);
  // When a file-uploaded extension can't be applied for lack of a license,
  // remember which install to retry once the license lands (so the admin
  // never has to leave the flow for the Installed tab). applyGate drives the
  // dialog copy for that case.
  const pendingApplyRef = useRef<string | null>(null);
  const [applyGate, setApplyGate] = useState(false);

  const clearPoll = useCallback(() => {
    if (pollRef.current) {
      clearTimeout(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const clearClaimPoll = useCallback(() => {
    if (claimPollRef.current) {
      clearTimeout(claimPollRef.current);
      claimPollRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      clearPoll();
      clearClaimPoll();
    },
    [clearPoll, clearClaimPoll],
  );

  const loadAll = useCallback(async () => {
    try {
      const [exts, lic, cat, inst] = await Promise.all([
        api.get<ExtensionInfo[]>("/admin/extensions"),
        api.get<LicenseInfo>("/admin/extensions/license").catch(() => null),
        api.get<StoreCatalog>("/admin/extensions/store/catalog").catch(() => null),
        api.get<{ instance_id: string }>("/admin/extensions/instance").catch(() => null),
      ]);
      setExtensions(exts);
      setLicense(lic);
      setCatalog(cat);
      setInstanceId(inst?.instance_id ?? "");
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

  const applyInstall = useCallback(
    async (id: string) => {
      setInstallBusy(true);
      setInstallError(null);
      try {
        const updated = await api.post<ExtensionInstall>(
          `/admin/extensions/install/${id}/apply`,
        );
        setInstall(updated);
        poll(updated.id);
      } catch (err) {
        // Not-yet-licensed extension (backend 403): don't dump an error and
        // send the admin to the Installed tab — open the license dialog right
        // here and retry the apply automatically once the license is applied.
        if (err instanceof ApiError && err.status === 403) {
          pendingApplyRef.current = id;
          setGateItem(null);
          setLicenseError(null);
          setApplyGate(true);
          setLicenseDialogOpen(true);
        } else {
          setInstallError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        setInstallBusy(false);
      }
    },
    // poll is defined below; referenced lazily via pollFnRef to avoid a cycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const poll = useCallback(
    (id: string) => {
      clearPoll();
      pollRef.current = setTimeout(async () => {
        try {
          const next = await api.get<ExtensionInstall>(`/admin/extensions/install/${id}`);
          setInstall(next);
          if (!TERMINAL.has(next.status)) {
            poll(id);
            return;
          }
          if (next.status === "installed") {
            autoApplyRef.current = false;
            // Content packs can add card types — refresh the metamodel cache.
            void invalidateMetamodel();
            // A newly installed extension may grant metamodel authoring
            // capabilities — drop the capability cache so they appear without
            // a full page reload.
            invalidateExtensionCapabilities();
            void loadAll();
          } else if (next.status === "previewed" && autoApplyRef.current) {
            // One-click store install: apply automatically unless the
            // dry-run flagged failures (then fall back to manual review).
            if (next.diff?.totals?.failed) {
              autoApplyRef.current = false;
            } else {
              void applyInstall(next.id);
            }
          } else if (next.status === "failed") {
            autoApplyRef.current = false;
          }
        } catch (e) {
          setInstallError(e instanceof Error ? e.message : String(e));
        }
      }, POLL_MS);
    },
    [clearPoll, loadAll, applyInstall],
  );

  const startStoreInstall = useCallback(
    async (itemKey: string) => {
      setStoreBusyKey(itemKey);
      setInstallError(null);
      setInstall(null);
      autoApplyRef.current = true; // one-click through to installed
      try {
        const created = await api.post<ExtensionInstall>("/admin/extensions/store/install", {
          key: itemKey,
        });
        setInstall(created);
        poll(created.id);
      } catch (err) {
        autoApplyRef.current = false;
        setInstallError(err instanceof Error ? err.message : String(err));
      } finally {
        setStoreBusyKey(null);
      }
    },
    [poll],
  );

  const closeLicenseDialog = useCallback(() => {
    setLicenseDialogOpen(false);
    setGateItem(null);
    setLicenseText("");
    setLicenseError(null);
    pendingInstallRef.current = null;
    pendingApplyRef.current = null;
    setApplyGate(false);
  }, []);

  const submitLicense = async (text: string) => {
    setLicenseBusy(true);
    setLicenseError(null);
    try {
      await api.put("/admin/extensions/license", { text });
      setLicenseText("");
      // A new license can activate capability grants — drop the cache.
      invalidateExtensionCapabilities();
      await loadAll();
      const continueKey = pendingInstallRef.current;
      const continueApplyId = pendingApplyRef.current;
      setLicenseDialogOpen(false);
      setGateItem(null);
      setApplyGate(false);
      pendingInstallRef.current = null;
      pendingApplyRef.current = null;
      // Resume whatever the license was needed for: a store install, or the
      // just-uploaded file waiting to be applied.
      if (continueApplyId) void applyInstall(continueApplyId);
      else if (continueKey) void startStoreInstall(continueKey);
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

  const pollClaim = useCallback(
    (token: string, itemKey: string) => {
      clearClaimPoll();
      claimPollRef.current = setTimeout(async () => {
        try {
          const res = await api.post<ClaimResult>("/admin/extensions/store/claim", { token });
          if (res.status === "applied") {
            setClaiming(null);
            setNotice(
              t("extensions.store.purchaseApplied", "Purchase confirmed — license applied."),
            );
            await loadAll();
            const continueKey = pendingInstallRef.current;
            setLicenseDialogOpen(false);
            setGateItem(null);
            pendingInstallRef.current = null;
            if (continueKey) void startStoreInstall(continueKey);
            return;
          }
        } catch {
          /* transient — keep polling */
        }
        claimCountRef.current += 1;
        if (claimCountRef.current >= CLAIM_MAX_POLLS) {
          setClaiming(null);
          setNotice(
            t(
              "extensions.store.claimTimeout",
              "No payment confirmation received. If you completed the checkout, paste the license from your email.",
            ),
          );
          return;
        }
        pollClaim(token, itemKey);
      }, CLAIM_POLL_MS);
    },
    [clearClaimPoll, loadAll, startStoreInstall, t],
  );

  const handleBuy = (item: StoreItem) => {
    if (!item.payment_link) return;
    const token = makeClaimToken();
    const sep = item.payment_link.includes("?") ? "&" : "?";
    // The instance ID rides along so the store can key the purchase to this
    // instance (composite licensing) — parsed off the end by the webhook
    // (fixed TEA-XXXX-XXXX-XXXX shape). Stripe allows [A-Za-z0-9_-] here.
    const ref = instanceId ? `${token}-${instanceId}` : token;
    window.open(
      `${item.payment_link}${sep}client_reference_id=${ref}`,
      "_blank",
      "noopener",
    );
    claimCountRef.current = 0;
    setClaiming({ token, itemKey: item.key });
    pollClaim(token, item.key);
  };

  const handleInstallClick = (item: StoreItem) => {
    if (item.entitlement_state === "active" || item.entitlement_state === "grace") {
      void startStoreInstall(item.key);
      return;
    }
    // Not entitled: ask for the license first, then continue automatically.
    pendingInstallRef.current = item.key;
    setGateItem(item);
    setLicenseDialogOpen(true);
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
    await applyInstall(install.id);
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
      invalidateExtensionCapabilities();
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleUninstall = async () => {
    if (!uninstallKey) return;
    try {
      await api.delete(`/admin/extensions/${uninstallKey}`);
      invalidateExtensionCapabilities();
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUninstallKey(null);
    }
  };

  const handleRemoveLicense = async () => {
    setRemoveLicenseBusy(true);
    try {
      await api.delete("/admin/extensions/license");
      invalidateExtensionCapabilities();
      setNotice(
        t(
          "extensions.license.removed",
          "License removed. Licensed extensions are disabled until a license is applied — no data was deleted.",
        ),
      );
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRemoveLicenseBusy(false);
      setRemoveLicenseOpen(false);
    }
  };

  const handleRenew = async () => {
    setRenewBusy(true);
    try {
      const res = await api.post<{ refreshed: boolean }>(
        "/admin/extensions/store/refresh-license",
      );
      if (res.refreshed) {
        setNotice(t("extensions.rows.renewed", "License refreshed from the store."));
        await loadAll();
      } else {
        // Manual license or nothing newer — fall back to the paste dialog.
        setNotice(
          t(
            "extensions.rows.nothingNew",
            "The store has no newer license — check your subscription, or paste a license file.",
          ),
        );
        setGateItem(null);
        setLicenseDialogOpen(true);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRenewBusy(false);
    }
  };

  const needsRestart = extensions.some((x) => x.status === "needs_restart");
  const isWorking = install ? !TERMINAL.has(install.status) : false;
  // During a one-click store install the "previewed" state is transient
  // (auto-apply kicks in), so treat it as still-working for the UI.
  const autoApplying =
    autoApplyRef.current && install?.status === "previewed" && !install.diff?.totals?.failed;
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

  // Shared install progress + preview + apply block. Rendered on the Store
  // tab (both store installs and manual uploads start there now).
  const installPanel = install && (
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
        <Chip size="small" label={autoApplying ? "installing" : install.status} />
        {!autoApplying && (
          <Button
            size="small"
            color="inherit"
            onClick={() => void handleDiscard()}
            disabled={install.status === "applying"}
          >
            {t("extensions.install.discard", "Discard")}
          </Button>
        )}
      </Stack>

      {(isWorking || autoApplying) && <LinearProgress sx={{ mb: 2 }} />}

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

      {install.status === "previewed" && !autoApplying && (
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
  );

  return (
    <Stack spacing={3}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <MaterialSymbol icon="extension" size={28} color="#1976d2" />
        <Typography variant="h5" sx={{ fontWeight: 700, flex: 1 }}>
          {t("extensions.title", "Extensions")}
        </Typography>
        {instanceId && (
          <Tooltip
            title={t(
              "extensions.instanceIdHint",
              "This instance's licensing identity. Quote it when purchasing or requesting a license — checkout asks for it.",
            )}
          >
            <Chip
              variant="outlined"
              size="small"
              icon={<MaterialSymbol icon={instanceCopied ? "check" : "content_copy"} size={16} />}
              label={`${t("extensions.instanceId", "Instance ID")}: ${instanceId}`}
              sx={{ fontFamily: "monospace" }}
              onClick={() => {
                void navigator.clipboard?.writeText(instanceId);
                setInstanceCopied(true);
                setTimeout(() => setInstanceCopied(false), 2000);
              }}
            />
          </Tooltip>
        )}
      </Box>

      {license?.problem && (
        <Alert severity="error" icon={<MaterialSymbol icon="report" />}>
          {license.problem}
        </Alert>
      )}

      <Typography variant="body2" color="text.secondary">
        {t(
          "extensions.intro",
          "Add customer-specific capabilities without changing the core. Install vendor-signed extensions one click at a time from the built-in Store, or upload the extension and license files directly — the file-based flow needs no connection to the Store, so everything still works on air-gapped instances.",
        )}
      </Typography>

      <Alert severity="info" icon={<MaterialSymbol icon="handshake" />}>
        {t(
          "extensions.consulting",
          "Extensions are built and signed by Turbo EA — they aren't self-built or open to third parties. We can build and tailor one to address your specific business needs.",
        )}{" "}
        <Link href="https://www.turbo-ea.org/consulting" target="_blank" rel="noopener noreferrer">
          {t("extensions.consultingLink", "More info here")}
        </Link>
        .
      </Alert>

      {error && <Alert severity="error">{error}</Alert>}
      {notice && (
        <Alert severity="info" onClose={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {needsRestart && (
        <Alert severity="warning" icon={<MaterialSymbol icon="restart_alt" />}>
          {t(
            "extensions.needsRestart",
            "One or more extensions carry backend code that loads at startup. Restart the backend container to finish (docker compose restart backend).",
          )}
        </Alert>
      )}

      <Tabs
        value={tab}
        onChange={(_, v) => setTab(v)}
        sx={{ borderBottom: 1, borderColor: "divider" }}
      >
        <Tab value="store" label={t("extensions.tabs.store", "Store")} />
        <Tab value="installed" label={t("extensions.tabs.installed", "Installed")} />
      </Tabs>

      {tab === "store" && (
        <>
          {loading ? (
            <LinearProgress />
          ) : !catalog?.configured ? (
            <Alert severity="info">
              {t(
                "extensions.store.notConfigured",
                "No extension store is configured on this instance. Install extensions from files on the Installed tab — the file-based flow covers everything the store does.",
              )}
            </Alert>
          ) : !catalog.reachable ? (
            <Alert severity="warning">
              {t(
                "extensions.store.unreachable",
                "The extension store could not be reached. Air-gapped or offline? Install from files on the Installed tab instead.",
              )}
            </Alert>
          ) : catalog.items.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {t("extensions.store.empty", "No extensions published yet.")}
            </Typography>
          ) : (
            <>
              <Box
                sx={{
                  display: "grid",
                  gap: 2,
                  gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
                }}
              >
                {catalog.items.map((item) => (
                  <Card variant="outlined" key={item.key}>
                    <CardContent sx={{ height: "100%", display: "flex", flexDirection: "column" }}>
                      <Stack
                        direction="row"
                        spacing={1}
                        alignItems="center"
                        flexWrap="wrap"
                        useFlexGap
                        sx={{ mb: 0.5 }}
                      >
                        <MaterialSymbol icon="extension" size={20} />
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                          {item.name}
                        </Typography>
                        {item.installed_version && (
                          <Chip
                            size="small"
                            color="success"
                            variant="outlined"
                            label={t("extensions.store.installedChip", "Installed {{version}}", {
                              version: item.installed_version,
                            })}
                          />
                        )}
                        {!item.installed_version && item.entitlement_state !== "unlicensed" && (
                          <Chip
                            size="small"
                            color={ENTITLEMENT_COLOR[item.entitlement_state]}
                            label={t("extensions.store.licensed", "Licensed")}
                          />
                        )}
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ flex: 1, mb: 1.5 }}>
                        {item.description}
                      </Typography>
                      {claiming?.itemKey === item.key && (
                        <Box sx={{ mb: 1.5 }}>
                          <Typography variant="caption" color="text.secondary">
                            {t(
                              "extensions.store.waitingPayment",
                              "Waiting for payment confirmation — complete the checkout in the other browser tab…",
                            )}
                          </Typography>
                          <LinearProgress sx={{ mt: 0.5 }} />
                        </Box>
                      )}
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="subtitle2" sx={{ flex: 1 }}>
                          {item.price}
                        </Typography>
                        {item.demo_url && (
                          <Button
                            size="small"
                            color="inherit"
                            component="a"
                            href={item.demo_url}
                            target="_blank"
                            rel="noopener"
                            startIcon={<MaterialSymbol icon="play_circle" size={18} />}
                          >
                            {t("extensions.store.seeInAction", "See it in action")}
                          </Button>
                        )}
                        {item.payment_link &&
                          item.entitlement_state === "unlicensed" &&
                          claiming?.itemKey !== item.key && (
                            <Button
                              size="small"
                              variant="contained"
                              onClick={() => handleBuy(item)}
                              startIcon={<MaterialSymbol icon="shopping_cart" size={18} />}
                            >
                              {t("extensions.store.buy", "Buy")}
                            </Button>
                          )}
                        {(!item.installed_version || item.update_available) && (
                          <Button
                            size="small"
                            variant={
                              item.entitlement_state === "unlicensed" ? "outlined" : "contained"
                            }
                            disabled={storeBusyKey !== null || isWorking}
                            onClick={() => handleInstallClick(item)}
                            startIcon={
                              storeBusyKey === item.key ? (
                                <CircularProgress size={14} color="inherit" />
                              ) : (
                                <MaterialSymbol icon="download" size={18} />
                              )
                            }
                          >
                            {item.update_available
                              ? t("extensions.store.update", "Update to {{version}}", {
                                  version: item.version,
                                })
                              : t("extensions.store.install", "Install")}
                          </Button>
                        )}
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Box>
              <Typography variant="caption" color="text.secondary">
                {t(
                  "extensions.store.afterPurchase",
                  "Payment opens in a new tab and your license applies automatically once the payment is confirmed (a copy also arrives by email). Bundles are verified against the vendor signature before anything is applied.",
                )}
              </Typography>
            </>
          )}

          {/* Manual/bespoke bundles install from file — same pipeline. */}
          <Box>
            <input
              ref={bundleFileRef}
              type="file"
              accept=".teax,.zip"
              hidden
              onChange={handleBundleFile}
            />
            <Button
              variant="outlined"
              size="small"
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
                : t("extensions.store.installFromFile", "Install from file…")}
            </Button>
            <Typography variant="caption" color="text.secondary" sx={{ ml: 1.5 }}>
              {t(
                "extensions.store.installFromFileHint",
                "For bespoke extensions and air-gapped installs: upload a signed .teax bundle you received from the vendor.",
              )}
            </Typography>
          </Box>

          {installError && <Alert severity="error">{installError}</Alert>}

          {install && (
            <Card variant="outlined">
              <CardContent>{installPanel}</CardContent>
            </Card>
          )}
        </>
      )}

      {tab === "installed" && (
        <>
          {license && (
            <Stack direction="row" spacing={1} alignItems="center">
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
              <Button
                size="small"
                onClick={() => {
                  setGateItem(null);
                  setLicenseDialogOpen(true);
                }}
              >
                {t("extensions.rows.enterLicense", "Enter license…")}
              </Button>
              <Button
                size="small"
                color="error"
                onClick={() => setRemoveLicenseOpen(true)}
              >
                {t("extensions.license.remove", "Remove license")}
              </Button>
            </Stack>
          )}
          {!license && (
            <Alert
              severity="info"
              action={
                <Button
                  size="small"
                  color="inherit"
                  onClick={() => {
                    setGateItem(null);
                    setLicenseDialogOpen(true);
                  }}
                >
                  {t("extensions.rows.enterLicense", "Enter license…")}
                </Button>
              }
            >
              {t(
                "extensions.license.none",
                "No license installed. Paste the license text you received (or upload the license file) to activate extensions.",
              )}
            </Alert>
          )}

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
                      <TableCell align="center">
                        {t("extensions.list.enabled", "Enabled")}
                      </TableCell>
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
                          {ext.entitlement.state !== "active" && (
                            <Button
                              size="small"
                              onClick={() => void handleRenew()}
                              disabled={renewBusy}
                              startIcon={
                                renewBusy ? (
                                  <CircularProgress size={14} color="inherit" />
                                ) : (
                                  <MaterialSymbol icon="autorenew" size={18} />
                                )
                              }
                            >
                              {t("extensions.rows.renew", "Renew")}
                            </Button>
                          )}
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
        </>
      )}

      {/* License dialog — install gate (with Buy) or plain license entry. */}
      <Dialog open={licenseDialogOpen} onClose={closeLicenseDialog} fullWidth maxWidth="sm">
        <DialogTitle>
          {gateItem || applyGate
            ? t("extensions.gate.title", "License required")
            : t("extensions.license.dialogTitle", "Apply a license")}
        </DialogTitle>
        <DialogContent>
          {gateItem && (
            <DialogContentText sx={{ mb: 2 }}>
              {t(
                "extensions.gate.body",
                "{{name}} needs a license entitlement to run. Buy it now — your license applies automatically after payment — or paste a license you already received.",
                { name: gateItem.name },
              )}
            </DialogContentText>
          )}
          {applyGate && !gateItem && (
            <DialogContentText sx={{ mb: 2 }}>
              {t(
                "extensions.gate.applyBody",
                "This extension is verified but needs a license to finish installing. Paste the license you received (or upload the file) — the install continues automatically.",
              )}
            </DialogContentText>
          )}
          {gateItem?.payment_link && (
            <Box sx={{ mb: 2 }}>
              {claiming?.itemKey === gateItem.key ? (
                <>
                  <Typography variant="caption" color="text.secondary">
                    {t(
                      "extensions.store.waitingPayment",
                      "Waiting for payment confirmation — complete the checkout in the other browser tab…",
                    )}
                  </Typography>
                  <LinearProgress sx={{ mt: 0.5 }} />
                </>
              ) : (
                <Button
                  variant="contained"
                  onClick={() => handleBuy(gateItem)}
                  startIcon={<MaterialSymbol icon="shopping_cart" size={18} />}
                >
                  {gateItem.price
                    ? t("extensions.gate.buyFor", "Buy — {{price}}", { price: gateItem.price })
                    : t("extensions.store.buy", "Buy")}
                </Button>
              )}
            </Box>
          )}
          <TextField
            value={licenseText}
            onChange={(e) => setLicenseText(e.target.value)}
            placeholder={t("extensions.license.placeholder", "Paste license text here…")}
            multiline
            minRows={3}
            fullWidth
            size="small"
            sx={{ fontFamily: "monospace" }}
          />
          <input
            ref={licenseFileRef}
            type="file"
            accept=".tealic,.json,.txt"
            hidden
            onChange={handleLicenseFile}
          />
          {licenseError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {licenseError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            disabled={licenseBusy}
            onClick={() => licenseFileRef.current?.click()}
            startIcon={<MaterialSymbol icon="upload_file" />}
          >
            {t("extensions.license.uploadFile", "Upload license file…")}
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button onClick={closeLicenseDialog}>{t("extensions.uninstall.cancel", "Cancel")}</Button>
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
        </DialogActions>
      </Dialog>

      <Dialog open={removeLicenseOpen} onClose={() => setRemoveLicenseOpen(false)}>
        <DialogTitle>{t("extensions.license.removeTitle", "Remove license?")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t(
              "extensions.license.removeBody",
              "Licensed extensions will be disabled until you apply a license again — their pages stop working and their jobs pause. No data is deleted, and applying a license restores everything.",
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveLicenseOpen(false)}>
            {t("extensions.uninstall.cancel", "Cancel")}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={removeLicenseBusy}
            onClick={() => void handleRemoveLicense()}
            startIcon={
              removeLicenseBusy ? (
                <CircularProgress size={16} color="inherit" />
              ) : (
                <MaterialSymbol icon="delete" />
              )
            }
          >
            {t("extensions.license.remove", "Remove license")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={uninstallKey !== null} onClose={() => setUninstallKey(null)}>
        <DialogTitle>{t("extensions.uninstall.title", "Uninstall extension?")}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t(
              "extensions.uninstall.body",
              "The extension's files are removed, its features stop working, and its card types are hidden from the metamodel. Cards and data it created are kept — everything reappears if you reinstall.",
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
