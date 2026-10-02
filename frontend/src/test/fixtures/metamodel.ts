/**
 * A small, fixed metamodel and inventory for page and helper tests.
 *
 * The constants are plain data in the wire shape (`CardType`, `RelationType`,
 * `Card`, `TagGroup`, …) so a test can hand them to `withMetamodel()` or to a
 * `mockApi.on("get", "/cards*", …)` route unchanged. Every id is a lowercase
 * UUID, the way the API returns them. The builders fill in every required
 * field so a test states only what it is about:
 *
 * ```ts
 * const type = makeCardType({ key: "Vehicle", fields_schema: [makeSection({ fields: [makeField({ key: "wheels", type: "number" })] })] });
 * const card = makeCard({ type: "Vehicle", name: "Bus", attributes: { wheels: 6 } });
 * ```
 *
 * Fixed points a test may rely on:
 * - `Application` carries one field of every built-in type plus a readonly
 *   number and two stakeholder roles.
 * - `BusinessCapability` is hierarchical; `CARDS` holds two capabilities named
 *   "Billing" under different parents (the `parent_path` ambiguity rule).
 * - `ITComponent` is an EOL-eligible type; `Provider` is not hierarchical.
 * - `Secret` is hidden (`is_hidden: true`).
 * - `relAppToApp` is a self-pair carrying `flowDirection`.
 * - `TAG_GROUPS` has the bare tag name "Critical" in two groups.
 */
import type {
  Card,
  CardType,
  FieldDef,
  FieldOption,
  RelationType,
  SectionDef,
  StakeholderRoleDefinition,
  SubtypeDef,
  Tag,
  TagGroup,
  User,
} from "@/types";

let seq = 0;
/** A deterministic lowercase UUID; the trailing block counts up per call. */
export function nextUuid(prefix = "0000"): string {
  seq += 1;
  return `${prefix.padEnd(8, "0").slice(0, 8)}-0000-4000-8000-${String(seq).padStart(12, "0")}`;
}

export function makeOption(overrides: Partial<FieldOption> & { key: string }): FieldOption {
  return { label: overrides.key, ...overrides };
}

export function makeField(overrides: Partial<FieldDef> & { key: string }): FieldDef {
  return { label: overrides.key, type: "text", ...overrides };
}

export function makeSection(overrides: Partial<SectionDef> = {}): SectionDef {
  return { section: "Details", fields: [], ...overrides };
}

export function makeSubtype(overrides: Partial<SubtypeDef> & { key: string }): SubtypeDef {
  return { label: overrides.key, ...overrides };
}

export function makeCardType(overrides: Partial<CardType> & { key: string }): CardType {
  return {
    label: overrides.key,
    icon: "apps",
    color: "#0f7eb5",
    category: "Application & Data",
    has_hierarchy: false,
    has_successors: false,
    allow_card_logo: false,
    fields_schema: [],
    stakeholder_roles: [],
    built_in: true,
    is_hidden: false,
    sort_order: 0,
    ...overrides,
  };
}

export function makeRelationType(
  overrides: Partial<RelationType> & {
    key: string;
    source_type_key: string;
    target_type_key: string;
  },
): RelationType {
  return {
    label: "relates to",
    reverse_label: "is related to by",
    cardinality: "n:m",
    attributes_schema: [],
    built_in: true,
    is_hidden: false,
    sort_order: 0,
    source_visible: true,
    source_mandatory: false,
    target_visible: true,
    target_mandatory: false,
    ...overrides,
  };
}

export function makeCard(overrides: Partial<Card> & { type: string; name: string }): Card {
  return {
    id: nextUuid("ca4d"),
    status: "ACTIVE",
    approval_status: "DRAFT",
    data_quality: 50,
    attributes: {},
    lifecycle: {},
    tags: [],
    stakeholders: [],
    ...overrides,
  };
}

export function makeTag(overrides: Partial<Tag> & { name: string; tag_group_id: string }): Tag {
  return { id: nextUuid("7a60"), ...overrides };
}

export function makeTagGroup(overrides: Partial<TagGroup> & { name: string }): TagGroup {
  return { id: nextUuid("7a66"), mode: "multi", mandatory: false, tags: [], ...overrides };
}

export function makeUserRef(overrides: Partial<User> & { email: string }): User {
  const local = overrides.email.split("@")[0];
  return {
    id: nextUuid("05e2"),
    display_name: local.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
    role: "member",
    is_active: true,
    ...overrides,
  };
}

/* ------------------------------------------------------------------------- */
/*  Card types                                                                 */
/* ------------------------------------------------------------------------- */

export const CRITICALITY_OPTIONS: FieldOption[] = [
  makeOption({ key: "missionCritical", label: "Mission Critical", color: "#d32f2f" }),
  makeOption({ key: "businessCritical", label: "Business Critical", color: "#f57c00" }),
  makeOption({ key: "businessOperational", label: "Business Operational", color: "#fbc02d" }),
  makeOption({ key: "administrativeService", label: "Administrative Service", color: "#388e3c" }),
];

export const REGION_OPTIONS: FieldOption[] = [
  makeOption({ key: "emea", label: "EMEA" }),
  makeOption({ key: "amer", label: "Americas" }),
  makeOption({ key: "apac", label: "APAC" }),
];

export const APPLICATION_TYPE: CardType = makeCardType({
  key: "Application",
  label: "Application",
  icon: "apps",
  color: "#0f7eb5",
  category: "Application & Data",
  has_hierarchy: true,
  has_successors: true,
  allow_card_logo: true,
  sort_order: 10,
  subtypes: [
    makeSubtype({ key: "businessApplication", label: "Business Application" }),
    makeSubtype({ key: "microservice", label: "Microservice" }),
  ],
  fields_schema: [
    makeSection({
      section: "__description",
      fields: [makeField({ key: "alias", label: "Alias", type: "text" })],
    }),
    makeSection({
      section: "Business Information",
      columns: 2,
      fields: [
        makeField({
          key: "businessCriticality",
          label: "Business Criticality",
          type: "single_select",
          options: CRITICALITY_OPTIONS,
          required: true,
          weight: 2,
        }),
        makeField({ key: "costTotalAnnual", label: "Total Annual Cost", type: "cost", weight: 1 }),
        makeField({ key: "isCloud", label: "Cloud Hosted", type: "boolean" }),
        makeField({ key: "goLiveDate", label: "Go-Live Date", type: "date" }),
        makeField({ key: "coverage", label: "Test Coverage", type: "percentage" }),
        makeField({
          key: "regions",
          label: "Regions",
          type: "multiple_select",
          options: REGION_OPTIONS,
        }),
        makeField({ key: "vendorScore", label: "Vendor Score", type: "number", readonly: true }),
        makeField({ key: "docsUrl", label: "Documentation", type: "url" }),
        makeField({ key: "notes", label: "Notes", type: "multiline_text" }),
      ],
    }),
  ],
  stakeholder_roles: [
    { key: "applicationOwner", label: "Application Owner" },
    { key: "technicalApplicationOwner", label: "Technical Application Owner" },
  ],
  translations: { label: { de: "Anwendung", fr: "Application" } },
});

export const BUSINESS_CAPABILITY_TYPE: CardType = makeCardType({
  key: "BusinessCapability",
  label: "Business Capability",
  icon: "account_tree",
  color: "#003399",
  category: "Business Architecture",
  has_hierarchy: true,
  sort_order: 5,
  fields_schema: [
    makeSection({
      section: "Assessment",
      fields: [
        makeField({ key: "maturity", label: "Maturity", type: "number" }),
        makeField({ key: "strategicImportance", label: "Strategic Importance", type: "number" }),
      ],
    }),
  ],
  stakeholder_roles: [{ key: "capabilityOwner", label: "Capability Owner" }],
});

export const IT_COMPONENT_TYPE: CardType = makeCardType({
  key: "ITComponent",
  label: "IT Component",
  icon: "memory",
  color: "#d29270",
  category: "Technical Architecture",
  has_hierarchy: true,
  sort_order: 20,
  subtypes: [
    makeSubtype({ key: "software", label: "Software" }),
    makeSubtype({ key: "saas", label: "SaaS" }),
  ],
  fields_schema: [
    makeSection({
      section: "Technical",
      fields: [
        makeField({ key: "version", label: "Version", type: "text" }),
        makeField({ key: "licenseCost", label: "License Cost", type: "cost" }),
      ],
    }),
  ],
  stakeholder_roles: [{ key: "technicalOwner", label: "Technical Owner" }],
});

export const PROVIDER_TYPE: CardType = makeCardType({
  key: "Provider",
  label: "Provider",
  icon: "storefront",
  color: "#ffa31f",
  category: "Technical Architecture",
  sort_order: 30,
  fields_schema: [
    makeSection({
      section: "Contact",
      fields: [makeField({ key: "website", label: "Website", type: "url" })],
    }),
  ],
});

export const HIDDEN_TYPE: CardType = makeCardType({
  key: "Secret",
  label: "Secret",
  icon: "lock",
  color: "#333333",
  category: "Technical Architecture",
  is_hidden: true,
  built_in: false,
  sort_order: 99,
});

export const CARD_TYPES: CardType[] = [
  BUSINESS_CAPABILITY_TYPE,
  APPLICATION_TYPE,
  IT_COMPONENT_TYPE,
  PROVIDER_TYPE,
  HIDDEN_TYPE,
];

/** `{typeKey: roles}` as `GET /stakeholder-roles` groups them. */
export const STAKEHOLDER_ROLES_BY_TYPE: Record<string, StakeholderRoleDefinition[]> =
  Object.fromEntries(CARD_TYPES.map((t) => [t.key, t.stakeholder_roles ?? []]));

/* ------------------------------------------------------------------------- */
/*  Relation types                                                             */
/* ------------------------------------------------------------------------- */

export const FLOW_DIRECTION_OPTIONS: FieldOption[] = [
  makeOption({ key: "forward", label: "Forward" }),
  makeOption({ key: "reverse", label: "Reverse" }),
  makeOption({ key: "bidirectional", label: "Bidirectional" }),
];

export const REL_APP_TO_ITC: RelationType = makeRelationType({
  key: "relAppToITC",
  label: "uses",
  reverse_label: "is used by",
  source_type_key: "Application",
  target_type_key: "ITComponent",
  sort_order: 1,
  translations: { label: { de: "verwendet" }, reverse_label: { de: "wird verwendet von" } },
});

export const REL_APP_TO_BC: RelationType = makeRelationType({
  key: "relAppToBC",
  label: "supports",
  reverse_label: "is supported by",
  source_type_key: "Application",
  target_type_key: "BusinessCapability",
  sort_order: 2,
  target_mandatory: true,
});

export const REL_PROVIDER_TO_ITC: RelationType = makeRelationType({
  key: "relProviderToITC",
  label: "provides",
  reverse_label: "is provided by",
  source_type_key: "Provider",
  target_type_key: "ITComponent",
  cardinality: "1:n",
  sort_order: 3,
});

export const REL_APP_TO_APP: RelationType = makeRelationType({
  key: "relAppToApp",
  label: "sends data to",
  reverse_label: "receives data from",
  source_type_key: "Application",
  target_type_key: "Application",
  sort_order: 4,
  attributes_schema: [
    makeField({
      key: "flowDirection",
      label: "Flow Direction",
      type: "single_select",
      options: FLOW_DIRECTION_OPTIONS,
      built_in: true,
    }),
  ],
});

export const RELATION_TYPES: RelationType[] = [
  REL_APP_TO_ITC,
  REL_APP_TO_BC,
  REL_PROVIDER_TO_ITC,
  REL_APP_TO_APP,
];

/* ------------------------------------------------------------------------- */
/*  Users, tags, cards                                                         */
/* ------------------------------------------------------------------------- */

export const USERS: User[] = [
  makeUserRef({
    id: "00000000-0000-4000-8000-00000000a001",
    email: "admin@test.local",
    display_name: "Test Admin",
    role: "admin",
    permissions: { "*": true },
  }),
  makeUserRef({
    id: "00000000-0000-4000-8000-00000000b002",
    email: "member@test.local",
    display_name: "Test Member",
    role: "member",
  }),
  makeUserRef({
    id: "00000000-0000-4000-8000-00000000c003",
    email: "viewer@test.local",
    display_name: "Test Viewer",
    role: "viewer",
  }),
  makeUserRef({
    id: "00000000-0000-4000-8000-00000000d004",
    email: "inactive@test.local",
    display_name: "Former Colleague",
    role: "member",
    is_active: false,
  }),
];

export const [ADMIN_USER, MEMBER_USER, VIEWER_USER, INACTIVE_USER] = USERS;

const TG_HOSTING = "7a660000-0000-4000-8000-000000000001";
const TG_RISK = "7a660000-0000-4000-8000-000000000002";

export const TAG_GROUPS: TagGroup[] = [
  makeTagGroup({
    id: TG_HOSTING,
    name: "Hosting",
    mode: "single",
    mandatory: true,
    restrict_to_types: ["Application", "ITComponent"],
    tags: [
      makeTag({ id: "7a600000-0000-4000-8000-000000000011", name: "On-Prem", color: "#607d8b", tag_group_id: TG_HOSTING }),
      makeTag({ id: "7a600000-0000-4000-8000-000000000012", name: "Cloud", color: "#03a9f4", tag_group_id: TG_HOSTING }),
      makeTag({ id: "7a600000-0000-4000-8000-000000000013", name: "Critical", color: "#e91e63", tag_group_id: TG_HOSTING }),
    ],
  }),
  makeTagGroup({
    id: TG_RISK,
    name: "Risk",
    mode: "multi",
    mandatory: false,
    restrict_to_types: null,
    tags: [
      makeTag({ id: "7a600000-0000-4000-8000-000000000021", name: "Critical", color: "#f44336", tag_group_id: TG_RISK }),
      makeTag({ id: "7a600000-0000-4000-8000-000000000022", name: "Audited", color: "#4caf50", tag_group_id: TG_RISK }),
    ],
  }),
];

export const [HOSTING_GROUP, RISK_GROUP] = TAG_GROUPS;

export const CARD_IDS = {
  finance: "ca4d0000-0000-4000-8000-000000000001",
  billingUnderFinance: "ca4d0000-0000-4000-8000-000000000002",
  sales: "ca4d0000-0000-4000-8000-000000000003",
  billingUnderSales: "ca4d0000-0000-4000-8000-000000000004",
  erp: "ca4d0000-0000-4000-8000-000000000011",
  crm: "ca4d0000-0000-4000-8000-000000000012",
  erpArchived: "ca4d0000-0000-4000-8000-000000000013",
  postgres: "ca4d0000-0000-4000-8000-000000000021",
  linux: "ca4d0000-0000-4000-8000-000000000022",
  acme: "ca4d0000-0000-4000-8000-000000000031",
} as const;

export const CARDS: Card[] = [
  makeCard({ id: CARD_IDS.finance, type: "BusinessCapability", name: "Finance", approval_status: "APPROVED", data_quality: 80 }),
  makeCard({ id: CARD_IDS.billingUnderFinance, type: "BusinessCapability", name: "Billing", parent_id: CARD_IDS.finance }),
  makeCard({ id: CARD_IDS.sales, type: "BusinessCapability", name: "Sales" }),
  makeCard({ id: CARD_IDS.billingUnderSales, type: "BusinessCapability", name: "Billing", parent_id: CARD_IDS.sales }),
  makeCard({
    id: CARD_IDS.erp,
    type: "Application",
    subtype: "businessApplication",
    name: "ERP Core",
    description: "The system of record.",
    approval_status: "APPROVED",
    data_quality: 92,
    lifecycle: { plan: "2019-01-01", active: "2020-06-01", endOfLife: "2030-12-31" },
    attributes: {
      businessCriticality: "missionCritical",
      costTotalAnnual: 250000,
      isCloud: false,
      goLiveDate: "2020-06-01",
      coverage: 75,
      regions: ["emea", "amer"],
      vendorScore: 4.2,
    },
    tags: [{ id: HOSTING_GROUP.tags[0].id, name: "On-Prem", color: "#607d8b", group_name: "Hosting" }],
    stakeholders: [
      {
        id: "57a40000-0000-4000-8000-000000000001",
        user_id: MEMBER_USER.id,
        user_display_name: MEMBER_USER.display_name,
        user_email: MEMBER_USER.email,
        role: "applicationOwner",
        role_label: "Application Owner",
      },
    ],
  }),
  makeCard({
    id: CARD_IDS.crm,
    type: "Application",
    subtype: "microservice",
    name: "CRM Cloud",
    data_quality: 40,
    lifecycle: { active: "2023-01-01" },
    attributes: { businessCriticality: "businessOperational", isCloud: true, regions: ["apac"] },
    tags: [{ id: HOSTING_GROUP.tags[1].id, name: "Cloud", color: "#03a9f4", group_name: "Hosting" }],
  }),
  makeCard({
    id: CARD_IDS.erpArchived,
    type: "Application",
    name: "ERP Legacy",
    status: "ARCHIVED",
    archived_at: "2026-01-15T10:00:00Z",
    data_quality: 10,
  }),
  makeCard({
    id: CARD_IDS.postgres,
    type: "ITComponent",
    subtype: "software",
    name: "PostgreSQL",
    attributes: { version: "16", eol_product: "postgresql", eol_cycle: "16" },
  }),
  makeCard({
    id: CARD_IDS.linux,
    type: "ITComponent",
    subtype: "software",
    name: "Ubuntu LTS",
    attributes: { version: "24.04" },
    lifecycle: { endOfLife: "2029-04-30" },
  }),
  makeCard({ id: CARD_IDS.acme, type: "Provider", name: "Acme Corp", attributes: { website: "https://acme.example" } }),
];

export const cardById = (id: string): Card => {
  const card = CARDS.find((c) => c.id === id);
  if (!card) throw new Error(`no fixture card ${id}`);
  return card;
};

/** The paginated `GET /cards` envelope around a card list. */
export function cardPage(items: Card[], overrides: Partial<{ page: number; page_size: number; total: number }> = {}) {
  return { items, total: items.length, page: 1, page_size: 50, ...overrides };
}
