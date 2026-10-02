/**
 * Browser APIs jsdom lacks (or implements as no-ops), installed per test.
 *
 * Every `install*` returns a restore function for `afterEach`/`afterAll`.
 * They are deliberately not global in `setup.ts`: a test that needs
 * `ResizeObserver` or a canvas says so, and the rest of the suite keeps
 * running against jsdom as it is.
 */
import { vi, type Mock } from "vitest";

type Restore = () => void;

function defineGlobal(name: string, value: unknown): Restore {
  const target = globalThis as Record<string, unknown>;
  const had = Object.prototype.hasOwnProperty.call(target, name);
  const previous = target[name];
  Object.defineProperty(target, name, { value, configurable: true, writable: true });
  return () => {
    if (had) Object.defineProperty(target, name, { value: previous, configurable: true, writable: true });
    else delete target[name];
  };
}

/** A `ResizeObserver` that never fires; `observe` calls are recorded. */
export function installResizeObserver(): Restore & { observed: Element[] } {
  const observed: Element[] = [];
  class FakeResizeObserver {
    observe(el: Element) {
      observed.push(el);
    }
    unobserve() {}
    disconnect() {}
  }
  const restore = defineGlobal("ResizeObserver", FakeResizeObserver);
  return Object.assign(restore, { observed });
}

/** An `IntersectionObserver` that reports every target as visible on `observe`. */
export function installIntersectionObserver(visible = true): Restore {
  class FakeIntersectionObserver {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(el: Element) {
      this.cb(
        [{ isIntersecting: visible, target: el } as IntersectionObserverEntry],
        this as unknown as IntersectionObserver,
      );
    }
    unobserve() {}
    disconnect() {}
    takeRecords(): IntersectionObserverEntry[] {
      return [];
    }
  }
  return defineGlobal("IntersectionObserver", FakeIntersectionObserver);
}

/** `URL.createObjectURL` / `revokeObjectURL`, recording every blob handed over. */
export function installObjectUrl(): Restore & { created: Blob[]; revoked: string[] } {
  const created: Blob[] = [];
  const revoked: string[] = [];
  const prevCreate = URL.createObjectURL;
  const prevRevoke = URL.revokeObjectURL;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    created.push(blob);
    return `blob:test/${created.length}`;
  }) as typeof URL.createObjectURL;
  URL.revokeObjectURL = vi.fn((url: string) => {
    revoked.push(url);
  }) as typeof URL.revokeObjectURL;
  const restore = () => {
    URL.createObjectURL = prevCreate;
    URL.revokeObjectURL = prevRevoke;
  };
  return Object.assign(restore, { created, revoked });
}

/**
 * A writable `navigator.clipboard`. Must run before `userEvent.setup()`, which
 * installs a getter-only property that a later `Object.assign` would throw on.
 */
export function installClipboard(): Restore & { writeText: Mock; readText: Mock } {
  const writeText = vi.fn(async (_text: string) => {});
  const readText = vi.fn(async () => "");
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText, readText },
    configurable: true,
    writable: true,
  });
  const restore = () => {
    if (descriptor) Object.defineProperty(navigator, "clipboard", descriptor);
    else delete (navigator as unknown as Record<string, unknown>).clipboard;
  };
  return Object.assign(restore, { writeText, readText });
}

export interface RectLike {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

function toDomRect(r: RectLike): DOMRect {
  const x = r.x ?? 0;
  const y = r.y ?? 0;
  const width = r.width ?? 0;
  const height = r.height ?? 0;
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON: () => ({ x, y, width, height }),
  } as DOMRect;
}

/** Pin one element's `getBoundingClientRect`. */
export function stubRects(el: Element, rect: RectLike): Restore {
  const spy = vi.spyOn(el, "getBoundingClientRect").mockReturnValue(toDomRect(rect));
  return () => spy.mockRestore();
}

/**
 * Pin `getBoundingClientRect` for every element matching a selector, the n-th
 * match taking the n-th rect (the last rect repeats). Elements matching no
 * selector keep jsdom's zero rect. Enough for @dnd-kit's `closestCenter` and
 * the report exporter's row boundaries.
 */
export function stubRectsBySelector(map: Record<string, RectLike[]>): Restore {
  const original = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    for (const [selector, rects] of Object.entries(map)) {
      if (!this.matches(selector)) continue;
      const all = Array.from(document.querySelectorAll(selector));
      const index = all.indexOf(this);
      const rect = rects[Math.min(index < 0 ? 0 : index, rects.length - 1)];
      if (rect) return toDomRect(rect);
    }
    return original.call(this);
  };
  return () => {
    Element.prototype.getBoundingClientRect = original;
  };
}

/** `document.elementFromPoint`, which jsdom does not implement. */
export function installElementFromPoint(fn: (x: number, y: number) => Element | null): Restore {
  const doc = document as unknown as Record<string, unknown>;
  const previous = doc.elementFromPoint;
  doc.elementFromPoint = fn;
  return () => {
    doc.elementFromPoint = previous;
  };
}

/** A recording 2D canvas context plus a fixed `toDataURL`. */
export function installCanvas(dataUrl = "data:image/png;base64,AAA"): Restore & {
  context: Record<string, Mock>;
} {
  const context: Record<string, Mock> = {
    drawImage: vi.fn(),
    fillRect: vi.fn(),
    clearRect: vi.fn(),
    fillText: vi.fn(),
    measureText: vi.fn(() => ({ width: 10 })),
    getImageData: vi.fn((_x: number, _y: number, w: number, h: number) => ({
      data: new Uint8ClampedArray(w * h * 4),
      width: w,
      height: h,
    })),
    putImageData: vi.fn(),
    scale: vi.fn(),
    translate: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
  };
  const getContext = vi
    .spyOn(HTMLCanvasElement.prototype, "getContext")
    .mockImplementation(() => context as unknown as CanvasRenderingContext2D);
  const toDataURL = vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(dataUrl);
  const restore = () => {
    getContext.mockRestore();
    toDataURL.mockRestore();
  };
  return Object.assign(restore, { context });
}

/**
 * A global `Image` whose `src` setter fires `onload` (or `onerror` when
 * `fail`) on a microtask, with the given natural size. jsdom never loads
 * images, so code awaiting `onload` would otherwise hang.
 */
export function installImage(opts: { width?: number; height?: number; fail?: boolean } = {}): Restore {
  const { width = 800, height = 600, fail = false } = opts;
  class FakeImage {
    onload: (() => void) | null = null;
    onerror: ((e?: unknown) => void) | null = null;
    naturalWidth = width;
    naturalHeight = height;
    width = width;
    height = height;
    crossOrigin: string | null = null;
    private _src = "";
    get src() {
      return this._src;
    }
    set src(value: string) {
      this._src = value;
      queueMicrotask(() => {
        if (fail) this.onerror?.(new Error("image failed"));
        else this.onload?.();
      });
    }
    addEventListener(name: string, fn: () => void) {
      if (name === "load") this.onload = fn;
      if (name === "error") this.onerror = fn;
    }
    removeEventListener() {}
    decode() {
      return fail ? Promise.reject(new Error("image failed")) : Promise.resolve();
    }
  }
  return defineGlobal("Image", FakeImage);
}

/** `window.open` as a spy returning `null` (a popup nobody can reach). */
export function installWindowOpen(): Mock {
  return vi.spyOn(window, "open").mockReturnValue(null) as unknown as Mock;
}

/** `window.confirm` answering `result` every time. */
export function installConfirm(result = true): Mock {
  return vi.spyOn(window, "confirm").mockReturnValue(result) as unknown as Mock;
}
