import { describe, expect, it } from "vitest";
import { deepLinkDialog } from "./reviewDeepLink";

describe("deepLinkDialog", () => {
  it("opens the sign dialog for a pending signatory, the request dialog for anyone else", () => {
    expect(deepLinkDialog("sign", true)).toBe("sign");
    expect(deepLinkDialog("sign", false)).toBe("request-signatures");
  });

  it("opens the reject dialog, and nothing for another action", () => {
    expect(deepLinkDialog("reject", true)).toBe("reject");
    expect(deepLinkDialog("reject", false)).toBe("reject");
    expect(deepLinkDialog("bogus", true)).toBeNull();
    expect(deepLinkDialog("", false)).toBeNull();
  });
});
