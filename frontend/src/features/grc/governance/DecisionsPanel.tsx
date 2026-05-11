import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link as RouterLink } from "react-router-dom";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import MuiCard from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { ArchitectureDecision } from "@/types";

const STATUS_COLOR: Record<ArchitectureDecision["status"], "default" | "warning" | "success"> = {
  draft: "default",
  in_review: "warning",
  signed: "success",
};

export default function DecisionsPanel() {
  const { t } = useTranslation("grc");
  const [loading, setLoading] = useState(true);
  const [decisions, setDecisions] = useState<ArchitectureDecision[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api.get<ArchitectureDecision[]>("/adr");
        if (!cancelled) setDecisions(data);
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

  if (decisions.length === 0) {
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
        <MaterialSymbol icon="fact_check" size={40} color="#bbb" />
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          {t("governance.decisions.empty")}
        </Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Typography variant="h6" fontWeight={600}>
        {t("governance.decisions.title")}
      </Typography>
      {decisions.map((d) => (
        <MuiCard key={d.id} variant="outlined">
          <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              alignItems={{ xs: "flex-start", sm: "center" }}
              spacing={1.5}
            >
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Stack direction="row" alignItems="center" spacing={1} sx={{ flexWrap: "wrap" }}>
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    sx={{ fontFamily: "monospace", fontWeight: 600 }}
                  >
                    {d.reference_number}
                  </Typography>
                  <Typography variant="subtitle2" fontWeight={600} noWrap>
                    {d.title}
                  </Typography>
                </Stack>
                {d.context && (
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      mt: 0.5,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {d.context}
                  </Typography>
                )}
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Chip
                  label={d.status.replace("_", " ")}
                  size="small"
                  color={STATUS_COLOR[d.status]}
                  variant={d.status === "signed" ? "filled" : "outlined"}
                />
                <Button
                  size="small"
                  component={RouterLink}
                  to={`/ea-delivery/adr/${d.id}`}
                  variant="outlined"
                >
                  {t("governance.decisions.open")}
                </Button>
              </Stack>
            </Stack>
          </CardContent>
        </MuiCard>
      ))}
    </Box>
  );
}
