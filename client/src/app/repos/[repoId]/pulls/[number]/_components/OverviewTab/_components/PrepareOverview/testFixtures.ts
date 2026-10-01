/* Readiness fixtures shared by the PrepareOverview tests. */
import type { PrOverviewReadiness } from "@devdigest/shared";

type Over = {
  clone?: Partial<PrOverviewReadiness["clone"]>;
  index?: Partial<PrOverviewReadiness["index"]>;
  brief?: Partial<PrOverviewReadiness["brief"]>;
} & Partial<Omit<PrOverviewReadiness, "clone" | "index" | "brief">>;

/** An all-ready PR unless overridden; `in_flight` follows the parts unless given. */
export function readiness(o: Over = {}): PrOverviewReadiness {
  const { clone, index, brief, ...rest } = o;
  const r: PrOverviewReadiness = {
    pr_id: "p1",
    repo_id: "r1",
    clone: { status: "cloned", in_flight: false, last_failure: null, ...clone },
    index: {
      status: "full",
      in_flight: false,
      last_indexed_at: "2026-09-30T10:00:00.000Z",
      last_indexed_sha: "abcdef1234567890",
      partial_reason: null,
      ...index,
    },
    brief: { intent: "fresh", risks: "fresh", in_flight: false, intent_failure: null, risks_failure: null, ...brief },
    blocked_by: null,
    actions: [],
    explicit_actions: [],
    in_flight: false,
    ...rest,
  };
  if (o.in_flight === undefined) r.in_flight = r.clone.in_flight || r.index.in_flight || r.brief.in_flight;
  return r;
}
