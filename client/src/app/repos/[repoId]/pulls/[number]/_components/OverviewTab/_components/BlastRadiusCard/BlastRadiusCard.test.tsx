import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import brief from "@/../messages/en/brief.json";
import blast from "@/../messages/en/blast.json";
import { renderWithProviders } from "@/test/render";
import { setupFakeApi } from "@/test/fake-api";
import { BlastRadiusCard } from "./BlastRadiusCard";

const api = setupFakeApi();
afterEach(cleanup);

const namespaces = { brief, blast };

// Explicit on purpose: mirrors BlastReason in vendor/shared/contracts/brief.ts, not the production constant.
const DEGRADED_REASONS = [
  "index_partial",
  "no_index",
  "flag_off",
  "no_changed_files",
  "index_failed",
  "repo_too_large",
  "no_data",
] as const;
type BlastReasonValue = (typeof DEGRADED_REASONS)[number];
type Caller = { file: string; line: number; name: string };

function replyBlast(opts: {
  status?: "ok" | "degraded";
  reason?: BlastReasonValue | null;
  symbols?: number;
  downstream?: Array<{ symbol: string; callers: Caller[] }>;
  source_sha?: string | null;
}) {
  const { status = "ok", reason = null, symbols = 0, downstream = [], source_sha = "deadbeefcafe" } = opts;
  api.reply("GET", "/pulls/p1/blast", {
    status,
    reason,
    blast: {
      changed_symbols: Array.from({ length: symbols }, (_, i) => ({ name: `sym${i}`, file: "src/a.ts", kind: "function" })),
      downstream: downstream.map((d) => ({ ...d, endpoints_affected: [], crons_affected: [] })),
      summary: "",
    },
    head_sha: "abc",
    source_sha,
    index_status: "ready",
    cached: false,
    truncated: false,
    computed_at: null,
  });
}

function reply(count: number, status: "ok" | "degraded" = "degraded") {
  const downstream = Array.from({ length: count }, (_, i) => ({
    symbol: `symbol${i}`,
    callers: [{ file: `src/f${i}.ts`, line: i + 1, name: `caller${i}` }],
    endpoints_affected: [],
    crons_affected: [],
  }));
  api.reply("GET", "/pulls/p1/blast", {
    status,
    reason: status === "degraded" ? "index_partial" : null,
    blast: { changed_symbols: [], downstream, summary: "" },
    head_sha: "abc",
    source_sha: null,
    index_status: "ready",
    cached: false,
    truncated: false,
    computed_at: null,
  });
}

describe("BlastRadiusCard scroll region", () => {
  it("renders a long tree inside a focusable, height-capped region; header, notice and stats stay outside", async () => {
    reply(15);
    renderWithProviders(<BlastRadiusCard prId="p1" repoId="r1" repoFullName="acme/widgets" />, { namespaces });
    const region = await screen.findByRole("region", { name: blast.scrollRegion });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(within(region).getAllByText(/^symbol\d+$/)).toHaveLength(15);

    expect(screen.getByText(brief.block.blast)).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByText("symbols")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: blast.view.tree })).toBeInTheDocument();
    expect(within(region).queryByText(brief.block.blast)).not.toBeInTheDocument();
    expect(within(region).queryByRole("status")).not.toBeInTheDocument();
    expect(within(region).queryByText("symbols")).not.toBeInTheDocument();
    expect(within(region).queryByRole("button", { name: blast.view.tree })).not.toBeInTheDocument();
  });

  it("keeps the graph view inside the scroll region too", async () => {
    reply(15, "ok");
    const user = userEvent.setup();
    renderWithProviders(<BlastRadiusCard prId="p1" repoId="r1" repoFullName="acme/widgets" />, { namespaces });
    await screen.findByRole("region", { name: blast.scrollRegion });
    await user.click(screen.getByRole("button", { name: blast.view.graph }));
    const region = screen.getByRole("region", { name: blast.scrollRegion });
    expect(within(region).getByRole("group", { name: blast.graph.ariaLabel })).toBeInTheDocument();
  });
});

describe("BlastRadiusCard bottom fade", () => {
  // jsdom has no layout: feed the three metrics the hook reads from a mutable box.
  const box = { scrollHeight: 0, clientHeight: 0, scrollTop: 0 };
  const proto = HTMLElement.prototype;
  const originals = (["scrollHeight", "clientHeight", "scrollTop"] as const).map(
    (k) => [k, Object.getOwnPropertyDescriptor(Element.prototype, k)] as const,
  );

  beforeEach(() => {
    for (const k of ["scrollHeight", "clientHeight", "scrollTop"] as const) {
      Object.defineProperty(proto, k, {
        configurable: true,
        get: () => box[k],
        set: (v: number) => {
          if (k === "scrollTop") box.scrollTop = v;
        },
      });
    }
  });
  afterEach(() => {
    for (const [k, d] of originals) {
      delete (proto as unknown as Record<string, unknown>)[k];
      if (d) Object.defineProperty(Element.prototype, k, d);
    }
  });

  const fade = () => screen.getByTestId("scroll-fade");

  // Controllable ResizeObserver: like the real one it only reports elements it observes.
  const observers: Array<{ cb: ResizeObserverCallback; targets: Set<Element> }> = [];
  beforeEach(() => {
    observers.length = 0;
    vi.stubGlobal(
      "ResizeObserver",
      class {
        targets = new Set<Element>();
        constructor(public cb: ResizeObserverCallback) {
          observers.push(this);
        }
        observe(el: Element) {
          this.targets.add(el);
        }
        unobserve(el: Element) {
          this.targets.delete(el);
        }
        disconnect() {
          this.targets.clear();
        }
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  /** The scroll box keeps its capped size; only mounted content boxes change size when the view swaps. */
  function resizeContent(region: HTMLElement) {
    for (const ro of observers) {
      const changed = [...ro.targets].filter((el) => el.isConnected && el !== region);
      if (changed.length) ro.cb([], ro as unknown as ResizeObserver);
    }
  }

  it("shows the fade when content overflows and the view is at the top", async () => {
    Object.assign(box, { scrollHeight: 800, clientHeight: 360, scrollTop: 0 });
    reply(15);
    renderWithProviders(<BlastRadiusCard prId="p1" repoId="r1" repoFullName="acme/widgets" />, { namespaces });
    await screen.findByRole("region", { name: blast.scrollRegion });
    await waitFor(() => expect(fade()).toHaveAttribute("data-visible", "true"));
  });

  it("hides the fade once scrolled to the bottom (2px tolerance)", async () => {
    Object.assign(box, { scrollHeight: 800, clientHeight: 360, scrollTop: 0 });
    reply(15);
    renderWithProviders(<BlastRadiusCard prId="p1" repoId="r1" repoFullName="acme/widgets" />, { namespaces });
    const region = await screen.findByRole("region", { name: blast.scrollRegion });
    await waitFor(() => expect(fade()).toHaveAttribute("data-visible", "true"));

    box.scrollTop = 439; // 1px short of the end, within tolerance
    fireEvent.scroll(region);
    expect(fade()).toHaveAttribute("data-visible", "false");

    box.scrollTop = 100;
    fireEvent.scroll(region);
    expect(fade()).toHaveAttribute("data-visible", "true");
  });

  it("re-measures when switching Tree/Graph swaps in content of a different height, without any scroll", async () => {
    Object.assign(box, { scrollHeight: 800, clientHeight: 360, scrollTop: 0 });
    reply(15, "ok");
    const user = userEvent.setup();
    renderWithProviders(<BlastRadiusCard prId="p1" repoId="r1" repoFullName="acme/widgets" />, { namespaces });
    const region = await screen.findByRole("region", { name: blast.scrollRegion });
    await waitFor(() => expect(fade()).toHaveAttribute("data-visible", "true"));

    Object.assign(box, { scrollHeight: 200, clientHeight: 200 }); // graph fits
    await user.click(screen.getByRole("button", { name: blast.view.graph }));
    resizeContent(region);
    await waitFor(() => expect(fade()).toHaveAttribute("data-visible", "false"));

    Object.assign(box, { scrollHeight: 800, clientHeight: 360 }); // tree overflows again
    await user.click(screen.getByRole("button", { name: blast.view.tree }));
    resizeContent(region);
    await waitFor(() => expect(fade()).toHaveAttribute("data-visible", "true"));
  });

  it("keeps the fade hidden without overflow", async () => {
    Object.assign(box, { scrollHeight: 200, clientHeight: 200, scrollTop: 0 });
    reply(2);
    renderWithProviders(<BlastRadiusCard prId="p1" repoId="r1" repoFullName="acme/widgets" />, { namespaces });
    await screen.findByRole("region", { name: blast.scrollRegion });
    expect(fade()).toHaveAttribute("data-visible", "false");
  });
});

describe("BlastRadiusCard caller row", () => {
  it("renders the path (full value in title) and the symbol name as separate elements", async () => {
    api.reply("GET", "/pulls/p1/blast", {
      status: "ok",
      reason: null,
      blast: {
        changed_symbols: [],
        downstream: [
          {
            symbol: "AgentCard",
            callers: [{ file: "src/app/agents/_components/AgentCard/AgentCard.test.tsx", line: 104, name: "renderCard" }],
            endpoints_affected: [],
            crons_affected: [],
          },
        ],
        summary: "",
      },
      head_sha: "abc",
      source_sha: null,
      index_status: "ready",
      cached: false,
      truncated: false,
      computed_at: null,
    });
    renderWithProviders(<BlastRadiusCard prId="p1" repoId="r1" repoFullName="acme/widgets" />, { namespaces });
    const full = "src/app/agents/_components/AgentCard/AgentCard.test.tsx:104";
    const path = await screen.findByTitle(full);
    const name = screen.getByText("renderCard");
    expect(path).toHaveTextContent(full);
    expect(path).not.toHaveTextContent("renderCard");
    expect(name).toBeInTheDocument();
  });
});

const oneCaller = [{ symbol: "doWork", callers: [{ file: "src/a b/x.ts", line: 7, name: "run" }] }];
const renderCard = () =>
  renderWithProviders(<BlastRadiusCard prId="p1" repoId="r1" repoFullName="acme/widgets" />, { namespaces });

describe("BlastRadiusCard caller links (tree)", () => {
  it("links file:line to GitHub at source_sha, in a new tab with noopener", async () => {
    replyBlast({ symbols: 1, downstream: oneCaller });
    renderCard();
    const link = await screen.findByRole("link", { name: "src/a b/x.ts:7" });
    expect(link).toHaveAttribute("href", "https://github.com/acme/widgets/blob/deadbeefcafe/src/a%20b/x.ts#L7");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("renders plain text in tree and graph when source_sha is null or empty", async () => {
    for (const source_sha of [null, ""]) {
      replyBlast({ symbols: 1, downstream: oneCaller, source_sha });
      renderCard();
      const user = userEvent.setup();
      expect(await screen.findByText("src/a b/x.ts:7")).toBeInTheDocument();
      expect(screen.queryAllByRole("link")).toHaveLength(0);
      await user.click(screen.getByRole("button", { name: blast.view.graph }));
      expect(screen.getByText("run:7")).toBeInTheDocument();
      expect(screen.queryAllByRole("link")).toHaveLength(0);
      cleanup();
    }
  });

  it("renders plain text when the repo full name is unknown", async () => {
    replyBlast({ symbols: 1, downstream: oneCaller });
    renderWithProviders(<BlastRadiusCard prId="p1" repoId="r1" repoFullName={null} />, { namespaces });
    expect(await screen.findByText("src/a b/x.ts:7")).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
});

describe("BlastRadiusCard graph", () => {
  const callers = [{ file: "src/f0.ts", line: 1, name: "caller0" }];

  it("wraps each caller label in a link whose accessible name starts with the visible label", async () => {
    replyBlast({ symbols: 1, downstream: [{ symbol: "doWork", callers }] });
    const user = userEvent.setup();
    renderCard();
    await screen.findByRole("region", { name: blast.scrollRegion });
    await user.click(screen.getByRole("button", { name: blast.view.graph }));
    const link = screen.getByRole("link", { name: /^caller0:1 \(src\/f0\.ts\)$/ });
    expect(link).toHaveAttribute("href", "https://github.com/acme/widgets/blob/deadbeefcafe/src/f0.ts#L1");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("caller0:1");
    expect(screen.queryByRole("img")).toBeNull();
  });
});

describe("BlastRadiusCard degraded badge and Resync", () => {
  it("shows the badge with the reason text for index_failed", async () => {
    replyBlast({ status: "degraded", reason: "index_failed", symbols: 1, downstream: oneCaller });
    renderCard();
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(blast.state.degraded);
    expect(status).toHaveTextContent(blast.reason.index_failed);
  });

  it("shows no badge when ok", async () => {
    replyBlast({ status: "ok", symbols: 1, downstream: oneCaller });
    renderCard();
    await screen.findByRole("region", { name: blast.scrollRegion });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("Resync posts once to /repos/r1/resync", async () => {
    api.reply("POST", "/repos/r1/resync", { status: "queued" }, 202);
    replyBlast({ status: "degraded", reason: "index_partial", symbols: 1, downstream: oneCaller });
    const user = userEvent.setup();
    renderCard();
    await user.click(await screen.findByRole("button", { name: blast.resync }));
    await waitFor(() => expect(api.requestsTo("POST", "/repos/r1/resync")).toHaveLength(1));
  });

  // Every reason a degraded badge can carry resolves to real copy (no raw key, no MISSING_MESSAGE).
  it.each(DEGRADED_REASONS)("shows the copy for the degraded reason %s", async (reason) => {
    replyBlast({ status: "degraded", reason, symbols: 1, downstream: oneCaller });
    renderCard();
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(blast.reason[reason]);
    expect(status).not.toHaveTextContent(/MISSING_MESSAGE|reason\./);
  });

  it.each(["flag_off", "repo_too_large"] as const)("offers no Resync for %s", async (reason) => {
    replyBlast({ status: "degraded", reason, symbols: 1, downstream: oneCaller });
    renderCard();
    expect(await screen.findByRole("status")).toHaveTextContent(blast.reason[reason]);
    expect(screen.queryByRole("button", { name: blast.resync })).not.toBeInTheDocument();
  });
});

describe("BlastRadiusCard no callers and plurals", () => {
  it("shows the no-callers text with the symbol count and no tree rows, in both views", async () => {
    replyBlast({
      symbols: 2,
      downstream: [
        { symbol: "a", callers: [] },
        { symbol: "b", callers: [] },
      ],
    });
    const user = userEvent.setup();
    renderCard();
    expect(await screen.findByText("2 changed symbols, no downstream callers found.")).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: blast.scrollRegion })).not.toBeInTheDocument();
    expect(screen.queryByText("a")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: blast.view.graph }));
    expect(screen.getByText("2 changed symbols, no downstream callers found.")).toBeInTheDocument();
  });

  it("uses singular and plural caller counts", async () => {
    replyBlast({
      symbols: 2,
      downstream: [
        { symbol: "one", callers: [{ file: "a.ts", line: 1, name: "x" }] },
        {
          symbol: "three",
          callers: [1, 2, 3].map((n) => ({ file: `b${n}.ts`, line: n, name: `y${n}` })),
        },
      ],
    });
    renderCard();
    expect(await screen.findByText("1 caller")).toBeInTheDocument();
    expect(screen.getByText("3 callers")).toBeInTheDocument();
  });
});
