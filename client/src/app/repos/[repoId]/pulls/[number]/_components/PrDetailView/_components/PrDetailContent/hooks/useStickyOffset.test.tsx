/**
 * useStickyOffset mirrors the sticky source's height into a CSS variable on the
 * target. Layout does not exist in jsdom, so offsetHeight and ResizeObserver are
 * stubbed; the contract under test is the wiring (late source mount, resize, cleanup),
 * observed through the CSS variable the hook writes.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, cleanup } from "@testing-library/react";
import { PR_HEADER_OFFSET_VAR } from "@/app/repos/[repoId]/pulls/[number]/constants";
import { useStickyOffset } from "./useStickyOffset";

let height = 40;
let observers: FakeRO[] = [];
/** Like the real one: reports only while it observes something and has not been disconnected. */
class FakeRO {
  active = false;
  constructor(public cb: () => void) {
    observers.push(this);
  }
  observe() {
    this.active = true;
  }
  disconnect() {
    this.active = false;
  }
}
/** Layout changed: every live observer reports. */
const resize = (to: number) => {
  height = to;
  observers.filter((o) => o.active).forEach((o) => o.cb());
};

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

  it("re-writes on resize and stops following the source after unmount", () => {
    const { unmount } = render(<Harness showSource />);
    const main = document.querySelector<HTMLElement>("main")!;
    resize(72);
    expect(offset()).toBe("72px");
    unmount();
    resize(99);
    expect(main.style.getPropertyValue(PR_HEADER_OFFSET_VAR)).toBe("72px");
  });

  it("stops following the source when it goes away", () => {
    const { rerender } = render(<Harness showSource />);
    rerender(<Harness showSource={false} />);
    resize(99);
    expect(offset()).toBe("40px");
  });

  it("writes a constant and measures nothing when given a fixed height (mobile bar)", () => {
    function Fixed() {
      const { setSource, setTarget } = useStickyOffset(88);
      return (
        <div>
          <main ref={setTarget} />
          <header ref={setSource} />
        </div>
      );
    }
    render(<Fixed />);
    expect(offset()).toBe("88px");
    resize(120);
    expect(offset()).toBe("88px");
  });
});
