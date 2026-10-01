import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import brief from "@/../messages/en/brief.json";
import cost from "@/../messages/en/cost.json";
import { renderWithProviders } from "@/test/render";
import { setupFakeApi } from "@/test/fake-api";
import { IntentCard } from "./IntentCard";

const api = setupFakeApi();
afterEach(cleanup);

const namespaces = { brief, cost };

const intentResponse = (confidence: "high" | "medium" | "low") => ({
  intent: {
    intent: "Add rate limiting",
    in_scope: ["Middleware"],
    out_of_scope: ["Auth changes"],
    pr_id: "p1",
    head_sha: "abc",
    confidence,
    sources: [{ kind: "title", ref: null, chars: 10 }],
    unresolved_links: [{ url: "https://example.com/spec", reason: "external_host" }],
    provider: null,
    model: null,
    tokens_in: null,
    tokens_out: null,
    cost_usd: 0.01,
    cost_source: "provider",
    derived_at: "2026-09-30T10:00:00Z",
  },
  stale: false,
  in_flight: false,
  last_failure: null,
});

describe("IntentCard", () => {
  it.each(["low", "medium"] as const)("shows a confidence badge for %s confidence", async (level) => {
    api.reply("GET", "/pulls/p1/intent", intentResponse(level));
    renderWithProviders(<IntentCard prId="p1" />, { namespaces });
    expect(await screen.findByText(brief.intent.confidence[level])).toBeInTheDocument();
  });

  it("shows no confidence badge for high confidence", async () => {
    api.reply("GET", "/pulls/p1/intent", intentResponse("high"));
    renderWithProviders(<IntentCard prId="p1" />, { namespaces });
    await screen.findByText(/Add rate limiting/);
    expect(screen.queryByText(/confidence/i)).toBeNull();
  });

  it("keeps sources, unread links and cost behind a closed Details disclosure", async () => {
    const user = userEvent.setup();
    api.reply("GET", "/pulls/p1/intent", intentResponse("high"));
    renderWithProviders(<IntentCard prId="p1" />, { namespaces });
    const toggle = await screen.findByRole("button", { name: brief.details });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText(brief.intent.sources)).toBeNull();
    expect(screen.queryByText(brief.intent.unresolved)).toBeNull();
    expect(screen.queryByText(brief.intent.cost, { exact: false })).toBeNull();

    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText(brief.intent.sources)).toBeInTheDocument();
    expect(screen.getByText("https://example.com/spec")).toBeInTheDocument();
    const costLine = screen.getByText(brief.intent.cost, { exact: false });
    expect(within(costLine).getByText(/\$/)).toBeInTheDocument();
  });
});
