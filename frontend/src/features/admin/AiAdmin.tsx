import { useState, useEffect } from "react";
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
import Checkbox from "@mui/material/Checkbox";
import Chip from "@mui/material/Chip";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";

interface AiSettings {
  enabled: boolean;
  descriptions_enabled: boolean;
  chat_enabled: boolean;
  provider_url: string;
  model: string;
  search_provider: string;
  search_url: string;
  enabled_types: string[];
}

export default function AiAdmin() {
  const { t } = useTranslation(["admin", "common"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snack, setSnack] = useState("");

  // AI settings state
  const [aiEnabled, setAiEnabled] = useState(false);
  const [descriptionsEnabled, setDescriptionsEnabled] = useState(true);
  const [chatEnabled, setChatEnabled] = useState(false);
  const [aiProviderUrl, setAiProviderUrl] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiSearchProvider, setAiSearchProvider] = useState("duckduckgo");
  const [aiSearchUrl, setAiSearchUrl] = useState("");
  const [aiEnabledTypes, setAiEnabledTypes] = useState<string[]>([]);
  const [savingAi, setSavingAi] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [aiAvailableModels, setAiAvailableModels] = useState<string[]>([]);

  const { types } = useMetamodel();
  const availableTypes = types.filter((ct) => !ct.is_hidden);

  useEffect(() => {
    api
      .get<AiSettings>("/settings/ai")
      .then((data) => {
        setAiEnabled(data.enabled);
        setDescriptionsEnabled(data.descriptions_enabled);
        setChatEnabled(data.chat_enabled);
        setAiProviderUrl(data.provider_url);
        setAiModel(data.model);
        setAiSearchProvider(data.search_provider);
        setAiSearchUrl(data.search_url);
        setAiEnabledTypes(data.enabled_types);
      })
      .catch((e) => setError(e instanceof Error ? e.message : t("common:errors.generic")))
      .finally(() => setLoading(false));
  }, []);

  const handleAiSave = async () => {
    setSavingAi(true);
    setError("");
    try {
      await api.patch("/settings/ai", {
        enabled: aiEnabled,
        descriptions_enabled: descriptionsEnabled,
        chat_enabled: chatEnabled,
        provider_url: aiProviderUrl,
        model: aiModel,
        search_provider: aiSearchProvider,
        search_url: aiSearchUrl,
        enabled_types: aiEnabledTypes,
      });
      setSnack(t("settings.ai.savedSuccess"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingAi(false);
    }
  };

  const handleAiTest = async () => {
    setTestingAi(true);
    setError("");
    try {
      const res = await api.post<{ ok: boolean; available_models: string[]; model_found: boolean }>(
        "/settings/ai/test",
      );
      setAiAvailableModels(res.available_models);
      if (res.model_found) {
        setSnack(t("settings.ai.testSuccess"));
      } else if (res.available_models.length > 0) {
        setSnack(
          t("settings.ai.testNoModel", { models: res.available_models.slice(0, 5).join(", ") }),
        );
      } else {
        setSnack(t("settings.ai.testNoModels"));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setTestingAi(false);
    }
  };

  const handleAiTypeToggle = (typeKey: string, checked: boolean) => {
    if (checked) {
      setAiEnabledTypes((prev) => [...prev, typeKey]);
    } else {
      setAiEnabledTypes((prev) => prev.filter((k) => k !== typeKey));
    }
  };

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

      {/* ── AI Provider ─────────────────────────────────────────── */}
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
        {t("settings.ai.sectionProvider")}
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="smart_toy" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.ai.providerTitle")}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("settings.ai.providerDescription")}
        </Typography>

        <FormControlLabel
          control={
            <Switch checked={aiEnabled} onChange={(e) => setAiEnabled(e.target.checked)} />
          }
          label={aiEnabled ? t("settings.ai.enabled") : t("settings.ai.disabled")}
          sx={{ mb: 2, display: "block" }}
        />

        {aiEnabled && (
          <>
          <TextField
              label={t("settings.ai.providerUrl")}
              fullWidth
              value={aiProviderUrl}
              onChange={(e) => setAiProviderUrl(e.target.value)}
              placeholder="http://localhost:11434"
              helperText={t("settings.ai.providerUrlHelper")}
              sx={{ mb: 2 }}
            />
            {aiAvailableModels.length > 0 ? (
              <TextField
                select
                label={t("settings.ai.model")}
                fullWidth
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                helperText={t("settings.ai.modelPickerHelper")}
                sx={{ mb: 2 }}
              >
                {!aiModel && (
                  <MenuItem value="" disabled>
                    {t("settings.ai.selectModel")}
                  </MenuItem>
                )}
                {aiAvailableModels.map((m) => (
                  <MenuItem key={m} value={m}>
                    {m}
                  </MenuItem>
                ))}
              </TextField>
            ) : (
              <TextField
                label={t("settings.ai.model")}
                fullWidth
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                placeholder="gemma3:4b"
                helperText={t("settings.ai.modelHelper")}
                sx={{ mb: 2 }}
              />
            )}
          </>
        )}

        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
          {aiEnabled && aiProviderUrl && (
            <Button
              variant="outlined"
              size="small"
              startIcon={
                testingAi ? (
                  <CircularProgress size={16} />
                ) : (
                  <MaterialSymbol icon="cable" size={18} />
                )
              }
              sx={{ textTransform: "none" }}
              onClick={handleAiTest}
              disabled={testingAi || savingAi}
            >
              {testingAi ? t("common:labels.loading") : t("settings.ai.testConnection")}
            </Button>
          )}
          <Button
            variant="contained"
            size="small"
            startIcon={<MaterialSymbol icon="save" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={handleAiSave}
            disabled={savingAi}
          >
            {savingAi ? t("common:labels.loading") : t("common:actions.save")}
          </Button>
        </Box>
      </Paper>

      {/* ── Feature sections (only show when AI provider is enabled) ── */}
      {aiEnabled && (
        <>
          {/* ── AI Descriptions ──────────────────────────────────── */}
          <Typography
            variant="overline"
            sx={{
              display: "block",
              mb: 1.5,
              fontWeight: 700,
              color: "text.secondary",
              letterSpacing: 1,
              fontSize: "0.75rem",
            }}
          >
            {t("settings.ai.sectionDescriptions")}
          </Typography>

          <Paper sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
              <MaterialSymbol icon="auto_awesome" size={22} color="#555" />
              <Typography variant="h6" fontWeight={600}>
                {t("settings.ai.title")}
              </Typography>
              <Chip
                label={
                  descriptionsEnabled
                    ? t("settings.ai.descriptionsActive")
                    : t("settings.ai.descriptionsInactive")
                }
                size="small"
                sx={{
                  height: 22,
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  bgcolor: descriptionsEnabled ? "success.main" : "action.disabledBackground",
                  color: descriptionsEnabled ? "#fff" : "text.secondary",
                }}
              />
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {t("settings.ai.description")}
            </Typography>

            <FormControlLabel
              control={
                <Switch
                  checked={descriptionsEnabled}
                  onChange={(e) => setDescriptionsEnabled(e.target.checked)}
                />
              }
              label={
                descriptionsEnabled
                  ? t("settings.ai.descriptionsEnabledLabel")
                  : t("settings.ai.descriptionsDisabledLabel")
              }
              sx={{ mb: 2, display: "block" }}
            />

            {descriptionsEnabled && (
            <>
            <TextField
              select
              label={t("settings.ai.searchProvider")}
              fullWidth
              value={aiSearchProvider}
              onChange={(e) => setAiSearchProvider(e.target.value)}
              helperText={t("settings.ai.searchProviderHelper")}
              sx={{ mb: 2 }}
            >
              <MenuItem value="duckduckgo">DuckDuckGo</MenuItem>
              <MenuItem value="google">Google Custom Search</MenuItem>
              <MenuItem value="searxng">SearXNG</MenuItem>
            </TextField>
            {(aiSearchProvider === "searxng" || aiSearchProvider === "google") && (
              <TextField
                label={
                  aiSearchProvider === "google"
                    ? t("settings.ai.googleCredentials")
                    : t("settings.ai.searxngUrl")
                }
                fullWidth
                value={aiSearchUrl}
                onChange={(e) => setAiSearchUrl(e.target.value)}
                placeholder={
                  aiSearchProvider === "google"
                    ? "API_KEY:SEARCH_ENGINE_ID"
                    : "http://localhost:8888"
                }
                helperText={
                  aiSearchProvider === "google"
                    ? t("settings.ai.googleCredentialsHelper")
                    : t("settings.ai.searxngUrlHelper")
                }
                sx={{ mb: 2 }}
              />
            )}
            <Typography variant="body2" fontWeight={600} sx={{ mb: 1 }}>
              {t("settings.ai.enabledTypes")}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
              {t("settings.ai.enabledTypesHelper")}
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 2 }}>
              {availableTypes.map((ct) => (
                <FormControlLabel
                  key={ct.key}
                  control={
                    <Checkbox
                      size="small"
                      checked={aiEnabledTypes.includes(ct.key)}
                      onChange={(e) => handleAiTypeToggle(ct.key, e.target.checked)}
                    />
                  }
                  label={ct.label}
                  sx={{ mr: 2 }}
                />
              ))}
            </Box>
            </>
            )}

            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button
                variant="contained"
                size="small"
                startIcon={<MaterialSymbol icon="save" size={18} />}
                sx={{ textTransform: "none" }}
                onClick={handleAiSave}
                disabled={savingAi}
              >
                {savingAi ? t("common:labels.loading") : t("common:actions.save")}
              </Button>
            </Box>
          </Paper>

          {/* ── AI Chat ──────────────────────────────────────────── */}
          <Typography
            variant="overline"
            sx={{
              display: "block",
              mb: 1.5,
              fontWeight: 700,
              color: "text.secondary",
              letterSpacing: 1,
              fontSize: "0.75rem",
            }}
          >
            {t("settings.ai.sectionChat")}
          </Typography>

          <Paper sx={{ p: 3, mb: 3 }}>
            <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
              <MaterialSymbol icon="chat" size={22} color="#555" />
              <Typography variant="h6" fontWeight={600}>
                {t("settings.ai.chatTitle")}
              </Typography>
              <Chip
                label={chatEnabled ? t("settings.ai.chatActive") : t("settings.ai.chatInactive")}
                size="small"
                sx={{
                  height: 22,
                  fontSize: "0.7rem",
                  fontWeight: 600,
                  bgcolor: chatEnabled ? "success.main" : "action.disabledBackground",
                  color: chatEnabled ? "#fff" : "text.secondary",
                }}
              />
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              {t("settings.ai.chatDescription")}
            </Typography>

            <FormControlLabel
              control={
                <Switch checked={chatEnabled} onChange={(e) => setChatEnabled(e.target.checked)} />
              }
              label={chatEnabled ? t("settings.ai.chatEnabledLabel") : t("settings.ai.chatDisabledLabel")}
              sx={{ mb: 2, display: "block" }}
            />

            {chatEnabled && (
              <Alert severity="info" sx={{ mb: 2 }} icon={<MaterialSymbol icon="shield" size={20} />}>
                {t("settings.ai.chatPrivacyNote")}
              </Alert>
            )}

            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button
                variant="contained"
                size="small"
                startIcon={<MaterialSymbol icon="save" size={18} />}
                sx={{ textTransform: "none" }}
                onClick={handleAiSave}
                disabled={savingAi}
              >
                {savingAi ? t("common:labels.loading") : t("common:actions.save")}
              </Button>
            </Box>
          </Paper>
        </>
      )}

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
