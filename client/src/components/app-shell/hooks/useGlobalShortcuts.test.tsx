/**
 * useGlobalShortcuts — the window-level key state machine: Cmd/Ctrl+K, `?`,
 * and the `g`-then-key chord with its G_NAV_TIMEOUT_MS window.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, fireEvent, cleanup } from "@testing-library/react";
import { G_NAV_TIMEOUT_MS } from "../constants";

const h = vi.hoisted(() => ({ push: vi.fn(), repoId: "repo-1" as string | null }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.push }) }));
vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ repoId: h.repoId }) }));

import { useGlobalShortcuts } from "./useGlobalShortcuts";

let onOpenPalette: ReturnType<typeof vi.fn>;
let onOpenHelp: ReturnType<typeof vi.fn>;

function mount() {
  return renderHook(() => useGlobalShortcuts({ onOpenPalette, onOpenHelp }));
}
const press = (key: string, init: KeyboardEventInit = {}, target: Element | Window = window) =>
  fireEvent.keyDown(target, { key, ...init });

beforeEach(() => {
  vi.useFakeTimers();
  h.push.mockClear();
  h.repoId = "repo-1";
  onOpenPalette = vi.fn();
  onOpenHelp = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("useGlobalShortcuts", () => {
  it("opens the palette on Cmd+K and Ctrl+K, and claims the key from the browser", () => {
    mount();
    const ev = new KeyboardEvent("keydown", { key: "k", metaKey: true, cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    press("K", { ctrlKey: true });
    expect(onOpenPalette).toHaveBeenCalledTimes(2);
  });

  it("opens the palette on Cmd+K even while typing in an input", () => {
    mount();
    const input = document.createElement("input");
    document.body.appendChild(input);
    press("k", { metaKey: true }, input);
    press("?", {}, input);
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
    expect(onOpenHelp).not.toHaveBeenCalled();
    input.remove();
  });

  it("opens shortcuts help on `?`", () => {
    mount();
    press("?");
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
  });

  it("navigates on `g` then a nav key, filling :repoId from the active repo", () => {
    mount();
    press("g");
    press("p");
    expect(h.push).toHaveBeenCalledWith("/repos/repo-1/pulls");
    press("g");
    press("a");
    expect(h.push).toHaveBeenLastCalledWith("/agents");
  });

  it("navigates to settings on `g` then `,`", () => {
    mount();
    press("g");
    press(",");
    expect(h.push).toHaveBeenCalledWith("/settings/api-keys");
  });

  it("ignores a nav key pressed without `g` first", () => {
    mount();
    press("p");
    expect(h.push).not.toHaveBeenCalled();
  });

  it("drops the chord once the timeout passes", () => {
    mount();
    press("g");
    vi.advanceTimersByTime(G_NAV_TIMEOUT_MS + 1);
    press("p");
    expect(h.push).not.toHaveBeenCalled();
  });

  it("keeps the chord alive just inside the timeout, and a second `g` restarts the window", () => {
    mount();
    press("g");
    vi.advanceTimersByTime(G_NAV_TIMEOUT_MS - 100);
    press("g");
    vi.advanceTimersByTime(G_NAV_TIMEOUT_MS - 100);
    press("p");
    expect(h.push).toHaveBeenCalledWith("/repos/repo-1/pulls");
  });

  it("consumes the chord on an unknown second key", () => {
    mount();
    press("g");
    press("x");
    press("p");
    expect(h.push).not.toHaveBeenCalled();
  });

  it("does not start a chord while typing in a text field", () => {
    mount();
    const area = document.createElement("textarea");
    document.body.appendChild(area);
    press("g", {}, area);
    press("p");
    expect(h.push).not.toHaveBeenCalled();
    area.remove();
  });

  it("stops listening on unmount", () => {
    const { unmount } = mount();
    unmount();
    press("k", { metaKey: true });
    press("g");
    press("p");
    expect(onOpenPalette).not.toHaveBeenCalled();
    expect(h.push).not.toHaveBeenCalled();
  });
});
