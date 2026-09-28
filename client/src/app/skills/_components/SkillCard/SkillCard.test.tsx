import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import type { SkillListItem } from "@devdigest/shared";
import { renderWithProviders } from "@/test/render";
import messages from "../../../../../messages/en/skills.json";
import shellMessages from "../../../../../messages/en/shell.json";

const h = vi.hoisted(() => ({
  updateMutate: vi.fn(),
  vetMutateAsync: vi.fn().mockResolvedValue(undefined),
  pushMock: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: h.pushMock }) }));
vi.mock("@/lib/hooks", () => ({
  useUpdateSkill: () => ({
    mutate: h.updateMutate,
    mutateAsync: h.updateMutate,
    isPending: false,
  }),
  useVetSkill: () => ({ mutateAsync: h.vetMutateAsync, isPending: false }),
}));

import { SkillCard } from "./SkillCard";

const SKILL: SkillListItem = {
  id: "sk1",
  name: "branch-coverage-gate",
  description: "Flags untested branches on new conditionals.",
  type: "rubric",
  source: "manual",
  body: "# Rule\nCheck every branch.",
  enabled: true,
  version: 1,
  needs_vetting: false,
  agent_count: 2,
};

const renderCard = (ui: React.ReactElement) =>
  renderWithProviders(ui, {
    namespaces: { skills: messages, shell: shellMessages },
  });

beforeEach(() => {
  h.updateMutate.mockReset();
  h.vetMutateAsync.mockReset().mockResolvedValue(undefined);
  h.pushMock.mockReset();
});
afterEach(cleanup);

describe("SkillCard", () => {
  it("renders name, type, source, description and agent count", () => {
    renderCard(<SkillCard skill={SKILL} />);
    expect(screen.getByText("branch-coverage-gate")).toBeInTheDocument();
    expect(screen.getByText("rubric")).toBeInTheDocument();
    expect(screen.getByText("Manual")).toBeInTheDocument();
    expect(screen.getByText("Flags untested branches on new conditionals.")).toBeInTheDocument();
    expect(screen.getByText("2 agents")).toBeInTheDocument();
  });

  it("summarises usage and impact: N agents · M runs · no evals", () => {
    renderCard(<SkillCard skill={{ ...SKILL, runs_30d: 142, latest_verdict: null }} />);
    const stats = screen.getByRole("group", { name: "Usage and impact" });
    expect(stats).toHaveTextContent("2 agents·142 runs·no evals");
    expect(screen.getByText("142 runs")).toHaveAttribute("title", "Completed runs that used this skill in the last 30 days");
  });

  it("shows the latest full verdict, its carrier and a stale marker", () => {
    renderCard(
      <SkillCard
        skill={{ ...SKILL, runs_30d: 1, latest_verdict: { verdict: "helps", carrier_name: "Strict reviewer", stale: true } }}
      />,
    );
    expect(screen.getByText("1 run")).toBeInTheDocument();
    expect(screen.getByText("Helps").closest("[title]")).toHaveAttribute("title", "Latest full eval on Strict reviewer");
    expect(screen.getByText("stale")).toBeInTheDocument();
    expect(screen.queryByText("no evals")).not.toBeInTheDocument();
  });

  it("leaves runs and verdict out when an older server does not send them", () => {
    renderCard(<SkillCard skill={SKILL} />);
    expect(screen.getByRole("group", { name: "Usage and impact" })).toHaveTextContent(/^2 agents$/);
  });

  it("falls back to a translated placeholder when description is empty", () => {
    renderCard(<SkillCard skill={{ ...SKILL, description: "" }} />);
    expect(screen.getByText("No description")).toBeInTheDocument();
  });

  it("shows a needs-vetting badge for an unvetted skill", () => {
    renderCard(<SkillCard skill={{ ...SKILL, needs_vetting: true }} />);
    expect(screen.getByText("needs vetting")).toBeInTheDocument();
  });

  it("toggling an already-vetted skill enables it directly", () => {
    renderCard(<SkillCard skill={{ ...SKILL, enabled: false }} />);
    fireEvent.click(screen.getByRole("switch", { name: "Enable branch-coverage-gate" }));
    expect(h.updateMutate).toHaveBeenCalledWith({
      id: "sk1",
      patch: { enabled: true },
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("turning on an unvetted skill opens Review & trust instead of enabling it", () => {
    renderCard(<SkillCard skill={{ ...SKILL, enabled: false, needs_vetting: true }} />);
    fireEvent.click(screen.getByRole("switch", { name: "Enable branch-coverage-gate" }));
    expect(h.updateMutate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Review & trust" })).toBeInTheDocument();
  });

  it("confirming Review & trust vets then enables the skill", async () => {
    renderCard(<SkillCard skill={{ ...SKILL, enabled: false, needs_vetting: true }} />);
    fireEvent.click(screen.getByRole("switch", { name: "Enable branch-coverage-gate" }));
    fireEvent.click(screen.getByRole("button", { name: "Trust & enable" }));
    await vi.waitFor(() => expect(h.vetMutateAsync).toHaveBeenCalledWith({ id: "sk1", version: 1 }));
    expect(h.updateMutate).toHaveBeenCalledWith({
      id: "sk1",
      patch: { enabled: true },
    });
  });

  it("turning an unvetted skill off never opens the modal", () => {
    renderCard(<SkillCard skill={{ ...SKILL, enabled: true, needs_vetting: true }} />);
    fireEvent.click(screen.getByRole("switch", { name: "Enable branch-coverage-gate" }));
    expect(h.updateMutate).toHaveBeenCalledWith({
      id: "sk1",
      patch: { enabled: false },
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a click on the card body opens the skill", () => {
    renderCard(<SkillCard skill={SKILL} href="/skills/sk1?tab=config" />);
    fireEvent.click(screen.getByText("Flags untested branches on new conditionals."));
    expect(h.pushMock).toHaveBeenCalledWith("/skills/sk1?tab=config");
  });

  it("a plain click on the name link also goes through the guard (AC-8)", () => {
    renderCard(<SkillCard skill={SKILL} href="/skills/sk1?tab=config" />);
    fireEvent.click(screen.getByRole("link", { name: "branch-coverage-gate" }));
    expect(h.pushMock).toHaveBeenCalledTimes(1);
    expect(h.pushMock).toHaveBeenCalledWith("/skills/sk1?tab=config");
  });

  it("a modifier-click on the name link is left to the browser (new tab)", () => {
    renderCard(<SkillCard skill={SKILL} href="/skills/sk1?tab=config" />);
    fireEvent.click(screen.getByRole("link", { name: "branch-coverage-gate" }), { metaKey: true });
    expect(h.pushMock).not.toHaveBeenCalled();
  });

  it("renders no link when it has nowhere to go", () => {
    renderCard(<SkillCard skill={SKILL} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
