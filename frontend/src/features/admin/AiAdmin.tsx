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
  provider_type: string;
  provider_url: string;
  api_key: string;
  model: string;
  search_provider: string;
  search_url: string;
  enabled_types: string[];
  portfolio_insights_enabled: boolean;
  chat_enabled: boolean;
}

const AI_KEY_MASK = "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022";

export default function AiAdmin() {
  const { t } = useTranslation(["admin", "common"]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [snack, setSnack] = useState("");

  // AI settings state
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiProviderType, setAiProviderType] = useState("ollama");
  const [aiProviderUrl, setAiProviderUrl] = useState("");
  const [aiApiKey, setAiApiKey] = useState("");
  const [aiModel, setAiModel] = useState("");
  const [aiEnabledTypes, setAiEnabledTypes] = useState<string[]>([]);
  const [portfolioInsightsEnabled, setPortfolioInsightsEnabled] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(false);
  const [savingAi, setSavingAi] = useState(false);
  const [testingAi, setTestingAi] = useState(false);
  const [aiAvailableModels, setAiAvailableModels] = useState<string[]>([]);

  // MCP integration state
  const [mcpEnabled, setMcpEnabled] = useState(false);
  const [mcpSsoConfigured, setMcpSsoConfigured] = useState(false);
  const [savingMcp, setSavingMcp] = useState(false);

  const { types } = useMetamodel();
  const availableTypes = types.filter((ct) => !ct.is_hidden);

  useEffect(() => {
    Promise.all([
      api.get<AiSettings>("/settings/ai"),
      api
        .get<{ enabled: boolean; sso_configured: boolean }>("/settings/mcp")
        .catch(() => ({ enabled: false, sso_configured: false })),
    ])
      .then(([data, mcpData]) => {
        setAiEnabled(data.enabled);
        setAiProviderType(data.provider_type || "ollama");
        setAiProviderUrl(data.provider_url);
        setAiApiKey(data.api_key || "");
        setAiModel(data.model);
        setAiEnabledTypes(data.enabled_types);
        setPortfolioInsightsEnabled(data.portfolio_insights_enabled ?? false);
        setChatEnabled(data.chat_enabled ?? false);
        setMcpEnabled(mcpData.enabled);
        setMcpSsoConfigured(mcpData.sso_configured);
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
        provider_type: aiProviderType,
        provider_url: aiProviderUrl,
        api_key: aiApiKey,
        model: aiModel,
        search_provider: "duckduckgo",
        search_url: "",
        enabled_types: aiEnabledTypes,
        portfolio_insights_enabled: portfolioInsightsEnabled,
        chat_enabled: chatEnabled,
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
        if (aiProviderType === "ollama") {
          setSnack(t("settings.ai.testNoModels"));
        } else {
          setSnack(t("settings.ai.testSuccess"));
        }
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

  const handleProviderTypeChange = (newType: string) => {
    setAiProviderType(newType);
    setAiAvailableModels([]);
    // Reset fields when switching providers
    if (newType === "anthropic") {
      setAiProviderUrl("");
    }
  };

  const handleMcpSave = async () => {
    setSavingMcp(true);
    setError("");
    try {
      await api.patch("/settings/mcp", { enabled: mcpEnabled });
      setSnack(t("settings.mcp.savedSuccess"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("common:errors.generic"));
    } finally {
      setSavingMcp(false);
    }
  };

  const showProviderUrl = aiProviderType !== "anthropic";
  const showApiKey = aiProviderType !== "ollama";
  const hasApiKeySet = aiApiKey === AI_KEY_MASK;

  const providerUrlPlaceholder =
    aiProviderType === "openai" ? "https://api.openai.com" : "http://localhost:11434";

  const modelPlaceholder =
    aiProviderType === "openai"
      ? "gpt-4o-mini"
      : aiProviderType === "anthropic"
        ? "claude-sonnet-4-20250514"
        : "gemma3:4b";

  const modelHelper =
    aiProviderType === "openai"
      ? t("settings.ai.modelHelperOpenai")
      : aiProviderType === "anthropic"
        ? t("settings.ai.modelHelperAnthropic")
        : t("settings.ai.modelHelper");

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

      {/* ── AI Provider ──────────────────────────────────────────── */}
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
          <MaterialSymbol icon="dns" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.ai.providerTitle")}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("settings.ai.providerDescription")}
        </Typography>

        {/* Provider Type */}
        <TextField
          select
          label={t("settings.ai.providerType")}
          fullWidth
          value={aiProviderType}
          onChange={(e) => handleProviderTypeChange(e.target.value)}
          sx={{ mb: 1 }}
        >
          <MenuItem value="ollama">{t("settings.ai.providerOllama")}</MenuItem>
          <MenuItem value="openai">{t("settings.ai.providerOpenai")}</MenuItem>
          <MenuItem value="anthropic">{t("settings.ai.providerAnthropic")}</MenuItem>
        </TextField>
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 2 }}>
          {aiProviderType === "ollama"
            ? t("settings.ai.providerOllamaDesc")
            : aiProviderType === "openai"
              ? t("settings.ai.providerOpenaiDesc")
              : t("settings.ai.providerAnthropicDesc")}
        </Typography>

        {/* Provider URL (hidden for Anthropic) */}
        {showProviderUrl && (
          <TextField
            label={t("settings.ai.providerUrl")}
            fullWidth
            value={aiProviderUrl}
            onChange={(e) => setAiProviderUrl(e.target.value)}
            placeholder={providerUrlPlaceholder}
            helperText={
              aiProviderType === "openai"
                ? t("settings.ai.providerUrlHelperOpenai")
                : t("settings.ai.providerUrlHelper")
            }
            sx={{ mb: 2 }}
          />
        )}

        {/* API Key (hidden for Ollama) */}
        {showApiKey && (
          <TextField
            label={t("settings.ai.apiKey")}
            fullWidth
            type="password"
            value={aiApiKey}
            onChange={(e) => setAiApiKey(e.target.value)}
            placeholder={hasApiKeySet ? "" : "sk-..."}
            helperText={
              hasApiKeySet ? t("settings.ai.apiKeySet") : t("settings.ai.apiKeyHelper")
            }
            sx={{ mb: 2 }}
          />
        )}

        {/* Model */}
        {(aiProviderType === "ollama" || aiProviderType === "openai") &&
        aiAvailableModels.length > 0 ? (
          <TextField
            select
            label={t("settings.ai.model")}
            fullWidth
            value={aiModel}
            onChange={(e) => setAiModel(e.target.value)}
            helperText={
              aiProviderType === "ollama" ? t("settings.ai.modelPickerHelper") : modelHelper
            }
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
            placeholder={modelPlaceholder}
            helperText={modelHelper}
            sx={{ mb: 2 }}
          />
        )}

        <Box sx={{ display: "flex", gap: 1, justifyContent: "flex-end" }}>
          {(aiProviderUrl || aiProviderType === "anthropic") && (
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

      {/* ── AI Features ──────────────────────────────────────────── */}
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
        {t("settings.ai.sectionFeatures")}
      </Typography>

      {/* AI Description Suggestions */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="auto_awesome" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.ai.title")}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("settings.ai.description")}
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
            {/* Search Info */}
            <Alert severity="info" icon={false} sx={{ mb: 2, py: 0.5 }}>
              <Typography variant="caption">{t("settings.ai.searchInfo")}</Typography>
            </Alert>

            {/* Enabled Types */}
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

      {/* AI Portfolio Insights */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="insights" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.ai.portfolioInsightsTitle")}
          </Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("settings.ai.portfolioInsightsDescription")}
        </Typography>

        <FormControlLabel
          control={
            <Switch
              checked={portfolioInsightsEnabled}
              onChange={(e) => setPortfolioInsightsEnabled(e.target.checked)}
            />
          }
          label={
            portfolioInsightsEnabled
              ? t("settings.ai.portfolioInsightsEnabled")
              : t("settings.ai.portfolioInsightsDisabled")
          }
          sx={{ mb: 2, display: "block" }}
        />

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

      {/* AI Chat Assistant */}
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
              fontSize: "0.65rem",
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
          label={
            chatEnabled
              ? t("settings.ai.chatEnabledLabel")
              : t("settings.ai.chatDisabledLabel")
          }
          sx={{ mb: 2, display: "block" }}
        />

        {chatEnabled && (
          <>
            <Alert severity="info" icon={false} sx={{ mb: 2, py: 0.5 }}>
              <Typography variant="caption">{t("settings.ai.chatPrivacyNote")}</Typography>
            </Alert>
            <Alert severity="warning" icon={false} sx={{ mb: 2, py: 0.5 }}>
              <Typography variant="caption">{t("settings.ai.chatModelHint")}</Typography>
            </Alert>
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

      {/* ── MCP Integration ──────────────────────────────────────── */}
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
        {t("settings.mcp.sectionTitle")}
      </Typography>

      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
          <MaterialSymbol icon="smart_toy" size={22} color="#555" />
          <Typography variant="h6" fontWeight={600}>
            {t("settings.mcp.title")}
          </Typography>
          <Chip
            label={mcpEnabled ? t("settings.mcp.enabled") : t("settings.mcp.disabled")}
            size="small"
            color={mcpEnabled ? "success" : "default"}
            sx={{ ml: 1 }}
          />
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          {t("settings.mcp.description")}
        </Typography>

        {!mcpSsoConfigured && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {t("settings.mcp.requiresSso")}
          </Alert>
        )}

        <FormControlLabel
          control={
            <Switch
              checked={mcpEnabled}
              onChange={(e) => setMcpEnabled(e.target.checked)}
              disabled={!mcpSsoConfigured}
            />
          }
          label={mcpEnabled ? t("settings.mcp.enabled") : t("settings.mcp.disabled")}
          sx={{ mb: 2 }}
        />

        {mcpEnabled && mcpSsoConfigured && (
          <>
            <Alert severity="info" sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ mb: 1 }}>
                <strong>{t("settings.mcp.setupTitle")}</strong>
              </Typography>
              <Typography variant="body2" component="div">
                1. {t("settings.mcp.setupStep1")}{" "}
                <code>{window.location.origin}/mcp/oauth/callback</code>
              </Typography>
              <Typography variant="body2" component="div">
                2. {t("settings.mcp.setupStep2")}
              </Typography>
            </Alert>
            <Alert severity="success" icon={false} sx={{ mb: 2 }}>
              <Typography variant="body2" sx={{ mb: 0.5 }}>
                <strong>{t("settings.mcp.serverUrl")}</strong>
              </Typography>
              <code>{window.location.origin}/mcp</code>
            </Alert>
          </>
        )}

        <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
          <Button
            variant="contained"
            size="small"
            startIcon={<MaterialSymbol icon="save" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={handleMcpSave}
            disabled={savingMcp}
          >
            {savingMcp ? t("common:labels.loading") : t("common:actions.save")}
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
