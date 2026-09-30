/**
 * useStickyOffset mirrors the sticky source's height into a CSS variable on the
 * target. Layout does not exist in jsdom, so offsetHeight and ResizeObserver are
 * stubbed; the contract under test is the wiring (late source mount, resize, cleanup).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, cleanup, act } from "@testing-library/react";
import { PR_HEADER_FULL_OFFSET_VAR, PR_HEADER_OFFSET_VAR } from "@/app/repos/[repoId]/pulls/[number]/constants";
import { useStickyOffset } from "./useStickyOffset";

let height = 40;
let observers: FakeRO[] = [];
class FakeRO {
  disconnect = vi.fn();
  observe = vi.fn();
  constructor(public cb: () => void) {
    observers.push(this);
  }
}

beforeEach(() => {
  height = 40;
  observers = [];
  vi.stubGlobal("ResizeObserver", FakeRO);
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(() => height);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function Harness({ showSource, compact }: { showSource: boolean; compact?: boolean }) {
  const { setSource, setTarget } = useStickyOffset();
  return (
    <div>
      <main ref={setTarget} />
      {showSource && <header ref={setSource} data-compact={compact ? "true" : "false"} />}
    </div>
  );
}

const offset = () => document.querySelector<HTMLElement>("main")!.style.getPropertyValue(PR_HEADER_OFFSET_VAR);

describe("useStickyOffset", () => {
  it("writes the source height to the target, also when the source mounts later (loading early return)", () => {
    const { rerender } = render(<Harness showSource={false} />);
    expect(offset()).toBe("");
    rerender(<Harness showSource />);
    expect(offset()).toBe("40px");
  });

  it("re-writes on resize and disconnects the observer on unmount", () => {
    const { unmount } = render(<Harness showSource />);
    const ro = observers[observers.length - 1]!;
    height = 72;
    ro.cb();
    expect(offset()).toBe("72px");
    unmount();
    expect(ro.disconnect).toHaveBeenCalled();
  });

  it("stops observing when the source goes away", () => {
    const { rerender } = render(<Harness showSource />);
    const ro = observers[observers.length - 1]!;
    rerender(<Harness showSource={false} />);
    expect(ro.disconnect).toHaveBeenCalled();
  });

  describe("full (expanded) height var", () => {
    const full = () => document.querySelector<HTMLElement>("main")!.style.getPropertyValue(PR_HEADER_FULL_OFFSET_VAR);
    const header = () => document.querySelector("header")!;
    const transition = (type: string, propertyName: string) => {
      const e = new Event(type, { bubbles: true }) as Event & { propertyName: string };
      e.propertyName = propertyName;
      act(() => void header().dispatchEvent(e));
    };

    it("tracks the live height while expanded", () => {
      render(<Harness showSource />);
      height = 190;
      observers[observers.length - 1]!.cb();
      expect(full()).toBe("190px");
    });

    it("freezes while compact, while the live var keeps following", () => {
      const { rerender } = render(<Harness showSource />);
      height = 190;
      observers[observers.length - 1]!.cb();
      rerender(<Harness showSource compact />);
      height = 80;
      observers[observers.length - 1]!.cb();
      expect(offset()).toBe("80px");
      expect(full()).toBe("190px");
    });

    it("stays frozen mid expand-transition and snaps to the real height when it ends", () => {
      const { rerender } = render(<Harness showSource compact />);
      height = 190;
      rerender(<Harness showSource />);
      transition("transitionrun", "grid-template-rows");
      height = 120;
      observers[observers.length - 1]!.cb();
      expect(full()).not.toBe("120px");
      height = 190;
      transition("transitionend", "grid-template-rows");
      expect(full()).toBe("190px");
    });

    it("ignores unrelated transitions (button hover) for the freeze", () => {
      render(<Harness showSource />);
      transition("transitionrun", "background-color");
      height = 150;
      observers[observers.length - 1]!.cb();
      expect(full()).toBe("150px");
    });
  });
});
