/**
 * Renderer for Turbo EA release notes.
 *
 * The notes are not arbitrary markdown from the internet: they are the
 * CHANGELOG section for one version, cut by `.github/workflows/github-release.yml`
 * from a file this repository owns. That format is narrow and stable — `###`
 * headings, `-` bullets, and inline bold / italic / code / links — so this
 * renders it directly to React elements rather than pulling in a markdown
 * engine plus a sanitiser.
 *
 * Two consequences worth keeping:
 *   - Nothing is ever turned into HTML, so there is no `dangerouslySetInnerHTML`
 *     and no injection surface on content fetched from a remote feed.
 *   - Anything outside the supported subset (a table, an image) degrades to the
 *     literal text of the source line. Unusual, never broken — and the escape
 *     hatch is the "View on GitHub" button next to it.
 */
import type { ReactNode } from "react";
import Box from "@mui/material/Box";
import Link from "@mui/material/Link";
import Typography from "@mui/material/Typography";

/** Bold, code, link, italic — first match wins, so `**x**` never reads as `*x*`. */
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\)|\*[^*\s][^*]*\*)/g;

const LINK = /^\[([^\]]+)\]\(([^)]+)\)$/;

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text
    .split(INLINE)
    .filter((part) => part !== "")
    .map((part, i) => {
      const key = `${keyPrefix}-${i}`;

      if (part.startsWith("**") && part.endsWith("**")) {
        return (
          <Box component="strong" key={key} sx={{ fontWeight: 600 }}>
            {part.slice(2, -2)}
          </Box>
        );
      }

      if (part.startsWith("`") && part.endsWith("`")) {
        return (
          <Box
            component="code"
            key={key}
            sx={{
              fontFamily: "monospace",
              fontSize: "0.85em",
              bgcolor: "action.hover",
              px: 0.5,
              py: 0.15,
              borderRadius: 0.5,
            }}
          >
            {part.slice(1, -1)}
          </Box>
        );
      }

      const link = LINK.exec(part);
      if (link) {
        const [, label, href] = link;
        // Only http(s) — a `javascript:` href must never become a link.
        if (/^https?:\/\//i.test(href)) {
          return (
            <Link key={key} href={href} target="_blank" rel="noopener noreferrer">
              {label}
            </Link>
          );
        }
        return <span key={key}>{part}</span>;
      }

      if (part.startsWith("*") && part.endsWith("*")) {
        return (
          <Box component="em" key={key}>
            {part.slice(1, -1)}
          </Box>
        );
      }

      return <span key={key}>{part}</span>;
    });
}

/** Turn one release body into renderable blocks. */
export function renderReleaseNotes(markdown: string): ReactNode {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = () => {
    if (bullets.length === 0) return;
    const items = bullets;
    bullets = [];
    blocks.push(
      <Box
        component="ul"
        key={`ul-${blocks.length}`}
        sx={{ pl: 3, my: 1, "& li": { mb: 0.75 } }}
      >
        {items.map((item, i) => (
          <Typography component="li" variant="body2" key={i} sx={{ lineHeight: 1.6 }}>
            {renderInline(item, `li-${blocks.length}-${i}`)}
          </Typography>
        ))}
      </Box>,
    );
  };

  lines.forEach((raw, index) => {
    const line = raw.trimEnd();
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);

    if (heading) {
      flushBullets();
      blocks.push(
        <Typography
          key={`h-${index}`}
          variant="subtitle2"
          sx={{ fontWeight: 700, mt: blocks.length ? 2 : 0, mb: 0.5 }}
        >
          {renderInline(heading[2], `h-${index}`)}
        </Typography>,
      );
      return;
    }

    const bullet = /^\s*[-*+]\s+(.*)$/.exec(line);
    if (bullet) {
      bullets.push(bullet[1]);
      return;
    }

    flushBullets();
    if (line.trim() === "") return;

    blocks.push(
      <Typography key={`p-${index}`} variant="body2" sx={{ lineHeight: 1.6, my: 1 }}>
        {renderInline(line, `p-${index}`)}
      </Typography>,
    );
  });

  flushBullets();
  return blocks;
}
