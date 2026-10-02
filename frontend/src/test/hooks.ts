/**
 * One-call mocks for the boot-time singleton hooks.
 *
 * Each `*Module()` is the object a `vi.mock(...)` factory returns: the real
 * module (so constants and pure helpers stay real) with the hook reading
 * `hookState` at call time, and its `invalidate*` export a `vi.fn`. The test
 * configures `hookState` in `beforeEach`; nothing here is read at import time,
 * so hoisting is not a concern:
 *
 * ```ts
 * vi.mock("@/hooks/useMetamodel", () => import("@/test/hooks").then((m) => m.useMetamodelModule()));
 * import { hookState, withMetamodel } from "@/test/hooks";
 * import { CARD_TYPES, RELATION_TYPES } from "@/test/fixtures/metamodel";
 *
 * beforeEach(() => withMetamodel(CARD_TYPES, RELATION_TYPES));
 * ```
 *
 * Not mocked on purpose: `useResolveLabel` and its entity-aware siblings work
 * unmocked (the real `@/i18n` is loaded by `setup.ts`), and so does
 * `useThemeMode` (the context default is `light`). `useAuthContext` is served by
 * the real `AuthProvider` through `renderWithProviders`.
 */
import { vi } from "vitest";

import type { CardType, ComplianceRegulation, RelationType, User } from "@/types";

export const hookState = {
  metamodel: {
    types: [] as CardType[],
    relationTypes: [] as RelationType[],
    loading: false,
  },
  dateFormat: "YYYY-MM-DD" as string,
  currency: { currency: "USD", symbol: "$", loading: false },
  themeMode: "light" as "light" | "dark",
  isRtl: false,
  ppm: { ppmEnabled: true, ppmLoaded: true },
  grc: { grcEnabled: true, grcLoaded: true },
  bpm: { bpmEnabled: true, bpmLoaded: true },
  turboLens: {
    turboLensReady: true,
    turboLensAiConfigured: true,
    turboLensEnabled: true,
    turboLensLoaded: true,
  },
  fileUploads: { fileUploadsEnabled: true, fileUploadsLoaded: true },
  complianceRegulations: [] as ComplianceRegulation[],
  permissions: { "*": true } as Record<string, boolean>,
  auth: { user: null as User | null, loading: false },
  calculatedFields: {} as Record<string, string[]>,
  /** Handlers `useEventStream` consumers registered; `emitEvent` fans out. */
  eventStream: { handlers: [] as Array<(event: Record<string, unknown>) => void>, reconnect: [] as Array<() => void> },

  reset(): void {
    this.metamodel = { types: [], relationTypes: [], loading: false };
    this.dateFormat = "YYYY-MM-DD";
    this.currency = { currency: "USD", symbol: "$", loading: false };
    this.themeMode = "light";
    this.isRtl = false;
    this.ppm = { ppmEnabled: true, ppmLoaded: true };
    this.grc = { grcEnabled: true, grcLoaded: true };
    this.bpm = { bpmEnabled: true, bpmLoaded: true };
    this.turboLens = {
      turboLensReady: true,
      turboLensAiConfigured: true,
      turboLensEnabled: true,
      turboLensLoaded: true,
    };
    this.fileUploads = { fileUploadsEnabled: true, fileUploadsLoaded: true };
    this.complianceRegulations = [];
    this.permissions = { "*": true };
    this.auth = { user: null, loading: false };
    this.calculatedFields = {};
    this.eventStream = { handlers: [], reconnect: [] };
  },
};

/** Point the metamodel mock at a type set (resets `loading`). */
export function withMetamodel(types: CardType[], relationTypes: RelationType[] = []): void {
  hookState.metamodel = { types, relationTypes, loading: false };
}

/** Deliver one SSE event to every mounted `useEventStream` consumer. Wrap in `act()`. */
export function emitEvent(event: Record<string, unknown>): void {
  for (const h of hookState.eventStream.handlers) h(event);
}

export async function useMetamodelModule() {
  const actual = await vi.importActual<typeof import("@/hooks/useMetamodel")>("@/hooks/useMetamodel");
  const invalidateCache = vi.fn(async () => {});
  return {
    ...actual,
    invalidateCache,
    useMetamodel: vi.fn(() => {
      const s = hookState.metamodel;
      return {
        types: s.types,
        relationTypes: s.relationTypes,
        loading: s.loading,
        getType: (key: string) => s.types.find((t) => t.key === key),
        getRelationsForType: (key: string) =>
          s.relationTypes.filter((rt) => rt.source_type_key === key || rt.target_type_key === key),
        invalidateCache,
      };
    }),
  };
}

export async function useDateFormatModule() {
  const actual = await vi.importActual<typeof import("@/hooks/useDateFormat")>("@/hooks/useDateFormat");
  return {
    ...actual,
    invalidateDateFormat: vi.fn(),
    getCachedDateFormat: () => hookState.dateFormat,
    useDateFormat: () => ({
      dateFormat: hookState.dateFormat,
      loading: false,
      formatDate: (d: Date | string | number | null | undefined) =>
        actual.formatDateWith(hookState.dateFormat as import("@/hooks/useDateFormat").DateFormatKey, d),
      formatDateTime: (d: Date | string | number | null | undefined) =>
        actual.formatDateTimeWith(hookState.dateFormat as import("@/hooks/useDateFormat").DateFormatKey, d),
      invalidate: vi.fn(),
      example: "",
    }),
  };
}

export async function useCurrencyModule() {
  const actual = await vi.importActual<typeof import("@/hooks/useCurrency")>("@/hooks/useCurrency");
  return {
    ...actual,
    invalidateCurrency: vi.fn(),
    useCurrency: () => {
      const { currency, symbol, loading } = hookState.currency;
      return {
        currency,
        loading,
        fmt: { format: (v: number) => `${symbol}${v}` },
        fmtShort: (v: number) => `${symbol}${v}`,
        symbol,
        invalidate: vi.fn(),
      };
    },
  };
}

export async function useThemeModeModule() {
  const actual = await vi.importActual<typeof import("@/hooks/useThemeMode")>("@/hooks/useThemeMode");
  return {
    ...actual,
    useThemeMode: () => ({ mode: hookState.themeMode, toggleMode: vi.fn() }),
  };
}

export function useIsRtlModule() {
  return { useIsRtl: () => hookState.isRtl };
}

export async function usePpmEnabledModule() {
  const actual = await vi.importActual<typeof import("@/hooks/usePpmEnabled")>("@/hooks/usePpmEnabled");
  return {
    ...actual,
    invalidatePpmEnabled: vi.fn(),
    usePpmEnabled: () => ({ ...hookState.ppm, invalidatePpm: vi.fn() }),
  };
}

export async function useGrcEnabledModule() {
  const actual = await vi.importActual<typeof import("@/hooks/useGrcEnabled")>("@/hooks/useGrcEnabled");
  return {
    ...actual,
    invalidateGrcEnabled: vi.fn(),
    useGrcEnabled: () => ({ ...hookState.grc, invalidateGrc: vi.fn() }),
  };
}

export async function useBpmEnabledModule() {
  const actual = await vi.importActual<typeof import("@/hooks/useBpmEnabled")>("@/hooks/useBpmEnabled");
  return {
    ...actual,
    invalidateBpmEnabled: vi.fn(),
    useBpmEnabled: () => ({ ...hookState.bpm, invalidateBpm: vi.fn() }),
  };
}

export async function useTurboLensReadyModule() {
  const actual = await vi.importActual<typeof import("@/hooks/useTurboLensReady")>(
    "@/hooks/useTurboLensReady",
  );
  return {
    ...actual,
    useTurboLensReady: () => ({ ...hookState.turboLens, invalidateTurboLens: vi.fn() }),
  };
}

export async function useFileUploadsEnabledModule() {
  const actual = await vi.importActual<typeof import("@/hooks/useFileUploadsEnabled")>(
    "@/hooks/useFileUploadsEnabled",
  );
  return {
    ...actual,
    invalidateFileUploadsEnabled: vi.fn(),
    useFileUploadsEnabled: () => ({ ...hookState.fileUploads, invalidateFileUploads: vi.fn() }),
  };
}

export async function useComplianceRegulationsModule() {
  const actual = await vi.importActual<typeof import("@/hooks/useComplianceRegulations")>(
    "@/hooks/useComplianceRegulations",
  );
  // `enabled` and `byKey` are memoised on the regulations array, as the real
  // hook does: a consumer keys an effect on `enabled`, and a fresh array per
  // render would spin it forever.
  let memo: {
    regulations: ComplianceRegulation[];
    enabled: ComplianceRegulation[];
    byKey: Record<string, ComplianceRegulation>;
  } | null = null;
  const refresh = vi.fn(async () => {});
  return {
    ...actual,
    invalidateComplianceRegulations: vi.fn(),
    useComplianceRegulations: () => {
      const regulations = hookState.complianceRegulations;
      if (!memo || memo.regulations !== regulations) {
        memo = {
          regulations,
          enabled: regulations.filter((r) => r.is_enabled),
          byKey: Object.fromEntries(regulations.map((r) => [r.key, r])),
        };
      }
      return { ...memo, loaded: true, refresh };
    },
  };
}

export function usePermissionsModule() {
  const can = (key: string) => Boolean(hookState.permissions["*"] || hookState.permissions[key]);
  return {
    usePermissions: () => ({
      permissions: hookState.permissions,
      can,
      canForType: (key: string, _typeKey?: string) => can(key),
      canReadType: () => true,
      isAdmin: Boolean(hookState.permissions["*"]),
      canViewCostsGlobally: can("costs.view"),
      cardPermissions: {},
      loadCardPermissions: vi.fn(async () => {}),
      canOnCard: () => true,
      invalidateCardPermissions: vi.fn(),
    }),
  };
}

export async function useAuthModule() {
  const actual = await vi.importActual<typeof import("@/hooks/useAuth")>("@/hooks/useAuth");
  return {
    ...actual,
    useAuth: () => ({
      user: hookState.auth.user,
      loading: hookState.auth.loading,
      login: vi.fn(),
      register: vi.fn(),
      ssoCallback: vi.fn(),
      proxySession: vi.fn(),
      setPassword: vi.fn(),
      logout: vi.fn(),
      refreshUser: vi.fn(async () => {}),
    }),
  };
}

export async function useCalculatedFieldsModule() {
  const actual = await vi.importActual<typeof import("@/hooks/useCalculatedFields")>(
    "@/hooks/useCalculatedFields",
  );
  return {
    ...actual,
    invalidateCalculatedFields: vi.fn(),
    useCalculatedFields: () => ({
      calculatedFields: hookState.calculatedFields,
      loading: false,
      isCalculated: (typeKey: string, fieldKey: string) =>
        (hookState.calculatedFields[typeKey] ?? []).includes(fieldKey),
    }),
  };
}

export function useEventStreamModule() {
  return {
    stopEventStream: vi.fn(),
    useEventStream: (onEvent: (event: Record<string, unknown>) => void, onReconnect?: () => void) => {
      hookState.eventStream.handlers.push(onEvent);
      if (onReconnect) hookState.eventStream.reconnect.push(onReconnect);
    },
  };
}
