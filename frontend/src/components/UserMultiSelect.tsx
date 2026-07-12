/**
 * Shared multi-select user picker — an MUI Autocomplete with chips over
 * `GET /users` (the least-privilege lite payload for non-admins), browse-on-open
 * with client-side filtering. Generalizes the owner/signatory picker pattern
 * used across the app (SignatureRequestDialog, MitigationTaskDialog, …) into a
 * reusable component; also exposed to UI extensions on `window.TurboEA.sdk`
 * (SDK 1.8) so they never hand-roll a weaker user picker.
 *
 * The user list is cached module-wide with an inflight-promise guard so several
 * pickers mounting in the same tick share one request.
 */

import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import { useEffect, useMemo, useState } from "react";

import { api } from "@/api/client";

export interface UserOption {
  id: string;
  display_name: string;
  email: string;
}

let _cache: UserOption[] | null = null;
let _inflight: Promise<UserOption[]> | null = null;

function fetchUsers(): Promise<UserOption[]> {
  if (_cache) return Promise.resolve(_cache);
  if (_inflight) return _inflight;
  _inflight = api
    .get<UserOption[]>("/users")
    .then((users) => {
      _cache = users;
      return users;
    })
    .finally(() => {
      _inflight = null;
    });
  return _inflight;
}

/** Test helper / cache bust after user admin changes. */
export function invalidateUserOptions(): void {
  _cache = null;
}

interface Props {
  value: UserOption[];
  onChange: (users: UserOption[]) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  size?: "small" | "medium";
  excludeIds?: string[];
}

export default function UserMultiSelect({
  value,
  onChange,
  label,
  placeholder,
  disabled = false,
  size = "small",
  excludeIds,
}: Props) {
  const [options, setOptions] = useState<UserOption[]>(_cache ?? []);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open || _cache) return;
    let cancelled = false;
    setLoading(true);
    fetchUsers()
      .then((users) => {
        if (!cancelled) setOptions(users);
      })
      .catch(() => {
        /* leave empty — picker degrades to no suggestions */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const visibleOptions = useMemo(() => {
    if (!excludeIds?.length) return options;
    const excluded = new Set(excludeIds);
    return options.filter((u) => !excluded.has(u.id));
  }, [options, excludeIds]);

  return (
    <Autocomplete
      multiple
      size={size}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      options={visibleOptions}
      loading={loading}
      disabled={disabled}
      value={value}
      onChange={(_, next) => onChange(next)}
      getOptionLabel={(u) => u.display_name || u.email}
      isOptionEqualToValue={(a, b) => a.id === b.id}
      filterOptions={(opts, state) => {
        const q = state.inputValue.trim().toLowerCase();
        if (!q) return opts;
        return opts.filter(
          (u) =>
            u.display_name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
        );
      }}
      renderOption={(props, u) => (
        <li {...props} key={u.id}>
          <ListItemText primary={u.display_name} secondary={u.email} />
        </li>
      )}
      renderTags={(selected, getTagProps) =>
        selected.map((u, index) => (
          <Chip
            {...getTagProps({ index })}
            key={u.id}
            label={u.display_name || u.email}
            size="small"
          />
        ))
      }
      renderInput={(params) => (
        <TextField {...params} label={label} placeholder={placeholder} />
      )}
    />
  );
}
