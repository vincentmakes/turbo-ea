/**
 * Curated list of Material Symbols icons useful for an EA platform.
 * Organised by category for browsing in the IconPicker, flattened for search.
 *
 * This is the single source of truth for the selectable card-type icon set.
 * It is consumed by:
 *   - `IconPicker.tsx` (the metamodel admin icon picker)
 *   - `scripts/gen-diagram-icon-paths.mjs` (bakes SVG path data for these names
 *     into `features/diagrams/iconPaths.ts` so the icons can be drawn onto
 *     DrawIO diagram shapes — see that file for the rationale).
 *
 * When adding a name here, regenerate the diagram icon paths with
 * `npm run gen:diagram-icons` so the new icon also shows up on diagrams.
 */
export const ICON_CATEGORIES: { labelKey: string; icons: string[] }[] = [
  {
    labelKey: "common",
    icons: [
      "home", "search", "settings", "info", "help", "check_circle",
      "cancel", "add_circle", "remove_circle", "star", "favorite",
      "visibility", "visibility_off", "lock", "lock_open", "delete",
      "edit", "save", "close", "done", "clear", "refresh", "sync",
      "schedule", "alarm", "bookmark", "flag", "label", "push_pin",
    ],
  },
  {
    labelKey: "businessStrategy",
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
    labelKey: "organizationPeople",
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
    labelKey: "architectureStructure",
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
    labelKey: "technologyCloud",
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
    labelKey: "dataAnalytics",
    icons: [
      "equalizer", "stacked_bar_chart", "waterfall_chart", "candlestick_chart",
      "bubble_chart", "scatter_plot", "ssid_chart", "area_chart",
      "donut_small", "data_usage", "dynamic_form", "functions",
      "calculate", "filter_alt", "sort", "tune",
      "science", "biotech", "experiment",
    ],
  },
  {
    labelKey: "securityCompliance",
    icons: [
      "security", "shield", "gpp_good", "gpp_bad", "gpp_maybe",
      "health_and_safety", "privacy_tip", "policy", "verified_user",
      "fingerprint", "key", "vpn_key", "password", "encrypted",
      "admin_panel_settings", "rule", "gavel", "balance",
    ],
  },
  {
    labelKey: "communication",
    icons: [
      "mail", "email", "send", "forum", "chat", "chat_bubble",
      "comment", "message", "sms", "notifications", "campaign",
      "announcement", "feedback", "rate_review", "reviews",
      "connect_without_contact", "share", "public", "language",
      "translate", "rss_feed", "podcasts",
    ],
  },
  {
    labelKey: "filesDocuments",
    icons: [
      "description", "article", "note", "sticky_note_2",
      "folder", "folder_open", "folder_shared", "create_new_folder",
      "file_copy", "file_present", "attachment", "link",
      "picture_as_pdf", "text_snippet", "source", "topic",
      "inventory_2", "archive", "unarchive",
    ],
  },
  {
    labelKey: "navigationMaps",
    icons: [
      "explore", "map", "place", "location_on", "my_location",
      "near_me", "navigation", "directions", "compass_calibration",
      "public", "travel_explore", "language",
      "flight_takeoff", "flight_land", "terrain",
    ],
  },
  {
    labelKey: "processesWorkflow",
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
    labelKey: "statusIndicators",
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
    labelKey: "miscellaneous",
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

/** Flat, de-duplicated list of every selectable icon name. */
export const ICON_NAMES: string[] = Array.from(
  new Set(ICON_CATEGORIES.flatMap((c) => c.icons)),
);
