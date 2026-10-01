import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import brief from "@/../messages/en/brief.json";
import cost from "@/../messages/en/cost.json";
import prReview from "@/../messages/en/prReview.json";
import { renderWithProviders } from "@/test/render";
import { apiError, setupFakeApi } from "@/test/fake-api";
import { BriefSection } from "./BriefSection";

const api = setupFakeApi();
afterEach(cleanup);

const namespaces = { brief, cost, prReview };
const doneRun = {
  run_id: "r1",
  status: "done",
  ran_at: "2026-09-30T10:00:00Z",
};

describe("BriefSection", () => {
  it("renders nothing once the PR is known to have no runs", async () => {
    api.reply("GET", "/pulls/p1/runs", []);
    api.reply("GET", "/pulls/p1/reviews", []);
    const { container } = renderWithProviders(<BriefSection prId="p1" />, { namespaces });
    await waitFor(() => expect(screen.queryByText("PR brief")).toBeNull());
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the heading and shows a retryable error when runs fail to load", async () => {
    api.route("GET", "/pulls/p1/runs", () => apiError(500, "boom"));
    api.reply("GET", "/pulls/p1/reviews", []);
    renderWithProviders(<BriefSection prId="p1" />, { namespaces });
    expect(await screen.findByText(brief.error)).toBeInTheDocument();
    expect(screen.getByText("PR brief")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry|try again/i })).toBeInTheDocument();
  });

  it("shows a compact single-row notice, not the review brief block, when no run has a review", async () => {
    api.reply("GET", "/pulls/p1/runs", [doneRun]);
    api.reply("GET", "/pulls/p1/reviews", []);
    renderWithProviders(<BriefSection prId="p1" />, { namespaces });
    expect(await screen.findByText(brief.noRun)).toBeInTheDocument();
    expect(screen.getByText("PR brief")).toBeInTheDocument();
    expect(screen.getByText(brief.unavailableHint)).toBeInTheDocument();
    expect(screen.queryByText("Review brief")).toBeNull();
  });
});
