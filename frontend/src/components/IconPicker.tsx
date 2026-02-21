import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import Box from "@mui/material/Box";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Tooltip from "@mui/material/Tooltip";
import MaterialSymbol from "./MaterialSymbol";

/**
 * Curated list of Material Symbols icons useful for an EA platform.
 * Organised by category for browsing, flattened for search.
 */
const ICON_CATEGORIES: { label: string; icons: string[] }[] = [
  {
    label: "Common",
    icons: [
      "home", "search", "settings", "info", "help", "check_circle",
      "cancel", "add_circle", "remove_circle", "star", "favorite",
      "visibility", "visibility_off", "lock", "lock_open", "delete",
      "edit", "save", "close", "done", "clear", "refresh", "sync",
      "schedule", "alarm", "bookmark", "flag", "label", "push_pin",
    ],
  },
  {
    label: "Business & Strategy",
    icons: [
      "rocket_launch", "trending_up", "trending_down", "analytics",
      "insights", "query_stats", "monitoring", "assessment", "leaderboard",
      "bar_chart", "pie_chart", "show_chart", "timeline", "speed",
      "target", "track_changes", "fact_check", "checklist", "task_alt",
      "workspace_premium", "emoji_events", "military_tech", "verified",
      "lightbulb", "tips_and_updates", "auto_awesome", "new_releases",
      "campaign", "branding_watermark", "storefront", "store",
      "shopping_cart", "payments", "account_balance", "savings",
      "currency_exchange", "toll", "receipt_long", "request_quote",
      "paid", "monetization_on", "attach_money", "price_check",
    ],
  },
  {
    label: "Organization & People",
    icons: [
      "corporate_fare", "business", "domain", "apartment", "location_city",
      "groups", "group", "person", "person_add", "people",
      "badge", "contact_mail", "contacts", "supervised_user_circle",
      "manage_accounts", "admin_panel_settings", "shield_person",
      "diversity_1", "diversity_2", "diversity_3", "handshake",
      "support_agent", "engineering", "school", "work", "work_history",
      "meeting_room", "chair", "desk",
    ],
  },
  {
    label: "Architecture & Structure",
    icons: [
      "account_tree", "hub", "schema", "device_hub", "mediation",
      "lan", "share", "route", "fork_right", "fork_left",
      "alt_route", "merge", "call_split", "call_merge",
      "layers", "stacks", "view_module", "view_quilt", "dashboard",
      "grid_view", "view_list", "view_agenda", "view_kanban",
      "view_column", "view_comfy", "view_compact", "view_cozy",
      "table_chart", "pivot_table_chart", "dataset",
    ],
  },
  {
    label: "Technology & Cloud",
    icons: [
      "apps", "memory", "developer_board", "dns", "storage",
      "database", "cloud", "cloud_upload", "cloud_download", "cloud_sync",
      "cloud_done", "backup", "terminal", "code", "data_object",
      "integration_instructions", "api", "webhook", "http",
      "computer", "desktop_windows", "laptop", "smartphone", "tablet",
      "monitor", "tv", "devices", "developer_mode",
      "smart_toy", "robot", "neurology", "psychology",
      "precision_manufacturing", "bolt", "electric_bolt",
      "construction", "build", "handyman", "memory_alt",
    ],
  },
  {
    label: "Data & Analytics",
    icons: [
      "equalizer", "stacked_bar_chart", "waterfall_chart", "candlestick_chart",
      "bubble_chart", "scatter_plot", "ssid_chart", "area_chart",
      "donut_small", "data_usage", "dynamic_form", "functions",
      "calculate", "filter_alt", "sort", "tune",
      "science", "biotech", "experiment",
    ],
  },
  {
    label: "Security & Compliance",
    icons: [
      "security", "shield", "gpp_good", "gpp_bad", "gpp_maybe",
      "health_and_safety", "privacy_tip", "policy", "verified_user",
      "fingerprint", "key", "vpn_key", "password", "encrypted",
      "admin_panel_settings", "rule", "gavel", "balance",
    ],
  },
  {
    label: "Communication",
    icons: [
      "mail", "email", "send", "forum", "chat", "chat_bubble",
      "comment", "message", "sms", "notifications", "campaign",
      "announcement", "feedback", "rate_review", "reviews",
      "connect_without_contact", "share", "public", "language",
      "translate", "rss_feed", "podcasts",
    ],
  },
  {
    label: "Files & Documents",
    icons: [
      "description", "article", "note", "sticky_note_2",
      "folder", "folder_open", "folder_shared", "create_new_folder",
      "file_copy", "file_present", "attachment", "link",
      "picture_as_pdf", "text_snippet", "source", "topic",
      "inventory_2", "archive", "unarchive",
    ],
  },
  {
    label: "Navigation & Maps",
    icons: [
      "explore", "map", "place", "location_on", "my_location",
      "near_me", "navigation", "directions", "compass_calibration",
      "public", "travel_explore", "language",
      "flight_takeoff", "flight_land", "terrain",
    ],
  },
  {
    label: "Processes & Workflow",
    icons: [
      "swap_horiz", "swap_vert", "sync_alt", "compare_arrows",
      "transform", "autorenew", "loop", "replay", "redo", "undo",
      "published_with_changes", "move_down", "move_up",
      "input", "output", "start", "play_arrow", "pause",
      "stop", "skip_next", "skip_previous", "fast_forward",
      "pending", "hourglass_empty", "hourglass_full", "timer",
    ],
  },
  {
    label: "Status & Indicators",
    icons: [
      "error", "warning", "report", "report_problem",
      "do_not_disturb", "block", "dangerous", "crisis_alert",
      "priority_high", "low_priority", "notification_important",
      "new_releases", "fiber_new", "grade", "star_rate",
      "thumb_up", "thumb_down", "sentiment_satisfied",
      "sentiment_dissatisfied", "sentiment_neutral",
      "radio_button_checked", "radio_button_unchecked",
      "check_box", "check_box_outline_blank",
      "circle", "square", "hexagon", "pentagon",
      "change_history", "diamond",
    ],
  },
  {
    label: "Miscellaneous",
    icons: [
      "category", "extension", "widgets", "token",
      "interests", "palette", "brush", "color_lens",
      "image", "photo_camera", "videocam",
      "music_note", "headphones", "mic",
      "power", "power_settings_new", "battery_full",
      "wifi", "bluetooth", "usb", "cable",
      "eco", "park", "forest", "water_drop",
      "local_fire_department", "ac_unit", "thermostat",
      "fitness_center", "sports_esports", "casino",
      "celebration", "cake", "restaurant", "local_cafe",
      "flight", "directions_car", "directions_bus", "train",
      "sailing", "anchor", "rocket",
    ],
  },
];


interface IconPickerProps {
  value: string;
  onChange: (icon: string) => void;
  color?: string;
  disabled?: boolean;
}

export default function IconPicker({ value, onChange, color, disabled }: IconPickerProps) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [search, setSearch] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const open = Boolean(anchorEl);

  // Reset search when popover opens
  useEffect(() => {
    if (open) {
      setSearch("");
      // Focus the search field after popover renders
      setTimeout(() => searchRef.current?.focus(), 100);
    }
  }, [open]);

  const needle = search.toLowerCase().replace(/\s+/g, "_");

  const filteredCategories = useMemo(() => {
    if (!needle) return ICON_CATEGORIES;
    return ICON_CATEGORIES.map((cat) => ({
      ...cat,
      icons: cat.icons.filter((icon) => icon.includes(needle)),
    })).filter((cat) => cat.icons.length > 0);
  }, [needle]);

  const totalResults = useMemo(
    () => filteredCategories.reduce((sum, cat) => sum + cat.icons.length, 0),
    [filteredCategories],
  );

  const handleSelect = useCallback(
    (icon: string) => {
      onChange(icon);
      setAnchorEl(null);
    },
    [onChange],
  );

  return (
    <>
      {/* Trigger — icon preview + name */}
      <Box
        sx={{
          display: "flex",
          gap: 1.5,
          alignItems: "center",
          cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
          border: "1px solid",
          borderColor: "divider",
          borderRadius: 1,
          px: 1.5,
          py: 0.75,
          minHeight: 40,
          "&:hover": disabled
            ? {}
            : { borderColor: "text.primary" },
        }}
        onClick={(e) => {
          if (!disabled) setAnchorEl(e.currentTarget);
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: 1,
            bgcolor: color || "action.hover",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <MaterialSymbol icon={value} size={20} color={color ? "#fff" : undefined} />
        </Box>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 500 }} noWrap>
            {value.replace(/_/g, " ")}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {value}
          </Typography>
        </Box>
        <MaterialSymbol icon="expand_more" size={18} color="#999" />
      </Box>

      {/* Popover with search + icon grid */}
      <Popover
        open={open}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{
          paper: {
            sx: { width: 420, maxHeight: 480, display: "flex", flexDirection: "column" },
          },
        }}
      >
        {/* Search bar */}
        <Box sx={{ p: 1.5, pb: 1, flexShrink: 0 }}>
          <TextField
            inputRef={searchRef}
            size="small"
            fullWidth
            placeholder="Search icons..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <MaterialSymbol icon="search" size={18} color="#999" />
                  </InputAdornment>
                ),
              },
            }}
          />
          {search && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: "block" }}>
              {totalResults} result{totalResults !== 1 ? "s" : ""}
            </Typography>
          )}
        </Box>

        {/* Icon grid */}
        <Box sx={{ flex: 1, overflow: "auto", px: 1.5, pb: 1.5 }}>
          {filteredCategories.length === 0 ? (
            <Box sx={{ py: 4, textAlign: "center" }}>
              <MaterialSymbol icon="search_off" size={32} color="#ccc" />
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                No icons match "{search}"
              </Typography>
              <Typography variant="caption" color="text.secondary">
                Try typing the icon name directly — any valid Material Symbols name will work.
              </Typography>
            </Box>
          ) : (
            filteredCategories.map((cat) => (
              <Box key={cat.label} sx={{ mb: 1.5 }}>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{
                    display: "block",
                    mb: 0.5,
                    fontSize: "0.68rem",
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                    fontWeight: 600,
                  }}
                >
                  {cat.label}
                </Typography>
                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(48px, 1fr))",
                    gap: "2px",
                  }}
                >
                  {cat.icons.map((icon) => (
                    <Tooltip key={icon} title={icon.replace(/_/g, " ")} placement="top" arrow>
                      <Box
                        onClick={() => handleSelect(icon)}
                        sx={{
                          width: 48,
                          height: 48,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          borderRadius: 1,
                          cursor: "pointer",
                          border: icon === value ? "2px solid" : "1px solid transparent",
                          borderColor: icon === value ? "primary.main" : "transparent",
                          bgcolor: icon === value ? "primary.50" : "transparent",
                          transition: "all 0.1s",
                          "&:hover": {
                            bgcolor: icon === value ? "primary.100" : "action.hover",
                          },
                        }}
                      >
                        <MaterialSymbol icon={icon} size={24} />
                      </Box>
                    </Tooltip>
                  ))}
                </Box>
              </Box>
            ))
          )}
        </Box>
      </Popover>
    </>
  );
}
