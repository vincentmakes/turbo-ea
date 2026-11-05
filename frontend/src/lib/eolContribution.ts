/**
 * Turn a custom EOL product into a draft contribution to endoflife.date.
 *
 * endoflife.date keeps one Markdown file per product under `products/`, its
 * data in YAML front matter (see their CONTRIBUTING guide). This module only
 * *writes that file*: the user reviews it and opens the pull request from
 * their own GitHub account, through GitHub's "new file" page (which forks the
 * repository for anyone without write access). Turbo EA holds no GitHub
 * credential and posts nothing on anyone's behalf.
 *
 * Field names differ from the API Turbo EA reads: the file's `eoas` (end of
 * active support) is what the API serves as `support`.
 */

import type { EolCustomCycle, EolCustomProduct, EolDateCategory, EolMilestone } from "@/types";
import { todayIsoDate } from "@/lib/dates";
import { milestoneMode, type MilestoneKind } from "@/lib/eolCustom";

/**
 * endoflife.date's product categories (their `category` field) — the twin of
 * `EOL_DATE_CATEGORIES` in `backend/app/schemas/eol_custom.py`.
 */
export const EOL_DATE_CATEGORIES: readonly EolDateCategory[] = [
  "app",
  "database",
  "device",
  "framework",
  "lang",
  "os",
  "server-app",
  "service",
  "standard",
];
export type { EolDateCategory };

export const EOL_DATE_REPO = "https://github.com/endoflife-date/endoflife.date";
export const EOL_DATE_CONTRIBUTING = `${EOL_DATE_REPO}/blob/master/CONTRIBUTING.md`;

/**
 * Past this length the GitHub URL is not offered: browsers and proxies cut
 * long query strings, and a truncated file would be worse than none. The
 * user copies the file instead.
 */
export const MAX_GITHUB_URL_LENGTH = 7000;

/** endoflife.date permalinks are lower-case and hyphenated. */
export function eolDateSlug(key: string): string {
  return key.replace(/[._]+/g, "-").replace(/-{2,}/g, "-").replace(/^-|-$/g, "");
}

/** A YAML double-quoted scalar (JSON string syntax is valid YAML). */
function quoted(text: string): string {
  return JSON.stringify(text);
}

/**
 * A milestone in endoflife.date's file format, where `true` always means
 * "has ended". That matches the stored `eol`, but the stored `support`
 * follows the API, where `true` means *still* supported — so `eoas` takes
 * the opposite boolean.
 */
function milestone(value: EolMilestone, kind: MilestoneKind): string | null {
  const mode = milestoneMode(value, kind);
  if (mode === "ended") return "true";
  if (mode === "ongoing") return "false";
  return mode === "date" ? (value as string) : null;
}

function releaseLines(c: EolCustomCycle): string[] {
  const lines = [`  - releaseCycle: ${quoted(c.cycle)}`];
  if (c.releaseDate) lines.push(`    releaseDate: ${c.releaseDate}`);
  const eoas = milestone(c.support, "support");
  if (eoas !== null) lines.push(`    eoas: ${eoas}`);
  const eol = milestone(c.eol, "eol");
  if (eol !== null) lines.push(`    eol: ${eol}`);
  if (c.latest) lines.push(`    latest: ${quoted(c.latest)}`);
  if (c.latestReleaseDate) lines.push(`    latestReleaseDate: ${c.latestReleaseDate}`);
  return lines;
}

/** Newest release first, undated cycles last — endoflife.date's order. */
function byNewestRelease(a: EolCustomCycle, b: EolCustomCycle): number {
  if (!a.releaseDate && !b.releaseDate) return 0;
  if (!a.releaseDate) return 1;
  if (!b.releaseDate) return -1;
  return b.releaseDate.localeCompare(a.releaseDate);
}

export interface ContributionOptions {
  category: EolDateCategory;
  /** The day the file is written; defaults to today. */
  today?: string;
  /** The release-policy paragraph endoflife.date requires, when written. */
  policyNote?: string | null;
  /** Placeholder for that paragraph while it is still to be written. */
  policyPlaceholder: string;
  /** Placeholder for the one-line description when the product has none. */
  descriptionPlaceholder: string;
}

/** The paragraph as typed, trimmed; a leading front-matter fence is removed
 * so the note can never be read as a second YAML block. */
function policyParagraph(note: string | null | undefined): string {
  return (note ?? "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .replace(/^-{3,}\s*/, "");
}

/** The `products/<slug>.md` file for a custom product, ready to review. */
export function buildEolProductFile(
  product: Pick<EolCustomProduct, "key" | "title" | "description" | "link" | "cycles">,
  options: ContributionOptions,
): string {
  const slug = eolDateSlug(product.key);
  const cycles = [...product.cycles].sort(byNewestRelease);
  const front = [
    "---",
    `title: ${quoted(product.title)}`,
    `addedAt: ${options.today ?? todayIsoDate()}`,
    `category: ${options.category}`,
    `permalink: /${slug}`,
  ];
  if (product.link) front.push(`releasePolicyLink: ${quoted(product.link)}`);
  // Only show the columns the data fills: an always-empty "Active support"
  // or "Latest" column is what the maintainers ask contributors to hide.
  if (cycles.some((c) => milestone(c.support, "support") !== null)) front.push("eoasColumn: true");
  if (!cycles.some((c) => c.latest)) front.push("latestColumn: false");
  front.push("", "releases:");
  for (const c of cycles) front.push(...releaseLines(c));
  front.push("", "---");

  const title = markdownText(product.title);
  const name = product.link ? `[${title}](${markdownUrl(product.link)})` : title;
  const description = markdownText(product.description ?? "") || options.descriptionPlaceholder;
  const policy = policyParagraph(options.policyNote) || options.policyPlaceholder;
  return [...front, "", `> ${name} ${description}`, "", policy, ""].join("\n");
}

/** What the file still lacks before it is worth proposing, in checklist order. */
export type ReadinessItemId = "cycles" | "eol" | "release" | "link" | "category" | "description";

export interface ReadinessItem {
  id: ReadinessItemId;
  ok: boolean;
}

export interface ContributionDraft {
  category: EolDateCategory | null;
  policyNote: string;
}

/**
 * The readiness checklist: endoflife.date wants every release dated with an
 * end of life, a release-policy link, a category and a one-line summary.
 */
export function contributionReadiness(
  product: Pick<EolCustomProduct, "cycles" | "link" | "description">,
  draft: ContributionDraft,
): ReadinessItem[] {
  const cycles = product.cycles;
  return [
    { id: "cycles", ok: cycles.length > 0 },
    { id: "eol", ok: cycles.every((c) => milestoneMode(c.eol, "eol") !== "unset") },
    { id: "release", ok: cycles.every((c) => !!c.releaseDate) },
    { id: "link", ok: !!product.link },
    { id: "category", ok: draft.category !== null },
    { id: "description", ok: !!product.description?.trim() },
  ];
}

export function isContributionReady(items: ReadinessItem[]): boolean {
  return items.every((item) => item.ok);
}

/** One line of Markdown prose: whitespace collapsed (a newline would end the
 * blockquote) and link syntax escaped, backslash first so user text can never
 * cancel an escape and become a link. */
function markdownText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/([\\[\]()])/g, "\\$1");
}

/** A link target that cannot end the `(...)` early or break on a space. */
function markdownUrl(url: string): string {
  return url
    .trim()
    .replace(/\\/g, "%5C")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")
    .replace(/\s/g, "%20");
}

/**
 * GitHub's "create a new file" page for endoflife.date, pre-filled with the
 * file. `null` when the result would be too long to survive as a URL.
 */
export function githubNewFileUrl(key: string, fileText: string): string | null {
  const filename = `${eolDateSlug(key)}.md`;
  const url =
    `${EOL_DATE_REPO}/new/master/products` +
    `?filename=${encodeURIComponent(filename)}&value=${encodeURIComponent(fileText)}`;
  return url.length > MAX_GITHUB_URL_LENGTH ? null : url;
}
