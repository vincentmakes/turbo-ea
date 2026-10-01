import { useState, useCallback, useEffect, useRef } from "react";
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
import { useNavigate } from "react-router";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useFileUploadsEnabled } from "@/hooks/useFileUploadsEnabled";
import { useResourceTypes } from "@/hooks/useResourceTypes";
import { fieldLabel } from "@/hooks/useResolveLabel";
import { api, ApiError } from "@/api/client";
import { getUrlErrorMsg, isValidUrl } from "./cardDetailUtils";
import {
  ATTACHMENT_ACCEPT,
  ATTACHMENT_MIME_ICONS,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_MB,
  extensionOf,
  hasAcceptedExtension,
  keepsStoredFormat,
} from "@/lib/attachmentFormats";
import type { DiagramSummary, FileAttachment } from "@/types";

interface DocumentLink {
  id: string;
  card_id: string;
  name: string;
  url: string | null;
  type: string;
  created_at: string | null;
}

interface SnowLink {
  connection_name: string;
  table: string;
  sys_id: string;
  url: string;
  last_synced_at: string | null;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── ResourcesTab ────────────────────────────────────────────────
function ResourcesTab({
  fsId,
  canManageDocuments,
  canManageDiagramLinks,
}: {
  fsId: string;
  canManageDocuments: boolean;
  canManageDiagramLinks: boolean;
}) {
  const { t, i18n } = useTranslation(["cards", "common"]);
  const navigate = useNavigate();
  const { fileUploadsEnabled } = useFileUploadsEnabled();
  const { linkTypes, fileCategories, byKindKey } = useResourceTypes();
  const locale = i18n.language;

  // Resolve the display label / icon for a stored link-type or file-category
  // key. Falls back to the raw stored value so legacy / removed keys still
  // render (e.g. a document saved before its type was deleted from the list).
  const linkTypeLabel = useCallback(
    (key: string) => {
      const row = byKindKey[`link_type:${key}`];
      return row ? fieldLabel(row, locale) : key;
    },
    [byKindKey, locale],
  );
  const fileCategoryLabel = useCallback(
    (key: string) => {
      const row = byKindKey[`file_category:${key}`];
      return row ? fieldLabel(row, locale) : key;
    },
    [byKindKey, locale],
  );
  const linkTypeIcon = useCallback(
    (key: string) => byKindKey[`link_type:${key}`]?.icon || "link",
    [byKindKey],
  );

  const [files, setFiles] = useState<FileAttachment[]>([]);
  const [docs, setDocs] = useState<DocumentLink[]>([]);
  const [snowLinks, setSnowLinks] = useState<SnowLink[]>([]);
  const [linkedDiagrams, setLinkedDiagrams] = useState<DiagramSummary[]>([]);
  const [error, setError] = useState("");

  // Document link dialog — one dialog for Add and Edit; `editingDoc` says
  // which. `linkError` is the server's own reason for a refusal, shown
  // inside the dialog: the page-level Alert sits behind the modal (#1166).
  const [linkDialogOpen, setLinkDialogOpen] = useState(false);
  const [editingDoc, setEditingDoc] = useState<DocumentLink | null>(null);
  const [linkName, setLinkName] = useState("");
  const [linkUrl, setLinkUrl] = useState("");
  const [linkType, setLinkType] = useState("documentation");
  const [linkError, setLinkError] = useState("");

  // File upload dialog — also the Replace dialog: when `replaceTargetRef`
  // names an attachment, the picked file goes into that entry instead of a
  // new one (#1166).
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploadCategory, setUploadCategory] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingFileRef = useRef<File | null>(null);
  const replaceTargetRef = useRef<FileAttachment | null>(null);

  // File edit dialog (name + category; the bytes stay — that is Replace).
  const [editingFile, setEditingFile] = useState<FileAttachment | null>(null);
  const [editFileName, setEditFileName] = useState("");
  const [editFileCategory, setEditFileCategory] = useState("");
  const [editFileError, setEditFileError] = useState("");

  // Diagram link dialog
  const [linkDiagramOpen, setLinkDiagramOpen] = useState(false);
  const [diagramSearch, setDiagramSearch] = useState("");
  const [allDiagrams, setAllDiagrams] = useState<DiagramSummary[]>([]);

  // Keep the Add-link dialog's selected type valid even if an admin removed
  // the built-in "documentation" type from the list.
  useEffect(() => {
    if (linkTypes.length === 0) return;
    if (!linkTypes.some((lt) => lt.key === linkType)) {
      setLinkType(linkTypes[0].key);
    }
  }, [linkTypes, linkType]);

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

  const loadSnowLinks = useCallback(() => {
    // Derived read-only deep links to the ServiceNow record(s) this card is
    // synced with. Silently ignore errors (e.g. no servicenow.view permission)
    // — the section simply stays hidden.
    api
      .get<SnowLink[]>(`/servicenow/cards/${fsId}/links`)
      .then(setSnowLinks)
      .catch(() => setSnowLinks([]));
  }, [fsId]);

  useEffect(() => {
    loadFiles();
    loadDocs();
    loadDiagrams();
    loadSnowLinks();
  }, [loadFiles, loadDocs, loadDiagrams, loadSnowLinks]);

  // ── File Upload ──
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // The backend proves the bytes match the extension; these two only save a
    // round-trip on a file it is certain to refuse. `accept=` is not enforced
    // on a drag-drop or an "All files" pick, so the name is checked here too.
    if (!hasAcceptedExtension(file.name)) {
      setError(t("resources.invalidType"));
      replaceTargetRef.current = null;
      return;
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      setError(t("resources.fileTooLarge", { size: MAX_ATTACHMENT_MB }));
      replaceTargetRef.current = null;
      return;
    }

    pendingFileRef.current = file;
    // A replace starts from the entry's current category; an upload from none.
    setUploadCategory(replaceTargetRef.current?.category ?? "");
    setUploadDialogOpen(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const startReplaceFile = (f: FileAttachment) => {
    replaceTargetRef.current = f;
    fileInputRef.current?.click();
  };

  const closeUploadDialog = () => {
    setUploadDialogOpen(false);
    pendingFileRef.current = null;
    replaceTargetRef.current = null;
  };

  const handleConfirmUpload = async () => {
    const file = pendingFileRef.current;
    if (!file) return;
    const target = replaceTargetRef.current;

    try {
      // A replace is a fresh upload into the same entry, so the category is
      // sent the same way: whatever is selected, or nothing for "No category".
      const extraFields: Record<string, string> = {};
      if (uploadCategory) extraFields.category = uploadCategory;
      if (target) {
        await api.upload(`/file-attachments/${target.id}/content`, file, "file", extraFields, {
          method: "PUT",
        });
      } else {
        await api.upload(`/cards/${fsId}/file-attachments`, file, "file", extraFields);
      }
      setError("");
      loadFiles();
    } catch (err) {
      // api.upload throws Error(detail); the detail names the real reason
      // ("File content does not match its '.pdf' extension.") rather than a
      // generic failure the user cannot act on.
      const detail = err instanceof Error ? err.message : "";
      setError(
        detail || t(target ? "resources.error.replaceFailed" : "resources.error.uploadFailed"),
      );
    }
    closeUploadDialog();
  };

  // ── File edit (name / category) ──
  const openEditFile = (f: FileAttachment) => {
    setEditingFile(f);
    setEditFileName(f.name);
    setEditFileCategory(f.category ?? "");
    setEditFileError("");
  };

  const closeEditFile = () => {
    setEditingFile(null);
    setEditFileName("");
    setEditFileCategory("");
    setEditFileError("");
  };

  // The bytes are not re-uploaded on a rename, so the extension has to keep
  // naming the stored format — the same rule the backend enforces.
  const editFileExtOk = editingFile ? keepsStoredFormat(editFileName, editingFile) : true;
  const canSaveFileEdit = Boolean(editFileName.trim()) && editFileExtOk;

  const handleSaveFileEdit = async () => {
    if (!editingFile || !canSaveFileEdit) return;
    try {
      await api.patch(`/file-attachments/${editingFile.id}`, {
        name: editFileName.trim(),
        category: editFileCategory,
      });
      closeEditFile();
      loadFiles();
    } catch (err) {
      setEditFileError(
        err instanceof ApiError ? err.message : t("resources.error.fileUpdateFailed"),
      );
    }
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
  const resetLinkForm = () => {
    setEditingDoc(null);
    setLinkName("");
    setLinkUrl("");
    setLinkType("documentation");
    setLinkError("");
  };

  const openAddLink = () => {
    resetLinkForm();
    setLinkDialogOpen(true);
  };

  const openEditLink = (doc: DocumentLink) => {
    setEditingDoc(doc);
    setLinkName(doc.name);
    setLinkUrl(doc.url ?? "");
    setLinkType(doc.type || "documentation");
    setLinkError("");
    setLinkDialogOpen(true);
  };

  // Cancel, Esc and the backdrop all drop whatever was typed — a half-typed
  // link must not resurface the next time the dialog opens.
  const closeLinkDialog = () => {
    setLinkDialogOpen(false);
    resetLinkForm();
  };

  // Same rule the backend applies (`DocumentCreate.validate_url_scheme`):
  // http://, https:// or mailto:, empty allowed. Checked here so the reason
  // is visible while typing rather than as a 422 after the click.
  const linkUrlValid = isValidUrl(linkUrl);
  const canSaveLink = Boolean(linkName.trim()) && linkUrlValid;

  const handleSaveLink = async () => {
    if (!canSaveLink) return;
    const payload = {
      name: linkName.trim(),
      url: linkUrl.trim() || null,
      type: linkType,
    };
    try {
      if (editingDoc) {
        await api.patch(`/documents/${editingDoc.id}`, payload);
      } else {
        await api.post(`/cards/${fsId}/documents`, payload);
      }
      closeLinkDialog();
      loadDocs();
    } catch (err) {
      // An ApiError carries the backend's reason (e.g. the URL scheme it
      // refused); a generic "Failed to link" gives the user nothing to fix.
      setLinkError(
        err instanceof ApiError
          ? err.message
          : t(editingDoc ? "resources.error.linkUpdateFailed" : "resources.error.linkFailed"),
      );
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

  return (
    <Box>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {/* ── File Attachments ── */}
      {(fileUploadsEnabled || files.length > 0) && (
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
          {canManageDocuments && fileUploadsEnabled && (
            <input
              ref={fileInputRef}
              type="file"
              hidden
              accept={ATTACHMENT_ACCEPT}
              onChange={handleFileSelect}
            />
          )}
          {canManageDocuments && fileUploadsEnabled && (
            <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 1 }}>
              <Typography variant="caption" color="text.secondary" sx={{ mr: 1 }}>
                {t("resources.maxSize", { size: MAX_ATTACHMENT_MB })}
              </Typography>
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
                    {canManageDocuments && fileUploadsEnabled && (
                      <Tooltip title={t("resources.replaceFile")}>
                        <IconButton size="small" onClick={() => startReplaceFile(f)}>
                          <MaterialSymbol icon="sync" size={18} />
                        </IconButton>
                      </Tooltip>
                    )}
                    {canManageDocuments && (
                      <Tooltip title={t("resources.editFile")}>
                        <IconButton size="small" onClick={() => openEditFile(f)}>
                          <MaterialSymbol icon="edit" size={16} />
                        </IconButton>
                      </Tooltip>
                    )}
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
                    icon={ATTACHMENT_MIME_ICONS[f.mime_type] || "description"}
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
                          label={fileCategoryLabel(f.category)}
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
      )}

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
                onClick={openAddLink}
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
                    <Box>
                      <Tooltip title={t("common:actions.edit")}>
                        <IconButton
                          size="small"
                          onClick={() => openEditLink(doc)}
                        >
                          <MaterialSymbol icon="edit" size={16} />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title={t("common:actions.delete")}>
                        <IconButton
                          size="small"
                          onClick={() => handleDeleteLink(doc.id)}
                        >
                          <MaterialSymbol icon="close" size={16} />
                        </IconButton>
                      </Tooltip>
                    </Box>
                  ) : undefined
                }
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <MaterialSymbol icon={linkTypeIcon(doc.type)} size={20} />
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
                          label={linkTypeLabel(doc.type)}
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

      {/* ── ServiceNow (read-only, auto-derived from sync) ── */}
      {snowLinks.length > 0 && (
        <Accordion defaultExpanded>
          <AccordionSummary
            expandIcon={<MaterialSymbol icon="expand_more" size={20} />}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <MaterialSymbol icon="cloud_sync" size={20} />
              <Typography variant="subtitle1" fontWeight={600}>
                {t("resources.serviceNow")}
              </Typography>
              <Chip label={snowLinks.length} size="small" />
              <Tooltip title={t("resources.serviceNowHint")}>
                <Box component="span" sx={{ display: "inline-flex" }}>
                  <MaterialSymbol icon="info" size={16} />
                </Box>
              </Tooltip>
            </Box>
          </AccordionSummary>
          <AccordionDetails>
            <List dense>
              {snowLinks.map((link) => (
                <ListItem key={`${link.table}-${link.sys_id}`}>
                  <ListItemIcon sx={{ minWidth: 36 }}>
                    <MaterialSymbol icon="open_in_new" size={20} />
                  </ListItemIcon>
                  <ListItemText
                    primary={
                      <Link
                        href={link.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {`${link.connection_name} — ${link.table}`}
                      </Link>
                    }
                    secondary={link.sys_id}
                  />
                </ListItem>
              ))}
            </List>
          </AccordionDetails>
        </Accordion>
      )}

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
                        onClick={(e) => {
                          // The row itself navigates to the diagram; the
                          // unlink click must not ride along with it (#1166).
                          e.stopPropagation();
                          handleUnlinkDiagram(d.id);
                        }}
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
                      <MaterialSymbol icon="schema" size={20} color="#999" />
                    </Box>
                  </ListItemIcon>
                )}
                <ListItemText
                  primary={
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Typography variant="body2">{d.name}</Typography>
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
                      <MaterialSymbol icon="schema" size={18} />
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

      {/* ── Upload File Dialog ── */}
      <Dialog
        open={uploadDialogOpen && fileUploadsEnabled}
        onClose={closeUploadDialog}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {replaceTargetRef.current
            ? t("resources.replaceFileDialog.title", { name: replaceTargetRef.current.name })
            : t("resources.uploadFileDialog.title")}
        </DialogTitle>
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
            {fileCategories.map((cat) => (
              <MenuItem key={cat.key} value={cat.key}>
                {fieldLabel(cat, locale)}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeUploadDialog}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" onClick={handleConfirmUpload}>
            {replaceTargetRef.current ? t("resources.replaceFile") : t("resources.uploadFile")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Edit File Dialog (name + category) ── */}
      <Dialog open={editingFile !== null} onClose={closeEditFile} maxWidth="xs" fullWidth>
        <DialogTitle>{t("resources.editFileDialog.title")}</DialogTitle>
        <DialogContent>
          {editFileError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setEditFileError("")}>
              {editFileError}
            </Alert>
          )}
          <TextField
            autoFocus
            label={t("resources.editFileDialog.name")}
            fullWidth
            value={editFileName}
            onChange={(e) => setEditFileName(e.target.value)}
            error={!editFileExtOk}
            helperText={
              editFileExtOk || !editingFile
                ? undefined
                : t("resources.editFileDialog.keepExtension", {
                    ext: extensionOf(editingFile.name),
                  })
            }
            sx={{ mt: 1, mb: 2 }}
          />
          <TextField
            select
            label={t("resources.uploadFileDialog.category")}
            fullWidth
            size="small"
            value={editFileCategory}
            onChange={(e) => setEditFileCategory(e.target.value)}
          >
            <MenuItem value="">{t("resources.uploadFileDialog.noCategory")}</MenuItem>
            {fileCategories.map((cat) => (
              <MenuItem key={cat.key} value={cat.key}>
                {fieldLabel(cat, locale)}
              </MenuItem>
            ))}
          </TextField>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeEditFile}>{t("common:actions.cancel")}</Button>
          <Button variant="contained" disabled={!canSaveFileEdit} onClick={handleSaveFileEdit}>
            {t("common:actions.save")}
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Add / Edit Link Dialog ── */}
      <Dialog
        open={linkDialogOpen}
        onClose={closeLinkDialog}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {editingDoc
            ? t("resources.editLinkDialog.title")
            : t("resources.addLinkDialog.title")}
        </DialogTitle>
        <DialogContent>
          {linkError && (
            <Alert severity="error" sx={{ mb: 2 }} onClose={() => setLinkError("")}>
              {linkError}
            </Alert>
          )}
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
            {linkTypes.map((lt) => (
              <MenuItem key={lt.key} value={lt.key}>
                {fieldLabel(lt, locale)}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label={t("resources.addLinkDialog.url")}
            fullWidth
            value={linkUrl}
            onChange={(e) => setLinkUrl(e.target.value)}
            placeholder="https://..."
            error={!linkUrlValid}
            helperText={linkUrlValid ? undefined : getUrlErrorMsg(t)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={closeLinkDialog}>
            {t("common:actions.cancel")}
          </Button>
          <Button
            variant="contained"
            disabled={!canSaveLink}
            onClick={handleSaveLink}
          >
            {editingDoc ? t("common:actions.save") : t("common:actions.add")}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

export default ResourcesTab;
