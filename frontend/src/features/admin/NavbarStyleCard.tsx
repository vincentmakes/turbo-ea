import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import { alpha } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import ColorPicker from "@/components/ColorPicker";
import { api } from "@/api/client";
import { useAppTitle } from "@/hooks/useAppTitle";
import { invalidateNavbarStyle } from "@/hooks/useNavbarStyle";
import { contrastRatio } from "@/lib/color";
import { NAVBAR_DEFAULTS, NAVBAR_PRESETS } from "@/theme/tokens";

interface NavbarStyleResponse {
  navbar_bg: string;
  navbar_fg: string;
}

interface Props {
  onSaved: (msg: string) => void;
  onError: (msg: string) => void;
}

/** Admin → Settings → Appearance card: instance-wide navbar colors.
 *  Curated presets + full-custom mode with a live mock-navbar preview. */
export default function NavbarStyleCard({ onSaved, onError }: Props) {
  const { t } = useTranslation("admin");
  const appTitle = useAppTitle();
  const [bg, setBg] = useState<string>(NAVBAR_DEFAULTS.bg);
  const [fg, setFg] = useState<string>(NAVBAR_DEFAULTS.fg);
  const [customMode, setCustomMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Own fetch (not part of GeneralTab's Promise.all) so the card stays
    // self-contained and unit-testable.
    api
      .get<NavbarStyleResponse>("/settings/navbar-style")
      .then((r) => {
        setBg(r.navbar_bg);
        setFg(r.navbar_fg);
        setCustomMode(
          !NAVBAR_PRESETS.some((p) => p.bg === r.navbar_bg && p.fg === r.navbar_fg),
        );
      })
      .catch(() => {
        // Keep defaults — the card still works for picking a new style.
      })
      .finally(() => setLoading(false));
  }, []);

  const selectedPresetKey = customMode
    ? null
    : (NAVBAR_PRESETS.find(
        (p) => p.bg === bg.toLowerCase() && p.fg === fg.toLowerCase(),
      )?.key ?? null);
  const ratio = contrastRatio(bg, fg);

  const applyPreset = (presetBg: string, presetFg: string) => {
    setCustomMode(false);
    setBg(presetBg);
    setFg(presetFg);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await api.patch<NavbarStyleResponse>("/settings/navbar-style", {
        navbar_bg: bg,
        navbar_fg: fg,
      });
      setBg(r.navbar_bg);
      setFg(r.navbar_fg);
      // Broadcast so the real navbar (and the logo preview) updates instantly.
      invalidateNavbarStyle({ bg: r.navbar_bg, fg: r.navbar_fg });
      onSaved(t("settings.navbarStyle.savedSuccess"));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Paper sx={{ p: 3, mb: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", mb: 2, gap: 1 }}>
        <MaterialSymbol icon="palette" size={22} color="#555" />
        <Typography variant="h6" fontWeight={600}>
          {t("settings.navbarStyle.title")}
        </Typography>
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        {t("settings.navbarStyle.description")}
      </Typography>

      {/* Preset swatches + Custom tile */}
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 2 }}>
        {NAVBAR_PRESETS.map((p) => {
          const selected = selectedPresetKey === p.key;
          return (
            <Box
              key={p.key}
              role="radio"
              aria-checked={selected}
              aria-label={t(`settings.navbarStyle.preset.${p.key}`)}
              onClick={() => applyPreset(p.bg, p.fg)}
              sx={{
                width: 132,
                borderRadius: 1,
                cursor: "pointer",
                overflow: "hidden",
                border: "2px solid",
                borderColor: selected ? "primary.main" : "divider",
              }}
            >
              <Box
                sx={{
                  bgcolor: p.bg,
                  height: 34,
                  display: "flex",
                  alignItems: "center",
                  gap: 0.75,
                  px: 1,
                }}
              >
                <Typography sx={{ color: p.fg, fontWeight: 700, fontSize: "0.7rem" }}>
                  Aa
                </Typography>
                <Box sx={{ width: 22, height: 6, borderRadius: 3, bgcolor: alpha(p.fg, 0.7) }} />
                <Box sx={{ width: 22, height: 6, borderRadius: 3, bgcolor: alpha(p.fg, 0.35) }} />
              </Box>
              <Typography
                variant="caption"
                sx={{ display: "block", textAlign: "center", py: 0.25 }}
              >
                {t(`settings.navbarStyle.preset.${p.key}`)}
              </Typography>
            </Box>
          );
        })}

        {/* Custom tile */}
        <Box
          role="radio"
          aria-checked={customMode}
          aria-label={t("settings.navbarStyle.custom")}
          onClick={() => setCustomMode(true)}
          sx={{
            width: 132,
            borderRadius: 1,
            cursor: "pointer",
            overflow: "hidden",
            border: "2px solid",
            borderColor: customMode ? "primary.main" : "divider",
          }}
        >
          <Box
            sx={{
              height: 34,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "action.hover",
            }}
          >
            <MaterialSymbol icon="tune" size={18} />
          </Box>
          <Typography
            variant="caption"
            sx={{ display: "block", textAlign: "center", py: 0.25 }}
          >
            {t("settings.navbarStyle.custom")}
          </Typography>
        </Box>
      </Box>

      {/* Custom color pickers */}
      {customMode && (
        <Box sx={{ display: "flex", gap: 3, mb: 2, flexWrap: "wrap" }}>
          <ColorPicker
            label={t("settings.navbarStyle.background")}
            value={bg}
            onChange={setBg}
          />
          <ColorPicker
            label={t("settings.navbarStyle.text")}
            value={fg}
            onChange={setFg}
          />
        </Box>
      )}

      {/* Live preview */}
      <Typography variant="caption" color="text.secondary">
        {t("settings.navbarStyle.preview")}
      </Typography>
      <Box
        data-testid="navbar-style-preview"
        sx={{
          mt: 0.5,
          mb: 1.5,
          borderRadius: 1,
          border: "1px solid",
          borderColor: "divider",
          bgcolor: bg,
          height: 48,
          display: "flex",
          alignItems: "center",
          gap: 1.5,
          px: 2,
          overflow: "hidden",
        }}
      >
        <Typography
          noWrap
          sx={{ color: fg, fontWeight: 700, fontSize: "0.9rem", mr: 1 }}
        >
          {appTitle}
        </Typography>
        <Typography
          sx={{
            color: fg,
            fontWeight: 700,
            fontSize: "0.8rem",
            bgcolor: alpha(fg, 0.12),
            px: 1,
            py: 0.4,
            borderRadius: 1,
          }}
        >
          {t("settings.navbarStyle.sampleActive")}
        </Typography>
        <Typography sx={{ color: alpha(fg, 0.7), fontSize: "0.8rem" }}>
          {t("settings.navbarStyle.sampleItemA")}
        </Typography>
        <Typography sx={{ color: alpha(fg, 0.7), fontSize: "0.8rem" }}>
          {t("settings.navbarStyle.sampleItemB")}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <MaterialSymbol icon="search" size={18} color={alpha(fg, 0.7)} />
        <MaterialSymbol icon="account_circle" size={20} color={fg} />
      </Box>

      {/* Contrast warning */}
      {ratio < 4.5 && (
        <Alert severity="warning" sx={{ mb: 1.5 }}>
          {t("settings.navbarStyle.contrastWarning")}
        </Alert>
      )}

      <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
        <Button
          variant="contained"
          size="small"
          onClick={handleSave}
          disabled={saving || loading}
          startIcon={
            saving ? <CircularProgress size={16} /> : <MaterialSymbol icon="save" size={18} />
          }
          sx={{ textTransform: "none" }}
        >
          {saving ? t("common:labels.loading") : t("common:actions.save")}
        </Button>
        <Button
          size="small"
          sx={{ textTransform: "none" }}
          onClick={() => applyPreset(NAVBAR_DEFAULTS.bg, NAVBAR_DEFAULTS.fg)}
        >
          {t("settings.navbarStyle.resetDefault")}
        </Button>
      </Box>
    </Paper>
  );
}
