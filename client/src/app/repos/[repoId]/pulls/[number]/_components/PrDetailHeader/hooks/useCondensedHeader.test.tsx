/**
 * useCondensedHeader: layout union from `mobile` + one sentinel observer.
 * jsdom has no IntersectionObserver, so it is faked and driven by hand.
 * The overflow-anchor guard on <main> is browser-verified (0px scroll deviation
 * at 10px steps, see the Smart Diff spec), not asserted on inline styles here.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, cleanup, act, screen } from "@testing-library/react";
import { useCondensedHeader } from "./useCondensedHeader";

type Entry = Partial<IntersectionObserverEntry>;
let callbacks: Array<(e: Entry[]) => void> = [];
class FakeIO {
  constructor(cb: (e: Entry[]) => void) {
    callbacks.push(cb);
  }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  callbacks = [];
  vi.stubGlobal("IntersectionObserver", FakeIO);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Harness({ withSentinel = true, isMobile = true }: { withSentinel?: boolean; isMobile?: boolean }) {
  const { layout, setSentinel } = useCondensedHeader(isMobile);
  return (
    <main>
      <p role="status">{layout}</p>
      {withSentinel && <div role="separator" aria-label="sentinel" ref={setSentinel} />}
    </main>
  );
}
const layout = () => screen.getByRole("status").textContent;
const fire = (isIntersecting: boolean, top: number) =>
  act(() =>
    callbacks[callbacks.length - 1]!([
      { isIntersecting, boundingClientRect: { top } as DOMRectReadOnly, rootBounds: { top: 0 } as DOMRectReadOnly },
    ]),
  );

describe("useCondensedHeader", () => {
  it("desktop layout while not mobile", () => {
    render(<Harness isMobile={false} />);
    expect(layout()).toBe("desktop");
  });

  it("mobile until the sentinel leaves through the top, condensed while it is gone, back when it returns", () => {
    render(<Harness />);
    expect(layout()).toBe("mobile");
    fire(false, -5);
    expect(layout()).toBe("condensed");
    fire(true, 10);
    expect(layout()).toBe("mobile");
  });

  it("stays mobile when the sentinel is out of view BELOW the root", () => {
    render(<Harness />);
    fire(false, 900);
    expect(layout()).toBe("mobile");
  });

  it("starts tracking once the sentinel mounts late (after a loading return)", () => {
    const { rerender } = render(<Harness withSentinel={false} />);
    expect(layout()).toBe("mobile");
    rerender(<Harness withSentinel />);
    fire(false, -5);
    expect(layout()).toBe("condensed");
  });

  it("after unmount a late observer report changes nothing and warns about nothing", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { unmount } = render(<Harness />);
    unmount();
    expect(() => fire(false, -5)).not.toThrow();
    expect(error).not.toHaveBeenCalled();
  });
});
