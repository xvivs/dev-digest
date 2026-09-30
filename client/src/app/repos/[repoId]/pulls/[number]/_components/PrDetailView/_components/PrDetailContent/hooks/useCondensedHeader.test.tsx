/**
 * useCondensedHeader: layout union from matchMedia + one sentinel observer.
 * jsdom has neither IntersectionObserver nor matchMedia, so both are faked.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, cleanup, act } from "@testing-library/react";
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

let mobile = true;
beforeEach(() => {
  ios = [];
  mobile = true;
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: q === "(max-width: 767px)" ? mobile : false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let latest: ReturnType<typeof useCondensedHeader>;
function Harness({ withSentinel = true }: { withSentinel?: boolean }) {
  latest = useCondensedHeader();
  return <main>{withSentinel && <div data-testid="sentinel" ref={latest.setSentinel} />}</main>;
}
const io = () => ios[ios.length - 1]!;
const fire = (isIntersecting: boolean, top: number) =>
  act(() => io().cb([{ isIntersecting, boundingClientRect: { top } as DOMRectReadOnly, rootBounds: { top: 0 } as DOMRectReadOnly }]));

describe("useCondensedHeader", () => {
  it("desktop layout while not mobile", () => {
    mobile = false;
    render(<Harness />);
    expect(latest.layout).toBe("desktop");
  });

  it("mobile until the sentinel leaves through the top, condensed while it is gone, back when it returns", () => {
    const { container } = render(<Harness />);
    expect(latest.layout).toBe("mobile");
    expect(io().observed).toEqual([container.querySelector("[data-testid=sentinel]")]);
    expect(io().opts?.root).toBe(container.querySelector("main"));
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

  it("sets overflow-anchor: none on <main> while observing and restores it", () => {
    const { container, unmount } = render(<Harness />);
    const main = container.querySelector("main")!;
    expect(main.style.overflowAnchor).toBe("none");
    unmount();
    expect(io().disconnect).toHaveBeenCalled();
  });

  it("does not observe without a sentinel", () => {
    render(<Harness withSentinel={false} />);
    expect(ios).toHaveLength(0);
  });
});
