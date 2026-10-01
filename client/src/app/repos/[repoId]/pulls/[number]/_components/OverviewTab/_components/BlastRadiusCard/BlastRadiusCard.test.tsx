import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { screen, cleanup, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import brief from "@/../messages/en/brief.json";
import blast from "@/../messages/en/blast.json";
import { renderWithProviders } from "@/test/render";
import { setupFakeApi } from "@/test/fake-api";
import { BlastRadiusCard } from "./BlastRadiusCard";
import { BLAST_BODY_MAX_HEIGHT } from "./styles";

const api = setupFakeApi();
afterEach(cleanup);

const namespaces = { brief, blast };

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
    renderWithProviders(<BlastRadiusCard prId="p1" />, { namespaces });
    const region = await screen.findByRole("region", { name: blast.scrollRegion });
    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveStyle({ maxHeight: `${BLAST_BODY_MAX_HEIGHT}px`, overflowY: "auto" });
    expect(within(region).getAllByText(/^symbol\d+$/)).toHaveLength(15);

    expect(region).not.toContainElement(screen.getByText(brief.block.blast));
    expect(region).not.toContainElement(screen.getByRole("status"));
    expect(region).not.toContainElement(screen.getByText(blast.stat.symbols));
    expect(region).not.toContainElement(screen.getByRole("button", { name: blast.view.tree }));
  });

  it("keeps the graph view inside the scroll region too", async () => {
    reply(15, "ok");
    renderWithProviders(<BlastRadiusCard prId="p1" />, { namespaces });
    await screen.findByRole("region", { name: blast.scrollRegion });
    await userEvent.click(screen.getByRole("button", { name: blast.view.graph }));
    const region = screen.getByRole("region", { name: blast.scrollRegion });
    expect(within(region).getByRole("img", { name: blast.graph.ariaLabel })).toBeInTheDocument();
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

  it("shows the fade when content overflows and the view is at the top", async () => {
    Object.assign(box, { scrollHeight: 800, clientHeight: 360, scrollTop: 0 });
    reply(15);
    renderWithProviders(<BlastRadiusCard prId="p1" />, { namespaces });
    await screen.findByRole("region", { name: blast.scrollRegion });
    await waitFor(() => expect(fade()).toHaveAttribute("data-visible", "true"));
    expect(fade()).toHaveStyle({ opacity: "1", pointerEvents: "none" });
  });

  it("hides the fade once scrolled to the bottom (2px tolerance)", async () => {
    Object.assign(box, { scrollHeight: 800, clientHeight: 360, scrollTop: 0 });
    reply(15);
    renderWithProviders(<BlastRadiusCard prId="p1" />, { namespaces });
    const region = await screen.findByRole("region", { name: blast.scrollRegion });
    await waitFor(() => expect(fade()).toHaveAttribute("data-visible", "true"));

    box.scrollTop = 439; // 1px short of the end, within tolerance
    fireEvent.scroll(region);
    expect(fade()).toHaveAttribute("data-visible", "false");
    expect(fade()).toHaveStyle({ opacity: "0" });

    box.scrollTop = 100;
    fireEvent.scroll(region);
    expect(fade()).toHaveAttribute("data-visible", "true");
  });

  it("keeps the fade hidden without overflow", async () => {
    Object.assign(box, { scrollHeight: 200, clientHeight: 200, scrollTop: 0 });
    reply(2);
    renderWithProviders(<BlastRadiusCard prId="p1" />, { namespaces });
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
    renderWithProviders(<BlastRadiusCard prId="p1" />, { namespaces });
    const full = "src/app/agents/_components/AgentCard/AgentCard.test.tsx:104";
    const path = await screen.findByTitle(full);
    const name = screen.getByText("renderCard");
    expect(path).toHaveTextContent(full);
    expect(path).not.toBe(name);
    expect(path).not.toContainElement(name);
    expect(path.parentElement).toContainElement(name);
  });
});
