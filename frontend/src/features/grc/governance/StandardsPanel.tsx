import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import { SEVERITY_COLORS, STATUS_COLORS, surface } from "@/theme/tokens";
import type { EAStandard } from "@/types";

const COMPLIANCE_LEVEL_COLORS: Record<string, string> = {
  mandated: SEVERITY_COLORS.critical,
  recommended: STATUS_COLORS.info,
  deprecated: STATUS_COLORS.warning,
};

const CATEGORY_ICONS: Record<string, string> = {
  technical: "settings",
  data: "database",
  security: "security",
  interoperability: "hub",
  business: "business_center",
  governance: "gavel",
};

export default function StandardsPanel() {
  const { t } = useTranslation("grc");
  const [loading, setLoading] = useState(true);
  const [standards, setStandards] = useState<EAStandard[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<EAStandard[]>("/metamodel/standards");
        if (!cancelled) {
          setStandards(data.filter((s) => s.is_active).sort((a, b) => a.sort_order - b.sort_order));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (standards.length === 0) {
    return (
      <Box
        sx={{
          py: 6,
          textAlign: "center",
          border: "1px dashed",
          borderColor: "divider",
          borderRadius: 2,
        }}
      >
        <MaterialSymbol icon="rule" size={40} color="#bbb" />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("governance.standards.empty")}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 2 }}>
      {standards.map((standard) => (
        <MuiCard key={standard.id} sx={{ bg: surface }}>
          <CardContent>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 1 }}>
              <Typography variant="h6" sx={{ flexGrow: 1, wordBreak: "break-word" }}>
                {standard.title}
              </Typography>
            </Box>

            {(standard.category || standard.compliance_level) && (
              <Box sx={{ display: "flex", gap: 1, mb: 1, flexWrap: "wrap" }}>
                {standard.category && (
                  <Chip
                    size="small"
                    icon={<MaterialSymbol icon={CATEGORY_ICONS[standard.category] || "label"} size={14} />}
                    label={standard.category}
                    variant="outlined"
                  />
                )}
                {standard.compliance_level && (
                  <Chip
                    size="small"
                    label={standard.compliance_level}
                    sx={{
                      backgroundColor: COMPLIANCE_LEVEL_COLORS[standard.compliance_level] || STATUS_COLORS.info,
                      color: "white",
                    }}
                  />
                )}
              </Box>
            )}

            {standard.description && (
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {standard.description}
              </Typography>
            )}

            {standard.rationale && (
              <>
                <Typography variant="caption" sx={{ fontWeight: 600, display: "block", mt: 1 }}>
                  {t("governance.standards.rationale")}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                  {standard.rationale}
                </Typography>
              </>
            )}

            {standard.reference_url && (
              <Box sx={{ mt: 1 }}>
                <Typography
                  component="a"
                  href={standard.reference_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  variant="body2"
                  sx={{ color: "primary.main", textDecoration: "none", "&:hover": { textDecoration: "underline" } }}
                >
                  {t("governance.standards.reference")}
                </Typography>
              </Box>
            )}

            {standard.card_count > 0 && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1 }}>
                {t("governance.standards.linkedCards", { count: standard.card_count })}
              </Typography>
            )}
          </CardContent>
        </MuiCard>
      ))}
    </Box>
  );
}
