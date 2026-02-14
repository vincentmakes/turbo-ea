import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import Avatar from "@mui/material/Avatar";
import AvatarGroup from "@mui/material/AvatarGroup";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import IconButton from "@mui/material/IconButton";
import Pagination from "@mui/material/Pagination";
import MenuItem from "@mui/material/MenuItem";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import LinearProgress from "@mui/material/LinearProgress";
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import type {
  PublicPortal,
  PortalFactSheet,
  PortalFactSheetListResponse,
} from "@/types";

const BASE = "/api/v1";
const TOOLBAR_COLOR = "#1a1a2e";

interface ToggleEntry {
  card: boolean;
  detail: boolean;
}
type Toggles = Record<string, ToggleEntry>;

const DEFAULT_CARD: Record<string, boolean> = {
  description: true,
  lifecycle: true,
  tags: true,
  subscribers: true,
  completion: true,
  quality_seal: false,
  relations: false,
};

const DEFAULT_DETAIL: Record<string, boolean> = {
  description: true,
  lifecycle: true,
  tags: true,
  subscribers: true,
  completion: true,
  quality_seal: true,
  relations: true,
};

function isVisible(
  toggles: Toggles | undefined,
  key: string,
  mode: "card" | "detail",
  fallback: boolean,
): boolean {
  const entry = toggles?.[key];
  if (entry) return mode === "card" ? entry.card : entry.detail;
  const defaults = mode === "card" ? DEFAULT_CARD : DEFAULT_DETAIL;
  return defaults[key] ?? fallback;
}

async function publicGet<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || res.statusText);
  }
  return res.json();
}

function Icon({
  name,
  size = 20,
  color,
}: {
  name: string;
  size?: number;
  color?: string;
}) {
  return (
    <span
      className="material-symbols-outlined"
      style={{ fontSize: size, color, userSelect: "none" }}
    >
      {name}
    </span>
  );
}

const ROLE_LABELS: Record<string, string> = {
  responsible: "Responsible",
  observer: "Observer",
  technical_application_owner: "Technical Owner",
  business_application_owner: "Business Owner",
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function LifecycleBar({ lifecycle }: { lifecycle?: Record<string, string> }) {
  if (!lifecycle) return null;
  const phases = [
    { key: "plan", label: "Plan", color: "#90caf9" },
    { key: "phaseIn", label: "Phase In", color: "#66bb6a" },
    { key: "active", label: "Active", color: "#4caf50" },
    { key: "phaseOut", label: "Phase Out", color: "#ff9800" },
    { key: "endOfLife", label: "End of Life", color: "#f44336" },
  ];
  const filled = phases.filter((p) => lifecycle[p.key]);
  if (filled.length === 0) return null;

  const now = new Date().toISOString().slice(0, 10);
  let currentPhase = filled[0].key;
  for (const p of phases) {
    if (lifecycle[p.key] && lifecycle[p.key] <= now) {
      currentPhase = p.key;
    }
  }

  return (
    <Box sx={{ display: "flex", gap: 0.5, mt: 1 }}>
      {phases.map((p) => {
        const date = lifecycle[p.key];
        const isCurrent = p.key === currentPhase;
        return (
          <Tooltip key={p.key} title={`${p.label}${date ? `: ${date}` : ""}`}>
            <Box
              sx={{
                flex: 1,
                height: 6,
                borderRadius: 3,
                bgcolor: date
                  ? isCurrent
                    ? p.color
                    : `${p.color}40`
                  : "#e0e0e0",
              }}
            />
          </Tooltip>
        );
      })}
    </Box>
  );
}

function FieldValue({
  value,
  field,
}: {
  value: unknown;
  field?: {
    type: string;
    options?: { key: string; label: string; color?: string }[];
  };
}) {
  if (value === null || value === undefined || value === "") {
    return (
      <Typography variant="body2" color="text.disabled">
        —
      </Typography>
    );
  }
  if (field?.type === "boolean") {
    return (
      <Icon
        name={value ? "check_circle" : "cancel"}
        size={18}
        color={value ? "#4caf50" : "#bdbdbd"}
      />
    );
  }
  if (field?.type === "single_select" && field.options) {
    const opt = field.options.find((o) => o.key === value);
    if (opt) {
      return (
        <Chip
          label={opt.label}
          size="small"
          sx={{
            height: 26,
            fontSize: "0.78rem",
            px: 0.5,
            bgcolor: opt.color ? `${opt.color}18` : "action.selected",
            color: opt.color || "text.primary",
            fontWeight: 500,
          }}
        />
      );
    }
  }
  if (
    field?.type === "multiple_select" &&
    Array.isArray(value) &&
    field.options
  ) {
    return (
      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
        {(value as string[]).map((v) => {
          const opt = field.options!.find((o) => o.key === v);
          return (
            <Chip
              key={v}
              label={opt?.label || v}
              size="small"
              sx={{
                height: 24,
                fontSize: "0.73rem",
                px: 0.5,
                bgcolor: opt?.color ? `${opt.color}18` : "action.selected",
                color: opt?.color || "text.primary",
              }}
            />
          );
        })}
      </Box>
    );
  }
  return <Typography variant="body2">{String(value)}</Typography>;
}

export default function PortalViewer() {
  const { slug } = useParams<{ slug: string }>();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [portal, setPortal] = useState<PublicPortal | null>(null);
  const [factSheets, setFactSheets] = useState<PortalFactSheet[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(24);
  const [search, setSearch] = useState("");
  const [subtype, setSubtype] = useState("");
  const [attrFilters, setAttrFilters] = useState<Record<string, string>>({});
  const [sortBy, setSortBy] = useState("name");
  const [sortDir, setSortDir] = useState("asc");
  const [loading, setLoading] = useState(true);
  const [fsLoading, setFsLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedFs, setSelectedFs] = useState<PortalFactSheet | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!slug) return;
    setLoading(true);
    publicGet<PublicPortal>(`/web-portals/public/${slug}`)
      .then(setPortal)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [slug]);

  const loadFactSheets = useCallback(async () => {
    if (!slug) return;
    setFsLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (subtype) params.set("subtype", subtype);
      const activeAttrFilters = Object.fromEntries(
        Object.entries(attrFilters).filter(([, v]) => v !== "")
      );
      if (Object.keys(activeAttrFilters).length > 0) {
        params.set("attr_filters", JSON.stringify(activeAttrFilters));
      }
      params.set("page", String(page));
      params.set("page_size", String(pageSize));
      params.set("sort_by", sortBy);
      params.set("sort_dir", sortDir);
      const data = await publicGet<PortalFactSheetListResponse>(
        `/web-portals/public/${slug}/fact-sheets?${params.toString()}`
      );
      setFactSheets(data.items);
      setTotal(data.total);
    } catch {
      // ignore
    } finally {
      setFsLoading(false);
    }
  }, [slug, search, subtype, attrFilters, page, pageSize, sortBy, sortDir]);

  useEffect(() => {
    if (portal) loadFactSheets();
  }, [portal, loadFactSheets]);

  const handleSearchChange = (value: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      setSearch(value);
      setPage(1);
    }, 300);
  };

  const totalPages = Math.ceil(total / pageSize);

  const allFields =
    portal?.type_info?.fields_schema?.flatMap((s) => s.fields) || [];
  const cardToggles = (portal?.card_config as Record<string, unknown>)?.toggles as Toggles | undefined;

  // Card-level visible fields: respect per-field toggles, fallback to first 3
  const cardVisibleFields = allFields.filter((f, idx) =>
    isVisible(cardToggles, `field:${f.key}`, "card", idx < 3)
  );
  // Detail-level visible fields
  const detailVisibleFields = allFields.filter((f) =>
    isVisible(cardToggles, `field:${f.key}`, "detail", true)
  );

  const show = (key: string, mode: "card" | "detail", fallback = true) =>
    isVisible(cardToggles, key, mode, fallback);

  // Filterable fields: select-type fields that are visible on card or detail
  const filterableFields = allFields.filter(
    (f) =>
      (f.type === "single_select" || f.type === "multiple_select") &&
      f.options &&
      f.options.length > 0 &&
      (cardVisibleFields.includes(f) || detailVisibleFields.includes(f))
  );

  const hasActiveFilters =
    subtype !== "" || Object.values(attrFilters).some((v) => v !== "");

  if (loading) {
    return (
      <Box
        sx={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
          bgcolor: "#f5f7fa",
        }}
      >
        <CircularProgress />
      </Box>
    );
  }

  if (error || !portal) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          minHeight: "100vh",
          bgcolor: "#f5f7fa",
          gap: 2,
        }}
      >
        <Icon name="error_outline" size={64} color="#bbb" />
        <Typography variant="h5" color="text.secondary">
          {error || "Portal not found"}
        </Typography>
        <Typography variant="body2" color="text.disabled">
          This portal may not exist or may not be published yet.
        </Typography>
      </Box>
    );
  }

  const typeColor = portal.type_info?.color || "#1976d2";

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "#f0f2f5" }}>
      {/* Header — matches Turbo EA toolbar */}
      <Box
        sx={{
          bgcolor: TOOLBAR_COLOR,
          color: "#fff",
          py: { xs: 3, md: 4 },
          px: { xs: 2, md: 4 },
        }}
      >
        <Box sx={{ maxWidth: 1200, mx: "auto" }}>
          <Box
            sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}
          >
            <Box
              sx={{
                width: 40,
                height: 40,
                borderRadius: 1.5,
                bgcolor: "rgba(255,255,255,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Icon
                name={portal.type_info?.icon || "language"}
                size={24}
                color="#fff"
              />
            </Box>
            <Typography variant="h4" fontWeight={700} sx={{ letterSpacing: -0.5 }}>
              {portal.name}
            </Typography>
          </Box>
          {portal.description && (
            <Typography
              variant="body1"
              sx={{ opacity: 0.8, maxWidth: 700, mt: 0.5, lineHeight: 1.6 }}
            >
              {portal.description}
            </Typography>
          )}
          <Typography variant="body2" sx={{ mt: 1.5, opacity: 0.5, fontSize: "0.8rem" }}>
            {total} {portal.type_info?.label || "item"}
            {total !== 1 ? "s" : ""}
          </Typography>
        </Box>
      </Box>

      {/* Search & Filters Bar */}
      <Box
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          bgcolor: "#fff",
          borderBottom: "1px solid #ddd",
          boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
          px: { xs: 2, md: 4 },
          py: 1.5,
        }}
      >
        <Box
          sx={{
            maxWidth: 1200,
            mx: "auto",
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            flexWrap: "wrap",
          }}
        >
          <TextField
            size="small"
            placeholder={`Search ${portal.type_info?.label || "items"}...`}
            defaultValue={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            sx={{ flex: 1, minWidth: 200 }}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <Icon name="search" size={20} color="#999" />
                </InputAdornment>
              ),
            }}
          />

          <IconButton
            size="small"
            onClick={() => setFiltersOpen(!filtersOpen)}
            sx={{
              bgcolor: filtersOpen ? `${typeColor}15` : "transparent",
              color: filtersOpen ? typeColor : "text.secondary",
            }}
          >
            <Icon name="tune" size={22} />
          </IconButton>

          <TextField
            select
            size="small"
            value={`${sortBy}-${sortDir}`}
            onChange={(e) => {
              const [sb, sd] = e.target.value.split("-");
              setSortBy(sb);
              setSortDir(sd);
              setPage(1);
            }}
            sx={{ minWidth: 180, "& .MuiSelect-select": { pr: "32px !important" } }}
          >
            <MenuItem value="name-asc">Name A-Z</MenuItem>
            <MenuItem value="name-desc">Name Z-A</MenuItem>
            <MenuItem value="updated_at-desc">Recently Updated</MenuItem>
            <MenuItem value="completion-desc">Highest Completion</MenuItem>
            <MenuItem value="completion-asc">Lowest Completion</MenuItem>
          </TextField>
        </Box>

        <Collapse in={filtersOpen}>
          <Box
            sx={{
              maxWidth: 1200,
              mx: "auto",
              display: "flex",
              gap: 1.5,
              flexWrap: "wrap",
              mt: 1.5,
              pb: 0.5,
            }}
          >
            {portal.type_info?.subtypes &&
              portal.type_info.subtypes.length > 0 && (
                <TextField
                  select
                  size="small"
                  label="Subtype"
                  value={subtype}
                  onChange={(e) => {
                    setSubtype(e.target.value);
                    setPage(1);
                  }}
                  sx={{ minWidth: 180, "& .MuiSelect-select": { pr: "32px !important" } }}
                >
                  <MenuItem value="">All Subtypes</MenuItem>
                  {portal.type_info.subtypes.map((st) => (
                    <MenuItem key={st.key} value={st.key}>
                      {st.label}
                    </MenuItem>
                  ))}
                </TextField>
              )}

            {filterableFields.map((field) => (
              <TextField
                key={field.key}
                select
                size="small"
                label={field.label}
                value={attrFilters[field.key] || ""}
                onChange={(e) => {
                  setAttrFilters((prev) => ({
                    ...prev,
                    [field.key]: e.target.value,
                  }));
                  setPage(1);
                }}
                sx={{ minWidth: 180, "& .MuiSelect-select": { pr: "32px !important" } }}
              >
                <MenuItem value="">All</MenuItem>
                {field.options!.map((opt) => (
                  <MenuItem key={opt.key} value={opt.key}>
                    {opt.label}
                  </MenuItem>
                ))}
              </TextField>
            ))}

            {hasActiveFilters && (
              <Chip
                label="Clear Filters"
                size="small"
                onDelete={() => {
                  setSubtype("");
                  setAttrFilters({});
                  setPage(1);
                }}
                sx={{ alignSelf: "center" }}
              />
            )}
          </Box>
        </Collapse>
      </Box>

      {fsLoading && <LinearProgress sx={{ height: 2 }} />}

      {/* Cards Grid */}
      <Box sx={{ maxWidth: 1200, mx: "auto", px: { xs: 2, md: 4 }, py: 3 }}>
        {factSheets.length === 0 && !fsLoading && (
          <Box sx={{ textAlign: "center", py: 8 }}>
            <Icon name="search_off" size={48} color="#ccc" />
            <Typography variant="h6" color="text.secondary" sx={{ mt: 1 }}>
              No results found
            </Typography>
            <Typography variant="body2" color="text.disabled">
              Try adjusting your search or filters.
            </Typography>
          </Box>
        )}

        <Box
          sx={{
            display: "grid",
            gridTemplateColumns: {
              xs: "1fr",
              sm: "repeat(2, 1fr)",
              md: "repeat(3, 1fr)",
            },
            gap: 2.5,
          }}
        >
          {factSheets.map((fs) => (
            <Card
              key={fs.id}
              sx={{
                borderRadius: 2.5,
                border: "1px solid #e0e0e0",
                bgcolor: "#fff",
                transition: "box-shadow 0.2s, transform 0.15s",
                "&:hover": {
                  boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
                  transform: "translateY(-2px)",
                },
              }}
              variant="outlined"
            >
              <CardActionArea onClick={() => setSelectedFs(fs)}>
                {/* Colored top stripe */}
                <Box sx={{ height: 4, bgcolor: typeColor }} />
                <CardContent sx={{ p: 2.5, pt: 2 }}>
                  {/* Header */}
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 1.5,
                      mb: 1.5,
                    }}
                  >
                    <Box
                      sx={{
                        width: 42,
                        height: 42,
                        borderRadius: 1.5,
                        bgcolor: `${typeColor}12`,
                        border: `1px solid ${typeColor}30`,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        flexShrink: 0,
                      }}
                    >
                      <Icon
                        name={portal.type_info?.icon || "description"}
                        size={22}
                        color={typeColor}
                      />
                    </Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography
                        variant="subtitle1"
                        fontWeight={700}
                        sx={{
                          lineHeight: 1.3,
                          color: "#1a1a2e",
                          fontSize: "0.95rem",
                          display: "-webkit-box",
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: "vertical",
                          overflow: "hidden",
                        }}
                      >
                        {fs.name}
                      </Typography>
                      {fs.subtype && (
                        <Typography
                          variant="caption"
                          sx={{ color: "#666", fontSize: "0.75rem" }}
                        >
                          {portal.type_info?.subtypes?.find(
                            (st) => st.key === fs.subtype
                          )?.label || fs.subtype}
                        </Typography>
                      )}
                    </Box>
                  </Box>

                  {/* Description preview */}
                  {show("description", "card") && fs.description && (
                    <Typography
                      variant="body2"
                      sx={{
                        mb: 1.5,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                        fontSize: "0.82rem",
                        lineHeight: 1.6,
                        color: "#555",
                      }}
                    >
                      {fs.description.replace(/<[^>]*>/g, "")}
                    </Typography>
                  )}

                  {/* Key fields */}
                  {cardVisibleFields.length > 0 && (
                    <Box
                      sx={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 2,
                        mb: 1.5,
                      }}
                    >
                      {cardVisibleFields.slice(0, 3).map((field) => {
                        const val = fs.attributes?.[field.key];
                        if (val === null || val === undefined || val === "")
                          return null;
                        return (
                          <Box key={field.key} sx={{ minWidth: 0 }}>
                            <Typography
                              variant="caption"
                              sx={{
                                display: "block",
                                fontSize: "0.68rem",
                                textTransform: "uppercase",
                                letterSpacing: 0.5,
                                color: "#888",
                                fontWeight: 600,
                                mb: 0.4,
                              }}
                            >
                              {field.label}
                            </Typography>
                            <FieldValue value={val} field={field} />
                          </Box>
                        );
                      })}
                    </Box>
                  )}

                  {/* Lifecycle */}
                  {show("lifecycle", "card") && (
                    <LifecycleBar lifecycle={fs.lifecycle} />
                  )}

                  {/* Quality Seal */}
                  {show("quality_seal", "card", false) && fs.quality_seal && fs.quality_seal !== "DRAFT" && (
                    <Chip
                      label={fs.quality_seal}
                      size="small"
                      sx={{
                        mt: 1,
                        height: 24,
                        fontSize: "0.73rem",
                        fontWeight: 600,
                        px: 0.5,
                        bgcolor:
                          fs.quality_seal === "APPROVED"
                            ? "#e8f5e9"
                            : fs.quality_seal === "REJECTED"
                              ? "#ffebee"
                              : "#fff3e0",
                        color:
                          fs.quality_seal === "APPROVED"
                            ? "#2e7d32"
                            : fs.quality_seal === "REJECTED"
                              ? "#c62828"
                              : "#e65100",
                      }}
                    />
                  )}

                  {/* Tags */}
                  {show("tags", "card") && fs.tags.length > 0 && (
                    <Box
                      sx={{
                        display: "flex",
                        gap: 0.75,
                        flexWrap: "wrap",
                        mt: 1.5,
                      }}
                    >
                      {fs.tags.slice(0, 4).map((tag) => (
                        <Chip
                          key={tag.id}
                          label={tag.name}
                          size="small"
                          sx={{
                            height: 24,
                            fontSize: "0.73rem",
                            px: 0.5,
                            bgcolor: tag.color
                              ? `${tag.color}18`
                              : "#f0f0f0",
                            color: tag.color || "#555",
                            fontWeight: 500,
                          }}
                        />
                      ))}
                      {fs.tags.length > 4 && (
                        <Chip
                          label={`+${fs.tags.length - 4}`}
                          size="small"
                          sx={{ height: 24, fontSize: "0.73rem" }}
                        />
                      )}
                    </Box>
                  )}

                  {/* Bottom row: subscribers + completion */}
                  {(show("subscribers", "card") || show("completion", "card")) && (
                  <Box
                    sx={{
                      display: "flex",
                      alignItems: "center",
                      gap: 1,
                      mt: 2,
                      pt: 1.5,
                      borderTop: "1px solid #f0f0f0",
                    }}
                  >
                    {/* Subscribers */}
                    {show("subscribers", "card") && fs.subscriptions && fs.subscriptions.length > 0 && (
                      <Tooltip
                        title={fs.subscriptions
                          .map(
                            (s) =>
                              `${s.display_name} (${ROLE_LABELS[s.role] || s.role})`
                          )
                          .join(", ")}
                      >
                        <AvatarGroup
                          max={3}
                          sx={{
                            "& .MuiAvatar-root": {
                              width: 24,
                              height: 24,
                              fontSize: "0.6rem",
                              fontWeight: 600,
                              border: "2px solid #fff",
                            },
                          }}
                        >
                          {fs.subscriptions.map((s, i) => (
                            <Avatar
                              key={i}
                              sx={{
                                bgcolor:
                                  s.role === "responsible"
                                    ? typeColor
                                    : "#9e9e9e",
                              }}
                            >
                              {initials(s.display_name)}
                            </Avatar>
                          ))}
                        </AvatarGroup>
                      </Tooltip>
                    )}

                    <Box sx={{ flex: 1 }} />

                    {/* Completion */}
                    {show("completion", "card") && (
                    <>
                    <LinearProgress
                      variant="determinate"
                      value={fs.completion}
                      sx={{
                        width: 60,
                        height: 4,
                        borderRadius: 2,
                        bgcolor: "#eee",
                        "& .MuiLinearProgress-bar": {
                          bgcolor:
                            fs.completion >= 80
                              ? "#4caf50"
                              : fs.completion >= 50
                                ? "#ff9800"
                                : "#ef5350",
                          borderRadius: 2,
                        },
                      }}
                    />
                    <Typography
                      variant="caption"
                      sx={{
                        fontSize: "0.73rem",
                        color: "#777",
                        fontWeight: 600,
                        minWidth: 32,
                        textAlign: "right",
                      }}
                    >
                      {Math.round(fs.completion)}%
                    </Typography>
                    </>
                    )}
                  </Box>
                  )}
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Box>

        {/* Pagination */}
        {totalPages > 1 && (
          <Box sx={{ display: "flex", justifyContent: "center", mt: 4 }}>
            <Pagination
              count={totalPages}
              page={page}
              onChange={(_, p) => setPage(p)}
              color="primary"
              size={isMobile ? "small" : "medium"}
            />
          </Box>
        )}
      </Box>

      {/* Detail Dialog */}
      <Dialog
        open={!!selectedFs}
        onClose={() => setSelectedFs(null)}
        maxWidth="md"
        fullWidth
        fullScreen={isMobile}
      >
        {selectedFs && (
          <>
            <DialogTitle
              sx={{
                display: "flex",
                alignItems: "flex-start",
                gap: 2,
                pb: 1,
                bgcolor: "#fafbfc",
                borderBottom: "1px solid #eee",
              }}
            >
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  borderRadius: 2,
                  bgcolor: `${typeColor}12`,
                  border: `1px solid ${typeColor}30`,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  mt: 0.5,
                }}
              >
                <Icon
                  name={portal.type_info?.icon || "description"}
                  size={28}
                  color={typeColor}
                />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography
                  variant="h5"
                  fontWeight={700}
                  sx={{ color: "#1a1a2e" }}
                >
                  {selectedFs.name}
                </Typography>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.25,
                    mt: 1,
                    flexWrap: "wrap",
                  }}
                >
                  <Chip
                    label={portal.type_info?.label || selectedFs.type}
                    size="small"
                    sx={{
                      height: 28,
                      fontSize: "0.8rem",
                      px: 0.75,
                      bgcolor: `${typeColor}15`,
                      color: typeColor,
                      fontWeight: 600,
                    }}
                  />
                  {selectedFs.subtype && (
                    <Chip
                      label={
                        portal.type_info?.subtypes?.find(
                          (st) => st.key === selectedFs.subtype
                        )?.label || selectedFs.subtype
                      }
                      size="small"
                      variant="outlined"
                      sx={{ height: 28, fontSize: "0.8rem", px: 0.75 }}
                    />
                  )}
                  {show("completion", "detail") && (
                  <Chip
                    label={`${Math.round(selectedFs.completion)}% complete`}
                    size="small"
                    sx={{
                      height: 28,
                      fontSize: "0.8rem",
                      px: 0.75,
                      bgcolor:
                        selectedFs.completion >= 80
                          ? "#e8f5e9"
                          : selectedFs.completion >= 50
                            ? "#fff3e0"
                            : "#ffebee",
                      color:
                        selectedFs.completion >= 80
                          ? "#2e7d32"
                          : selectedFs.completion >= 50
                            ? "#e65100"
                            : "#c62828",
                      fontWeight: 600,
                    }}
                  />
                  )}
                  {show("quality_seal", "detail") && selectedFs.quality_seal && selectedFs.quality_seal !== "DRAFT" && (
                  <Chip
                    label={selectedFs.quality_seal}
                    size="small"
                    sx={{
                      height: 28,
                      fontSize: "0.8rem",
                      px: 0.75,
                      fontWeight: 600,
                      bgcolor:
                        selectedFs.quality_seal === "APPROVED"
                          ? "#e8f5e9"
                          : selectedFs.quality_seal === "REJECTED"
                            ? "#ffebee"
                            : "#fff3e0",
                      color:
                        selectedFs.quality_seal === "APPROVED"
                          ? "#2e7d32"
                          : selectedFs.quality_seal === "REJECTED"
                            ? "#c62828"
                            : "#e65100",
                    }}
                  />
                  )}
                </Box>
              </Box>
              <IconButton onClick={() => setSelectedFs(null)} sx={{ mt: -0.5 }}>
                <Icon name="close" size={24} />
              </IconButton>
            </DialogTitle>
            <DialogContent sx={{ pt: 3 }}>
              {/* Description */}
              {show("description", "detail") && selectedFs.description && (
                <Box sx={{ mb: 3 }}>
                  <Typography
                    variant="subtitle2"
                    fontWeight={700}
                    sx={{
                      mb: 0.75,
                      textTransform: "uppercase",
                      fontSize: "0.75rem",
                      letterSpacing: 1,
                      color: "#888",
                    }}
                  >
                    Description
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{
                      lineHeight: 1.7,
                      whiteSpace: "pre-wrap",
                      color: "#333",
                    }}
                    dangerouslySetInnerHTML={{
                      __html: selectedFs.description,
                    }}
                  />
                </Box>
              )}

              {/* Lifecycle */}
              {show("lifecycle", "detail") && selectedFs.lifecycle &&
                Object.values(selectedFs.lifecycle).some(Boolean) && (
                  <Box sx={{ mb: 3 }}>
                    <Typography
                      variant="subtitle2"
                      fontWeight={700}
                      sx={{
                        mb: 1.25,
                        textTransform: "uppercase",
                        fontSize: "0.75rem",
                        letterSpacing: 1,
                        color: "#888",
                      }}
                    >
                      Lifecycle
                    </Typography>
                    <Box sx={{ display: "flex", gap: 2.5, flexWrap: "wrap" }}>
                      {[
                        { key: "plan", label: "Plan" },
                        { key: "phaseIn", label: "Phase In" },
                        { key: "active", label: "Active" },
                        { key: "phaseOut", label: "Phase Out" },
                        { key: "endOfLife", label: "End of Life" },
                      ].map((phase) => {
                        const date = selectedFs.lifecycle?.[phase.key];
                        if (!date) return null;
                        return (
                          <Box key={phase.key}>
                            <Typography
                              variant="caption"
                              sx={{ display: "block", fontSize: "0.73rem", color: "#888", mb: 0.25 }}
                            >
                              {phase.label}
                            </Typography>
                            <Typography
                              variant="body2"
                              fontWeight={600}
                              sx={{ color: "#333" }}
                            >
                              {date}
                            </Typography>
                          </Box>
                        );
                      })}
                    </Box>
                    <LifecycleBar lifecycle={selectedFs.lifecycle} />
                  </Box>
                )}

              {/* Attributes */}
              {portal.type_info?.fields_schema?.map((section) => {
                const detailFieldKeys = new Set(detailVisibleFields.map((f) => f.key));
                const fieldsWithValues = section.fields.filter(
                  (f) =>
                    detailFieldKeys.has(f.key) &&
                    selectedFs.attributes?.[f.key] !== undefined &&
                    selectedFs.attributes?.[f.key] !== null &&
                    selectedFs.attributes?.[f.key] !== ""
                );
                if (fieldsWithValues.length === 0) return null;
                return (
                  <Box key={section.section} sx={{ mb: 3 }}>
                    <Typography
                      variant="subtitle2"
                      fontWeight={700}
                      sx={{
                        mb: 1.25,
                        textTransform: "uppercase",
                        fontSize: "0.75rem",
                        letterSpacing: 1,
                        color: "#888",
                      }}
                    >
                      {section.section}
                    </Typography>
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" },
                        gap: 2,
                      }}
                    >
                      {fieldsWithValues.map((field) => (
                        <Box key={field.key}>
                          <Typography
                            variant="caption"
                            sx={{ display: "block", fontSize: "0.73rem", color: "#888", mb: 0.25 }}
                          >
                            {field.label}
                          </Typography>
                          <FieldValue
                            value={selectedFs.attributes?.[field.key]}
                            field={field}
                          />
                        </Box>
                      ))}
                    </Box>
                  </Box>
                );
              })}

              {/* Subscribers */}
              {show("subscribers", "detail") && selectedFs.subscriptions &&
                selectedFs.subscriptions.length > 0 && (
                  <Box sx={{ mb: 3 }}>
                    <Typography
                      variant="subtitle2"
                      fontWeight={700}
                      sx={{
                        mb: 1.25,
                        textTransform: "uppercase",
                        fontSize: "0.75rem",
                        letterSpacing: 1,
                        color: "#888",
                      }}
                    >
                      Subscribers
                    </Typography>
                    <Box
                      sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}
                    >
                      {selectedFs.subscriptions.map((sub, i) => (
                        <Box
                          key={i}
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            bgcolor: "#f5f5f5",
                            borderRadius: 2,
                            px: 1.5,
                            py: 0.75,
                          }}
                        >
                          <Avatar
                            sx={{
                              width: 32,
                              height: 32,
                              fontSize: "0.73rem",
                              fontWeight: 700,
                              bgcolor:
                                sub.role === "responsible"
                                  ? typeColor
                                  : "#9e9e9e",
                            }}
                          >
                            {initials(sub.display_name)}
                          </Avatar>
                          <Box>
                            <Typography
                              variant="body2"
                              fontWeight={600}
                              sx={{ fontSize: "0.85rem", color: "#333" }}
                            >
                              {sub.display_name}
                            </Typography>
                            <Typography
                              variant="caption"
                              sx={{ display: "block", fontSize: "0.73rem", color: "#888", mb: 0.25 }}
                            >
                              {ROLE_LABELS[sub.role] || sub.role}
                            </Typography>
                          </Box>
                        </Box>
                      ))}
                    </Box>
                  </Box>
                )}

              {/* Tags */}
              {show("tags", "detail") && selectedFs.tags.length > 0 && (
                <Box sx={{ mb: 3 }}>
                  <Typography
                    variant="subtitle2"
                    fontWeight={700}
                    sx={{
                      mb: 1,
                      textTransform: "uppercase",
                      fontSize: "0.75rem",
                      letterSpacing: 1,
                      color: "#888",
                    }}
                  >
                    Tags
                  </Typography>
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                    {selectedFs.tags.map((tag) => (
                      <Chip
                        key={tag.id}
                        label={
                          tag.group_name
                            ? `${tag.group_name}: ${tag.name}`
                            : tag.name
                        }
                        size="small"
                        sx={{
                          height: 28,
                          fontSize: "0.8rem",
                          px: 0.75,
                          bgcolor: tag.color ? `${tag.color}18` : "#f0f0f0",
                          color: tag.color || "#444",
                          fontWeight: 500,
                        }}
                      />
                    ))}
                  </Box>
                </Box>
              )}

              {/* Relations */}
              {show("relations", "detail") && selectedFs.relations.length > 0 && (
                <Box sx={{ mb: 3 }}>
                  <Typography
                    variant="subtitle2"
                    fontWeight={700}
                    sx={{
                      mb: 1.25,
                      textTransform: "uppercase",
                      fontSize: "0.75rem",
                      letterSpacing: 1,
                      color: "#888",
                    }}
                  >
                    Related Items
                  </Typography>
                  {(() => {
                    const grouped: Record<
                      string,
                      typeof selectedFs.relations
                    > = {};
                    for (const rel of selectedFs.relations) {
                      const rt = portal.relation_types.find(
                        (r) => r.key === rel.type
                      );
                      const label =
                        rel.direction === "outgoing"
                          ? rt?.label || rel.type
                          : rt?.reverse_label || rt?.label || rel.type;
                      grouped[label] = grouped[label] || [];
                      grouped[label].push(rel);
                    }
                    return Object.entries(grouped).map(([label, rels]) => (
                      <Box key={label} sx={{ mb: 2 }}>
                        <Typography
                          variant="caption"
                          fontWeight={600}
                          sx={{
                            mb: 0.75,
                            display: "block",
                            fontSize: "0.78rem",
                            color: "#555",
                          }}
                        >
                          {label}
                        </Typography>
                        <Box
                          sx={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: 1,
                          }}
                        >
                          {rels.map((rel, i) => (
                            <Chip
                              key={`${rel.related_id}-${i}`}
                              label={rel.related_name}
                              size="small"
                              variant="outlined"
                              sx={{ height: 28, fontSize: "0.8rem", px: 0.75, fontWeight: 500 }}
                            />
                          ))}
                        </Box>
                      </Box>
                    ));
                  })()}
                </Box>
              )}

              {/* Last updated */}
              {selectedFs.updated_at && (
                <>
                  <Divider sx={{ my: 2 }} />
                  <Typography
                    variant="caption"
                    sx={{ color: "#bbb", fontSize: "0.75rem" }}
                  >
                    Last updated:{" "}
                    {new Date(selectedFs.updated_at).toLocaleDateString(
                      undefined,
                      { year: "numeric", month: "long", day: "numeric" }
                    )}
                  </Typography>
                </>
              )}
            </DialogContent>
          </>
        )}
      </Dialog>
    </Box>
  );
}
