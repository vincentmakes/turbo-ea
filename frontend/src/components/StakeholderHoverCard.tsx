import { useCallback, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Popover from "@mui/material/Popover";
import Typography from "@mui/material/Typography";
import { api, ApiError } from "@/api/client";
import { useResolveLabel } from "@/hooks/useResolveLabel";
import type { Card as CardType, TranslationMap } from "@/types";

interface RoleDescriptor {
  key: string;
  label: string;
  color: string;
  translations: TranslationMap;
}

interface StakeholderResponse {
  items: CardType[];
  roles_by_card_id: Record<string, RoleDescriptor[]>;
}

interface RoleGroup {
  role: RoleDescriptor;
  cards: CardType[];
}

/** Module-level cache so repeated hovers (the same user across many rows) only
 * fetch once per page session. Keyed by user id; stores the in-flight or
 * settled promise. Errors are also cached so a 403 doesn't refire on every
 * hover. */
const cache = new Map<string, Promise<StakeholderResponse | null>>();

function fetchPortfolio(userId: string): Promise<StakeholderResponse | null> {
  const cached = cache.get(userId);
  if (cached) return cached;
  const promise = api
    .get<StakeholderResponse>(
      `/cards/my-stakeholder?user_id=${encodeURIComponent(userId)}`,
    )
    .catch((err: unknown) => {
      // Swallow permission errors silently — the wrapper just shows "no roles".
      if (err instanceof ApiError && (err.status === 403 || err.status === 404)) {
        return null;
      }
      throw err;
    });
  cache.set(userId, promise);
  return promise;
}

const MAX_CARDS_PER_ROLE = 3;
const OPEN_DELAY_MS = 400;
const CLOSE_DELAY_MS = 150;

interface Props {
  userId: string;
  userName?: string;
  /** Defaults to inline-block so the wrapper sits flush with surrounding
   * text. AG Grid cells override to "block". */
  display?: "inline-block" | "block" | "inline-flex";
  children: ReactNode;
}

export default function StakeholderHoverCard({
  userId,
  userName,
  display = "inline-block",
  children,
}: Props) {
  const { t } = useTranslation("common");
  const navigate = useNavigate();
  const rl = useResolveLabel();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [data, setData] = useState<StakeholderResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const openTimer = useRef<number | undefined>(undefined);
  const closeTimer = useRef<number | undefined>(undefined);

  const open = useCallback(
    (el: HTMLElement) => {
      window.clearTimeout(closeTimer.current);
      openTimer.current = window.setTimeout(() => {
        setAnchor(el);
        setLoading(true);
        fetchPortfolio(userId)
          .then((res) => setData(res))
          .finally(() => setLoading(false));
      }, OPEN_DELAY_MS);
    },
    [userId],
  );

  const scheduleClose = useCallback(() => {
    window.clearTimeout(openTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setAnchor(null);
    }, CLOSE_DELAY_MS);
  }, []);

  const cancelClose = useCallback(() => {
    window.clearTimeout(closeTimer.current);
  }, []);

  const groups: RoleGroup[] = (() => {
    if (!data) return [];
    const buckets = new Map<string, RoleGroup>();
    for (const card of data.items) {
      for (const role of data.roles_by_card_id[card.id] || []) {
        const existing = buckets.get(role.key);
        if (existing) existing.cards.push(card);
        else buckets.set(role.key, { role, cards: [card] });
      }
    }
    return Array.from(buckets.values()).sort(
      (a, b) => b.cards.length - a.cards.length,
    );
  })();

  return (
    <>
      <Box
        component="span"
        sx={{ display, cursor: "default" }}
        onMouseEnter={(e) => open(e.currentTarget as HTMLElement)}
        onMouseLeave={scheduleClose}
      >
        {children}
      </Box>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        disableRestoreFocus
        sx={{ pointerEvents: "none" }}
        slotProps={{
          paper: {
            sx: { pointerEvents: "auto", maxWidth: 360, minWidth: 280, p: 1.5 },
            onMouseEnter: cancelClose,
            onMouseLeave: scheduleClose,
          },
        }}
      >
        {userName && (
          <Typography variant="subtitle2" fontWeight={600} sx={{ mb: 0.5 }}>
            {userName}
          </Typography>
        )}
        {loading && <LinearProgress sx={{ mb: 1 }} />}
        {!loading && groups.length === 0 && (
          <Typography variant="caption" color="text.secondary">
            {t("stakeholders.hover.noRoles")}
          </Typography>
        )}
        {!loading && groups.length > 0 && (
          <Box>
            {groups.map(({ role, cards }) => {
              const visible = cards.slice(0, MAX_CARDS_PER_ROLE);
              const overflow = cards.length - visible.length;
              return (
                <Box key={role.key} sx={{ mb: 1, "&:last-of-type": { mb: 0 } }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.25 }}>
                    <Box
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        bgcolor: role.color,
                        flexShrink: 0,
                      }}
                    />
                    <Typography
                      variant="caption"
                      sx={{
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: 0.4,
                        fontSize: "0.65rem",
                        color: "text.secondary",
                      }}
                    >
                      {rl(role.label, role.translations)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.65rem" }}>
                      ({cards.length})
                    </Typography>
                  </Box>
                  {visible.map((card) => (
                    <Box
                      key={`${role.key}-${card.id}`}
                      sx={{
                        py: 0.25,
                        px: 0.75,
                        cursor: "pointer",
                        borderRadius: 0.5,
                        "&:hover": { bgcolor: "action.hover" },
                      }}
                      onClick={() => {
                        setAnchor(null);
                        navigate(`/cards/${card.id}`);
                      }}
                    >
                      <Typography variant="body2" sx={{ fontSize: "0.78rem" }} noWrap>
                        {card.name}
                      </Typography>
                    </Box>
                  ))}
                  {overflow > 0 && (
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      sx={{ pl: 0.75, fontSize: "0.65rem", display: "block" }}
                    >
                      {t("dashboard.workspace.andMore", { count: overflow })}
                    </Typography>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
      </Popover>
    </>
  );
}

/** Test-only: wipe the per-user portfolio cache between test cases. */
export function _resetStakeholderHoverCache() {
  cache.clear();
}
