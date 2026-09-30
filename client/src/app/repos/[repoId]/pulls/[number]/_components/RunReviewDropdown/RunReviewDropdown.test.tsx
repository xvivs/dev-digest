import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import prReview from "@/../messages/en/prReview.json";
import { renderWithProviders } from "@/test/render";

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: vi.fn() }),
}));

type Agent = { id: string; name: string; model: string; enabled: boolean };
let agents: Agent[] = [];
vi.mock("@/lib/hooks/agents", () => ({
  useAgents: () => ({ data: agents }),
}));

const mutateAsync = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  useRunReview: () => ({ mutateAsync, isPending: false }),
}));

import { RunReviewDropdown } from "./RunReviewDropdown";

afterEach(() => {
  cleanup();
  agents = [];
  push.mockReset();
  mutateAsync.mockReset();
});

const renderDropdown = (ui: React.ReactElement) => renderWithProviders(ui, { namespaces: { prReview } });

const openMenu = () => fireEvent.click(screen.getByRole("button", { name: /Run Review/ }));

describe("RunReviewDropdown", () => {
  it("renders the trigger label", () => {
    renderDropdown(<RunReviewDropdown prId="pr1" />);
    expect(screen.getByText("Run Review")).toBeInTheDocument();
  });

  it("lists every agent, marking disabled ones, and runs the one picked", async () => {
    agents = [
      { id: "a1", name: "Security", model: "gpt-4.1", enabled: true },
      { id: "a2", name: "Style", model: "haiku", enabled: false },
    ];
    mutateAsync.mockResolvedValue({ runs: [{ run_id: "run-9" }] });
    const onRunStart = vi.fn();
    const onRunsStarted = vi.fn();
    const onRunSettled = vi.fn();
    renderDropdown(
      <RunReviewDropdown prId="pr1" onRunStart={onRunStart} onRunsStarted={onRunsStarted} onRunSettled={onRunSettled} />,
    );

    openMenu();
    expect(screen.getByRole("menuitem", { name: /Run all enabled agents/ })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /Security gpt-4\.1/ })).toBeInTheDocument();
    expect(screen.getByText("haiku · disabled")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("menuitem", { name: /Style/ }));
    expect(onRunStart).toHaveBeenCalledTimes(1);
    expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", agentId: "a2" });
    await waitFor(() => expect(onRunsStarted).toHaveBeenCalledWith(["run-9"]));
    expect(onRunSettled).toHaveBeenCalledTimes(1);
  });

  it("'Run all' asks for every enabled agent", () => {
    agents = [{ id: "a1", name: "Security", model: "gpt-4.1", enabled: true }];
    mutateAsync.mockResolvedValue({ runs: [] });
    renderDropdown(<RunReviewDropdown prId="pr1" />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /Run all enabled agents/ }));
    expect(mutateAsync).toHaveBeenCalledWith({ prId: "pr1", all: true });
  });

  it("with no agents, offers to create one and routes to /agents", () => {
    renderDropdown(<RunReviewDropdown prId="pr1" />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: /No agents yet — create one/ }));
    expect(push).toHaveBeenCalledWith("/agents");
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it("warns first on a merged/closed PR", () => {
    renderDropdown(<RunReviewDropdown prId="pr1" warnMerged />);
    openMenu();
    expect(screen.getByText("Already merged — review is informational")).toBeInTheDocument();
  });

  it("iconOnlyBelowMd keeps ONE button: label behind the hide utility, plus aria-label and title", () => {
    renderDropdown(<RunReviewDropdown prId="pr1" iconOnlyBelowMd />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveAttribute("aria-label", "Run Review");
    expect(buttons[0]).toHaveAttribute("title", "Run Review");
    expect(buttons[0]!.querySelector(".dd-hide-below-md")).toHaveTextContent("Run Review");
  });

  it("without the prop the trigger is unchanged: plain label, no aria-label/title", () => {
    renderDropdown(<RunReviewDropdown prId="pr1" />);
    const button = screen.getByRole("button");
    expect(button).not.toHaveAttribute("aria-label");
    expect(button).not.toHaveAttribute("title");
    expect(button.querySelector(".dd-hide-below-md")).toBeNull();
  });
});
