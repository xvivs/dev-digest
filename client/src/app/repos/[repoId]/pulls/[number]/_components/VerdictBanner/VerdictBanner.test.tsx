import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import type { Verdict } from "@devdigest/shared";
import prReview from "@/../messages/en/prReview.json";
import { renderWithProviders } from "@/test/render";
import { VerdictBanner } from "./VerdictBanner";

afterEach(cleanup);

type BannerProps = React.ComponentProps<typeof VerdictBanner>;

function renderBanner(props: Partial<BannerProps> = {}) {
  return renderWithProviders(
    <VerdictBanner
      verdict="request_changes"
      summary="Hardcoded secret introduced."
      score={42}
      findingsCount={1}
      blockers={1}
      agentName="Security Reviewer"
      {...props}
    />,
    { namespaces: { prReview } },
  );
}

describe("VerdictBanner", () => {
  it("shows verdict label + score + finding/blocker counts", () => {
    renderBanner();
    expect(screen.getByText("Request changes")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    // ICU plurals: was "1 findings · 1 blockers" before ARCH-23.
    expect(screen.getByText("1 finding · 1 blocker")).toBeInTheDocument();
    expect(screen.getByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret introduced.")).toBeInTheDocument();
  });

  it.each<[Verdict, string]>([
    ["request_changes", "Request changes"],
    ["approve", "Approve"],
    ["comment", "Comment"],
  ])("renders the %s verdict with its label", (verdict, label) => {
    renderBanner({ verdict });
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("drops the blockers tail at zero and pluralises the finding count", () => {
    renderBanner({ findingsCount: 3, blockers: 0 });
    expect(screen.getByText("3 findings")).toBeInTheDocument();
    expect(screen.queryByText(/blocker/)).not.toBeInTheDocument();
  });

  it("omits the score ring, agent badge and summary when they are missing", () => {
    renderBanner({ score: null, agentName: null, summary: null });
    expect(screen.queryByText("PR SCORE")).not.toBeInTheDocument();
    expect(screen.queryByText("Security Reviewer")).not.toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret introduced.")).not.toBeInTheDocument();
  });
});
