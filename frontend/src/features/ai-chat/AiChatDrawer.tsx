import { useState, useEffect, useRef, useCallback } from "react";
import Box from "@mui/material/Box";
import Drawer from "@mui/material/Drawer";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Chip from "@mui/material/Chip";
import CircularProgress from "@mui/material/CircularProgress";
import Tooltip from "@mui/material/Tooltip";
import Fade from "@mui/material/Fade";
import { useTheme } from "@mui/material/styles";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import type { AiChatMessage } from "@/types";

const BASE = "/api/v1";
const MAX_HISTORY = 20;

interface Props {
  open: boolean;
  onClose: () => void;
  providerType?: string;
}

/** Render markdown-lite: bold, inline code, bullet lists. */
function renderMarkdown(text: string) {
  // Split into lines for list handling
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} style={{ margin: "4px 0 4px 16px", paddingLeft: 0 }}>
          {listItems.map((item, i) => (
            <li key={i} style={{ marginBottom: 2 }}>
              <span dangerouslySetInnerHTML={{ __html: inlineFormat(item) }} />
            </li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bulletMatch = line.match(/^\s*[-*]\s+(.*)/);
    if (bulletMatch) {
      listItems.push(bulletMatch[1]);
      continue;
    }
    flushList();

    if (line.startsWith("### ")) {
      elements.push(
        <Typography key={i} variant="subtitle2" sx={{ fontWeight: 700, mt: 1, mb: 0.5 }}>
          {line.slice(4)}
        </Typography>
      );
    } else if (line.startsWith("## ")) {
      elements.push(
        <Typography key={i} variant="subtitle1" sx={{ fontWeight: 700, mt: 1, mb: 0.5 }}>
          {line.slice(3)}
        </Typography>
      );
    } else if (line.trim() === "") {
      elements.push(<Box key={i} sx={{ height: 8 }} />);
    } else {
      elements.push(
        <Typography
          key={i}
          variant="body2"
          component="p"
          sx={{ my: 0.25, lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: inlineFormat(line) }}
        />
      );
    }
  }
  flushList();
  return elements;
}

function inlineFormat(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/`([^`]+)`/g, '<code style="background:#f0f0f0;padding:1px 4px;border-radius:3px;font-size:0.85em">$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>");
}

export default function AiChatDrawer({ open, onClose, providerType = "ollama" }: Props) {
  const theme = useTheme();
  const isMobile = useMediaQuery("(max-width:767px)");
  const { t } = useTranslation("common");

  const [messages, setMessages] = useState<AiChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll on new content
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Focus input when drawer opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 200);
    }
  }, [open]);

  const handleSend = useCallback(async () => {
    const msg = input.trim();
    if (!msg || streaming) return;

    setInput("");
    setError("");

    const userMessage: AiChatMessage = { role: "user", content: msg };
    const updatedMessages = [...messages, userMessage];
    setMessages(updatedMessages);

    // Prepare history (capped)
    const history = updatedMessages.slice(0, -1).slice(-MAX_HISTORY).map((m) => ({
      role: m.role,
      content: m.content,
    }));

    setStreaming(true);
    const assistantMessage: AiChatMessage = { role: "assistant", content: "" };
    setMessages((prev) => [...prev, assistantMessage]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const token = sessionStorage.getItem("token");
      const resp = await fetch(`${BASE}/ai/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        signal: controller.signal,
        body: JSON.stringify({
          message: msg,
          history,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ detail: resp.statusText }));
        throw new Error(typeof err.detail === "string" ? err.detail : resp.statusText);
      }

      const reader = resp.body?.getReader();
      if (!reader) throw new Error("No response stream");

      const decoder = new TextDecoder();
      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr) continue;

          try {
            const data = JSON.parse(jsonStr);
            if (data.token) {
              accumulated += data.token;
              // Update the last message in place
              setMessages((prev) => {
                const copy = [...prev];
                copy[copy.length - 1] = { role: "assistant", content: accumulated };
                return copy;
              });
            }
            if (data.error) {
              setError(data.error);
            }
          } catch {
            // skip malformed chunks
          }
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === "AbortError") {
        // User cancelled — keep partial response
      } else {
        const message = err instanceof Error ? err.message : "Connection failed";
        setError(message);
        // Remove the empty assistant message if we got an error before any tokens
        setMessages((prev) => {
          if (prev.length > 0 && prev[prev.length - 1].role === "assistant" && !prev[prev.length - 1].content) {
            return prev.slice(0, -1);
          }
          return prev;
        });
      }
    } finally {
      setStreaming(false);
      abortRef.current = null;
    }
  }, [input, messages, streaming]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  const handleClear = () => {
    setMessages([]);
    setError("");
  };

  const drawerWidth = isMobile ? "100vw" : 460;

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: drawerWidth,
          maxWidth: "100vw",
          display: "flex",
          flexDirection: "column",
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 2,
          py: 1.5,
          borderBottom: 1,
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <MaterialSymbol icon="smart_toy" size={22} color={theme.palette.primary.main} />
        <Typography variant="subtitle1" sx={{ fontWeight: 700, flex: 1 }}>
          {t("aiChat.title")}
        </Typography>
        <Chip
          icon={<MaterialSymbol icon={providerType === "ollama" ? "lock" : "cloud"} size={14} />}
          label={providerType === "ollama" ? t("aiChat.localAi") : t("aiChat.cloudAi")}
          size="small"
          sx={{
            height: 22,
            fontSize: "0.65rem",
            bgcolor: providerType === "ollama" ? "success.main" : "info.main",
            color: "#fff",
            fontWeight: 600,
            "& .MuiChip-icon": { color: "#fff" },
          }}
        />
        {messages.length > 0 && (
          <Tooltip title={t("aiChat.clearChat")}>
            <IconButton size="small" onClick={handleClear} disabled={streaming}>
              <MaterialSymbol icon="delete_sweep" size={20} />
            </IconButton>
          </Tooltip>
        )}
        <IconButton size="small" onClick={onClose}>
          <MaterialSymbol icon="close" size={20} />
        </IconButton>
      </Box>

      {/* Privacy notice */}
      <Fade in={messages.length === 0}>
        <Box
          sx={{
            display: messages.length === 0 ? "flex" : "none",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
            px: 3,
            py: 4,
            textAlign: "center",
          }}
        >
          <Box
            sx={{
              width: 56,
              height: 56,
              borderRadius: "50%",
              bgcolor: "primary.main",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <MaterialSymbol icon="smart_toy" size={28} color="#fff" />
          </Box>
          <Typography variant="body1" sx={{ fontWeight: 600 }}>
            {t("aiChat.welcome")}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 360 }}>
            {providerType === "ollama"
              ? t("aiChat.welcomeDescription")
              : t("aiChat.welcomeDescriptionCloud")}
          </Typography>

          {/* Privacy badge */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 1,
              px: 2,
              py: 1,
              borderRadius: 2,
              bgcolor: "action.hover",
              mt: 1,
            }}
          >
            <MaterialSymbol icon="shield" size={18} color={theme.palette.success.main} />
            <Typography variant="caption" color="text.secondary">
              {providerType === "ollama"
                ? t("aiChat.privacyNotice")
                : t("aiChat.privacyNoticeCloud")}
            </Typography>
          </Box>

          {/* Suggested questions */}
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 1, width: "100%" }}>
            {[
              t("aiChat.suggestion1"),
              t("aiChat.suggestion2"),
              t("aiChat.suggestion3"),
            ].map((suggestion) => (
              <Box
                key={suggestion}
                onClick={() => {
                  setInput(suggestion);
                  setTimeout(() => inputRef.current?.focus(), 50);
                }}
                sx={{
                  px: 2,
                  py: 1,
                  borderRadius: 2,
                  border: 1,
                  borderColor: "divider",
                  cursor: "pointer",
                  transition: "all 0.15s",
                  "&:hover": {
                    borderColor: "primary.main",
                    bgcolor: "action.hover",
                  },
                }}
              >
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: "0.8rem" }}>
                  {suggestion}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Fade>

      {/* Messages */}
      <Box
        sx={{
          flex: 1,
          overflow: "auto",
          px: 2,
          py: 1,
          display: messages.length === 0 ? "none" : "flex",
          flexDirection: "column",
          gap: 1.5,
        }}
      >
        {messages.map((msg, idx) => (
          <Box
            key={idx}
            sx={{
              display: "flex",
              justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
              gap: 1,
            }}
          >
            {msg.role === "assistant" && (
              <Box
                sx={{
                  width: 28,
                  height: 28,
                  borderRadius: "50%",
                  bgcolor: "primary.main",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                  mt: 0.5,
                }}
              >
                <MaterialSymbol icon="smart_toy" size={16} color="#fff" />
              </Box>
            )}
            <Box
              sx={{
                maxWidth: "85%",
                px: 1.5,
                py: 1,
                borderRadius: 2,
                bgcolor: msg.role === "user" ? "primary.main" : "action.hover",
                color: msg.role === "user" ? "#fff" : "text.primary",
                ...(msg.role === "user" && {
                  borderBottomRightRadius: 4,
                }),
                ...(msg.role === "assistant" && {
                  borderBottomLeftRadius: 4,
                }),
              }}
            >
              {msg.role === "user" ? (
                <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
                  {msg.content}
                </Typography>
              ) : msg.content ? (
                <Box sx={{ "& p": { m: 0 }, "& code": { fontSize: "0.8rem" } }}>
                  {renderMarkdown(msg.content)}
                </Box>
              ) : (
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, py: 0.5 }}>
                  <CircularProgress size={14} />
                  <Typography variant="caption" color="text.secondary">
                    {t("aiChat.thinking")}
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        ))}

        {error && (
          <Box sx={{ px: 2, py: 1, borderRadius: 1, bgcolor: "error.main", color: "#fff" }}>
            <Typography variant="body2">{error}</Typography>
          </Box>
        )}

        <div ref={messagesEndRef} />
      </Box>

      {/* Input area */}
      <Box
        sx={{
          p: 1.5,
          borderTop: 1,
          borderColor: "divider",
          flexShrink: 0,
          bgcolor: "background.paper",
        }}
      >
        <TextField
          fullWidth
          size="small"
          multiline
          maxRows={4}
          placeholder={t("aiChat.inputPlaceholder")}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          inputRef={inputRef}
          disabled={streaming}
          sx={{
            "& .MuiOutlinedInput-root": {
              borderRadius: 3,
              pr: 0.5,
            },
          }}
          InputProps={{
            endAdornment: (
              <InputAdornment position="end">
                {streaming ? (
                  <Tooltip title={t("aiChat.stop")}>
                    <IconButton size="small" onClick={handleStop} sx={{ color: "error.main" }}>
                      <MaterialSymbol icon="stop_circle" size={22} />
                    </IconButton>
                  </Tooltip>
                ) : (
                  <IconButton
                    size="small"
                    onClick={handleSend}
                    disabled={!input.trim()}
                    sx={{
                      color: input.trim() ? "primary.main" : "text.disabled",
                    }}
                  >
                    <MaterialSymbol icon="send" size={20} />
                  </IconButton>
                )}
              </InputAdornment>
            ),
          }}
        />
        <Typography
          variant="caption"
          color="text.disabled"
          sx={{ display: "block", textAlign: "center", mt: 0.5, fontSize: "0.65rem" }}
        >
          {t("aiChat.disclaimer")}
        </Typography>
      </Box>
    </Drawer>
  );
}
