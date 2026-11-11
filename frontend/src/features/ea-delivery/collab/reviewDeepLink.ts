/**
 * Which dialog a review deep link (`?action=sign|reject`, the link MCP's
 * pending workflow answers return) opens on a decision or SoAW editor, once
 * the document and the reader are known.
 *
 * `sign` opens the sign dialog for a pending signatory of a document in
 * review (the person the link was made for); for anyone else it opens the
 * request-signatures dialog, as it always did. `reject` opens the reject
 * dialog. Anything else opens nothing.
 */
export type ReviewDialog = "sign" | "request-signatures" | "reject";

export function deepLinkDialog(action: string, canSign: boolean): ReviewDialog | null {
  if (action === "sign") return canSign ? "sign" : "request-signatures";
  if (action === "reject") return "reject";
  return null;
}
