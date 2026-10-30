import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import {
  focusFieldControl,
  focusFirstControl,
  useEditRequest,
  type EditRequest,
} from "./useEditRequest";

type Props = { request: EditRequest | undefined; canAct: boolean; act: (r: EditRequest) => void };

function setup(initial: Partial<Props> = {}) {
  const act = vi.fn();
  const props: Props = { request: undefined, canAct: true, act, ...initial };
  const hook = renderHook((p: Props) => useEditRequest(p.request, p.canAct, p.act), {
    initialProps: props,
  });
  return { act, ...hook, props };
}

describe("useEditRequest", () => {
  it("ignores an undefined request", () => {
    const { act, rerender, props } = setup();
    expect(act).not.toHaveBeenCalled();
    rerender({ ...props, canAct: false });
    rerender({ ...props, canAct: true });
    expect(act).not.toHaveBeenCalled();
  });

  it("acts on a request it can act on, once, with the request", () => {
    const request = { nonce: 1 };
    const { act, rerender, props } = setup({ request });
    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledWith(request);
    rerender({ ...props });
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("acts again for each new request", () => {
    const first = { nonce: 1 };
    const second = { nonce: 2 };
    const { act, rerender, props } = setup({ request: first });
    rerender({ ...props, request: second });
    expect(act).toHaveBeenCalledTimes(2);
    expect(act).toHaveBeenLastCalledWith(second);
  });

  it("defers a request it cannot act on yet until it can", () => {
    const request = { nonce: 4 };
    const { act, rerender, props } = setup({ request, canAct: false });
    expect(act).not.toHaveBeenCalled();
    rerender({ ...props, canAct: true });
    expect(act).toHaveBeenCalledTimes(1);
    expect(act).toHaveBeenCalledWith(request);
  });

  it("never acts on a request it may never act on", () => {
    const { act, rerender, props } = setup({ request: { nonce: 5 }, canAct: false });
    rerender({ ...props });
    expect(act).not.toHaveBeenCalled();
  });

  it("never acts twice for one nonce, even when it can act again or gets a copy", () => {
    const request = { nonce: 7 };
    const { act, rerender, props } = setup({ request });
    rerender({ ...props, canAct: false });
    rerender({ ...props, canAct: true });
    rerender({ ...props, request: { nonce: 7 } });
    expect(act).toHaveBeenCalledTimes(1);
  });

  it("does not act again on a request it already acted on when it remounts", () => {
    // A Card-tab section remounts when the user comes back to the tab, with
    // the jump it already acted on still in its props.
    const request = { nonce: 8 };
    const first = setup({ request });
    first.unmount();
    const second = setup({ request });
    expect(first.act).toHaveBeenCalledTimes(1);
    expect(second.act).not.toHaveBeenCalled();
  });

  it("calls the latest act", () => {
    const request = { nonce: 9 };
    const stale = vi.fn();
    const latest = vi.fn();
    const { rerender } = renderHook((p: Props) => useEditRequest(p.request, p.canAct, p.act), {
      initialProps: { request, canAct: false, act: stale } as Props,
    });
    rerender({ request, canAct: true, act: latest });
    expect(stale).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith(request);
  });
});

describe("focusFirstControl", () => {
  function mount(html: string) {
    const root = document.createElement("div");
    root.innerHTML = html;
    document.body.appendChild(root);
    return root;
  }

  it("focuses the first control a person can tab to", () => {
    const root = mount(
      '<span>label</span><input tabindex="-1" id="hidden" /><input disabled id="off" />' +
        '<div role="combobox" tabindex="0" id="select"></div><input id="after" />',
    );
    expect(focusFirstControl(root)).toBe(true);
    expect(document.activeElement?.id).toBe("select");
    root.remove();
  });

  it("finds inputs, textareas, selects and buttons", () => {
    for (const html of [
      '<input id="x" />',
      '<textarea id="x"></textarea>',
      '<select id="x"><option>a</option></select>',
      '<button id="x">b</button>',
      '<div tabindex="0" id="x"></div>',
    ]) {
      const root = mount(html);
      expect(focusFirstControl(root)).toBe(true);
      expect(document.activeElement?.id).toBe("x");
      root.remove();
    }
  });

  it("focuses nothing when there is nothing to focus", () => {
    const root = mount('<span>text</span><input tabindex="-1" />');
    (document.activeElement as HTMLElement | null)?.blur();
    expect(focusFirstControl(root)).toBe(false);
    expect(document.activeElement).toBe(document.body);
    expect(focusFirstControl(null)).toBe(false);
    expect(focusFirstControl(undefined)).toBe(false);
    root.remove();
  });
});

describe("focusFieldControl", () => {
  it("focuses the control inside the wrapper carrying the field key", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<div data-field-key="a"><input id="a" /></div>' +
      '<div data-field-key="b.c"><input id="bc" /></div>';
    document.body.appendChild(root);
    expect(focusFieldControl(root, "b.c")).toBe(true);
    expect(document.activeElement?.id).toBe("bc");
    expect(focusFieldControl(root, "missing")).toBe(false);
    expect(document.activeElement?.id).toBe("bc");
    expect(focusFieldControl(null, "a")).toBe(false);
    root.remove();
  });
});
