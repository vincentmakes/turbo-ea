import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { printPage } from "./printPage";

/** jsdom has no `execCommand`; each test installs the one it needs. */
function installExecCommand(impl: (cmd: string, ui?: boolean) => boolean) {
  const fn = vi.fn(impl);
  Object.defineProperty(document, "execCommand", { value: fn, configurable: true, writable: true });
  return fn;
}

function setVendor(vendor: string) {
  vi.spyOn(navigator, "vendor", "get").mockReturnValue(vendor);
}

let print: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  print = vi.spyOn(window, "print").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  delete (document as unknown as Record<string, unknown>).execCommand;
});

describe("printPage", () => {
  it("prints through execCommand in WebKit and does not call window.print when it is handled", () => {
    setVendor("Apple Computer, Inc.");
    const exec = installExecCommand(() => true);
    printPage();
    expect(exec).toHaveBeenCalledTimes(1);
    expect(exec).toHaveBeenCalledWith("print", false);
    expect(print).not.toHaveBeenCalled();
  });

  it("falls back to window.print in WebKit when the command is not handled", () => {
    setVendor("Apple Computer, Inc.");
    const exec = installExecCommand(() => false);
    printPage();
    expect(exec).toHaveBeenCalledWith("print", false);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("falls back to window.print in WebKit when the command throws", () => {
    setVendor("Apple Computer, Inc.");
    const exec = installExecCommand(() => {
      throw new Error("unsupported");
    });
    expect(() => printPage()).not.toThrow();
    expect(exec).toHaveBeenCalledTimes(1);
    expect(print).toHaveBeenCalledTimes(1);
  });

  it.each(["Google Inc.", ""])(
    "calls window.print alone, never execCommand, when the vendor is %j",
    (vendor) => {
      setVendor(vendor);
      const exec = installExecCommand(() => true);
      printPage();
      expect(exec).not.toHaveBeenCalled();
      expect(print).toHaveBeenCalledTimes(1);
    },
  );

  it("matches the vendor by its start only", () => {
    setVendor("Not Apple");
    const exec = installExecCommand(() => true);
    printPage();
    expect(exec).not.toHaveBeenCalled();
    expect(print).toHaveBeenCalledTimes(1);
  });
});
