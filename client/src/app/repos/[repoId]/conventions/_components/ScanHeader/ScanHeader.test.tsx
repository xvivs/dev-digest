/** ScanHeader — the header line and stats strip of AC-34, and the Re-scan button's states. */
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "@/test/render";
import messages from "../../../../../../../messages/en/conventions.json";
import costMessages from "../../../../../../../messages/en/cost.json";
import { scan } from "../../fixtures";
import { ScanHeader } from "./ScanHeader";

afterEach(cleanup);

function renderHeader(props: Partial<Parameters<typeof ScanHeader>[0]> = {}) {
  const onRescan = vi.fn();
  renderWithProviders(
    <ScanHeader repoName="payments-api" scan={scan()} onRescan={onRescan} scanning={false} rescanDisabled={false} {...props} />,
    { namespaces: { conventions: messages, cost: costMessages } },
  );
  return { onRescan };
}

describe("ScanHeader", () => {
  it("finished scan: heading, 'Detected from N sample files · last scan X ago' and every stat", () => {
    renderHeader();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Conventions in payments-api");
    expect(screen.getByText(/^Detected from 84 sample files · last scan .+ ago$/)).toBeInTheDocument();

    const stats = screen.getByRole("group", { name: "Scan statistics" });
    const statValue = (label: string) => {
      const term = within(stats).getByText(label, { selector: "dt" });
      // Each stat is a `div` wrapping one dt/dd pair; scope to it instead of walking siblings.
      const pair = term.parentElement;
      if (!pair) throw new Error(`no wrapper for stat ${label}`);
      return within(pair).getByRole("definition").textContent;
    };
    const labels = ["Found", "Verified", "Dropped", "Relocated", "Model", "Tokens", "Cost", "Duration"];
    expect(Object.fromEntries(labels.map((label) => [label, statValue(label)]))).toEqual({
      Found: "5",
      Verified: "3",
      Dropped: "2",
      Relocated: "1",
      Model: "deepseek/deepseek-v4-flash",
      Tokens: "12.3k in · 950 out",
      Cost: "~$0.0012",
      Duration: "42s",
    });
  });

  it("marks an estimated cost with ~, a provider-billed one without, and dashes unrecorded stats", () => {
    renderHeader({ scan: scan({ cost_usd: 0.5, cost_source: "provider" }) });
    expect(screen.getByText("$0.500")).toBeInTheDocument();
    expect(screen.queryByText("~$0.500")).not.toBeInTheDocument();
    cleanup();

    renderHeader({ scan: scan({ model: null, tokens_in: null, tokens_out: null, cost_usd: null, cost_source: null, duration_ms: null }) });
    const stats = screen.getByRole("group", { name: "Scan statistics" });
    expect(within(stats).getAllByText("—")).toHaveLength(4);
  });

  it("before a first scan: explains the page, hides stats and Re-scan (B6)", () => {
    renderHeader({ scan: null });
    expect(screen.getByText(/Scan the cloned repo to surface house-rules/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Scan statistics" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Re-scan|Scanning/ })).not.toBeInTheDocument();
  });

  it("Re-scan: clickable when idle, disabled when told to and while scanning", async () => {
    const user = userEvent.setup();
    const { onRescan } = renderHeader();
    await user.click(screen.getByRole("button", { name: "Re-scan" }));
    expect(onRescan).toHaveBeenCalledTimes(1);
    cleanup();

    renderHeader({ rescanDisabled: true });
    expect(screen.getByRole("button", { name: "Re-scan" })).toBeDisabled();
    cleanup();

    renderHeader({ scanning: true });
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
  });

  it("while a scan runs: 'Scanning… started X ago', no stats, disabled button even without `scanning` (B5)", () => {
    renderHeader({ runningScan: scan({ id: "s2", status: "running", finished_at: null }), scanning: true });
    expect(screen.getByText(/^Scanning… started .+ ago$/)).toBeInTheDocument();
    expect(screen.queryByText(/^Detected from/)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Scan statistics" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
    cleanup();

    renderHeader({ runningScan: scan({ status: "running", finished_at: null }) });
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
  });

  it("after a failure: 'Last scan failed X ago', a note dating the older results when there are any (B5)", () => {
    renderHeader({
      failedScan: scan({ id: "f", status: "failed" }),
      scan: scan({ finished_at: "2026-09-20T09:00:42.000Z" }),
    });
    expect(screen.getByText(/^Last scan failed .+ ago$/)).toBeInTheDocument();
    expect(screen.getByText("Showing results from scan of Sep 20, 2026")).toBeInTheDocument();
    expect(screen.queryByText(/^Detected from/)).not.toBeInTheDocument();
    cleanup();

    renderHeader({ failedScan: scan({ status: "failed" }), scan: null });
    expect(screen.getByText(/^Last scan failed/)).toBeInTheDocument();
    expect(screen.queryByText(/Showing results/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Re-scan" })).toBeEnabled();
  });
});

describe("ScanHeader clock while a scan runs", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const running = scan({ id: "s2", status: "running", started_at: "2026-09-29T09:00:00.000Z", finished_at: null });

  it("keeps 'Scanning… started X ago' counting without any prop change", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T09:00:05.000Z"));
    renderHeader({ runningScan: running, scanning: true });
    expect(screen.getByText("Scanning… started 5 seconds ago")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(screen.getByText("Scanning… started 1 minute ago")).toBeInTheDocument();
  });

  it("never shows a future start: a started_at ahead of the browser clock reads 'just now'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T08:59:54.000Z"));
    renderHeader({ runningScan: running, scanning: true });
    expect(screen.getByText("Scanning… started just now")).toBeInTheDocument();
    expect(screen.queryByText(/ in /)).not.toBeInTheDocument();
  });

  it("changes the text after 5 s while a scan runs", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T09:00:03.000Z"));
    renderHeader({ runningScan: running, scanning: true });
    expect(screen.getByText("Scanning… started 3 seconds ago")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5_000);
    });
    expect(screen.getByText("Scanning… started 8 seconds ago")).toBeInTheDocument();
  });

  it("clamps last scan and failed scan in the future to 'just now'", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T08:59:00.000Z"));
    renderHeader({ scan: scan({ finished_at: "2026-09-29T09:00:00.000Z" }) });
    expect(screen.getByText("Detected from 84 sample files · last scan just now")).toBeInTheDocument();
    cleanup();
    renderHeader({ failedScan: scan({ status: "failed", finished_at: "2026-09-29T09:00:00.000Z" }), scan: null });
    expect(screen.getByText("Last scan failed just now")).toBeInTheDocument();
  });

  it("does not move the label between two ticks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T09:00:05.000Z"));
    renderHeader({ runningScan: running, scanning: true });
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.getByText("Scanning… started 5 seconds ago")).toBeInTheDocument();
  });

  it("keeps 'last scan X ago' aging after a scan finished, ticking every 30 s only", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T09:05:00.000Z"));
    renderHeader({ scan: scan({ finished_at: "2026-09-29T09:00:42.000Z" }) });
    expect(screen.getByText("Detected from 84 sample files · last scan 4 minutes ago")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(screen.getByText("Detected from 84 sample files · last scan 4 minutes ago")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(10 * 60_000);
    });
    expect(screen.getByText("Detected from 84 sample files · last scan 14 minutes ago")).toBeInTheDocument();
  });
});
