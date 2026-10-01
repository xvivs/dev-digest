import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import brief from "@/../messages/en/brief.json";
import blast from "@/../messages/en/blast.json";
import cost from "@/../messages/en/cost.json";
import prReview from "@/../messages/en/prReview.json";
import { renderWithProviders } from "@/test/render";
import { setupFakeApi, json } from "@/test/fake-api";
import { OverviewTab } from "./OverviewTab";
import { readiness } from "./_components/PrepareOverview/testFixtures";

const api = setupFakeApi();
afterEach(cleanup);

const namespaces = { brief, blast, cost, prReview };

const HEAD_MOVED = { reason: "head_moved", at: "2026-09-30T10:00:00Z" } as const;

const RISKS_RECORD = {
  pr_id: "p1",
  head_sha: "abc",
  risks: [{ kind: "security", title: "Auth surface touched", explanation: "x", severity: "high", file_refs: [], origin: "rule" }],
  dropped_refs: 0,
  rule_only: false,
  provider: null,
  model: null,
  tokens_in: null,
  tokens_out: null,
  cost_usd: null,
  cost_source: null,
  derived_at: "2026-09-30T10:00:00Z",
};

function stubApi() {
  api.reply("GET", "/pulls/p1/runs", []);
  api.reply("GET", "/pulls/p1/reviews", []);
  api.reply("GET", "/pulls/p1/overview/readiness", readiness());
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
    renderWithProviders(<OverviewTab prId="p1" repoId="r1" repoFullName="acme/widgets" />, { namespaces });
    expect(await screen.findByText("“Add rate limiting”")).toBeInTheDocument();
    expect(screen.getByText(brief.intent.inScope)).toBeInTheDocument();
    expect(screen.getByText(brief.intent.outOfScope)).toBeInTheDocument();
    expect(screen.getByText("Middleware")).toBeInTheDocument();
    expect(screen.getByText("Auth changes")).toBeInTheDocument();
  });

  it("renders no PR brief section for a PR without runs", async () => {
    stubApi();
    renderWithProviders(<OverviewTab prId="p1" repoId="r1" repoFullName="acme/widgets" />, { namespaces });
    await screen.findByText(/Add rate limiting/);
    expect(screen.queryByText(brief.section)).toBeNull();
  });

  describe("Refresh PR ownership (AC-12)", () => {
    const REFRESH = brief.failure.refreshPr;
    const follows = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

    it("risks-only head_moved next to a stale risks record → exactly one Refresh PR, inside RiskAreas", async () => {
      stubApi();
      api.reply("GET", "/pulls/p1/risks", { risks: RISKS_RECORD, stale: true, in_flight: false, last_failure: HEAD_MOVED });
      api.reply("GET", "/pulls/p1/overview/readiness", readiness({ brief: { risks: "stale", risks_failure: HEAD_MOVED }, blocked_by: "head_moved" }));
      renderWithProviders(<OverviewTab prId="p1" repoId="r1" repoFullName="acme/widgets" />, { namespaces });
      await screen.findByRole("button", { name: /Auth surface touched/ });
      const buttons = await screen.findAllByRole("button", { name: REFRESH });
      expect(buttons).toHaveLength(1);
      expect(follows(screen.getByText(brief.block.risks), buttons[0]!)).toBe(true);

      // Clicking it refreshes the Prepare readiness too.
      const before = api.requestsTo("GET", "/pulls/p1/overview/readiness").length;
      await userEvent.setup().click(buttons[0]!);
      await waitFor(() => expect(api.requestsTo("GET", "/pulls/p1/overview/readiness").length).toBeGreaterThan(before));
    });

    it("risks-only head_moved with no risks record → exactly one Refresh PR", async () => {
      stubApi();
      api.reply("GET", "/pulls/p1/risks", { risks: null, stale: false, in_flight: false, last_failure: HEAD_MOVED });
      api.reply("GET", "/pulls/p1/overview/readiness", readiness({ brief: { risks: "missing", risks_failure: HEAD_MOVED }, blocked_by: "head_moved" }));
      renderWithProviders(<OverviewTab prId="p1" repoId="r1" repoFullName="acme/widgets" />, { namespaces });
      await screen.findByText("“Add rate limiting”");
      expect(await screen.findAllByRole("button", { name: REFRESH })).toHaveLength(1);
    });

    it("intent-phase head_moved (recorded for both phases) → one in IntentCard, one in RiskAreas, none in PrepareOverview", async () => {
      stubApi();
      api.reply("GET", "/pulls/p1/intent", { intent: null, stale: false, in_flight: false, last_failure: HEAD_MOVED });
      api.reply("GET", "/pulls/p1/risks", { risks: RISKS_RECORD, stale: true, in_flight: false, last_failure: HEAD_MOVED });
      api.reply(
        "GET",
        "/pulls/p1/overview/readiness",
        readiness({ brief: { intent: "missing", risks: "stale", intent_failure: HEAD_MOVED, risks_failure: HEAD_MOVED }, blocked_by: "head_moved" }),
      );
      renderWithProviders(<OverviewTab prId="p1" repoId="r1" repoFullName="acme/widgets" />, { namespaces });
      await screen.findByRole("button", { name: /Auth surface touched/ });
      await waitFor(() => expect(screen.getAllByRole("button", { name: REFRESH })).toHaveLength(2));
      const [first, second] = screen.getAllByRole("button", { name: REFRESH });
      const intentHeading = screen.getByText(brief.block.intent);
      const risksHeading = screen.getByText(brief.block.risks);
      expect(follows(intentHeading, first!)).toBe(true);
      expect(follows(first!, risksHeading)).toBe(true);
      expect(follows(risksHeading, second!)).toBe(true);
      expect(await screen.findByRole("button", { name: brief.prepare.blocked })).toBeDisabled();
    });
  });
});

describe("Resync from the Blast radius card", () => {
  const DOWNSTREAM = [{ symbol: "doWork", callers: [{ file: "src/a.ts", line: 7, name: "run" }], endpoints_affected: [], crons_affected: [] }];
  const blastBody = (status: "ok" | "degraded") => ({
    status,
    reason: status === "degraded" ? "index_partial" : null,
    blast: { changed_symbols: [{ name: "doWork", file: "src/a.ts", kind: "function" }], downstream: DOWNSTREAM, summary: "" },
    head_sha: "abc",
    source_sha: "deadbeef",
    index_status: "ready",
    cached: false,
    truncated: false,
    computed_at: null,
  });

  // A job that finishes before the first readiness poll: the first readiness the page reads after the
  // POST already says idle, and the index is fresh from then on. A blast fetched alongside that readiness
  // (the resync's own refresh) still sees the old answer; only a blast refetch after it sees "ok".
  it("a fast resync job refreshes the blast once readiness settles: the degraded badge goes away", async () => {
    stubApi();
    let resynced = false;
    let indexFresh = false;
    api.route("POST", "/repos/r1/resync", () => {
      resynced = true;
      return json({ status: "queued" }, 202);
    });
    api.route("GET", "/pulls/p1/overview/readiness", async () => {
      if (resynced) {
        await new Promise((r) => setTimeout(r, 30));
        indexFresh = true;
      }
      return json(readiness());
    });
    api.route("GET", "/pulls/p1/blast", () => json(blastBody(indexFresh ? "ok" : "degraded")));

    const user = userEvent.setup();
    renderWithProviders(<OverviewTab prId="p1" repoId="r1" repoFullName="acme/widgets" />, { namespaces });
    expect(await screen.findByRole("status")).toHaveTextContent(blast.reason.index_partial);

    await user.click(screen.getByRole("button", { name: blast.resync }));

    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: blast.resync })).not.toBeInTheDocument();
    expect(api.requestsTo("POST", "/repos/r1/resync")).toHaveLength(1);
    expect(api.requestsTo("GET", "/pulls/p1/blast").length).toBeGreaterThanOrEqual(3);
  });
});
