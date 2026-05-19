import { forwardRef, useImperativeHandle, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import TagPicker from "@/components/TagPicker";
import type { TagGroup, TagRef } from "@/types";

interface Params {
  value: TagRef[] | undefined;
  groups: TagGroup[];
  typeKey?: string;
  stopEditing?: (cancel?: boolean) => void;
}

const TagsCellEditor = forwardRef<{ getValue: () => TagRef[] }, Params>(
  (props, ref) => {
    const initialIds = useMemo(
      () => (props.value || []).map((t) => t.id),
      [props.value],
    );
    const [ids, setIds] = useState<string[]>(initialIds);

    const refsById = useMemo(() => {
      const map = new Map<string, TagRef>();
      for (const g of props.groups) {
        for (const t of g.tags) {
          map.set(t.id, {
            id: t.id,
            name: t.name,
            color: t.color,
            group_name: g.name,
          });
        }
      }
      return map;
    }, [props.groups]);

    useImperativeHandle(ref, () => ({
      getValue: () =>
        ids
          .map((id) => refsById.get(id))
          .filter((tag): tag is TagRef => Boolean(tag)),
    }));

    return (
      <Box sx={{ p: 1, minWidth: 320, bgcolor: "background.paper" }}>
        <TagPicker
          groups={props.groups}
          value={ids}
          onChange={setIds}
          typeKey={props.typeKey}
          size="small"
        />
      </Box>
    );
  },
);

TagsCellEditor.displayName = "TagsCellEditor";

export default TagsCellEditor;
