import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import brief from "@/../messages/en/brief.json";
import blast from "@/../messages/en/blast.json";
import cost from "@/../messages/en/cost.json";
import prReview from "@/../messages/en/prReview.json";
import { renderWithProviders } from "@/test/render";
import { setupFakeApi } from "@/test/fake-api";
import { OverviewTab } from "./OverviewTab";

const api = setupFakeApi();
afterEach(cleanup);

const namespaces = { brief, blast, cost, prReview };

function stubApi() {
  api.reply("GET", "/pulls/p1/runs", []);
  api.reply("GET", "/pulls/p1/reviews", []);
  api.reply("GET", "/pulls/p1/intent", {
    intent: {
      intent: "Add rate limiting",
      in_scope: ["Middleware"],
      out_of_scope: ["Auth changes"],
      pr_id: "p1",
      head_sha: "abc",
      confidence: "high",
      sources: [],
      unresolved_links: [],
      provider: null,
      model: null,
      tokens_in: null,
      tokens_out: null,
      cost_usd: null,
      cost_source: null,
      derived_at: "2026-09-30T10:00:00Z",
    },
    stale: false,
    in_flight: false,
    last_failure: null,
  });
}

describe("OverviewTab", () => {
  it("renders the intent in typographic quotes with both scope lists", async () => {
    stubApi();
    renderWithProviders(<OverviewTab prId="p1" />, { namespaces });
    expect(await screen.findByText("“Add rate limiting”")).toBeInTheDocument();
    expect(screen.getByText(brief.intent.inScope)).toBeInTheDocument();
    expect(screen.getByText(brief.intent.outOfScope)).toBeInTheDocument();
    expect(screen.getByText("Middleware")).toBeInTheDocument();
    expect(screen.getByText("Auth changes")).toBeInTheDocument();
  });

  it("renders no PR brief section for a PR without runs", async () => {
    stubApi();
    renderWithProviders(<OverviewTab prId="p1" />, { namespaces });
    await screen.findByText(/Add rate limiting/);
    expect(screen.queryByText(brief.section)).toBeNull();
  });
});
