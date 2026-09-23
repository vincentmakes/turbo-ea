import { describe, it, expect } from "vitest";
import { dateInputEngine } from "./browserEngine";

const UA = {
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  edgeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  operaWin:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 OPR/120.0.0.0",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.6; rv:140.0) Gecko/20100101 Firefox/140.0",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
  firefoxIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/140.0 Mobile/15E148 Safari/605.1.15",
  jsdom: "Mozilla/5.0 (linux) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/26.1.0",
};

describe("dateInputEngine", () => {
  it("recognises Safari on macOS as desktop WebKit", () => {
    expect(dateInputEngine(UA.safariMac, 0)).toBe("webkit-desktop");
  });

  it.each([
    ["Chrome on macOS", UA.chromeMac],
    ["Edge on macOS", UA.edgeMac],
    ["Opera on Windows", UA.operaWin],
    ["Chrome on Android", UA.chromeAndroid],
    ["Firefox on macOS", UA.firefoxMac],
    ["jsdom", UA.jsdom],
  ])("treats %s as not WebKit", (_name, ua) => {
    expect(dateInputEngine(ua, 0)).toBe("other");
  });

  it.each([
    ["Safari on iPhone", UA.safariIphone],
    ["Chrome on iPhone (WebKit underneath)", UA.chromeIphone],
    ["Firefox on iPhone (WebKit underneath)", UA.firefoxIphone],
  ])("treats %s as touch WebKit", (_name, ua) => {
    expect(dateInputEngine(ua, 5)).toBe("webkit-touch");
  });

  it("tells iPadOS in desktop mode apart from a Mac by its touch points", () => {
    // iPadOS sends the macOS Safari UA; only maxTouchPoints differs.
    expect(dateInputEngine(UA.safariMac, 5)).toBe("webkit-touch");
    expect(dateInputEngine(UA.safariMac, 0)).toBe("webkit-desktop");
  });
});
