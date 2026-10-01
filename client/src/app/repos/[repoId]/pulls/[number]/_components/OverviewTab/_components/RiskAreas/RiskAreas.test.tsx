import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import brief from "@/../messages/en/brief.json";
import cost from "@/../messages/en/cost.json";
import { renderWithProviders } from "@/test/render";
import { setupFakeApi } from "@/test/fake-api";
import { RiskAreas } from "./RiskAreas";

const api = setupFakeApi();
afterEach(cleanup);

describe("RiskAreas", () => {
  it("keeps the severity available as text, not colour alone", async () => {
    api.reply("GET", "/pulls/p1/risks", {
      risks: {
        pr_id: "p1",
        head_sha: "abc",
        risks: [
          { kind: "security", title: "Auth surface touched", explanation: "x", severity: "high", file_refs: [], origin: "rule" },
        ],
        dropped_refs: 0,
        rule_only: false,
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
    renderWithProviders(<RiskAreas prId="p1" />, { namespaces: { brief, cost } });
    expect(await screen.findByRole("button", { name: /Auth surface touched/ })).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
  });
});
