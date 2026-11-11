/**
 * What can follow a signed decision, in one menu: revise it (a new revision
 * of the same decision), replace it with a new decision, or revoke it. The
 * last two open a NEW draft that already carries the `replaces` / `revokes`
 * link and the same linked cards; nothing changes until that draft is signed.
 */
import { useState } from "react";
import Button from "@mui/material/Button";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";

import { api } from "@/api/client";
import MaterialSymbol from "@/components/MaterialSymbol";
import { useSubmitOnce } from "@/hooks/useSubmitOnce";
import type { ArchitectureDecision, DecisionLinkKind, DecisionRef } from "@/types";
import { decisionHref } from "./DecisionBanners";
import { decisionRefLabel, type Translate } from "./decisionStanding";

type MenuAdr = Pick<
  ArchitectureDecision,
  | "id"
  | "reference_number"
  | "revision_number"
  | "title"
  | "status"
  | "standing"
  | "is_earlier_revision"
  | "open_revision"
  | "linked_cards"
>;

/** Why an action is not offered (a `delivery` key), or null when it is. */
export interface ReviseMenuState {
  revise: string | null;
  replace: string | null;
  revoke: string | null;
}

/** A decision another one revoked or replaced: its chain is closed. */
export function isClosed(adr: Pick<MenuAdr, "standing" | "is_earlier_revision">): boolean {
  if (adr.standing === "revoked") return true;
  return adr.standing === "superseded" && !adr.is_earlier_revision;
}

export function reviseMenuState(adr: MenuAdr, canManage: boolean): ReviseMenuState {
  let reason: string | null = null;
  if (!canManage) reason = "adr.revise.reasonNoPermission";
  else if (adr.is_earlier_revision) reason = "adr.revise.reasonEarlier";
  else if (isClosed(adr)) reason = "adr.revise.reasonClosed";
  return { revise: reason, replace: reason, revoke: reason };
}

/** The new draft "Replace" / "Revoke" creates (`POST /adr`). */
export function successorDraft(adr: MenuAdr, kind: "replaces" | "revokes", t: Translate) {
  const title =
    kind === "replaces"
      ? t("adr.revise.replaceTitle", { title: adr.title })
      : t("adr.revise.revokeTitle", { reference: decisionRefLabel(adr, t), title: adr.title });
  return {
    title,
    links: [{ decision_id: adr.id, kind: kind as DecisionLinkKind }],
    linked_card_ids: (adr.linked_cards ?? []).map((c) => c.id),
  };
}

export type ReviseFailure = { kind: "existing"; id: string } | { kind: "error"; message: string };

/**
 * What a refused revise means: an open revision to go to, or a message. The
 * 409 details are `{error: "open_revision_exists", revision_id}` and
 * `{error: "not_revisable", reason?: "not_latest", by?: ref}`.
 */
export function reviseFailure(err: unknown, t: Translate): ReviseFailure {
  const detail = (err as { detail?: unknown } | null)?.detail as
    | { error?: string; revision_id?: string; reason?: string; by?: DecisionRef }
    | undefined;
  if (detail?.error === "open_revision_exists" && detail.revision_id) {
    return { kind: "existing", id: detail.revision_id };
  }
  if (detail?.error === "not_revisable") {
    if (detail.by) {
      return { kind: "error", message: t("adr.revise.closedBy", { by: decisionRefLabel(detail.by, t) }) };
    }
    return { kind: "error", message: t("adr.revise.notLatest") };
  }
  return { kind: "error", message: t("adr.editor.error.reviseFailed") };
}

/**
 * Create a revision (`POST /adr/{id}/revise`) and say where to go. Shared by
 * the menu and the editor's "Create consolidated revision".
 */
export async function createRevision(
  adrId: string,
  body: { consolidates?: string[]; change_summary?: string },
  t: Translate,
): Promise<{ id: string; notice: string } | { error: string }> {
  try {
    const rev = await api.post<ArchitectureDecision>(`/adr/${adrId}/revise`, body);
    return { id: rev.id, notice: t("adr.editor.revised") };
  } catch (err) {
    const failure = reviseFailure(err, t);
    if (failure.kind === "existing") return { id: failure.id, notice: t("adr.revise.openRevisionExists") };
    return { error: failure.message };
  }
}

export interface ReviseMenuProps {
  adr: MenuAdr;
  canManage: boolean;
  onNotice: (message: string) => void;
  onError: (message: string) => void;
}

export default function ReviseMenu({ adr, canManage, onNotice, onError }: ReviseMenuProps) {
  const { t } = useTranslation("delivery");
  const navigate = useNavigate();
  const action = useSubmitOnce();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const state = reviseMenuState(adr, canManage);

  const go = (id: string, notice: string) => {
    navigate(decisionHref(id));
    onNotice(notice);
  };

  const revise = () =>
    action.run(async () => {
      setAnchor(null);
      if (adr.open_revision) {
        go(adr.open_revision.id, t("adr.revise.openRevisionExists"));
        return;
      }
      const out = await createRevision(adr.id, {}, t);
      if ("error" in out) onError(out.error);
      else go(out.id, out.notice);
    });

  const succeed = (kind: "replaces" | "revokes") =>
    action.run(async () => {
      setAnchor(null);
      try {
        const created = await api.post<ArchitectureDecision>("/adr", successorDraft(adr, kind, t));
        go(created.id, t("adr.revise.draftCreated"));
      } catch {
        onError(t("adr.revise.draftFailed"));
      }
    });

  const items = [
    {
      key: "revise",
      icon: "edit_note",
      label: adr.open_revision
        ? t("adr.revise.openRevision", { revision: decisionRefLabel(adr.open_revision, t) })
        : t("adr.revise.revise"),
      hint: t("adr.revise.reviseHint"),
      reason: state.revise,
      onClick: revise,
    },
    {
      key: "replace",
      icon: "swap_horiz",
      label: t("adr.revise.replace"),
      hint: t("adr.revise.replaceHint"),
      reason: state.replace,
      onClick: () => succeed("replaces"),
    },
    {
      key: "revoke",
      icon: "block",
      label: t("adr.revise.revoke"),
      hint: t("adr.revise.revokeHint"),
      reason: state.revoke,
      onClick: () => succeed("revokes"),
    },
  ];

  return (
    <>
      <Button
        variant="outlined"
        startIcon={<MaterialSymbol icon="edit_note" size={18} />}
        endIcon={<MaterialSymbol icon="arrow_drop_down" size={18} />}
        onClick={(e) => setAnchor(e.currentTarget)}
        disabled={action.busy}
        aria-haspopup="menu"
        sx={{ textTransform: "none" }}
      >
        {t("adr.revise.menu")}
      </Button>
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {items.map((item) => (
          <MenuItem
            key={item.key}
            data-testid={`revise-${item.key}`}
            disabled={item.reason !== null}
            onClick={item.onClick}
          >
            <ListItemIcon>
              <MaterialSymbol icon={item.icon} size={20} />
            </ListItemIcon>
            <ListItemText
              primary={item.label}
              secondary={item.reason ? t(item.reason) : item.hint}
            />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
