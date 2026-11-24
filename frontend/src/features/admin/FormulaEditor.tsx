import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Popper from "@mui/material/Popper";
import Typography from "@mui/material/Typography";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import CodeEditor from "react-simple-code-editor";
import { useFieldLabel, useRelationLabel } from "@/hooks/useResolveLabel";
import type { CardType, RelationType } from "@/types";
import { HL_STYLES, highlightFormula } from "./formulaHighlight";

interface Suggestion {
  insert: string; // text to insert
  label: string; // display label
  detail?: string; // secondary text (type, description)
  category: string; // grouping label
}

interface FormulaEditorProps {
  value: string;
  onChange: (value: string) => void;
  cardType: CardType | null;
  relationTypes: RelationType[];
  dataFields?: {
    key: string;
    label: string;
    kind?: string;
    options?: { id: string; label: string }[];
  }[];
  nestedFields?: Record<string, { key: string; label: string }[]>;
  extraNames?: string[];
  textareaId?: string;
  legacy?: boolean;
}

export function FormulaEditor({
  value,
  onChange,
  cardType,
  relationTypes,
  dataFields,
  nestedFields,
  extraNames,
  textareaId = "formula-editor-textarea",
  legacy = false,
}: FormulaEditorProps) {
  const { t } = useTranslation(["admin"]);
  const fieldLabel = useFieldLabel();
  const relLabel = useRelationLabel();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [cursorToken, setCursorToken] = useState({ prefix: "", token: "" });

  const getTextarea = useCallback(
    () => document.getElementById(textareaId) as HTMLTextAreaElement | null,
    [textareaId],
  );

  const allSuggestions = useMemo(() => {
    const items: Suggestion[] = [];

    items.push(
      { insert: "data", label: "data", detail: "Card fields object", category: "Context" },
      {
        insert: "relations",
        label: "relations",
        detail: "Related cards by type",
        category: "Context",
      },
      {
        insert: "relation_count",
        label: "relation_count",
        detail: "Relation counts by type",
        category: "Context",
      },
      { insert: "children", label: "children", detail: "Child cards list", category: "Context" },
      {
        insert: "children_count",
        label: "children_count",
        detail: "Number of children",
        category: "Context",
      },
      {
        insert: "parent",
        label: "parent",
        detail: "Parent card object (or None)",
        category: "Context",
      },
      {
        insert: "hierarchy_level",
        label: "hierarchy_level",
        detail: "Depth in hierarchy (1 = root)",
        category: "Context",
      },
      { insert: "ppm", label: "ppm", detail: t("calculations.ctxPpm"), category: "Context" },
      { insert: "None", label: "None", detail: "Null value", category: "Constants" },
      { insert: "True", label: "True", detail: "Boolean true", category: "Constants" },
      { insert: "False", label: "False", detail: "Boolean false", category: "Constants" },
    );

    if (dataFields) {
      items.splice(1, 7);
      if (legacy) items.shift();
      items.push(
        ...(extraNames ?? []).map((name) => ({ insert: name, label: name, category: t("pml.fields.conditionInput") })),
      );
    }

    const fns: [string, string, string][] = legacy ? [
      ["IF", "IF(cond, true_val, false_val)", "Conditional"],
      ["YEAR", "YEAR(date)", "Year"],
      ["MONTH", "MONTH(date)", "Month"],
      ["DAY", "DAY(date)", "Day"],
    ] : [
      ["IF", "IF(cond, true_val, false_val)", "Conditional"],
      ["SUM", "SUM(list)", "Sum numbers"],
      ["AVG", "AVG(list)", "Average"],
      ["MIN", "MIN(list)", "Minimum"],
      ["MAX", "MAX(list)", "Maximum"],
      ["COUNT", "COUNT(list)", "List length"],
      ["ROUND", "ROUND(num, decimals)", "Round number"],
      ["ABS", "ABS(num)", "Absolute value"],
      ["LN", "LN(num)", "Natural log (null for \u2264 0)"],
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
      items.push({
        insert: name + "(",
        label: name,
        detail: `${sig} — ${desc}`,
        category: "Functions",
      });
    }

    for (const b of legacy ? [] : [
      "len(",
      "str(",
      "int(",
      "float(",
      "bool(",
      "abs(",
      "round(",
      "min(",
      "max(",
      "sum(",
    ]) {
      const name = b.replace("(", "");
      items.push({ insert: b, label: name, detail: `Python ${name}()`, category: "Built-ins" });
    }

    return items;
  }, [t, dataFields, extraNames, legacy]);

  const ppmFieldSuggestions = useMemo<Suggestion[]>(() => {
    const items: Suggestion[] = [];
    for (const measure of ["Budget", "Planned", "Actual"]) {
      for (const bucket of ["capex", "opex", "total"]) {
        items.push({
          insert: `${bucket}${measure}`,
          label: `${bucket}${measure}`,
          detail: t(`calculations.ppm${measure}`, { bucket }),
          category: t("common:modules.ppm"),
        });
      }
    }
    items.push({
      insert: "byYear",
      label: "byYear",
      detail: t("calculations.ppmByYear"),
      category: t("common:modules.ppm"),
    });
    items.push({
      insert: "currentFiscalYear",
      label: "currentFiscalYear",
      detail: t("calculations.ppmCurrentFy"),
      category: t("common:modules.ppm"),
    });
    items.push({
      insert: "unscheduledPlanned",
      label: "unscheduledPlanned",
      detail: t("calculations.ppmUnscheduled"),
      category: t("common:modules.ppm"),
    });
    items.push({
      insert: "unscheduledActual",
      label: "unscheduledActual",
      detail: t("calculations.ppmUnscheduled"),
      category: t("common:modules.ppm"),
    });
    items.push({
      insert: "unscheduledCapexActual",
      label: "unscheduledCapexActual",
      detail: t("calculations.ppmUnscheduled"),
      category: t("common:modules.ppm"),
    });
    items.push({
      insert: "unscheduledOpexActual",
      label: "unscheduledOpexActual",
      detail: t("calculations.ppmUnscheduled"),
      category: t("common:modules.ppm"),
    });
    // Delivery figures (#1111): progress, tasks, risks, the latest status report.
    items.push({
      insert: "completion",
      label: "completion",
      detail: t("calculations.ppmCompletion"),
      category: t("common:modules.ppm"),
    });
    items.push({
      insert: "wbsCount",
      label: "wbsCount",
      detail: t("calculations.ppmWbsCount"),
      category: t("common:modules.ppm"),
    });
    items.push({
      insert: "milestoneCount",
      label: "milestoneCount",
      detail: t("calculations.ppmMilestoneCount"),
      category: t("common:modules.ppm"),
    });
    for (const key of ["taskCount", "tasksTodo", "tasksInProgress", "tasksDone", "tasksBlocked"]) {
      items.push({
        insert: key,
        label: key,
        detail: t("calculations.ppmTaskCounts"),
        category: t("common:modules.ppm"),
      });
    }
    items.push({
      insert: "tasksOverdue",
      label: "tasksOverdue",
      detail: t("calculations.ppmTasksOverdue"),
      category: t("common:modules.ppm"),
    });
    for (const key of ["riskCount", "risksOpen", "riskScoreMax"]) {
      items.push({
        insert: key,
        label: key,
        detail: t("calculations.ppmRisks"),
        category: t("common:modules.ppm"),
      });
    }
    for (const key of [
      "reportCount",
      "reportDate",
      "scheduleHealth",
      "costHealth",
      "scopeHealth",
    ]) {
      items.push({
        insert: key,
        label: key,
        detail: t("calculations.ppmReport"),
        category: t("common:modules.ppm"),
      });
    }
    return items;
  }, [t]);

  const dataFieldSuggestions = useMemo(() => {
    const items: Suggestion[] = [
      { insert: "name", label: "name", detail: "Card name (text)", category: "Card Fields" },
      {
        insert: "description",
        label: "description",
        detail: "Description (text)",
        category: "Card Fields",
      },
      { insert: "status", label: "status", detail: "ACTIVE / ARCHIVED", category: "Card Fields" },
      { insert: "subtype", label: "subtype", detail: "Card subtype", category: "Card Fields" },
      {
        insert: "approval_status",
        label: "approval_status",
        detail: "DRAFT / APPROVED / ...",
        category: "Card Fields",
      },
      {
        insert: "lifecycle",
        label: "lifecycle",
        detail: "Lifecycle dates object",
        category: "Card Fields",
      },
    ];
    if (dataFields) {
      return dataFields.map((field) => ({
        insert: field.key,
        label: field.key,
        detail:
          field.label +
          (field.options?.length
            ? " (" +
              field.options.map((option) => option.label + ': "' + option.id + '"').join(", ") +
              ")"
            : ""),
        category: t("surveyBuilder.steps.fields"),
      }));
    }
    if (cardType) {
      for (const section of cardType.fields_schema || []) {
        for (const f of section.fields) {
          items.push({
            insert: f.key,
            label: f.key,
            detail: `${fieldLabel(f)} (${f.type})`,
            category: section.section,
          });
        }
      }
    }
    return items;
  }, [cardType, dataFields, fieldLabel, t]);

  const relationKeySuggestions = useMemo(() => {
    if (!cardType) return [];
    return relationTypes
      .filter((rt) => rt.source_type_key === cardType.key || rt.target_type_key === cardType.key)
      .map((rt) => ({
        insert: rt.key,
        label: rt.key,
        detail: `${relLabel(rt)} (${rt.source_type_key} → ${rt.target_type_key})`,
        category: "Relation Types",
      }));
  }, [cardType, relationTypes, relLabel]);

  const getTokenAtCursor = useCallback((text: string, pos: number) => {
    const before = text.slice(0, pos);
    // Match the last word-like token, possibly with dots (e.g. "data.bus", "relation_count.rel")
    const match = before.match(/([\w.]+)$/);
    if (!match) return { prefix: "", token: "" };
    const full = match[1];
    const dotIdx = full.lastIndexOf(".");
    if (dotIdx >= 0) {
      return { prefix: full.slice(0, dotIdx), token: full.slice(dotIdx + 1) };
    }
    return { prefix: "", token: full };
  }, []);

  const filteredSuggestions = useMemo(() => {
    const { prefix, token } = cursorToken;
    const lower = token.toLowerCase();

    let pool: Suggestion[];
    if (prefix === "data" && !legacy) {
      pool = dataFieldSuggestions;
    } else if (!legacy && nestedFields?.[prefix]) {
      pool = nestedFields[prefix].map((field) => ({
        insert: field.key,
        label: field.key,
        detail: field.label,
        category: t("surveyBuilder.steps.fields"),
      }));
    } else if (prefix === "relations" || prefix === "relation_count") {
      pool = relationKeySuggestions;
    } else if (prefix === "ppm" && !dataFields) {
      pool = ppmFieldSuggestions;
    } else if (prefix) {
      // Nested access like "relations.relAppToITC." — no suggestions for deeper nesting
      return [];
    } else {
      pool = allSuggestions;
    }

    if (!lower) return prefix ? pool.slice(0, 20) : []; // Show all after dot, nothing without typing
    return pool.filter((s) => s.label.toLowerCase().includes(lower)).slice(0, 12);
  }, [
    cursorToken,
    allSuggestions,
    dataFieldSuggestions,
    relationKeySuggestions,
    ppmFieldSuggestions,
    dataFields,
    nestedFields,
    legacy,
    t,
  ]);

  const handleValueChange = useCallback(
    (newValue: string) => {
      onChange(newValue);
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

  useEffect(() => {
    if (filteredSuggestions.length === 0) {
      setShowSuggestions(false);
    } else if (cursorToken.prefix || cursorToken.token.length >= 2) {
      setShowSuggestions(true);
    }
  }, [filteredSuggestions, cursorToken]);

  const applySuggestion = useCallback(
    (suggestion: Suggestion) => {
      const textarea = getTextarea();
      if (!textarea) return;

      const pos = textarea.selectionStart ?? value.length;
      const tokenInfo = getTokenAtCursor(value, pos);
      const tokenLen = tokenInfo.token.length;

      const before = value.slice(0, pos - tokenLen);
      const after = value.slice(pos);
      const newValue = before + suggestion.insert + after;
      const newCursorPos = before.length + suggestion.insert.length;

      // No "ignore the echo" flag here: the editor reports only real input
      // events, so a flag set now would swallow the user's NEXT keystroke —
      // typing `.` straight after accepting `data` opened no field list.
      onChange(newValue);
      setShowSuggestions(false);
      setCursorToken({ prefix: "", token: "" });

      requestAnimationFrame(() => {
        textarea.focus();
        textarea.setSelectionRange(newCursorPos, newCursorPos);
      });
    },
    [value, onChange, getTokenAtCursor, getTextarea],
  );

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
      // Only the suggestion list closes: without stopping the event here, MUI's
      // Dialog treated the same keydown as escapeKeyDown and unmounted the
      // whole edit dialog, discarding the form.
      e.preventDefault();
      e.stopPropagation();
      setShowSuggestions(false);
    }
  };

  const lineCount = (value || "\n").split("\n").length;

  return (
    <Box sx={{ position: "relative" }} ref={containerRef}>
      <style>{HL_STYLES}</style>
      <Typography component="label" htmlFor={textareaId} variant="caption" sx={{ color: "text.secondary", mb: 0.5, display: "block" }}>
        {t("calculations.formula")}
      </Typography>
      <Box
        sx={{
          display: "flex",
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          bgcolor: "action.hover",
          overflow: "hidden",
          "&:focus-within": {
            borderColor: "primary.main",
            boxShadow: (t) => `0 0 0 1px ${t.palette.primary.main}`,
          },
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
            textareaId={textareaId}
            placeholder={t("calculations.formulaPlaceholder")}
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
              {t("calculations.insertHint")}
            </Typography>
          </Box>
        </Paper>
      </Popper>
    </Box>
  );
}
