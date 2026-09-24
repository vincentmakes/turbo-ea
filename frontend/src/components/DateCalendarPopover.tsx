import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Box, Button, ButtonBase, IconButton, Popover, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useIsRtl } from "@/hooks/useIsRtl";
import {
  addDays,
  addMonths,
  dayNumber,
  firstDayOfWeek,
  fullDateLabel,
  isValidIso,
  monthGrid,
  monthTitle,
  outOfRange,
  todayIso,
  weekdayLabels,
  yearMonthOf,
} from "@/lib/calendarGrid";

export interface DateCalendarPopoverProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  /** ISO date, or `""` when empty. */
  value: string;
  /** Locale whose week data decides the first day of the week. */
  weekLocale: string;
  min?: string;
  max?: string;
  onSelect: (iso: string) => void;
  /** Present only when the field can be cleared. */
  onClear?: () => void;
  onClose: () => void;
}

const CELL = 36;
const YEAR_SPAN = 100;

/**
 * The themed calendar DateField opens on WebKit (#1142), whose native date
 * popover is drawn by macOS / iOS, cannot be styled and renders tiny. Built
 * only from MUI parts so it follows the theme (light / dark / RTL); every
 * locale-dependent piece — names, first weekday, digits — comes from `Intl`
 * via `lib/calendarGrid.ts`. Chrome and Firefox never render it: they keep
 * their own native picker.
 */
export default function DateCalendarPopover({
  open,
  anchorEl,
  value,
  weekLocale,
  min,
  max,
  onSelect,
  onClear,
  onClose,
}: DateCalendarPopoverProps) {
  const { t, i18n } = useTranslation("common");
  const isRtl = useIsRtl();
  const lang = i18n.language;
  const today = todayIso();
  const selected = isValidIso(value) ? value : "";

  const [focusDay, setFocusDay] = useState(selected || today);
  const [yearMode, setYearMode] = useState(false);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const moveFocus = useRef(false);

  // Each opening starts on the month of the value (or today's).
  useEffect(() => {
    if (open) {
      setFocusDay(selected || today);
      setYearMode(false);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const firstDay = useMemo(() => firstDayOfWeek(weekLocale), [weekLocale]);
  const labels = useMemo(() => weekdayLabels(lang, firstDay), [lang, firstDay]);
  const { year, month } = yearMonthOf(focusDay);
  const days = useMemo(() => monthGrid(year, month, firstDay), [year, month, firstDay]);

  // Keyboard moves the roving focus; follow it with DOM focus.
  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current
      ?.querySelector<HTMLElement>(`[data-iso="${focusDay}"]`)
      ?.focus();
  }, [focusDay]);

  const go = (iso: string) => {
    moveFocus.current = true;
    setFocusDay(iso);
  };

  const pick = (iso: string) => {
    if (outOfRange(iso, min, max)) return;
    onSelect(iso);
  };

  const onGridKey = (e: KeyboardEvent) => {
    const back = isRtl ? 1 : -1;
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focusDay, back),
      ArrowRight: () => addDays(focusDay, -back),
      ArrowUp: () => addDays(focusDay, -7),
      ArrowDown: () => addDays(focusDay, 7),
      PageUp: () => addMonths(focusDay, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focusDay, e.shiftKey ? 12 : 1),
      Home: () => addDays(focusDay, -((days.indexOf(focusDay) % 7 + 7) % 7)),
      End: () => addDays(focusDay, 6 - ((days.indexOf(focusDay) % 7 + 7) % 7)),
    };
    const move = moves[e.key];
    if (move) {
      e.preventDefault();
      go(move());
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(focusDay);
    }
  };

  const years = useMemo(() => {
    const current = Number(today.slice(0, 4));
    return Array.from({ length: YEAR_SPAN * 2 + 1 }, (_, i) => current - YEAR_SPAN + i);
  }, [today]);

  const prevIcon = isRtl ? "chevron_right" : "chevron_left";
  const nextIcon = isRtl ? "chevron_left" : "chevron_right";

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      disableRestoreFocus
      TransitionProps={{
        // Land keyboard focus on the selected (or today's) day.
        onEntered: () =>
          gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus(),
      }}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      transformOrigin={{ vertical: "top", horizontal: "left" }}
      slotProps={{
        paper: {
          role: "dialog",
          "aria-label": t("dateField.calendar"),
          sx: { p: 1.5, width: CELL * 7 + 24 },
        },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", mb: 1 }}>
        <Button
          size="small"
          color="inherit"
          onClick={() => setYearMode((v) => !v)}
          aria-label={t("dateField.chooseYear")}
          aria-expanded={yearMode}
          endIcon={<MaterialSymbol icon={yearMode ? "arrow_drop_up" : "arrow_drop_down"} size={20} />}
          sx={{ textTransform: "none", fontWeight: 600, fontSize: "0.95rem", px: 1 }}
        >
          {monthTitle(lang, year, month)}
        </Button>
        <Box sx={{ flex: 1 }} />
        {!yearMode && (
          <>
            <IconButton
              size="small"
              aria-label={t("dateField.previousMonth")}
              onClick={() => setFocusDay(addMonths(focusDay, -1))}
            >
              <MaterialSymbol icon={prevIcon} size={20} />
            </IconButton>
            <IconButton
              size="small"
              aria-label={t("dateField.nextMonth")}
              onClick={() => setFocusDay(addMonths(focusDay, 1))}
            >
              <MaterialSymbol icon={nextIcon} size={20} />
            </IconButton>
          </>
        )}
      </Box>

      {yearMode ? (
        <Box
          role="listbox"
          aria-label={t("dateField.chooseYear")}
          sx={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 0.5,
            height: CELL * 7,
            overflowY: "auto",
          }}
          ref={(el: HTMLDivElement | null) => {
            el?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView?.({
              block: "center",
            });
          }}
        >
          {years.map((y) => (
            <ButtonBase
              key={y}
              role="option"
              aria-selected={y === year}
              onClick={() => {
                setFocusDay(addMonths(focusDay, (y - year) * 12));
                setYearMode(false);
              }}
              sx={{
                height: 32,
                borderRadius: 4,
                typography: "body2",
                ...(y === year && {
                  bgcolor: "primary.main",
                  color: "primary.contrastText",
                }),
                "&:hover": { bgcolor: y === year ? "primary.dark" : "action.hover" },
              }}
            >
              {new Intl.NumberFormat(lang, { useGrouping: false }).format(y)}
            </ButtonBase>
          ))}
        </Box>
      ) : (
        <Box role="grid" aria-label={monthTitle(lang, year, month)} ref={gridRef} onKeyDown={onGridKey}>
          <Box role="row" sx={{ display: "grid", gridTemplateColumns: `repeat(7, ${CELL}px)` }}>
            {labels.map((l) => (
              <Typography
                key={l.long}
                role="columnheader"
                aria-label={l.long}
                variant="caption"
                color="text.secondary"
                sx={{ textAlign: "center", lineHeight: `${CELL - 8}px` }}
              >
                {l.short}
              </Typography>
            ))}
          </Box>
          {Array.from({ length: 6 }, (_, row) => (
            <Box
              key={row}
              role="row"
              sx={{ display: "grid", gridTemplateColumns: `repeat(7, ${CELL}px)` }}
            >
              {days.slice(row * 7, row * 7 + 7).map((iso) => {
                const inMonth = yearMonthOf(iso).month === month;
                const isSelected = iso === selected;
                const isToday = iso === today;
                const disabled = outOfRange(iso, min, max);
                return (
                  <Box key={iso} role="gridcell" aria-selected={isSelected} sx={{ p: "2px" }}>
                    <ButtonBase
                      data-iso={iso}
                      tabIndex={iso === focusDay ? 0 : -1}
                      disabled={disabled}
                      aria-label={fullDateLabel(lang, iso)}
                      aria-current={isToday ? "date" : undefined}
                      onClick={() => pick(iso)}
                      onFocus={() => iso !== focusDay && setFocusDay(iso)}
                      sx={{
                        width: CELL - 4,
                        height: CELL - 4,
                        borderRadius: "50%",
                        typography: "body2",
                        color: inMonth ? "text.primary" : "text.disabled",
                        border: 1,
                        borderColor: isToday && !isSelected ? "primary.main" : "transparent",
                        "&:hover": { bgcolor: "action.hover" },
                        "&.Mui-focusVisible": { outline: 2, outlineColor: "primary.main" },
                        "&.Mui-disabled": { color: "text.disabled", opacity: 0.5 },
                        ...(isSelected && {
                          bgcolor: "primary.main",
                          color: "primary.contrastText",
                          fontWeight: 600,
                          "&:hover": { bgcolor: "primary.dark" },
                        }),
                      }}
                    >
                      {dayNumber(lang, iso)}
                    </ButtonBase>
                  </Box>
                );
              })}
            </Box>
          ))}
        </Box>
      )}

      <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1 }}>
        {onClear ? (
          <Button size="small" onClick={onClear}>
            {t("dateField.clear")}
          </Button>
        ) : (
          <span />
        )}
        <Button size="small" disabled={outOfRange(today, min, max)} onClick={() => pick(today)}>
          {t("dateField.today")}
        </Button>
      </Box>
    </Popover>
  );
}
