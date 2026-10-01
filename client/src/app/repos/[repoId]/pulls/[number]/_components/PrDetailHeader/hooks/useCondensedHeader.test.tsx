/**
 * useCondensedHeader: layout union from `mobile` + one sentinel observer.
 * jsdom has no IntersectionObserver, so it is faked.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, cleanup, act, screen } from "@testing-library/react";
import { useCondensedHeader } from "./useCondensedHeader";

type Entry = Partial<IntersectionObserverEntry>;
let ios: FakeIO[] = [];
class FakeIO {
  observed: Element[] = [];
  disconnect = vi.fn();
  constructor(
    public cb: (e: Entry[]) => void,
    public opts?: IntersectionObserverInit,
  ) {
    ios.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
}


beforeEach(() => {
  ios = [];
  vi.stubGlobal("IntersectionObserver", FakeIO);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let latest: ReturnType<typeof useCondensedHeader>;
function Harness({
  withSentinel = true,
  isMobile = true,
  anchor,
}: {
  withSentinel?: boolean;
  isMobile?: boolean;
  anchor?: React.CSSProperties["overflowAnchor"];
}) {
  latest = useCondensedHeader(isMobile);
  return (
    <main style={anchor ? { overflowAnchor: anchor } : undefined}>
      {withSentinel && <div data-testid="sentinel" ref={latest.setSentinel} />}
    </main>
  );
}
const io = () => ios[ios.length - 1]!;
const fire = (isIntersecting: boolean, top: number) =>
  act(() => io().cb([{ isIntersecting, boundingClientRect: { top } as DOMRectReadOnly, rootBounds: { top: 0 } as DOMRectReadOnly }]));

describe("useCondensedHeader", () => {
  it("desktop layout while not mobile", () => {
    render(<Harness isMobile={false} />);
    expect(latest.layout).toBe("desktop");
  });

  it("mobile until the sentinel leaves through the top, condensed while it is gone, back when it returns", () => {
    render(<Harness />);
    expect(latest.layout).toBe("mobile");
    // The observer watches the sentinel and nothing else.
    expect(io().observed).toEqual([screen.getByTestId("sentinel")]);
    fire(false, -5);
    expect(latest.layout).toBe("condensed");
    fire(true, 10);
    expect(latest.layout).toBe("mobile");
  });

  it("stays mobile when the sentinel is out of view BELOW the root", () => {
    render(<Harness />);
    fire(false, 900);
    expect(latest.layout).toBe("mobile");
  });

  it("sets overflow-anchor: none on <main> while observing and restores the prior value on unmount", () => {
    const { unmount } = render(<Harness anchor="auto" />);
    const main = screen.getByRole("main");
    expect(main.style.overflowAnchor).toBe("none");
    unmount();
    expect(io().disconnect).toHaveBeenCalled();
    expect(main.style.overflowAnchor).toBe("auto");
  });

  it("restores overflow-anchor when the sentinel goes away while <main> stays mounted", () => {
    const { rerender } = render(<Harness anchor="auto" />);
    const main = screen.getByRole("main");
    expect(main.style.overflowAnchor).toBe("none");
    rerender(<Harness anchor="auto" withSentinel={false} />);
    expect(main.style.overflowAnchor).toBe("auto");
  });

  it("does not observe without a sentinel", () => {
    render(<Harness withSentinel={false} />);
    expect(ios).toHaveLength(0);
  });
});
