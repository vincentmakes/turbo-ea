import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { EAPrinciple } from "@/types";

export default function PrinciplesPanel() {
  const { t } = useTranslation("grc");
  const [loading, setLoading] = useState(true);
  const [principles, setPrinciples] = useState<EAPrinciple[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<EAPrinciple[]>("/metamodel/principles");
        if (!cancelled) {
          setPrinciples(data.filter((p) => p.is_active).sort((a, b) => a.sort_order - b.sort_order));
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

  if (principles.length === 0) {
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
        <MaterialSymbol icon="bookmark_star" size={40} color="#bbb" />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("governance.principles.empty")}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Typography variant="h6" fontWeight={600}>
        {t("governance.principles.title")}
      </Typography>
      {principles.map((p, idx) => (
        <MuiCard key={p.id} variant="outlined">
          <CardContent sx={{ py: 2, "&:last-child": { pb: 2 } }}>
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
              <Typography
                variant="caption"
                sx={{
                  bgcolor: "primary.main",
                  color: "#fff",
                  borderRadius: "50%",
                  width: 24,
                  height: 24,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  flexShrink: 0,
                  mt: 0.25,
                }}
              >
                {idx + 1}
              </Typography>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.25 }}>
                  {p.title}
                </Typography>
                {p.description && (
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                    {p.description}
                  </Typography>
                )}
                {(p.rationale || p.implications) && (
                  <Box sx={{ display: "flex", gap: 3, mt: 0.5, flexWrap: "wrap" }}>
                    {p.rationale && (
                      <Box sx={{ flex: 1, minWidth: 200 }}>
                        <Typography variant="caption" color="text.secondary" fontWeight={600}>
                          {t("governance.principles.rationale")}:
                        </Typography>
                        <Box component="ul" sx={{ m: 0, pl: 2, listStyleType: "'•  '" }}>
                          {p.rationale
                            .split("\n")
                            .filter(Boolean)
                            .map((line, i) => (
                              <Typography
                                key={i}
                                component="li"
                                variant="caption"
                                color="text.secondary"
                                sx={{ py: 0.1 }}
                              >
                                {line}
                              </Typography>
                            ))}
                        </Box>
                      </Box>
                    )}
                    {p.implications && (
                      <Box sx={{ flex: 1, minWidth: 200 }}>
                        <Typography variant="caption" color="text.secondary" fontWeight={600}>
                          {t("governance.principles.implications")}:
                        </Typography>
                        <Box component="ul" sx={{ m: 0, pl: 2, listStyleType: "'•  '" }}>
                          {p.implications
                            .split("\n")
                            .filter(Boolean)
                            .map((line, i) => (
                              <Typography
                                key={i}
                                component="li"
                                variant="caption"
                                color="text.secondary"
                                sx={{ py: 0.1 }}
                              >
                                {line}
                              </Typography>
                            ))}
                        </Box>
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
            </Box>
          </CardContent>
        </MuiCard>
      ))}
    </Box>
  );
}
