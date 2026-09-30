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
  it("titles the page with the repo name", () => {
    renderHeader();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Conventions in payments-api");
  });

  it("reads 'Detected from N sample files · last scan X ago'", () => {
    renderHeader();
    expect(screen.getByText(/^Detected from 84 sample files · last scan .+ ago$/)).toBeInTheDocument();
  });

  it("shows every stat of the scan", () => {
    renderHeader();
    const stats = screen.getByRole("group", { name: "Scan statistics" });
    const values = Object.fromEntries(
      ["Found", "Verified", "Dropped", "Relocated", "Model", "Tokens", "Cost", "Duration"].map((label) => [
        label,
        within(stats).getByText(label).nextElementSibling?.textContent,
      ]),
    );
    expect(values).toEqual({
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

  it("marks an estimated cost with ~ and a provider-billed one without", () => {
    cleanup();
    renderHeader({ scan: scan({ cost_usd: 0.5, cost_source: "provider" }) });
    expect(screen.getByText("$0.500")).toBeInTheDocument();
  });

  it("shows a dash for stats the scan did not record", () => {
    renderHeader({ scan: scan({ model: null, tokens_in: null, tokens_out: null, cost_usd: null, cost_source: null, duration_ms: null }) });
    const stats = screen.getByRole("group", { name: "Scan statistics" });
    expect(within(stats).getAllByText("—")).toHaveLength(4);
  });

  it("explains the page and hides the stats before a first scan", () => {
    renderHeader({ scan: null });
    expect(screen.getByText(/Scan the cloned repo to surface house-rules/)).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Scan statistics" })).not.toBeInTheDocument();
  });

  it("re-scans on click", async () => {
    const user = userEvent.setup();
    const { onRescan } = renderHeader();
    await user.click(screen.getByRole("button", { name: "Re-scan" }));
    expect(onRescan).toHaveBeenCalledTimes(1);
  });

  it("disables Re-scan and says so while scanning", () => {
    renderHeader({ scanning: true });
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
  });

  it("disables Re-scan when told to", () => {
    renderHeader({ rescanDisabled: true });
    expect(screen.getByRole("button", { name: "Re-scan" })).toBeDisabled();
  });

  it("hides Re-scan before the first scan (B6)", () => {
    renderHeader({ scan: null });
    expect(screen.queryByRole("button", { name: /Re-scan|Scanning/ })).not.toBeInTheDocument();
  });

  it("while a scan runs: 'Scanning… started X ago', no stats, disabled button (B5)", () => {
    renderHeader({ runningScan: scan({ id: "s2", status: "running", finished_at: null }), scanning: true });
    expect(screen.getByText(/^Scanning… started .+ ago$/)).toBeInTheDocument();
    expect(screen.queryByText(/^Detected from/)).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Scan statistics" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
  });

  it("disables Re-scan for a running scan even when `scanning` is not set", () => {
    renderHeader({ runningScan: scan({ status: "running", finished_at: null }) });
    expect(screen.getByRole("button", { name: "Scanning…" })).toBeDisabled();
  });

  it("after a failure: 'Last scan failed X ago' plus a muted note dating the older results (B5)", () => {
    renderHeader({
      failedScan: scan({ id: "f", status: "failed" }),
      scan: scan({ finished_at: "2026-09-20T09:00:42.000Z" }),
    });
    expect(screen.getByText(/^Last scan failed .+ ago$/)).toBeInTheDocument();
    expect(screen.getByText("Showing results from scan of Sep 20, 2026")).toBeInTheDocument();
    expect(screen.queryByText(/^Detected from/)).not.toBeInTheDocument();
  });

  it("after a failure with no earlier results: no 'Showing results' note", () => {
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

  it("does not move the label between two ticks", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T09:00:05.000Z"));
    renderHeader({ runningScan: running, scanning: true });
    act(() => {
      vi.advanceTimersByTime(4_000);
    });
    expect(screen.getByText("Scanning… started 5 seconds ago")).toBeInTheDocument();
  });

  it("does not tick when no scan is running", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-29T09:05:00.000Z"));
    renderHeader({ scan: scan({ finished_at: "2026-09-29T09:00:42.000Z" }) });
    const label = /^Detected from 84 sample files · last scan 4 minutes ago$/;
    expect(screen.getByText(label)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(600_000);
    });
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
