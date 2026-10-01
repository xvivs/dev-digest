/* Spec 06 D13a / AC-24, AC-25: one click, bounded auto-continuation.
   The fake API's readiness answer is advanced by hand and polls are driven
   with `refetchQueries`, so no timers are involved. */
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PrepareOverviewResponse, PrOverviewReadiness } from "@devdigest/shared";
import brief from "@/../messages/en/brief.json";
import { renderWithProviders } from "@/test/render";
import { json, setupFakeApi } from "@/test/fake-api";
import { overviewReadinessKey } from "@/lib/hooks";
import { PrepareOverview } from "./PrepareOverview";
import { readiness } from "./testFixtures";

const api = setupFakeApi();
afterEach(cleanup);

const READINESS = "/pulls/p1/overview/readiness";
const PREPARE = "/pulls/p1/overview/prepare";

const NO_CLONE_INDEX = { status: "no_clone", last_indexed_sha: null, last_indexed_at: null } as const;
const UNCLONED = readiness({ clone: { status: "missing" }, index: NO_CLONE_INDEX, brief: { intent: "missing" }, actions: ["clone"] });
const CLONING = readiness({ clone: { status: "missing", in_flight: true }, index: NO_CLONE_INDEX, brief: { intent: "missing" } });
const OFFERS_DERIVE = readiness({ brief: { intent: "missing" }, actions: ["derive_brief"] });
const DERIVING = readiness({ brief: { intent: "missing", in_flight: true } });

function setup(first: PrOverviewReadiness) {
  let current = first;
  let nextPost: Partial<PrepareOverviewResponse> = {};
  api.route("GET", READINESS, () => json(current));
  api.route("POST", PREPARE, () =>
    json({ status: "started", started: [], failed: [], readiness: current, ...nextPost }, 202),
  );
  const view = renderWithProviders(<PrepareOverview prId="p1" />, { namespaces: { brief } });
  const poll = async (next: PrOverviewReadiness) => {
    current = next;
    await act(() => view.queryClient.refetchQueries({ queryKey: overviewReadinessKey("p1") }));
    // A mutation fired by the poll is pending already; wait until it has reached the fake API and settled.
    await waitFor(() => expect(view.queryClient.isMutating()).toBe(0));
  };
  const posts = () => api.requestsTo("POST", PREPARE);
  const respondNext = (r: Partial<PrepareOverviewResponse>) => {
    nextPost = r;
  };
  return { view, poll, posts, respondNext };
}

async function clickPrepare() {
  await waitFor(() => expect(screen.getByRole("button", { name: brief.prepare.label })).toBeEnabled());
  await userEvent.setup().click(screen.getByRole("button", { name: brief.prepare.label }));
}

describe("PrepareOverview auto-continuation", () => {
  it("continues once: clone click → clone in flight → derive offered → one more POST {}, never a third", async () => {
    const s = setup(UNCLONED);
    s.respondNext({ started: ["clone"], readiness: CLONING });
    await clickPrepare();
    await waitFor(() => expect(s.posts()).toHaveLength(1));

    await s.poll(CLONING);
    expect(s.posts()).toHaveLength(1);

    s.respondNext({ started: ["derive_brief"], readiness: DERIVING });
    await s.poll(OFFERS_DERIVE);
    await waitFor(() => expect(s.posts()).toHaveLength(2));
    expect(s.posts().map((p) => p.body)).toEqual([{}, {}]);

    // The derive failed and is offered again: not retried automatically.
    await s.poll(readiness({ brief: { intent: "missing", intent_failure: { reason: "llm_error", at: "x" } }, actions: ["derive_brief"] }));
    expect(s.posts()).toHaveLength(2);
  });

  it("never sends reindex_partial or clone automatically", async () => {
    const s = setup(UNCLONED);
    s.respondNext({ started: ["clone"], readiness: CLONING });
    await clickPrepare();
    await waitFor(() => expect(s.posts()).toHaveLength(1));

    await s.poll(readiness({ clone: { in_flight: true }, actions: [], explicit_actions: [] }));
    await s.poll(readiness({ index: { in_flight: true }, actions: ["clone"] }));
    expect(s.posts()).toHaveLength(1);
    await s.poll(readiness({ index: { status: "partial" }, actions: [], explicit_actions: ["reindex_partial"], in_flight: true }));
    expect(s.posts()).toHaveLength(1);
    // The plan offers only clone again: still nothing.
    await s.poll(UNCLONED);
    expect(s.posts()).toHaveLength(1);
  });

  it("clone job failed (repo missing): readiness falls back to clone-only, no auto POST, a manual click sends exactly one more", async () => {
    const s = setup(UNCLONED);
    s.respondNext({ started: ["clone"], readiness: CLONING });
    await clickPrepare();
    await waitFor(() => expect(s.posts()).toHaveLength(1));
    await s.poll(CLONING);

    // The clone job failed: idle again, still uncloned, the plan offers `clone` once more.
    await s.poll(UNCLONED);
    await s.poll(UNCLONED);
    expect(s.posts()).toHaveLength(1);
    await waitFor(() => expect(screen.getByRole("button", { name: brief.prepare.label })).toBeEnabled());

    // Only a click retries it, one POST per click.
    s.respondNext({ started: ["clone"], readiness: CLONING });
    await clickPrepare();
    await waitFor(() => expect(s.posts()).toHaveLength(2));
    await s.poll(UNCLONED);
    expect(s.posts()).toHaveLength(2);
    expect(s.posts().map((p) => p.body)).toEqual([{}, {}]);
  });

  it("an idle readiness with only reindex_partial ends the intent; a later derive offer sends nothing", async () => {
    const s = setup(UNCLONED);
    s.respondNext({ started: ["clone"], readiness: CLONING });
    await clickPrepare();
    await waitFor(() => expect(s.posts()).toHaveLength(1));
    await s.poll(readiness({ index: { status: "partial" }, explicit_actions: ["reindex_partial"] }));
    await s.poll(OFFERS_DERIVE);
    expect(s.posts()).toHaveLength(1);
  });

  it("sends nothing after unmount", async () => {
    const s = setup(UNCLONED);
    s.respondNext({ started: ["clone"], readiness: CLONING });
    await clickPrepare();
    await waitFor(() => expect(s.posts()).toHaveLength(1));
    s.view.unmount();
    await s.poll(OFFERS_DERIVE);
    expect(s.posts()).toHaveLength(1);
  });

  it("a response with failed steps ends the intent", async () => {
    const s = setup(UNCLONED);
    s.respondNext({ started: [], failed: ["clone"], readiness: UNCLONED });
    await clickPrepare();
    await waitFor(() => expect(s.posts()).toHaveLength(1));
    await s.poll(OFFERS_DERIVE);
    expect(s.posts()).toHaveLength(1);
  });

  it("an auto POST answering failed: ['derive_brief'] ends the intent", async () => {
    const s = setup(UNCLONED);
    s.respondNext({ started: ["clone"], readiness: CLONING });
    await clickPrepare();
    s.respondNext({ started: [], failed: ["derive_brief"], readiness: OFFERS_DERIVE });
    await s.poll(readiness({ actions: ["index_incremental", "derive_brief"] }));
    await waitFor(() => expect(s.posts()).toHaveLength(2));
    await s.poll(readiness({ actions: ["index_full"] }));
    expect(s.posts()).toHaveLength(2);
  });

  it("seeded fired (PC-17): a manual click's derive is not re-sent when offered again", async () => {
    const s = setup(OFFERS_DERIVE);
    s.respondNext({ started: ["derive_brief"], readiness: DERIVING });
    await clickPrepare();
    await waitFor(() => expect(s.posts()).toHaveLength(1));
    await s.poll(OFFERS_DERIVE);
    expect(s.posts()).toHaveLength(1);
  });

  it("seeded fired (PC-17): every auto action of the triggering plan joins fired", async () => {
    const s = setup(UNCLONED);
    s.respondNext({ started: ["clone"], readiness: CLONING });
    await clickPrepare();
    s.respondNext({ started: ["index_incremental", "derive_brief"], readiness: readiness({ index: { in_flight: true } }) });
    await s.poll(readiness({ actions: ["index_incremental", "derive_brief"] }));
    await waitFor(() => expect(s.posts()).toHaveLength(2));
    await s.poll(readiness({ actions: ["index_incremental"] }));
    expect(s.posts()).toHaveLength(2);
  });
});
