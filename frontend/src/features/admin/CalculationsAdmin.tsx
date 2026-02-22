import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Alert from "@mui/material/Alert";
import TextField from "@mui/material/TextField";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import Switch from "@mui/material/Switch";
import Accordion from "@mui/material/Accordion";
import AccordionSummary from "@mui/material/AccordionSummary";
import AccordionDetails from "@mui/material/AccordionDetails";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import Autocomplete from "@mui/material/Autocomplete";
import CodeEditor from "react-simple-code-editor";
import MaterialSymbol from "@/components/MaterialSymbol";
import { api } from "@/api/client";
import { useMetamodel } from "@/hooks/useMetamodel";
import type { Calculation, Card as CardItem, CardType, FieldDef, RelationType } from "@/types";

// ── Suggestion types ───────────────────────────────────────────────

interface Suggestion {
  insert: string;     // text to insert
  label: string;      // display label
  detail?: string;    // secondary text (type, description)
  category: string;   // grouping label
}

// ── Syntax highlighting ───────────────────────────────────────────

const FORMULA_FUNCTIONS = new Set([
  "IF", "SUM", "AVG", "MIN", "MAX", "COUNT", "ROUND", "ABS",
  "COALESCE", "LOWER", "UPPER", "CONCAT", "CONTAINS", "PLUCK",
  "FILTER", "MAP_SCORE",
]);
const FORMULA_BUILTINS = new Set([
  "len", "str", "int", "float", "bool", "abs", "round", "min", "max", "sum",
]);
const FORMULA_KEYWORDS = new Set(["is", "not", "or", "and", "in"]);
const FORMULA_CONSTANTS = new Set(["None", "True", "False"]);

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Simple tokenizer that produces syntax-highlighted HTML. */
function highlightFormula(code: string): string {
  // Process line by line to handle # comments
  return code.split("\n").map((line) => {
    const commentIdx = findCommentStart(line);
    if (commentIdx === 0) return `<span class="hl-comment">${escapeHtml(line)}</span>`;
    const codePart = commentIdx >= 0 ? line.slice(0, commentIdx) : line;
    const commentPart = commentIdx >= 0 ? line.slice(commentIdx) : "";
    return highlightLine(codePart) +
      (commentPart ? `<span class="hl-comment">${escapeHtml(commentPart)}</span>` : "");
  }).join("\n");
}

/** Find the start of a # comment (not inside a string). */
function findCommentStart(line: string): number {
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === inStr && line[i - 1] !== "\\") inStr = null;
    } else if (ch === '"' || ch === "'") {
      inStr = ch;
    } else if (ch === "#") {
      return i;
    }
  }
  return -1;
}

/** Highlight a single line of code (no comments). */
function highlightLine(line: string): string {
  // Regex that matches tokens in order of priority
  const rx = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(\b\d+(?:\.\d+)?\b)|(\.?\b[a-zA-Z_]\w*\b)|([>=<!]=|[+\-*/%<>=,(){}:[\]])/g;
  let result = "";
  let lastIdx = 0;
  let m;
  while ((m = rx.exec(line)) !== null) {
    if (m.index > lastIdx) result += escapeHtml(line.slice(lastIdx, m.index));
    if (m[1]) { // string
      result += `<span class="hl-string">${escapeHtml(m[1])}</span>`;
    } else if (m[2]) { // number
      result += `<span class="hl-number">${escapeHtml(m[2])}</span>`;
    } else if (m[3]) { // word
      const word = m[3];
      if (word.startsWith(".")) {
        // .property access — highlight the dot as punctuation, word as property
        result += `<span class="hl-punct">.</span><span class="hl-property">${escapeHtml(word.slice(1))}</span>`;
      } else if (FORMULA_FUNCTIONS.has(word)) {
        result += `<span class="hl-function">${escapeHtml(word)}</span>`;
      } else if (FORMULA_BUILTINS.has(word)) {
        result += `<span class="hl-builtin">${escapeHtml(word)}</span>`;
      } else if (FORMULA_CONSTANTS.has(word)) {
        result += `<span class="hl-constant">${escapeHtml(word)}</span>`;
      } else if (FORMULA_KEYWORDS.has(word)) {
        result += `<span class="hl-keyword">${escapeHtml(word)}</span>`;
      } else if (word === "data" || word === "relations" || word === "relation_count" || word === "children" || word === "children_count") {
        result += `<span class="hl-context">${escapeHtml(word)}</span>`;
      } else {
        result += escapeHtml(word);
      }
    } else if (m[4]) { // operator / punctuation
      result += `<span class="hl-punct">${escapeHtml(m[4])}</span>`;
    }
    lastIdx = rx.lastIndex;
  }
  if (lastIdx < line.length) result += escapeHtml(line.slice(lastIdx));
  return result;
}

/** CSS for syntax highlighting classes. */
const HL_STYLES = `
  .hl-comment { color: #6a737d; font-style: italic; }
  .hl-string { color: #b31d28; }
  .hl-number { color: #005cc5; }
  .hl-function { color: #6f42c1; }
  .hl-builtin { color: #6f42c1; opacity: 0.85; }
  .hl-keyword { color: #d73a49; }
  .hl-constant { color: #005cc5; }
  .hl-context { color: #22863a; }
  .hl-property { color: #005cc5; }
  .hl-punct { color: #6a737d; }
`;

// ── FormulaEditor with autocomplete ────────────────────────────────

interface FormulaEditorProps {
  value: string;
  onChange: (value: string) => void;
  cardType: CardType | null;
  relationTypes: RelationType[];
}

const TEXTAREA_ID = "formula-editor-textarea";

function FormulaEditor({ value, onChange, cardType, relationTypes }: FormulaEditorProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [cursorToken, setCursorToken] = useState({ prefix: "", token: "" });
  const suppressRef = useRef(false);

  const getTextarea = useCallback(
    () => document.getElementById(TEXTAREA_ID) as HTMLTextAreaElement | null,
    [],
  );

  // Build the full suggestion catalog based on selected card type
  const allSuggestions = useMemo(() => {
    const items: Suggestion[] = [];

    // Top-level context variables
    items.push(
      { insert: "data", label: "data", detail: "Card fields object", category: "Context" },
      { insert: "relations", label: "relations", detail: "Related cards by type", category: "Context" },
      { insert: "relation_count", label: "relation_count", detail: "Relation counts by type", category: "Context" },
      { insert: "children", label: "children", detail: "Child cards list", category: "Context" },
      { insert: "children_count", label: "children_count", detail: "Number of children", category: "Context" },
      { insert: "None", label: "None", detail: "Null value", category: "Constants" },
      { insert: "True", label: "True", detail: "Boolean true", category: "Constants" },
      { insert: "False", label: "False", detail: "Boolean false", category: "Constants" },
    );

    // Functions
    const fns: [string, string, string][] = [
      ["IF", "IF(cond, true_val, false_val)", "Conditional"],
      ["SUM", "SUM(list)", "Sum numbers"],
      ["AVG", "AVG(list)", "Average"],
      ["MIN", "MIN(list)", "Minimum"],
      ["MAX", "MAX(list)", "Maximum"],
      ["COUNT", "COUNT(list)", "List length"],
      ["ROUND", "ROUND(num, decimals)", "Round number"],
      ["ABS", "ABS(num)", "Absolute value"],
      ["COALESCE", "COALESCE(v1, v2, ...)", "First non-null"],
      ["LOWER", "LOWER(s)", "Lowercase"],
      ["UPPER", "UPPER(s)", "Uppercase"],
      ["CONCAT", "CONCAT(s1, s2, ...)", "Join strings"],
      ["CONTAINS", "CONTAINS(s, sub)", "Substring check"],
      ["PLUCK", "PLUCK(list, key)", "Extract field"],
      ["FILTER", "FILTER(list, key, val)", "Filter list"],
      ["MAP_SCORE", 'MAP_SCORE(val, {"a":1,...})', "Map to score"],
    ];
    for (const [name, sig, desc] of fns) {
      items.push({ insert: name + "(", label: name, detail: `${sig} — ${desc}`, category: "Functions" });
    }

    // Python builtins
    for (const b of ["len(", "str(", "int(", "float(", "bool(", "abs(", "round(", "min(", "max(", "sum("]) {
      const name = b.replace("(", "");
      items.push({ insert: b, label: name, detail: `Python ${name}()`, category: "Built-ins" });
    }

    return items;
  }, []);

  // Data fields for the selected card type (used after "data.")
  const dataFieldSuggestions = useMemo(() => {
    const items: Suggestion[] = [
      { insert: "name", label: "name", detail: "Card name (text)", category: "Card Fields" },
      { insert: "description", label: "description", detail: "Description (text)", category: "Card Fields" },
      { insert: "status", label: "status", detail: "ACTIVE / ARCHIVED", category: "Card Fields" },
      { insert: "subtype", label: "subtype", detail: "Card subtype", category: "Card Fields" },
      { insert: "approval_status", label: "approval_status", detail: "DRAFT / APPROVED / ...", category: "Card Fields" },
      { insert: "lifecycle", label: "lifecycle", detail: "Lifecycle dates object", category: "Card Fields" },
    ];
    if (cardType) {
      for (const section of cardType.fields_schema || []) {
        for (const f of section.fields) {
          items.push({
            insert: f.key,
            label: f.key,
            detail: `${f.label} (${f.type})`,
            category: section.section,
          });
        }
      }
    }
    return items;
  }, [cardType]);

  // Relation type keys (used after "relations." and "relation_count.")
  const relationKeySuggestions = useMemo(() => {
    if (!cardType) return [];
    return relationTypes
      .filter((rt) => rt.source_type_key === cardType.key || rt.target_type_key === cardType.key)
      .map((rt) => ({
        insert: rt.key,
        label: rt.key,
        detail: `${rt.label} (${rt.source_type_key} → ${rt.target_type_key})`,
        category: "Relation Types",
      }));
  }, [cardType, relationTypes]);

  // Extract the token being typed at cursor position
  const getTokenAtCursor = useCallback((text: string, pos: number) => {
    // Walk backwards to find token start
    const before = text.slice(0, pos);
    // Match the last word-like token, possibly with dots (e.g. "data.bus", "relation_count.rel")
    const match = before.match(/([\w.]+)$/);
    if (!match) return { prefix: "", token: "" };
    const full = match[1];
    // Split by last dot to determine prefix context
    const dotIdx = full.lastIndexOf(".");
    if (dotIdx >= 0) {
      return { prefix: full.slice(0, dotIdx), token: full.slice(dotIdx + 1) };
    }
    return { prefix: "", token: full };
  }, []);

  // Compute filtered suggestions based on current token
  const filteredSuggestions = useMemo(() => {
    const { prefix, token } = cursorToken;
    const lower = token.toLowerCase();

    let pool: Suggestion[];
    if (prefix === "data") {
      pool = dataFieldSuggestions;
    } else if (prefix === "relations" || prefix === "relation_count") {
      pool = relationKeySuggestions;
    } else if (prefix) {
      // Nested access like "relations.relAppToITC." — no suggestions for deeper nesting
      return [];
    } else {
      pool = allSuggestions;
    }

    if (!lower) return prefix ? pool.slice(0, 20) : []; // Show all after dot, nothing without typing
    return pool.filter((s) => s.label.toLowerCase().includes(lower)).slice(0, 12);
  }, [cursorToken, allSuggestions, dataFieldSuggestions, relationKeySuggestions]);

  // Handle value change from the code editor
  const handleValueChange = useCallback(
    (newValue: string) => {
      onChange(newValue);
      if (suppressRef.current) {
        suppressRef.current = false;
        return;
      }
      // Read cursor position after the editor updates
      requestAnimationFrame(() => {
        const ta = getTextarea();
        if (!ta) return;
        const pos = ta.selectionStart ?? newValue.length;
        const tokenInfo = getTokenAtCursor(newValue, pos);
        setCursorToken(tokenInfo);
        setSelectedIdx(0);
        const shouldShow = tokenInfo.prefix ? true : tokenInfo.token.length >= 2;
        setShowSuggestions(shouldShow);
      });
    },
    [onChange, getTextarea, getTokenAtCursor],
  );

  // Update showSuggestions when filteredSuggestions changes
  useEffect(() => {
    if (filteredSuggestions.length === 0) {
      setShowSuggestions(false);
    } else if (cursorToken.prefix || cursorToken.token.length >= 2) {
      setShowSuggestions(true);
    }
  }, [filteredSuggestions, cursorToken]);

  // Insert a suggestion at the cursor position
  const applySuggestion = useCallback((suggestion: Suggestion) => {
    const textarea = getTextarea();
    if (!textarea) return;

    const pos = textarea.selectionStart ?? value.length;
    const tokenInfo = getTokenAtCursor(value, pos);
    const tokenLen = tokenInfo.token.length;

    const before = value.slice(0, pos - tokenLen);
    const after = value.slice(pos);
    const newValue = before + suggestion.insert + after;
    const newCursorPos = before.length + suggestion.insert.length;

    suppressRef.current = true;
    onChange(newValue);
    setShowSuggestions(false);
    setCursorToken({ prefix: "", token: "" });

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newCursorPos, newCursorPos);
    });
  }, [value, onChange, getTokenAtCursor, getTextarea]);

  // Handle keyboard navigation in the suggestions list
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showSuggestions || filteredSuggestions.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.min(prev + 1, filteredSuggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIdx((prev) => Math.max(prev - 1, 0));
    } else if (e.key === "Tab" || e.key === "Enter") {
      if (showSuggestions && filteredSuggestions[selectedIdx]) {
        e.preventDefault();
        applySuggestion(filteredSuggestions[selectedIdx]);
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  };

  const lineCount = (value || "\n").split("\n").length;

  return (
    <Box sx={{ position: "relative" }} ref={containerRef}>
      <style>{HL_STYLES}</style>
      <Typography variant="caption" sx={{ color: "text.secondary", mb: 0.5, display: "block" }}>
        Formula *
      </Typography>
      <Box
        sx={{
          display: "flex",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "action.hover",
          overflow: "hidden",
          "&:focus-within": { borderColor: "primary.main", boxShadow: (t) => `0 0 0 1px ${t.palette.primary.main}` },
        }}
      >
        {/* Line numbers gutter */}
        <Box
          sx={{
            py: "10px",
            px: 1,
            bgcolor: "action.selected",
            borderRight: 1,
            borderColor: "divider",
            userSelect: "none",
            flexShrink: 0,
            fontFamily: "monospace",
            fontSize: "0.82rem",
            lineHeight: "1.5",
            color: "text.secondary",
            textAlign: "right",
            minWidth: 36,
          }}
          aria-hidden
        >
          {Array.from({ length: lineCount }, (_, i) => (
            <div key={i}>{i + 1}</div>
          ))}
        </Box>

        {/* Code editor */}
        <Box sx={{ flex: 1, minHeight: 160, overflow: "auto" }}>
          <CodeEditor
            value={value}
            onValueChange={handleValueChange}
            highlight={highlightFormula}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
            textareaId={TEXTAREA_ID}
            placeholder="Start typing — suggestions appear for fields, functions, and relations"
            padding={10}
            style={{
              fontFamily: "monospace",
              fontSize: "0.82rem",
              lineHeight: "1.5",
              minHeight: 160,
              color: "#24292e",
              caretColor: "#24292e",
            }}
          />
        </Box>
      </Box>
      <Popper
        open={showSuggestions && filteredSuggestions.length > 0}
        anchorEl={containerRef.current}
        placement="bottom-start"
        sx={{ zIndex: 1500, width: containerRef.current?.offsetWidth || 400 }}
        modifiers={[{ name: "offset", options: { offset: [0, 4] } }]}
      >
        <Paper
          elevation={8}
          sx={{
            maxHeight: 240,
            overflow: "auto",
            border: "1px solid",
            borderColor: "divider",
            py: 0.5,
          }}
        >
          {filteredSuggestions.map((s, i) => (
            <Box
              key={s.insert + s.category}
              onMouseDown={(e) => {
                e.preventDefault(); // prevent blur
                applySuggestion(s);
              }}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                px: 1.5,
                py: 0.5,
                cursor: "pointer",
                bgcolor: i === selectedIdx ? "action.selected" : "transparent",
                "&:hover": { bgcolor: "action.hover" },
              }}
            >
              <Typography
                variant="body2"
                sx={{
                  fontFamily: "monospace",
                  fontSize: "0.8rem",
                  fontWeight: i === selectedIdx ? 600 : 400,
                  minWidth: 0,
                  flexShrink: 0,
                }}
              >
                {s.label}
              </Typography>
              {s.detail && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  noWrap
                  sx={{ flexShrink: 1, minWidth: 0 }}
                >
                  {s.detail}
                </Typography>
              )}
              <Typography
                variant="caption"
                sx={{
                  ml: "auto",
                  flexShrink: 0,
                  color: "text.disabled",
                  fontSize: "0.65rem",
                }}
              >
                {s.category}
              </Typography>
            </Box>
          ))}
          <Box sx={{ px: 1.5, pt: 0.5, borderTop: "1px solid", borderColor: "divider" }}>
            <Typography variant="caption" color="text.disabled">
              Tab or Enter to insert &middot; Esc to dismiss
            </Typography>
          </Box>
        </Paper>
      </Popper>
    </Box>
  );
}

// ── Highlighted Code Block (read-only, with line numbers) ─────────

const EXAMPLE_FORMULAS = `# Total Budget
COALESCE(data.budgetCapEx, 0) + COALESCE(data.budgetOpEx, 0)

# Count related applications
relation_count.relAppToITC

# Weighted score
scores = {"perfect": 4, "good": 3, "adequate": 2, "poor": 1}
MAP_SCORE(data.stability, scores) * 0.5 + MAP_SCORE(data.security, scores) * 0.5

# ── TIME Model (Tolerate / Invest / Migrate / Eliminate) ──
# Assumes single_select fields: businessFit and technicalFit
# with options: excellent, adequate, insufficient, unreasonable.
#
# Scoring: Map each dimension to 1-4 numeric scale.
# Business Fit  = Y-axis (how well does it serve the business?)
# Technical Fit = X-axis (how healthy is the technology?)
#
# Quadrant logic (threshold at score 2.5):
#   Invest    = high business + high technical
#   Migrate   = high business + low technical
#   Tolerate  = low business  + high technical
#   Eliminate = low business  + low technical
#
bf = MAP_SCORE(data.businessFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
tf = MAP_SCORE(data.technicalFit, {"excellent": 4, "adequate": 3, "insufficient": 2, "unreasonable": 1})
IF(bf is None or tf is None, None, IF(bf >= 2.5, IF(tf >= 2.5, "invest", "migrate"), IF(tf >= 2.5, "tolerate", "eliminate")))`;

function HighlightedCodeBlock({ code }: { code: string }) {
  const lines = code.split("\n");
  return (
    <Box
      sx={{
        display: "flex",
        bgcolor: "action.hover",
        borderRadius: 1,
        border: "1px solid",
        borderColor: "divider",
        overflow: "auto",
        fontSize: "0.7rem",
        lineHeight: "1.55",
        fontFamily: "monospace",
      }}
    >
      <style>{HL_STYLES}</style>
      <Box
        sx={{
          py: 1,
          px: 1,
          color: "text.secondary",
          textAlign: "right",
          userSelect: "none",
          borderRight: 1,
          borderColor: "divider",
          bgcolor: "action.selected",
          flexShrink: 0,
          minWidth: 28,
        }}
        aria-hidden
      >
        {lines.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </Box>
      <Box
        component="pre"
        sx={{ py: 1, px: 1.5, m: 0, color: "#24292e", whiteSpace: "pre-wrap", flex: 1 }}
        dangerouslySetInnerHTML={{ __html: highlightFormula(code) }}
      />
    </Box>
  );
}

// ── Formula Reference Panel ────────────────────────────────────────

interface FormulaReferenceProps {
  cardType: CardType | null;
  relationTypes: RelationType[];
}

function FormulaReference({ cardType, relationTypes }: FormulaReferenceProps) {
  const relTypes = relationTypes.filter(
    (rt) =>
      cardType &&
      (rt.source_type_key === cardType.key ||
        rt.target_type_key === cardType.key)
  );

  const functions = [
    { name: "IF(cond, true_val, false_val)", desc: "Conditional" },
    { name: "SUM(list)", desc: "Sum a list of numbers" },
    { name: "AVG(list)", desc: "Average a list" },
    { name: "MIN(list) / MAX(list)", desc: "Min / Max of list" },
    { name: "COUNT(list)", desc: "Length of a list" },
    { name: "ROUND(num, decimals)", desc: "Round a number" },
    { name: "ABS(num)", desc: "Absolute value" },
    { name: "COALESCE(v1, v2, ...)", desc: "First non-null value" },
    { name: "LOWER(s) / UPPER(s)", desc: "Case conversion" },
    { name: "CONCAT(s1, s2, ...)", desc: "String concatenation" },
    { name: "CONTAINS(s, sub)", desc: "Substring check" },
    { name: "PLUCK(list, key)", desc: "Extract field from each dict" },
    { name: "FILTER(list, key, val)", desc: "Filter list by field value" },
    { name: 'MAP_SCORE(val, {"a":1,...})', desc: "Map key to score" },
  ];

  return (
    <Accordion sx={{ mt: 2 }}>
      <AccordionSummary expandIcon={<MaterialSymbol icon="expand_more" size={20} />}>
        <Typography variant="body2" sx={{ fontWeight: 500 }}>
          Formula Reference
        </Typography>
      </AccordionSummary>
      <AccordionDetails>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {cardType && (
            <Box>
              <Typography variant="caption" fontWeight={600} gutterBottom>
                Available Fields (data.&lt;fieldKey&gt;)
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                <Chip size="small" label="data.name" variant="outlined" />
                <Chip size="small" label="data.description" variant="outlined" />
                <Chip size="small" label="data.status" variant="outlined" />
                <Chip size="small" label="data.subtype" variant="outlined" />
                {cardType.fields_schema?.flatMap((s) =>
                  s.fields.map((f) => (
                    <Chip
                      key={f.key}
                      size="small"
                      label={`data.${f.key}`}
                      variant="outlined"
                      title={`${f.label} (${f.type})`}
                    />
                  ))
                )}
              </Box>
            </Box>
          )}

          {relTypes.length > 0 && (
            <Box>
              <Typography variant="caption" fontWeight={600} gutterBottom>
                Relation Types
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                {relTypes.map((rt) => (
                  <Chip
                    key={rt.key}
                    size="small"
                    label={`relations.${rt.key}`}
                    variant="outlined"
                    title={`${rt.label} (${rt.source_type_key} → ${rt.target_type_key})`}
                  />
                ))}
              </Box>
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
                Also: relation_count.&lt;key&gt;, children, children_count
              </Typography>
            </Box>
          )}

          <Box>
            <Typography variant="caption" fontWeight={600} gutterBottom>
              Built-in Functions
            </Typography>
            <Table size="small" sx={{ mt: 0.5 }}>
              <TableBody>
                {functions.map((fn) => (
                  <TableRow key={fn.name}>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: "0.75rem", py: 0.25, whiteSpace: "nowrap" }}>
                      {fn.name}
                    </TableCell>
                    <TableCell sx={{ fontSize: "0.75rem", py: 0.25 }}>{fn.desc}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>

          <Box>
            <Typography variant="caption" fontWeight={600} gutterBottom>
              Example Formulas
            </Typography>
            <HighlightedCodeBlock code={EXAMPLE_FORMULAS} />
          </Box>
        </Box>
      </AccordionDetails>
    </Accordion>
  );
}

// ── Edit Dialog ────────────────────────────────────────────────────

interface EditDialogProps {
  open: boolean;
  calculation: Partial<Calculation> | null;
  cardTypes: CardType[];
  relationTypes: RelationType[];
  onClose: () => void;
  onSave: (data: Partial<Calculation>) => Promise<void>;
}

function EditDialog({ open, calculation, cardTypes, relationTypes, onClose, onSave }: EditDialogProps) {
  const [form, setForm] = useState<Partial<Calculation>>({});
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validationResult, setValidationResult] = useState<{ valid: boolean; error?: string; preview_result?: unknown } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setForm(calculation || { execution_order: 0 });
      setValidationResult(null);
      setError("");
    }
  }, [open, calculation]);

  const selectedType = cardTypes.find((t) => t.key === form.target_type_key);

  // Get eligible fields for the selected type
  const eligibleFields: FieldDef[] = [];
  if (selectedType) {
    for (const section of selectedType.fields_schema || []) {
      for (const field of section.fields) {
        if (["number", "cost", "text", "single_select", "boolean"].includes(field.type)) {
          eligibleFields.push(field);
        }
      }
    }
  }

  const handleValidate = async () => {
    if (!form.formula || !form.target_type_key) return;
    setValidating(true);
    setValidationResult(null);
    try {
      const res = await api.post<{ valid: boolean; error?: string; preview_result?: unknown }>(
        "/calculations/validate",
        { formula: form.formula, target_type_key: form.target_type_key }
      );
      setValidationResult(res);
    } catch (e: unknown) {
      setValidationResult({ valid: false, error: String(e) });
    } finally {
      setValidating(false);
    }
  };

  const handleSave = async () => {
    if (!form.name || !form.target_type_key || !form.target_field_key || !form.formula) {
      setError("Name, target type, target field, and formula are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(form);
      onClose();
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{calculation?.id ? "Edit Calculation" : "New Calculation"}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
          {error && <Alert severity="error">{error}</Alert>}

          <TextField
            label="Name"
            value={form.name || ""}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            fullWidth
          />

          <TextField
            label="Description"
            value={form.description || ""}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            multiline
            rows={2}
            fullWidth
          />

          <Box sx={{ display: "flex", gap: 2 }}>
            <FormControl fullWidth required>
              <InputLabel>Target Card Type</InputLabel>
              <Select
                value={form.target_type_key || ""}
                label="Target Card Type"
                onChange={(e) => setForm({ ...form, target_type_key: e.target.value, target_field_key: "" })}
              >
                {cardTypes.map((t) => (
                  <MenuItem key={t.key} value={t.key}>
                    {t.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            <FormControl fullWidth required disabled={!selectedType}>
              <InputLabel>Target Field</InputLabel>
              <Select
                value={form.target_field_key || ""}
                label="Target Field"
                onChange={(e) => setForm({ ...form, target_field_key: e.target.value })}
              >
                {eligibleFields.map((f) => (
                  <MenuItem key={f.key} value={f.key}>
                    {f.label} ({f.type})
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Box>

          <TextField
            label="Execution Order"
            type="number"
            value={form.execution_order ?? 0}
            onChange={(e) => setForm({ ...form, execution_order: parseInt(e.target.value) || 0 })}
            sx={{ maxWidth: 180 }}
          />

          <FormulaEditor
            value={form.formula || ""}
            onChange={(v) => {
              setForm({ ...form, formula: v });
              setValidationResult(null);
            }}
            cardType={selectedType || null}
            relationTypes={relationTypes}
          />

          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Button
              size="small"
              variant="outlined"
              onClick={handleValidate}
              disabled={validating || !form.formula || !form.target_type_key}
            >
              {validating ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
              Validate
            </Button>
            {validationResult && (
              <Chip
                size="small"
                label={validationResult.valid ? "Valid" : "Invalid"}
                color={validationResult.valid ? "success" : "error"}
              />
            )}
            {validationResult?.error && (
              <Typography variant="caption" color="error" sx={{ ml: 1 }}>
                {validationResult.error}
              </Typography>
            )}
            {validationResult?.valid && validationResult.preview_result !== undefined && (
              <Typography variant="caption" color="text.secondary" sx={{ ml: 1 }}>
                Preview: {JSON.stringify(validationResult.preview_result)}
              </Typography>
            )}
          </Box>

          <FormulaReference cardType={selectedType || null} relationTypes={relationTypes} />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSave} disabled={saving}>
          {saving ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
          {calculation?.id ? "Save" : "Create"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Test Dialog ────────────────────────────────────────────────────

interface TestDialogProps {
  open: boolean;
  calculation: Calculation | null;
  onClose: () => void;
}

function TestDialog({ open, calculation, onClose }: TestDialogProps) {
  const [selectedCard, setSelectedCard] = useState<CardItem | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [options, setOptions] = useState<CardItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; error?: string; computed_value?: unknown; card_name?: string } | null>(null);

  const { types } = useMetamodel();

  useEffect(() => {
    if (open) {
      setSelectedCard(null);
      setSearchInput("");
      setOptions([]);
      setResult(null);
    }
  }, [open]);

  // Debounced card search
  useEffect(() => {
    if (!searchInput || searchInput.length < 2 || !calculation?.target_type_key) {
      setOptions([]);
      return;
    }
    setSearchLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await api.get<{ items: CardItem[] }>(
          `/cards?type=${encodeURIComponent(calculation.target_type_key)}&search=${encodeURIComponent(searchInput)}&page_size=15`,
        );
        setOptions(res.items);
      } catch {
        setOptions([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, calculation?.target_type_key]);

  const handleTest = async () => {
    if (!calculation || !selectedCard) return;
    setTesting(true);
    setResult(null);
    try {
      const res = await api.post<{ success: boolean; error?: string; computed_value?: unknown; card_name?: string }>(
        `/calculations/${calculation.id}/test`,
        { card_id: selectedCard.id }
      );
      setResult(res);
    } catch (e: unknown) {
      setResult({ success: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const typeLabel = types.find((t) => t.key === calculation?.target_type_key)?.label || calculation?.target_type_key || "card";

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>Test Calculation: {calculation?.name}</DialogTitle>
      <DialogContent>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2, mt: 1 }}>
          <Typography variant="body2" color="text.secondary">
            Search for a {typeLabel} to test this formula against. The result will not be saved.
          </Typography>
          <Autocomplete
            options={options}
            value={selectedCard}
            onChange={(_, val) => {
              setSelectedCard(val);
              setResult(null);
            }}
            onInputChange={(_, val, reason) => {
              if (reason === "input") setSearchInput(val);
              else if (reason === "clear") setSearchInput("");
            }}
            filterOptions={(x) => x}
            getOptionLabel={(opt) => opt.name}
            isOptionEqualToValue={(opt, val) => opt.id === val.id}
            loading={searchLoading}
            noOptionsText={searchInput.length < 2 ? "Type to search..." : "No cards found"}
            renderOption={({ key, ...optProps }, option) => (
              <li key={option.id} {...optProps}>
                <Box sx={{ display: "flex", flexDirection: "column" }}>
                  <Typography variant="body2">{option.name}</Typography>
                  {option.subtype && (
                    <Typography variant="caption" color="text.secondary">
                      {option.subtype}
                    </Typography>
                  )}
                </Box>
              </li>
            )}
            renderInput={(params) => (
              <TextField
                {...params}
                label={`Search ${typeLabel}`}
                placeholder={`Type a ${typeLabel.toLowerCase()} name...`}
                slotProps={{
                  input: {
                    ...params.InputProps,
                    endAdornment: (
                      <>
                        {searchLoading ? <CircularProgress color="inherit" size={16} /> : null}
                        {params.InputProps.endAdornment}
                      </>
                    ),
                  },
                }}
              />
            )}
          />
          <Button variant="contained" onClick={handleTest} disabled={testing || !selectedCard}>
            {testing ? <CircularProgress size={16} sx={{ mr: 1 }} /> : null}
            Test
          </Button>
          {result && (
            <Alert severity={result.success ? "success" : "error"}>
              {result.success ? (
                <>
                  Computed value for &quot;{result.card_name}&quot;:{" "}
                  <strong>{JSON.stringify(result.computed_value)}</strong>
                </>
              ) : (
                result.error
              )}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

// ── Main Component ─────────────────────────────────────────────────

export default function CalculationsAdmin() {
  const { types, relationTypes } = useMetamodel();
  const [calculations, setCalculations] = useState<Calculation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editCalc, setEditCalc] = useState<Partial<Calculation> | null>(null);
  const [testOpen, setTestOpen] = useState(false);
  const [testCalc, setTestCalc] = useState<Calculation | null>(null);
  const [recalculating, setRecalculating] = useState<string | null>(null);
  const [recalcResult, setRecalcResult] = useState<{ type: string; message: string } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Calculation | null>(null);
  const [filterType, setFilterType] = useState<string>("");

  const visibleTypes = types.filter((t) => !t.is_hidden);

  const fetchCalculations = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.get<Calculation[]>("/calculations");
      setCalculations(data);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCalculations();
  }, [fetchCalculations]);

  const handleSave = async (data: Partial<Calculation>) => {
    const payload = {
      name: data.name,
      description: data.description || null,
      target_type_key: data.target_type_key,
      target_field_key: data.target_field_key,
      formula: data.formula,
      execution_order: data.execution_order,
    };
    if (data.id) {
      await api.patch(`/calculations/${data.id}`, payload);
    } else {
      await api.post("/calculations", payload);
    }
    await fetchCalculations();
  };

  const handleToggleActive = async (calc: Calculation) => {
    try {
      if (calc.is_active) {
        await api.post(`/calculations/${calc.id}/deactivate`, {});
      } else {
        await api.post(`/calculations/${calc.id}/activate`, {});
      }
      await fetchCalculations();
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const handleDelete = async (calc: Calculation) => {
    try {
      await api.delete(`/calculations/${calc.id}`);
      setDeleteConfirm(null);
      await fetchCalculations();
    } catch (e: unknown) {
      setError(String(e));
    }
  };

  const handleRecalculate = async (typeKey: string) => {
    setRecalculating(typeKey);
    setRecalcResult(null);
    try {
      const res = await api.post<{
        cards_processed: number;
        calculations_succeeded: number;
        calculations_failed: number;
      }>(`/calculations/recalculate/${typeKey}`, {});
      setRecalcResult({
        type: typeKey,
        message: `Processed ${res.cards_processed} cards: ${res.calculations_succeeded} succeeded, ${res.calculations_failed} failed`,
      });
    } catch (e: unknown) {
      setRecalcResult({ type: typeKey, message: `Error: ${String(e)}` });
    } finally {
      setRecalculating(null);
    }
  };

  const filteredCalcs = filterType
    ? calculations.filter((c) => c.target_type_key === filterType)
    : calculations;

  const getTypeLabel = (key: string) => types.find((t) => t.key === key)?.label || key;

  const getFieldLabel = (typeKey: string, fieldKey: string) => {
    const t = types.find((ct) => ct.key === typeKey);
    if (!t) return fieldKey;
    for (const section of t.fields_schema || []) {
      for (const field of section.fields) {
        if (field.key === fieldKey) return field.label;
      }
    }
    return fieldKey;
  };

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 3, flexWrap: "wrap" }}>
        <MaterialSymbol icon="calculate" size={22} />
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          Calculated Fields
        </Typography>
        <Box sx={{ flex: 1 }} />
        <FormControl size="small" sx={{ minWidth: 180 }}>
          <InputLabel>Filter by type</InputLabel>
          <Select
            value={filterType}
            label="Filter by type"
            onChange={(e) => setFilterType(e.target.value)}
          >
            <MenuItem value="">All types</MenuItem>
            {visibleTypes.map((t) => (
              <MenuItem key={t.key} value={t.key}>
                {t.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Button
          variant="contained"
          startIcon={<MaterialSymbol icon="add" size={18} />}
          onClick={() => {
            setEditCalc(null);
            setEditOpen(true);
          }}
        >
          New Calculation
        </Button>
      </Box>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError("")}>
          {error}
        </Alert>
      )}

      {recalcResult && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          onClose={() => setRecalcResult(null)}
        >
          <strong>{getTypeLabel(recalcResult.type)}:</strong> {recalcResult.message}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
          <CircularProgress />
        </Box>
      ) : filteredCalcs.length === 0 ? (
        <Card>
          <CardContent sx={{ textAlign: "center", py: 6 }}>
            <MaterialSymbol icon="calculate" size={48} color="#ccc" />
            <Typography variant="h6" color="text.secondary" sx={{ mt: 1 }}>
              No calculations defined
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Create a calculation to auto-populate card fields based on formulas.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <TableContainer component={Card}>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Name</TableCell>
                <TableCell>Target Type</TableCell>
                <TableCell>Target Field</TableCell>
                <TableCell>Order</TableCell>
                <TableCell align="center">Active</TableCell>
                <TableCell>Last Run</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {filteredCalcs.map((calc) => (
                <TableRow key={calc.id} hover>
                  <TableCell>
                    <Typography variant="body2" fontWeight={500}>
                      {calc.name}
                    </Typography>
                    {calc.description && (
                      <Typography variant="caption" color="text.secondary">
                        {calc.description}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{getTypeLabel(calc.target_type_key)}</TableCell>
                  <TableCell>{getFieldLabel(calc.target_type_key, calc.target_field_key)}</TableCell>
                  <TableCell>{calc.execution_order}</TableCell>
                  <TableCell align="center">
                    <Switch
                      checked={calc.is_active}
                      onChange={() => handleToggleActive(calc)}
                      size="small"
                    />
                  </TableCell>
                  <TableCell>
                    {calc.last_run_at ? (
                      <Typography variant="caption">
                        {new Date(calc.last_run_at).toLocaleString()}
                      </Typography>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        Never
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {calc.last_error ? (
                      <Tooltip title={calc.last_error}>
                        <Chip size="small" label="Error" color="error" />
                      </Tooltip>
                    ) : calc.last_run_at ? (
                      <Chip size="small" label="OK" color="success" />
                    ) : null}
                  </TableCell>
                  <TableCell align="right">
                    <Tooltip title="Edit">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setEditCalc(calc);
                          setEditOpen(true);
                        }}
                      >
                        <MaterialSymbol icon="edit" size={18} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Test with card">
                      <IconButton
                        size="small"
                        onClick={() => {
                          setTestCalc(calc);
                          setTestOpen(true);
                        }}
                      >
                        <MaterialSymbol icon="science" size={18} />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Recalculate all">
                      <IconButton
                        size="small"
                        onClick={() => handleRecalculate(calc.target_type_key)}
                        disabled={recalculating === calc.target_type_key}
                      >
                        {recalculating === calc.target_type_key ? (
                          <CircularProgress size={18} />
                        ) : (
                          <MaterialSymbol icon="refresh" size={18} />
                        )}
                      </IconButton>
                    </Tooltip>
                    <Tooltip title="Delete">
                      <IconButton
                        size="small"
                        color="error"
                        onClick={() => setDeleteConfirm(calc)}
                      >
                        <MaterialSymbol icon="delete" size={18} />
                      </IconButton>
                    </Tooltip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <EditDialog
        open={editOpen}
        calculation={editCalc}
        cardTypes={visibleTypes}
        relationTypes={relationTypes}
        onClose={() => setEditOpen(false)}
        onSave={handleSave}
      />

      <TestDialog
        open={testOpen}
        calculation={testCalc}
        onClose={() => setTestOpen(false)}
      />

      {/* Delete confirmation */}
      <Dialog open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)}>
        <DialogTitle>Delete Calculation</DialogTitle>
        <DialogContent>
          <Typography>
            Are you sure you want to delete &quot;{deleteConfirm?.name}&quot;? This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
