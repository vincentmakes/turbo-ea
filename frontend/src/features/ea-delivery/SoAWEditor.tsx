import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import Snackbar from "@mui/material/Snackbar";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";
import Paper from "@mui/material/Paper";
import Divider from "@mui/material/Divider";
import Select from "@mui/material/Select";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Collapse from "@mui/material/Collapse";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Checkbox from "@mui/material/Checkbox";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";
import MaterialSymbol from "@/components/MaterialSymbol";
import RichTextEditor from "./RichTextEditor";
import EditableTable from "./EditableTable";
import {
  SOAW_TEMPLATE_SECTIONS,
  TOGAF_PHASES,
  buildDefaultSections,
  type TemplateSectionDef,
} from "./soawTemplate";
import { exportToDocx, exportToPdf } from "./soawExport";
import { api } from "@/api/client";
import type { FactSheet, SoAW, SoAWSectionData, SoAWSignatory, User } from "@/types";

// ─── constants ──────────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "draft", label: "Draft" },
  { value: "in_review", label: "In Review" },
  { value: "approved", label: "Approved" },
  { value: "signed", label: "Signed" },
];

// ─── component ──────────────────────────────────────────────────────────────

export default function SoAWEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const theme = useTheme();
  const compact = useMediaQuery(theme.breakpoints.down("sm"));
  const isNew = !id;

  // SoAW state
  const [name, setName] = useState("");
  const [initiativeId, setInitiativeId] = useState("");
  const [status, setStatus] = useState("draft");
  const [docInfo, setDocInfo] = useState({
    prepared_by: "",
    reviewed_by: "",
    review_date: "",
  });
  const [versionHistory, setVersionHistory] = useState<
    { version: string; date: string; revised_by: string; description: string }[]
  >([{ version: "", date: "", revised_by: "", description: "" }]);
  const [sections, setSections] = useState<Record<string, SoAWSectionData>>(
    buildDefaultSections,
  );
  const [customSections, setCustomSections] = useState<
    {
      id: string;
      title: string;
      content: string;
      insertAfter: string;
    }[]
  >([]);

  // UI state
  const [initiatives, setInitiatives] = useState<FactSheet[]>([]);
  const [loading, setLoading] = useState(!!id);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [snack, setSnack] = useState("");
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({});
  const [addSectionOpen, setAddSectionOpen] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("");
  const [newSectionAfter, setNewSectionAfter] = useState("");
  const soawIdRef = useRef<string | null>(id ?? null);

  // Keep ref in sync when route param changes (e.g. after revision navigation)
  useEffect(() => {
    if (id) soawIdRef.current = id;
  }, [id]);

  // Signing state
  const [signatories, setSignatories] = useState<SoAWSignatory[]>([]);
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [revisionNumber, setRevisionNumber] = useState(1);
  const [signDialogOpen, setSignDialogOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedSignatories, setSelectedSignatories] = useState<string[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const isSigned = status === "signed";

  // ── load data ──────────────────────────────────────────────────────────

  useEffect(() => {
    const loadInitiatives = async () => {
      try {
        const res = await api.get<{ items: FactSheet[] }>(
          "/fact-sheets?type=Initiative&page_size=500",
        );
        setInitiatives(res.items);
      } catch {
        /* non-critical */
      }
    };
    const loadUsers = async () => {
      try {
        const res = await api.get<User[]>("/users");
        setUsers(res);
      } catch {
        /* non-critical */
      }
    };
    const loadCurrentUser = async () => {
      try {
        const res = await api.get<{ id: string }>("/auth/me");
        setCurrentUserId(res.id);
      } catch {
        /* non-critical */
      }
    };
    loadInitiatives();
    loadUsers();
    loadCurrentUser();
  }, []);

  useEffect(() => {
    if (!id) return;
    const load = async () => {
      setLoading(true);
      try {
        const data = await api.get<SoAW>(`/soaw/${id}`);
        setName(data.name);
        setInitiativeId(data.initiative_id ?? "");
        setStatus(data.status);
        if (data.document_info) setDocInfo(data.document_info);
        if (data.version_history?.length) setVersionHistory(data.version_history);
        setSignatories(data.signatories ?? []);
        setSignedAt(data.signed_at);
        setRevisionNumber(data.revision_number ?? 1);

        // Merge persisted sections with template defaults so new template
        // sections added later still appear.
        const defaults = buildDefaultSections();
        const merged = { ...defaults };
        const persistedSections = data.sections ?? {};

        // Separate template sections from custom sections
        for (const [key, val] of Object.entries(persistedSections)) {
          if (key.startsWith("custom_")) {
            // Re-hydrate custom sections
            setCustomSections((prev) => {
              const exists = prev.some((c) => c.id === key);
              if (exists) return prev;
              return [
                ...prev,
                {
                  id: key,
                  title: (val as SoAWSectionData & { title?: string }).title ?? key,
                  content: val.content,
                  insertAfter:
                    (val as SoAWSectionData & { insertAfter?: string }).insertAfter ?? "",
                },
              ];
            });
          } else {
            merged[key] = { ...merged[key], ...val };
          }
        }
        setSections(merged);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  // ── section update helpers ─────────────────────────────────────────────

  const updateSection = useCallback(
    (sectionId: string, patch: Partial<SoAWSectionData>) => {
      setSections((prev) => ({
        ...prev,
        [sectionId]: { ...prev[sectionId], ...patch },
      }));
    },
    [],
  );

  const toggleSectionHidden = useCallback((sectionId: string) => {
    setSections((prev) => ({
      ...prev,
      [sectionId]: {
        ...prev[sectionId],
        hidden: !prev[sectionId]?.hidden,
      },
    }));
  }, []);

  const toggleCollapse = (sectionId: string) =>
    setCollapsedSections((prev) => ({
      ...prev,
      [sectionId]: !prev[sectionId],
    }));

  // ── custom sections ────────────────────────────────────────────────────

  const addCustomSection = () => {
    if (!newSectionTitle.trim()) return;
    const cid = `custom_${Date.now()}`;
    setCustomSections((prev) => [
      ...prev,
      {
        id: cid,
        title: newSectionTitle.trim(),
        content: "",
        insertAfter: newSectionAfter,
      },
    ]);
    setNewSectionTitle("");
    setNewSectionAfter("");
    setAddSectionOpen(false);
  };

  const removeCustomSection = (cid: string) => {
    setCustomSections((prev) => prev.filter((c) => c.id !== cid));
    setSections((prev) => {
      const next = { ...prev };
      delete next[cid];
      return next;
    });
  };

  const updateCustomContent = (cid: string, html: string) => {
    setCustomSections((prev) =>
      prev.map((c) => (c.id === cid ? { ...c, content: html } : c)),
    );
  };

  // ── save ───────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!name.trim()) {
      setError("Document name is required");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // Merge custom sections into the sections record for persistence
      const allSections: Record<string, unknown> = { ...sections };
      for (const cs of customSections) {
        allSections[cs.id] = {
          content: cs.content,
          hidden: false,
          title: cs.title,
          insertAfter: cs.insertAfter,
        };
      }

      const payload = {
        name: name.trim(),
        initiative_id: initiativeId || null,
        status,
        document_info: docInfo,
        version_history: versionHistory,
        sections: allSections,
      };

      if (soawIdRef.current) {
        await api.patch(`/soaw/${soawIdRef.current}`, payload);
      } else {
        const created = await api.post<SoAW>("/soaw", payload);
        soawIdRef.current = created.id;
        // Update URL without re-rendering
        window.history.replaceState(null, "", `/ea-delivery/soaw/${created.id}`);
      }
      setSnack("Saved successfully");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // ── signing helpers ────────────────────────────────────────────────────

  const handleRequestSignatures = async () => {
    if (!soawIdRef.current || selectedSignatories.length === 0) return;
    setSaving(true);
    setError("");
    try {
      const data = await api.post<SoAW>(
        `/soaw/${soawIdRef.current}/request-signatures`,
        { user_ids: selectedSignatories }
      );
      setSignatories(data.signatories ?? []);
      setStatus(data.status);
      setSignDialogOpen(false);
      setSelectedSignatories([]);
      setSnack("Signature requests sent");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to request signatures");
    } finally {
      setSaving(false);
    }
  };

  const handleSign = async () => {
    if (!soawIdRef.current) return;
    setSaving(true);
    setError("");
    try {
      const data = await api.post<SoAW>(`/soaw/${soawIdRef.current}/sign`);
      setSignatories(data.signatories ?? []);
      setStatus(data.status);
      setSignedAt(data.signed_at);
      setSnack(data.status === "signed" ? "Document fully signed" : "Signature recorded");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to sign");
    } finally {
      setSaving(false);
    }
  };

  const handleRevise = async () => {
    if (!soawIdRef.current) return;
    setSaving(true);
    setError("");
    try {
      const data = await api.post<SoAW>(`/soaw/${soawIdRef.current}/revise`);
      navigate(`/ea-delivery/soaw/${data.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create revision");
    } finally {
      setSaving(false);
    }
  };

  const currentUserIsSignatory = signatories.some(
    (s) => s.user_id === currentUserId && s.status === "pending"
  );

  // ── version history helpers ────────────────────────────────────────────

  const addVersionRow = () =>
    setVersionHistory((prev) => [
      ...prev,
      { version: "", date: "", revised_by: "", description: "" },
    ]);

  const updateVersionRow = (
    idx: number,
    field: string,
    value: string,
  ) =>
    setVersionHistory((prev) =>
      prev.map((row, i) =>
        i === idx ? { ...row, [field]: value } : row,
      ),
    );

  const removeVersionRow = (idx: number) => {
    if (versionHistory.length <= 1) return;
    setVersionHistory((prev) => prev.filter((_, i) => i !== idx));
  };

  // ── build ordered section list (template + custom interleaved) ─────────

  const orderedSections = (): (
    | { kind: "template"; def: TemplateSectionDef; data: SoAWSectionData }
    | { kind: "custom"; cs: typeof customSections[number] }
    | { kind: "part_header"; part: "I" | "II" }
  )[] => {
    const result: ReturnType<typeof orderedSections> = [];
    let currentPart: "I" | "II" | null = null;

    for (const def of SOAW_TEMPLATE_SECTIONS) {
      // Insert part headers
      if (def.part !== currentPart) {
        currentPart = def.part;
        result.push({ kind: "part_header", part: def.part });
      }

      result.push({
        kind: "template",
        def,
        data: sections[def.id] ?? {
          content: "",
          hidden: false,
        },
      });

      // Insert custom sections that go after this template section
      for (const cs of customSections) {
        if (cs.insertAfter === def.id) {
          result.push({ kind: "custom", cs });
        }
      }
    }

    // Custom sections without a specific insertAfter go at the end
    for (const cs of customSections) {
      if (
        !cs.insertAfter ||
        !SOAW_TEMPLATE_SECTIONS.some((d) => d.id === cs.insertAfter)
      ) {
        if (!result.some((r) => r.kind === "custom" && r.cs.id === cs.id)) {
          result.push({ kind: "custom", cs });
        }
      }
    }

    return result;
  };

  // ── render ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ maxWidth: 960, mx: "auto" }}>
      {/* Top bar */}
      <Box sx={{ display: "flex", alignItems: "center", flexWrap: "wrap", mb: 3, gap: 1 }}>
        <Tooltip title="Back to EA Delivery">
          <IconButton onClick={() => navigate("/ea-delivery")}>
            <MaterialSymbol icon="arrow_back" size={22} />
          </IconButton>
        </Tooltip>
        {!compact && <MaterialSymbol icon="description" size={26} color="#e65100" />}
        <Typography
          variant={compact ? "subtitle1" : "h5"}
          sx={{ fontWeight: 700, flex: 1, minWidth: 0 }}
          noWrap
        >
          {isNew ? "New Statement of Architecture Work" : name || "Untitled"}
        </Typography>
        {!isNew && (
          compact ? (
            <Tooltip title="Preview">
              <IconButton onClick={() => navigate(`/ea-delivery/soaw/${soawIdRef.current}/preview`)}>
                <MaterialSymbol icon="visibility" size={20} />
              </IconButton>
            </Tooltip>
          ) : (
            <Button
              size="small"
              startIcon={<MaterialSymbol icon="visibility" size={18} />}
              sx={{ textTransform: "none" }}
              onClick={() => navigate(`/ea-delivery/soaw/${soawIdRef.current}/preview`)}
            >
              Preview
            </Button>
          )
        )}
        {compact ? (
          <Tooltip title="Export PDF">
            <IconButton
              onClick={() => exportToPdf(name, docInfo, versionHistory, sections, customSections, revisionNumber)}
            >
              <MaterialSymbol icon="picture_as_pdf" size={20} />
            </IconButton>
          </Tooltip>
        ) : (
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="picture_as_pdf" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={() => exportToPdf(name, docInfo, versionHistory, sections, customSections, revisionNumber)}
          >
            PDF
          </Button>
        )}
        {compact ? (
          <Tooltip title="Export Word">
            <IconButton
              onClick={() => exportToDocx(name, docInfo, versionHistory, sections, customSections)}
            >
              <MaterialSymbol icon="article" size={20} />
            </IconButton>
          </Tooltip>
        ) : (
          <Button
            size="small"
            startIcon={<MaterialSymbol icon="article" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={() => exportToDocx(name, docInfo, versionHistory, sections, customSections)}
          >
            Word
          </Button>
        )}
        {!isSigned && (
          <Button
            variant="contained"
            size="small"
            startIcon={<MaterialSymbol icon="save" size={18} />}
            sx={{ textTransform: "none" }}
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        )}
        {/* Signing actions */}
        {!isNew && !isSigned && soawIdRef.current && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<MaterialSymbol icon="draw" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={() => setSignDialogOpen(true)}
          >
            Request Signatures
          </Button>
        )}
        {currentUserIsSignatory && (
          <Button
            size="small"
            variant="contained"
            color="success"
            startIcon={<MaterialSymbol icon="task_alt" size={18} />}
            sx={{ textTransform: "none" }}
            disabled={saving}
            onClick={handleSign}
          >
            Sign
          </Button>
        )}
        {isSigned && (
          <Button
            size="small"
            variant="contained"
            startIcon={<MaterialSymbol icon="content_copy" size={18} />}
            sx={{ textTransform: "none" }}
            disabled={saving}
            onClick={handleRevise}
          >
            New Revision
          </Button>
        )}
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* Signed banner */}
      {isSigned && (
        <Alert severity="success" sx={{ mb: 2 }} icon={<MaterialSymbol icon="verified" size={20} />}>
          This document was signed on {signedAt ? new Date(signedAt).toLocaleDateString() : "N/A"} and is read-only.
          {revisionNumber > 1 && ` (Revision ${revisionNumber})`}
        </Alert>
      )}

      {/* Signatories progress */}
      {signatories.length > 0 && !isSigned && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          icon={<MaterialSymbol icon="draw" size={20} />}
        >
          {signatories.filter((s) => s.status === "signed").length} of{" "}
          {signatories.length} signatures collected
        </Alert>
      )}

      {/* ── Document metadata ──────────────────────────────────────────── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
          Document Information
        </Typography>

        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2, mb: 2 }}>
          <TextField
            label="Document Name"
            fullWidth
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            disabled={isSigned}
          />
          <TextField
            select
            label="Initiative"
            fullWidth
            value={initiativeId}
            onChange={(e) => setInitiativeId(e.target.value)}
            disabled={isSigned}
          >
            <MenuItem value="">
              <em>None</em>
            </MenuItem>
            {initiatives.map((init) => (
              <MenuItem key={init.id} value={init.id}>
                {init.name}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2, mb: 2 }}>
          <TextField
            label="Prepared By"
            fullWidth
            value={docInfo.prepared_by}
            onChange={(e) =>
              setDocInfo((p) => ({ ...p, prepared_by: e.target.value }))
            }
            disabled={isSigned}
          />
          <TextField
            label="Reviewed By"
            fullWidth
            value={docInfo.reviewed_by}
            onChange={(e) =>
              setDocInfo((p) => ({ ...p, reviewed_by: e.target.value }))
            }
            disabled={isSigned}
          />
          <TextField
            label="Review Date"
            fullWidth
            type="date"
            InputLabelProps={{ shrink: true }}
            value={docInfo.review_date}
            onChange={(e) =>
              setDocInfo((p) => ({ ...p, review_date: e.target.value }))
            }
            disabled={isSigned}
          />
        </Box>

        <FormControl size="small" sx={{ minWidth: 140 }}>
          <InputLabel>Status</InputLabel>
          <Select
            value={status}
            label="Status"
            onChange={(e) => setStatus(e.target.value)}
            disabled={isSigned}
          >
            {STATUS_OPTIONS.map((o) => (
              <MenuItem key={o.value} value={o.value}>
                {o.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        {revisionNumber > 1 && (
          <Chip
            label={`Revision ${revisionNumber}`}
            size="small"
            variant="outlined"
            sx={{ ml: 1 }}
          />
        )}
      </Paper>

      {/* ── Version History ────────────────────────────────────────────── */}
      <Paper sx={{ p: 3, mb: 3 }}>
        <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 600, flex: 1 }}>
            Document Version History
          </Typography>
          {!isSigned && (
            <Tooltip title="Add version entry">
              <IconButton size="small" onClick={addVersionRow}>
                <MaterialSymbol icon="add" size={18} />
              </IconButton>
            </Tooltip>
          )}
        </Box>
        <Table size="small">
          <TableHead>
            <TableRow sx={{ bgcolor: "grey.50" }}>
              <TableCell sx={{ fontWeight: 600 }}>Version</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Date</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Revised By</TableCell>
              <TableCell sx={{ fontWeight: 600 }}>Description</TableCell>
              <TableCell sx={{ width: 40 }} />
            </TableRow>
          </TableHead>
          <TableBody>
            {versionHistory.map((row, idx) => (
              <TableRow key={idx}>
                <TableCell sx={{ p: 0.5 }}>
                  <TextField
                    size="small"
                    fullWidth
                    disabled={isSigned}
                    value={row.version}
                    onChange={(e) =>
                      updateVersionRow(idx, "version", e.target.value)
                    }
                    variant="standard"
                    InputProps={{ disableUnderline: true }}
                    sx={{ px: 1 }}
                  />
                </TableCell>
                <TableCell sx={{ p: 0.5 }}>
                  <TextField
                    size="small"
                    fullWidth
                    disabled={isSigned}
                    type="date"
                    value={row.date}
                    onChange={(e) =>
                      updateVersionRow(idx, "date", e.target.value)
                    }
                    variant="standard"
                    InputProps={{ disableUnderline: true }}
                    InputLabelProps={{ shrink: true }}
                    sx={{ px: 1 }}
                  />
                </TableCell>
                <TableCell sx={{ p: 0.5 }}>
                  <TextField
                    size="small"
                    fullWidth
                    disabled={isSigned}
                    value={row.revised_by}
                    onChange={(e) =>
                      updateVersionRow(idx, "revised_by", e.target.value)
                    }
                    variant="standard"
                    InputProps={{ disableUnderline: true }}
                    sx={{ px: 1 }}
                  />
                </TableCell>
                <TableCell sx={{ p: 0.5 }}>
                  <TextField
                    size="small"
                    fullWidth
                    disabled={isSigned}
                    value={row.description}
                    onChange={(e) =>
                      updateVersionRow(idx, "description", e.target.value)
                    }
                    variant="standard"
                    InputProps={{ disableUnderline: true }}
                    sx={{ px: 1 }}
                  />
                </TableCell>
                <TableCell sx={{ p: 0.5 }}>
                  {!isSigned && versionHistory.length > 1 && (
                    <IconButton size="small" onClick={() => removeVersionRow(idx)}>
                      <MaterialSymbol icon="close" size={16} />
                    </IconButton>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Paper>

      {/* ── Template sections ──────────────────────────────────────────── */}
      {orderedSections().map((entry) => {
        if (entry.kind === "part_header") {
          return (
            <Box key={`part-${entry.part}`} sx={{ mt: 4, mb: 2 }}>
              <Divider />
              <Typography
                variant="h5"
                sx={{ fontWeight: 700, mt: 2, color: "primary.main" }}
              >
                Part {entry.part}:{" "}
                {entry.part === "I"
                  ? "Statement of Architecture Work"
                  : "Baseline and Target Architectures"}
              </Typography>
            </Box>
          );
        }

        if (entry.kind === "custom") {
          const { cs } = entry;
          return (
            <Paper key={cs.id} sx={{ p: 3, mb: 2, borderLeft: "4px solid #1976d2" }}>
              <Box sx={{ display: "flex", alignItems: "center", mb: 1.5 }}>
                <Chip label="Custom" size="small" color="primary" sx={{ mr: 1 }} />
                <Typography sx={{ fontWeight: 600, flex: 1 }}>
                  {cs.title}
                </Typography>
                {!isSigned && (
                  <Tooltip title="Remove custom section">
                    <IconButton
                      size="small"
                      onClick={() => removeCustomSection(cs.id)}
                    >
                      <MaterialSymbol icon="delete_outline" size={18} />
                    </IconButton>
                  </Tooltip>
                )}
              </Box>
              <RichTextEditor
                content={cs.content}
                onChange={(html) => updateCustomContent(cs.id, html)}
                placeholder="Enter content for this section..."
                readOnly={isSigned}
              />
            </Paper>
          );
        }

        // Template section
        const { def, data } = entry;
        const isCollapsed = collapsedSections[def.id] ?? false;
        const isHidden = data.hidden;

        return (
          <Paper
            key={def.id}
            sx={{
              p: 3,
              mb: 2,
              opacity: isHidden ? 0.5 : 1,
              borderLeft: isHidden ? "4px solid #ccc" : "none",
            }}
          >
            {/* Section header */}
            <Box sx={{ display: "flex", alignItems: "center", mb: isCollapsed ? 0 : 1.5 }}>
              <IconButton
                size="small"
                sx={{ mr: 0.5 }}
                onClick={() => toggleCollapse(def.id)}
              >
                <MaterialSymbol
                  icon={isCollapsed ? "chevron_right" : "expand_more"}
                  size={20}
                />
              </IconButton>
              <Typography
                sx={{
                  fontWeight: 600,
                  flex: 1,
                  fontSize: def.level === 2 ? "1.1rem" : "0.95rem",
                  textDecoration: isHidden ? "line-through" : "none",
                }}
              >
                {def.title}
              </Typography>
              {!isSigned && (
                <Tooltip title={isHidden ? "Show section" : "Hide section"}>
                  <IconButton
                    size="small"
                    onClick={() => toggleSectionHidden(def.id)}
                  >
                    <MaterialSymbol
                      icon={isHidden ? "visibility_off" : "visibility"}
                      size={18}
                    />
                  </IconButton>
                </Tooltip>
              )}
            </Box>

            {/* Section body */}
            <Collapse in={!isCollapsed && !isHidden}>
              {def.preamble && (
                <Typography
                  variant="body2"
                  color="text.secondary"
                  sx={{ mb: 1.5 }}
                >
                  {def.preamble}
                </Typography>
              )}

              {def.type === "rich_text" && (
                <RichTextEditor
                  content={data.content}
                  onChange={(html) =>
                    updateSection(def.id, { content: html })
                  }
                  placeholder={def.hint}
                  readOnly={isSigned}
                />
              )}

              {def.type === "table" && data.table_data && (
                <EditableTable
                  columns={data.table_data.columns}
                  rows={data.table_data.rows}
                  onChange={(rows) =>
                    updateSection(def.id, {
                      table_data: {
                        columns: data.table_data!.columns,
                        rows,
                      },
                    })
                  }
                  readOnly={isSigned}
                />
              )}

              {def.type === "togaf_phases" && (
                <Table size="small">
                  <TableHead>
                    <TableRow sx={{ bgcolor: "grey.50" }}>
                      <TableCell sx={{ fontWeight: 600, width: 280 }}>Phase</TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>
                        Relevant Artefacts
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {TOGAF_PHASES.map((phase) => (
                      <TableRow key={phase.key}>
                        <TableCell>{phase.label}</TableCell>
                        <TableCell sx={{ p: 0.5 }}>
                          <TextField
                            size="small"
                            fullWidth
                            multiline
                            disabled={isSigned}
                            placeholder="e.g. documents, diagrams, architecture decisions..."
                            value={data.togaf_data?.[phase.key] ?? ""}
                            onChange={(e) => {
                              const next = {
                                ...(data.togaf_data ?? {}),
                                [phase.key]: e.target.value,
                              };
                              updateSection(def.id, { togaf_data: next });
                            }}
                            variant="standard"
                            InputProps={{ disableUnderline: true }}
                            sx={{ px: 1 }}
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </Collapse>

            {/* Show collapsed indicator when hidden */}
            {isHidden && !isCollapsed && (
              <Typography variant="body2" color="text.disabled" sx={{ ml: 4 }}>
                This section is hidden and will not appear in exports.
              </Typography>
            )}
          </Paper>
        );
      })}

      {/* ── Add custom section ─────────────────────────────────────────── */}
      {!isSigned && (
        <Box sx={{ display: "flex", justifyContent: "center", my: 3 }}>
          <Button
            variant="outlined"
            startIcon={<MaterialSymbol icon="add" size={18} />}
            sx={{ textTransform: "none" }}
            onClick={() => setAddSectionOpen(true)}
          >
            Add Custom Section
          </Button>
        </Box>
      )}

      <Dialog
        open={addSectionOpen}
        onClose={() => setAddSectionOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add Custom Section</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label="Section title"
            fullWidth
            value={newSectionTitle}
            onChange={(e) => setNewSectionTitle(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
            onKeyDown={(e) => e.key === "Enter" && addCustomSection()}
          />
          <TextField
            select
            label="Insert after"
            fullWidth
            value={newSectionAfter}
            onChange={(e) => setNewSectionAfter(e.target.value)}
            helperText="Choose where to place the new section"
          >
            <MenuItem value="">
              <em>End of document</em>
            </MenuItem>
            {SOAW_TEMPLATE_SECTIONS.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.title}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddSectionOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!newSectionTitle.trim()}
            onClick={addCustomSection}
          >
            Add
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Signature Block ───────────────────────────────────────────── */}
      {signatories.length > 0 && (
        <Paper sx={{ p: 3, mb: 3, border: "2px solid", borderColor: isSigned ? "success.main" : "grey.300" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
            <MaterialSymbol
              icon={isSigned ? "verified" : "draw"}
              size={24}
              color={isSigned ? "#2e7d32" : "#ed6c02"}
            />
            <Typography variant="h6" sx={{ fontWeight: 700 }}>
              Signatures
            </Typography>
            {isSigned && (
              <Chip label="Fully Signed" size="small" color="success" />
            )}
          </Box>
          <Divider sx={{ mb: 2 }} />
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
            {signatories.map((sig) => (
              <Box
                key={sig.user_id}
                sx={{
                  p: 2,
                  border: "1px solid",
                  borderColor: sig.status === "signed" ? "success.light" : "grey.300",
                  borderRadius: 1,
                  bgcolor: sig.status === "signed" ? "success.50" : "grey.50",
                }}
              >
                {sig.status === "signed" ? (
                  <>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                      <MaterialSymbol icon="verified" size={20} color="#2e7d32" />
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, color: "success.dark" }}>
                        Approved
                      </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {sig.display_name}
                    </Typography>
                    {sig.email && (
                      <Typography variant="caption" color="text.secondary">
                        {sig.email}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                      Signed: {sig.signed_at ? new Date(sig.signed_at).toLocaleString() : "N/A"}
                    </Typography>
                  </>
                ) : (
                  <>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                      <MaterialSymbol icon="pending" size={20} color="#ed6c02" />
                      <Typography variant="subtitle2" sx={{ fontWeight: 700, color: "warning.dark" }}>
                        Pending
                      </Typography>
                    </Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {sig.display_name}
                    </Typography>
                    {sig.email && (
                      <Typography variant="caption" color="text.secondary">
                        {sig.email}
                      </Typography>
                    )}
                  </>
                )}
              </Box>
            ))}
          </Box>
        </Paper>
      )}

      {/* ── Bottom save bar ────────────────────────────────────────────── */}
      <Box
        sx={{
          display: "flex",
          justifyContent: "flex-end",
          gap: 1,
          pb: 4,
        }}
      >
        <Button
          variant="outlined"
          sx={{ textTransform: "none" }}
          onClick={() => navigate("/ea-delivery")}
        >
          Back
        </Button>
        {!isSigned && (
          <Button
            variant="contained"
            startIcon={<MaterialSymbol icon="save" size={18} />}
            sx={{ textTransform: "none" }}
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "Saving..." : "Save"}
          </Button>
        )}
        {isSigned && (
          <Button
            variant="contained"
            startIcon={<MaterialSymbol icon="content_copy" size={18} />}
            sx={{ textTransform: "none" }}
            disabled={saving}
            onClick={handleRevise}
          >
            New Revision
          </Button>
        )}
      </Box>

      {/* Request Signatures dialog */}
      <Dialog
        open={signDialogOpen}
        onClose={() => setSignDialogOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Request Signatures</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Select users who should sign this document. A todo will be created for
            each signatory and they will receive a notification.
          </Typography>
          <List dense sx={{ maxHeight: 400, overflow: "auto" }}>
            {users
              .filter((u) => u.is_active)
              .map((u) => {
                const checked = selectedSignatories.includes(u.id);
                return (
                  <ListItemButton
                    key={u.id}
                    onClick={() =>
                      setSelectedSignatories((prev) =>
                        checked
                          ? prev.filter((id) => id !== u.id)
                          : [...prev, u.id]
                      )
                    }
                    dense
                  >
                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <Checkbox
                        edge="start"
                        checked={checked}
                        tabIndex={-1}
                        disableRipple
                        size="small"
                      />
                    </ListItemIcon>
                    <ListItemText
                      primary={u.display_name}
                      secondary={u.email}
                    />
                  </ListItemButton>
                );
              })}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSignDialogOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={saving || selectedSignatories.length === 0}
            onClick={handleRequestSignatures}
          >
            {saving ? "Sending..." : `Request ${selectedSignatories.length} Signature${selectedSignatories.length !== 1 ? "s" : ""}`}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Snackbar */}
      <Snackbar
        open={!!snack}
        autoHideDuration={3000}
        onClose={() => setSnack("")}
        message={snack}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
