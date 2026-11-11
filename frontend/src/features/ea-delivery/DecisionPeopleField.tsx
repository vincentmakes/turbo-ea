/**
 * Decision makers / participants of a decision: each entry is a Turbo EA user
 * or a free-text name (someone outside the tool). An MUI `Autocomplete` in
 * `multiple freeSolo` mode over the cached user list `UserMultiSelect` shares.
 *
 * A typed name that matches exactly one user's display name (ignoring case)
 * becomes that user; the same person never appears twice.
 */
import { useEffect, useMemo, useState } from "react";
import Autocomplete from "@mui/material/Autocomplete";
import Box from "@mui/material/Box";
import Chip from "@mui/material/Chip";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { useTranslation } from "react-i18next";

import MaterialSymbol from "@/components/MaterialSymbol";
import {
  cachedUserOptions,
  fetchUserOptions,
  type UserOption,
} from "@/components/UserMultiSelect";
import { cardSearchRank, compareByRank } from "@/lib/searchRank";
import type { DecisionPerson, DecisionPersonInput } from "@/types";

export type DecisionPeoplePart = "decision_makers" | "participants";

export const PEOPLE_LABEL_KEYS: Record<DecisionPeoplePart, string> = {
  decision_makers: "adr.people.decisionMakers",
  participants: "adr.people.participants",
};

function personKey(p: DecisionPerson): string {
  return p.user_id ? `u:${p.user_id}` : `n:${p.display_name.trim().toLowerCase()}`;
}

/** The user id behind an Autocomplete entry; null for free text. MUI also
 *  hands a typed string to `isOptionEqualToValue` in free-solo mode. */
export function entryUserId(entry: UserOption | DecisionPerson | string): string | null {
  if (typeof entry === "string") return null;
  if ("email" in entry) return entry.id;
  return entry.user_id;
}

/** A typed name → the one user it names exactly, else a free-text person. */
export function resolveTypedName(name: string, users: UserOption[]): DecisionPerson | null {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const matches = users.filter((u) => u.display_name.trim().toLowerCase() === lower);
  if (matches.length === 1) {
    return { user_id: matches[0].id, display_name: matches[0].display_name };
  }
  return { user_id: null, display_name: trimmed };
}

/**
 * The field's next value from what the Autocomplete hands back: strings
 * (typed) are resolved, users kept, empty entries dropped and duplicates
 * collapsed (first one wins, order kept).
 */
export function normalizePeople(
  entries: (DecisionPerson | UserOption | string)[],
  users: UserOption[],
): DecisionPerson[] {
  const out: DecisionPerson[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    let person: DecisionPerson | null;
    if (typeof entry === "string") person = resolveTypedName(entry, users);
    else if ("email" in entry) person = { user_id: entry.id, display_name: entry.display_name };
    else if (entry.user_id) person = entry;
    else person = resolveTypedName(entry.display_name, users);
    if (!person) continue;
    const key = personKey(person);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(person);
  }
  return out;
}

/** The write payload (`decision_makers` / `participants`) for a value. */
export function peoplePayload(people: DecisionPerson[]): DecisionPersonInput[] {
  return people.map((p) => (p.user_id ? { user_id: p.user_id } : { name: p.display_name }));
}

function PersonChip({
  person,
  freeTextHint,
  ...chipProps
}: {
  person: DecisionPerson;
  freeTextHint: string;
} & React.ComponentProps<typeof Chip>) {
  const chip = (
    <Chip
      {...chipProps}
      size="small"
      label={person.display_name}
      variant={person.user_id ? "filled" : "outlined"}
      icon={
        person.user_id ? (
          <MaterialSymbol icon="person" size={16} />
        ) : (
          <MaterialSymbol icon="edit_note" size={16} />
        )
      }
    />
  );
  if (person.user_id) return chip;
  return (
    <Tooltip title={freeTextHint} arrow>
      {chip}
    </Tooltip>
  );
}

export interface DecisionPeopleFieldProps {
  value: DecisionPerson[];
  onChange?: (people: DecisionPerson[]) => void;
  /** Which list this is: picks the default label. */
  part: DecisionPeoplePart;
  /** Overrides the default label. */
  label?: string;
  placeholder?: string;
  helperText?: string;
  /** Chips only, no input (a locked decision, the preview). */
  readOnly?: boolean;
  disabled?: boolean;
  size?: "small" | "medium";
  disablePortal?: boolean;
}

export default function DecisionPeopleField({
  value,
  onChange,
  part,
  label,
  placeholder,
  helperText,
  readOnly = false,
  disabled = false,
  size = "small",
  disablePortal = false,
}: DecisionPeopleFieldProps) {
  const { t } = useTranslation("delivery");
  const fieldLabel = label ?? t(PEOPLE_LABEL_KEYS[part]);
  const freeTextHint = t("adr.people.freeText");

  const [users, setUsers] = useState<UserOption[]>(() => cachedUserOptions() ?? []);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (readOnly || !open) return;
    // Another picker may have filled the cache since this one mounted.
    const cached = cachedUserOptions();
    if (cached) {
      setUsers(cached);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchUserOptions()
      .then((list) => {
        if (!cancelled) setUsers(list);
      })
      .catch(() => {
        /* no suggestions: free text still works */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, readOnly]);

  const selectedUserIds = useMemo(
    () => new Set(value.map((p) => p.user_id).filter((id): id is string => Boolean(id))),
    [value],
  );

  if (readOnly) {
    return (
      <Box>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 0.5 }}>
          {fieldLabel}
        </Typography>
        {value.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {t("adr.people.none")}
          </Typography>
        ) : (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
            {value.map((p) => (
              <PersonChip key={personKey(p)} person={p} freeTextHint={freeTextHint} />
            ))}
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Autocomplete<UserOption | DecisionPerson, true, false, true>
      multiple
      freeSolo
      size={size}
      disablePortal={disablePortal}
      disabled={disabled}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      loading={loading}
      options={users.filter((u) => !selectedUserIds.has(u.id))}
      value={value}
      onChange={(_, next) => onChange?.(normalizePeople(next, users))}
      getOptionLabel={(o) => (typeof o === "string" ? o : o.display_name)}
      isOptionEqualToValue={(a, b) => {
        const aId = entryUserId(a);
        return aId !== null && aId === entryUserId(b);
      }}
      filterOptions={(opts, state) => {
        const q = state.inputValue.trim();
        const list = opts as UserOption[];
        if (!q) return list;
        const rank = (u: UserOption) => ({ name: u.display_name, alias: u.email });
        const cmp = compareByRank(q);
        return list
          .filter((u) => cardSearchRank(rank(u), q) >= 0)
          .sort((a, b) => cmp(rank(a), rank(b)));
      }}
      renderOption={(liProps, o) => {
        const u = o as UserOption;
        return (
          <li {...liProps} key={u.id}>
            <ListItemText primary={u.display_name} secondary={u.email} />
          </li>
        );
      }}
      renderTags={(selected, getTagProps) =>
        selected.map((entry, index) => {
          const { key, ...tagProps } = getTagProps({ index });
          const person: DecisionPerson =
            "email" in entry ? { user_id: entry.id, display_name: entry.display_name } : entry;
          return (
            <PersonChip key={key} person={person} freeTextHint={freeTextHint} {...tagProps} />
          );
        })
      }
      renderInput={(params) => (
        <TextField
          {...params}
          label={fieldLabel}
          placeholder={placeholder ?? t("adr.people.placeholder")}
          helperText={helperText}
        />
      )}
    />
  );
}
