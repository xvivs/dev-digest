/**
 * FindingsPanel — smoke, plus the one invariant the severity UI has to hold:
 * the number on a counter pill is the number of cards the list renders once
 * that pill is selected. Counters are tallied AFTER "hide low confidence" and
 * BEFORE the severity filter, so both controls stay honest together.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import type { FindingRecord, Severity } from "@devdigest/shared";
import prReview from "@/../messages/en/prReview.json";
import { renderWithProviders } from "@/test/render";

vi.mock("@/lib/hooks", () => ({
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { FindingsPanel } from "./FindingsPanel";

afterEach(cleanup);

function finding(
  o: Partial<FindingRecord> & { id: string; severity: Severity; title: string },
): FindingRecord {
  return {
    category: "security",
    file: "src/config.ts",
    line_start: 11,
    line_end: 11,
    rationale: "Because.",
    suggestion: null,
    confidence: 0.95,
    kind: "finding",
    trifecta_components: null,
    evidence: null,
    review_id: "r1",
    accepted_at: null,
    dismissed_at: null,
    ...o,
  };
}

const CRITICAL = finding({ id: "f1", severity: "CRITICAL", title: "Hardcoded secret" });
/** 1 CRITICAL · 3 WARNING — the last warning is the only low-confidence
 *  one, so "hide low confidence" trims exactly that finding. */
const FINDINGS: FindingRecord[] = [
  CRITICAL,
  finding({ id: "f2", severity: "WARNING", title: "Unhandled rejection", confidence: 0.9 }),
  finding({ id: "f3", severity: "WARNING", title: "Loose comparison", confidence: 0.88 }),
  finding({ id: "f4", severity: "WARNING", title: "Extract a helper", confidence: 0.3 }),
];

/** The wrapper persists across `rerender`, so a rerender only passes the panel. */
function renderWithIntl(ui: React.ReactElement) {
  return renderWithProviders(ui, { namespaces: { prReview } });
}

/** FindingCard stamps `data-finding-id` on its root — the only structural
 *  handle for "how many cards are on screen". */
const cardCount = () => document.querySelectorAll("[data-finding-id]").length;

describe("FindingsPanel (smoke)", () => {
  it("renders the toolbar + a finding card", () => {
    renderWithIntl(<FindingsPanel findings={[CRITICAL]} prId="pr1" />);
    expect(screen.getByText("Hide low confidence")).toBeInTheDocument();
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("shows the empty state when nothing matches", () => {
    renderWithIntl(<FindingsPanel findings={[]} prId="pr1" />);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel — severity counters and filter", () => {
  it("every pill equals the number of cards rendered, before and after hide-low", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);

    expect(screen.getByText("1 CRITICAL")).toBeInTheDocument();
    expect(screen.getByText("3 WARNING")).toBeInTheDocument();
    expect(cardCount()).toBe(4);

    // Hiding low confidence must move the pill and the list in lockstep: the
    // only low-confidence finding is the last warning.
    fireEvent.click(screen.getByRole("switch"));
    expect(screen.queryByText("3 WARNING")).not.toBeInTheDocument();
    expect(screen.getByText("2 WARNING")).toBeInTheDocument();
    expect(cardCount()).toBe(3);
  });

  it("picking Warning leaves exactly the three warnings; picking it again clears the filter", () => {
    renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    const warning = screen.getByRole("button", { name: "Warning" });

    fireEvent.click(warning);
    expect(warning).toHaveAttribute("aria-pressed", "true");
    expect(cardCount()).toBe(3);
    expect(screen.getByText("Unhandled rejection")).toBeInTheDocument();
    expect(screen.getByText("Loose comparison")).toBeInTheDocument();
    expect(screen.queryByText("Hardcoded secret")).not.toBeInTheDocument();
    // The tally keeps describing the whole list, not the filtered slice.
    expect(screen.getByText("1 CRITICAL")).toBeInTheDocument();

    fireEvent.click(warning);
    expect(warning).toHaveAttribute("aria-pressed", "false");
    expect(cardCount()).toBe(4);
  });

  it("a severity with nothing behind it is disabled, not hidden", () => {
    renderWithIntl(<FindingsPanel findings={[CRITICAL]} prId="pr1" />);
    expect(screen.getByRole("button", { name: "Critical" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Warning" })).toBeDisabled();
  });

  it("a filter its bucket has just been emptied under falls through to the empty state", () => {
    const lowWarning = finding({ id: "f5", severity: "WARNING", title: "Nit", confidence: 0.3 });
    renderWithIntl(<FindingsPanel findings={[CRITICAL, lowWarning]} prId="pr1" />);

    fireEvent.click(screen.getByRole("button", { name: "Warning" }));
    expect(cardCount()).toBe(1);

    // The only warning is low-confidence — hiding it leaves the filter
    // pointing at an empty bucket.
    fireEvent.click(screen.getByRole("switch"));
    expect(cardCount()).toBe(0);
    expect(screen.getByText("No findings match")).toBeInTheDocument();
  });
});

describe("FindingsPanel — Timeline hand-off", () => {
  it("applies targetSeverity already on the first render", () => {
    renderWithIntl(
      <FindingsPanel findings={FINDINGS} prId="pr1" targetSeverity="CRITICAL" targetNonce={1} />,
    );
    expect(cardCount()).toBe(1);
    expect(screen.getByText("Hardcoded secret")).toBeInTheDocument();
  });

  it("re-applies targetSeverity whenever targetNonce changes", () => {
    const { rerender } = renderWithIntl(<FindingsPanel findings={FINDINGS} prId="pr1" />);
    expect(cardCount()).toBe(4);

    rerender(<FindingsPanel findings={FINDINGS} prId="pr1" targetSeverity="WARNING" targetNonce={1} />);
    expect(cardCount()).toBe(3);
    expect(screen.getByRole("button", { name: "Warning" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    // Same severity, new nonce — still re-applied after the user cleared it.
    fireEvent.click(screen.getByRole("button", { name: "Warning" }));
    expect(cardCount()).toBe(4);
    rerender(<FindingsPanel findings={FINDINGS} prId="pr1" targetSeverity="WARNING" targetNonce={2} />);
    expect(cardCount()).toBe(3);
  });
});
