/**
 * useHeaderCollapse: sentinel-driven hysteresis. jsdom has neither layout,
 * IntersectionObserver nor matchMedia, so all three are faked; the contract is
 * the wiring (collapse above 120, expand below 40, nothing in between, mobile gate).
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { render, cleanup, act } from "@testing-library/react";
import { useHeaderCollapse } from "./useHeaderCollapse";

type IOCallback = (entries: Partial<IntersectionObserverEntry>[]) => void;
let ios: FakeIO[] = [];
class FakeIO {
  observed: Element[] = [];
  disconnect = vi.fn();
  constructor(public cb: IOCallback) {
    ios.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
}

let matches: Record<string, boolean> = {};
beforeEach(() => {
  ios = [];
  matches = { "(max-width: 767px)": true, "(prefers-reduced-motion: reduce)": false };
  vi.stubGlobal("IntersectionObserver", FakeIO);
  vi.stubGlobal("matchMedia", (q: string) => ({
    matches: matches[q] ?? false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

let latest: ReturnType<typeof useHeaderCollapse>;
function Harness() {
  latest = useHeaderCollapse();
  return (
    <main>
      <div data-testid="collapse" ref={latest.setCollapseSentinel} />
      <div data-testid="expand" ref={latest.setExpandSentinel} />
    </main>
  );
}

const io = () => ios[ios.length - 1]!;
const target = (id: string) => document.querySelector(`[data-testid=${id}]`)!;
// `top` is relative to the root: negative = above the scroll container's top edge.
const fire = (id: string, isIntersecting: boolean, top = -10) =>
  act(() => io().cb([{ target: target(id), isIntersecting, boundingClientRect: { top } as DOMRectReadOnly, rootBounds: { top: 0 } as DOMRectReadOnly }]));

describe("useHeaderCollapse", () => {
  it("observes both sentinels, rooted on <main>", () => {
    render(<Harness />);
    expect(io().observed).toEqual([target("collapse"), target("expand")]);
    expect(latest.compact).toBe(false);
  });

  it("collapses past the upper threshold, holds between, expands below the lower one", () => {
    render(<Harness />);
    fire("collapse", false);
    expect(latest.compact).toBe(true);
    // Scrolling back up past the 120 marker alone does not expand (hysteresis).
    fire("collapse", true);
    expect(latest.compact).toBe(true);
    fire("expand", true);
    expect(latest.compact).toBe(false);
  });

  it("ignores a collapse sentinel that is out of view BELOW the root", () => {
    render(<Harness />);
    fire("collapse", false, 900);
    expect(latest.compact).toBe(false);
  });

  it("never compacts on desktop, even after the sentinels fire", () => {
    matches["(max-width: 767px)"] = false;
    render(<Harness />);
    fire("collapse", false);
    expect(latest.mobile).toBe(false);
    expect(latest.compact).toBe(false);
  });

  it("reports prefers-reduced-motion", () => {
    matches["(prefers-reduced-motion: reduce)"] = true;
    render(<Harness />);
    expect(latest.reducedMotion).toBe(true);
  });

  it("disconnects on unmount", () => {
    const { unmount } = render(<Harness />);
    const current = io();
    unmount();
    expect(current.disconnect).toHaveBeenCalled();
  });
});
