/**
 * ReviewRunAccordion — the disclosure contract. Two things are load-bearing and
 * were previously only covered by the browser suite:
 *
 *  - the body mounts and unmounts (it is not merely hidden), so a collapsed run
 *    costs nothing and cannot be found by text;
 *  - the Timeline hand-off: `targetReviewId` + `targetNonce` force the run open
 *    from outside, and the nonce has to re-fire on a repeat click.
 *
 * Under jsdom the `Collapse` primitive finds no running animations, so the exit
 * is synchronous here — the same DOM contract a plain `{open && …}` had.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReviewRecord } from "@devdigest/shared";
import prReview from "../../../../../../../../messages/en/prReview.json";
import cost from "../../../../../../../../messages/en/cost.json";

vi.mock("../../../../../../../lib/hooks/reviews", () => ({
  useDeleteReview: () => ({ mutate: vi.fn(), isPending: false }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ReviewRunAccordion } from "./ReviewRunAccordion";

afterEach(cleanup);

const REVIEW: ReviewRecord = {
  id: "rev-1",
  pr_id: "pr-1",
  agent_id: "a-1",
  run_id: "run-1",
  agent_name: "Security Reviewer",
  kind: "review",
  verdict: "request_changes",
  summary: "The migration drops the old key in the same transaction.",
  score: 44,
  model: "claude-opus-5",
  grounding: null,
  created_at: "2026-09-20T18:45:10.000Z",
  findings: [
    {
      id: "f1",
      review_id: "rev-1",
      severity: "CRITICAL",
      category: "bug",
      title: "Backfill and column drop share one transaction",
      file: "migrations/0042.sql",
      start_line: 61,
      end_line: 74,
      rationale: "A mid-migration failure leaves sessions unreadable.",
      suggestion: null,
      confidence: 0.93,
      accepted_at: null,
      dismissed_at: null,
    },
  ],
};

function renderAccordion(props: Partial<React.ComponentProps<typeof ReviewRunAccordion>> = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ prReview, cost }}>
      <ReviewRunAccordion review={REVIEW} prId="pr-1" {...props} />
    </NextIntlClientProvider>,
  );
}

/** The header is the whole toggle — located by the role it advertises. */
const header = () => screen.getAllByRole("button", { name: /Security Reviewer/ })[0]!;

const bodyText = () => screen.queryByText(REVIEW.summary!);

describe("ReviewRunAccordion", () => {
  it("keeps the header readable while collapsed and the body out of the DOM", () => {
    renderAccordion();

    // The tally the browser suite asserts on lives in the header, so it must
    // survive a collapsed run.
    expect(screen.getByText(/1 finding/)).toBeInTheDocument();
    expect(screen.getByText("request changes")).toBeInTheDocument();
    expect(bodyText()).not.toBeInTheDocument();
  });

  it("opens by default when asked, and toggles closed again", () => {
    renderAccordion({ defaultOpen: true });
    expect(bodyText()).toBeInTheDocument();

    fireEvent.click(header());
    expect(bodyText()).not.toBeInTheDocument();

    fireEvent.click(header());
    expect(bodyText()).toBeInTheDocument();
  });

  it("wires the trigger to the region it controls", () => {
    renderAccordion({ defaultOpen: true });

    const trigger = header();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    const region = trigger.getAttribute("aria-controls");
    expect(region).toBeTruthy();
    expect(document.getElementById(region!)).toBeInTheDocument();

    fireEvent.click(trigger);
    expect(header()).toHaveAttribute("aria-expanded", "false");
  });

  it("opens from the keyboard", () => {
    renderAccordion();
    fireEvent.keyDown(header(), { key: "Enter" });
    expect(bodyText()).toBeInTheDocument();
  });

  it("is forced open by the Timeline hand-off, and re-fires on a repeat click", () => {
    const { rerender } = renderAccordion({ targetReviewId: "rev-1", targetNonce: 1 });
    expect(bodyText()).toBeInTheDocument();

    // The user collapses it by hand, then clicks the same timeline tile again:
    // the nonce is what makes an otherwise identical target re-open the run.
    fireEvent.click(header());
    expect(bodyText()).not.toBeInTheDocument();

    rerender(
      <NextIntlClientProvider locale="en" messages={{ prReview, cost }}>
        <ReviewRunAccordion review={REVIEW} prId="pr-1" targetReviewId="rev-1" targetNonce={2} />
      </NextIntlClientProvider>,
    );
    expect(bodyText()).toBeInTheDocument();
  });

  it("ignores a hand-off aimed at a different review", () => {
    renderAccordion({ targetReviewId: "rev-other", targetNonce: 1 });
    expect(bodyText()).not.toBeInTheDocument();
  });
});
