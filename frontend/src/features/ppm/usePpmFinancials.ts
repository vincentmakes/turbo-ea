import { useMemo } from "react";
import { useApiQuery } from "@/hooks/useApiQuery";
import { useCurrency } from "@/hooks/useCurrency";
import { currencySymbolOverride } from "@/lib/currency";
import type { PmlInitiativeSchedule, PpmFinancials } from "@/types";

function useInitiativeQuery<T extends { initiative_id: string }>(
  initiativeId: string | null | undefined,
  resource: "financials" | "schedule",
  refetchKey?: number,
) {
  const query = useApiQuery<T>(
    initiativeId ? "/ppm/initiatives/" + encodeURIComponent(initiativeId) + "/" + resource : null,
    { keepPreviousData: false, refetchKey },
  );
  return {
    ...query,
    data: !query.error && query.data?.initiative_id === initiativeId ? query.data : undefined,
  };
}

export function usePpmFinancials(initiativeId: string | null | undefined, refetchKey?: number) {
  return useInitiativeQuery<PpmFinancials>(initiativeId, "financials", refetchKey);
}

export function usePpmSchedule(initiativeId: string | null | undefined, refetchKey?: number) {
  return useInitiativeQuery<PmlInitiativeSchedule>(initiativeId, "schedule", refetchKey);
}

export function decimalWithoutExponent(value: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?[Ee]([+-]?\d+)$/.exec(value);
  if (!match) return value;
  const [, sign, whole, fraction = "", exponent] = match;
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  if (point <= 0) return sign + "0." + "0".repeat(-point) + digits;
  if (point >= digits.length) return sign + digits.padEnd(point, "0");
  return sign + digits.slice(0, point) + "." + digits.slice(point);
}

export function financialAmountFormatter(currency: string, locale?: string) {
  const integerFormatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
  const digitFormatter = new Intl.NumberFormat(locale, { useGrouping: false });
  const decimal = digitFormatter.formatToParts(1.1).find((part) => part.type === "decimal");
  const digits = Array.from({ length: 10 }, (_, digit) => digitFormatter.format(digit));
  const override = currencySymbolOverride(currency);

  return (value: string | number | null | undefined): string => {
    if (value == null) return "—";
    const match = /^(-?\d+)(?:\.(\d+))?$/.exec(decimalWithoutExponent(String(value)));
    if (!match) return typeof value === "number" ? integerFormatter.format(value) : value;

    const integer = BigInt(match[1]);
    const parts = integerFormatter.formatToParts(
      integer === 0n && match[1].startsWith("-") ? -0 : integer,
    );
    const fraction = match[2]
      ? (decimal?.value ?? ".") + Array.from(match[2], (digit) => digits[Number(digit)]).join("")
      : "";
    const integerEnd = parts.map((part) => part.type).lastIndexOf("integer");
    // Group the integer with Intl, then render the authoritative fraction without rounding it.
    return parts
      .map((part, index) => {
        if (part.type === "currency" && override) return override;
        return index === integerEnd ? part.value + fraction : part.value;
      })
      .join("");
  };
}

export function usePpmFinancialAmount() {
  const { currency } = useCurrency();
  return useMemo(() => financialAmountFormatter(currency), [currency]);
}
