/**
 * useStickyOffset mirrors the sticky source's height into a CSS variable on the
 * target. Layout does not exist in jsdom, so offsetHeight and ResizeObserver are
 * stubbed; the contract under test is the wiring (late source mount, resize, cleanup).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { PR_HEADER_OFFSET_VAR } from "@/app/repos/[repoId]/pulls/[number]/constants";
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

function Harness({ showSource }: { showSource: boolean }) {
  const { setSource, setTarget } = useStickyOffset();
  return (
    <div>
      <main ref={setTarget} />
      {showSource && <header ref={setSource} />}
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
});
