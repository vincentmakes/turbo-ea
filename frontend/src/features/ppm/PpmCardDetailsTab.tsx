import { useCallback, useMemo } from "react";
import Box from "@mui/material/Box";
import ErrorBoundary from "@/components/ErrorBoundary";
import {
  DescriptionSection,
  AttributeSection,
  LifecycleSection,
} from "@/features/cards/sections";
import { useMetamodel } from "@/hooks/useMetamodel";
import { useCalculatedFields } from "@/hooks/useCalculatedFields";
import { useCurrency } from "@/hooks/useCurrency";
import { api } from "@/api/client";
import type { Card, SectionDef } from "@/types";

interface Props {
  card: Card;
  canEdit: boolean;
  onCardUpdate: (card: Card) => void;
}

export default function PpmCardDetailsTab({ card, canEdit, onCardUpdate }: Props) {
  const { getType } = useMetamodel();
  const { isCalculated } = useCalculatedFields();
  const { fmt: currencyFmt } = useCurrency();

  const typeConfig = getType(card.type);

  const calcFieldKeys = useMemo(() => {
    const keys: string[] = [];
    for (const section of typeConfig?.fields_schema || []) {
      for (const field of section.fields || []) {
        if (isCalculated(card.type, field.key)) keys.push(field.key);
      }
    }
    return keys;
  }, [typeConfig, card.type, isCalculated]);

  const hiddenFieldKeys = useMemo(() => {
    if (!card.subtype || !typeConfig?.subtypes) return new Set<string>();
    const st = typeConfig.subtypes.find((s: { key: string }) => s.key === card.subtype);
    return new Set<string>(st?.hidden_fields ?? []);
  }, [card.subtype, typeConfig]);

  const customSections = useMemo(
    () => (typeConfig?.fields_schema || []).filter(
      (s: { section: string }) => s.section !== "__description",
    ),
    [typeConfig],
  );

  const descExtraFields = useMemo(() => {
    const descSection = (typeConfig?.fields_schema || []).find(
      (s: { section: string }) => s.section === "__description",
    );
    return (descSection?.fields || []).filter(
      (f: { key: string }) => !hiddenFieldKeys.has(f.key),
    );
  }, [typeConfig, hiddenFieldKeys]);

  const handleUpdate = useCallback(
    async (updates: Record<string, unknown>) => {
      const updated = await api.patch<Card>(`/cards/${card.id}`, updates);
      onCardUpdate(updated);
    },
    [card.id, onCardUpdate],
  );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
      {/* Description + extra fields */}
      <ErrorBoundary label="Description" inline>
        <DescriptionSection
          card={card}
          onSave={handleUpdate}
          canEdit={canEdit}
          initialExpanded
          extraFields={descExtraFields.length > 0 ? descExtraFields : undefined}
          currencyFmt={currencyFmt}
        />
      </ErrorBoundary>

      {/* Lifecycle */}
      <ErrorBoundary label="Lifecycle" inline>
        <LifecycleSection
          card={card}
          onSave={handleUpdate}
          canEdit={canEdit}
          initialExpanded
        />
      </ErrorBoundary>

      {/* Custom attribute sections */}
      {customSections.map((section: SectionDef, i: number) => {
        const fields = section.fields || [];
        const visibleFields = fields.filter((f) => !hiddenFieldKeys.has(f.key));
        if (visibleFields.length === 0) return null;
        return (
          <ErrorBoundary key={i} label={section.section} inline>
            <AttributeSection
              section={section}
              card={card}
              onSave={handleUpdate}
              canEdit={canEdit}
              calculatedFieldKeys={calcFieldKeys}
              initialExpanded
              hiddenFieldKeys={hiddenFieldKeys}
            />
          </ErrorBoundary>
        );
      })}
    </Box>
  );
}
