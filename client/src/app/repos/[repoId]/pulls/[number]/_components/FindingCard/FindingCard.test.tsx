import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, fireEvent, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FindingRecord } from "@devdigest/shared";
import prReview from "@/../messages/en/prReview.json";
import { renderWithProviders } from "@/test/render";
import { FindingCard } from "./FindingCard";

afterEach(cleanup);

const FINDING: FindingRecord = {
  id: "f1",
  severity: "CRITICAL",
  category: "security",
  title: "Hardcoded Stripe secret key",
  file: "src/config.ts",
  start_line: 11,
  end_line: 11,
  rationale: "A **live** Stripe key is committed in source.",
  suggestion: "Move the key to an environment variable.",
  confidence: 0.95,
  kind: "finding",
  trifecta_components: null,
  evidence: null,
  review_id: "r1",
  accepted_at: null,
  dismissed_at: null,
};

const renderCard = (ui: React.ReactElement) => renderWithProviders(ui, { namespaces: { prReview } });
const toggle = () => screen.getByRole("button", { name: /Hardcoded Stripe secret key/ });

describe("FindingCard (smoke, both themes)", () => {
  (["dark", "light"] as const).forEach((theme) => {
    it(`renders severity + file:line + rationale in ${theme}`, () => {
      renderCard(
        <div data-theme={theme}>
          <FindingCard f={FINDING} defaultExpanded onAction={() => {}} />
        </div>,
      );
      expect(screen.getByText("Hardcoded Stripe secret key")).toBeInTheDocument();
      expect(screen.getByText("src/config.ts:11")).toBeInTheDocument();
      // category label is shown alongside the severity badge
      expect(screen.getByText("security")).toBeInTheDocument();
    });
  });

  it("fires accept/dismiss actions", () => {
    const onAction = vi.fn();
    renderCard(<FindingCard f={FINDING} defaultExpanded onAction={onAction} />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(onAction).toHaveBeenCalledWith("accept");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(onAction).toHaveBeenCalledWith("dismiss");
  });
});

describe("FindingCard disclosure header", () => {
  it("is a native button wired to the body, so Enter/Space toggle it without a key handler", () => {
    renderCard(<FindingCard f={FINDING} onAction={() => {}} />);
    const header = toggle();
    // A <button type="button"> gets Enter/Space activation from the browser;
    // jsdom does not synthesise that click, so assert the element contract.
    expect(header.tagName).toBe("BUTTON");
    expect(header).toHaveAttribute("type", "button");
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Accept" })).not.toBeInTheDocument();

    header.focus();
    expect(header).toHaveFocus();
    fireEvent.click(header);

    expect(header).toHaveAttribute("aria-expanded", "true");
    const accept = screen.getByRole("button", { name: "Accept" });
    const region = document.getElementById(header.getAttribute("aria-controls")!);
    expect(region).toContainElement(accept);
  });

  it("keeps the file link outside the toggle and does not toggle when it is clicked", () => {
    renderCard(
      <FindingCard f={FINDING} onAction={() => {}} repoFullName="acme/payments-api" headSha="abc123" />,
    );
    const link = screen.getByRole("link", { name: "src/config.ts:11" });
    expect(link).toHaveAttribute("href", expect.stringContaining("acme/payments-api"));
    expect(toggle()).not.toContainElement(link);

    fireEvent.click(link);
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });
});

describe("FindingCard markdown hardening", () => {
  it("renders rationale/suggestion markdown in safe mode: no auto-loading image, link shows the URL", () => {
    renderCard(
      <FindingCard
        f={{
          ...FINDING,
          rationale: "See ![x](https://evil.test/p.png) for context.",
          suggestion: "Also linked: [docs](https://example.test/fix)",
        }}
        defaultExpanded
        onAction={() => {}}
      />,
    );

    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    const imgLink = screen.getByRole("link", { name: /x \(https:\/\/evil\.test\/p\.png\)/ });
    expect(imgLink).toHaveAttribute("target", "_blank");
    expect(imgLink).toHaveAttribute("rel", "noopener noreferrer");

    const docsLink = screen.getByRole("link", { name: "docs" });
    expect(docsLink).toHaveAttribute("href", "https://example.test/fix");
    expect(docsLink).toHaveAttribute("target", "_blank");
    expect(docsLink).toHaveAttribute("rel", "noopener noreferrer");
  });
});

describe("FindingCard suggested fix", () => {
  const renderWith = (suggestion: string | null) =>
    renderCard(<FindingCard f={{ ...FINDING, suggestion }} defaultExpanded onAction={() => {}} />);

  it.each([":", "  ", "- "])("hides the block for placeholder text %j", (suggestion) => {
    renderWith(suggestion);
    expect(screen.queryByText(prReview.finding.suggestedFix)).not.toBeInTheDocument();
  });

  it.each(["});", "```\n});\n```", "!="])("shows the block for code-only suggestion %j", (suggestion) => {
    renderWith(suggestion);
    expect(screen.getByText(prReview.finding.suggestedFix)).toBeInTheDocument();
  });

  it("shows the block for real text", () => {
    renderWith("Move the key to an environment variable.");
    expect(screen.getByText(prReview.finding.suggestedFix)).toBeInTheDocument();
  });
});

describe("FindingCard file link", () => {
  it("calls onOpenFile instead of linking to GitHub", async () => {
    const user = userEvent.setup();
    const onOpenFile = vi.fn();
    renderCard(
      <FindingCard f={FINDING} repoFullName="acme/api" headSha="abc" onOpenFile={onOpenFile} onAction={() => {}} />,
    );
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /src\/config\.ts:11/ }));
    expect(onOpenFile).toHaveBeenCalledTimes(1);
  });
});
