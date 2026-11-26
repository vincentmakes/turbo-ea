import { useState, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Paper from "@mui/material/Paper";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import CircularProgress from "@mui/material/CircularProgress";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Select from "@mui/material/Select";
import FormHelperText from "@mui/material/FormHelperText";
import IconButton from "@mui/material/IconButton";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useAuthContext } from "@/hooks/AuthContext";
import { hasPermission } from "@/components/RequirePermission";
import { useTheme } from "@mui/material/styles";
import type { AppRole, SsoRoleMapEntry, SsoSettings } from "@/types";

/** A role-map row in the form; `_rowId` is a stable React key, stripped on save. */
interface RoleMapRow extends SsoRoleMapEntry {
  _rowId: number;
}

/**
 * Microsoft tenant values that admit any tenant. A role map is refused there:
 * a foreign tenant could assign itself the app's roles.
 */
const MULTI_TENANT_IDS = new Set(["organizations", "common", "consumers"]);

/** The form's rows as the API takes them: trimmed values, fully empty rows dropped. */
function roleMapPayload(rows: RoleMapRow[]): SsoRoleMapEntry[] {
  return rows
    .map((r) => ({ value: r.value.trim(), role: r.role }))
    .filter((r) => r.value !== "" || r.role !== "");
}

function RoleChip({ role }: { role: AppRole }) {
  return (
    <Chip
      size="small"
      label={role.label}
      sx={{
        bgcolor: role.color + "22",
        color: role.color,
        fontWeight: 600,
        border: `1px solid ${role.color}44`,
        pointerEvents: "none",
      }}
    />
  );
}

const SSO_PROVIDERS = [
  { value: "microsoft", label: "settings.sso.providers.microsoft" },
  { value: "google", label: "settings.sso.providers.google" },
  { value: "okta", label: "settings.sso.providers.okta" },
  { value: "oidc", label: "settings.sso.providers.oidc" },
];

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="overline"
      sx={{
        display: "block",
        mb: 1.5,
        mt: 1,
        fontWeight: 700,
        color: "text.secondary",
        letterSpacing: 1,
        fontSize: "0.75rem",
      }}
    >
      {children}
    </Typography>
  );
}

export default function AuthAdmin() {
  const theme = useTheme();
  const { t } = useTranslation(["admin", "common"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snack, setSnack] = useState("");

  // Registration toggle state
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [savingRegistration, setSavingRegistration] = useState(false);

  // SSO state
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [ssoProvider, setSsoProvider] = useState("microsoft");
  const [ssoClientId, setSsoClientId] = useState("");
  const [ssoClientSecret, setSsoClientSecret] = useState("");
  const [ssoTenantId, setSsoTenantId] = useState("organizations");
  const [ssoDomain, setSsoDomain] = useState("");
  const [ssoIssuerUrl, setSsoIssuerUrl] = useState("");
  const [ssoAuthEndpoint, setSsoAuthEndpoint] = useState("");
  const [ssoTokenEndpoint, setSsoTokenEndpoint] = useState("");
  const [ssoJwksUri, setSsoJwksUri] = useState("");
  const [ssoRoleClaim, setSsoRoleClaim] = useState("");
  const [roleMapRows, setRoleMapRows] = useState<RoleMapRow[]>([]);
  const [ssoExtraScopes, setSsoExtraScopes] = useState("");
  const [savingSso, setSavingSso] = useState(false);

  // A role map hands out roles at every sign-in, so changing it is user
  // management: the API asks for admin.users on top of admin.settings. Without
  // it the claim and rows are read-only; the extra scopes stay editable.
  const { user: currentUser } = useAuthContext();
  const canEditRoleMap = hasPermission(currentUser?.permissions, "admin.users");

  // Stable React keys for role-map rows, so reordering moves each row's own
  // input state with it instead of leaving it at the old index.
  const nextRowId = useRef(0);

  // Archived roles are fetched too, so a stored row pointing at one still has a label.
  const { data: roles } = useApiQuery<AppRole[]>("/roles?include_archived=true");
  const roleByKey = useMemo(() => new Map((roles ?? []).map((r) => [r.key, r])), [roles]);
  const activeRoles = useMemo(() => (roles ?? []).filter((r) => !r.is_archived), [roles]);

  useEffect(() => {
    Promise.all([
      api.get<SsoSettings>("/settings/sso"),
      api.get<{ enabled: boolean }>("/settings/registration"),
    ])
      .then(([ssoData, regData]) => {
        setSsoEnabled(ssoData.enabled);
        setSsoProvider(ssoData.provider || "microsoft");
        setSsoClientId(ssoData.client_id);
        setSsoClientSecret(ssoData.client_secret);
        setSsoTenantId(ssoData.tenant_id);
        setSsoDomain(ssoData.domain || "");
        setSsoIssuerUrl(ssoData.issuer_url || "");
        setSsoAuthEndpoint(ssoData.authorization_endpoint || "");
        setSsoTokenEndpoint(ssoData.token_endpoint || "");
        setSsoJwksUri(ssoData.jwks_uri || "");
        setSsoRoleClaim(ssoData.role_claim ?? "");
        setRoleMapRows(
          (ssoData.role_map ?? []).map((r) => ({
            value: r.value,
            role: r.role,
            _rowId: nextRowId.current++,
          })),
        );
        setSsoExtraScopes(ssoData.extra_scopes ?? "");
        setRegistrationEnabled(regData.enabled);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("common:errors.generic")))
      .finally(() => setLoading(false));
  }, []);

  const handleRegistrationToggle = async (enabled: boolean) => {
    setSavingRegistration(true);
    setError("");
    try {
      await api.patch("/settings/registration", { enabled });
      setRegistrationEnabled(enabled);
      setSnack(
        enabled
          ? t("settings.registration.enabledSuccess")
          : t("settings.registration.disabledSuccess"),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingRegistration(false);
    }
  };

  const handleSsoSave = async () => {
    setSavingSso(true);
    setError("");
    try {
      await api.patch("/settings/sso", {
        enabled: ssoEnabled,
        provider: ssoProvider,
        client_id: ssoClientId,
        client_secret: ssoClientSecret,
        tenant_id: ssoTenantId,
        domain: ssoDomain,
        issuer_url: ssoIssuerUrl,
        authorization_endpoint: ssoAuthEndpoint,
        token_endpoint: ssoTokenEndpoint,
        jwks_uri: ssoJwksUri,
        // Omitted when read-only, so the stored claim and map are kept as they are.
        ...(canEditRoleMap
          ? { role_claim: ssoRoleClaim.trim(), role_map: roleMapPayload(roleMapRows) }
          : {}),
        extra_scopes: ssoExtraScopes.trim(),
      });
      setSnack(t("settings.sso.savedSuccess"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingSso(false);
    }
  };

  const updateRoleMapRow = (idx: number, patch: Partial<SsoRoleMapEntry>) => {
    setRoleMapRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const addRoleMapRow = () => {
    setRoleMapRows((rows) => [...rows, { value: "", role: "", _rowId: nextRowId.current++ }]);
  };

  // Swap a row with its neighbour: map order is match order (first match wins).
  const moveRoleMapRow = (idx: number, delta: -1 | 1) => {
    setRoleMapRows((rows) => {
      const target = idx + delta;
      if (target < 0 || target >= rows.length) return rows;
      const next = [...rows];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  };

  const removeRoleMapRow = (idx: number) => {
    setRoleMapRows((rows) => rows.filter((_, i) => i !== idx));
  };

  const tenantNeedsSpecificId =
    ssoProvider === "microsoft" &&
    (ssoTenantId.trim() === "" || MULTI_TENANT_IDS.has(ssoTenantId.trim().toLowerCase()));

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 720, mx: "auto" }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* ── Self-Registration ─────────────────────────────────────── */}
      <SectionHeader>{t("settings.auth.section.registration")}</SectionHeader>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="person_add" size={22} color={theme.palette.text.secondary} />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.registration.title")}
          </Typography>
          <Chip
            label={registrationEnabled ? t("settings.bpm.enabled") : t("settings.bpm.disabled")}
            size="small"
            color={registrationEnabled ? "success" : "default"}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t("settings.registration.description")}
        </Typography>
        <FormControlLabel
          control={
            <Switch
              checked={registrationEnabled}
              onChange={(e) => handleRegistrationToggle(e.target.checked)}
              disabled={savingRegistration || ssoEnabled}
            />
          }
          label={
            ssoEnabled
              ? t("settings.registration.managedBySso")
              : registrationEnabled
                ? t("settings.registration.usersCanRegister")
                : t("settings.registration.onlyAdmins")
          }
        />
      </Paper>

      {/* ── Single Sign-On ────────────────────────────────────────── */}
      <SectionHeader>{t("settings.auth.section.sso")}</SectionHeader>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="shield_person" size={22} color={theme.palette.text.secondary} />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.sso.title")}
          </Typography>
          <Chip
            label={ssoEnabled ? t("settings.bpm.enabled") : t("settings.bpm.disabled")}
            size="small"
            color={ssoEnabled ? "success" : "default"}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("settings.sso.description")}
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={ssoEnabled}
              onChange={(e) => setSsoEnabled(e.target.checked)}
            />
          }
          label={ssoEnabled ? t("settings.sso.enabled") : t("settings.sso.disabled")}
          sx={{ mb: 2 }}
        />

        {ssoEnabled && (
          <>
            {/* Provider selector */}
            <TextField
              select
              label={t("settings.sso.provider")}
              fullWidth
              value={ssoProvider}
              onChange={(e) => setSsoProvider(e.target.value)}
              helperText={t("settings.sso.providerHelper")}
              sx={{ mb: 2 }}
            >
              {SSO_PROVIDERS.map((p) => (
                <MenuItem key={p.value} value={p.value}>
                  {t(p.label)}
                </MenuItem>
              ))}
            </TextField>

            {/* Client ID — always shown */}
            <TextField
              label={t("settings.sso.clientId")}
              fullWidth
              value={ssoClientId}
              onChange={(e) => setSsoClientId(e.target.value)}
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              helperText={t(`settings.sso.clientIdHelper.${ssoProvider}`)}
              sx={{ mb: 2 }}
            />

            {/* Client Secret — always shown */}
            <TextField
              label={t("settings.sso.clientSecret")}
              fullWidth
              type="password"
              value={ssoClientSecret}
              onChange={(e) => setSsoClientSecret(e.target.value)}
              helperText={t(`settings.sso.clientSecretHelper.${ssoProvider}`)}
              sx={{ mb: 2 }}
            />

            {/* Microsoft: Tenant ID */}
            {ssoProvider === "microsoft" && (
              <TextField
                label={t("settings.sso.tenantId")}
                fullWidth
                value={ssoTenantId}
                onChange={(e) => setSsoTenantId(e.target.value)}
                placeholder="organizations"
                helperText={t("settings.sso.tenantIdHelper")}
                sx={{ mb: 2 }}
              />
            )}

            {/* Google: Hosted Domain */}
            {ssoProvider === "google" && (
              <TextField
                label={t("settings.sso.googleDomain")}
                fullWidth
                value={ssoDomain}
                onChange={(e) => setSsoDomain(e.target.value)}
                placeholder="yourcompany.com"
                helperText={t("settings.sso.googleDomainHelper")}
                sx={{ mb: 2 }}
              />
            )}

            {/* Okta: Domain */}
            {ssoProvider === "okta" && (
              <TextField
                label={t("settings.sso.oktaDomain")}
                fullWidth
                value={ssoDomain}
                onChange={(e) => setSsoDomain(e.target.value)}
                placeholder="dev-12345.okta.com"
                helperText={t("settings.sso.oktaDomainHelper")}
                sx={{ mb: 2 }}
              />
            )}

            {/* Generic OIDC: Issuer URL */}
            {ssoProvider === "oidc" && (
              <>
                <TextField
                  label={t("settings.sso.issuerUrl")}
                  fullWidth
                  value={ssoIssuerUrl}
                  onChange={(e) => setSsoIssuerUrl(e.target.value)}
                  placeholder="https://auth.example.com/realms/myapp"
                  helperText={t("settings.sso.issuerUrlHelper")}
                  sx={{ mb: 2 }}
                />

                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1.5, mt: 1 }}
                >
                  {t("settings.sso.manualEndpointsLabel")}
                </Typography>

                <TextField
                  label={t("settings.sso.authorizationEndpoint")}
                  fullWidth
                  value={ssoAuthEndpoint}
                  onChange={(e) => setSsoAuthEndpoint(e.target.value)}
                  placeholder="https://auth.example.com/realms/myapp/protocol/openid-connect/auth"
                  helperText={t("settings.sso.authorizationEndpointHelper")}
                  sx={{ mb: 2 }}
                />
                <TextField
                  label={t("settings.sso.tokenEndpoint")}
                  fullWidth
                  value={ssoTokenEndpoint}
                  onChange={(e) => setSsoTokenEndpoint(e.target.value)}
                  placeholder="https://auth.example.com/realms/myapp/protocol/openid-connect/token"
                  helperText={t("settings.sso.tokenEndpointHelper")}
                  sx={{ mb: 2 }}
                />
                <TextField
                  label={t("settings.sso.jwksUri")}
                  fullWidth
                  value={ssoJwksUri}
                  onChange={(e) => setSsoJwksUri(e.target.value)}
                  placeholder="https://auth.example.com/realms/myapp/protocol/openid-connect/certs"
                  helperText={t("settings.sso.jwksUriHelper")}
                  sx={{ mb: 2 }}
                />
              </>
            )}

            {/* Redirect URI info */}
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2">
                <strong>{t("settings.sso.redirectUri")}</strong>:{" "}
                {t("settings.sso.redirectUriHint")}{" "}
                <code>{window.location.origin}/auth/callback</code>
              </Typography>
            </Alert>

            {/* Provider-specific setup hints */}
            {ssoProvider === "google" && (
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  {t("settings.sso.googleSetupHint")}
                </Typography>
              </Alert>
            )}
            {ssoProvider === "okta" && (
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  {t("settings.sso.oktaSetupHint")}
                </Typography>
              </Alert>
            )}
            {ssoProvider === "oidc" && (
              <Alert severity="info" sx={{ mb: 2 }}>
                <Typography variant="body2">
                  {t("settings.sso.oidcSetupHint")}
                </Typography>
              </Alert>
            )}

            {/* Role mapping — Google ID tokens carry no groups claim, so it is
                hidden there (the stored values are still sent unchanged). */}
            {ssoProvider !== "google" && (
              <Box data-testid="sso-role-mapping">
                <Divider sx={{ my: 2 }} />
                <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 1 }}>
                  {t("settings.sso.roleMap.title")}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                  {t("settings.sso.roleMap.description")}
                </Typography>
                <Alert severity="info" sx={{ mb: 2 }}>
                  <Typography variant="body2">{t("settings.sso.roleMap.rulesHint")}</Typography>
                </Alert>
                {tenantNeedsSpecificId && (
                  <Alert severity="warning" sx={{ mb: 2 }}>
                    <Typography variant="body2">
                      {t("settings.sso.roleMap.multiTenantWarning")}
                    </Typography>
                  </Alert>
                )}

                {!canEditRoleMap && (
                  <Alert severity="info" sx={{ mb: 2 }} data-testid="sso-role-map-read-only">
                    <Typography variant="body2">
                      {t("settings.sso.roleMap.readOnlyHint")}
                    </Typography>
                  </Alert>
                )}

                <TextField
                  label={t("settings.sso.roleMap.claim")}
                  fullWidth
                  disabled={!canEditRoleMap}
                  value={ssoRoleClaim}
                  onChange={(e) => setSsoRoleClaim(e.target.value)}
                  placeholder="groups"
                  helperText={t("settings.sso.roleMap.claimHelper")}
                  sx={{ mb: 2 }}
                />

                {roleMapRows.length === 0 && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                    {t("settings.sso.roleMap.empty")}
                  </Typography>
                )}
                {roleMapRows.map((row, idx) => {
                  const known = roleByKey.get(row.role);
                  const isActive = activeRoles.some((r) => r.key === row.role);
                  // A stored key that is archived or unknown still renders, so
                  // it is never silently dropped on the next save.
                  const showStoredOption = row.role !== "" && !isActive;
                  const flagInactive = showStoredOption && roles !== undefined;
                  const labelId = `sso-role-map-role-${row._rowId}`;
                  return (
                    <Box
                      key={row._rowId}
                      data-testid="sso-role-map-row"
                      sx={{ display: "flex", gap: 1, mb: 1, alignItems: "flex-start" }}
                    >
                      <TextField
                        size="small"
                        label={t("settings.sso.roleMap.value")}
                        disabled={!canEditRoleMap}
                        value={row.value}
                        onChange={(e) => updateRoleMapRow(idx, { value: e.target.value })}
                        placeholder="ea-admins"
                        sx={{ flex: 1 }}
                      />
                      <FormControl size="small" sx={{ flex: 1 }} disabled={!canEditRoleMap}>
                        <InputLabel id={labelId}>{t("settings.sso.roleMap.role")}</InputLabel>
                        <Select
                          labelId={labelId}
                          label={t("settings.sso.roleMap.role")}
                          value={row.role}
                          onChange={(e) => updateRoleMapRow(idx, { role: e.target.value })}
                          renderValue={(val) => {
                            const r = roleByKey.get(val);
                            return r ? <RoleChip role={r} /> : val;
                          }}
                        >
                          {activeRoles.map((r) => (
                            <MenuItem key={r.key} value={r.key}>
                              <RoleChip role={r} />
                            </MenuItem>
                          ))}
                          {showStoredOption && (
                            <MenuItem value={row.role} disabled>
                              {known ? <RoleChip role={known} /> : row.role}
                            </MenuItem>
                          )}
                        </Select>
                        {flagInactive && (
                          <FormHelperText sx={{ color: "warning.main" }}>
                            {t("settings.sso.roleMap.inactiveRole")}
                          </FormHelperText>
                        )}
                      </FormControl>
                      <IconButton
                        size="small"
                        aria-label={t("settings.sso.roleMap.moveUp")}
                        disabled={!canEditRoleMap || idx === 0}
                        onClick={() => moveRoleMapRow(idx, -1)}
                      >
                        <MaterialSymbol icon="arrow_upward" size={18} />
                      </IconButton>
                      <IconButton
                        size="small"
                        aria-label={t("settings.sso.roleMap.moveDown")}
                        disabled={!canEditRoleMap || idx === roleMapRows.length - 1}
                        onClick={() => moveRoleMapRow(idx, 1)}
                      >
                        <MaterialSymbol icon="arrow_downward" size={18} />
                      </IconButton>
                      <IconButton
                        size="small"
                        aria-label={t("settings.sso.roleMap.remove")}
                        disabled={!canEditRoleMap}
                        onClick={() => removeRoleMapRow(idx)}
                      >
                        <MaterialSymbol icon="close" size={18} />
                      </IconButton>
                    </Box>
                  );
                })}
                <Button
                  size="small"
                  startIcon={<MaterialSymbol icon="add" size={18} />}
                  sx={{ textTransform: "none", mb: 2 }}
                  disabled={!canEditRoleMap}
                  onClick={addRoleMapRow}
                >
                  {t("settings.sso.roleMap.add")}
                </Button>

                <TextField
                  label={t("settings.sso.roleMap.extraScopes")}
                  fullWidth
                  value={ssoExtraScopes}
                  onChange={(e) => setSsoExtraScopes(e.target.value)}
                  placeholder="groups"
                  helperText={t("settings.sso.roleMap.extraScopesHelper")}
                  sx={{ mb: 2 }}
                />
              </Box>
            )}
          </>
        )}

        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            variant="contained"
            size="small"
            startIcon={<MaterialSymbol icon="save" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={handleSsoSave}
            disabled={savingSso}
          >
            {savingSso ? t("common:labels.loading") : t("common:actions.save")}
          </Button>
        </Box>
      </Paper>

      <Snackbar
        open={!!snack}
        autoHideDuration={4000}
        onClose={() => setSnack("")}
        message={snack}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
