/** useShellCommands — the command-palette command set built from NAV + extras. */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { renderHook, cleanup } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import shellMessages from "../../../../messages/en/shell.json";

const h = vi.hoisted(() => {
  const push = vi.fn();
  // One router object for every render, the way Next's app router behaves.
  return { push, router: { push }, toggle: vi.fn(), theme: "dark" as "dark" | "light" };
});

vi.mock("next/navigation", () => ({ useRouter: () => h.router }));
vi.mock("@/lib/repo-context", () => ({ useActiveRepo: () => ({ repoId: "repo-1" }) }));
vi.mock("@/lib/theme", () => ({ useTheme: () => ({ theme: h.theme, toggle: h.toggle }) }));

import { useShellCommands } from "./useShellCommands";

// Module-level: a fresh messages object per render would hand out a new `t`.
const MESSAGES = { shell: shellMessages };

function wrapper({ children }: { children: ReactNode }) {
  return (
    <NextIntlClientProvider locale="en" messages={MESSAGES}>
      {children}
    </NextIntlClientProvider>
  );
}
const mount = () => renderHook(() => useShellCommands(), { wrapper });

beforeEach(() => {
  h.push.mockClear();
  h.toggle.mockClear();
  h.theme = "dark";
});
afterEach(cleanup);

describe("useShellCommands", () => {
  it("builds one translated 'Go to' command per nav item, then settings and the theme toggle", () => {
    const { result } = mount();
    expect(result.current.map((c) => [c.id, c.label])).toEqual([
      ["pulls", "Go to Pull Requests"],
      ["skills", "Go to Skills"],
      ["agents", "Go to Agents"],
      ["settings", "Go to Settings"],
      ["toggle-theme", "Switch to light theme"],
    ]);
  });

  it("runs nav commands against the active repo", () => {
    const { result } = mount();
    result.current.find((c) => c.id === "pulls")?.run();
    expect(h.push).toHaveBeenCalledWith("/repos/repo-1/pulls");
    result.current.find((c) => c.id === "settings")?.run();
    expect(h.push).toHaveBeenLastCalledWith("/settings/api-keys");
  });

  it("offers the opposite theme and toggles it", () => {
    h.theme = "light";
    const { result } = mount();
    const cmd = result.current.find((c) => c.id === "toggle-theme");
    expect(cmd?.label).toBe("Switch to dark theme");
    expect(cmd?.icon).toBe("Moon");
    cmd?.run();
    expect(h.toggle).toHaveBeenCalledTimes(1);
  });

  it("returns the same array across renders when nothing changed", () => {
    const { result, rerender } = mount();
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});
