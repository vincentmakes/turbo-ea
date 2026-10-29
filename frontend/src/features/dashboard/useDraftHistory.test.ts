import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { HISTORY_LIMIT, isEditableTarget, undoRedoAction, useDraftHistory } from "./useDraftHistory";

function setup<T>(initial: T) {
  return renderHook(() => useDraftHistory<T>(initial));
}

describe("useDraftHistory", () => {
  it("starts with nothing to undo or redo", () => {
    const { result } = setup([1]);
    expect(result.current.present).toEqual([1]);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it("steps back and forward through each change", () => {
    const { result } = setup("a");
    act(() => result.current.set("b"));
    act(() => result.current.set("c"));
    expect(result.current.present).toBe("c");
    expect(result.current.canUndo).toBe(true);

    act(() => result.current.undo());
    expect(result.current.present).toBe("b");
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.undo());
    expect(result.current.present).toBe("a");
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.undo());
    expect(result.current.present).toBe("a");

    act(() => result.current.redo());
    expect(result.current.present).toBe("b");
    act(() => result.current.redo());
    expect(result.current.present).toBe("c");
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.redo());
    expect(result.current.present).toBe("c");
    expect(result.current.canUndo).toBe(true);
  });

  it("clears what could be redone once a new change is made", () => {
    const { result } = setup(1);
    act(() => result.current.set(2));
    act(() => result.current.undo());
    expect(result.current.canRedo).toBe(true);
    act(() => result.current.set(3));
    expect(result.current.present).toBe(3);
    expect(result.current.canRedo).toBe(false);
    act(() => result.current.undo());
    expect(result.current.present).toBe(1);
  });

  it("ignores a value equal to the present one, such as the grid echoing its layout", () => {
    const { result } = setup([{ id: "a", layout: { x: 0, y: 0, w: 4, h: 3 } }]);
    act(() => result.current.set([{ id: "b", layout: { x: 0, y: 0, w: 4, h: 3 } }]));
    act(() => result.current.undo());
    const before = result.current.present;
    act(() => result.current.set([{ id: "a", layout: { x: 0, y: 0, w: 4, h: 3 } }]));
    expect(result.current.present).toBe(before);
    expect(result.current.canUndo).toBe(false);
    // The redo step survives an echo.
    expect(result.current.canRedo).toBe(true);
  });

  it("hands the updater form the current value", () => {
    const { result } = setup<number[] | null>(null);
    act(() => result.current.set((current) => [...(current ?? []), 1]));
    act(() => result.current.set((current) => [...(current ?? []), 2]));
    expect(result.current.present).toEqual([1, 2]);
    act(() => result.current.undo());
    expect(result.current.present).toEqual([1]);
  });

  it("reset replaces the value and forgets both directions", () => {
    const { result } = setup(0);
    act(() => result.current.set(1));
    act(() => result.current.set(2));
    act(() => result.current.undo());
    act(() => result.current.reset(9));
    expect(result.current.present).toBe(9);
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
  });

  it(`keeps only the last ${HISTORY_LIMIT} undo steps`, () => {
    expect(HISTORY_LIMIT).toBe(50);
    const { result } = setup(0);
    for (let i = 1; i <= HISTORY_LIMIT + 5; i++) act(() => result.current.set(i));
    let steps = 0;
    while (result.current.canUndo) {
      act(() => result.current.undo());
      steps++;
    }
    expect(steps).toBe(HISTORY_LIMIT);
    expect(result.current.present).toBe(5);
  });

  it("returns the same callbacks on every render", () => {
    const { result } = setup(0);
    const first = result.current;
    act(() => result.current.set(1));
    expect(result.current.set).toBe(first.set);
    expect(result.current.undo).toBe(first.undo);
    expect(result.current.redo).toBe(first.redo);
    expect(result.current.reset).toBe(first.reset);
  });
});

describe("undoRedoAction", () => {
  const key = (k: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>> = {}) => ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });

  it("reads Ctrl or Cmd + Z as undo", () => {
    expect(undoRedoAction(key("z", { ctrlKey: true }))).toBe("undo");
    expect(undoRedoAction(key("z", { metaKey: true }))).toBe("undo");
  });

  it("reads Ctrl or Cmd + Shift + Z and Ctrl or Cmd + Y as redo", () => {
    expect(undoRedoAction(key("Z", { ctrlKey: true, shiftKey: true }))).toBe("redo");
    expect(undoRedoAction(key("z", { metaKey: true, shiftKey: true }))).toBe("redo");
    expect(undoRedoAction(key("y", { ctrlKey: true }))).toBe("redo");
    expect(undoRedoAction(key("Y", { metaKey: true }))).toBe("redo");
  });

  it("ignores the keys without a modifier, with Alt, or any other key", () => {
    expect(undoRedoAction(key("z"))).toBeNull();
    expect(undoRedoAction(key("y", { shiftKey: true }))).toBeNull();
    expect(undoRedoAction(key("z", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(undoRedoAction(key("y", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(undoRedoAction(key("x", { ctrlKey: true }))).toBeNull();
  });
});

describe("isEditableTarget", () => {
  it("is true for text fields, selects and editable elements", () => {
    expect(isEditableTarget(document.createElement("input"))).toBe(true);
    expect(isEditableTarget(document.createElement("textarea"))).toBe(true);
    expect(isEditableTarget(document.createElement("select"))).toBe(true);
    const editable = document.createElement("div");
    // jsdom does not compute isContentEditable from the attribute.
    Object.defineProperty(editable, "isContentEditable", { value: true });
    expect(isEditableTarget(editable)).toBe(true);
  });

  it("is false for anything else", () => {
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(document.body)).toBe(false);
    expect(isEditableTarget(document)).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });
});
