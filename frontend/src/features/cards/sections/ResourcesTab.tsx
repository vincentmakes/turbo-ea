import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemText from "@mui/material/ListItemText";
import ListItemIcon from "@mui/material/ListItemIcon";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import TextField from "@mui/material/TextField";
import MenuItem from "@mui/material/MenuItem";
import Alert from "@mui/material/Alert";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import Tooltip from "@mui/material/Tooltip";
import Link from "@mui/material/Link";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useMetamodel } from "@/hooks/useMetamodel";
import { api } from "@/api/client";
import CreateAdrDialog from "@/features/ea-delivery/CreateAdrDialog";
import type { ArchitectureDecision, DiagramSummary, FileAttachment } from "@/types";

interface DocumentLink {
  id: string;
  card_id: string;
  name: string;
  url: string | null;
  type: string;
  created_at: string | null;
}

const STATUS_COLORS: Record<string, "default" | "warning" | "success"> = {
  draft: "default",
  in_review: "warning",
  signed: "success",
};

const LINK_TYPES = [
  "documentation",
  "security",
  "compliance",
  "architecture",
  "operations",
  "support",
  "other",
] as const;

const FILE_CATEGORIES = [
  "architecture",
  "security",
  "compliance",
  "operations",
  "meeting_notes",
  "design",
  "other",
] as const;

const MIME_ICONS: Record<string, string> = {
  "application/pdf": "picture_as_pdf",
  "image/png": "image",
  "image/jpeg": "image",
  "image/svg+xml": "image",
  "text/plain": "description",
};

const LINK_TYPE_ICONS: Record<string, string> = {
  documentation: "menu_book",
  security: "shield",
  compliance: "verified",
  architecture: "architecture",
  operations: "settings",
  support: "support_agent",
  other: "link",
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── ResourcesTab ────────────────────────────────────────────────
function ResourcesTab({
  fsId,
  cardName,
  cardType,
  canManageDocuments,
  canManageAdrLinks,
  canManageDiagramLinks,
}: {
  fsId: string;
  cardName: string;
  cardType: string;
  canManageDocuments: boolean;
  canManageAdrLinks: boolean;
  canManageDiagramLinks: boolean;
}) {
  const { t } = useTranslation(["cards", "common"]);
  const navigate = useNavigate();
  const { types: metamodelTypes } = useMetamodel();

  const typeColorMap = useMemo(() => {
    const map: Record<string, string> = {};
    for (const mt of metamodelTypes) map[mt.key] = mt.color;
    return map;
  }, [metamodelTypes]);

  const [adrs, setAdrs] = useState<ArchitectureDecision[]>([]);
  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [docs, setDocs] = useState<DocumentLink[]>([]);
  const [linkedDiagrams, setLinkedDiagrams] = useState<DiagramSummary[]>([]);
  const [error, setError] = useState("");

  // ADR link dialog
  const [linkAdrOpen, setLinkAdrOpen] = useState(false);
  const [adrSearch, setAdrSearch] = useState("");
  const [allAdrs, setAllAdrs] = useState<ArchitectureDecision[]>([]);

  // ADR create dialog
  const [createAdrOpen, setCreateAdrOpen] = useState(false);

  // Document link dialog
  const [addLinkOpen, setAddLinkOpen] = useState(false);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkType, setLinkType] = useState("documentation");

  // File upload dialog
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadCategory, setUploadCategory] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);

  // Diagram link dialog
  const [linkDiagramOpen, setLinkDiagramOpen] = useState(false);
  const [diagramSearch, setDiagramSearch] = useState("");
  const [allDiagrams, setAllDiagrams] = useState<DiagramSummary[]>([]);

  const loadAdrs = useCallback(() => {
    api
      .get<ArchitectureDecision[]>(`/adr/by-card/${fsId}`)
      .then(setAdrs)
      .catch(() => setError(t("resources.error.loadFailed")));
  }, [fsId, t]);

  const loadFiles = useCallback(() => {
    api
      .get<FileAttachment[]>(`/cards/${fsId}/file-attachments`)
      .then(setFiles)
      .catch(() => {});
  }, [fsId]);

  const loadDocs = useCallback(() => {
    api
      .get<DocumentLink[]>(`/cards/${fsId}/documents`)
      .then(setDocs)
      .catch(() => {});
  }, [fsId]);

  const loadDiagrams = useCallback(() => {
    api
      .get<DiagramSummary[]>(`/diagrams?card_id=${fsId}`)
      .then(setLinkedDiagrams)
      .catch(() => {});
  }, [fsId]);

  useEffect(() => {
    loadAdrs();
    loadFiles();
    loadDocs();
    loadDiagrams();
  }, [loadAdrs, loadFiles, loadDocs, loadDiagrams]);

  // ── ADR Linking ──
  const openLinkAdr = async () => {
    setLinkAdrOpen(true);
    setAdrSearch("");
    try {
      const all = await api.get<ArchitectureDecision[]>("/adr");
      setAllAdrs(all);
    } catch {
      /* ignore */
    }
  };

  const handleLinkAdr = async (adrId: string) => {
    try {
      await api.post(`/adr/${adrId}/cards`, { card_id: fsId });
      loadAdrs();
      setLinkAdrOpen(false);
    } catch {
      setError(t("resources.error.linkFailed"));
    }
  };

  const handleUnlinkAdr = async (adrId: string) => {
    if (!confirm(t("resources.confirmUnlinkAdr"))) return;
    try {
      await api.delete(`/adr/${adrId}/cards/${fsId}`);
      loadAdrs();
    } catch {
      setError(t("resources.error.unlinkFailed"));
    }
  };

  // ── File Upload ──
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 10 * 1024 * 1024) {
      setError(t("resources.fileTooLarge", { size: 10 }));
      return;
    }

    pendingFileRef.current = file;
    setUploadCategory("");
    setUploadDialogOpen(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleConfirmUpload = async () => {
    const file = pendingFileRef.current;
    if (!file) return;

    try {
      const extraFields: Record<string, string> = {};
      if (uploadCategory) extraFields.category = uploadCategory;
      await api.upload(`/cards/${fsId}/file-attachments`, file, "file", extraFields);
      loadFiles();
    } catch {
      setError(t("resources.error.uploadFailed"));
    }
    pendingFileRef.current = null;
    setUploadDialogOpen(false);
  };

  const handleDeleteFile = async (fileId: string) => {
    if (!confirm(t("resources.confirmDeleteFile"))) return;
    await api.delete(`/file-attachments/${fileId}`);
    loadFiles();
  };

  const handleDownload = (fileId: string, fileName: string) => {
    api
      .getRaw(`/file-attachments/${fileId}/download`)
      .then(async (res) => {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
      })
      .catch(() => {});
  };

  // ── Document Links ──
  const handleAddLink = async () => {
    if (!linkName.trim()) return;
    try {
      await api.post(`/cards/${fsId}/documents`, {
        name: linkName,
        url: linkUrl || null,
        type: linkType,
      });
      setLinkName("");
      setLinkUrl("");
      setLinkType("documentation");
      setAddLinkOpen(false);
      loadDocs();
    } catch {
      setError(t("resources.error.linkFailed"));
    }
  };

  const handleDeleteLink = async (docId: string) => {
    if (!confirm(t("resources.confirmDeleteLink"))) return;
    await api.delete(`/documents/${docId}`);
    loadDocs();
  };

  // ── Diagram Linking ──
  const openLinkDiagram = async () => {
    setLinkDiagramOpen(true);
    setDiagramSearch("");
    try {
      const all = await api.get<DiagramSummary[]>("/diagrams");
      setAllDiagrams(all);
    } catch {
      /* ignore */
    }
  };

  const handleLinkDiagram = async (diagramId: string) => {
    try {
      await api.post(`/diagrams/${diagramId}/cards`, { card_id: fsId });
      loadDiagrams();
      setLinkDiagramOpen(false);
    } catch {
      setError(t("resources.error.diagramLinkFailed"));
    }
  };

  const handleUnlinkDiagram = async (diagramId: string) => {
    if (!confirm(t("resources.confirmUnlinkDiagram"))) return;
    try {
      await api.delete(`/diagrams/${diagramId}/cards/${fsId}`);
      loadDiagrams();
    } catch {
      setError(t("resources.error.diagramLinkFailed"));
    }
  };

  const linkedDiagramIds = new Set(linkedDiagrams.map((d) => d.id));
  const filteredAllDiagrams = allDiagrams.filter(
    (d) =>
      !linkedDiagramIds.has(d.id) &&
      d.name.toLowerCase().includes(diagramSearch.toLowerCase()),
  );

  const linkedAdrIds = new Set(adrs.map((a) => a.id));
  const filteredAllAdrs = allAdrs.filter(
    (a) =>
      !linkedAdrIds.has(a.id) &&
      (a.title.toLowerCase().includes(adrSearch.toLowerCase()) ||
        a.reference_number.toLowerCase().includes(adrSearch.toLowerCase())),
  );

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* ── Architecture Decisions ── */}
      <Accordion defaultExpanded>
        <AccordionSummary
          expandIcon={<MaterialSymbol icon="expand_more" size={20} />}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <MaterialSymbol icon="gavel" size={20} />
            <Typography variant="subtitle1" fontWeight={600}>
              {t("resources.architectureDecisions")}
            </Typography>
            <Chip label={adrs.length} size="small" />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {canManageAdrLinks && (
            <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mb: 1 }}>
              <Button
                size="small"
                startIcon={<MaterialSymbol icon="add" size={18} />}
                onClick={() => setCreateAdrOpen(true)}
                sx={{ textTransform: "none" }}
              >
                {t("resources.createAdr")}
              </Button>
              <Button
                size="small"
                startIcon={<MaterialSymbol icon="link" size={18} />}
                onClick={openLinkAdr}
                sx={{ textTransform: "none" }}
              >
                {t("resources.linkAdr")}
              </Button>
            </Box>
          )}
          <List dense>
            {adrs.map((adr) => (
              <ListItem
                key={adr.id}
                secondaryAction={
                  canManageAdrLinks ? (
                    <Tooltip title={t("resources.unlinkAdr")}>
                      <IconButton
                        size="small"
                        onClick={() => handleUnlinkAdr(adr.id)}
                      >
                        <MaterialSymbol icon="link_off" size={18} />
                      </IconButton>
                    </Tooltip>
                  ) : undefined
                }
                sx={{ cursor: "pointer" }}
                onClick={() => navigate(`/ea-delivery/adr/${adr.id}`)}
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                      <Typography
                        variant="body2"
                        fontWeight={600}
                        color="text.secondary"
                      >
                        {adr.reference_number}
                      </Typography>
                      <Typography variant="body2">{adr.title}</Typography>
                      <Chip
                        label={adr.status.replace("_", " ")}
                        size="small"
                        color={STATUS_COLORS[adr.status] || "default"}
                        sx={{ height: 20, fontSize: "0.7rem" }}
                      />
                      {(adr.linked_cards ?? []).map((lc) => (
                        <Chip
                          key={lc.id}
                          label={lc.name}
                          size="small"
                          sx={{
                            height: 20,
                            fontSize: "0.7rem",
                            maxWidth: 140,
                            bgcolor: typeColorMap[lc.type] || "#9e9e9e",
                            color: "#fff",
                            "& .MuiChip-label": { px: 0.75 },
                          }}
                        />
                      ))}
                    </Box>
                  }
                />
              </ListItem>
            ))}
            {adrs.length === 0 && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ py: 2, textAlign: "center" }}
              >
                {t("resources.emptyAdr")}
              </Typography>
            )}
          </List>
        </AccordionDetails>
      </Accordion>

      {/* ── File Attachments ── */}
      <Accordion defaultExpanded>
        <AccordionSummary
          expandIcon={<MaterialSymbol icon="expand_more" size={20} />}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <MaterialSymbol icon="attach_file" size={20} />
            <Typography variant="subtitle1" fontWeight={600}>
              {t("resources.fileAttachments")}
            </Typography>
            <Chip label={files.length} size="small" />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {canManageDocuments && (
            <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
              <input
                ref={fileInputRef}
                type="file"
                hidden
                accept=".pdf,.docx,.xlsx,.pptx,.png,.jpg,.jpeg,.svg,.txt"
                onChange={handleFileSelect}
              />
              <Button
                size="small"
                startIcon={<MaterialSymbol icon="upload" size={18} />}
                onClick={() => fileInputRef.current?.click()}
                sx={{ textTransform: "none" }}
              >
                {t("resources.uploadFile")}
              </Button>
            </Box>
          )}
          <List dense>
            {files.map((f) => (
              <ListItem
                key={f.id}
                secondaryAction={
                  <Box>
                    <Tooltip title={t("resources.downloadFile")}>
                      <IconButton
                        size="small"
                        onClick={() => handleDownload(f.id, f.name)}
                      >
                        <MaterialSymbol icon="download" size={18} />
                      </IconButton>
                    </Tooltip>
                    {canManageDocuments && (
                      <Tooltip title={t("resources.deleteFile")}>
                        <IconButton
                          size="small"
                          onClick={() => handleDeleteFile(f.id)}
                        >
                          <MaterialSymbol icon="close" size={16} />
                        </IconButton>
                      </Tooltip>
                    )}
                  </Box>
                }
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <MaterialSymbol
                    icon={MIME_ICONS[f.mime_type] || "description"}
                    size={20}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={f.name}
                  secondary={
                    <Box
                      component="span"
                      sx={{ display: "flex", gap: 1, mt: 0.25 }}
                    >
                      <Chip
                        size="small"
                        label={formatFileSize(f.size)}
                        variant="outlined"
                        sx={{ height: 20, fontSize: "0.7rem" }}
                      />
                      {f.category && (
                        <Chip
                          size="small"
                          label={t(`resources.fileCategory.${f.category}`)}
                          variant="outlined"
                          sx={{ height: 20, fontSize: "0.7rem" }}
                        />
                      )}
                      {f.creator_name && (
                        <Chip
                          size="small"
                          label={f.creator_name}
                          variant="outlined"
                          sx={{ height: 20, fontSize: "0.7rem" }}
                        />
                      )}
                    </Box>
                  }
                />
              </ListItem>
            ))}
            {files.length === 0 && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ py: 2, textAlign: "center" }}
              >
                {t("resources.emptyFiles")}
              </Typography>
            )}
          </List>
        </AccordionDetails>
      </Accordion>

      {/* ── Document Links ── */}
      <Accordion defaultExpanded>
        <AccordionSummary
          expandIcon={<MaterialSymbol icon="expand_more" size={20} />}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <MaterialSymbol icon="link" size={20} />
            <Typography variant="subtitle1" fontWeight={600}>
              {t("resources.documentLinks")}
            </Typography>
            <Chip label={docs.length} size="small" />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {canManageDocuments && (
            <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
              <Button
                size="small"
                startIcon={<MaterialSymbol icon="add" size={18} />}
                onClick={() => setAddLinkOpen(true)}
                sx={{ textTransform: "none" }}
              >
                {t("resources.addLink")}
              </Button>
            </Box>
          )}
          <List dense>
            {docs.map((doc) => (
              <ListItem
                key={doc.id}
                secondaryAction={
                  canManageDocuments ? (
                    <IconButton
                      size="small"
                      onClick={() => handleDeleteLink(doc.id)}
                    >
                      <MaterialSymbol icon="close" size={16} />
                    </IconButton>
                  ) : undefined
                }
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <MaterialSymbol
                    icon={LINK_TYPE_ICONS[doc.type] || "link"}
                    size={20}
                  />
                </ListItemIcon>
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      {doc.url ? (
                        <Link
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {doc.name}
                        </Link>
                      ) : (
                        doc.name
                      )}
                      {doc.type && doc.type !== "link" && (
                        <Chip
                          size="small"
                          label={t(`resources.linkType.${doc.type}`)}
                          variant="outlined"
                          sx={{ height: 20, fontSize: "0.7rem" }}
                        />
                      )}
                    </Box>
                  }
                />
              </ListItem>
            ))}
            {docs.length === 0 && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ py: 2, textAlign: "center" }}
              >
                {t("resources.emptyLinks")}
              </Typography>
            )}
          </List>
        </AccordionDetails>
      </Accordion>

      {/* ── Diagrams ── */}
      <Accordion defaultExpanded>
        <AccordionSummary
          expandIcon={<MaterialSymbol icon="expand_more" size={20} />}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <MaterialSymbol icon="draw" size={20} />
            <Typography variant="subtitle1" fontWeight={600}>
              {t("resources.diagrams")}
            </Typography>
            <Chip label={linkedDiagrams.length} size="small" />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {canManageDiagramLinks && (
            <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
              <Button
                size="small"
                startIcon={<MaterialSymbol icon="link" size={18} />}
                onClick={openLinkDiagram}
                sx={{ textTransform: "none" }}
              >
                {t("resources.linkDiagram")}
              </Button>
            </Box>
          )}
          <List dense>
            {linkedDiagrams.map((d) => (
              <ListItem
                key={d.id}
                secondaryAction={
                  canManageDiagramLinks ? (
                    <Tooltip title={t("resources.unlinkDiagram")}>
                      <IconButton
                        size="small"
                        onClick={() => handleUnlinkDiagram(d.id)}
                      >
                        <MaterialSymbol icon="link_off" size={18} />
                      </IconButton>
                    </Tooltip>
                  ) : undefined
                }
                sx={{ cursor: "pointer" }}
                onClick={() => navigate(`/diagrams/${d.id}`)}
              >
                {d.thumbnail && (
                  <ListItemIcon sx={{ minWidth: 56 }}>
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: 1,
                        overflow: "hidden",
                        bgcolor: "action.hover",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <img
                        src={
                          d.thumbnail.startsWith("data:")
                            ? d.thumbnail
                            : `data:image/svg+xml;base64,${btoa(d.thumbnail)}`
                        }
                        alt={d.name}
                        style={{
                          maxWidth: "100%",
                          maxHeight: "100%",
                          objectFit: "contain",
                        }}
                      />
                    </Box>
                  </ListItemIcon>
                )}
                {!d.thumbnail && (
                  <ListItemIcon sx={{ minWidth: 56 }}>
                    <Box
                      sx={{
                        width: 40,
                        height: 40,
                        borderRadius: 1,
                        bgcolor: "action.hover",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <MaterialSymbol icon="draw" size={20} color="#999" />
                    </Box>
                  </ListItemIcon>
                )}
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="body2">{d.name}</Typography>
                      <Chip
                        size="small"
                        label={
                          d.type === "data_flow"
                            ? t("diagrams:gallery.types.dataFlow")
                            : t("diagrams:gallery.types.freeDraw")
                        }
                        variant="outlined"
                        sx={{ height: 20, fontSize: "0.7rem" }}
                      />
                    </Box>
                  }
                />
              </ListItem>
            ))}
            {linkedDiagrams.length === 0 && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ py: 2, textAlign: "center" }}
              >
                {t("resources.emptyDiagrams")}
              </Typography>
            )}
          </List>
        </AccordionDetails>
      </Accordion>

      {/* ── Link Diagram Dialog ── */}
      <Dialog
        open={linkDiagramOpen}
        onClose={() => setLinkDiagramOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t("resources.linkDiagramDialog.title")}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            placeholder={t("resources.linkDiagramDialog.search")}
            fullWidth
            size="small"
            value={diagramSearch}
            onChange={(e) => setDiagramSearch(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
          />
          <List dense>
            {filteredAllDiagrams.map((d) => (
              <ListItem
                key={d.id}
                secondaryAction={
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => handleLinkDiagram(d.id)}
                    sx={{ textTransform: "none" }}
                  >
                    {t("resources.linkDiagram")}
                  </Button>
                }
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                      <MaterialSymbol
                        icon={d.type === "data_flow" ? "device_hub" : "draw"}
                        size={18}
                      />
                      <Typography variant="body2">{d.name}</Typography>
                    </Box>
                  }
                />
              </ListItem>
            ))}
            {filteredAllDiagrams.length === 0 && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ py: 2, textAlign: "center" }}
              >
                {t("resources.linkDiagramDialog.empty")}
              </Typography>
            )}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkDiagramOpen(false)}>
            {t("common:actions.cancel")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Link ADR Dialog ── */}
      <Dialog
        open={linkAdrOpen}
        onClose={() => setLinkAdrOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t("resources.linkAdrDialog.title")}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            placeholder={t("resources.linkAdrDialog.search")}
            fullWidth
            size="small"
            value={adrSearch}
            onChange={(e) => setAdrSearch(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
          />
          <List dense>
            {filteredAllAdrs.map((adr) => (
              <ListItem
                key={adr.id}
                secondaryAction={
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => handleLinkAdr(adr.id)}
                    sx={{ textTransform: "none" }}
                  >
                    {t("resources.linkAdr")}
                  </Button>
                }
              >
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                      <Typography variant="body2" fontWeight={600}>
                        {adr.reference_number}
                      </Typography>
                      <Typography variant="body2">{adr.title}</Typography>
                    </Box>
                  }
                />
              </ListItem>
            ))}
            {filteredAllAdrs.length === 0 && (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ py: 2, textAlign: "center" }}
              >
                {t("resources.linkAdrDialog.empty")}
              </Typography>
            )}
          </List>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setLinkAdrOpen(false)}>
            {t("common:actions.cancel")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Create ADR Dialog ── */}
      <CreateAdrDialog
        open={createAdrOpen}
        onClose={() => setCreateAdrOpen(false)}
        onCreated={() => loadAdrs()}
        preLinkedCards={[{ id: fsId, name: cardName, type: cardType }]}
      />

      {/* ── Upload File Dialog ── */}
      <Dialog
        open={uploadDialogOpen}
        onClose={() => {
          setUploadDialogOpen(false);
          pendingFileRef.current = null;
        }}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{t("resources.uploadFileDialog.title")}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            {pendingFileRef.current?.name}
          </Typography>
          <TextField
            select
            label={t("resources.uploadFileDialog.category")}
            fullWidth
            size="small"
            value={uploadCategory}
            onChange={(e) => setUploadCategory(e.target.value)}
          >
            <MenuItem value="">{t("resources.uploadFileDialog.noCategory")}</MenuItem>
            {FILE_CATEGORIES.map((cat) => (
              <MenuItem key={cat} value={cat}>
                {t(`resources.fileCategory.${cat}`)}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => {
              setUploadDialogOpen(false);
              pendingFileRef.current = null;
            }}
          >
            {t("common:actions.cancel")}
          </Button>
          <Button variant="contained" onClick={handleConfirmUpload}>
            {t("resources.uploadFile")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Add Link Dialog ── */}
      <Dialog
        open={addLinkOpen}
        onClose={() => setAddLinkOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{t("resources.addLinkDialog.title")}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            label={t("resources.addLinkDialog.name")}
            fullWidth
            value={linkName}
            onChange={(e) => setLinkName(e.target.value)}
            sx={{ mt: 1, mb: 2 }}
          />
          <TextField
            select
            label={t("resources.addLinkDialog.type")}
            fullWidth
            size="small"
            value={linkType}
            onChange={(e) => setLinkType(e.target.value)}
            sx={{ mb: 2 }}
          >
            {LINK_TYPES.map((lt) => (
              <MenuItem key={lt} value={lt}>
                {t(`resources.linkType.${lt}`)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t("resources.addLinkDialog.url")}
            fullWidth
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://..."
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddLinkOpen(false)}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="contained"
            disabled={!linkName.trim()}
            onClick={handleAddLink}
          >
            {t("common:actions.add")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default ResourcesTab;
