import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import AdrGrid from "@/features/ea-delivery/AdrGrid";
import AdrFilterSidebar, {
  type AdrFilters,
  EMPTY_ADR_FILTERS,
} from "@/features/ea-delivery/AdrFilterSidebar";
import { exportAdrsToDocx } from "@/features/ea-delivery/adrExport";
import CreateAdrDialog from "@/features/ea-delivery/CreateAdrDialog";
import { useAuthContext } from "@/hooks/AuthContext";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useResolveMetaLabel } from "@/hooks/useResolveLabel";
import type { ArchitectureDecision } from "@/types";

export default function DecisionsPanel() {
  const { t } = useTranslation(["grc", "delivery", "common"]);
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const { types: metamodelTypes } = useMetamodel();
  const rml = useResolveMetaLabel();

  const canManage = !!user?.permissions?.["*"] || !!user?.permissions?.["adr.manage"];

  const [adrs, setAdrs] = useState<ArchitectureDecision[]>([]);
  const [loading, setLoading] = useState(true);
  const [adrSearch, setAdrSearch] = useState("");
  const [adrFilters, setAdrFilters] = useState<AdrFilters>({ ...EMPTY_ADR_FILTERS });
  const [adrSidebarCollapsed, setAdrSidebarCollapsed] = useState(false);
  const [adrSidebarWidth, setAdrSidebarWidth] = useState(280);
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.get<ArchitectureDecision[]>("/adr");
      setAdrs(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // ── ADR row handlers ─────────────────────────────────────────────

  const handleDelete = useCallback(
    async (adr: ArchitectureDecision) => {
      if (!confirm(t("delivery:adr.confirm.delete"))) return;
      try {
        await api.delete(`/adr/${adr.id}`);
        setAdrs((prev) => prev.filter((a) => a.id !== adr.id));
      } catch (e) {
        setError(e instanceof Error ? e.message : t("delivery:error.deleteSoaw"));
      }
    },
    [t],
  );

  const handleDuplicate = useCallback(
    async (adr: ArchitectureDecision) => {
      try {
        const dup = await api.post<ArchitectureDecision>(`/adr/${adr.id}/duplicate`);
        navigate(`/ea-delivery/adr/${dup.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("delivery:adr.editor.error.duplicateFailed"));
      }
    },
    [navigate, t],
  );

  const handleExport = useCallback(
    async (selected: ArchitectureDecision[]) => {
      if (selected.length === 0) return;
      try {
        // List endpoint returns a summary — fetch full ADRs to get rich-text fields.
        const full = await Promise.all(
          selected.map((a) => api.get<ArchitectureDecision>(`/adr/${a.id}`)),
        );
        await exportAdrsToDocx(full);
      } catch (e) {
        setError(e instanceof Error ? e.message : t("delivery:adr.export.error"));
      }
    },
    [t],
  );

  // ── ADR filter helpers ───────────────────────────────────────────

  const filteredAdrs = useMemo(() => {
    let list = adrs;
    if (adrFilters.statuses.length > 0) {
      list = list.filter((a) => adrFilters.statuses.includes(a.status));
    }
    if (adrFilters.cardTypes.length > 0) {
      list = list.filter((a) =>
        (a.linked_cards ?? []).some((c) => adrFilters.cardTypes.includes(c.type)),
      );
    }
    if (adrFilters.linkedCards.length > 0) {
      list = list.filter((a) =>
        (a.linked_cards ?? []).some((c) => adrFilters.linkedCards.includes(c.id)),
      );
    }
    if (adrFilters.dateCreatedFrom) {
      list = list.filter((a) => a.created_at && a.created_at >= adrFilters.dateCreatedFrom);
    }
    if (adrFilters.dateCreatedTo) {
      list = list.filter(
        (a) => a.created_at && a.created_at <= adrFilters.dateCreatedTo + "T23:59:59",
      );
    }
    if (adrFilters.dateModifiedFrom) {
      list = list.filter(
        (a) => a.updated_at && a.updated_at >= adrFilters.dateModifiedFrom,
      );
    }
    if (adrFilters.dateModifiedTo) {
      list = list.filter(
        (a) => a.updated_at && a.updated_at <= adrFilters.dateModifiedTo + "T23:59:59",
      );
    }
    if (adrFilters.dateSignedFrom) {
      list = list.filter((a) => a.signed_at && a.signed_at >= adrFilters.dateSignedFrom);
    }
    if (adrFilters.dateSignedTo) {
      list = list.filter(
        (a) => a.signed_at && a.signed_at <= adrFilters.dateSignedTo + "T23:59:59",
      );
    }
    if (adrFilters.signedBy.length > 0) {
      list = list.filter((a) =>
        a.signatories.some(
          (s) => s.status === "signed" && adrFilters.signedBy.includes(s.user_id),
        ),
      );
    }
    return list;
  }, [adrs, adrFilters]);

  const availableCardTypes = useMemo(() => {
    const typeKeys = new Set<string>();
    for (const adr of adrs) {
      for (const c of adr.linked_cards ?? []) typeKeys.add(c.type);
    }
    return [...typeKeys].map((key) => {
      const mt = metamodelTypes.find((mt) => mt.key === key);
      return {
        key,
        label: rml(key, mt?.translations, "label") || key,
        color: mt?.color ?? "#666",
      };
    });
  }, [adrs, metamodelTypes, rml]);

  const availableLinkedCards = useMemo(() => {
    const seen = new Map<
      string,
      { id: string; name: string; type: string; color: string }
    >();
    for (const adr of adrs) {
      for (const c of adr.linked_cards ?? []) {
        if (adrFilters.cardTypes.length > 0 && !adrFilters.cardTypes.includes(c.type)) {
          continue;
        }
        if (!seen.has(c.id)) {
          const mt = metamodelTypes.find((mt) => mt.key === c.type);
          seen.set(c.id, {
            id: c.id,
            name: c.name,
            type: c.type,
            color: mt?.color ?? "#666",
          });
        }
      }
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [adrs, metamodelTypes, adrFilters.cardTypes]);

  const availableSignatories = useMemo(() => {
    const seen = new Map<string, { userId: string; displayName: string }>();
    for (const adr of adrs) {
      for (const s of adr.signatories) {
        if (s.status === "signed" && !seen.has(s.user_id)) {
          seen.set(s.user_id, { userId: s.user_id, displayName: s.display_name });
        }
      }
    }
    return [...seen.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [adrs]);

  return (
    <Box>
      <Stack
        direction={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "flex-start", sm: "center" }}
        justifyContent="space-between"
        spacing={1}
        sx={{ mb: 1.5 }}
      >
        <Typography variant="h6" fontWeight={600}>
          {t("grc:governance.decisions.title")}
        </Typography>
        {canManage && (
          <Button
            variant="contained"
            size="small"
            startIcon={<MaterialSymbol icon="add" size={18} />}
            onClick={() => setCreateOpen(true)}
          >
            {t("grc:governance.decisions.create")}
          </Button>
        )}
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : (
        // Layout: filter sidebar grows with its own natural height, grid uses
        // AG Grid's autoHeight so it sizes to the row count instead of an
        // inner scrollbar. End result: one scroll context — the page itself.
        <Box
          sx={{
            display: "flex",
            alignItems: "flex-start",
            border: 1,
            borderColor: "divider",
            borderRadius: 1,
            overflow: "hidden",
          }}
        >
          <Box sx={{ alignSelf: "stretch", display: "flex" }}>
            <AdrFilterSidebar
              filters={adrFilters}
              onFiltersChange={setAdrFilters}
              collapsed={adrSidebarCollapsed}
              onToggleCollapse={() => setAdrSidebarCollapsed((p) => !p)}
              width={adrSidebarWidth}
              onWidthChange={setAdrSidebarWidth}
              availableCardTypes={availableCardTypes}
              availableLinkedCards={availableLinkedCards}
              availableSignatories={availableSignatories}
            />
          </Box>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <AdrGrid
              adrs={filteredAdrs}
              metamodelTypes={metamodelTypes}
              loading={false}
              quickFilterText={adrSearch}
              onQuickFilterChange={setAdrSearch}
              onEdit={(adr) => navigate(`/ea-delivery/adr/${adr.id}`)}
              onPreview={(adr) => navigate(`/ea-delivery/adr/${adr.id}/preview`)}
              onDuplicate={handleDuplicate}
              onDelete={handleDelete}
              onExport={handleExport}
              autoHeight
            />
          </Box>
        </Box>
      )}

      <CreateAdrDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(adr) => {
          setCreateOpen(false);
          navigate(`/ea-delivery/adr/${adr.id}`);
        }}
      />
    </Box>
  );
}
