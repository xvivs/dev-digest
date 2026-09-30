import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup, fireEvent, within } from "@testing-library/react";
import { renderWithProviders } from "@/test/render";
import shellMessages from "../../../messages/en/shell.json";
import { AppShell } from "./AppShell";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("./hooks", async () => {
  const React = await import("react");
  return {
    useGlobalShortcuts: () => {},
    useShellCommands: () => [],
    useShellContext: ({ onOpenNav }: { onOpenNav: () => void }) =>
      React.useMemo(() => ({ onOpenNav, labels: { openNav: "Open navigation" } }), [onOpenNav]),
  };
});

afterEach(cleanup);

function renderShell() {
  return renderWithProviders(<AppShell>content</AppShell>, { namespaces: { shell: shellMessages } });
}

describe("AppShell mobile logo", () => {
  it("shows the logo in the header and the desktop sidebar, none in the drawer until opened", () => {
    renderShell();
    // topbar (centered, mobile) + sidebar (desktop)
    expect(screen.getAllByText("DevDigest")).toHaveLength(2);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("drawer header shows the logo, keeps its accessible name, hides the visible title", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    const dialog = screen.getByRole("dialog", { name: /Navigation/ });
    expect(within(dialog).getAllByText("DevDigest")).toHaveLength(1);
    expect(within(dialog).getByRole("heading")).toHaveTextContent("DevDigest");
    // the i18n string survives only as visually hidden text inside the heading
    expect(within(dialog).getByText("Navigation")).toHaveStyle({ position: "absolute", width: "1px" });
  });
});
