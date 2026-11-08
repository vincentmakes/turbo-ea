/**
 * The text of a Layered Dependency View line label: the lines `wrapEdgeLabel`
 * broke it into, one under the other and centred, so a long relation label
 * reads in full (the verb, then its values) instead of being cut off. Renders
 * nothing for a label with no text, such as a merged connector showing only
 * its count.
 */
export default function LdvEdgeLabelText({ lines }: { lines: readonly string[] }) {
  if (lines.length === 0) return null;
  return <span style={{ whiteSpace: "pre", textAlign: "center" }}>{lines.join("\n")}</span>;
}
