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
import { screen, cleanup, fireEvent } from "@testing-library/react";
import type { ReviewRecord } from "@devdigest/shared";
import prReview from "@/../messages/en/prReview.json";
import cost from "@/../messages/en/cost.json";
import { renderWithProviders } from "@/test/render";

const deleteReview = vi.fn();
vi.mock("@/lib/hooks/reviews", () => ({
  useDeleteReview: () => ({ mutate: deleteReview, isPending: false }),
  useFindingAction: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { ReviewRunAccordion, type ReviewRunAccordionProps } from "./ReviewRunAccordion";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  deleteReview.mockReset();
});

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
      line_start: 61,
      line_end: 74,
      rationale: "A mid-migration failure leaves sessions unreadable.",
      suggestion: null,
      confidence: 0.93,
      accepted_at: null,
      dismissed_at: null,
    },
  ],
};

const accordion = (props: Partial<ReviewRunAccordionProps> = {}) => (
  <ReviewRunAccordion review={REVIEW} prId="pr-1" {...props} />
);

function renderAccordion(props: Partial<ReviewRunAccordionProps> = {}) {
  return renderWithProviders(accordion(props), { namespaces: { prReview, cost } });
}

/** The header toggle — a native button, located by the accessible name it carries. */
const header = () => screen.getByRole("button", { name: /Security Reviewer/ });

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

  // Was a keyDown(Enter) test against a `role="button"` div with a hand-written
  // key handler. The header is now a native <button>, whose Enter/Space
  // activation the browser provides (jsdom does not synthesise it), so the
  // contract to pin is "it is a real, focusable button".
  it("is reachable and operable from the keyboard: a native, focusable button", () => {
    renderAccordion();
    const trigger = header();
    expect(trigger.tagName).toBe("BUTTON");
    trigger.focus();
    expect(trigger).toHaveFocus();
  });

  it("keeps the delete action out of the toggle, and confirms before deleting", () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderAccordion();

    const del = screen.getByRole("button", { name: "Delete this review run" });
    expect(header()).not.toContainElement(del);

    fireEvent.click(del);
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining("Security Reviewer"));
    expect(deleteReview).toHaveBeenCalledWith("rev-1");
    // The click did not bubble into the toggle.
    expect(bodyText()).not.toBeInTheDocument();
  });

  it("does not delete when the confirm is dismissed", () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderAccordion();
    fireEvent.click(screen.getByRole("button", { name: "Delete this review run" }));
    expect(deleteReview).not.toHaveBeenCalled();
  });

  it("shows the server's blocker count for the run when one is given", () => {
    // The finding is CRITICAL (1 by the client rule); the run row says 3.
    renderAccordion({ runBlockers: 3 });
    expect(screen.getByText(/1 finding · 3 blockers/)).toBeInTheDocument();
  });

  it("falls back to the client blocker rule without a run row — dismissed findings still count", () => {
    const dismissed: ReviewRecord = {
      ...REVIEW,
      findings: REVIEW.findings.map((f) => ({ ...f, dismissed_at: "2026-09-21T00:00:00.000Z" })),
    };
    renderWithProviders(<ReviewRunAccordion review={dismissed} prId="pr-1" />, { namespaces: { prReview, cost } });
    expect(screen.getByText(/1 finding · 1 blocker$/)).toBeInTheDocument();
  });

  it("is forced open by the Timeline hand-off, and re-fires on a repeat click", () => {
    const { rerender } = renderAccordion({ targetReviewId: "rev-1", targetNonce: 1 });
    expect(bodyText()).toBeInTheDocument();

    // The user collapses it by hand, then clicks the same timeline tile again:
    // the nonce is what makes an otherwise identical target re-open the run.
    fireEvent.click(header());
    expect(bodyText()).not.toBeInTheDocument();

    rerender(accordion({ targetReviewId: "rev-1", targetNonce: 2 }));
    expect(bodyText()).toBeInTheDocument();
  });

  it("ignores a hand-off aimed at a different review", () => {
    renderAccordion({ targetReviewId: "rev-other", targetNonce: 1 });
    expect(bodyText()).not.toBeInTheDocument();
  });
});
